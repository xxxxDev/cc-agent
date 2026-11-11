const crypto = require('crypto');
const { resolveClientIp } = require('../services/clientIp');

// Site-wide mutation guards. The app authenticates with a
// cookie (authMiddleware.js), so without these a logged-in user's browser can
// be driven by any third-party page: agents, schedules and accounts changed in
// their name. These are deliberately identity-blind: they run before verifyToken
// and never read req.userId/req.username/req.role.

// Single source of truth for the origin policy. server/app.js's cors() calls
// isAllowedOrigin() too, so the CORS list and the mutation gate cannot drift
// apart. NODE_ENV is read at call time (it is fixed at boot in every real
// deployment, so this is free) so the same code path serves both environments.

// The address and the ports come from server/siteConfig.js (one place).
// The service is reached through its public address (a proxy or tunnel) and on this
// machine's loopback; the Host check in server/app.js (siteConfig.isAllowedHost)
// refuses any other Host, a LAN address included, before these guards run.
const site = require('../siteConfig');
const SERVING_PORT = site.servicePort();

// Always allowed, both environments. Origin-checked even for the app's own
// POSTs, so the prod domain MUST stay allow-listed or login/POSTs fail.
const alwaysAllowedOrigins = [site.publicOrigin()];

// Dev-only. localhost / 127.0.0.1 are origins an attacker can serve a page from,
// so they are NOT trusted in production. But the SPA is served at localhost
// during local dev and cors() gates its GETs too, so removing them in dev would
// break local dev entirely — hence the env split, not a plain deletion.
// Asked at each request: whether the dev ports count (siteConfig.devMode) can change.
const devOnlyOrigins = () => [...new Set([...site.loopbackPorts(), ...site.devPorts()])].flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

// Private-range LAN origins. The Host check (siteConfig.isAllowedHost) admits only
// the public host and loopback, so a request sent to a LAN address never gets here;
// these only matter for a request that reaches an allowed Host from a page on a LAN
// address. In prod an origin is PINNED to the single serving port, so a page an
// attacker serves on another port of a LAN host is not a trusted origin.
const LAN_HOST = '(?:10\\.\\d+\\.\\d+\\.\\d+|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+)';
const privateLanProd = new RegExp(`^https?://${LAN_HOST}:${SERVING_PORT}$`);
// Dev: the vite dev server, the service and a scratch instance (siteConfig) — not any port, which let a page served from anywhere on the LAN make
// credentialed requests here.
const privateLanDev = () => new RegExp(`^https?://${LAN_HOST}:(?:${[...new Set([...site.devPorts(), ...site.loopbackPorts()])].join('|')})$`);

// Passkeys belong to the public address alone: a key made for localhost would be the
// same key on every machine and port, and anything serving a page there could ask
// for it. The setting PRODUCT.env.passkeyDevOrigin names (siteConfig.js) is a second
// trusted origin for passkeys, for a scratch instance while developing.
function isPasskeyOrigin(origin) {
  if (alwaysAllowedOrigins.includes(origin)) return true;
  // Not where NODE_ENV is production. On a local install scripts/start.mjs sets
  // development, so there the only thing keeping this shut is that the variable is
  // never set for the live service: it is given on the command line of a scratch
  // instance alone.
  const devOrigin = process.env[site.PRODUCT.env.passkeyDevOrigin];
  return process.env.NODE_ENV !== 'production' && !!devOrigin && origin === devOrigin;
}

function isAllowedOrigin(origin) {
  if (alwaysAllowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') {
    return privateLanProd.test(origin);
  }
  return devOnlyOrigins().includes(origin) || privateLanDev().test(origin);
}

// GET/HEAD are never gated, so the SSE stream (GET /api/schedules/stream) is
// untouched. OPTIONS is cors()'s preflight and never reaches a route.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const isUnsafe = (req) => !SAFE_METHODS.has(req.method);

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const csrfTokenShape = /^[a-f0-9]{64}$/;

// Whether this request reached the browser over HTTPS. The tunnel terminates TLS
// and forwards to loopback in plain HTTP, and Cloudflare redirects plain HTTP to
// the public host before it gets here, so that Host is the signal. Loopback access
// stays plain HTTP, where a Secure cookie would never be sent back.
// Keying the flag on NODE_ENV would not work: this service does not run with
// NODE_ENV=production.
const PUBLIC_HOSTS = new Set(alwaysAllowedOrigins.map((origin) => new URL(origin).hostname));
function isHttpsRequest(req) {
  return Boolean(req && (req.secure || req.get?.('x-forwarded-proto') === 'https' || PUBLIC_HOSTS.has(String(req.hostname || ''))));
}

function csrfCookieOpts(req) {
  return {
    // the SPA has to read this one back out to echo it in the header, so unlike
    // session_id it cannot be httpOnly — it is a CSRF token, not a credential
    httpOnly: false,
    secure: isHttpsRequest(req),
    sameSite: 'Lax',
    path: '/',
  };
}

// A session cookie by design: if it is dropped, the next /api request re-mints
// it before any mutation can be attempted (App.vue fires GET /api/auth/verify
// on every boot), so the pair is self-healing and survives a server restart.
function issueCsrfCookie(req, res, next) {
  if (!csrfTokenShape.test(req.cookies?.[CSRF_COOKIE] || '')) {
    res.cookie(CSRF_COOKIE, crypto.randomBytes(32).toString('hex'), csrfCookieOpts(req));
  }
  next();
}

function sameToken(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function requireAllowedOrigin(req, res, next) {
  if (!isUnsafe(req)) return next();
  const origin = req.get('origin');
  // fail closed: absent or unparseable Origin is refused, never waved through
  if (!origin || !isAllowedOrigin(origin)) {
    return res.status(403).json({ message: 'Origin not allowed' });
  }
  next();
}

// Blocks the form-post / simple-request CSRF shapes (text/plain,
// form-urlencoded, multipart) that never trigger a preflight. Only enforced when
// a body is actually present: the app's DELETEs are bodyless and would otherwise
// be refused for a content-type they have no reason to send.
function hasBody(req) {
  return req.get('transfer-encoding') !== undefined || Number(req.get('content-length')) > 0;
}

function requireJsonContentType(req, res, next) {
  if (!isUnsafe(req) || !hasBody(req)) return next();
  // Binary uploads keep the same origin, CSRF and authentication gates: a file for
  // a message, or an agent's picture. application/octet-stream is not a type a form
  // can send without a preflight, so this opens no simple-request CSRF shape.
  if (req.method === 'POST' && /^\/conversations\/[a-f0-9-]{36}\/(attachments|avatar)$/.test(req.path) && req.is('application/octet-stream')) return next();
  if (!req.is('application/json')) {
    return res.status(415).json({ message: 'Content-Type must be application/json' });
  }
  next();
}

// Double-submit cookie: the token is echoed from a JS-readable cookie into a
// header. A cross-site attacker can make the browser SEND the cookie but cannot
// READ it (it is host-only, and JS cannot see Set-Cookie), so it cannot populate
// the header. This needs no server-side state, unlike a session-bound HMAC.
function requireCsrfToken({ exempt = [] } = {}) {
  return (req, res, next) => {
    if (!isUnsafe(req) || exempt.includes(req.path)) return next();
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (
      !csrfTokenShape.test(cookie || '') ||
      !csrfTokenShape.test(header || '') ||
      !sameToken(cookie, header)
    ) {
      return res.status(403).json({ message: 'Invalid CSRF token' });
    }
    next();
  };
}

// Fixed window, in memory, same shape as authController's login-failure limiter.
const RATE_LIMIT_MAX_KEYS = 5000;

const { ipGroup } = require('../services/qrLogin');
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    if (!isUnsafe(req)) return next();
    const now = Date.now();
    // By the address's group, as the sign-in blocks are: an IPv6 /64 is one caller.
    const key = ipGroup(String(resolveClientIp(req) || 'unknown'));
    let entry = hits.get(key);
    // reclaim this caller's own expired bucket so a returning client is a fresh
    // window, not counted as a brand-new key against the cap
    if (entry && now > entry.resetAt) {
      hits.delete(key);
      entry = undefined;
    }
    if (!entry) {
      // Admitting a NEW key. Sweeping only expired entries frees nothing under a
      // flood of unique unexpired, trusted client addresses, so after
      // an opportunistic sweep we FAIL CLOSED once full: an unbounded key map is
      // itself a denial-of-service. Existing keys (handled above/below) are never
      // rejected here, so legitimate in-window callers keep their bucket.
      if (hits.size >= RATE_LIMIT_MAX_KEYS) {
        for (const [k, e] of hits) if (now > e.resetAt) hits.delete(k);
      }
      if (hits.size >= RATE_LIMIT_MAX_KEYS) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        return res.status(429).json({ message: 'Too many requests, slow down' });
      }
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ message: 'Too many requests, slow down' });
    }
    next();
  };
}

// express.json()'s 100kb default, stated explicitly: mutation bodies are small
// allow-listed field sets, far below it.
const JSON_BODY_LIMIT = '100kb';

// express's default error handler answers a body-parser error with HTML — and
// leaks a stack trace outside production. Keep the API's JSON error shape.
function jsonBodyErrorHandler(err, req, res, next) {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body too large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }
  return next(err);
}

module.exports = {
  isAllowedOrigin,
  isPasskeyOrigin,
  isHttpsRequest,
  issueCsrfCookie,
  requireAllowedOrigin,
  requireJsonContentType,
  requireCsrfToken,
  rateLimit,
  RATE_LIMIT_MAX_KEYS,
  jsonBodyErrorHandler,
  JSON_BODY_LIMIT,
};

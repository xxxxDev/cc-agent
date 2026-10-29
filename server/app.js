require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const authRoutes = require('./routes/authRoutes');
const pushRoutes = require('./routes/pushRoutes');
const { security } = require('./services/securityLog');
const { getDefaultPushService } = require('./services/pushService');
const { resolveClientIp } = require('./services/clientIp');
const { audit } = require('./services/audit');
const {
  isAllowedOrigin,
  issueCsrfCookie,
  requireAllowedOrigin,
  requireJsonContentType,
  requireCsrfToken,
  rateLimit,
  jsonBodyErrorHandler,
  JSON_BODY_LIMIT,
} = require('./middlewares/requestGuards');

const {PRODUCT, isAllowedHost, isHttpsHost, servicePort, publicOrigin} = require('./siteConfig');
// A wrong setting stops the service at start, not at the first request.
publicOrigin();
// The setting PRODUCT.env.distDir names (CC_AGENT_DIST_DIR here) is a test seam: a throwaway instance serves a scratch build, not
// the live dist/ (a throwaway test instance).
const DIST_DIR = process.env[PRODUCT.env.distDir] || path.join(__dirname, '..', 'dist');

// Content-Security-Policy: scripts come only from
// this origin, plus the inline scripts of the pages in dist/ (index.html's theme
// bootstrap, reset-sw.html's recovery script), each allowed by its hash. The
// hashes are taken from the files actually being served and re-taken whenever a
// rebuild changes them, so a rebuild cannot quietly break a page or widen the
// policy. Styles stay 'unsafe-inline': Framework7 writes style attributes.
// Every response carries the policy, the agents' bridge polls included, so the folder
// is looked at no more than once a second rather than on each of them; a response
// that may be a page looks every time, so it never meets the previous build's hashes.
const INLINE_CHECK_MS = 1000;
let inlineScripts = { stamp: '', sources: '', checked: 0 };
function inlineScriptSources(page) {
  const now = Date.now();
  if (!page && now - inlineScripts.checked < INLINE_CHECK_MS) return inlineScripts.sources;
  inlineScripts.checked = now;
  try {
    const pages = fs.readdirSync(DIST_DIR).filter((name) => name.endsWith('.html')).sort().map((name) => path.join(DIST_DIR, name));
    const stamp = pages.map((file) => `${file}:${fs.statSync(file).mtimeMs}`).join('|');
    if (stamp !== inlineScripts.stamp) {
      const bodies = pages.flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]));
      const hashes = new Set(bodies.map((body) => `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`));
      inlineScripts = { stamp, sources: [...hashes].join(' '), checked: now };
    }
  } catch {
    inlineScripts = { stamp: '', sources: '', checked: now };
  }
  return inlineScripts.sources;
}
function contentSecurityPolicy(host, page) {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptSources(page)}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ws://${host} wss://${host}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    // Frames are this site's own pages only. The .html attachment preview relies on
    // it: its frame cannot be sent to another site (ccAgentRoutes, the /page route).
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    // Nothing frames this app, itself included: the split view draws its cells
    // natively, so framing stays closed.
    "frame-ancestors 'none'",
    // A source this product's pages need beyond these is named in siteConfig.js
    // (PRODUCT.cspExtraSources), added to its directive here.
  ].map((line) => [line, ...(PRODUCT.cspExtraSources[line.split(' ')[0]] || [])].join(' ')).join('; ');
}

const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{if(!isAllowedHost(req.headers.host))return res.status(403).json({message:'Invalid Host'});res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',contentSecurityPolicy(req.headers.host,false));
 // Only the public host is HTTPS (its proxy or tunnel serves it over TLS);
 // loopback, the only other Host admitted above, stays plain HTTP and must not be pinned to HTTPS.
 if(isHttpsHost(req.headers.host))res.setHeader('Strict-Transport-Security','max-age=31536000');
 next();});
app.use(compression());

const PORT = servicePort();

// Refuse cross-site mutations explicitly, and before cors(). cors()
// only refuses a disallowed origin by accident — its error callback surfaces as
// a 500 — and it deliberately waves through a request carrying no Origin at all,
// which is the actual hole. Safe methods are not gated, so cors() keeps its
// existing behaviour for everything else.
// Requests the site's guards turned away, counted a day for the admin's security
// page (services/securityLog.js): not signed in, rate-limited, refused.
app.use('/api', (req, res, next) => {
  res.on('finish', () => { const s = res.statusCode; if (s === 401) security.guard('unauth'); else if (s === 429) security.guard('rate'); else if (s === 403) security.guard('refused'); });
  next();
});
app.use('/api', requireAllowedOrigin);

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));

// The other machine's exchange (peer link, agentStore/peerLink.js): up to 256 KB, only on
// the lowercase path and never from Cloudflare or a page, before the site-wide limit.
app.use('/bridge/peer', (req, res, next) => (!req.originalUrl.startsWith('/bridge/peer/') || req.headers.origin || req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['cdn-loop'] ? res.status(404).json({ message: 'Not found' }) : next()), express.json({ limit: '256kb' }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(jsonBodyErrorHandler);
app.use(cookieParser());
// cookie-parser turns a cookie written as j:{…} into an object. A session cookie is a
// string or it is nothing: dropped here, before any route can hand it to a query.
app.use((req,res,next)=>{for(const k of ['session_id'])if(k in req.cookies&&typeof req.cookies[k]!=='string')delete req.cookies[k];next();});
// The bridge is for the agents on this machine, which call 127.0.0.1 directly.
// Tunnel traffic also arrives from 127.0.0.1, so anything Cloudflare forwarded —
// recognised by the headers it adds — is refused as if the path did not exist.
// Express ignores case here but a proxy rule on /bridge may not, so only lowercase is the bridge.
// Refusals and failed bridge calls are audited; the API audit below never saw them.
app.use('/bridge', (req, res, next) => {
  const cloudflare = req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['cdn-loop'];
  if (cloudflare || !req.originalUrl.startsWith('/bridge')) {
    audit({ source: 'bridge', method: req.method, path: req.originalUrl, status: 404, reason: cloudflare ? 'forwarded by Cloudflare' : 'not spelled /bridge', ip: resolveClientIp(req) });
    return res.status(404).json({ message: 'Not found' });
  }
  res.on('finish', () => {
    if (res.statusCode >= 400) audit({ source: 'bridge', method: req.method, path: req.originalUrl, status: res.statusCode });
  });
  next();
});
require('./ccAgentRoutes').installBridge(app);
app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
// The conversation list and the open conversation are polled every 1.2s; their
// successful reads were 99% of the log and buried everything else in it.
const POLL = /^\/api\/conversations(?:\/[0-9a-f-]{36})?(?:\?.*)?$/;
app.use('/api', (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode < 400 && POLL.test(req.originalUrl)) return;
    const entry = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - started,
      // A name typed by someone not signed in, on a request that failed, may be a
      // password put in the wrong box: only its first letters are kept, as in the
      // security log.
      username: req.username || (typeof req.body?.username === 'string' ? (res.statusCode < 400 || req.body.username.length <= 3 ? req.body.username.slice(0, 80) : `${req.body.username.slice(0, 3)}…`) : undefined),
      role: req.role,
      hasSessionCookie: Boolean(req.cookies?.session_id),
      ip: resolveClientIp(req),
    };
    audit(entry);
  });
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// The rest of the site-wide mutation policy. Mounted on /api itself, so
// every mutation inherits it without opting in. GET/HEAD pass straight through (the SSE stream is unaffected).
app.use(
  '/api',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 60 }),
  issueCsrfCookie,
  requireJsonContentType,
  requireCsrfToken({ exempt: ['/auth/login'] }),
);
// Login holds no session, and so no CSRF token, yet: it is CSRF-exempt above and
// instead carries a stricter volume cap of its own. That is a different control
// from authController's failure-based lockout, which only
// counts failures — this one caps attempts whether they succeed or not.
// Each step its own count (the exact path): the name, the password and the code
// shared one twenty, and three name lookups could spend a sign-in's worth.
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.post('/api/auth/login/code', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.post('/api/auth/login/start', rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }));
// A login page asks for a QR request each minute, holding no session: a cap of its own.
app.use('/api/auth/qr/start', rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }));
// Passkey sign-in, before a session: each try is a challenge and a signature check.
app.use('/api/auth/passkey', rateLimit({ windowMs: 15 * 60 * 1000, max: 80 }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'cc-agent', port: Number(PORT) }));
app.use('/api/auth', authRoutes);



app.use('/api/push', pushRoutes);
app.use('/api/admin/security', require('./routes/adminSecurityRoutes'));

require('./ccAgentRoutes').installAgentRoutes(app);
app.use('/api',(req,res)=>res.status(404).json({message:'Not found'}));
const wwwDir = DIST_DIR;
// Unhashed PWA control files must revalidate on every load: when the origin is
// silent Cloudflare injects a months-long browser TTL, and a cached stale
// registerSW.js once stranded browsers in a worker-less state. Hashed /assets/ names change every build, so they may cache
// forever — but only if we say so explicitly, for the same reason.
const NO_CACHE_BASENAMES = new Set([
  'index.html',
  'registerSW.js',
  'sw.js',
  'push-handler.js',
  'push-config.js',
  'manifest.webmanifest',
  // The update check reads this to learn which build the origin is serving. A
  // cached copy makes the app compare itself against its own stale answer, so
  // the check silently never fires — the other half of the precache exclusion
  // in vite.config.js.
  'version.json',
]);
function staticCacheHeaders(res, filePath) {
  if (path.extname(filePath).toLowerCase() === '.html') res.setHeader('Content-Security-Policy',contentSecurityPolicy(res.req.headers.host,true));
  if (NO_CACHE_BASENAMES.has(path.basename(filePath))) {
    res.setHeader('Cache-Control', 'no-cache');
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}
app.use(express.static(wwwDir, { setHeaders: staticCacheHeaders }));
app.get('*', (req, res) => {
  res.setHeader('Content-Security-Policy',contentSecurityPolicy(req.headers.host,true));
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(wwwDir, 'index.html'));
});

app.use((err,req,res,next)=>{res.status(err.status||500).json({message:err.status?err.message:'伺服器發生錯誤'});if(!err.status)console.error(err);});
module.exports={app};

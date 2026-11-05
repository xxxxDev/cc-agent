const path = require('path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { usersDB, sessionsDB, userLifecycleTransitionsDB, loginDevicesDB, passkeysDB } = require('../stores');
const qrLogin = require('../services/qrLogin');
const twoStep = require('../services/twoStep');
const passkeys = require('../services/passkeys');
const { audit } = require('../services/audit');
const { resolveClientIp, isLoopback } = require('../services/clientIp');
const { security, accountKey } = require('../services/securityLog');
const { resolveLivePrincipal } = require('../services/livePrincipal');
const { hashSessionToken } = require('../services/sessionTokens');
const { compactQuietly } = require('../services/compactQuietly');
const { isHttpsRequest, isPasskeyOrigin } = require('../middlewares/requestGuards');
const { defaultUserOrder } = require('../services/userOrder');
const {
  LIFECYCLE_STATUS,
  effectiveLifecycleStatus,
  isActiveUser,
  normalizeUsername,
  findPendingLifecycleTransition,
} = require('../services/userLifecycle');

// Session model: a sliding 15-day idle window. The JWT + cookie carry
// a long absolute backstop (~400d, near the browser cookie cap); the REAL logout
// gate is sessionsDB.expiresAt, which verifyToken/verifySession check and
// touchActivity() slides forward on activity. Net effect: active users never have
// to re-login; 15 idle days logs them out. All knobs are env-overridable.
const IDLE_SECONDS = Number(process.env.SESSION_IDLE_DAYS || 15) * 24 * 60 * 60;
const TOKEN_TTL_SECONDS = Number(process.env.SESSION_MAX_DAYS || 400) * 24 * 60 * 60;
const ONLINE_WINDOW_MS = Number(process.env.ONLINE_WINDOW_MINUTES || 5) * 60 * 1000;
const SLIDE_THROTTLE_MS = 60 * 1000; // rewrite lastSeen / slide expiresAt at most once per 60s per user
const MIN_PASSWORD_LENGTH = 8;
const FRESH_SIGN_IN_MS = 5 * 60_000; // see justSignedIn

// Display names and usernames reach HTML an admin sees: Framework7 built its
// dialogs from them unescaped, and a member's name ran as script in the admin's
// session. The client now escapes every dialog;
// the server still refuses markup and control characters and caps the length,
// so what is stored never depends on that. A double quote too: a name lands in an
// attribute as easily as in text.
const NAME_MAX_LENGTH = 50;
const USERNAME_MAX_LENGTH = 64;
const MARKUP_OR_CONTROL = /[<>"\u0000-\u001f\u007f]/;
function textProblem(value, max, label) {
  if (value.length > max) return `${label} must be at most ${max} characters`;
  if (MARKUP_OR_CONTROL.test(value)) return `${label} cannot contain < > " or control characters`;
  return null;
}

// In-memory throttle so an active client hitting the API repeatedly doesn't rewrite
// NeDB on every request. Keyed by session (touchKey); resets on restart (worst case:
// one extra write per session after a restart). Single process, so one map.
const lastTouchAt = new Map();
// By session, not by account: with one throttle for the account, a phone used for a
// moment while a computer kept winning the minute never slid, and its session could
// run out while in use. The same key where a session is issued
// and where it slides: issued under the account's id alone, the first request after
// a sign-in wrote everything again.
const touchKey = (userId, token) => `${userId}:${hashSessionToken(token).slice(0, 16)}`;

// Failed sign-ins lock an address out and block it for longer each time
// (services/securityLog.js); each try is kept for the admin's page.
const placeOf = (req) => security.where(req, isLoopback(req.socket?.remoteAddress || req.connection?.remoteAddress));

// case-insensitive exact-match username lookup (external users WILL type
// "alice" for "Alice"; NeDB has no collation, so use an anchored regex)
function usernameQuery(username) {
  const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { username: new RegExp(`^${escaped}$`, 'i') };
}

function activeUserMutationQuery(userId) {
  return {
    _id: userId,
    $or: [
      { lifecycleStatus: LIFECYCLE_STATUS.ACTIVE },
      { lifecycleStatus: { $exists: false } },
    ],
  };
}

function nonTombstoneUserMutationQuery(userId) {
  return {
    _id: userId,
    lifecycleStatus: { $ne: LIFECYCLE_STATUS.DELETED_TOMBSTONE },
  };
}

// Turned away without checking the password: kept, so the page shows who kept trying.
function loginBlocked(ip, req, username, method = 'password') {
  if (!security.blockOf(ip)) return false;
  security.login({ outcome: 'blocked', reason: 'blocked', username, method, ip, ua: req?.headers?.['user-agent'], place: req ? placeOf(req) : {} });
  return true;
}
// userId: the account tried, when it is known (a signed-in session's own by default).
function recordLoginFailure(ip, req, username, reason, method = 'password', userId = req?.userId || '') {
  const made = security.fail(ip, username, userId, { real: reason !== 'no-such-user' });
  security.login({ outcome: made ? 'locked' : 'fail', reason, username, method, ip, ua: req?.headers?.['user-agent'], place: req ? placeOf(req) : {} });
  if (made) audit({ source: 'security', action: 'auto-block', group: made.group, until: made.until, strikes: made.strikes });
  // By account as well, for a sign-in: a guess at one name from many addresses
  // (securityLog.js). A signed-in session asking for its own password
  // again (binding a phone, two-step settings) counts against its address only.
  // A wrong code comes only from someone who had the password right: a far smaller
  // count of its own, at sign-in, when turning two-step off and when adding a passkey
  // (not when first turning two-step on: that code is for a secret not yet in use).
  const coded = reason === 'wrong-code' && method !== 'two-step' ? security.codeFail(username) : null;
  if (coded) audit({ source: 'security', action: 'account-protect', name: coded.name, until: coded.until, times: coded.times, reason: 'wrong codes' });
  if (method !== 'password' && method !== 'code') return;
  const guard = security.accountFail(username);
  if (guard) audit({ source: 'security', action: 'account-protect', name: guard.name, until: guard.until, times: guard.times });
}
// An account under protection takes a password only from an address it has signed
// in from lately; anywhere else is turned away unchecked, a name that is no account
// just the same.
function accountGuarded(ip, req, username, userId, method = 'password') {
  if (!security.accountGuard(username, ip, userId)) return false;
  security.login({ outcome: 'blocked', reason: 'account', username, method, ip, ua: req?.headers?.['user-agent'], place: req ? placeOf(req) : {} });
  return true;
}
const TOO_MANY = { message: 'Too many login attempts, try again later' };
// The account has had its day's wrong codes (securityLog.codeSpent): no authenticator
// code is looked at any more today. Said so, with 429, and not counted as one more
// wrong code: nothing was checked, and counting on would only lengthen the block on
// the owner's own address without telling them why. A recovery code is still taken.
const CODES_SPENT = { message: 'No more authenticator codes are taken for this account today. Use a recovery code, a passkey or QR sign-in.', code: 'CODES_SPENT' };
// Said, and kept: one line for the admin, folded with the ones after it from the
// same address (securityLog.login, outcome blocked), so guessing that goes on past
// the day's count still leaves its trace.
function sayCodesSpent(req, res, user) {
  security.login({ outcome: 'blocked', reason: 'codes-spent', username: user?.username || '', method: 'code', ip: resolveClientIp(req), ua: req?.headers?.['user-agent'], place: req ? placeOf(req) : {} });
  return res.status(429).json(CODES_SPENT);
}
const recoveryShaped = (code) => typeof code === 'string' && twoStep.looksLikeRecovery(code);
const codeRefusedToday = (user, code) => Boolean(user?.twoStep && !recoveryShaped(code) && security.codeSpent(user.username));
// While an account's codes are being guessed its sign-in settings are frozen, but
// not to a recovery code: eighty bits are not guessed, and the owner must still be
// able to change a password that leaked or turn two-step off.
// Past the day's count it is said as that (codeRefusedToday), not as this.
const codesFrozen = (user, code) => Boolean(security.codesGuessed(user.username) && !recoveryShaped(code) && !security.codeSpent(user.username));
// No code sent at all is not a wrong code: asked for, not counted (a page that did
// not know two-step had been turned on elsewhere sends none).
const NEED_CODE = { message: 'Enter your two-step code', code: 'NEED_CODE' };
const noCode = (code) => typeof code !== 'string' || !code.trim();
// The password was right and no code came: asked for, not counted, but kept in the
// audit log like a sign-in that reached the code step, since a session that is
// not its owner's has just learnt the password is right.
function needCode(req, res, user, where) {
  audit({ source: 'two-step', action: 'code-missing', userId: String(user?._id || ''), where, ip: resolveClientIp(req) });
  return res.status(400).json(NEED_CODE);
}
// Room for one more try from this address (and on this name) while it is checked;
// given back when the answer has gone out (securityLog.js, hold).
function held(ip, res, username = '') {
  const release = security.hold(ip, username);
  if (!release) return false;
  // (A response that cannot say when it is over, as in a unit test, holds nothing.)
  if (typeof res.on === 'function') res.on('close', release); else release();
  return true;
}

function ensureSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-to-a-long-random-string') {
    throw new Error('JWT_SECRET must be set to a strong non-default value');
  }
}

// The way back in for an only admin nothing else lets in (authenticator, recovery
// codes and bound phone all gone, or the account under protection with no known
// address left): scripts/sign-in-rescue.mjs, run on this machine, leaves a note
// naming the account, and the next start turns its two-step sign-in off or lifts
// its protection. Only someone with the machine's files can leave that note.
const RESCUE_NOTE_MS = 24 * 3600_000;
const CLEANUP_INCOMPLETE = { message: 'The account was changed, but its sign-ins were not all removed. Try again.', code: 'CREDENTIAL_CLEANUP_INCOMPLETE' };
function applySignInRescue() {
  const file = path.join(process.env.DB_DIR || path.join(__dirname, '..', 'db'), 'sign-in-rescue.json');
  let note, age;
  try { age = Date.now() - require('fs').statSync(file).mtimeMs; note = JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { note = undefined; }
  if (age === undefined) return;
  try { require('fs').unlinkSync(file); } catch (e) { console.error('sign-in rescue: note not removed, nothing done:', e.message); return; }
  if (note === undefined) return;
  // A note left and forgotten must not act at some start weeks later: after a day it
  // is removed and nothing is done.
  if (!(age < RESCUE_NOTE_MS)) { console.error('sign-in rescue: the note is more than a day old, removed and not applied'); return; }
  const name = note?.username;
  if (typeof name !== 'string' || !name || name.length > 80) return;
  if (note.what === 'block') {
    if (security.unblock(security.groupOf(name), 'this machine')) { console.log('address block lifted from this machine'); audit({ source: 'security', action: 'unblock', group: security.groupOf(name), by: 'this machine' }); }
    return;
  }
  if (note.what === 'protection') {
    if (security.accountRelease(name, 'this machine')) { console.log('account protection lifted from this machine'); audit({ source: 'security', action: 'account-release', name, by: 'this machine' }); }
    return;
  }
  if (note.what !== 'two-step') return;
  usersDB.update(usernameQuery(name), { $unset: { twoStep: true, twoStepPending: true } }, {}, (err, n) => {
    if (err) return console.error('two-step reset:', err.message);
    console.log(`two-step sign-in reset from this machine for ${n} account(s)`);
    if (n) { audit({ source: 'two-step', action: 'local-reset', username: name }); security.twoStep({ action: 'reset', by: 'this machine' }); }
  });
}

ensureSecret();
applySignInRescue();

function publicUser(user) {
  const lifecycleStatus = effectiveLifecycleStatus(user);
  return {
    id: user._id,
    username: user.username,
    name: user.name || user.username,
    role: user.role,
    language: user.language || 'en',
    lifecycleStatus,
    disabledAt: user.disabledAt || null,
    deletedAt: user.deletedAt || null,
    twoStep: Boolean(user.twoStep),
  };
}

let injectedLifecycleService = null;
function lifecycleService() {
  return injectedLifecycleService
    || require('../services/userLifecycle').getDefaultUserLifecycleService();
}

function sendLifecycleError(res, error, extra = {}) {
  res.status(error.status || 500).json({
    message: error.message,
    code: error.code || 'USER_LIFECYCLE_FAILED',
    details: error.details,
    ...extra,
  });
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
};
// Secure whenever the request came in over HTTPS (requestGuards.isHttpsRequest).
const sessionCookieOpts = (res) => ({ ...COOKIE_OPTS, secure: isHttpsRequest(res.req), maxAge: TOKEN_TTL_SECONDS * 1000 });

// fresh: only for a sign-in that has just taken the password (and the two-step code,
// when that is on); see justSignedIn.
function issueSession(user, res, { method = 'password', ua = '', approvedBy = null, fresh = false } = {}) {
  const now = Date.now();
  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role, jti: randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS },
  );

  sessionsDB.insert({
    userId: user._id,
    username: user.username,
    tokenHash: hashSessionToken(token),
    // How and from what it signed in, for the account's device list.
    method, userAgent: String(ua || '').slice(0, 300), createdAt: now, ...(approvedBy ? { approvedBy } : {}),
    ...(fresh ? { freshUntil: now + FRESH_SIGN_IN_MS } : {}),
    lastSeen: now,
    expiresAt: new Date(now + IDLE_SECONDS * 1000),
  });

  // stamp the user active immediately so they show online right after logging in
  usersDB.update(activeUserMutationQuery(user._id), { $set: { lastSeen: now } }, {}, () => {});
  lastTouchAt.set(touchKey(user._id, token), now);

  res.cookie('session_id', token, sessionCookieOpts(res));

  return token;
}

// Sliding-session renewal + presence heartbeat, shared by verifyToken and
// verifySession. Throttled to once/60s/user. Pushes the idle gate
// (sessionsDB.expiresAt) forward, stamps lastSeen for the online badge, and
// refreshes the cookie so its absolute lifetime rolls too. Fire-and-forget:
// the DB writes never block the request.
function touchActivity(userId, token, res) {
  // Best-effort: presence + sliding must NEVER break auth. Any failure here is
  // swallowed so verifyToken/verifySession keep working even if a DB write hiccups.
  try {
    const now = Date.now();
    const key = touchKey(userId, token);
    if (lastTouchAt.size > 5000) for (const [k, at] of lastTouchAt) if (now - at >= SLIDE_THROTTLE_MS) lastTouchAt.delete(k);
    if (now - (lastTouchAt.get(key) || 0) < SLIDE_THROTTLE_MS) return;
    lastTouchAt.set(key, now);
    // The address a live session is used from stays known to the account's protection.
    if (res?.req) security.seen(userId, resolveClientIp(res.req));

    const expiresAt = new Date(now + IDLE_SECONDS * 1000);
    usersDB.update(activeUserMutationQuery(userId), { $set: { lastSeen: now } }, {}, () => {});
    sessionsDB.update({ tokenHash: hashSessionToken(token) }, { $set: { lastSeen: now, expiresAt } }, {}, () => {});
    if (res && !res.headersSent) {
      res.cookie('session_id', token, sessionCookieOpts(res));
    }
  } catch (err) {
    console.error('touchActivity failed (ignored):', err.message);
  }
}
exports.touchActivity = touchActivity;

exports.login = (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const ip = resolveClientIp(req);
  if (loginBlocked(ip, req, username)) {
    return res.status(429).json(TOO_MANY);
  }

  usersDB.findOne(usernameQuery(username), (err, user) => {
    if (err) return res.status(500).json({ message: 'Error reading user' });
    if (accountGuarded(ip, req, username, user?._id)) return res.status(429).json(TOO_MANY);
    if (!held(ip, res, username)) return res.status(429).json(TOO_MANY);
    if (!user) {
      recordLoginFailure(ip, req, username, 'no-such-user');
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    if (!isActiveUser(user)) {
      recordLoginFailure(ip, req, username, 'inactive', 'password', user._id);
      return res.status(403).json({ message: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
    }
    findPendingLifecycleTransition(userLifecycleTransitionsDB, user._id).then((pending) => {
      if (pending) {
        recordLoginFailure(ip, req, username, 'inactive', 'password', user._id);
        res.status(403).json({ message: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
        return;
      }
      bcrypt.compare(password, user.password, (compareErr, isMatch) => {
        if (compareErr || !isMatch) {
          recordLoginFailure(ip, req, username, 'wrong-password', 'password', user._id);
          return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Re-read after the asynchronous password comparison so a concurrent
        // disable/delete cannot issue a fresh session from a stale user object,
        // nor a password changed meanwhile sign in with the old one: the hash read
        // last, just before the session is made, must be the one just compared. Nothing waits between that read and the
        // session, so a change that lands later removes it with the other sessions.
        findPendingLifecycleTransition(userLifecycleTransitionsDB, user._id)
          .then((freshPending) => {
            if (freshPending) {
              recordLoginFailure(ip, req, username, 'inactive', 'password', user._id);
              res.status(403).json({
                message: 'Account is not active', code: 'ACCOUNT_INACTIVE',
              });
              return;
            }
            usersDB.findOne({ _id: user._id }, (freshErr, freshUser) => {
              if (freshErr) return res.status(500).json({ message: 'Error reading user' });
              if (!isActiveUser(freshUser)) {
                recordLoginFailure(ip, req, username, 'inactive', 'password', user._id);
                return res.status(403).json({
                  message: 'Account is not active', code: 'ACCOUNT_INACTIVE',
                });
              }
              // Not counted: the password was right a moment ago.
              if (freshUser.password !== user.password) return res.status(400).json({ message: 'Invalid credentials' });
              // Two-step on: the right password earns a ticket, not a session
              // (services/twoStep.js); POST /login/code turns it into one, and
              // only while the password is still the one this ticket was for.
              if (freshUser.twoStep) {
                // Kept: a right password with no code after it is what a leaked password looks like.
                audit({ source: 'two-step', action: 'code-asked', userId: freshUser._id, ip });
                res.json({ step: 'code', ...twoStepTickets.issue(freshUser._id, passwordMark(freshUser)) });
                return;
              }
              security.succeeded(ip);
              security.login({ outcome: 'ok', username: freshUser.username, userId: freshUser._id, ip, ua: req.headers['user-agent'], place: placeOf(req) });
              // The token travels only in the httpOnly cookie; the SPA never
              // read it from here, and a copy in the body is one XSS away.
              issueSession(freshUser, res, { method: 'password', ua: req.headers['user-agent'], fresh: true });
              res.json({
                message: 'Login successful',
                user: publicUser(freshUser),
                expiresIn: IDLE_SECONDS,
              });
            });
          })
          .catch(() => res.status(500).json({ message: 'Error reading user lifecycle' }));
      });
    }).catch(() => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error reading user lifecycle' });
      }
    });
  });
};

// POST /api/auth/login/start {username}: the login page has the name and asks what
// the account can sign in with, so it can ask for a passkey before a password. It says only whether there is a passkey; a name that
// is no account, or not active, is answered as one without. That does tell a caller
// that a name with a passkey exists: the name-first page accepts that.
exports.loginStart = async (req, res) => {
  try {
    const { username } = req.body || {};
    if (typeof username !== 'string' || !username || username.length > USERNAME_MAX_LENGTH) return res.json({ passkey: false });
    const user = await findUser(usernameQuery(username));
    res.json({ passkey: Boolean(user && isActiveUser(user) && (await passkeyStore.ids(user._id)).length) });
  } catch (e) { console.error('login start:', e.message); res.json({ passkey: false }); }
};

// Two-step sign-in (services/twoStep.js).
const twoStepTickets = twoStep.createTickets();
// What a two-step ticket is tied to: the password hash it was checked against.
const passwordMark = (user) => String(user?.password || '');
const updateUser = (query, change) => new Promise((ok, no) => usersDB.update(query, change, {}, (e, n) => (e ? no(e) : ok(n))));
// Is this the account's code: its authenticator's six digits, not used before, or
// a recovery code, which is spent. The write is what decides: of two requests with
// the same code, one changes the row and the other finds nothing to change.
// spend false only looks: for a step that is not the end of what the code is for.
async function passesTwoStep(user, code, { spend = true } = {}) {
  if (!user?.twoStep) return false;
  if (twoStep.looksLikeRecovery(code)) {
    const hash = twoStep.hashRecovery(code);
    if (!(user.twoStep.recovery || []).includes(hash)) return false;
    if (!spend) return true;
    return (await updateUser({ _id: user._id, 'twoStep.recovery': hash }, { $pull: { 'twoStep.recovery': hash } })) > 0;
  }
  // The day's wrong codes are spent: no authenticator code is looked at, on any of
  // the ways that take one (sign-in, turning it off, binding a phone, a passkey).
  if (security.codeSpent(user.username)) return false;
  const secret = twoStep.open(user.twoStep.secret, process.env.JWT_SECRET);
  const step = secret && twoStep.matchStep(secret, code, { lastStep: user.twoStep.lastStep || 0 });
  if (!step) return false;
  if (!spend) return true;
  return (await updateUser({ _id: user._id, 'twoStep.lastStep': { $lt: step } }, { $set: { 'twoStep.lastStep': step } })) > 0;
}

// POST /api/auth/login/code {ticket, code}: the second step of a password sign-in.
exports.loginCode = async (req, res) => {
  try {
    const { ticket, code } = req.body || {};
    const ip = resolveClientIp(req);
    if (loginBlocked(ip, req, '', 'code')) return res.status(429).json(TOO_MANY);
    const userId = twoStepTickets.userOf(ticket);
    const user = userId && await activeAccount(userId);
    // A ticket from before the password changed is gone: the old password must
    // not lead to a session.
    if (!user || !user.twoStep || twoStepTickets.markOf(ticket) !== passwordMark(user)) {
      if (userId) twoStepTickets.spend(ticket);
      return res.status(401).json({ message: 'Sign in again', code: 'TICKET_GONE' });
    }
    if (accountGuarded(ip, req, user.username, user._id, 'code')) return res.status(429).json(TOO_MANY);
    if (!held(ip, res, user.username)) return res.status(429).json(TOO_MANY);
    // None sent is asked for, not counted, and costs the ticket no try.
    if (noCode(code)) return res.status(400).json(NEED_CODE);
    if (codeRefusedToday(user, code)) return sayCodesSpent(req, res, user);
    if (!twoStepTickets.tryOne(ticket)) return res.status(401).json({ message: 'Sign in again', code: 'TICKET_GONE' });
    if (typeof code !== 'string' || code.length > 40 || !(await passesTwoStep(user, code))) {
      twoStepTickets.missed(ticket);
      recordLoginFailure(ip, req, user.username, 'wrong-code', 'code', user._id);
      return res.status(400).json({ message: 'Invalid code', code: twoStepTickets.userOf(ticket) ? 'WRONG_CODE' : 'TICKET_GONE' });
    }
    twoStepTickets.spend(ticket);
    // Read once more just before the session, nothing waited for in between: the
    // password may have changed or the account gone off while the code was checked.
    const latest = await findUser({ _id: user._id });
    if (!isActiveUser(latest) || passwordMark(latest) !== passwordMark(user)) return res.status(401).json({ message: 'Sign in again', code: 'TICKET_GONE' });
    security.login({ outcome: 'ok', username: latest.username, userId: latest._id, ip, ua: req.headers['user-agent'], place: placeOf(req) });
    issueSession(latest, res, { method: 'password', ua: req.headers['user-agent'], fresh: true });
    res.json({ message: 'Login successful', user: publicUser(latest), expiresIn: IDLE_SECONDS });
  } catch (e) { console.error('login code:', e.message); res.status(500).json({ message: 'Error' }); }
};

// The password again for a signed-in session, before it changes how the account
// signs in. A wrong one counts against the address, as when binding a phone.
async function passwordAgain(req, res, method) {
  const ip = resolveClientIp(req);
  if (loginBlocked(ip, req, '', method) || !held(ip, res)) { res.status(429).json(TOO_MANY); return null; }
  const user = await activeAccount(req.userId);
  if (!user) { res.status(403).json({ message: 'Account is not active' }); return null; }
  const { password } = req.body || {};
  if (!(typeof password === 'string' && password && await bcrypt.compare(password, user.password))) {
    recordLoginFailure(ip, req, user.username, 'wrong-password', method);
    res.status(400).json({ message: 'Invalid credentials', code: 'WRONG_PASSWORD' });
    return null;
  }
  return user;
}
// GET /api/auth/two-step: is it on, and how many recovery codes are left.
exports.twoStepStatus = async (req, res) => {
  try {
    const user = await activeAccount(req.userId);
    if (!user) return res.status(403).json({ message: 'Account is not active' });
    res.json({ enabled: Boolean(user.twoStep), enabledAt: user.twoStep?.enabledAt || null, recoveryLeft: user.twoStep ? (user.twoStep.recovery || []).length : 0 });
  } catch { res.status(500).json({ message: 'Error' }); }
};
// POST /api/auth/two-step/setup {password}: a new secret to put in an authenticator.
// Nothing changes until a code from it comes back to /enable.
exports.twoStepSetup = async (req, res) => {
  try {
    const user = await passwordAgain(req, res, 'two-step');
    if (!user) return;
    if (user.twoStep) return res.status(409).json({ message: 'Two-step sign-in is already on', code: 'ALREADY_ON' });
    const secret = twoStep.newSecret();
    await updateUser(activeUserMutationQuery(user._id), { $set: { twoStepPending: { secret: twoStep.seal(secret, process.env.JWT_SECRET), at: Date.now() } } });
    res.json({ secret, uri: twoStep.uri(secret, user.username) });
  } catch (e) { console.error('two-step setup:', e.message); res.status(500).json({ message: 'Error' }); }
};
// POST /api/auth/two-step/enable {code}: the authenticator shows the right digits,
// so it is on. The recovery codes are given here, once.
exports.twoStepEnable = async (req, res) => {
  try {
    const ip = resolveClientIp(req);
    if (loginBlocked(ip, req, '', 'two-step') || !held(ip, res)) return res.status(429).json(TOO_MANY);
    const user = await activeAccount(req.userId);
    if (!user) return res.status(403).json({ message: 'Account is not active' });
    if (user.twoStep) return res.status(409).json({ message: 'Two-step sign-in is already on', code: 'ALREADY_ON' });
    const pending = user.twoStepPending;
    const secret = pending && Date.now() - pending.at < twoStep.PENDING_MS ? twoStep.open(pending.secret, process.env.JWT_SECRET) : null;
    if (!secret) return res.status(409).json({ message: 'Start the setup again', code: 'SETUP_GONE' });
    const step = twoStep.matchStep(secret, (req.body || {}).code);
    if (!step) {
      recordLoginFailure(ip, req, user.username, 'wrong-code', 'two-step');
      return res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' });
    }
    const { codes, hashes } = twoStep.newRecoveryCodes();
    const changed = await updateUser({ ...activeUserMutationQuery(user._id), twoStep: { $exists: false } }, {
      $set: { twoStep: { secret: pending.secret, enabledAt: new Date().toISOString(), lastStep: step, recovery: hashes } },
      $unset: { twoStepPending: true },
    });
    if (!changed) return res.status(409).json({ message: 'Two-step sign-in is already on', code: 'ALREADY_ON' });
    endFreshSignIn(req.userId);
    // The users file is append-only until compacted: a secret set up and replaced, or
    // turned off, stays in it as an older line. Compacted whenever two-step changes. A compaction that fails
    // is said, never left as an unhandled rejection.
    compactQuietly(usersDB, 'two-step: users');
    audit({ source: 'two-step', action: 'enable', userId: req.userId });
    security.twoStep({ action: 'on', userId: req.userId, ip, place: placeOf(req) });
    res.json({ enabled: true, recoveryCodes: codes });
  } catch (e) { console.error('two-step enable:', e.message); res.status(500).json({ message: 'Error' }); }
};
// POST /api/auth/two-step/disable {password, code}: both, so neither a stolen
// session nor a stolen password alone turns it off. (An admin can reset another
// account's with their own password, below.)
exports.twoStepDisable = async (req, res) => {
  try {
    const user = await passwordAgain(req, res, 'two-step');
    if (!user) return;
    if (!user.twoStep) return res.json({ enabled: false });
    // Not while the account is under protection: codes are being guessed.
    const { code } = req.body || {};
    if (noCode(code)) return needCode(req, res, user, 'two-step-off');
    if (codesFrozen(user, code)) return res.status(429).json(TOO_MANY);
    if (codeRefusedToday(user, code)) return sayCodesSpent(req, res, user);
    if (typeof code !== 'string' || code.length > 40 || !(await passesTwoStep(user, code))) {
      recordLoginFailure(resolveClientIp(req), req, user.username, 'wrong-code', 'two-step-off');
      return res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' });
    }
    await updateUser({ _id: user._id }, { $unset: { twoStep: true, twoStepPending: true } });
    twoStepTickets.revokeUser(user._id);
    compactQuietly(usersDB, 'two-step: users');
    audit({ source: 'two-step', action: 'disable', userId: req.userId });
    security.twoStep({ action: 'off', userId: req.userId, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ enabled: false });
  } catch (e) { console.error('two-step disable:', e.message); res.status(500).json({ message: 'Error' }); }
};
// POST /api/auth/users/:id/reset-two-step {adminPassword, adminCode}: an admin turns it off for
// an account whose authenticator and recovery codes are gone. Resetting a password
// does not do this: it would make a reset the way round the second step. The
// admin's own password again, and never the admin's own account, so a stolen
// admin session cannot take its own second step away. The
// admin's own code too when theirs is on, like the other confirmed actions: a
// session and a password alone must not strip another administrator's second
// step.
exports.resetUserTwoStep = (req, res) => inTurn(async (req, res) => {
  try {
    if (String(req.params.id) === String(req.userId)) return res.status(409).json({ message: 'Turn your own two-step sign-in off in Settings', code: 'OWN_ACCOUNT' });
    const user = await findUser({ _id: req.params.id });
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Nothing to reset is said so, and costs the admin no code.
    if (!user.twoStep && !user.twoStepPending) return res.status(409).json({ message: 'Two-step sign-in is not on for this account', code: 'NO_TWO_STEP' });
    if (!(await adminAgain(req, res, 'reset-two-step', user._id))) return;
    // A write that fails may still have happened: the admin's code stays spent (adminKept).
    await updateUser({ _id: user._id }, { $unset: { twoStep: true, twoStepPending: true } }).catch((e) => { adminKept(req); throw e; });
    adminGranted(req, user._id);
    twoStepTickets.revokeUser(user._id);
    compactQuietly(usersDB, 'two-step: users');
    audit({ source: 'two-step', action: 'reset', userId: user._id, by: req.username });
    security.twoStep({ action: 'reset', userId: user._id, by: req.username, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ message: 'Two-step sign-in reset' });
  } catch (e) { console.error('two-step reset:', e.message); res.status(500).json({ message: 'Error' }); }
})(req, res);
exports._twoStepTickets = twoStepTickets;

// Passkeys (services/passkeys.js). Signing in
// with one asks for no password and no two-step code: the device has verified its
// owner, and holding it is the second step. A password change or reset removes
// them, as it does bound phones: whoever changed it may be shutting out someone
// who got in before and left a passkey behind.
const passkeyChallenges = passkeys.createChallenges();
const passkeyStore = passkeys.createStore(passkeysDB);
const sendPasskeyError = (res, e) => res.status(e.status || 500).json({ message: e.status ? e.message : 'Error', ...(e.status === 400 ? { code: 'PASSKEY_REFUSED' } : {}) });
// GET /api/auth/passkeys: the account's passkeys.
exports.listPasskeys = async (req, res) => {
  try { res.json({ passkeys: await passkeyStore.list(req.userId) }); } catch (e) { sendPasskeyError(res, e); }
};
// Did this session sign in with the password (and the two-step code, when that is
// on) in the last five minutes? Then its holder has just proved both, and the page
// offers to make a passkey right after signing in without asking for them again. A session from QR sign-in, a passkey, or an
// older one does not count; nor one from before the password was changed, two-step
// turned on, or the account disabled (endFreshSignIn). Returns the session's token
// hash, which the challenge is tied to, or ''.
async function justSignedIn(req) {
  const tokenHash = hashSessionToken(req.sessionToken || req.cookies?.session_id || '');
  const [row] = await findSessions({ tokenHash, userId: req.userId });
  return row && row.method === 'password' && typeof row.freshUntil === 'number' && Date.now() < row.freshUntil ? tokenHash : '';
}
// What changes how the account signs in ends that: every session of the account is
// fresh no longer, and a challenge waiting to add a passkey is dropped.
function endFreshSignIn(userId) {
  passkeyChallenges.revokeUser(userId);
  sessionsDB.update({ userId: String(userId) }, { $unset: { freshUntil: true } }, { multi: true }, () => {});
}
// POST /api/auth/passkeys/options {password, code}: what the browser needs to make
// one. The password again, and the two-step code when that is on: a new passkey is
// a new way in, so a session alone, or a session and the password, must not add it.
// Neither is asked of a session that signed in with them moments ago.
exports.passkeyOptions = async (req, res) => {
  try {
    const asked = (req.body || {}).password;
    const fresh = !asked ? await justSignedIn(req) : '';
    // No password given and not just signed in (the offer left open too long): said
    // plainly, and not counted as a wrong password.
    if (!asked && !fresh) return res.status(400).json({ message: 'Enter your password to add a passkey', code: 'NEED_PASSWORD' });
    const user = fresh ? await activeAccount(req.userId) : await passwordAgain(req, res, 'passkey');
    if (!user) { if (fresh) res.status(403).json({ message: 'Account is not active' }); return; }
    // While the account's codes are being guessed nothing is added on the strength of
    // a sign-in a moment ago: the password and a code again (a recovery code passes).
    if (fresh && user.twoStep && security.codesGuessed(user.username)) return res.status(400).json({ message: 'Enter your password to add a passkey', code: 'NEED_PASSWORD' });
    if (user.twoStep && !fresh) {
      const { code } = req.body || {};
      if (noCode(code)) return needCode(req, res, user, 'passkey');
      if (codesFrozen(user, code)) return res.status(429).json(TOO_MANY);
      // Looked at here, spent when the passkey is kept: a sheet closed on the device
      // must not cost a recovery code.
      if (codeRefusedToday(user, code)) return sayCodesSpent(req, res, user);
      if (typeof code !== 'string' || code.length > 40 || !(await passesTwoStep(user, code, { spend: false }))) {
        recordLoginFailure(resolveClientIp(req), req, user.username, 'wrong-code', 'passkey');
        return res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' });
      }
    }
    res.json({
      challenge: passkeyChallenges.issue('create', user._id, '', fresh ? `fresh:${fresh}` : ''),
      user: { id: passkeys.b64u(Buffer.from(String(user._id))), name: user.username, displayName: user.name || user.username },
      algs: Object.keys(passkeys.ALGS).map(Number),
      exclude: await passkeyStore.ids(user._id),
    });
  } catch (e) { sendPasskeyError(res, e); }
};
// POST /api/auth/passkeys {name, id, clientDataJSON, authenticatorData, publicKey, alg}:
// the passkey the browser made for that challenge is kept.
exports.addPasskey = async (req, res) => {
  try {
    const user = await activeAccount(req.userId);
    if (!user) return res.status(403).json({ message: 'Account is not active' });
    const body = req.body || {};
    const { made, note } = passkeys.register(body, { challenges: passkeyChallenges, userId: user._id, isAllowedOrigin: isPasskeyOrigin });
    // A challenge given to a session that had just signed in stands for the password
    // and the code, for that session and only while it is still just signed in.
    const byFresh = typeof note === 'string' && note.startsWith('fresh:');
    if (byFresh && (note !== `fresh:${await justSignedIn(req)}` || (user.twoStep && security.codesGuessed(user.username)))) return res.status(400).json({ message: 'Enter your password to add a passkey', code: 'NEED_PASSWORD' });
    if (user.twoStep && !byFresh && noCode(body.code)) return needCode(req, res, user, 'passkey');
    if (user.twoStep && !byFresh && codeRefusedToday(user, body.code)) return sayCodesSpent(req, res, user);
    if (user.twoStep && !byFresh && !(typeof body.code === 'string' && body.code.length <= 40 && await passesTwoStep(user, body.code))) {
      recordLoginFailure(resolveClientIp(req), req, user.username, 'wrong-code', 'passkey');
      return res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' });
    }
    // How it was added: only a key added with the password (and the code, when two-step
    // was on) may later stand for them in an admin's confirmation: one added on a
    // sign-in moment ago could be a stolen session's own.
    const passkey = await passkeyStore.add(user._id, typeof body.name !== 'string' || textProblem(body.name, 40, 'name') ? 'Passkey' : body.name, { ...made, addedWith: byFresh ? 'fresh' : 'password', withCode: Boolean(user.twoStep && !byFresh) });
    audit({ source: 'passkey', action: 'add', userId: req.userId, passkeyId: passkey.id });
    security.passkey({ action: 'add', userId: req.userId, ip: resolveClientIp(req), place: placeOf(req) });
    res.status(201).json({ passkey });
  } catch (e) { sendPasskeyError(res, e); }
};
// DELETE /api/auth/passkeys/:id
exports.removePasskey = async (req, res) => {
  try {
    if (!(await passkeyStore.remove(req.userId, req.params.id))) return res.status(404).json({ message: 'Not found' });
    audit({ source: 'passkey', action: 'remove', userId: req.userId, passkeyId: String(req.params.id) });
    security.passkey({ action: 'remove', userId: req.userId, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ ok: true });
  } catch (e) { sendPasskeyError(res, e); }
};
// POST /api/auth/passkey/start: a login page asks for a challenge (no session yet).
exports.passkeyStart = (req, res) => res.json({ challenge: passkeyChallenges.issue('get', '', security.groupOf(resolveClientIp(req))) });
// POST /api/auth/passkey/finish {id, clientDataJSON, authenticatorData, signature}:
// the passkey's answer; right, and its account is signed in. Like QR sign-in it is
// open to an address shut out of password sign-in: there is nothing here to guess.
exports.passkeyFinish = async (req, res) => {
  const ip = resolveClientIp(req), body = req.body || {};
  try {
    const answer = passkeys.answer(body, { challenges: passkeyChallenges, isAllowedOrigin: isPasskeyOrigin });
    const kept = await passkeyStore.byCredential(body.id);
    const { signCount } = passkeys.assert(answer, body, kept);
    const user = await activeAccount(kept.userId);
    if (!user) throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason: 'inactive' });
    if (!(await passkeyStore.used(kept, signCount))) throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason: 'counter' });
    security.login({ outcome: 'ok', username: user.username, userId: user._id, method: 'passkey', ip, ua: req.headers['user-agent'], place: placeOf(req) });
    issueSession(user, res, { method: 'passkey', ua: req.headers['user-agent'] });
    res.json({ message: 'Login successful', user: publicUser(user), expiresIn: IDLE_SECONDS });
  } catch (e) {
    if (e.status === 400) security.login({ outcome: 'fail', reason: 'passkey', username: '', method: 'passkey', ip, ua: req.headers['user-agent'], place: placeOf(req) });
    else console.error('passkey sign-in:', e.message);
    sendPasskeyError(res, e);
  }
};
exports._passkeyChallenges = passkeyChallenges;
exports._applySignInRescue = applySignInRescue;

exports.logout = (req, res) => {
  const token = req.cookies.session_id || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  res.clearCookie('session_id', { path: '/' });

  // A string or nothing (app.js drops a parsed j:{…} cookie as well; checked here too
  // so the handler does not depend on that).
  if (!token || typeof token !== 'string') return res.json({ message: 'Logged out successfully' });

  // A browser PushSubscription may outlive its login cookie. Bind subscriptions
  // to the live session and deactivate this session's devices before deleting
  // the row; a later login can deliberately re-register the same browser endpoint.
  Promise.resolve()
    .then(() => require('../services/pushStore').getDefaultPushStore().deactivateSession(token))
    .catch((error) => console.error(`push logout suppression failed: ${error.message}`))
    // A phone bound as a login key in this session can approve nothing once it is
    // gone: its key goes with it, so the device list does not show a dead one. What it let in stays signed in: signing
    // out on the phone is the owner putting the phone away, not losing it; the same
    // when its session runs out (dropLapsedPhones). A key unbound or replaced, or a
    // session signed out from the list, does take what it let in along: dropPhone.
    .then(() => loginDevices.bySession(req.userId || jwt.decode(token)?.id, hashSessionToken(token)))
    .then((phone) => { if (phone) { qrRequests.revokeDevice(phone._id); return loginDevices.remove(phone.userId, phone._id); } })
    .catch(() => {})
    .finally(() => {
      // Also a row still holding the token itself (a start-up conversion that failed):
      // by its hash alone it stayed, and worked again once a later start converted it.
      sessionsDB.remove({ $or: [{ tokenHash: hashSessionToken(token) }, { token: String(token) }] }, { multi: true }, () => {
        compactQuietly(sessionsDB, 'sessions');
        // Its other open pages (other tabs) told at once (server/liveUpdates.js).
        require('../liveUpdates').endSignIn(hashSessionToken(token));
        res.json({ message: 'Logged out successfully' });
      });
    });
};

exports.verifySession = (req, res) => {
  const token = req.cookies.session_id;
  if (!token || typeof token !== 'string') return res.status(401).json({ message: 'No session cookie found' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid or expired session cookie' });

    sessionsDB.findOne({ tokenHash: hashSessionToken(token), userId: decoded.id }, (sessionErr, session) => {
      if (sessionErr || !session || new Date(session.expiresAt).getTime() < Date.now()) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      usersDB.findOne({ _id: decoded.id }, (userErr, user) => {
        if (userErr || !isActiveUser(user)) return res.status(401).json({ message: 'User not found' });
        findPendingLifecycleTransition(userLifecycleTransitionsDB, decoded.id).then((pending) => {
          if (pending) return res.status(401).json({ message: 'User not found' });
          touchActivity(decoded.id, token, res);
          res.json({ user: publicUser(user), expiresIn: IDLE_SECONDS });
        }).catch(() => res.status(401).json({ message: 'User not found' }));
      });
    });
  });
};

exports.me = (req, res) => {
  usersDB.findOne({ _id: req.userId }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Error reading user' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: publicUser(user) });
  });
};

exports.updateMe = (req, res) => {
  const allowedLanguages = ['en', 'zh-TW'];
  const update = {};
  if (typeof req.body.name === 'string') update.name = req.body.name.trim() || req.username;
  const nameProblem = update.name && textProblem(update.name, NAME_MAX_LENGTH, 'Name');
  if (nameProblem) return res.status(400).json({ message: nameProblem });
  if (typeof req.body.language === 'string') {
    if (!allowedLanguages.includes(req.body.language)) {
      return res.status(400).json({ message: 'Unsupported language' });
    }
    update.language = req.body.language;
  }
  // Settings an older build kept that this product does not have: a value still
  // stored, or one sent here, is ignored.

  usersDB.update(activeUserMutationQuery(req.userId), { $set: update }, {}, (err, updated) => {
    if (err) return res.status(500).json({ message: 'Error updating user' });
    if (!updated) {
      return res.status(409).json({ message: 'Account is no longer active', code: 'ACCOUNT_INACTIVE' });
    }
    compactQuietly(usersDB, 'users');
    usersDB.findOne({ _id: req.userId }, (readErr, user) => {
      if (readErr || !user) return res.status(404).json({ message: 'User not found' });
      res.json({ user: publicUser(user) });
    });
  });
};

exports.changePassword = (req, res) => {
  const { oldPassword, newPassword, code } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Old and new passwords are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  // A wrong old password is a guess at the password like any other: counted against
  // the address, kept in the log, and not looked at from a blocked address. A stolen
  // session could otherwise guess it here without end and take the account over.
  const ip = resolveClientIp(req);
  if (loginBlocked(ip, req, req.username || '', 'change-password') || !held(ip, res)) return res.status(429).json(TOO_MANY);

  usersDB.findOne({ _id: req.userId }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Error reading user' });
    if (!user) return res.status(404).json({ message: 'User not found' });

    bcrypt.compare(oldPassword, user.password, (compareErr, isMatch) => {
      if (compareErr || !isMatch) {
        recordLoginFailure(ip, req, user.username, 'wrong-password', 'change-password');
        return res.status(400).json({ message: 'Incorrect old password' });
      }
      // With two-step on, the code as well: a new password removes the account's passkeys and bound
      // phones, so a session and the password alone could shut the owner out.
      const coded = !user.twoStep ? Promise.resolve(true) : (async () => {
        if (noCode(code)) { needCode(req, res, user, 'change-password'); return false; }
        if (codesFrozen(user, code)) { res.status(429).json(TOO_MANY); return false; }
        if (codeRefusedToday(user, code)) { sayCodesSpent(req, res, user); return false; }
        // A code is spent as it is looked at (one request wins, here and at the
        // administrator's doors); a recovery code is given back when the change then
        // fails, so that does not cost one.
        if (code.length > 40 || !(await passesTwoStep(user, code))) {
          recordLoginFailure(ip, req, user.username, 'wrong-code', 'change-password');
          res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' }); return false;
        }
        return true;
      })();
      const notChanged = () => giveRecoveryBack(user, user.twoStep && recoveryShaped(code) ? twoStep.hashRecovery(code) : null);
      coded.then((ok) => { if (!ok) return;

      bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
        if (hashErr) return notChanged().then(() => res.status(500).json({ message: 'Error hashing password' }));

        // Only over the password that was just checked: one changed meanwhile (an
        // admin's reset, another of the owner's pages) is not overwritten by a change
        // that was already on its way.
        usersDB.update(
          { ...activeUserMutationQuery(req.userId), password: user.password },
          { $set: { password: hashedPassword } },
          {},
          (updateErr, updated) => {
            // The account's other sessions, its passkeys and its phones all go, each
            // waited for, and said when they did not all go (the sessions too, as lifecycleAction says it).
            // A new password unbinds every login-key phone: whoever changed it may be
            // shutting out someone who had the old one. This session stays, however the
            // request named it (cookie or Authorization).
            const signInsGo = () => {
              qrRequests.revokeUser(req.userId);twoStepTickets.revokeUser(req.userId);endFreshSignIn(req.userId);
              const mine = hashSessionToken(req.sessionToken || req.cookies.session_id);
              return Promise.all([removeSessionsOrFail({ userId: req.userId, tokenHash: { $ne: mine } }), passkeyStore.removeAll(req.userId), loginDevices.removeAll(req.userId)]);
            };
            // A write the store reports as failed may have been made all the same (NeDB
            // changes the row in memory before it saves it): the code stays spent (see
            // adminKept). Read back: if the new password is what the account now has,
            // it is treated as changed, the old ways in go as they would, and the page is
            // told the password may have changed.
            if (updateErr) {
              return findUser({ _id: req.userId }).catch(() => null).then((now) => {
                if (now?.password !== hashedPassword) return res.status(500).json({ message: 'Error updating password' });
                const unknown = { message: 'The password may have been changed: sign in with the new one, or with the old one if that fails', code: 'PASSWORD_CHANGE_UNKNOWN' };
                return signInsGo().then(() => res.status(500).json(unknown), (e) => { console.error('password change: sign-ins not all removed:', e.message); res.status(500).json(unknown); });
              });
            }
            if (!updated) {
              return notChanged().then(() => findUser(activeUserMutationQuery(req.userId)).catch(() => null)).then((now) => res.status(409).json(now
                ? { message: 'The password was changed meanwhile; try again', code: 'PASSWORD_CHANGED' }
                : { message: 'Account is no longer active', code: 'ACCOUNT_INACTIVE' }));
            }
            compactQuietly(usersDB, 'users');
            signInsGo()
              .then(() => res.json({ message: 'Password changed successfully' }))
              .catch((e) => { console.error('password change: sign-ins not all removed:', e.message); res.status(500).json({ message: 'Password changed, but its other sign-ins, passkeys or bound phones could not all be removed; remove them from Settings', code: 'CREDENTIAL_CLEANUP_INCOMPLETE' }); });
          },
        );
      });
      }).catch((e) => { console.error('change password:', e.message); if (!res.headersSent) res.status(500).json({ message: 'Error' }); });
    });
  });
};

// --- admin user management ---

exports.listUsers = (req, res) => {
  usersDB.find({}, (err, users) => {
    if (err) return res.status(500).json({ message: 'Error reading users' });
    const now = Date.now();
    // In the order the admins dragged them into (services/userOrder.js).
    let ordered = users, orderVersion = null;
    try { ordered = defaultUserOrder().sort(users, (u) => u._id); orderVersion = defaultUserOrder().version(); } catch (e) { console.error('user order:', e.message); }
    res.json({
      orderVersion,
      users: ordered.map((u) => ({
        ...publicUser(u),
        lastSeen: u.lastSeen || null,
        online: Boolean(isActiveUser(u) && u.lastSeen && now - u.lastSeen < ONLINE_WINDOW_MS),
      })),
    });
  });
};

// Making an administrator (a new admin account, or an account raised to admin) takes
// the acting admin's own password again, and the two-step code when theirs is on.
// An admin's session alone could otherwise make a
// second admin and use it to reset the first one's password and two-step.
// The same again for what would get round it: resetting anyone's password, enabling an administrator
// that was disabled, renaming an administrator. A session alone could otherwise
// take over an administrator that exists instead of making one.
// how: create, promote, demote, reset-password, reset-two-step, enable, disable, delete, purge, rename.
async function adminAgain(req, res, how, target) {
  const { adminPassword, adminCode, adminPasskey } = req.body || {};
  // A passkey stands for the password and the code together: it needs the person at
  // the device, verified, and is bound to this site.
  // Its challenge was issued to this account (POST /api/auth/passkey/again) and answers
  // one action.
  if (adminPasskey && typeof adminPasskey === 'object' && !Array.isArray(adminPasskey)) return adminAgainByPasskey(req, res, how, target, adminPasskey);
  if (typeof adminPassword !== 'string' || !adminPassword) { res.status(400).json({ message: 'Enter your own password to do this', code: 'NEED_PASSWORD' }); return false; }
  const ip = resolveClientIp(req);
  if (loginBlocked(ip, req, req.username || '', 'admin-grant') || !held(ip, res)) { res.status(429).json(TOO_MANY); return false; }
  const me = await activeAccount(req.userId);
  if (!me || me.role !== 'admin') { res.status(403).json({ message: 'Account is not active' }); return false; }
  if (!(await bcrypt.compare(adminPassword, me.password))) {
    recordLoginFailure(ip, req, me.username, 'wrong-password', 'admin-grant');
    res.status(400).json({ message: 'Invalid credentials', code: 'WRONG_PASSWORD' }); return false;
  }
  if (me.twoStep) {
    if (noCode(adminCode)) { needCode(req, res, me, 'admin-again'); return false; }
    if (codesFrozen(me, adminCode)) { res.status(429).json(TOO_MANY); return false; }
    if (codeRefusedToday(me, adminCode)) { sayCodesSpent(req, res, me); return false; }
    // A code is spent as it is looked at, so one code is one action however many
    // requests carry it at once, here or at any other door that takes one. A
    // recovery code is given back when the action then does not happen
    // (adminRefused): a grant that fails on a taken name must not cost one.
    if (adminCode.length > 40 || !(await passesTwoStep(me, adminCode))) {
      recordLoginFailure(ip, req, me.username, 'wrong-code', 'admin-grant');
      res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' }); return false;
    }
  }
  req.adminGrant = { how, target, me, claimed: me.twoStep && recoveryShaped(adminCode) ? twoStep.hashRecovery(adminCode) : null };
  return true;
}
async function adminAgainByPasskey(req, res, how, target, body) {
  const ip = resolveClientIp(req);
  if (loginBlocked(ip, req, req.username || '', 'admin-grant') || !held(ip, res)) { res.status(429).json(TOO_MANY); return false; }
  const me = await activeAccount(req.userId);
  if (!me || me.role !== 'admin') { res.status(403).json({ message: 'Account is not active' }); return false; }
  try {
    const answer = passkeys.answer(body, { challenges: passkeyChallenges, isAllowedOrigin: isPasskeyOrigin, userId: me._id });
    const kept = await passkeyStore.byCredential(body.id);
    if (!kept || String(kept.userId) !== String(me._id)) throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason: 'not yours' });
    if (!passkeys.confirmsAdmin(kept, me)) throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason: 'not added with the password' });
    const { signCount } = passkeys.assert(answer, body, kept);
    if (!(await passkeyStore.used(kept, signCount))) throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason: 'counter' });
  } catch (e) {
    if (e.status !== 400) throw e;
    recordLoginFailure(ip, req, me.username, 'wrong-passkey', 'admin-grant');
    res.status(400).json({ message: 'Passkey not accepted', code: 'PASSKEY_REFUSED' }); return false;
  }
  req.adminGrant = { how, target, me, claimed: null, by: 'passkey' };
  return true;
}
// POST /api/auth/passkey/again: a challenge for the signed-in admin to confirm one
// action with a passkey, and which of their keys may answer it. None: the page asks
// for the password (and code) instead.
exports.passkeyAgain = async (req, res) => {
  try {
    const me = await activeAccount(req.userId);
    if (!me || me.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
    const ids = await passkeyStore.ids(me._id, (d) => passkeys.confirmsAdmin(d, me));
    if (!ids.length) return res.json({ challenge: null, allow: [] });
    res.json({ challenge: passkeyChallenges.issue('get', me._id), allow: ids });
  } catch (e) { sendPasskeyError(res, e); }
};
// The administrator was made: the line is written now, not before, so the record
// shows only grants that happened.
function adminGranted(req, userId) {
  const grant = req.adminGrant;
  if (!grant) return;
  req.adminGrant = null;
  audit({ source: 'users', action: grant.how === 'create' || grant.how === 'promote' ? 'admin-grant' : 'admin-again', how: grant.how, by: req.username, target: String(userId || grant.target), ...(grant.by ? { with: grant.by } : {}) });
}
// It may have happened: a store write reported as failed can have been made all the
// same (NeDB changes its rows in memory before it saves them), or the action stopped
// part-way. The confirmation counts as used and its code stays spent; no line is
// written, since the record shows only what is known to have happened. A code is
// given back only when the action certainly did not happen.
function adminKept(req) { req.adminGrant = null; }
// A recovery code that was claimed for something that then did not happen goes back,
// to the two-step it came from and no other (one turned off or set up anew meanwhile
// has other codes).
const giveRecoveryBack = (user, hash) => (!hash || !user?.twoStep?.secret ? Promise.resolve()
  : updateUser({ _id: user._id, 'twoStep.secret': user.twoStep.secret }, { $addToSet: { 'twoStep.recovery': hash } }).then(() => {}, (e) => console.error('recovery code not given back:', e.message)));
// The handler answered with its confirmation unused: the code it claimed goes back.
function adminRefused(req) {
  const grant = req.adminGrant;
  req.adminGrant = null;
  return giveRecoveryBack(grant?.me, grant?.claimed);
}
// What an administrator does to accounts is done one request at a time, each reading
// the account as the one before left it. Side by side, several renames each moved
// the counts from the name they had read, a delete forgot the counts of a name the
// account no longer had, an account promoted meanwhile was treated as the member it
// had been, and two accounts were made under one name.
// The turn ends when the handler itself answers, not when the connection closes: a
// client that goes away must neither free the turn under a handler still at work
// nor get its code back for an action that then happens. One that never answers
// gives way after a minute, and keeps what it claimed. Who is acting is read again
// when the turn comes: an administrator demoted, disabled or signed out while
// waiting does nothing more.
let adminTurn = Promise.resolve(), adminWaiting = 0;
const ADMIN_TURN_MS = 60_000, ADMIN_WAITING_MAX = 40;
const inTurn = (handler) => (req, res) => {
  if (adminWaiting >= ADMIN_WAITING_MAX) return res.status(429).json(TOO_MANY);
  adminWaiting += 1;
  adminTurn = adminTurn.catch(() => {}).then(() => new Promise((done) => {
    let over = false;
    const free = () => { if (over) return false; over = true; clearTimeout(timer); adminWaiting -= 1; return true; };
    const timer = setTimeout(() => { if (free()) done(); }, ADMIN_TURN_MS);
    timer.unref?.();
    // Given back only on an answer that says it did not happen.
    const answered = () => { if (free()) (res.statusCode >= 400 ? adminRefused(req) : Promise.resolve()).then(done, done); };
    for (const m of ['json', 'send', 'end']) if (typeof res[m] === 'function') { const say = res[m]; res[m] = function (...a) { try { return say.apply(this, a); } finally { answered(); } }; }
    Promise.resolve().then(async () => {
      // Nobody is there to answer: nothing is done.
      if (res.destroyed || res.writableEnded || req.socket?.destroyed) return answered();
      // A request with no session to read (a test calling the handler) is taken as it came.
      if (req.sessionToken) {
        const actor = await resolveLivePrincipal(req.sessionToken, req.userId);
        if (!actor) return res.status(401).json({ message: 'Invalid or expired session' });
        if (actor.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
        req.username = actor.username; req.role = actor.role; req.principal = actor;
      }
      return handler(req, res);
    }).catch((e) => { console.error('admin action:', e.message); try { if (!res.headersSent) res.status(500).json({ message: 'Error' }); } finally { answered(); } });
  }));
};
// Two names that are one name once folded (a Kelvin sign for k, ß for ẞ) would share
// everything the security log counts by name while being two accounts to the user
// list: deleting or renaming the one would clear the other's counts. Such a twin is refused where a name is given or changed.
const nameFold = (v) => String(v || '').normalize('NFKC').trim().toLowerCase();
async function nameTwin(name, exceptId = '') {
  const want = nameFold(name);
  if (!want) return null;
  const all = await new Promise((ok, no) => usersDB.find({}, (e, rows) => (e ? no(e) : ok(rows))));
  // And the key the security log counts under, which is cut at eighty characters:
  // two long names of letters that grow in lower case shared it.
  return all.find((u) => String(u._id) !== String(exceptId) && (nameFold(u.username) === want || accountKey(u.username) === accountKey(name))) || null;
}
// Said once at start-up when accounts already stored share a name this way; nothing is changed.
usersDB.find({}, (e, rows) => {
  if (e || !rows) return;
  const seen = new Map();
  for (const u of rows) for (const k of new Set([`f:${nameFold(u.username)}`, `k:${accountKey(u.username)}`])) seen.set(k, (seen.get(k) || 0) + 1);
  const shared = [...seen.values()].filter((n) => n > 1).length;
  if (shared) console.warn(`users: ${shared} name(s) are shared by more than one stored account once folded; rename one of each pair`);
});
// The role an account is given: 'admin' or 'user'; anything else is refused. The role
// names an earlier build kept (roleId) are gone: a stored
// one is never read, and goes when the account's role is next set.
function placeRole(role) {
  if (role === 'admin' || role === 'user') return { role };
  return null;
}
exports.createUser = inTurn(async (req, res) => {
  try {
    // A role that is not there is refused before the admin's code is asked for and spent.
    const asRole = (req.body || {}).role;
    if (asRole !== undefined && asRole !== null && !placeRole(asRole)) return res.status(400).json({ message: 'Unsupported role' });
    if (typeof (req.body || {}).username === 'string' && await nameTwin(req.body.username)) return res.status(400).json({ message: 'User already exists' });
    // A name already taken is refused before the admin's code is asked for and spent.
    const wanted = String((req.body || {}).username || '').trim();
    // A name or password that will be refused is refused by the making itself, unasked.
    const asked = (req.body || {}).password;
    if (typeof asked !== 'string') return res.status(400).json({ message: 'Username and password are required' });
    if (!wanted || textProblem(wanted, USERNAME_MAX_LENGTH, 'Username') || asked.length < MIN_PASSWORD_LENGTH) return createUserNow(req, res);
    if ((req.body || {}).role === 'admin' && wanted && await findUser(usernameQuery(wanted))) return res.status(400).json({ message: 'User already exists' });
    if ((req.body || {}).role === 'admin' && !(await adminAgain(req, res, 'create', String((req.body || {}).username || '').slice(0, 64)))) return;
  } catch (e) { console.error('admin grant:', e.message); return res.status(500).json({ message: 'Error' }); }
  return createUserNow(req, res);
});
function createUserNow(req, res) {
  const { username, password, role } = req.body || {};
  const name = (username || '').trim();
  if (!name || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }
  const usernameProblem = textProblem(name, USERNAME_MAX_LENGTH, 'Username');
  if (usernameProblem) return res.status(400).json({ message: usernameProblem });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const placed = role === undefined || role === null ? { role: 'user' } : placeRole(role);
  if (!placed) return res.status(400).json({ message: 'Unsupported role' });

  usersDB.findOne(usernameQuery(name), (err, existing) => {
    if (err) return res.status(500).json({ message: 'Error reading users' });
    if (existing) return res.status(400).json({ message: 'User already exists' });

    bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
      if (hashErr) return res.status(500).json({ message: 'Error hashing password' });
      usersDB.insert(
        {
          username: name,
          normalizedUsername: normalizeUsername(name),
          password: hashedPassword,
          role: placed.role,
          language: 'en',
          lifecycleStatus: LIFECYCLE_STATUS.ACTIVE,
          lifecycleSchemaVersion: 1,
        },
        (insertErr, user) => {
          if (insertErr) { adminKept(req); return res.status(500).json({ message: 'Error creating user' }); }
          compactQuietly(usersDB, 'users');
          adminGranted(req, user._id);
          res.status(201).json({ user: publicUser(user) });
        },
      );
    });
  });
}

exports.updateUser = inTurn(async (req, res) => {
  try {
    // A name that cannot be had is refused before the admin's code is asked for and
    // spent, whatever else the request carries.
    const renamed = typeof (req.body || {}).username === 'string' && (req.body.username.trim());
    if (renamed && textProblem(renamed, USERNAME_MAX_LENGTH, 'Username')) return res.status(400).json({ message: textProblem(renamed, USERNAME_MAX_LENGTH, 'Username') });
    if (renamed && await nameTwin(renamed, req.params.id)) return res.status(400).json({ message: 'Username already taken' });
    const holder = renamed ? await findUser(usernameQuery(renamed)) : null;
    if (holder && String(holder._id) !== String(req.params.id)) return res.status(400).json({ message: 'Username already taken' });
    const asRole = (req.body || {}).role;
    if (typeof asRole === 'string' && !placeRole(asRole)) return res.status(400).json({ message: 'Unsupported role' });
    if (asRole === 'admin') {
      const target = await findUser({ _id: req.params.id });
      // Already an admin: nothing is being granted, nothing more is asked.
      if (target && target.role !== 'admin' && !(await adminAgain(req, res, 'promote', String(target._id)))) return;
    }
    // Taking an administrator down is confirmed like making one: a session alone could otherwise demote the other admin
    // and then do to that account everything a member's account allows.
    if (typeof asRole === 'string' && asRole !== 'admin' && String(req.params.id) !== String(req.userId)) {
      const target = await findUser({ _id: req.params.id });
      if (target && target.role === 'admin' && !(await adminAgain(req, res, 'demote', String(target._id)))) return;
    }
    if (renamed && !req.adminGrant) {
      const target = await findUser({ _id: req.params.id });
      // A rename is any name that is not the stored one letter for letter. Compared
      // in lower case, a letter that only looks the same (U+212A for k) passed as no
      // change and took no confirmation.
      const differs = target && target.role === 'admin' && renamed !== target.username;
      if (differs && !(await adminAgain(req, res, 'rename', String(target._id)))) return;
    }
  } catch (e) { console.error('admin grant:', e.message); return res.status(500).json({ message: 'Error' }); }
  return updateUserNow(req, res);
});
function updateUserNow(req, res) {
  const { id } = req.params;
  const { name, username, role } = req.body || {};
  const update = {};
  const unset = {};

  if (typeof name === 'string' && name.trim()) update.name = name.trim();
  const problem = (update.name && textProblem(update.name, NAME_MAX_LENGTH, 'Name'))
    || (typeof username === 'string' && username.trim() && textProblem(username.trim(), USERNAME_MAX_LENGTH, 'Username'));
  if (problem) return res.status(400).json({ message: problem });
  if (typeof role === 'string') {
    const placed = placeRole(role);
    if (!placed) {
      return res.status(400).json({ message: 'Unsupported role' });
    }
    if (id === req.userId && placed.role !== 'admin') {
      return res.status(400).json({ message: 'You cannot demote your own account' });
    }
    update.role = placed.role;
    unset.roleId = true;
  }

  const apply = () => {
    usersDB.findOne({ _id: id }, (findErr, existingUser) => {
      if (findErr) return res.status(500).json({ message: 'Error reading user' });
      if (!existingUser) return res.status(404).json({ message: 'User not found' });
      if (effectiveLifecycleStatus(existingUser) === LIFECYCLE_STATUS.DELETED_TOMBSTONE) {
        return res.status(409).json({ message: 'Deleted users cannot be edited', code: 'USER_TOMBSTONE_TERMINAL' });
      }
      // 'admin' with no grant made means the check found an administrator already.
      // Held to that at the write: one demoted in between is not raised again by a
      // request that was let through as "nothing is being granted".
      const stillAdmin = update.role === 'admin' && req.adminGrant?.how !== 'promote';
      if (stillAdmin && existingUser.role !== 'admin') return res.status(409).json({ message: 'This account is no longer an administrator; try again', code: 'ROLE_CHANGED' });
      // The sign-ins carry the role and the name: they end only when one of them changes.
      // The name as it already is, which the re-prompt lets through, is no change.
      if (update.username === existingUser.username) { delete update.username; delete update.normalizedUsername; }
      const signInsChange = Boolean(update.username) || (update.role !== undefined && update.role !== existingUser.role);
      // Written with the change and cleared when the sign-ins are gone: "the same request
      // again finishes it" holds though that request now changes nothing (review, 2026-11-03).
      const endSignIns = signInsChange || existingUser.signInsCleanupDue === true;
      if (signInsChange) update.signInsCleanupDue = true;
      usersDB.update({ ...nonTombstoneUserMutationQuery(id), ...(stillAdmin ? { role: 'admin' } : {}) }, { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, {}, (err, updated) => {
        if (err) { adminKept(req); return res.status(500).json({ message: 'Error updating user' }); }
        if (!updated) {
          return res.status(409).json(stillAdmin ? { message: 'This account is no longer an administrator; try again', code: 'ROLE_CHANGED' } : { message: 'Deleted users cannot be edited', code: 'USER_TOMBSTONE_TERMINAL' });
        }
        compactQuietly(usersDB, 'users');
        // The counts follow the account to its new name.
        if (update.username && update.username !== existingUser.username) security.renamed(existingUser.username, update.username);
        adminGranted(req, id);
        // role/username changes invalidate the user's sessions (JWT carries both)
        // With them go what was waiting on those sessions: a QR request approved
        // and not collected, a two-step ticket, the bound phones.
        // Waited for, and said when it did not all go: the same request again
        // finishes it.
        // What only waits on memory goes at once, before anything is awaited.
        if (endSignIns) { qrRequests.revokeUser(id);twoStepTickets.revokeUser(id);endFreshSignIn(id); }
        // admin→user demotion: what a member may not keep goes (server/productAccountHooks.js).
        // One that could not be stopped or written is said, as for a disable, not answered
        // as done.
        let agentsLeft = null;
        if (update.role === 'user') {
          try { const r = require('../productAccountHooks').onDemoted(id); if (r?.failed?.length) agentsLeft = r.failed; }
          catch (error) { console.error(`full-access cleanup failed: ${error.message}`); agentsLeft = [{ id: '*', title: 'full-access cleanup failed' }]; }
        }
        const signInsGone = !endSignIns ? Promise.resolve()
          : Promise.all([removeSessionsOrFail({ userId: id }), loginDevices.removeAll(id)]).then(() => new Promise((done, failed) => usersDB.update({ _id: id }, { $unset: { signInsCleanupDue: true } }, {}, (e) => (e ? failed(e) : done()))));
        signInsGone.then(() => {
        if (agentsLeft) return res.status(500).json({ message: 'Demoted and signed out, but some of its agents were not stopped or saved: stop them by hand', code: 'FULL_ACCESS_CLEANUP_INCOMPLETE', agentsNotStopped: agentsLeft });
        usersDB.findOne({ _id: id }, (readErr, user) => {
          if (readErr || !user) return res.status(404).json({ message: 'User not found' });
          res.json({ user: publicUser(user) });
        });
        }, (e) => { console.error('update: sign-ins not all removed:', e.message); res.status(500).json(CLEANUP_INCOMPLETE); });
      });
    });
  };

  if (typeof username === 'string' && username.trim()) {
    const newUsername = username.trim();
    usersDB.findOne(usernameQuery(newUsername), (err, existing) => {
      if (err) return res.status(500).json({ message: 'Error reading users' });
      if (existing && existing._id !== id) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      update.username = newUsername;
      update.normalizedUsername = normalizeUsername(newUsername);
      apply();
    });
    return;
  }

  if (!Object.keys(update).length) {
    return res.status(400).json({ message: 'Nothing to update' });
  }
  apply();
}

// The order of the accounts, as an admin drags them.
// Only the order changes; a list that changed meanwhile is refused.
function orderRefused(res, e) {
  if (e?.status) return res.status(e.status).json({ message: e.message, code: e.code });
  console.error('user order:', e?.message);
  return res.status(500).json({ message: 'Error' });
}
exports.reorderUsers = inTurn(async (req, res) => {
  try {
    const known = await new Promise((ok, no) => usersDB.find({}, { _id: 1 }, (e, rows) => (e ? no(e) : ok(rows.map((u) => String(u._id))))));
    const ids = defaultUserOrder().set((req.body || {}).ids, known, (req.body || {}).version);
    audit({ source: 'users', action: 'user-reorder', by: req.username, count: ids.length });
    res.json({ ids, orderVersion: defaultUserOrder().version() });
  } catch (e) { orderRefused(res, e); }
});

// A disabled or deleted account's agents stop, every one. Only for an account read back as not active: one not found is left
// alone, since a process reading the wrong data must never stop live agents. Enabling it
// again starts nothing; its owner does.
// What could not be stopped is handed back for the response, so the admin is told which
// agents to stop by hand: agentsNotStopped lists them
// by id and name; agentsStopUnchecked says the stop itself could not be done or checked.
// A product with nothing to stop returns nothing from the hook.
async function stopAgentsIfOff(id) {
  try {
    const user = await findUser({ _id: id });
    if (!user || isActiveUser(user)) return {};
    const { stopped = [], failed = [] } = require('../productAccountHooks').onAccountOff(String(user._id)) || {};
    if (stopped.length) audit({ source: 'users', action: 'agents-stopped', target: String(user._id), count: stopped.length, conversations: stopped });
    if (failed.length) audit({ source: 'users', action: 'agents-not-stopped', target: String(user._id), count: failed.length, conversations: failed.map((c) => c.id) });
    return failed.length ? { agentsNotStopped: failed } : {};
  } catch (e) { console.error('account off: its agents not all stopped:', e.message); return { agentsStopUnchecked: true }; }
}

async function lifecycleAction(req, res, action, successMessage) {
  try {
    // Read to know whether an administrator is being brought back: not guessed when it cannot be read.
    const before = await findUser({ _id: req.params.id });
    if (action === 'enable' && before?.role === 'admin' && !(await adminAgain(req, res, 'enable', String(before._id)))) return;
    // Disabling or deleting another administrator is confirmed too.
    if ((action === 'disable' || action === 'delete') && before?.role === 'admin' && String(before._id) !== String(req.userId) && !(await adminAgain(req, res, action, String(before._id)))) return;
    // An account comes back with none of the ways in it had: what a disable could not
    // remove is removed here, or the account is not enabled.
    // Only for one that is off: enabling an account that is already on (a stale list,
    // a second click) must not strip its passkeys and phones.
    // Read again for this: the admin's password and code took a while, and a disable
    // may have landed meanwhile.
    const now = action === 'enable' ? await findUser({ _id: req.params.id }) : null;
    if (action === 'enable' && now && !isActiveUser(now)) {
      try { await Promise.all([loginDevices.removeAll(req.params.id), passkeyStore.removeAll(req.params.id)]); } catch (e) { console.error('enable: old passkeys or phones not removed:', e.message); return res.status(500).json({ message: 'Not enabled: its old passkeys or bound phones could not be removed first. Try again.', code: 'CREDENTIAL_CLEANUP_INCOMPLETE' }); }
    }
    const result = await lifecycleService()[`${action}User`]({
      targetUserId: req.params.id,
      actor: req.principal,
      reason: req.body?.reason,
    });
    // A disabled or deleted account keeps no login-key phone, nor anything they approved.
    // Said when they did not all go: they open nothing while the account is off, and
    // enabling it removes them again before it is on.
    let left = null;
    if (action === 'disable' || action === 'delete') {
      qrRequests.revokeUser(req.params.id);twoStepTickets.revokeUser(req.params.id);endFreshSignIn(req.params.id);
      try { await Promise.all([loginDevices.removeAll(req.params.id), passkeyStore.removeAll(req.params.id)]); } catch (e) { left = e; console.error(`${action}: passkeys or bound phones not removed:`, e.message); }
      // A disable keeps what the security log holds for the account, its protection
      // and its counts: off and on again must not be a way round them. A delete forgets it all.
      if (action === 'delete') security.forgetUser(req.params.id, before?.username);
    }
    adminGranted(req, req.params.id);
    const agentsLeft = action === 'disable' || action === 'delete' ? await stopAgentsIfOff(req.params.id) : {};
    if (left) return res.status(500).json({ message: `${successMessage}, but its passkeys or bound phones could not all be removed. ${action === 'delete' ? 'Delete it again to remove them.' : 'They are removed before it is enabled again.'}`, code: 'CREDENTIAL_CLEANUP_INCOMPLETE', ...result, ...agentsLeft });
    res.json({ message: successMessage, ...result, ...agentsLeft });
  } catch (error) {
    // Stopped part-way, the account is already changed: the confirmation was used,
    // its code stays spent and the line is written.
    let agentsLeft = {};
    if (error?.code === 'USER_LIFECYCLE_PARTIAL') { adminGranted(req, req.params.id); if (action === 'disable' || action === 'delete') agentsLeft = await stopAgentsIfOff(req.params.id); }
    // Any other failure that is not a refusal (a 4xx said before anything was written)
    // may have written something, a pending transition among it: the code stays spent.
    else if (!(error?.status >= 400 && error.status < 500)) adminKept(req);
    sendLifecycleError(res, error, agentsLeft);
  }
}

exports.disableUser = inTurn((req, res) => lifecycleAction(req, res, 'disable', 'User disabled'));
exports.enableUser = inTurn((req, res) => lifecycleAction(req, res, 'enable', 'User enabled'));
exports.deleteUser = inTurn((req, res) => lifecycleAction(req, res, 'delete', 'User deleted'));

exports._setUserLifecycleServiceForTests = (service) => {
  injectedLifecycleService = service || null;
};

// Retryable footprint cleanup for a purged user: remove their push subscription and
// preference rows, and everything their agents own. Every cleanup is attempted,
// but any failure keeps the tombstone row as the retry anchor. push-deliveries
// history is intentionally left untouched.
async function purgeUserFootprint(userId) {
  const id = String(userId);
  const outcomes = await Promise.allSettled([
    require('../services/pushStore').getDefaultPushStore().purgeUser(id),
    // What the product keeps for them (server/productAccountHooks.js; in CC Agent their
    // agents' conversations, attachments, workspaces and transcripts). Without it,
    // deleting an account would leave every message on disk for ever, reachable by nobody.
    Promise.resolve().then(() => require('../productAccountHooks').onPurge(id)),
    loginDevices.removeAll(id),
    passkeyStore.removeAll(id),
    Promise.resolve().then(() => { qrRequests.revokeUser(id); twoStepTickets.revokeUser(id);endFreshSignIn(id); }),
  ]);
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (failures.length) {
    const error = new Error(`user purge cleanup incomplete (${failures.length} step(s) failed)`);
    error.code = 'USER_PURGE_CLEANUP_INCOMPLETE';
    error.causes = failures.map((outcome) => outcome.reason);
    throw error;
  }
}

// DELETE /api/auth/users/:id/purge — permanently remove a tombstone account.
// Admin-only (restrictTo in the route; the internal role check mirrors updateMe
// and keeps the endpoint self-guarding). The target must already be a
// deleted_tombstone; anything else is refused with 409 USER_NOT_TOMBSTONE.
// What is left of an administrator is removed for good with the acting admin's own
// password again, as deleting one is.
exports.purgeUser = inTurn(async (req, res) => {
  if (req.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    const gone = await findUser({ _id: req.params.id });
    let tombstone = false;
    try { tombstone = Boolean(gone) && effectiveLifecycleStatus(gone) === LIFECYCLE_STATUS.DELETED_TOMBSTONE; } catch (_error) { tombstone = false; }
    if (tombstone && gone.role === 'admin' && !(await adminAgain(req, res, 'purge', String(gone._id)))) return;
  } catch (e) { console.error('purge:', e.message); return res.status(500).json({ message: 'Error' }); }
  return purgeUserNow(req, res);
});
function purgeUserNow(req, res) {
  const { id } = req.params;
  usersDB.findOne({ _id: id }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Error reading user' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    let status = null;
    try {
      status = effectiveLifecycleStatus(user);
    } catch (_error) {
      status = null;
    }
    if (status !== LIFECYCLE_STATUS.DELETED_TOMBSTONE) {
      return res.status(409).json({
        message: 'Only a deleted user can be permanently removed',
        code: 'USER_NOT_TOMBSTONE',
      });
    }
    purgeUserFootprint(id)
      .then(() => {
        security.forgetUser(id, user.username);
        // Remove the tombstone last. If this write fails, the already-idempotent
        // footprint cleanup can safely run again while the row remains.
        usersDB.remove({ _id: id }, {}, (removeErr, removed) => {
          if (removeErr) { adminKept(req); return res.status(500).json({ message: 'Error removing user' }); }
          if (!removed) return res.status(404).json({ message: 'User not found' });
          compactQuietly(usersDB, 'users');
          adminGranted(req, id);
          return res.json({ message: 'User purged', id });
        });
      })
      .catch((cleanupErr) => {
        // Part of it is gone for good: the confirmation was used.
        adminGranted(req, id);
        console.error(`purge cleanup failed for ${id}: ${cleanupErr.message}`);
        return res.status(500).json({
          message: 'User footprint cleanup is incomplete; retry the purge',
          code: 'USER_PURGE_CLEANUP_INCOMPLETE',
        });
      });
  });
}

exports.resetUserPassword = inTurn(async (req, res) => {
  // What would be refused anyway is refused before the admin's code is asked for and
  // spent on it.
  // One's own password is changed with the old one, on the change-password page: this door asks for neither.
  if (String(req.params.id) === String(req.userId)) return res.status(409).json({ message: 'Change your own password from Settings', code: 'OWN_ACCOUNT' });
  const asked = (req.body || {}).newPassword;
  if (!asked || asked.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  try { if (!(await adminAgain(req, res, 'reset-password', String(req.params.id)))) return; } catch (e) { console.error('reset password:', e.message); return res.status(500).json({ message: 'Error' }); }
  return resetUserPasswordNow(req, res);
});
exports._resetUserPasswordNow = (req, res) => resetUserPasswordNow(req, res);
function resetUserPasswordNow(req, res) {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  usersDB.findOne({ _id: id }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Error reading user' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (effectiveLifecycleStatus(user) === LIFECYCLE_STATUS.DELETED_TOMBSTONE) {
      return res.status(409).json({ message: 'Deleted users have no credentials', code: 'USER_TOMBSTONE_TERMINAL' });
    }
    bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
      if (hashErr) return res.status(500).json({ message: 'Error hashing password' });
      usersDB.update(
        nonTombstoneUserMutationQuery(id),
        { $set: { password: hashedPassword } },
        {},
        (updateErr, updated) => {
          if (updateErr) { adminKept(req); return res.status(500).json({ message: 'Error updating password' }); }
          if (!updated) {
            return res.status(409).json({
              message: 'Deleted users have no credentials', code: 'USER_TOMBSTONE_TERMINAL',
            });
          }
          qrRequests.revokeUser(id);twoStepTickets.revokeUser(id);endFreshSignIn(id);
          // Waited for: the password is new, and the old ways in are gone before the
          // admin is told so; the same request again finishes what did not go.
          adminGranted(req, id);
          Promise.all([removeSessionsOrFail({ userId: id }), loginDevices.removeAll(id), passkeyStore.removeAll(id)]).then(() => {
            compactQuietly(usersDB, 'users');
            res.json({ message: 'Password reset' });
          }, (e) => { console.error('reset: sign-ins not all removed:', e.message); res.status(500).json(CLEANUP_INCOMPLETE); });
        },
      );
    });
  });
}

// QR sign-in (services/qrLogin.js).
const qrRequests = qrLogin.createRequests();
const loginDevices = qrLogin.createDevices(loginDevicesDB);
const findUser = (query) => new Promise((ok, no) => usersDB.findOne(query, (e, u) => (e ? no(e) : ok(u))));
const findSessions = (query) => new Promise((ok, no) => sessionsDB.find(query, (e, r) => (e ? no(e) : ok(r))));
async function activeAccount(userId) {
  const user = await findUser({ _id: userId });
  if (!isActiveUser(user)) return null;
  if (await findPendingLifecycleTransition(userLifecycleTransitionsDB, userId)) return null;
  return user;
}
const sendQrError = (res, e) => res.status(e.status || 500).json({ message: e.status ? e.message : 'Error' });

const liveSessionMarks = (rows) => rows.filter((x) => new Date(x.expiresAt).getTime() > Date.now()).map((x) => x.tokenHash);
const removeSessions = (query) => new Promise((ok) => sessionsDB.remove(query, { multi: true }, () => ok()));
// The same, but a failure is one: for the places that tell an admin the sign-ins are gone.
const removeSessionsOrFail = (query) => new Promise((ok, no) => sessionsDB.remove(query, { multi: true }, (e) => (e ? no(e) : ok())));
// A phone is unbound: what it approved and has not been collected is void, and what
// it let in is signed out, with any phone bound in those sessions in turn; a session
// signed out takes the phone bound in it along (only the first link of that chain used to go).
async function dropPhone(userId, phone) {
  await loginDevices.remove(userId, phone._id);
  qrRequests.revokeDevice(phone._id);
  for (const row of await findSessions({ userId, approvedBy: phone._id })) await dropSession(userId, row);
}
// A phone whose binding session is gone (idle past its days) can approve nothing any
// more: its key goes, and does not count against the ten. What it let in stays signed
// in, as when the phone signs itself out: a phone left unopened for two weeks must not
// sign the account's computers out. A key unbound, replaced, or whose session is
// signed out from the list does take what it let in along: dropPhone.
async function dropLapsedPhones(userId) {
  const live = liveSessionMarks(await findSessions({ userId }));
  for (const phone of await loginDevices.lapsed(userId, live)) { qrRequests.revokeDevice(phone._id); await loginDevices.remove(userId, phone._id); }
}
// One bind at a time for an account: two sent at once each found no key before
// them and left two keys on one session.
const bindQueue = new Map();
function oneBindAtATime(userId, work) {
  const key = String(userId);
  const run = (bindQueue.get(key) || Promise.resolve()).catch(() => {}).then(work);
  bindQueue.set(key, run);
  run.catch(() => {}).then(() => { if (bindQueue.get(key) === run) bindQueue.delete(key); });
  return run;
}
async function dropSession(userId, row) {
  await removeSessions({ _id: row._id });
  const phone = await loginDevices.bySession(userId, row.tokenHash);
  if (phone) await dropPhone(userId, phone);
}
// POST /api/auth/devices {name, password, code}: this phone becomes a login key. The
// password again (and the two-step code, when that is on), so a session cookie alone
// cannot make one.
exports.bindDevice = async (req, res) => {
  try {
    const { name, password, code } = req.body || {};
    const ip = resolveClientIp(req);
    // A place taken before the password is looked at, like every other check of one.
    if (loginBlocked(ip, req, '', 'bind') || !held(ip, res)) return res.status(429).json({ message: 'Too many attempts, try again later' });
    const user = await activeAccount(req.userId);
    if (!user) return res.status(403).json({ message: 'Account is not active' });
    const ok = typeof password === 'string' && password && await bcrypt.compare(password, user.password);
    if (!ok) { recordLoginFailure(ip, req, user.username, 'wrong-password', 'bind'); return res.status(400).json({ message: 'Invalid credentials', code: 'WRONG_PASSWORD' }); }
    // A bound phone is a way in (it approves QR sign-ins): with two-step on it takes
    // the code as well, like a new passkey, or a session and the password would get
    // round the second step.
    if (user.twoStep) {
      if (noCode(code)) return needCode(req, res, user, 'bind');
      if (codesFrozen(user, code)) return res.status(429).json(TOO_MANY);
      if (codeRefusedToday(user, code)) return sayCodesSpent(req, res, user);
      if (typeof code !== 'string' || code.length > 40 || !(await passesTwoStep(user, code))) {
        recordLoginFailure(ip, req, user.username, 'wrong-code', 'bind');
        return res.status(400).json({ message: 'Invalid code', code: 'WRONG_CODE' });
      }
    }
    // One key a session: binding again replaces the one before, so signing the
    // session out leaves no second key behind. Replacing it is unbinding it: the
    // computers the old key let in are signed out with it (the page says so).
    const mark = hashSessionToken(req.sessionToken || req.cookies?.session_id || '');
    const device = await oneBindAtATime(req.userId, async () => {
      await dropLapsedPhones(req.userId);
      // This session may itself have been let in by a key that just went.
      if (!liveSessionMarks(await findSessions({ userId: req.userId })).includes(mark)) throw Object.assign(new Error('Sign in again'), { status: 401 });
      const before = await loginDevices.bySession(req.userId, mark);
      if (before) await dropPhone(req.userId, before);
      const made = await loginDevices.bind(req.userId, typeof name !== 'string' || textProblem(name, 40, 'name') ? 'Phone' : name, mark);
      for (const extra of await loginDevices.others(req.userId, mark, made.id)) await dropPhone(req.userId, extra);
      return made;
    });
    audit({ source: 'qr-login', action: 'bind', userId: req.userId, deviceId: device.id });
    security.qr({ action: 'bind', userId: req.userId, deviceId: device.id, ip, place: placeOf(req) });
    res.status(201).json({ device });
  } catch (e) { sendQrError(res, e); }
};
// GET /api/auth/devices: the account's login-key phones and its signed-in sessions.
exports.listDevices = async (req, res) => {
  try {
    const current = req.sessionToken || req.cookies?.session_id ? hashSessionToken(req.sessionToken || req.cookies.session_id) : null;
    // Keys bound in a session that has ended approve nothing: dropped, not listed,
    // before the sessions are read, since what they let in goes with them.
    await dropLapsedPhones(req.userId);
    const rows = await findSessions({ userId: req.userId });
    if (current && !rows.some((x) => x.tokenHash === current)) return res.status(401).json({ message: 'Sign in again' });
    // Sessions from before devices were kept have no browser noted: this one is
    // known now, so it is filled in.
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    for (const x of rows) if (x.tokenHash === current && !x.userAgent && ua) { x.userAgent = ua;sessionsDB.update({ _id: x._id }, { $set: { userAgent: ua } }, {}, () => {}); }
    const sessions = rows.filter((x) => new Date(x.expiresAt).getTime() > Date.now())
      .map((x) => ({ id: x._id, method: x.method || 'password', userAgent: x.userAgent || '', createdAt: x.createdAt ? new Date(x.createdAt).toISOString() : null, lastSeen: x.lastSeen ? new Date(x.lastSeen).toISOString() : null, current: x.tokenHash === current }))
      .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    res.json({ devices: await loginDevices.list(req.userId), sessions });
  } catch (e) { sendQrError(res, e); }
};
// Unbinding a phone also signs out what it let in, and, removed from another device
// (a lost phone), the phone's own session.
exports.removeDevice = async (req, res) => {
  try {
    const device = await loginDevices.find(req.userId, req.params.id);
    if (!device) return res.status(404).json({ message: 'Not found' });
    const current = hashSessionToken(req.sessionToken || req.cookies?.session_id || '');
    await dropPhone(req.userId, device);
    if (device.sessionHash && device.sessionHash !== current) await removeSessions({ userId: req.userId, tokenHash: device.sessionHash });
    audit({ source: 'qr-login', action: 'unbind', userId: req.userId, deviceId: device._id });
    security.qr({ action: 'unbind', userId: req.userId, deviceId: device._id, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ ok: true });
  } catch (e) { sendQrError(res, e); }
};
// DELETE /api/auth/sessions/:id: sign one of one's own devices out.
// A phone's own session signed out unbinds that phone too, with what it let in:
// signing out a lost phone should leave nothing of it behind.
exports.removeSession = async (req, res) => {
  try {
    const [row] = await findSessions({ _id: String(req.params.id), userId: req.userId });
    if (!row) return res.status(404).json({ message: 'Not found' });
    await dropSession(req.userId, row);
    // That device's open pages told at once (server/liveUpdates.js).
    require('../liveUpdates').endSignIn(row.tokenHash);
    res.json({ ok: true });
  } catch (e) { sendQrError(res, e); }
};
// POST /api/auth/qr/start {username}: a login page asks for a request (no session
// yet), for the account whose name it was given.
exports.qrStart = (req, res) => {
  try { res.json(qrRequests.start({ ip: resolveClientIp(req), ua: req.headers['user-agent'], name: (req.body || {}).username })); } catch (e) { sendQrError(res, e); }
};
// GET /api/auth/qr/poll?id= with its poll secret in X-QR-Poll: that page asks how it
// stands; approved, it is signed in here, once. A GET, so its asking every two
// seconds is not counted against the site's cap on changes; the secret travels in
// a header another site cannot set.
exports.qrPoll = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const r = qrRequests.collect(req.query?.id, req.headers['x-qr-poll']);
    if (r.status !== 'approved') return res.json({ status: r.status });
    const user = await activeAccount(r.userId);
    // The approving phone must still be bound, and the session it was bound in still
    // signed in: unbinding it, signing it out, or a password change (which unbinds
    // them all) voids what it approved.
    const phone = user && r.deviceId ? await loginDevices.find(r.userId, r.deviceId) : null;
    if (!phone || !liveSessionMarks(await findSessions({ userId: r.userId })).includes(phone.sessionHash)) return res.json({ status: 'denied' });
    issueSession(user, res, { method: 'qr', ua: req.headers['user-agent'], approvedBy: r.deviceId });
    audit({ source: 'qr-login', action: 'signed-in', userId: r.userId, ip: resolveClientIp(req) });
    security.qr({ action: 'signed-in', userId: r.userId, deviceId: r.deviceId, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ status: 'approved', user: publicUser(user), expiresIn: IDLE_SECONDS });
  } catch (e) { sendQrError(res, e); }
};
// GET /api/auth/qr/:id: the bound phone reads who is asking, before deciding.
exports.qrPeek = async (req, res) => {
  // Only a bound phone reads who is asking (its id and secret in headers): another
  // account seeing the code learns nothing of that computer.
  const session = hashSessionToken(req.sessionToken || req.cookies?.session_id || '');
  if (!(await loginDevices.verify(req.userId, req.headers['x-device-id'], req.headers['x-device-secret'], session).catch(() => null))) return res.status(403).json({ message: 'This phone is not bound as a login key', code: 'DEVICE_NOT_BOUND' });
  const r = qrRequests.peek(req.params.id);
  if (!r) return res.status(404).json({ message: 'This code has expired; refresh the login page' });
  // A hint only, by address group: an IPv6 /64 is one network.
  const { group, ...shown } = r;
  res.json({ ...shown, sameNetwork: group === security.groupOf(resolveClientIp(req)) });
};
// POST /api/auth/qr/:id/decide {approve, deviceId, secret}: only from a phone the
// account bound, and only for the account signed in on it.
exports.qrDecide = async (req, res) => {
  try {
    const { approve, deviceId, secret, code } = req.body || {};
    const account = await activeAccount(req.userId);
    if (!account) return res.status(403).json({ message: 'Account is not active' });
    const session = hashSessionToken(req.sessionToken || req.cookies?.session_id || '');
    if (!(await loginDevices.verify(req.userId, deviceId, secret, session))) return res.status(403).json({ message: 'This phone is not bound as a login key', code: 'DEVICE_NOT_BOUND' });
    const outcome = qrRequests.decide(req.params.id, req.userId, approve === true, { code, deviceId, name: account.username });
    if (outcome === 'gone') return res.status(404).json({ message: 'This code has expired; refresh the login page' });
    if (outcome === 'wrong-account') { audit({ source: 'qr-login', action: 'wrong-account', userId: req.userId, deviceId });security.qr({ action: 'wrong-account', userId: req.userId, deviceId, ip: resolveClientIp(req), place: placeOf(req) }); }
    if (outcome === 'wrong-account') return res.status(409).json({ message: 'That page is signing in a different account; the request was refused', code: 'WRONG_ACCOUNT' });
    if (outcome === 'wrong-code') { audit({ source: 'qr-login', action: 'wrong-code', userId: req.userId, deviceId });security.qr({ action: 'wrong-code', userId: req.userId, deviceId, ip: resolveClientIp(req), place: placeOf(req) });return res.status(400).json({ message: 'The number does not match; the request was refused', code: 'WRONG_CODE' }); }
    audit({ source: 'qr-login', action: approve === true ? 'approve' : 'deny', userId: req.userId, deviceId });
    security.qr({ action: approve === true ? 'approve' : 'deny', userId: req.userId, deviceId, ip: resolveClientIp(req), place: placeOf(req) });
    res.json({ ok: true });
  } catch (e) { sendQrError(res, e); }
};
exports._qrRequests = qrRequests;
// The admin's password (and code) again, for what another part of the site guards the
// same way: the peer link's pairing and an agent opened to it (ccAgentRoutes).
exports.adminAgain = adminAgain;
exports.adminGranted = adminGranted;
exports.adminKept = adminKept;

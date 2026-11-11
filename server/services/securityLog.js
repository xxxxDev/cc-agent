// Sign-in defence for an admin to look at: every
// password sign-in tried, what QR sign-in did, how often the site's guards turned
// something away, and which addresses are shut out of signing in with a password.
//
// Blocking: ten failures from one address (an IPv6 /64 counts as one) within 15
// minutes lock it out; each lockout is a strike, and the block grows with the strikes
// of the last seven days: an hour, then a day, then a week. An admin can block or
// unblock an address by hand. A block stops password sign-in and binding a phone
// (which asks for the password); QR sign-in stays open, since it needs a bound phone
// to approve, so an owner who locked themselves out still gets in.
//
// By account too: twenty failures on one account
// name within an hour, from however many addresses, and for an hour that name signs
// in with a password only from an address it signed in from in the last thirty days;
// a day, when it happens again within a day. Not a lock: whoever guesses must not be
// able to shut the owner out, so the owner's own networks and QR sign-in stay open.
// A name that is no account is counted and answered the same, so the answer does not
// say which names exist.
//
// Kept 180 days in one private JSON file; written at most every two seconds.
const fs = require('node:fs');
const path = require('node:path');
const { ipGroup } = require('./qrLogin');
const { normalizeIp } = require('./clientIp');
const { PRODUCT } = require('../siteConfig');

const KEEP_DAYS = 180, EVENTS_MAX = 20000, WRITE_MS = 2000;
const WINDOW_MS = 15 * 60_000, MAX_FAILURES = 10, STRIKE_DAYS = 7;
const STEPS_MS = [60 * 60_000, 24 * 3600_000, 7 * 24 * 3600_000];
const HAND_MAX_HOURS = 24 * 365;
const ACCOUNT_WINDOW_MS = 60 * 60_000, ACCOUNT_MAX_FAILURES = 20, ACCOUNT_AGAIN_MS = 24 * 3600_000, KNOWN_DAYS = 30;
const ACCOUNT_STEPS_MS = [60 * 60_000, 24 * 3600_000];
// Wrong two-step codes, which only someone holding the password can make, get a
// much smaller count: ten in a day protect the account.
// And thirty wrong codes in a day: no authenticator code is looked at for that
// account for the rest of the day, from any address (a recovery code, a passkey
// or QR sign-in still gets its owner in).
const CODE_DAY_MAX = 30, GUARD_WRITE_MS = 60_000;
const CODE_WINDOW_MS = 24 * 3600_000, CODE_MAX_FAILURES = 10, SEEN_WRITE_MS = 60 * 60_000, SEEN_MAX = 30;
const accountKey = (name) => String(name || '').trim().toLowerCase().slice(0, 80);
const OUTCOMES = new Set(['ok', 'fail', 'locked', 'blocked']);
const GUARDS = new Set(['unauth', 'rate', 'refused']);
const realTimers = { setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout };
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function create({ file, now = Date.now, timers = realTimers } = {}) {
  let data = { events: [], guards: {}, blocks: {}, strikes: {}, accounts: {}, seen: {}, counts: {} };
  try {
    const read = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(read?.events)) data.events = read.events.filter((e) => e && typeof e.ts === 'string' && typeof e.kind === 'string');
    if (read?.guards && typeof read.guards === 'object') data.guards = read.guards;
    if (read?.blocks && typeof read.blocks === 'object') data.blocks = read.blocks;
    if (read?.strikes && typeof read.strikes === 'object') data.strikes = read.strikes;
    if (read?.accounts && typeof read.accounts === 'object') data.accounts = read.accounts;
    if (read?.seen && typeof read.seen === 'object') data.seen = read.seen;
    if (read?.counts && typeof read.counts === 'object' && !Array.isArray(read.counts)) data.counts = read.counts;
  } catch (e) {
    // Unreadable: kept aside rather than written over, so its blocks can be recovered.
    if (e.code !== 'ENOENT') { try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch {} console.error('security log unreadable, starting empty:', e.message); }
  }
  for (const k of ['blocks', 'strikes', 'accounts', 'seen']) data[k] = Object.assign(Object.create(null), data[k]);
  // A file edited by hand must not make signing in throw: what has not the right
  // shape is dropped as it is read.
  const stamp = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  for (const [k, b] of Object.entries(data.blocks)) if (!b || typeof b !== 'object' || !stamp(b.until) || !stamp(b.at)) delete data.blocks[k];
  for (const [k, a] of Object.entries(data.accounts)) { if (!a || typeof a !== 'object' || !stamp(a.until) || !stamp(a.at)) delete data.accounts[k]; else if (!Number.isInteger(a.times) || a.times < 1) a.times = 1; }
  for (const [k, list] of Object.entries(data.strikes)) { if (!Array.isArray(list)) delete data.strikes[k]; else data.strikes[k] = list.filter(stamp); }
  for (const [k, groups] of Object.entries(data.seen)) { if (!groups || typeof groups !== 'object' || Array.isArray(groups)) delete data.seen[k]; else for (const [g, ts] of Object.entries(groups)) if (!stamp(ts)) delete groups[g]; }
  if (!data.guards || typeof data.guards !== 'object' || Array.isArray(data.guards)) data.guards = {};
  const failures = new Map(); // group → {count, resetAt}
  const accountFailures = new Map(); // account name → {count, resetAt}
  const codeFailures = new Map(); // account name → {count, resetAt}
  const codeDay = new Map(); // account name → {count, resetAt}: every wrong code of the day
  const flying = new Map(); // 'g:'+group or 'a:'+name → tries being checked now
  // The counts are kept in the file too: held in memory alone, every restart of the
  // service handed whoever was guessing a fresh round, the day's wrong codes included.
  // Restored within bounds, whatever the file says: a window no longer than its own
  // from now, and a count that still needs one more failure to tip (the day's wrong
  // codes may be at their full count). A clock that was ahead, or a file edited by
  // hand, must not shut an address or an account out for years.
  // Account names are kept as a hash: a name that is no account may be a password
  // typed in the wrong box, and the log keeps only three letters of those.
  // Keyed with the server's secret: a plain hash of a short string can be guessed
  // offline by whoever holds the file.
  const nameHash = (k) => require('node:crypto').createHmac('sha256', `${PRODUCT.securityLog.nameHashLabel}:${process.env.JWT_SECRET || ''}`).update(k).digest('hex').slice(0, 32);
  const kept = { failures: [failures, WINDOW_MS, MAX_FAILURES - 1], accountFailures: [null, ACCOUNT_WINDOW_MS, ACCOUNT_MAX_FAILURES - 1], codeFailures: [codeFailures, CODE_WINDOW_MS, CODE_MAX_FAILURES - 1], codeDay: [codeDay, CODE_WINDOW_MS, CODE_DAY_MAX] };
  const accountsByHash = new Map(); // restored account counts, until the name is seen again
  for (const [name, [map, windowMs, most]] of Object.entries(kept)) {
    const saved = data.counts[name];
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [k, v] of Object.entries(saved).slice(0, 5000)) {
      if (!v || !Number.isInteger(v.count) || v.count < 1 || !Number.isFinite(v.resetAt) || v.resetAt <= now()) continue;
      (map || accountsByHash).set(k, { count: Math.min(v.count, most), resetAt: Math.min(v.resetAt, now() + windowMs), ...(v.strange ? { strange: true } : {}) });
    }
  }
  // The count for an account name, taking up the one kept from before a restart.
  const accountCount = (k) => {
    let f = accountFailures.get(k);
    if (!f && accountsByHash.size) { const h = nameHash(k); f = accountsByHash.get(h); if (f) { accountsByHash.delete(h); accountFailures.set(k, f); } }
    return f;
  };
  let pending = null;
  const save = () => { if (pendingSlow) { timers.clearTimeout(pendingSlow); pendingSlow = null; } if (!pending) pending = timers.setTimeout(() => { pending = null; write(); }, WRITE_MS); };
  let pendingSlow = null;
  const saveSlow = () => { if (!pending && !pendingSlow) pendingSlow = timers.setTimeout(() => { pendingSlow = null; write(); }, GUARD_WRITE_MS); };
  function write() {
    const t = now(), cut = new Date(t - KEEP_DAYS * 86400_000).toISOString();
    data.events = data.events.filter((e) => e.ts >= cut);
    trim(EVENTS_MAX);
    for (const day of Object.keys(data.guards)) if (day < dayKey(Date.parse(cut))) delete data.guards[day];
    for (const [g, b] of Object.entries(data.blocks)) if (Date.parse(b.until) <= t) delete data.blocks[g];
    // Kept a day past its end, so one that comes again within a day is known as that.
    for (const [k, a] of Object.entries(data.accounts)) if (t - Date.parse(a.until) >= ACCOUNT_AGAIN_MS) delete data.accounts[k];
    for (const [id, groups] of Object.entries(data.seen)) { for (const [g, ts] of Object.entries(groups)) if (t - Date.parse(ts) >= KNOWN_DAYS * 86400_000) delete groups[g]; if (!Object.keys(groups).length) delete data.seen[id]; }
    const live = (entries) => Object.fromEntries(entries.filter(([, v]) => v.resetAt > t));
    data.counts = { failures: live([...failures]), codeFailures: live([...codeFailures]), codeDay: live([...codeDay]), accountFailures: live([...[...accountFailures].map(([k, v]) => [nameHash(k), v]), ...accountsByHash]) };
    for (const [g, list] of Object.entries(data.strikes)) { const kept = list.filter((x) => t - Date.parse(x) < STRIKE_DAYS * 86400_000); if (kept.length) data.strikes[g] = kept; else delete data.strikes[g]; }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(tmp, file);
    } catch (e) { console.error('security log:', e.message); }
  }
  const at = () => new Date(now()).toISOString();
  const groupOf = (ip) => ipGroup(String(ip || 'unknown'));
  // Failures and turned-away tries are what a flood makes: past the cap those go
  // first, so the sign-ins, QR events and blocks of 180 days are not washed out.
  const noisy = (e) => e.kind === 'login' && e.outcome !== 'ok';
  // Down to max: the oldest failures and turned-away tries go first, and only then
  // the oldest of the rest. One rule for both the write and a push: the write used
  // to cut the oldest of everything at the cap, before this could ever run, so a
  // flood of failures did wash the sign-ins out.
  function trim(max) {
    let drop = data.events.length - max;
    if (drop <= 0) return;
    data.events = data.events.filter((e) => !(drop > 0 && noisy(e) && drop--));
    if (data.events.length > max) data.events.splice(0, data.events.length - max);
  }
  function push(event) {
    data.events.push({ ts: at(), ...event });
    if (data.events.length > EVENTS_MAX + 500) trim(EVENTS_MAX);
    save();
  }
  // Written now, but not more than once a second: a flood of blocks must not stall
  // the server on the disk.
  let lastFlush = 0;
  function flushSoon() { if (now() - lastFlush >= 1000) { lastFlush = now(); flush(); } else save(); }

  // Where a request came from: Cloudflare's country (and city, when that is turned
  // on there), trusted only on a request Cloudflare forwarded (see clientIp.js).
  function where(req, trusted) {
    if (!trusted) return {};
    const country = text(req?.headers?.['cf-ipcountry'], 2).toUpperCase();
    // Letters, spaces and a little punctuation only: it is shown on the admin's page.
    const said = text(req?.headers?.['cf-ipcity'], 60);
    const city = /^[\p{L}\p{M} .'-]+$/u.test(said) ? said : '';
    return { ...(/^[A-Z]{2}$/.test(country) && country !== 'XX' ? { country } : {}), ...(city ? { city } : {}) };
  }

  function blockOf(ip) {
    const b = data.blocks[groupOf(ip)];
    return b && Date.parse(b.until) > now() ? { ...b } : null;
  }
  // A password sign-in tried. outcome: ok, fail (reason), locked (this failure
  // tipped the address over) or blocked (turned away without being checked).
  function login({ outcome, reason = '', username = '', userId = '', method = 'password', ip = '', ua = '', place = {} }) {
    if (!OUTCOMES.has(outcome)) return;
    const g = groupOf(ip);
    // Turned away again within a quarter of an hour: counted on the last one.
    if (outcome === 'blocked') {
      const last = data.events.findLast((e) => e.kind === 'login' && e.group === g);
      if (last?.outcome === 'blocked' && (last.reason || '') === text(reason, 40) && now() - Date.parse(last.lastTs || last.ts) < WINDOW_MS) { last.times = (last.times || 1) + 1; last.lastTs = at(); save(); return; }
    }
    // A refused passkey answer takes no password to send and is not counted against
    // the address: the same, so a stream of them is one line, not thousands.
    if (outcome === 'fail' && reason === 'passkey') {
      const last = data.events.findLast((e) => e.kind === 'login' && e.group === g);
      if (last?.outcome === 'fail' && last.reason === 'passkey' && now() - Date.parse(last.lastTs || last.ts) < WINDOW_MS) { last.times = (last.times || 1) + 1; last.lastTs = at(); save(); return; }
    }
    // A name that is no account may be a password typed in the wrong box: only its
    // first letters are kept.
    const name = text(username, 80);
    // The same for a try turned away unchecked: nobody looked whether it is a name.
    const shown = (reason === 'no-such-user' || outcome === 'blocked') && name.length > 3 ? `${name.slice(0, 3)}…` : name;
    push({ kind: 'login', outcome, reason: text(reason, 40), username: shown, ...(userId ? { userId: text(String(userId), 40) } : {}), method: text(method, 20), ip: text(ip, 64), group: g, ua: text(ua, 300), ...place });
  }
  // A failure from this address: counted, and on the tenth within the window a
  // strike and a block of the length the strikes call for. Returns the block made.
  // name, userId: the account that was tried, when there is one.
  function fail(ip, name = '', userId = '', { real = true } = {}) {
    const g = groupOf(ip), t = now();
    let f = failures.get(g);
    if (!f || t > f.resetAt) { f = { count: 0, resetAt: t + WINDOW_MS }; failures.set(g, f); }
    f.count += 1; saveSlow();
    // One failure in the window on an account this address is not known to makes the
    // whole window a stranger's. Judged on the last failure alone, someone with an
    // account of their own here could guess another's nine times and end on a wrong
    // password for their own, and never be shut for more than the hour.
    // real false: the name is no account (a slip of the owner's own fingers at home
    // must not turn the window into a stranger's).
    if (!f.strange && real && (accountKey(name) || userId) && !knownAddress(name, ip, userId)) f.strange = true;
    if (failures.size > 5000) for (const [k, v] of failures) if (t > v.resetAt) failures.delete(k);
    if (f.count < MAX_FAILURES) return null;
    failures.delete(g);
    const strikes = (data.strikes[g] || []).filter((x) => t - Date.parse(x) < STRIKE_DAYS * 86400_000);
    strikes.push(new Date(t).toISOString()); data.strikes[g] = strikes;
    // Bounded like the blocks: a flood of new addresses over days must not grow the file without end.
    const struck = Object.keys(data.strikes);
    if (struck.length > 5000) delete data.strikes[struck.filter((x) => x !== g).sort((a, b) => String(data.strikes[a].at(-1)).localeCompare(String(data.strikes[b].at(-1))))[0]];
    // An address the account has signed in from lately (a shared network, a home)
    // is never shut for more than the first step: someone else there must not lock
    // the owner out for a week.
    // A session used from here counts too: a session lasts for months without a new
    // sign-in, so the sign-in events alone forget the owner's own network.
    // Known to the account that was tried, not to any account: someone who can sign
    // in to their own account from here and guesses another's would otherwise never
    // be shut for more than the hour. With no
    // account named (a try that names none), any account's use of the address counts.
    const known = f.strange ? false : accountKey(name) || userId ? knownAddress(name, ip, userId)
      : Object.values(data.seen).some((groups) => groups[g] && t - Date.parse(groups[g]) < KNOWN_DAYS * 86400_000)
      || data.events.some((e) => e.group === g && t - Date.parse(e.ts) < 30 * 86400_000 && ((e.kind === 'login' && e.outcome === 'ok') || (e.kind === 'qr' && e.action === 'signed-in')));
    // A block an admin made by hand is not replaced or cut short by this one.
    const byHand = data.blocks[g];
    if (byHand && byHand.auto === false && Date.parse(byHand.until) > t + (known ? STEPS_MS[0] : STEPS_MS[Math.min(strikes.length, STEPS_MS.length) - 1])) { flushSoon(); return { ...byHand }; }
    const ms = known ? STEPS_MS[0] : STEPS_MS[Math.min(strikes.length, STEPS_MS.length) - 1];
    // What an admin set by hand is a floor under every block that follows it: a
    // longer automatic one takes its place, and a later one for a known address must
    // not then cut the admin's time short.
    const hand = Math.max(byHand?.auto === false ? Date.parse(byHand.until) : 0, Date.parse(byHand?.handUntil || 0) || 0);
    const until = Math.max(known ? t + ms : Math.max(t + ms, Date.parse(data.blocks[g]?.until || 0) || 0), hand > t ? hand : 0);
    // Full: the automatic block that ends soonest makes room; one made by hand goes
    // only when there is no other.
    const live = Object.keys(data.blocks).filter((x) => x !== g);
    if (live.length >= 5000) { const soonest = (list) => list.sort((a, b) => data.blocks[a].until.localeCompare(data.blocks[b].until))[0]; const autos = live.filter((x) => data.blocks[x].auto !== false); delete data.blocks[soonest(autos.length ? autos : live)]; }
    data.blocks[g] = { group: g, until: new Date(until).toISOString(), at: new Date(t).toISOString(), auto: true, strikes: strikes.length, reason: `${MAX_FAILURES} failures in 15 minutes`, ...(hand > t ? { handUntil: new Date(hand).toISOString() } : {}) };
    // A block is written at once: a restart must not lift it.
    flushSoon();
    return { ...data.blocks[g] };
  }
  // A success no longer clears the address's failures: an account holder could
  // otherwise fail nine times, sign in, and go on guessing another's password. The count still lapses after 15 minutes.
  const succeeded = () => {};

  // A failure on this account name, whatever address it came from. Returns the
  // protection made by the twentieth within the hour.
  function accountFail(name) {
    const k = accountKey(name), t = now();
    if (!k) return null;
    let f = accountCount(k);
    if (!f || t > f.resetAt) { f = { count: 0, resetAt: t + ACCOUNT_WINDOW_MS }; accountFailures.set(k, f); }
    f.count += 1; saveSlow();
    // Full of made-up names: the lapsed go, then the ones tried least, so a flood of
    // names does not wash out the count of the one being guessed.
    if (accountFailures.size > 5000) {
      for (const [n, v] of accountFailures) if (t > v.resetAt) accountFailures.delete(n);
      if (accountFailures.size > 5000) for (const n of [...accountFailures].sort((a, b) => a[1].count - b[1].count).slice(0, 500).map((x) => x[0])) if (n !== k) accountFailures.delete(n);
    }
    if (f.count < ACCOUNT_MAX_FAILURES) return null;
    accountFailures.delete(k);
    return protect(k, t);
  }
  // A wrong two-step code for this account: the tenth within a day protects it.
  function codeFail(name) {
    const k = accountKey(name), t = now();
    if (!k) return null;
    let d = codeDay.get(k);
    if (!d || t > d.resetAt) { d = { count: 0, resetAt: t + CODE_WINDOW_MS }; codeDay.set(k, d); }
    d.count += 1; saveSlow();
    if (codeDay.size > 5000) for (const [n, v] of codeDay) if (t > v.resetAt) codeDay.delete(n);
    let f = codeFailures.get(k);
    if (!f || t > f.resetAt) { f = { count: 0, resetAt: t + CODE_WINDOW_MS }; codeFailures.set(k, f); }
    f.count += 1;
    if (codeFailures.size > 5000) for (const [n, v] of codeFailures) if (t > v.resetAt) codeFailures.delete(n);
    if (f.count < CODE_MAX_FAILURES) return null;
    codeFailures.delete(k);
    return protect(k, t, true);
  }
  // Again within a day of the last one ending is a day, and stays a day for as
  // long as it keeps coming.
  // codes: made by wrong two-step codes, which only someone holding the password makes.
  function protect(k, t, codes = false) {
    const before = data.accounts[k];
    const times = before && t - Date.parse(before.until) < ACCOUNT_AGAIN_MS ? (before.times || 1) + 1 : 1;
    const live = Object.keys(data.accounts);
    if (live.length >= 5000 && !before) delete data.accounts[live.sort((a, b) => data.accounts[a].until.localeCompare(data.accounts[b].until))[0]];
    data.accounts[k] = { name: k, at: new Date(t).toISOString(), until: new Date(t + ACCOUNT_STEPS_MS[Math.min(times, ACCOUNT_STEPS_MS.length) - 1]).toISOString(), times, ...(codes || (before?.codes && Date.parse(before.until) > t) ? { codes: true } : {}) };
    push({ kind: 'account', action: 'protect', name: k, until: data.accounts[k].until });
    flushSoon();
    return { ...data.accounts[k] };
  }
  // A signed-in session of this account was used from this address. A session lasts
  // for months without signing in again, so this, not only the sign-in, is what
  // keeps the owner's own networks known.
  function seen(userId, ip) {
    const id = String(userId || ''), g = groupOf(ip), t = now();
    if (!id || g === 'unknown') return;
    const mine = data.seen[id] ||= {};
    if (mine[g] && t - Date.parse(mine[g]) < SEEN_WRITE_MS) return;
    mine[g] = new Date(t).toISOString();
    const all = Object.keys(mine);
    if (all.length > SEEN_MAX) delete mine[all.sort((a, b) => mine[a].localeCompare(mine[b]))[0]];
    save();
  }
  // A try about to be checked. The counts above move only once a check has failed,
  // so tries sent all at once would each find room; the ones being checked now are
  // counted too, and one that finds none is turned away.
  // Returns what to call when the check is over, or null.
  function hold(ip, name = '') {
    const g = `g:${groupOf(ip)}`, k = accountKey(name), a = k ? `a:${k}` : '', t = now();
    const used = (f) => (f && t <= f.resetAt ? f.count : 0);
    if (used(failures.get(g.slice(2))) + (flying.get(g) || 0) >= MAX_FAILURES) return null;
    if (a && used(accountCount(k)) + (flying.get(a) || 0) >= ACCOUNT_MAX_FAILURES) return null;
    const keys = a ? [g, a] : [g];
    for (const x of keys) flying.set(x, (flying.get(x) || 0) + 1);
    let over = false;
    return () => { if (over) return; over = true; for (const x of keys) { const n = (flying.get(x) || 1) - 1; if (n > 0) flying.set(x, n); else flying.delete(x); } };
  }
  // Has this account signed in from this address lately, by password or by QR, or
  // used a session from it?
  function knownAddress(name, ip, userId) {
    const k = accountKey(name), g = groupOf(ip), t = now(), id = userId ? String(userId) : '';
    const last = id && data.seen[id]?.[g];
    if (last && t - Date.parse(last) < KNOWN_DAYS * 86400_000) return true;
    return data.events.some((e) => e.group === g && t - Date.parse(e.ts) < KNOWN_DAYS * 86400_000
      && ((e.kind === 'login' && e.outcome === 'ok' && (id && e.userId ? e.userId === id : accountKey(e.username) === k)) || (id && e.kind === 'qr' && e.action === 'signed-in' && e.userId === id)));
  }
  // The protection that turns this address away from this account, if any.
  function accountGuard(name, ip, userId) {
    const a = data.accounts[accountKey(name)];
    if (!a || Date.parse(a.until) <= now() || knownAddress(name, ip, userId)) return null;
    return { ...a };
  }
  // Has this account had its day's wrong codes? Then none is looked at, wherever from:
  // an address that holds a session is 'known' and so is not turned away by the
  // account's protection, and would otherwise go on guessing.
  const codeSpent = (name) => { const d = codeDay.get(accountKey(name)); return Boolean(d && now() <= d.resetAt && d.count >= CODE_DAY_MAX); };
  // Protected now because codes were being guessed: only then are the account's
  // two-step settings frozen. Protection from plain wrong passwords, which anyone who
  // knows the name can cause, must not stop the owner changing them.
  const codesGuessed = (name) => { const a = data.accounts[accountKey(name)]; return Boolean(a && a.codes && Date.parse(a.until) > now()); };
  // Protected now, whatever the address: no two-step setting is changed meanwhile.
  const accountProtected = (name) => { const a = data.accounts[accountKey(name)]; return Boolean(a && Date.parse(a.until) > now()); };
  // An account disabled or deleted: the addresses its sessions were used from, its
  // protection and its counts go with it. Its sign-in events stay in the log; they carry its id, so an
  // account made later under the same name is not known by them.
  // keepDay: the day's wrong codes stay counted (an account only switched off).
  function forgetUser(userId, name = '', { keepDay = false } = {}) {
    const id = String(userId || ''), k = accountKey(name);
    let changed = false;
    if (id && Object.hasOwn(data.seen, id)) { delete data.seen[id]; changed = true; }
    if (k) { if (Object.hasOwn(data.accounts, k)) { delete data.accounts[k]; changed = true; } if (accountCount(k)) changed = true; for (const map of keepDay ? [accountFailures, codeFailures] : [accountFailures, codeFailures, codeDay]) if (map.delete(k)) changed = true; }
    if (changed) flush();
    return changed;
  }
  // An account given another name: its protection and its counts go with it, so a
  // rename is no way round them. Where the account had a count, what the new name
  // had gathered of its own (guesses at a name nobody had yet) gives way to it.
  function renamed(from, to) {
    const a = accountKey(from), b = accountKey(to);
    if (!a || !b || a === b) return false;
    let changed = false;
    if (Object.hasOwn(data.accounts, a)) { data.accounts[b] = { ...data.accounts[a], name: b }; delete data.accounts[a]; changed = true; }
    accountCount(a); accountCount(b);
    for (const map of [accountFailures, codeFailures, codeDay]) if (map.has(a)) { map.set(b, map.get(a)); map.delete(a); changed = true; }
    if (changed) flush();
    return changed;
  }
  // keepDay: the day's wrong codes stay counted (a release asked for over the web).
  function accountRelease(name, by, { keepDay = false } = {}) {
    const k = accountKey(name);
    if (!Object.hasOwn(data.accounts, k)) {
      // No protection to lift, but the machine's rescue still clears the counts: they
      // are kept across restarts now, and the day's wrong codes may be what shuts
      // the owner out after a release over the web.
      if (keepDay || !k) return false;
      let had = Boolean(accountCount(k));
      for (const map of [accountFailures, codeFailures, codeDay]) if (map.delete(k)) had = true;
      if (had) flush();
      return had;
    }
    accountCount(k);
    delete data.accounts[k]; accountFailures.delete(k); codeFailures.delete(k); if (!keepDay) codeDay.delete(k);
    push({ kind: 'account', action: 'release', name: k, by: text(by, 80) });
    flush();
    return true;
  }

  // What an admin typed, as the group it blocks: an address (its /64 for IPv6), or a
  // /64 written as its first four groups, with or without "::" or "/64". Spaces and
  // letter case and leading zeros do not make another group: 2001:0DB8:0000:0001
  // blocks 2001:db8:0:1::5.
  function handGroup(ip) {
    const raw = String(ip || '').trim().toLowerCase().replace(/\/64$/, '');
    const full = normalizeIp(raw);
    if (full) return groupOf(full);
    const four = raw.replace(/::$/, '');
    return /^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3}$/.test(four) ? ipGroup(`${four}::`) : null;
  }
  function block(ip, hours, by) {
    const g = handGroup(ip), h = Number(hours);
    if (!g || g === 'unknown' || !Number.isFinite(h) || h < 1 || h > HAND_MAX_HOURS) throw Object.assign(new Error('Invalid block'), { status: 400 });
    data.blocks[g] = { group: g, until: new Date(now() + h * 3600_000).toISOString(), at: at(), auto: false, by: text(by, 80), reason: 'by an admin' };
    push({ kind: 'block', action: 'block', group: g, hours: h, by: text(by, 80) });
    flush();
    return { ...data.blocks[g] };
  }
  function unblock(group, by) {
    const g = String(group || '');
    if (!Object.hasOwn(data.blocks, g)) return false;
    delete data.blocks[g]; delete data.strikes[g]; failures.delete(g);
    push({ kind: 'block', action: 'unblock', group: g, by: text(by, 80) });
    flush();
    return true;
  }
  // QR sign-in events (bind, unbind, approve, deny, wrong-code, signed-in).
  function qr({ action, userId = '', deviceId = '', ip = '', place = {} }) {
    push({ kind: 'qr', action: text(action, 20), userId: text(String(userId), 40), deviceId: text(String(deviceId), 40), ...(ip ? { ip: text(ip, 64), group: groupOf(ip) } : {}), ...place });
  }
  // Two-step sign-in turned on, off, or reset by an admin or from the machine.
  function twoStep({ action, userId = '', by = '', ip = '', place = {} }) {
    push({ kind: 'two-step', action: text(action, 20), userId: text(String(userId), 40), ...(by ? { by: text(by, 80) } : {}), ...(ip ? { ip: text(ip, 64), group: groupOf(ip) } : {}), ...place });
  }
  // A passkey added to or removed from an account.
  function passkey({ action, userId = '', ip = '', place = {} }) {
    push({ kind: 'passkey', action: text(action, 20), userId: text(String(userId), 40), ...(ip ? { ip: text(ip, 64), group: groupOf(ip) } : {}), ...place });
  }
  // A request turned away by a guard: counted a day, not kept one by one.
  function guard(kind) {
    if (!GUARDS.has(kind)) return;
    const day = dayKey(now()), g = data.guards[day] ||= {};
    // Counted now, written within a minute: every 401, 429 and 403 comes through
    // here, and a write is the whole file.
    g[kind] = (g[kind] || 0) + 1; saveSlow();
  }

  // For the admin's page.
  function view({ days = 7, filter = 'all', limit = 100 } = {}) {
    const t = now(), out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const from = d.getTime(), to = from + 86400_000;
      const c = { ok: 0, fail: 0, locked: 0, blocked: 0 };
      for (const e of data.events) if (e.kind === 'login') { const x = Date.parse(e.ts); if (x >= from && x < to) c[e.outcome] += e.times || 1; }
      for (const e of data.events) if (e.kind === 'qr' && e.action === 'signed-in') { const x = Date.parse(e.ts); if (x >= from && x < to) c.ok += 1; }
      const key = dayKey(from);
      out.push({ date: key, ...c, guards: { unauth: 0, rate: 0, refused: 0, ...(data.guards[key] || {}) } });
    }
    const pick = { all: () => true, fail: (e) => e.kind === 'login' && e.outcome !== 'ok', qr: (e) => e.kind === 'qr', block: (e) => e.kind === 'block' || e.kind === 'account' || (e.kind === 'login' && (e.outcome === 'locked' || e.outcome === 'blocked')) }[filter] || (() => true);
    const recent = data.events.filter(pick).slice(-Math.min(500, Math.max(1, limit))).reverse();
    const blocks = Object.values(data.blocks).filter((b) => Date.parse(b.until) > t).sort((a, b) => b.at.localeCompare(a.at));
    const accounts = Object.values(data.accounts).filter((a) => Date.parse(a.until) > t).sort((a, b) => b.at.localeCompare(a.at));
    return { days: out, sources: sources(), blocks, accounts, recent, rules: { windowMinutes: WINDOW_MS / 60_000, maxFailures: MAX_FAILURES, steps: STEPS_MS.map((ms) => ms / 3600_000) } };
  }
  // Addresses with failures, most first; one that has also signed in is marked.
  function sources(limit = 20) {
    const by = new Map();
    for (const e of data.events) {
      if (e.kind !== 'login' || !e.group) continue;
      const s = by.get(e.group) || { group: e.group, fails: 0, ok: 0, usernames: new Set(), last: '', country: '', city: '' };
      if (e.outcome === 'ok') s.ok += 1; else s.fails += e.times || 1;
      if (e.outcome !== 'ok' && e.username) s.usernames.add(e.username);
      s.last = e.ts; if (e.country) s.country = e.country; if (e.city) s.city = e.city;
      by.set(e.group, s);
    }
    for (const e of data.events) if (e.kind === 'qr' && e.action === 'signed-in' && e.group && by.has(e.group)) by.get(e.group).ok += 1;
    return [...by.values()].filter((s) => s.fails).sort((a, b) => b.fails - a.fails || b.last.localeCompare(a.last)).slice(0, limit)
      .map((s) => ({ ...s, usernames: [...s.usernames].slice(0, 10), known: s.ok > 0, blocked: blockOf(s.group) }));
  }
  // One address: its attempts, what they look like, and its block.
  function source(group) {
    const g = String(group || '');
    const events = data.events.filter((e) => e.group === g);
    const logins = events.filter((e) => e.kind === 'login');
    const fails = logins.filter((e) => e.outcome !== 'ok');
    const signs = [];
    // Many tries close together: a program, not a person mistyping.
    for (let i = 0; i + 9 < fails.length; i++) {
      const span = Date.parse(fails[i + 9].ts) - Date.parse(fails[i].ts);
      if (span < 5 * 60_000) { signs.push({ sign: 'burst', level: 'high', minutes: Math.max(1, Math.round(span / 60_000)) }); break; }
    }
    const names = [...new Set(fails.map((e) => e.username).filter(Boolean))];
    const unknown = [...new Set(fails.filter((e) => e.reason === 'no-such-user').map((e) => e.username).filter(Boolean))];
    if (unknown.length) signs.push({ sign: 'guessing', level: 'medium', usernames: unknown.slice(0, 10) });
    const country = logins.map((e) => e.country).filter(Boolean).at(-1);
    if (country && !data.events.some((e) => e.country === country && ((e.kind === 'login' && e.outcome === 'ok') || (e.kind === 'qr' && e.action === 'signed-in')))) signs.push({ sign: 'new-country', level: 'medium', country });
    return {
      group: g, country: country || '', city: logins.map((e) => e.city).filter(Boolean).at(-1) || '',
      fails: fails.length, ok: logins.filter((e) => e.outcome === 'ok').length + events.filter((e) => e.kind === 'qr' && e.action === 'signed-in').length,
      usernames: names.slice(0, 20), signs, blocked: blockOf(g), strikes: (data.strikes[g] || []).length,
      events: events.slice(-100).reverse(),
    };
  }
  function flush() { if (pending) { timers.clearTimeout(pending); pending = null; } if (pendingSlow) { timers.clearTimeout(pendingSlow); pendingSlow = null; } write(); }
  const unsaved = () => Boolean(pending || pendingSlow);
  return { where, blockOf, login, fail, succeeded, hold, seen, accountFail, codeFail, codeSpent, codesGuessed, unsaved, accountGuard, forgetUser, renamed, accountProtected, accountRelease, block, unblock, qr, twoStep, passkey, guard, view, source, flush, groupOf };
}

// Only the service names the data folder it is kept in (scripts/start.mjs sets the setting
// dirEnv names); any other process keeps its own in a new temporary folder, as audit.js does,
// never the live one. mkdtemp makes it with an unguessable name and only this account's
// access, so no other user can make it first. The setting, the file and the folder's prefix
// are the product's (siteConfig.js).
const stateRoot = process.env[PRODUCT.securityLog.dirEnv]
  || fs.mkdtempSync(path.join(require('node:os').tmpdir(), `${PRODUCT.tempPrefix}-security-`));
const security = create({ file: path.join(stateRoot, PRODUCT.securityLog.file) });
// What the last two seconds (or the last minute of guard counts) left unwritten is
// written as the process goes: a restart must not lose a block just made.
process.on('exit', () => { try { if (security.unsaved()) security.flush(); } catch {} });
module.exports = { create, security, accountKey, KEEP_DAYS, MAX_FAILURES, STEPS_MS, ACCOUNT_MAX_FAILURES, ACCOUNT_STEPS_MS };

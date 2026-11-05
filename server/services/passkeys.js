// Passkeys (WebAuthn): a device keeps a private
// key behind its fingerprint, face or PIN, and the server only the public one. To
// sign in, the server sets a random challenge, the device signs it once its owner
// is verified, and the signature is checked here. Nothing kept on the server signs
// anyone in, and the browser ties the key to this site's own name.
//
// No attestation is asked for (which maker's device it is does not matter here),
// so the public key is taken as the browser hands it over, in the standard form
// node reads, and only the fixed-layout part of the authenticator's data is parsed.
// Whoever registers a key is signed in and has given the password (again, or moments
// ago at sign-in): a false key would only be one of their own.
const crypto = require('node:crypto');

const CHALLENGE_MS = 5 * 60_000, MAX_CHALLENGES = 5000, MAX_PER_GROUP = 5, MAX_PASSKEYS = 10;
const ALGS = { '-7': 'ES256', '-257': 'RS256' };
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const B64U = /^[A-Za-z0-9_-]+$/;
const bytes = (text, max) => (typeof text === 'string' && text.length <= max && B64U.test(text) ? Buffer.from(text, 'base64url') : null);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
const refuse = (reason) => { throw Object.assign(new Error('Passkey not accepted'), { status: 400, reason }); };

// Challenges: each for one purpose (and, to add a key, one account), used once.
// Those for adding a key are one an account, and kept apart from those a login page
// asks for with no session, of which one address group holds five: asking for many
// pushes out only the asker's own, not everyone's.
function createChallenges({ now = Date.now } = {}) {
  const live = new Map();
  // note: kept with the challenge and handed back when it is taken.
  function issue(purpose, userId = '', group = '', note = '') {
    // A challenge for one account to confirm an action is that account's own: a login
    // page asking from the same addresses does not push it out.
    const t = now(), owner = purpose === 'create' ? `u:${userId}` : userId ? `a:${userId}` : `g:${group}`;
    for (const [k, v] of live) if (v.expiresAt <= t) live.delete(k);
    const mine = [...live].filter(([, v]) => v.owner === owner);
    while (mine.length >= (purpose === 'create' ? 1 : MAX_PER_GROUP)) live.delete(mine.shift()[0]);
    if (live.size >= MAX_CHALLENGES) { const old = [...live].find(([, v]) => v.purpose !== 'create'); live.delete((old || live.entries().next().value)[0]); }
    const challenge = b64u(crypto.randomBytes(32));
    live.set(challenge, { purpose, userId: String(userId), owner, note, expiresAt: t + CHALLENGE_MS });
    return challenge;
  }
  // Taken whatever comes of it: a challenge answers one attempt.
  function take(challenge, purpose, userId = '') {
    const v = typeof challenge === 'string' ? live.get(challenge) : null;
    if (!v) return false;
    live.delete(challenge);
    return v.expiresAt > now() && v.purpose === purpose && v.userId === String(userId) ? (v.note || true) : false;
  }
  // A waiting challenge to add a key is dropped when how the account signs in changes.
  function revokeUser(userId) { for (const [k, v] of live) if (v.owner === `u:${userId}`) live.delete(k); }
  return { issue, take, revokeUser, _size: () => live.size };
}

// What the browser says it did: the kind of ceremony, the challenge it answered and
// the page that asked. The page must be one of the origins passkeys are for (the
// site's public address only: requestGuards.isPasskeyOrigin).
function readClient(clientDataJSON, type, isAllowedOrigin) {
  const raw = bytes(clientDataJSON, 4000) || refuse('client data');
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch { refuse('client data'); }
  if (!data || data.type !== type) refuse('type');
  if (data.crossOrigin || data.topOrigin !== undefined) refuse('cross-origin');
  if (typeof data.origin !== 'string' || !isAllowedOrigin(data.origin)) refuse('origin');
  let host;
  try { host = new URL(data.origin).hostname; } catch { refuse('origin'); }
  return { raw, challenge: data.challenge, origin: data.origin, rpId: host };
}
// The authenticator's data: which site it was for, that its owner was there and
// was verified (fingerprint, face or PIN), its counter, and on registration the
// new key's id.
function readAuthenticator(authenticatorData, rpId, { attested = false } = {}) {
  const data = bytes(authenticatorData, 4000);
  if (!data || data.length < 37) refuse('authenticator data');
  if (!crypto.timingSafeEqual(data.subarray(0, 32), sha256(rpId))) refuse('site');
  const flags = data[32];
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) refuse('not verified');
  const out = { raw: data, signCount: data.readUInt32BE(33) };
  if (attested) {
    if (!(flags & FLAG_AT) || data.length < 55) refuse('no key');
    const n = data.readUInt16BE(53);
    if (n < 1 || n > 1023 || data.length < 55 + n) refuse('key id');
    out.credentialId = b64u(data.subarray(55, 55 + n));
  }
  return out;
}
function readKey(publicKey, alg) {
  const name = Object.hasOwn(ALGS, String(alg)) ? ALGS[String(alg)] : null;
  const der = bytes(publicKey, 2000);
  if (!name || !der) refuse('key');
  let key;
  try { key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { refuse('key'); }
  const type = key.asymmetricKeyType, d = key.asymmetricKeyDetails || {};
  if (name === 'ES256' ? !(type === 'ec' && d.namedCurve === 'prime256v1') : !(type === 'rsa' && d.modulusLength >= 2048 && d.publicExponent === 65537n)) refuse('key kind');
  return { key, publicKey: b64u(der), alg: Number(alg) };
}

// A new passkey from a signed-in account: what to keep of it.
function register({ id, clientDataJSON, authenticatorData, publicKey, alg }, { challenges, userId, isAllowedOrigin }) {
  const client = readClient(clientDataJSON, 'webauthn.create', isAllowedOrigin);
  const note = challenges.take(client.challenge, 'create', userId);
  if (!note) refuse('challenge');
  const auth = readAuthenticator(authenticatorData, client.rpId, { attested: true });
  if (typeof id !== 'string' || id !== auth.credentialId) refuse('key id');
  const key = readKey(publicKey, alg);
  return { note, made: { credentialId: auth.credentialId, publicKey: key.publicKey, alg: key.alg, signCount: auth.signCount, rpId: client.rpId } };
}
// A sign-in answer: its challenge is taken first, whichever key it names, so the
// answer does not tell whether a key is known here.
// userId: a challenge issued for one account only (an admin confirming an action).
function answer({ clientDataJSON }, { challenges, isAllowedOrigin, userId = '' }) {
  const client = readClient(clientDataJSON, 'webauthn.get', isAllowedOrigin);
  if (!challenges.take(client.challenge, 'get', userId)) refuse('challenge');
  return client;
}
// That answer's signature from a kept passkey: the counter to keep, or it throws.
function assert(client, { authenticatorData, signature }, passkey) {
  if (!passkey) refuse('unknown key');
  if (client.rpId !== passkey.rpId) refuse('site');
  const auth = readAuthenticator(authenticatorData, client.rpId);
  const sig = bytes(signature, 2000) || refuse('signature');
  const { key } = readKey(passkey.publicKey, passkey.alg);
  const signed = Buffer.concat([auth.raw, sha256(client.raw)]);
  let ok = false;
  try { ok = crypto.verify('sha256', signed, passkey.alg === -7 ? { key, dsaEncoding: 'der' } : key, sig); } catch {}
  if (!ok) refuse('signature');
  // A counter that goes backwards is a copy of the key in use. Keys that sync
  // between a person's devices always say zero, and that is left alone.
  if ((auth.signCount || passkey.signCount) && auth.signCount <= passkey.signCount) refuse('counter');
  return { signCount: auth.signCount };
}

function createStore(db) {
  db.ensureIndex({ fieldName: 'credentialId', unique: true }, (e) => { if (e) console.error('passkeys index:', e.message); });
  const call = (method, ...args) => new Promise((ok, no) => db[method](...args, (e, r) => (e ? no(e) : ok(r))));
  const shown = (d) => ({ id: d._id, name: d.name, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt });
  async function add(userId, name, made) {
    if ((await call('find', { userId: String(userId) })).length >= MAX_PASSKEYS) throw Object.assign(new Error('Too many passkeys; remove one first'), { status: 409 });
    // One key, one row, whoever's: the index refuses a second (and says no more than that).
    return shown(await call('insert', { userId: String(userId), name: String(name || '').trim().slice(0, 40) || 'Passkey', ...made, createdAt: new Date().toISOString(), lastUsedAt: null }).catch((e) => { if (e.errorType === 'uniqueViolated') refuse('known key'); throw e; }));
  }
  const byCredential = (credentialId) => (typeof credentialId === 'string' && credentialId.length <= 1400 && B64U.test(credentialId) ? call('findOne', { credentialId }) : Promise.resolve(null));
  // The counter moves only forwards: of two uses of one signature's count, one writes.
  const used = async (doc, signCount) => (await call('update', { _id: doc._id, signCount: doc.signCount }, { $set: { signCount, lastUsedAt: new Date().toISOString() } }, {})) > 0;
  const list = async (userId) => (await call('find', { userId: String(userId) })).map(shown).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = async (userId, keep = () => true) => (await call('find', { userId: String(userId) })).filter(keep).map((d) => d.credentialId);
  const remove = async (userId, id) => (await call('remove', { _id: String(id), userId: String(userId) }, {})) > 0;
  const removeAll = (userId) => call('remove', { userId: String(userId) }, { multi: true });
  return { add, byCredential, used, list, ids, remove, removeAll };
}

// Whether a kept key may stand for an admin's password and code: added with the
// password, and with the code when the account has two-step now. Keys from before
// this was recorded are not (the admin adds one again in Settings).
const confirmsAdmin = (doc, user) => doc?.addedWith === 'password' && (!user?.twoStep || doc.withCode === true);

module.exports = { confirmsAdmin, createChallenges, createStore, register, answer, assert, b64u, ALGS, CHALLENGE_MS, MAX_PASSKEYS };

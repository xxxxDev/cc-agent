const crypto = require('node:crypto');
const { PRODUCT } = require('../siteConfig');

const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PUSH_KEYS = new Set(['endpoint', 'expirationTime', 'keys']);
const ENCRYPTION_AAD = Buffer.from(PRODUCT.pushEncryptionLabel);
const DEFAULT_KEY_ID = 'k0';

function pushError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireSecret(value, label) {
  if (typeof value !== 'string' || value.trim().length < 32) {
    throw pushError('PUSH_NOT_CONFIGURED', `${label} is not configured`, 503);
  }
  return value.trim();
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// A key id defaults to 'k0' so a store with no explicit id is byte-identical to
// the pre-rotation deployment (its rows are implicitly 'k0').
function resolveKeyId(value) {
  const id = trimmed(value);
  return id || DEFAULT_KEY_ID;
}

// A previous secret is optional. Present-but-blank counts as absent; present but
// too short is a configuration error rather than a silent downgrade.
function optionalSecret(value, label) {
  if (value === undefined || value === null) return null;
  const raw = trimmed(value);
  if (!raw) return null;
  if (raw.length < 32) {
    throw pushError('PUSH_KEY_CONFIG_INVALID', `${label} is invalid`, 503);
  }
  return raw;
}

function toEncryptionKeyBuffer(raw) {
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (decoded.length === 32) return decoded;
  }
  return crypto.createHash('sha256').update(raw).digest();
}

// Resolve a { current, previous } key set. `current` is required exactly as
// today; `previous` is optional. A previous key sharing the current key's id is
// a fail-closed configuration error (503): the same id must never name two
// different key materials, or dual-read/decrypt-by-id becomes ambiguous.
function resolveKeySet(env, {
  currentSecretVar, currentIdVar, previousSecretVar, previousIdVar, label, materialize,
}) {
  const current = {
    id: resolveKeyId(env[currentIdVar]),
    key: materialize(requireSecret(env[currentSecretVar], label)),
  };
  const previousRaw = optionalSecret(env[previousSecretVar], `${label} (previous)`);
  let previous = null;
  if (previousRaw) {
    const previousId = resolveKeyId(env[previousIdVar]);
    if (previousId === current.id) {
      throw pushError(
        'PUSH_KEY_CONFIG_INVALID',
        `${label} previous key id must differ from the current key id`,
        503,
      );
    }
    previous = { id: previousId, key: materialize(previousRaw) };
  }
  return { current, previous };
}

function encryptionKeySet(env = process.env) {
  return resolveKeySet(env, {
    currentSecretVar: 'PUSH_SUBSCRIPTION_ENCRYPTION_KEY',
    currentIdVar: 'PUSH_SUBSCRIPTION_ENCRYPTION_KEY_ID',
    previousSecretVar: 'PUSH_SUBSCRIPTION_ENCRYPTION_KEY_PREVIOUS',
    previousIdVar: 'PUSH_SUBSCRIPTION_ENCRYPTION_KEY_PREVIOUS_ID',
    label: 'push encryption key',
    materialize: toEncryptionKeyBuffer,
  });
}

function hmacKeySet(env = process.env) {
  return resolveKeySet(env, {
    currentSecretVar: 'PUSH_SUBSCRIPTION_HMAC_KEY',
    currentIdVar: 'PUSH_SUBSCRIPTION_HMAC_KEY_ID',
    previousSecretVar: 'PUSH_SUBSCRIPTION_HMAC_KEY_PREVIOUS',
    previousIdVar: 'PUSH_SUBSCRIPTION_HMAC_KEY_PREVIOUS_ID',
    label: 'push HMAC key',
    // Preserve the pre-rotation fingerprint: the HMAC key is the raw secret's
    // UTF-8 bytes, never a hash. Existing fingerprints must keep matching.
    materialize: (raw) => Buffer.from(raw),
  });
}

// Current key ids used to stamp new rows. Only the id is needed here, so this
// never requires the actual VAPID/HMAC material to be present.
function currentHmacKeyId(env = process.env) {
  return resolveKeyId(env.PUSH_SUBSCRIPTION_HMAC_KEY_ID);
}

function currentEncryptionKeyId(env = process.env) {
  return resolveKeyId(env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY_ID);
}

function currentVapidKeyId(env = process.env) {
  return resolveKeyId(env.VAPID_KEY_ID);
}

function vapidKeySet(env = process.env) {
  const currentId = resolveKeyId(env.VAPID_KEY_ID);
  const current = {
    id: currentId,
    publicKey: trimmed(env.VAPID_PUBLIC_KEY),
    privateKey: trimmed(env.VAPID_PRIVATE_KEY),
  };
  const prevPublic = trimmed(env.VAPID_PUBLIC_KEY_PREVIOUS);
  const prevPrivate = trimmed(env.VAPID_PRIVATE_KEY_PREVIOUS);
  const prevIdSet = trimmed(env.VAPID_KEY_ID_PREVIOUS);
  let previous = null;
  if (prevPublic || prevPrivate || prevIdSet) {
    if (!prevPublic || !prevPrivate) {
      throw pushError(
        'PUSH_KEY_CONFIG_INVALID',
        'previous VAPID key requires both a public and a private key',
        503,
      );
    }
    const previousId = resolveKeyId(env.VAPID_KEY_ID_PREVIOUS);
    if (previousId === currentId) {
      throw pushError(
        'PUSH_KEY_CONFIG_INVALID',
        'previous VAPID key id must differ from the current key id',
        503,
      );
    }
    previous = { id: previousId, publicKey: prevPublic, privateKey: prevPrivate };
  }
  return { current, previous };
}

// Just the VAPID key ids (no secret material required). Throws the same
// fail-closed configuration error as vapidKeySet on an id collision.
function vapidKeyIds(env = process.env) {
  const set = vapidKeySet(env);
  return { current: set.current.id, previous: set.previous ? set.previous.id : null };
}

// Select the VAPID keypair a row's stored keyId names. A row whose keyId matches
// neither current nor previous fails closed (PUSH_VAPID_KEY_UNAVAILABLE, 503) so
// a device is never messaged with the wrong key.
function selectVapidDetails(vapidKeyId, env = process.env) {
  const set = vapidKeySet(env);
  const id = trimmed(vapidKeyId) || DEFAULT_KEY_ID;
  let pair = null;
  if (id === set.current.id) pair = set.current;
  else if (set.previous && id === set.previous.id) pair = set.previous;
  if (!pair || !pair.publicKey || !pair.privateKey) {
    throw pushError('PUSH_VAPID_KEY_UNAVAILABLE', 'Push VAPID key is unavailable for this device', 503);
  }
  return {
    subject: trimmed(env.VAPID_SUBJECT),
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    keyId: pair.id,
  };
}

function getPushConfig(env = process.env) {
  const publicKey = trimmed(env.VAPID_PUBLIC_KEY);
  const privateKey = trimmed(env.VAPID_PRIVATE_KEY);
  const subject = trimmed(env.VAPID_SUBJECT);
  let storageReady = true;
  try {
    encryptionKeySet(env);
    hmacKeySet(env);
  } catch (_error) {
    storageReady = false;
  }
  let keyId = DEFAULT_KEY_ID;
  let vapidReady = true;
  try {
    keyId = vapidKeySet(env).current.id;
  } catch (_error) {
    vapidReady = false;
  }
  const subjectReady = /^(?:mailto:|https:\/\/)/i.test(subject);
  return {
    available: Boolean(publicKey && privateKey && subjectReady && storageReady && vapidReady),
    publicKey: publicKey || null,
    privateKey: privateKey || null,
    subject: subject || null,
    keyId,
  };
}

function assertPushConfigured(env = process.env) {
  const config = getPushConfig(env);
  if (!config.available) {
    throw pushError('PUSH_NOT_CONFIGURED', 'Web Push is not configured', 503);
  }
  return config;
}

function validateDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_ID_RE.test(value)) {
    throw pushError('PUSH_DEVICE_INVALID', 'Push device identity is invalid');
  }
  return value;
}

// The server POSTs to whatever endpoint a subscription names, so an arbitrary
// https URL let any member aim it at a host of their choosing, loopback and LAN
// included. Only the browsers' push services.
const PUSH_SERVICE_DOMAINS = [
  'push.apple.com', // Safari, iOS home-screen apps (web.push.apple.com)
  'fcm.googleapis.com', // Chrome, Android, most Chromium browsers
  'android.googleapis.com', // legacy GCM endpoints
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // legacy Edge (WNS)
];
function isPushServiceHost(hostname) {
  const host = String(hostname).toLowerCase();
  return PUSH_SERVICE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function validateSubscription(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push subscription is invalid');
  }
  const unknown = Object.keys(input).filter((key) => !PUSH_KEYS.has(key));
  if (unknown.length || !Object.hasOwn(input, 'endpoint') || !Object.hasOwn(input, 'keys')) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push subscription shape is invalid');
  }
  let endpoint;
  try {
    endpoint = new URL(input.endpoint);
  } catch (_error) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push endpoint is invalid');
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || endpoint.port
    || !isPushServiceHost(endpoint.hostname)
    || input.endpoint.length > 2048
  ) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push endpoint is invalid');
  }
  if (!input.keys || typeof input.keys !== 'object' || Array.isArray(input.keys)) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push keys are invalid');
  }
  const keyNames = Object.keys(input.keys).sort();
  if (keyNames.join(',') !== 'auth,p256dh') {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push keys are invalid');
  }
  for (const key of keyNames) {
    const value = input.keys[key];
    if (typeof value !== 'string' || value.length < 8 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push keys are invalid');
    }
  }
  const expirationTime = input.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) {
    throw pushError('PUSH_SUBSCRIPTION_INVALID', 'Push expiration is invalid');
  }
  return {
    endpoint: endpoint.href,
    expirationTime,
    keys: { auth: input.keys.auth, p256dh: input.keys.p256dh },
  };
}

function keyedFingerprintWith(key, kind, value) {
  return crypto.createHmac('sha256', key).update(`${kind}\0${value}`).digest('hex');
}

// Current-key fingerprint (the default computed on every write and the first
// lookup on every read).
function keyedFingerprint(kind, value, env = process.env) {
  return keyedFingerprintWith(hmacKeySet(env).current.key, kind, value);
}

function normalizeEndpointForFingerprint(endpoint) {
  return validateSubscription({
    endpoint,
    expirationTime: null,
    keys: { auth: 'aaaaaaaa', p256dh: 'bbbbbbbb' },
  }).endpoint;
}

function endpointFingerprint(endpoint, env = process.env) {
  return keyedFingerprintWith(
    hmacKeySet(env).current.key, 'endpoint', normalizeEndpointForFingerprint(endpoint),
  );
}

// Previous-key endpoint fingerprint, or null when no previous HMAC key is
// configured. Used only as the dual-read fallback on a current-key miss.
function endpointFingerprintPrevious(endpoint, env = process.env) {
  const { previous } = hmacKeySet(env);
  if (!previous) return null;
  return keyedFingerprintWith(previous.key, 'endpoint', normalizeEndpointForFingerprint(endpoint));
}

function sessionFingerprint(token, env = process.env) {
  if (typeof token !== 'string' || !token) {
    throw pushError('PUSH_SESSION_INVALID', 'Push session is invalid', 401);
  }
  return keyedFingerprintWith(hmacKeySet(env).current.key, 'session', token);
}

function sessionFingerprintPrevious(token, env = process.env) {
  if (typeof token !== 'string' || !token) {
    throw pushError('PUSH_SESSION_INVALID', 'Push session is invalid', 401);
  }
  const { previous } = hmacKeySet(env);
  if (!previous) return null;
  return keyedFingerprintWith(previous.key, 'session', token);
}

function encryptSubscription(input, env = process.env) {
  const subscription = validateSubscription(input);
  const { current } = encryptionKeySet(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(ENCRYPTION_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(subscription), 'utf8'),
    cipher.final(),
  ]);
  return {
    version: 2,
    keyId: current.id,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function decryptWithKey(value, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', key, Buffer.from(value.iv, 'base64url'),
  );
  decipher.setAAD(ENCRYPTION_AAD);
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return validateSubscription(JSON.parse(plaintext));
}

// The key is chosen by keyId. An unknown keyId is a distinct, fail-closed error
// (PUSH_KEY_UNAVAILABLE, 503) — never conflated with corrupt ciphertext,
// because the correct action is "restore the key", not "discard the row".
function decryptSubscription(value, env = process.env) {
  if (!value || value.version !== 2) {
    throw pushError('PUSH_SUBSCRIPTION_CORRUPT', 'Encrypted push subscription is invalid', 500);
  }
  const keys = encryptionKeySet(env);
  let key = null;
  if (value.keyId === keys.current.id) key = keys.current.key;
  else if (keys.previous && value.keyId === keys.previous.id) key = keys.previous.key;
  if (!key) {
    throw pushError('PUSH_KEY_UNAVAILABLE', 'Encryption key for this record is unavailable', 503);
  }
  try {
    return decryptWithKey(value, key);
  } catch (_error) {
    throw pushError('PUSH_SUBSCRIPTION_CORRUPT', 'Encrypted push subscription is invalid', 500);
  }
}

module.exports = {
  assertPushConfigured,
  getPushConfig,
  validateDeviceId,
  validateSubscription,
  keyedFingerprint,
  endpointFingerprint,
  endpointFingerprintPrevious,
  sessionFingerprint,
  sessionFingerprintPrevious,
  encryptSubscription,
  decryptSubscription,
  currentHmacKeyId,
  currentEncryptionKeyId,
  currentVapidKeyId,
  vapidKeyIds,
  selectVapidDetails,
  pushError,
};

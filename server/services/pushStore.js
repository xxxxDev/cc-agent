const crypto = require('node:crypto');
const { isActiveUser, findPendingLifecycleTransition } = require('./userLifecycle');
const {
  validateDeviceId,
  validateSubscription,
  endpointFingerprint,
  endpointFingerprintPrevious,
  sessionFingerprint,
  sessionFingerprintPrevious,
  encryptSubscription,
  decryptSubscription,
  currentHmacKeyId,
  currentVapidKeyId,
  pushError,
} = require('./pushCrypto');
const { hashSessionToken } = require('./sessionTokens');

// What a notification is about is the product's (server/pushEvents.js: its
// categories, and the fields that name one event on a delivery row); this file is
// generic.
const events = require('../pushEvents');
// Every category defaults on: the master Notifications toggle means
// "receive every category". Send-time gating still honours a stored explicit false.
const DEFAULT_PREFERENCES = events.preferenceDefaults;
const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES);

function databaseCall(database, method, ...args) {
  return new Promise((resolve, reject) => {
    database[method](...args, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function ensureIndex(database, options) {
  return new Promise((resolve, reject) => {
    database.ensureIndex(options, (error) => (error ? reject(error) : resolve()));
  });
}

function executeCursor(cursor) {
  return new Promise((resolve, reject) => {
    cursor.exec((error, values) => (error ? reject(error) : resolve(values)));
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw pushError('PUSH_PREFERENCES_INVALID', 'Push preferences are invalid');
  }
  const keys = Object.keys(input).sort();
  if (keys.join(',') !== [...PREFERENCE_KEYS].sort().join(',')) {
    throw pushError('PUSH_PREFERENCES_INVALID', 'Push preferences shape is invalid');
  }
  const output = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] !== 'boolean') {
      throw pushError('PUSH_PREFERENCES_INVALID', 'Push preferences are invalid');
    }
    output[key] = input[key];
  }
  return output;
}

// Read leniently: a row saved by another version may hold keys no longer known (the
// keys inherited from an older version) or a value that is not a boolean. What is known and well
// formed is kept, the rest is the default, and nothing throws; the row is left as
// it is until the account next saves. Writes stay strict (normalizePreferences).
function storedPreferences(stored) {
  const output = { ...DEFAULT_PREFERENCES };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return output;
  for (const key of PREFERENCE_KEYS) {
    try { if (typeof stored[key] === 'boolean') output[key] = stored[key]; } catch { /* a getter that throws reads as the default */ }
  }
  return output;
}

function createPushStore({
  subscriptionsDB,
  preferencesDB,
  deliveriesDB,
  sessionsDB,
  usersDB,
  transitionsDB,
  env = process.env,
}) {
  if (
    !subscriptionsDB || !preferencesDB || !deliveriesDB
    || !sessionsDB || !usersDB || !transitionsDB
  ) {
    throw new Error('push datastores are required');
  }
  const ready = Promise.all([
    ensureIndex(subscriptionsDB, { fieldName: 'endpointFingerprint', unique: true }),
    ensureIndex(subscriptionsDB, { fieldName: 'userId' }),
    ensureIndex(preferencesDB, { fieldName: 'userId', unique: true }),
    ensureIndex(deliveriesDB, { fieldName: 'deliveryId', unique: true }),
    // Stable logical identity is independent of rotatable HMAC fingerprints.
    // Sparse keeps all pre-migration rows valid until their first replay adopts it.
    ensureIndex(deliveriesDB, { fieldName: 'deliveryKey', unique: true, sparse: true }),
    ensureIndex(deliveriesDB, { fieldName: 'status' }),
    ensureIndex(deliveriesDB, { fieldName: 'nextAttemptAt' }),
  ]);

  async function findOne(database, query) {
    await ready;
    return databaseCall(database, 'findOne', query);
  }

  async function findMany(database, query, { sort, limit } = {}) {
    await ready;
    let cursor = database.find(query);
    if (sort) cursor = cursor.sort(sort);
    if (limit) cursor = cursor.limit(limit);
    return executeCursor(cursor);
  }

  // Dual-read fingerprints: a lookup computes the current-key
  // fingerprint first and, when a previous HMAC key is configured, also the
  // previous-key fingerprint so rows written before rotation stay reachable.
  // Writes always use the current key; these lists only ever widen a read.
  function endpointFingerprintCandidates(endpoint) {
    const current = endpointFingerprint(endpoint, env);
    const previous = endpointFingerprintPrevious(endpoint, env);
    return previous && previous !== current ? [current, previous] : [current];
  }

  // Sessions are stored as token hashes (sessionTokens.js), so a subscription's
  // session fingerprint is taken over the hash: that is all a later check, or a
  // key rotation, has to recompute it from.
  function sessionFingerprintCandidates(tokenHash) {
    const current = sessionFingerprint(tokenHash, env);
    const previous = sessionFingerprintPrevious(tokenHash, env);
    return previous && previous !== current ? [current, previous] : [current];
  }

  async function upsertSubscription({ userId, sessionToken, deviceId, subscription, userAgent = null }) {
    const user = await findOne(usersDB, { _id: String(userId) });
    if (
      !isActiveUser(user)
      || await findPendingLifecycleTransition(transitionsDB, userId)
    ) {
      throw pushError('PUSH_USER_INACTIVE', 'Push cannot be enabled for an inactive account', 409);
    }
    validateDeviceId(deviceId);
    const normalized = validateSubscription(subscription);
    const fingerprint = endpointFingerprint(normalized.endpoint, env);
    const now = new Date().toISOString();
    // Dedupe against a row written under the previous HMAC key too, so the same
    // browser endpoint is re-bound (not duplicated) across a key rotation. The
    // write below re-stamps it to the current fingerprint/keyIds.
    let existing = await findOne(subscriptionsDB, { endpointFingerprint: fingerprint });
    if (!existing) {
      const previousFingerprint = endpointFingerprintPrevious(normalized.endpoint, env);
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        existing = await findOne(subscriptionsDB, { endpointFingerprint: previousFingerprint });
      }
    }
    const document = {
      endpointFingerprint: fingerprint,
      userId: String(userId),
      deviceId,
      sessionFingerprint: sessionFingerprint(hashSessionToken(sessionToken), env),
      encryptedSubscription: encryptSubscription(normalized, env),
      hmacKeyId: currentHmacKeyId(env),
      vapidKeyId: currentVapidKeyId(env),
      active: true,
      userAgent: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      disabledAt: null,
      disabledReason: null,
    };
    if (existing) {
      await databaseCall(subscriptionsDB, 'update', { _id: existing._id }, { $set: document }, {});
    } else {
      try {
        await databaseCall(subscriptionsDB, 'insert', document);
      } catch (error) {
        if (!/unique constraint/i.test(String(error?.message || ''))) throw error;
        await databaseCall(subscriptionsDB, 'update', { endpointFingerprint: fingerprint }, { $set: document }, {});
      }
    }
    await databaseCall(
      subscriptionsDB,
      'update',
      {
        userId: String(userId), deviceId, active: true,
        endpointFingerprint: { $ne: fingerprint },
      },
      { $set: { active: false, disabledAt: now, disabledReason: 'device_replaced', updatedAt: now } },
      { multi: true },
    );
    // Close the lifecycle/session race: an admin may disable the account while
    // this cross-store upsert is in flight. Never return an active binding unless
    // both the owner and the exact session are still live after the write.
    if (!(await isSessionActive(document))) {
      await deactivateByFingerprint(fingerprint, 'session_inactive');
      throw pushError('PUSH_SESSION_INACTIVE', 'Push session is no longer active', 409);
    }
    return { endpointFingerprint: fingerprint, deviceId };
  }

  async function deactivateSubscription({ userId, deviceId, endpoint }) {
    validateDeviceId(deviceId);
    const query = { userId: String(userId), deviceId, active: true };
    if (endpoint) query.endpointFingerprint = { $in: endpointFingerprintCandidates(endpoint) };
    const now = new Date().toISOString();
    const changed = await databaseCall(
      subscriptionsDB,
      'update',
      query,
      { $set: { active: false, disabledAt: now, disabledReason: 'user_disabled', updatedAt: now } },
      { multi: true },
    );
    return Number(changed || 0);
  }

  async function deactivateByFingerprint(fingerprint, reason = 'push_endpoint_gone') {
    const now = new Date().toISOString();
    return databaseCall(
      subscriptionsDB,
      'update',
      { endpointFingerprint: fingerprint, active: true },
      { $set: { active: false, disabledAt: now, disabledReason: reason, updatedAt: now } },
      {},
    );
  }

  async function deactivateSession(token) {
    let fingerprints;
    try {
      fingerprints = sessionFingerprintCandidates(hashSessionToken(token));
    } catch (error) {
      if (error.code === 'PUSH_NOT_CONFIGURED') return 0;
      throw error;
    }
    const now = new Date().toISOString();
    return databaseCall(
      subscriptionsDB,
      'update',
      { sessionFingerprint: { $in: fingerprints }, active: true },
      { $set: { active: false, disabledAt: now, disabledReason: 'session_ended', updatedAt: now } },
      { multi: true },
    );
  }

  async function deactivateUser(userId, reason = 'user_disabled') {
    const now = new Date().toISOString();
    const changed = await databaseCall(
      subscriptionsDB,
      'update',
      { userId: String(userId), active: true },
      { $set: { active: false, disabledAt: now, disabledReason: reason, updatedAt: now } },
      { multi: true },
    );
    return Number(changed || 0);
  }

  async function listActiveSubscriptions(userId) {
    return findMany(subscriptionsDB, { userId: String(userId), active: true });
  }

  async function getSubscription(fingerprint) {
    return findOne(subscriptionsDB, { endpointFingerprint: fingerprint });
  }

  async function isSessionActive(subscription) {
    if (!subscription?.sessionFingerprint || !subscription?.userId) return false;
    const user = await findOne(usersDB, { _id: String(subscription.userId) });
    if (!isActiveUser(user)) return false;
    if (await findPendingLifecycleTransition(transitionsDB, subscription.userId)) return false;
    const sessions = await findMany(sessionsDB, { userId: subscription.userId });
    const now = Date.now();
    // Dual-key compare: a subscription written before rotation stores its
    // session fingerprint under the previous HMAC key, so match either key.
    return sessions.some((session) => (
      new Date(session.expiresAt).getTime() >= now
      && typeof session.tokenHash === 'string'
      && sessionFingerprintCandidates(session.tokenHash).includes(subscription.sessionFingerprint)
    ));
  }

  async function getPreferences(userId) {
    const existing = await findOne(preferencesDB, { userId: String(userId) });
    return storedPreferences(existing?.preferences);
  }

  async function setPreferences(userId, input) {
    const preferences = normalizePreferences(input);
    const now = new Date().toISOString();
    const existing = await findOne(preferencesDB, { userId: String(userId) });
    if (existing) {
      await databaseCall(
        preferencesDB, 'update', { _id: existing._id },
        { $set: { preferences, updatedAt: now } }, {},
      );
    } else {
      try {
        await databaseCall(preferencesDB, 'insert', {
          userId: String(userId), preferences, createdAt: now, updatedAt: now,
        });
      } catch (error) {
        if (!/unique constraint/i.test(String(error?.message || ''))) throw error;
        await databaseCall(
          preferencesDB, 'update', { userId: String(userId) },
          { $set: { preferences, updatedAt: now } }, {},
        );
      }
    }
    return preferences;
  }

  async function getStatus(userId, deviceId) {
    validateDeviceId(deviceId);
    const subscriptions = await listActiveSubscriptions(userId);
    const active = [];
    for (const subscription of subscriptions) {
      if (await isSessionActive(subscription)) active.push(subscription);
    }
    return {
      deviceEnabled: active.some((subscription) => subscription.deviceId === deviceId),
      activeDevices: new Set(active.map((subscription) => subscription.deviceId)).size,
      preferences: await getPreferences(userId),
    };
  }

  function deliveryKeyForWebPush(reply, subscription) {
    const binding = subscription._id
      ? `subscription:${String(subscription._id)}`
      : `device:${String(subscription.deviceId)}`;
    return crypto.createHash('sha256').update(
      `${events.eventKey(reply)}\0webpush\0${binding}`,
    ).digest('hex');
  }

  async function adoptLogicalIdentity(existing, {
    deliveryKey,
    logicalChecksum,
    extra = {},
    conflictMessage,
  }) {
    if (
      (existing.deliveryKey && existing.deliveryKey !== deliveryKey)
      || (existing.logicalChecksum && existing.logicalChecksum !== logicalChecksum)
    ) {
      throw pushError('PUSH_DELIVERY_CONFLICT', conflictMessage, 409);
    }
    if (
      existing.deliveryKey === deliveryKey
      && existing.logicalChecksum === logicalChecksum
      && Object.entries(extra).every(([key, value]) => existing[key] === value)
    ) {
      return existing;
    }
    try {
      await databaseCall(
        deliveriesDB,
        'update',
        { _id: existing._id },
        { $set: { deliveryKey, logicalChecksum, ...extra } },
        {},
      );
      return findOne(deliveriesDB, { _id: existing._id });
    } catch (error) {
      if (!/unique constraint/i.test(String(error?.message || ''))) throw error;
      const winner = await findOne(deliveriesDB, { deliveryKey });
      if (!winner || winner.logicalChecksum !== logicalChecksum) {
        throw pushError('PUSH_DELIVERY_CONFLICT', conflictMessage, 409);
      }
      return winner;
    }
  }

  async function ensureDelivery({
    reply, subscription, payload, status, suppressionReason = null,
    recipientUserId = null, recipientReason = 'owner',
  }) {
    const deliveryKey = deliveryKeyForWebPush(reply, subscription);
    const deliveryId = crypto.createHash('sha256').update(
      `${events.eventKey(reply)}\0${subscription.endpointFingerprint}`,
    ).digest('hex');
    const logical = {
      ...events.eventFields(reply),
      userId: String(reply.ownerUserId),
      deviceId: subscription.deviceId,
      category: events.eventCategory(reply),
      payload,
    };
    const logicalChecksum = checksum(logical);
    // Immutable identity is (event, device) with the owner as userId.
    // `channel`/`recipientUserId`/`recipientReason` are bookkeeping columns kept OUT
    // of the checksum, so a row without them re-projects to the same checksum and
    // never trips PUSH_DELIVERY_CONFLICT.
    const immutable = {
      deliveryId,
      ...events.eventFields(reply),
      userId: String(reply.ownerUserId),
      endpointFingerprint: subscription.endpointFingerprint,
      deviceId: subscription.deviceId,
      category: events.eventCategory(reply),
      payload,
    };
    const immutableChecksum = checksum(immutable);
    let existing = await findOne(deliveriesDB, { deliveryKey });
    if (!existing) existing = await findOne(deliveriesDB, { deliveryId });
    if (existing) {
      const existingLogicalChecksum = checksum({
        ...events.storedEventFields(existing),
        userId: existing.userId,
        deviceId: existing.deviceId,
        category: existing.category,
        payload: existing.payload,
      });
      if (existingLogicalChecksum !== logicalChecksum) {
        throw pushError('PUSH_DELIVERY_CONFLICT', 'Immutable push delivery conflict', 409);
      }
      const adopted = await adoptLogicalIdentity(existing, {
        deliveryKey,
        logicalChecksum,
        conflictMessage: 'Immutable push delivery conflict',
      });
      return { created: false, delivery: adopted };
    }
    const now = new Date().toISOString();
    const document = {
      ...immutable,
      deliveryKey,
      logicalChecksum,
      channel: 'webpush',
      recipientUserId: recipientUserId ? String(recipientUserId) : String(reply.ownerUserId),
      recipientReason,
      immutableChecksum,
      status,
      suppressionReason,
      attempts: 0,
      nextAttemptAt: status === 'pending' ? now : null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      lastErrorCode: null,
    };
    try {
      const delivery = await databaseCall(deliveriesDB, 'insert', document);
      return { created: true, delivery };
    } catch (error) {
      if (!/unique constraint/i.test(String(error?.message || ''))) throw error;
      const winner = await findOne(deliveriesDB, { deliveryKey })
        || await findOne(deliveriesDB, { deliveryId });
      if (!winner || winner.logicalChecksum !== logicalChecksum) {
        throw pushError('PUSH_DELIVERY_CONFLICT', 'Immutable push delivery conflict', 409);
      }
      return { created: false, delivery: winner };
    }
  }

  async function listDue(now = new Date().toISOString(), limit = 25) {
    return findMany(
      deliveriesDB,
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { sort: { nextAttemptAt: 1, createdAt: 1 }, limit },
    );
  }

  async function claimDelivery(deliveryId) {
    const now = new Date().toISOString();
    const changed = await databaseCall(
      deliveriesDB, 'update',
      { deliveryId, status: 'pending' },
      { $set: { status: 'sending', claimedAt: now, updatedAt: now } }, {},
    );
    if (!changed) return null;
    return findOne(deliveriesDB, { deliveryId });
  }

  async function updateDelivery(deliveryId, update) {
    await databaseCall(
      deliveriesDB, 'update', { deliveryId },
      { $set: { ...update, updatedAt: new Date().toISOString() } }, {},
    );
    return findOne(deliveriesDB, { deliveryId });
  }

  async function recoverStaleSending(before) {
    return databaseCall(
      deliveriesDB, 'update',
      { status: 'sending', claimedAt: { $lt: before } },
      { $set: { status: 'pending', nextAttemptAt: new Date().toISOString(), lastErrorCode: 'stale_claim' } },
      { multi: true },
    );
  }

  // Permanent purge cleanup: remove a purged user's subscription
  // and preference rows outright. Delivery history (push-deliveries.db) is
  // intentionally left untouched. Best-effort — the caller swallows failures.
  async function purgeUser(userId) {
    const id = String(userId);
    const [subscriptions, preferences] = await Promise.all([
      databaseCall(subscriptionsDB, 'remove', { userId: id }, { multi: true }),
      databaseCall(preferencesDB, 'remove', { userId: id }, { multi: true }),
    ]);
    return { subscriptions: Number(subscriptions || 0), preferences: Number(preferences || 0) };
  }

  return {
    upsertSubscription,
    deactivateSubscription,
    deactivateByFingerprint,
    deactivateSession,
    deactivateUser,
    listActiveSubscriptions,
    getSubscription,
    readSubscription(subscription) {
      return decryptSubscription(subscription.encryptedSubscription, env);
    },
    isSessionActive,
    getPreferences,
    setPreferences,
    getStatus,
    ensureDelivery,
    listDue,
    claimDelivery,
    updateDelivery,
    recoverStaleSending,
    purgeUser,
  };
}

let defaultStore = null;

function getDefaultPushStore() {
  if (!defaultStore) {
    const {
      pushSubscriptionsDB,
      pushPreferencesDB,
      pushDeliveriesDB,
      sessionsDB,
      usersDB,
      userLifecycleTransitionsDB,
    } = require('../stores');
    defaultStore = createPushStore({
      subscriptionsDB: pushSubscriptionsDB,
      preferencesDB: pushPreferencesDB,
      deliveriesDB: pushDeliveriesDB,
      sessionsDB,
      usersDB,
      transitionsDB: userLifecycleTransitionsDB,
    });
  }
  return defaultStore;
}

module.exports = {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  createPushStore,
  getDefaultPushStore,
};

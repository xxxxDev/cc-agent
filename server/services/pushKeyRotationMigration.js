const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
} = require('./privateFiles');
const {
  decryptSubscription,
  encryptSubscription,
  endpointFingerprint,
  sessionFingerprint,
  sessionFingerprintPrevious,
  currentHmacKeyId,
  currentEncryptionKeyId,
  currentVapidKeyId,
  vapidKeyIds,
} = require('./pushCrypto');

// Stored data, named by the product (siteConfig.js).
const BACKUP_SCHEMA = require('../siteConfig').PRODUCT.pushKeyBackupSchema;
const BACKUP_FILES = Object.freeze(['push-subscriptions.db', 'push-deliveries.db']);
const MANIFEST_BASENAME = 'push-key-rotation-backup-manifest.json';
const NON_TERMINAL_DELIVERY = Object.freeze(['pending', 'sending']);

function databaseCall(database, method, ...args) {
  return new Promise((resolve, reject) => {
    database[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}

function findMany(database, query = {}) {
  return new Promise((resolve, reject) => {
    database.find(query).exec((error, values) => (error ? reject(error) : resolve(values)));
  });
}

function migrationError(message, details) {
  return Object.assign(new Error(message), {
    status: 409,
    code: 'PUSH_KEY_ROTATION_BLOCKED',
    details,
  });
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function regularFileInfo(filename) {
  const resolved = path.resolve(filename);
  const info = fs.lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw migrationError('Push datastore path is not a regular file', { filename: resolved });
  }
  return { resolved, info };
}

function validatePrivateFileForRead(filename) {
  const result = regularFileInfo(filename);
  if ((result.info.mode & 0o077) !== 0) {
    throw migrationError('Push datastore is not private enough to read', {
      mode: result.info.mode & 0o777,
    });
  }
  if (fs.existsSync(`${result.resolved}~`)) {
    throw migrationError('Push datastore has an unresolved NeDB companion file', {
      filename: result.resolved,
    });
  }
  return result;
}

// Backup both push datastores under one manifest (schema tag + per-file
// sha256/size/mode), refusing to overwrite a non-empty target, the same
// discipline as the user-lifecycle backup, extended to two files.
function backupPushKeyFiles(dbDir, backupDirectory, { now = () => new Date() } = {}) {
  const directory = ensurePrivateDirectory(backupDirectory);
  const manifestFile = path.join(directory, MANIFEST_BASENAME);
  const targets = BACKUP_FILES.map((basename) => ({
    basename,
    source: path.resolve(dbDir, basename),
    backup: path.join(directory, basename),
  }));
  if (fs.existsSync(manifestFile) || targets.some((t) => fs.existsSync(t.backup))) {
    throw migrationError('Push key rotation backup target is not empty', { backupDirectory: directory });
  }
  const files = [];
  for (const target of targets) {
    const { info } = validatePrivateFileForRead(target.source);
    fs.copyFileSync(target.source, target.backup, fs.constants.COPYFILE_EXCL);
    const mode = info.mode & 0o777;
    fs.chmodSync(target.backup, mode);
    files.push({
      basename: target.basename,
      size: fs.statSync(target.backup).size,
      mode,
      sha256: sha256File(target.backup),
    });
  }
  const manifest = { schema: BACKUP_SCHEMA, createdAt: now().toISOString(), files };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: PRIVATE_FILE_MODE,
  });
  fs.chmodSync(manifestFile, PRIVATE_FILE_MODE);
  return { backupDirectory: directory, manifestFile, manifest };
}

function swapFileFromBackup(backup, target, mode) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.restore-${process.pid}-${Date.now()}`,
  );
  try {
    fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, mode);
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    const directoryDescriptor = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_cleanupError) { /* absent */ }
    throw error;
  }
}

// Verify the whole manifest (schema/size/sha256/mode) for BOTH files before
// swapping either, then temp-file-swap each into place and re-verify.
function restorePushKeyFiles(backupDirectory, dbDir) {
  const directory = path.resolve(backupDirectory);
  const directoryInfo = fs.lstatSync(directory);
  if (
    directoryInfo.isSymbolicLink()
    || !directoryInfo.isDirectory()
    || (directoryInfo.mode & 0o077) !== 0
  ) {
    throw migrationError('Push key rotation backup directory is not private');
  }
  const manifestFile = path.join(directory, MANIFEST_BASENAME);
  regularFileInfo(manifestFile);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_error) {
    throw migrationError('Push key rotation backup manifest is invalid');
  }
  if (manifest?.schema !== BACKUP_SCHEMA || !Array.isArray(manifest.files)) {
    throw migrationError('Push key rotation backup manifest is invalid');
  }
  const plan = [];
  for (const basename of BACKUP_FILES) {
    const entry = manifest.files.find((file) => file?.basename === basename);
    const backup = path.join(directory, basename);
    const { info } = regularFileInfo(backup);
    if (
      !entry
      || entry.size !== info.size
      || entry.sha256 !== sha256File(backup)
      || entry.mode !== (info.mode & 0o777)
      || (entry.mode & 0o077) !== 0
    ) {
      throw migrationError('Push key rotation backup verification failed', { file: basename });
    }
    plan.push({ basename, backup, target: path.resolve(dbDir, basename), mode: entry.mode });
  }
  ensurePrivateDirectory(dbDir);
  for (const item of plan) {
    if (fs.existsSync(item.target)) regularFileInfo(item.target);
    if (fs.existsSync(`${item.target}~`)) {
      throw migrationError('Restore target has an unresolved NeDB companion file', { file: item.basename });
    }
  }
  const restored = [];
  for (const item of plan) {
    swapFileFromBackup(item.backup, item.target, item.mode);
    const size = fs.statSync(item.target).size;
    const mode = fs.statSync(item.target).mode & 0o777;
    const sha256 = sha256File(item.target);
    const entry = manifest.files.find((file) => file.basename === item.basename);
    if (size !== entry.size || mode !== entry.mode || sha256 !== entry.sha256) {
      throw migrationError('Restored push datastore verification failed', { file: item.basename });
    }
    restored.push({ file: item.basename, size, mode, sha256 });
  }
  return { restored };
}

// A stored session fingerprint resolves to: itself (already current-key), the
// current-key fingerprint of the same live token (was previous-key), or null
// (no live session: leave stale; the send-time check is dual-key/authoritative).
async function buildSessionResolver(sessionsDB, env) {
  const sessions = await findMany(sessionsDB);
  const currentFingerprints = new Set();
  const previousToCurrent = new Map();
  for (const session of sessions) {
    // Sessions store a token hash; subscription fingerprints are taken over it.
    if (typeof session.tokenHash !== 'string' || !session.tokenHash) continue;
    const current = sessionFingerprint(session.tokenHash, env);
    currentFingerprints.add(current);
    const previous = sessionFingerprintPrevious(session.tokenHash, env);
    if (previous && previous !== current) previousToCurrent.set(previous, current);
  }
  return (storedFingerprint) => {
    if (!storedFingerprint) return null;
    if (currentFingerprints.has(storedFingerprint)) return storedFingerprint;
    if (previousToCurrent.has(storedFingerprint)) return previousToCurrent.get(storedFingerprint);
    return null;
  };
}

function keyIdContext(env) {
  const vapid = vapidKeyIds(env);
  return {
    encryptionId: currentEncryptionKeyId(env),
    hmacId: currentHmacKeyId(env),
    vapidCurrentId: currentVapidKeyId(env),
    vapidPreviousId: vapid.previous,
  };
}

// Classify one subscription row against the current key set, producing the
// minimal $set needed to move it fully onto the current keys. `vapidKeyId` is
// deliberately never part of the update: only a real resubscription moves a
// device to a new VAPID key. Returns null `update` when already converged.
function classifySubscription(row, env, ids, resolveSession) {
  let decrypted;
  try {
    decrypted = decryptSubscription(row.encryptedSubscription, env);
  } catch (error) {
    return { undecryptable: true, code: error.code || 'PUSH_SUBSCRIPTION_CORRUPT' };
  }
  const envelope = row.encryptedSubscription || {};
  const needsReencrypt = !(envelope.version === 2 && envelope.keyId === ids.encryptionId);
  const newEndpointFingerprint = endpointFingerprint(decrypted.endpoint, env);
  const needsEndpointFingerprint = row.endpointFingerprint !== newEndpointFingerprint;
  const needsHmacKeyId = (row.hmacKeyId || 'k0') !== ids.hmacId;

  const resolvedSession = resolveSession(row.sessionFingerprint);
  const needsSessionFingerprint = resolvedSession !== null && resolvedSession !== row.sessionFingerprint;
  const staleSession = resolvedSession === null;

  const vapidKeyId = row.vapidKeyId || 'k0';
  let vapidClass = 'unknown';
  if (vapidKeyId === ids.vapidCurrentId) vapidClass = 'current';
  else if (ids.vapidPreviousId && vapidKeyId === ids.vapidPreviousId) vapidClass = 'previous';

  const update = {};
  if (needsReencrypt) update.encryptedSubscription = encryptSubscription(decrypted, env);
  if (needsEndpointFingerprint) update.endpointFingerprint = newEndpointFingerprint;
  if (needsHmacKeyId) update.hmacKeyId = ids.hmacId;
  if (needsSessionFingerprint) update.sessionFingerprint = resolvedSession;

  return {
    undecryptable: false,
    needsReencrypt,
    needsEndpointFingerprint,
    needsHmacKeyId,
    needsSessionFingerprint,
    staleSession,
    vapidClass,
    oldEndpointFingerprint: row.endpointFingerprint,
    newEndpointFingerprint,
    changed: Object.keys(update).length > 0,
    update: Object.keys(update).length > 0 ? update : null,
  };
}

// Build a full rotation plan (never writes). The returned `report` carries
// counts and key ids ONLY: no key material, endpoints, or fingerprints.
async function planPushKeyRotation(subscriptionsDB, deliveriesDB, sessionsDB, env) {
  const ids = keyIdContext(env);
  const resolveSession = await buildSessionResolver(sessionsDB, env);
  const subscriptions = await findMany(subscriptionsDB);

  const counts = {
    subscriptionsReencrypted: 0,
    subscriptionsEndpointRefingerprinted: 0,
    subscriptionsHmacKeyIdStamped: 0,
    subscriptionsSessionRefingerprinted: 0,
    subscriptionsSessionStale: 0,
    subscriptionsOnCurrentVapidKey: 0,
    subscriptionsOnPreviousVapidKey: 0,
    subscriptionsOnUnknownVapidKey: 0,
  };
  const subscriptionUpdates = [];
  const endpointRemap = new Map();
  const undecryptableIds = [];
  let subscriptionsChanged = 0;

  for (const row of subscriptions) {
    const verdict = classifySubscription(row, env, ids, resolveSession);
    if (verdict.undecryptable) {
      undecryptableIds.push(String(row._id));
      continue;
    }
    if (verdict.needsReencrypt) counts.subscriptionsReencrypted += 1;
    if (verdict.needsEndpointFingerprint) {
      counts.subscriptionsEndpointRefingerprinted += 1;
      endpointRemap.set(verdict.oldEndpointFingerprint, verdict.newEndpointFingerprint);
    }
    if (verdict.needsHmacKeyId) counts.subscriptionsHmacKeyIdStamped += 1;
    if (verdict.needsSessionFingerprint) counts.subscriptionsSessionRefingerprinted += 1;
    if (verdict.staleSession) counts.subscriptionsSessionStale += 1;
    if (verdict.vapidClass === 'current') counts.subscriptionsOnCurrentVapidKey += 1;
    else if (verdict.vapidClass === 'previous') counts.subscriptionsOnPreviousVapidKey += 1;
    else counts.subscriptionsOnUnknownVapidKey += 1;
    if (verdict.changed) {
      subscriptionsChanged += 1;
      subscriptionUpdates.push({ id: row._id, update: verdict.update });
    }
  }

  const deliveries = await findMany(deliveriesDB, { status: { $in: NON_TERMINAL_DELIVERY } });
  const deliveryUpdates = [];
  for (const row of deliveries) {
    if (!row.endpointFingerprint) continue;
    const target = endpointRemap.get(row.endpointFingerprint);
    if (target && target !== row.endpointFingerprint) {
      deliveryUpdates.push({ id: row._id, endpointFingerprint: target });
    }
  }

  const plannedChanges = subscriptionsChanged + deliveryUpdates.length;
  const report = {
    totalSubscriptions: subscriptions.length,
    ...counts,
    subscriptionsChanged,
    totalDeliveries: deliveries.length,
    pendingDeliveriesRefingerprinted: deliveryUpdates.length,
    undecryptable: undecryptableIds.length,
    plannedChanges,
    keyIds: {
      encryption: ids.encryptionId,
      hmac: ids.hmacId,
      vapidCurrent: ids.vapidCurrentId,
      vapidPrevious: ids.vapidPreviousId,
    },
  };
  return {
    report, subscriptionUpdates, deliveryUpdates, undecryptableIds,
  };
}

// Apply (or dry-run) the rotation. Undecryptable rows fail closed BEFORE any
// write (a partial rotation is worse than none). Apply re-plans afterwards and
// only reports success when the store fully converges to the current keys.
async function rotatePushKeys(subscriptionsDB, deliveriesDB, sessionsDB, {
  apply = false, env = process.env, now = () => new Date(),
} = {}) {
  const plan = await planPushKeyRotation(subscriptionsDB, deliveriesDB, sessionsDB, env);
  if (plan.undecryptableIds.length) {
    throw migrationError('Some push subscriptions cannot be decrypted with the available keys', {
      undecryptable: plan.undecryptableIds.length,
    });
  }
  if (!apply) {
    return {
      mode: 'dry-run',
      changed: 0,
      wouldChange: plan.report.plannedChanges,
      converged: plan.report.plannedChanges === 0,
      report: plan.report,
    };
  }
  const rotatedAt = now().toISOString();
  let changed = 0;
  for (const item of plan.subscriptionUpdates) {
    changed += Number(await databaseCall(
      subscriptionsDB, 'update', { _id: item.id },
      { $set: { ...item.update, keyRotatedAt: rotatedAt } }, {},
    ) || 0);
  }
  for (const item of plan.deliveryUpdates) {
    changed += Number(await databaseCall(
      deliveriesDB, 'update', { _id: item.id },
      { $set: { endpointFingerprint: item.endpointFingerprint, keyRotatedAt: rotatedAt } }, {},
    ) || 0);
  }
  require('./compactQuietly').compactQuietly(subscriptionsDB, 'push subscriptions');
  require('./compactQuietly').compactQuietly(deliveriesDB, 'push deliveries');

  const after = await planPushKeyRotation(subscriptionsDB, deliveriesDB, sessionsDB, env);
  if (after.undecryptableIds.length || after.report.plannedChanges) {
    throw migrationError('Push key rotation did not converge', after.report);
  }
  return {
    mode: 'apply',
    changed,
    wouldChange: plan.report.plannedChanges,
    converged: true,
    report: plan.report,
    after: after.report,
  };
}

module.exports = {
  BACKUP_SCHEMA,
  BACKUP_FILES,
  MANIFEST_BASENAME,
  backupPushKeyFiles,
  restorePushKeyFiles,
  planPushKeyRotation,
  rotatePushKeys,
  validatePrivateFileForRead,
  sha256File,
};

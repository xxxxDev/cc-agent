#!/usr/bin/env node
// Moves the stored push subscriptions onto the current push keys after a rotation
// (docs/push-keys.md): re-encrypts them and takes their fingerprints again. Run it with
// the service stopped; --apply backs up both push stores first, --restore puts a backup back.
// --dry-run only reads: the files are parsed here and never opened by NeDB, which would
// create a missing file and rewrite every file it loads.

const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');
const { privateDatastoreOptions } = require('../services/privateFiles');
const {
  planPushKeyRotation,
  rotatePushKeys,
  backupPushKeyFiles,
  restorePushKeyFiles,
  validatePrivateFileForRead,
} = require('../services/pushKeyRotationMigration');

const DATA_FILES = Object.freeze(['push-subscriptions.db', 'push-deliveries.db', 'sessions.db']);
// scripts/start.mjs keeps its lock, naming its pid, in the data folder: the parent of auth/.
const SERVICE_LOCK = 'server.lock';
// NeDB refuses to load a file with more than this share of unreadable lines.
const CORRUPT_ALERT_THRESHOLD = 0.1;

function rotationError(message, code, details) {
  return Object.assign(new Error(message), { code, details });
}

function usageError(message) {
  return rotationError(message, 'PUSH_KEY_ROTATION_USAGE');
}

function parseArgs(argv) {
  const options = { mode: null, dbDir: null, backupDir: null, ackQuiesced: false, keys: null };
  const valueOf = (index, name) => {
    const value = argv[index];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw usageError(`${name} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') options.mode = options.mode ? 'invalid' : 'dry-run';
    else if (value === '--apply') options.mode = options.mode ? 'invalid' : 'apply';
    else if (value === '--restore') options.mode = options.mode ? 'invalid' : 'restore';
    else if (value === '--ack-quiesced') options.ackQuiesced = true;
    else if (value === '--db-dir') options.dbDir = valueOf(index += 1, value);
    else if (value === '--backup-dir') options.backupDir = valueOf(index += 1, value);
    else if (value === '--keys') options.keys = valueOf(index += 1, value);
    // Only a flag's own name is repeated back: a stray value could be a key pasted by mistake.
    else throw usageError(String(value).startsWith('--') ? `unknown argument: ${value}` : 'unexpected value on the command line');
  }
  if (!['dry-run', 'apply', 'restore'].includes(options.mode)) {
    throw usageError('choose exactly one of --dry-run, --apply, or --restore');
  }
  if (!options.dbDir) throw usageError('--db-dir is required');
  if (['apply', 'restore'].includes(options.mode) && (!options.ackQuiesced || !options.backupDir)) {
    throw usageError(`${options.mode} requires --backup-dir and --ack-quiesced`);
  }
  return options;
}

// The keys file's values win over the environment, as they do in scripts/start.mjs. Its
// errors are fixed text: JSON.parse quotes the text around a mistake, here key material.
function loadKeys(filename) {
  let text;
  try { text = fs.readFileSync(filename, 'utf8'); } catch (error) {
    throw rotationError('The --keys file cannot be read', 'PUSH_KEY_ROTATION_KEYS_INVALID', { reason: error.code || 'read failed' });
  }
  let keys;
  try { keys = JSON.parse(text); } catch (_error) {
    throw rotationError('The --keys file is not valid JSON', 'PUSH_KEY_ROTATION_KEYS_INVALID');
  }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)
    || Object.values(keys).some((value) => typeof value !== 'string')) {
    throw rotationError('The --keys file must be one JSON object of text values', 'PUSH_KEY_ROTATION_KEYS_INVALID');
  }
  return keys;
}

// A mistyped --db-dir must not be taken for an empty install: every file the service
// keeps there has to be present already, and nothing is created in its place.
function requireDataDirectory(dbDir) {
  const resolved = path.resolve(dbDir);
  let info;
  try { info = fs.lstatSync(resolved); } catch (_error) { info = null; }
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    throw rotationError('--db-dir is not an existing data folder', 'PUSH_KEY_ROTATION_MISSING_DATA', { dbDir: resolved });
  }
  return resolved;
}

function requireDataFiles(dbDir) {
  const resolved = requireDataDirectory(dbDir);
  const missing = DATA_FILES.filter((basename) => {
    try { return !fs.lstatSync(path.join(resolved, basename)).isFile(); } catch (_error) { return true; }
  });
  if (missing.length) {
    throw rotationError('--db-dir does not hold the service\'s data files', 'PUSH_KEY_ROTATION_MISSING_DATA', { dbDir: resolved, missing });
  }
  return resolved;
}

// A service started by scripts/start.mjs on this data folder holds server.lock with its
// pid. Any other way of running it leaves no signal: --ack-quiesced stays the promise.
function refuseWhileServiceRuns(dbDir) {
  const lock = path.join(path.dirname(path.resolve(dbDir)), SERVICE_LOCK);
  let text;
  try { text = fs.readFileSync(lock, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw rotationError('The service lock cannot be read', 'PUSH_KEY_ROTATION_SERVICE_RUNNING', { lock });
  }
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw rotationError('The service lock is unreadable; stop the service, then remove it', 'PUSH_KEY_ROTATION_SERVICE_RUNNING', { lock });
  }
  try { process.kill(pid, 0); } catch (error) {
    if (error.code === 'ESRCH') return; // left by a service that did not exit cleanly
  }
  throw rotationError('The service is running on this data folder; stop it first', 'PUSH_KEY_ROTATION_SERVICE_RUNNING', { lock, pid });
}

function reviveDates(_key, value) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && '$$date' in value) {
    return new Date(value.$$date);
  }
  return value;
}

// One NeDB data file as NeDB itself loads it (lib/persistence.js treatRawData): one JSON
// document a line, the last line of an _id wins, $$deleted removes it, index lines are
// skipped. Read through a descriptor opened read-only, never written, created or compacted.
function readDatafileSnapshot(filename) {
  const { resolved } = validatePrivateFileForRead(filename);
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let raw;
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw rotationError('A data file is not a regular file', 'PUSH_KEY_ROTATION_MISSING_DATA', { file: path.basename(resolved) });
    }
    raw = fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  const lines = raw.split('\n').filter((line) => line !== '');
  const byId = new Map();
  let corrupt = 0;
  for (const line of lines) {
    let doc;
    try { doc = JSON.parse(line, reviveDates); } catch (_error) { corrupt += 1; continue; }
    if (doc && doc._id) {
      if (doc.$$deleted === true) byId.delete(doc._id);
      else byId.set(doc._id, doc);
    } else if (!(doc && (doc.$$indexCreated || typeof doc.$$indexRemoved === 'string'))) {
      corrupt += 1;
    }
  }
  if (lines.length && corrupt / lines.length > CORRUPT_ALERT_THRESHOLD) {
    throw rotationError('A data file is too damaged to read', 'PUSH_KEY_ROTATION_BLOCKED', { file: path.basename(resolved), corruptLines: corrupt });
  }
  return [...byId.values()];
}

async function snapshotStore(filename) {
  const store = new Datastore({ inMemoryOnly: true });
  const docs = readDatafileSnapshot(filename);
  if (docs.length) await store.insertAsync(docs);
  return store;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const keys = options.keys ? loadKeys(options.keys) : null;
  refuseWhileServiceRuns(options.dbDir);

  if (options.mode === 'restore') {
    requireDataDirectory(options.dbDir);
    return { mode: 'restore', ...restorePushKeyFiles(options.backupDir, options.dbDir) };
  }

  const dbDir = requireDataFiles(options.dbDir);
  if (keys) Object.assign(process.env, keys);
  // Sessions are only read, in both modes: they are not part of the backup.
  const sessionsDB = await snapshotStore(path.join(dbDir, 'sessions.db'));

  if (options.mode === 'dry-run') {
    const subscriptionsDB = await snapshotStore(path.join(dbDir, 'push-subscriptions.db'));
    const deliveriesDB = await snapshotStore(path.join(dbDir, 'push-deliveries.db'));
    const plan = await planPushKeyRotation(subscriptionsDB, deliveriesDB, sessionsDB, process.env);
    if (plan.undecryptableIds.length) {
      throw rotationError('Some push subscriptions cannot be decrypted with the available keys', 'PUSH_KEY_ROTATION_BLOCKED', {
        undecryptable: plan.undecryptableIds.length,
      });
    }
    return {
      mode: 'dry-run',
      converged: plan.report.plannedChanges === 0,
      wouldChange: plan.report.plannedChanges,
      report: plan.report,
    };
  }

  // apply: manifest-backed backup BEFORE any mutation.
  const backup = backupPushKeyFiles(dbDir, options.backupDir);
  const subscriptionsDB = new Datastore(privateDatastoreOptions(path.join(dbDir, 'push-subscriptions.db')));
  const deliveriesDB = new Datastore(privateDatastoreOptions(path.join(dbDir, 'push-deliveries.db')));
  const result = await rotatePushKeys(subscriptionsDB, deliveriesDB, sessionsDB, {
    apply: true, env: process.env,
  });
  return {
    mode: 'apply',
    backup: {
      backupDir: backup.backupDirectory,
      manifest: backup.manifestFile,
      files: backup.manifest.files.map((file) => ({
        basename: file.basename, sha256: file.sha256, size: file.size, mode: file.mode,
      })),
    },
    changed: result.changed,
    converged: result.converged,
    report: result.report,
    after: result.after,
  };
}

// Only this script's own errors, the push modules' (fixed text and key names) and the
// system's (a path) are shown as they are; anything else gets a fixed message, so no key
// text can reach the terminal.
function describeError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const known = code.startsWith('PUSH_') || code === 'PRIVATE_STORAGE_INVALID';
  if (known) return { error: error.message, code, details: error.details };
  if (error?.syscall) return { error: error.message, code: code || 'PUSH_KEY_ROTATION_FAILED' };
  return { error: 'Push key rotation failed', code: 'PUSH_KEY_ROTATION_FAILED' };
}

if (require.main === module) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.converged === false) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify(describeError(error))}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs, main, loadKeys, readDatafileSnapshot, requireDataFiles, refuseWhileServiceRuns, describeError,
};

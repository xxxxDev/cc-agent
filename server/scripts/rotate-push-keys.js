#!/usr/bin/env node
// Moves the stored push subscriptions onto the current push keys after a rotation
// (docs/push-keys.md): re-encrypts them and takes their fingerprints again. Run it with
// the service stopped; --apply backs up both push stores first, --restore puts a backup back.
// --dry-run only reads: the files are parsed here with NeDB's own reader, never opened by a
// NeDB store, which would create a missing file and rewrite every file it loads.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const Datastore = require('@seald-io/nedb');
const NedbIndex = require('@seald-io/nedb/lib/indexes');
const nedbModel = require('@seald-io/nedb/lib/model');
const { NEDB_LINE_HOOKS, privateDatastoreOptions } = require('../services/privateFiles');
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
    // Only a flag's own name is repeated back, never a value given with it (--name=value)
    // or alone: either could be a key or a path pasted by mistake.
    else throw usageError(String(value).startsWith('--') ? `unknown argument: ${String(value).split('=')[0]}` : 'unexpected value on the command line');
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
// keeps there has to be present already, and nothing is created in its place. A folder
// that is not there is not named back: what was typed may not be a path at all.
function requireDataDirectory(dbDir) {
  const resolved = path.resolve(dbDir);
  let info;
  try { info = fs.lstatSync(resolved); } catch (_error) { info = null; }
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    throw rotationError('--db-dir is not an existing data folder', 'PUSH_KEY_ROTATION_MISSING_DATA');
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
// Returns quietly when there is no lock or only one left by a process that is gone.
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

// An apply or a restore holds server.lock itself, made the way scripts/start.mjs makes it
// (flag wx, its own pid), so a start refuses while the stores are being written: start.mjs
// stops at a lock whose process is alive. One left by a process that is gone is taken
// over, as start.mjs does. It is removed when the run ends, by an error or a signal too,
// and only while it is still this process's file.
function holdServiceLock(dbDir) {
  const lock = path.join(path.dirname(path.resolve(dbDir)), SERVICE_LOCK);
  const take = () => fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  try { take(); } catch (error) {
    if (error.code !== 'EEXIST') {
      throw rotationError('The service lock cannot be made', 'PUSH_KEY_ROTATION_LOCK_FAILED', { lock, reason: error.code || 'write failed' });
    }
    refuseWhileServiceRuns(dbDir);
    try { fs.unlinkSync(lock); take(); } catch (_error) {
      throw rotationError('Something else took the service lock; try again', 'PUSH_KEY_ROTATION_SERVICE_RUNNING', { lock });
    }
  }
  const owned = fs.lstatSync(lock);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const signal of signals) process.removeListener(signal, onSignal);
    process.removeListener('exit', release);
    try {
      const current = fs.lstatSync(lock);
      if (!current.isSymbolicLink() && current.ino === owned.ino && current.dev === owned.dev
        && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
    } catch (_error) { /* already gone */ }
  };
  // The lock goes, then the signal is raised again with no handler left, so the process
  // ends the way that signal ends it.
  function onSignal(signal) {
    release();
    process.kill(process.pid, signal);
  }
  for (const signal of signals) process.once(signal, onSignal);
  process.once('exit', release);
  return release;
}

// What NeDB says when it cannot load a file, as this script's fixed messages: its own
// text quotes a broken unique key, which can be a fingerprint.
function datafileLoadError(error, file) {
  if (error && error.corruptionRate !== undefined) {
    return rotationError('A data file is too damaged to read', 'PUSH_KEY_ROTATION_BLOCKED', {
      file, unreadableLines: error.corruptItems, lines: error.dataLength,
    });
  }
  if (error && error.errorType === 'uniqueViolated') {
    return rotationError('A data file breaks one of its unique indexes', 'PUSH_KEY_ROTATION_BLOCKED', { file });
  }
  return error;
}

// One data file as an in-memory store holding what NeDB itself would load from it
// (lib/persistence.js loadDatabaseAsync): its own line reader, which also ends a line at
// \r, U+0085, U+2028 and U+2029, its own parser with the service's hooks and corruption
// limit, and its indexes rebuilt, so a file NeDB would refuse is refused here too. The
// bytes come through a descriptor opened read-only: nothing is written, created or
// compacted. unreadableLines counts the lines NeDB would drop.
async function loadDatafileSnapshot(filename) {
  const { resolved } = validatePrivateFileForRead(filename);
  const file = path.basename(resolved);
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let raw;
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw rotationError('A data file is not a regular file', 'PUSH_KEY_ROTATION_MISSING_DATA', { file });
    }
    raw = fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  let unreadableLines = 0;
  const store = new Datastore({
    inMemoryOnly: true,
    afterSerialization: NEDB_LINE_HOOKS.afterSerialization,
    beforeDeserialization: (line) => {
      const kept = NEDB_LINE_HOOKS.beforeDeserialization(line);
      // NeDB counts a line as corrupt when it does not parse or parses to null.
      if (line !== '') {
        try { if (nedbModel.deserialize(kept) == null) unreadableLines += 1; } catch (_error) { unreadableLines += 1; }
      }
      return kept;
    },
  });
  let treated;
  try { treated = await store.persistence.treatRawStreamAsync(Readable.from([raw])); } catch (error) {
    throw datafileLoadError(error, file);
  }
  for (const [fieldName, index] of Object.entries(treated.indexes)) store.indexes[fieldName] = new NedbIndex(index);
  try { store._resetIndexes(treated.data); } catch (error) {
    throw datafileLoadError(error, file);
  }
  return { store, unreadableLines };
}

// The documents a snapshot holds, for checks and tests.
async function readDatafileSnapshot(filename) {
  return (await loadDatafileSnapshot(filename)).store.getAllData();
}

// A store the apply writes to: NeDB opens it here, inside main, so a file it refuses
// becomes one of this script's errors instead of an exception nobody catches.
async function openDatastore(filename) {
  const store = new Datastore({ ...privateDatastoreOptions(filename), autoload: false });
  try { await store.loadDatabaseAsync(); } catch (error) {
    throw datafileLoadError(error, path.basename(filename));
  }
  return store;
}

async function snapshotAll(dbDir) {
  const stores = {};
  const unreadableLines = {};
  for (const basename of DATA_FILES) {
    const snapshot = await loadDatafileSnapshot(path.join(dbDir, basename));
    stores[basename] = snapshot.store;
    unreadableLines[basename] = snapshot.unreadableLines;
  }
  return { stores, unreadableLines };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const keys = options.keys ? loadKeys(options.keys) : null;
  const dbDir = requireDataDirectory(options.dbDir);
  // A dry run writes nothing, the lock included: it only checks that no service runs.
  if (options.mode === 'dry-run') refuseWhileServiceRuns(dbDir);
  const release = options.mode === 'dry-run' ? () => {} : holdServiceLock(dbDir);
  try {
    if (options.mode === 'restore') {
      return { mode: 'restore', ...restorePushKeyFiles(options.backupDir, dbDir) };
    }
    requireDataFiles(dbDir);
    if (keys) Object.assign(process.env, keys);
    // All three files are read as NeDB would read them before anything is written, so a
    // file the apply could not load stops it here, before the backup. Sessions are only
    // read, in both modes: they are not part of the backup.
    const snapshot = await snapshotAll(dbDir);
    const sessionsDB = snapshot.stores['sessions.db'];

    if (options.mode === 'dry-run') {
      const plan = await planPushKeyRotation(
        snapshot.stores['push-subscriptions.db'], snapshot.stores['push-deliveries.db'], sessionsDB, process.env,
      );
      if (plan.undecryptableIds.length) {
        throw rotationError('Some push subscriptions cannot be decrypted with the available keys', 'PUSH_KEY_ROTATION_BLOCKED', {
          undecryptable: plan.undecryptableIds.length,
        });
      }
      return {
        mode: 'dry-run',
        converged: plan.report.plannedChanges === 0,
        wouldChange: plan.report.plannedChanges,
        unreadableLines: snapshot.unreadableLines,
        report: plan.report,
      };
    }

    // apply: manifest-backed backup BEFORE any mutation.
    const backup = backupPushKeyFiles(dbDir, options.backupDir);
    const subscriptionsDB = await openDatastore(path.join(dbDir, 'push-subscriptions.db'));
    const deliveriesDB = await openDatastore(path.join(dbDir, 'push-deliveries.db'));
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
      unreadableLines: snapshot.unreadableLines,
      report: result.report,
      after: result.after,
    };
  } finally {
    release();
  }
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
  parseArgs, main, loadKeys, loadDatafileSnapshot, readDatafileSnapshot, openDatastore, requireDataFiles,
  refuseWhileServiceRuns, holdServiceLock, describeError,
};

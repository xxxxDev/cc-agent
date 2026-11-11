#!/usr/bin/env node
// Moves the stored push subscriptions onto the current push keys after a rotation
// (docs/push-keys.md): re-encrypts them and takes their fingerprints again. Run it with
// the service stopped; --apply backs up both push stores first, --restore puts a backup back.

const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');
const { privateDatastoreOptions } = require('../services/privateFiles');
const {
  planPushKeyRotation,
  rotatePushKeys,
  backupPushKeyFiles,
  restorePushKeyFiles,
} = require('../services/pushKeyRotationMigration');

function parseArgs(argv) {
  const options = { mode: null, dbDir: null, backupDir: null, ackQuiesced: false, keys: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') options.mode = options.mode ? 'invalid' : 'dry-run';
    else if (value === '--apply') options.mode = options.mode ? 'invalid' : 'apply';
    else if (value === '--restore') options.mode = options.mode ? 'invalid' : 'restore';
    else if (value === '--ack-quiesced') options.ackQuiesced = true;
    else if (value === '--db-dir') options.dbDir = argv[index += 1];
    else if (value === '--backup-dir') options.backupDir = argv[index += 1];
    else if (value === '--keys') options.keys = argv[index += 1];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!['dry-run', 'apply', 'restore'].includes(options.mode)) {
    throw new Error('choose exactly one of --dry-run, --apply, or --restore');
  }
  if (!options.dbDir) throw new Error('--db-dir is required');
  if (['apply', 'restore'].includes(options.mode) && (!options.ackQuiesced || !options.backupDir)) {
    throw new Error(`${options.mode} requires --backup-dir and --ack-quiesced`);
  }
  return options;
}

function openStores(dbDir) {
  return {
    subscriptionsDB: new Datastore(privateDatastoreOptions(path.join(dbDir, 'push-subscriptions.db'))),
    deliveriesDB: new Datastore(privateDatastoreOptions(path.join(dbDir, 'push-deliveries.db'))),
    sessionsDB: new Datastore(privateDatastoreOptions(path.join(dbDir, 'sessions.db'))),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // The keys file the service starts with (push-keys.json in the data folder); its values
  // win over the environment, as they do in scripts/start.mjs.
  if (options.keys) Object.assign(process.env, JSON.parse(fs.readFileSync(options.keys, 'utf8')));

  if (options.mode === 'restore') {
    return { mode: 'restore', ...restorePushKeyFiles(options.backupDir, options.dbDir) };
  }

  if (options.mode === 'dry-run') {
    const { subscriptionsDB, deliveriesDB, sessionsDB } = openStores(options.dbDir);
    const plan = await planPushKeyRotation(subscriptionsDB, deliveriesDB, sessionsDB, process.env);
    if (plan.undecryptableIds.length) {
      throw Object.assign(new Error('Some push subscriptions cannot be decrypted with the available keys'), {
        code: 'PUSH_KEY_ROTATION_BLOCKED',
        details: { undecryptable: plan.undecryptableIds.length },
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
  const backup = backupPushKeyFiles(options.dbDir, options.backupDir);
  const { subscriptionsDB, deliveriesDB, sessionsDB } = openStores(options.dbDir);
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

if (require.main === module) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.converged === false) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        error: error.message,
        code: error.code || 'PUSH_KEY_ROTATION_FAILED',
        details: error.details,
      })}\n`);
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, main };

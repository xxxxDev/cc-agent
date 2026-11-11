const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendPrivateJsonLine, ensurePrivateDirectory, hardenExistingPrivateFile } = require('./privateFiles');
const { PRODUCT } = require('../siteConfig');

// One audit log for the API, the agent bridge and the admin terminal.
//
// Only the service names it: scripts/start.mjs sets the setting PRODUCT.env.auditLog
// names. Any other process that loads this file (a one-off script, a scratch copy of the
// server) writes to a temporary folder of its own, so its requests never mix into the
// live log, where a run of unauthenticated ones would read like an attack. That folder is
// made by mkdtemp: an unguessable name, this account only, so no other user can make it first.
// (The setting's name and the folder's prefix are the product's: siteConfig.js.)
const AUDIT_LOG = process.env[PRODUCT.env.auditLog]
  || path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${PRODUCT.tempPrefix}-audit-`)), 'api-audit.log');
ensurePrivateDirectory(path.dirname(AUDIT_LOG));
hardenExistingPrivateFile(AUDIT_LOG);

function audit(entry) {
  try {
    appendPrivateJsonLine(AUDIT_LOG, { ts: new Date().toISOString(), ...entry });
  } catch (err) {
    console.error('audit log write failed:', err.message);
  }
}

module.exports = { audit, AUDIT_LOG };

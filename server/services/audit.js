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

// A path is kept to its first 512 characters: a request can carry a very long one.
const PATH_MAX = 512;
function audit(entry) {
  try {
    const line = { ts: new Date().toISOString(), ...entry };
    if (typeof line.path === 'string' && line.path.length > PATH_MAX) line.path = `${line.path.slice(0, PATH_MAX)}…`;
    appendPrivateJsonLine(AUDIT_LOG, line);
  } catch (err) {
    console.error('audit log write failed:', err.message);
  }
}

// A request from someone not signed in takes nothing to make, so at most this many of them
// are written a minute for each source (api, bridge, bridge-cloudflare); the rest are counted
// in one line for that source and minute, written with the next one or within a minute.
const REFUSED_PER_MINUTE = 60;
const budgets = new Map();
function flush(source, b) {
  if (b.count > REFUSED_PER_MINUTE) audit({ source, action: 'refusals-not-logged', count: b.count - REFUSED_PER_MINUTE, minute: new Date(b.minute * 60000).toISOString() });
}
function auditRefused(entry, now = Date.now()) {
  const source = entry.source || 'api';
  const minute = Math.floor(now / 60000);
  let b = budgets.get(source);
  if (!b || b.minute !== minute) {
    if (b) { flush(source, b); clearTimeout(b.timer); }
    b = { minute, count: 0, timer: null };
    budgets.set(source, b);
  }
  b.count += 1;
  if (b.count <= REFUSED_PER_MINUTE) return audit(entry);
  if (!b.timer) {
    const t = b;
    b.timer = setTimeout(() => { if (budgets.get(source) === t) { flush(source, t); budgets.delete(source); } }, 61_000);
    b.timer.unref?.();
  }
}

module.exports = { audit, auditRefused, REFUSED_PER_MINUTE, PATH_MAX, AUDIT_LOG };

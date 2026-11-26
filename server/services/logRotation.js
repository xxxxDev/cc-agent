'use strict';

// Age-based rename rotation + retention for the server's write-only audit logs
// (api-audit.log): rename the whole file into
// logs/archive/<name>-<UTC stamp>.log once its oldest line is older than 7 days,
// recreate an empty 0600 log immediately, and delete archive segments whose mtime
// is older than 365 days. No young-tail is kept (these files have no reader
// contract). The writers open the file for each append
// (privateFiles.appendPrivateJsonLine), so renaming it underneath them is safe.

const fs = require('node:fs');
const path = require('node:path');
const {
  ensurePrivateDirectory,
  PRIVATE_FILE_MODE,
} = require('./privateFiles');
// Windows has no O_NOFOLLOW; the descriptor identity checks stand in for it there.
const { isWin } = require('../../channel/platform.cjs');

const ROTATE_AFTER_DAYS = 7;
const RETENTION_DAYS = 365;
// A log is also rotated once it is this large, and the oldest archive segments go once
// they add up to more than the archive cap, so requests nobody signed in for cannot fill
// the disk.
const ROTATE_AT_BYTES = 100 * 1024 * 1024;
const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_LINE_CAP = 64 * 1024;
// The setting that moves the audit log (services/audit.js) is named by the product.
const AUDIT_LOG_ENV = require('../siteConfig').PRODUCT.env.auditLog;
const DEFAULT_FILES = Object.freeze(['api-audit.log', 'agent-monitor.log']);

function defaultLogsDir() {
  // Rotate where the audit log is written (services/audit.js): beside it when
  // the audit-log setting (PRODUCT.env.auditLog) moves it out of the code folder,
  // else server/logs.
  return process.env[AUDIT_LOG_ENV]
    ? path.dirname(path.resolve(process.env[AUDIT_LOG_ENV]))
    : path.resolve(__dirname, '..', 'logs');
}

// The audit log, under the name that setting gives it, and the agent monitor's log.
function defaultFiles() {
  return process.env[AUDIT_LOG_ENV]
    ? [...new Set([path.basename(process.env[AUDIT_LOG_ENV]), 'agent-monitor.log'])]
    : DEFAULT_FILES;
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function activeFileInfo(filePath) {
  try {
    const info = fs.lstatSync(filePath);
    if (info.isSymbolicLink() || !info.isFile()) return { info: null, reason: 'not_regular' };
    return { info, reason: null };
  } catch (error) {
    if (error.code === 'ENOENT') return { info: null, reason: 'missing' };
    return { info: null, reason: 'unreadable' };
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// Read the first line through a no-follow descriptor and verify it is the same
// regular file lstat inspected. Return both the timestamp and a safe reason.
function firstLineTimeMs(filePath, expectedInfo) {
  const noFollow = fs.constants.O_NOFOLLOW;
  // Refuse without no-follow on POSIX: opening must not traverse a substituted link.
  if (!Number.isInteger(noFollow) && !isWin) return { stamp: null, reason: 'nofollow_unavailable' };
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  } catch (_error) {
    return { stamp: null, reason: 'unreadable' };
  }
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameFile(opened, expectedInfo)) {
      return { stamp: null, reason: 'changed' };
    }
    const buffer = Buffer.alloc(FIRST_LINE_CAP);
    const read = fs.readSync(fd, buffer, 0, FIRST_LINE_CAP, 0);
    if (read === 0) return { stamp: null, reason: 'unparseable_first_line' };
    const text = buffer.subarray(0, read).toString('utf8');
    const newline = text.indexOf('\n');
    const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim();
    if (!firstLine) return { stamp: null, reason: 'unparseable_first_line' };
    let parsed;
    try {
      parsed = JSON.parse(firstLine);
    } catch (_error) {
      return { stamp: null, reason: 'unparseable_first_line' };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { stamp: null, reason: 'unparseable_first_line' };
    }
    const stamp = Date.parse(parsed.ts);
    return Number.isNaN(stamp)
      ? { stamp: null, reason: 'unparseable_first_line' }
      : { stamp, reason: null };
  } finally {
    fs.closeSync(fd);
  }
}

function hardenRegularNoFollow(filePath) {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow) && !isWin) throw new Error('O_NOFOLLOW is unavailable');
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`log path is not a regular file: ${filePath}`);
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameFile(opened, before)) {
      throw new Error(`log path changed during no-follow open: ${filePath}`);
    }
    fs.fchmodSync(fd, PRIVATE_FILE_MODE);
  } finally {
    fs.closeSync(fd);
  }
}

function createOrOpenPrivateLog(filePath) {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow) && !isWin) throw new Error('O_NOFOLLOW is unavailable');
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_APPEND | noFollow;
  const fd = fs.openSync(filePath, flags, PRIVATE_FILE_MODE);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) throw new Error(`log path is not a regular file: ${filePath}`);
    const current = fs.lstatSync(filePath);
    if (current.isSymbolicLink() || !current.isFile() || !sameFile(opened, current)) {
      throw new Error(`log path changed during no-follow create: ${filePath}`);
    }
    fs.fchmodSync(fd, PRIVATE_FILE_MODE);
  } finally {
    fs.closeSync(fd);
  }
}

function uniqueSegment(archiveDir, base, stamp) {
  let candidate = path.join(archiveDir, `${base}-${stamp}.log`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(archiveDir, `${base}-${stamp}-${suffix}.log`);
    suffix += 1;
  }
  return candidate;
}

function rotateFile(filePath, archiveDir, { now, dryRun, rotateAtBytes = ROTATE_AT_BYTES }) {
  const inspected = activeFileInfo(filePath);
  if (!inspected.info) return { rotated: null, reason: inspected.reason };
  const firstLine = firstLineTimeMs(filePath, inspected.info);
  if (firstLine.stamp === null) return { rotated: null, reason: firstLine.reason };
  const stamp = firstLine.stamp;
  const ageDays = (now.getTime() - stamp) / DAY_MS;
  if (ageDays <= ROTATE_AFTER_DAYS && inspected.info.size < rotateAtBytes) return { rotated: null, reason: 'young' };

  const base = path.basename(filePath, path.extname(filePath));
  const segment = uniqueSegment(archiveDir, base, utcStamp(now));
  const segmentName = path.basename(segment);
  if (dryRun) return { rotated: null, wouldRotate: segmentName, reason: 'dry_run' };

  ensurePrivateDirectory(archiveDir);
  const current = fs.lstatSync(filePath);
  if (current.isSymbolicLink() || !current.isFile() || !sameFile(current, inspected.info)) {
    return { rotated: null, reason: 'changed' };
  }
  fs.renameSync(filePath, segment);
  hardenRegularNoFollow(segment);
  createOrOpenPrivateLog(filePath);
  return { rotated: segmentName };
}

function deleteOldSegments(archiveDir, base, { now, dryRun, archiveMaxBytes = ARCHIVE_MAX_BYTES }) {
  const deleted = [];
  const kept = [];
  const skipped = [];
  // The archive folder itself is looked at without following it: a link put in its
  // place would have old files deleted wherever it points. (Rotating into one is refused by ensurePrivateDirectory.)
  let folder;
  try {
    folder = fs.lstatSync(archiveDir);
  } catch (error) {
    if (error.code === 'ENOENT') return { deleted, skipped };
    throw error;
  }
  if (folder.isSymbolicLink() || !folder.isDirectory()) {
    skipped.push({ name: path.basename(archiveDir), reason: 'not_regular' });
    return { deleted, skipped };
  }
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  for (const name of fs.readdirSync(archiveDir).sort()) {
    if (!name.startsWith(`${base}-`) || !name.endsWith('.log')) continue;
    const full = path.join(archiveDir, name);
    const info = fs.lstatSync(full);
    if (!info.isFile()) {
      skipped.push({ name, reason: 'not_regular' });
      continue;
    }
    if (info.mtimeMs < cutoff) {
      if (!dryRun) fs.unlinkSync(full);
      deleted.push(name);
    } else kept.push({ name, full, size: info.size, mtimeMs: info.mtimeMs });
  }
  // Over the cap, the oldest segments go first.
  let total = kept.reduce((n, k) => n + k.size, 0);
  for (const k of kept.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= archiveMaxBytes) break;
    if (!dryRun) fs.unlinkSync(k.full);
    deleted.push(k.name);
    total -= k.size;
  }
  return { deleted, skipped };
}

function runLogRotation({
  logsDir = defaultLogsDir(),
  now = new Date(),
  files = defaultFiles(),
  dryRun = false,
  rotateAtBytes = ROTATE_AT_BYTES,
  archiveMaxBytes = ARCHIVE_MAX_BYTES,
} = {}) {
  const archiveDir = path.join(logsDir, 'archive');
  const report = {};
  for (const file of files) {
    const base = path.basename(file, path.extname(file));
    const { deleted, skipped } = deleteOldSegments(archiveDir, base, { now, dryRun, archiveMaxBytes });
    const rotated = rotateFile(path.join(logsDir, file), archiveDir, { now, dryRun, rotateAtBytes });
    report[file] = { rotated, deleted, skipped };
  }
  return report;
}

// House start pattern: run one pass at startup,
// then an hourly unref'd interval (a size check needs more than one a day); never throw (a failed pass logs one line only).
function startLogRotation(options = {}) {
  const {
    intervalMs = 60 * 60 * 1000,
    timers = { setInterval, clearInterval },
    logger = console,
    ...passthrough
  } = options;
  const runOnce = () => {
    try {
      runLogRotation(passthrough);
    } catch (error) {
      logger.error?.(`[logRotation] pass failed: ${error.message}`);
    }
  };
  runOnce();
  const handle = timers.setInterval(runOnce, intervalMs);
  handle?.unref?.();
  return () => timers.clearInterval?.(handle);
}

module.exports = {
  ROTATE_AFTER_DAYS,
  RETENTION_DAYS,
  ROTATE_AT_BYTES,
  ARCHIVE_MAX_BYTES,
  runLogRotation,
  startLogRotation,
  defaultLogsDir,
  defaultFiles,
};

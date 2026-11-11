const fs = require('node:fs');
const path = require('node:path');

// The lock one process at a time holds on a data folder (server.lock: scripts/start.mjs,
// and server/scripts/rotate-push-keys.js while it writes the stores; its dry run only
// reads it, with inspectDataFolderLock). It is made with
// O_EXCL, names its process and is synced where the filesystem allows. One naming a
// process that is gone is taken over only inside a second lock beside it,
// server.lock.takeover, made the same way: in
// there the lock is read again and, if it still names a process that is gone, removed and
// made afresh with O_EXCL. One process at a time is inside, so none removes a lock another
// has just taken over, and nothing is renamed or linked (some filesystems have no hard
// links). A takeover lock whose process is gone (it died inside) is removed only inside a
// third lock named for that very file, server.lock.takeover.break-<inode>, made with
// O_EXCL: two processes that judged it at once cannot both remove it, so neither removes
// the takeover lock the other has just made. A break file whose process is gone (it died
// inside) is removed the same way, inside a break file of its own, and the takeover lock
// is then judged again. A process removes no lock but its own on the way out. A lock
// naming this process's own pid that this process did not make was left by an earlier
// process with the same pid (after a reboot, say), and is gone too.

const TAKEOVER_SUFFIX = '.takeover';
const BREAK_SUFFIX = '.break-';
const BUSY_WAIT_MS = 20;
const LOCK_MODE = 0o600;

// The locks this process made (device and inode).
const madeHere = new Set();
const fileKey = (info) => `${info.dev}:${info.ino}`;

function lockError(message, code, details) {
  return Object.assign(new Error(message), { code }, details);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Whether a lock as read is held: one naming this process (or the pid it takes the lock
// as) only when this process made that very file, any other while its process is alive.
function held(lock, pid, isAlive) {
  if (lock.pid === pid || lock.pid === process.pid) return madeHere.has(fileKey(lock));
  return isAlive(lock.pid);
}

// The pid a lock's text names, or null when it names none: digits only (after trimming),
// 1 to 2^31-1. A larger number is no process (process.kill refuses it, and every error but
// ESRCH reads as alive, so it would be held forever).
const MAX_PID = 2 ** 31 - 1;
function lockPid(text) {
  const trimmed = String(text).trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return pid >= 1 && pid <= MAX_PID ? pid : null;
}

function unreadable(filename) {
  return lockError('The data folder lock is unreadable', 'DATA_FOLDER_LOCK_UNREADABLE', { file: filename });
}

// One read of a lock file: { pid, ino, dev }, null when it is gone, or { pid: null } when
// it is a regular file naming no pid.
function readLockOnce(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw unreadable(filename);
  }
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile()) throw unreadable(filename);
    return { pid: lockPid(fs.readFileSync(descriptor, 'utf8')), ino: info.ino, dev: info.dev };
  } finally {
    fs.closeSync(descriptor);
  }
}

// The pid a lock file names and its inode, or null when it is gone. A lock is made with
// O_EXCL before its pid is written, so one read empty (or naming no pid) may be another
// process's lock a moment old: it is read again every BUSY_WAIT_MS for UNREADABLE_AFTER_MS
// (by the clock: a sleep can run long). One that still names no pid then (or is not a
// regular file) is refused: nobody can say it is stale. The error names the file.
const UNREADABLE_AFTER_MS = 200;
function readLock(filename) {
  const deadline = Date.now() + UNREADABLE_AFTER_MS;
  for (;;) {
    const lock = readLockOnce(filename);
    if (!lock || lock.pid !== null) return lock;
    if (Date.now() >= deadline) throw unreadable(filename);
    sleep(BUSY_WAIT_MS);
  }
}

function sameFile(filename, owned) {
  let now;
  try { now = fs.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return !now.isSymbolicLink() && now.ino === owned.ino && now.dev === owned.dev;
}

// The folder's entry for a file just made, synced where the system allows it (not all do,
// for a folder): best effort.
function syncFolder(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (_error) { /* not supported here */ } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_error) { /* closed */ }
  }
}

// Makes filename with O_EXCL, naming pid, syncs it, and returns the fstat of the
// descriptor it made: the file this process owns. One it made but could not finish is
// removed again. EEXIST when it is there already.
function createLock(filename, pid) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filename, flags, LOCK_MODE);
  let made = null;
  try {
    made = fs.fstatSync(descriptor);
    madeHere.add(fileKey(made));
    const text = Buffer.from(String(pid));
    let written = 0;
    while (written < text.length) {
      const count = fs.writeSync(descriptor, text, written);
      if (count <= 0) throw lockError('The data folder lock could not be written', 'DATA_FOLDER_LOCK_WRITE');
      written += count;
    }
    // Synced where the filesystem allows it: some (FUSE, network mounts) refuse fsync.
    try { fs.fsyncSync(descriptor); } catch (error) {
      if (error.code !== 'EINVAL' && error.code !== 'ENOTSUP') throw error;
    }
    syncFolder(filename);
    return fs.fstatSync(descriptor);
  } catch (error) {
    if (made && sameFile(filename, made)) {
      try { fs.unlinkSync(filename); } catch (_cleanupError) { /* gone */ }
    }
    if (made) madeHere.delete(fileKey(made));
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
}

// Removes a lock this process made, only while it is still that file and names pid.
function removeOwnLock(filename, owned, pid) {
  try {
    if (sameFile(filename, owned) && fs.readFileSync(filename, 'utf8') === String(pid)) fs.unlinkSync(filename);
  } catch (_error) { /* gone */ }
  madeHere.delete(fileKey(owned));
}

// How deep break files of break files go: each level is there only when a process died
// inside the one before it, so a deeper one is left for a person (DATA_FOLDER_LOCK_BUSY).
const MAX_BREAK_DEPTH = 3;

// Removes a lock whose process is gone (judged: as it was read), inside a breaker lock
// named for that very file. Only the process that makes the breaker removes it, and only
// while it is still the file judged and names the same process, still gone: no other can
// remove or replace it meanwhile. True when it is gone; false when another process is
// breaking it, or it changed (judged again from the top). A breaker left by a process that
// died inside it is broken the same way, inside a breaker of its own, holding nothing
// meanwhile; the lock it guarded is then judged again inside a breaker made afresh. One
// that stays empty throws DATA_FOLDER_LOCK_UNREADABLE with its name.
function breakDeadLock(filename, judged, pid, isAlive, depth = 0) {
  const breakerName = `${filename}${BREAK_SUFFIX}${judged.ino}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let breaker;
    try { breaker = createLock(breakerName, pid); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const other = readLock(breakerName);
      if (!other) continue; // done meanwhile
      if (held(other, pid, isAlive) || depth >= MAX_BREAK_DEPTH) return false;
      if (!breakDeadLock(breakerName, other, pid, isAlive, depth + 1)) return false;
      continue;
    }
    try {
      let now;
      try { now = readLock(filename); } catch (error) {
        if (error.code === 'DATA_FOLDER_LOCK_UNREADABLE') return false;
        throw error;
      }
      if (!now) return true;
      if (now.ino !== judged.ino || now.dev !== judged.dev || now.pid !== judged.pid || held(now, pid, isAlive)) return false;
      try { fs.unlinkSync(filename); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return true;
    } finally {
      removeOwnLock(breakerName, breaker, pid);
    }
  }
  return false;
}

// Whether breakDeadLock could remove a lock whose process is gone (judged), read the same
// way and writing nothing: false where it would meet a live breaker (or one too deep).
function breakable(filename, judged, pid, isAlive, depth = 0) {
  const breakerName = `${filename}${BREAK_SUFFIX}${judged.ino}`;
  const other = readLock(breakerName);
  if (!other) return true;
  if (held(other, pid, isAlive) || depth >= MAX_BREAK_DEPTH) return false;
  return breakable(breakerName, other, pid, isAlive, depth + 1);
}

// Enters the takeover lock: its fstat, or null while another live process is inside or
// is breaking a dead one.
function enterTakeover(guard, pid, isAlive) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return createLock(guard, pid); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const inside = readLock(guard);
    if (!inside) continue; // left meanwhile
    if (held(inside, pid, isAlive)) return null;
    // Its process died inside.
    if (!breakDeadLock(guard, inside, pid, isAlive)) return null;
  }
  return null;
}

// Reads the lock as takeDataFolderLock reads it (an empty one read again for a moment,
// the pid range, a lock naming this process's own pid that it did not make is stale) and
// writes nothing: no lock, no takeover lock, a stale one left in place. null when there
// is none; otherwise { pid, held }: held while its process is alive, false when the lock
// was left by a process that is gone and a start would take it over. A stale one is judged
// further as a start judges it: the takeover lock beside it, and the break files beside a
// dead takeover lock. Throws DATA_FOLDER_LOCK_UNREADABLE (with the file) for one nobody can
// say is stale, and DATA_FOLDER_LOCK_BUSY where a start would meet a live process taking
// it over. For a check that must not write (a dry run): a start can still take the lock a
// moment after.
function inspectDataFolderLock(lock, { pid = process.pid, isAlive = processAlive } = {}) {
  const holder = readLock(lock);
  if (!holder) return null;
  if (held(holder, pid, isAlive)) return { pid: holder.pid, held: true };
  const inside = readLock(`${lock}${TAKEOVER_SUFFIX}`);
  if (inside && (held(inside, pid, isAlive) || !breakable(`${lock}${TAKEOVER_SUFFIX}`, inside, pid, isAlive))) {
    throw lockError('The data folder lock is being taken over', 'DATA_FOLDER_LOCK_BUSY');
  }
  return { pid: holder.pid, held: false };
}

// Takes the lock for this process, or throws DATA_FOLDER_LOCK_HELD (a live process has
// it), DATA_FOLDER_LOCK_UNREADABLE (with the file that cannot be read), or
// DATA_FOLDER_LOCK_BUSY (another process kept taking it over). Returns the pid of a stale
// holder it replaced, if any, and the fstat of the lock it made (stat), which is how its
// release knows the file is still its own.
function takeDataFolderLock(lock, { pid = process.pid, isAlive = processAlive, attempts = 5, wait = sleep } = {}) {
  const guard = `${lock}${TAKEOVER_SUFFIX}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return { tookOverFrom: null, stat: createLock(lock, pid) }; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readLock(lock);
    if (!holder) continue; // released meanwhile
    if (held(holder, pid, isAlive)) throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', { pid: holder.pid });
    const entered = enterTakeover(guard, pid, isAlive);
    if (!entered) { wait(BUSY_WAIT_MS); continue; }
    try {
      const stale = readLock(lock);
      if (stale && held(stale, pid, isAlive)) throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', { pid: stale.pid });
      if (stale) {
        try { fs.unlinkSync(lock); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      try { return { tookOverFrom: stale ? stale.pid : null, stat: createLock(lock, pid) }; } catch (error) {
        // A process starting meanwhile made it with O_EXCL: it is judged again.
        if (error.code !== 'EEXIST') throw error;
      }
    } finally {
      removeOwnLock(guard, entered, pid);
    }
  }
  throw lockError('The data folder lock kept changing', 'DATA_FOLDER_LOCK_BUSY');
}

module.exports = { takeDataFolderLock, inspectDataFolderLock, processAlive, lockPid };

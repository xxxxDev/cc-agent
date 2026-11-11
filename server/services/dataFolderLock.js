const fs = require('node:fs');
const crypto = require('node:crypto');

// The lock one process at a time holds on a data folder (server.lock: scripts/start.mjs,
// and server/scripts/rotate-push-keys.js while it writes the stores). It is made with
// flag wx and names its process. One naming a process that is gone is taken over: it is
// first renamed to a name of this process's own, which only one process can do, and
// removed only if what was moved still names that same process; then the lock is made
// with wx again. Deleting it where it lies instead could delete the lock another process
// had just taken over, and both would go on as its holder.

function lockError(message, code, pid) {
  return Object.assign(new Error(message), { code, pid });
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// The pid a lock file names and its inode, or null when it is gone. A file that names
// no pid (or cannot be read as a regular file) is refused: nobody can say it is stale.
function readLock(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw lockError('The data folder lock is unreadable', 'DATA_FOLDER_LOCK_UNREADABLE');
  }
  try {
    const info = fs.fstatSync(descriptor);
    const pid = Number(fs.readFileSync(descriptor, 'utf8').trim());
    if (!info.isFile() || !Number.isInteger(pid) || pid <= 0) {
      throw lockError('The data folder lock is unreadable', 'DATA_FOLDER_LOCK_UNREADABLE');
    }
    return { pid, ino: info.ino, dev: info.dev };
  } finally {
    fs.closeSync(descriptor);
  }
}

// Takes the lock for this process, or throws DATA_FOLDER_LOCK_HELD (a live process has
// it), DATA_FOLDER_LOCK_UNREADABLE, or DATA_FOLDER_LOCK_BUSY (others kept taking it).
// Returns the pid of a stale holder it replaced, if any.
function takeDataFolderLock(lock, { pid = process.pid, isAlive = processAlive, attempts = 5 } = {}) {
  let tookOverFrom = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.writeFileSync(lock, String(pid), { flag: 'wx', mode: 0o600 });
      return { tookOverFrom };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readLock(lock);
    if (!holder) continue; // released meanwhile
    if (isAlive(holder.pid)) throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', holder.pid);
    const aside = `${lock}.stale-${pid}-${crypto.randomBytes(6).toString('hex')}`;
    try { fs.renameSync(lock, aside); } catch (error) {
      if (error.code === 'ENOENT') continue; // another process moved it first
      throw error;
    }
    let moved = null;
    try { moved = readLock(aside); } catch (_error) { /* not the file judged stale */ }
    if (!moved || moved.pid !== holder.pid || moved.ino !== holder.ino || moved.dev !== holder.dev || isAlive(moved.pid)) {
      // Another process took the stale lock over between the read and the rename: its
      // lock is put back as it was (the same file, so its own release still knows it),
      // unless a lock is already there again.
      try { fs.linkSync(aside, lock); } catch (_error) { /* a lock is there again */ }
      try { fs.unlinkSync(aside); } catch (_error) { /* gone */ }
      throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', moved ? moved.pid : null);
    }
    fs.unlinkSync(aside);
    tookOverFrom = holder.pid;
  }
  throw lockError('The data folder lock kept changing', 'DATA_FOLDER_LOCK_BUSY');
}

module.exports = { takeDataFolderLock, processAlive };

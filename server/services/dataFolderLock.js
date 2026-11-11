const fs = require('node:fs');

// The lock one process at a time holds on a data folder (server.lock: scripts/start.mjs,
// and server/scripts/rotate-push-keys.js while it writes the stores). It is made with
// O_EXCL and names its process. One naming a process that is gone is taken over only
// inside a second lock beside it, server.lock.takeover, made the same way: in there the
// lock is read again and, if it still names a process that is gone, removed and made
// afresh with O_EXCL. One process at a time is inside, so none removes a lock another has
// just taken over, and nothing is renamed or linked (some filesystems have no hard
// links). A takeover lock whose process is gone (it died inside) is judged by its pid
// too, and removed only while it is still the file that was judged. A process removes no
// takeover lock but its own on the way out.

const TAKEOVER_SUFFIX = '.takeover';
const BUSY_WAIT_MS = 20;
const LOCK_MODE = 0o600;

function lockError(message, code, pid) {
  return Object.assign(new Error(message), { code, pid });
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
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

function sameFile(filename, owned) {
  let now;
  try { now = fs.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return !now.isSymbolicLink() && now.ino === owned.ino && now.dev === owned.dev;
}

// Makes filename with O_EXCL, naming pid, and returns the fstat of the descriptor it
// made: the file this process owns. One it made but could not finish is removed again.
// EEXIST when it is there already.
function createLock(filename, pid) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filename, flags, LOCK_MODE);
  let made = null;
  try {
    made = fs.fstatSync(descriptor);
    const text = Buffer.from(String(pid));
    let written = 0;
    while (written < text.length) {
      const count = fs.writeSync(descriptor, text, written);
      if (count <= 0) throw lockError('The data folder lock could not be written', 'DATA_FOLDER_LOCK_WRITE');
      written += count;
    }
    return fs.fstatSync(descriptor);
  } catch (error) {
    if (made && sameFile(filename, made)) {
      try { fs.unlinkSync(filename); } catch (_cleanupError) { /* gone */ }
    }
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
}

// Enters the takeover lock: its fstat, or null while another live process is inside.
function enterTakeover(guard, pid, isAlive) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return createLock(guard, pid); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const inside = readLock(guard);
    if (!inside) continue; // left meanwhile
    if (isAlive(inside.pid)) return null;
    // Its process died inside: removed while it is still the file judged.
    if (sameFile(guard, inside)) {
      try { fs.unlinkSync(guard); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return null;
}

// Takes the lock for this process, or throws DATA_FOLDER_LOCK_HELD (a live process has
// it), DATA_FOLDER_LOCK_UNREADABLE, or DATA_FOLDER_LOCK_BUSY (another process kept taking
// it over). Returns the pid of a stale holder it replaced, if any, and the fstat of the
// lock it made (stat), which is how its release knows the file is still its own.
function takeDataFolderLock(lock, { pid = process.pid, isAlive = processAlive, attempts = 5, wait = sleep } = {}) {
  const guard = `${lock}${TAKEOVER_SUFFIX}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return { tookOverFrom: null, stat: createLock(lock, pid) }; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readLock(lock);
    if (!holder) continue; // released meanwhile
    if (isAlive(holder.pid)) throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', holder.pid);
    const entered = enterTakeover(guard, pid, isAlive);
    if (!entered) { wait(BUSY_WAIT_MS); continue; }
    try {
      const stale = readLock(lock);
      if (stale && isAlive(stale.pid)) throw lockError('The data folder is in use', 'DATA_FOLDER_LOCK_HELD', stale.pid);
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

module.exports = { takeDataFolderLock, processAlive };

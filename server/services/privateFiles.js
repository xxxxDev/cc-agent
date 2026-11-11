const fs = require('node:fs');
const path = require('node:path');

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const DATASTORE_MODES = Object.freeze({
  fileMode: PRIVATE_FILE_MODE,
  dirMode: PRIVATE_DIR_MODE,
});

function privateStorageError(message) {
  return Object.assign(new Error(message), { code: 'PRIVATE_STORAGE_INVALID' });
}

function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true, mode: PRIVATE_DIR_MODE });
  const info = fs.lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw privateStorageError(`private storage directory is not a real directory: ${resolved}`);
  }
  fs.chmodSync(resolved, PRIVATE_DIR_MODE);
  return resolved;
}

function hardenExistingPrivateFile(filename) {
  const resolved = path.resolve(filename);
  let info;
  try {
    info = fs.lstatSync(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw privateStorageError(`private storage file is not a regular file: ${resolved}`);
  }
  fs.chmodSync(resolved, PRIVATE_FILE_MODE);
  return true;
}

// NeDB ends a line of its data file at \n and also at \r, \v, \f, U+0085, U+2028 and
// U+2029 (lib/byline.js). JSON.stringify escapes all of those except the last three, so a
// document with one of them in a string (a User-Agent, a name, a notice's text) was
// written as one line and read back as broken pieces: dropped quietly, or the whole store
// refused once a tenth of its lines broke. They are written as JSON escapes instead.
// Reading needs no undoing, since JSON.parse turns the escapes back into the characters,
// so files written before this read as they always did.
const NEDB_LINE_BREAKS = /[\u0085\u2028\u2029]/g;
function escapeNedbLineBreaks(line) {
  return line.replace(NEDB_LINE_BREAKS, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
const NEDB_LINE_HOOKS = Object.freeze({
  afterSerialization: escapeNedbLineBreaks,
  beforeDeserialization: (line) => line,
});

function privateDatastoreOptions(filename) {
  const resolved = path.resolve(filename);
  ensurePrivateDirectory(path.dirname(resolved));
  hardenExistingPrivateFile(resolved);
  // NeDB may recover this crash-safe companion into the live filename.
  hardenExistingPrivateFile(`${resolved}~`);
  return {
    filename: resolved,
    autoload: true,
    modes: { ...DATASTORE_MODES },
    ...NEDB_LINE_HOOKS,
  };
}

function appendPrivateJsonLine(filename, value) {
  const resolved = path.resolve(filename);
  ensurePrivateDirectory(path.dirname(resolved));
  hardenExistingPrivateFile(resolved);
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_APPEND
    | (fs.constants.O_CLOEXEC || 0)
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(resolved, flags, PRIVATE_FILE_MODE);
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile()) throw privateStorageError(`private log is not regular: ${resolved}`);
    fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    let pending = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    while (pending.length) {
      const written = fs.writeSync(descriptor, pending);
      if (written <= 0) throw privateStorageError(`private log write stalled: ${resolved}`);
      pending = pending.subarray(written);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = {
  DATASTORE_MODES,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  appendPrivateJsonLine,
  NEDB_LINE_HOOKS,
  ensurePrivateDirectory,
  escapeNedbLineBreaks,
  hardenExistingPrivateFile,
  privateDatastoreOptions,
};

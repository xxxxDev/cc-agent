const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const DATASTORE_MODES = Object.freeze({
  fileMode: PRIVATE_FILE_MODE,
  dirMode: PRIVATE_DIR_MODE,
});

// The path is kept apart too (reason, path), so a caller that must not print paths can
// leave it out.
function privateStorageError(reason, filePath) {
  const message = filePath ? `${reason}: ${filePath}` : reason;
  return Object.assign(new Error(message), { code: 'PRIVATE_STORAGE_INVALID', reason, path: filePath });
}

function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true, mode: PRIVATE_DIR_MODE });
  const info = fs.lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw privateStorageError('private storage directory is not a real directory', resolved);
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
    throw privateStorageError('private storage file is not a regular file', resolved);
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

// A file written before those escapes may still hold the raw characters, and NeDB splits
// its lines before any hook runs: such a record is dropped on load, gone for good at the
// next compaction, and a file with more than a tenth of its lines broken does not load at
// all. The raw characters are escaped in the file itself before a store loads it. That is
// lossless: NeDB joins records with \n only, and JSON.stringify writes \n, \r, \v and \f
// as escapes and never puts these three outside a string, so each one sits inside a JSON
// string, where \uXXXX means the same character. It is done on the UTF-8 bytes (C2 85,
// E2 80 A8, E2 80 A9: a lead byte is never a continuation byte, so each is that character
// wherever it is), so every other byte stays as it was.
const RAW_NEDB_LINE_BREAKS = Object.freeze([
  { name: 'U+0085', bytes: Buffer.from('\u0085', 'utf8'), escape: Buffer.from('\\u0085', 'ascii') },
  { name: 'U+2028', bytes: Buffer.from(' ', 'utf8'), escape: Buffer.from('\\u2028', 'ascii') },
  { name: 'U+2029', bytes: Buffer.from(' ', 'utf8'), escape: Buffer.from('\\u2029', 'ascii') },
]);

// The bytes with every raw U+0085, U+2028 and U+2029 written as its JSON escape, and how
// many of each there were. A buffer without any comes back as it is.
function escapeRawNedbLineBreaks(buffer) {
  const characters = Object.fromEntries(RAW_NEDB_LINE_BREAKS.map(({ name }) => [name, 0]));
  if (!RAW_NEDB_LINE_BREAKS.some(({ bytes }) => buffer.includes(bytes))) {
    return { buffer, characters, total: 0 };
  }
  const parts = [];
  let start = 0;
  let total = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const lead = buffer[index];
    if (lead !== 0xc2 && lead !== 0xe2) continue;
    const found = RAW_NEDB_LINE_BREAKS.find(({ bytes }) => buffer[index] === bytes[0]
      && buffer.subarray(index, index + bytes.length).equals(bytes));
    if (!found) continue;
    parts.push(buffer.subarray(start, index), found.escape);
    characters[found.name] += 1;
    total += 1;
    index += found.bytes.length - 1;
    start = index + 1;
  }
  parts.push(buffer.subarray(start));
  return { buffer: Buffer.concat(parts), characters, total };
}

// Makes filename (it must not exist) with these bytes, mode 600, synced. A file it made
// but could not finish is removed again, so a full disk leaves nothing behind.
function writeNewPrivateFile(filename, buffer) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filename, flags, PRIVATE_FILE_MODE);
  try {
    fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    let pending = buffer;
    while (pending.length) {
      const written = fs.writeSync(descriptor, pending);
      if (written <= 0) throw privateStorageError('private file write stalled');
      pending = pending.subarray(written);
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(filename); } catch (_cleanupError) { /* gone */ }
    throw error;
  }
  fs.closeSync(descriptor);
}

// Writes the bytes to `temporary`, synced, then renames it to filename: a file under
// filename is always whole. On any error the temporary file is removed.
function writeDurablePrivateFile(filename, buffer, temporary) {
  writeNewPrivateFile(temporary, buffer);
  try {
    fs.renameSync(temporary, filename);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_cleanupError) { /* gone */ }
    throw error;
  }
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

// The file NeDB will read for this store: the store itself, or, when it is missing, the
// crash-safe companion NeDB then moves into its place. Null when there is neither.
function nedbFileToLoad(filename) {
  for (const candidate of [filename, `${filename}~`]) {
    let info;
    try { info = fs.lstatSync(candidate); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw privateStorageError('private storage file is not a regular file', candidate);
    }
    return candidate;
  }
  return null;
}

// Escapes the raw characters in the file a store is about to load. The original is kept
// first, byte for byte, beside it (a new name, mode 600, written under a temporary name,
// synced, then renamed to it); the escaped copy is then written to a temporary file,
// synced, and renamed over the store, so a crash leaves the store either as it was or
// repaired, and the backup in both cases. Only when nothing changed the file meanwhile is
// it replaced. An error before the store is replaced removes this run's files, the backup
// too, since the store is as it was: a full disk at every start adds nothing. A file
// without any is not touched.
function repairRawNedbLineBreaks(filename) {
  const resolved = path.resolve(filename);
  const target = nedbFileToLoad(resolved);
  if (!target) return { repaired: false, total: 0 };
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let original;
  let before;
  try {
    before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw privateStorageError('private storage file is not a regular file', target);
    original = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const { buffer, characters, total } = escapeRawNedbLineBreaks(original);
  const file = path.basename(target);
  if (!total) return { repaired: false, file, characters, total };
  const directory = path.dirname(target);
  const tag = `${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const backup = path.join(directory, `${file}.before-line-break-repair-${tag}`);
  const temporary = path.join(directory, `.${file}.line-break-repair-${tag}`);
  writeDurablePrivateFile(backup, original, path.join(directory, `.${path.basename(backup)}`));
  try {
    syncDirectory(directory);
    writeNewPrivateFile(temporary, buffer);
    const now = fs.lstatSync(target);
    if (now.ino !== before.ino || now.dev !== before.dev || now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
      throw privateStorageError('private storage file changed while it was being repaired', target);
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_cleanupError) { /* not made, or renamed */ }
    try { fs.unlinkSync(backup); } catch (_cleanupError) { /* gone */ }
    throw error;
  }
  syncDirectory(directory);
  return { repaired: true, file, characters, total, backup: path.basename(backup) };
}

function reportRepair(result) {
  console.warn(`[stores] ${result.file}: ${result.total} raw line break(s) written as escapes; the original is kept as ${result.backup}`);
}

function privateDatastoreOptions(filename, { onRepair = reportRepair } = {}) {
  const resolved = path.resolve(filename);
  ensurePrivateDirectory(path.dirname(resolved));
  hardenExistingPrivateFile(resolved);
  // NeDB may recover this crash-safe companion into the live filename.
  hardenExistingPrivateFile(`${resolved}~`);
  const repair = repairRawNedbLineBreaks(resolved);
  if (repair.repaired && onRepair) onRepair(repair);
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
    if (!info.isFile()) throw privateStorageError('private log is not regular', resolved);
    fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    let pending = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    while (pending.length) {
      const written = fs.writeSync(descriptor, pending);
      if (written <= 0) throw privateStorageError('private log write stalled', resolved);
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
  escapeRawNedbLineBreaks,
  repairRawNedbLineBreaks,
  hardenExistingPrivateFile,
  privateDatastoreOptions,
};

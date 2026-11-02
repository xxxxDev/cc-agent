// Reads one file an agent named, for attachments.fromPaths, in a process of its own: the
// service must not change its working directory. Standing in the file's folder ties
// the read to that folder itself, whatever its path names by now: process.cwd() reports
// where this process really is, so a parent folder swapped for a link is seen, and the
// file is then opened relative to the folder, past no parent at all, and not through a
// link (security audit, 2026-11-03: the agent could swap the name between the service's
// check and its read). The bytes go to stdout. Exit 3: not that file. Exit 4: wrong size.
const fs = require('node:fs');
const [dir, name, singleName, limit] = process.argv.slice(2);
const max = Number(limit);
try {
  process.chdir(dir);
  if (process.cwd() !== dir) process.exit(3);
  // Windows has no O_NOFOLLOW, so the name is looked at first there.
  if (!fs.constants.O_NOFOLLOW && !fs.lstatSync(name).isFile()) process.exit(3);
  // Non-blocking, so a pipe put in the file's place cannot hang the read.
  const fd = fs.openSync(name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) process.exit(3);
  const buffer = Buffer.allocUnsafe(Math.min(stat.size, max) + 1);
  let size = 0;
  for (let got; size < buffer.length && (got = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0;) size += got;
  if (!size || size > max) process.exit(4);
  // Asked last, of the name and the open file together. A second name of a file outside the
  // agent's folders looks like a file inside them, and removing that name right after the
  // open would hide the count from the open file alone (independent review, 2026-11-03).
  const open = fs.fstatSync(fd, {bigint: true}), named = fs.lstatSync(name, {bigint: true});
  if (named.dev !== open.dev || named.ino !== open.ino || (singleName === '1' && (open.nlink !== 1n || named.nlink !== 1n))) process.exit(3);
  for (let sent = 0; sent < size;) sent += fs.writeSync(1, buffer, sent, size - sent);
} catch {
  process.exit(3);
}

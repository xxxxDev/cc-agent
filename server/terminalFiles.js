// A file dropped or pasted on an agent's terminal is kept
// in that chat's own attachment folder, exactly as a chat attachment is (the same upload, its
// owner check, size limits and unsent quota: attachments.put), and its path is typed into the
// terminal, as a desktop terminal does with a dropped file. Only where the agent can read it:
// - a full-access agent reads anything of its owner's;
// - a scoped agent reads its attachment folder only when the runner opened it for it, which
//   it does when the folder holds nothing but plain files whose names do not start with a
//   dot (channel/runner.mjs plainFiles: a folder added to the sandbox could otherwise carry
//   settings or links). The same test is made here; a folder that fails it keeps such an
//   agent's files in the chat, and the page says why.
// Anything but a Claude agent (a command agent, a demo) has no terminal for this.
const fs = require('node:fs');

// The runner's plainFiles, the folder looked at again only when it changed.
const cache = new Map();
function plainFolder(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return true; }   // made empty at the next launch
  if (!st.isDirectory()) return false;
  const key = st.mtimeMs + ':' + st.ino, hit = cache.get(dir);
  if (hit && hit.key === key) return hit.value;
  let value = false;
  try { value = fs.readdirSync(dir, {withFileTypes: true}).every(e => e.isFile() && !e.name.startsWith('.')); } catch {}
  cache.set(dir, {key, value});
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// {ok} or {ok:false, reason}: reason is shown on the page.
function access({mode, archived = false, full = false, dir}) {
  if (mode !== 'claude' || archived) return {ok: false, reason: 'no-terminal'};
  if (full) return {ok: true};
  return plainFolder(dir) ? {ok: true} : {ok: false, reason: 'unreadable'};
}

module.exports = {access, plainFolder};

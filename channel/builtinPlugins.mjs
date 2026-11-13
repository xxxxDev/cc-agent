// Claude Code's built-in plugins (name@builtin), as a scoped agent's launch switches them off
// (channel/runner.mjs). Claude Code ships them inside its own
// program (cc-plugin-easel, cc-plugin-plugin-authoring, cc-plugin-diff and others): a tool one
// registers (mcp__easel__chart) never reaches a PreToolUse hook, --setting-sources does not stop
// them, and Claude Code has no setting that switches them all off, so each is switched off by id
// (enabledPlugins false, which removes a plugin and its tools: tried on 2.1.323) and its tools
// denied by name. Their names are read from the program file itself, every "cc-plugin-<name>"
// literal in it, kept per file (path, size, time) in a small cache. Where the file cannot be
// read or holds none (a launcher script whose runtime is not known, a build that names them
// otherwise), the names known from 2.1.323 are used and the launch says the list was not
// checked (known: false), so the server raises a notice.
// Kept on: the built-ins that guard rather than add (sec-default, privacy) and telemetry, which
// carries no tool; switching off a guard would weaken what the agent is held to.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const KNOWN = ['agents-md', 'claude-platform', 'claude-test', 'diff', 'easel', 'mermaid', 'mods-guide', 'plugin-authoring', 'privacy', 'responsive-mode', 'sec-default', 'telemetry', 'tips', 'you-should-know'];
export const KEEP = new Set(['sec-default', 'privacy', 'telemetry']);
const PREFIX = Buffer.from('"cc-plugin-');

// Every "cc-plugin-<name>" literal in a file, read in pieces (the program is over 300 MB).
export function scan(file) {
  const names = new Set(), size = 16 * 1024 * 1024, overlap = 64;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size + overlap);
    let pos = 0, carry = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, carry, size, pos);
      if (n <= 0) break;
      const end = carry + n;
      for (let i = buf.indexOf(PREFIX, 0); i >= 0 && i < end; i = buf.indexOf(PREFIX, i + 1)) {
        let j = i + PREFIX.length;
        while (j < end && /[a-z0-9-]/.test(String.fromCharCode(buf[j]))) j++;
        if (j < end && buf[j] === 0x22 && j - i - PREFIX.length >= 2 && j - i - PREFIX.length <= 40) names.add(buf.toString('latin1', i + PREFIX.length, j));
      }
      pos += n;
      carry = Math.min(overlap, end);
      buf.copy(buf, 0, end - carry, end);
      if (n < size) break;
    }
  } finally { fs.closeSync(fd); }
  return [...names].sort();
}

// The program file itself; a launcher script (#!) gives null, so the known list and the notice apply.
function programOf(file) {
  try {
    const head = Buffer.alloc(2), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
    return head.toString('latin1') === '#!' ? null : file;
  } catch { return null; }
}

// {names, known}: the built-in plugins of the program at `file` to switch off, and whether they
// were read from it. cacheFile: where to keep what a scan found, or null.
export function builtinPlugins(file, {home = os.homedir(), cacheFile = null} = {}) {
  let found = null;
  const program = file ? programOf(file) : null;
  if (program) {
    let key = null;
    try { const st = fs.statSync(program); key = `${program}|${st.size}|${st.mtimeMs}`; } catch {}
    let cache = {};
    if (key && cacheFile) { try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {}; } catch { cache = {}; } }
    if (key && Array.isArray(cache[key])) found = cache[key];
    else if (key) {
      try { found = scan(program); } catch { found = null; }
      if (found && found.length && cacheFile) {
        try { const tmp = cacheFile + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ [key]: found }), { mode: 0o600 }); fs.renameSync(tmp, cacheFile); } catch {}
      }
    }
  }
  const known = !!(found && found.length);
  const names = [...new Set([...(known ? found : []), ...KNOWN])].filter((n) => !KEEP.has(n)).sort();
  return { names, known };
}

// What a scoped agent's settings get for them: each off by id, in both spellings Claude Code
// takes (name@builtin and cc-plugin-name@builtin), and its tools denied by name.
export function builtinSettings(names) {
  const ids = names.flatMap((n) => [`${n}@builtin`, `cc-plugin-${n}@builtin`]);
  return { enabledPlugins: Object.fromEntries(ids.map((id) => [id, false])), deny: names.flatMap((n) => [`mcp__${n}`, `mcp__cc-plugin-${n}`]) };
}

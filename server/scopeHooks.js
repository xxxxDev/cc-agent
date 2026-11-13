// What the scope refused, from Claude Code's own hooks, in place of reading the agent's
// transcript. A scoped agent's --settings (channel/runner.mjs)
// carry four hooks, each running channel/scope-hook.sh: PermissionDenied (the auto-mode
// classifier blocked a call), PostToolBatch (every call of a batch with what the model was
// shown), PostToolUseFailure on Bash (a command that failed), and PostToolUse on the file tools
// (only the call's id is kept: the call succeeded). The hook keeps an event only when it
// carries a refusal marker (PermissionDenied always). Each event is one file in the agent's
// spool folder, control-g<n>/scope-spool; agentStore's scope intake reads it (list, read) when
// the relay timer, a turn's end, Esc, a stop or a session found gone wakes it.
//
// Why the agent's own tools cannot write or remove an event: the spool sits in the
// generation's control folder, beside runtime.json and settings.json, which the agent's
// sandbox can neither read nor write (denyRead ~, allowWrite only its workspace, temp and
// granted folders; CC Agent's data folder can never be granted, agentAccess.protectedRoots)
// and its file tools cannot reach (--restricted). Claude Code runs hooks outside the sandbox,
// as the user running CC Agent, from the --settings it read at start, which the agent cannot
// change. So a file in the spool was written by the hook, and the hook writes only what Claude
// Code handed it. Nothing comes over the network, so there is no secret to hold. What the
// agent does decide is the content: the commands it runs and what they print. That is data
// here, never trusted as more. (A program the agent may run outside the sandbox, or an MCP
// server it was given, runs as that user too, and is outside this guarantee.)
//
// What is matched, and how:
// - PermissionDenied: always a refusal, of its own kind ('classifier'): widening the scope
//   would not let it through.
// - File tools (PostToolBatch): only an entry with no PostToolUse for its id (the call did not
//   succeed) whose result is exactly one of Claude Code's own refusal sentences for that path,
//   as read from 2.1.322 and its hooks (fileRefusal); one that still names --restricted, in no
//   form known, is filed as text matched.
// - Bash (PostToolUseFailure): the refusal patterns (BLOCKED). A command can print the same
//   words, so a decoy cannot be told apart; those are filed after the exact ones.
// Not caught: a refusal the command swallows (`| head`, `|| true`): Claude Code reports success.
const fs = require('node:fs');
const path = require('node:path');

const SPOOL = 'scope-spool';
// The Claude Code these hooks were measured on (PermissionDenied, PostToolBatch and
// PostToolUseFailure with tool_use_id): older ones bring the notice. The hooks are
// written into --settings only from HOOKS_MIN, where both event names exist, so an older
// Claude Code never meets a settings file it might refuse whole, sandbox and deny rules with it.
const MIN_VERSION = '2.1.322', HOOKS_MIN = '2.1.318';
const EVENTS = new Set(['PermissionDenied', 'PostToolBatch', 'PostToolUseFailure', 'PreToolUse']);
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS'];
const FILE_TOOL = new Set(FILE_TOOLS);
// The hook keeps an event's first 256 KiB (channel/scope-hook.sh), a safety limit: real events
// were at most 32 KB. A batch cut so is read to its last whole call (the id comes before each
// call's result, and a refusal's result is short); any other event cut so is counted as not
// kept. A larger file (an older hook's) is not read.
const MAX_EVENT_BYTES = 256 * 1024;
// A file the hook is still writing (.in.<random>) that has not been renamed this long after
// it was made is a hook that died: removed.
const STALE_MS = 60_000;
const NAME = /^([A-Za-z0-9]{6,20})\.(ev|ids)$/;
const TOOL_ID = /^[A-Za-z0-9_-]{1,200}$/;

const quote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
// The hooks for a scoped agent's --settings: /bin/sh, a 10 s limit, and the script always
// exits 0, so a hook can neither hold up nor fail a tool call. PermissionDenied is always kept
// (pd); a batch or a failed command only when it carries a refusal marker (ev); a file tool
// call that succeeded only its id, and only when its result carries one (ids).
function hookSettings(script, spool) {
  const run = (kind) => ({ type: 'command', command: ['/bin/sh', script, spool, kind].map(quote).join(' '), timeout: 10 });
  return {
    PermissionDenied: [{ hooks: [run('pd')] }],
    PostToolBatch: [{ hooks: [run('ev')] }],
    PostToolUseFailure: [{ matcher: 'Bash', hooks: [run('ev')] }],
    PostToolUse: [{ matcher: FILE_TOOLS.join('|'), hooks: [run('ids')] }],
  };
}

// a >= b, both x.y.z.
function atLeast(a, b) {
  const p = (v) => String(v).split('.').map((n) => Number(n));
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return true;
}
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const supported = (version) => typeof version === 'string' && VERSION.test(version) && atLeast(version, MIN_VERSION);
const hooksAccepted = (version) => typeof version === 'string' && VERSION.test(version) && atLeast(version, HOOKS_MIN);

const spoolDir = (control) => path.join(control, SPOOL);

// The spool, read without holding the server: every call
// below is asynchronous and takes one file at a time, so the server's event loop turns between
// any two files, however many wait. agentStore's intake decides which spool and when.
//
// list(): what waits in a spool, oldest first, as {files: [{name, kind, at, size}], notes,
// taken}; null when there is no spool; {unsafe: true} when it is not a plain folder of this
// account's (a link, another owner's). Only plain files named as the hook names them are kept;
// anything else is removed. notes: what could not be taken, each with a key of its own (the
// file's name) so the same file is never counted twice: 'full' (events the hook did not write
// because the spool was full: dropped.count, one byte each) and 'cut' (a PostToolUse too large
// to copy: large.count). Those counters are moved aside first (taken), so a byte the hook adds
// meanwhile goes to a new one; the caller removes them once it has counted them. cache: a Map
// the caller keeps for this spool (name: time and size), so a file is looked at once, not at
// every listing. heard: the hook has run since the last launch (it makes an empty file, heard,
// on every call while there is none; agentStore removes it at a launch).
const fsp = fs.promises;
// When this server first saw each .in. file (list), by its monotonic clock; let go once gone.
const firstSeen = new Map();
const PENDING = 'pending.count', HEARD = 'heard', BAD = 'scope-bad', BAD_KEPT = 100, BAD_DAYS = 7;
const MARKERS = [{ file: 'dropped.count', tag: 'dropped', why: 'full' }, { file: 'large.count', tag: 'large', why: 'cut' }];
const ownFolder = (st) => st.isDirectory() && !st.isSymbolicLink() && (typeof process.getuid !== 'function' || st.uid === process.getuid());
async function list(dir, cache = new Map()) {
  let st;
  try { st = await fsp.lstat(dir); } catch { return null; }
  if (!ownFolder(st)) return { unsafe: true };
  let names;
  try { names = await fsp.readdir(dir); } catch { return { unsafe: true }; }
  // Still the same folder after the listing (not swapped for a link meanwhile).
  try { const again = await fsp.lstat(dir); if (!ownFolder(again) || again.ino !== st.ino || again.dev !== st.dev) return { unsafe: true }; } catch { return null; }
  const now = Date.now(), files = [], notes = [], taken = [], here = new Set(names);
  for (const name of cache.keys()) if (!here.has(name)) cache.delete(name);
  for (const k of firstSeen.keys()) if (path.dirname(k) === dir && !here.has(path.basename(k))) firstSeen.delete(k);
  let seen = 0;
  for (const name of names) {
    // A long listing whose files are mostly known yields now and then all the same.
    if (++seen % 1000 === 0) await new Promise((r) => setImmediate(r));
    if (name === PENDING || name === HEARD) continue;
    const file = path.join(dir, name);
    const known = cache.get(name);
    if (known) { files.push(known); continue; }
    // A file the hook is still writing: removed once this server has seen it for STALE_MS by its
    // own monotonic clock (an mtime against the wall clock would be wrong after a clock change).
    if (name.startsWith('.in.')) {
      const k = file, first = firstSeen.get(k) ?? (firstSeen.set(k, performance.now()), performance.now());
      if (performance.now() - first > STALE_MS) { try { await fsp.rm(file, { force: true }); } catch {} firstSeen.delete(k); }
      continue;
    }
    const marker = MARKERS.find((x) => name === x.file || name.startsWith('.taken-' + x.tag + '.'));
    if (marker) {
      let moved = file;
      if (name === marker.file) { moved = path.join(dir, '.taken-' + marker.tag + '.' + process.pid + '.' + now + '.' + Math.random().toString(36).slice(2, 8)); try { await fsp.rename(file, moved); } catch { continue; } }
      try { const d = await fsp.lstat(moved); if (d.isFile() && d.size) notes.push({ why: marker.why, key: path.basename(moved), n: Math.min(d.size, 1e9) }); } catch {}
      taken.push(moved);
      continue;
    }
    const m = NAME.exec(name);
    let s;
    try { s = await fsp.lstat(file); } catch { continue; }
    if (!m || !s.isFile()) { try { await fsp.rm(file, { force: true, recursive: true }); } catch {} continue; }
    const f = { name, kind: m[2], at: s.mtimeMs, size: s.size };
    cache.set(name, f);
    files.push(f);
  }
  files.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files, notes, taken, heard: here.has(HEARD) };
}
// One file of a spool: {events, ids, note} (note 'dropped' when it is not an event the hooks
// send, too large or unreadable; 'cut' when it was kept only in part). Opened without following
// a link. ids: the last tool_use_id in it, where Claude Code puts the call's own.
async function read(dir, f) {
  let text = null, h;
  try {
    h = await fsp.open(path.join(dir, f.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = await h.stat();
    if (st.isFile() && st.size <= MAX_EVENT_BYTES) text = await h.readFile('utf8');
  } catch {} finally { if (h) try { await h.close(); } catch {} }
  // Not readable (EACCES), gone between the listing and now, a link or too large: counted as
  // dropped, as an event that could not be read; the hook writes its files 0600 as this
  // account, so none of these happens to one of its own.
  if (text === null) return { events: [], ids: [], note: 'dropped' };
  if (f.kind === 'ids') {
    const all = [...text.matchAll(/"tool_use_id"\s*:\s*"([A-Za-z0-9_-]{1,200})"/g)];
    return { events: [], ids: all.length ? [all.at(-1)[1]] : [] };
  }
  let payload;
  try { payload = JSON.parse(text); } catch {
    // Cut at the hook's limit: a batch's whole calls are kept, anything else is not.
    const big = Buffer.byteLength(text) >= MAX_EVENT_BYTES, head = big ? batchHead(text) : null;
    return head ? { events: [head], ids: [], note: 'cut' } : { events: [], ids: [], note: big ? 'cut' : 'dropped' };
  }
  // A PreToolUse event is only ever the scope gate's refusal, which carries its mark.
  if (!payload || typeof payload !== 'object' || !EVENTS.has(payload.hook_event_name) || (payload.hook_event_name === 'PreToolUse' && !(payload.cc_agent_gate && typeof payload.cc_agent_gate === 'object'))) return { events: [], ids: [], note: 'dropped' };
  return { events: [payload], ids: [] };
}
const remove = async (dir, names) => { for (const n of names) { try { await fsp.rm(path.isAbsolute(n) ? n : path.join(dir, n), { force: true }); } catch {} } };
// The hook's count of what it wrote starts again: everything it had written has been read.
const restartCount = (dir) => fsp.rm(path.join(dir, PENDING), { force: true }).catch(() => {});
// Files whose filing kept failing go to scope-bad beside the spool, the newest BAD_KEPT of
// the last BAD_DAYS kept; returns how many were moved.
async function quarantine(dir, names) {
  const bad = path.join(path.dirname(dir), BAD);
  let moved = 0;
  try { await fsp.mkdir(bad, { recursive: true, mode: 0o700 }); } catch { return 0; }
  for (const n of names) { try { await fsp.rename(path.join(dir, n), path.join(bad, n)); moved += 1; } catch {} }
  try {
    const kept = [];
    for (const n of await fsp.readdir(bad)) { try { kept.push({ n, at: (await fsp.lstat(path.join(bad, n))).mtimeMs }); } catch {} }
    kept.sort((a, b) => b.at - a.at);
    for (const [i, x] of kept.entries()) if (i >= BAD_KEPT || x.at < Date.now() - BAD_DAYS * 86400_000) { try { await fsp.rm(path.join(bad, x.n), { force: true }); } catch {} }
  } catch {}
  return moved;
}
// The whole calls at the start of a PostToolBatch cut short: the text up to "tool_calls":[ is
// Claude Code's own fields, then each call an object, read while one ends before the cut.
function batchHead(text) {
  const at = text.indexOf('"tool_calls":[');
  if (at < 0 || !/"hook_event_name"\s*:\s*"PostToolBatch"/.test(text.slice(0, at))) return null;
  const agent = /"agent_id"\s*:\s*"([A-Za-z0-9_-]{1,200})"/.exec(text.slice(0, at));
  const calls = [];
  let i = at + '"tool_calls":['.length;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i += 1;
    if (text[i] !== '{') break;
    let depth = 0, inString = false, end = -1;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) { if (ch === '\\') j += 1; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true; else if (ch === '{') depth += 1; else if (ch === '}') { depth -= 1; if (!depth) { end = j; break; } }
    }
    if (end < 0) break;
    try { calls.push(JSON.parse(text.slice(i, end + 1))); } catch { break; }
    i = end + 1;
  }
  return { hook_event_name: 'PostToolBatch', tool_calls: calls, ...(agent ? { agent_id: agent[1] } : {}) };
}

// Claude Code's own refusals of its file tools, as read from 2.1.322 (`strings` of the binary)
// and as a hook sees them: on their own, after "Error: ", or inside
// <tool_use_error> when the call's input check refused it. Under --restricted (CC Agent's
// scoped agents), for a path outside the agent's folders:
//   plain:      "<path> is outside <folders>[ (letter case counts: <path> is inside)]; --restricted …"
//   symlink:    "<path> resolves through a symlink to <real path>, which is outside <folders>; --restricted …"
//   unresolved: "Where <path> leads on disk could not be determined (a link or directory on the way
//               could not be examined, or the links do not resolve); --restricted …"
// and for a deny rule: "Permission to read|edit <path> has been denied." and the three
// REFUSAL_SENTENCES. Only the symlink form has been seen on a real run; the others
// are from the binary only. In the symlink and unresolved forms each path is printed as Claude
// Code shortens it (sx): whole up to 160 characters (UTF-16 units), else its first 160 and
// "… [+N chars]", N the characters left out; the plain form prints the path whole.
// Not CC Agent's scope, so not matched: "Refusing to read|write <path>: where it leads on disk
// could not be determined …" (without --restricted), "Refusing to write <path>: it is a symbolic
// link …", and Claude Code's protection of its own config folder.
const REFUSAL_SENTENCES = new Set([
  'File is in a directory that is denied by your permission settings.',
  'File is covered by a Read deny rule in your permission settings and cannot be edited.',
  'File is covered by a Read deny rule in your permission settings and cannot be written.',
]);
const RESTRICTED_END = '; --restricted confines the file tools to the working directory.';
const SYMLINK = ' resolves through a symlink to ', WHICH_OUTSIDE = ', which is outside ';
const UNRESOLVED_END = ' leads on disk could not be determined (a link or directory on the way could not be examined, or the links do not resolve)' + RESTRICTED_END;
const SHORT_AT = 160, MAX_LEFT_OUT = 4096;
const MORE = /^… \[\+(\d{1,4}) chars\]/;
function unwrap(text) {
  const inner = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/.exec(text);
  const t = inner ? inner[1] : text;
  return t.startsWith('Error: ') ? t.slice('Error: '.length) : t;
}
const targetOf = (input) => [input?.file_path, input?.notebook_path, input?.path].find((v) => typeof v === 'string' && v) || null;
// The spellings Claude Code may print for the call's own path: as given, and made absolute
// (~ the home of the user running CC Agent, a relative one against the event's cwd).
function spellings(target, cwd, home) {
  if (typeof target !== 'string' || !target || target.length > 4000) return [];
  const out = [target];
  const expanded = target.replace(/^~(?=\/|$)/, home);
  if (path.isAbsolute(expanded)) out.push(path.resolve(expanded));
  else if (typeof cwd === 'string' && path.isAbsolute(cwd)) out.push(path.resolve(cwd, expanded));
  return [...new Set(out)];
}
// How long the part of `text` from `at` is that prints `p` as Claude Code does (whole, or its
// head and "… [+N chars]" with N exactly what was left out, bounded), or -1.
function printedAt(text, at, p) {
  if (text.startsWith(p, at)) return p.length;
  if (p.length <= SHORT_AT) return -1;
  for (const head of [SHORT_AT, SHORT_AT - 1]) {
    if (!text.startsWith(p.slice(0, head), at)) continue;
    const m = MORE.exec(text.slice(at + head, at + head + 20));
    if (m && Number(m[1]) === p.length - head) return head + m[0].length;
  }
  return -1;
}
// The real path as printed in the symlink form: {printed, full} (full: printed whole, so it is
// the path itself), or null when it cannot be one Claude Code printed: shortened past the bound,
// a head that is not one, or nothing.
function landingOf(printed) {
  if (!printed) return null;
  const short = /^([\s\S]*)… \[\+(\d+) chars\]$/.exec(printed);
  if (!short) return { printed, full: true };
  const head = short[1].length, left = Number(short[2]);
  if (head < 1 || head > SHORT_AT || left < 1 || left > MAX_LEFT_OUT) return null;
  return { printed, full: false };
}
// A path with a control or format character (a newline, a right-to-left mark, a zero-width
// space) is never suggested: what the admin would see is not what would be granted.
const UNSEEN = /[\p{Cc}\p{Cf}]/u;
// One of the forms above, for this call's own path: {suggest, symlink} or null. suggest: a path
// a grant could be suggested from, only one Claude Code printed whole: the call's own in the
// plain form, the real one in the symlink form (never the folder of the call's own path, which
// is only where the link is). None for the unresolved form, the deny rules, a shortened real
// path, or one whose printing may differ from the path (an escaped or replaced character).
function fileRefusal(text, input, cwd, home = require('node:os').homedir()) {
  if (REFUSAL_SENTENCES.has(text)) return {};
  if (text.includes('\n')) return null;
  const own = spellings(targetOf(input), cwd, home);
  for (const p of own) {
    // From the program text only (2.1.322): not seen on a real run.
    for (const verb of ['read', 'edit']) if (text === `Permission to ${verb} ${p} has been denied.`) return {};
    if (!text.endsWith(RESTRICTED_END)) continue;
    if (text.startsWith(p + ' is outside ')) return path.isAbsolute(p) && !UNSEEN.test(p) ? { suggest: p } : {};
    if (text.startsWith('Where ')) { const n = printedAt(text, 6, p); if (n > 0 && text.slice(6 + n) === UNRESOLVED_END) return {}; }
    const n = printedAt(text, 0, p);
    if (n < 0 || !text.startsWith(SYMLINK, n)) continue;
    // What follows is "<real path>, which is outside <folders>": taken only when that phrase
    // comes once, so a real path that holds it cannot move where the path ends.
    const rest = text.slice(n + SYMLINK.length, -RESTRICTED_END.length);
    const at = rest.indexOf(WHICH_OUTSIDE);
    if (at < 0 || rest.indexOf(WHICH_OUTSIDE, at + 1) >= 0) continue;
    const landing = landingOf(rest.slice(0, at));
    if (!landing) continue;
    const plain = landing.full && path.isAbsolute(landing.printed) && !/[�\\]/.test(landing.printed) && !UNSEEN.test(landing.printed);
    return { symlink: { from: text.slice(0, n), to: landing.printed }, ...(plain ? { suggest: landing.printed } : {}) };
  }
  return null;
}
// What a failed Bash command shows when the sandbox refused it (the patterns read from 2.1.322
// and real transcripts): a file or folder, a network connection through the sandbox's proxy, a
// path outside the folders. Text a command printed can match too. Each holds one of the hook's
// markers (channel/scope-hook.sh), or the hook would not have kept the event.
const BLOCKED = /Operation not permitted|operation not permitted| is outside |denied by your permission settings|deny network-outbound|sandbox_violations|has been denied by your rule|is covered by a \w+ deny rule in your permission settings|path outside the working directory|Path is outside allowed working directories|link chain (?:that )?cannot be followed|CONNECT tunnel failed, response 403|blocked by the sandbox proxy/;
const reasonOf = (v) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200) : '');

// The refusals in these events, in order: {kind: 'blocked' | 'classifier', id, tool, input,
// error, exact, target, suggest, symlink, program, subagent}. exact: Claude Code's own refusal,
// matched as a whole sentence for the call's own path; a missing PostToolUse alone never makes
// one (its hook may have been killed or timed out). A file tool's entry with no PostToolUse
// whose result still names --restricted, but in no form above, is filed as text matched, with
// no suggestion. used: the ids that had a PostToolUse (a call that succeeded), these added first.
function classify(events, ids = [], used = new Set()) {
  for (const id of ids) used.add(id);
  const out = [];
  const sub = (p) => (typeof p.agent_id === 'string' && TOOL_ID.test(p.agent_id) ? p.agent_id : null);
  const one = (p, x) => {
    if (typeof x.tool_use_id !== 'string' || !TOOL_ID.test(x.tool_use_id)) return null;
    const input = x.tool_input && typeof x.tool_input === 'object' ? x.tool_input : {};
    const command = typeof input.command === 'string' ? input.command : '';
    return { id: x.tool_use_id, tool: typeof x.tool_name === 'string' ? x.tool_name : '', input, target: targetOf(input), program: (/^\s*([^\s;|&]+)/.exec(command)?.[1] || '').split('/').pop().slice(0, 80), subagent: sub(p) };
  };
  for (const p of events) {
    // CC Agent's scope gate refused it (channel/scope-gate.mjs, the only PreToolUse hook a scoped
    // agent has, which writes only a refusal): its own decision, exact; a website not listed
    // suggests that website, a local or private address and an MCP server nothing.
    if (p.hook_event_name === 'PreToolUse') {
      const x = one(p, p), g = p.cc_agent_gate;
      if (!x || !g || typeof g !== 'object' || typeof g.why !== 'string') continue;
      const host = g.kind === 'web' && !g.local && typeof g.host === 'string' && /^[a-z0-9.-]{1,253}$/.test(g.host) ? g.host : null;
      out.push({ ...x, kind: 'blocked', exact: true, error: 'CC Agent scope: ' + reasonOf(g.why), ...(host ? { suggestHost: host } : {}) });
      continue;
    }
    if (p.hook_event_name === 'PermissionDenied') {
      const x = one(p, p);
      if (x) out.push({ ...x, kind: 'classifier', exact: true, error: reasonOf(p.reason) });
    } else if (p.hook_event_name === 'PostToolUseFailure') {
      const x = one(p, p);
      if (!x || x.tool !== 'Bash' || p.is_interrupt === true || typeof p.error !== 'string') continue;
      // Never the classifier's: a command can print its sentence too;
      // the classifier's own denial comes as PermissionDenied.
      if (BLOCKED.test(p.error)) out.push({ ...x, kind: 'blocked', exact: false, error: p.error });
    } else if (p.hook_event_name === 'PostToolBatch' && Array.isArray(p.tool_calls)) {
      for (const call of p.tool_calls) {
        const x = call && typeof call === 'object' ? one(p, call) : null;
        // A call that succeeded: its id is let go now that its batch has come (each call is in one).
        if (x && used.has(x.id)) { used.delete(x.id); continue; }
        if (!x || !FILE_TOOL.has(x.tool) || typeof call.tool_response !== 'string') continue;
        const text = unwrap(call.tool_response);
        const m = fileRefusal(text, x.input, p.cwd);
        if (m) out.push({ ...x, kind: 'blocked', exact: true, error: text, ...m });
        else if (text.includes('--restricted confines')) out.push({ ...x, kind: 'blocked', exact: false, error: text });
      }
    }
  }
  return out;
}

module.exports = { MIN_VERSION, HEARD, hookSettings, supported, hooksAccepted, spoolDir, list, read, remove, restartCount, quarantine, classify };

#!/usr/bin/env node
'use strict';
// How full an agent's context is, for the page (issue #12 point 1).
// Claude Code runs this as the agent's statusLine and
// subagentStatusLine command (channel/runner.mjs), with what it would show on stdin:
//   statusLine.cjs main      <control folder> [owner]
//   statusLine.cjs subagents <control folder> [owner]
// It keeps a few numbers and the model id, never the paths, session or text around them,
// and writes them, as a new file renamed into place, to context.json or subagents.json in
// that generation's control folder, which the agent's own tools cannot reach. Claude Code
// 2.1.319 runs both commands through its hook runner, outside the sandbox, as it does CC
// Agent's hooks. Then, for a full-access agent ("owner"), whose workspace settings replace
// the user's own status line, it runs the user's command from ~/.claude/settings.json with
// the same stdin and prints what that prints, so the terminal looks as before.
// It must be quick and must never fail the agent: anything wrong is dropped, and it always
// exits 0.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const INPUT_MAX = 1024 * 1024, FILE_MAX = 16 * 1024, OUTPUT_MAX = 64 * 1024, OWNER_TIMEOUT_MS = 2000, SUBAGENT_MAX = 40;
const FILES = {main: 'context.json', subagents: 'subagents.json'};
const SETTING = {main: 'statusLine', subagents: 'subagentStatusLine'};
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const count = (v, max = 100e6) => Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const model = v => typeof v === 'string' && /^[A-Za-z0-9._:@\[\]\/-]{1,100}$/.test(v) ? v : null;
const effort = v => EFFORTS.includes(v) ? v : null;
// Shown on the page: no control, format or line-separator characters, cut short.
const label = (v, max) => typeof v === 'string' ? Array.from(v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '';

function mainFields(input) {
  const w = input && typeof input.context_window === 'object' && input.context_window || {};
  const usage = w.current_usage && typeof w.current_usage === 'object' ? w.current_usage : null;
  // Claude Code counts what is in the window as the last call's input with its cache reads
  // and writes (total_input_tokens); before the first message there is none.
  const used = usage ? count(w.total_input_tokens) : null;
  return {v: 1, at: Date.now(), model: model(input?.model?.id), effort: effort(input?.effort?.level), used, window: count(w.context_window_size)};
}
function subagentFields(input) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  return {v: 1, at: Date.now(), subagents: tasks.filter(t => t && typeof t === 'object' && typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(t.id)).slice(0, SUBAGENT_MAX).map(t => ({
    id: t.id, type: label(t.agentType, 60), label: label(t.label || t.description, 120), status: /^[a-z_]{1,20}$/.test(t.status) ? t.status : null,
    model: model(t.model), effort: effort(t.effort), used: count(t.tokenCount), window: count(t.contextWindowSize), startedAt: count(t.startTime, 1e14),
  }))};
}

// The control folder named on the command line, as the runner made it: a plain folder of
// this account's, never a link. The file is made new beside it and renamed into place.
function write(dir, name, data) {
  let text = JSON.stringify(data);
  if (Buffer.byteLength(text) > FILE_MAX && Array.isArray(data.subagents)) {
    const list = [...data.subagents];
    while (list.length && Buffer.byteLength(text = JSON.stringify({...data, subagents: list})) > FILE_MAX) list.pop();
  }
  if (Buffer.byteLength(text) > FILE_MAX) return false;
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false;
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return false;
  const file = path.join(dir, name), tmp = path.join(dir, '.' + name + '.' + process.pid + '.tmp');
  try { fs.unlinkSync(tmp); } catch {}
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  // A write or rename that fails takes its temporary file with it.
  try {
    try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
  return true;
}

// The user's own command for this kind, if their user settings have one that is not this.
function ownerCommand(kind, home = os.homedir()) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    const c = s && s[SETTING[kind]];
    if (!c || c.type !== 'command' || typeof c.command !== 'string' || !c.command.trim()) return null;
    if (c.command.includes(path.basename(__filename))) return null;
    return c.command;
  } catch { return null; }
}

// Runs it in a shell of its own process group, the same stdin, at most OUTPUT_MAX of its
// output kept; at the timeout the group is killed and its output let go, so something it
// left behind holding the pipe (one in a session of its own) cannot keep this waiting; and
// if Claude Code goes first, the group goes too. Resolves with what
// it printed.
let running = null;
const killGroup = child => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
function runOwner(command, input, timeoutMs = OWNER_TIMEOUT_MS) {
  return new Promise(resolve => {
    let child;
    try { child = spawn('/bin/sh', ['-c', command], {stdio: ['pipe', 'pipe', 'ignore'], detached: true}); } catch { resolve(''); return; }
    running = child;
    const chunks = [];let size = 0, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); running = null; resolve(Buffer.concat(chunks).toString('utf8')); };
    const timer = setTimeout(() => { killGroup(child); child.stdout.destroy(); finish(); }, timeoutMs);
    child.stdout.on('data', d => { if (size < OUTPUT_MAX) { chunks.push(d.subarray(0, OUTPUT_MAX - size)); size += Math.min(d.length, OUTPUT_MAX - size); } });
    child.on('error', finish);
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function readStdin(max = INPUT_MAX) {
  return new Promise(resolve => {
    const chunks = [];let size = 0, over = false;
    process.stdin.on('data', d => { size += d.length; if (size > max) over = true; else chunks.push(d); });
    process.stdin.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    process.stdin.on('error', () => resolve(null));
  });
}

// Claude Code gone (this process handed to another parent): the user's command goes, and so
// does this.
function watchParent(interval = 250) {
  const parent = process.ppid;
  const timer = setInterval(() => {
    let gone = process.ppid !== parent;
    if (!gone) try { process.kill(parent, 0); } catch (e) { gone = e.code === 'ESRCH'; }
    if (!gone) return;
    if (running) killGroup(running);
    process.exit(0);
  }, interval);
  timer.unref();
}

async function main(argv = process.argv.slice(2)) {
  const [kind, dir, owner] = argv;
  if (!FILES[kind]) return;
  const raw = await readStdin();
  if (raw === null) return;
  try { const input = JSON.parse(raw.toString('utf8')); write(dir, FILES[kind], kind === 'main' ? mainFields(input) : subagentFields(input)); } catch {}
  if (owner !== 'owner') return;
  const command = ownerCommand(kind);
  if (!command) return;
  watchParent();
  return runOwner(command, raw);
}

// Out once the output is written, whatever is still about.
if (require.main === module) {
  process.stdout.on('error', () => process.exit(0));
  main().then(out => out ? process.stdout.write(out, () => process.exit(0)) : process.exit(0), () => process.exit(0));
}
module.exports = {mainFields, subagentFields, write, ownerCommand, runOwner, FILE_MAX, OWNER_TIMEOUT_MS};

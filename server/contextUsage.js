// How full an agent's context is, for the ring in its navbar (issue #12 point 1).
// channel/statusLine.cjs, run by the agent's Claude Code as
// its statusLine and subagentStatusLine, keeps context.json and subagents.json in the
// generation's control folder. That folder is out of the agent's reach, but the script runs
// as the agent's process, so what it wrote is read as untrusted: a small plain file, never
// through a link, and only numbers in range and a model id of plain characters taken from it.
// Nothing here is read from the transcript, and nothing from it goes to another agent.
const fs = require('node:fs');
const path = require('node:path');

const FILE_MAX = 16 * 1024;
// subagentStatusLine runs every five seconds while a subagent is at work and not at all once
// none is; an older file lists subagents that are gone.
const SUBAGENT_FRESH_MS = 15000;
const TOKENS_MAX = 10e6, EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const cache = new Map();

function readSmall(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > FILE_MAX || !st.size) return null;
    const key = st.size + ':' + st.mtimeMs, hit = cache.get(file);
    if (hit?.key === key) return hit.value;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    for (let n; got < buf.length && (n = fs.readSync(fd, buf, got, buf.length - got, null)) > 0;) got += n;
    let value = null;
    try { value = JSON.parse(buf.subarray(0, got).toString('utf8')); } catch {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = null;
    cache.set(file, {key, value});
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

const tokens = v => Number.isInteger(v) && v >= 0 && v <= TOKENS_MAX ? v : null;
const windowSize = v => Number.isInteger(v) && v >= 1000 && v <= TOKENS_MAX ? v : null;
const time = v => Number.isInteger(v) && v > 0 && v < 1e14 ? v : null;
const model = v => typeof v === 'string' && /^[A-Za-z0-9._:@\[\]\/-]{1,100}$/.test(v) ? v : null;
const effort = v => EFFORTS.includes(v) ? v : null;
const text = (v, max) => typeof v === 'string' ? Array.from(v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim()).slice(0, max).join('') : '';
const percent = (used, limit) => used !== null && limit ? Math.min(100, Math.round(used / limit * 100)) : null;
// The auto-compact window the session was started with (agentStore.js autoCompactEnv), as the
// runner accepts it.
const autoCompactOf = v => typeof v === 'string' && /^[1-9]\d{5,6}$/.test(v) && Number(v) >= 100000 && Number(v) <= 1000000 ? Number(v) : null;

// main: the main session's context; "limit" is when it compacts: the auto-compact window set
// for this agent when there is one, otherwise the model's whole window as Claude Code reports
// it (limitSource says which). stale: written before this start, or the agent is not there.
function main(raw, {alive, launchedAt, autoCompact}) {
  if (!raw || raw.v !== 1) return null;
  const at = time(raw.at);
  if (!at) return null;
  const used = tokens(raw.used), window = windowSize(raw.window), compactAt = autoCompactOf(autoCompact);
  const limit = compactAt || window;
  return {used, window, limit, limitSource: compactAt ? 'autoCompact' : window ? 'model' : null, percent: percent(used, limit),
    model: model(raw.model), effort: effort(raw.effort), at: new Date(at).toISOString(), stale: !alive || (Number.isFinite(launchedAt) && at < launchedAt)};
}
function subagents(raw, {alive, now}) {
  if (!alive || !raw || raw.v !== 1 || !Array.isArray(raw.subagents)) return [];
  const at = time(raw.at);
  if (!at || now - at > SUBAGENT_FRESH_MS) return [];
  return raw.subagents.slice(0, 40).filter(s => s && typeof s === 'object' && typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s.id) && (s.status === 'running' || s.status === 'pending' || s.status == null)).map(s => {
    const used = tokens(s.used), window = windowSize(s.window);
    return {id: s.id, type: text(s.type, 60), label: text(s.label, 120), model: model(s.model), effort: effort(s.effort), used, window, percent: percent(used, window), startedAt: time(s.startedAt) ? new Date(s.startedAt).toISOString() : null};
  });
}

// A full-access agent whose workspace already had a status line of its own keeps it, and
// CC Agent's is not added (channel/runner.mjs writes status-own):
// no numbers for its main context then, and the page says why.
const ownStatusLine = dir => { try { return fs.lstatSync(path.join(dir, 'status-own')).isFile(); } catch { return false; } };
function view({dir, alive = false, launchedAt, autoCompact, now = Date.now()} = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return {main: null, subagents: []};
  const own = ownStatusLine(dir);
  return {main: own ? null : main(readSmall(path.join(dir, 'context.json')), {alive, launchedAt, autoCompact}), subagents: subagents(readSmall(path.join(dir, 'subagents.json')), {alive, now}), ...(own ? {ownStatusLine: true} : {})};
}

module.exports = {view, FILE_MAX, SUBAGENT_FRESH_MS};

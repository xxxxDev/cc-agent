const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Long-running schedules for agents: the owner
// adds one, or an agent sets one up the owner agreed to in its conversation, and the server sends its instruction into
// that agent's conversation when it falls due. Claude Code's own scheduling lives
// in one session and expires after seven days, so it cannot hold these.
// Times are the server's local time, which is the owner's.
const MAX_SCHEDULES = 500;
// One agent's proposals are its own output: it can neither bury the page nor push
// other agents' proposals out of it.
const MAX_PENDING_PER_AGENT = 20;
const MAX_PENDING = 200;
const TYPES = ['daily', 'weekly', 'monthly', 'interval', 'dates'];
const MAX_TIMES = 6;
// Set dates: each one runs once, and the schedule switches itself off after the last.
const MAX_DATES = 24;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw error(`${label}須為 1–${max} 字`);
  return value.trim();
};

// The one shape a frequency is stored in; anything else is refused.
function frequencyOf(input) {
  // A model may send numbers as strings ("6"); nothing else is guessed.
  const whole = (v) => (typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : v);
  const raw = input && typeof input === 'object' ? input : {};
  const f = { ...raw, hours: whole(raw.hours), day: whole(raw.day), days: Array.isArray(raw.days) ? raw.days.map(whole) : raw.days };
  if (!TYPES.includes(f.type)) throw error('頻率不正確');
  if (f.type === 'interval') {
    if (!Number.isInteger(f.hours) || f.hours < 1 || f.hours > 168) throw error('間隔須為 1–168 小時');
    return { type: 'interval', hours: f.hours };
  }
  // Several fixed times a day (09:00 and 21:00
  // that never drift); `time` alone stays the one-time form, and `time` is always
  // the first of them.
  const list = f.times !== undefined ? f.times : [f.time];
  if (!Array.isArray(list) || !list.length || list.length > MAX_TIMES || list.some((t) => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw error(`時間須為 HH:MM，最多 ${MAX_TIMES} 個`);
  const times = [...new Set(list)].sort();
  const at = times.length > 1 ? { time: times[0], times } : { time: times[0] };
  if (f.type === 'daily') return { type: 'daily', ...at };
  if (f.type === 'dates') {
    const dates = Array.isArray(f.dates) ? [...new Set(f.dates)].sort() : [];
    if (!dates.length || dates.length > MAX_DATES || !dates.every(isDate)) throw error(`日期須為 YYYY-MM-DD，1–${MAX_DATES} 個`);
    return { type: 'dates', ...at, dates };
  }
  if (f.type === 'weekly') {
    const days = Array.isArray(f.days) ? [...new Set(f.days)].sort() : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw error('每週須選至少一天');
    return { type: 'weekly', ...at, days };
  }
  if (!Number.isInteger(f.day) || f.day < 1 || f.day > 31) throw error('每月日期須為 1–31');
  return { type: 'monthly', ...at, day: f.day };
}

// The first time strictly after `after` that the frequency names. A monthly day
// past the month's end falls on its last day. Set dates that are all past give null.
function nextRun(frequency, after = new Date()) {
  const from = new Date(after);
  if (frequency.type === 'dates') {
    const [first] = frequency.dates.flatMap((d) => (frequency.times || [frequency.time]).map((t) => new Date(d + 'T' + t + ':00'))).filter((w) => w > from).sort((a, b) => a - b);
    return first || null;
  }
  if (frequency.type === 'interval') return new Date(from.getTime() + frequency.hours * 3600_000);
  // With several times, the earliest of each one's next run.
  if (frequency.times?.length > 1) return new Date(Math.min(...frequency.times.map((time) => nextRun({ ...frequency, time, times: undefined }, from).getTime())));
  const [hour, minute] = frequency.time.split(':').map(Number);
  const at = (y, m, d) => new Date(y, m, d, hour, minute, 0, 0);
  if (frequency.type === 'monthly') {
    for (let i = 0; i < 14; i += 1) {
      const y = from.getFullYear(), m = from.getMonth() + i;
      const last = new Date(y, m + 1, 0).getDate();
      const when = at(y, m, Math.min(frequency.day, last));
      if (when > from) return when;
    }
    throw error('無法計算下次時間');
  }
  for (let i = 0; i < 8; i += 1) {
    const when = at(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (when <= from) continue;
    if (frequency.type === 'daily' || frequency.days.includes(when.getDay())) return when;
  }
  throw error('無法計算下次時間');
}

// The next run of a schedule being set up or switched on; set dates all past are refused.
function firstRun(frequency, after) {
  const when = nextRun(frequency, after);
  if (!when) throw error('指定的日期都已經過了');
  return when.toISOString();
}

// A background script: the agent writes it, the owner approves that
// exact text, and the server runs it in a sandbox with no agent involved
// (server/scriptSandbox.js). Only the network names listed here are reachable.
const SCRIPT_INTERPRETERS = ['python', 'node', 'sh', 'bash', 'zsh'];
const SCRIPT_MAX = 32000;
const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function scriptOf(input, current) {
  const x = input && typeof input === 'object' ? input : null;
  if (!x) throw error('腳本設定不正確');
  const source = x.source !== undefined ? x.source : current?.source;
  if (current && x.source !== undefined && x.source !== current.source) throw error('腳本內容要由 Agent 重新提議，不能在這裡修改', 409);
  if (typeof source !== 'string' || !source.trim() || source.length > SCRIPT_MAX) throw error(`腳本須為 1–${SCRIPT_MAX} 字`);
  // What the owner reads must be what runs: characters that end a line for an
  // interpreter but not on the page, or hide, reorder or blank out text, are
  // refused by class, invisible ones included (a
  // lone CR, U+2028, a Hangul filler or a variation selector ran code the page
  // did not show). TAB, LF and CRLF are text.
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(source.replace(/\r\n/g, '\n').replace(/[\t\n]/g, ''))) throw error('腳本含有看不見或會改變換行的字元，請只用一般文字');
  // Python takes the first source-encoding line (PEP 263) in the first two lines;
  // anything but UTF-8 would read the text differently from the page.
  for (const line of source.split('\n').slice(0, 2)) {
    const declared = line.match(/^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/);
    if (!declared) continue;
    if (!/^utf[-_]?8$/i.test(declared[1])) throw error('腳本的編碼宣告只能是 utf-8');
    break;
  }
  const interpreter = x.interpreter !== undefined ? x.interpreter : current?.interpreter;
  if (!SCRIPT_INTERPRETERS.includes(interpreter)) throw error('腳本語言須為 ' + SCRIPT_INTERPRETERS.join('、'));
  if (current && x.interpreter !== undefined && x.interpreter !== current.interpreter) throw error('腳本語言要由 Agent 重新提議', 409);
  const domains = x.domains !== undefined ? x.domains : current?.domains || [];
  if (!Array.isArray(domains) || domains.length > 10 || domains.some((d) => typeof d !== 'string' || !DOMAIN.test(d.toLowerCase()))) throw error('允許連線的網站須為最多 10 個網域名稱');
  // The same rule as an agent's own websites: no wildcard over a shared suffix
  // anyone can host under (*.github.io, *.co.uk).
  try { domains.forEach((d) => require('./agentAccess').website(d)); } catch (e) { throw error('允許連線的網站太廣：' + e.message.replace(/^.*: /, '')); }
  const timeoutSeconds = x.timeoutSeconds !== undefined ? Number(x.timeoutSeconds) : current?.timeoutSeconds || 60;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 600) throw error('腳本時間上限須為 5–600 秒');
  return { interpreter, source, hash: require('node:crypto').createHash('sha256').update(source).digest('hex'), domains: [...new Set(domains.map((d) => d.toLowerCase()))], timeoutSeconds };
}

function create(stateRoot, { now = () => new Date() } = {}) {
  const file = path.join(stateRoot, 'schedules.json');
  let schedules = null, rejected = [];
  // A missing file is an empty list. An unreadable one is set aside, not written
  // over: it holds schedules the owner approved.
  const load = () => {
    if (schedules) return schedules;
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; schedules = []; return schedules; }
    try { const data = JSON.parse(raw); schedules = data.schedules || []; rejected = data.rejected || []; } catch {
      const aside = `${file}.unreadable-${Date.now()}`;
      fs.renameSync(file, aside);
      console.error(`schedules: ${file} could not be read and was moved to ${aside}`);
      schedules = [];
    }
    return schedules;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify({ schedules, rejected }, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  const list = () => load().slice();
  const get = (id) => load().find((s) => s.id === id) || null;
  const fields = (input, current = {}) => ({
    // One line: the name is quoted to the agent with every run.
    name: input.name !== undefined ? text(typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ') : input.name, 80, '名稱') : current.name,
    prompt: input.prompt !== undefined ? (input.prompt === '' && (current.script || input.script || current.check || input.check || current.feed || input.feed) ? '' : text(input.prompt, 4000, '指示')) : current.prompt,
    frequency: input.frequency !== undefined ? frequencyOf(input.frequency) : current.frequency,
    whenPaused: input.whenPaused !== undefined ? (['start', 'wait', 'skip'].includes(input.whenPaused) ? input.whenPaused : (() => { throw error('暫停時的處理不正確'); })()) : current.whenPaused || 'start',
    script: input.script !== undefined && input.script !== null ? scriptOf(input.script, current.script) : current.script,
    // A built-in check by its id (server/scheduleChecks.js), instead of a script.
    check: input.check !== undefined && input.check !== null ? (typeof input.check === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(input.check) ? input.check : (() => { throw error('內建檢查不正確'); })()) : current.check,
    // An RSS or Atom feed CC Agent reads itself (server/feeds.js).
    feed: input.feed !== undefined && input.feed !== null ? { url: require('./feeds').urlOf(input.feed?.url) } : current.feed,
    // The last day it runs, in local time, or none.
    until: input.until !== undefined ? (input.until === null || input.until === '' ? null : (typeof input.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.until) && new Date(input.until + 'T00:00:00Z').toISOString().slice(0, 10) === input.until ? input.until : (() => { throw error('到期日須為 YYYY-MM-DD'); })())) : current.until ?? null,
    // Hours when its pushes wait until the end, e.g. {from:'23:00',to:'08:00'}.
    quiet: input.quiet !== undefined ? (input.quiet === null ? null : (input.quiet && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.quiet.from) && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.quiet.to) && input.quiet.from !== input.quiet.to ? { from: input.quiet.from, to: input.quiet.to } : (() => { throw error('安靜時段須為兩個不同的 HH:MM'); })())) : current.quiet ?? null,
    onResult: input.onResult !== undefined ? (['push', 'agent'].includes(input.onResult) ? input.onResult : (() => { throw error('結果的處理不正確'); })()) : current.onResult,
  });
  // A script schedule needs no instruction of its own (it is sent only with a
  // result the agent is to handle); an agent schedule is nothing without one.
  const complete = (f) => {
    if ([f.script, f.check, f.feed].filter(Boolean).length > 1) throw error('腳本、內建檢查與 RSS 只能選一個');
    if (!f.name || !f.frequency || (!f.script && !f.check && !f.feed && !f.prompt)) throw error('名稱、指示與頻率都要填');
    // What a feed brings is always the agent's to sum up.
    if (f.feed) { f.onResult = 'agent'; f.prompt = f.prompt || ''; } else if (f.script || f.check) { f.onResult = f.onResult || 'push'; f.prompt = f.prompt || ''; } else { delete f.onResult; delete f.script; delete f.check; }
    if (!f.feed) delete f.feed;
    if (!f.script) delete f.script;
    if (!f.check) delete f.check;
    return f;
  };
  // Proposals are the agents' output and have their own cap, so they never use up
  // the room the owner's own schedules need.
  function room(pending) {
    const count = load().filter((s) => (s.status === 'pending') === pending).length;
    if (count >= (pending ? MAX_PENDING : MAX_SCHEDULES)) throw error(pending ? '待核准的排程太多，請先處理' : '排程已達上限', 409);
  }
  const fingerprint = (conversationId, f) => conversationId + '\n' + f.name + '\n' + f.prompt + '\n' + JSON.stringify(f.frequency) + (f.script ? '\n' + f.script.hash : '') + (f.check ? '\ncheck:' + f.check : '') + (f.feed ? '\nfeed:' + f.feed.url : '');

  // An agent's schedule, set up once the owner agreed to it in their conversation:
  // running from now; the owner sees it on the page, where an admin can change or switch it off.
  // `active` is the caller's to decide: only an agent the admin trusts with full
  // access starts its own; any other still waits for approval. Each agent has a cap of its own on the ones not switched off, so one
  // cannot fill the room the others need; one an admin turned down or deleted is
  // not set up again as it was. The refusals only an agent meets are in its owner's
  // language (`language`, as agentStore reads it).
  function propose(conversation, input = {}, { active = false, language = 'en' } = {}) {
    const zh = language === 'zh-TW';
    const f = complete(fields({ ...input, prompt: input.prompt === '' ? undefined : input.prompt }));
    const reason = input.reason === undefined || input.reason === '' ? '' : text(input.reason, 1000, '原因');
    const mine = load().filter((s) => s.conversationId === conversation.id && s.proposedBy === 'agent');
    const same = mine.find((s) => fingerprint(s.conversationId, s) === fingerprint(conversation.id, f));
    if (same) return { schedule: same, created: false };
    // One an admin turned down or deleted is not proposed again as it was; an agent
    // that starts its own asks the owner first, so it may set it up again.
    if (!active && rejected.includes(fingerprint(conversation.id, f))) throw error(zh ? '管理員已拒絕或刪除過這個排程，請勿再提同樣的排程' : 'An admin turned down or deleted this schedule before; do not propose the same one again', 409);
    // Switched-off ones do not count. Only an agent that starts its own (`active`) may
    // delete or switch off its schedules itself, and not one waiting for approval;
    // any other's are an admin's to change on the Schedules page.
    if (mine.filter((s) => s.status !== 'off').length >= MAX_PENDING_PER_AGENT) throw error(zh
      ? `這個 Agent 已有 ${MAX_PENDING_PER_AGENT} 個開著的排程，${active ? '請先刪掉或關掉不用的（待核准的由管理員處理）' : '請管理員在排程頁刪掉或關掉不用的'}`
      : `This agent already has ${MAX_PENDING_PER_AGENT} schedules that are not switched off; ${active ? 'delete or switch off the ones it no longer needs first (one waiting for approval is an admin\'s)' : 'an admin can delete or switch off the ones it no longer needs on the Schedules page'}`, 409);
    room(!active);
    const at = now().toISOString();
    const s = { id: randomUUID(), owner: conversation.owner, conversationId: conversation.id, agentTitle: String(conversation.title || ''), ...f, reason, proposedBy: 'agent', createdAt: at, lastRun: null,
      ...(active ? { status: 'active', approvedAt: at, nextAt: firstRun(f.frequency, now()), notifyPending: false } : { status: 'pending', nextAt: null, notifyPending: true }) };
    load().push(s); save(); return { schedule: s, created: true };
  }
  // The owner's own, running from now.
  function add(conversation, input = {}) {
    const f = complete(fields({ ...input, prompt: input.prompt === '' ? undefined : input.prompt }));
    room(false);
    const s = { id: randomUUID(), owner: conversation.owner, conversationId: conversation.id, ...f, reason: '', proposedBy: 'owner', status: 'active', createdAt: now().toISOString(), approvedAt: now().toISOString(), nextAt: firstRun(f.frequency, now()), lastRun: null };
    load().push(s); save(); return s;
  }
  function approve(id, input = {}) {
    const s = get(id); if (!s) throw error('找不到這個排程', 404);
    if (s.status !== 'pending') throw error('這個排程已經處理過', 409);
    room(false);
    const f = fields(input, s);
    const nextAt = firstRun(f.frequency, now());
    Object.assign(s, f, { status: 'active', approvedAt: now().toISOString(), notifyPending: false, nextAt });
    save(); return s;
  }
  // A frequency changed, or a schedule turned back on, counts from now: nothing
  // missed while it was off is made up.
  // `replaceScript`: an agent that manages its schedules gives a whole new script,
  // frozen again like one just set up.
  function update(id, input = {}, { replaceScript = false } = {}) {
    const s = get(id); if (!s) throw error('找不到這個排程', 404);
    const before = JSON.stringify(s.frequency);
    const feedBefore = s.feed?.url;
    // Everything checked before anything changes: a refused edit leaves no trace.
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') throw error('開關必須是開或關');
      if (s.status === 'pending') throw error('待核准的排程要先核准', 409);
    }
    const f = fields(replaceScript && input.script ? { ...input, script: undefined } : input, s);
    if (replaceScript && input.script) f.script = scriptOf(input.script);
    // What it runs is one thing: the one just given takes the place of the others.
    const kind = input.feed ? 'feed' : input.check ? 'check' : input.script ? 'script' : null;
    const willRun = input.enabled !== undefined ? input.enabled : s.status === 'active';
    const nextAt = willRun && (input.enabled === true || JSON.stringify(f.frequency) !== before || (!s.nextAt && !s.pendingRun)) ? firstRun(f.frequency, now()) : undefined;
    Object.assign(s, f);
    if (kind) {
      for (const k of ['feed', 'check', 'script']) if (k !== kind) delete s[k];
      if (kind !== 'check') delete s.checkSig;
      s.onResult = kind === 'feed' ? 'agent' : s.onResult || 'push';
      s.prompt = s.prompt || '';
    }
    // Another feed starts over: what the old one had seen means nothing to it.
    if (s.feed?.url !== feedBefore) { delete s.feedSeen; delete s.feedTitle; }
    if (input.enabled !== undefined) {
      s.status = input.enabled ? 'active' : 'off';
      // A script already running finishes; its run is not orphaned into a second one.
      if (!input.enabled && !s.pendingRun?.scriptRunning) delete s.pendingRun;
    }
    if (s.status === 'active' && nextAt) s.nextAt = nextAt;
    if (s.status !== 'active') s.nextAt = null;
    save(); return s;
  }
  function remove(id, { byAgent = false } = {}) {
    const all = load(); const at = all.findIndex((s) => s.id === id);
    if (at < 0) throw error('找不到這個排程', 404);
    // One an agent set up, deleted by the owner, is not set up again as it was; one
    // the agent removed itself may be set up again.
    if (all[at].proposedBy === 'agent' && !byAgent) remember(all[at]);
    all.splice(at, 1); save();
  }
  function remember(s) { const f = fingerprint(s.conversationId, s); rejected = [...rejected.filter((r) => r !== f), f].slice(-200); }
  // Turning a proposal down removes it and remembers it, so the same one is not
  // proposed again straight away.
  function reject(id) {
    const s = get(id); if (!s) throw error('找不到這個排程', 404);
    if (s.status !== 'pending') throw error('只有待核准的排程可以拒絕', 409);
    remove(id);
  }
  // An agent deleted for good takes its schedules with it.
  function removeFor(conversationId) {
    const all = load(); const kept = all.filter((s) => s.conversationId !== conversationId);
    const forgot = rejected.filter((r) => !r.startsWith(conversationId + '\n'));
    if (kept.length !== all.length || forgot.length !== rejected.length) { schedules = kept; rejected = forgot; save(); }
  }
  function patch(id, values) { const s = get(id); if (!s) return null; Object.assign(s, values); save(); return s; }
  return { list, get, propose, add, approve, update, remove, reject, removeFor, patch, save, remember: (s) => { remember(s); save(); } };
}

// When a push made at `at` may go out: at once, or at the end of the quiet hours
// it falls in (which may cross midnight).
function afterQuiet(quiet, at = new Date()) {
  if (!quiet) return null;
  const [fh, fm] = quiet.from.split(':').map(Number), [th, tm] = quiet.to.split(':').map(Number);
  const mins = at.getHours() * 60 + at.getMinutes(), from = fh * 60 + fm, to = th * 60 + tm;
  const inside = from < to ? mins >= from && mins < to : mins >= from || mins < to;
  if (!inside) return null;
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), th, tm, 0, 0);
  if (end <= at) end.setDate(end.getDate() + 1);
  return end;
}
// Past its last day (local time).
const expired = (until, at = new Date()) => !!until && at >= new Date(new Date(until + 'T00:00:00').getTime() + 86400_000);

module.exports = { afterQuiet, expired, create, nextRun, frequencyOf, scriptOf, SCRIPT_INTERPRETERS, MAX_PENDING_PER_AGENT, MAX_SCHEDULES };

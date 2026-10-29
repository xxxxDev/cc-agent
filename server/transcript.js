// Every agent is a real `claude` CLI process, and Claude Code writes each session
// to ~/.claude/projects/<cwd with non-alphanumerics turned into ->/<sessionId>.jsonl.
// That file already carries per-turn token usage and every tool call, so reading it
// answers three questions the UI wants — what an agent has cost, what it is doing
// right now, and what actually went to the model — without adding a single hook or
// changing how agents run.
//
// Nothing here may throw: a missing or unreadable transcript is an absent number in
// the UI, never a failed conversation request.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

// US$ per million tokens, as [input, output, cache read if not a tenth of input].
// Everything else derives from the input price the way Anthropic prices it: cache
// reads 0.1x, 5-minute cache writes 1.25x, 1-hour cache writes 2x. These numbers
// reproduce Claude Code's own cost-state records (totalCostUSD) exactly. Fable
// has its own row below; an admin can select it, so leaving it out would silently
// bank its turns as unpriced. Opus 5.5 is Claude Code 2.1.280's own table
// (tier_4_20_cache_read_0_20): 4/20, with cache reads at 0.2 rather than a tenth of
// its input, hence the third number; its cache writes are the usual 1.25x and 2x.
// A turn is priced by the model that answered it, so a conversation that moved
// from one model to another is the sum of each at its own price.
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25],
  // Claude Code 2.1.293's model catalog, each checked against the
  // total_cost_usd of a one-line `claude -p` run, which these reproduce exactly:
  // Fable 5.1 is 10/50 with cache reads at 0.25, Sonnet 5 and
  // Sonnet 5.5 are 2/10, Haiku 5.5 is 0.1/0.5.
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],
};
// Haiku 5.5 costs five times as much on a request whose prompt (input, cache reads
// and cache writes together) is above 100,000 tokens: the catalog's long_prompt.
const LONG_PROMPT = {'claude-haiku-5-5': [100000, 5]};
// Server-side web search is billed per request, not per token.
const WEB_SEARCH_USD = 0.01;

function priceOf(model) {
  if (!model) return null;
  const bare = String(model).replace(/\[[^\]]*\]$/, ''); // claude-opus-5[1m] is priced as claude-opus-5
  if (PRICES[bare]) return PRICES[bare];
  // The longest name first, so a dated claude-opus-5-5-… is not taken for Opus 5.
  const family = Object.keys(PRICES).sort((a, b) => b.length - a.length).find(name => bare.startsWith(name)); // claude-haiku-4-5-20251001
  return family ? PRICES[family] : null;
}

function messageCost(usage, model, serviceTier) {
  const price = priceOf(model);
  if (!price) return null;
  const [input, output, cacheRead = input * 0.1] = price;
  const created = usage.cache_creation || {};
  const hour = created.ephemeral_1h_input_tokens || 0;
  const short = created.ephemeral_5m_input_tokens || 0;
  // Older records carry only the total; price the remainder at the 5-minute rate.
  const rest = Math.max(0, (usage.cache_creation_input_tokens || 0) - hour - short);
  const searches = usage.server_tool_use?.web_search_requests || 0;
  const prompt = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + hour + short + rest;
  const [above, times] = LONG_PROMPT[Object.keys(LONG_PROMPT).find(name => String(model).startsWith(name))] || [Infinity, 1];
  return ((usage.input_tokens || 0) * input
    + (usage.output_tokens || 0) * output
    + (usage.cache_read_input_tokens || 0) * cacheRead
    + hour * input * 2
    + (short + rest) * input * 1.25) * (prompt > above ? times : 1) / 1e6
    + searches * WEB_SEARCH_USD;
}

// One reader per transcript file, advanced by the bytes appended since last time,
// so polling a conversation every 1.2s costs a stat() and nothing else once the
// file has been read.
const readers = new Map();
const blank = () => ({
  offset: 0,
  partial: Buffer.alloc(0),
  counted: new Set(),
  tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0},
  costUSD: 0,
  unpriced: 0,
  turns: 0,
  models: new Set(),
  running: new Map(),
  background: new Map(),
  subagents: new Map(),
  skills: new Map(),
  queue: [],
  enqueued: new Set(),
  relays: new Map(),
  relayIds: new Set(),
  sends: new Map(),
  tools: 0,
  lastAt: null,
  quotaReset: null,
  compactions: [],
});

// Hook feedback is the same turn continuing, so it does not reset the count.
const TURN_CONTINUATION = 'Stop hook feedback:';
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
const TASK_ID = /<task-id>([^<\s]+)<\/task-id>/g;
// Stopping a job by hand sends no notice at all, only the stop itself, so the
// stop is what ends it (otherwise a stopped command reads as still running).
const STOP_TOOLS = new Set(['TaskStop', 'KillShell']);
// A background job whose end never showed up (Claude Code stopped some other way)
// is not shown as working forever.
const BACKGROUND_MAX_MS = 12 * 60 * 60 * 1000;

// Work left running in the background outlives the turn that started it: a
// subagent launched to run on its own, or a command sent to the background. Each
// ends with a task notification naming it; a new Claude Code process (the runner's
// opening instruction) has none of the old ones left (show a subagent at work).
function trackBackground(state, record) {
  const started = record.toolUseResult;
  if (started && typeof started === 'object') {
    if (started.isAsync && typeof started.agentId === 'string') {
      state.subagents.set(started.agentId, String(started.description || ''));
      state.background.set(started.agentId, {kind: 'subagent', description: String(started.description || ''), since: record.timestamp || null});
    } else if (started.success === true && typeof started.resumedAgentId === 'string') {
      // A finished subagent called back with SendMessage runs in the background
      // again, under the task it was launched with (otherwise an agent
      // waiting on one shows no bubble).
      const id = started.resumedAgentId;
      state.background.set(id, {kind: 'subagent', description: state.subagents.get(id) || '', since: record.timestamp || null});
    } else if (typeof started.backgroundTaskId === 'string') {
      // Named by what the agent said it runs, so the owner sees which one is left
      // running: agents forget to stop them.
      const use = Array.isArray(record.message?.content) ? record.message.content.find(b => b?.type === 'tool_result')?.tool_use_id : null;
      const description = state.running.get(use)?.command || '';
      state.background.set(started.backgroundTaskId, {kind: 'command', description, since: record.timestamp || null});
    }
  }
  if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) {
      if (block?.type !== 'tool_use' || !STOP_TOOLS.has(block.name)) continue;
      const id = block.input?.task_id ?? block.input?.shell_id;
      if (typeof id === 'string') state.background.delete(id);
    }
  }
  // The notice is a prompt of its own when the agent is idle; during a turn it is
  // queued, and the transcript keeps it as a queue entry and an attachment instead.
  const text = record.type === 'user' ? record.message?.content
    : record.type === 'queue-operation' && record.operation === 'enqueue' ? record.content
    : record.type === 'attachment' && record.attachment?.type === 'queued_command' ? record.attachment.prompt : null;
  if (typeof text !== 'string') return;
  if (record.type === 'user' && text.trimStart().startsWith(RUNNER_START)) state.background.clear();
  // Several notices can arrive in one message.
  if (text.includes('<task-notification>')) for (const [, id] of text.matchAll(TASK_ID)) state.background.delete(id);
}

// Whether Claude is in a turn, whoever started it. The server learns of a turn when
// it hands Claude a web message, but Claude also starts one on its own for a task
// notification or a prompt typed in its terminal, and the page showed an idle agent
// for all of that one (an agent working for
// minutes on a finished background job's notice). A prompt opens a turn; Claude
// Code's end-of-turn records, or an interruption, close it.
const TURN_END = new Set(['turn_duration', 'stop_hook_summary']);
const NOT_A_PROMPT = /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;
const INTERRUPTED = '[Request interrupted by user';
// A turn whose end never showed up stops counting once nothing has been written
// for this long with no tool running.
const TURN_QUIET_MS = 20 * 60 * 1000;
const NOTE_MAX = 300;
// This only classifies working state; it gives an agent's message no user authority.
// Claude Code writes it as <cross-session-message> (missing it, a wake from
// another agent showed no working bubble); older builds wrote <agent-message>.
const AGENT_WAKE = /^Another Claude session sent a message:\s*<(agent-message|cross-session-message)\b[^>]*>[\s\S]*?<\/\1>(?:\s|$)/;
function trackTurn(state, record) {
  if (record.type === 'system' && TURN_END.has(record.subtype)) { state.turnOpen = false; return; }
  if (record.type !== 'user' || record.isCompactSummary || record.isVisibleInTranscriptOnly) return;
  const content = record.message?.content;
  if (typeof content === 'string') {
    const text = content.trimStart();
    if (NOT_A_PROMPT.test(text)) return;
    // Claude Code's own notes are meta; so are channel messages, which are prompts.
    if (record.isMeta && !text.startsWith('<channel ') && !AGENT_WAKE.test(text)) return;
    state.turnOpen = true;
    // How long the turn has run, as Claude Code's own timer counts it, and what it
    // has said in it so far, both from its start.
    state.turnSince = record.timestamp || null;
    state.note = null;
  } else if (Array.isArray(content) && content.some(b => b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED))) {
    state.turnOpen = false;
  }
}
function inTurn(state, now = Date.now()) {
  return !!state.turnOpen && (state.running.size > 0 || now - Date.parse(state.lastAt || 0) < TURN_QUIET_MS);
}

// The skills Claude Code offered the model, as it listed them: a full listing when
// a process starts, then one for each skill added later. The composer's slash menu
// offers these.
function trackSkills(state, record) {
  const listing = record.type === 'attachment' && record.attachment?.type === 'skill_listing' ? record.attachment : null;
  if (!listing || !Array.isArray(listing.names)) return;
  if (listing.isInitial) state.skills.clear();
  const described = new Map();
  for (const entry of String(listing.content || '').split(/\n(?=- )/)) {
    const match = /^- ([^:\n]+):\s*([\s\S]*)$/.exec(entry.trim());
    if (match) described.set(match[1].trim(), match[2].replace(/\s+/g, ' ').trim());
  }
  for (const name of listing.names) if (typeof name === 'string' && name) state.skills.set(name, described.get(name) || '');
}

// Messages handed to Claude Code and not yet taken up, oldest first. Every channel
// message is enqueued; a dequeue opens a turn with the oldest, and a remove takes
// one into the turn in progress. One that arrives as a turn is ending waits here
// and opens the next (such a message was taken as
// unanswered, and the turn that answered it showed as the agent's own work).
function trackQueue(state, record) {
  if (record.type === 'user' && typeof record.message?.content === 'string' && record.message.content.trimStart().startsWith(RUNNER_START)) { state.queue = []; return; }
  if (record.type !== 'queue-operation') return;
  const id = typeof record.content === 'string' ? CHANNEL_OPEN.exec(record.content)?.[1] || null : null;
  if (record.operation === 'enqueue') { state.queue.push(id); if (id) state.enqueued.add(id); }
  else if (record.operation === 'dequeue') state.queue.shift();
  else if (record.operation === 'remove') { const at = state.queue.indexOf(id); if (at >= 0) state.queue.splice(at, 1); }
}

// Only system errors explicitly marked as zero usage are left out; the raw record and progress tracking keep them.
function zeroUsageError(record) {
  const message = record.message, usage = message?.usage;
  if (record.type !== 'assistant' || record.isApiErrorMessage !== true || message?.model !== '<synthetic>' || !usage) return false;
  if (!['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].every(key => usage[key] === 0)) return false;
  const emptyCounts = value => value == null || (typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(n => n === 0));
  return ['cache_creation', 'output_tokens_details', 'input_tokens_details', 'server_tool_use'].every(key => emptyCounts(usage[key]))
    && ['prompt_tokens', 'completion_tokens'].every(key => usage[key] === undefined || usage[key] === 0)
    && (usage.iterations == null || (Array.isArray(usage.iterations) && usage.iterations.length === 0));
}

function absorb(state, record) {
  // A usage limit that stopped the session records when it resets (quotaLimits,
  // Claude Code 2.1.286), for CC Agent to wake the agent then.
  if (record.type === 'assistant' && record.isApiErrorMessage === true && record.quotaLimits?.status === 'rejected'
      && Number.isFinite(record.quotaLimits.resetsAt)) {
    state.quotaReset = {at: record.quotaLimits.resetsAt * 1000, seen: Date.parse(record.timestamp) || null};
  }
  // Where Claude Code compacted the conversation, with what it measured: the page marks the point in the chat.
  if (record.type === 'system' && record.subtype === 'compact_boundary') {
    const m = record.compactMetadata || {}, n = v => Number.isFinite(v) && v >= 0 ? v : null;
    state.compactions.push({at: record.timestamp || null, trigger: m.trigger === 'manual' ? 'manual' : 'auto', preTokens: n(m.preTokens), postTokens: n(m.postTokens), durationMs: n(m.durationMs)});
    if (state.compactions.length > 100) state.compactions.shift();
  }
  trackBackground(state, record);
  trackTurn(state, record);
  trackSkills(state, record);
  trackQueue(state, record);
  trackRelays(state, record);
  const message = record.message;
  if (!message) return;
  // A prompt is activity too: a turn that has only just opened is in it.
  if (record.timestamp) state.lastAt = record.timestamp;
  // A new prompt starts a new turn, whoever sent it: an agent resumed from a
  // terminal or a channel plugin's session would otherwise report the whole
  // session's tools as "this turn".
  if (record.type === 'user' && typeof message.content === 'string'
      && !message.content.includes(TURN_CONTINUATION)) {
    state.tools = 0;
    state.running.clear();
  }
  const usage = message.usage;
  // A streamed reply appears several times; the same message id and API block is
  // one billed unit. Counting the raw records would roughly double the total.
  if (usage && !zeroUsageError(record)) {
    const key = (message.id || record.uuid) + ':' + (record.apiBlockIndex ?? 0);
    if (!state.counted.has(key)) {
      state.counted.add(key);
      state.turns += 1;
      state.tokens.input += usage.input_tokens || 0;
      state.tokens.output += usage.output_tokens || 0;
      state.tokens.cacheRead += usage.cache_read_input_tokens || 0;
      state.tokens.cacheWrite += usage.cache_creation_input_tokens || 0;
      state.tokens.thinking += usage.output_tokens_details?.thinking_tokens || 0;
      if (message.model) state.models.add(message.model);
      const cost = messageCost(usage, message.model, message.service_tier);
      if (cost === null) state.unpriced += 1; else state.costUSD += cost;
    }
  }
  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block.type === 'tool_use') {
      // Answering the web user ends the turn; the next one starts from zero.
      if (block.name === 'mcp__executive__reply') { state.tools = 0; state.running.clear(); state.note = null; }
      else {
        state.tools += 1;
        // A subagent working in the foreground is named by what it was sent to do.
        const detail = SUBAGENT_TOOLS.has(block.name) && typeof block.input?.description === 'string' ? block.input.description : null;
        // A command is named by what the agent said it does, or else by itself, in
        // case it goes on in the background.
        const said = block.name === 'Bash' ? (typeof block.input?.description === 'string' && block.input.description.trim() ? block.input.description : String(block.input?.command || '')) : '';
        state.running.set(block.id, {name: block.name, detail, at: record.timestamp || null, ...(said ? {command: said.replace(/\s+/g, ' ').trim().slice(0, 80)} : {})});
      }
    } else if (block.type === 'tool_result') state.running.delete(block.tool_use_id);
    // What the agent last wrote in its terminal between tools, which the page shows
    // in the typing bubble ("checking the list first") rather than only that it is
    // thinking. A reply to the
    // page clears it; that is already in the chat.
    else if (block.type === 'text' && record.type === 'assistant' && typeof block.text === 'string' && block.text.trim()) state.note = block.text.replace(/\s+/g, ' ').trim();
  }
  if (record.timestamp) state.lastAt = record.timestamp;
}

// Messages between agents' sessions: one that
// arrived, from Claude Code's cross-session channel, and one this session sent with
// SendMessage to another session. An arrival is queued first when the session is
// busy (its text only) and handed over later, as a prompt or a queued command that
// Claude Code marks as from a peer with the message's id; only a handed one is the
// agent's to answer. Text that merely contains the tag (a web message, a file, a
// subagent's report) is never one: only a queued prompt that starts with it, or a
// record Claude Code itself marked.
const RELAY = /^\s*<cross-session-message\s+([^>]*)>([\s\S]*?)<\/cross-session-message>/;
const RELAY_KEEP = 200;
const attr = (attrs, name) => (attrs.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')) || [])[1] || '';
const relayHash = (from, body) => require('node:crypto').createHash('sha256').update(from + '\n' + body.trim()).digest('hex').slice(0, 32);
function keepRelay(state, key, entry) {
  if (state.relays.has(key)) return;
  state.relays.set(key, entry);
  if (state.relays.size > RELAY_KEEP) state.relays.delete(state.relays.keys().next().value);
}
function trackRelays(state, record) {
  const at = record.timestamp || null;
  // Queued: shown now, answered once it is handed over. Each queueing is its own
  // message, even with the same words as an earlier one.
  if (record.type === 'queue-operation' && record.operation === 'enqueue' && typeof record.content === 'string') {
    const m = RELAY.exec(record.content);
    if (m) {
      const from = attr(m[1], 'from').slice(0, 300), body = m[2].trim(), hash = relayHash(from, body);
      keepRelay(state, 'in:' + hash + ':' + at, {key: 'in:' + hash + ':' + at, hash, direction: 'in', from, name: attr(m[1], 'from-name').slice(0, 120), text: body.slice(0, 20000), at, handed: false});
    }
  }
  const origin = record.type === 'user' ? record.origin : record.type === 'attachment' && record.attachment?.type === 'queued_command' ? record.attachment.origin : null;
  if (origin?.kind === 'peer' && typeof origin.msg_id === 'string' && !state.relayIds.has(origin.msg_id)) {
    state.relayIds.add(origin.msg_id);
    if (state.relayIds.size > RELAY_KEEP * 2) state.relayIds.delete(state.relayIds.values().next().value);
    const from = String(origin.from || '').slice(0, 300), body = String(origin.body || '').trim(), hash = relayHash(from, body);
    const queued = [...state.relays.values()].find(r => r.direction === 'in' && !r.handed && r.hash === hash);
    if (queued) queued.handed = true;
    else keepRelay(state, 'in:' + origin.msg_id, {key: 'in:' + origin.msg_id, hash, direction: 'in', from, name: String(origin.name || '').slice(0, 120), text: body.slice(0, 20000), at, handed: true});
  }
  if (record.type === 'user' && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) {
      // What SendMessage said about a send: one to another session names its address.
      if (block?.type === 'tool_result' && state.sends.has(block.tool_use_id)) {
        const use = state.sends.get(block.tool_use_id); state.sends.delete(block.tool_use_id);
        // The result comes as a string or as text blocks; read the text either way, so a
        // refusal ({"success":false,...}) is seen as one. A send with no message is only
        // an idle-notice subscription: nothing was said.
        const said = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(b => typeof b?.text === 'string' ? b.text : '').join('\n') : JSON.stringify(block.content || '');
        const address = (said.match(/\b(uds:[^\s;"'\\]+)/) || [])[1] || (String(use.to).startsWith('uds:') ? use.to : '');
        const other = address || /another Claude session|Remote Control session|cloud session|cross-session/i.test(said);
        if (other && String(use.message || '').trim() && !block.is_error && !/"success"\s*:\s*false/.test(said)) keepRelay(state, 'out:' + block.tool_use_id, {key: 'out:' + block.tool_use_id, direction: 'out', from: address.slice(0, 300), name: String(use.to || '').slice(0, 120), text: String(use.message || '').slice(0, 20000), at, handed: true});
      }
    }
  }
  if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) if (block?.type === 'tool_use' && block.name === 'SendMessage' && block.input) state.sends.set(block.id, {to: block.input.to, message: block.input.message});
    if (state.sends.size > 50) state.sends.delete(state.sends.keys().next().value);
  }
}
function relays(stateRoot, conversation) {
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return [];
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file ? read(file) : null;
  return state ? [...state.relays.values()] : [];
}

function read(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { readers.delete(file); return null; }
  let state = readers.get(file);
  // A shorter file is a different file: start over rather than read from the middle.
  if (!state || stat.size < state.offset) { state = blank(); readers.set(file, state); }
  if (stat.size > state.offset) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const length = stat.size - state.offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buffer, 0, length, state.offset);
      state.offset += read;
      // Split on bytes, not characters: the tail may stop mid-record and even
      // mid-codepoint, and decoding that would corrupt the next line.
      const chunk = Buffer.concat([state.partial, buffer.subarray(0, read)]);
      const end = chunk.lastIndexOf(0x0a);
      if (end < 0) { state.partial = chunk; return state; }
      state.partial = chunk.subarray(end + 1);
      for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
        if (!line) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        absorb(state, record);
      }
    } catch { return state; }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  }
  return state;
}

// A session imported from another directory keeps living in the project folder it
// was created in, so fall back to a scan — but remember the answer, including the
// absence of one, because this runs on every poll (several times a second across
// agents). Either answer is looked at again after a while; a file gone meanwhile
// reads as nothing (read() finds no file).
const located = new Map();
const LOOKUP_TTL_MS = 30000;
function locate(cwd, sessionId) {
  if (!sessionId) return null;
  const cached = located.get(sessionId);
  if (cached && cached.at > Date.now() - LOOKUP_TTL_MS) return cached.file;
  let file = path.join(PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId + '.jsonl');
  if (!fs.existsSync(file)) {
    file = null;
    try {
      for (const entry of fs.readdirSync(PROJECTS, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(PROJECTS, entry.name, sessionId + '.jsonl');
        if (fs.existsSync(candidate)) { file = candidate; break; }
      }
    } catch {}
  }
  located.set(sessionId, {file, at: Date.now()});
  return file;
}

function statesFor(stateRoot, conversation) {
  const out = [];
  for (const run of conversation.runs || []) {
    const cwd = path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number);
    const file = locate(cwd, run.sessionId);
    if (!file) continue;
    const state = read(file);
    if (state) out.push({run, state});
  }
  return out;
}

// Totals across every generation of one agent. Tokens are exact — they are copied
// from the usage Claude Code recorded. The dollar figure is derived from them, and
// the subscription these agents run under does not charge it; it is the
// API-equivalent value of the work.
function usage(stateRoot, conversation) {
  if (!conversation || conversation.mode !== 'claude') return null;
  const states = statesFor(stateRoot, conversation);
  if (!states.length) return null;
  const tokens = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0};
  const models = new Set();
  let costUSD = 0, turns = 0, unpriced = 0;
  const generations = [];
  for (const {run, state} of states) {
    for (const key of Object.keys(tokens)) tokens[key] += state.tokens[key];
    costUSD += state.costUSD;
    turns += state.turns;
    unpriced += state.unpriced;
    for (const model of state.models) models.add(model);
    generations.push({generation: run.number, turns: state.turns, costUSD: state.costUSD, tokens: {...state.tokens}});
  }
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {tokens: {...tokens, total}, costUSD, turns, unpriced, models: [...models], generations};
}

// What the newest generation is doing right now: the tool it is waiting on, how
// many tools this answer has taken, and when the current one started.
function progress(stateRoot, conversation) {
  if (!conversation || conversation.mode !== 'claude') return null;
  const states = statesFor(stateRoot, conversation);
  const current = states.at(-1);
  if (!current || current.run !== (conversation.runs || []).at(-1)) return null;
  const state = current.state;
  const running = [...state.running.values()].at(-1) || null;
  const now = Date.now();
  const background = liveBackground(state, now);
  const turn = inTurn(state, now);
  const note = turn && state.note ? (state.note.length > NOTE_MAX ? state.note.slice(0, NOTE_MAX) + '…' : state.note) : null;
  return {tool: running?.name || null, detail: running?.detail || null, since: running?.at || null, tools: state.tools, at: state.lastAt, background, inTurn: turn,
    turnSince: turn ? state.turnSince || null : null, note};
}

function liveBackground(state, now = Date.now()) {
  return [...state.background.values()].filter(job => !(Date.parse(job.since) < now - BACKGROUND_MAX_MS));
}

// What the Agents list needs to know, reading only the current run's transcript:
// whether Claude is in a turn, and how many jobs it left running in the background
// (a subagent at work, and no spinner on the list); for the wrap-up check, how many
// of them are subagents and which are commands.
function currentWork(stateRoot, conversation) {
  const none = {inTurn: false, background: 0, subagents: 0, commands: []};
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return none;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file ? read(file) : null;
  if (!state) return none;
  const jobs = liveBackground(state);
  return {inTurn: inTurn(state), background: jobs.length, subagents: jobs.filter(j => j.kind === 'subagent').length,
    commands: jobs.filter(j => j.kind === 'command').map(({description, since}) => ({description, since}))};
}

// When the usage limit that last stopped the current run resets: {at, seen} in ms.
function quotaReset(stateRoot, conversation) {
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return null;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file ? read(file) : null;
  return state?.quotaReset || null;
}

// Web messages the current run's Claude still holds for a turn to come, and every
// one it was ever handed; null when there is no transcript to ask.
function waiting(stateRoot, conversation) {
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return null;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file ? read(file) : null;
  return state ? {queued: new Set(state.queue.filter(Boolean)), handed: state.enqueued} : null;
}

// ---------------------------------------------------------------------------
// One turn, in full: what the model was given, what it did, what it sent back.
//
// The boundaries are exact rather than guessed. A turn opens with the user record
// the channel delivered — literally `<channel source="executive" message_id="…">`
// wrapping the text — and everything up to the next such record belongs to it,
// including the `mcp__executive__reply` whose message_id is the same, and whatever
// the model wrote after replying. So a bubble in the web UI and its transcript
// segment are matched by id.
const CHANNEL_OPEN = /^<channel\s+source="executive"\s+message_id="([0-9a-f-]{36})"/;
const MAX_TEXT = 20000;      // per block
const MAX_RECORDS = 400;     // per turn
const MAX_FILE = 64 * 1024 * 1024;
const TAIL = 32 * 1024 * 1024;

const clip = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1) ?? '';
  return text.length > MAX_TEXT ? {text: text.slice(0, MAX_TEXT), clipped: text.length} : {text};
};

// A message that arrives while Claude is still working is not a prompt of its own:
// Claude Code queues it and records it as an attachment (every bubble after such a message had "no transcript record").
function queuedPrompt(record) {
  return record?.type === 'attachment' && record.attachment?.type === 'queued_command' && typeof record.attachment.prompt === 'string'
    ? record.attachment.prompt : null;
}
function channelId(record) {
  const content = record?.message?.content;
  const text = typeof content === 'string' ? content : queuedPrompt(record);
  return typeof text === 'string' ? (CHANNEL_OPEN.exec(text)?.[1] || null) : null;
}

function project(record) {
  const message = record.message;
  const blocks = [];
  if (typeof message.content === 'string') blocks.push({type: 'text', ...clip(message.content)});
  else if (Array.isArray(message.content)) for (const block of message.content) {
    if (block.type === 'text') blocks.push({type: 'text', ...clip(block.text)});
    else if (block.type === 'thinking') blocks.push({type: 'thinking', ...clip(block.thinking || block.text)});
    else if (block.type === 'tool_use') blocks.push({type: 'tool_use', name: block.name, ...clip(block.input)});
    else if (block.type === 'tool_result') blocks.push({type: 'tool_result', isError: !!block.is_error, ...clip(block.content)});
    else blocks.push({type: block.type});
  }
  if (!blocks.length) return null;
  return {
    role: record.type === 'assistant' ? 'assistant' : 'user',
    at: record.timestamp || null,
    model: message.model || null,
    sidechain: !!record.isSidechain,
    usage: message.usage ? {
      input: message.usage.input_tokens || 0,
      output: message.usage.output_tokens || 0,
      cacheRead: message.usage.cache_read_input_tokens || 0,
      cacheWrite: message.usage.cache_creation_input_tokens || 0,
      thinking: message.usage.output_tokens_details?.thinking_tokens || 0,
    } : null,
    blocks,
  };
}

function readAll(file) {
  const stat = fs.statSync(file);
  if (stat.size <= MAX_FILE) return {text: fs.readFileSync(file, 'utf8'), partial: false};
  // A transcript this large is not expected; read the tail, where a turn the user
  // can still click almost certainly lives, and say the file was not read whole.
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(TAIL);
    const read = fs.readSync(fd, buffer, 0, TAIL, stat.size - TAIL);
    const chunk = buffer.subarray(0, read);
    const start = chunk.indexOf(0x0a);
    return {text: chunk.subarray(start + 1).toString('utf8'), partial: true};
  } finally { fs.closeSync(fd); }
}

// Whether the agent did anything but read and talk since a moment: a tool that can
// change something, in its current session. What the wrap-up check goes by: a question answered from what it read leaves nothing
// to commit or write down. Bash counts, read-only or not: nobody can tell from here.
const IDLE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'WebSearch', 'WebFetch', 'TodoWrite', 'ListAgents', 'AskUserQuestion', 'LSP', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool', 'Skill', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'EnterPlanMode', 'ExitPlanMode']);
function workedSince(stateRoot, conversation, since) {
  if (!conversation || conversation.mode !== 'claude') return false;
  const run = (conversation.runs || []).find(r => r.number === conversation.generation) || (conversation.runs || []).at(-1);
  if (!run) return false;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  if (!file) return false;
  let source;
  try { source = readAll(file); } catch { return false; }
  for (const line of source.text.split('\n')) {
    if (!line || !line.includes('"tool_use"')) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'assistant' || record.isSidechain || !(Date.parse(record.timestamp) >= since)) continue;
    const content = Array.isArray(record.message?.content) ? record.message.content : [];
    if (content.some(b => b?.type === 'tool_use' && typeof b.name === 'string' && !IDLE_TOOLS.has(b.name) && !b.name.startsWith('mcp__executive__'))) return true;
  }
  return false;
}

function segment(stateRoot, conversation, messageId) {
  if (!conversation || conversation.mode !== 'claude') return null;
  const message = (conversation.messages || []).find(m => m.id === messageId);
  if (!message) return null;
  // Either bubble of an exchange points at the same turn: the assistant's reply
  // records which user message it answered.
  const turnId = message.role === 'assistant' ? message.inReplyTo : message.role === 'user' ? message.id : null;
  if (!turnId) return null;
  const run = (conversation.runs || []).find(r => r.number === message.generation) || (conversation.runs || []).at(-1);
  if (!run) return null;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  if (!file) return null;

  let source;
  try { source = readAll(file); } catch { return null; }
  const records = [];
  const tokens = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0};
  const counted = new Set();
  let costUSD = 0, unpriced = 0, tools = 0, inside = false, answered = false, truncated = false, from = null, to = null;
  for (const line of source.text.split('\n')) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const opens = channelId(record);
    // The turn runs until the next message once this one is answered. Before its
    // answer, messages that arrive mid-turn are part of the work that led to it.
    if (opens) { if (inside && answered) break; if (!inside) { if (opens !== turnId) continue; inside = true; } }
    if (!inside) continue;
    const queued = queuedPrompt(record);
    if (queued) {
      const view = {role: 'user', at: record.timestamp || null, model: null, sidechain: false, usage: null, blocks: [{type: 'text', ...clip(queued)}]};
      if (records.length >= MAX_RECORDS) truncated = true; else { if (view.at) { from = from || view.at; to = view.at; } records.push(view); }
      continue;
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    const replies = Array.isArray(record.message?.content) ? record.message.content.filter(b => b?.type === 'tool_use' && b.name === 'mcp__executive__reply').map(b => b.input?.message_id) : [];
    // Answered, what comes with a reply to another message is that message's.
    if (answered && replies.some(id => id !== turnId)) break;
    if (replies.includes(turnId)) answered = true;
    const usage = record.message?.usage;
    if (usage && !zeroUsageError(record)) {
      const key = (record.message.id || record.uuid) + ':' + (record.apiBlockIndex ?? 0);
      if (!counted.has(key)) {
        counted.add(key);
        tokens.input += usage.input_tokens || 0;
        tokens.output += usage.output_tokens || 0;
        tokens.cacheRead += usage.cache_read_input_tokens || 0;
        tokens.cacheWrite += usage.cache_creation_input_tokens || 0;
        tokens.thinking += usage.output_tokens_details?.thinking_tokens || 0;
        const cost = messageCost(usage, record.message.model, record.message.service_tier);
        if (cost === null) unpriced += 1; else costUSD += cost;
      }
    }
    const view = project(record);
    if (!view) continue;
    for (const block of view.blocks) if (block.type === 'tool_use' && block.name !== 'mcp__executive__reply') tools += 1;
    if (records.length >= MAX_RECORDS) { truncated = true; continue; }
    if (view.at) { from = from || view.at; to = view.at; }
    records.push(view);
  }
  if (!records.length) return null;
  return {messageId, turnId, generation: run.number, from, to, tokens, costUSD, turns: counted.size, unpriced, tools, records, truncated, partialFile: source.partial};
}

// Turns this conversation never saw. An agent resumed from a session the owner
// ran elsewhere (their terminal, a channel plugin's session) carries that history in the same
// transcript, while the conversation page only holds what the web channel sent.
// Read-only and additive: every turn carries the record's own id, so importing
// twice adds nothing the second time.
//
// A web turn is recognised by the channel marker the executive server writes into
// the prompt. The marker is not always at the start — a changed profile is
// prepended to it — so it is matched anywhere in the text.
const WEB_TURN = /<channel\s+source="executive"\s+message_id="[0-9a-f-]{36}"/;
const CHANNEL_WRAPPER = /^<channel\b[^>]*>\s*([\s\S]*?)\s*<\/channel>\s*$/;
const SYSTEM_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// What a channel session actually showed its reader is the text it sent through
// the channel's reply tool, not the notes it left in the terminal.
const REPLY_TOOL = /__reply$/;
// Claude Code's own scaffolding: the runner's opening instruction, the profile
// header, hook feedback, background-task notices and the wrappers around locally
// run commands are not conversation. A channel prompt is marked isMeta as well,
// so the marker has to be the content, never the flag.
const NOT_CONVERSATION = [
  'Initialize this private web session',
  'Agent profile supplied by this conversation owner',
  'Stop hook feedback:',
  '<task-notification>',
  '<local-command-',
  '<command-name>',
  '<command-message>',
  'Caveat: The messages below were generated',
  '[Request interrupted',
];
// Notes recognised only where they begin, so an owner quoting one is still heard:
// Claude Code's nudge when a turn ended without visible text, as the start-up turn
// does, came in as the owner's words.
const NOTE_OPENINGS = ['[Your previous response had no visible output'];
// The runner's opening instruction starts an exchange of its own: whatever follows
// it until the next real prompt is start-up, not an answer to the turn before.
const RUNNER_START = 'Initialize this private web session';
// Claude Code flags its own notes to the model isMeta: hook feedback, image sizes,
// the no-visible-output nudge, a usage limit reset, another session's message. A
// channel prompt is flagged too, and it is the only one that is someone's words.
const CHANNEL_PROMPT = /^\s*<channel\b/;
// A web reply is already a bubble on this page, under the web message it answers.
const WEB_REPLY = /^mcp__executive__reply$/;
const MAX_IMPORT = 1000;

function readableText(value) {
  const wrapped = CHANNEL_WRAPPER.exec(value);
  const inner = wrapped ? wrapped[1] : value;
  const text = inner.replace(SYSTEM_BLOCK, '').trim();
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function assistantText(record) {
  const content = record.message?.content;
  if (typeof content === 'string') return readableText(content);
  if (!Array.isArray(content)) return '';
  const parts = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
  return parts.length ? readableText(parts.join('\n')) : '';
}

// skipped, when given, collects the records read and found not to be conversation,
// so turns imported before the importer knew better can be taken back out.
// A web exchange is left out only when this page already has that message: a
// session copied to another agent, or a page that lost bubbles, gets its web turns
// back too (a copied session brought in nothing).
const WEB_MESSAGE_ID = /<channel\s+source="executive"\s+message_id="([0-9a-f-]{36})"/;
const PROFILE_PREFIX = '\n\nUser message:\n';
function history(stateRoot, conversation, skipped = new Set()) {
  if (!conversation || conversation.mode !== 'claude') return [];
  const onPage = new Set((conversation.messages || []).map(m => m.id));
  const turns = [];
  for (const run of conversation.runs || []) {
    const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
    if (!file) continue;
    // Read whole, however large: importing is asked for by hand, and the tail alone
    // would leave out a large session's earlier turns.
    let source;
    try { source = {text: fs.readFileSync(file, 'utf8')}; } catch { continue; }
    // Only exchanges that began outside this page are taken: a web prompt and its
    // answer are already bubbles here, under their own message ids.
    // startup: between the runner's instruction and the next prompt, where what the
    // agent writes is its start-up notes.
    // A reply the tool refused never reached the page (a call without final, then
    // sent again with it, came in twice).
    const failed = new Set();
    for (const line of source.text.split('\n')) {
      if (!line.includes('"is_error":true')) continue;
      try { for (const b of JSON.parse(line).message?.content || []) if (b?.type === 'tool_result' && b.is_error) failed.add(b.tool_use_id); } catch {}
    }
    const refused = new Map();
    let active = false, answered = false, trailing = null, startup = false;
    // An exchange that never went through a reply tool (a plain terminal session)
    // is answered by its closing prose, not by every note along the way.
    const close = () => { if (active && !answered && trailing) turns.push(trailing); trailing = null; answered = false; };
    for (const line of source.text.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!record || record.isSidechain || typeof record.uuid !== 'string') continue;
      if (record.type === 'user') {
        const content = record.message?.content;
        if (typeof content !== 'string') continue;   // tool results and other structured turns
        // First: a compaction summary retells earlier turns, web markers included,
        // and must not end the exchange it happened in.
        if (record.isCompactSummary) continue;
        if (WEB_TURN.test(content)) {
          const id = WEB_MESSAGE_ID.exec(content)[1];
          close(); startup = false;
          if (onPage.has(id)) { active = false; continue; }
          const at = content.lastIndexOf(PROFILE_PREFIX);
          // The profile header sits inside the channel wrapper or before it.
          const rest = at >= 0 ? content.slice(at + PROFILE_PREFIX.length) : content;
          const text = readableText(CHANNEL_PROMPT.test(rest) ? rest : rest.replace(/\s*<\/channel>\s*$/, ''));
          if (!text) { active = false; continue; }
          active = true;
          turns.push({sourceUuid: record.uuid, role: 'user', text, at: record.timestamp || null, generation: run.number});
          continue;
        }
        if (content.trimStart().startsWith(RUNNER_START)) { close(); active = false; startup = true; skipped.add(record.uuid); continue; }
        if ((record.isMeta && !CHANNEL_PROMPT.test(content)) || NOT_CONVERSATION.some(marker => content.includes(marker))
          || NOTE_OPENINGS.some(opening => content.trimStart().startsWith(opening))) { skipped.add(record.uuid); continue; }
        const text = readableText(content);
        if (!text) continue;
        close();
        active = true;
        startup = false;
        turns.push({sourceUuid: record.uuid, role: 'user', text, at: record.timestamp || null, generation: run.number});
      } else if (record.type === 'assistant' && !active) {
        if (startup) skipped.add(record.uuid);
      } else if (record.type === 'assistant') {
        const content = record.message?.content;
        if (Array.isArray(content)) content.forEach((block, index) => {
          if (block?.type !== 'tool_use' || !REPLY_TOOL.test(block.name || '')) return;
          // Left out; an earlier import of it goes only once the same words were sent.
          if (failed.has(block.id)) { const t = readableText(String(block.input?.text || '')); refused.set(t, [...(refused.get(t) || []), record.uuid + ':' + index]); return; }
          const sent = typeof block.input?.text === 'string' ? readableText(block.input.text) : '';
          if (!sent) return;
          // Answered, and the answer is on the page already: a question typed in the
          // terminal and answered in the web chat brings in only the question.
          // Marked by its own block, so another reply in the same record stays.
          for (const key of refused.get(sent) || []) skipped.add(key);
          if (WEB_REPLY.test(block.name) && (typeof block.input?.message_id !== 'string' || onPage.has(block.input.message_id))) { answered = true; trailing = null; skipped.add(record.uuid + ':' + index); return; }
          turns.push({sourceUuid: record.uuid + ':' + index, role: 'assistant', text: sent, at: record.timestamp || null, generation: run.number});
          answered = true;
          trailing = null;
        });
        const text = assistantText(record);
        if (text && !answered) trailing = {sourceUuid: record.uuid, role: 'assistant', text, at: record.timestamp || null, generation: run.number};
      }
    }
    close();
  }
  return turns.slice(-MAX_IMPORT);
}

// The current run's skills, for the slash menu.
function skills(stateRoot, conversation) {
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return [];
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file ? read(file) : null;
  return state ? [...state.skills].map(([name, description]) => ({name, description: description.slice(0, 300)})) : [];
}

// The claude.ai connectors an agent has had tools from (they are named in its
// transcript as mcp__claude_ai_<Name>__…), as /mcp names them: "claude.ai Name".
function connectors(stateRoot, conversation) {
  const run = (conversation?.runs || []).at(-1);
  if (conversation?.mode !== 'claude' || !run) return [];
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  if (!file) return [];
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const size = fs.fstatSync(fd).size, len = Math.min(size, 4 * 1024 * 1024), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return []; }
  return [...new Set([...text.matchAll(/mcp__claude_ai_([A-Za-z0-9-]+?)__/g)].map(m => 'claude.ai ' + m[1].replace(/_/g, ' ')))].slice(0, 20);
}

// The last compaction of the agent's current session, as its transcript records it.
function lastCompaction(stateRoot, conversation) {
  const run = (conversation.runs || []).find(r => r.number === conversation.generation) || (conversation.runs || []).at(-1);
  if (!run) return null;
  const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
  const state = file && read(file);
  return state?.compactions.at(-1) || null;
}

// The subagents an agent started: Claude Code keeps
// each one's own transcript beside the session's, in <session>/subagents, with a note
// of what it was (type, task, the tool call that started it). Read once per file as
// it stands, newest first, the largest reports cut short.
const SUBAGENT_MAX = 100, SUBAGENT_FILE_MAX = 30 * 1024 * 1024;
const subagentCache = new Map();
function readSubagent(file, metaFile) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (!stat.isFile() || stat.size > SUBAGENT_FILE_MAX) return null;
  const key = stat.size + ':' + stat.mtimeMs, cached = subagentCache.get(file);
  if (cached?.key === key) return cached.value;
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) || {}; } catch {}
  const value = {type: typeof meta.agentType === 'string' ? meta.agentType.slice(0, 80) : '', task: typeof meta.description === 'string' ? meta.description.slice(0, 200) : '',
    toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null, startedAt: null, endedAt: null, messages: 0, tools: 0,
    tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, costUSD: 0, unpriced: 0, models: [], prompt: '', result: ''};
  const counted = new Set(), models = new Set();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const message = record.message;
    if (!message || (record.type !== 'user' && record.type !== 'assistant')) continue;
    if (record.timestamp) { value.startedAt ??= record.timestamp; value.endedAt = record.timestamp; }
    value.messages += 1;
    if (record.type === 'user' && !value.prompt) value.prompt = (typeof message.content === 'string' ? message.content : (message.content || []).filter(b => b?.type === 'text').map(b => b.text).join('\n')).slice(0, 4000);
    if (record.type !== 'assistant') continue;
    const said = assistantText(record);
    if (said) value.result = said.slice(0, 12000);
    if (Array.isArray(message.content)) value.tools += message.content.filter(b => b?.type === 'tool_use').length;
    const usage = message.usage;
    if (!usage || zeroUsageError(record)) continue;
    const id = (message.id || record.uuid) + ':' + (record.apiBlockIndex ?? 0);
    if (counted.has(id)) continue;
    counted.add(id);
    value.tokens.input += usage.input_tokens || 0; value.tokens.output += usage.output_tokens || 0;
    value.tokens.cacheRead += usage.cache_read_input_tokens || 0; value.tokens.cacheWrite += usage.cache_creation_input_tokens || 0;
    if (message.model) models.add(message.model);
    const cost = messageCost(usage, message.model, message.service_tier);
    if (cost === null) value.unpriced += 1; else value.costUSD += cost;
  }
  value.models = [...models];
  subagentCache.set(file, {key, value});
  if (subagentCache.size > 2000) subagentCache.delete(subagentCache.keys().next().value);
  return value;
}
function subagents(stateRoot, conversation) {
  if (!conversation || conversation.mode !== 'claude') return [];
  const out = [];
  for (const run of conversation.runs || []) {
    const file = locate(path.join(stateRoot, 'workspaces', conversation.id, 'g' + run.number), run.sessionId);
    if (!file) continue;
    const dir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => /^agent-[A-Za-z0-9_-]{1,80}\.jsonl$/.test(n)); } catch { continue; }
    for (const name of names) {
      const one = readSubagent(path.join(dir, name), path.join(dir, name.replace(/\.jsonl$/, '.meta.json')));
      if (one && one.startedAt) out.push({id: name.slice('agent-'.length, -'.jsonl'.length), generation: run.number, ...one});
    }
  }
  return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, SUBAGENT_MAX);
}

module.exports = {workedSince, subagents, lastCompaction, usage, progress, currentWork, quotaReset, waiting, skills, connectors, relays, segment, history, messageCost, priceOf, PRICES, WEB_SEARCH_USD};

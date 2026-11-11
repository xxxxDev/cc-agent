// What an agent's owner types straight into its terminal, and the agent's answer to it,
// shown in the chat too. transcript.js feeds every record
// of a session's transcript, in order, to track(); agentStore.mirrorTerminal takes the events
// it keeps and adds them to the conversation, flagged via:'terminal'.
//
// Which records are a prompt someone typed is decided by classify(), and it is conservative:
// anything it is not sure of is left out. Claude Code (2.1.310 and later) marks a prompt
// typed at its own input as origin {kind:'human'}, promptSource 'typed' (or 'queued' when
// typed during a turn), not isMeta. Everything else it writes as a user record says what it
// is: a web message arrives as a channel prompt (isMeta, origin channel, wrapped in
// <channel source="executive" ...>), another session's message as origin peer, a finished
// background task as origin task-notification, its own notes (hook feedback, image sizes,
// the no-visible-output nudge) as isMeta, a slash command as <command-name>/<local-command-*>
// wrappers, a compaction as isCompactSummary, an image's file as a meta companion of its
// prompt. The runner's start-up instruction is typed (it is Claude's first prompt) and is
// recognised by its words. On top of the marks, text that starts like any of those is
// skipped as well, in case a version marks one differently.
//
// A turn's answer is the last text the agent wrote in it, outside subagents, once the turn
// is over (turn_duration, a stop_hook_summary that did not hold the turn open, or the next
// prompt of any kind). There is none when the turn also carried a web message or used the
// executive tools (reply, post: the answer is in the chat already, or was meant for someone
// else), when it was interrupted, or when it wrote nothing.
//
// Bounded: at most EVENTS_MAX events are kept per transcript, and the picture data of a
// prompt only for the last PICTURES_KEPT prompts that had any, at most PICTURES_MAX each and
// PICTURE_CHARS of base64 each; the text of each at TEXT_MAX.
const EVENTS_MAX = 40, PICTURES_KEPT = 3, PICTURES_MAX = 4, PICTURE_CHARS = 8 * 1024 * 1024, TEXT_MAX = 20000;
const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const RUNNER_START = 'Initialize this private web session';
// Text that is never someone's words when it opens a prompt.
const NOT_TYPED = [
  /^<(channel|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification|system-reminder|cross-session-message|agent-message|user-prompt-submit-hook)\b/,
  /^\//,                                   // a slash command typed raw (/compact)
  /^Another Claude session sent a message/,
  /^Stop hook feedback/,
  /^\[Request interrupted/,
  /^\[Your previous response had no visible output/,
  /^\[Image: (source|original)/,
  /^Caveat: The messages below were generated/,
  /^This session is being continued from a previous conversation/,
];
// Anywhere in it: the runner's instruction and the profile header CC Agent prepends.
const NOT_TYPED_ANYWHERE = [RUNNER_START, 'Agent profile supplied by this conversation owner', '<channel source="executive"'];
const SYSTEM_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const IMAGE_TOKEN = /\[Image #\d+\]\s?/g;
const INTERRUPTED = '[Request interrupted';

const textOf = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';

// A typed prompt, as {text, pictures}, or null. pictures: [{type, data}] as Claude Code keeps
// them (base64), only of the kinds a page shows.
function classify(record) {
  if (!record || record.type !== 'user' || typeof record.uuid !== 'string') return null;
  if (record.isSidechain || record.isMeta || record.isCompactSummary || record.isVisibleInTranscriptOnly || record.turnCompanion) return null;
  if (record.toolUseResult !== undefined || record.sourceToolUseID !== undefined) return null;
  if (!record.origin || record.origin.kind !== 'human') return null;
  if (record.promptSource !== undefined && !['typed', 'queued'].includes(record.promptSource)) return null;
  const content = record.message && record.message.content;
  if (typeof content !== 'string' && !Array.isArray(content)) return null;
  // Only words and pictures: a tool result or any other block is not a typed prompt.
  if (Array.isArray(content) && (!content.length || content.some(b => !b || !['text', 'image'].includes(b.type)))) return null;
  const raw = textOf(content);
  const opening = raw.trimStart();
  if (NOT_TYPED.some(re => re.test(opening)) || NOT_TYPED_ANYWHERE.some(s => raw.includes(s))) return null;
  const pictures = Array.isArray(content) ? content.filter(b => b.type === 'image' && b.source && b.source.type === 'base64'
    && PICTURE_TYPES.has(b.source.media_type) && typeof b.source.data === 'string' && b.source.data.length <= PICTURE_CHARS)
    .slice(0, PICTURES_MAX).map(b => ({type: b.source.media_type, data: b.source.data})) : [];
  let text = raw.replace(SYSTEM_BLOCK, '');
  if (pictures.length) text = text.replace(IMAGE_TOKEN, '');
  text = text.trim();
  if (!text && !pictures.length) return null;
  return {text: Array.from(text).slice(0, TEXT_MAX).join(''), pictures};
}

const blank = () => ({open: null, events: []});
function push(state, event) {
  state.events.push(event);
  if (state.events.length > EVENTS_MAX) state.events.splice(0, state.events.length - EVENTS_MAX);
  // Picture data only for the last few prompts that had any.
  let kept = 0;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.kind === 'prompt' && e.pictures && e.pictures.length && ++kept > PICTURES_KEPT) e.pictures = null;
  }
}
function close(state, {answer = true} = {}) {
  const open = state.open;
  state.open = null;
  if (!open || !answer || open.mixed || !open.last || !open.last.text) return;
  push(state, {kind: 'answer', uuid: open.last.uuid, prompt: open.uuid, at: open.last.at, text: Array.from(open.last.text).slice(0, TEXT_MAX).join('')});
}
// A user record that opens something else: the next prompt of any kind. Tool results,
// Claude Code's notes within a turn and compaction summaries do not.
function opensOther(record) {
  if (record.isCompactSummary || record.isVisibleInTranscriptOnly) return false;
  const content = record.message && record.message.content;
  if (Array.isArray(content) && content.some(b => b && b.type === 'tool_result')) return false;
  const text = textOf(content).trimStart();
  if (record.isMeta) return /^<channel\b/.test(text) || /^Another Claude session sent a message/.test(text);
  return !!text;
}

function track(state, record) {
  if (!record || record.isSidechain) return;
  if (record.type === 'system') {
    if (!state.open) return;
    if (record.subtype === 'turn_duration') close(state);
    // A Stop hook that holds the turn open (CC Agent's own, when a reply is still owed) is
    // recorded with its errors and the turn goes on.
    else if (record.subtype === 'stop_hook_summary' && !(Array.isArray(record.hookErrors) && record.hookErrors.length)) close(state);
    return;
  }
  if (record.type === 'attachment') {
    // A message that arrived while the turn ran, queued by Claude Code: a web message (or
    // another session's) makes the turn's answer not the terminal's alone.
    const queued = record.attachment && record.attachment.type === 'queued_command' && typeof record.attachment.prompt === 'string' ? record.attachment.prompt : '';
    if (state.open && /^\s*(<channel\b|Another Claude session sent a message)/.test(queued)) state.open.mixed = true;
    return;
  }
  if (record.type === 'user') {
    const content = record.message && record.message.content;
    // A picture's file, written beside its prompt: where it came from.
    if (record.isMeta && record.turnCompanion && state.open && record.promptId && record.promptId === state.open.promptId) {
      const event = state.events.find(e => e.kind === 'prompt' && e.uuid === state.open.uuid);
      if (event && Array.isArray(content)) for (const b of content) {
        const m = b && b.type === 'text' && typeof b.text === 'string' ? /^\[Image: source: (\/[^\]\n]{1,1000})\]$/.exec(b.text.trim()) : null;
        if (m && event.sources.length < PICTURES_MAX) event.sources.push(m[1]);
      }
      return;
    }
    if (Array.isArray(content) && content.some(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED))) { close(state, {answer: false}); return; }
    const typed = classify(record);
    if (typed) {
      close(state);
      state.open = {uuid: record.uuid, promptId: typeof record.promptId === 'string' ? record.promptId : null, mixed: false, last: null};
      push(state, {kind: 'prompt', uuid: record.uuid, at: record.timestamp || null, text: typed.text, pictures: typed.pictures, sources: []});
      return;
    }
    if (state.open && opensOther(record)) {
      // A web message delivered in the middle of the turn is part of it; anything else
      // starts a turn of its own.
      if (record.isMeta) state.open.mixed = true; else close(state);
    }
    return;
  }
  if (record.type === 'assistant' && state.open) {
    const content = record.message && record.message.content;
    if (!Array.isArray(content)) return;
    if (content.some(b => b && b.type === 'tool_use' && typeof b.name === 'string' && /^mcp__executive__/.test(b.name))) state.open.mixed = true;
    const text = content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').replace(SYSTEM_BLOCK, '').trim();
    if (!text) return;
    // One message is written as several records, one per block: its words are joined.
    const id = record.message.id || record.uuid;
    const last = state.open.last;
    state.open.last = last && last.id === id ? {...last, uuid: record.uuid, text: last.text + '\n\n' + text} : {id, uuid: record.uuid, at: record.timestamp || null, text};
  }
}

module.exports = {classify, track, blank, EVENTS_MAX, PICTURES_KEPT, PICTURES_MAX};

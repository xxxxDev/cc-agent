// What a conversation's typing bubbles say, read from the agent as the server
// reports it: the conversation page and a split-view cell ask the same questions,
// so they get the same answers here.
import {progressLine, backgroundLine} from './agent-i18n.js';

const shortToolName = name => String(name || '').replace(/^mcp__/, '').split('__').pop();
const secondsSince = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null; };

// After a reply the turn takes a few seconds to close, and the typing bubble
// flashed up for them though nothing more was coming. An agent can answer in several messages, so this is a grace period
// rather than a rule: a tool started after the reply, or a turn still open after
// it, shows the agent at work again.
export const SETTLE_MS = 8000;
export function settlingAfterReply(d) {
  if (d?.phase !== 'busy') return false;
  const last = d.messages?.at(-1);
  if (last?.role !== 'assistant') return false;
  const answered = Date.parse(last.at || 0);
  if (!Number.isFinite(answered) || Date.now() - answered > SETTLE_MS) return false;
  // A tool still running means the agent is at work, whenever it started.
  return !d.progress?.tool;
}

// A turn runs from the user's message until the agent's turn ends, not until its
// first reply: an agent may answer in several messages ("checking now", then the
// result), and the typing bubble has to stay under them the whole time. Compaction has
// its own shield, so it is left out.
export function awaitingReply(d) {
  if (d?.phase !== 'busy' || d.compacting || settlingAfterReply(d)) return false;
  const last = d.messages?.findLast(m => m.role === 'user');
  return !!last && ['queued', 'delivered', 'completed'].includes(last.delivery);
}

// One line of "what is it doing right now", read from the agent's own Claude Code
// transcript by the server. It only exists while the agent is actually working, so
// an idle page keeps its full height and nothing shifts. locked: an operation
// (starting, compacting) has the agent, and says so itself.
export function progressText(d, {locked = false} = {}) {
  if (!d || d.mode !== 'claude' || d.phase !== 'busy' || locked || settlingAfterReply(d)) return '';
  const p = d.progress || {};
  const lastAt = d.messages?.at(-1)?.at;
  // A subagent in the foreground is named by its task rather than "Agent".
  const tool = p.detail ? 'subagent：' + p.detail : p.tool ? shortToolName(p.tool) : '';
  // The step's own time, and the turn's as Claude Code's terminal counts it (the
  // two can differ by many minutes).
  // Thinking is counted from the chat's last message, but never from before the turn began: a
  // start-up turn after a restart sends nothing to the chat.
  const thinking = [lastAt, p.turnSince].filter(t => Number.isFinite(Date.parse(t || ''))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return progressLine({tool, tools: p.tools || 0, seconds: secondsSince(p.since || thinking), total: p.turnSince ? secondsSince(p.turnSince) : null});
}

// What the agent last said in its terminal during this turn, shown above that line
// in the typing bubble; its replies are already in the chat.
export function progressNote(d, {locked = false} = {}) {
  if (!progressText(d, {locked})) return '';
  return typeof d.progress?.note === 'string' ? d.progress.note : '';
}

// Background work outlives the turn, so it shows whether or not the agent is
// answering, for as long as the agent is up.
export function backgroundText(d, {locked = false} = {}) {
  if (!d || d.mode !== 'claude' || !d.connected || !['ready', 'busy'].includes(d.phase) || locked) return '';
  const jobs = Array.isArray(d.progress?.background) ? d.progress.background : [];
  const subagents = jobs.filter(j => j.kind === 'subagent');
  const starts = jobs.map(j => Date.parse(j.since || '')).filter(Number.isFinite);
  const commands = jobs.filter(j => j.kind !== 'subagent');
  return backgroundLine({subagents: subagents.length, commands: commands.length, task: subagents[0]?.description || '', command: commands[0]?.description || '',
    seconds: starts.length ? secondsSince(new Date(Math.min(...starts)).toISOString()) : null});
}

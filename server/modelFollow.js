// Agent Profile follows the terminal: a model, and an
// effort when one is reported, picked with /model in the agent's own terminal is saved into
// its profile, so the profile says what the session runs and its next start runs it too.
//
// What the session runs comes from its status line (channel/statusLine.cjs -> context.json ->
// contextUsage.view), the only place Claude Code reports it. That file is written by the
// agent's own process, so it is read as untrusted (contextUsage checks its shape) and is only
// ever compared with the lists the profile may hold (agentProfile.validate, run by the caller
// as check()); nothing outside them is saved.
//
// The rules that keep it from flapping, all here so they can be tested on their own:
// - a save of the profile waiting for a restart (pending) wins: nothing is followed;
// - only a report from this start of the session, written a while after it was launched
//   (GRACE_MS: a status line of the run stopped for the restart can still land just after
//   the new launch), counts; an older one or a stale one (the session not alive) never;
// - only a change from what the session itself was running counts (session: the model and
//   effort it was launched with, moved along by what was followed). A profile its owner has
//   just saved, which the session has not restarted onto yet, differs from the report but the
//   report does not differ from the session: nothing is overwritten. Once a /model typed in the terminal is seen, its result is
//   weighed against the profile, so a change the status line showed a moment before the
//   command reached the transcript is still saved;
// - a reported effort of null (not reported) changes nothing about the effort;
// - only what was picked in the terminal is saved: the status
//   line also moves by itself (a fallback model when one is overloaded, opusplan between its
//   two models), so the profile changes only when the session's transcript has a /model
//   (model and effort) or /effort (effort) typed since the last follow point (typed, since:
//   transcript.typedSettings and what was followed before), and a status line written after
//   it. Anything else only moves what the session is shown to run. That command is then
//   followed (the result's followed), so a later change with no new command is shown only.
const GRACE_MS = 5000;

function decide({report, session = {}, saved = {}, launchedAt = 0, pending = false, check = () => false, typed = {}, since = 0} = {}) {
  if (pending) return {kind: 'none', reason: 'pending'};
  if (!report || typeof report.model !== 'string' || !report.model) return {kind: 'none', reason: 'no-report'};
  const at = Number(report.at);
  if (report.stale || !Number.isFinite(at) || !Number.isFinite(launchedAt) || at < launchedAt + GRACE_MS) return {kind: 'none', reason: 'stale'};
  const effort = typeof report.effort === 'string' && report.effort ? report.effort : null;
  const modelMoved = report.model !== session.model, effortMoved = !!effort && effort !== session.effort;
  const moved = modelMoved || effortMoved;
  const now = {model: report.model, effort: effort || session.effort || null};
  const from = Math.max(Number(since) || 0, launchedAt);
  const after = v => Number.isFinite(v) && v > from;
  const modelTyped = after(typed.model), effortTyped = modelTyped || after(typed.effort);
  const typedAt = Math.max(modelTyped ? typed.model : 0, after(typed.effort) ? typed.effort : 0);
  // No command since the last follow point, or the status line not written since it: shown only.
  if (!typedAt || at < typedAt) return moved ? {kind: 'session', session: now, reason: typedAt ? 'not-yet' : 'not-typed'} : {kind: 'none', reason: 'unchanged'};
  // What was picked, against what the profile holds (a change the status line showed
  // before the command reached the transcript counts too); the rest as it is saved.
  const want = {model: modelTyped ? report.model : saved.model, effort: effortTyped && effort ? effort : saved.effort};
  const followed = {followed: typedAt};
  if (want.model === saved.model && want.effort === saved.effort) return moved ? {kind: 'session', session: now, reason: 'same-as-profile', ...followed} : {kind: 'none', reason: 'same-as-profile', ...followed};
  if (check(want)) return {kind: 'save', session: now, profile: want, ...followed};
  // An effort outside the lists does not keep an allowed model out, and the other way round.
  const parts = [{model: want.model, effort: saved.effort}, {model: saved.model, effort: want.effort}]
    .filter(p => !(p.model === saved.model && p.effort === saved.effort));
  const fallback = parts.find(p => check(p));
  if (fallback) return {kind: 'save', session: now, profile: fallback, reason: 'partly-allowed', ...followed};
  return {kind: 'session', session: now, reason: 'not-allowed', ...followed};
}

module.exports = {decide, GRACE_MS};

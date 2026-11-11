// Agent Profile follows the terminal (2026-11-10): a model, and an
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
//   report does not differ from the session: nothing is overwritten;
// - a reported effort of null (not reported) changes nothing about the effort.
const GRACE_MS = 5000;

function decide({report, session = {}, saved = {}, launchedAt = 0, pending = false, check = () => false} = {}) {
  if (pending) return {kind: 'none', reason: 'pending'};
  if (!report || typeof report.model !== 'string' || !report.model) return {kind: 'none', reason: 'no-report'};
  const at = Number(report.at);
  if (report.stale || !Number.isFinite(at) || !Number.isFinite(launchedAt) || at < launchedAt + GRACE_MS) return {kind: 'none', reason: 'stale'};
  const effort = typeof report.effort === 'string' && report.effort ? report.effort : null;
  const modelMoved = report.model !== session.model, effortMoved = !!effort && effort !== session.effort;
  if (!modelMoved && !effortMoved) return {kind: 'none', reason: 'unchanged'};
  const now = {model: report.model, effort: effort || session.effort || null};
  // What the profile would hold: what moved, and the rest as it is saved.
  const want = {model: modelMoved ? report.model : saved.model, effort: effortMoved ? effort : saved.effort};
  if (want.model === saved.model && want.effort === saved.effort) return {kind: 'session', session: now, reason: 'same-as-profile'};
  if (check(want)) return {kind: 'save', session: now, profile: want};
  // An effort outside the lists does not keep an allowed model out, and the other way round.
  const parts = [modelMoved && {model: want.model, effort: saved.effort}, effortMoved && {model: saved.model, effort: want.effort}]
    .filter(p => p && !(p.model === saved.model && p.effort === saved.effort));
  const fallback = parts.find(p => check(p));
  if (fallback) return {kind: 'save', session: now, profile: fallback, reason: 'partly-allowed'};
  return {kind: 'session', session: now, reason: 'not-allowed'};
}

module.exports = {decide, GRACE_MS};

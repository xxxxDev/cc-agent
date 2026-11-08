const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Only the path and query of an address are read; any base resolves a relative one.
const BASE = 'http://localhost';
const pathPattern = new RegExp(`^/agents/(${UUID})/?$`, 'i');
export function agentIdFromUrl(href) {
  const url = new URL(href, BASE);
  const id = url.pathname.match(pathPattern)?.[1] || url.searchParams.get('conversation');
  return id && new RegExp(`^${UUID}$`, 'i').test(id) ? id : null;
}
export function agentUrl(id) { return `/agents/${encodeURIComponent(id)}`; }
// Where a scope-report notification lands (server/services/pushService.js).
export function reportIdFromUrl(href) {
  const id = new URL(href, BASE).searchParams.get('access-report');
  return id && new RegExp(`^${UUID}$`, 'i').test(id) ? id : null;
}
// Where a diagnostics report's notification lands (the same file).
export function diagnosticIdFromUrl(href) {
  const id = new URL(href, BASE).searchParams.get('diagnostic-report');
  return id && new RegExp(`^${UUID}$`, 'i').test(id) ? id : null;
}
// Where a new schedule proposal's notification lands (server/services/pushService.js).
export function scheduleIdFromUrl(href) {
  const id = new URL(href, BASE).searchParams.get('schedule');
  return id && new RegExp(`^${UUID}$`, 'i').test(id) ? id : null;
}

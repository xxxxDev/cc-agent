// This product's screens: which tabs there are, the pages of its own
// tabs' routers and the address of each, and its addresses that are not such a page.
// js/appUrl.js (which holds the Settings tab's pages) and js/tab-session.js read it
// and are generic; what is here is CC Agent's own.
import {agentIdFromUrl, agentUrl, reportIdFromUrl, diagnosticIdFromUrl, scheduleIdFromUrl} from './agentUrl.js';

export const ID = '[A-Za-z0-9_-]{1,64}';
export const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Every tab, and the one a stored tab that is no longer there falls back to.
// A stored tab id that is not in this list falls back to chat.
// 'view-admin' is an admin's only; App.vue moves anyone else off it.
export const TAB_IDS = ['view-chat', 'view-groups', 'view-schedules', 'view-admin', 'view-settings'];
export const HOME_TAB = 'view-chat';
// The tab that holds Manage Users (pages/UsersPage.vue opens an account in it).
export const ADMIN_TAB = 'view-admin';

// The product's tabs whose pages live in their own F7 router, rows as in appUrl.js's
// Settings pages. The admin's pages moved from Settings to their own tab;
// their old /settings/... addresses still open them (oldPath).
export const TAB_PAGES = {
  // Group chats: the list, and one group.
  'view-groups': [
    {route: '/groups/', path: '/groups'},
    {route: '/group/', path: '/groups/:id', id: UUID, parent: '/groups/'},
  ],
  'view-admin': [
    {route: '/admin/', path: '/admin', admin: true},
    {route: '/users/', path: '/admin/users', parent: '/admin/', admin: true},
    {route: '/user/', path: '/admin/users/:id', id: ID, parent: '/users/', admin: true},
    {route: '/access-reports/', path: '/admin/access-reports', parent: '/admin/', admin: true},
    {route: '/access-report/', path: '/admin/access-reports/:id', id: UUID, parent: '/access-reports/', admin: true},
    {route: '/diagnostic-reports/', path: '/admin/diagnostic-reports', parent: '/admin/', admin: true},
    {route: '/nav-buttons/', path: '/admin/nav-buttons', parent: '/admin/', admin: true},
    {route: '/diagnostic-report/', path: '/admin/diagnostic-reports/:id', id: UUID, parent: '/diagnostic-reports/', admin: true},
    {route: '/security/', path: '/admin/security', parent: '/admin/', admin: true},
  ],
};

export const oldPath = (path) => path.replace(/^\/settings(?=\/(users|access-reports)(\/|$))/, '/admin');

// The address of a tab with no page table (appUrl.js asks only for those).
export function tabAddress({tab, route, conversationId}) {
  if (tab === 'view-schedules') return '/schedules';
  // The chat tab keeps the addresses it already had: `/` for the list and
  // `/agents/<id>` for a conversation (agent-chat.js).
  return route?.path === '/conversation/' && conversationId ? agentUrl(conversationId) : '/';
}

// An address that opens something other than a page of TAB_PAGES: its screen, null
// for one the home tab resolves itself, or undefined. path: url's path without its
// trailing slashes.
export function specialScreen(url, path) {
  // A scope-report notification's link (server/services/pushService.js).
  const report = reportIdFromUrl(url.href);
  if (report) return {tab: 'view-admin', admin: true, stack: ['/access-reports/', `/access-report/?id=${report}`]};
  // A diagnostics report's notification (the same file).
  const diagnostic = diagnosticIdFromUrl(url.href);
  if (diagnostic) return {tab: 'view-admin', admin: true, stack: ['/diagnostic-reports/', `/diagnostic-report/?id=${diagnostic}`]};
  // A group reply's notification: that group.
  const group = url.searchParams.get('group');
  if (group && new RegExp(`^${UUID}$`).test(group)) return {tab: 'view-groups', stack: [`/group/?id=${group}`]};
  // A schedule proposal's notification: the Schedules tab, which opens that one.
  const schedule = scheduleIdFromUrl(url.href);
  if (schedule) return {tab: 'view-schedules', stack: [], schedule};
  if (agentIdFromUrl(url.href)) return null;
  if (path === '/schedules') return {tab: 'view-schedules', stack: []};
  return undefined;
}

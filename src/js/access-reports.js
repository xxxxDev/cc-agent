import {f7} from 'framework7-vue';
import {ct, labelled} from './agent-i18n.js';
import {timeLocale} from './i18n.js';
import {setActiveTab} from './tab-session.js';

// How a scope report reads on the review pages: its icon, style and label.
export function reportMeta(r) {
  // CC Agent's digest of many reports an agent said it solved itself.
  if (r.kind === 'digest' && r.status === 'open') return {icon: 'exclamationmark_triangle_fill', cls: 'report-open', label: ct('未處理')};
  if (r.status === 'open') return {icon: r.kind === 'permission' ? 'hand_raised_fill' : 'lock_shield_fill', cls: 'report-open', label: ct('未處理')};
  // What the agent said it solved within its scope (explain_report): a record, not a to-do.
  if (r.status === 'self-resolved') return {icon: 'checkmark_circle', cls: 'report-self', label: ct('Agent 已自行解決')};
  if (r.resolution === 'granted') return {icon: 'checkmark_seal_fill', cls: 'report-granted', label: ct('已開通')};
  return {icon: 'xmark_seal_fill', cls: 'report-dismissed', label: ct('已略過')};
}

export const reportKind = (r) => (r.kind === 'permission' ? ct('要求權限') : r.kind === 'digest' ? ct('多次自行解決') : ct('被沙盒擋下'));
// A digest's one line: how many, within the day, and by which tools.
export const digestLine = (r) => labelled(ct('24 小時內說已自行解決'), `${r.count || 0} ${ct('次')}${r.detail ? ' · ' + r.detail : ''}`);

export function reportTime(at) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(timeLocale(), {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
}

export const excerpt = (text, n = 120) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

export const listOrNone = (items) => (items || []).join('\n');

// One of the Admin tab's report pages, from anywhere (a chat's report card, an agent's
// profile): that tab, with the page over whatever it showed; the same page is replaced.
export function openAdminPage(url) {
  setActiveTab('view-admin');
  const router = f7.views?.get('#view-admin')?.router;
  if (!router) return;
  if (router.currentRoute?.path === url.split('?')[0]) router.navigate(url, {reloadCurrent: true, animate: false});
  else router.navigate(url);
}
export const openAccessReport = (id) => openAdminPage(`/access-report/?id=${encodeURIComponent(id)}`);
export const openAgentReports = (id) => openAdminPage(`/access-reports/?agent=${encodeURIComponent(id)}`);

// What an agent keeps running into: the tool, and for a command its program.
export function reportHabit(r) {
  const tool = String(r.tool || ct('未知工具'));
  const command = /"command"\s*:\s*"\s*([^"\s;|&]+)/.exec(String(r.detail || ''));
  return command ? `${tool} ${command[1].split('/').pop()}` : tool;
}
// Per agent: how many reports, how many it solved itself, still needed (open ones only,
// never a dismissed or granted one), granted, and its
// most frequent tools or commands. Newest agent first, as the list. A digest is CC Agent's
// note about the others, not a report of the agent's, so it is in none of the counts.
export function agentSummaries(list) {
  const by = new Map();
  for (const r of list) {
    if (r.kind === 'digest') continue;
    const key = r.conversationId || r.title || '';
    if (!by.has(key)) by.set(key, {id: key, title: r.agentTitle || r.title || 'Agent', ownerName: r.ownerName || '', total: 0, self: 0, needed: 0, granted: 0, habits: new Map()});
    const a = by.get(key);
    a.total += 1;
    if (r.status === 'self-resolved') a.self += 1;
    else if (r.status === 'open') a.needed += 1;
    if (r.resolution === 'granted') a.granted += 1;
    const habit = reportHabit(r);
    a.habits.set(habit, (a.habits.get(habit) || 0) + 1);
  }
  return [...by.values()].map((a) => ({...a, top: [...a.habits].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, n]) => ({name, n}))}));
}

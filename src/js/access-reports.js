import {f7} from 'framework7-vue';
import {ct, labelled, listJoin, generation} from './agent-i18n.js';
import {timeLocale} from './i18n.js';
import {setActiveTab} from './tab-session.js';

// How a scope report reads on the review pages: its icon, style and label.
// CC Agent's own notices about an agent, not reports of its own: the cap reached, reports that
// may be missing (hooks), and from before, a digest or a transcript scan's notice.
export const isNotice = (r) => ['digest', 'cap', 'scan', 'hooks'].includes(r?.kind);
// What a wider scope could let through: not the auto-mode safety check's denials, and not a
// notice.
export const grantable = (r) => !!r && !isNotice(r) && r.kind !== 'classifier';
// A folder too broad, or one whose files the user's shell, the system or a tool reads or runs,
// as the server judges it (server/accessReports.js riskyFolder), less the folders on the
// server's PATH, which only the server knows: warned of as it is typed.
const RISKY = [/^\/$/, /^~$/, /^\/Volumes\/[^/]+$/, /^\/(private\/)?etc(\/|$)/, /^\/usr(\/|$)/, /^\/(private\/)?var(\/|$)/, /^\/(Library|System|Applications|opt|bin|sbin)(\/|$)/, /^~\/\.oh-my-zsh(\/|$)/, /^~\/Library(\/|$)/, /^~\/\.config(\/|$)/, /^~\/\.local(\/|$)/, /^~\/\.(zsh|bash|profile|zprofile|zlogin|zshenv|bash_profile|bashrc|zshrc|inputrc|ssh|gnupg)[^/]*(\/|$)/, /^~\/[^/]+$/, /^~\/\.cargo(\/|$)/, /^~\/\.(vscode|vscode-insiders|cursor|windsurf)[^/]*\/extensions(\/|$)/, /^~\/\.npm\/_npx(\/|$)/, /^~\/\.docker\/cli-plugins(\/|$)/, /^~\/\.ipython(\/[^/]+)?$/, /^~\/\.ipython\/[^/]+\/startup(\/|$)/, /^~\/\.vim\/plugin(\/|$)/, /^~\/\.config\/nvim(\/|$)/].map((re) => new RegExp(re.source, 'i'));
const RUN_FOLDERS = ['bin', 'sbin', 'shims', 'hooks', '.git', '.bin', '.husky'];
export function riskyFolder(value) {
  const v = String(value || '').trim().replace(/\/+$/, '') || (String(value || '').trim() ? '/' : '');
  if (!v) return false;
  // A home folder written out in full is read as ~.
  const tilde = v.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/i, '~');
  // Case aside: most Mac volumes ignore it (/USR/local is /usr/local).
  return RISKY.some((re) => re.test(tilde)) || v.split('/').some((part) => RUN_FOLDERS.includes(part.toLowerCase()));
}
export function reportMeta(r) {
  // CC Agent's own notice: the cap reached (or, from before, a digest).
  if (isNotice(r) && r.status === 'open') return {icon: 'exclamationmark_triangle_fill', cls: 'report-open', label: ct('未處理')};
  if (r.status === 'open') return {icon: r.kind === 'permission' ? 'hand_raised_fill' : 'lock_shield_fill', cls: 'report-open', label: ct('未處理')};
  if (r.resolution === 'granted') return {icon: 'checkmark_seal_fill', cls: 'report-granted', label: ct('已開通')};
  return {icon: 'xmark_seal_fill', cls: 'report-dismissed', label: ct('已略過')};
}
// The agent's own word that it no longer needs this (explain_report, still_needed false): a
// label only, the report stays for an admin.
export const notNeeded = (r) => r?.explanation?.stillNeeded === false;

export const reportKind = (r) => (r.kind === 'permission' ? ct('要求權限') : r.kind === 'classifier' ? ct('自動判斷擋下') : r.kind === 'digest' ? ct('舊的彙整') : r.kind === 'cap' ? ct('報告單已滿') : r.kind === 'scan' ? ct('讀不到拒絕紀錄') : r.kind === 'hooks' ? ct('範圍報告可能不完整') : r.exact === false ? `${ct('被範圍擋下')} · ${ct('依文字判斷')}` : ct('被範圍擋下'));
// The tools an old digest counted ([{tool, n}], or its own line).
const toolsLine = (r) => Array.isArray(r.tools) ? listJoin(r.tools.map((t) => `${plain(t.tool) || ct('未知工具')} ×${t.n}`)) : plain(r.detail);
// What a scan notice could not read: the session's own file, a subagent's by its id, or a
// generation's last look let go unfinished.
const scanFiles = (r) => listJoin((Array.isArray(r.files) ? r.files : []).slice(0, 20).map((f) => (f === 'main' ? ct('主對話') : f === 'subagents' ? ct('子代理資料夾') : /^gen:\d{1,9}$/.test(f) ? generation(Number(f.slice(4))) : `subagent ${plain(f)}`)));
// Why, the latest time: one word (unreadable, let go unfinished, too many to keep, a line too long).
const SCAN_WHY = {unreadable: '讀不到', dropped: '已放掉', lost: '未保留', skipped: '過長略過'};
// Why reports may be missing (agentStore hooksNotice), the latest time.
const HOOKS_WHY = {
  version: '這個 Claude Code 版本太舊，收不到被擋下的紀錄',
  'version-partial': '這個 Claude Code 版本可能不會回報所有被擋下的紀錄',
  'unknown-version': '看不出 Claude Code 的版本，可能收不到被擋下的紀錄',
  plugins: '讀不到這個 Claude Code 內建的 plugin，只關掉了已知的那些',
  silent: '啟動後一直沒收到 Claude Code 的 hook 事件',
  restart: '這個 Agent 在改用 hook 之前就啟動了，重新連線後才會收集',
  dropped: '有些 hook 事件讀不到',
  unsafe: 'hook 暫存資料夾不安全，已略過',
  full: '等待的 hook 事件太多，有些沒有記下',
  cut: '有些 hook 事件太大，只看了開頭',
  bad: '等待失敗太多次，已移到一邊的 hook 事件',
  unscanned: '改用 hook 之前，還有一段紀錄沒看過',
  store: '範圍報告單的檔案讀不到，原檔已移到一邊（移不動時不再寫入）',
  'store-items': '範圍報告單檔裡有幾項不是報告單，已另存到一邊，其他照舊',
  'store-unwritable': '範圍報告單檔有問題又寫不進去：重新啟動 server 之前，不會再存任何報告單或處理結果',
};
// A notice's one line: how many were refused past the cap, how many looks could not be read, or (an old digest) how many and by which tools.
export function digestLine(r) {
  if (r.kind === 'cap') return labelled(ct('已達未處理上限，之後被擋下沒記錄'), `${r.count || 0} ${ct('次')}`);
  if (r.kind === 'hooks') {
    const version = r.detail === 'version' && r.version ? ` · Claude Code ${plain(r.version)} · ${ct('需要')} ${plain(r.minVersion || '')}+` : '';
    return labelled(ct(HOOKS_WHY[r.detail] || '範圍報告可能不完整'), `${r.count || 0} ${ct('次')}${version}`);
  }
  if (r.kind === 'scan') {
    const files = scanFiles(r), why = SCAN_WHY[r.detail];
    return labelled(ct('有些拒絕紀錄讀不到，可能沒開單'), `${r.count || 0} ${ct('次')}${why ? ' · ' + ct(why) : ''}${files ? ' · ' + files : ''}`);
  }
  const tools = toolsLine(r);
  return labelled(ct('舊的彙整'), `${r.count || 0} ${ct('次')}${tools ? ' · ' + tools : ''}`);
}
// What was refused past the cap: tool and first line each.
const refusedLines = (list) => (Array.isArray(list) ? list : []).map((x) => [plain(x.tool) || ct('未知工具'), plain(x.line), x.n > 1 ? `×${x.n}` : ''].filter(Boolean).join(' '));
// Past a turn's limit: each of them, or, past 200, the first and the last with how many between.
export function overflowLines(o) {
  if (!o) return [];
  const lines = refusedLines(o.lines);
  if (!o.omitted) return lines;
  const gap = labelled('…', `${o.omitted} ${ct('次')}`);
  return Number.isInteger(o.cut) ? [...lines.slice(0, o.cut), gap, ...lines.slice(o.cut)] : [...lines, gap];
}
// A cap notice's lines: the first different ones since it opened, then the last ones.
export const capLines = (r) => [...refusedLines(r.first), ...(r.first?.length && r.recent?.length ? ['…'] : []), ...refusedLines(r.recent)];
// Text an agent or a person wrote, as shown: without direction marks, zero-width and other
// characters that show nothing, so they cannot reorder or hide what is around them.
export const plain = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu, '');

export function reportTime(at) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(timeLocale(), {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
}

// One line of at most n characters, counted by code point.
export const excerpt = (text, n = 120) => {
  const s = Array.from(plain(text).replace(/\s+/g, ' ').trim());
  return s.length > n ? s.slice(0, n).join('') + '…' : s.join('');
};

export const listOrNone = (items) => (items || []).join('\n');

// One of the Admin tab's report pages from elsewhere (an agent's profile): that tab, with the
// page over whatever it showed, so its back returns there; the same page is replaced. A chat's
// report card opens its report over the chat instead (js/reportPopup.js).
function openAdminPage(url) {
  setActiveTab('view-admin');
  const router = f7.views?.get('#view-admin')?.router;
  if (!router) return;
  if (router.currentRoute?.path === url.split('?')[0]) router.navigate(url, {reloadCurrent: true, animate: false});
  else router.navigate(url);
}
// title: the agent's name, so the page can still name one that has no reports.
export const openAgentReports = (id, title = '') => openAdminPage(`/access-reports/?agent=${encodeURIComponent(id)}${title ? '&title=' + encodeURIComponent(title) : ''}`);

// What an agent keeps running into: the tool, and for a command its program.
function reportHabit(r) {
  const tool = plain(r.tool) || ct('未知工具');
  const command = /"command"\s*:\s*"\s*([^"\s;|&]+)/.exec(String(r.detail || ''));
  return command ? `${tool} ${command[1].split('/').pop()}` : tool;
}
// Per agent: how many reports, how many still open, how many of those the agent says it no
// longer needs, granted, and its most frequent tools or commands. Newest agent first, as the
// list. CC Agent's own notices are not reports of the agent's, so they are in none of the counts.
export function agentSummaries(list) {
  const by = new Map();
  for (const r of list) {
    if (isNotice(r)) continue;
    const key = r.conversationId || r.title || '';
    if (!by.has(key)) by.set(key, {id: key, title: plain(r.agentTitle || r.title) || 'Agent', ownerName: r.ownerName || '', total: 0, open: 0, notNeeded: 0, granted: 0, habits: new Map()});
    const a = by.get(key);
    a.total += 1;
    if (r.status === 'open') { a.open += 1; if (notNeeded(r)) a.notNeeded += 1; }
    if (r.resolution === 'granted') a.granted += 1;
    const habit = reportHabit(r);
    a.habits.set(habit, (a.habits.get(habit) || 0) + 1);
  }
  return [...by.values()].map((a) => ({...a, top: [...a.habits].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, n]) => ({name, n}))}));
}
// An agent in the picker, with how many reports, as the language writes a count beside a name.
export const agentOption = (a) => ct('{title}（{n}）').replace('{n}', String(a.total)).replace('{title}', () => a.title);
// An agent's counts, one line, in the language's own case and order.
export const summaryCounts = (a) => ct('共 {total} · 未處理 {open} · 說不需要 {notNeeded} · 已開通 {granted}').replace('{total}', String(a.total)).replace('{open}', String(a.open)).replace('{notNeeded}', String(a.notNeeded)).replace('{granted}', String(a.granted));
// Text for f7.dialog and f7.toast, which render HTML: whatever an agent or a person wrote is
// shown as text, never as markup.
export const escapeHtml = (v) => plain(v).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

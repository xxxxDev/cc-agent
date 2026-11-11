const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Everything an agent tried outside its scope, for an admin to review. Nothing out
// of scope is granted from a prompt (not to a member, not to an admin), so a refused request ends up here instead, and whether to
// widen that agent's scope is decided from this list. SECURITY.md.
const MAX_REPORTS = 5000;
// Open reports per conversation, so one agent, whose own output feeds the 'blocked' reports,
// can neither bury the queue nor push other agents' reports out of it.
const MAX_PER_CONVERSATION = 200;

function create(stateRoot) {
  const file = path.join(stateRoot, 'access-reports.json');
  let reports = null;
  const load = () => {
    if (reports) return reports;
    try { reports = JSON.parse(fs.readFileSync(file, 'utf8')).reports || []; } catch { reports = []; }
    return reports;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ reports }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  // `key` makes filing idempotent: the same refusal seen twice is one report.
  function add(entry) {
    load();
    if (entry.key && reports.some((r) => r.key === entry.key)) return null;
    if (entry.conversationId && reports.filter((r) => r.conversationId === entry.conversationId && r.status === 'open').length >= MAX_PER_CONVERSATION) return null;
    // notifyPending: the admins' push goes out from server/notifications.js.
    const report = { id: randomUUID(), at: new Date().toISOString(), status: 'open', ...entry, notifyPending: true };
    reports.push(report);
    if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
    save();
    return report;
  }
  const list = () => load().slice().reverse();
  const get = (id) => load().find((r) => r.id === id) || null;
  function update(id, patch) {
    const report = get(id);
    if (!report) return null;
    Object.assign(report, patch);
    save();
    return report;
  }
  // Many reports, one write: the file holds up to MAX_REPORTS of them.
  function updateMany(ids, patch) {
    load();
    const wanted = new Set(ids);
    let changed = 0;
    for (const report of reports) if (wanted.has(report.id)) { Object.assign(report, patch); changed += 1; }
    if (changed) save();
    return changed;
  }
  function purgeOwner(owner) {
    load();
    const before = reports.length;
    reports = reports.filter((r) => r.owner !== owner);
    if (reports.length !== before) save();
    return before - reports.length;
  }
  return { add, list, get, update, updateMany, purgeOwner, file };
}

// What an admin would most likely add to the agent's scope to allow what the
// report shows: the website it tried to reach, or the folder it tried to use. It is
// read out of agent-produced text, so it is only a suggestion: the admin sees and
// can edit it, and the server validates whatever is granted.
function suggest(report, home = require('node:os').homedir()) {
  const text = `${report.detail || ''}\n${report.error || ''}`;
  const site = /deny network-outbound ([a-z0-9.-]+):\d+/i.exec(text)
    || /fetch content from ([a-z0-9.-]+\.[a-z]{2,})/i.exec(text)
    || /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i.exec(text);
  const grantable = (fn, value) => { try { return fn(value); } catch { return null; } };
  const { allowedFolder, website } = require('./agentAccess');
  if (site) {
    const value = grantable(website, site[1].toLowerCase());
    return value ? { type: 'website', value } : null;
  }
  const found = /((?:\/(?:Users|Volumes|private|tmp|opt|Library|Applications))(?:\/[^\s'"`:,;)]+)*)/.exec(text) || /(~(?:\/[^\s'"`:,;)]+)+)/.exec(text);
  if (!found) return null;
  let folder = found[1].replace(/\/+$/, '');
  const last = folder.split('/').pop();
  if (/\.[A-Za-z0-9]{1,8}$/.test(last)) folder = folder.slice(0, -(last.length + 1)) || folder;
  if (home && (folder === home || folder.startsWith(`${home}/`))) folder = `~${folder.slice(home.length)}`;
  // Only what could actually be granted: never the home directory itself, a path
  // with "..", or anything holding CC Agent's own data (agentAccess.allowedFolder).
  const value = folder && grantable(allowedFolder, folder);
  return value ? { type: 'folder', value } : null;
}

module.exports = { create, suggest, MAX_REPORTS, MAX_PER_CONVERSATION };

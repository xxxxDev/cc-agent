const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Everything an agent tried outside its scope, for an admin to review. Nothing out
// of scope is granted from a prompt (not to a member, not to an admin), so a refused request ends up here instead, and whether to
// widen that agent's scope is decided from this list. SECURITY.md.
const MAX_REPORTS = 5000;
// Open reports per conversation: one agent, whose own output feeds the 'blocked' reports,
// cannot bury the queue. Past it, it files no more and CC Agent's one 'cap' notice counts
// what was refused since (agentStore capNotice). Nothing the agent says closes a report.
const MAX_PER_CONVERSATION = 200;
// At MAX_REPORTS, an admin's oldest decision (granted or dismissed, kept in the audit log)
// makes room; an open report is never removed: with none decided, the new one is not filed,
// and CC Agent's one 'cap' notice for that agent counts it (agentStore capNotice). The cap
// notice itself is always kept, one open a conversation.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function create(stateRoot) {
  const file = path.join(stateRoot, 'access-reports.json');
  let reports = null;
  // A file that could not be read or parsed, or holds anything but reports (an object with a
  // string id each), is never taken for an empty store, and never written over: it is moved
  // aside under a dated name, with a small marker file beside it
  // (<aside>.notice), and one notice (kind 'hooks', detail 'store') tells the admins. The notice
  // is raised from the marker at each start until the store holds it, so a crash before the
  // store was written loses no notice. Where the file cannot even be moved aside, or the bad
  // items cannot be set aside or the store rewritten without them, the store refuses every
  // write (unwritable: each change is refused on disk, and an admin's action answers with an
  // error) until the server restarts, and its notice (detail 'store-unwritable') says so.
  let unwritable = null;
  const dir = path.dirname(file), base = path.basename(file);
  const storeNotice = (asideName, why, detail = 'store') => ({ id: randomUUID(), at: new Date().toISOString(), status: 'open', kind: 'hooks', detail, key: 'store:' + (asideName || 'unwritable'), conversationId: null, owner: null, title: '', tool: '', count: 1, error: String(why || '').slice(0, 300), ...(asideName ? { movedTo: asideName } : {}), notifyPending: true, notifyAfter: new Date().toISOString() });
  const load = () => {
    if (reports) return reports;
    let text = null, failed = null, asideUnmarked = null, badItems = 0;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') failed = e; }
    if (text !== null) {
      try {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.reports)) throw new Error('no reports list');
        // Items that are not reports (an object with a string id) go aside on their own, to
        // <file>.bad-items-<time> with its marker; the reports stay.
        const ok = (r) => r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && r.id;
        const bad = data.reports.filter((r) => !ok(r));
        reports = data.reports.filter(ok);
        if (bad.length) {
          const aside = `${file}.bad-items-${new Date().toISOString().replace(/[:.]/g, '-')}`;
          let step = 'set aside';
          try {
            fs.writeFileSync(aside, JSON.stringify({ items: bad }), { mode: 0o600, flag: 'wx' });
            try { fs.writeFileSync(`${aside}.notice`, JSON.stringify({ why: `${bad.length} item(s) that are not reports`, detail: 'store-items' }), { mode: 0o600 }); } catch { asideUnmarked = path.basename(aside); }
            badItems = bad.length;
            // The store without them, written now, so a restart does not set them aside again.
            step = 'written without them';
            const tmp = `${file}.${process.pid}.items-${randomUUID().slice(0, 8)}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ reports }, null, 1), { mode: 0o600 });
            fs.renameSync(tmp, file);
          } catch (e) { unwritable = new Error(`scope reports: items that are not reports could not be ${step} (${e.message}); nothing more is written until the server restarts`); }
        }
      } catch (e) { failed = e; }
    }
    if (failed) {
      const aside = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(file, aside);
        try { fs.writeFileSync(`${aside}.notice`, JSON.stringify({ why: failed.message.slice(0, 300) }), { mode: 0o600 }); } catch { asideUnmarked = path.basename(aside); }
      } catch (e) { unwritable = new Error(`scope reports unreadable (${failed.message}) and not moved aside (${e.message}); nothing more is written until the server restarts`); }
      console.error(`scope reports: ${file} could not be read (${failed.message}); ${unwritable ? 'left where it is, nothing will be written' : 'moved aside to ' + path.basename(aside)}`);
      reports = [];
      if (unwritable) reports.push(storeNotice(null, unwritable.message, 'store-unwritable'));
      else if (asideUnmarked) reports.push(storeNotice(asideUnmarked, failed.message));
    } else if (unwritable) reports.push(storeNotice(null, unwritable.message, 'store-unwritable'));
    else if (asideUnmarked) reports.push(storeNotice(asideUnmarked, `${badItems} item(s) that are not reports`, 'store-items'));
    if (!reports) reports = [];
    // A notice for each file set aside, from its marker, once; a marker whose notice the store
    // already holds is removed.
    let raised = 0;
    try {
      for (const n of fs.readdirSync(dir)) {
        if (!(n.startsWith(base + '.unreadable-') || n.startsWith(base + '.bad-items-')) || !n.endsWith('.notice')) continue;
        const asideName = n.slice(0, -'.notice'.length);
        if (reports.some((r) => r.key === 'store:' + asideName)) { if (!failed) try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} continue; }
        let why = '', detail = 'store';
        try { const m = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); why = m.why || ''; if (m.detail === 'store-items') detail = m.detail; } catch {}
        reports.push(storeNotice(asideName, why, detail));
        raised += 1;
      }
    } catch {}
    // A report an agent once closed by its own word ('self-resolved', before that was removed)
    // is open again, for an admin, with its history kept and a mark
    // saying so (formerlySelfResolved); queued for the admins once, in the batched push.
    let reopened = 0;
    for (const r of reports) if (r.status === 'self-resolved') { r.status = 'open'; r.formerlySelfResolved = true; r.notifyPending = true; r.notifyAfter = new Date().toISOString(); reopened += 1; }
    if (reopened || raised || asideUnmarked) save();
    return reports;
  };
  // Temporary files a write left behind when the process was killed in it.
  try { for (const n of fs.readdirSync(path.dirname(file))) if (/^access-reports\.json\.\d+(\.[A-Za-z0-9-]+)?\.tmp$/.test(n)) fs.rmSync(path.join(path.dirname(file), n), { force: true }); } catch {}
  // One writer, asynchronous and coalescing, for the scope intake: a
  // change only marks the store, and the whole file is written at most once every
  // WRITE_EVERY_MS (by a monotonic clock, so setting the clock back stops nothing), to a
  // temporary file renamed over it, so a burst of changes is one write. Reads come from memory.
  // Writing it takes the server about 15 to 27 ms (the JSON of up to 5000 reports), once a
  // second at most. persistedUpTo(n) resolves once change n (changes() just after it) is on
  // disk and rejects if the write that held it failed; a failed write is tried again, 1 s
  // doubling to a minute. An admin's action does not use it: it writes in its own tick
  // (transaction, flushNow). writeSoon() asks for the next write now (a shutdown). What is still
  // unwritten when the process exits is written then. A process killed outright loses what
  // changed since the last write: reports that did not come from the hooks (the hooks' are read
  // again, their files still there) and push state, so a batched push can go out a second
  // time; about a second of them while writes succeed, longer while a failing write backs off.
  const WRITE_EVERY_MS = 1000;
  // onDisk: the change number of the state the file now holds. A background write renames its
  // file only if nothing newer is on disk by then (a synchronous write, flushNow or flushSync,
  // may have come in between): the check and the rename happen in one tick (renameSync), so no
  // older state can land over a newer one.
  let dirty = false, writing = null, lastAt = -Infinity, timer = null, failures = 0, soon = false, seq = 0, written = 0, upTo = [], onDisk = 0;
  const settleUpTo = (e, through) => { upTo = upTo.filter((w) => { if (w.n <= written) { w.ok(); return false; } if (e && w.n <= through) { w.no(e); return false; } return true; }); };
  const body = () => JSON.stringify({ reports }, null, 1);
  async function writeNow() {
    timer = null;
    if (!dirty || !reports) return;
    dirty = false; soon = false;
    const data = body(), tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`, through = seq;
    writing = (async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(tmp, data, { mode: 0o600 });
      // Superseded: a newer state is on disk already, holding everything this one held.
      if (onDisk > through) { try { fs.rmSync(tmp, { force: true }); } catch {} return; }
      fs.renameSync(tmp, file);
      onDisk = through;
    })();
    try { await writing; failures = 0; lastAt = performance.now(); written = Math.max(written, through); settleUpTo(null, through); }
    catch (e) { failures += 1; dirty = true; console.error('scope reports not written:', e.message); settleUpTo(e, through); }
    finally { writing = null; if (dirty) schedule(); }
  }
  function schedule() {
    if (writing || unwritable) return;
    const wait = failures ? Math.min(1000 * 2 ** (failures - 1), 60_000) : soon ? 0 : Math.max(0, lastAt + WRITE_EVERY_MS - performance.now());
    if (timer) { if (!soon || failures) return; clearTimeout(timer); }
    timer = setTimeout(writeNow, wait);
    timer.unref?.();
  }
  function save() {
    seq += 1;
    if (unwritable) { settleUpTo(unwritable, seq); return; }
    dirty = true; schedule();
  }
  const changes = () => seq;
  function persistedUpTo(n) {
    if (n <= written) return Promise.resolve();
    if (unwritable) return Promise.reject(unwritable);
    return new Promise((ok, no) => { upTo.push({ n, ok, no }); schedule(); });
  }
  // Someone waits for it: the timer holds the process open until the write is done.
  const writeSoon = () => { const p = persistedUpTo(seq); if (dirty) { soon = true; schedule(); timer?.ref?.(); } return p; };
  function flushSync() {
    // A write still under way when the process ends would never finish: written again here.
    if ((!dirty && !writing) || !reports || unwritable) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.exit-${randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(tmp, body(), { mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false; written = seq; onDisk = seq; settleUpTo(null, seq);
  }
  process.on('exit', () => { try { flushSync(); } catch (e) { console.error('scope reports not written at exit:', e.message); } });
  // `key` makes filing idempotent: the same refusal seen twice is one report.
  function add(entry) {
    load();
    if (entry.key && reports.some((r) => r.key === entry.key)) return null;
    // CC Agent's own notices about an agent (kind 'cap' at the cap, 'hooks' when reports may be
    // missing; 'scan' and 'digest' from before) are not held back by it.
    if (entry.conversationId && !['cap', 'digest', 'scan', 'hooks'].includes(entry.kind)) {
      // One reopened from an old self-resolve (formerlySelfResolved, an upgrade's) does not count:
      // an agent with many of those still files what is refused now.
      const open = reports.filter((r) => r.conversationId === entry.conversationId && r.status === 'open' && !r.formerlySelfResolved && !['cap', 'digest', 'scan', 'hooks'].includes(r.kind));
      if (open.length >= MAX_PER_CONVERSATION) return null;
    }
    if (reports.length >= MAX_REPORTS && !['cap', 'scan', 'hooks'].includes(entry.kind)) {
      const at = reports.findIndex((r) => r.status !== 'open');
      if (at < 0) return null;
      reports.splice(at, 1);
    }
    // notifyPending: the admins' push goes out from server/notifications.js.
    const report = { id: randomUUID(), at: new Date().toISOString(), status: 'open', ...entry, notifyPending: true };
    reports.push(report);
    save();
    return report;
  }
  const list = () => load().slice().reverse();
  const hasKey = (key) => load().some((r) => r.key === key);
  const get = (id) => load().find((r) => r.id === id) || null;
  // A decided report keeps how many refusals came past its limit, not their lines (or the keys an
  // older release kept): the file holds MAX_REPORTS reports.
  const settled = (report) => { if (report.status === 'resolved' && report.overflow && typeof report.overflow === 'object' && (report.overflow.lines || report.overflow.keys)) report.overflow = { count: report.overflow.count }; };
  // A patch that changes nothing is not written: the file can hold MAX_REPORTS reports.
  function update(id, patch) {
    const report = get(id);
    if (!report) return null;
    if (Object.keys(patch).every((k) => same(report[k], patch[k]))) return report;
    Object.assign(report, patch);
    settled(report);
    save();
    return report;
  }
  // Many reports, one write: the file holds up to MAX_REPORTS of them. patch may be a function
  // of each report.
  function updateMany(ids, patch) {
    load();
    const wanted = new Set(ids);
    let changed = 0;
    for (const report of reports) {
      if (!wanted.has(report.id)) continue;
      const p = typeof patch === 'function' ? patch(report) : patch;
      if (!Object.keys(p).every((k) => same(report[k], p[k]))) { Object.assign(report, p); settled(report); changed += 1; }
    }
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
  // Written now, synchronously, as at exit: an admin's action (agentStore) changes the store
  // and writes it in the same tick, so nothing else runs between the change and the write.
  // Throws if it could not be written.
  function flushNow() {
    load();
    if (unwritable) throw unwritable;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.now-${randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(tmp, body(), { mode: 0o600 });
    fs.renameSync(tmp, file);
    onDisk = seq; written = seq; settleUpTo(null, seq);
    // A background write still under way discards its file (onDisk); the store is written once
    // more after it all the same, so the file ends at the latest state whatever the order.
    if (writing) { dirty = true; writing.finally(() => schedule()); } else dirty = false;
  }
  // fn's changes, then flushNow, in one tick; if either throws, the store is back as it was
  // before fn (what the intake had changed and not yet written stays, to be written later).
  function transaction(fn) {
    load();
    const before = structuredClone(reports), wasDirty = dirty;
    try { const out = fn(); flushNow(); return out; }
    catch (e) { reports = before; dirty = wasDirty || dirty; throw e; }
  }
  // Several changes as one: with the coalescing writer above they are one write anyway.
  const batch = (fn) => fn();
  return { add, list, hasKey, get, update, updateMany, purgeOwner, transaction, batch, persistedUpTo, changes, writeSoon };
}

// What an admin would most likely add to the agent's scope to allow what the report shows,
// only from fields Claude Code itself filled, never from text the agent chose (a command, an
// edit's new text, a file's content, a prompt's description), which could name any site or
// folder: the path a file tool was given (targetPath: its folder, or itself for Glob, Grep
// and LS) or the address a prompt's url field held (targetHost). A refusal matched only by its
// wording, the safety check's, a notice, or an older report without those fields: none. The
// admin sees and can edit it, and the server validates whatever is granted.
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function suggest(report, home = require('node:os').homedir(), folderThere = isFolder) {
  if (report.exact === false || report.kind === 'classifier' || ['cap', 'digest', 'scan', 'hooks'].includes(report.kind)) return null;
  const grantable = (fn, value) => { try { return fn(value); } catch { return null; } };
  const { allowedFolder, website } = require('./agentAccess');
  if (typeof report.targetHost === 'string' && report.targetHost) {
    const value = grantable(website, report.targetHost.toLowerCase());
    return value ? { type: 'website', value } : null;
  }
  if (typeof report.targetPath !== 'string' || !path.isAbsolute(report.targetPath)) return null;
  let folder = path.resolve(report.targetPath);
  if (!report.targetIsDir) folder = path.dirname(folder);
  if (home && (folder === home || folder.startsWith(`${home}/`))) folder = `~${folder.slice(home.length)}`;
  // Only what could actually be granted: never the home directory itself, a path with "..",
  // or anything holding CC Agent's own data (agentAccess.allowedFolder).
  const value = folder && grantable(allowedFolder, folder);
  if (!value) return null;
  // Only a folder the server can see (a link that leads nowhere, or one that is gone, is not one).
  if (!folderThere(path.resolve(String(value).replace(/^~(?=\/|$)/, home)))) return null;
  // Too broad, or a folder the user's shell or the system reads or runs: shown, never filled in.
  return riskyFolder(value, home) ? { type: 'folder', value, risky: true } : { type: 'folder', value };
}
// Too broad, or a folder whose files the user's shell, the system or a tool reads or runs: the
// suggestion is shown, never filled in, and a grant of one needs a second confirmation
// (agentStore grantAccess; src/js/access-reports.js riskyFolder warns as it is typed).
const RISKY = [/^\/$/, /^~$/, /^\/Volumes\/[^/]+$/, /^\/(private\/)?etc(\/|$)/, /^\/usr(\/|$)/, /^\/(private\/)?var(\/|$)/, /^\/(Library|System|Applications|opt|bin|sbin)(\/|$)/, /^~\/\.oh-my-zsh(\/|$)/, /^~\/Library(\/|$)/, /^~\/\.config(\/|$)/, /^~\/\.local(\/|$)/, /^~\/\.(zsh|bash|profile|zprofile|zlogin|zshenv|bash_profile|bashrc|zshrc|inputrc|ssh|gnupg)[^/]*(\/|$)/, /^~\/[^/]+$/, /^~\/\.cargo(\/|$)/, /^~\/\.(vscode|vscode-insiders|cursor|windsurf)[^/]*\/extensions(\/|$)/, /^~\/\.npm\/_npx(\/|$)/, /^~\/\.docker\/cli-plugins(\/|$)/, /^~\/\.ipython(\/[^/]+)?$/, /^~\/\.ipython\/[^/]+\/startup(\/|$)/, /^~\/\.vim\/plugin(\/|$)/, /^~\/\.config\/nvim(\/|$)/];
const RISKY_FOLDED = RISKY.map((re) => new RegExp(re.source, 'i'));
// Folders whose contents run: a bin, sbin, shims (version managers), hooks, .husky (git hooks) or node_modules/.bin
// folder, a .git folder (its hooks run at the owner's next commit), anywhere in the path.
const RUN_FOLDERS = new Set(['bin', 'sbin', 'shims', 'hooks', '.git', '.bin', '.husky']);
// The folders on PATH (the server's own) a check compares with: only absolute ones; an empty
// entry, or a relative one such as ".", names no fixed folder and is left out.
const pathFolders = (value = process.env.PATH) => String(value || '').split(path.delimiter).filter((d) => d && path.isAbsolute(d)).map((d) => path.resolve(d));
// pathDirs: one of them, a folder inside one, or one that holds one. fold: compared without
// regard to case (a path as runtimeTools.canonical gives it, for a volume that ignores case).
function riskyFolder(value, home = require('node:os').homedir(), pathDirs = pathFolders(), { fold = false } = {}) {
  if (typeof value !== 'string' || !value) return false;
  const f = (v) => (fold ? String(v).toLowerCase() : String(v));
  const h = home ? f(home) : '';
  const abs = f(value === '~' || value.startsWith('~/') ? (home || '') + value.slice(1) : path.resolve(value));
  const tilde = h && (abs === h || abs.startsWith(`${h}/`)) ? `~${abs.slice(h.length)}` : abs;
  if ((fold ? RISKY_FOLDED : RISKY).some((re) => re.test(tilde))) return true;
  if (abs.split('/').some((part) => RUN_FOLDERS.has(part))) return true;
  return pathDirs.some((d) => {
    if (typeof d !== 'string' || !d || !path.isAbsolute(d)) return false;
    const p = f(path.resolve(d));
    return abs === p || abs.startsWith(`${p}/`) || p.startsWith(`${abs}/`);
  });
}
// A folder about to be granted: as typed, and as the disk knows it (links followed, case folded:
// runtimeTools.canonical), so /USR/local, ~/proj/.GIT or a link to /usr/local/bin count too.
function riskyGrant(entry, home = require('node:os').homedir(), pathDirs = pathFolders()) {
  if (riskyFolder(entry, home, pathDirs)) return true;
  const { canonical } = require('../channel/runtimeTools.cjs');
  const abs = entry === '~' || entry.startsWith('~/') ? home + entry.slice(1) : path.resolve(entry);
  return riskyFolder(canonical(abs), canonical(home), pathDirs.map((d) => canonical(d)), { fold: true });
}

module.exports = { create, suggest, riskyFolder, riskyGrant, MAX_REPORTS, MAX_PER_CONVERSATION };

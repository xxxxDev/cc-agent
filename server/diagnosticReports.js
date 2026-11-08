const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// What a person sent from Agent Profile's 「回報診斷」: the same text the copy button makes,
// who sent it, for which agent, when and from which build, for an admin to read, mark
// handled, delete or hand to an agent. Kept in the data folder beside the scope reports
// (accessReports.js): an index of the reports and each report's text in a file of its own,
// so the index stays small and one large trace is not rewritten with every change. Only an admin reads them (ccAgentRoutes.js).
const MAX_BYTES = 512 * 1024;
const MAX_REPORTS = 200;
// One person keeps at most this many; their oldest goes first.
const PER_USER_MAX = 20;
const PER_USER_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function create(stateRoot, { now = Date.now } = {}) {
  const dir = path.join(stateRoot, 'diagnostic-reports');
  const file = path.join(dir, 'reports.json');
  const textFile = (id) => {
    if (!ID.test(id)) throw fail('找不到這份診斷回報', 404);
    return path.join(dir, `${id}.txt`);
  };
  let reports = null;
  // A missing index is an empty one. One that is there but cannot be read now (EACCES, EIO and
  // the like) leaves the store unloaded: the request is refused and the next one tries again,
  // so nothing is swept or overwritten. One that reads but is not a list of reports is
  // moved aside as reports.json.bad-<ts>, logged, and the store starts empty. A text file the
  // index does not name (left by a write that stopped half way) is removed, unless a bad index
  // is kept aside: its texts stay for whoever recovers it.
  const unavailable = () => fail('診斷回報暫時讀不到，請稍後再試', 503);
  const load = () => {
    if (reports) return reports;
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') { console.error('diagnostic reports: cannot read the index:', e.message); throw unavailable(); }
    }
    if (raw === null) { reports = []; return reports; }
    let loaded;
    try {
      loaded = JSON.parse(raw).reports;
      if (!Array.isArray(loaded) || !loaded.every((r) => r && typeof r === 'object' && ID.test(r.id))) throw new Error('not a list of reports');
    } catch (e) {
      const aside = `${file}.bad-${now()}`;
      // Not moved aside: starting empty would let the next save overwrite it.
      try { fs.renameSync(file, aside); } catch (moveError) { console.error('diagnostic reports: cannot move the bad index aside:', moveError.message); throw unavailable(); }
      console.error(`diagnostic reports: the index could not be read (${e.message}); kept as ${aside}, starting empty`);
      reports = [];
      return reports;
    }
    const known = new Set(loaded.map((r) => r.id));
    let names = [];
    try { names = fs.readdirSync(dir); } catch {}
    if (!names.some((name) => name.startsWith('reports.json.bad-'))) {
      for (const name of names) {
        const m = /^(.+)\.txt$/.exec(name);
        if (m && ID.test(m[1]) && !known.has(m[1])) dropText(m[1]);
      }
    }
    reports = loaded;
    return reports;
  };
  const ensureDir = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Every change builds the new list, saves it, and only then becomes the store; texts the
  // change lets go are removed after that.
  const save = (next) => {
    ensureDir();
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ reports: next }, null, 1), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
  };
  // Which reports stay once `added` joins them: the sender keeps at most PER_USER_MAX and
  // the store MAX_REPORTS. Handled reports go first, then the oldest; to make room in the
  // store only handled ones or the sender's own go, so one person never pushes out other
  // people's unhandled reports.
  const prune = (all, from) => {
    const kept = all.slice(), dropped = [];
    const dropFirst = (pick) => {
      const i = kept.findIndex((r) => pick(r) && r.status === 'handled');
      const j = i >= 0 ? i : kept.findIndex(pick);
      if (j < 0) return false;
      dropped.push(kept.splice(j, 1)[0]);
      return true;
    };
    while (kept.filter((r) => r.from === from).length > PER_USER_MAX) dropFirst((r) => r.from === from);
    while (kept.length > MAX_REPORTS) {
      const i = kept.findIndex((r) => r.status === 'handled');
      if (i >= 0) dropped.push(kept.splice(i, 1)[0]);
      else if (!dropFirst((r) => r.from === from)) break;
    }
    return { kept, dropped };
  };
  const dropText = (id) => { try { fs.rmSync(textFile(id), { force: true }); } catch {} };

  // from: the sender's user id; the agent was checked against the sender's access by
  // the route. Too large, empty, or the sender's tenth in an hour: refused.
  function add({ from, conversationId, agentTitle, build, text }) {
    if (typeof text !== 'string' || !text.trim()) throw fail('診斷資訊是空的');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_BYTES) throw fail('診斷資訊太大（上限 512 KB）', 413);
    load();
    const since = now() - HOUR_MS;
    if (reports.filter((r) => r.from === from && Date.parse(r.at) > since).length >= PER_USER_PER_HOUR) throw fail('回報太頻繁，請稍後再試', 429);
    const report = {
      id: randomUUID(), at: new Date(now()).toISOString(), status: 'open', from, conversationId,
      agentTitle: String(agentTitle || '').slice(0, 120), build: /^[\w.+-]{1,80}$/.test(String(build || '')) ? String(build) : 'unknown',
      bytes, notifyPending: true,
    };
    const { kept, dropped } = prune([...reports, report], from);
    // The store is full of other people's unhandled reports: refused, nobody's is dropped.
    if (!kept.includes(report)) throw fail('診斷回報已滿，請等管理員處理後再試', 503);
    // The text first, then the index; a text file goes only once the index no longer names
    // it, and a failed index save takes the new text back out.
    ensureDir();
    fs.writeFileSync(textFile(report.id), text, { mode: 0o600 });
    try { save(kept); } catch (e) {
      dropText(report.id);
      throw e;
    }
    reports = kept;
    for (const r of dropped) dropText(r.id);
    return report;
  }
  const list = () => load().slice().reverse();
  const find = (id) => load().find((r) => r.id === id) || null;
  function get(id) {
    const r = find(id);
    if (!r) throw fail('找不到這份診斷回報', 404);
    let text = '';
    try { text = fs.readFileSync(textFile(r.id), 'utf8'); } catch {}
    return { ...r, text };
  }
  function setStatus(id, status, by) {
    if (!['open', 'handled'].includes(status)) throw fail('Unknown status');
    const r = find(id);
    if (!r) throw fail('找不到這份診斷回報', 404);
    const changed = { ...r, ...(status === 'handled' ? { status, handledAt: new Date(now()).toISOString(), handledBy: by } : { status, handledAt: null, handledBy: null }) };
    const next = reports.map((x) => (x.id === id ? changed : x));
    save(next);
    reports = next;
    return changed;
  }
  function remove(id) {
    const r = find(id);
    if (!r) throw fail('找不到這份診斷回報', 404);
    const next = reports.filter((x) => x.id !== id);
    save(next);
    reports = next;
    dropText(id);
    return r;
  }
  const pending = () => list().filter((r) => r.notifyPending);
  function markNotified(ids) {
    load();
    const wanted = new Set(ids);
    let changed = 0;
    const next = reports.map((r) => {
      if (!wanted.has(r.id) || !r.notifyPending) return r;
      changed += 1;
      return { ...r, notifyPending: false };
    });
    if (!changed) return 0;
    save(next);
    reports = next;
    return changed;
  }
  // Everything a deleted account sent goes with it, as its scope reports do.
  function purgeOwner(owner) {
    load();
    const gone = reports.filter((r) => r.from === owner);
    if (!gone.length) return 0;
    const next = reports.filter((r) => r.from !== owner);
    save(next);
    reports = next;
    for (const r of gone) dropText(r.id);
    return gone.length;
  }
  return { add, list, get, setStatus, remove, pending, markNotified, purgeOwner, dir };
}

// The one route whose body the site-wide parser leaves to its own (app.js, ccAgentRoutes.js).
const DIAGNOSTIC_REPORTS_PATH = '/api/diagnostic-reports';

module.exports = { DIAGNOSTIC_REPORTS_PATH, create, MAX_BYTES, MAX_REPORTS, PER_USER_MAX, PER_USER_PER_HOUR };

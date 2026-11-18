// The Terminal tab: this computer's own shell, and SSH and
// SFTP to other machines, an admin's. A machine is this computer, one the admin saved on the
// page, or a Host of ~/.ssh/config (read only). Its terminals are tmux sessions on a server of
// their own (not the shell tabs' one, which the admin page can switch off and end at once), each
// running the account's login shell or ssh. SFTP lists and moves files with the system's sftp
// and ssh.
//
// CC Agent keeps no password or key: ssh uses the account's own keys and agent, and a password
// is typed by the admin into the terminal. The SSH tab and SFTP share one connection
// (ControlMaster), so a machine that asks for a password works in SFTP after signing in once in
// its terminal; SFTP itself never asks (BatchMode). A host key is accepted in the terminal, as ssh
// asks there; SFTP refuses an unknown one.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {execFileSync, spawn} = require('node:child_process');
const agentEnv = require('../channel/agentEnv.cjs');

const HOME = os.userInfo().homedir;
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252})|[0-9A-Fa-f:.]{2,45})$/;
const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const ALIAS_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const ID_RE = /^(?:local|s-[a-f0-9]{12}|c-[a-f0-9]{2,128})$/;
const SEP = '|~|';
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
const MAX_TRANSFERS = 30;
// The system's own ssh and sftp, by full path: a program of the same name earlier on PATH (a
// folder an agent may be given) is never the one run.
const SSH = fs.existsSync('/usr/bin/ssh') ? '/usr/bin/ssh' : 'ssh';
const SFTP = fs.existsSync('/usr/bin/sftp') ? '/usr/bin/sftp' : 'sftp';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const tilde = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);

// One path from the page: text without control characters, at most 4096 long.
function cleanPath(p, {allowEmpty = false} = {}) {
  if (p === undefined || p === null || p === '') { if (allowEmpty) return ''; throw fail('缺少路徑'); }
  if (typeof p !== 'string' || p.length > 4096 || /[\u0000-\u001f\u007f]/.test(p)) throw fail('路徑不正確');
  return p;
}
// A name inside a folder: no slash, not . or ..
function cleanName(n) {
  if (typeof n !== 'string' || !n || n.length > 255 || /[/\u0000-\u001f\u007f]/.test(n) || n === '.' || n === '..') throw fail('名稱不正確');
  return n;
}
// A path in an sftp batch line, quoted as sftp reads its arguments.
const sq = (p) => '"' + cleanPath(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function parseConfig(text) {
  const out = [];
  let block = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(\S+)\s*(?:=\s*|\s+)(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      const names = value.split(/\s+/).filter((n) => ALIAS_RE.test(n) && !/[*?!]/.test(n));
      block = names.length ? names.map((alias) => ({alias})) : null;
      if (block) out.push(...block);
    } else if (key === 'match') block = null;
    else if (block) for (const h of block) {
      if (key === 'hostname' && !h.hostname) h.hostname = value;
      else if (key === 'user' && !h.user) h.user = value;
      else if (key === 'port' && !h.port) h.port = Number(value) || undefined;
      else if ((key === 'proxycommand' || key === 'proxyjump') && !h.proxy) h.proxy = true;
    }
  }
  const seen = new Set();
  return out.filter((h) => !seen.has(h.alias) && seen.add(h.alias));
}

// One line of sftp's `ls -la`.
const LS_RE = /^([bcdlps-][-rwxsStT]{9}[@+.]?)\s+(?:\d+|\?)\s+(\S+)\s+(\S+)\s+(\d+)\s+([A-Z][a-z]{2}\s+\d+\s+(?:\d{1,2}:\d{2}|\d{4}))\s(.+)$/;
function parseLs(text) {
  const entries = [];
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('sftp>')) continue;
    const m = LS_RE.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    let name = m[6];
    const link = m[1][0] === 'l';
    if (link && name.includes(' -> ')) name = name.slice(0, name.indexOf(' -> '));
    if (name === '.' || name === '..') continue;
    entries.push({name, dir: m[1][0] === 'd', link, size: Number(m[4]), modified: m[5].replace(/\s+/g, ' '), mode: m[1].slice(0, 10), owner: m[2]});
  }
  return entries;
}

function create({stateRoot, run = execFileSync, spawnFn = spawn, pty = null, home = HOME, now = Date.now}) {
  const dir = path.join(stateRoot, 'hosts');
  const socket = path.join(dir, 'tmux.sock');
  // The shared connections' sockets: a short folder, as a socket's path must stay under 104
  // bytes and ssh adds 17 to it while it sets one up.
  const ctl = path.join(stateRoot, 'hc');
  const controlOk = Buffer.byteLength(path.join(ctl, 'x'.repeat(40))) + 17 < 104;
  const file = path.join(dir, 'hosts.json');
  const ensure = () => { fs.mkdirSync(dir, {recursive: true, mode: 0o700}); fs.mkdirSync(ctl, {recursive: true, mode: 0o700}); };
  // Batch files a transfer left when the service stopped in the middle of it.
  try { for (const f of fs.readdirSync(path.join(stateRoot, 'hosts'))) if (f.startsWith('batch-')) fs.rmSync(path.join(stateRoot, 'hosts', f), {force: true}); } catch {}
  // Files on their way between the admin's own device and a machine: one folder
  // each, gone once handed on, and anything left by a stop a day later.
  const between = path.join(dir, 'between');
  // Nothing in it can be taken after a restart (the transfers it belonged to are gone): all of it
  // goes at start; while running, an hourly look removes what has waited a day.
  try { fs.rmSync(between, {recursive: true, force: true}); } catch {}
  const sweepBetween = () => { try { for (const f of fs.readdirSync(between)) { const p = path.join(between, f); try { if (now() - fs.lstatSync(p).mtimeMs > 86400000) fs.rmSync(p, {recursive: true, force: true}); } catch {} } } catch {} };
  { const timer = setInterval(sweepBetween, 3600000); timer.unref?.(); }
  const dropFetch = (t) => { if (t?.fetch?.place) try { fs.rmSync(t.fetch.place, {recursive: true, force: true}); } catch {} };
  const passage = () => { fs.mkdirSync(between, {recursive: true, mode: 0o700}); const p = path.join(between, crypto.randomBytes(8).toString('hex')); fs.mkdirSync(p, {mode: 0o700}); return p; };
  const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j.users === 'object' && j.users ? j : {users: {}}; } catch { return {users: {}}; } };
  const save = (j) => { ensure(); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(j, null, 1), {mode: 0o600}); fs.renameSync(tmp, file); };
  // ssh and sftp get the allowlist and the account's agent, never the service's secrets.
  const env = () => ({...agentEnv(), ...(process.env.SSH_AUTH_SOCK ? {SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK} : {}), HOME: home, LC_CTYPE: 'en_US.UTF-8'});
  const tmux = (args, opts = {}) => {
    try { return run('tmux', ['-S', socket, ...args], {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'], env: env(), ...opts}); }
    catch (e) { const err = fail('tmux: ' + (String(e.stderr || '').trim() || e.message), 500); err.stderr = String(e.stderr || ''); throw err; }
  };

  function configHosts() {
    try { return parseConfig(fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8')); } catch { return []; }
  }
  function saved(userId) { return (load().users[userId] || []).filter((h) => h && ID_RE.test(h.id)); }
  // ~/.ssh/config machines deleted on the page: left out of the list, the file untouched.
  const hidden = (userId) => { const x = load().hidden?.[userId]; return Array.isArray(x) ? x.filter((a) => typeof a === 'string') : []; };
  function restoreHidden(userId) { const j = load(); if (j.hidden?.[userId]) { delete j.hidden[userId]; save(j); } }
  const configId = (alias) => 'c-' + Buffer.from(alias).toString('hex');
  // What an edit of a ~/.ssh/config machine changed: only that is given on top of its alias, so
  // what ssh takes from Host * or Include stays.
  function pinned(c, v) {
    const out = [];
    if (v.host !== c.host) out.push('host');
    if ((v.user || '') !== (c.user || '')) out.push('user');
    if (Number(v.port) !== Number(c.port || 22)) out.push('port');
    if (v.identityFile) out.push('identityFile');
    return out;
  }
  function list(userId) {
    const own = saved(userId); const gone = new Set(hidden(userId));
    return [
      {id: 'local', kind: 'local', name: os.hostname().replace(/\.local$/, ''), user: os.userInfo().username},
      ...own.map((h) => ({...h, kind: 'saved'})),
      // A ~/.ssh/config machine edited on the page is kept as the page's own (from: its alias)
      // and shown once, there; deleting that brings the config one back. The file is never written.
      ...configHosts().filter((c) => !own.some((h) => h.from === c.alias) && !gone.has(c.alias)).map((c) => ({id: configId(c.alias), kind: 'config', name: c.alias, alias: c.alias, host: c.hostname || c.alias, user: c.user || '', port: c.port || 22, proxy: !!c.proxy})),
    ];
  }
  function find(userId, id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw fail('找不到這台主機', 404);
    const h = list(userId).find((x) => x.id === id);
    if (!h) throw fail('找不到這台主機', 404);
    return h;
  }
  function validate(b = {}) {
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw fail('名稱要 1 到 60 個字');
    const host = String(b.host ?? '').trim();
    if (!HOST_RE.test(host)) throw fail('主機位址不正確');
    const user = String(b.user ?? '').trim();
    if (user && !USER_RE.test(user)) throw fail('使用者名稱不正確');
    const port = b.port === undefined || b.port === '' || b.port === null ? 22 : Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('連接埠要是 1 到 65535');
    let identityFile = String(b.identityFile ?? '').trim();
    if (identityFile) {
      if (identityFile.startsWith('~/')) identityFile = path.join(home, identityFile.slice(2));
      if (!path.isAbsolute(identityFile) || identityFile.length > 1024 || /[\u0000-\u001f\u007f]/.test(identityFile)) throw fail('金鑰檔要寫完整路徑');
    }
    return {name, host, user, port, ...(identityFile ? {identityFile} : {})};
  }
  function add(userId, body) {
    const h = {id: 's-' + crypto.randomBytes(6).toString('hex'), ...validate(body)};
    const j = load(); const own = j.users[userId] || [];
    if (own.length >= 200) throw fail('主機太多了');
    j.users[userId] = [...own, h]; save(j);
    return h;
  }
  function update(userId, id, body) {
    const j = load(); const own = j.users[userId] || []; const i = own.findIndex((h) => h.id === id);
    if (i < 0) {
      // A ~/.ssh/config machine: kept on the page from now on, still going through its alias
      // (so its ProxyJump and the like stay), with what was changed given on top.
      const c = typeof id === 'string' && id.startsWith('c-') && list(userId).find((x) => x.id === id && x.kind === 'config');
      if (!c) throw fail('找不到這台主機', 404);
      if (own.length >= 200) throw fail('主機太多了');
      const v = validate(body);
      const h = {id: 's-' + crypto.randomBytes(6).toString('hex'), from: c.alias, ...v, pin: pinned(c, v)};
      closeAll(userId, id);
      j.users[userId] = [...own, h];
      // It keeps its place in the list and its category.
      const l = j.layout?.[userId];
      if (l) { l.order = (l.order || []).map((x) => (x === id ? h.id : x)); for (const g of l.groups || []) g.hosts = (g.hosts || []).map((x) => (x === id ? h.id : x)); }
      save(j);
      return h;
    }
    const v = validate(body);
    const c = own[i].from && configHosts().find((x) => x.alias === own[i].from);
    own[i] = {id, ...(own[i].from ? {from: own[i].from} : {}), ...v, ...(c ? {pin: pinned({host: c.hostname || c.alias, user: c.user || '', port: c.port || 22}, v)} : {})}; j.users[userId] = own; save(j);
    return own[i];
  }
  function remove(userId, id) {
    const j = load(); const own = j.users[userId] || []; const i = own.findIndex((h) => h.id === id);
    if (i < 0) {
      const c = typeof id === 'string' && id.startsWith('c-') && list(userId).find((x) => x.id === id && x.kind === 'config');
      if (!c) throw fail('找不到這台主機', 404);
      closeAll(userId, id);
      j.hidden = {...(j.hidden || {}), [userId]: [...new Set([...hidden(userId), c.alias])].slice(0, 1000)}; save(j);
      return;
    }
    closeAll(userId, id);
    own.splice(i, 1); j.users[userId] = own; save(j);
  }

  // ---- the list's order and categories, an account's own: Edit drags
  // the machines and makes categories, as on the Agents list. Ids no longer there are
  // dropped when read; machines not named stay outside any category, in their usual order.
  function layout(userId) {
    const l = load().layout?.[userId] || {}; const ids = new Set(list(userId).map((h) => h.id));
    const order = (Array.isArray(l.order) ? l.order : []).filter((id) => ids.has(id));
    const groups = (Array.isArray(l.groups) ? l.groups : []).map((g) => ({id: g.id, name: g.name, hosts: (g.hosts || []).filter((id) => ids.has(id))}));
    return {order, groups};
  }
  function setLayout(userId, b = {}) {
    const idOk = (id) => typeof id === 'string' && ID_RE.test(id);
    if (!Array.isArray(b.order) || b.order.length > 1000 || !b.order.every(idOk)) throw fail('清單不正確');
    const groups = Array.isArray(b.groups) ? b.groups : [];
    if (groups.length > 50) throw fail('分類太多了');
    const seen = new Set();
    const clean = groups.map((g) => {
      const name = String(g?.name ?? '').trim();
      if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw fail('分類名稱要 1 到 40 個字');
      const id = typeof g.id === 'string' && /^g-[a-f0-9]{8}$/.test(g.id) ? g.id : 'g-' + crypto.randomBytes(4).toString('hex');
      const hosts = (Array.isArray(g.hosts) ? g.hosts : []).filter((h) => idOk(h) && !seen.has(h) && seen.add(h));
      return {id, name, hosts};
    });
    const j = load(); j.layout = {...(j.layout || {}), [userId]: {order: [...new Set(b.order)], groups: clean}}; save(j);
    return layout(userId);
  }

  // ---- connecting
  const common = () => { ensure(); return [...(controlOk ? ['-o', 'ControlMaster=auto', '-o', 'ControlPath=' + path.join(ctl, '%C'), '-o', 'ControlPersist=600'] : ['-o', 'ControlMaster=no', '-o', 'ControlPath=none']), '-o', 'ServerAliveInterval=30']; };
  // The host's own options (the same for ssh and sftp, both read -o) and where to go.
  const viaAlias = (h) => h.kind === 'saved' && h.from && configHosts().some((c) => c.alias === h.from);
  // Through its alias, only what the edit changed (older entries without pin: all of it).
  const has = (h, f) => !viaAlias(h) || !Array.isArray(h.pin) || h.pin.includes(f);
  const hostOptions = (h) => h.kind === 'config' ? [] : viaAlias(h) && Array.isArray(h.pin) ? [
    ...(has(h, 'host') ? ['-o', 'HostName=' + h.host] : []), ...(has(h, 'port') ? ['-o', 'Port=' + h.port] : []), ...(has(h, 'user') && h.user ? ['-o', 'User=' + h.user] : []),
    ...(h.identityFile ? ['-o', 'IdentityFile=' + h.identityFile, '-o', 'IdentitiesOnly=yes'] : []),
  ] : [...(viaAlias(h) ? ['-o', 'HostName=' + h.host] : []), '-o', 'Port=' + h.port, ...(h.user ? ['-o', 'User=' + h.user] : []), ...(h.identityFile ? ['-o', 'IdentityFile=' + h.identityFile, '-o', 'IdentitiesOnly=yes'] : [])];
  const destination = (h) => h.kind === 'config' ? h.alias : viaAlias(h) ? h.from : h.host;
  const sshArgs = (h) => [...common(), ...hostOptions(h), '--', destination(h)];

  // ---- terminals
  const prefix = (userId, id) => `h-${userId}-${id}-`;
  const nameOf = (userId, id, n) => prefix(userId, id) + n;
  // One tmux listing for all machines (a page asks for every one at once).
  function sessions() {
    try { return tmux(['list-sessions', '-F', '#{session_name}|#{pane_current_command}|#{window_activity}' + SEP + '#{pane_title}' + SEP + '#{pane_current_path}']); }
    catch (e) { if (/no server running|error connecting to|No such file or directory/.test(String(e.stderr || ''))) return ''; throw e; }
  }
  function tabs(userId, id, out = sessions()) {
    const p = prefix(userId, id);
    return out.split('\n').filter((l) => l.startsWith(p)).map((l) => {
      const [head, title = '', where = ''] = l.split(SEP);
      const [name, command = '', activity = ''] = head.split('|');
      const n = Number(name.slice(p.length));
      const running = !!command && !SHELLS.has(command.replace(/^-/, '')) && command !== 'ssh';
      const busy = running && Math.floor(now() / 1000) - Number(activity) <= 4;
      const t = String(title).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
      // The folder it is in, as the agents' shell tabs show it: this computer's from tmux, another
      // machine's from the title its shell sets ("user@host: ~/dir"), when it sets one.
      const remote = /^[^@\s]+@[^:\s]+:\s*(\S.*)$/.exec(t)?.[1] || '';
      const cwd = id === 'local' ? (where === home ? '~' : where.startsWith(home + '/') ? '~' + where.slice(home.length) : where) : remote;
      return {n, busy, running, ...(running ? {command: command.slice(0, 40)} : {}), title: t.slice(0, 60), cwd: cwd.slice(0, 300)};
    }).filter((s) => Number.isInteger(s.n) && s.n >= 1).sort((a, b) => a.n - b.n);
  }
  function alive(userId, id, n) {
    if (!ID_RE.test(String(id)) || !Number.isInteger(n) || n < 1) return false;
    try { tmux(['has-session', '-t', '=' + nameOf(userId, id, n)]); return true; } catch { return false; }
  }
  function openTab(userId, id, {localAllowed = true} = {}) {
    const h = find(userId, id);
    if (h.kind === 'local' && !localAllowed) throw fail('終端機分頁已在管理頁關閉', 403);
    const taken = new Set(tabs(userId, id).map((s) => s.n));
    let n = 1; while (taken.has(n)) n += 1;
    ensure();
    const e = env();
    const shell = [e.SHELL, os.userInfo().shell, '/bin/zsh', '/bin/bash'].find((s) => s && path.isAbsolute(s) && fs.existsSync(s));
    const command = h.kind === 'local' ? [shell, '-l'] : [SSH, ...sshArgs(h)];
    // Two opened at once may pick the same number: the next free one then.
    for (let tries = 0; ; tries += 1) {
      try { tmux(['new-session', '-d', '-s', nameOf(userId, id, n), '-c', home, '-x', '120', '-y', '30', ...command]); return {n}; }
      catch (e) { if (tries < 5 && /duplicate session/.test(e.stderr || e.message)) { n += 1; while (taken.has(n)) n += 1; continue; } throw e; }
    }
  }
  function closeTab(userId, id, n) {
    if (!alive(userId, id, n)) return false;
    try { tmux(['kill-session', '-t', '=' + nameOf(userId, id, n)]); } catch {}
    return true;
  }
  function closeAll(userId, id) { for (const s of tabs(userId, id)) closeTab(userId, id, s.n); }
  // Every terminal of an account (no longer an admin): the sessions whose names are its.
  function closeUser(userId) {
    let out = '';
    try { out = tmux(['list-sessions', '-F', '#{session_name}']); } catch { return; }
    for (const name of out.split('\n')) if (name.startsWith(`h-${userId}-`)) { try { tmux(['kill-session', '-t', '=' + name]); } catch {} }
  }
  // An account no longer an admin, disabled or deleted (productAccountHooks.js): its terminals and
  // transfers end now, and a purged account's saved machines go too.
  function accountOff(userId, {purge = false} = {}) {
    closeUser(userId);
    for (const t of transfers.values()) if (t.userId === userId) { if (t.state === 'running') t.kill?.(); dropFetch(t); }
    if (purge) { const j = load(); if (j.users[userId] || j.layout?.[userId] || j.hidden?.[userId]) { delete j.users[userId]; if (j.layout) delete j.layout[userId]; if (j.hidden) delete j.hidden[userId]; save(j); } }
  }
  // Everything on this computer's shells (the admin page switched shell tabs off): this computer's
  // own terminals end; other machines' SSH terminals are not shells of this computer and stay.
  function closeLocal() {
    let out = '';
    try { out = tmux(['list-sessions', '-F', '#{session_name}']); } catch { return; }
    for (const name of out.split('\n')) if (/^h-[^-]+-local-\d+$/.test(name)) { try { tmux(['kill-session', '-t', '=' + name]); } catch {} }
  }

  // ---- reachability: a connection to its port, or unknown behind a proxy.
  // Whether a machine answers on its SSH port, kept a minute per address: each look opens and drops
  // a connection, which a server's log, and a fail2ban or CrowdSec there, sees;
  // pages open at once share one look.
  const reached = new Map();
  function reach(h) {
    if (h.kind === 'local') return Promise.resolve('online');
    if (h.proxy) return Promise.resolve('unknown');
    const key = h.host + ':' + (h.port || 22), kept = reached.get(key);
    if (kept && now() - kept.at < 60000) return kept.value;
    const value = probe(h);
    reached.set(key, {at: now(), value});
    if (reached.size > 500) reached.delete(reached.keys().next().value);
    return value;
  }
  function probe(h) {
    return new Promise((resolve) => {
      const s = net.connect({host: h.host, port: h.port || 22});
      const done = (v) => { s.destroy(); resolve(v); };
      s.setTimeout(1500, () => done('offline'));
      s.once('connect', () => done('online'));
      s.once('error', () => done('offline'));
    });
  }

  // ---- files
  const friendly = (text) => {
    const t = String(text || '');
    if (/Host key verification failed|No .* host key is known/i.test(t)) return '這台主機的指紋還沒確認：先用 SSH 連一次，在終端機回答 yes';
    if (/Permission denied|Too many authentication failures/i.test(t)) return '登入被拒：這台要密碼的話，先在 SSH 分頁登入一次，SFTP 就能沿用那條連線';
    if (/Could not resolve hostname|Connection refused|timed out|No route to host|Connection closed/i.test(t)) return '連不上這台主機';
    if (/No such file|not found/i.test(t)) return '找不到這個檔案或資料夾';
    return t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('sftp>')).slice(-2).join(' ').slice(0, 300) || 'SFTP 失敗';
  };
  // One sftp run: its commands from stdin, never asking anything.
  function sftp(h, commands, {timeout = 30000} = {}) {
    return new Promise((resolve, reject) => {
      const child = spawnFn(SFTP, ['-q', '-b', '-', '-o', 'BatchMode=yes', ...common(), ...hostOptions(h), '--', destination(h)], {env: env(), cwd: home, stdio: ['pipe', 'pipe', 'pipe']});
      let out = '', err = '', settled = false;
      const end = (f, v) => { if (settled) return; settled = true; clearTimeout(timer); f(v); };
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} end(reject, fail('SFTP 逾時', 504)); }, timeout);
      child.stdout.on('data', (d) => { out += d; if (out.length > 8e6) { try { child.kill('SIGKILL'); } catch {} end(reject, fail('清單太長', 413)); } });
      child.stderr.on('data', (d) => { err += d; if (err.length > 1e5) err = err.slice(-1e5); });
      child.on('error', (e) => end(reject, fail('找不到 sftp：' + e.message, 500)));
      child.on('close', (code) => code === 0 ? end(resolve, out) : end(reject, fail(friendly(err || out), 502)));
      child.stdin.end(commands.join('\n') + '\n');
    });
  }
  // A fixed command for the remote shell, whatever shell it is; the path goes in on stdin, never
  // in the command line, as quoting differs in fish.
  const REMOVE = "sh -c 'IFS= read -r p && exec rm -rf -- \"$p\"'";
  function sshRun(h, command, {timeout = 30000, input = ''} = {}) {
    return new Promise((resolve, reject) => {
      const child = spawnFn(SSH, ['-o', 'BatchMode=yes', ...common(), ...hostOptions(h), '--', destination(h), command], {env: env(), cwd: home, stdio: ['pipe', 'pipe', 'pipe']});
      let err = '', settled = false;
      const end = (f, v) => { if (settled) return; settled = true; clearTimeout(timer); f(v); };
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} end(reject, fail('逾時', 504)); }, timeout);
      child.stdout.on('data', () => {});
      child.stderr.on('data', (d) => { err += d; if (err.length > 1e5) err = err.slice(-1e5); });
      child.on('error', (e) => end(reject, fail(e.message, 500)));
      child.on('close', (code) => code === 0 ? end(resolve) : end(reject, fail(friendly(err), 502)));
      child.stdin.end(input);
    });
  }

  const localPath = (p) => {
    p = cleanPath(p, {allowEmpty: true}) || home;
    if (p === '~') p = home; else if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    if (!path.isAbsolute(p)) throw fail('路徑要從 / 開始');
    return path.resolve(p);
  };
  function localList(p) {
    const at = localPath(p);
    let names;
    try { names = fs.readdirSync(at); } catch (e) { throw fail(e.code === 'ENOENT' ? '找不到這個資料夾' : e.code === 'EACCES' || e.code === 'EPERM' ? '沒有權限打開這個資料夾' : e.code === 'ENOTDIR' ? '這不是資料夾' : e.message, e.code === 'ENOENT' ? 404 : 403); }
    const entries = [];
    for (const name of names.slice(0, 5000)) {
      try {
        const st = fs.lstatSync(path.join(at, name));
        let dir = st.isDirectory();
        if (st.isSymbolicLink()) { try { dir = fs.statSync(path.join(at, name)).isDirectory(); } catch {} }
        entries.push({name, dir, link: st.isSymbolicLink(), size: st.size, modified: st.mtime.toISOString(), mode: (st.mode & 0o7777).toString(8)});
      } catch {}
    }
    return {path: at, display: tilde(at), parent: at === '/' ? null : path.dirname(at), entries};
  }
  async function remoteList(h, p) {
    p = cleanPath(p, {allowEmpty: true});
    const out = await sftp(h, [...(p ? ['cd ' + sq(p)] : []), 'pwd', 'ls -la']);
    const m = /Remote working directory:\s*(.+)/.exec(out);
    const at = m ? m[1].trim() : p || '/';
    return {path: at, display: at, parent: at === '/' ? null : path.posix.dirname(at), entries: parseLs(out)};
  }
  const listFiles = (userId, id, p) => id === 'local' ? localList(p) : remoteList(find(userId, id), p);

  // Rename, delete, a new folder, permissions: here or there.
  async function fileOp(userId, id, b = {}) {
    const op = b.op;
    if (id === 'local') {
      const p = localPath(b.path);
      if (op !== 'mkdir' && (p === '/' || p === home)) throw fail('這個資料夾不能這樣改');
      if (op === 'rename') { const to = path.join(path.dirname(p), cleanName(b.name)); if (fs.existsSync(to)) throw fail('已經有同名的檔案'); fs.renameSync(p, to); return {ok: true}; }
      if (op === 'delete') { fs.rmSync(p, {recursive: true, force: false}); return {ok: true}; }
      if (op === 'mkdir') { fs.mkdirSync(path.join(p, cleanName(b.name))); return {ok: true}; }
      if (op === 'chmod') { const mode = parseMode(b.mode); if (fs.lstatSync(p).isSymbolicLink()) throw fail('這是捷徑（符號連結），請改它指到的檔案'); fs.chmodSync(p, mode); return {ok: true}; }
      throw fail('不認得的動作');
    }
    const h = find(userId, id);
    const p = path.posix.normalize(cleanPath(b.path)).replace(/(.)\/$/, '$1');
    // The page sends only full paths; a relative one could name the home or root folder past the check below.
    if (!p.startsWith('/')) throw fail('路徑要從 / 開始');
    if (op !== 'mkdir' && p === '/') throw fail('這個資料夾不能這樣改');
    if (op === 'rename') {
      const name = cleanName(b.name), parent = path.posix.dirname(p);
      // sftp's rename replaces a file of that name on a server that has posix-rename: asked first.
      if ((await remoteList(h, parent)).entries.some((e) => e.name.toLowerCase() === name.toLowerCase() && e.name !== path.posix.basename(p))) throw fail('已經有同名的檔案');
      await sftp(h, ['rename ' + sq(p) + ' ' + sq(path.posix.join(parent, name))]); return {ok: true};
    }
    if (op === 'delete') { await sshRun(h, REMOVE, {input: cleanPath(p) + '\n'}); return {ok: true}; }
    if (op === 'mkdir') { await sftp(h, ['mkdir ' + sq(path.posix.join(p, cleanName(b.name)))]); return {ok: true}; }
    if (op === 'chmod') { await sftp(h, ['chmod -h ' + parseMode(b.mode).toString(8) + ' ' + sq(p)]); return {ok: true}; }
    throw fail('不認得的動作');
  }
  function parseMode(m) { const s = String(m ?? ''); if (!/^[0-7]{3,4}$/.test(s)) throw fail('權限要寫成三或四位數字，例如 644'); return parseInt(s, 8); }

  // ---- transfers: one sftp each, its progress meter read from a terminal of its own.
  const transfers = new Map();
  const publicTransfer = (t) => ({id: t.id, hostId: t.hostId, direction: t.direction, ...(t.fetch ? {toDevice: true, ready: t.state === 'done' && !t.fetch.taken} : {}), ...(t.fromDevice ? {fromDevice: true} : {}), name: t.name, count: t.count, to: t.fetch ? '' : t.to, percent: t.percent, state: t.state, error: t.error, startedAt: t.startedAt, endedAt: t.endedAt});
  function listTransfers(userId) { return [...transfers.values()].filter((t) => t.userId === userId).map(publicTransfer).reverse(); }
  async function startTransfer(userId, id, b = {}, inner = {}) {
    if (id === 'local') throw fail('這台電腦自己不用傳');
    const h = find(userId, id);
    const direction = b.direction === 'upload' ? 'upload' : b.direction === 'download' ? 'download' : null;
    if (!direction) throw fail('要上傳還是下載？');
    const items = Array.isArray(b.items) ? b.items : [b.from];
    if (!items.length || items.length > 50) throw fail('一次最多 50 個');
    const sources = items.map((x) => direction === 'upload' ? localPath(x) : cleanPath(x));
    const toDir = direction === 'upload' ? cleanPath(b.toDir) : localPath(b.toDir);
    const running = [...transfers.values()].filter((t) => t.userId === userId && t.state === 'running').length;
    if (running >= 4) throw fail('同時最多 4 個傳輸，等前面的傳完', 429);
    // A file of the same name on the other side is replaced only when the admin said so (the page
    // asks): sftp's get and put overwrite without asking.
    if (b.overwrite !== true) {
      // Without regard to case: this computer's disk, and a Mac or Windows server's, take README and Readme as one file.
      const there = new Set((direction === 'upload' ? (await remoteList(h, toDir)).entries.map((e) => e.name) : (() => { try { return fs.readdirSync(toDir); } catch { return []; } })()).map((n) => n.toLowerCase()));
      const clash = sources.map((src) => direction === 'upload' ? path.basename(src) : path.posix.basename(src)).filter((n) => there.has(n.toLowerCase()));
      if (clash.length) throw Object.assign(fail('另一邊已經有同名的檔案：' + clash.slice(0, 5).join(', '), 409), {clash});
      // Counted again: other transfers may have started while the other side was looked at.
      if ([...transfers.values()].filter((t) => t.userId === userId && t.state === 'running').length >= 4) throw fail('同時最多 4 個傳輸，等前面的傳完', 429);
    }
    const lines = ['progress', ...sources.map((src) => direction === 'upload' ? `put -r ${sq(src)} ${sq(path.posix.join(toDir, path.basename(src)))}` : `get -r ${sq(src)} ${sq(path.join(toDir, path.posix.basename(src)))}`)];
    const t = {id: crypto.randomBytes(8).toString('hex'), userId, hostId: id, direction, ...(inner.fetch ? {fetch: inner.fetch} : {}), ...(inner.after ? {after: inner.after} : {}), name: sources.length === 1 ? path.basename(sources[0]) : '', count: sources.length, to: direction === 'upload' ? toDir : tilde(toDir), percent: 0, state: 'running', error: '', startedAt: new Date(now()).toISOString(), endedAt: null};
    transfers.set(t.id, t);
    while (transfers.size > MAX_TRANSFERS) { const old = [...transfers.values()].find((x) => x.state !== 'running'); if (!old) break; dropFetch(old); transfers.delete(old.id); }
    // Still an admin after the wait for the other side's listing: the route's check, again.
    if (inner.allowed && !inner.allowed()) { transfers.delete(t.id); throw fail('Admin only', 403); }
    ensure();
    const batch = path.join(dir, `batch-${t.id}`);
    fs.writeFileSync(batch, lines.join('\n') + '\n', {mode: 0o600});
    const args = ['-b', batch, '-o', 'BatchMode=yes', ...common(), ...hostOptions(h), '--', destination(h)];
    const ptyModule = pty || require('node-pty');
    let child, tail = '';
    const finish = (state, error = '') => { if (t.state !== 'running') return; t.state = state; t.error = error; t.endedAt = new Date(now()).toISOString(); if (state === 'done') t.percent = 100; try { t.after?.(state); } catch {} try { fs.rmSync(batch, {force: true}); } catch {} try { require('./services/audit').audit({source: 'terminal-hosts', action: 'host-transfer-' + state, by: userId, host: id, direction, items: sources.slice(0, 50).map((x) => String(x).slice(0, 300)), to: String(toDir).slice(0, 300), ...(error ? {error: String(error).slice(0, 200)} : {})}); } catch {} };
    try { child = ptyModule.spawn(SFTP, args, {name: 'xterm', cols: 160, rows: 10, cwd: home, env: env()}); }
    catch (e) { finish('failed', e.message); return publicTransfer(t); }
    t.kill = () => { try { child.kill(); } catch {} finish('cancelled'); };
    child.onData((d) => { tail = (tail + d).slice(-4000); const all = [...d.matchAll(/(\d{1,3})%/g)]; if (all.length) t.percent = Math.min(99, Number(all[all.length - 1][1])); });
    child.onExit(({exitCode}) => finish(exitCode === 0 ? 'done' : 'failed', exitCode === 0 ? '' : friendly(tail)));
    return publicTransfer(t);
  }
  // ---- the admin's own device: a file it sent, handed to a machine; a machine's file, fetched to it
  // A file the page sent in parts (attachments.js, kept under the account's own name) is given its
  // name in a folder of its own and put on the machine as any upload is, or moved into the folder on
  // this computer; it is gone from here afterwards either way.
  async function receive(userId, id, {file, name, toDir, overwrite, allowed} = {}) {
    const clean = String(name || '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
    if (!clean || clean === '.' || clean === '..' || clean.length > 255) throw fail('名稱不正確');
    if (id === 'local') {
      const to = localPath(toDir); const target = path.join(to, clean);
      if (!fs.statSync(to).isDirectory()) throw fail('這不是資料夾');
      if (overwrite !== true && fs.readdirSync(to).some((n) => n.toLowerCase() === clean.toLowerCase())) throw Object.assign(fail('另一邊已經有同名的檔案：' + clean, 409), {clash: [clean]});
      try { fs.renameSync(file, target); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, target); fs.rmSync(file, {force: true}); }
      return {ok: true, local: true, name: clean};
    }
    const place = passage(); const staged = path.join(place, clean);
    fs.renameSync(file, staged);
    try {
      const t = await startTransfer(userId, id, {direction: 'upload', items: [staged], toDir, overwrite}, {allowed, after: () => fs.rmSync(place, {recursive: true, force: true})});
      const kept = transfers.get(t.id); if (kept) kept.fromDevice = true;
      return {...t, fromDevice: true};
    } catch (e) { let back = false; try { fs.renameSync(staged, file); back = true; } catch {} if (back) fs.rmSync(place, {recursive: true, force: true}); throw e; }
  }
  // A machine's file for the device: fetched here first (with its progress in the list), then the
  // page takes it once (fetched()), and it is gone; one never taken goes with the day's sweep.
  async function fetchFile(userId, id, p, {allowed} = {}) {
    if (id === 'local') throw fail('這台電腦的檔案直接下載');
    const src = path.posix.normalize(cleanPath(p)); const base = path.posix.basename(src);
    if (!src.startsWith('/') || !base || base === '.' || base === '..') throw fail('路徑要從 / 開始');
    // A folder is refused before anything comes, and a file only with room for it and the
    // reserve the chat's uploads keep: the disk is the one the service's data is on.
    const h = find(userId, id);
    const entry = (await remoteList(h, path.posix.dirname(src))).entries.find((e) => e.name === base);
    if (!entry) throw fail('找不到這個檔案或資料夾', 404);
    if (entry.dir) throw fail('資料夾要先壓縮才能下載');
    // A link may name a folder, which sftp's get then copies whole: its own file is taken instead.
    if (entry.link) throw fail('這是捷徑（符號連結），請改下載它指到的檔案');
    try { fs.mkdirSync(between, {recursive: true, mode: 0o700}); const st = fs.statfsSync(between); if (st.bavail * st.bsize < (entry.size || 0) + 1024 * 1024 * 1024) throw fail('這台電腦的磁碟空間不夠放這個檔案', 507); } catch (e) { if (e.status) throw e; }
    p = src;
    const place = passage();
    try { return await startTransfer(userId, id, {direction: 'download', items: [p], toDir: place, overwrite: true}, {allowed, fetch: {place, name: path.posix.basename(cleanPath(p))}, after: (state) => { if (state !== 'done') fs.rmSync(place, {recursive: true, force: true}); }}); }
    catch (e) { fs.rmSync(place, {recursive: true, force: true}); throw e; }
  }
  function fetched(userId, tid) {
    const t = transfers.get(tid);
    if (!t || t.userId !== userId || !t.fetch || t.state !== 'done' || t.fetch.taken) throw fail('找不到這個傳輸', 404);
    const f = path.join(t.fetch.place, t.fetch.name); let st; try { st = fs.lstatSync(f); } catch { throw fail('找不到這個檔案或資料夾', 404); }
    if (!st.isFile()) { dropFetch(t); throw fail('資料夾要先壓縮才能下載'); }
    // Taken only once it went all the way (a HEAD, or a send cut off, would leave nothing to retry).
    return {file: f, name: t.fetch.name, size: st.size, done: (whole) => { if (!whole) return; t.fetch.taken = true; dropFetch(t); }};
  }
  // This computer's own file, straight to the device.
  function localFile(p) {
    const f = localPath(p); let st; try { st = fs.lstatSync(f); } catch { throw fail('找不到這個檔案或資料夾', 404); }
    if (st.isSymbolicLink() || !st.isFile()) throw fail(st.isDirectory() ? '資料夾要先壓縮才能下載' : '找不到這個檔案或資料夾', st.isDirectory() ? 400 : 404);
    return {file: f, name: path.basename(f), size: st.size};
  }
  function cancelTransfer(userId, tid) {
    const t = transfers.get(tid);
    if (!t || t.userId !== userId) throw fail('找不到這個傳輸', 404);
    if (t.state === 'running') t.kill?.();
    return publicTransfer(t);
  }

  return {socket, receive, fetchFile, fetched, localFile, sessions, layout, setLayout, hidden, restoreHidden, list, find, add, update, remove, tabs, alive, openTab, closeTab, closeAll, closeUser, accountOff, closeLocal, nameOf, reach, listFiles, fileOp, listTransfers, startTransfer, cancelTransfer, sshArgs};
}

let instance = null;
const shared = () => instance || (instance = create({stateRoot: require('./agentStore').stateRoot}));
module.exports = {create, shared, parseConfig, parseLs};

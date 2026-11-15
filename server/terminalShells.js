// Shells beside an agent's Claude terminal: a clean shell of the admin's own to run
// something else, opened from a tab on the terminal page, which the agent of that
// conversation never touches. Each is a tmux session of its own, which lives until its
// tab is closed, its shell exits, or the agent is deleted.
//
// Kept apart from the agent: the tmux server's socket is in CC Agent's own data folder,
// which no scoped agent can read (server/agentAccess.js protectedRoots), not in the shared
// temporary folder; and a shell starts in the home folder, not the agent's, where the agent
// could have left a repository whose settings run a program at the first prompt (git's
// fsmonitor, run by a prompt's git status). A full-access agent runs as this account and
// can reach anything; that is what full access is.
// Started with the agent allowlist of environment variables (channel/agentEnv.cjs), never
// the service's secrets. Only an admin can open one, for an agent of their own. Not on
// Windows, whose tmux-compatible server takes no socket file: there the list is empty and
// opening one is refused.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const agentEnv = require('../channel/agentEnv.cjs');
const platform = require('../channel/platform.cjs');

// No cap on how many; each takes the lowest free number.
const prefix = (c) => 'sh-' + c.id + '-';
const nameOf = (c, n) => prefix(c) + n;
// Paths are shown under the home folder as ~, as a shell's prompt shows them.
// The account's own home, as a shell opens in (open below), not $HOME, which a test or a service may set elsewhere.
const HOME = os.userInfo().homedir;
const tilde = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
// A shell waiting at its prompt shows its own name as the pane's command; anything else
// is a program running in it.
const SEP = '|~|';
// A title as a tab shows it: printable, short, without the mark some programs put first
// ("✳ Claude Code").
const cleanTitle = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 60);
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);

// Seconds without output after which a running program counts as waiting, not working.
const BUSY_QUIET_S = 4;
function create({stateRoot, run = execFileSync, now = Date.now}) {
  const dir = path.join(stateRoot, 'shells');
  const socket = path.join(dir, 'tmux.sock');
  // A failed tmux is the server's fault, never its exit code as an HTTP status (an exit
  // code 1 once went out as the status and the request never answered).
  const tmux = (args, opts = {}) => {
    // A UTF-8 locale for the client, or tmux prints a title's or a folder's non-ASCII as "_".
    const env = {...(opts.env || process.env), LC_CTYPE: 'en_US.UTF-8'};
    try { return run('tmux', ['-S', socket, ...args], {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'], ...opts, env}); }
    catch (e) { const err = new Error('tmux: ' + (String(e.stderr || '').trim() || e.message)); err.stderr = String(e.stderr || ''); err.status = 500; throw err; }
  };
  // The folder an agent's current Claude session runs in.
  const folderOf = (c, g) => path.join(stateRoot, 'workspaces', c.id, 'g' + g.number);

  function list(c) {
    if (platform.isWin) return [];
    let out = '';
    // No server yet is no shells; any other failure is not "none", so closing all of an
    // agent's does not pass over ones it could not list.
    // Printable separators: without a UTF-8 locale (the service under launchd) tmux printed a
    // tab as "_". The title a program gave itself (a terminal app's tab shows it: "Claude
    // Code") and the path can hold anything, so they are
    // last and kept apart by a sequence neither has.
    try { out = tmux(['list-sessions', '-F', '#{session_name}|#{pane_current_command}|#{window_activity}' + SEP + '#{pane_title}' + SEP + '#{pane_current_path}']); }
    catch (e) { if (/no server running|error connecting to|No such file or directory/.test(String(e.stderr || ''))) return []; throw e; }
    const p = prefix(c);
    return out.split('\n').filter((l) => l.startsWith(p)).map((l) => {
      const [head, title = '', ...rest] = l.split(SEP);
      const [name, command = '', activity = ''] = head.split('|');
      const cwd = rest.join(SEP);
      const n = Number(name.slice(p.length));
      // A program open in it names the tab; it is busy only while it is putting something on
      // the screen: codex or Claude waiting at their prompt is open, not busy.
      const running = !!command && !SHELLS.has(command.replace(/^-/, ''));
      const quiet = Math.floor(now() / 1000) - Number(activity);
      const busy = running && Number.isFinite(quiet) && quiet <= BUSY_QUIET_S;
      return {n, cwd: tilde(cwd || ''), busy, running, ...(running ? {command: command.slice(0, 40), title: cleanTitle(title)} : {})};
    }).filter((s) => Number.isInteger(s.n) && s.n >= 1).sort((a, b) => a.n - b.n);
  }

  function alive(c, n) {
    if (platform.isWin || !Number.isInteger(n) || n < 1) return false;
    try { tmux(['has-session', '-t', '=' + nameOf(c, n)]); return true; } catch { return false; }
  }

  function open(c, g) {
    if (platform.isWin) { const e = new Error('Windows 不支援終端機分頁'); e.status = 409; throw e; }
    const taken = new Set(list(c).map((s) => s.n));
    let n = 1;
    while (taken.has(n)) n += 1;
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    const env = agentEnv();
    const home = os.userInfo().homedir;
    // The account's own login shell, as a terminal app opens it.
    const shell = [env.SHELL, os.userInfo().shell, '/bin/zsh', '/bin/bash'].find((s) => s && path.isAbsolute(s) && fs.existsSync(s));
    // A pane takes everything but PATH from the tmux server's environment, which is this
    // client's when it is the one that starts the server: the allowlist, either way.
    tmux(['new-session', '-d', '-s', nameOf(c, n), '-c', home, '-x', '100', '-y', '30', shell, '-l'], {env});
    return {n, cwd: tilde(home), busy: false};
  }

  function close(c, n) {
    if (!alive(c, n)) return false;
    try { tmux(['kill-session', '-t', '=' + nameOf(c, n)]); } catch {}
    return true;
  }

  function closeAll(c) {
    for (const s of list(c)) close(c, s.n);
  }

  // Every shell of every agent at once (shell tabs switched off): the whole shells server goes,
  // whatever any one listing would have missed. No server is nothing to end; any other failure
  // is the caller's to report.
  function killServer() {
    // tmux removes its socket when its server ends, and a server cannot run without one: no
    // socket is no shells.
    if (!fs.existsSync(socket)) return;
    try { tmux(['kill-server']); }
    catch (e) { if (/no server running|error connecting|No such file/i.test(e.stderr || e.message)) return; throw e; }
  }

  const folder = (c, g) => tilde(folderOf(c, g));
  return {socket, available: !platform.isWin, list, alive, open, close, closeAll, killServer, nameOf, folder};
}

module.exports = {create};

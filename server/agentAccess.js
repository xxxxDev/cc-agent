const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// What an agent may reach beyond its own workspace: folders it may use, folders
// carved out of those, folders it may only read, and websites. Set per agent by an admin; the default is
// nothing, the workspace alone. The runner turns it
// into Claude's restricted mode plus the OS sandbox: see SECURITY.md.
const LIMIT = 20;
const fail = (message) => Object.assign(new Error(message), { status: 400 });

// Where CC Agent keeps what no agent may reach: its own code and data (signing
// secrets, every user's conversations, other agents' bridge tokens), and the
// owner's credentials. An allowed folder may not be, or contain, any of these, so
// a folder that holds this repository cannot be granted, and an agent cannot talk
// an admin into it through a report's suggestion. Folders inside them can still be excluded.
// Also the folders of the programs agents are run with (node, claude, tmux: an agent
// that could rewrite them would run its own code as every later agent) and any path
// named in CC_AGENT_PROTECTED_PATHS (channel/runtimeTools.cjs).
const ROOT = path.resolve(__dirname, '..');
const runtimeTools = require('../channel/runtimeTools.cjs');
const unsandboxedCommands = require('../channel/unsandboxedCommands.cjs');
function protectedRoots() {
  const home = os.homedir();
  return [...new Set([ROOT, process.env.AGENT_DATA_DIR || path.join(ROOT, '.local'), process.env.DB_DIR, path.join(home, '.ssh'), path.join(home, '.claude'), path.join(home, '.config'), path.join(home, 'Library', 'Keychains'), ...runtimeTools.toolRoots(), ...runtimeTools.extraProtected()]
    .filter(Boolean).map((p) => path.resolve(p)))];
}
// The protected roots as the disk knows them, kept for a few seconds: every scope read
// checks each of its folders against them, and finding them walks PATH and resolves
// each one (about 5 ms a scope uncached).
let cachedRoots = { at: 0, key: '', roots: [] };
function canonicalRoots() {
  const key = [process.env.PATH, process.env.AGENT_DATA_DIR, process.env.DB_DIR, process.env.CC_AGENT_PROTECTED_PATHS, os.homedir()].join('\0');
  if (cachedRoots.key !== key || Date.now() - cachedRoots.at > 5000) cachedRoots = { at: Date.now(), key, roots: [...new Set(protectedRoots().map((r) => runtimeTools.canonical(r)))] };
  return cachedRoots.roots;
}
// The owner's shell startup files and Claude Code's own settings in the home folder.
const HOME_STARTUP = ['.zshrc', '.zprofile', '.zshenv', '.zlogin', '.zlogout', '.bashrc', '.bash_profile', '.bash_login', '.profile', '.claude', '.claude.json'];
const absolute = (entry) => (entry.startsWith('~') ? path.join(os.homedir(), entry.slice(1)) : entry);
const within = (inner, outer) => inner === outer || inner.startsWith(`${outer}/`);

// Absolute or home-relative, normalised, no "..", never the whole disk.
function folder(value) {
  if (typeof value !== 'string') throw fail('Folders must be text');
  const raw = value.trim();
  if (raw.length > 400 || raw.includes('\0') || !(raw === '~' || raw.startsWith('~/') || raw.startsWith('/'))) {
    throw fail(`A folder must start with / or ~/: ${raw.slice(0, 80)}`);
  }
  // Refused rather than resolved: "~/Desktop/proj/../.." reads as a project and
  // means the whole home directory.
  if (raw.split('/').includes('..')) throw fail(`A folder cannot contain "..": ${raw.slice(0, 80)}`);
  // Claude reads a permission rule's path as a pattern: an excluded folder named with
  // [ ] { } * ? would match nothing, and no escape is honoured.
  if (/[*?[\]{}]/.test(raw)) throw fail(`A folder name cannot contain * ? [ ] { }: ${raw.slice(0, 80)}`);
  // Each folder is written into the agent's CLAUDE.md and scope notice, one to a line in
  // backticks: a line break or a backtick in a name would end it and let the rest read
  // as instructions. Control characters likewise.
  if (/[\x00-\x1f\x7f`]/.test(raw)) throw fail('A folder name cannot contain a line break, a control character or a backtick');
  const home = raw.startsWith('~');
  const rest = path.posix.normalize(home ? `/${raw.slice(1)}` : raw).replace(/\/+$/, '');
  if (!home && !rest) throw fail('The whole disk cannot be granted');
  return (home ? '~' : '') + rest;
}

// What may be granted as an allowed folder: a normalised folder that is not a
// whole home, a whole top-level directory or all volumes, and holds none of
// CC Agent's own data or the owner's credentials.
function allowedFolder(value) {
  const entry = folder(value);
  const abs = path.resolve(absolute(entry));
  // Judged as the disk knows it, so /USERS/Shared is /Users/Shared.
  const real = runtimeTools.canonical(abs), depth = real.split('/').filter(Boolean).length;
  if (depth < 2 || (real.startsWith('/users/') && depth < 3) || real === runtimeTools.canonical(os.homedir())) {
    throw fail(`Too broad to grant: ${entry}. Name the project folder itself.`);
  }
  // A file is not a folder: a startup file granted "as a
  // folder" would be the agent's to write.
  try { if (!fs.statSync(abs).isDirectory()) throw fail(`Not a folder: ${entry}`); } catch (e) { if (e.status) throw e; }
  // The files Claude Code itself reads outside the sandbox when it starts, or starts an
  // agent's commands: the owner's shell startup files and Claude's own settings. An
  // agent that could write one would run what it wrote outside the sandbox.
  if (HOME_STARTUP.some((f) => runtimeTools.inside(abs, path.join(os.homedir(), f)))) throw fail(`A file the shell or Claude reads at start cannot be granted: ${entry}`);
  // Compared as the disk knows them: links followed, case folded (macOS volumes ignore
  // case, so /USERS/ME/.ssh is ~/.ssh).
  for (const root of canonicalRoots()) {
    if (root === '/' || real === root || real.startsWith(root + '/') || root.startsWith(real + '/')) throw fail(`Holds CC Agent's own data or credentials: ${entry}. Name a folder outside it.`);
  }
  return entry;
}

// A host name, optionally with a leading wildcard label. A wildcard must sit on a
// name one organisation owns: *.example.org, not *.co.uk or *.github.io, where
// anyone can have a subdomain.
const SHARED_SUFFIXES = new Set(['github.io', 'githubusercontent.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'appspot.com', 'blogspot.com', 'cloudfront.net', 'amazonaws.com', 'azurewebsites.net', 'onrender.com', 'fly.dev', 'ngrok.io', 'trycloudflare.com']);
function website(value) {
  const host = String(value).trim().toLowerCase();
  if (!/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw fail(`Not a website name: ${host.slice(0, 80)}`);
  if (host.startsWith('*.')) {
    const base = host.slice(2), labels = base.split('.');
    const countrySecondLevel = labels.length === 2 && labels[1].length === 2 && ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'].includes(labels[0]);
    if (labels.length < 2 || countrySecondLevel || SHARED_SUFFIXES.has(base)) throw fail(`Too broad a wildcard: ${host}`);
  }
  return host;
}

// An MCP server the agent may use: its name as in
// its tools' names, mcp__<name>__…, e.g. claude_ai_Example or excel. None by default.
function mcpServer(value) {
  const name = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) || name === 'executive') throw fail(`Not an MCP server name: ${name.slice(0, 80)}`);
  return name;
}

function list(values, each, label) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw fail(`${label} must be a list`);
  const out = [...new Set(values.filter((v) => String(v ?? '').trim()).map(each))];
  if (out.length > LIMIT) throw fail(`At most ${LIMIT} ${label}`);
  return out;
}

function normalize(input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid access');
  return {
    allow: list(input.allow, allowedFolder, 'folders'),
    exclude: list(input.exclude, folder, 'excluded folders'),
    // Folders it may read and never write (what a program
    // run outside the sandbox saves, in a folder of that program's project). Checked as an
    // allowed folder is; agentStore.js refuses one over another folder of the same scope or
    // over a project folder of a program run outside the sandbox (its .env sits there), and
    // the runner keeps it out of every writable list. Present only when some are listed, so
    // every scope stored before reads the same. Only an admin sets them, like the folders.
    ...(() => { const readOnly = list(input.readOnly, allowedFolder, 'read-only folders'); return readOnly.length ? { readOnly } : {}; })(),
    domains: list(input.domains, website, 'websites'),
    // Present only when some are chosen, so every scope stored before reads the same.
    ...(() => { const mcp = list(input.mcp, mcpServer, 'MCP servers'); return mcp.length ? { mcp } : {}; })(),
    // Programs it may run outside the OS sandbox:
    // {program, folder, args}, checked as data here (channel/unsandboxedCommands.cjs)
    // and against the disk when saved and at every launch (agentStore.js); the runner
    // runs each through a wrapper of its own. Present only when some are listed, so every scope stored
    // before reads the same. Only an admin sets them, like the MCP ticks.
    ...(() => { const unsandboxed = unsandboxedCommands.list(input.unsandboxed); return unsandboxed.length ? { unsandboxed } : {}; })(),
    // Full access: no scope at all, the agent runs
    // like the owner's own terminal. Present only when on, so every scope stored
    // before it reads the same. Only on an agent an admin owns, and never in a
    // template (agentStore.js enforces both).
    ...(input.full === true ? { full: true } : {}),
  };
}

// The access an agent runs with. Anything stored that no longer validates falls
// back to the workspace alone rather than to more.
function of(conversation) {
  try { return normalize(conversation?.access); } catch { return normalize({}); }
}

const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

module.exports = { normalize, of, same, allowedFolder, website, mcpServer, protectedRoots, absolute, within, LIMIT };

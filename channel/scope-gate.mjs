// CC Agent's scope gate: a PreToolUse hook Claude Code runs, outside the sandbox and before any
// permission decision, for a scoped agent's WebFetch and MCP tool calls (channel/runner.mjs), in
// place of leaving them to auto mode. It allows a call by
// exiting 0 and refuses one by exiting 2 with the reason on stderr, which Claude Code shows the
// agent; anything that goes wrong refuses (exit 2). A refusal is also written to the agent's
// spool, through channel/scope-hook.sh, so CC Agent files it as a scope report.
//   node scope-gate.mjs <spool> <scope-hook.sh> <rules.json>
// rules.json: {domains: [...], mcp: [...]} as the runner wrote it for this launch.
// WebFetch: the URL's host must be one of the listed websites: "example.com" is that host only,
// "*.example.com" any name under it (not example.com itself). Never, listed or not: an IP
// literal, localhost or a name under .localhost, this machine's own names, or a name that
// resolves (now, here) to a loopback, link-local (169.254.0.0/16, the cloud metadata address,
// fe80::/10), private (10/8, 172.16/12, 192.168/16, 100.64/10, 198.18/15, fc00::/7), multicast,
// reserved or unspecified address, an IPv6 form carrying one of those IPv4 addresses
// (IPv4-mapped, NAT64, 6to4), or one of this machine's own addresses in any of those forms. A
// name that does not resolve is refused. What the gate checks is the address now; Claude Code
// resolves the name again when it fetches.
// MCP: only CC Agent's own executive server and the servers ticked for the agent. A tool's server
// is what lies between "mcp__" and the next "__", as Claude Code names them; a ticked name that
// itself holds "__", or a tool whose name holds another "__" after it, never matches.
// The decision is decide() below, which takes the resolver as a parameter; run as a program, the
// file uses the system's.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import {spawnSync} from 'node:child_process';

const V4_BLOCKED = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) V4_BLOCKED.addSubnet(a, n, 'ipv4');

// An IPv6 address as eight 16-bit numbers (a dotted IPv4 tail included), or null.
function hextets(ip) {
  if (!net.isIPv6(ip)) return null;
  let s = ip;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) { const [a, b, c, d] = tail[1].split('.').map(Number); s = s.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const h = head ? head.split(':') : [], r = rest ? rest.split(':') : [];
  const fill = rest === null ? [] : Array(8 - h.length - r.length).fill('0');
  const all = [...h, ...fill, ...r].map((x) => parseInt(x || '0', 16));
  return all.length === 8 && all.every((x) => x >= 0 && x <= 0xffff) ? all : null;
}
const v4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
// What an address stands for: an IPv4 address (also when carried in an IPv4-mapped, NAT64 or
// 6to4 IPv6 form), an IPv6 one written out in full, or null for one that cannot be read. Kind
// 'blocked' marks IPv6 ranges that never belong to a public website.
export function canonical(addr) {
  const ip = String(addr).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (net.isIPv4(ip)) return {v4: ip};
  const x = hextets(ip);
  if (!x) return null;
  const zero = (n) => x.slice(0, n).every((y) => y === 0);
  if (zero(5) && x[5] === 0xffff) return {v4: v4(x[6], x[7])};                       // ::ffff:0:0/96
  if (zero(6)) return {blocked: true, v6: x.join(':')};                               // ::/96, :: and ::1 too
  if (x[0] === 0x64 && x[1] === 0xff9b && x.slice(2, 6).every((y) => y === 0)) return {v4: v4(x[6], x[7])}; // 64:ff9b::/96
  if (x[0] === 0x64 && x[1] === 0xff9b && x[2] === 1) return {blocked: true, v6: x.join(':')}; // 64:ff9b:1::/48
  if (x[0] === 0x2002) return {v4: v4(x[1], x[2])};                                   // 6to4
  if (x[0] === 0x2001 && (x[1] === 0 || x[1] === 0xdb8)) return {blocked: true, v6: x.join(':')}; // Teredo, documentation
  if ((x[0] & 0xffc0) === 0xfe80 || (x[0] & 0xfe00) === 0xfc00 || (x[0] & 0xff00) === 0xff00) return {blocked: true, v6: x.join(':')};
  return {v6: x.join(':')};
}
const key = (c) => (c.v4 ? 'v4:' + c.v4 : 'v6:' + c.v6);
export function addressBlocked(addr, own = new Set()) {
  const c = canonical(addr);
  if (!c || c.blocked) return true;
  if (own.has(key(c))) return true;
  return c.v4 ? V4_BLOCKED.check(c.v4, 'ipv4') : false;
}
export const ownAddresses = () => new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((x) => canonical(x.address)).filter(Boolean).map(key));
export const ownNames = () => { const h = os.hostname().toLowerCase().replace(/\.$/, ''); const short = h.split('.')[0]; return new Set([h, short, short + '.local', short + '.lan']); };
export async function systemResolve(host, ms = 3000) {
  let t;
  try {
    const got = await Promise.race([dns.lookup(host, {all: true, verbatim: true}), new Promise((_, no) => { t = setTimeout(() => no(new Error('timed out')), ms); })]);
    return got.map((x) => x.address);
  } finally { clearTimeout(t); }
}
const listed = (host, domains) => domains.some((d) => (d.startsWith('*.') ? host.endsWith(d.slice(1)) && host.length > d.length - 1 : host === d));
// Names that belong to a home or office network, never a website to suggest granting.
const LOCAL_SUFFIX = /\.(local|lan|home|internal|intranet|corp|localdomain|private|arpa)$/;
// A tool's server and the rest of its name: the server up to the first "__" after "mcp__", as
// Claude Code names them; a rest that still holds "__" is refused (no server's tool is named so).
const serverOf = (tool) => { const rest = tool.slice(5), i = rest.indexOf('__'); return i > 0 && !rest.slice(i + 2).includes('__') && rest.length > i + 2 ? rest.slice(0, i) : null; };

// The decision for one call: {allow: true} or {why, extra}. env: {resolve(host, ms), own (a set
// from ownAddresses), names (a set from ownNames)}.
export async function decide(payload, rules, env) {
  const tool = String(payload?.tool_name || '');
  if (tool.startsWith('mcp__')) {
    const servers = new Set(['executive', ...(Array.isArray(rules.mcp) ? rules.mcp : [])].map(String).filter((s) => s && !s.includes('__')));
    const server = serverOf(tool);
    if (server && servers.has(server)) return {allow: true};
    return {why: `${tool.slice(0, 120)} is not among this agent's MCP servers`, extra: {kind: 'mcp'}};
  }
  if (tool !== 'WebFetch') return {allow: true};
  const domains = (Array.isArray(rules.domains) ? rules.domains : []).map((d) => String(d).toLowerCase());
  let url;
  try { url = new URL(String(payload?.tool_input?.url || '')); } catch { return {why: 'the address could not be read', extra: {kind: 'web'}}; }
  if (!['http:', 'https:'].includes(url.protocol)) return {why: `${url.protocol} addresses are not reachable from this agent`, extra: {kind: 'web'}};
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const local = (why) => ({why: `${host} ${why}; this agent never reaches it`, extra: {kind: 'web', local: true}});
  if (net.isIP(host)) return local('is an address, not a listed website');
  if (host === 'localhost' || host.endsWith('.localhost') || env.names.has(host)) return local('is this machine');
  if (!listed(host, domains)) {
    // Refused before anything is looked up: resolving a name the agent chose, outside the
    // sandbox, would carry what it puts in the name to whoever answers for it. Suggested for
    // granting by its spelling alone: a name with a dot, not of a home or office network; the
    // server checks where it leads when an admin grants it.
    const suggest = host.includes('.') && !LOCAL_SUFFIX.test(host);
    return {why: `${host} is not one of this agent's websites`, extra: suggest ? {kind: 'web', host} : {kind: 'web', local: true}};
  }
  let addresses;
  try { addresses = await env.resolve(host, 3000); } catch (e) { return {why: `${host} could not be resolved (${String(e?.message).slice(0, 80)})`, extra: {kind: 'web'}}; }
  if (!addresses.length || addresses.some((a) => addressBlocked(a, env.own))) return local('leads to a local, private or own address');
  return {allow: true};
}

async function main() {
  const [spool, hookScript, rulesFile] = process.argv.slice(2);
  let payload = null;
  const refuse = (why, extra = {}) => {
    // Filed as CC Agent's own refusal (scopeHooks classify: hook_event_name PreToolUse with
    // cc_agent_gate), through the hook script so the spool is written as every event is.
    try {
      if (payload && spool && hookScript) spawnSync('/bin/sh', [hookScript, spool, 'pd'], {input: JSON.stringify({...payload, cc_agent_gate: {why, ...extra}}), timeout: 5000, stdio: ['pipe', 'ignore', 'ignore']});
    } catch {}
    process.stderr.write(`CC Agent scope: ${why}\n`);
    process.exit(2);
  };
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { payload = null; refuse('the call could not be read'); }
    let rules;
    try { rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')); } catch { refuse('the scope could not be read'); }
    const d = await decide(payload, rules, {resolve: systemResolve, own: ownAddresses(), names: ownNames()});
    if (d.allow === true) process.exit(0);
    refuse(d.why, d.extra);
  } catch { refuse('the call could not be checked'); }
}
// Run as a program when it is the file node was given (the hook names it by its path); a file
// that imports it (the server's grant check, the tests) gets the functions alone.
if (/(^|[\\/])scope-gate\.mjs$/.test(process.argv[1] || '')) main();

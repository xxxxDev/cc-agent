// A record of why agents go offline (agents still went grey or lost a message
// while the computer was busy, and nothing written down said when or why). Each line of
// agent-monitor.log, beside the audit log and rotated with it, is one JSON object: what CC Agent
// saw or did to an agent (event), or once a minute the computer and every running agent
// (sample). Every line carries the time and the computer's load, so a drop can be read against
// what the machine was doing then. The time is `ts`, as in the audit log, which is what log
// rotation reads from a file's first line. Writing is best effort: a full disk never stops an agent.
const os = require('node:os');
const path = require('node:path');
const {appendPrivateJsonLine} = require('./services/privateFiles');

const FILE = 'agent-monitor.log';
let file = null;
function target() {
  if (!file) file = path.join(path.dirname(require('./services/audit').AUDIT_LOG), FILE);
  return file;
}
// Tests point it elsewhere.
function setFile(f) { file = f; }

function host() {
  const [l1, l5, l15] = os.loadavg();
  return {
    load: [+l1.toFixed(2), +l5.toFixed(2), +l15.toFixed(2)],
    cpus: os.cpus().length,
    freeMb: Math.round(os.freemem() / 1048576),
    uptimeS: Math.round(os.uptime()),
  };
}
// Busy beyond what the cores carry: the one-minute load over the number of cores.
function overloaded(factor = 1) {
  const cpus = os.cpus().length || 1;
  return os.loadavg()[0] > cpus * factor;
}

function write(line) {
  try { appendPrivateJsonLine(target(), {ts: new Date().toISOString(), ...line, host: host()}); }
  catch {}
}
// What CC Agent saw happen to one agent. c is the conversation, g its current run.
function event(type, c, g, extra = {}) {
  const now = Date.now();
  write({
    kind: 'event', type,
    agent: c?.id, title: c?.title,
    ...(g ? {
      phase: g.phase, ready: !!g.ready,
      heartbeatAgeS: g.heartbeat ? Math.round((now - g.heartbeat) / 1000) : null,
      pollAgeS: g.lastPoll ? Math.round((now - g.lastPoll) / 1000) : null,
      runAgeS: g.launchedAt ? Math.round((now - g.launchedAt) / 1000) : null,
    } : {}),
    ...extra,
  });
}
// Once a minute: every agent that should be running, in a few fields each.
function sample(agents) {
  write({kind: 'sample', agents});
}

module.exports = {event, sample, overloaded, host, setFile, FILE};

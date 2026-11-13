// Generic service start. The product's launcher (scripts/start.mjs) sets its environment and data up, seeds
// what it seeds, then calls startService(). What the product runs beside the web
// service it starts in `product(server)`.
const path = require('node:path');

// app: the Express app. port: servicePort() of siteConfig.js; it listens on this
// machine only (the tunnel or a proxy brings the public address here).
// onListening(server): what is said once it listens.
// product(server): starts what the product runs beside it and returns
//   { stop(): ms to give it before the process ends (0: none), finish() }, or nothing.
// live: options for installLiveUpdates; a product without agentStore.js passes its own agents.
// exit: process.exit unless the caller passes its own. Returns { server, stop }.
const STOP_GRACE_MS = 3000;

function startService({ app, port, live: liveOptions = {}, onListening = () => {}, product = () => null, exit = (code) => process.exit(code), signals = ['SIGINT', 'SIGTERM'] }) {
  const server = app.listen(port, '127.0.0.1', () => onListening(server));
  server.on('error', (error) => { console.error(error.message); exit(1); });
  // The audit logs beside this instance's own (services/audit.js) are moved to
  // archive/ once their first line is a week old, and kept a year: at start, then
  // daily. A move is a rename, so even a large first one takes no time.
  const stopLogRotation = require('./services/logRotation').startLogRotation({ logsDir: path.dirname(require('./services/audit').AUDIT_LOG) });
  const own = product(server) || {};
  // Which build is served and who is there, to open pages (liveUpdates.js).
  const live = require('./liveUpdates').installLiveUpdates(server, liveOptions);
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    stopLogRotation();
    // stop() gives the time it asks for, or a promise of it: the process leaves only once that
    // promise is settled (within the grace period below).
    let wait = 0, ready = Promise.resolve();
    try {
      const asked = own.stop?.();
      if (asked && typeof asked.then === 'function') ready = Promise.resolve(asked).then((w) => { wait = Number(w) || 0; }, (error) => console.error('stopping:', error.message));
      else wait = Number(asked) || 0;
    } catch (error) { console.error('stopping:', error.message); }
    live.close();
    let left = false;
    const leave = () => { if (left) return; left = true; try { own.finish?.(); } catch {} exit(0); };
    // What the product asked time for has it, twice over at most if the server
    // does not close. Whatever it asked, a request or a socket that hangs on gets
    // STOP_GRACE_MS, then is cut, so the process ends here and not by launchd's
    // SIGKILL, which would lose what finish() still writes (a hung request kept an old stop() running past ten seconds).
    // A promise from stop() that does not settle is waited for STOP_GRACE_MS at most.
    const settled = Promise.race([ready, new Promise((r) => setTimeout(r, STOP_GRACE_MS).unref?.())]);
    settled.then(() => setTimeout(() => { try { server.closeAllConnections?.(); } catch {} leave(); }, Math.max(wait * 2, STOP_GRACE_MS)).unref?.());
    server.close(() => settled.then(() => (wait ? setTimeout(leave, wait) : leave())));
  }
  for (const signal of signals) process.on(signal, stop);
  return { server, stop };
}

module.exports = { startService };

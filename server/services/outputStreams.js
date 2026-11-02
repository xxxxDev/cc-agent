// stdout and stderr can be files, and a file can stop taking writes when the disk is full.
// Node then raises an error event on the stream, and with no listener that ends the
// process: the service stopped because it could not write a log line (security audit,
// 2026-11-03; seen on a full disk 2026-11-02). Losing a log line is the smaller loss.
function keepOutputErrorsQuiet(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) stream.on('error', () => {});
}
module.exports = { keepOutputErrorsQuiet };

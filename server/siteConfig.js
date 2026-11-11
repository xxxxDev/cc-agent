// Where this CC Agent is reached, in one place: every check that trusts a Host or an
// Origin reads the public address and the port from here.
//
// Set CC_AGENT_PUBLIC_ORIGIN (the HTTPS address people open) and, if needed,
// CC_AGENT_PORT; unset, they are the placeholders below. Passkeys belong to the public
// address, so changing it later makes every registered passkey stop working.
const DEFAULT_ORIGIN = 'https://cc-agent.example.com';
const DEFAULT_PORT = 4280;

// What else is this product's own: a product built on this code sets these values
// here, and the generic files read them from here. The labels below are
// mixed into what is stored, so each keeps the value it had when the data was made:
// a different push label leaves every saved subscription unreadable, a different
// two-step label every authenticator secret, a different recovery label every
// recovery code. They are not to be changed.
const PRODUCT = Object.freeze({
  name: 'CC Agent',
  // pushCrypto.js: the AES-GCM additional data of a stored push subscription.
  pushEncryptionLabel: 'cc-agent:web-push-subscription:v1',
  // twoStep.js: the name an authenticator app shows, the key the secrets are sealed
  // with, and what a recovery code is hashed with.
  twoStepIssuer: 'CC Agent',
  twoStepKeyLabel: 'cc-agent two-step',
  recoveryCodeLabel: 'cc-agent recovery',
  // app.js: sources a page may use beyond this origin, by CSP directive. None here.
  cspExtraSources: Object.freeze({}),
  // The names of this product's environment settings that generic files read: the
  // audit log's path (services/audit.js), a scratch instance's passkey origin
  // (middlewares/requestGuards.js), its build folder (app.js) and the data folder
  // the sign-in rescue writes to (scripts/sign-in-rescue.mjs).
  env: Object.freeze({
    auditLog: 'CC_AGENT_AUDIT_LOG',
    passkeyDevOrigin: 'CC_AGENT_PASSKEY_DEV_ORIGIN',
    // Set to 1 while developing (the vite dev server, a scratch instance).
    dev: 'CC_AGENT_DEV',
    distDir: 'CC_AGENT_DIST_DIR',
    // scripts/sign-in-rescue.mjs: the data folder, else .local under the project.
    dataDir: 'CC_AGENT_DATA_DIR',
  }),
  // scripts/sign-in-rescue.mjs: where this product's running server keeps its account
  // database when neither DB_DIR nor the data-folder setting is given, from the project's
  // root (scripts/start.mjs sets DB_DIR to <data folder>/auth). The rescue note goes
  // beside it, where authController's applySignInRescue reads it.
  accountDbDir: '.local/auth',
  // The start of folder names a process other than the service writes in under the
  // system's temporary folder (services/audit.js, services/securityLog.js):
  // `${tempPrefix}-audit-<pid>`.
  tempPrefix: 'cc-agent',
  // services/securityLog.js, stored data: the folder it is kept in (the one the
  // environment setting dirEnv names), its file, and the label account names are hashed
  // with. The label and the file are not to be changed. (No path module here:
  // vite.config.js may bundle this file.)
  securityLog: Object.freeze({
    dirEnv: 'AGENT_DATA_DIR',
    file: 'security-log.json',
    nameHashLabel: 'security-log-names',
  }),
  // services/pushKeyRotationMigration.js, stored data: the schema a push-key backup
  // manifest is written and read with.
  pushKeyBackupSchema: 'cc-agent.push-key-rotation-backup.v1',
});
// A scratch instance (a second copy of the service, with its own data folder and build)
// and the vite dev server, while developing.
const SCRATCH_PORT = 4281, DEV_PORT = 4279;
// Their ports are trusted only while developing: CC_AGENT_DEV=1 and NODE_ENV not
// production. Otherwise any program on this machine that serves a page on one of those
// ports would be a trusted origin: credentialed CORS, the CSRF cookie read back, the
// account's own actions taken in its name.
const devMode = () => process.env[PRODUCT.env.dev] === '1' && process.env.NODE_ENV !== 'production';
const devPorts = () => (devMode() ? [SCRATCH_PORT, DEV_PORT] : []);

function servicePort() {
  const raw = process.env.CC_AGENT_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error('CC_AGENT_PORT must be a port from 1 to 65535');
  return Number(raw);
}

// An HTTPS origin and nothing else: no path, no user, no query.
function publicOrigin() {
  const raw = process.env.CC_AGENT_PUBLIC_ORIGIN || DEFAULT_ORIGIN;
  let url;
  try { url = new URL(raw); } catch { throw new Error('CC_AGENT_PUBLIC_ORIGIN must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw !== url.origin) {
    throw new Error('CC_AGENT_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  // A public name, not this machine: such an address would be given HSTS and passkeys.
  const name = url.hostname.replace(/\.$/, '');
  if (/^(localhost|\[.*\]|\d+\.\d+\.\d+\.\d+)$/i.test(name) || name.endsWith('.localhost')) {
    throw new Error('CC_AGENT_PUBLIC_ORIGIN must be a public host name, not localhost or an IP address');
  }
  return url.origin;
}
const publicHost = () => new URL(publicOrigin()).host;

// Loopback ports a request may name as its Host: the service, and while developing a
// scratch instance.
const loopbackPorts = () => [...new Set([servicePort(), ...(devMode() ? [SCRATCH_PORT] : [])])];
const loopbackHosts = (ports) => ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]);

// The Host header a request may carry. Anything else is refused (app.js).
const isAllowedHost = (host) => typeof host === 'string' && (host === publicHost() || loopbackHosts(loopbackPorts()).includes(host));
// A TLS-terminating proxy or tunnel forwards plain HTTP, so the public Host says HTTPS.
const isHttpsHost = (host) => host === publicHost();

// The pages a live-update or terminal socket may come from: the public address, and on
// this machine the service, the vite dev server and a scratch instance.
const socketOrigins = () => new Set([publicOrigin(), ...loopbackHosts([...new Set([servicePort(), ...devPorts()])]).map((h) => 'http://' + h)]);
// Both the Origin and the Host are checked, the Host as the page would have named it.
const isAllowedSocket = (req) => {
  const origins = socketOrigins(), host = req.headers.host;
  return origins.has(req.headers.origin) && origins.has((isHttpsHost(host) ? 'https://' : 'http://') + host);
};

module.exports = { PRODUCT, DEV_PORT, SCRATCH_PORT, devMode, devPorts, servicePort, publicOrigin, publicHost, loopbackPorts, isAllowedHost, isHttpsHost, socketOrigins, isAllowedSocket };

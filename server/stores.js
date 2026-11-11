const Datastore = require('@seald-io/nedb');
const path = require('path');
const { privateDatastoreOptions } = require('./services/privateFiles');

// DB_DIR: two processes autoloading the same NeDB files race each other's
// crash-safe compaction (.db~ create/rename) into ENOENT, so each process names
// its own folder here. scripts/start.mjs sets it to <data folder>/auth; without
// it, server/db is used.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'db');

function datastore(filename) {
  return new Datastore(privateDatastoreOptions(path.join(DB_DIR, filename)));
}

// Shared NeDB instances — required by both the auth controller and the
// auth middleware (verifyToken checks live sessions, not just JWT validity).
const usersDB = datastore('users.db');
const sessionsDB = datastore('sessions.db');
const userLifecycleTransitionsDB = datastore('user-lifecycle-transitions.db');


const pushSubscriptionsDB = datastore('push-subscriptions.db');
const pushPreferencesDB = datastore('push-preferences.db');
const pushDeliveriesDB = datastore('push-deliveries.db');
// Phones bound as login keys for QR sign-in (server/services/qrLogin.js).
const loginDevicesDB = datastore('login-devices.db');
// Passkeys: the public half of each (server/services/passkeys.js).
const passkeysDB = datastore('passkeys.db');

// Periodic cleanup: logout only removes the current token's row, so sessions
// that lapse by idle-timeout are never deleted and would accumulate over time
// (more so now that sessions can live up to the 15-day sliding window). Sweep
// expired rows shortly after boot and hourly to keep the store bounded — this
// also catches abandoned sessions a pure clean-on-read would miss.
function sweepExpiredSessions() {
  sessionsDB.remove({ expiresAt: { $lt: new Date() } }, { multi: true }, (err, removed) => {
    if (err) return;
    if (removed > 0) {
      require('./services/compactQuietly').compactQuietly(sessionsDB, 'sessions');
      console.log(`[session-sweep] removed ${removed} expired session row(s)`);
    }
  });
}
const initialSweep = setTimeout(sweepExpiredSessions, 10 * 1000);
const recurringSweep = setInterval(sweepExpiredSessions, 60 * 60 * 1000);
initialSweep.unref();
recurringSweep.unref();

module.exports = { loginDevicesDB, passkeysDB,
  usersDB,
  sessionsDB,
  userLifecycleTransitionsDB,
  pushSubscriptionsDB,
  pushPreferencesDB,
  pushDeliveriesDB,
};

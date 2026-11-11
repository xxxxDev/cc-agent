const crypto = require('node:crypto');

// A session row keeps a SHA-256 of its token, never the token. Kept in the clear,
// any copy of sessions.db — a backup, a data directory carried to another host —
// would be a working login for everyone in it. The token is a signed, high-entropy JWT, so a
// plain hash is enough; nothing here needs to be slow.
function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { hashSessionToken };

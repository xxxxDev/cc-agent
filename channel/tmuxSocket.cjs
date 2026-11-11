// The tmux server an installation's agents run in: one per data folder, so a second
// CC Agent on the same account (a scratch copy while developing) can never reach another one's
// agents. The private state root is canonicalized, so symlink aliases of the same
// instance still agree.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
module.exports = function tmuxSocket(stateRoot) {
  if (typeof stateRoot !== 'string' || !stateRoot) throw new Error('Agent state root is required');
  let root = path.resolve(stateRoot);
  try { root = fs.realpathSync.native(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return 'cc-agent-' + createHash('sha256').update(root).digest('hex').slice(0, 16);
};

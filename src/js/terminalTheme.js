// This computer's terminal theme (server/terminalTheme.js), asked for once per page: every
// terminal pane paints with it, so a shell's colours are the terminal app's. None (not a
// Mac, not readable): the pane keeps its own.
import {api} from './api.js';
let asked = null;
export function terminalTheme() {
  if (!asked) asked = api('/preferences/terminal-theme').then((r) => r?.theme || null).catch(() => { asked = null; return null; });
  return asked;
}

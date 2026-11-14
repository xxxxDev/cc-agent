// The web terminal follows this computer's own terminal theme: the colours of
// Terminal.app's default profile, read from its settings, so a shell's colours match the
// terminal app's. ls and zsh send colour codes; each terminal paints them from its own
// palette, and xterm's default one is not the one the terminal app uses.
// macOS only; anywhere else, or if the settings cannot be read, there is none and the
// page keeps its own. Read off the main thread, at most once a minute.
const {execFile} = require('node:child_process');

const KEYS = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
// JavaScript for Automation: the profile's colours are archived NSColor objects, which
// only AppKit can read.
const SCRIPT = `ObjC.import('AppKit');
const d=$.NSUserDefaults.alloc.initWithSuiteName('com.apple.Terminal');
const name=ObjC.unwrap(d.stringForKey('Default Window Settings'));
const all=d.dictionaryForKey('Window Settings');
const p=name&&!all.isNil()?all.objectForKey(name):$();
const out={name:name||''};
if(p&&!p.isNil()){const keys=ObjC.deepUnwrap(p.allKeys)||[];
 for(const k of keys){if(!/Color$/.test(k)&&k!=='Font')continue;
  const o=$.NSKeyedUnarchiver.unarchiveObjectWithData(p.objectForKey(k));if(!o||o.isNil())continue;
  if(k==='Font'){out.fontSize=Number(o.pointSize);continue;}
  const c=o.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);if(!c||c.isNil())continue;
  out[k]=[c.redComponent,c.greenComponent,c.blueComponent];}}
JSON.stringify(out);`;

const hex = (rgb) => Array.isArray(rgb) && rgb.length === 3 && rgb.every((x) => Number.isFinite(x))
  ? '#' + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('') : undefined;

// The profile as xterm.js takes a theme; only the colours the profile has.
function toTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const theme = {background: hex(raw.BackgroundColor), foreground: hex(raw.TextColor), cursor: hex(raw.CursorColor), selectionBackground: hex(raw.SelectionColor)};
  for (const [i, k] of KEYS.entries()) {
    theme[k.toLowerCase()] = hex(raw['ANSI' + k + 'Color']);
    theme['bright' + k] = hex(raw['ANSIBright' + k + 'Color']);
  }
  for (const k of Object.keys(theme)) if (!theme[k]) delete theme[k];
  if (!Object.keys(theme).length) return null;
  const fontSize = Number.isFinite(raw.fontSize) && raw.fontSize >= 8 && raw.fontSize <= 32 ? Math.round(raw.fontSize) : undefined;
  return {name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '', theme, ...(fontSize ? {fontSize} : {})};
}

function create({platform = process.platform, run = execFile, ttlMs = 60000} = {}) {
  let cached = null, at = 0, pending = null;
  return function read() {
    if (platform !== 'darwin') return Promise.resolve(null);
    if (Date.now() - at < ttlMs) return Promise.resolve(cached);
    if (pending) return pending;
    pending = new Promise((resolve) => {
      run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], {timeout: 5000, maxBuffer: 65536}, (err, stdout) => {
        let theme = null;
        if (!err) { try { theme = toTheme(JSON.parse(String(stdout).trim())); } catch {} }
        cached = theme; at = Date.now(); pending = null; resolve(theme);
      });
    });
    return pending;
  };
}

module.exports = {create, toTheme};

// The owner's Claude Code plugins, as a scoped agent's launch sees them (channel/runner.mjs). A
// tool a plugin registers is listed as mcp__<plugin>__<tool> and, as seen on a run with a mod's
// tool, never reaches a PreToolUse hook, so CC Agent's
// scope gate cannot hold it. A scoped agent gets none of them: the runner switches each installed
// or enabled one off by its id (enabledPlugins false), empties the plugin folders named in the
// environment (CLAUDE_CODE_PLUGIN_DIRS), and denies by name every plugin's tools, the tools of the
// MCP servers a plugin brings, and every MCP server set up on this computer that was not ticked.
// Read here: installed plugins (plugins/installed_plugins.json, and each one's folder), the
// plugins the user's settings enable, a plugin folder under skills/ or a mods folder (dev-mods/),
// and the folders CLAUDE_CODE_PLUGIN_DIRS names (the environment, or the user's settings' env),
// all under the owner's Claude folder. One kept anywhere else, or made after the launch, is not
// known here and so not denied by name.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
const list = (dir) => { try { return fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch { return []; } };
// How Claude Code spells a server's name in a tool's name.
export const toolLabel = (n) => String(n).replace(/[^A-Za-z0-9_-]/g, '_');

// home: the owner's home folder; mcpServers: ~/.claude.json's; ticked: the agent's MCP list;
// envDirs: CLAUDE_CODE_PLUGIN_DIRS as the runner's own environment has it; projectDirs: the
// workspace and the granted folders, whose .mcp.json servers are denied too unless ticked.
export function ownerPlugins({home, mcpServers = {}, ticked = [], envDirs, projectDirs = []} = {}) {
  const claudeDir = path.join(home || '', '.claude');
  const ids = new Set(), names = new Set(), servers = new Set();
  const fromFolder = (dir) => {
    const j = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
    if (!j || typeof j.name !== 'string' || !j.name) return;
    names.add(j.name);
    const inner = {...(j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {}), ...(readJson(path.join(dir, '.mcp.json'))?.mcpServers || {})};
    for (const s of Object.keys(inner)) servers.add(`plugin_${toolLabel(j.name)}_${toolLabel(s)}`);
  };
  const installed = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  for (const [id, v] of Object.entries(installed?.plugins && typeof installed.plugins === 'object' ? installed.plugins : {})) {
    if (!id.includes('@')) continue;
    ids.add(id); names.add(id.split('@')[0]);
    for (const e of [].concat(v || [])) if (e && typeof e.installPath === 'string') fromFolder(e.installPath);
  }
  const userSettings = readJson(path.join(claudeDir, 'settings.json')) || {};
  for (const id of Object.keys(userSettings.enabledPlugins && typeof userSettings.enabledPlugins === 'object' ? userSettings.enabledPlugins : {})) if (id.includes('@')) { ids.add(id); names.add(id.split('@')[0]); }
  for (const d of list(path.join(claudeDir, 'skills'))) fromFolder(d);
  for (const s of list(path.join(claudeDir, 'dev-mods'))) for (const d of list(s)) fromFolder(d);
  for (const d of [envDirs, userSettings.env?.CLAUDE_CODE_PLUGIN_DIRS].filter((x) => typeof x === 'string').flatMap((x) => x.split(path.delimiter)).filter(Boolean)) fromFolder(d.replace(/^~(?=\/|$)/, home || ''));
  for (const s of Object.keys(mcpServers && typeof mcpServers === 'object' ? mcpServers : {})) servers.add(toolLabel(s));
  for (const d of projectDirs) for (const s of Object.keys(readJson(path.join(d, '.mcp.json'))?.mcpServers || {})) servers.add(toolLabel(s));
  const keep = new Set(['executive', 'cc-agent', ...ticked.map(String)]);
  const labels = [...new Set([...[...names].map(toolLabel), ...servers])].filter((n) => n && !keep.has(n));
  return {ids: [...ids].sort(), labels: labels.sort()};
}

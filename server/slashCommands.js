// Slash commands typed in the conversation's composer ("/m" in the terminal offers /mcp; the chat should too).
//
// Claude Code's own commands only run when typed into its terminal, so these go to
// the agent's tmux pane, and what they print stays there. Only the ones listed
// here: the rest end the process (/exit), start or switch a session the agent is
// tracked by (/clear, /resume, /fork, /cd), sign the account out, or change what
// the Agent Profile owns (/model, /effort). Names and arguments are those of
// Claude Code 2.1.277. Skills are different: the model runs them itself when a
// message names one, so they travel as ordinary messages and answer in the chat
// (transcript.skills lists the agent's own).
const TERMINAL = [
  {name: 'compact', hint: '[整理重點]', description: '整理對話記憶（compact）'},
  {name: 'context', description: '顯示 context 使用量'},
  {name: 'usage', aliases: ['cost', 'stats'], description: '用量、費用與方案額度'},
  // Options offered one level at a time after the command, as in the terminal; `then: 'servers'` goes on to this agent's MCP servers.
  {name: 'mcp', hint: '[reconnect|enable|disable <server>]', description: '管理 MCP servers', interactive: true, options: [
    {value: 'reconnect', description: '重新連線一個 MCP server', then: 'servers'},
    {value: 'enable', description: '啟用一個 MCP server', then: 'servers'},
    {value: 'disable', description: '停用一個 MCP server', then: 'servers'},
  ]},
  {name: 'status', description: '版本、模型、帳號與連線狀態', interactive: true},
  // Not typed into the terminal: it opens the login card (claudeLogin.js).
  {name: 'login', description: '重新登入 Claude（整台電腦的 agent 共用）'},
  // Its settings and their values as the terminal lists them after /config and
  // /config key= (Claude Code 2.1.282, read off the terminal).
  {name: 'config', aliases: ['settings'], hint: '[key=value]', description: 'Claude Code 設定', interactive: true, options: [
    {value: "agentPushNotifEnabled=", description: "true | false", values: ["agentPushNotifEnabled=true", "agentPushNotifEnabled=false"]},
    {value: "artifacts=", description: "true | false", values: ["artifacts=true", "artifacts=false"]},
    {value: "autoCompact=", description: "true | false", values: ["autoCompact=true", "autoCompact=false"]},
    {value: "autoConnectIde=", description: "true | false", values: ["autoConnectIde=true", "autoConnectIde=false"]},
    {value: "autoScroll=", description: "true | false", values: ["autoScroll=true", "autoScroll=false"]},
    {value: "checkpoints=", description: "true | false", values: ["checkpoints=true", "checkpoints=false"]},
    {value: "chrome=", description: "true | false", values: ["chrome=true", "chrome=false"]},
    {value: "copyFullResponse=", description: "true | false", values: ["copyFullResponse=true", "copyFullResponse=false"]},
    {value: "copyOnSelect=", description: "true | false", values: ["copyOnSelect=true", "copyOnSelect=false"]},
    {value: "defaultToAgentsView=", description: "true | false", values: ["defaultToAgentsView=true", "defaultToAgentsView=false"]},
    {value: "editor=", description: "normal | vim", values: ["editor=normal", "editor=vim"]},
    {value: "externalEditorContext=", description: "true | false", values: ["externalEditorContext=true", "externalEditorContext=false"]},
    {value: "feedbackDrafts=", description: "notify | quiet | off", values: ["feedbackDrafts=notify", "feedbackDrafts=quiet", "feedbackDrafts=off"]},
    {value: "gitignore=", description: "true | false", values: ["gitignore=true", "gitignore=false"]},
    {value: "inputNeededNotifEnabled=", description: "true | false", values: ["inputNeededNotifEnabled=true", "inputNeededNotifEnabled=false"]},
    {value: "leftArrowOpensAgents=", description: "true | false", values: ["leftArrowOpensAgents=true", "leftArrowOpensAgents=false"]},
    {value: "model=", description: "default | sonnet | opus | haiku", values: ["model=default", "model=sonnet", "model=opus", "model=haiku"]},
    {value: "notifChannel=", description: "auto | iterm2 | terminal_bell | iterm2_with_bell", values: ["notifChannel=auto", "notifChannel=iterm2", "notifChannel=terminal_bell", "notifChannel=iterm2_with_bell"]},
    {value: "outputStyle=", description: "default | Proactive | Concise | Explanatory", values: ["outputStyle=default", "outputStyle=Proactive", "outputStyle=Concise", "outputStyle=Explanatory"]},
    {value: "permissionMode=", description: "default | plan | acceptEdits | auto", values: ["permissionMode=default", "permissionMode=plan", "permissionMode=acceptEdits", "permissionMode=auto"]},
    {value: "progressBar=", description: "true | false", values: ["progressBar=true", "progressBar=false"]},
    {value: "promptSuggestionEnabled=", description: "true | false", values: ["promptSuggestionEnabled=true", "promptSuggestionEnabled=false"]},
    {value: "prStatus=", description: "true | false", values: ["prStatus=true", "prStatus=false"]},
    {value: "recap=", description: "true | false", values: ["recap=true", "recap=false"]},
    {value: "reduceMotion=", description: "true | false", values: ["reduceMotion=true", "reduceMotion=false"]},
    {value: "remoteControl=", description: "true | false | default", values: ["remoteControl=true", "remoteControl=false", "remoteControl=default"]},
    {value: "switchModelsOnFlag=", description: "Switch automatically | Ask each time", values: ["switchModelsOnFlag=Switch automatically", "switchModelsOnFlag=Ask each time"]},
    {value: "theme=", description: "auto | dark | light | light-daltonized", values: ["theme=auto", "theme=dark", "theme=light", "theme=light-daltonized"]},
    {value: "thinking=", description: "true | false", values: ["thinking=true", "thinking=false"]},
    {value: "timeFormat=", description: "auto | 12-hour | 24-hour | 24-hour-utc", values: ["timeFormat=auto", "timeFormat=12-hour", "timeFormat=24-hour", "timeFormat=24-hour-utc"]},
    {value: "tips=", description: "true | false", values: ["tips=true", "tips=false"]},
    {value: "turnDuration=", description: "true | false", values: ["turnDuration=true", "turnDuration=false"]},
    {value: "useAutoModeDuringPlan=", description: "true | false", values: ["useAutoModeDuringPlan=true", "useAutoModeDuringPlan=false"]},
    {value: "verbose=", description: "true | false", values: ["verbose=true", "verbose=false"]},
    {value: "workflowKeywordTriggerEnabled=", description: "true | false", values: ["workflowKeywordTriggerEnabled=true", "workflowKeywordTriggerEnabled=false"]},
    {value: "workflows=", description: "true | false", values: ["workflows=true", "workflows=false"]},
    {value: "workflowSizeGuideline=", description: "unrestricted | small | medium | large", values: ["workflowSizeGuideline=unrestricted", "workflowSizeGuideline=small", "workflowSizeGuideline=medium", "workflowSizeGuideline=large"]},
    {value: "worktreeBaseRef=", description: "fresh | head", values: ["worktreeBaseRef=fresh", "worktreeBaseRef=head"]},
  ]},
  {name: 'permissions', description: '工具權限規則', interactive: true},
  {name: 'hooks', description: '查看 hooks 設定', interactive: true},
  {name: 'skills', description: '列出可用的 skills', interactive: true},
  // The options Claude Code 2.1.282's own terminal offers after /plugin, read off
  // it by typing each one; installed plugins and marketplaces are this
  // machine's.
  {name: 'plugin', hint: '[list|enable|disable|install|uninstall|marketplace|stats]', description: '管理外掛', interactive: true, options: [
    {value: 'list', description: 'List installed plugins', next: [{value: '--enabled', description: 'Only show enabled plugins'}, {value: '--disabled', description: 'Only show disabled plugins'}]},
    {value: 'enable', description: 'Enable an installed plugin', then: 'plugins'},
    {value: 'disable', description: 'Disable an installed plugin', then: 'plugins'},
    {value: 'install', description: 'Install a plugin from a marketplace', then: 'catalog'},
    {value: 'uninstall', description: 'Remove an installed plugin', then: 'plugins'},
    {value: 'marketplace', description: 'Manage plugin marketplaces', next: [
      {value: 'add', description: 'Add a marketplace from a URL or path'},
      {value: 'remove', description: 'Remove a known marketplace', then: 'marketplaces'},
      {value: 'update', description: 'Refresh a marketplace from its source', then: 'marketplaces'},
      {value: 'list', description: 'List known marketplaces'}]},
    {value: 'stats', description: 'Show skill usage and context costs'},
  ]},
  {name: 'reload-plugins', description: '套用外掛變更'},
  {name: 'reload-skills', description: '重新載入磁碟上的 skills'},
  {name: 'skill-doctor', description: '找出沒用到、佔 context 的 skills'},
  {name: 'tasks', description: '背景工作', interactive: true},
  {name: 'diff', description: '未提交的變更與每輪的差異', interactive: true},
  {name: 'recap', description: '產生一行本 session 摘要'},
  {name: 'btw', hint: '<問題>', description: '順便問一個小問題，不打斷目前工作'},
  {name: 'goal', hint: '[條件 | clear]', description: '設定完成條件，達成前 Claude 不停', options: [{value: 'clear', description: '清除目前的完成條件'}]},
  {name: 'export', hint: '[檔名]', description: '匯出這段對話'},
  {name: 'output-style', hint: '[style]', description: '切換輸出風格'},
  {name: 'help', description: 'Claude Code 說明與指令', interactive: true},
];
// Skills whose arguments Claude Code's terminal offers as a list after the name
// (read off 2.1.282's terminal): only its built-in claude-api does.
const SKILL_OPTIONS = {
  'claude-api': ['cost-optimize', 'migrate', 'managed-agents-onboard', 'prompt-audit', 'upgrade', 'build-eval', 'hillclimb', 'preserved-thinking-migration'].map(value => ({value, description: ''})),
};
const byName = new Map();
for (const command of TERMINAL) for (const name of [command.name, ...(command.aliases || [])]) byName.set(name, command);

const MAX_ARGS = 300;
// One line: "/name" and, for a command that takes them, its arguments. Nothing
// that could reach the terminal as a key of its own.
const SHAPE = /^\/([a-z][a-z0-9-]*)(?:[ \t]+([^\n\r]*))?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

// The command a draft asks for, or null when it is not one of these (a path such
// as /Users/… or a skill is a message, not a terminal command).
function resolve(text) {
  const match = SHAPE.exec(String(text || '').trim());
  if (!match) return null;
  const command = byName.get(match[1]);
  if (!command) return null;
  const args = (match[2] || '').trim();
  if (args && (!command.hint || args.length > MAX_ARGS || CONTROL.test(args))) return null;
  return {name: command.name, args, text: '/' + command.name + (args ? ' ' + args : ''), interactive: !!command.interactive};
}

const list = () => TERMINAL.map(({name, aliases, hint, description, interactive, options}) => ({name, aliases: aliases || [], hint: hint || '', description, interactive: !!interactive, options: options || []}));

module.exports = {resolve, list, SKILL_OPTIONS};

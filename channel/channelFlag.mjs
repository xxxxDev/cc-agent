// Whether the Claude that started the channel server loaded the channel, from its command line
// (channel/server.mjs). Claude Code's /restart (2.1.325) starts it again in the same process
// without the flag. Not knowing is taken as loaded: no command
// line, one that is not Claude's, or one that does not show its options (Claude Code under Node
// sets its process title to "claude", and ps then shows that word alone). CC Agent always starts it with --mcp-config, which /restart keeps.
export function channelLoaded(argv) {
  if (typeof argv !== 'string' || !/claude/i.test(argv) || !/--mcp-config\b/.test(argv)) return true;
  return /--dangerously-load-development-channels\b|--channels\b/.test(argv);
}

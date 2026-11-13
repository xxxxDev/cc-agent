# CC Agent's scope gate, the shell in front of channel/scope-gate.mjs: a call to CC Agent's own
# executive server goes through at once (most MCP calls are its, and node would cost each one
# tens of milliseconds); every other call the hook is given goes to the gate, which decides.
#   /bin/sh scope-gate.sh <node> <scope-gate.mjs> <spool> <scope-hook.sh> <rules.json>
# Anything that goes wrong refuses (exit 2): this hook never lets a call through by failing.
PATH=/usr/bin:/bin
LC_ALL=C
export PATH LC_ALL
# Only the call's first 2 KiB is looked at here (Claude Code's own fields come first, tool_name
# among them); matching in the shell takes time that grows with the square of what it reads, and
# what the agent puts in a call is not bounded. dd reads no further than asked; if this dd cannot
# (no iflag=fullblock), nothing is looked at and the gate reads the whole call.
h=$(dd bs=2048 count=1 iflag=fullblock 2>/dev/null && printf x) || h=
t=
case $h in
  *x)
    h=${h%x}
    # A quote inside any string is escaped, so "tool_name": can only be a key. The first one is
    # Claude Code's own field when nothing before it is the tool's input (an MCP tool's input may
    # have a key of that name); otherwise the gate decides.
    t=${h#*\"tool_name\":\"}
    [ "$t" = "$h" ] && t=${h#*\"tool_name\": \"}
    [ "$t" = "$h" ] && t=
    case ${h%%\"tool_name\"*} in *\"tool_input\"*) t= ;; esac
    ;;
  *) h= ;;
esac
# The tool's name ends at the next quote; the executive server's tool, whose name holds no other
# "__", passes here, as the gate would pass it.
n=${t%%\"*}
r=${n#mcp__executive__}
case $n in mcp__executive__?*) case $r in *__*) ;; *) cat >/dev/null 2>&1; exit 0 ;; esac ;; esac
{ printf '%s' "$h"; cat; } | "$1" "$2" "$3" "$4" "$5"
s=$?
[ "$s" -eq 0 ] && exit 0
exit 2

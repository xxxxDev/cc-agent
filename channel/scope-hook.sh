# CC Agent's scope-report hook (server/scopeHooks.js), run by Claude Code outside the
# sandbox for a scoped agent: $1 the agent's spool folder (in its control folder, which the
# agent cannot reach), $2 what to keep: pd (a PermissionDenied event, always kept), ev (a
# PostToolBatch or a failed Bash command, kept only when it carries a refusal marker) or ids
# (the tool_use_id of a file tool call that succeeded, kept only when its result carries a
# marker: the server needs it only to tell such a call from a refusal). One event, one file,
# written under a temporary name and renamed, so the server never reads half of one. It waits
# on nothing and always exits 0, printing nothing: a hook here never holds up or changes a
# tool call.
# Cost: most events are small (in a measured run: median 1.8 KB, at most 32 KB) and carry no
# marker; the first 64 KiB are read into the shell (dd) and matched there, so such an event costs
# the shell and one dd, nothing more. A larger one goes to a temporary file and grep -F.
# What it keeps is bounded: an event's first 256 KiB (a safety limit: real events were at most
# 32 KB; a batch's calls come one by one, each id before its result, and the server reads a
# cut one to its last whole call); for ids, the last id in the event, where Claude Code puts
# tool_use_id after the result (past 64 MiB it is only counted, in large.count). pending.count
# gets a byte for each file written and the server removes it once it has filed what it read:
# past 5000 with nothing draining, nothing more is written and a byte goes to dropped.count
# instead, which the server counts and reports.
PATH=/usr/bin:/bin
LC_ALL=C
export PATH LC_ALL
umask 077
set -f
case "$2" in pd|ev|ids) ;; *) cat >/dev/null 2>&1; exit 0 ;; esac
# That the hooks run at all, once a start (the server removes it at a launch): an empty file,
# made by the shell itself, so most events, which carry no marker, still show the hooks live.
[ -e "$1/heard" ] || true 2>/dev/null >"$1/heard"
# The refusal markers, one a line: every text the server matches (scopeHooks.js BLOCKED,
# CLASSIFIER and the file tools' sentences) contains one of them.
M='is outside
--restricted confines
denied by your permission settings
deny rule
has been denied
auto mode classifier
peration not permitted
EPERM
sandbox_violations
deny network-outbound
path outside the working directory
link chain
CONNECT tunnel failed
blocked by the sandbox proxy'
SMALL=65536
# dd reads no further than it is asked (head may read ahead and lose the rest). An old dd
# without iflag=fullblock writes nothing here: the event then goes the larger way, whole.
d=$(dd bs=$((SMALL + 1)) count=1 iflag=fullblock 2>/dev/null && printf x)
case $d in *x) d=${d%x} ;; *) d=; SMALL=-1 ;; esac
# A spool past 5000 written and not drained: only counted.
full() {
  n=$({ wc -c <"$1/pending.count"; } 2>/dev/null)
  [ "$((n + 0))" -ge 5000 ] && printf x >>"$1/dropped.count" 2>/dev/null
}
if [ "${#d}" -le "$SMALL" ]; then
  # The whole event is in d: matched in the shell.
  [ -n "$d" ] || exit 0
  if [ "$2" != pd ]; then
    hit=
    IFS='
'
    for m in $M; do case $d in *"$m"*) hit=1; break ;; esac; done
    [ -n "$hit" ] || exit 0
  fi
  full "$1" && exit 0
  tmp=$(mktemp "$1/.in.XXXXXXXXXX" 2>/dev/null) || exit 0
  if [ "$2" = ids ]; then printf '%s' "$d" | grep -o '"tool_use_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]*"' >"$tmp" 2>/dev/null
  else printf '%s' "$d" >"$tmp" 2>/dev/null; fi
else
  tmp=$(mktemp "$1/.in.XXXXXXXXXX" 2>/dev/null) || { cat >/dev/null 2>&1; exit 0; }
  if [ "$2" = ids ]; then
    # At most 64 MiB copied: a larger event is not kept, only counted in large.count.
    { printf '%s' "$d"; head -c $((67108865 - SMALL - 1)); } >"$tmp" 2>/dev/null; cat >/dev/null 2>&1
    if [ "$(wc -c <"$tmp" 2>/dev/null)" -gt 67108864 ] 2>/dev/null; then rm -f "$tmp" 2>/dev/null; full "$1" || printf x >>"$1/large.count" 2>/dev/null; exit 0; fi
  else { printf '%s' "$d"; head -c $((262144 - SMALL - 1)); } >"$tmp" 2>/dev/null; cat >/dev/null 2>&1; fi
  if [ "$2" != pd ] && ! grep -q -F -e "$M" "$tmp" 2>/dev/null; then rm -f "$tmp" 2>/dev/null; exit 0; fi
  if full "$1"; then rm -f "$tmp" 2>/dev/null; exit 0; fi
  if [ "$2" = ids ]; then
    tail -c 4096 "$tmp" 2>/dev/null | grep -o '"tool_use_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]*"' >"$tmp.i" 2>/dev/null
    mv -f "$tmp.i" "$tmp" 2>/dev/null || { rm -f "$tmp" "$tmp.i" 2>/dev/null; exit 0; }
  fi
fi
[ -s "$tmp" ] || { rm -f "$tmp" 2>/dev/null; exit 0; }
k=$2; [ "$k" = pd ] && k=ev
mv -f "$tmp" "$1/${tmp##*/.in.}.$k" 2>/dev/null && printf x >>"$1/pending.count" 2>/dev/null || rm -f "$tmp" 2>/dev/null
exit 0

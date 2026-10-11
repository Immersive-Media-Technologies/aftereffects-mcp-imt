#!/bin/bash
# Poll After Effects until a condition holds — ONE tool call instead of a loop
# of ae_do calls. Runs a status .jsx through DoScript every INTERVAL seconds;
# the .jsx must write its status line into OUT (ExtendScript File.write);
# stops when OUT matches REGEX or after TIMEOUT seconds.
#   ae-wait.sh status.jsx out.txt 'Ср\. ош\.|Average error' 240 8
# Prints each distinct status with a timestamp; exit 0 = matched, 3 = timeout,
# other = DoScript failed (dialog/menu open → ae-dialogs.sh).
set -uo pipefail
JSX="$1"; OUT="$2"; RE="$3"; TIMEOUT="${4:-240}"; INT="${5:-8}"
APP="${AE_APP:-$(ls -d /Applications/Adobe\ After\ Effects*/Adobe\ After\ Effects*.app 2>/dev/null | sort | tail -1)}"
[ -n "$APP" ] || { echo "After Effects not found under /Applications (set AE_APP)" >&2; exit 2; }
t0=$(date +%s); last=""
while :; do
  rm -f "$OUT"
  osascript -e 'with timeout of 60 seconds' -e "tell application \"$APP\" to DoScript (POSIX file \"$JSX\")" -e 'end timeout' >/dev/null || exit $?
  s=$(cat "$OUT" 2>/dev/null | tr '\n' ' ')
  [ "$s" != "$last" ] && { echo "t+$(( $(date +%s) - t0 ))s: $s"; last="$s"; }
  echo "$s" | grep -Eq "$RE" && exit 0
  [ $(( $(date +%s) - t0 )) -ge "$TIMEOUT" ] && { echo "timeout ${TIMEOUT}s" >&2; exit 3; }
  sleep "$INT"
done

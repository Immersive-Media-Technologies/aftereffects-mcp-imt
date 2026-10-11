#!/bin/bash
# After Effects dialogs and menus (System Events).
#   ae-dialogs.sh list            → every AE window: name, subrole, position, size
#   ae-dialogs.sh close [N]       → press Return in AE up to N times (default 1) while a
#                                   dialog is open, re-checking after each press
#   ae-dialogs.sh escape          → one Escape (an open context/app menu blocks DoScript
#                                   with AppleEvent timeout -1712 until Escape)
#   ae-dialogs.sh front           → bring AE to the front
#   ae-dialogs.sh menus <menu>    → localized item names of one menu bar menu
# Exit code 1 of osascript with «-1719» = the AE process does not exist (crashed).
set -uo pipefail
P='tell application "System Events" to tell process "After Effects"'
case "${1:-list}" in
  list)   osascript -e 'with timeout of 20 seconds' -e "$P to get {name, subrole, position, size} of every window" -e 'end timeout' ;;
  close)  n="${2:-1}"; for i in $(seq 1 "$n"); do
            d=$(osascript -e "$P to count (every window whose subrole is \"AXDialog\" or subrole is \"AXSystemDialog\")" 2>/dev/null || echo 0)
            [ "$d" = "0" ] && { echo "no dialog ($((i-1)) closed)"; exit 0; }
            osascript -e "$P to key code 36"; sleep 1; done; echo "pressed Return $n times" ;;
  escape) osascript -e "$P to key code 53" ;;
  front)  osascript -e 'tell application "System Events" to set frontmost of process "After Effects" to true' ;;
  menus)  osascript -e 'with timeout of 20 seconds' -e "$P to get name of every menu item of menu \"$2\" of menu bar item \"$2\" of menu bar 1" -e 'end timeout' ;;
  *) echo "usage: ae-dialogs.sh list|close [N]|escape|front|menus <menu>" >&2; exit 2 ;;
esac

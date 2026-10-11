#!/bin/bash
# Click a menu item of After Effects by its LOCALIZED names (System Events,
# needs Accessibility for the calling app).
#   ae-menu.sh "Анимация" "Отслеживать камеру"
#   ae-menu.sh "Animation" "Track Camera"
# Menu clicks are safe (unlike synthetic clicks on panel buttons — use ae-click.js
# for those). The analysis the item starts runs in the background: poll with
# ae-wait.sh. Localized names: read them from the UI (ae-dialogs.sh menus) or
# the docs in recipes/.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: ae-menu.sh <menu> <item> [submenu-item]" >&2; exit 2; }
MENU="$1"; ITEM="$2"; SUB="${3:-}"
if [ -n "$SUB" ]; then
  osascript -e 'with timeout of 30 seconds' -e "tell application \"System Events\" to tell process \"After Effects\" to click menu item \"$SUB\" of menu 1 of menu item \"$ITEM\" of menu \"$MENU\" of menu bar item \"$MENU\" of menu bar 1" -e 'end timeout'
else
  osascript -e 'with timeout of 30 seconds' -e "tell application \"System Events\" to tell process \"After Effects\" to click menu item \"$ITEM\" of menu \"$MENU\" of menu bar item \"$MENU\" of menu bar 1" -e 'end timeout'
fi

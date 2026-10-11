#!/bin/bash
# Screenshot of the display that holds After Effects, optionally cropped — for
# UI-only steps (reading a panel button position, a dialog text). `screencapture`
# without -D fails on a multi-display Mac («could not create image from display»).
#   ae-shot.sh out.jpg                → whole display 1
#   ae-shot.sh out.png X Y W H [D]    → crop (screen points) of display D (default 1)
# Needs Screen Recording permission for the calling app.
set -euo pipefail
OUT="$1"; D="${6:-1}"
if [ $# -ge 5 ]; then screencapture -x -D "$D" -R "$2,$3,$4,$5" "$OUT"; else screencapture -x -D "$D" -t jpg "$OUT"; fi
echo "$OUT $(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null | awk '/pixel/{printf "%s ", $2}')"

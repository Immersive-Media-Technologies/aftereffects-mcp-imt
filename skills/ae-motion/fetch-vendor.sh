#!/bin/bash
# AE Motion — fetch the topic references this skill routes to (pinned commits) into ./vendor/.
# Download only (git clone over HTTPS from GitHub); nothing is uploaded. Re-run to refresh.
# Third-party content keeps its own license: see vendor/<name>/LICENSE and vendor/<name>/.source.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ae-motion-XXXX")"
trap 'rm -rf "$TMP"' EXIT
get() { # repo commit subdir dest
  git clone -q --filter=blob:none --no-checkout "https://github.com/$1.git" "$TMP/$4"
  git -C "$TMP/$4" sparse-checkout set --no-cone "/$3/" "/LICENSE"
  git -C "$TMP/$4" checkout -q "$2"
  rm -rf "vendor/$4" && mkdir -p "vendor/$4"
  cp -R "$TMP/$4/$3/." "vendor/$4/"
  [ -f "$TMP/$4/LICENSE" ] && cp "$TMP/$4/LICENSE" "vendor/$4/LICENSE"
  echo "https://github.com/$1 @ $2 ($3)" > "vendor/$4/.source"
  echo "  vendor/$4"
}
# After Effects 2026: keyframes/easing/rigs/expressions, shapes, text, assembly, MOGRT, ExtendScript pitfalls (MIT)
get Engine-Room-Games/after-effects-mcp e0598fd plugin/skills ae2026
# Editable per-letter typography, compositing recipes, MOGRT and QA (MIT)
get fuuuuuuma/after-effects-agent 8eaf847 plugins/after-effects-agent/skills/after-effects-agent ae-agent
# Motion principles, timing, easing, text animators, shape layers, effects, expressions (MIT)
get LobzyJay/motion-design-with-claude a4d48c5 skills motion-design
# Animation principles, colour, shot composition, logo reveals, backgrounds, AE expression library (MIT)
get iart-ai/motion-design-skills 3c129f7 skills motion-fundamentals
# Choreography rules and text-effect catalogue, engine-agnostic (Apache-2.0)
get heygen-com/hyperframes 097250e skills/hyperframes-animation hyperframes-animation

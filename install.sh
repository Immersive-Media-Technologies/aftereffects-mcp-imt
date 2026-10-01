#!/bin/bash
# AE-MCP-IMT — install on macOS.
#   ./install.sh            check → build → live self-test → write client configs (asks first)
#   ./install.sh --yes      same, without questions
#   ./install.sh --no-config   check, build and self-test only; print the config instead
# Nothing is installed into After Effects: no panel, no ZXP, no AEX — the dispatcher is sent to AE
# through osascript on every call. Removing this folder removes the server.
set -u
YES=0; NOCONF=0
for a in "$@"; do case "$a" in --yes|-y) YES=1;; --no-config) NOCONF=1;; esac; done
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s  ok  %s%s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s warn %s%s\n' "$YEL" "$OFF" "$*"; }
bad()  { printf '%s FAIL %s%s\n' "$RED" "$OFF" "$*"; FAIL=1; }
ask()  { [ "$YES" = "1" ] && return 0; printf '%s [y/N] ' "$1"; read -r r; [ "$r" = "y" ] || [ "$r" = "Y" ]; }

say ""; say "AE-MCP-IMT — environment check"; say "─────────────────────────────────────────────"
if [ "$(uname -s)" != "Darwin" ]; then bad "this script is for macOS (found: $(uname -s)); on Windows run install.ps1"; else ok "macOS $(sw_vers -productVersion)"; fi

AE_APP=""
for d in "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app" "/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app" "/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app"; do
  [ -d "$d" ] && { AE_APP="$d"; break; }
done
# the .app BUNDLE, not the folder: the path goes into `tell application <path> to DoScript`
[ -n "$AE_APP" ] && ok "After Effects: $AE_APP" || bad "After Effects not found in /Applications (2024–2026 supported)"

# Node by absolute path: a GUI client (Claude Desktop, Cursor) does not see nvm's PATH.
NODE_BIN=""
for n in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null)"; do
  [ -n "$n" ] && [ -x "$n" ] || continue
  major="$("$n" -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
  [ -n "$major" ] && [ "$major" -ge 22 ] 2>/dev/null && { NODE_BIN="$n"; break; }
done
if [ -z "$NODE_BIN" ]; then
  bad "Node.js >= 22 not found (checked /opt/homebrew/bin, /usr/local/bin, /usr/bin, PATH)"
  say "${DIM}     install: brew install node   — or use the Claude Desktop extension (.mcpb), which needs no Node${OFF}"
else
  ok "Node $("$NODE_BIN" -v) — $NODE_BIN"
fi
[ "$FAIL" = "1" ] && { say ""; say "${RED}Stopped.${OFF}"; exit 1; }

say ""; say "Build"; say "─────────────────────────────────────────────"
cd "$HERE" || exit 1
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1
else npm install --no-audit --no-fund >/dev/null 2>&1; fi
[ -d node_modules ] && ok "dependencies installed" || { bad "npm install failed"; exit 1; }
npm run build >/dev/null 2>&1
[ -f dist/index.js ] && ok "server built: dist/index.js" || { bad "build produced no dist/index.js"; exit 1; }

say ""; say "Live check against After Effects"; say "─────────────────────────────────────────────"
if ! pgrep -f "After Effects" >/dev/null 2>&1; then
  warn "After Effects is not running — skipping the live check (start it and run ./install.sh again)"
else
  OUT="$(AE_MCP_EXE="$AE_APP" "$NODE_BIN" "$HERE/tools/selftest.mjs" 2>/dev/null)"
  if printf '%s' "$OUT" | grep -q '"ok": *true'; then
    ok "After Effects answers: $(printf '%s' "$OUT" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"
  else
    bad "After Effects did not answer"; printf '%s\n' "$OUT" | head -12
    say "${DIM} • macOS asks once for Automation permission (System Settings → Privacy & Security → Automation);${OFF}"
    say "${DIM}   AppleScript error -1743 means it was denied — allow the terminal / client app to control After Effects.${OFF}"
    say "${DIM} • After Effects → Settings → Scripting & Expressions → «Allow Scripts to Write Files and Access Network» must be on.${OFF}"
  fi
fi

SERVER_JSON="{
      \"command\": \"$NODE_BIN\",
      \"args\": [\"$HERE/dist/index.js\"],
      \"env\": { \"AE_MCP_EXE\": \"$AE_APP\", \"MCP_TIMEOUT\": \"120000\" }
    }"
say ""; say "Connect"; say "─────────────────────────────────────────────"
if [ "$NOCONF" = "1" ]; then
  say "Add to your client's MCP config:"; say ""; say "  \"mcpServers\": { \"aftereffects\": $SERVER_JSON }"; say ""
else
  # write_config <file> <label>: inserts/replaces mcpServers.aftereffects, keeps everything else, backs up first
  write_config() {
    f="$1"; label="$2"
    if ask "Add the server to $label ($f)?"; then
      mkdir -p "$(dirname "$f")"
      [ -f "$f" ] && cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
      "$NODE_BIN" - "$f" "$NODE_BIN" "$HERE/dist/index.js" "$AE_APP" <<'NODE'
const fs = require('fs'); const [file, node, entry, ae] = process.argv.slice(2);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.aftereffects = { command: node, args: [entry], env: { AE_MCP_EXE: ae, MCP_TIMEOUT: '120000' } };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
NODE
      ok "$label: mcpServers.aftereffects written (restart $label)"
    fi
  }
  write_config "$HOME/Library/Application Support/Claude/claude_desktop_config.json" "Claude Desktop"
  write_config "$HOME/.cursor/mcp.json" "Cursor"
  write_config "$HOME/.gemini/config/mcp_config.json" "Google Antigravity"
  say ""
  say "Other clients: \"mcpServers\": { \"aftereffects\": $SERVER_JSON }"
fi
say ""
say "${DIM}First session on a new machine: add AE_MCP_READONLY=1 to env and work on a COPY of the project —${OFF}"
say "${DIM}the server edits the open document. MCP_TIMEOUT=120000: a cold AE start does not fit the default 30 s.${OFF}"
say ""

#!/bin/bash
# AE-MCP — установка на macOS.
#
# Скрипт НИЧЕГО не устанавливает в сам After Effects: панелей, ZXP и AEX нет,
# диспетчер запускается на каждый вызов через osascript. Удаление = удаление
# этой папки.
#
# Запуск:  ./install.sh
set -u

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s  ok  %s%s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s warn %s%s\n' "$YEL" "$OFF" "$*"; }
bad()  { printf '%s FAIL %s%s\n' "$RED" "$OFF" "$*"; FAIL=1; }

say ""
say "AE-MCP — проверка окружения"
say "─────────────────────────────────────────────"

# 1. macOS. На Windows транспорт другой (AfterFX.exe -r), эта сборка его не
#    несёт — лучше сказать сразу, чем упасть на osascript.
if [ "$(uname -s)" != "Darwin" ]; then
  bad "нужна macOS (обнаружено: $(uname -s))"
else
  ok "macOS $(sw_vers -productVersion)"
fi

# 2. After Effects. Ищем .app-БАНДЛ, а не каталог установки: на macOS это
#    значение уходит в `tell application <path> to DoScript`, и путь без
#    ".app" AppleScript роняет синтаксической ошибкой.
AE_DIR=""
for d in "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app" \
         "/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app" \
         "/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app"; do
  [ -d "$d" ] && { AE_DIR="$d"; break; }
done
if [ -z "$AE_DIR" ]; then
  bad "After Effects не найден в /Applications (поддержаны 2024–2026)"
else
  ok "After Effects: $AE_DIR"
fi

# 3. Node >= 24. Ищем ПО АБСОЛЮТНЫМ путям, а не через PATH: GUI-приложение на
#    macOS не наследует PATH из шелла, поэтому node, найденный только через
#    nvm, приложению не пригодится, даже если здесь он виден.
NODE_BIN=""
for n in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -x "$n" ]; then
    major="$("$n" -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
    if [ -n "$major" ] && [ "$major" -ge 24 ] 2>/dev/null; then NODE_BIN="$n"; break; fi
  fi
done
if [ -z "$NODE_BIN" ]; then
  bad "не найден Node >= 24 по абсолютному пути"
  say "${DIM}     проверены: /opt/homebrew/bin/node, /usr/local/bin/node, /usr/bin/node${OFF}"
  say "${DIM}     установите: brew install node   (nvm-версии приложению не видны)${OFF}"
else
  ok "Node $("$NODE_BIN" -v) — $NODE_BIN"
fi

[ "$FAIL" = "1" ] && { say ""; say "${RED}Установка прервана.${OFF}"; exit 1; }

# 4. Зависимости и сборка.
say ""
say "Сборка"
say "─────────────────────────────────────────────"
cd "$HERE" || exit 1
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1
else
  npm install --no-audit --no-fund >/dev/null 2>&1
fi
[ -d node_modules ] && ok "зависимости установлены" || { bad "npm install не отработал"; exit 1; }
npm run build >/dev/null 2>&1
[ -f dist/index.js ] && ok "сервер собран: dist/index.js" || { bad "сборка не дала dist/index.js"; exit 1; }

# 5. Живая проверка. Единственный надёжный способ узнать, что AppleEvents
#    разрешены и что в AE включена запись файлов скриптами, — сходить в AE.
say ""
say "Живая проверка After Effects"
say "─────────────────────────────────────────────"
if ! pgrep -f "After Effects" >/dev/null 2>&1; then
  warn "After Effects не запущен — пропускаю живую проверку"
  say "${DIM}     запустите AE и повторите: ./install.sh${OFF}"
else
  OUT="$("$NODE_BIN" "$HERE/tools/selftest.mjs" 2>&1)"
  if printf '%s' "$OUT" | grep -q '"ok": *true'; then
    ok "AE отвечает: $(printf '%s' "$OUT" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"
  else
    bad "AE не ответил"
    printf '%s\n' "$OUT" | head -20
    say ""
    say "${DIM}Наиболее частые причины:${OFF}"
    say "${DIM} • Ошибка AppleScript -1743 — не выдано разрешение на автоматизацию.${OFF}"
    say "${DIM}   Системные настройки → Конфиденциальность и безопасность →${OFF}"
    say "${DIM}   Автоматизация → разрешить управление After Effects.${OFF}"
    say "${DIM} • В AE выключено «Разрешить сценариям записывать файлы и получать${OFF}"
    say "${DIM}   доступ к сети»: Настройки → Сценарии и выражения.${OFF}"
  fi
fi

# 6. Готовая запись конфига.
say ""
say "Подключение"
say "─────────────────────────────────────────────"
say "Deep Artisan подхватывает сервер сам, если папка лежит по пути"
say "  ~/CascadeProjects/ae-mcp   или   <Deep Artisan.app>/Contents/Resources/ae-mcp"
say ""
say "Для стороннего MCP-клиента запись конфига:"
cat <<JSON

  "mcpServers": {
    "ae": {
      "command": "$NODE_BIN",
      "args": ["$HERE/dist/index.js"],
      "env": {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "AE_MCP_EXE": "$AE_DIR",
        "AE_MCP_READONLY": "0",
        "AE_MCP_ENABLE_EVAL": "0"
      }
    }
  }

JSON
say "${DIM}Первый запуск на новой машине делайте с AE_MCP_READONLY=1 и на КОПИИ${OFF}"
say "${DIM}проекта: сервер меняет открытый документ.${OFF}"
say ""

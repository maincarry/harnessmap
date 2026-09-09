#!/usr/bin/env bash
# HarnessMap for Codex - uninstall, one command:
#   bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.sh)            # hooks, plugin, server
#   bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.sh) --purge    # ... and the app + ALL map data in ~/.harnessmap
set -u
APP="${HARNESSMAP_APP:-$HOME/.harnessmap/app}"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
say "stopping the map server"; curl -s -m 3 -X POST http://127.0.0.1:8790/api/shutdown >/dev/null 2>&1; sleep 1; pkill -f "bun run src/server.ts" 2>/dev/null || true
if [ -f "${APP}/hooks/enable-codex.ts" ]; then say "removing the hooks from ~/.codex/hooks.json"; ( cd "${APP}" && bun run hooks/enable-codex.ts --remove ) || true; fi
if command -v codex >/dev/null 2>&1; then say "removing the plugin and marketplace"; codex plugin remove map@harnessmap >/dev/null 2>&1 || true; codex plugin marketplace remove harnessmap >/dev/null 2>&1 || true; fi
if [ "${1:-}" = "--purge" ]; then say "deleting ~/.harnessmap (the app and every map)"; rm -rf "$HOME/.harnessmap"; else say "kept ~/.harnessmap (your maps and the app). To delete everything: rerun with --purge"; fi
say "done. Codex no longer loads harnessmap; a running Codex app needs a full quit (Cmd+Q) and reopen."

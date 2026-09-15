#!/usr/bin/env bash
# HarnessMap for Codex - uninstall, one command:
#   bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.sh)            # hooks, plugin, server
#   bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.sh) --purge    # ... and the app + ALL map data in ~/.harnessmap
set -u
APP="${HARNESSMAP_APP:-$HOME/.harnessmap/app}"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
# M257: the Codex APP ships its own CLI but does not put it on PATH (Jacob's Mac) - find it and use it; link it so `codex` works in Terminal
find_codex() {
  command -v codex >/dev/null 2>&1 && return 0
  for c in "${CODEX_CLI_PATH:-}" /Applications/Codex.app/Contents/Resources/codex /Applications/Codex.app/Contents/Resources/bin/codex "$HOME/Applications/Codex.app/Contents/Resources/codex" /Applications/ChatGPT.app/Contents/Resources/codex /Applications/ChatGPT.app/Contents/Resources/bin/codex "$HOME/.codex/bin/codex"; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      export PATH="$(dirname "$c"):$PATH"
      for b in /usr/local/bin "$HOME/.local/bin"; do
        if { [ -d "$b" ] && [ -w "$b" ]; } || mkdir -p "$b" 2>/dev/null; then [ -e "$b/codex" ] || ln -s "$c" "$b/codex" 2>/dev/null; break; fi
      done
      say "codex found inside the app at $c (linked as 'codex' for your Terminal; if Terminal still cannot find it, run:  export PATH=\"$(dirname "$c"):\$PATH\")"
      return 0
    fi
  done
  return 1
}
find_codex || true
say "stopping the map server"; curl -s -m 3 -X POST http://127.0.0.1:8790/api/shutdown >/dev/null 2>&1; sleep 1; pkill -f "bun run src/server.ts" 2>/dev/null || true
if [ -f "${APP}/hooks/enable-codex.ts" ]; then say "removing the hooks from ~/.codex/hooks.json"; ( cd "${APP}" && bun run hooks/enable-codex.ts --remove ) || true; fi
if command -v codex >/dev/null 2>&1; then say "removing the plugin and marketplace"; codex plugin remove map@harnessmap >/dev/null 2>&1 || true; codex plugin marketplace remove harnessmap >/dev/null 2>&1 || true; fi
if [ "${1:-}" = "--purge" ]; then say "deleting ~/.harnessmap (the app and every map)"; rm -rf "$HOME/.harnessmap"; else say "kept ~/.harnessmap (your maps and the app). To delete everything: rerun with --purge"; fi
say "done. Codex no longer loads harnessmap; a running Codex app needs a full quit (Cmd+Q) and reopen."

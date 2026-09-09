#!/usr/bin/env bash
# HarnessMap for Codex - one command (macOS / Linux):
#   curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/install-codex.sh | bash
# Installs bun if missing, puts the app in ~/.harnessmap/app, registers it as a Codex plugin
# (marketplace + plugin), and prints the two things Codex asks of you (trust the hooks, new session).
set -euo pipefail
APP="${HARNESSMAP_APP:-$HOME/.harnessmap/app}"; REPO="${HARNESSMAP_REPO:-https://github.com/maincarry/harnessmap.git}"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
if ! command -v bun >/dev/null 2>&1; then say "installing bun (the map's runtime)..."; curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; fi
if ! command -v codex >/dev/null 2>&1; then say "codex is not on PATH - install the Codex CLI (npm i -g @openai/codex) or the Codex app first; the map's hooks will attach once it is."; fi
mkdir -p "$(dirname "${APP}")"
if [ -d "${APP}/.git" ]; then say "updating ${APP}..."; git -C "${APP}" pull -q --ff-only || true; else say "fetching the map into ${APP}..."; git clone -q "${REPO}" "${APP}"; fi
( cd "${APP}" && bun install --production >/dev/null 2>&1 || true )
if command -v codex >/dev/null 2>&1 && codex plugin marketplace add "${APP}" >/dev/null 2>&1; then
  if codex plugin add map@harnessmap >/dev/null 2>&1; then
    say "installed as a Codex plugin (marketplace 'harnessmap', plugin 'map')."
    say "Next: start a NEW Codex session (or restart the Codex app) and accept the hook trust prompt when it appears."
    say "If the map does not appear after that: bun run \"${APP}/hooks/enable-codex.ts\" --force  (user-level hooks)"
  else
    say "plugin install did not succeed - registering user-level hooks instead."; ( cd "${APP}" && bun run hooks/enable-codex.ts --force )
  fi
else
  say "registering user-level hooks (this Codex has no plugin command, or codex is missing)."; ( cd "${APP}" && bun run hooks/enable-codex.ts --force ) || true
fi
say "The map lives at http://127.0.0.1:8790 once a session starts. All data stays in ~/.harnessmap."

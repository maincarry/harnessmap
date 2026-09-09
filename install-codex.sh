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
# Codex does not execute plugin-bundled hooks yet (openai/codex #16430, open), and hooks the user
# adds are skipped until trusted, often without a prompt (#35306). So: user-level hooks, then /hooks.
( cd "${APP}" && bun run hooks/enable-codex.ts --force ) || { say "could not register the hooks - see the error above"; exit 1; }
if command -v codex >/dev/null 2>&1; then codex plugin marketplace add "${APP}" >/dev/null 2>&1 && codex plugin add map@harnessmap >/dev/null 2>&1 && say "skills registered as a Codex plugin (marketplace 'harnessmap', plugin 'map')" || true; fi
say "LAST STEP, in Codex: start a session and type  /hooks  - trust the harnessmap entries (Codex skips untrusted hooks silently). Then start a NEW thread."
say "The map lives at http://127.0.0.1:8790 once a session starts. All data stays in ~/.harnessmap."

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
# start the map server now and open the page - the user sees the map before Codex is even involved
# a server already running on OLDER code is restarted (M236): the build it reports must match the app on disk
HEADSHA=$(git -C "${APP}" rev-parse --short HEAD 2>/dev/null || echo "")
RUNNING=$(curl -s -m 2 http://127.0.0.1:8790/api/state 2>/dev/null | grep -o '"build":"[a-z0-9]*"' | cut -d'"' -f4)
MACHINE=$(curl -s -m 2 http://127.0.0.1:8790/api/state 2>/dev/null | grep -o '"machine":"[^"]*"' | cut -d'"' -f4)
# a harnessmap answering on this port from ANOTHER machine = an SSH port forward; nothing here can close it
if [ -n "${MACHINE}" ] && [ "${MACHINE}" != "$(hostname)" ]; then say "port 8790 is answered by a map server on ANOTHER machine ('${MACHINE}') - an SSH port forward? Close that tunnel (or move it off 8790), then rerun this installer."; exit 1; fi
if curl -s -m 2 -o /dev/null http://127.0.0.1:8790/api/state && [ -n "${HEADSHA}" ] && [ "${RUNNING}" != "${HEADSHA}" ]; then say "restarting the map server on the updated code (${RUNNING:-old} -> ${HEADSHA})"; curl -s -m 3 -X POST http://127.0.0.1:8790/api/shutdown >/dev/null 2>&1; sleep 2; pkill -f "bun run src/server.ts" 2>/dev/null; sleep 1; fi
if ! curl -s -m 2 -o /dev/null http://127.0.0.1:8790/api/state; then ( cd "${APP}" && nohup bun run src/server.ts > "${HOME}/.harnessmap/server.log" 2>&1 & ); for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -m 2 -o /dev/null http://127.0.0.1:8790/api/state && break; done; fi
if curl -s -m 2 -o /dev/null http://127.0.0.1:8790/api/state; then say "the map is up at http://127.0.0.1:8790"; (command -v open >/dev/null 2>&1 && open http://127.0.0.1:8790) || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://127.0.0.1:8790) || true; else say "the map server did not answer - see ${HOME}/.harnessmap/server.log"; fi
printf '\n\033[1m%s\033[0m\n' "ONE MANUAL STEP (Codex requires it; nothing can do it for you):"
printf '%s\n' "  1. open a terminal in any project folder and run:  codex" "  2. type  /hooks  and trust the harnessmap entries (Codex skips untrusted hooks silently; the app cannot trust them, the CLI can, and both share the setting)" "  3. start a NEW thread (CLI or app) and say:  open map  - the map attaches to THAT session only (it is off everywhere else); say  close map  to detach"
say "To check any time:  bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/test-codex.sh)"
say "The map lives at http://127.0.0.1:8790 once a session starts. All data stays in ~/.harnessmap."

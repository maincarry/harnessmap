#!/usr/bin/env bash
# HarnessMap on Codex - the whole verification in ONE command, output made for pasting back:
#   bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/test-codex.sh)
# Starts the map server detached, checks state and models, drives the three hooks the way Codex does,
# waits for the filer, and prints a summary table. Touches nothing in ~/.codex.
set -u
APP="${HARNESSMAP_APP:-$HOME/.harnessmap/app}"; LOG=/tmp/harnessmap-test-server.log; B=http://127.0.0.1:8790
say() { printf '\n== %s\n' "$*"; }
res=(); add() { res+=("$1 | $2 | ${3:-}"); }
say "0. tools"; codex --version 2>/dev/null | tail -1 || echo "codex: not on PATH"; bun --version 2>/dev/null || echo "bun: missing"; ls "$APP/src/server.ts" >/dev/null 2>&1 && echo "app: $APP" || { echo "app missing at $APP - run the installer first"; exit 1; }
say "1. plugin"; codex plugin list 2>/dev/null | grep -i harnessmap || echo "(no plugin listed)"; [ -f "$HOME/.codex/hooks.json" ] && grep -c harnessmap "$HOME/.codex/hooks.json" | sed 's/^/user-level hook entries: /' || echo "user-level hooks: none (fine when the plugin is installed)"
say "2. server"; if curl -s -m 2 -o /dev/null "$B/api/state"; then echo "already running"; else (cd "$APP" && nohup bun run src/server.ts > "$LOG" 2>&1 &); for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -m 2 -o /dev/null "$B/api/state" && break; done; fi
ST=$(curl -s -m 5 -w '\n%{http_code}' "$B/api/state"); code=$(echo "$ST" | tail -1);
MACHINE=$(echo "$ST" | head -1 | grep -o '"machine":"[^"]*"' | cut -d'"' -f4); if [ -n "$MACHINE" ] && [ "$MACHINE" != "$(hostname)" ]; then echo "port 8790 is answered by a map server on ANOTHER machine ('$MACHINE') - an SSH port forward? Close it and rerun."; add "state" "FAIL" "foreign server $MACHINE"; say "SUMMARY (paste this back)"; printf '%s\n' "${res[@]}"; exit 1; fi; echo "state HTTP $code: $(echo "$ST" | head -1 | head -c 160)"; echo "$ST" | head -1 | grep -o '"build":"[^"]*"\|"appRoot":"[^"]*"' | tr '\n' ' '; echo; add "state" "$([ "$code" = 200 ] && echo PASS || echo FAIL)" "HTTP $code"
say "3. models"; MO=$(curl -s -m 5 -w '\n%{http_code}' "$B/api/models"); mcode=$(echo "$MO" | tail -1); echo "models HTTP $mcode: $(echo "$MO" | head -1 | head -c 300)"; add "models" "$([ "$mcode" = 200 ] && echo PASS || echo FAIL)" "HTTP $mcode$(echo "$MO" | head -1 | grep -o '"backend":"[a-z]*"' | head -1 | sed 's/^/ /')"
say "4. hooks, driven by hand (SessionStart, UserPromptSubmit, Stop)"; cd "$APP"
S1=$(echo '{"session_id":"probe-'$$'","cwd":"'"$HOME"'/maptest-probe","hook_event_name":"SessionStart"}' | bun run hooks/session-start.ts 2>&1 | head -c 300); echo "session-start: $S1"; add "session-start hook" "$( (echo "$S1" | grep -q additionalContext || [ -z "$S1" ]) && echo PASS || echo FAIL)" "$([ -z "$S1" ] && echo 'silent: project already known')"
P1=$(echo '{"session_id":"probe-'$$'","turn_id":"t1","hook_event_name":"UserPromptSubmit","prompt":"we decided the header will be blue because it is calmer"}' | bun run hooks/on-prompt.ts 2>&1 | head -c 200); echo "on-prompt: ${P1:0:120}"; add "on-prompt hook" "$(echo "$P1" | grep -q additionalContext && echo PASS || echo 'FAIL (no context returned)')"
echo '{"session_id":"probe-'$$'","turn_id":"t1","hook_event_name":"Stop","last_assistant_message":"Noted: blue header, chosen for calm."}' | bun run hooks/on-stop.ts >/dev/null 2>&1; echo "on-stop: sent; waiting up to 120 s for the filer"; N=""; for i in $(seq 1 24); do sleep 5; N=$(curl -s -m 5 "$B/api/state" | grep -o '"content":"[^"]*[Bb]lue[^"]*"' | head -1); [ -n "$N" ] && break; done
echo "node: ${N:-none after 120 s}"; add "filing (a node about the blue header)" "$([ -n "$N" ] && echo PASS || echo 'FAIL (see the backend line and the log below)')" "$([ -n "$N" ] && echo "$((i*5)) s")"
say "5. backend"; curl -s -m 5 "$B/api/auth-info" | grep -o '"backend":"[^"]*"\|"lastErr":[^,}]*' | tr '\n' ' '; echo; echo "claude: $(command -v claude || echo none)  codex: $(command -v codex || echo none)"
say "6. log tail"; tail -15 "$LOG" 2>/dev/null | cut -c1-200; tail -8 "$HOME/.harnessmap/server.log" 2>/dev/null | cut -c1-200
say "SUMMARY (paste this back)"; printf '%s\n' "${res[@]}"
echo "server left running on $B (log $LOG). Next: quit the Codex app fully, reopen, new thread, say hello - the reply should mention the map."

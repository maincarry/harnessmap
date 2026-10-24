#!/bin/bash
# The whole demo, one command. One fresh server; the story's turns go in through the real hooks' endpoint while the map
# page is recorded; then the companion and the map beats are recorded over the finished map; cards and score; the cut.
#   usage: bash demo/make.sh <take-name> [port=9375]       (absolute paths; safe under systemd-run)
# Needs: bun, playwright chromium, a full ffmpeg (FFMPEG=/path), codex login (CODEX_HOME) for the filer and the map guide.
set -u
TAKE=${1:-take1}; PORT=${2:-9375}
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
OUT=${DEMO_OUT:-/tmp/claude-1000/demo-$TAKE}; rm -rf "$OUT"; mkdir -p "$OUT/home/.harnessmap" "$OUT/recA"
FFMPEG=${FFMPEG:-ffmpeg}; export FFMPEG
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$OUT/make.log"; }

log "1/6 a fresh server (port $PORT), inference on"
env -u ANTHROPIC_API_KEY HARNESSMAP_INFERENCE=codex CODEX_HOME=${CODEX_HOME:-$HOME/.codex} HARNESSMAP_INFERENCE_CONCURRENCY=4 \
  HARNESSMAP_HOME="$OUT/home/.harnessmap" HARNESSMAP_DB="$OUT/home/map.sqlite" PORT=$PORT HOME="$OUT/home" \
  HARNESSMAP_AUTOTIDY_ROUNDS=15 HARNESSMAP_LATEST_OVERRIDE=0.0.1 \
  bun run src/server.ts > "$OUT/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/state" && break; sleep 1; done

log "2/6 recording the map while the story files (seed.ts at the recorder's pace)"
bun run demo/record.ts A $PORT "$OUT/recA" > "$OUT/recA.log" 2>&1 &
REC=$!
bun run demo/seed.ts $PORT "$OUT" > "$OUT/seed.log" 2>&1
wait $REC
grep -E 'landed|NOT drained|context for' "$OUT/seed.log" | tee -a "$OUT/make.log"
for i in $(seq 1 60); do p=$(curl -sf "http://127.0.0.1:$PORT/api/filings" | sed -n 's/.*"pending":\([0-9]*\).*/\1/p'); [ "${p:-1}" = "0" ] && break; sleep 2; done

log "3/6 the companion"
bun run demo/record.ts C $PORT "$OUT/recC" > "$OUT/recC.log" 2>&1
log "4/6 the map beats (chat agent's view, talk to the map, galaxy)"
bun run demo/record.ts B $PORT "$OUT/recB" > "$OUT/recB.log" 2>&1
curl -sf "http://127.0.0.1:$PORT/api/state" > "$OUT/state.json"
kill $SRV 2>/dev/null; cp "$OUT/home/map.sqlite" "$OUT/map.sqlite" 2>/dev/null

log "5/6 cards + score"
bun run demo/record.ts cards 0 "$OUT/cards" > "$OUT/cards.log" 2>&1
bun run demo/music.ts "$OUT/music.wav" 180 >> "$OUT/make.log" 2>&1

log "6/6 the cut"
bun run demo/cut.ts "$OUT/recA" "$OUT/recB" "$OUT/recC" "$OUT/cards" "$OUT/music.wav" "$OUT/cut" > "$OUT/cut.log" 2>&1
tail -3 "$OUT/cut.log" | tee -a "$OUT/make.log"
ls -la "$OUT/cut/" | tee -a "$OUT/make.log"
log "done: $OUT/cut/harnessmap-demo.mp4"

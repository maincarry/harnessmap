#!/bin/bash
# The whole demo, one command: a fresh server; one continuous take on the stage while the story files through the
# hooks' endpoint; the score; the cut.    usage: bash demo/make.sh <take-name> [port=9375]   (absolute paths under systemd)
# Needs: bun, playwright chromium, a full ffmpeg (FFMPEG=/path), codex login (CODEX_HOME) for the filer and the map guide.
set -u
TAKE=${1:-take1}; PORT=${2:-9375}
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
OUT=${DEMO_OUT:-/tmp/claude-1000/demo-$TAKE}; rm -rf "$OUT"; mkdir -p "$OUT/home/.harnessmap" "$OUT/recA"
FFMPEG=${FFMPEG:-ffmpeg}; export FFMPEG
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$OUT/make.log"; }

log "1/4 a fresh server (port $PORT), inference on"
env -u ANTHROPIC_API_KEY HARNESSMAP_INFERENCE=codex CODEX_HOME=${CODEX_HOME:-$HOME/.codex} HARNESSMAP_INFERENCE_CONCURRENCY=4 \
  HARNESSMAP_HOME="$OUT/home/.harnessmap" HARNESSMAP_DB="$OUT/home/map.sqlite" PORT=$PORT HOME="$OUT/home" \
  HARNESSMAP_AUTOTIDY_ROUNDS=15 HARNESSMAP_LATEST_OVERRIDE=0.0.1 \
  bun run src/server.ts > "$OUT/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/state" && break; sleep 1; done

log "2/4 the take (stage + camera) while the story files"
bun run demo/take.ts $PORT "$OUT" > "$OUT/take.log" 2>&1 &
REC=$!
bun run demo/seed.ts $PORT "$OUT" > "$OUT/seed.log" 2>&1
wait $REC
grep -E 'landed|NOT drained|context for' "$OUT/seed.log" | tee -a "$OUT/make.log"
grep -E '"keep"|pageerror|video' "$OUT/take.log" | cut -c1-120 | tee -a "$OUT/make.log"
curl -sf "http://127.0.0.1:$PORT/api/state" > "$OUT/state.json"; kill $SRV 2>/dev/null; cp "$OUT/home/map.sqlite" "$OUT/map.sqlite" 2>/dev/null

log "3/4 the score"
bun run demo/music.ts "$OUT/music.wav" 200 >> "$OUT/make.log" 2>&1

log "4/4 the cut"
bun run demo/cut2.ts "$OUT" > "$OUT/cut.log" 2>&1
tail -4 "$OUT/cut.log" | tee -a "$OUT/make.log"
ls -la "$OUT/cut/" | tee -a "$OUT/make.log"
log "done: $OUT/cut/harnessmap-demo.mp4"

#!/bin/bash
# The whole demo, one command. Seeds a fresh map from demo/story.json through the real hooks while recording the
# map page, then records the companion and the map beats over the finished map, renders the cards and the score,
# and cuts the video.   usage: bash demo/make.sh <take-name> [seed-port=9375] [beats-port=8813]
# Needs: bun, playwright chromium, a full ffmpeg (FFMPEG=/path, e.g. the ffmpeg-static package), codex login
# (CODEX_HOME) for the filer and the map guide.
set -u
TAKE=${1:-take1}; SEEDPORT=${2:-9375}; BEATPORT=${3:-8813}
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
OUT=${DEMO_OUT:-/tmp/claude-1000/demo-$TAKE}; mkdir -p "$OUT"
FFMPEG=${FFMPEG:-ffmpeg}; export FFMPEG
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$OUT/make.log"; }

log "1/6 seeding + recording the map (port $SEEDPORT)"
rm -rf "/tmp/claude-1000/harnessmap-e2e-demo-$TAKE-mid"
( env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE -u HARNESSMAP_HOME -u HARNESSMAP_URL -u PORT \
    E2E_ENGINE=codex E2E_TMP_NAME="demo-$TAKE" E2E_MODELS=mid E2E_PORT=$SEEDPORT E2E_BRAIN=1 E2E_MAP_OUT="$OUT/story.map" \
    timeout 1500 bun run src/eval/e2e-run.ts demo/story.json --keep > "$OUT/seed.log" 2>&1; echo "exit=$?" >> "$OUT/seed.log" ) &
SEED=$!
sleep 6
bun run demo/record.ts A $SEEDPORT "$OUT/recA" > "$OUT/recA.log" 2>&1
wait $SEED
grep -E 'PASS|FAIL|^exit=' "$OUT/seed.log" | sort | uniq -c | sort -rn | head -5 | tee -a "$OUT/make.log"

log "2/6 a server over the finished map (port $BEATPORT), inference on for the map guide"
K="/tmp/claude-1000/harnessmap-e2e-demo-$TAKE-mid"; H="$OUT/home"; rm -rf "$H"; mkdir -p "$H"; cp -r "$K/home" "$H/"; cp "$K/e2e.sqlite" "$H/map.sqlite"
env -u ANTHROPIC_API_KEY HARNESSMAP_INFERENCE=codex CODEX_HOME=${CODEX_HOME:-$HOME/.codex} HARNESSMAP_INFERENCE_CONCURRENCY=2 \
  HARNESSMAP_HOME="$H/home/.harnessmap" HARNESSMAP_DB="$H/map.sqlite" PORT=$BEATPORT HOME="$H/home" HARNESSMAP_AUTOTIDY_ROUNDS=0 \
  bun run src/server.ts > "$OUT/beats-server.log" 2>&1 &
SRV=$!
for i in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$BEATPORT/api/state" && break; sleep 1; done

log "3/6 the companion"
bun run demo/record.ts C $BEATPORT "$OUT/recC" > "$OUT/recC.log" 2>&1
log "4/6 the map beats (chat agent's view, talk to the map, galaxy)"
bun run demo/record.ts B $BEATPORT "$OUT/recB" > "$OUT/recB.log" 2>&1
kill $SRV 2>/dev/null

log "5/6 cards + score"
bun run demo/record.ts cards 0 "$OUT/cards" > "$OUT/cards.log" 2>&1
bun run demo/music.ts "$OUT/music.wav" 180 >> "$OUT/make.log" 2>&1

log "6/6 the cut"
bun run demo/cut.ts "$OUT/recA" "$OUT/recB" "$OUT/recC" "$OUT/cards" "$OUT/music.wav" "$OUT/cut" > "$OUT/cut.log" 2>&1
tail -3 "$OUT/cut.log" | tee -a "$OUT/make.log"
ls -la "$OUT/cut/" | tee -a "$OUT/make.log"
log "done: $OUT/cut/harnessmap-demo.mp4"

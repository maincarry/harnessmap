# Codex e2e loop — runbook

A second autonomous tester for HarnessMap: run real-conversation replay scenarios
one at a time, check structural invariants, triage, clean up, log. This mirrors the
loop the Claude session runs; the point is independent coverage and a second set of
eyes on the same map behaviors. (Jacob, 2026-10-02: "ask codex to run the same type
of loops as well.")

## Golden rules
- **One e2e at a time.** Codex startup is memory-spiky; never run two concurrently.
- **Never touch the live map server** (standalone process, loopback 127.0.0.1:8790).
  Do not kill it; never use port 8790. The e2e harness uses its own port (8799 here).
- **Bug fixes + test improvements only.** A design/product judgment is a tagged
  proposal in docs/MIND.md §10, never a ruled change (the loop makes no rulings).
- **Investigate before reporting.** A single model-driven assertion fail with clean
  invariants is usually variance — re-run (spaced) before calling it a finding. For a
  structural flag, trace it to root cause in the sqlite/map before escalating.
- **Push every commit.** Test/CI edits: no version bump. A product ship bumps BOTH
  package.json and codex-plugin/.codex-plugin/plugin.json.

## Preflight (before each run)
- Memory: run only if `free -m` **available** > 2500 MB (the "free" column misleads —
  Linux reclaims page cache; available is the real headroom). Else wait and retry.
- No other codex/build running; the e2e port free; git tree clean.
- Pick a FRESH scenario: `src/eval/scenarios/replay-real-*-p1.json` (p1 = standalone
  fresh start; p2/p3 = mid-stream slices, also valuable). Skip ones already green in
  the ledger and the OOM-heavy set (matlab-face, socket-gui, drone-swarm, csim-cache,
  go-failing-test, js-focus-nav, java-cooling-sim). Smallest file first is a fine order.

## Run (bare, backgrounded; cd first — cwd resets break module resolution)
```
cd <repo> && env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE \
  E2E_ENGINE=codex CODEX_HOME=~/.codex HARNESSMAP_INFERENCE_CONCURRENCY=1 \
  E2E_PORT=<free port, not 8790> \
  bun run src/eval/e2e-run.ts src/eval/scenarios/replay-real-<scen>.json --keep
```
`--keep` leaves the map at `src/eval/scenarios/replay-real-<scen>.map` and the sqlite at
`/tmp/<tmpdir>/harnessmap-e2e-replay-real-<scen>/e2e.sqlite` for inspection.

## When done
1. Read the output tail: `N passed, 0 failed` = green.
2. Invariants: `bun run src/eval/invariants.ts <that e2e.sqlite>`.
   - `... ok` suffix = zero issues. A line printed instead of `ok` is a flag — read it.
   - `seed_rewritten_by_round` / `root_rewritten_by_round` = NORMAL (an untitled root or
     focused seed specialized to the first topic).
   - `governor_fight` = the SAME guard on the SAME node across 2+ rounds. Triage:
     - `title_healed … (distinct heals → evolving node, benign)` = the filer re-titled an
       evolving node, the healer shortened it each round; final title clean = OK.
     - `title_healed … (repeated heal → thrash)` or `title_heal_stale` = real; investigate.
   - `sibling_twin … (distinct content → title collision)` = two real facts sharing a
     title (a known §10 design-call gap, not a dedup bug). `(same content → dedup miss)`
     = investigate.
   - `title_invisible` (zero-width/format char in a live title) = a REAL bug — fix.
3. Verify the .map substance: read `tables.nodes` — titles on-topic, one node per
   subject (no twins), statuses honest (a rejected answer is `<retracted>`/`<open>`, not
   `<answered>`; user corrections and dead-link reports live in the details layer, so
   check `memory_details` before calling evidence "dropped"), no narration.
4. Clean up (do the kill ALONE — killing a codex child in a `&&` chain aborts the rest
   of the line via the signal):
   ```
   pids=$(pgrep -f '/tmp/hm-codex'); [ -n "$pids" ] && kill $pids   # its own command
   rm -f src/eval/scenarios/replay-real-*.map; rm -rf tmp; rm -rf /tmp/hm-codex-*
   ```
   Reap codex children BY PID — never `pkill codex` (it could hit the live server's
   inference), never the server pid, never port 8790.
5. Append one line to `docs/E2E-LEDGER.md`: scenario, pass/fail, node/guard counts, a
   one-line substance note, any finding.

## Findings
- Real product bug → verify against product semantics (read the relevant code) then fix,
  prove it by re-running the failing case, push.
- Design/behavior judgment → add a dated `§10 sighting` to docs/MIND.md with the evidence
  and a proposal; do not change behavior. Surface confirmed findings in the Discord digest.

## Coordination with the Claude loop
The 3.9 GB box runs ONE codex e2e at a time — if codex runs here it must alternate with
the Claude loop, not overlap (two concurrent codex startups OOM the box). Prefer running
codex's loop on a separate machine/environment pointed at its own checkout. Keep separate
ledger lines (prefix "codex:") so the two testers don't clobber each other's notes.

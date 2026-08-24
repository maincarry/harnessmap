# The filer, redesigned (proposal, 2026-08-16)

Trigger (Mark): the filer over-produces on simple exchanges, its prompt has
accreted duties past a small model's reliable instruction budget (park-all
regressed 4×, gate at floor), and as a plugin it should run on the user's
existing Claude Code auth, not a separate API key.

## 1. Mandate — what the filer MUST do

M1. Capture the USER side faithfully: decisions, constraints, questions,
    reversals, meta-instructions→tasks, and any new topic (M61 guarantee).
    User words are sacred; never editorialize them.
M2. Place under the light; out-of-scope → "to sort" with provenance (guarded).
M3. Merge, never duplicate; statuses are earned per-node states (guarded).
M4. Title what it creates (minimal titles).

MUST NOT: restructure (suggest only — M24), mass re-status (guarded — M61),
invent content, editorialize.

## 2. Content policy — the fix for over-production

Today every round mines the assistant's reply into evidence nodes (the WiFi
round: 7 nodes, 5 from the assistant's advice). New policy:

- USER-side capture: unlimited (it's the point).
- ASSISTANT-side capture: selective —
  (a) the direct answer to a user question → recorded as the answer-gist ON
      the question node (status answered), not as separate nodes;
  (b) recommendations the user ENGAGED with (accepted, pushed back, chose);
  (c) at most ONE floated node for the agent's key unengaged proposal.
  Cap: ≤2 assistant-derived nodes per round unless the user engaged more.
- Everything else the assistant said is recoverable via provenance (the
  transcript is kept); the map records the topics, not the lecture.

Expected effect on the WiFi round: 7 nodes → ~3 (topic, the switch question
answered, one key recommendation floated).

## 3. Reliability architecture

Phase 1 (now): SLIM the single pass — move the content policy in, move
title-polish out (existing async title pass), keep the four guards. Measure
against the gate (median of 3 runs).

Phase 2 (if wobble persists): TWO-PASS split —
- Pass A CAPTURE (tiny prompt, no map): extract a typed capture list from the
  round: {speaker, kind, text, engaged}. Pure extraction — the most reliable
  thing a small model does.
- Pass B INTEGRATE (map + capture list): place/merge/status/title. Prompt
  shrinks by everything Pass A took.
Guards remain mechanical and post-hoc in both phases (the standing lesson).

Gate hardening either way: median-of-3 runs; add the travel corpus as a
second graded scenario; track score history in-repo.

## 4. Auth — run on the user's Claude Code subscription

Today all map models call the API directly with ANTHROPIC_API_KEY. Plugin
users already have working CC auth (subscription OR key). Design: an
`Inference` backend abstraction —

- `api` backend (current): direct SDK, json_schema structured outputs.
  Preferred when a key is present (strongest output enforcement).
- `agent-sdk` backend: the Claude Agent SDK's query() with tools off and
  maxTurns 1 — runs on WHATEVER auth Claude Code has, subscription included.
  No json_schema enforcement → strict-JSON prompt + parse + one retry with
  the parse error fed back; our guards already catch structural garbage.

Auto-detect: ANTHROPIC_API_KEY set → api; else agent-sdk. Usage lands on the
user's normal CC account either way; no second billing relationship.

## 5. Monitoring — knowing the filer is healthy

1. **Turn beat** (shipped, M62): seen → replying → filing → filed ✓, with a
   staleness alarm when observation breaks.
2. **Round telemetry table**: per round — latency, tokens in/out, alteration
   count, guard triggers, parse retries, backend. Surfaced as a small health
   panel in the map UI (rounds today, error rate, guard-cap count).
3. **Filer regret rate** (the truest metric, free from our own event log):
   how often the user deletes/edits/re-places a filer-created node within
   24h of its creation. Computed nightly from map_events; charted.
4. **Sampled judge**: every Nth round, one cheap judge call grades "did the
   filer capture the user's commitments from this exchange?" (0–2). Rolling
   average = live quality signal between gate runs.

## Decisions needed (Mark/Jacob)

D1. Content policy caps as specified? (≤2 assistant nodes, answer-gist on
    the question node)
D2. Auth backend abstraction with auto-detect?
D3. Phase 1 slim-first, two-pass only if the gate still wobbles?
D4. Monitoring set: telemetry + regret rate + sampled judge?

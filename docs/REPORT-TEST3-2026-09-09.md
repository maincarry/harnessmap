# Test 3 — Work: does the map's advantage survive contact with a task?

Run 2026-09-09, 9:58–10:12 pm ET (2026-09-09 01:58–02:12 UTC). Commit 9882b7b + flag fix. Report written the same night, as Jacob asked.

## The question

Test 2 showed a sealed Claude recalls facts better when briefed by the map than by the transcript at the same budget. Test 3 asks whether that survives contact with a real deliverable: when the agent must **write something the project would actually ship**, is the map-briefed version more correct, and does it stop quoting dead decisions as live?

## Method

- **Five frozen tasks**, chosen from the project's own history so both arms can know the material: the "to sort" tray help section (W1), the release note for import at scale (W2), the three moves explained to a new user (W3), the sign-in & billing note (W4), how the agent's block is decided each turn (W5). Writing tasks, 120–300 words each. Tasks, checklists and rulings were frozen before the run.
- **Two arms at equal budget.** Map-briefed: the product's own block under per-task re-aim (auto-focus + auto-light on the task text). Transcript-briefed: the most recent portion of the project's modification log (the snapshot at a27a94f), cut to exactly the map brief's length for that task (46–53k characters).
- **Sealed agent**: `claude -p` on sonnet 4.6, tools denied, a canary proving the seal before any cell. Two reps per task and arm → 20 outputs.
- **Two outcomes**, graded by two independent graders (haiku) on every output, JSON schema, kappa reported:
  - *Correctness*: each checklist claim is **present**, **absent**, or **contradicted** (29 claims across the five tasks).
  - *Contradictions*: for each of 14 current rulings, does any sentence contradict it (state the opposite, or present an overturned version as current) — the downstream signature of stale memory.
- **Registered before the run**: "map-briefed outputs are at least 15 points more correct and no more contradictory than transcript-briefed at equal budget." n = 5 supports direction only.

## Result

Graders agreed at **kappa 0.90** on 116 double-graded verdicts. No re-aim refusals.

| Outcome | Map-briefed | Transcript-briefed | Paired difference |
|---|---|---|---|
| Checklist claims present | **71%** | 44% | +27 points (map ahead on 4 tasks, tied on 1) |
| Contradictions of rulings, per output | **0.40** | 1.05 | −0.65 (map fewer on 3, transcript fewer on 2) |

**Verdict against the registered claim: supported at face value** — direction only.

Per task:

| Task | Map | Transcript |
|---|---|---|
| W1 · to-sort tray help | 79% · 0.5 contradictions | 8% · 1.8 |
| W2 · import-at-scale release note | 83% · 0.5 | 79% · 0.0 |
| W3 · the three moves | 50% · 0.0 | 29% · 1.5 |
| W4 · sign-in & billing | 60% · 0.5 | 20% · 2.0 |
| W5 · how the block is decided | 83% · 0.5 | 83% · 0.0 |

## Reading

The shape is the recall test's age classes again. W2 and W5 rest on the last two weeks of the log, which the transcript's recent window contains: both arms score ~80% and the transcript arm contradicts nothing. W1, W3 and W4 rest on rulings from late August that fell outside the window: the transcript-briefed agent wrote plausible product prose that was wrong — its billing note says the agents "run on the API key you connected at setup" (the ruling since M103 is the opposite: the subscription path can never bill the key), its tray section invents tidy "respecting to-sort as a staging zone" — and the map-briefed agent got the rulings right.

So the map's value in work is the same as in recall: it carries what fell out of the window, and it keeps the agent from asserting stale rules as current. Where the transcript has the material, the two are even.

## What this does and does not show

- It shows direction, on five tasks, with tasks and checklists written by the builder. A headline claim needs the founders' own tasks and a larger set.
- It does not test code tasks (making the change in the repo with tools). Writing tasks were chosen first because they are clean; a code pilot is the honest next version.
- The 20 outputs are archived (docs/archive/work-run-2026-09-09/cells.json, local only) for a blind read by the founders — the version without the builder's hand in the grading.

## The battery, complete

| Test | Question | Result |
|---|---|---|
| 1 · Filing | Is the map built right from real rounds? | Rulings kept 100%; currency at the floor; failure mode = bystander nodes |
| 2 · Recall | Does the map beat the transcript at equal budget? | +0.6 on a 2-point scale, five runs, two protocols |
| 3 · Work | Does the advantage survive a real deliverable? | +27 points correct, 2.6× fewer contradictions |

Three tests, one direction. Cost figure, as the design requires: the map arm's brief averaged 49k characters, the same as the transcript arm's by construction.

## Sanity check (2026-09-10, 5:50 am ET, on Jacob's "sanity check")

Done by hand on the archived cells (docs/archive/work-run-2026-09-09/cells.json, local).

- **No answer-key leak.** The checklists were written from the map; the map brief carries the claims' rare words in full for 1/6 (W1), 2/6 (W2), 4/6 (W3), 0/5 (W4), 2/6 (W5) claims — the transcript brief for 0, 0, 3, 0, 4. The map arm wrote from the map's content, not from the key.
- **The transcript arm genuinely lacked the material.** Its brief has 0 mentions of "to sort" (W1), "three moves" (W3), "subscription" / "API key" (W4). By construction: the baseline is the last ~50k characters of the log, not a search of it. A retrieval baseline (the log's passages nearest the task's words, same budget) is the tougher, honest next comparison — the test's weak point.
- **All 15 contradiction verdicts read against the cited sentence.** Three misgrades, all charged against the map: W5 rep0, both graders counted "the deliverable does not state X" as a contradiction (absence ≠ contradiction); W2 rep1, one grader counted a sentence that agrees with the ruling. Corrected contradictions per output: **map 0.25** (reported 0.40) vs transcript 1.05 (unchanged). The transcript's are real: tidy picks up to-sort items (invented), zoom changes what the agent sees (wrong), agents bill your API key (the opposite of M103). One transcript verdict is weak (W3, "the focus node and its ancestors are never dimmed"); left as is.
- **Correctness verdicts** spot-checked on the extreme cells (W1 transcript 8%, W4 map 60%): fair. W4 map lost a point for naming the dev-mode button instead of the sign-in & billing button — a correct deduction.

Verdict: the result stands; the contradiction gap was understated. Next run: the grader prompt says "absent is not contradicted"; the baseline is retrieval, not the tail.

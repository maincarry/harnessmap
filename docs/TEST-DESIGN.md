> Doctrine v2 of 2026-09-03; results and the standing measurement rules are docs/MIND.md §4.10 and §11.

# The test battery, redesigned from the thesis (v2, 2026-09-03)

Status: for Jacob + Mark's review. Supersedes v1 (which organized tests by
instrument; this version derives every test from the product's reason to
exist). The Measurement Doctrine artifact still governs procedure.

## 0. The thesis, and what follows from it

The product's claim: **a small, organized, current, user-aimed briefing
beats the same-sized slice of raw history.** Four mechanisms carry it:

- A. Density — commitments per character: the map keeps decisions, sheds dialogue.
- B. Index — memory organized by topic, matching how questions arrive.
- C. Currency — later rulings overwrite earlier ones; dead decisions read as dead.
- D. Aiming — focus and light carry the user's judgment of what matters now.

Consequence for testing: wherever the thesis is a comparison, the test must
be that comparison. The honest opponent is the transcript slice at equal
budget — the memory a user actually has without us — not an empty briefing.

## 1. Test 1 — Filing: is the map built right?

*Checks mechanisms A and C at their source: the filer creates density and
currency, or fails to.*

- Replay a frozen ~25-round segment of this project's real conversation
  through the production filer into an empty map.
- Grade the finished map with frozen code checks, two classes:
  - **Ruling checks** (mechanism A): one per documented commitment in the
    segment, each citing its M-number — the decision exists, correctly
    statused, correctly placed.
  - **Currency checks** (mechanism C, new, and the point of the redesign):
    the segment deliberately includes every reversal it contains — for each,
    the map must show the later ruling as live and the earlier as dead.
    Tonight's inversion failure is this mechanism breaking downstream; this
    check class catches it at the source.
- Score: N of M per class, median of 3 runs, hard floor per class. A filing
  change that keeps rulings but breaks currency must fail visibly.

## 2. Test 2 — Recall: the head-to-head the thesis makes

*The primary instrument. Measures A+B+C+D together against the honest
opponent, and decomposes D.*

- **Primary comparison, registered in advance:** map briefing vs transcript
  slice, equal character budget, on the question bank. The transcript arm
  gets the most recent characters of the real conversation up to the same
  budget — exactly what a user's agent has today. Registered claim per run:
  direction and minimum difference.
- **Conditions (each declared, never inherited):**
  - map, realistic aiming — focus on the most recently worked topic, its
    chapter lit plus the two most recently touched other chapters.
    *Definition needs a founder ruling; this default is derived from usage,
    not arbitrary, but it is still my proposal.*
  - transcript, same budget (the opponent).
  - map, everything lit (debugging only: serving capacity; not a judged number).
  - dark (floor; validity check — the ceiling and floor must separate or
    the run is invalid).
  - The D-mechanism's contribution = realistic-aimed minus everything-lit,
    isolated by subtraction within the same run.
- **The bank:** grow 24 → 69 (the power-computed size); every item carries
  its frozen required fact, known wrong answers, ruling citation,
  provenance, author; founder-authored items close the independence gap.
  New: an automatic per-item check whether the fact exists on the map at
  all, so every score decomposes mechanically into: recalled / served-but-
  wrong / never-filed (staleness).
- Procedure per the Doctrine: sealed cells (proof-based canary), blind
  0/1/2 grading (declining is never 0), 20% double-graded with
  chance-corrected agreement ≥ .70 or self-quarantine, three repetitions,
  paired per question, noise floor published, ledger line with caveats.

## 3. Test 3 — Work: does the advantage survive contact with a task?

*Convergence evidence that A–D translate into output, not just recall.*

- 5 frozen tasks (real deliverables: the release note, the ruled change).
- **Comparative like T2**: map-briefed vs transcript-briefed at equal budget
  — not vs nothing, because "any memory helps" is not the claim.
- Two outcomes: task correctness (frozen per-task checklist) and
  **contradictions of current rulings** (each output sentence judged blind
  against the rulings list — mechanism C's downstream signature: quoting a
  dead decision as live).
- n=5 supports direction only; registered as convergence evidence — a
  headline claim requires T2 and T3 to agree.

## 4. Test 4 — Cost: the price tag on every gain

- Unchanged: map tokens ÷ chat tokens per session, from the existing meter,
  printed beside every reported gain. Plus one derived figure that makes
  mechanism A visible: required-facts present per 1,000 characters of
  briefing vs the same for the transcript slice — density, measured.

## 5. What each result will and will not mean

- T2 map > transcript at equal budget, with T3 agreeing in direction →
  the thesis holds on this project (external validity still bounded to us
  until pilot-user items exist).
- T2 all-lit failures → serving defects (the inversion class); fix serving.
- T2 never-filed misses → staleness; fix is live filing or re-import, not serving.
- T1 currency failures → the filer, not the composer, is the broken link.
- Any difference below the published noise floor → no sentence may be
  written about it.

## 6. Rulings requested

1. The realistic-aiming definition (§2) — approve my usage-derived default
   or state your own.
2. The primary comparison (map vs transcript at equal budget) as THE judged
   number — confirm.
3. T1's new currency-check class and per-class floors — confirm.
4. Founder items for the bank (5 each) — still the one thing only you can do.

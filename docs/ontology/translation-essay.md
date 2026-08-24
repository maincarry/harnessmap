# Simulated map-update history — essay conversation

> The per-round translation loop (map-conditioned summary → whole-map alteration) run
> over the raw essay transcript in [example-essay.md](example-essay.md), with the map
> shown as a tree. Eager node creation (nodes at topic introduction, prune later) —
> pending Jacob's confirm.

**Legend:** ✓ accepted/decided · ○ open · ⚠ tentative/floated (agent-authored unless
noted) · ✗ dropped · ⏸ parked · ● ratified-by-work · ☐ task · Δ altered this round

---

**R1 = T1** — "ok essay time" → create root.
```
essay
```

**R2 = T2** — agent proposes 4-section outline. Eager: tentative subnodes, author-marked.
```
essay
├─ intro ⚠
├─ arguments ⚠
├─ copyright-angle ⚠
└─ conclusion ⚠
```

**R3 = T3** — "why is copyright in there" → drop one node; a DECISION is born from a rebuke.
```
essay
├─ Δ angle: authorship, NOT copyright ✓
├─ intro ⚠ · arguments ⚠ · conclusion ⚠
└─ Δ ✗ copyright-angle
```

**R4 = T4–T6** — clarification in flight (art-vs-authorship). **No alteration.**

**R5 = T7** — "ok the second one" lands it.
```
essay
├─ angle ✓
├─ Δ target: authorship-as-attribution ✓   (provenance T4–T7)
└─ intro ⚠ · arguments ⚠ · conclusion ⚠
```

**R6 = T8** — thesis v1 arrives (agent-proposed). `Δ thesis ○ v1`

**R7 = T9** — "too strong" → same node, revision pressure. `Δ thesis ○ (v1 rejected: over-claims)`

**R8 = T10–T11** — v2 rejected ("terms of service lol"); the rebuke's lasting half
becomes a constraint, flagged as *reasserted from prior context*:
`Δ thesis ○ (v2 rejected: register)` · `Δ + audience: plain language ✓`

**R9 = T12–T13** — v3 lands, plus a micro-constraint.

*Snapshot after T13:*
```
essay
├─ angle: authorship, not copyright ✓
├─ target: authorship-as-attribution ✓
├─ audience: plain language, general readers ✓
├─ thesis: "picks, shapes, stands behind it → author" ✓ (3 revisions)
│   └─ phrase-lock: "stands behind it" ✓
└─ intro ⚠ · arguments ⚠ · conclusion ⚠
```
Thirteen turns of mess; seven pointables; valid at every intermediate round.

**R10 = T14** — agent proposes argument lines. Eager again:
```
├─ arguments
│   ├─ selection ⚠ · intention ⚠ · process ⚠
```

**R11 = T15–T16** — "what do you mean process" + explanation. **No alteration.**

**R12 = T17–T18** — "isn't that just your intention one" → merge is a map alteration,
not a new node: `Δ intention/craft ⚠ (absorbed process)`

**R13 = T19** — user starts working in selection → ratified-by-work, children appear:
```
│   ├─ Δ selection ●
│   │   ├─ ev: photography contact sheets ✓
│   │   └─ ev: duchamp ○ (user-floated, "maybe")
```

**R14 = T20–T22** — register violation and rewrite. **No map alteration** — the
correction lives in the audience constraint's provenance (enforced, not changed).

**R15 = T23–T25** — the reversal: an item killed by its own creator six turns later.
`Δ ✗ ev: duchamp ("too cliche")` · `Δ + ev: hip-hop sampling ✓`

**R16 = T26–T27** — user opens the intention argument (ratified-by-work); agent brings
data with an internal discrepancy:
```
│   └─ Δ intention/craft ●
│       ├─ q: iteration data? ○
│       └─ ev: Study S ⚠ (mean 40 / median 12 — unresolved)
```

**R17 = T28–T30** — user catches the discrepancy; evidence content is CORRECTED by the
user, and a citation decision appears:
`Δ q ✓ answered` · `Δ ev: Study S → median 12 ✓ (mean 40 → provenance)` · `Δ + cite median, not mean ✓`

**R18 = T31** — connected subnode, exactly where it belongs:
```
├─ thesis ✓
│   └─ Δ objection: "it's all just curation" ○ (user)
```

**R19 = T32** — agent's premature rebuttal: `Δ + reply: selection-density ⚠` (floated, unengaged)

**R20 = T33** — "I didn't ask you to answer it" — **no map alteration**; the reply stays ⚠.

**R21 = T34** — solicited assessment annotates the objection:
`Δ objection ○ + assessment: "strongest objection; not fatal"`

**R22 = T35** — park the subtree; two tasks for next session; intro upgrades from
tentative to planned.

*Final map after T35:*
```
essay
├─ angle: authorship, not copyright ✓
├─ target: authorship-as-attribution ✓
├─ audience: plain language ("my mom should get it") ✓
├─ thesis: "picks, shapes, stands behind it → author" ✓ ³ʳᵉᵛ
│   ├─ phrase-lock: "stands behind it" ✓
│   └─ ⏸ objection: "it's all just curation" ○
│       ├─ assessment: strongest, not fatal
│       └─ reply: selection-density ⚠ (agent, never engaged)
├─ arguments
│   ├─ selection ●
│   │   ├─ ev: photography contact sheets ✓
│   │   ├─ ✗ ev: duchamp (cliche)
│   │   └─ ev: hip-hop sampling ✓
│   └─ intention/craft ● (absorbed process)
│       ├─ q: iteration data ✓ answered
│       ├─ ev: Study S — median 12 ✓ (mean 40 in provenance)
│       └─ cite median, not mean ✓
├─ intro ☐ draft next session
├─ conclusion ⚠ (agent-proposed, never touched — prune candidate)
└─ ☐ revisit curation objection next session
```

## Anatomy of a round (from the detailed R1–R5 walk, Discord 2026-07-19)

Per message (finest grain — agent turns fire the loop too):

1. **Read** the map M + the **exchange buffer** (scratch state beside the localization
   pointer: pending clarifications, unresolved references).
2. **Summarize** the new message in M's vocabulary (map-conditioned).
3. **Classify** each assertion: **map-scoped content** vs **exchange-scoped process**.
   Dialogue mechanics (clarifying questions, confirmations, puzzlement) never become
   nodes — test: would the user ever later point at it? Eagerness applies to introduced
   TOPICS only.
4. **Derive alterations** under author/status rules: user-declared → live/✓ (a user
   asserting their own standing commitment skips "proposed"); agent-proposed → ⚠
   tentative; user rebuke → drop the target, and usually CREATE a ✓ decision from the
   rebuke's lasting half.
5. **Apply**; update localization pointer + exchange buffer.

Extra mechanics surfaced: definite-reference lookup on session open ("THE authorship
thing" → query project map; found → reactivate/promote, not duplicate); rhetorical-
question detection (surface question, pragmatic rejection); affect is not state ("user
is annoyed" never becomes a node); no-ops are correct behavior, not laziness (R4, R5).

## Redescription / partial recombination (grill continuation)

When the user redescribes existing categories ("selection and craft are secretly the
same point — it's all judgment; the real second argument is commitment"):

- **Map-level speech** is a third register beside content-level and process-level: the
  map itself is the referent. It translates into re-carving alterations, not items.
- **Re-carves are GATED** (unlike ordinary alterations): the system builds the full
  proposal — new nodes, per-item redistribution, leftovers — and applies it on one
  confirm. Redistributing committed content is where silent misfiling is most dangerous.
- **Old categories tombstone with forwarding aliases** — "the selection argument" still
  resolves next week, forwarding into the new node. Identity rule: partial recombination
  tombstones BOTH parents; a node keeping ~most of its content survives renamed instead
  (continuity threshold; assessor's call, user's override).
- **Leftovers go homeless, never force-fitted.**
- **Damage walks as usual:** stale-content flags on items that name old categories;
  parent's absorbed summary line → rewrite advised; other chats' pointers forward;
  fader settings inherit with a flag.
- **Register applies at map level too:** "hmm, 2 and 3 kind of overlap?" = a floated
  re-carve held as a grey GHOST OVERLAY over the current carving until ratified or
  dismissed. Musing about structure must not restructure anything.
- The map's own history keeps the old carving one alteration away — bad re-carves revert.

## What the simulation shows

1. **Rhythm:** 22 rounds → 15 alterations, 5 explicit no-ops. Roughly a third of rounds
   don't touch the map; the translator must be comfortable doing nothing.
2. **Every intermediate map was valid** — at T13 or T25 the tree was a truthful, usable
   seed. Nothing waited for the end.
3. **Rebukes and corrections are the richest source of ✓ nodes** (angle, audience,
   cite-median all born from pushback).
4. **Eager creation's cost is visible and small:** `conclusion ⚠` sat untouched for the
   whole chat — one line of noise, one prune. Its benefit showed at T17: the
   process/intention merge was a well-defined alteration because both nodes existed.
5. **The final tree is next session's seed, verbatim.** T35's "remind me about the
   curation thing" is already sitting there as a task node.

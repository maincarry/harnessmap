# Ontology working docs — containers & items

> Working docs from the 2026-07-19 grill session (Jacob × Claude, Discord). The three
> example files are RAW CONVERSATIONS ONLY — realistic transcripts with misunderstandings,
> corrections, and multi-round exchanges. They are the input corpus for the translation
> exercise, which is deliberately deferred (to be done together, not unilaterally).
> The schema below is the agreed baseline from the grill session; the transformation
> rules at the bottom are PARKED HYPOTHESES from a premature first attempt — to be
> tested against these transcripts when we do the translation. Not merged into DESIGN.md.

## The two-kind base

**Container** — a location that gives addresses. Comes from the deliverable's part-whole
spine (essay → section; trip → leg → day). When no deliverable exists, the chat itself is
the default container. Containers can be `live | provisional | cut`.

**Item** — the deliberation atom; the thing users point at and operate on in speech.

```
item = (id, type, content, status, author, home container, role-links, provenance)
```

`author ∈ {user, agent}` — agent-created items (proposals, found evidence, raised
questions) enter floated/noted and are promoted only by user engagement. `provenance` =
the turns the item came from, including status-change history.

Seven types, domain-independent:

| Type | Lifecycle | Example pointing |
|---|---|---|
| `claim` (incl. ideas) | floated → proposed → accepted / rejected | "drop objection 1, that's bullshit" |
| `question` | open → answered / mooted | "the open question about collage" |
| `option` | live → chosen / dropped | "the ryokan option" |
| `decision` | proposed → decided / reversed | "our call to target general readers" |
| `constraint` | active / hard → relaxed / lifted | "the budget cap" |
| `evidence` | noted → cited / retracted | "the Study S stat" |
| `task` | todo → doing → done / dropped | "the visa todo" |

Universal status overlays (apply to any type): `parked`, `dropped-as-noise`.

**Role-links** (typed edges between items, may cross containers):
`supports · objection-to · replies-to · answers · motivated-by · satisfies · blocks · chooses`

## Rules discovered by the examples (see findings in each file)

1. **Containers follow the deliverable; items attach by role-links that cross containers.**
   "Objection 1 to argument 2" is resolved via role-link, not container address — pointing
   uses both address paths and role paths.
2. **Moving ≠ re-linking.** Re-homing an item (new container) and re-targeting its
   role-links are different gestures; the UI must keep them distinct.
3. **Lazy granularity (split-on-point).** Items are as fine as pointing has needed, no
   finer. Pointing *inside* an item ("its second premise") triggers a split proposal.
4. **The spine is downstream of items.** Container order and even container *existence*
   can hang on decisions/options (a provisional "Nara" leg tied to an open question).
5. **Moves can stale content.** An item whose text assumes its old home gets a mini
   rewrite flag on re-home — the re-parent damage rule, at item scale.
6. **Homeless items are fine indefinitely.** Crystallization proposes containers when a
   cluster coheres; it never forces adoption. The mess is a feature.
7. **"Goal" is not a primitive.** A goal-node = a container plus its live items — a view,
   not a stored kind.

## PARKED: transformation hypotheses (premature — test later, together)

8. **Extraction is incremental, per-turn — not batch.** Items are born and mutate
   mid-chat; statuses have timelines. Save points consolidate; they don't extract.
9. **Commitment-detection is the core skill, and it's register-sensitive.** "Not
   copyright" and "no red-eyes, ugh" are binding; "I'm going to quit lol" is not. The
   extractor under-extracts from venting and lets the user raise the register. When
   unsure: floated (one shrug to dismiss).
10. **Casual finality:** roughly half of all items in the examples came from asides, not
    deliberate statements. Missing them is how you lose the user's trust ("I TOLD you").
11. **Agent items are second-class until engaged; containers require ratification.**
    Engagement promotes a floated agent item; only explicit user uptake creates a
    container. This is the anti-spam rule for the map.
12. **Refinement ≠ duplication.** The same item tracked through paraphrase and revision;
    identity = role-in-structure, not wording.
13. **Flip-flops apply in utterance order** ("scratch it — wait no, keep as maybe" ends
    parked), full history kept.
14. **Most content never becomes items.** Drafts, comparisons, search process stay in the
    log (recall reaches them). Items are the skeleton, not the flesh.
15. **Dropped ≠ deleted:** dropped items revive by pointing, with history.
16. **Crystallization trigger observed:** user overload ("ok this is a lot") → agent
    reflects the shape back (that's the proposal) → one-word ratification.

## The raw conversations

- [example-essay.md](example-essay.md) — deliverable-spined; thesis negotiated over
  multiple rounds, register corrections, user reverses own instruction, agent overreach
- [example-travel.md](example-travel.md) — constraint- and option-heavy; wrong
  assumptions corrected, user fixes the agent's math, flip-flops, received-wisdom vs data
- [example-exploration.md](example-exploration.md) — no deliverable; agent misreads
  register twice, misrecalls an old idea, conversation reframes itself mid-stream

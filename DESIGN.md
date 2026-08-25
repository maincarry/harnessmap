# Harnessmap — Design v2

*The user controls the flow tangibly, by understanding and prioritizing the goals of the conversation in the way they want.*

> **Status:** endorsed design. v1 (2026-07-17, history-based) is archived at
> `docs/archive/DESIGN-v1.md`. v2 reflects the goal-based redesign developed with Jacob
> (Discord, 2026-07-17 → 07-19) and Mark's alignment + MVP rulings (2026-08-12).
> Working docs & validation corpus: `docs/ontology/`.

---

## 0. The conceptual point (canonical — Jacob, 2026-08-25)

A user needs to understand exactly **three things**, and everything else follows:

1. **The map** — a tree of your work that files itself. Self-evident to anyone who has used a file manager or a decision tree.
2. **Focus ▶** — *talk about this.*
3. **Light / dim ☀** — *keep this in the background / let the AI forget it* (you still see everything).

All other features are peripheral: they either automate upkeep of these three (dots, nudges, tidy), operate them in plain words (the map guide), or protect them (undo, approval gates). Every surface that explains the product — tour, README, guide orientation — states these three and stops.

---

## 1. Thesis

Working with an AI today means one long chat: it fills with junk, side-topics pollute the
main work, nothing is findable, and after a week away you re-read everything to remember
where you were. The deep cause: **chat products organize your thinking by time**, and
time is the wrong index for work.

Harnessmap replaces the long chat with a **map of the work itself** — what you're trying
to do, what's decided, what's open, what's parked. You still converse with the AI; the
chats become short working sessions, and the map is the lasting record.

The product promise, in three verbs: **see** everything that matters at a glance,
**point** at any piece of it in plain speech, **change** it directly — and the system
keeps everything consistent with your change.

The analogy that compresses it: a chat harness makes you work inside the *commit log*;
harnessmap moves you into the *codebase*, with the log kept underneath for provenance.

---

## 2. The two layers

Everything in the system lives on one of two layers, connected by exactly one bridge.

| History layer (events) | Goal layer (meaning) |
|---|---|
| turn | item |
| chat | map alteration set / doc revision |
| a node's chat history | a node's revision history |
| the log | the map |
| ordering: happened-before | ordering: frames / summarizes |
| immutable, total, singular | editable, partial, plural |
| attention by recency | attention by **focus + lit set** |

- **The log** is append-only and never edited. Every turn of every chat is kept, forever,
  reachable by recall. Nothing the user does on the map can lose history.
- **The map** is the editable structure of meaning — the thing users navigate, point at,
  and rearrange. Many valid maps could describe one history; the user's map is theirs.
- **The bridge** is the per-round translation loop (§4) — the ONLY mechanism that turns
  history into map content. Map operations never touch the log; chat operations never
  directly edit the map. Any feature ambiguous about its layer is a design smell.

A chat is temporal scaffolding: people and models think by conversing in time. When its
rounds have been translated, the chat has done its job and archives to the log; what
remains on the map is the meaning it produced.

---

## 3. Ontology: nodes all the way down (v3, 2026-08-14)

**The carving principle:** a unit is whatever the user can point at and operate on in
speech — *"drop objection 1 to argument 2, that's bullshit."* A unit has a location (its
address is part of its identity), a separable identity (surgery on it leaves the rest
standing), and pointability (a plain noun phrase reaches it). The user's referential
habits ARE the ontology; the system only suggests.

**One kind, nothing else** (Jacob's v0.4 ruling — "there are only nodes and sub-nodes,
so that everything are topics"; it replaced the earlier containers+items split, whose
seam made typed lines dead ends and forced the filer to invent duplicate sibling
folders when a claim grew a discussion):

```
node = (id, parent, content, type?, status, author, children, role-links, provenance)
```

- A **"topic"** is just a node whose children matter more than its own sentence
  (rendered bold; `type` empty). A claim/option/question is a node that may grow
  children of its own: evidence files UNDER the claim it supports, objections UNDER
  the option they attack, sub-questions UNDER their question.
- Every node is zoomable, focusable, lightable, growable (+), and deletable — one
  vocabulary of operations (`create_node / update_node / move_node`), one code path,
  no leaf-vs-branch wiring to miss.
- Reserved (per Jacob, post-MVP): per-node **artifacts** — uploads and docs/PDFs
  generated under that node's focus.

Seven suggested types, domain-independent (validated against essay / travel /
free-exploration transcripts in `docs/ontology/`) — open vocabulary, the translator
may coin better labels:

| Type | Lifecycle |
|---|---|
| `claim` (incl. ideas) | floated → proposed → accepted / rejected |
| `question` | open → answered / mooted |
| `option` | live → chosen / dropped |
| `decision` | proposed → decided / reversed |
| `constraint` | active / hard → relaxed / lifted |
| `evidence` | noted → cited / retracted |
| `task` | todo → doing → done / dropped |
| *(heading)* | live / provisional |

Universal overlays: `parked`, `exploratory`; **`removed` is the ONE dead word**
(user deletions and merged-away duplicates — the legacy container word `cut`
normalizes to it). Role-links (typed, may cross branches): `supports · objection-to ·
replies-to · answers · motivated-by · satisfies · blocks · chooses` — used for
cross-branch relations; the primary relation IS the hierarchy (evidence sits under
its claim, not beside it with a link).

Load-bearing consequences:

- **"Goal" is not a primitive.** A goal = a node + its live subtree — a view,
  not a stored kind.
- **`author ∈ {user, agent}`:** agent-created nodes enter floated/noted and are
  promoted only by user engagement. This is the anti-spam rule — the agent cannot
  colonize the map with its own suggestions.
- **Lazy granularity:** nodes are as fine as pointing has needed, no finer. Pointing
  *inside* a node ("its second premise") triggers a split proposal.
- **Provenance everywhere:** every node links to the turns it came from, including its
  full status-change history. `node ← round summary ← raw turns` is the audit chain.
- **Dropped ≠ deleted:** dropped nodes stay visible and revive by pointing at them;
  `removed` nodes leave the view but survive in the event log.

---

## 4. The bridge: per-round translation

Translation is per-round, never an end-of-chat batch — that is what connects the
history-based layer to the goal-based one continuously.

```
Per round (each message, agent turns included):
  input:  M (current map), buffer (exchange scratch state), R (new message)
  1. S ← summarize(R), phrased in M's existing vocabulary
  2. classify each assertion in S:
       content-level  → map alterations
       process-level  → exchange buffer only (clarifications, confirmations)
       map-level      → re-carve proposal (§6; gated, deferred from MVP)
  3. alterations: update a node | new connected subnode | new detached node
  4. apply; advance localization pointer + buffer
```

Rules the corpus validated:

- **Map-conditioned summarization is the identity system.** Writing S in the map's
  vocabulary resolves "the claim about authorship" to *thesis* for free, and stops
  project language drifting across weeks.
- **Eager node creation:** introduced topics become nodes at introduction (tentative ⚠,
  author-marked), pruned later. This keeps every later round's alteration well-defined
  (a rebuke needs an addressable target). *(Awaiting Jacob's explicit confirm.)*
- **Commitment-detection is the core skill, and it's register-sensitive.** "Not
  copyright" and "ugh, no red-eyes" are binding; "I'll just quit lol" is not. The
  translator under-extracts from venting and lets the user raise the register; when
  unsure it floats the item (one shrug to dismiss). Roughly half of all real items come
  from casual asides — missing them is how the system loses trust.
- **Dialogue mechanics never become nodes** (test: would the user ever later point at
  it?). Affect is not state. About a third of rounds correctly change nothing.
- **Flip-flops apply in utterance order** ("scratch it — wait no, keep as maybe" ends
  parked), full history kept. Refinement ≠ duplication: one item tracked through
  paraphrase; identity = role-in-structure, not wording.
- **User assertions of their own standing commitments skip "proposed"** and are born
  decided. Definite references on session open ("THE authorship thing") query the map
  and reactivate rather than duplicate.
- **Map development rhythm** (observed in the 22-round essay simulation): the user
  plants a live root → the agent inflates grey hypothesis → user pushback converts grey
  to black or kills it → mechanics leave it untouched. The map hardens exactly as fast
  as the user commits — never faster.
- **Most content never becomes items.** Drafts, comparisons, search process stay in the
  log; items are the skeleton, not the flesh.

Full worked material: `docs/ontology/translation-essay.md` (22-round map-update history,
round anatomy R1–R5, re-carve semantics).

---

## 5. Context composition: focus + lit

*(Replaces the earlier "faders" concept — killed 2026-08-12: "40% of context" is
ill-defined; compression isn't a continuum and users can't perceive proportions.)*

Two separate needs, two simple mechanisms:

- **Inclusion** (what the model can see) — a SET: each node is **lit** or dark. Binary.
- **Salience** (what we're working on) — a POINTER: exactly **one focus node** per chat
  — the localization pointer the translation loop already maintains.

Detail level derives from role; the user never dials percentages:

```
FOCUS node      → full detail: whole item-tree, open questions, key verbatim
LIT nodes       → brief: one-paragraph summary each
ANCESTORS       → frame: one-liners (thesis, constraints never lost)
everything else → dark: absent
```

**Seeds.** A chat opens from a composed seed that states the priority structure
explicitly: "You are working ON [focus]. Background reference: [lit briefs]. Frame:
[ancestor one-liners]." Each lit node shows its token weight — the map doubles as a
context-budget dashboard.

**Mid-session.** Map changes (focus moves, lighting toggles, edits, deletions) ride in
as labeled `[map update]` headers attached to the next user message — append-only,
cache-friendly, causally ordered, and explicitly marked as harness state, never as user
words. Save points consolidate accumulated headers into a fresh clean seed.

**The exact-rewind exception (Mark's ruling).** Within your own live chat, rewinding N
turns is a verbatim, cache-friendly, instant resume — a prefix is always self-consistent.
Everything else — jumping to another node, returning after time away — re-seeds from the
map. Two operations under one "go back" gesture: continuity where it's cheap and true,
fresh focus everywhere else.

---

## 6. Operations

**Point and operate (speech is the API).** "Drop objection 1 to argument 2" resolves via
container address + role-links to one item, applies the status change, then runs damage
advice. Scoped mass-ops work ("park the whole Nara thing"), with confirm when the
resolved set is larger than the user likely means. With no addresses (homeless items),
pointing degrades gracefully to type + topic + recency — how humans point in
unstructured talk.

**Delete → damage report → advised cleanup → one confirm.** Deleting or rejecting an
item walks its links and sorts dependents: *fatally hurt* (advise delete) · *degraded*
(advise review) · *untouched* (silent). Like a refactoring tool reporting broken call
sites. Never auto-delete; the harness proposes, the user disposes. **MVP: downward only**
(what cited/used this?); upward propagation (parent summaries) and sideways (other
chats' lit sets) defer to v1.

**Crystallization (dumb v0).** With no declared project, items accumulate under the chat
container. After enough homeless items cohere, the system offers: "want me to organize
this?" — user ratifies with a word, items re-home, addresses come into being. Never
forced; the honest floor is a structured-memory chat that still supports "drop the
side-project option," which is already value.

**Restructuring — manual in MVP.** Drag items between containers; rename; create/cut
containers. Two distinct gestures the UI must never conflate: *moving* an item (re-home)
vs *re-linking* it (re-target its role-links). Re-homing can stale an item's content →
mini rewrite flag. **Re-carve automation is deferred** (spec preserved in
`docs/ontology/translation-essay.md`): map-level speech → gated reorganization proposal →
per-item redistribution, tombstones with forwarding aliases, leftovers go homeless,
ghost overlays for musing-register structure-talk.

**Fold / merge — deferred, groundwork kept.** The merge unit is a goal *subtree*, not a
session; folding = distilling a completed structure into its parent's context,
recursively composable. Under the item ontology, a fold is a batch of contributions
delivered at once — merge becomes a quantity, not a special kind of thing.

---

## 7. UI

**Two panes: the map (left) and the workspace (right).** The workspace shows either a
*chat* (live working conversation) or a *node view* (a container's items, statuses,
provenance links). The whole seam in one rule: click a node → see its contents; press
Continue → a chat opens beneath it, seeded per §5.

- **Map v0 = plain interactive tree**: indented, collapsible, status glyphs
  (✓ ○ ⚠ ✗ ⏸ ☐ ●), focus marker ▶, lit/dark state, token weights on lit nodes — the
  exact format validated in the simulation flipbook.
- **Async + pulse:** the chat never blocks on translation; the map catches up a beat
  behind, changed nodes pulse briefly; clicking a pulsed node shows the round summary
  that caused the change (the debuggable middle layer) — "what did you think I meant?"
  is always one click deep, and correcting the summary re-derives the alteration.
- **The galaxy** (goals as stars, branches orbiting, focus as your ship, lit = illuminated)
  is a future *rendering* of the same data model — deterministic orbits derived from the
  tree, gravity as motion flavor only, never a physics reshuffle. Deferred to keep v0
  honest; the renderer interface should not preclude it.

---

## 8. Architecture

```
┌──────────────────────── Browser (localhost) ────────────────────────┐
│   Map view (tree v0)        Workspace: chat view / node view        │
│   pulse · summary cards · focus & lighting controls                 │
└───────────────▲──────────────────────────────▲──────────────────────┘
                │ WebSocket (map deltas, chat stream)
┌───────────────┴──────────────────────────────┴──────────────────────┐
│                    harnessmap server (local)                         │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────────────────┐ │
│  │ Store       │  │ Session Mgr   │  │ Translator                   │ │
│  │ SQLite:     │  │ live chats,   │  │ per-round loop (§4):         │ │
│  │ log (turns) │  │ seeds, focus/ │  │ summarize → classify →       │ │
│  │ + map       │  │ lit state,    │  │ alter; async, cheap fast     │ │
│  │ (nodes,     │  │ exact rewind, │  │ model (Haiku-class);         │ │
│  │ items,      │  │ [map update]  │  │ damage walker; crystallizer  │ │
│  │ provenance) │  │ headers       │  │                              │ │
│  └────────────┘  └──────┬────────┘  └──────────────────────────────┘ │
│                         │ wraps                                       │
│                ┌────────▼─────────┐                                   │
│                │ Claude Agent SDK │  ← agent turns, tool exec,        │
│                │ (resume/fork)    │    session resume (exact rewind)  │
│                └──────────────────┘                                   │
└───────────────────────────────────────────────────────────────────────┘
```

- **Wrap, don't rebuild** (unchanged from v1): the SDK owns agent turns and session
  resume. The server owns the store, the translator, and seed composition.

### SDK integration contract (verified against Agent SDK docs, 2026-08-12)

Context management splits across exactly three surfaces, none of which fight the SDK:

1. **Session birth — we compose.** New chat = new SDK session: `systemPrompt: { type:
   'preset', preset: 'claude_code', append: <harnessmap instructions> }` keeps the full
   Claude Code harness behavior (tools, conventions) while adding ours; the composed
   seed (§5) goes in as the opening user message. All built-in tools, MCP, subagents,
   and permissions carry over intact.
2. **Mid-session — we append, never rewrite.** We are the client: our server constructs
   every user-message payload, so `[map update]` headers are prepended to the content
   blocks we send (streaming input mode). `UserPromptSubmit` hooks (`additionalContext`)
   are a secondary injection path. The SDK transcript is **strictly append-only** — no
   API can edit or excise past messages — which matches our rebuild-don't-splice rule
   exactly; deletion is always re-synthesis at the next joint.
3. **Observation — full fidelity.** The SDK streams every message (assistant, tool
   use/result, partials) — enough to maintain our own log and feed the per-round
   translator without touching SDK session files.

**Exact rewind — the one verified constraint:** `resume` + `forkSession` branch only
from a session's **latest** state; there is no fork-at-message-N API. Implementation:
**fork-at-save-point** — when a save point materializes, fork the live session
immediately (its latest state *is* the save point) and store the fork's session ID as
the checkpoint handle; exact rewind to a save point = resume that fork. Rewind between
save points falls back to prefix re-seeding from our own log (approximate, clearly
labeled). Consequence: keep auto-save-points reasonably frequent.

**Custom tools:** in-process MCP server (`mcpServers`) registers harness functions —
the `recall` tool (v1), and later map-ops the agent may call. Tool names:
`mcp__harnessmap__*`.

**Compaction risk (flagged):** the SDK auto-compacts near the context limit and no
disable flag is documented. Our chats are short by construction (re-seed at joints), so
this should rarely trigger; a `PreCompact` hook archives the transcript if it does.
Verify behavior in the first spike.
- **Single user** in MVP; the item `author` field and immutable log already future-proof
  multiplayer.
- Translator outputs stored with provenance (prompt, model) — translations are auditable.

---

## 9. MVP cut and roadmap

> **TD review outcomes (2026-08-12, adversarial fresh-eyes review — verdict: PROCEED
> WITH CHANGES).** Adopted:
> 1. **Build order inverted.** Phase A (the gate, before any app code): a headless
>    translator eval — replay the corpus through the real production translator and
>    grade against the validated simulation. Kill-criterion: if commitment-detection
>    quality is inadequate after prompt tuning, the design's core is invalid and the
>    app doesn't get built. (`src/eval/run.ts` — implemented.)
> 2. **Event-sourced map store.** `map_events` (append-only alterations, with source
>    provenance) is the source of truth; containers/items/links are a rebuildable
>    projection. This is the substrate rewind, re-translation, fold, and multiplayer
>    all need. `author` is a string id, not an enum. (Implemented.)
> 3. **Rewind semantics specified:** rewinding a chat reverts the map by demoting
>    alterations from the abandoned rounds — items they created drop to
>    floated/provisional (never silently deleted; provenance intact). Event-sourcing
>    makes this a replay-with-filter, not surgery.
> 4. **v0 trimmed further:** crystallization cut (user names the root container);
>    damage advice reduced to showing inbound links on delete (no LLM triage);
>    exact rewind ships only after the fork-at-save-point SDK spike passes (until
>    then: re-seed); mass-ops cut; click-ops ship before speech-pointing.
> 5. **SDK sessions demoted to cache:** our log is canonical; losing an SDK fork
>    degrades to re-seeding, never to data loss. Compaction/fork behavior is the
>    first SDK spike.
> 6. **Serial translation queue** with a visible "map is N rounds behind" indicator
>    and log-driven backfill after translator outages. Round N+1 waits for N.
> 7. Added open items: resolver evals ("drop objection 1" must resolve correctly —
>    same trust stakes as translation), per-round cost/latency budgets, a
>    translator-side map digest for large projects, and a **redaction escape hatch**
>    (append-only forever cannot honor "delete that, it's my password" — needs one
>    designed exception before multiplayer).

### Build log — v0 shipped & tested (2026-08-12)

Runtime: **bun** (no node on the build box; `bun:sqlite` avoids native builds).
All three tasks green:

- **Task #2 (SDK spike) — PASS.** Verified the full integration contract:
  seeded session opens, `resume` continues it, `forkSession` carries full context
  AND is isolated from the original's later turns, original keeps its own history.
  Fork-at-save-point is sound.
- **Task #1 (translator gate) — PASS, 12/12** essay expectations, 0 round errors,
  15 items (in the 12–30 band). Two real findings fixed en route:
  1. *Structured-output schema:* a single flat object with ~13 optional
     properties under `additionalProperties:false` (and `['string','null']`
     unions) hangs server-side grammar compilation → 60s+ then timeout/400.
     Fix: **per-op `anyOf` variants** with mostly-required fields — compiles
     fast, validates more precisely. (Documented inline in `translator.ts`.)
  2. *Prompt:* first run scored 6/12 — the cheap model under-detected casual-aside
     commitments and over-applied "park" globally. Fix: explicit rules for
     rebukes-are-decisions, one-commitment-one-item, narrowly-scoped mass-ops,
     meta-instructions-become-tasks. Second run: 12/12. This is exactly the risk
     the TD review said to validate first — and it was real and fixable.
- **Task #3 (v0 app) — built & e2e-tested, 11/11.** Bun server (`Bun.serve`,
  zero server deps) + two-pane UI. e2e drives the real HTTP/WS surface: chat →
  agent reply → async translation → items appear (constraint/decision/task
  extracted correctly) → user click-op (park) → cross-turn recall. Exploration
  corpus (hardest, no deliverable) also replays coherently — crystallizes a
  container from the mess, correctly moots the reframed question.

Verified surfaces: `bun run eval essay` (gate), `src/spike/sdk-spike.ts`,
`src/eval/e2e.ts`. Not yet built (deferred per the trim): exact-rewind wiring,
speech-pointing, damage triage beyond inbound-link display, galaxy view.

**Live UI verified in a real browser (2026-08-12).** Headless Chromium drove the
running app; both panes render correctly in light + dark, hover click-ops work,
and the translator built a *nested* sub-container with agent-floated options from
one message — the ontology visibly working. Two UI bugs found & fixed in the
process: (a) chat-pane transcript didn't load on first paint (a `currentChat`/
`loadTurns` startup race vs. the first WS frame); (b) the ⏸ status/park glyph
rendered as tofu in the system font (→ `‖`). Access hardened: HTTP Basic auth
(`HARNESSMAP_USERS`), `HOST` bind control, SSH-tunnel guidance (the host has a
public IP). Screenshots: `docs/ui-screens.html`.

### Build log — v0.2 shipped & tested (2026-08-14)

Jacob's 9-point critique (+ grill session; spec in the Discord thread) drove a
revision of v0. All four phases green:

- **Two-way core (was the "just a summarizer" flaw):** the chat agent now
  receives a complete map-state description EVERY turn — tree with folded
  one-liners, focus subtree in full, lit briefs, standing constraints, open
  questions, and the user's recent map manipulations (a deletion = "drop from
  consideration"). The v0 "ignore the map" instruction is gone.
- **Focus ≠ lit:** ▶ focus (re-aims the chat) and ☀ lit (background, cascades
  to descendants) are separate controls.
- **Capture everything:** no commitment floor; tentative moves land with status
  `exploratory` (dim/italic). Types are guidance — the translator coins labels
  (observed: `thesis`, `concern`, `objection`, `section`). Cleanup is
  downstream: delete (status `removed`, reported to the agent) or reorganize.
- **Integrate, don't append (Jacob's "fatal"):** per-round sticky integration
  into the goal tree; conservative upward renames; recency accent fading over
  3 rounds. Two tuning iterations were needed (statuses-as-session-moods and
  corrections-produce-both-artifacts were the failure modes) — **gate v2:
  13/13, 0 errors, 24 items in band**, including the two new checks
  (integration structure + exploration captured). The final map's T35 "park
  all of it" correctly parked only the objection thread.
- **Reorganize (a)+(i):** confirm target → conservative proposal (merge/regroup/
  rename/category + suggested deletions) → before/after preview (transaction
  dry-run) → apply/cancel. Scope-guarded to the chosen subtree server-side.
- **UI:** auto-fold of non-focus subtrees, ? legend, item edit/retype/delete,
  recency tints, exploratory rendering. **e2e 12/12** (incl. focus + reorganize
  endpoints); live-browser verified light + dark (`docs/shots/`).

Known glyph rule (twice bitten): server-rendered emoji (⏸, 🗑) tofu — use text
glyphs (`‖`, `del`).

### Build log — v0.3 shipped & tested (2026-08-14)

Jacob's zoom redesign: the chat list is gone — there is ONE map and ONE
conversation, and the map replaces the transcript as the agent's memory.

- **Map-as-memory (option b, Jacob's pick):** no perpetual SDK session. Each
  turn the agent's context is composed fresh: full map state + a rolling window
  of the last `HARNESSMAP_WINDOW` (default 10) turns + the new message. The
  transcript beyond the window matters only through what the translator moved
  onto the map — which makes translation quality load-bearing, and makes the
  map's content user-legible *as* the memory. A `[FOCUS CHANGED]` directive is
  injected the first turn after a re-aim so momentum can't carry the old topic.
- **"+" replaces "new chat":** `POST /api/nodes` creates a container anywhere
  in the tree; optional focus of the one conversation, with a durable system
  marker turn ("— focus moved to X —") in the transcript.
- **Zoom (built on recommended defaults; Z1/Z2/Z3 offered to Jacob, no answer
  yet):** click a topic name to zoom in, breadcrumbs to zoom out; zoomed view
  shows only the subtree. Zoom is per-browser view state ONLY — agent and
  translator always see the whole map. Focus is fully independent of zoom,
  with a "▶ focus is elsewhere" one-click jump indicator when they diverge.
  Lit-all/dim-all are scoped to the zoomed view; the ☀ manage panel always
  shows the whole map.
- **Jacob's live bugs:** (1) tidy no longer dies silently at "preparing…" —
  the proposal call has a 90s timeout and failures surface as a visible
  "tidy failed: <reason>" line; (2) focus now has a confirm stage (his ask),
  optimistic UI, and a status line — the older half of the fix (a11d0d9) is
  finally live because the running server was restarted onto current code.
- **Verified:** TSC 0 errors; **e2e 11/11** against a fresh server, including
  cross-turn recall through the new composed-context path (no SDK resume);
  live-browser shots of whole-map, zoomed, lit-manager, and dark views
  (`docs/shots/`). One UI bug found by the browser pass (lit-manager `walk`
  joined a string, killing the modal) — fixed and re-verified.

**Jacob's Z-answers landed same day (zoom is operational, not view-only):**

- **Z1 (ii):** dedicated `zoom` button per row (name-click zoom rejected).
  Row cleanup with it: passive ▶/☀ state badges by the name; all actions
  (zoom / ▶ focus / ☀ / + / ⟳ tidy) live in a hover cluster.
- **Z2 (+ same-day correction):** `POST /api/chats/:id/zoomin` — zooming in
  dims every lit topic outside the subtree (no auto-restore on zoom-out; user
  re-lights) and *offers* the focus shift — Jacob corrected "focus follows
  zoom" to "merely suggest the shift", so the client asks and passes
  `focus:true` only on accept. Plus **auto-light**: a global button where the
  map model recommends-and-applies background lighting for the current focus
  (`translator/autolit.ts`; topic-level only — first prompt draft reasoned
  about items and its ids resolved to nothing). Z3 (i) confirmed: zoomed view
  is the subtree only.
- Browser-verified: zoom click → focus followed server-side, outside topics
  dimmed, breadcrumbs + durable "— zoomed into … —" markers; autolit round-trip
  dimmed the unrelated branch (`docs/shots/ui-rowops.png`, `ui-zoomed.png`).

**Same-day follow-ups (Jacob):**

- **Auto-focus / auto-zoom** (`translator/recommend.ts`, `POST …/recommend`
  {kind}): the model recommends a topic + reason; server applies NOTHING — the
  client shows a confirm and only then calls the normal focus/zoomin endpoints.
  Model quirk found live: ids come back wrapped in brackets ("[7740e6d8]") —
  resolvers now strip them (autolit's too).
- **Manage panel** hosts all three auto actions alongside per-topic ▶/☀.
- **"agent's view" button** (transparency for the test product): shows the
  exact composed context — map state + recent window — via
  `previewContext()` / `GET …/context`. What the user sees is literally what
  the agent gets.
- **Scope ruling (Jacob, 2026-08-14): NO manual map editing in MVP** — no
  manual move/reparent, no wrap-selection, no manual rename. "Bare minimum
  first, with the automated map." The user's levers stay: create (+), focus,
  lit, zoom, item status edits/delete, and tidy. Manual `mv` is the first
  post-MVP candidate (see F1 discussion in Discord).
- **Auto-naming (Jacob: naming every new thing "seriously sucks"):** "+" now
  allows a blank name → topic is born "untitled" and the translator renames
  it from the conversation (new AUTO-NAME UNTITLED duty). Verified live:
  blank + → "untitled" → first round renamed it "buy vs. lease car for
  commute" (~20s).
- **Red-dot suggestions (Jacob: "the necessity is ill-defined"):** the
  per-round filer now NEVER restructures existing structure — STICKY STRUCTURE
  hardened to additive-only (may create sub-containers and place new material;
  may not move existing items or split/merge existing containers). When it
  senses the need it emits `suggest_restructure {containerId, note}` — stored
  in a `suggestions` table (not map_events; one open per container, newer note
  replaces older), shown as a red dot on the topic. Click → note + three
  choices: dismiss / keep for later / "see the proposal" (runs tidy on that
  subtree seeded with the note as a hint; applying marks the suggestion done).
  Prompt lesson: the duty had to move INTO the per-round user message ("final
  check before answering…") — as a system rule alone, haiku never fired it.
  Verified: positive case emits ("mixes apartment hunting with birthday
  dinner — split"), clean-container negative control stays silent, dot/modal/
  dismiss/keep browser-tested, projection rebuild unaffected (suggestions
  table deliberately has no FK to containers). Translator gate re-run after
  the prompt change: 12/13, 0 errors (the miss is corpus-variance on T30's
  median-decision item, not structural).
- **On-demand map check (Jacob):** "● check map" button reviews the WHOLE map
  (`translator/mapcheck.ts`, `POST /api/mapcheck`) — files red-dot suggestions
  for anything needing restructuring, or reports the clean bill ("well done —
  your map is clean!"). Complements the per-round check, which only looks at
  containers just filed into. Verified: messy map re-flagged (even after its
  earlier dot was dismissed), populated clean map got the clean bill with no
  false flags.
- **Merge bug (Jacob: "merge is not working, you still leave duplicates"):**
  root cause found in his live map — models said `status:'removed'` (ITEM
  vocabulary) for dead CONTAINERS, while every renderer only hides `'cut'`,
  so merged-away containers kept rendering as zombies/duplicates. Fixes:
  (1) `updateContainer` normalizes removed→cut and, on cut, pops live
  children/items up to the parent (never silently hide survivors); (2)
  idempotent schema migrations normalize legacy rows and clean orphans;
  (3) reorganize prompt now has a mandatory container-merge procedure
  (rehome survivors first, only then cut; 'cut' is the container dead-word)
  and a hint-resolution mandate (the flagged problem MUST be fully fixed);
  (4) hint-referenced `[abcd1234]` topics join the tidy scope — previously
  the scope guard blocked the very cross-subtree merge a suggestion asked
  for. Verified on a copy of the live DB: migration killed all zombies;
  the real weather-duplicate merge now ends with ONE surviving container,
  items rehomed, zero live items hidden in cut containers.
- **Topic delete (Jacob: "you removed the delete button entirely"):** items
  always had `del`; topics never did. Added: `del` on every topic row —
  cuts the whole subtree (deepest-first), un-lights it, rescues focus if it
  was inside, and tells the agent to drop it all. Browser-verified.
- **Context scaling (Jacob's "gets ugly as the map expands" → approved a+b):**
  the map block is budgeted (`HARNESSMAP_MAP_BUDGET`, default 16000 chars ≈
  4k tokens). Never cut: constraints, focus subtree, frame, instructions.
  Filled in priority order — lit briefs → open questions (structurally capped
  to focus+lit topics) → ELSEWHERE one-liners — each cut stalest-first
  (staleness = newest item update in the subtree), with explicit markers:
  "… N more topic(s) exist but are not shown … ask — the user can light it."
  The same text feeds agent and agent's-view, so trust is preserved (G2).
  Verified: 2.9k-char map fits untouched; forced 1200-char budget cuts lit +
  questions with markers while constraints survive; e2e 11/11 re-run green.

### Build log — v0.4 shipped & tested (2026-08-14)

Jacob's ontology ruling ("major major flaw… there are only nodes and sub-nodes")
executed as a true rewrite, not a shim — option (ii), chosen after his "does
updates in leaf update toward branch?" question exposed promotion's permanent
two-vocabulary tax (every leaf ability separately re-wired for branches; the
zombie-merge bug was exactly that class).

- **One `nodes` table**; containers/items frozen as a read-only backup. The
  migration is event-sourced: `map_events` replays into nodes — legacy ops
  (`create_container`, `create_item`, `rehome_item`, …) remain as replay-only
  aliases in the projector. Verified on a copy of the live map: 0 items lost
  (every legacy content string present as a node); one empty orphan node
  resurfaced (a v0.3.7 direct-SQL cleanup invisible to the event log) — benign,
  deletable. `INSERT OR REPLACE` on links (replay idempotence).
- **One operation vocabulary**: `create_node / update_node / move_node` +
  `suggest_restructure {nodeId}`. Translator, tidy, map check, auto-light,
  auto-focus/zoom, composer, renderers, server, UI all rewritten to it.
  `removed` is the one dead word (`cut` normalizes on replay).
- **The v0.4 behavior**: any node — claim, option, question — zooms, focuses,
  lights, takes + children, and deletes (one `del`, subtree-aware, which also
  dissolved the two-delete-buttons inconsistency). Filing is hierarchy-first:
  evidence under its claim; the filer is banned from creating near-namesake
  sibling folders.
- **Verified**: TSC 0; migration dry-run on live copy (above); **e2e 12/12**
  incl. new "any node can hold children" check; **translator gate 11/13,
  0 errors** (misses are corpus variance: audience constraint captured but
  parked, median-decision item); browser pass on the migrated map — zoomed
  into a claim via breadcrumb trail, + inside the zoom, focus-elsewhere
  indicator (`docs/shots/ui-nodezoom.png`).

### Build log — v0.4.1 (2026-08-14)

Jacob's M30/M31 (see `docs/MODLOG.md`, new — the maintained log of every one
of his modification points):

- **Clean chat**: button in the chat header. Appends a clear-marker system
  turn; the transcript view and the agent's rolling window restart from the
  marker, while the full log and the map survive — proof-tested: a codeword
  mentioned pre-clear vanished from the window but persisted via the node the
  translator had filed it into. The map IS the memory across clears.
- **↑ zoom out**: one level, to the immediate parent (breadcrumbs still jump
  anywhere).

### Build log — v0.5 "the light is the law" (2026-08-15)

Jacob's zoom/scope arc (M47) landed as an architecture change: THE LIGHT
GOVERNS BOTH AGENTS. The map = dumb, total storage; agents = stateless
workers seeing through a user-shaped keyhole.

- **Reading:** the map agent's view now equals the chat agent's floor —
  focus subtree + lit branches + "to sort" in full; every dim top-level
  branch is ONE line (name + count), subtree invisible. Budgeted (D3):
  beyond the cap, stalest in-scope branches degrade to one-liners.
- **Expansion-on-demand:** instead of filing, the map agent may answer
  `request_expansion {ids}` (≤3 dim branches) → ONE re-run with them
  readable. Reading grows on its own judgment (Jacob's philosophy:
  "the user's light is the floor"); chosen over an always-on Phase-1
  peek call (every-round tax, decides before trying) and a free tool
  loop (unbounded cost, mushy gate).
- **Writing never expands.** The write scope is exactly the user's
  light. Enforced by a SERVER-SIDE GUARD, not the prompt: out-of-light
  creations are redirected under a top-level "to sort" node with
  provenance ("arrived while focus was: X") and an auto amber
  suggest_relight note ("probably belongs under [Y] — re-light to
  check the fit"); root-level creations count as out-of-light too
  (only "to sort" itself may be born at root); updates/moves touching
  dim nodes are dropped and logged. Empirical basis: with full reading
  and a prompt-only rule, the filer filed straight into a dim branch —
  prompts guide, guards enforce.
- **Re-light ≠ move** (Jacob): re-lighting is fit-checking; the map
  agent moves a "to sort" child home only on a later round when its
  home is writable (TO-SORT INTEGRATION duty).
- **UI:** amber ● on to-sort arrivals (modal: dismiss / keep /
  ☀ re-light [target]); "to sort" pinned visible even when zoomed.
- **Known consequences (flagged, accepted):** dim branches are frozen —
  reversals of dim decisions wait in "to sort" until re-lit; "to sort"
  hygiene is the user's (no silent cleanup, per M23/M24).
- **Verified:** scenario end-to-end (zoom weather → remark about dimmed
  food branch → to-sort + provenance + amber note); guard needed two
  iterations (model dodged to root-level creation — now also guarded);
  translator gate **12/13, 0 errors — best yet**; e2e 12/12.

### v0 — "the map that writes itself" (thinking/writing work)

| In | Out (deferred) |
|---|---|
| Two-pane local web app wrapping the SDK | Coding use case; shadow-git workspaces |
| Items + containers, full ontology | Re-carve automation (manual restructure only) |
| Per-round translation, async + pulse | Upward/sideways damage propagation |
| Focus + binary lit; composed seeds | Graded detail levels; galaxy rendering |
| Exact same-branch rewind | Fold/merge |
| Point-and-operate + click ops; damage advice (downward) | Multiplayer |
| Dumb crystallization | Recall tool for the child (log search UI suffices in v0) |

**Success signal:** users stop scrolling transcripts — they answer "where were we / what
did we decide?" from the map, and "drop/park/focus" gestures become habitual. If the map
isn't trusted as the record, nothing downstream matters.

### v1 — "the harness for building"
Coding target: shadow-git workspaces (save point = commit, branch = git branch, jump =
checkout). Re-carve automation. Upward damage (parent summaries stale-flagged).
Galaxy-lite rendering. Recall tool. Synthesis-quality + translation-quality evals
(seeded scenarios, graded fidelity — goal-doc quality is upstream of everything).

### v2 — ambitions
Fold/merge of goal subtrees. Multiplayer maps (authors already typed). Agent-initiated
cartography (agent proposes forks/folds/cleanups). Map-level search. The map as a
*planning* surface: sketch future containers as empty goals and let sessions grow toward
them.

---

## 10. Open items

1. **Eager node creation** — working assumption in all simulations; awaiting Jacob's
   explicit confirm.
2. **Translation simulation on the exploration case** (detached nodes + crystallization —
   the hardest corpus case) — queued.
3. **Glossary freeze** (~6 user-facing terms) before any UI copy is written.
4. **Evals for translation quality** — commitment-detection precision/recall on seeded
   transcripts; must exist before v0 ships to anyone but us.

## 11. Design history

- v1 (history-based: context snapshots, fork/checkpoint/merge, galaxy) —
  `docs/archive/DESIGN-v1.md`. Its fork-without-pollution instinct survives as a
  structural guarantee; its snapshot-resume survives as the exact-rewind exception.
- Superseded en route: prose goal-docs as nodes (→ item trees); body+inbox two-zone docs
  (→ per-round translation); percentage faders (→ focus + lit); facet-based carving
  (→ pointability); interface-thinness as carving criterion (→ demoted to suggestion
  heuristic).
- Full working record: `docs/ontology/` (corpus, schema, simulations) and the Discord
  design threads (2026-07-17, 07-19, 08-12).

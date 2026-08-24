# Harnessmap: Design Exploration
*Context as territory — an AI harness where you navigate your work instead of scrolling it.*

> **Status:** living design doc. Started 2026-07-17. This session = design + decisions, no code yet.

---

## Decisions locked so far (2026-07-17)

1. **Foundation: wrap the Claude Agent SDK.** We do not build our own agent loop. The SDK owns agent turns, tool execution, and context replay. We own the map, the snapshot/graph store, and the fork/checkpoint/split/merge + goal-synthesis logic on top.
2. **The fork primitive comes for free from the SDK.** `resume: <sessionId>` replays a saved session's context; `forkSession: true` branches a *new* session from that point while leaving the original untouched. That is fork-from-any-checkpoint at the context layer. SDK auto-compaction can seed the `distill`/merge step. *(Confirm exact API surface when we start coding.)*
3. **Storage model: chain + offset (git-style), not full copies.** A snapshot is a pointer `(session/log, index)`, not a transcript copy. Shared prefixes deduplicate. This maps cleanly onto SDK resumable sessions.
4. **Merge is deferred to post-MVP.** The MVP proves "branch off without fear" (continue + save point + branch + map). §4 stays in this doc as design groundwork, but nothing in Phase 0 depends on it.
5. **Workspace state is versioned with the map, git-style, from the MVP.** Every snapshot records the workspace as a commit in a **shadow git repo** managed by the harness. Branching a conversation branches the files too (a real git branch); jumping to a point restores — or offers to restore — that file state. This upgrades the original "hash-and-warn" MVP plan: file drift becomes impossible by construction rather than merely detected.
6. **Softened user-facing vocabulary.** Internal/code terms stay git-like; the UI uses plain words most people understand without knowing git:

   | Internal (doc & code) | UI term |
   |---|---|
   | snapshot / node | **point** |
   | checkpoint | **save point** |
   | fork | **branch off** ("Branch from here") |
   | split | **split** |
   | merge | **combine** *(deferred)* |
   | session | **chat** |
   | distill | **condense** |
   | delete | **delete** |
   | rewrite | **rewrite** ("Re-aim this branch") |
   | sight set | **sight** ("light up") |

7. **Goals are first-class — the map's primary axis.** Fork/return is goal/topic-based, not inquiry-based: the unit is "a thing you're trying to accomplish," not "a conversation you had." Every branch anchors to a structured **goal object** — highly specific, never a one-liner — maintained by a dedicated **Goal Synthesis procedure** independent of chat summarization (§2).
8. **Two new operations: delete and rewrite.** Delete prunes a goal/branch from map and goal tree git-style — drop the ref now, GC unreachable storage later; snapshots shared with live work are hidden, not destroyed (§3). Rewrite re-aims a branch: the user redefines its goal and the seed context is re-synthesized from parent context(s) — user-picked, or a genealogical trace with a distance cap / relevance-exhaustion stop (§3).
9. **Sight: user-composed context.** A single "you are here" is not enough. Each session carries a **sight set** — nodes the user has lit up, whose goal objects + distilled briefs enter the agent's context. Lighting nodes on the map IS context control; every snapshot records the active sight set (§3).
10. **The merge unit is a goal structure (subtree), not a single session.** Groundwork only — merge itself stays deferred. E.g. fold "objection" into "Argument 2," then fold the whole Argument-2 subtree (objection included) into the essay body (§4).
11. **UI direction: planets, gravity, galaxy.** Project = galaxy, goal = star, branch = orbiting planet, sub-branch = moon, sight = illumination, you = your ship. Layout stays deterministic — orbital positions derive from the goal tree; gravity is metaphor and motion flavor, never a reshuffling physics sim (§5).

Everything below is the exploration these decisions came out of, still open for red-lining. Sections use the internal terms.

---

## 1. Vision & Core Mental Model

### The problem with linear chat
Every serious AI-assisted work session eventually hits the same wall:

- **Context pollution.** You're deep into drafting Section 3 of a paper and want to chase a tangent about a citation. Ask it in the same chat and the tangent's tokens live in your context forever, degrading the main thread.
- **No way back.** You realize the conversation went off the rails 20 turns ago. Your options: scroll, copy-paste, and start a new chat — losing structure, provenance, and the ability to compare paths.
- **No overview.** A user with 40 chats has 40 opaque titles in a sidebar. Nothing tells them *where they are* in their overall project, what's finished, what's abandoned, or what depends on what.

### The reframe: context as territory
A conversation is not a log; it's a **path through a space of possible contexts**. Every turn is a step; every "what if I'd asked differently" is an unexplored fork. Harnessmap makes that space literal:

- **Nodes are places** — frozen context snapshots you can stand on.
- **Edges are moves** — continue, fork, merge, split.
- **Sessions are expeditions** — the live frontier growing off a node.
- **The map is memory** — you *see* your goals, tangents, and dead ends spatially, the way you'd see branches in `git log --graph`.

The one-line pitch: **git for conversations, with a map instead of a CLI.**

### Why a map beats a sidebar
- Spatial layout encodes *relationships* (this research thread feeds that draft section) that a flat list cannot.
- Forking becomes cheap and guilt-free — a tangent is just a new twig, visibly separate, never polluting the trunk.
- Returning to work after a week: one glance at the map re-loads your mental state faster than re-reading transcripts.

---

## 2. Data Model

### Core entities

```
Snapshot (node)      — immutable, content-addressed frozen context
Edge                 — typed relation between snapshots
Session              — mutable "head" pointer + live agent state
Checkpoint           — named/starred snapshot (a ref)
Goal                 — first-class structured objective; the map's primary axis
Project              — one map = one project = one DAG of snapshots + a goal tree
```

### Snapshot (the node)
A snapshot is an **immutable, content-addressed record** of everything needed to resume from that point:

```jsonc
{
  "id": "snap_9f3a…",              // hash of contents → dedup for free
  "parent_ids": ["snap_1c2b…"],    // 1 parent (continue/fork), 2+ (merge)
  "edge_type_from_parent": "fork", // how this node came to exist
  "sdk_session_ref": "sess_ab12",  // the Claude Agent SDK session this resumes
  "message_log_ref": "log_ab12 @ index 47",  // chain+offset, see storage note
  "system_prompt_ref": "prompt_v3",
  "tool_state": {                   // serializable tool/env state
    "files_touched": [...],
    "artifacts": [...],
    "mcp_server_config_hash": "…"
  },
  "meta": {
    "created_at": "...",
    "auto_summary": "Drafting related-work section; found 3 candidate citations",
    "topic_labels": ["related-work", "citations"],
    "token_count": 41203,
    "goal_ref": "goal_7d2f…",            // the goal this node serves — first-class, see below
    "sight_set": ["goal_lit1", "snap_x"] // nodes illuminated when this turn ran (§3)
  }
}
```

**Key storage trick — chain + offset, not full copies.** Messages within one linear run are stored once as an append-only log; a snapshot is `(log_id, index)`. Only forks create new logs (which themselves reference the parent snapshot rather than copying history). This is exactly git's model: snapshots are cheap pointers; the DAG deduplicates shared prefixes. A 200-node map of a long project costs barely more than the raw transcripts. **This aligns with how SDK sessions resume — a snapshot is essentially `(sdk_session_id, turn_index)` plus our metadata.**

### Edge types

| Edge | Parents → Child | Meaning |
|---|---|---|
| `continue` | 1 → 1 | Normal turn-taking; auto-created at checkpointable moments |
| `fork` | 1 → 1 | New branch from any snapshot; original untouched (SDK `forkSession`) |
| `merge` | 2+ → 1 | Synthesized child seeded from multiple parents (§4) |
| `split` | 1 → N | One session decomposed into N sibling branches |
| `distill` | 1 → 1 | Same lineage, compacted context (summarization edge) |
| `rewrite` | 1 → 1 | Re-aimed re-synthesis of a branch's context under a redefined goal (§3) |

`distill` is worth calling out: context compaction ("this session hit the token limit, summarize and continue") is just a self-merge — it fits the same graph vocabulary instead of being a hidden harness behavior. SDK auto-compaction is a natural provider for it.

### Session (mutable)
A session is `{ head_snapshot_id, sdk_session_id, live_message_buffer, sight_set, agent_loop_state, status }`. Sessions are the *only* mutable things. Statuses: `active`, `paused`, `archived`, `merged-away`. When a session advances, the harness periodically **materializes** its buffer into new snapshots (see checkpoint policy, §3). Closing or forking always materializes first — nothing on the map is ever a lie about what exists.

### Checkpoint
A checkpoint is a **ref**: `{ name, snapshot_id, pinned: bool, note }`. Like a git tag. Auto-checkpoints (every N turns / after significant tool runs / at topic shifts detected by a cheap classifier) keep the map granular; user checkpoints are the ones rendered prominently.

### Goal (first-class) — the map's primary axis
Existing tools are **inquiry-based**: the unit is "a conversation you had." Harnessmap is **goal-based**: the unit is "a thing you are trying to accomplish," and sessions are expeditions in service of a goal. Fork and return are goal/topic operations first, conversation operations second.

```jsonc
{
  "id": "goal_7d2f…",
  "statement": "Determine whether the status-quo-bias objection defeats Argument 2 (the autonomy argument, essay §3). If it does not, articulate the strongest form of the objection and a reply that survives it; decide keep / revise / drop.",
  "success_criteria": ["objection stated in strongest form", "reply drafted", "keep/revise/drop decided"],
  "status": "open | done | blocked | abandoned",
  "parent_goal": "goal_arg2",          // → the goal TREE overlaying the snapshot DAG
  "anchor_node": "snap_…",             // where this goal lives on the map
  "evidence_refs": ["snap_… @ turn 12"],
  "revision_history": []               // rewrites, with provenance (§3)
}
```

**Never one-liners.** A goal statement must be specific enough to re-aim a session by itself: concrete subject, relation to the parent goal, and a falsifiable picture of "done."

**Goal Synthesis procedure** — an independent pipeline, deliberately separate from chat auto-summaries (those optimize for recap; this optimizes for aim):
1. **Draft** at branch time from the user's stated intent + parent context.
2. **Refine** against a specificity rubric (named subject? success criteria? parent relation? falsifiable "done"?). A critic pass rejects vague statements and retries; the user confirms the result.
3. **Maintain:** every ~N turns, check for drift/split/completion; propose updates, user confirms structural changes.
4. **Rewrite** on demand (§3) — re-aim with full revision history.

The `parent_goal` links form a **goal tree overlaying the snapshot DAG** — and it is the structure users navigate first. The map renders goals; snapshots are the territory underneath.

### Invariants
1. Snapshots are immutable and content-addressed. Editing history is impossible; only new branches exist.
2. Every session's head is reachable from the project root — the map is always a single connected DAG.
3. Any snapshot can be resumed at any time (tool state permitting — see risks, §7).

---

## 3. Key Operations

### Fork
**Semantics:** pick any snapshot `S`; create a new session whose head is a new empty branch off `S`. **Implemented via SDK `resume: S.sdk_session_ref` + `forkSession: true`.**

- Context: the new session sees *exactly* the messages up to `S`. Later messages in the original branch do not exist for it.
- The original session is untouched — not paused, not modified. Both can run concurrently.
- **Goal-anchored branching:** every fork opens (or attaches to) a first-class goal object (§2). Goal Synthesis drafts a specific statement from the user's stated intent + parent context — never a one-liner; the map label is derived from it. Forking IS creating a goal; returning is returning to a goal, not scrolling to a message.
- **Lightweight fork ("peek"):** a fork that auto-archives if abandoned within a few turns without a checkpoint — keeps the map from filling with 2-turn tangents. Tangents that turn real get promoted automatically.

**Edge cases**
- *Fork mid-tool-call:* disallow; snap to the nearest turn boundary before/after the tool result.
- *Fork from a merged-away branch:* fine — snapshots outlive their sessions.
- *Mutable external state* (files the agent wrote): the snapshot records file hashes; on resume, the harness warns "3 files differ from this snapshot" and offers workspace restore (if workspace versioning is enabled) or proceed-with-drift. Optionally pair fork with a copy-on-write workspace (worktree-style) so branches can't stomp each other's files.

### Checkpoint
**Semantics:** name the current (or any past) point so you can find it, return to it, or fork from it.

- Zero-cost operation — the snapshot usually already exists; checkpointing just adds a ref + optional note.
- **Auto-checkpoint policy** (configurable): every user turn boundary is snapshot-eligible; the harness *materializes* snapshots at (a) every K turns, (b) after any destructive/expensive tool run, (c) detected topic shift, (d) explicit user checkpoint. Fine-grained snapshots exist in storage; the map only *renders* checkpoints and structural nodes (forks/merges), so granularity doesn't equal clutter.

### Split
**Semantics:** "this session is actually three lines of work" → decompose into N sibling branches from a common ancestor.

Two flavors:
1. **Split-forward (cheap, default):** N forks from the current head, each labeled with one sub-goal. All children share full history. This is really "multi-fork with labels."
2. **Split-retroactive (expensive, powerful):** an LLM pass classifies past messages by thread, then *reconstructs* N branches each containing only its thread's messages, prefixed with a distilled summary of the shared preamble. Original branch is preserved and archived — reconstruction creates new snapshots, never rewrites old ones (invariant 1).

**Edge cases:** messages relevant to multiple threads get duplicated into each (fine — branches are independent); ambiguous messages go to a review list the user can drag between piles in the UI.

### Delete
**Semantics:** the user no longer wants a goal/topic — remove it (and, with confirmation, its descendants) from the map and the goal tree.

- Distinct from marking a dead end (⛔ keeps the record visible as part of the map's honesty); delete removes from view entirely.
- Under the hood, git's model exactly: **drop the ref now, GC later.** The goal entry and branch refs are removed and the branch is tombstoned. Snapshots that are ancestors of live work are retained (invariant 1) but hidden; fully unreachable logs/workspace commits become purgeable by a later GC pass.
- Undo window: tombstones are restorable until GC runs.

### Rewrite (re-aim)
**Semantics:** the user redefines the goal of a branch/section; the branch's working context is re-synthesized to serve the new goal.

- Inputs: the target node/branch, the new goal statement (or "re-derive it"), and a **context source**:
  - **(a) user-picked** — the user selects which parent context(s)/branches to draw from, or
  - **(b) genealogical trace** — walk the ancestry (including merged-in lines once merge exists), distilling each hop, stopping at a distance cap *k* **or** when a relevance judge determines marginal information is exhausted, whichever first.
- Output: a fresh seed — a re-aimed distillation of the heritage — materialized as a new snapshot via a `rewrite` edge. The goal object is updated with full revision history; the old line is preserved and archived (invariant 1: rewrite never edits history, it re-derives a new head).
- Mechanically, rewrite is `distill` with a new aim: same machinery, different target.

### Sight (context illumination)
**Semantics:** a single "you are here" is not enough — the user controls what else the agent can *see*. Each session has a **sight set**: map nodes/goals the user has lit up.

- A lit node contributes its **goal object + latest distilled brief** to the session's context; the `recall` tool (post-MVP) is scoped to lineage + lit nodes.
- Default sight = own lineage. Toggle any node on/off between turns; each snapshot records the sight set active when that turn ran, so every point stays exactly reproducible.
- Cost is visible: each lit node shows its token weight — the map doubles as a literal context-budget dashboard.
- **Sight is the cheap, reversible cousin of merge.** It moves information across branches with zero synthesis risk and no new nodes — which is why it can ship long before combine does.

### Merge
**Semantics:** take 2+ snapshots, synthesize a new child seeded from both, spawn a session on it. Full treatment in §4.

**Mechanics common to all strategies**
- Inputs: parent snapshots, optional user **goal prompt** ("merge these to draft the final intro"), a strategy choice.
- Output: a new snapshot with 2+ parents; its message log begins with the synthesized seed (system-side context), then the session proceeds normally.
- Parents' sessions can be auto-archived (default, reduces clutter) or left active (merge as "reader," not "consumer" — parent branches keep going).
- Merge is never destructive: bad merge? Delete the child branch; parents were snapshots all along. **There are no merge conflicts, only merge quality** — this is the deep difference from git, and it's why strategy design (§4) is the hard part.

---

## 4. Merge Strategies (the hard part)

The fundamental tension: parents may total 300k tokens; the child needs a seed that is *small enough to leave working room* and *faithful enough not to hallucinate the past*.

### The merge unit: goal structures, not sessions
When merge lands, its unit is a **goal subtree**, not a single session. Essay example: one goal is "consider an objection to Argument 2." After that exploration, you don't just fold the objection back into the Argument-2 goal — you later fold the *whole Argument-2 subtree* (objection included) back into the main essay body. So merge is really **fold**: distill a completed goal structure into its parent goal's context, recursively composable up the goal tree. Every strategy below applies at subtree granularity — the "parents" being combined are goal structures with internal hierarchy, and the synthesized seed must preserve that hierarchy rather than flatten it.

### Strategy catalog

**S1. Summarize-both-then-seed (baseline)**
LLM summarizes each parent's full context independently → concatenate summaries + user goal → seed.
- ✅ Simple, predictable, cheap-ish, parallelizable.
- ❌ Lossy on specifics (exact code, exact citations); summaries of summaries degrade across repeated merges ("photocopy decay").
- *Mitigation:* summaries carry **pointers back to their source snapshots**, and the child gets a `recall(snapshot_id, query)` tool to re-query the original transcript on demand. This one tool changes merge from lossy compression into lossy compression *with a lossless backing store* — arguably the single most important design decision in the doc.

**S2. Asymmetric merge (trunk + tributary)**
One parent is primary (keep tail of its raw messages verbatim); the other is distilled to a compact "findings brief."
- ✅ Matches the dominant real use case: "fold my research tangent back into the draft." Preserves working fidelity of the trunk.
- ❌ User must pick the trunk (usually obvious; default to the branch with the active session / more recent activity).
- **Likely the default merge.**

**S3. Cherry-pick / extract merge**
UI or LLM selects specific *artifacts* — a code block, a paragraph, a decision, a citation list — from parent B and injects only those into parent A's live session. Arguably not a merge but a "transplant."
- ✅ Maximum fidelity, minimum tokens, no synthesis hallucination.
- ❌ Manual; loses reasoning context around the artifact.
- Render as a thin dashed edge on the map (provenance without full merge semantics).

**S4. Interleave-by-timestamp**
Zip both message logs chronologically into one context.
- ✅ Trivially implementable, zero information loss.
- ❌ Usually incoherent (two conversations shuffled together), token-expensive, confuses the model. Include only as a debug/power-user mode; useful mainly when branches were genuinely one interleaved effort split by accident.

**S5. Goal-hierarchy synthesis (the ambitious one)**
Three-pass pipeline:
1. **Extract:** per parent, an LLM pass emits structured state: `goals[] (with status: done/open/blocked), decisions[], findings[], artifacts[], open_questions[]`.
2. **Reconcile:** a synthesis pass merges the goal lists into a single **prioritized goal tree** — user's stated merge goal at the root, parent goals nested under it, conflicts surfaced explicitly ("Branch A decided X; Branch B assumes not-X — resolve before proceeding"), priorities assigned by (user goal relevance > blocking relationships > recency).
3. **Seed:** child context = goal tree + decisions log + findings + artifact pointers + recall tool.
- ✅ The child session *knows what it's for*; conflicts become explicit agenda items instead of silent contradictions; the goal tree renders beautifully on the map (§5).
- ❌ Most LLM calls, most failure modes (bad extraction poisons everything); needs a user review step.
- *Design choice:* show the goal tree to the user for a 30-second edit **before** spawning the child. Human-in-the-loop at exactly the leverage point.

**S6. Debate/adjudication merge (speculative)**
When parents explored *competing approaches*, seed a session whose first task is to argue both sides against the user's goal and recommend. Merge as decision procedure, not just union. Cheap to build on top of S5 (it's a prompt variant); high wow-factor for the "I forked to try two designs" pattern.

### Building the goal hierarchy — concretely
- **Continuous, not merge-time-only:** a cheap background pass tags each session's evolving goal state every ~10 turns (goals opened/closed/mutated). Merge-time extraction then reads these incremental annotations instead of 150k raw tokens — cheaper, and the goal data doubles as map labels (§5).
- **Priority function:** `relevance-to-merge-goal` (LLM-judged) → `blocks/blocked-by` edges among goals → `status` (open before done) → recency. Deterministic tie-breaks so merges are reproducible.
- **Schema, not prose:** goals as structured objects (`id, statement, status, parent_goal, evidence_refs[]`) so the tree is diffable, editable in UI, and re-usable at the *next* merge without re-extraction.

### Strategy selection
Offer S2 as the one-click default, S1 as fallback when no clear trunk exists, S3 via drag-and-drop on the map, S5 behind a "smart merge" button with the review step. S4/S6 behind a power-user flag. Don't make users read a strategy menu.

---

## 5. Map UI/UX

### Visual language

| Element | Encoding |
|---|---|
| Regular snapshot | Small dot (mostly elided; shown on branch expand) |
| Checkpoint | Larger node with flag/pin glyph + user's name |
| Fork point | Node where edges diverge; fork-intent label on the outgoing edge |
| Merge node | Diamond/confluence glyph; hover shows strategy + goal tree |
| **Active session head** | Pulsing/glowing terminal node — the "you are here" beacons |
| Archived branch | Desaturated, thinner stroke |
| Node size | Optionally ∝ tokens or turns (weight of work at that point) |
| Distill edge | Dotted (same lineage, compressed) |
| Cherry-pick | Thin dashed cross-link |

### Layout
- **Layered DAG** (Sugiyama/dagre/ELK), time flowing left→right (or top→down). Deterministic and stable: adding a node must not reshuffle the map — spatial memory is the entire point. Reserve force-directed layouts for a future "topic similarity" view, never the default.
- **Semantic zoom:** zoomed out → only checkpoints, forks, merges, and branch labels (the "subway map"); zoomed in → individual snapshots and turn summaries. Collapsed linear runs render as a single thick edge labeled "23 turns."
- Long-linear-chain projects (the paper example) naturally render as a spine with tangent twigs — the motivating picture draws itself.

### Interactions
- **Click active head** → jump into that session's chat view (map ⇄ chat is the core two-pane rhythm; map can dock as a minimap beside the chat).
- **Click any snapshot** → preview card: auto-summary, goal, token count, last messages → buttons: `Fork here` / `Resume` / `Checkpoint` / `Light up` / `Delete`.
- **Hover edge** → what happened along it ("researched citations; found 3 candidates").
- **Drag node A onto node B** → merge dialog (strategy + goal input). Drag onto a *live session* → cherry-pick/transplant (S3).
- **Right-click session** → split, archive, rename, color.
- **Breadcrumb path:** while in a chat, the minimap highlights the ancestry path from root to your head — you always know where you stand.

### Surfacing goals/topics
- Branch labels come from fork-intent (§3) or auto-topic-labeling; rendered along edges like street names.
- A **goal panel** lists the live goal tree (from §4's continuous extraction) with each goal linking to the nodes where it was opened/advanced/closed — goals become a second index into the same map.
- Status glyphs on branch tips: ✅ goal met, 🔶 open, ⛔ dead end (user-markable — marking dead ends is how the map stays honest).

### The galaxy direction (planets, gravity, galaxies)
The visual metaphor we're steering toward:

| Concept | Celestial mapping |
|---|---|
| Project | **Galaxy** |
| Goal | **Star** — brightness = status/activity; the goal tree is a system of systems |
| Branch / session | **Planet** orbiting its goal-star |
| Sub-branch | **Moon** |
| Active head | Your **ship** |
| Sight | **Illumination** — lit bodies are what your agent can see |
| Delete | Ejected from the system (recoverable until GC) |
| Fold / combine (post-MVP) | Accretion into the star |
| Dead end | Cold, dark body — still on the chart |

**The constraint that survives the metaphor:** layout stays deterministic. Orbital positions derive from the goal tree (angle ≈ birth order, radius ≈ depth/recency), not from a physics simulation. Gravity is metaphor and motion flavor — drift, parallax, glow — never a force-directed reshuffle that destroys spatial memory. The layered-DAG "transit" view remains as a second lens; galaxy is the home view.

---

## 6. Architecture Sketch

```
┌────────────────────────────── Frontend ──────────────────────────────┐
│  Map view (React Flow / Cytoscape + ELK layout)   Chat view          │
│  Preview cards · drag-merge · goal panel          (standard agent UI)│
└──────────────▲───────────────────────────────────────▲───────────────┘
               │ WebSocket (graph deltas, session stream)
┌──────────────┴───────────────────────────────────────┴───────────────┐
│                           Harness Core (server)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ Graph Store  │  │ Session Mgr  │  │ Synthesis Service            │ │
│  │ snapshots,   │  │ live heads,  │  │ summarize · goal-extract ·   │ │
│  │ edges, refs  │  │ agent loops, │  │ merge strategies · topic     │ │
│  │ (SQLite +    │  │ material-    │  │ labeling (queue of LLM jobs, │ │
│  │  CAS blobs)  │  │ ization      │  │ cheap model for background)  │ │
│  └─────────────┘  └──────┬───────┘  └──────────────────────────────┘ │
│                          │ wraps                                      │
│                 ┌────────▼─────────┐                                  │
│                 │  Claude Agent    │  ← the SDK. harnessmap is a      │
│                 │  SDK (resume/    │    layer AROUND it, not a fork.  │
│                 │  forkSession)    │                                  │
│                 └──────────────────┘                                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Notes
- **Wrap, don't rebuild.** The Claude Agent SDK is a black box that consumes `(messages, tools)` and streams results, with resumable + forkable sessions. Harnessmap's contract with it is narrow: (1) construct/resume a session from a snapshot's chain, (2) intercept the stream to materialize snapshots, (3) inject the `recall` tool.
- **Graph store:** SQLite for the DAG/refs/metadata + content-addressed blob store for message logs. Single-user local-first works day one; the schema ports to Postgres for multi-user later.
- **Synthesis service:** background job queue; small/cheap model (Haiku) for continuous labeling and auto-summaries, frontier model for merges and retroactive splits. All synthesis outputs are themselves stored as artifacts with provenance (which prompt, which model) — merges should be auditable.
- **Concurrency:** multiple sessions can run simultaneously (that's the point of forking). Session Manager schedules agent loops; snapshots' immutability means zero cross-branch locking — only per-session head advancement needs serialization. Shared *workspace* files are the exception (see risks).

---

## 7. Open Questions & Risks

**Hard problems**
- **Tool-state resumability.** Messages snapshot cleanly; the *world* doesn't. Files written, DB rows inserted, deployed side effects — resuming an old snapshot can put the agent in a context that contradicts reality. **Decided (2026-07-17): files are solved git-style from the MVP** — every snapshot is a commit in a shadow git repo, branching a chat branches the files, jumping restores them. Remaining exposure: *non-file* side effects (DB writes, network calls, deploys) — those stay warn-only for now.
- **Merge quality is the product.** If merged sessions feel amnesiac or hallucinate their own history, users stop trusting the core feature. The `recall` tool + human-reviewed goal tree are the two mitigations; both need real evaluation, not vibes.
- **Photocopy decay.** Repeated distill/merge chains compound summarization loss. Track a "synthesis depth" per node; past a threshold, re-derive from original transcripts (always reachable — invariant 1) instead of stacking summaries.
- **Goal quality is upstream of everything.** If goal statements degrade into vague one-liners, goal-based navigation collapses back into an inquiry-based chat list. Hence the independent Goal Synthesis procedure with its specificity rubric — it needs its own evals, and possibly its own dedicated prompts/models.

**UX risks**
- **Map sprawl.** Enthusiastic forkers produce hairballs. Mitigations: peek-forks that auto-archive, semantic zoom, aggressive default collapsing, per-project maps.
- **Concept overload.** Fork/checkpoint/split/merge is a git-sized vocabulary aimed at non-git users. Naming matters ("branch out," "save point," "combine"?); the map must teach by affordance — drag-to-merge, click-to-fork — not by manual.
- **Sight footguns.** Lighting many heavy nodes silently eats the context budget. Every lit node must show its token weight, with warnings past a threshold.
- **When is a node made?** Too many nodes = noise; too few = "the point I wanted isn't on the map." Fine-grained storage + coarse rendering (per §3) is the bet; validate it.

**Open questions**
- Is a fork's system prompt inherited or re-derivable per branch? (Per-branch overrides seem right; adds complexity.)
- Multiplayer maps — two people on different branches of one project — is a natural extension; how early does it need to shape the data model? (Immutable snapshots already make it *almost* free.)
- Cost: continuous background labeling on every session is an always-on LLM spend. Batch it? Local small model?
- Should merges be re-runnable ("try this merge again with strategy S5") as first-class siblings? (Cheap given immutability; probably yes.)

---

## 8. Roadmap

### Phase 0 — MVP: "fork without fear" (~6–8 weeks, 2–3 people)
The smallest thing that proves the mental model:
- Wrap the Claude Agent SDK; conversation snapshots (chain+offset storage).
- Operations: **continue, checkpoint, goal-anchored fork, delete, sight v0**. No merge, no split, no rewrite.
- **Goal Synthesis v0:** draft + specificity-rubric pass at branch time; goals are structured objects from day one.
- **Sight v0:** lit nodes inject their goal object + distilled brief; token weight shown per lit node.
- Map: read-only DAG (deterministic transit layout first; galaxy home view targeted for Phase 1), auto-summaries via cheap model, click-to-jump, fork-from-node, goal-derived labels.
- **Workspace: shadow git repo.** Every save point = a commit; branch off = a git branch; jumping to a point checks out that file state. Non-file side effects: warn-only.
- **Success signal:** users fork ≥ a few times per real session *and return to* pre-fork branches. If forking isn't habit-forming on its own, merge won't save the product.

### Phase 1 — v1: "the map is the workspace" (~3–4 months)
- **Merge:** S2 (asymmetric) as default + S1 fallback; `recall` tool; drag-to-merge UI; archived-parent hygiene.
- **Rewrite (re-aim):** user-picked parent or capped genealogical trace; goal revision history.
- **Galaxy home view** (deterministic orbital layout); transit view kept as second lens.
- **Split-forward**; peek-forks; semantic zoom; hover previews; goal-tree panel; goal drift maintenance (periodic re-check + user confirm); delete GC.
- Continuous topic labeling; multiple concurrent sessions; local-first persistence + export.
- Eval harnesses: merge quality *and* goal-statement specificity (seeded scenarios, graded fidelity).

### Phase 2 — Ambitious: "the harness that knows your goals"
- **Goal-structure folds:** S5 goal-hierarchy merges at subtree granularity ("fold the Argument-2 subtree — objection included — into the essay body") with editable goal-tree review; goal status rendered on the map; S6 debate merges.
- Retroactive split; copy-on-write branch workspaces for coding use cases.
- **Agent-initiated cartography:** the agent proposes forks ("this looks like a tangent — branch it?") and merges ("your citation branch has findings your draft branch needs").
- Multiplayer maps; cross-project links; map-level search ("where did we decide the eval metric?" → jump to node).
- Long-horizon dream: the map as a *planning* surface — sketch future nodes ("Section 4," "robustness experiments") as empty goals, and let sessions grow toward them. The map stops being a history and becomes a plan you and the agent fill in together.

---

*Working thesis to rally around: linear chat made context a liability — every message you send costs you forever. Harnessmap makes context an asset with a shape. If we get fork-without-fear right in Phase 0, everything else is compounding interest.*

# Harness strategy — standalone vs. layer (investigated 2026-08-16)

Mark's framing: the product's core value is the MAP and map-mediated context
management — not harness plumbing. Rebuilding tool use, context management,
and compaction means permanently chasing harness teams. Investigate becoming
a layer on top of existing harnesses instead.

## What the extension surfaces actually offer (verified)

**Claude Code hooks** (docs, 2026-08): the full observe+inject loop exists.

| Need | Hook | Capability |
|---|---|---|
| Observe each round | `Stop` | fires per turn, provides `last_assistant_message` + `transcript_path` — feeds our filer |
| Inject map context per turn | `UserPromptSubmit` | `additionalContext` — our composed map block rides along on EVERY turn |
| Inject on resume | `SessionStart` | `additionalContext` at session start/resume |
| Steer compaction | `PreCompact` | `compactionInstructions` (map-aware compaction), or block compaction outright |
| Session identity | all hooks | `session_id` + `transcript_path` → node ↔ session association |

**MCP**: as of 2026, every major host speaks it natively — Claude Code, Cursor,
Codex CLI, ChatGPT desktop, Copilot CLI, OpenAI Agents SDK. It is the default
integration layer for agent runtimes; the 2026-07-28 spec goes stateless with
an extensions framework. MCP tools are the portable half of harnessmap
(map operations the agent and user can invoke); hooks-grade per-turn injection
is Claude-Code-specific for now.

## Options

**A. Standalone harness (status quo).**
The keyhole is perfect: context is rebuilt per turn, so light-is-the-law is
absolute, agent's-view is exact, per-turn cost is flat. But we must build tool
use, web search, files, permissions, compaction, artifacts… forever, against
teams of hundreds. Adoption = "abandon your harness for our app" — the hardest
possible sell. The chat pane stays valuable as a design lab and demo, not as
the product's delivery vehicle.

**B. Claude Code plugin (hooks + MCP + our web UI).**
Ship as a plugin: our existing server (store, filer, all map models, web UI)
plus a hook adapter.
- `Stop` hook → filer runs on each real CC exchange (tool-use rounds included:
  Jacob's web-search findings get filed onto the map).
- `UserPromptSubmit` → `additionalContext` = `composeState(...)` — the same
  map block we compose today, injected instead of owned.
- `PreCompact` → compaction instructions derived from the map ("preserve
  everything about the focus subtree; the map already holds X, Y").
- Node ↔ session association: record `session_id` against the focus node;
  focusing a node can resume its session (`--resume`) or start clean with the
  node's memory injected. **This is Mark's "associate contexts to an idea/goal"
  made literal: choosing a node chooses a context.**
- Tools, permissions, compaction, sessions: all native CC. We stop competing.
Honest loss vs A: within a session, context is append-only — we can add and
steer but not subtract mid-session. Mitigation is the map itself: map-as-memory
makes short, focus-scoped sessions natural (`/clear` on focus switch costs
nothing when the map carries the work), and session boundaries are where
subtraction happens.
Adoption: `/plugin install harnessmap`, map opens at localhost beside the
terminal. Users keep their harness, their tools, their muscle memory; we add
the map. Easiest possible story.

**C. MCP-first multi-harness core.**
`map-core` = store + filer + map models + web UI, exposed over HTTP + MCP.
Adapters per harness: Claude Code adapter (hooks — full automatic loop);
Cursor/Codex/Copilot adapters (MCP tools; observation degraded to
agent-invoked logging or transcript watching until those hosts grow hook
equivalents). "The user chooses the harness; harnessmap is the map layer."

## Recommendation: B now, architected as C

1. **Refactor to `map-core`** (mostly done already: the server IS the core;
   the chat pane becomes one adapter among others). Keep it harness-agnostic:
   one interface — `observeRound()`, `composeContext()`, MCP tool surface.
2. **Build the Claude Code plugin adapter first.** Hooks give the only
   full-fidelity loop today; CC is where our users are; plugin marketplaces
   give distribution; we dogfood it building harnessmap itself.
3. **Add thin MCP adapters** (Codex, Cursor…) once the plugin proves the loop —
   breadth when it's cheap, not before.
4. **Stop investing in standalone harness features** (no tool-use build-out in
   the chat pane). The pane remains the lab: fastest place to iterate on map
   mechanics with zero integration friction.

What survives unchanged in B/C: the map, the filer and its gate, light-is-the-
law for map WRITES (the filer is ours everywhere), to-sort, all four node
layers, tidy/check/autos, the web UI. What changes: the chat agent's context
goes from owned to injected+steered, and sessions become the map's unit of
context association — which is arguably the design finding its true shape.

Risks: hook API stability (pin versions), injection token cost (same as
today's composed block), two-window UX until an IDE webview exists.

## Mechanics Q&A (Mark, 2026-08-16)

**Lit/dim vs tool-use contexts.** Research lives in three places with
different rules: (1) the MAP — the filer reads tool results from the
transcript and files findings as nodes; obeys the light absolutely, in every
future injection and session. (2) The LIVE transcript — append-only; dim
cannot subtract mid-session (same as our old verbatim window, which never
obeyed lighting either); enforced at every compaction via PreCompact
instructions ("drop dimmed topics X, Y — the map holds their digests") and at
session boundaries. (3) ARCHIVED transcripts on disk — pure storage, mined on
demand.

**Migration to a new chat.** Focus switch offers resume (node's session,
verbatim, native) or fresh start (SessionStart injects composeState: map
obeying the light + node memories + optional verbatim slices pulled from old
transcripts). Toggles never restart anything themselves; they change what the
next construction includes.

**Provenance index — association is captured at write time.** Every node is
born from a round; at that moment the filer holds the raw material with
stable identifiers (message uuids, tool_use_ids, file paths, URLs) and
records them against the node. `node ← round ← {session, tool outputs,
files, urls}`. Reconstruction tiers: digest (description/fit/memory —
default), raw (exact tool outputs by tool_use_id from archived JSONL), live
(file paths re-read natively — fresh beats stale).

**Three refinements (Mark):**
1. **Session-freshness chip**: instant changes vs boundary-bound changes are
   shown honestly — "N changes apply fully on fresh session — [start fresh]
   [compact now]", ⏳ badge on pending toggles.
2. **Auto-association confirmed**: no manual tagging, ever — the filing that
   already happens each round writes the accession record in the same motion.
3. **File snapshots for forking**: content-addressed capture — when a round
   references a file, hash + store the blob once (dedup); provenance records
   (path, content_hash). Normal work resolves paths live; fork/rewind
   resolves hashes to exact bytes ("changed since branch point" diff hints).
   This revives the foundation-phase "file changes stored like git" ruling;
   chat-side forking itself is native (Claude Code resume-as-fork), so file
   state is the only missing piece of the deferred fork/checkpoint feature.

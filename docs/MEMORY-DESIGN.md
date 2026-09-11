> Proposal of 2026-09-01, superseded by M214 (five organs at three lengths). The standing design is docs/MIND.md §4.4.

> VOCABULARY UPDATE (Jacob, 2026-09-01): the words gist/facts are DROPPED.
> Storage and code say minimal (the one-sentence current view), summary
> (the ≤150-word medium resolution), details (dated, provenance-linked,
> supersedable specifics). The design below predates the rename.

# Memory, restructured — design for review (M191 proposal, 2026-09-01)

Status: PLAN — for Mark + Jacob's review before any code. Driven by the
memory-RCT and the v2/v3/v4 import experiments (docs/archive/memory-rct-2026-08-31/).

## 0. The evidence this answers

| Measured failure | Number | Root cause | This design's answer |
|---|---|---|---|
| Background injection barely helps | lit arms 0.78–1.44 vs focus 1.72 | memories rank last, ship 0–1 per block | gists broadly, facts warmly |
| Confident inversion (P5) | 0 → answer opposite of ruling | title/statement served without substance | gist = required-current condensed view, always ships with the node |
| Stale truth wins (P2) | both map arms below baseline | superseded states indistinguishable | fact-level supersession + gist currency |
| Selection failure | 2/9 probes: fact on map, wrong branch lit | agent cannot reach beyond the light's aim | recall tool + gist index |
| Memory is write-only | 1,612 memories stored, ~0 served | blob memory competes all-or-nothing | facts serve individually |

## 1. Write side

**Schema.** `node_memory.text` (blob) is replaced by:

```
node_memory:  node_id PK, gist TEXT            -- 1–2 sentences, the CURRENT
                                               -- condensed view of the topic
memory_facts: id PK, node_id, text, fact_date,
              status TEXT ('current'|'superseded'),
              prov TEXT (json: {session, tool_use_ids, paths, urls}),
              created_at
```

**Gist duty (Mark's "correct condensed view").** The existing touched-memories
batch call now returns `{gist, facts[]}` per touched node. The gist must state
the topic's *present* standing — a gist describing a reversed decision as live
is a defect. Soft mechanical check: if any `current` fact is newer than the
gist's last update, the node is queued for a gist refresh (audited, no user
noise).

**Fact supersession.** The same call may mark existing facts `superseded`
(fact-level "choosing retires rivals", M65's organ). Superseded facts are
never served as current — they remain for provenance and history.

**Provenance.** Facts carry links into the existing provenance ladder
(M58/M57): digest (the fact text itself) → raw (tool output by tool_use_id
from archived JSONL) → live (file paths re-read fresh). No new capture
machinery — writes already record this; facts just keep the keys.

**Migration (1,612 existing memories + all future imports).** Hybrid: bulk
background pass (cheap tier, batched ~20/call) over nodes that are lit or
touched in the last 14 days; everything else converts lazily on first touch.
Blob column kept until Stage 4; dual-read in the interim. Import's memory
field maps directly: source detail → facts with provenance tags, plus one gist.

## 2. Read side — gists broadly, facts warmly, raw on demand

Composer changes (the M156 tier order becomes node-aware):

1. **Shape** (unchanged, budget-aware rollup from M190).
2. **Gists broadly**: every visible lit node's gist rides with its title
   (~150 chars each; ~200 topics of current-view awareness per block).
3. **Statements**: as today, node-granular fill.
4. **Facts warmly**: full `current` facts only for the WARM set, ranked by:
   - focus tree-distance (strongest — own subtree, then siblings/ancestors,
     then same-chapter cousins; in-memory maps post-M190d make this free),
   - filer-touched this session (free relevance signal),
   - explicitly lit by hand this session,
   - updated_at recency.
   Warm set is budget-bound (default: facts until 25% of remaining budget),
   drop-order = reverse warmth. "Memories drop first" survives *within* tiers.
5. Coverage line + ❗ (M162) unchanged; the agent-view modal shows gist/fact
   section sizes.

## 3. Recall — the pull channel

Tool for the host agent (MCP in the CC plugin; served to the built-in chat
server-side; Codex fallback: the injected block names the endpoint and the
＋session path since Codex lacks MCP-tool injection parity today).

- `recall(node)` → **card**: gist + current facts.
- `recall(node, "evidence")` → facts with provenance resolved: raw tool
  output by tool_use_id, live file re-read (fresh beats stale), URLs cited.
- `recall(node, "around")` → **neighborhood**: card + ancestor gists +
  children cards — the local tree, because a node's meaning lives in its
  ancestry (Mark's same-tree point).

**Guards (server-enforced, not prompt):**
- **Recall obeys the light.** A dimmed target returns only: "set aside by the
  user — offer to light it." No content. No side door.
- Rate: audited, per-session cap (default 20/turn-cycle) against loops.
- Every recall is transcript-visible and lands in dev-mode traces.

The gist layer doubles as the recall index — the agent sees the one-liners,
so it knows what it *can* reach; that converts selection failures into
recoveries.

## 4. Validation before ship (the harness exists)

New RCT arms on the same 9 probes + blinded judge, baselines V4L=1.44,
ceiling A2=1.72:

- **G** — gists broadly only. Hypothesis: fixes wrong-branch blindness cheap.
- **GW** — gists + warm facts. Target: ≥1.55 (closes half the gap to focus).
- **GWR** — GW + recall enabled. Must convert both selection failures (P1, P7
  class); target ≥1.65.
- Regression guard: focus arm must not degrade (gists steal no focus budget).

Suite additions: fact schema + supersession round-trip; gist-staleness queue;
recall dim-refusal; migration idempotency; a scaled compose-latency check
(<500ms at 2,000 nodes — locks in M190d).

## 5. Rollout stages

1. **Write side only**: dual-write gist+facts alongside blob. No serving
   change. Migration starts. (Reviewable in isolation; zero user-visible risk.)
2. **Serving switch** behind `HARNESSMAP_MEMORY_SERVING=cards` — run the RCT
   arms, publish numbers in-channel, flip default only on target met.
3. **Recall tool** (plugin minor version; the 🔑-page transparency section
   gains a "what the agent can pull" line).
4. Retire the blob column; remove dual-read.

## 6. Cost

Same call count per round (schema swap on the existing memory batch).
Migration: one-off ~80 cheap-tier calls for the warm bulk. Recall: on-demand
only, user-visible in the cost meter (`cost.recall` metric added).

## 7. Open questions for the review

1. Warm-set budget share: 25% of remaining — or should facts outrank
   *statements* for warm nodes (serve a warm node's facts before a cold
   node's statement)? Evidence leans yes; it inverts an M156 ordering, so it
   is Jacob's call.
2. Gist length: hard cap 300 chars at the store, or prompt-only?
3. Recall while influence is closed (M143): recall is agent-initiated, so
   closed influence should refuse recalls too — confirm.
4. Does born-lit-at-import-scale ruling (pending, M190d) land before Stage 2?
   The gist layer makes over-lighting cheaper but not free.

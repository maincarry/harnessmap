> Living design log of the brain (current). Its standing rules are summarized in docs/MIND.md §4.5.

# The Brain — design log

A running record of how the map's mind is built and why. Rulings carry who said them and when. Newest section last. Code references are to the tree as of 2026-09-08.

## 1. Settled shape (Jacob, 2026-09-08, 1:40–2:30 pm ET)

- **The user is sovereign.** Approves every proposal; their edits outrank every agent; their words and glossary bind every writer (M224).
- **The central mind is a dictator** — Jacob: "the central mind should still be the dictator, but with governors reporting to it, and it ultimately advises everyone." It keeps **its own overview of the whole project**, formed from the map itself (outline, instruments, history, the user's edits) — "it is not just as smart as dispatches" (Jacob). It consults the local and takes the final, most-informed call.
- **Governors are persistent local area agents**, created, managed and deleted by the central mind "with serious aim for persistency and continuity, so deleted agents leave their assets to the next folks even after redistricting" (Jacob). They report up. They never speak to an agent or the user.
- **The whole mind is advisory.** Nothing it produces applies by itself; tidy proposes; the user approves (Jacob: "the mind as a whole is an advisory organ").
- **The king writes the final report himself**, in one sitting, from his cabinet (structure from the reviewer, content from the areas, history, taste, the user's edits) and his governors, plus his own overview — and every agent's advice comes out of that same sitting, per-area advice included. One voice reaches the agents.
- **Principal–agent.** A governor sees its area deeply and the whole shallowly; it will overrate its area, defend its past judgments, drift into its own words. So: governors own knowledge, the centre owns judgment. A governor's disagreement must cite dated material that changed; a governor that keeps disagreeing without new material is a finding about the governor (the centre may redistrict it).
- **Staleness is a duty, not a risk** (Jacob: node descriptions carry dates now). A governor is regenerated from dated material on refresh, never by editing old prose; any claim in a report older than the newest change in its area is suspect and the centre's currency check runs over governors' text.
- **No measurement of the king's wisdom** (Jacob: "nearly impossible"). The filing test's currency line and a placement check stay as a regression alarm, not a proof.

## 2. What exists today (before governors)

`src/translator/mapstatus.ts`: `measureMap` (instruments incl. roots since M215) → `runMapStatus` (the structural review; provable shape findings ride mechanically) → `runContentScan` (per-chapter counts, newest change) → `assessChapters` (one stateless assessment per area, rewritten on change, sized to the area; dominant chapters assessed by their parts) → `historyStatus` → `synthesizeOverallStatus` (the understanding: essence, arc, tensions, keystones, gaps, trust, reconciliation, advice per lane: filing, lighting, review, chat) → consulted through `statusConsult(store, pid, forNodeId, lane)` and `chatAwareness`. Today `statusConsult` also serves the raw area assessment ("THIS AREA'S ASSESSMENT") straight to the filer, tidy and the lighter — that ends under §1.

## 3. Governors — concrete design

### 3.1 Store
Table `area_minds` (project_id, node_id = the area's root, status active|retired, understanding TEXT, log TEXT as dated lines, predecessors JSON of node_ids, created_at, updated_at, retired_at). One row per area, ever; retired rows keep their full text (the estate stays readable: "what area X used to believe").

### 3.2 Districting — the king decides
Input to the king's structural sitting: the outline with sizes, the current governors (root, size, age, last refresh), and the mechanical suggestion (top-level chapters + any subtree of ≥15 nodes, nested). Output: `districts: [{ rootId, action: keep | create | retire, reason }]`, validated against the outline's ids; unknown ids dropped and audited.
Rules: a governor is never retired while its area lives; redistricting happens only after a structural change the user approved (a tidy applied, an import applied, a user move) — never on the king's whim between; a retire must name the successors; the first refresh of a successor takes the predecessors' understandings as input (the estate). Retire without successors only when the area is gone from the map.

### 3.3 Refresh — when and from what
In the brain's cycle only (after N rounds, or the button), for governors whose area changed since their `updated_at` — the content scan's newest-change already knows. Never per round (cost: the filer's cost again). Input: the area's tiered material with dates, the governor's previous understanding and log, the king's last ruling on the area (its per-area advice and findings), the predecessors' text on a first refresh. Output: understanding (regenerated from the dated material, integrated with the previous text where the material still supports it), a dated log line ("what changed since"), and `disagreements` with the king's last ruling, each citing the dated node that changed. Model: the smart tier (Jacob: the governors' quality is where cost meets wisdom).

### 3.4 The king's sitting
`synthesizeOverallStatus` gains: the governors' dispatches (understanding + log tail + disagreements), and one more output section `advice_by_area: [{ rootId, advice }]` — the king's own words for each area, written from the whole. Disagreements the king does not accept become findings ("area X believes Y; the map as a whole says Z because …"). The king may read a province directly: when a governor disagrees, or when a decision turns on one area, the sitting's input includes that area's tiered material, not only the dispatch.

### 3.5 Consult — one voice
`statusConsult(store, pid, forNodeId, lane)`: the trimmed report + the lane's advice (as today) + the king's `advice_by_area` entry for the nearest governed area around `forNodeId` (walk up ancestors to the nearest active governor). The raw governor text is never served to an agent. The composer and the block: nothing local rides the block (Jacob). The guide may ask a governor's raw understanding through a map query (`kind: "area"`), served marked "the governor's belief, unreconciled, dated".

### 3.6 Migration
Each existing chapter assessment becomes its governor's first understanding (log line: "born from the assessment of <date>"). The `chapter_assessments` table stays for one release as the reporters' input, then retires.

### 3.7 Surfaces
🩺 map status: the king's report, then the governors' reports (understanding, log, disagreements, born/retired) under it, labeled as beliefs with dates; a retired governor is readable from its successor. Dev mode's agent network gains the governors as one node ("area minds", role mapcheck).

### 3.8 Cost
Refresh only changed areas: a busy hour touches 3–5 areas → 3–5 smart-tier calls per cycle (≈$0.05–0.10 at list). The king's sitting grows by the dispatches (25 governors × 300 words ≈ 10k tokens of input) — within the brain role's budget. Nothing per round.

### 3.9 Sanity plan
Mechanical: districting validation (unknown ids dropped; a live area never retired; retire names successors), estates (successor's first input carries predecessors), consult routing (nearest governed area; raw text never served), migration. End to end on a copy of v6: governors born for its 13 chapters; one round filed into an area → that governor alone refreshes; a fold of two chapters applied → one estate settled; the map-status page shows the reports. Alarm after: the filing test's currency line and the placement check.

### 3.10 Open, deliberately
- Whether the per-area advice is written for every area each sitting or only for areas whose governor reported (cost vs completeness) — default: only areas with a new dispatch, others keep their last advice with its date.
- The refresh cadence N — default: the cycle's existing trigger.

Status: designed, agreed, not built (Jacob, 2026-09-08 2:29 pm ET: "write the concrete brain design as a brain design design log, for this is important").

# The map (harnessmap)

Current state of the project map — always fresh; re-read after any map-change notice.
Focus/lighting below reflect what the user has chosen to emphasize.

```
[map state — the current structure of this work]

FOCUS (what the user is actively working on):
  ○ harnessmap

HOW THE FOCUS FITS (its place among parents and children):
  This is a complete, standalone goal map—it doesn't contribute to anything larger, and has no sub-goals beneath it. It stands alone as the full structure you're working with.

BACKGROUND (lit by the user as reference):
  (each topic at the detail the room allows — fuller near your focus)
  - Modification Log
      (MODLOG.md — 'Modification log — Jacob's design/change requests'. Every modification point Jacob raised, in order, with status. Each new request gets a numbered entry (Mn) when it lands. Requested in M31: 'keep a log of each and all of my modification points.' Source is a large document imported in 5 chunks; this is chunk 1 covering M1-M83 plus standing rules.)
    - v0.2 — 9-point critique
        (MODLOG.md '## v0.2 era — the 9-point critique (2026-08-13)'. Nine foundational fixes M1-M9, all shipped in v0.2.)
      - Two-way map
          (M1 — Two-way map: agent must RECEIVE the map every turn, not just write. ✅ v0.2 (composeState every turn).)
      - Capture everything
          (M2 — Capture everything: no commitment floor; tentative thinking lands as `exploratory`. ✅ v0.2.)
      - Integrate not append
          (M3 — Integrate, don't append ('fatal' flaw): per-round sticky integration into the goal tree. ✅ v0.2. This principle recurs (see M41 node-memory, M67 filing rules).)
      - Hierarchical lighting
          (M4 — Hierarchical lit: lighting a parent lights its descendants. ✅ v0.2.)
      - Focus not lit
          (M5 — Focus ≠ lit: separate controls, separate meanings. ✅ v0.2.)
      - Map legend
          (M6 — Legend explaining the map's marks. ✅ v0.2 (the `?` button). Later refreshed in M83.)
      - Auto-fold branches
          (M7 — Auto-fold non-focus branches. ✅ v0.2.)
      - Tidy flow
          (M8 — Reorganize/tidy: confirm target → proposal → before/after preview → apply/cancel. ✅ v0.2, resolved (a)+(i). Basis for the whole tidy lane later refined in M69, M70, M72, M76.)
        - M122 — Tidy top level
            (Jacob 2026-08-23, follow-through on jurisdiction-gap ("agents not capable of achieving proposal they themselves proposed — why?"). Top level now a tidy target. ⟳ tidy top level (in ⋯ other) runs propose→approve with nodeId=null → ROOT SCOPE: tidy agent sees every top-level thread (+2 levels, M72 depth protections intact) and ONLY here holds license to create top-level domain containers (create_node parentId null) and move top-level threads under them. 'to sort' tray = system infrastructure, not writable, ops filtered. Create filter now scope-aware: subtree tidies can't create parentless nodes at all (guards-not-p)
          - M122b — Modal crash fix
              (Jacob bug report 2026-08-23: "The tidy proposal is not showing any proposal." Real crash: M121's before/after walk called .join('') on a recursive call already returning a string — template IIFE threw, killing whole modal after fetch. Caught by rendering the REAL playground proposal through extracted modal code in a headless harness; fixed (drop stray .join); both subtree and root scopes render. Lesson: parse checks don't execute template IIFEs — render-test UI code paths with real data before shipping. Provenance: MODLOG M122b.)
      - Upward propagation
          (M9 — Upward propagation: parent names follow their children's drift. ✅ v0.2.)
    - v0.3 — one conversation + zoom
        (MODLOG.md '## v0.3 era — one conversation + zoom (2026-08-14)'. Covers M10-M28: single conversation, map-as-memory, zoom lane, auto-light, manage panel, agent's view, auto-naming, no-manual-edit ruling, suggestion dots, bug fixes.)
      - One conversation
          (M10 — One map, one conversation; chat list dissolved; '+' creates nodes. ✅ v0.3.)
      - Map-as-memory
          (M11 — Map-as-memory (option b): agent context = map + rolling window, no perpetual session. ✅ v0.3. Core architectural anchor — the map is storage, the agent is stateless.)
      - Tidy hang bug
          (M12 — Bug: tidy hangs silently at 'preparing…'. ✅ v0.3 (90s timeout + visible error).)
      - Focus button bug
          (M13 — Bug: focus buttons ineffective, no confirmation stage. ✅ v0.3 (confirm + optimistic UI + server restart).)
      - Zoom lane
          (Zoom introduced across M14-M16 (Z1/Z2/Z3) in v0.3.1, later brought to full consistency in M82. Zoom dims everything outside the subtree; zoomed view shows only the subtree; focus shift only SUGGESTED, not forced.)
        - Dedicated zoom button
            (M14 — Z1 (ii): dedicated zoom button, not name-click; tidy up clumsy row buttons. ✅ v0.3.1.)
        - Zoom operational
            (M15 — Z2: zoom is operational — dims everything outside the subtree; *correction:* focus shift only SUGGESTED. ✅ v0.3.1. A basis for the suggest-then-confirm standing rule.)
        - Zoom shows subtree
            (M16 — Z3 (i): zoomed view shows only the subtree. ✅ v0.3.1.)
        - Zoom out
            (M30b — Zoom OUT to the immediate parent node. ✅ v0.4.1 (↑ zoom out).)
      - Auto-light
          (M17 — Map agent recommends and implements lighting (auto-light). ✅ v0.3.1.)
      - Manage panel
          (M18 — Manage panel governs focus AND lit. ✅ v0.3.1.)
      - Auto-focus and auto-zoom
          (M19 — Auto-light in manage panel; add auto-focus and auto-zoom (confirm before implement). ✅ v0.3.2. Suggest-then-confirm basis for the attention lanes.)
      - Agent's view
          (M20-M21: transparency of the agent context. M20 added the 'agent's view' button; M21 kept it legible at scale. This is the basis for the standing rule 'what the agent sees, the user can see.')
        - See agent context
            (M20 — The user should see the full map description the agent gets; add a button. ✅ v0.3.2 ('agent's view').)
        - Structural caps + token budget
            (M21 — Agent's view gets ugly as the map expands → approved (a) structural caps + (b) token budget. ✅ v0.3.3. Includes a visible-omission rule.)
      - Auto-naming
          (M22 — Auto-naming: never force naming; name from the conversation like Claude/GPT. ✅ v0.3.4. Refined in M34, M36, M37, M40, M68, M83.)
      - No manual editing
          (M23 — Scope ruling: NO manual map editing in MVP (no move/rename/wrap-selection) — bare minimum, automated map — 📌 STANDING. The filer suggests (M24), never acts. Users later got limited triage verbs on to-sort children (M52) as an explicit exception.)
      - Filer never restructures
          (M24 — 'Genuine necessity' ill-defined → filer never restructures; red-dot suggestion, user decides, dot dismissable. ✅ v0.3.5. Suggest-then-confirm anchor.)
      - Demand suggestions button
          (M25 — How frequent are suggestions? + button to demand suggestions or get 'well done, your map is clean!' ✅ v0.3.6 (● check map, later renamed ● tidy map in M72).)
      - Merge duplicates bug
          (M26 — Bug: merge leaves duplicates; suggestions don't guarantee solutions. ✅ v0.3.7 (zombie-status root cause + hint-scope + mandatory merge procedure).)
      - No delete button
          (M27 — Bug: no topic delete button. ✅ v0.3.7.)
      - Duplicate delete buttons
          (M28 — Two identical delete buttons → fix inconsistency. ✅ v0.3.7b (then dissolved entirely by v0.4's single node `del`).)
    - Nodes all the way down
        (MODLOG.md '## v0.4 era — nodes all the way down (2026-08-14)'. Covers M29-M48. The 'major major flaw' fix: no topic/item split, only nodes and sub-nodes, zoom on anything. Event-sourced migration. Then rich node state (title/content/fit/memory), tree guide lines, and the light-is-the-law arc.)
      - Everything is a node
          (M29 — 'Major major flaw': no topic/item split — only nodes and sub-nodes; zoom on anything. N1: node = type + ancestors + children (+ artifacts later); statuses stay non-fixed; artifacts deferred. ✅ v0.4 (true rewrite, event-sourced migration). Foundational — 'everything is a node' becomes a standing rule.)
      - Clean-chat button
          (M30a — Clean-chat button in the chat screen. ✅ v0.4.1. Clean-chat later ruled a VIEW function (M42/W2).)
      - Row buttons
          (M32-M35 cleaned up node-row buttons. Final row ops after M33: zoom · ▶ · ☀ · + · tidy · del. Manual status buttons (✓ ‖ ✗) dropped entirely — statuses are the automated map's job.)
        - Idle buttons
            (M32 — Clean up node row buttons — some are idle. ✅ v0.4.1 (first pass: contextual hiding).)
        - Drop manual status
            (M33 — (1) ▶ should LIGHT UP on the focused node (always visible, accent), not disappear; (2) drop ✓ ‖ ✗ manual status buttons — statuses are the automated map's job (consistent with M23/M24); say it in conversation instead. ✅ v0.4.1 (row ops: zoom · ▶ · ☀ · + · tidy · del).)
        - Instant node creation
            (M34 — '+' still asks for a name → auto-naming not felt. ✅ v0.4.1 (name prompt removed: + creates the node instantly; the map names it, click its text to rename manually).)
        - Add ≠ zoom
            (M35 — Add node ≠ zoom in. ✅ v0.4.1 (adding never changes the view; the one confirm is about focus only; zoom stays its own gesture).)
      - Rich node state
          (M36-M44 built up node state: title vs content split (M36), simpler auto-titles + detail modal (M37), relational 'how it fits' (M38), self-contained descriptions + op-time estimates (M39), auto-naming bug fixes (M40), node chat MEMORY (M41), second-place conversation memory harness (M42), machine-memories read-only ruling (M43), conversation-shaped focus summary (M44).)
        - Title vs content
            (M36 — Node titles too long — separate title from description. ✅ v0.4.2 (nodes carry `title` = short display label + `content` = full statement; map shows titles, agent reads full content; filer titles every new node and refreshes stale ones; existing long nodes backfilled).)
        - Minimal titles + detail modal
            (M37 — (1) auto-naming aims at MINIMUM simple wording (2-4 plain words, 'how you'd say it out loud', drop nuance rather than cram); (2) descriptions must be visible — click a node to see and edit title + description. ✅ v0.4.2 (detail modal; whole map retitled).)
        - How it fits
            (M38 — Relational description per node: how it fits its surroundings, auto-updated as they change; scope 2 up / 2 down (Jacob); agent receives it in context; guides reorganization. ✅ v0.4.3 (lazy + neighborhood-hash cache — scales at any size; 'How it fits' in detail panel; HOW THE FOCUS FITS in agent context, warmed async ≤1 round behind; tidy gets relational notes as misplacement clues).)
        - Richer descriptions + opWatch
            (M39 — (1) descriptions self-contained (numbers, names, reasons, WHY); (2) 'how it fits' 1-3 tight sentences, no filler; principle: informative first, compact second, never ugly at scale; (3) ops likely to exceed 1 minute warn beforehand with estimated time. ✅ v0.4.4 (prompt updates + opWatch: every model-backed button shows size-based estimate, pre-warns when >60s, escalates the status line past a minute).)
        - Auto-naming fixes
            (M40 — (1) bug: auto-naming gives full description or stays blank → untitled duty sets BOTH informative content AND minimal title, whole-map untitled sweep every round; (2) clicking a node offers a suggested auto-rename with 'use this' adopt button; (3) bug: highlights invisible → recency was in-memory, reset on restart; now derived from persisted updated_at stamps; (4) category editable in node panel. ✅ v0.4.5. Also: M39's richer-description rule regressed the translator gate to 9/13 (park-all session-mood bug); anti-park-all check moved into per-round instruction → gate back to 11/13, 0 errors.)
        - Node chat memory
            (M41 — Node state = THREE descriptions: description, fit, and chat MEMORY (a record of conversation conducted while the node was focus). ✅ v0.4.6 (node_memory table; merged async after each round by a digest model, ≤150 words, integrate-don't-append; shown read-only in the node panel; fed to agent as FOCUS MEMORY when focused — per-node memory deeper than the rolling turn window).)
        - Two-memory harness
            (M42 — Small-talk problem: two memories — map memory is guide, conversational memory second-place, harness-style (not a schematized extractor; Jacob), because the SDK's own compaction can't be steered. Window 10→20 verbatim turns + rolling ~150-word summary of scrolled-out turns. P1 write-time dedupe (map-covered material excluded), P2 removals die in the summary (removal notices fed to the folder), P3 read-time subordination ('on any conflict the map wins'). Clean-chat is a VIEW function (Jacob's W2 ruling): the summary survives cleans and absorbs the turns a clean cuts. ✅ v0.4.7.)
        - Memories read-only
            (M43 — User should not be allowed to edit the focus summary. ✅ already true (all machine-maintained memories — node chat memory, 'how it fits', the second-place conversation summary — are display-only; the harness is their only writer. User-editable: title, description, category). 📌 recorded as a standing ruling.)
        - Conversation summary structure
            (M44 — Focus/chat summary should be a CONVERSATION summary, not content-only: what the user asked, how the agent responded, how the user seemed to take it — content as the spine. ✅ v0.4.8 (node-memory digest prompt rewritten around the dialogue shape + reaction trail).)
      - Tree guide lines
          (M45 — UI hierarchy unclear → grilled with samples; Jacob chose A: tree guide lines. ✅ v0.4.9 (vertical guides connect children to parents at every depth, file-explorer style).)
      - Lit privilege ladder
          (M46 — Lit should mean more now nodes are enriched: a lit node's background payload = full DESCRIPTION (no fit — Jacob; no chat memory — focus-only privilege). Privilege ladder: focus = everything · lit = knowledge minus conversation · elsewhere = one line · dark = nothing. Lit families render indented under their parent. ✅ v0.4.10.)
    - Keep this log
        (M31 — Keep a log of each and all modification points. ✅ v0.4.1 (this file, MODLOG.md). The origin of the modification log itself.)
    - Light is the law
        (M47 conceptual anchor (Jacob): the map is storage, the map agent is a stateless worker; the user's light is the floor, the agent manages its reading above it. Covers M47-M56: the light-as-law arc, to-sort folder, triage verbs, agent-assisted placement. v0.5 era, 2026-08-15/16.)
      - Light bounds writes
          (M47 — Zoom scope arc → 'the light is the law' (v0.5): no creation outside the light; map agent's reading = chat agent's floor (dim = top-level one-liners) + expansion-on-demand (≤3 branches, one re-run, READ-only); writes bounded by the user's light via server-side guard (out-of-light creations → top-level 'to sort' with provenance + amber re-light suggestion; root creations count as out-of-light; dim updates dropped); re-light is fit-checking, separate from moving; 'to sort' pinned in zoomed view; tools (tidy/check/auto-*) unaffected. ✅ v0.5, gate 12/13 (best), e2e 12/12.)
      - Test-drive fixes
          (M48 — (1) node references in chat markers use TITLES not descriptions (Jacob); (2) fold caret enlarged; (3) overlong auto-titles (>64 chars) rejected at the store — previous good title kept; (4) orphaned-focus bug (tidy-apply deletions had no focus rescue) → focus validates on every state build; (5) relight notes without a created node get one synthesized into 'to sort'; (6) to-sort integration reliable: deterministic server-side PENDING INTEGRATION injection fires when a suggested home becomes writable, amber notes auto-close when node finds a home. ✅ v0.5.1.)
      - No harness narration
          (M49 — Bug (Jacob's 'What on earth???'): chat agent refused a breakfast question ('not really my lane') and narrated harness mechanics ('the map's focus is on a new node you just created…') — composed instructions said 'advance the FOCUS' with nothing licensing normal conversation. Fixed: the map guides WORK priorities, never refuses casual/personal asks, never redirects to the map, never narrates harness state (no meta-speak about focus/nodes/context blocks). ✅ v0.5.2, verified.)
      - No dignity threshold
          (M50 — Jacob overruled the work/small-talk boundary: the map has NO topic dignity threshold. Whatever the user is deliberating IS map material (breakfast = question + options + choice, same as a thesis); only pure dialogue mechanics (greetings, acks, pleasantries, harness meta-talk) produce nothing. ✅ v0.5.3, verified: breakfast becomes a 'breakfast choice' topic in 'to sort' with options; gate 11/13, 0 errors. Later reframed as 'topic map' in M73.)
      - to-sort folder
          ('to sort' is the system dumpster/parking-garage (Mark's phrase, M61): capture without structural claim, promotion by re-mention/place/promote. Governed by M51 (system folder, uneditable), M52 (exit verbs), M53-M55 (agent-assisted place, cycle guards, subtree-follows), M56 (bottom-pinned).)
        - System folder
            (M51 — 'to sort' is a system folder: name/description/category not editable (server rejects + info modal instead of the edit panel, which also explains the three ways out). ✅ v0.5.4.)
        - Exit verbs
            (M52 — To-sort items always have an exit: '↖ place' (pick any destination from a tree picker) and '★ promote' (become a top-level topic) on every to-sort child — user triage verbs, restricted to to-sort children (general manual moving stays out per M23); provenance stripped on the way out; amber notes auto-close. ✅ v0.5.5.)
        - Agent-assisted place
            (M53 — 'place' is agent-assisted (Jacob: 'the map agent should search and fetch home for it'): picker first shows the map agent's candidate homes with reasons (whole-map search — user-invoked tool, lighting-unaffected); full-map browse collapses to a fallback; promote remains the no-home answer. ✅ v0.5.6.)
        - Place cycle guard
            (M54 — 'place' destinations exclude the item's own subtree (cycle guard) and anything inside 'to sort' — enforced in server guard, browse picker, and suggest-home filter. ✅ v0.5.7.)
        - One topic one subtree
            (M55 — 'place all subnodes with it': children ALWAYS follow a place (moving a node carries its subtree). The real gap: the filer scattered one deliberation as to-sort SIBLINGS → new rule: one deliberation = ONE subtree in 'to sort', provenance once on the topic node. ✅ v0.5.8. Reframed 'deliberation'→'topic' in M73.)
        - Bottom-pinned
            (M56 — 'to sort' always renders at the BOTTOM of the whole-map view (already bottom-pinned in zoomed view). ✅ v0.5.9.)
        - M123 — To-sort permanence
            (Jacob 2026-08-23 bug batch. TO-SORT VANISHED: tidy apply removed the tray itself (map_events seq 177, source reorganize). Ruling: to-sort always present as pinned system node even if empty. (1) store guard skips any update/move targeting live top-level to-sort from every source; (2) ensureToSort(pid) idempotent at boot + project creation; (3) delete endpoint refuses to-sort with 409; (4) tray row hides ✕ ⇢ ↖ ⟳. Adoption predicate: system tray doesn't count as content for pristine check. FOCUS ORPHANS: delete/reorganize-apply now rescue EVERY chat of project (to parent, else surviving top-level); merge already did)
    - v0.6 — Claude Code plugin
        (MODLOG.md M57-M62 (M57 spike, M58 real plugin, M59 delta injection, M60 push+pull, M61 playground). Plugin package hooks into native Claude Code: SessionStart, UserPromptSubmit, Stop, PreCompact. Green-lit by both principals Mark + Jacob.)
      - Plugin spike
          (M57 — Plugin spike, PROVEN end-to-end on native Claude Code, headless: (1) Stop hook → /api/harness/observe → filer filed a real CC round into a clean topic tree; (2) fresh session + UserPromptSubmit additionalContext → full recall including status nuance ('a proposal, not locked in'); (3) dim + focus-shift → new native session honestly lacked branch details (name + count only), constraints floor intact by design. Fixed: ELSEWHERE's folded one-liner leaked full node description → now name-only. Adapter surface: POST /api/harness/observe, GET /api/harness/context, hooks in src/spike/cc-plugin/. ✅ spike, strategy g)
      - Real CC plugin
          (M58 — The real Claude Code plugin (both principals green-lit): `plugin/` package (.claude-plugin manifest + hooks.json + four hooks: SessionStart = node↔session indexing + map-core auto-start; UserPromptSubmit = per-turn map injection; Stop = observe; PreCompact = map-aware compaction instructions); server adapter hardened — server-side transcript slicing by last-observed uuid (harness-adapter.ts), harness_sessions index, provenance table capturing message uuids + tool_use_ids + file paths + urls per round. Verified with a REAL tool-use round (Read's tool_use_id + exact file path in provenance). Deferred: freshne)
      - Delta injection
          (M59 — Mark's snapshot-accumulation concern (injections persist in append-only transcript → every turn stacks a full snapshot): fixed with DELTA INJECTION — full map block once per session, then only changes since the anchored map-event seq (often nothing: zero tokens), user-action notices folded in; PostCompact hook re-anchors so the turn after compaction re-injects the full block. Verified: full → null → small delta → full-after-compaction. ✅ v0.6.1.)
      - Push + pull awareness
          (M60 — PUSH = injections (full block once/session, deltas after) with bounded-reconstruction re-anchor (full re-injected after N=15 accumulated changes); PULL = .harnessmap/MAP.md written into every active host project on map change (same lighting keyhole), pointed at by the full-block header and every delta notice — agent Reads on demand, CC's micro-compaction self-cleans old reads. CLAUDE.md ruled out for state (loaded once per session). Verified: file created on session-start, refreshed on change, delta pointer present, threshold re-anchor fires, real session consulted the file. ✅ v0.6.2.)
      - New-topic guarantee
          (M61 — Playground feedback (Mark+Jacob live): (1) map UI shows host-session life ('message received — agent is replying…' + 'filing the round onto the map…'); (2) weather-topic miss (filer SAW an unrelated topic and filed nothing) → NEW-TOPIC GUARANTEE: any topic absent from the map leaves ≥1 node, however transient (weather → question[answered] in 'to sort'); only pure mechanics produce nothing; (3) guarantee re-triggered park-all regression (gate 9/13) → MECHANICAL GUARD: >6 same-status-only flips in one round capped at 6. Gate 10/13, 0 errors. Ruling: Mark's 'dumpster/parking garage' = 'to sort'; per-NEW-TOPIC )
    - v0.7 — filer & inference
        (MODLOG.md M63-M70. Filer design rulings (Mark), inference backend abstraction, seven-type vocabulary, fleet testing, born-lit nodes, Nest bug fixes, title self-heal, conversational tidy, tidy latency. Note: M62 not present in the log (numbering skips 62).)
      - Filer design rulings
          (M63 — D1: rich assistant-side capture KEPT ('I feel like I have an assistant keeping track of everything'; predefined-type-vocabulary parked — Jacob earlier ruled FOR open vocab, needs reconciling). D2: inference backend abstraction (src/inference.ts): 'subscription' DEFAULT (Agent SDK, tools off, 1 turn — inherits CC auth incl OAuth; strict-JSON prompt + parse + 1 retry) with HARNESSMAP_INFERENCE=api opt-in (direct SDK, enforced json_schema); all 9 model modules routed through it. D3: model tiering — cheap model per-round, HARNESSMAP_SMART_MODEL (sonnet) for tidy + mapcheck. D4: dashboards deferred, audit_log ta)
      - Seven-type vocabulary
          (M64 — Type vocabulary settled (Mark, reconciling Jacob's open-vocab ruling): FILER labels from a fixed set of seven (claim/question/option/decision/constraint/evidence/task; headings untyped; exploratory musings = claim/question + exploratory) — schema-enum-enforced on api, prompt-enforced + guard-coerced (audited offlist_type) on subscription; USERS retype any node to any word freely. Consistent machine labeling for future fine-tuning; product openness preserved. Gate 10/13, 0 errors. ✅ v0.7.1.)
      - Fleet test
          (M65 — Filer fleet test (Mark: 20 rounds, own project each, diverse personas): src/eval/fleet.ts — 20 scenarios (PhD/founder/parent/novelist/coach/lawyer/teacher/gamer/retiree/engineer/musician/applicant/landlord/chef/traveler/student/scientist/shopper/self-improver/organizer). Two api runs (37/42, 36/42 ≈ 87%) + subscription spot-checks (~7s/round, guard caught offlist type). REAL BUG: model reusing a short id for two creates minted the same uuid → second node lost (UNIQUE) — normalizeIds re-mints on repeated creates. Weaknesses: (1) exploratory self-doubt capture ~50% flaky (evidence for two-pass filer); (2) cho)
      - Born lit
          (M66 — New nodes are born LIT (Jacob): every created node (filer rounds, user '+', tidy applies, guard-synthesized to-sort arrivals) auto-lights; the user dims deliberately rather than lighting deliberately. Softens fresh-map UX from the fleet report (to-sort births visible to the agent). ✅ v0.7.3.)
      - Nest bug fixes
          (M67 — Jacob's Nest bug ('why isn't it generating more nodes under google nest?'): filer (1) compressed the agent's multi-fact answer into one blob, (2) placed it as a SIBLING of the Nest option instead of under it, (3) once created a node narrating the dialogue ('User asked for more detail…'). Two new rules: INFO EXPANSION (a 'tell me more about X' round files each distinct fact as its own child UNDER X, merged with existing children) and NODES STATE FACTS, NEVER NARRATE THE DIALOGUE. Bench: 5 fact-children under the Nest profile, 0 narration nodes. ✅ v0.7.4.)
      - Title self-heal
          (M68 — Titles ≤6 words, broken names ALWAYS self-heal (Jacob): store rejects titles over 6 words/64 chars (audited); a healer sweep (boot + after every round, ≤5 nodes/sweep, off the hot path) auto-titles any node whose displayed name would run long — including bug leftovers like narration-content nodes. Verified: seeded broken node healed to a 5-word title on boot. ✅ v0.7.5.)
      - Conversational tidy
          (M69 — Conversational tidy (Jacob): the reorganization proposal modal gains a feedback line — type a different idea ('group by price instead'), ↻ re-propose, and the map agent builds THAT proposal (user direction overrides its instincts; prior proposal passed as context); loop until apply/cancel. Bench: generic cleanup → 'exactly two sub-branches: historical vs institutional' → obeyed. ✅ v0.7.6. This feedback-loop pattern is reused across auto-* lanes (M80).)
      - Tidy latency
          (M70 — Tidy latency on complex maps (Jacob): input SCOPED (target subtree in full; rest as one-liners — tidy can't touch it anyway per the scope guard) + ADAPTIVE model tier (≤8-node subtrees use cheap model; larger get smart). Real-map timing on slowest path (subscription+sonnet): 10s, from the 30-90s class. Future: pre-compute proposals in background when a red/amber dot is filed, so dot-initiated tidy opens instantly. ✅ v0.7.7. Scoping later tightened by M72.)
      - Precomputed proposals
          (M71 — Precomputed dot proposals, cost-throttled (Jacob, 2026-08-17): 'Precompute proposals is exactly the right move, but not too often' — clarified as COST trouble. Cost-minimal: when a dot is filed (and at boot), a background sweep computes its proposal ONCE — ever — after a 25s settle debounce, serially (one per sweep), never while the filer queue is busy. Cached on the suggestion row (proposal + proposal_hash = subtree updatedAt-hash). Click serves cache instantly when hash matches (audit proposal_cache_hit); stale or feedback requests always compute live — background NEVER recomputes. Net ≈ one extra call, u)
      - Local-neighborhood tidy
          (M72 — Tidy reads only the local neighborhood; whole-map read is tidy-map's job (Jacob, 2026-08-17): 'Tidy should only read up 1 ancestor and 1 child… Only the check-map, or rename it tidy map, should read whole thing.' Per-dot/per-node tidy input: parent (one-liner, orientation), target, children, grandchildren. Deeper content hidden behind '+N nested below — do NOT remove or edit' markers; scope guard drops removals/content-edits of nodes with hidden depth (moves-whole allowed). Replaces M70's whole-map-as-one-liners render. UI: '● check map' → '● tidy map' (mapcheck keeps full-map read).)
      - Topic map
          (M73 — Topic map, not deliberation map (Jacob, 2026-08-17): 'this is not a deliberation map, it is a topic map. Whether the agent had lunch is a clear topic. Drop the talk of deliberation.' Filer was refusing nodes for topics that didn't look like weighing-a-choice. Prompt reframed: THIS IS A TOPIC MAP — whatever gets discussed is a topic, no dignity threshold, no requirement of question/options/decision shape; only pure dialogue mechanics produce nothing. 'ONE DELIBERATION = ONE SUBTREE' → 'ONE TOPIC = ONE SUBTREE'; FILER-DESIGN.md aligned. Gate 12/13 (previous best 10/13).)
      - Attention nudges
          (M74-M75 built mechanical, zero-model-cost nudges: drift out of focus+light raises red dots on the attention buttons (M74); explicit focus requests raise the auto-focus dot with a remembered target (M75). Any focus/light/zoom action clears the nudge.)
        - Drift nudge dots
            (M74 — Nudge auto-focus/auto-light with red dots (Jacob, 2026-08-17): v1 is mechanical (zero model cost per M71): when 2+ consecutive rounds land new material in 'to sort', the conversation has drifted outside the current focus+light — both buttons get a pulsing red dot with explanatory tooltip. Any focus/light action (focus change, lit toggle, zoom-in) clears the nudge and resets the streak. Audit kind nudge_raised.)
        - Explicit focus nudge
            (M75 — Explicit focus requests raise the auto-focus nudge + host notice (Jacob, 2026-08-17): detection piggybacks on the per-round filer (no extra model call): optional focus_request:{id} output field + final-check ('let's focus on X' → the node where X lives; passing mentions are NOT focus requests). Server raises the focus red dot with the named target (tooltip shows it), remembers the target so clicking ▶ auto-focus serves it INSTANTLY without a model call, appends a ONE-SHOT notice to the next injection so the host points the user at the button. Any focus/light action clears. Bench: explicit ask → correct node)
      - Tidy knows its lane
          (M76 — Tidy never drops for irrelevance; that's focus/light's job (Jacob, 2026-08-17): 'It is not right to propose dropping a node merely because user focused on another node.' Both tidy surfaces carry a KNOW THE SYSTEM'S OWN FUNCTIONS rule: reorganize (never propose removal because the user focused elsewhere / conversation moved on / node seems inactive — removal only for redundancy and debris) and mapcheck (never FLAG for inactivity or distance from current focus — only structural problems), since mapcheck notes become hints reorganize must resolve.)
      - Talk to map
          (M77-M82 built the talk-to-map lane: '🗨 ask the map' → renamed 'talk to map'. A cheap-tier, user-initiated, strictly ADVISORY mapchat specialist that diagnoses map issues and returns approve-cards routing through the same guarded endpoints the buttons use. Grows to propose focus/light/zoom/tidy, delegate to auto-* specialists, and emit ordered multi-specialist plans.)
        - Ask the map
            (M77 — Direct line to the map agent (Jacob, 2026-08-17): 'When there are map-related issues, there should be an option for the user to directly talk with the map agent.' New mapchat specialist (cheap tier, user-initiated only — no background cost): knows the system's real controls (focus, light/dim, zoom, to-sort, dots, tidy map, direct edits) and answers with a diagnosis + exact fixing actions. Strictly ADVISORY — cannot edit from this channel, told never to claim it did. UI: '🗨 ask the map' button beside ● tidy map opens a chat modal (session-local history, last 4 exchanges fed back). Chat-agent side: injected )
        - Propose and apply
        - Specialist delegation
        - Propose-accept auto lanes
        - Multi-specialist plans
        - Zoom consistency
      - Auto-rename button
    - Standing rules
        (MODLOG.md '## Standing rules distilled from the above'. The invariant principles: user controls flow, automated map no manual restructuring (M23), suggest-then-confirm (M15/M19/M24), everything is a node (M29), what the agent sees the user can see (M20/M21), machine memories read-only (M43), the light is the law (M47), no topic dignity threshold (M50), new-topic guarantee (M61).)
      - Map is the product
          (Standing rule: 'The user controls the flow tangibly; the map is the product, chat is the interface.')
      - Suggest then confirm
      - Open vocabulary
      - Light is the law
    - M83b — long-name detection
    - M84 — node search
      - M84b — row favorite button
      - M93 — shared search state
    - M85 — dim behavioral rule
    - M86 — stale cache self-heal
    - M87 — verification sweep
    - M88 — projects & chats
      - M92 — focus picker
    - M89 — integration suite
    - M90 — three merges
      - M94 — merge substance
      - M95 — chat merge killed
    - M91 — packaging
    - M96 — display polish
      - M96b — tooltip audit
    - M97 — embedded terminals
      - M97b — Bun native PTY
        - M102 — resize fix
      - M98 — sessions unified
        - M99 — prompt stash + close
    - M100 — node move
    - M101 — clearable status
    - M103 — subscription billing
    - M104 — illumination design
      - M104-REWOUND
    - M105 — zoom/dim split
    - M106 — what changed
      - M106b — new/changed chips
      - M107 — persistent marks
    - M108 — tutorial tour
      - M108b — tutorial clarity
    - M109 — to-sort refined
      - M109d — amber dead
    - M110 — pane resizing
    - M111+M112 — focus path
    - M113 — Dev mode
      - M115 — Timeline as story
    - M114 — Add-node redesign
    - M116 — Proposal cards
    - M117 — The cast
    - M118 — Tidy leads with changes
      - M119 — Styled diff trees
      - M121 — Human-language preview
      - M182 — No long rename names
    - M120 — Expand immediate only
    - M124 — Agent coordination
    - M125 — Home node
      - M126 — Home row button
      - M128e — Home → anchor
      - M128f — Home → ◉
      - M128g — Home SVG house
    - M127 — Tutorial catch-up
    - M128 — Tiered menu
      - M128b — More button vanishes
      - M128c — Glyphs restored
      - M128d — ⟳ tidy glyph
    - M129 — Session modes
    - M130 — Zoom root fold
    - M131 — UI smoke harness
      - M131b — Tooltip coverage
    - M132 — Two modes
      - M132 — Reversed
      - M132b — Reinstated
      - M134 — Toggle dropped
    - M133 — Mobile view
      - M133b — Mobile preview button
      - M133c — iPhone frame
      - M133d — One switch button
      - M135 — ChatGPT-mobile rebuild
      - M135b — Row is its name
    - M136 — Undo
    - M137–M140 — Mode-A chat
      - M137 Choice promoted
      - M138 Markdown
      - M139 Streaming
      - M140 Copy
      - M173 — Thinking bubble fix
      - M174 — Greetings not map business
      - M175 — Point at ＋ session
    - M141 — Packaging hardened
      - install-smoke (21 checks)
    - M142 — IMPORT agent
      - Import agent design
      - Import sources
      - Import flow
      - M157 — Import CC memory
      - M187 — Import at scale
    - M143 — Close influence
    - Text size control tour seven beats
    - M145 — Reference card cleanup
      - M145b — Guide fallback
    - M146 — Sessions + pins
    - M147 — Four keys, rest folded
    - Display categories and statuses
    - M149 — Agent's view → dev
    - M150 — Import → ＋more
    - M151 — Plain words: focus
      - M151b — Plain words: zoom
    - M152 — Three-concept doctrine
      - M153 — Tour = three moves
    - M154 — Talk to map primary
      - M171 — Inline talk-to-map
        - M171b/c — Briefed referrals
    - M155 — Focus unmistakable
    - M156 — Node memory 1+3
      - M156 slice 2
      - M156 complete (2+4)
      - M156b — No new terminology
    - M158 — Feedback via guide
    - M159 — Dev mode reorg
      - M159b — Feedback list
      - M159c — Dev mode gated
    - M160 — Codex support
    - M161 — Update visibility
      - M177 — Correct update command
    - M162 — Context visibility
      - M162 part 1 — trim warning
      - M162 part 2 — agent view
      - M162 part 3 — focus pill
        - M162b — Pinned divider
      - M165c — Sectioned exact text
    - M163 — Restyle
      - M163b — Status color fade
      - M163c — Update note box
      - M163d — Talk-to-map redraw
    - M163e — Exact text visible
      - M163f — Leak audit
    - M164 — Favorites tray
      - M164b — Favorites folder
    - M165 — To-tidy folder
      - M165b — No auto-expand
    - M166 — Auto-review
      - M166b — Or 30 minutes
    - M167 — Native popups gone
      - M167b — Folders never hide
      - M167c/d — Guide alignment
    - M168 — Three-tier menu
      - M168b — Docs caught up
      - M168c — Tier amendment
      - M168d — Card carries functions
      - M168e — Mobile row removed
    - M169 — Email feedback path
    - M170 — Breathing status
    - M172 — Direct feedback button
      - M172b — Feedback fix
      - M172c — Save first
      - M172d — Card polish
    - M176 — Tunnel guard
    - M178 — Tutorial seed map
    - M179–M180 — Login rewound
    - M181 — Host/Origin guard
    - M183 — Docs pulled, license implicit
    - M184 — Local metrics + cost
    - M185 — Key scrubbed
      - M185b — .env deleted
      - Setup subscription model for test suites
    - M186 — Auth transparency page
      - M186b — Roadmap: wizard
  … 1 lit topic(s) omitted for space (stalest first).

ELSEWHERE ON THE MAP (folded — set aside by the user; see the rule below):
  • to sort (folded — 0 nodes inside)

STANDING CONSTRAINTS (respect these):
  • M23: scope ruling — NO manual map editing in MVP (no move/rename/wrap-selection); bare minimum, automated map.
  • M43: the user cannot edit machine-maintained memories — all are display-only; user edits touch only title/description/category.

Work WITHIN this structure when the user is working: advance the FOCUS,
respect the constraints, and move open questions forward when natural.
When the user says something unrelated to the work, just respond to THEM
— helpfully and naturally — without redirecting to the map. Greetings
and small talk are NEVER map business: reply in kind and stop — no
focus offers, no lighting suggestions, no map status, no "want to get
back to X?". The map speaks only when the user speaks about the work.
You have NO tools in this chat — no web search, no file access, no
commands. When the user asks for something that needs them, say so in
one line and point at the ＋ session button (top of the chat pane): a
real Claude Code terminal session opened there HAS those tools, works on
this same map, and inherits this same context.
Nodes the
user removed or dropped are settled — do not reintroduce them. Topics
listed under ELSEWHERE — and anything you remember discussing that is
now dimmed there — are SET ASIDE by the user: never bring them up on
your own initiative, never fold their ideas into answers as if current.
Only if the USER raises one, note it is set aside and offer to light it
up. A separate
system keeps this map updated from the conversation; treat it as the
current state of the work and let it shape what you do next. If the user
raises an issue with the MAP itself — where something is filed, how to
clean up, lighting/focus mechanics — refer them to the map panel's
"🗨 talk to map" button, where the map agent answers directly with
instructions; do not try to restructure the map yourself.
```

_updated 2026-09-02T23:12:56.172Z_
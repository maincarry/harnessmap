# Preferences as part of the map — design proposal (v1, 2026-09-08)

Status: for Jacob + Mark's ruling. Written on Jacob's "we need some serious better
integration of the preference — think through the map designs and give a proposal".

## 0. What exists today (checked against the code, 2026-09-08)

- One free text per map, `prefs:<project>`, capped at 1,200 characters (silently truncated).
- Writers: the ✎ editor in ⋯ other (replaces the text); the map-chat, when the user
  states a lasting preference, proposes a card "save a standing preference" and the
  approved line is appended as a bullet. Nothing else writes it: the filer never turns
  a statement in the user's own session into a preference.
- Readers: every map agent, verbatim, in its system card (filer, tidy, expand, memory,
  naming, auto-focus, auto-light, import, reviewer) — "standing instructions, follow
  unless this round says otherwise"; the brain in its structural review ("their taste
  outranks doctrine") and in every synthesis. The chat agent never sees it.
- The brain's two other memories of the user: a *taste digest* (≤900 chars, model-written
  from what was applied, dismissed, undone — never shown to the user as a preference)
  and *tuning* (spoken guidance to the brain, rewritten by the brain after each chat,
  ≤2,000 chars).
- Told only at save time (status line + card confirmation + audit). Never afterwards:
  no proposal says which preference it followed; nothing reports one ignored.
- No scope (a naming rule reaches the lighting agent), no conflict handling (two
  contradicting bullets both stand), no expiry, no mechanical enforcement, and no
  measurement of adherence anywhere in the test battery.

## 1. Principles this design follows (the map's own laws)

Everything is a node. Capture everything, propose→approve anything an agent wants to
change about the user's intent. The user's word outranks doctrine. Topics, never
phases. A later ruling updates the node it supersedes and keeps its history (M204/M205).
The light is the law for content — but preferences are law, not content.

## 2. The design: a Preferences chapter

### 2.1 Data
Preferences are NODES under a system chapter **preferences**, created at bootstrap like
"to sort": top-level, owned by the system, never tidied, moved or removed by an agent,
and — unlike every other chapter — always served, whatever the light, because it is the
rulebook, not material.

- `type: 'preference'`; statement = the rule in the user's own words; status
  `live | superseded | parked`; children allowed (reasons, examples, exceptions as child
  nodes, so a rule can carry its why).
- **Scope is placement** (Jacob, 2026-09-08: a scope table "seems unnecessary when
  preference becomes complex"). A preference node in the top-level chapter is global; a
  preference node placed under a chapter governs that subtree; one placed under a single
  node governs that node — exactly how everything else on the map already scopes. Per-node
  rules come free. The side table shrinks to `preference_meta(node_id, role, guard_kind,
  guard_param)`: an optional role the rule speaks to (naming, lighting, filing, memory,
  tidy, import, brain, guide — inferred from the wording when not set) and the mechanical
  guard form when the rule has one (§2.5).
- Versions come for free: a changed preference is `update_node` with history; a new
  preference on the same subject UPDATES the existing one (the filer's update rule, M204),
  and the previous wording is the version below it.

### 2.2 Capture — three doors, all propose→approve
1. The ✎ editor becomes the chapter's editor: add, edit, park; each row shows status,
   scope and usage.
2. The map-chat card as today, but it creates a node.
3. **The filer.** A new duty in every round: preference-shaped statements ("from now on",
   "always", "never", "stop doing", "I prefer", "don't file X") are proposed, never filed
   silently — a new alteration `propose_preference { statement, roles?, chapterIds? }`
   that surfaces as a red-dot card on the preferences chapter. The host agent's own
   restatements of a rule the user set count as evidence for the same card.

### 2.3 Delivery — composed, scoped, counted
`preferencesFor(role, context)` replaces the blob in the system card: the rules on the
path from the node the call touches (the focus, the tidy target, the import root) up to
the map's top — nearest first — plus the global chapter, filtered by role where a role is
set. Each rule carries a short id `[p-a1b2]`. Delivery is
capped by COUNT (≈12), ranked by scope specificity then recency; the remainder is one
line, "N more general preferences (see the chapter)". The brain receives the whole
chapter with statuses. Parked rules are never delivered.

### 2.4 Visible application
Every agent schema gains `applied: string[]` (ids it followed this call) and
`conflicts: [{ id, why }]` (a rule it could not follow and why). The UI shows
"followed: short names · never file under Kant" on proposal cards and in the round
line / what-changed panel. An audit `pref_applied` per id gives each preference a usage
count on its row ("applied 14× · last 2 h ago"); "never applied" is itself a signal, and
the brain reports it: a live rule whose scope matched 20 rounds and was never applied
is named in the overall status as a preference the map is ignoring.

### 2.5 Mechanical guards
When an approved rule has a checkable form, the card offers "enforce mechanically?":
- name length (≤ N words / chars), banned words, banned categories or statuses;
- "never light chapter X" / "keep chapter Y lit" / "never dim Z" (lighting guards);
- "never file under X" / "always file X under Y" (placement guards);
- "statement nodes are one sentence" (shape guard).
Guards run in code where the cycle guard already lives (apply time) and where the
auto-light budget guard lives (proposal time). A violation is REFUSED and audited, never
silently corrected — the same law as the budget guard (M199).

### 2.6 Learning, kept visible
The taste digest continues but its output becomes PROPOSED preference cards, not a
hidden note. Tuning merges into the chapter as rules scoped to the brain. Behavioural
signals become proposals, never silent changes: a topic pulled up three times → "keep X
lit?"; a suggestion kind dismissed three times → "stop proposing Y?"; a chapter the user
always re-dims after auto-light → "never light Z?".

### 2.7 Conflicts and lifecycle
Same subject → update, with history. Explicit contradiction detected at capture → the
card reads "this replaces [p-a1b2]: …" and the old rule goes `superseded` on approval.
No character cap anywhere; count-ranked delivery does the budgeting. Parked = kept, not
delivered.

### 2.8 The boundary
Map preferences govern the MAP. Rules about the conversation itself ("answer in
Chinese", "be terse") belong to the user's own harness (CLAUDE.md) and are out of scope;
the filer's capture duty says so when it sees one.

## 3. UI
The chapter renders like any chapter with a ✎ badge and always-lit styling; rows carry
status, scope chips and usage; the editor is the chapter (add / edit / park); proposal
cards show followed / conflicts; the what-changed panel lists applied preferences per
round; the brain's report gains a "preferences ignored" line when §2.4 fires.

## 4. Migration
`prefs:` text → split on bullets → live preference nodes authored by the user. Taste →
one proposed card. Tuning → proposed nodes scoped to the brain. `systemCard` keeps its
signature and calls `preferencesFor`, so no agent changes on day one.

## 5. Testing
- Test 1 gains a **preference-adherence class**: three preferences set before the replay
  (a naming-length rule, a never-file rule, a placement rule), the segment replayed,
  code checks count obeyed rounds; floor 90%.
- The update suite gains "a new preference on the same subject updates the old one".
- The recall test is unchanged unless a lighting preference is set; then it measures it.

## 6. Cost
Zero extra model calls in the steady state: composition is code, capture rides the
filer's existing call, guards are code, the taste digest already runs. Context per agent
call drops from a 1,200-char blob to ≈12 short lines that apply.

## 7. Staging
- A (≈2 days): chapter + nodes + scope table + migration + `preferencesFor` + editor.
- B (1–2 days): filer capture cards + `applied`/`conflicts` + UI surfaces.
- C (1–2 days): mechanical guards + usage counts + brain "ignored" report + learning cards.
- D (½ day): Test 1 adherence class; update-suite case.

## 8. Rulings requested (ruling 4 on day-one scope withdrawn 2026-09-08: scope is placement)
1. Always-served regardless of light — confirm (the rulebook is not content).
2. Guards refuse rather than auto-fix — confirm.
3. Capture from the host agent's own restatements — allow or not.
4. Slot: after Test 1's second segment and before Test 3 (my recommendation), or after Test 3.

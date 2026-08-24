# Harnessmap — the app as it stands (v0.5.9, 2026-08-15)

**The idea.** You think by talking to an AI, but chat organizes thought by
*time*, which is the wrong index. Harnessmap keeps ONE continuous conversation
and grows a live MAP of what you're actually doing — topics, claims, questions,
options, decisions, constraints, evidence — beside it. The map, not the
transcript, is the durable thing: it's simultaneously your view of the work AND
the agent's memory of it. One sentence: *a file manager for the AI's mind,
where you do the managing.*

## The map

Everything on it is a NODE — one kind of thing, nested arbitrarily deep. A node
carries four layers:

| Layer | What it is | Who writes it |
|---|---|---|
| title | 2–4 words, what the map shows | map agent (user may edit) |
| description | the full self-contained statement | map agent (user may edit) |
| fit | how it sits among parents/children (2-up/2-down, cached) | machine only |
| chat memory | digest of conversation while it was focus (asked/answered/reaction) | machine only |

Types and statuses are open vocabulary with glyphs (✓ decided, ○ open,
‖ parked, ✗ dropped, ∿ exploratory…). Tree guide-lines show who belongs to
whom; blue tint marks recent change; red ● = restructure suggested (the map
never restructures on its own); amber ● = a "to sort" arrival probably belongs
under a dimmed branch.

## Controls

Per node (hover): **zoom** (isolate the subtree; dims outside lighting; offers
a focus shift) · **▶ focus** (aim the conversation; lit on the focused node) ·
**☀ light/dim** (branch in/out of the agent's background) · **+** (add a child;
auto-named from conversation) · **⟳ tidy** (cleanup proposal, before/after
preview, user approves) · **del** (subtree-aware).

Global: ↑ zoom out · light-all/dim-all (view-scoped) · ☀ auto-light (applies) ·
▶ auto-focus / auto-zoom (suggest → confirm) · ● check map (clean bill or
dots) · ▶☀ manage (whole-map focus+lighting) · agent's view (the exact composed
context) · clean chat (view-only; memory continuous) · ? legend.

## The two workers

**Chat agent** — who you talk to. Context composed fresh each turn: map state
(focus subtree full + lit branches' descriptions + one-liners elsewhere,
budgeted with explicit "…N not shown" markers) + focus-node memory + rolling
texture summary (subordinate: the map wins on conflict) + last 20 turns.

**Map agent (the filer)** — runs after each exchange, writes the map:
capture-everything (no topic dignity threshold — any deliberation is a topic),
integrate-don't-append, hierarchy-first, minimal auto-titles, statuses as
earned states. Quality enforced by a 35-round eval gate re-run on every prompt
change.

## The light is the law

The user's lighting bounds both workers: the chat agent's background, and where
the map agent may WRITE. The map agent reads the lit floor and may expand its
reading once per round on its own judgment (≤3 branches, read-only). Material
belonging outside the light lands in **"to sort"** — a system folder pinned at
the bottom, name locked, every arrival carrying provenance. One deliberation
arrives as one subtree. Ways out: amber ● re-light (map agent moves it home
next round) · ↖ place (agent-searched ranked homes with reasons; browse
fallback; cycle-guarded) · ★ promote (become top-level) · say it in chat ·
⟳ tidy. All scope rules are enforced by server-side guards, not prompts.

## Memory

Nothing is lost: full transcript in an append-only log; every map change is an
event (the map can be rebuilt from history — that's how migrations work). What
the agent sees is curated: map first, texture summary second, verbatim window
last. Clean-chat clears the screen, never the memory.

**Storage is total and dumb; agents are stateless workers seeing through the
keyhole the user shapes.**

Full change history: `docs/MODLOG.md` (M1–M56) and the build logs in
`DESIGN.md`.

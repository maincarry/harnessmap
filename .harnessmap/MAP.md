# The map (harnessmap)

Current state of the project map — always fresh; re-read after any map-change notice.
Focus/lighting below reflect what the user has chosen to emphasize.

```
[map state — the current structure of this work]

FOCUS (what the user is actively working on):
  ○ harnessmap
    ○ heading: Core design (live)
      ○ heading: Foundational decisions (live)
    ○ heading: Design history (live)
      ○ heading: Version eras (live)
    ○ heading: Incidents resolved (live)
      ○ heading: Incidents (live)
    ○ heading: Current work (live)

BACKGROUND (lit by the user as reference):
  titles:
  - harnessmap import
    - Context as territory
      - Read the map structure correctly
    - Foundational decisions
      - Wrap Claude Agent SDK not rebuild
      - Storage design for snapshots
      - Shadow git repo
      - Translate git vocabulary for users
      - Cut merge from MVP
    - Operations vocabulary
      - Fork a snapshot
      - Save point reference
      - Retroactive split by thread classification
      - Delete goal now garbage collect later
      - Rewrite goal from parents
    - Goals-first reframe (the deepest change)
      - Goal-centered navigation
      - Goal structure basics
      - Goal synthesis pipeline
      - Merge goal structures recursively
    - Sight and the galaxy UI
      - Light up nodes for context control
      - Cosmic navigation metaphor
    - Lossy summaries with lossless backing
    - Auth and billing incidents resolved
      - Verify Claude Code authentication architecture
      - Handle desktop sign-in credential sync
      - Unintended API key billing
      - Fix auth key leakage in dev
      - Sign-in & billing status page
      - Settings page and wizard growth
      - Revoke billed API key
    - Setup imports and export config
  - Modification log
    - Version eras
      - v0.2 nine-point critique
      - v0.3 one conversation and zoom
      - v0.4 nodes all the way down
      - v0.5 light is the law
      - v0.6 Claude Code plugin
      - v0.7 filer maturation
      - Later refinements
    - Cross-cutting themes
      - Talk to map
      - Prompts guide, guards enforce
      - Propose then accept
      - Auth and billing transparency
        - Login work rewound
    - Standing rules
      - Map is the product
      - No manual restructuring
      - Everything is a node
      - Full visibility, read-only memory
      - Light is the law
      - Topic map, no threshold
    - Open questions
      - Desktop-app auth gap
      - Settings page and wizard
      - Panel takeaways parked

  in full:
  • harnessmap import: harnessmap: a goal-map AI harness that wraps the Claude Agent SDK, letting users navigate work as territory instead of scrolling linear chat
    • Context as territory: Vision: treat context as territory — nodes are frozen context snapshots you stand on, edges are moves, sessions are live expeditions, the map is spatial memory. Pitch: git for conversations, with a map instead of a CLI [claim, exploratory]
      • Read the map structure correctly: Linear chat's three failures motivating the reframe: context pollution from tangents, no way back after going off-rails, and no overview across many opaque chats [claim, exploratory]
    • Foundational decisions
      • Wrap Claude Agent SDK not rebuild: Wrap the Claude Agent SDK rather than rebuild; resume:<sessionId> + forkSession:true gives fork-from-any-checkpoint for free at the context layer [decision, decided]
      • Storage design for snapshots: Storage is chain + offset, not full copies: a snapshot is (sdk_session_id, turn_index) + metadata, so shared prefixes dedupe like git [decision, decided]
      • Shadow git repo: MVP keeps a shadow git repo: every save point is a commit, branching a chat is a git branch, jumping is a checkout — so file drift is impossible by construction, not merely detected [decision, decided]
      • Translate git vocabulary for users: Soften the git-sized vocabulary for non-git users: point, save point, branch off, combine, chat, condense — code keeps git terms, users never see them [decision, decided]
      • Cut merge from MVP: Cut merge/combine from the MVP; validate the core hypothesis first — do people fork and come back? [decision, decided]
    • Operations vocabulary
      • Fork a snapshot: Fork: branch a new session from any snapshot; original untouched; optional fork-with-intent goal becomes the branch's map label [option, decided]
      • Save point reference: Checkpoint (save point): a named ref on a snapshot; auto-checkpoints keep storage granular while the map renders only structural nodes [option, decided]
      • Retroactive split by thread classification: Split: decompose one session into N sibling branches — cheap split-forward (multi-fork with labels) or expensive retroactive split by LLM thread-classification [option, exploratory]
      • Delete goal now garbage collect later: Delete: drop a goal/branch's ref now and GC later; distinct from marking a dead end, which stays on the chart as a record [option, decided]
      • Rewrite goal from parents: Rewrite: user redefines a section's goal; seed context re-synthesized from heritage via chosen parents or a genealogical trace capped at distance k or until relevance is exhausted [option, decided]
    • Goals-first reframe (the deepest change)
      • Goal-centered navigation: The map's primary unit is a goal (a thing you're trying to accomplish), not a conversation; the goal tree overlays the snapshot DAG and is what you navigate [decision, decided]
      • Goal structure basics: Goal entity: statement / success_criteria / status / parent_goal / evidence_refs / revision_history [claim, exploratory]
      • Goal synthesis pipeline: Goal Synthesis is an independent pipeline from chat auto-summaries (recap and aim are different optimization targets), enforcing specificity via a rubric + critic pass — never one-liners [decision, decided]
      • Merge goal structures recursively: Merge means folding goal structures, not sessions: an objection folds into Argument 2, then the whole Argument-2 subtree folds into the essay body — recursively composable [claim, exploratory]
    • Sight and the galaxy UI
      • Light up nodes for context control: Sight: light up nodes to control which context the agent can see — the cheap, reversible cousin of merge; pulled into the MVP, and each lit node shows its token weight as a context-budget dashboard [decision, decided]
      • Cosmic navigation metaphor: Galaxy home view: goal=star, branch=planet, sub-branch=moon, you=ship, sight=illumination, delete=ejection, fold=accretion — with deterministic orbits so spatial memory survives (gravity is metaphor, not a force sim) [decision, exploratory]
    • Lossy summaries with lossless backing: The recall(snapshot_id, query) tool turns every merge from lossy summarization into lossy summary with a lossless backing store the child can re-query — the sleeper primitive [claim, exploratory]
    • Auth and billing incidents resolved: Auth & billing incidents resolved during development
      • Verify Claude Code authentication architecture: Model calls happen in two independently-authenticated places: the user's own Claude Code session (their auth) and the server's own agents (filer, namer, etc.) which spawn the CLI and read its separate credential store [claim, decided]
      • Handle desktop sign-in credential sync: Desktop-app-only users (e.g. Jacob) sign into the app, which does not populate the CLI's credential store, so the filer dies silently with 'Invalid API key' — same account, empty second drawer [evidence, decided]
      • Unintended API key billing: A leftover dev .env auto-loaded by Bun carried ANTHROPIC_API_KEY into every server child; Claude Code prefers an API key when present, so weeks of chat/suite/terminal calls billed the key instead of the subscription [evidence, decided]
      • Fix auth key leakage in dev: Fix: delete the .env, and structurally scrub ANTHROPIC_API_KEY from the whole server process at import unless HARNESSMAP_INFERENCE=api is explicitly set, plus loud startup warnings in both directions [decision, decided]
      • Sign-in & billing status page: A 🔑 sign-in & billing transparency page states who pays, scrub status, the four CLI sign-in locations in real lookup order (presence booleans only), and live call health — visibility only, no login flows [decision, decided]
      • Settings page and wizard growth: Direction: the 🔑 page is a seed that grows into a full settings page and setup wizard once CC-app and chat integrations introduce a second auth option [decision, exploratory]
      • Revoke billed API key: Rotate/revoke the billed API key in the Anthropic console — inert for the product now but lived in process memory for weeks [task, open]
    • Setup imports and export config: Open questions carried forward: does the MVP map render the goal tree or the snapshot DAG; who owns the working directory when two chats are active; whether the 👁/🔑 page shows only the map's contribution or the whole assembled context [question, open]
  • Modification log: Modification log for the harnessmap goal-map project: every design/change request Jacob (and later Mark) raised, in order, with status, from v0.2 through the late-August auth/metrics work.
    (fits: This node is the **complete audit trail** of how the harnessmap system evolved from a rough sketch to a guarded, agent-coordinated platform — each design era resolving prior tensions (two-way mapping,)
    • Version eras: The log is organized by version era, each era resolving a cluster of related requests.
      • v0.2 nine-point critique: v0.2 era — the 9-point critique (M1–M9): two-way map, capture everything as exploratory, integrate not append, hierarchical lighting, focus separated from lit, a legend, auto-fold non-focus, tidy with before/after preview, and upward name propagation. [decision, decided]
      • v0.3 one conversation and zoom: v0.3 era — one map + one conversation, chat list dissolved, map-as-memory (map + rolling window, no perpetual session), and the zoom feature: dedicated zoom button, zoom dims outside the subtree, auto-light/auto-focus/auto-zoom in a manage panel with confirm-before-implement (M10–M28). [decision, decided]
      • v0.4 nodes all the way down: v0.4 era — nodes all the way down: no topic/item split, everything is a node (type + ancestors + children), event-sourced rewrite; then titles split from descriptions, relational 'how it fits', node chat memory, and second-place conversation memory (M29–M46). [decision, decided]
      • v0.5 light is the law: v0.5 era — 'the light is the law': no creation outside the light, the map agent's reading is the chat agent's floor with expansion-on-demand, writes bounded by a server-side guard sending out-of-light creations to 'to sort'; casual conversation allowed, no topic dignity threshold, new-topic guarantee (M47–M56, plus M49/M50). [decision, decided]
      • v0.6 Claude Code plugin: v0.6 era — Claude Code plugin integration: hooks (SessionStart, UserPromptSubmit, Stop, PreCompact), server adapter with transcript slicing and provenance, delta injection to avoid snapshot accumulation, and push+pull map awareness via a .harnessmap/MAP.md file (M57–M62). [decision, decided]
      • v0.7 filer maturation: v0.7 era — filer maturation: fixed seven-type vocabulary (claim/question/option/decision/constraint/evidence/task) machine-enforced but user-overridable, inference backend abstraction (subscription default, api opt-in), model tiering, fleet testing, born-lit nodes, info-expansion filing, self-healing titles, conversational and scoped tidy (M63–M72). [decision, decided]
      • Later refinements: Later work — talk-to-map guide with multi-specialist plans, node search with favorites, precomputed dot proposals, inline referral buttons, feedback flow, and the late-August auth/billing/metrics hardening (M73 onward).
    • Cross-cutting themes: Cross-cutting themes that recur across many modification points.
      • Talk to map: Talk-to-map (formerly 'ask the map') is a direct advisory channel to the map agent: diagnoses map issues and proposes focus/light/zoom/tidy revisions, delegates unnamed asks to specialists, proposes ordered multi-specialist plans, and applies only on user approval through the same guarded endpoints — it can never write directly (M77–M83, M171). [decision, decided]
      • Prompts guide, guards enforce: Recurring lesson: prompts guide but server-side guards enforce. Many fixes replaced prompt nudges with mechanical guards (id re-minting, offlist-type coercion, lit/dim conflict cancellation, deepest-match retargeting, title-length healing, park-all caps). [claim, decided]
      • Propose then accept: Every agent-initiated action that re-aims the user follows propose → feedback loop → approve, unified across tidy, auto-light, auto-focus, auto-zoom via a shared specialist-proposal dialog (M69, M80, M82). [decision, decided]
      • Auth and billing transparency: Auth and billing were repeatedly invisibility problems: silent filing death without CLI login, an API key auto-loaded from .env that billed Mark for weeks, and confusion between credential stores. Fixes scrub the key unless api mode is explicitly chosen, delete the .env, warn loudly at startup, and add a visibility-only sign-in/billing page (M179–M186b). [decision, decided]
        • Login work rewound: The login work (M179 error naming, M179b probe/banner, M180 in-page sign-in) was built then rewound the same night on Jacob's call — the desktop-app-only auth problem remains real and unsolved, parked for Mark's fix. [constraint, open]
    • Standing rules: Standing rules distilled across the log, treated as durable constraints on the design.
      • Map is the product: The user controls the flow tangibly; the map is the product, chat is the interface. [constraint, decided]
      • No manual restructuring: Automated map, no manual restructuring (M23): the filer suggests, never acts on its own; the user decides. [constraint, decided]
      • Everything is a node: Everything is a node (M29); statuses and types are open vocabulary for users, though the filer labels from a fixed seven-type set. [constraint, decided]
      • Full visibility, read-only memory: What the agent sees, the user can see (M20/M21); machine-maintained memories are read-only, user edits touch only title/description/category (M43). [constraint, decided]
      • Light is the law: The light is the law (M47): it bounds the chat agent's background and the map agent's writes; reading may expand on demand, writing never. [constraint, decided]
      • Topic map, no threshold: Topic map, not deliberation map (M50/M73): whatever the user discusses is map material with no dignity threshold; only pure dialogue mechanics (greetings, acks, harness meta-talk) produce nothing. [constraint, decided]
    • Open questions: Open questions and parked items still unresolved in the log.
      • Desktop-app auth gap: Desktop-app-only users hit silent filing failure because their app login doesn't authenticate the CLI path the agents use — the first-run flow should eventually detect a missing CLI login proactively. [question, open]
      • Settings page and wizard: The 🔑 billing page is slated to grow into a full settings page and setup wizard once CC app and chat integrations introduce new auth options (M186b). [task, open]
      • Panel takeaways parked: Stakeholder-panel takeaways parked for the founders: observer mode ('earn the injection'), a cost meter for quota burn, unsigned-update path, licensing, and with/without-map downstream evaluation (M181). [question, open]

ELSEWHERE ON THE MAP (folded — set aside by the user; see the rule below):
  • to sort (folded — 0 nodes inside)

OPEN QUESTIONS (in focus and lit topics):
  • Desktop-app-only users hit silent filing failure because their app login doesn't authenticate the CLI path the agents use — the first-run flow should eventually detect a missing CLI login proactively.
  • Stakeholder-panel takeaways parked for the founders: observer mode ('earn the injection'), a cost meter for quota burn, unsigned-update path, licensing, and with/without-map downstream evaluation (M181).
  • Open questions carried forward: does the MVP map render the goal tree or the snapshot DAG; who owns the working directory when two chats are active; whether the 👁/🔑 page shows only the map's contribution or the whole assembled context

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

_updated 2026-08-31T04:35:00.069Z_
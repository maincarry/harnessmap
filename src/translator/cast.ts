import { Store } from '../store/db.js';

// M124 (Jacob): coordination. Every decision-making specialist receives the
// same SYSTEM CARD — the cast and each role's jurisdiction — so no agent
// proposes work that belongs to another role (the root-grouping incident:
// mapcheck proposed what subtree-tidy could never execute). The card also
// carries the user's MAP PREFERENCES (governed, per-project, user-editable),
// so taste learned once steers every agent, not just the one that heard it.

export const CAST_ROLES = `THE CAST — who does what here. The user talks to ONE running session, the CHAT AGENT; the server never prompts it, it only injects map context into its next turn and reads its replies. Every other role is a one-shot MAP AGENT with no session or memory of its own:
- FILER: files each exchange onto the map (only writer that acts without approval, within the lit scope).
- LIGHTING / FOCUS / ZOOM agents: propose attention changes — the user approves.
- TIDY agent: restructures ONE chosen subtree; only in ROOT SCOPE (the "tidy top level" flow) may top-level containers be created or top-level threads moved.
- NAMING agent: display names. MEMORY agent: node memories. PLACEMENT agent: suggests homes.
- MAP GUIDE: answers the user's questions about the map and drafts proposals.
Map agents never talk to each other — the map is the only shared ground. Work that belongs to another role is NOT yours: name the right mechanism (e.g. "this needs the tidy-top-level flow" / "that is a lighting change") instead of doing it badly yourself or flagging it where it cannot be executed.`;

export function systemCard(store: Store, projectId: string, self: string): string {
  const prefs = (store.getSetting(`prefs:${projectId}`) ?? '').trim();
  return `\n\n${CAST_ROLES}\nYou are ${self}.`
    + (prefs ? `\n\nUSER'S MAP PREFERENCES (standing instructions for every map agent — follow unless this round says otherwise):\n${prefs}` : '');
}


// M217 (Jacob, 2026-09-08: "in dev mode, give a roadmap of all the agents as
// a network"): the cast as data — who reads which store, who writes or
// proposes what. Rendered in dev mode. Stores are the shared ground; agents
// never talk to each other (M124). `model` false = mechanical or external.
export const CAST_GRAPH = {
  stores: [
    { id: 'rounds', label: 'conversation rounds', what: 'what the user and the chat agent said, every turn' },
    { id: 'source', label: 'imported source', what: 'the retained document or transcript' },
    { id: 'tree', label: 'the map tree', what: 'nodes, statuses, placement, timelines (event log)' },
    { id: 'memory', label: 'node memory', what: 'name · description · fit · modlog · chat memory, at three resolutions + full' },
    { id: 'light', label: 'focus + light', what: 'per session: the focus node and the lit set' },
    { id: 'brain', label: "the brain's reports", what: 'instruments, structural review, area assessments, history, the understanding' },
    { id: 'prefs', label: 'map preferences', what: 'standing instructions every agent receives' },
    { id: 'dots', label: 'proposals + dots', what: 'anything awaiting the user\'s approval' },
    { id: 'block', label: "the chat agent's block", what: 'the composed map context injected into the next turn' },
  ],
  agents: [
    { id: 'chat', label: 'chat agent (Claude Code)', model: false, task: null, what: 'the user\'s session; the server never prompts it', reads: ['block'], writes: ['rounds'], proposes: [] },
    { id: 'composer', label: 'composer', model: false, task: null, what: 'tiered attention: light is the law; focus at full, lit nodes by warmth, the rest as names; pull-up offers', reads: ['tree', 'memory', 'light', 'brain', 'prefs'], writes: ['block'], proposes: [] },
    { id: 'pullup', label: 'pull-up (word matcher)', model: false, task: null, what: 'a set-aside node the chat agent asked for, served once', reads: ['tree', 'memory', 'rounds'], writes: ['block'], proposes: [] },
    { id: 'filer', label: 'filer', model: true, task: 'filer', what: 'files each exchange; rewrites overturned statements; the only writer without approval (lit scope)', reads: ['rounds', 'tree', 'memory', 'brain', 'prefs', 'light'], writes: ['tree', 'memory'], proposes: [] },
    { id: 'memory', label: 'memory agent', model: true, task: 'memory', what: 'the organs of touched nodes; taste digest; merge memories', reads: ['rounds', 'tree', 'source'], writes: ['memory'], proposes: [] },
    { id: 'summary', label: 'rolling summary', model: true, task: 'summary', what: 'the running conversation summary', reads: ['rounds'], writes: ['block'], proposes: [] },
    { id: 'naming', label: 'naming agent', model: true, task: 'title', what: 'short display names', reads: ['tree'], writes: ['tree'], proposes: [] },
    { id: 'fit', label: 'fit writer', model: true, task: 'relations', what: 'how a node fits its surroundings', reads: ['tree', 'memory'], writes: ['memory'], proposes: [] },
    { id: 'attention', label: 'lighting / focus / zoom agents', model: true, task: 'autolit', what: 'propose the working background and the focus; the guard applies over-budget sets by resolution', reads: ['rounds', 'tree', 'memory', 'brain', 'light'], writes: [], proposes: ['dots'] },
    { id: 'recommend', label: 'recommendation agent', model: true, task: 'recommend', what: 'red-dot focus suggestions', reads: ['rounds', 'tree'], writes: [], proposes: ['dots'] },
    { id: 'place', label: 'placement agent', model: true, task: 'place', what: 'homes for "to sort" items', reads: ['tree'], writes: [], proposes: ['dots'] },
    { id: 'tidy', label: 'tidy agent', model: true, task: 'tidy', what: 'restructures one subtree; top level only in the tidy-top-level flow', reads: ['tree', 'memory', 'brain', 'prefs'], writes: [], proposes: ['dots'] },
    { id: 'reviewer', label: 'structural reviewer + area assessments', model: true, task: 'mapcheck', what: "the brain's reporters: shape findings (provable ones ride mechanically), per-area assessments", reads: ['tree', 'memory', 'prefs'], writes: ['brain'], proposes: [] },
    { id: 'brain', label: 'the brain (overall report)', model: true, task: 'brain', what: 'reconciles the reports into the understanding; verifies imports against the source summary; the history report', reads: ['brain', 'tree', 'source', 'rounds'], writes: ['brain'], proposes: [] },
    { id: 'import', label: 'import agent', model: true, task: 'import', what: 'source summary → chunk filing (filer tier) → finish pass; adopts the seed root or places onto a filled map', reads: ['source', 'tree', 'brain', 'prefs'], writes: ['memory'], proposes: ['dots'] },
    { id: 'guide', label: 'map guide (talk to map)', model: true, task: 'mapchat', what: 'answers the user and drafts proposals; saves lasting preferences', reads: ['tree', 'light', 'dots', 'memory', 'prefs'], writes: ['prefs'], proposes: ['dots'] },
  ],
  rule: 'Map agents never talk to each other — the stores are the only shared ground. Everything in "proposes" waits for the user\'s approval; "writes" lands directly.',
};

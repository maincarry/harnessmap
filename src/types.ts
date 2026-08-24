// Core ontology (DESIGN.md §3, v3 — the v0.4 nodes unification, Jacob
// 2026-08-14): ONE kind of thing. A node has a type, a status, one line of
// content, a parent, and children. "Topic vs item" is gone — a topic is just
// a node whose children matter more than its own sentence, and any node can
// grow children (evidence under a claim, objections under an option).

// Suggested type vocabulary — open; the translator may coin labels
// (thesis, concern, objection, section…). null/'' = plain topic node.
export type NodeType =
  | 'claim'
  | 'question'
  | 'option'
  | 'decision'
  | 'constraint'
  | 'evidence'
  | 'task';

// Open status vocabulary (v0.2 ruling: suggested values, not schema).
// Universal: 'exploratory' (tentative), 'removed' (dead — deleted/merged
// away; the ONE dead word for every node, there is no separate 'cut').
export type NodeStatus =
  | 'floated'
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'open'
  | 'answered'
  | 'mooted'
  | 'live'
  | 'provisional'
  | 'chosen'
  | 'dropped'
  | 'decided'
  | 'reversed'
  | 'active'
  | 'hard'
  | 'relaxed'
  | 'lifted'
  | 'noted'
  | 'cited'
  | 'retracted'
  | 'todo'
  | 'doing'
  | 'done'
  | 'parked'
  | 'exploratory'
  | 'removed';

// String, not enum: multiplayer means arbitrary author ids later. 'user' and
// 'agent' are the conventional single-user values.
export type Author = string;

export type LinkType =
  | 'supports'
  | 'objection-to'
  | 'replies-to'
  | 'answers'
  | 'motivated-by'
  | 'satisfies'
  | 'blocks'
  | 'chooses';

export interface MapNode {
  id: string;
  projectId: string;
  parentId: string | null; // null = top level
  content: string;         // the FULL statement — precise, agent-facing
  title?: string | null;   // short display label (M36); null = show content
  type: string | null;     // claim/question/… — null for plain topic nodes
  status: string;
  author: Author;
  createdAt: string;
  updatedAt: string;
}

export interface Link {
  id: string;
  type: LinkType;
  fromItemId: string; // node id
  toId: string;       // node id
  toKind: 'item' | 'container'; // legacy field, both mean "node" now
}

// The translator's output: one round = one set of alterations (DESIGN.md §4).
// Canonical ops are node ops. Legacy container/item ops remain REPLAY-ONLY
// aliases so old map_events rebuild into nodes (the event-sourced migration).
export type Alteration =
  | { op: 'create_node'; id: string; parentId?: string | null; content: string; title?: string; type?: string | null; status: string; author: Author }
  | { op: 'update_node'; id: string; content?: string; title?: string; type?: string; status?: string } // status 'removed' = delete (whole subtree hides)
  | { op: 'move_node'; id: string; parentId: string | null }
  | { op: 'create_link'; id: string; type: LinkType; fromItemId: string; toId: string; toKind?: 'item' | 'container' }
  | { op: 'set_focus'; containerId: string }
  // Not a map mutation: a red-dot restructure suggestion on a node.
  // Stored in the suggestions table, never in map_events.
  | { op: 'suggest_restructure'; nodeId: string; note: string }
  // Out-of-scope filing (M47): re-light this branch to check whether new
  // material fits there. Stored as a suggestion, kind 'relight'.
  | { op: 'suggest_relight'; nodeId: string; note: string }
  // M47 expansion-on-demand: not a map op — the map agent declaring it cannot
  // file properly without reading these dim branches. Triggers one re-run
  // with them readable; never persisted.
  | { op: 'request_expansion'; ids: string[] }
  // ---- legacy (replay-only) ----
  | { op: 'create_container'; id: string; parentId: string | null; name: string; status: string; author: Author }
  | { op: 'update_container'; id: string; name?: string; status?: string }
  | { op: 'create_item'; id: string; type: string; content: string; status: string; author: Author; homeContainerId: string }
  | { op: 'update_item'; id: string; content?: string; status?: string; type?: string }
  | { op: 'rehome_item'; id: string; homeContainerId: string }
  | { op: 'suggest_restructure'; containerId: string; note: string };

export interface Suggestion {
  id: string;
  projectId: string;
  nodeId: string;
  note: string;
  status: 'open' | 'dismissed' | 'done';
  kind?: string; // restructure (red dot) | relight (amber dot)
  createdAt: string;
}

export interface RoundResult {
  summary: string; // the map-conditioned interpretive summary (the debuggable middle layer)
  alterations: Alteration[];
}

export interface Turn {
  id: string;
  chatId: string;
  idx: number;
  role: 'user' | 'assistant' | 'system';
  content: string; // rendered text; raw SDK message JSON kept alongside
  raw: string | null;
  createdAt: string;
}

export interface Chat {
  id: string;
  projectId: string;
  focusContainerId: string; // node id (column name is historical)
  sdkSessionId: string | null;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface SavePoint {
  id: string;
  chatId: string;
  name: string;
  forkSessionId: string | null; // fork-at-save-point handle (DESIGN.md §8)
  turnIdx: number;
  createdAt: string;
}

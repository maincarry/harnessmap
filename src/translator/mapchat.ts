import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { getNodeMemory } from './memory.js';
import { call } from '../inference.js';
import { statusConsult } from './mapstatus.js';
import { loadMap, descendantNodes } from '../map/render.js';
import { matchNodes } from '../map/match.js';
import { outlineWithIds } from './importer.js';
import { nearestGovernor } from './governors.js';

// M77 (Jacob): when there are map-related issues, the user talks to the MAP
// AGENT directly — the chat agent refers them here, and the map agent answers
// with instructions about what to do. Advisory channel: it explains and
// instructs using the system's real controls; it never edits the map itself.

const SYSTEM = `You are the MAP GUIDE of harnessmap: a live goal map beside an AI conversation. The user has opened a direct line to YOU to ask about the map itself. The cast, if asked: the user talks to ONE running session, the CHAT AGENT (their Claude Code tab) — the server never prompts it, it only injects map context into its next turn and reads its replies to file them. Everyone else (you included) is a MAP AGENT: a one-shot worker with no session or memory of its own — filer (files each exchange), lighting/focus/zoom agents (propose attention changes), tidy agent (restructuring), naming agent, memory agent, placement agent, and you, the map guide. Map agents never talk to each other; the map is the only shared ground. Answer their question — and when they are asking for a CHANGE, attach a concrete proposal they can approve with one click. NEWCOMERS: when the question is disoriented ("what is this?", "what am I looking at?", "how does this work?"), give the friendly 20-second version built on the THREE ideas (1: this is a map of your work that files itself; 2: focus ▶ = talk about this; 3: light ☀ = keep in the background, dim = let Claude forget it) — then answer about whatever their map actually shows, using THEIR node names. Nothing you output applies by itself; the user always approves first.

THE SYSTEM'S CONTROLS (what you may point the user at):
- FOCUS: click a node and "set focus" re-aims the conversation there. ▶ auto-focus suggests a focus target (red dot on it = the system detected the conversation calls for it).
- LIGHT/DIM: each node can be lit (in the chat agent's working background) or dimmed (visible to the user, out of the agent's reach). ☀ auto-light picks a sensible background for the current focus. New nodes are born lit.
- ZOOM: zooming isolates a subtree in the VIEW only — lighting unchanged. "Dim all outside" is the separate action that dims everything outside the zoom.
- "to sort": the holding pen — anything the filer can't place in the writable scope lands there with an arrival note. It is a PERMANENT system node: always present even when empty; nothing can delete, move, or rename it. Leaving: the user approves its placement dot (one-click move), uses ↖/⇧ on the item, or lights the destination so the filer moves it home next round.
- DOTS: a red dot on a node is a suggestion from the map — on a normal node, a cleanup proposal ("see the proposal" shows a before/after the user can edit, give feedback on, or apply); on a to-sort item, a placement — approving moves it under the suggested branch.
- ⟳ tidy map: reviews the whole map on demand and files dots (or reports it clean). When the problem is the TOP LEVEL itself (unrelated sibling threads needing domain containers), the dot lands on "⟳ tidy top level" (in ⋯ other) — the ONLY flow where top-level containers can be created and top-level threads regrouped; a normal subtree tidy cannot do that.
- HOME (small house icon): the home button above the map zooms to the user's home page — the whole map by default, or the node they set with the house button on its row. View only.
- ✎ MAP PREFERENCES (in ⋯ other): standing instructions every map agent receives (how to group, name, clean). When the user tells YOU a lasting preference, propose saving it (kind "pref").
- DELETING with sessions inside: deleting a node warns about sessions focused inside it and CLOSES them by default (uncheckable to keep — kept ones refocus to the parent).
- ⏻ CLOSE MAP INFLUENCE (in ⋯ other, behind ＋ more): silences the map completely for this project — the user's Claude sessions receive NO map context and the map is never mentioned to them — while filing continues quietly, so the map stays current. Reopened from the same button.
- 🔧 DEV MODE (in ⋯ other): records every map-agent call and injection in full, shown as a timeline — for seeing exactly who was prompted with what.
- DIRECT EDITS: the user can rename, retype, re-status, move, or delete any node by hand, and create their own ("type your own idea").
- MERGES: ⇢ merge folds one node into a survivor (children, description, and chat memory combine; the duplicate disappears); a whole other MAP can be folded into the current one as a top-level topic (irreversible). Sessions are never merged — the map already carries everything; stale sessions just age out.
- 🔍 SEARCH: finds a node by words; the user confirms it in a parents+children view, then can light / zoom / focus it. ★ favorites pin nodes to the top of search.
- Every map change flows into the chat agent's context automatically — fixing the map IS fixing the agent's memory.

HOW TO ANSWER:
- Diagnose briefly in the map's own vocabulary, then give the shortest path that resolves the issue.
- When the user asks for a change (not just an explanation), ALSO emit exactly one "action" — a proposal at the right level:
  * kind "focus" + nodeId: they want the conversation aimed somewhere ("let's work on X", "switch to Y"). nodeId is the EXACT node they named — the deepest matching node, never its parent or the surrounding topic. Example: the map has "Garden plan [aaaa1111]" with child "decision: Soil mix 60/30/10 [bbbb2222]"; "switch to the soil mix" → nodeId bbbb2222. Answering aaaa1111 (the parent) is WRONG.
  * kind "light" + lit/dim id lists: they want the working background changed ("light everything about pricing", "dim the old stuff", "only X should be active").
  * kind "tidy" + nodeId + instruction: they want structure cleaned ("merge these", "split this topic", "this area is a mess") — instruction is one sentence telling the tidy specialist what to do; a full before/after preview will be generated for the user to approve.
  * kind "zoom" + nodeId: they want the VIEW isolated on one subtree ("zoom into X", "isolate X", "show me only X") — view only; lighting and focus untouched.
  * kind "autofocus" (no other fields): they want a focus change but DIDN'T name a target ("where should I be working?", "aim me at the right thing") — the focus specialist will propose one for approval.
  * kind "autolight" (no other fields): they want the background sorted but DIDN'T name nodes ("fix my lighting", "set up the background for what I'm doing") — the light specialist will pick, for approval.
  * kind "autozoom" (no other fields): they want the view decluttered but DIDN'T name a subtree ("too much on screen", "zoom to whatever I'm doing") — the zoom specialist will pick, for approval.
  * kind "search" + instruction (the search words): they're LOOKING for a node ("find my node about X", "where did we put Y") — opens the search view with results. Single-step only.
  * kind "favorite" + nodeId: they want a node pinned ("favorite X", "pin Y") — applies on approval. Single-step only.
  * kind "merge" + nodeId + intoId: they want two nodes combined ("merge X into Y", "these two are the same") — nodeId disappears into intoId. If they named only the duplicates without a survivor, pick the better-worded one as intoId. Single-step only.
  * kind "mergeproject" + projectName (one of OTHER MAPS): they want that whole map folded into THIS one as a topic. Warn in the answer that it is irreversible. Single-step only.
  * kind "feedback" + instruction: the user has hit what looks like a SERIOUS BUG in this product (something clearly broken, data loss, wrong behavior they demonstrated) or made an important product suggestion — and ONLY then. instruction = a crisp report in their words (what happened / what they expected). In your answer, offer to send it to the developers — it opens a GitHub issue THEY review and submit themselves; nothing is sent automatically and usage is never monitored. Never use this for ordinary questions or map operations. Single-step only.
  * kind "pref" + instruction "glossary: <their word> instead of <the word the map used>": they correct VOCABULARY ("we call it a session, not a chat", "it's the tray, not the inbox") — saved to the map's glossary; every agent then uses their word and the map's names are corrected.
  * kind "pref" + instruction: they express a LASTING preference about how the map should be managed ("keep containers broad", "never propose deleting my exploratory notes", "name nodes in my language") — instruction is the preference as ONE short standing rule. It is saved (with their approval) into the map preferences that EVERY map agent receives. Only for durable taste — not one-off requests. Single-step only.
- STATUS QUESTIONS ("what is unsolved / open / still pending / active?"): the STATUS INDEX block is mechanical and complete — answer from it with its count and its items; never estimate from the tree.
- WHAT YOU SEE: the map as an OUTLINE (deeper levels rolled up as "(+N inside)"), the STATUS INDEX (complete), the nodes whose words match the user's sentence (full statements), the focus, the lit set, the favorites, the open dots, and the brain's standing report. You do NOT see every node's statement, memory or history.
- ASK THE MAP: when the answer needs what you cannot see, return "queries" (up to 4) instead of guessing — the server answers them mechanically and re-runs you ONCE with RESULTS: {kind "status", status?: one status or omitted for every unsettled node}, {kind "search", words}, {kind "subtree", nodeId} (everything inside a node, with ids), {kind "history", nodeId} (the node's versions and dates), {kind "memory", nodeId} (what the map remembers about it), {kind "lit"}, {kind "favorites"}, {kind "area", nodeId} (what the AREA's governor believes about the area around that node — a local, unreconciled belief with a date; the central report outranks it). Give your best partial answer alongside. Never query what is already in front of you.
- IDS: every id you use in an action must be one you were SHOWN (outline, index, matches, results). To act on something you cannot see yet, query first.
- Pick the LEVEL by the system's division of labor: attention → focus/light, structure → tidy. Named targets → focus/light with ids; unnamed → autofocus/autolight delegation.
- COMPLEX REQUESTS: when one operation isn't enough, emit an ORDERED PLAN — an "actions" array of up to 40 focus/light/zoom/tidy/favorite steps, in the order they should apply ("favorite all the open questions" = one favorite step per node, each with its exact id from the STATUS INDEX; if there are more than 40, say so and take the first 40). Example: "let's work on A and get B and C out of the background" → [{kind focus, nodeId A}, {kind light, dim [B, C]}]. Steps must not contradict each other (never light and dim the same node). autofocus/autolight/autozoom are single-step only — never inside a plan.
- Never emit actions for a pure question. Simple request → one action; complex → one plan.
- In the answer text, say what the attached proposal does in one sentence — the user sees an approve button next to it.
- Use node ids exactly as given in [brackets].
- Division of labor, if asked: current relevance is focus/light's job; structure (duplicates, misplacement) is tidy's; capture happens automatically every round.
- PLAIN TEXT ONLY: no markdown, no asterisks, no headers — the answer renders as raw text. Short answers; a numbered list of steps is fine as plain lines.
- Say "topic", never "deliberation" — this is a topic map.`;

const SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['answer'],
  properties: {
    answer: { type: 'string' as const },
    action: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string' as const, enum: ['focus', 'light', 'tidy', 'zoom', 'autofocus', 'autolight', 'autozoom', 'search', 'favorite', 'merge', 'mergeproject', 'pref', 'feedback'] },
        nodeId: { type: 'string' as const, description: 'For focus: the deepest node whose content matches what the user named — NEVER its parent. For tidy: the subtree root to clean. For merge: the node that disappears.' },
        intoId: { type: 'string' as const, description: 'merge only: the surviving node' },
        projectName: { type: 'string' as const, description: 'mergeproject only: the other map to fold into this one' },
        lit: { type: 'array' as const, items: { type: 'string' as const } },
        dim: { type: 'array' as const, items: { type: 'string' as const } },
        instruction: { type: 'string' as const },
      },
    },
    queries: {
      type: 'array' as const,
      description: 'Questions for the map the server answers mechanically before re-running you once (up to 4).',
      items: {
        type: 'object' as const, additionalProperties: false, required: ['kind'],
        properties: {
          kind: { type: 'string' as const, enum: ['status', 'search', 'subtree', 'history', 'memory', 'lit', 'favorites', 'area'] },
          status: { type: 'string' as const }, words: { type: 'string' as const }, nodeId: { type: 'string' as const },
        },
      },
    },
    actions: {
      type: 'array' as const,
      description: 'Ordered plan for complex requests needing several operations, up to 40 steps: focus/light/tidy/zoom, or a favorite per node ("favorite all X" = one favorite step per node).',
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string' as const, enum: ['focus', 'light', 'tidy', 'zoom', 'favorite'] },
          nodeId: { type: 'string' as const },
          lit: { type: 'array' as const, items: { type: 'string' as const } },
          dim: { type: 'array' as const, items: { type: 'string' as const } },
          instruction: { type: 'string' as const },
        },
      },
    },
  },
};

// M218 (Mark, 2026-09-08 — "what is going on?"): the deepest-match rescue
// re-targets a pick that shares NO words with the user's sentence to the
// best word match anywhere on the map. It was built for "switch to the soil
// mix" picking the parent; it also fired on "yes let's do the zoom" (zoomed
// to a leaf whose text mentions "zoom") and on "let's favorite all active
// nodes" (two of three favorites collapsed onto "Confirm view shows all five
// elements"). Rule now: only the user's CONTENT words count — the product's
// own vocabulary (zoom, favorite, active, nodes, yes…) never names a target;
// no content words → the pick stands. Favorites are never rescued: their ids
// come from the guide's own listing, not from a name the user typed.
const STOP = new Set(['the', 'this', 'that', 'with', 'about', 'lets', 'let', 'want', 'switch', 'focus', 'conversation', 'topic', 'node', 'decision', 'question', 'work']);
const UI_WORDS = new Set(['zoom', 'zooming', 'isolate', 'declutter', 'show', 'view', 'only', 'into', 'favorite', 'favorites', 'favourite', 'pin', 'star', 'light', 'lit', 'dim', 'active', 'inactive', 'nodes', 'node', 'unsolved', 'solved', 'open', 'closed', 'pending', 'decided', 'all', 'every', 'yes', 'yeah', 'sure', 'please', 'okay', 'now', 'them', 'those', 'these', 'ones', 'map', 'tree', 'agent', 'guide', 'can', 'have', 'get', 'set', 'make', 'give', 'find', 'list']);
export const contentTokens = (t: string): Set<string> => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !UI_WORDS.has(w)));
export function rescueTarget(q: string, picked: any, nodes: any[], kind: 'focus' | 'zoom' | 'favorite' = 'focus'): any {
  if (kind === 'favorite') return picked;
  const verbs = kind === 'zoom' ? /zoom|isolate|show me only|declutter/i : /focus|work on|switch|aim|move to|go to|back to/i;
  const clause = q.split(/,|;| and | then /i).find((c) => verbs.test(c)) ?? q;
  const qt = contentTokens(clause);
  if (!qt.size) return picked; // nothing named in the user's own words — the pick stands
  const score = (n: any) => { const nt = contentTokens(`${n.title ?? ''} ${n.content}`); let c = 0; for (const w of qt) if (nt.has(w)) c++; return c; };
  if (score(picked) > 0) return picked;
  let best = picked, bestScore = 0;
  for (const n of nodes) { if (n.status === 'removed') continue; const sc = score(n); if (sc > bestScore) { best = n; bestScore = sc; } }
  return best;
}

// M218: the STATUS INDEX — what the guide can count instead of skim. Unsettled
// = a status that says the matter is still open, or a question not answered.
const SETTLED = new Set(['decided', 'completed', 'done', 'answered', 'resolved', 'closed', 'live', 'active', 'standing', 'designed', 'reversed', 'superseded', 'dropped', 'rejected', 'reverted', 'removed', 'constraint', 'noted', 'provisional']);
export function statusIndex(nodes: any[]): { counts: Record<string, number>; unsettled: any[] } {
  const live = nodes.filter((n) => n.status !== 'removed');
  const counts: Record<string, number> = {};
  for (const n of live) counts[n.status] = (counts[n.status] ?? 0) + 1;
  const unsettled = live.filter((n) => !SETTLED.has(n.status) || (n.type === 'question' && !['answered', 'decided', 'resolved', 'closed'].includes(n.status)));
  return { counts, unsettled };
}

// M219 (Mark: "fix the talk to map feature — future proof, elegant"): the
// guide no longer skims a 140k-character tree. It sees an outline and asks
// the map QUESTIONS the server answers mechanically; it answers from those
// results and may only act on ids it was shown. New capability = a new query
// kind here, not prompt surgery; the prompt no longer grows with the map,
// so the model is free to be a strong one.
export interface GuideQuery { kind: 'status' | 'search' | 'subtree' | 'history' | 'memory' | 'lit' | 'favorites' | 'area'; status?: string; words?: string; nodeId?: string }
export function runGuideQuery(store: Store, projectId: string, chatId: string | null, q: GuideQuery, shown: Set<string>): string {
  const map = loadMap(store, projectId);
  const live = map.nodes.filter((n) => n.status !== 'removed');
  const nm = (n: any) => (n.title || n.content.slice(0, 60)) as string;
  const line = (n: any) => { shown.add(n.id); return `[${n.id.slice(0, 8)}] ${nm(n)} (${n.type ? n.type + ', ' : ''}${n.status})${n.title && n.content !== n.title ? ` — ${n.content.slice(0, 160)}` : ''}`; };
  const find = (raw?: string) => { const id = String(raw ?? '').replace(/[\[\]]/g, ''); return id ? live.find((n) => n.id === id || n.id.startsWith(id)) : undefined; };
  switch (q.kind) {
    case 'status': {
      const st = (q.status ?? '').trim().toLowerCase();
      const hits = st ? live.filter((n) => n.status === st) : statusIndex(map.nodes).unsettled;
      return `RESULT status${st ? ` "${st}"` : ' (unsettled)'} — ${hits.length} node(s):\n${hits.slice(0, 120).map(line).join('\n') || '(none)'}${hits.length > 120 ? `\n… ${hits.length - 120} more` : ''}`;
    }
    case 'search': {
      const hits = matchNodes(store, projectId, q.words ?? '', { limit: 12, minHits: 1 });
      let ns = hits.map((h) => live.find((n) => n.id === h.id)).filter(Boolean) as any[];
      // Short or single words fall through the weighted matcher (it needs two
      // tokens of four letters or more): plain substring scan as the fallback.
      if (!ns.length) { const words = (q.words ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2); if (words.length) ns = live.filter((n) => { const t = `${n.title ?? ''} ${n.content}`.toLowerCase(); return words.every((w) => t.includes(w)); }).slice(0, 12); }
      return `RESULT search "${(q.words ?? '').slice(0, 80)}" — ${ns.length} node(s):\n${ns.map(line).join('\n') || '(no node matches those words)'}`;
    }
    case 'subtree': {
      const n = find(q.nodeId); if (!n) return `RESULT subtree: unknown node ${q.nodeId ?? ''}`;
      const ids = new Set([n.id, ...descendantNodes(store, n.id)]);
      const rows = live.filter((x) => ids.has(x.id));
      const depth = (id: string): number => { let d = 0; let p = live.find((x) => x.id === id)?.parentId; while (p && p !== n.parentId && d < 30) { d++; p = live.find((x) => x.id === p)?.parentId; } return d; };
      return `RESULT subtree of "${nm(n)}" — ${rows.length} node(s):\n${rows.slice(0, 150).map((x) => '  '.repeat(depth(x.id)) + line(x)).join('\n')}${rows.length > 150 ? `\n… ${rows.length - 150} more` : ''}`;
    }
    case 'history': {
      const n = find(q.nodeId); if (!n) return `RESULT history: unknown node ${q.nodeId ?? ''}`;
      const h = store.nodeHistory(n.id);
      shown.add(n.id);
      return `RESULT history of "${nm(n)}" — ${h.length} version(s):\n${h.slice(-12).map((v) => `- ${v.dated ? v.at : v.changedAt + ' (recorded)'} [${v.source}]${v.status ? ` → ${v.status}` : ''}${v.title ? ` title "${v.title}"` : ''}${v.content ? `: ${String(v.content).slice(0, 160)}` : ''}`).join('\n') || '(no recorded versions)'}`;
    }
    case 'memory': {
      const n = find(q.nodeId); if (!n) return `RESULT memory: unknown node ${q.nodeId ?? ''}`;
      shown.add(n.id);
      const mem = getNodeMemory(store, n.id);
      return `RESULT memory of "${nm(n)}":\n${mem ? String(mem).slice(0, 1500) : '(the map remembers nothing beyond the statement yet)'}`;
    }
    case 'lit': {
      const lit = chatId ? store.getLit(chatId) : [];
      const ns = lit.map((id) => live.find((n) => n.id === id)).filter(Boolean) as any[];
      return `RESULT lit — ${ns.length} node(s):\n${ns.slice(0, 120).map(line).join('\n') || '(nothing lit)'}`;
    }
    case 'area': {
      const n = find(q.nodeId); if (!n) return `RESULT area: unknown node ${q.nodeId ?? ''}`;
      const g = nearestGovernor(store, projectId, n.id);
      if (!g) return `RESULT area: no governor holds the area around "${nm(n)}" yet`;
      const root = live.find((x) => x.id === g.nodeId); if (root) shown.add(root.id);
      return `RESULT area — the governor of "${root ? nm(root) : g.nodeId.slice(0, 8)}" [${g.nodeId.slice(0, 8)}] believes (local, unreconciled, refreshed ${g.updatedAt.slice(0, 10)}; the central report outranks this):\n${g.understanding.slice(0, 2500)}${g.disagreements.length ? `\nIt disagrees with the centre on: ${g.disagreements.join(' · ')}` : ''}`;
    }
    case 'favorites': {
      const ns = store.getFavorites().map((id) => live.find((n) => n.id === id)).filter(Boolean) as any[];
      return `RESULT favorites — ${ns.length}:\n${ns.map(line).join('\n') || '(none)'}`;
    }
  }
  return 'RESULT: unknown query';
}

export interface MapChatAction {
  kind: 'focus' | 'light' | 'tidy' | 'zoom' | 'autofocus' | 'autolight' | 'autozoom' | 'search' | 'favorite' | 'merge' | 'mergeproject' | 'pref' | 'feedback';
  nodeId?: string; nodeName?: string;
  lit?: { id: string; name: string }[];
  dim?: { id: string; name: string }[];
  instruction?: string;
  intoId?: string; intoName?: string;
  projectId?: string; projectName?: string;
}

export async function answerMapQuestion(
  store: Store, projectId: string, chatId: string, question: string,
  history: { q: string; a: string }[] = [],
): Promise<{ answer: string; actions?: MapChatAction[] } | { error: string }> {
  const map = loadMap(store, projectId);
  const chat = store.getChat(chatId);
  const focus = chat ? store.getNode(chat.focusContainerId) : null;
  const litSet = chat ? new Set(store.getLit(chatId)) : new Set<string>();
  const dotIds: string[] = [];
  const otherProjects = store.listProjects().filter((pr) => pr.id !== projectId).map((pr) => ({ id: pr.id, name: pr.name }));
  const dots = store.getOpenSuggestions(projectId).map((s) => {
    const n = store.getNode(s.nodeId);
    if (n) dotIds.push(n.id);
    return `- ${s.kind === 'relight' ? 'amber' : 'red'} dot on "${n ? (n.title || n.content.slice(0, 40)) : '?'}": ${s.note}`;
  });
  // Mechanical deepest-match guard: haiku reliably names the PARENT topic
  // for focus requests despite prompt+schema instructions (bench 4/4). When
  // a descendant's words match the question better than the picked node's,
  // re-target there — deterministic, no extra call.
  const deepestMatch = (q: string, picked: any, kind: 'focus' | 'zoom' = 'focus') => rescueTarget(q, picked, map.nodes, kind);
  const shown = new Set<string>();
  const resolve = (raw: unknown) => {
    const id = String(raw ?? '').replace(/[\[\]]/g, '');
    const n = id ? map.nodes.find((n) => n.status !== 'removed' && (n.id === id || n.id.startsWith(id))) : undefined;
    // M219: an id the guide was never shown is a guess, not a target.
    if (n && !shown.has(n.id)) { store.audit('guide_unshown_id', { id: n.id.slice(0, 8) }); return undefined; }
    return n;
  };
  try {
    // M124: typed context request — the guide sees the map but not node
    // memories or change history; if it returns `need`, re-run ONCE with the
    // requested blocks appended. Bounded, mechanical, dev-mode-auditable.
    const nm = (n: any) => n.title || n.content.slice(0, 50);
    // M219: an outline that fits (deeper levels roll up), plus the nodes that
    // match the user's own words with full statements — the prompt no longer
    // grows with the map.
    const outline = outlineWithIds(map.nodes as any, 14_000).replace(new RegExp(`\\[${(chat?.focusContainerId ?? '').slice(0, 8)}\\]`), (m) => `▶ ${m}`);
    for (const m of outline.matchAll(/\[([0-9a-f]{8})\]/g)) { const n = map.nodes.find((x) => x.id.startsWith(m[1])); if (n) shown.add(n.id); }
    const matched = matchNodes(store, projectId, question, { limit: 8, minHits: 1 }).map((h) => map.nodes.find((n) => n.id === h.id)).filter((n): n is any => !!n && n.status !== 'removed');
    for (const n of matched) shown.add(n.id);
    const idx = statusIndex(map.nodes);
    for (const n of idx.unsettled.slice(0, 80)) shown.add(n.id);
    const favs = store.getFavorites().map((id) => map.nodes.find((n) => n.id === id)).filter(Boolean) as any[];
    for (const n of favs) shown.add(n.id);
    const litNodes = [...litSet].map((id) => map.nodes.find((n) => n.id === id)).filter(Boolean).slice(0, 40) as any[];
    for (const n of litNodes) shown.add(n.id);
    const litNames = litNodes.map((n: any) => `${nm(n)} [${n.id.slice(0, 8)}]`);
    for (const id of dotIds) shown.add(id);
    const baseParts = [
          `THE MAP AS AN OUTLINE (ids in [brackets]; deeper levels rolled up as "(+N inside)" — query subtree to see inside; ▶ = focus):\n${outline}`,
          matched.length ? `NODES WHOSE WORDS MATCH THE USER'S SENTENCE (full statements):\n${matched.map((n: any) => `[${n.id.slice(0, 8)}] ${nm(n)} (${n.status}) — ${n.content.slice(0, 200)}`).join('\n')}` : '',
          // M218: mechanical and complete — the guide answers "what is open" from here, never by skimming the tree.
          `STATUS INDEX (mechanical, complete — answer questions about what is unsolved / open / pending / active FROM THIS, with its true count):\ncounts by status: ${Object.entries(idx.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\nUNSETTLED (${idx.unsettled.length}): ${idx.unsettled.length ? idx.unsettled.slice(0, 80).map((n: any) => `[${n.id.slice(0, 8)}] ${nm(n)} (${n.type ? n.type + ', ' : ''}${n.status})`).join(' · ') + (idx.unsettled.length > 80 ? ` · … ${idx.unsettled.length - 80} more` : '') : '(none)'}\nNote: "active" is a status the import gives chapter headings; it does not mean unsolved.`,
          focus ? `CURRENT FOCUS: "${focus.title || focus.content}". LIT (${litSet.size}): ${litNames.join(', ') || '(nothing)'}${litSet.size > 40 ? ' …' : ''}` : '',
          `FAVORITES (${favs.length}): ${favs.map((n: any) => `${nm(n)} [${n.id.slice(0, 8)}]`).join(', ') || '(none)'}`,
          dots.length ? `OPEN DOTS:\n${dots.join('\n')}` : 'No open dots.',
          otherProjects.length ? `OTHER MAPS (completely separate): ${otherProjects.map((pr) => `"${pr.name}"`).join(', ')}` : '',
          ...history.slice(-4).map((h) => `EARLIER IN THIS CHAT:\nUSER: ${h.q}\nYOU: ${h.a}`),
    ].filter(Boolean);
    const tailParts = [`THE USER ASKS:\n${question.slice(0, 1500)}`, 'Answer as the map guide.' + statusConsult(store, projectId, chat?.focusContainerId, 'full')];
    let parsed: any;
    let extras: string[] = [];
    for (let pass = 1; pass <= 2; pass++) {
      parsed = await call({
        task: 'mapchat', system: SYSTEM + systemCard(store, projectId, 'the MAP GUIDE'), schema: SCHEMA, maxTokens: 800, timeoutMs: 60_000,
        audit: (k, d) => store.audit(k, d),
        user: [...baseParts, ...extras, ...tailParts].join('\n\n'),
      });
      const queries: GuideQuery[] = Array.isArray(parsed.queries) ? parsed.queries.filter((q: any) => q && ['status', 'search', 'subtree', 'history', 'memory', 'lit', 'favorites', 'area'].includes(q.kind)).slice(0, 4) : [];
      if (pass === 1 && queries.length) {
        extras = queries.map((q) => runGuideQuery(store, projectId, chatId, q, shown));
        store.audit('guide_queries', { kinds: queries.map((q) => q.kind) });
        continue;
      }
      break;
    }
    const answer = String(parsed.answer ?? '').trim();
    if (!answer) return { error: 'no answer produced' };
    // Resolve proposed actions' ids; steps that don't resolve are dropped
    // silently (the answer text still stands on its own).
    const resolveAction = (a: any): MapChatAction | undefined => {
      if (a?.kind === 'focus') {
        const picked = resolve(a.nodeId);
        if (!picked) return undefined;
        const n = deepestMatch(question, picked);
        if (n.id !== picked.id) store.audit('mapchat_retarget', { from: picked.id.slice(0, 8), to: n.id.slice(0, 8) });
        return { kind: 'focus', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'light') {
        const name = (n: any) => n.title || n.content.slice(0, 60);
        const uniq = (xs: any[]) => { const seen = new Set(); return xs.filter((x) => !seen.has(x.id) && seen.add(x.id)); };
        const lit = uniq((a.lit ?? []).map(resolve).filter(Boolean).map((n: any) => ({ id: n.id, name: name(n) })));
        const dim = uniq((a.dim ?? []).map(resolve).filter(Boolean).map((n: any) => ({ id: n.id, name: name(n) })));
        return lit.length + dim.length > 0 ? { kind: 'light', lit, dim } : undefined;
      }
      if (a?.kind === 'tidy') {
        const n = resolve(a.nodeId);
        return n ? { kind: 'tidy', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60), instruction: (a.instruction ?? '').slice(0, 300) } : undefined;
      }
      if (a?.kind === 'zoom') {
        const picked = resolve(a.nodeId);
        if (!picked) return undefined;
        const n = deepestMatch(question, picked, 'zoom');
        if (n.id !== picked.id) store.audit('mapchat_retarget', { from: picked.id.slice(0, 8), to: n.id.slice(0, 8) });
        return { kind: 'zoom', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'search') {
        const query = (a.instruction ?? a.query ?? '').slice(0, 120);
        return query ? { kind: 'search', instruction: query } : undefined;
      }
      if (a?.kind === 'favorite') {
        const n = resolve(a.nodeId);
        if (!n) return undefined;
        return { kind: 'favorite', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'merge') {
        const src = resolve(a.nodeId), dst = resolve(a.intoId);
        if (!src || !dst || src.id === dst.id) return undefined;
        return { kind: 'merge', nodeId: src.id, nodeName: src.title || src.content.slice(0, 60), intoId: dst.id, intoName: dst.title || dst.content.slice(0, 60) };
      }
      if (a?.kind === 'mergeproject') {
        const ref = String(a.projectName ?? '').toLowerCase();
        const hit = otherProjects.find((pr) => pr.name.toLowerCase().includes(ref) || ref.includes(pr.name.toLowerCase()));
        return hit ? { kind: 'mergeproject', projectId: hit.id, projectName: hit.name } : undefined;
      }
      if (a?.kind === 'feedback') {
        const instruction = (a.instruction ?? '').trim().slice(0, 800);
        return instruction ? { kind: 'feedback', instruction } : undefined;
      }
      if (a?.kind === 'pref') {
        const instruction = (a.instruction ?? '').trim().slice(0, 200);
        return instruction ? { kind: 'pref', instruction } : undefined;
      }
      if (a?.kind === 'autofocus' || a?.kind === 'autolight' || a?.kind === 'autozoom') return { kind: a.kind };
      return undefined;
    };
    // M81: plans. Prefer the array; fall back to the single action. Guards:
    // cap 4, delegation kinds ejected from plans, tidy last (it opens its own
    // approval), cross-step lit/dim contradictions cancel (audited).
    const rawSteps: any[] = Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions : (parsed.action ? [parsed.action] : []);
    let steps: MapChatAction[] = rawSteps.slice(0, 40).map((a: any) => resolveAction(a))
      .filter((x: MapChatAction | undefined): x is MapChatAction => Boolean(x));
    // M218: the same node twice in one plan is one step (two favorites once
    // collapsed onto one node and the user saw "2 of 3").
    { const seen = new Set<string>(); steps = steps.filter((st) => { const k = `${st.kind}:${st.nodeId ?? ''}`; if (st.nodeId && seen.has(k)) return false; seen.add(k); return true; }); }
    if (steps.length > 1) {
      steps = steps.filter((st) => !['autofocus', 'autolight', 'autozoom', 'search', 'merge', 'mergeproject'].includes(st.kind));
      steps.sort((x, y) => (x.kind === 'tidy' ? 1 : 0) - (y.kind === 'tidy' ? 1 : 0));
      const litAll = new Set(steps.flatMap((st) => st.kind === 'light' ? (st.lit ?? []).map((x) => x.id) : []));
      const conflict = new Set(steps.flatMap((st) => st.kind === 'light' ? (st.dim ?? []).filter((x) => litAll.has(x.id)).map((x) => x.id) : []));
      if (conflict.size) {
        store.audit('guard_plan_conflict', { ids: [...conflict].map((id) => id.slice(0, 8)) });
        for (const st of steps) if (st.kind === 'light') { st.lit = (st.lit ?? []).filter((x) => !conflict.has(x.id)); st.dim = (st.dim ?? []).filter((x) => !conflict.has(x.id)); }
        steps = steps.filter((st) => st.kind !== 'light' || (st.lit!.length + st.dim!.length > 0));
      }
      // Dimming the new focus target — or an ancestor holding it — would cut
      // the conversation off from where the same plan just aimed it.
      const focusStep = steps.find((st) => st.kind === 'focus');
      if (focusStep?.nodeId) {
        const protectedIds = new Set<string>();
        for (let n = store.getNode(focusStep.nodeId); n; n = n.parentId ? store.getNode(n.parentId) : undefined) protectedIds.add(n.id);
        for (const st of steps) if (st.kind === 'light' && (st.dim ?? []).some((x) => protectedIds.has(x.id))) {
          store.audit('guard_plan_dim_focus', { ids: (st.dim ?? []).filter((x) => protectedIds.has(x.id)).map((x) => x.id.slice(0, 8)) });
          st.dim = (st.dim ?? []).filter((x) => !protectedIds.has(x.id));
        }
        steps = steps.filter((st) => st.kind !== 'light' || ((st.lit ?? []).length + (st.dim ?? []).length > 0));
        // (M105: the zoom-vs-focus plan guard is gone — zoom is view-only
        // now and cannot dim the focus.)
      }
    }
    return steps.length ? { answer, actions: steps } : { answer };
  } catch (err) {
    console.error('[mapchat] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

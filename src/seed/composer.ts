import { Store } from '../store/db.js';
import { getNodeMemory } from '../translator/memory.js';
import {
  ancestors, descendantNodes, renderNodeBrief,
  renderNodeOneLiner, renderSubtreeFull,
} from '../map/render.js';

// v0.2 (Jacob's #1/#7): the chat agent receives a COMPLETE map-state
// description EVERY turn — not a seed-once. v0.3.3: budgeted (a+b). v0.4:
// nodes all the way down — "topics" and "items" are the same thing now.
//
// Budget: ~4k tokens (HARNESSMAP_MAP_BUDGET chars, default 16000), filled in
// priority order — constraints are never cut, focus is always full, then lit
// briefs, open questions (only from visible nodes), ELSEWHERE — cutting
// stalest-first, with explicit "…N not shown" markers so both the agent and
// the user see what was omitted.

const BUDGET_CHARS = Number(process.env.HARNESSMAP_MAP_BUDGET ?? 16_000);

export function composeState(store: Store, chatId: string, manipulations: string[]): string {
  const chat = store.getChat(chatId);
  if (!chat) throw new Error(`unknown chat ${chatId}`);
  const focusId = chat.focusContainerId;
  const project = chat.projectId;

  const nodes = store.getNodes(project).filter((n) => n.status !== 'removed');

  // Staleness: a node's last touch = the newest update in its subtree.
  const touch = new Map<string, string>();
  for (const n of nodes) touch.set(n.id, n.updatedAt);
  const subtreeTouch = (id: string): string => {
    let max = touch.get(id) ?? '';
    for (const d of descendantNodes(store, id)) {
      const t = touch.get(d) ?? '';
      if (t > max) max = t;
    }
    return max;
  };
  const freshestFirst = (ids: string[]) =>
    [...ids].sort((a, b) => (subtreeTouch(a) < subtreeTouch(b) ? 1 : -1));

  // --- always-present sections (never cut) ---
  const focusSubtree = new Set([focusId, ...descendantNodes(store, focusId)]);
  const frame = ancestors(store, focusId);
  const constraints = nodes.filter((n) => n.type === 'constraint' && ['active', 'hard'].includes(n.status));

  const fixed: string[] = ['[map state — the current structure of this work]'];
  if (frame.length > 0) {
    fixed.push('WIDER FRAME:');
    for (const f of frame) fixed.push(`  • ${renderNodeBrief(store, f.id)}`);
  }
  fixed.push('', 'FOCUS (what the user is actively working on):');
  fixed.push(renderSubtreeFull(store, focusId).split('\n').map((l) => `  ${l}`).join('\n'));

  // M38: how the focus fits its surroundings — cached relational description
  // (refreshed asynchronously after each round; may lag one beat).
  const focusRel = store.getCachedRelation(focusId);
  if (focusRel) {
    fixed.push('', 'HOW THE FOCUS FITS (its place among parents and children):');
    fixed.push(focusRel.split('\n').map((l) => `  ${l}`).join('\n'));
  }

  // M41: the focus node's chat memory — what was discussed here before,
  // deeper than the rolling turn window.
  const focusMem = getNodeMemory(store, focusId);
  if (focusMem) {
    fixed.push('', 'FOCUS MEMORY (what was discussed when this was the focus before):');
    fixed.push(focusMem.split('\n').map((l) => `  ${l}`).join('\n'));
  }

  const tail: string[] = [];
  if (constraints.length > 0) {
    tail.push('', 'STANDING CONSTRAINTS (respect these):');
    for (const k of constraints) tail.push(`  • ${k.content}${k.status === 'hard' ? ' (hard)' : ''}`);
  }
  if (manipulations.length > 0) {
    tail.push('', 'RECENT USER ACTIONS ON THE MAP (since last message):');
    for (const m of manipulations) tail.push(`  • ${m}`);
  }
  tail.push(
    '',
    'Work WITHIN this structure when the user is working: advance the FOCUS,',
    'respect the constraints, and move open questions forward when natural.',
    'When the user says something unrelated to the work, just respond to THEM',
    '— helpfully and naturally — without redirecting to the map. Nodes the',
    'user removed or dropped are settled — do not reintroduce them. Topics',
    'listed under ELSEWHERE — and anything you remember discussing that is',
    'now dimmed there — are SET ASIDE by the user: never bring them up on',
    'your own initiative, never fold their ideas into answers as if current.',
    'Only if the USER raises one, note it is set aside and offer to light it',
    'up. A separate',
    'system keeps this map updated from the conversation; treat it as the',
    'current state of the work and let it shape what you do next. If the user',
    'raises an issue with the MAP itself — where something is filed, how to',
    'clean up, lighting/focus mechanics — refer them to the map panel\'s',
    '"🗨 talk to map" button, where the map agent answers directly with',
    'instructions; do not try to restructure the map yourself.',
  );

  let budget = BUDGET_CHARS - fixed.join('\n').length - tail.join('\n').length;

  // --- budgeted sections, filled in priority order, stalest cut first ---

  // 1. LIT branches (background the user chose). M46 (Jacob): a lit node
  // contributes its full DESCRIPTION — no fit, no chat memory (focus-only
  // privilege). Rendered one block per top-lit branch (a lit node whose
  // parent isn't lit) to kill the cascade-duplication; whole blocks are
  // budgeted stalest-first.
  const litSet = new Set(store.getLit(chatId));
  const topLit = freshestFirst([...litSet].filter((id) =>
    !focusSubtree.has(id) && store.getNode(id) && !litSet.has(store.getNode(id)!.parentId ?? '')));
  const litBlock = (id: string, depth: number): string[] => {
    const n = store.getNode(id);
    if (!n || n.status === 'removed') return [];
    const pad = '  '.repeat(depth + 1);
    const label = n.title && n.title !== n.content ? `${n.title}: ` : '';
    const lines = [`${pad}• ${label}${n.content}${n.type ? ` [${n.type}, ${n.status}]` : ''}`];
    for (const kid of store.childrenOf(id)) {
      if (litSet.has(kid.id)) lines.push(...litBlock(kid.id, depth + 1));
    }
    return lines;
  };
  const litLines: string[] = [];
  let litOmitted = 0;
  for (const id of topLit) {
    const block = litBlock(id, 0);
    const size = block.join('\n').length;
    if (budget - size < 0) { litOmitted++; continue; }
    budget -= size;
    litLines.push(...block);
  }

  // 2. OPEN QUESTIONS — only from visible (focus+lit) parts of the map.
  const visible = new Set([...focusSubtree, ...store.getLit(chatId)]);
  const openQs = nodes.filter((n) => n.type === 'question' && n.status === 'open'
    && (visible.has(n.id) || (n.parentId && visible.has(n.parentId))));
  const qLines: string[] = [];
  let qOmitted = 0;
  for (const q of openQs) {
    const line = `  • ${q.content}`;
    if (budget - line.length < 0) { qOmitted++; continue; }
    budget -= line.length;
    qLines.push(line);
  }

  // 3. ELSEWHERE — one line per unlit top-level node, freshest first.
  const rest = freshestFirst(nodes
    .filter((n) => n.parentId === null && !focusSubtree.has(n.id) && !litSet.has(n.id))
    .map((n) => n.id));
  const restLines: string[] = [];
  let restOmitted = 0;
  for (const id of rest) {
    const line = `  • ${renderNodeOneLiner(store, id)}`;
    if (budget - line.length < 0) { restOmitted++; continue; }
    budget -= line.length;
    restLines.push(line);
  }

  // --- assemble in display order, with explicit omission markers (G2) ---
  const parts: string[] = [...fixed];
  if (litLines.length > 0 || litOmitted > 0) {
    parts.push('', 'BACKGROUND (lit by the user as reference):');
    parts.push(...litLines);
    if (litOmitted > 0) parts.push(`  … ${litOmitted} lit topic(s) omitted for space (stalest first).`);
  }
  if (restLines.length > 0 || restOmitted > 0) {
    parts.push('', 'ELSEWHERE ON THE MAP (folded — set aside by the user; see the rule below):');
    parts.push(...restLines);
    if (restOmitted > 0) parts.push(`  … ${restOmitted} more topic(s) exist but are not shown (stalest first). If something seems missing, ask — the user can light it.`);
  }
  if (qLines.length > 0 || qOmitted > 0) {
    // Questions sit after the constraints block within the tail.
    const at = constraints.length > 0 ? constraints.length + 2 : 0;
    tail.splice(at, 0, '', 'OPEN QUESTIONS (in focus and lit topics):', ...qLines,
      ...(qOmitted > 0 ? [`  … ${qOmitted} more open question(s) omitted for space.`] : []));
  }
  parts.push(...tail);
  return parts.join('\n');
}

import type { Alteration } from '../types.js';
import { systemCard } from './cast.js';
import { Store } from '../store/db.js';
import { call, modelFor } from '../inference.js';
import { loadMap, descendantNodes, renderSubtreeFull } from '../map/render.js';
import { SCHEMA, normalizeIds } from './translator.js';

// Reorganize (v0.2, Jacob's #8, resolved (a)+(i)): conservative cleanup of one
// chosen subtree, returned as a PROPOSAL with a before/after preview — nothing
// applies until the user confirms. v0.4: nodes all the way down.

const SYSTEM = `You are the reorganizer for a goal map made of NODES (one kind of thing: every line has content, optional type, status, and children — a topic is just a node whose children matter most). The user has selected ONE subtree that has become messy and asked you to clean it up. You receive ONLY the local neighborhood (ids in [brackets]): the target's parent for orientation, the target, its children, and its grandchildren. A grandchild marked "+N nested below" has deeper content you cannot see — you may move it whole, but NEVER remove it or edit its content.

Propose a CONSERVATIVE cleanup of the target subtree ONLY:
- MERGE duplicate nodes — full procedure, all steps mandatory: (1) pick the survivor (the better-worded / fuller one; update_node its content if needed); (2) move_node every child worth keeping from the redundant node to the survivor; (3) ONLY THEN kill the redundant node with update_node status 'removed'. NEVER remove a node that still has live children you haven't moved — that hides content.
- REGROUP: if the subtree has clearly become two or more topics, create heading nodes and move_node accordingly. Only when the grouping is obvious. Prefer nesting under the node the material is about (evidence under its claim) over inventing parallel headings.
- RENAME: fix node content (including the subtree root's) so it reflects what's actually inside — keep recognizable vocabulary.
- FIX types/statuses that are plainly wrong (a "question" that's actually a decision, etc.).
- SUGGEST DELETIONS: exploratory debris the user never promoted, superseded duds, stale leftovers → update_node status 'removed'. These are suggestions; the user can uncheck them.
- KNOW THE SYSTEM'S OWN FUNCTIONS: this map has focus (where the conversation aims) and light/dim (what stays in the working background). Currently-irrelevant is THEIR job, not yours. NEVER propose removing a node because the user focused elsewhere, the conversation moved on, or it seems inactive/off-topic right now — an untouched-but-valid node stays exactly where it is. Removal is only for redundancy and debris: duplicates (after merging), superseded duds, dead leftovers.

DO NOT: touch anything outside the target subtree (plus any nodes explicitly listed as also-in-scope); change the meaning of nodes; drop solid commitments (accepted/decided/active/hard nodes are kept unless truly duplicated); invent new content.
Sticky bias: when in doubt, leave it as it is. A small, obviously-right cleanup beats an ambitious rewrite.
EXCEPTION to the sticky bias: when the request includes a stated reason this cleanup was suggested, resolving THAT problem is the job — your proposal MUST fully fix the stated problem (a "merge these duplicates" suggestion must end with exactly one surviving node and no duplicates). Being conservative about everything else, yes; leaving the flagged problem half-fixed, no.

Return: summary (one sentence on what the cleanup does) + alterations. Reference existing ids exactly as given in [brackets]; new node ids as short random strings.`;

// M122 (Jacob): the top level itself as a tidy target — the ONLY place any
// agent may create top-level nodes or move existing top-level threads.
const ROOT_EXTRA = `

ROOT SCOPE — this run's target is THE TOP LEVEL of the map itself; there is no single target node, you see every top-level thread (and two levels under each). Special license, valid ONLY in root scope: you MAY create new top-level heading nodes (domain containers — create_node with parentId null) and move_node existing top-level nodes under them. Group only when the domains are obvious; a few broad, recognizable containers beat many narrow ones; never bury a thread under a label the user wouldn't recognize; leave a thread at top level when it fits no group. The "to sort" tray is system infrastructure: never move, rename, remove, or nest anything under it. All other rules stand.`;

export interface ReorganizeProposal {
  summary: string;
  alterations: Alteration[];
  before: string;
  after: string;
}

export async function proposeReorganize(store: Store, projectId: string, nodeId: string | null, hint?: string, feedback?: string, priorSummary?: string): Promise<ReorganizeProposal | { error: string } | null> {
  const map = loadMap(store, projectId);
  const isRoot = !nodeId;
  const isToSortNode = (n: any) => ((n.title ?? n.content) as string).startsWith('to sort');
  const tops = map.nodes.filter((n) => n.parentId === null && n.status !== 'removed');
  const target = isRoot ? null : store.getNode(nodeId!);
  if (!isRoot && !target) return null;
  const renderScope = () => isRoot
    ? tops.filter((t) => store.getNode(t.id)?.status !== 'removed').map((t) => renderSubtreeFull(store, t.id)).join('\n')
    : renderSubtreeFull(store, nodeId!);
  const before = renderScope();

  // A suggestion may say "merge with [abcd1234]" — those referenced nodes
  // join the cleanup scope, otherwise the guard would block the very merge
  // the suggestion asks for.
  const hintedIds = [...(hint ?? '').matchAll(/\[([0-9a-f]{8})\]/g)]
    .map((m) => map.nodes.find((n) => n.id.startsWith(m[1]))?.id)
    .filter((x): x is string => Boolean(x) && x !== nodeId);

  // M72 (Jacob): tidy reads ONLY the local neighborhood — 1 ancestor up,
  // 2 levels down (children + grandchildren). Deeper content is hidden
  // behind a "+N nested below" marker and protected from removal/edits.
  const label = (x: any) => `${x.type ? `${x.type}: ` : ''}${x.content} [${x.id.slice(0, 8)}] (${x.status})`;
  const visible = new Set<string>();
  const lines: string[] = [];
  const emit = (id: string, depth: number, indent: number) => {
    const n = store.getNode(id); if (!n) return;
    visible.add(id);
    const kids = store.childrenOf(id).filter((k) => k.status !== 'removed');
    const deeper = depth >= 2 && kids.length ? ` (+${descendantNodes(store, id).length} nested below — do NOT remove or edit this node)` : '';
    lines.push(`${'  '.repeat(indent)}- ${label(n)}${deeper}`);
    if (depth < 2) for (const k of kids) emit(k.id, depth + 1, indent + 1);
  };
  const parent = target?.parentId ? store.getNode(target.parentId) : undefined;
  if (parent) lines.push(`(parent, for orientation only — not yours to change) ${label(parent)}`);
  if (isRoot) {
    for (const t of tops) {
      if (isToSortNode(t)) { lines.push(`(system tray — not yours to change) ${label(t)}`); continue; }
      emit(t.id, 0, 0);
    }
  } else {
    emit(nodeId!, 0, parent ? 1 : 0);
  }
  for (const h of hintedIds) emit(h, 0, 0);
  const fullTree = lines.join('\n');
  // Adaptive tier: small neighborhoods don't need the smart model.
  const model = visible.size <= 8 ? modelFor('filer') : modelFor('tidy');

  try {
    const parsed = await call({
      task: 'tidy', modelOverride: model, system: (isRoot ? SYSTEM + ROOT_EXTRA : SYSTEM) + systemCard(store, projectId, 'the TIDY agent'), maxTokens: 3000, schema: SCHEMA, timeoutMs: 120_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `LOCAL NEIGHBORHOOD (all you can see and all you may change, except the parent line):\n${fullTree}`,
          isRoot ? 'TARGET: THE TOP LEVEL of the map — group and clean the top-level threads per ROOT SCOPE.'
                 : `TARGET SUBTREE to clean up: "${target!.content}" [${nodeId!.slice(0, 8)}] and everything under it.`,
          // M38: cached relational descriptions guide the reorganization — a
          // node whose "how it fits" reads awkwardly is a misplacement clue.
          ...(() => {
            const relIds = isRoot
              ? tops.filter((t) => !isToSortNode(t)).flatMap((t) => [t.id, ...descendantNodes(store, t.id)])
              : [nodeId!, ...descendantNodes(store, nodeId!)];
            const rels = relIds
              .map((id) => ({ id, rel: store.getCachedRelation(id) }))
              .filter((x) => x.rel);
            return rels.length
              ? [`HOW THESE NODES CURRENTLY FIT (relational notes — use awkward fits as misplacement clues):\n${rels.map((x) => `[${x.id.slice(0, 8)}] ${x.rel}`).join('\n')}`]
              : [];
          })(),
          ...(hint ? [`WHY THIS CLEANUP WAS SUGGESTED (your proposal must fully resolve this): ${hint}`] : []),
          // M69: iterative tidy — the user talks back to the proposal.
          ...(priorSummary ? [`YOUR PREVIOUS PROPOSAL (the user saw it and wants something different): ${priorSummary}`] : []),
          ...(feedback ? [`THE USER'S DIRECTION — this OVERRIDES your own instincts; build the proposal the user is asking for: ${feedback}`] : []),
          ...(hintedIds.length ? [`ALSO IN SCOPE (referenced by the suggestion): ${hintedIds.map((id) => `"${store.getNode(id)?.content}" [${id.slice(0, 8)}]`).join(', ')} — you may modify these too, e.g. as merge survivors.`] : []),
          'Propose the conservative cleanup.',
        ].join('\n\n'),
    });
    let alterations = normalizeIds(parsed.alterations ?? [], map);

    // Safety net (M72): edits may touch only VISIBLE nodes, and a node with
    // hidden depth may be moved whole but never removed or content-edited.
    const hasHidden = (id: string) => !store.childrenOf(id).every((k) => visible.has(k.id) || k.status === 'removed');
    alterations = alterations.filter((a: any) => {
      if (a.op === 'create_node') return a.parentId ? visible.has(a.parentId) : isRoot;
      if (!('id' in a) || !visible.has(a.id)) return false;
      if (a.op === 'update_node' && hasHidden(a.id) && (a.status === 'removed' || a.content !== undefined)) return false;
      return true;
    });

    const after = store.previewAlterations(projectId, alterations, renderScope);
    return { summary: parsed.summary ?? '', alterations, before, after };
  } catch (err) {
    // Surface the real reason to the UI (Jacob's bug: silent death at "preparing…").
    console.error('[reorganize] proposal failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.slice(0, 200) };
  }
}

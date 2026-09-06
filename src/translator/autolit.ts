import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree, renderTieredTree } from '../map/render.js';
import { statusConsult } from './mapstatus.js';
import { budgetChars } from '../seed/composer.js';
import { getAllMinimals } from './memory.js';
import { descendantNodes } from '../map/render.js';

// M199 (Jacob: "it absolutely needs to know the budget"). The lighter is told
// the block size and what its lit set costs, and a mechanical guard refuses a
// proposal that does not fit. Cost model: the composer floors every visible
// lit node at its minimal line (shape + one-sentence gist), so a lit set
// costs about the sum of those lines; the lit floor may take LIT_SHARE of
// the block (the rest is focus, constraints, questions, and depth).
export const LIT_SHARE = 0.6;
export function litSetCost(store: Store, ids: Iterable<string>): { nodes: number; chars: number } {
  const minimals = getAllMinimals(store);
  let nodes = 0, chars = 0;
  for (const id of ids) {
    const n = store.getNode(id);
    if (!n || n.status === 'removed') continue;
    nodes++;
    const short = n.title || (n.content.length > 70 ? n.content.slice(0, 69) : n.content);
    chars += short.length + 6 + (minimals.get(id)?.length ?? 0);
  }
  return { nodes, chars };
}
export function litCap(store: Store): number { return Math.round(budgetChars(store) * LIT_SHARE); }
/** The lit set that would result from applying a proposal (cascade included; the focus path is never dimmed). */
export function resultingLit(store: Store, currentLit: string[], lit: string[], dim: string[], keep: Set<string> = new Set()): Set<string> {
  // Dim first, then light: "dim the log, light the v0.5 era inside it" must
  // leave the era lit (the model proposes exactly this shape).
  const out = new Set(currentLit);
  for (const id of dim) for (const d of [id, ...descendantNodes(store, id)]) { if (!keep.has(d)) out.delete(d); }
  for (const id of lit) { out.add(id); for (const d of descendantNodes(store, id)) out.add(d); }
  return out;
}

// Auto-lit (v0.3, Jacob's Z2): the map agent recommends which topics belong in
// the conversation's background and which should dim, given the current focus.
// Triggered by a global button; applied immediately (recommend AND implement).

const SYSTEM = `You manage the background context of a goal-map conversation. Topics that are "lit" are loaded into the agent's background; "dim" topics are not seen at all.

Given the map (ids in [brackets]), the current FOCUS topic, and which topics are currently lit, choose the lighting that best serves the focus:
- LIT: nodes whose content the agent needs while working on the focus — standing constraints that apply, sibling topics with decisions the focus depends on, anything the focus explicitly builds on.
- DIM: nodes irrelevant to the focus. Finished or parked threads with no bearing on the focus. When in doubt, dim — background costs attention.
Never dim the focus node or its ancestors.

Lighting applies to any node and cascades to its whole subtree. Prefer lighting/dimming at the highest node that captures your intent.

Return: summary (one short sentence of what you changed and why — describe only changes you are actually making; if none, say the lighting already fits the focus), lit (node ids to turn ON), dim (node ids to turn OFF). Only list CHANGES from the current lighting; ids exactly as given in [brackets].`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'lit', 'dim'],
  properties: {
    summary: { type: 'string' },
    lit: { type: 'array', items: { type: 'string' } },
    dim: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface AutolitResult { summary: string; lit: string[]; dim: string[]; cost?: { nodes: number; chars: number }; overBudget?: { nodes: number; chars: number; cap: number } }

export async function proposeAutolit(
  store: Store, projectId: string, focusId: string | null, currentLit: string[],
  feedback?: string, priorSummary?: string,
): Promise<AutolitResult | { error: string }> {
  const map = loadMap(store, projectId);
  // M194 (Jacob): tiered context, same model as the chat briefing.
  const tree = renderTieredTree(store, projectId, focusId ?? null, 40_000);
  const litNames = currentLit.map((id) => store.getNode(id)?.content).filter(Boolean);
  // The budget, as numbers the lighter must respect (M199).
  const cap = litCap(store);
  const now = litSetCost(store, currentLit);
  const chapterCosts = map.nodes.filter((n: any) => n.status !== 'removed' && n.parentId === null).flatMap((top: any) =>
    [top, ...map.nodes.filter((n: any) => n.parentId === top.id && n.status !== 'removed')].map((c: any) => {
      const ids = [c.id, ...descendantNodes(store, c.id)];
      const cost = litSetCost(store, ids);
      return `  [${c.id.slice(0, 8)}] ${(c.title || c.content).slice(0, 50)}: ${cost.nodes} nodes ≈ ${cost.chars} chars`;
    }));
  const budgetNote = [
    `THE BUDGET (a hard limit, enforced mechanically): the agent's map block gives the lit background at most ${cap} characters. Every lit node costs its one-line minimal (about ${now.nodes ? Math.round(now.chars / now.nodes) : 90} characters); lighting a node lights its WHOLE subtree.`,
    `Currently lit: ${now.nodes} nodes ≈ ${now.chars} characters (${now.chars > cap ? `OVER the limit by ${now.chars - cap}` : `${cap - now.chars} to spare`}).`,
    `What each chapter costs if lit (with its subtree):
${chapterCosts.join('\n')}`,
    `Your proposal must leave the lit set at or under ${cap} characters. Over the limit, nothing gets depth and most names fold out of sight — a lit node the agent cannot see is not lit. Prefer lighting the specific topics the focus needs over whole eras or chapters.`,
  ].join('\n');

  try {
    const parsed = await call({
      task: 'autolit', system: SYSTEM + systemCard(store, projectId, 'the LIGHTING agent'), maxTokens: 1000, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `MAP (ids in [brackets]; ▶ marks the focus):\n${tree}`,
          `CURRENTLY LIT: ${litNames.length ? litNames.join(', ') : '(nothing)'}`,
          budgetNote,
          // M80: iterative — the user talks back to the proposal (M69 pattern).
          ...(priorSummary ? [`YOUR PREVIOUS PROPOSAL (the user saw it and wants something different): ${priorSummary}`] : []),
          ...(feedback ? [`THE USER'S DIRECTION — this OVERRIDES your own instincts; build the lighting the user is asking for: ${feedback}`] : []),
          'Choose the lighting changes.',
        ].join('\n\n') + statusConsult(store, projectId, focusId ?? undefined, 'lighting'),
    });
    // Resolve 8-char bracket prefixes back to full container ids; drop unknowns.
    const resolve = (ids: string[]) => ids
      .map((raw) => String(raw).replace(/[\[\]]/g, ''))
      .map((p) => map.nodes.find((n) => n.id === p || n.id.startsWith(p))?.id)
      .filter((x): x is string => Boolean(x));
    let lit = resolve(parsed.lit ?? []);
    let dim = resolve(parsed.dim ?? []);
    // Mechanical guard: the model sometimes puts the SAME node in both lists
    // (bench, with feedback). A contradiction is a no-op, not a coin flip.
    const both = new Set(lit.filter((id) => dim.includes(id)));
    if (both.size) {
      store.audit('guard_lit_conflict', { ids: [...both].map((id) => id.slice(0, 8)) });
      lit = lit.filter((id) => !both.has(id));
      dim = dim.filter((id) => !both.has(id));
    }
    // The guard (M199): a proposal that does not fit the block is refused —
    // once with the numbers handed back for a second try, then reported.
    const after = litSetCost(store, resultingLit(store, currentLit, lit, dim, new Set(focusId ? [focusId] : [])));
    if (after.chars > cap) {
      if (!feedback?.startsWith('[budget]')) {
        return proposeAutolit(store, projectId, focusId, currentLit,
          `[budget] Your previous proposal would leave ${after.nodes} nodes ≈ ${after.chars} characters lit, over the ${cap}-character limit by ${after.chars - cap}. Choose again: light specific topics, not chapters; dim what does not fit.`,
          parsed.summary ?? '');
      }
      store.audit('guard_lit_budget', { nodes: after.nodes, chars: after.chars, cap });
      return { summary: `OVER BUDGET — ${after.nodes} nodes ≈ ${after.chars} chars lit, limit ${cap}. Not applied. ${parsed.summary ?? ''}`, lit, dim, overBudget: { nodes: after.nodes, chars: after.chars, cap } };
    }
    return { summary: parsed.summary ?? '', lit, dim, cost: after };
  } catch (err) {
    console.error('[autolit] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

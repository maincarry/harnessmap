import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree } from '../map/render.js';

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

export interface AutolitResult { summary: string; lit: string[]; dim: string[] }

export async function proposeAutolit(
  store: Store, projectId: string, focusId: string | null, currentLit: string[],
  feedback?: string, priorSummary?: string,
): Promise<AutolitResult | { error: string }> {
  const map = loadMap(store, projectId);
  const tree = renderTree(map, { ids: true, focusId: focusId ?? undefined });
  const litNames = currentLit.map((id) => store.getNode(id)?.content).filter(Boolean);

  try {
    const parsed = await call({
      task: 'autolit', system: SYSTEM + systemCard(store, projectId, 'the LIGHTING agent'), maxTokens: 1000, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `MAP (ids in [brackets]; ▶ marks the focus):\n${tree}`,
          `CURRENTLY LIT: ${litNames.length ? litNames.join(', ') : '(nothing)'}`,
          // M80: iterative — the user talks back to the proposal (M69 pattern).
          ...(priorSummary ? [`YOUR PREVIOUS PROPOSAL (the user saw it and wants something different): ${priorSummary}`] : []),
          ...(feedback ? [`THE USER'S DIRECTION — this OVERRIDES your own instincts; build the lighting the user is asking for: ${feedback}`] : []),
          'Choose the lighting changes.',
        ].join('\n\n'),
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
    return { summary: parsed.summary ?? '', lit, dim };
  } catch (err) {
    console.error('[autolit] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

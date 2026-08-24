import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree } from '../map/render.js';

// On-demand map check (v0.3.5, Jacob): "can you add a button where I can
// demand suggestion? or none-suggestion ('well done your map is clean!')".
// Unlike the per-round check (which only looks at containers just filed
// into), this reviews the WHOLE map and files red-dot suggestions.

const SYSTEM = `You review the structure of a goal map on demand. The map is made of NODES — one kind of thing; any node can hold children. Look at EVERY node that has children: does any subtree hold two or more unrelated topics? Contain duplicate or near-duplicate nodes? Have content that no longer matches what's inside? Hold nodes that plainly belong elsewhere (e.g. evidence sitting far from the claim it supports)?

Be conservative — flag only clear cases where a cleanup would obviously help. A map with a few loose nodes is fine; a subtree mixing two projects is not. An empty or tiny map is clean by definition.

KNOW THE SYSTEM'S OWN FUNCTIONS: this map has focus (where the conversation aims) and light/dim (what stays in the working background). Currently-irrelevant is THEIR job, not yours. Never flag a node for being inactive, off-topic right now, or away from the user's current focus — an untouched-but-valid node is not a structural problem. Flag only structure: mixing, duplication, misplacement, outgrown or mismatched content.

TOP-LEVEL PILE: when the problem is the top level ITSELF — several unrelated sibling threads that want domain containers — no single node is the target. Flag the special id [__top__] for that (it routes to the tidy-top-level flow, the only place top-level grouping can be executed). Never flag an individual top-level node for a problem that is really about its siblings.

Return:
- summary: one sentence. If the map is clean, say so plainly (this is shown to the user as good news). If not, one sentence on the overall state.
- suggestions: one entry per node whose subtree needs restructuring — nodeId (an id exactly as in [brackets]) + note (one sentence: what you'd change and why). Empty array if the map is clean.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'note'],
        properties: { nodeId: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
} as const;

export interface MapCheckResult { summary: string; suggestions: { nodeId: string; note: string }[] }

export async function checkMap(store: Store, projectId: string, focusId: string | null): Promise<MapCheckResult | { error: string }> {
  const map = loadMap(store, projectId);
  const tree = renderTree(map, { ids: true, focusId: focusId ?? undefined });

  try {
    const parsed = await call({
      task: 'mapcheck', system: SYSTEM + systemCard(store, projectId, 'the map REVIEWER (the tidy agent in review mode)'), maxTokens: 1500, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: `MAP (ids in [brackets]):\n${tree}\n\nReview the structure.`,
    });
    const suggestions = (parsed.suggestions ?? [])
      .map((s: any) => {
        const raw = String(s.nodeId ?? '').replace(/[\[\]]/g, '');
        if (raw === '__top__') return { nodeId: '__top__', note: String(s.note ?? '') };
        const n = map.nodes.find((x) => x.id === raw || x.id.startsWith(raw));
        return n ? { nodeId: n.id, note: String(s.note ?? '') } : null;
      })
      .filter(Boolean) as { nodeId: string; note: string }[];
    return { summary: parsed.summary ?? '', suggestions };
  } catch (err) {
    console.error('[mapcheck] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

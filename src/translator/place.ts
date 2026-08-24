import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree, descendantNodes } from '../map/render.js';

// M53 (Jacob): "place" is agent-assisted — the map agent searches the whole
// map and fetches candidate homes for a to-sort item; the user picks.
// User-invoked tool: lighting-unaffected by ruling.

const SYSTEM = `You find homes for an unfiled item on a goal map. Given the whole map (ids in [brackets]) and the ITEM, return up to 3 candidate parent nodes where it would genuinely belong, best first, each with a short plain reason ("fits under X because ..."). Candidates must be existing nodes (never "to sort", never the item itself). If nothing fits anywhere, return an empty list — promotion to a new top-level topic is the user's other button.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: { candidates: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['nodeId', 'reason'],
    properties: { nodeId: { type: 'string' }, reason: { type: 'string' } } } } },
} as const;

export async function suggestHomes(store: Store, projectId: string, nodeId: string): Promise<{ candidates: { nodeId: string; name: string; reason: string }[] } | { error: string }> {
  const n = store.getNode(nodeId);
  if (!n) return { error: 'unknown node' };
  const map = loadMap(store, projectId);
  const tree = renderTree(map, { ids: true });
  try {
    const parsed = await call({
      task: 'place', system: SYSTEM + systemCard(store, projectId, 'the PLACEMENT agent'), maxTokens: 500, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: `MAP:\n${tree}\n\nITEM to place: ${n.type ? n.type + ': ' : ''}${n.content}`,
    });
    const own = new Set([nodeId, ...descendantNodes(store, nodeId)]);
    const toSortRoot = map.nodes.find((x) => x.parentId === null && ((x.title ?? '') === 'to sort' || x.content.startsWith('to sort')));
    const toSortSet = toSortRoot ? new Set([toSortRoot.id, ...descendantNodes(store, toSortRoot.id)]) : new Set<string>();
    const candidates = (parsed.candidates ?? [])
      .map((c: any) => {
        const raw = String(c.nodeId ?? '').replace(/[\[\]]/g, '');
        const full = map.nodes.find((x) => (x.id === raw || x.id.startsWith(raw)) && x.status !== 'removed');
        if (!full || own.has(full.id) || toSortSet.has(full.id)) return null;
        return { nodeId: full.id, name: full.title || full.content.slice(0, 50), reason: String(c.reason ?? '') };
      })
      .filter(Boolean).slice(0, 3);
    return { candidates };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

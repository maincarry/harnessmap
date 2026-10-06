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

// M416 (LONG #395 long-en-d, 84 rounds): two whole threads (tic-tac-toe, 20 nodes; the panorama merge, 19 nodes) lived in
// "to sort" for the rest of the run. The placer asks the model for homes and the model, rightly, finds NOTHING on the map for
// a new topic (candidates 0); the item is retried thirty minutes later, finds nothing again, and stays — while the filer keeps
// growing the thread under it, and the aim (M275) can never make a to-sort node the focus, so the focus stayed on the first
// thread and the brain's "right now" answered with it. M311 already says a stray with no kin on the map belongs at the top
// level — at create time. This is the same rule applied by the placer: nothing fits twice, or nothing fits once and a thread
// is already growing under the item, and the item becomes its own top-level topic.
export function shouldPromoteStranded(misses: number, liveChildren: number): boolean {
  return misses >= 2 || (misses >= 1 && liveChildren >= 2);
}

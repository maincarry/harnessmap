import { Store } from '../store/db.js';
import { call } from '../inference.js';
import type { MapNode } from '../types.js';

// Relational description (M38, Jacob): how a node relates to its neighborhood
// — up to the grandparent (2 levels), down to grandchildren (2 levels).
// LAZY + CACHED: nothing is computed on map changes. On read, we hash the
// neighborhood (ids + updatedAt); if it matches the cached hash, serve the
// cached text; otherwise regenerate. Cost: one cheap call per actual read of
// a changed node, regardless of map size or depth.

const SYSTEM = `You explain how one node of a goal map fits its surroundings, for the user. You get the NODE, its parent and grandparent (if any), its children, and its grandchildren (if any).

Write 1-3 TIGHT sentences. Informative first, compact second — but never restate what the node's own text already says, never pad ("this node serves as…", "plays a role in…" = filler). Say only what the STRUCTURE adds:
- UPWARD: what it contributes to its parent (and through it the grandparent) — why it sits there.
- DOWNWARD: what its children collectively do for it (group them; grandchildren at most as texture).
- No parent or no children → skip that direction silently.
Plain everyday language, the map's own vocabulary, no headers, no bullets.`;

const line = (n: MapNode) => `${n.type ? `${n.type}: ` : ''}${n.content} (${n.status})`;

function neighborhood(store: Store, n: MapNode) {
  const parent = n.parentId ? store.getNode(n.parentId) : undefined;
  const grand = parent?.parentId ? store.getNode(parent.parentId) : undefined;
  const children = store.childrenOf(n.id).filter((k) => k.status !== 'removed');
  const grandkids = children.flatMap((k) => store.childrenOf(k.id).filter((g) => g.status !== 'removed'));
  return { parent, grand, children, grandkids };
}

export function neighborhoodHash(store: Store, n: MapNode): string {
  const { parent, grand, children, grandkids } = neighborhood(store, n);
  return [n, parent, grand, ...children, ...grandkids]
    .filter((x): x is MapNode => Boolean(x))
    .map((x) => `${x.id.slice(0, 8)}@${x.updatedAt}`)
    .join('|');
}

// Suggested minimal title for one node (M40): shown in the detail panel with
// an adopt button — the user chooses.
export async function suggestTitle(store: Store, nodeId: string): Promise<{ title: string } | { error: string }> {
  const n = store.getNode(nodeId);
  if (!n) return { error: 'unknown node' };
  const parent = n.parentId ? store.getNode(n.parentId) : undefined;
  try {
    const text = await call({
      task: 'title', maxTokens: 60, timeoutMs: 60_000,
      system: 'You write ONE minimal display title for a goal-map node: 2-4 plain everyday words (absolute maximum 6) — how the user would casually refer to it out loud. DROP nuance rather than cram it in; a title names the thing, it does not summarize the statement. Reply with the title only, no quotes, no punctuation around it.',
      audit: (k, d) => store.audit(k, d),
      user: `${parent ? `(sits under: ${parent.title || parent.content})\n` : ''}${n.type ? `${n.type}: ` : ''}${n.content}`,
    });
    const title = String(text ?? '').trim().replace(/^["']|["']$/g, '');
    return title ? { title } : { error: 'no title produced' };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

export async function describeRelations(store: Store, nodeId: string): Promise<{ text: string; cached: boolean } | { error: string }> {
  const n = store.getNode(nodeId);
  if (!n) return { error: 'unknown node' };
  const hash = neighborhoodHash(store, n);
  const db = (store as any).db;
  const row = db.prepare('SELECT text, nb_hash FROM relations WHERE node_id = ?').get(nodeId) as any;
  if (row && row.nb_hash === hash) return { text: row.text, cached: true };

  const { parent, grand, children, grandkids } = neighborhood(store, n);
  try {
    const text0 = await call({
      task: 'relations', system: SYSTEM, maxTokens: 250, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `NODE: ${line(n)}`,
          grand ? `GRANDPARENT: ${line(grand)}` : '',
          parent ? `PARENT: ${line(parent)}` : '(top-level node — no parent)',
          children.length ? `CHILDREN:\n${children.map((k) => `  - ${line(k)}`).join('\n')}` : '(no children)',
          grandkids.length ? `GRANDCHILDREN:\n${grandkids.map((g) => `  - ${line(g)}`).join('\n')}` : '',
          'Describe how this node fits.',
        ].filter(Boolean).join('\n\n'),
    });
    const text = String(text0 ?? '').trim();
    db.prepare('INSERT OR REPLACE INTO relations (node_id, text, nb_hash) VALUES (?, ?, ?)').run(nodeId, text, hash);
    return { text, cached: false };
  } catch (err) {
    console.error('[relations] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

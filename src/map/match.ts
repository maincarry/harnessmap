// Word matching between a text (a question, a round) and the map's nodes.
// M203 (2026-09-07): the pull-up matcher used title + first 300 chars and
// substring tests ("port" hit "important"); on the recall test the fact node
// reached the top three for two of eight lost questions. Matching whole
// words against the node's stored memory as well, title hits counted double
// and minimal ×1.5, puts six of eight in the top three — no model call,
// ~12 ms per turn on a 600-node map. Shared by the pull-up offer (server)
// and the filer's existing-node candidates (translator).
import type { Store } from '../store/db.js';

export const MATCH_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'should', 'would', 'about', 'what', 'when', 'how', 'our', 'are', 'was', 'were', 'have', 'has', 'does', 'user', 'users', 'map', 'node', 'nodes', 'topic', 'topics', 'agent', 'into', 'than', 'then', 'them', 'they', 'there', 'their', 'your', 'will', 'can', 'may', 'not', 'but', 'its', 'also', 'like', 'just', 'some', 'more', 'each', 'every', 'which', 'where', 'here', 'been', 'being', 'only', 'very', 'much', 'many', 'such', 'over', 'under', 'again', 'still', 'even', 'ever']);

export function matchTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !MATCH_STOP.has(w)))];
}

const wordSet = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));

export interface NodeMatch { id: string; score: number; hits: number }

// Field weights: a word in the title outranks the same word in the memory.
const FIELD_WEIGHT: Record<string, number> = { title: 2, content: 1, minimal: 1.5, medium: 1 };

export interface MatchItem { id: string; title?: string | null; content?: string | null; minimal?: string | null; medium?: string | null }

// Match against any list of items (an import's subtree-so-far, a proposal)
// — the store form below builds its items from the map.
export function matchItems(items: MatchItem[], text: string, opts: { exclude?: Set<string>; limit?: number; minHits?: number } = {}): NodeMatch[] {
  const toks = matchTokens(text);
  if (toks.length < 2) return [];
  const fields = new Map<string, Record<string, Set<string>>>();
  for (const n of items) {
    fields.set(n.id, { title: wordSet(n.title ?? ''), content: wordSet(String(n.content ?? '').slice(0, 300)), minimal: wordSet(n.minimal ?? ''), medium: wordSet(n.medium ?? '') });
  }
  const df = new Map<string, number>();
  for (const t of toks) { let d = 0; for (const f of fields.values()) if (f.title.has(t) || f.content.has(t) || f.minimal.has(t) || f.medium.has(t)) d++; df.set(t, d); }
  const weight = (t: string) => { const d = df.get(t) ?? 0; return d ? Math.log(1 + items.length / d) : 0; };
  const out: NodeMatch[] = [];
  for (const n of items) {
    if (opts.exclude?.has(n.id)) continue;
    const f = fields.get(n.id)!;
    let score = 0, hits = 0;
    for (const t of toks) {
      let fw = 0;
      for (const k of Object.keys(FIELD_WEIGHT)) if (f[k].has(t) && FIELD_WEIGHT[k] > fw) fw = FIELD_WEIGHT[k];
      if (fw) { score += weight(t) * fw; hits++; }
    }
    if (hits >= (opts.minHits ?? 2)) out.push({ id: n.id, score, hits });
  }
  out.sort((a, b) => b.score - a.score);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export function matchNodes(store: Store, projectId: string, text: string, opts: { exclude?: Set<string>; limit?: number; minHits?: number } = {}): NodeMatch[] {
  const live = store.getNodes(projectId).filter((n) => n.status !== 'removed');
  const db = (store as any).db;
  const mem = new Map<string, { minimal: string; medium: string }>();
  for (const r of db.prepare('SELECT node_id, minimal, medium FROM node_memory').all() as any[]) mem.set(r.node_id, { minimal: r.minimal ?? '', medium: r.medium ?? '' });
  return matchItems(live.map((n) => ({ id: n.id, title: n.title, content: n.content, minimal: mem.get(n.id)?.minimal, medium: mem.get(n.id)?.medium })), text, opts);
}

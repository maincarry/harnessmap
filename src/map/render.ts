import type { MapNode } from '../types.js';
import { Store } from '../store/db.js';

// Render the map as an indented text tree — used both by the translator prompt
// (map-conditioned summarization needs the map's vocabulary) and the seed
// composer. v0.4: one kind of thing — every line is a node.

const GLYPH: Record<string, string> = {
  accepted: '✓', decided: '✓', done: '✓', answered: '✓', chosen: '✓', cited: '✓',
  open: '○', live: '○', proposed: '○', todo: '☐', doing: '☐',
  floated: '⚠', noted: '⚠', provisional: '⚠',
  rejected: '✗', dropped: '✗', retracted: '✗', reversed: '✗', mooted: '✗', lifted: '✗',
  parked: '⏸', hard: '‼', active: '○', relaxed: '○', exploratory: '∿',
};

export interface MapView {
  nodes: MapNode[];
}

export function loadMap(store: Store, projectId: string): MapView {
  return { nodes: store.getNodes(projectId) };
}

// One node, one line: "[glyph] [type: ]content (status)".
export function nodeLine(n: MapNode, opts: { ids?: boolean } = {}): string {
  const g = GLYPH[n.status] ?? (n.type ? '·' : '');
  const idTag = opts.ids ? ` [${n.id.slice(0, 8)}]` : '';
  const typeTag = n.type ? `${n.type}: ` : '';
  const statusTag = n.type || !['live', 'provisional'].includes(n.status) ? ` (${n.status})` : '';
  return `${g ? `${g} ` : ''}${typeTag}${n.content}${idTag}${statusTag}`.trim();
}

export function renderTree(map: MapView, opts: { focusId?: string; ids?: boolean } = {}): string {
  const children = new Map<string | null, MapNode[]>();
  for (const n of map.nodes) {
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId)!.push(n);
  }
  const lines: string[] = [];
  // Every walk below carries a visited set: a parent cycle in the data (one
  // shipped 2026-09-04 and took the server down on 2026-09-06) must cost a
  // skipped node, never the process.
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const n of children.get(parentId) ?? []) {
      if (n.status === 'removed' || seen.has(n.id)) continue;
      seen.add(n.id);
      const marker = n.id === opts.focusId ? '▶ ' : '';
      lines.push(`${'  '.repeat(depth)}${marker}${nodeLine(n, opts)}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.length > 0 ? lines.join('\n') : '(empty map)';
}

// All descendant node ids (not including itself).
export function descendantNodes(store: Store, nodeId: string): string[] {
  const n = store.getNode(nodeId);
  if (!n) return [];
  const all = store.getNodes(n.projectId);
  const byParent = new Map<string | null, string[]>();
  for (const x of all) {
    if (!byParent.has(x.parentId)) byParent.set(x.parentId, []);
    byParent.get(x.parentId)!.push(x.id);
  }
  const out: string[] = [];
  const seen = new Set<string>([nodeId]);
  const walk = (id: string) => {
    for (const kid of byParent.get(id) ?? []) { if (seen.has(kid)) continue; seen.add(kid); out.push(kid); walk(kid); }
  };
  walk(nodeId);
  return out;
}

// A node + all its descendants in full detail (the focus view).
export function renderSubtreeFull(store: Store, nodeId: string, depth = 0, seen: Set<string> = new Set()): string {
  const n = store.getNode(nodeId);
  if (!n || n.status === 'removed' || seen.has(nodeId)) return '';
  seen.add(nodeId);
  const pad = '  '.repeat(depth);
  const lines = [`${pad}${nodeLine(n)}`];
  for (const kid of store.childrenOf(nodeId)) {
    const sub = renderSubtreeFull(store, kid.id, depth + 1, seen);
    if (sub) lines.push(sub);
  }
  return lines.join('\n');
}

// One-paragraph brief of a node: its line + direct-children one-liners (lit view).
export function renderNodeBrief(store: Store, nodeId: string): string {
  const n = store.getNode(nodeId);
  if (!n) return '';
  const kids = store.childrenOf(nodeId)
    .filter((k) => !['removed', 'dropped', 'rejected', 'retracted'].includes(k.status));
  const parts = kids.slice(0, 12).map((k) => nodeLine(k));
  return `${n.content} — ${parts.join(' · ') || 'nothing under it yet'}`;
}

// One-liner for a folded node: content + live-descendant counts.
export function renderNodeOneLiner(store: Store, nodeId: string): string {
  const n = store.getNode(nodeId);
  if (!n) return '';
  let total = 0;
  let open = 0;
  for (const id of descendantNodes(store, nodeId)) {
    const d = store.getNode(id)!;
    if (d.status === 'removed') continue;
    total += 1;
    if (['open', 'todo', 'doing', 'live'].includes(d.status)) open += 1;
  }
  // M57: folded = NAME only (title, or truncated content) — the full
  // description leaked dimmed knowledge into ELSEWHERE (found in the spike).
  const name = n.title || (n.content.length > 60 ? `${n.content.slice(0, 60)}…` : n.content);
  return `${name} (folded — ${total} node${total === 1 ? '' : 's'} inside${open ? `, ${open} open` : ''})`;
}

// M47 final (Jacob's D1+D3): the map agent's sight OBEYS THE LIGHT, same as
// the chat agent's. In-scope nodes render in full; at the scope boundary a
// dim node renders as ONE line (name + count) and its subtree is invisible.
// D3: the in-scope rendering is budgeted — beyond the cap, stalest in-scope
// top-level branches degrade to one-liners with an explicit marker.
export function renderScopedTree(map: MapView, scope: Set<string>, opts: { focusId?: string; budgetChars?: number } = {}): string {
  const children = new Map<string | null, MapNode[]>();
  for (const n of map.nodes) {
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId)!.push(n);
  }
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const subtreeCount = (id: string, seen: Set<string> = new Set([id])): number => {
    let c = 0;
    for (const k of children.get(id) ?? []) { if (k.status !== 'removed' && !seen.has(k.id)) { seen.add(k.id); c += 1 + subtreeCount(k.id, seen); } }
    return c;
  };
  const subtreeTouch = (id: string, seen: Set<string> = new Set([id])): string => {
    let max = byId.get(id)?.updatedAt ?? '';
    for (const k of children.get(id) ?? []) { if (seen.has(k.id)) continue; seen.add(k.id); const t = subtreeTouch(k.id, seen); if (t > max) max = t; }
    return max;
  };
  const dimLine = (n: MapNode, depth: number) => {
    const name = n.title || (n.content.length > 60 ? `${n.content.slice(0, 60)}…` : n.content);
    const c = subtreeCount(n.id);
    return `${'  '.repeat(depth)}(dim) ${name}${c ? ` — ${c} node(s) inside, not shown` : ''} [${n.id.slice(0, 8)}]`;
  };
  const seenW = new Set<string>();
  const walk = (parentId: string | null, depth: number, out: string[]) => {
    for (const n of children.get(parentId) ?? []) {
      if (n.status === 'removed' || seenW.has(n.id)) continue;
      seenW.add(n.id);
      const marker = n.id === opts.focusId ? '▶ ' : '';
      if (scope.has(n.id)) {
        out.push(`${'  '.repeat(depth)}${marker}${nodeLine(n, { ids: true })}`);
        walk(n.id, depth + 1, out);
      } else {
        out.push(`${marker ? '  '.repeat(depth) + marker + dimLine(n, 0) : dimLine(n, depth)}`);
        // dim boundary: subtree invisible
      }
    }
  };

  // Render each top-level branch separately so the budget can degrade
  // whole branches.
  const tops = (children.get(null) ?? []).filter((n) => n.status !== 'removed');
  const renderTop = (t: MapNode): string[] => {
    const out: string[] = [];
    const marker = t.id === opts.focusId ? '▶ ' : '';
    if (scope.has(t.id)) {
      out.push(`${marker}${nodeLine(t, { ids: true })}`);
      walk(t.id, 1, out);
    } else {
      out.push(`${marker}${dimLine(t, 0)}`);
    }
    return out;
  };
  const budget = opts.budgetChars ?? Number(process.env.HARNESSMAP_MAP_BUDGET ?? 16_000);
  const rendered = tops.map((t) => ({ t, lines: renderTop(t), touch: subtreeTouch(t.id) }));
  let total = rendered.reduce((a, r) => a + r.lines.join('\n').length, 0);
  if (total > budget) {
    // degrade stalest in-scope branches (never the focus branch) to one-liners
    const focusTop = opts.focusId ? (map.nodes.find((n) => n.id === opts.focusId) ?? null) : null;
    const focusTopId = (() => {
      let cur = focusTop;
      const hops = new Set<string>();
      while (cur && cur.parentId && !hops.has(cur.id)) { hops.add(cur.id); cur = byId.get(cur.parentId) ?? null; }
      return cur?.id;
    })();
    for (const r of [...rendered].sort((a, b) => (a.touch < b.touch ? -1 : 1))) {
      if (total <= budget) break;
      if (r.t.id === focusTopId || !scope.has(r.t.id) || r.lines.length <= 1) continue;
      total -= r.lines.join('\n').length;
      r.lines = [`${dimLine(r.t, 0)} (in scope but folded for space — stale)`];
      total += r.lines[0].length;
    }
  }
  const lines = rendered.flatMap((r) => r.lines).filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : '(empty map)';
}

// Ancestor chain of a node, root first (the frame).
export function ancestors(store: Store, nodeId: string): MapNode[] {
  const chain: MapNode[] = [];
  let cur = store.getNode(nodeId);
  const seen = new Set<string>([nodeId]);
  while (cur && cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent = store.getNode(cur.parentId);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}


// M194 (Jacob): the advisory agents — auto-light, auto-focus, the reviewer —
// stop receiving the flat every-node dump (whose size grew with the map and
// was heading off a context cliff: ~240k chars at 2,161 nodes) and receive
// the SAME tiered serving as everything else: every topic at its minimal as
// the floor (folding at scale), promoted to medium and long by closeness to
// the focus and recency, under a real budget. One context model everywhere.
// Ids ride in [brackets] because advisors must reference nodes.
export function renderTieredTreeForSubtree(store: any, projectId: string, rootId: string, budget = 9_000): string {
  return renderTieredTree(store, projectId, null, budget, rootId);
}

export function renderTieredTree(store: any, projectId: string, focusId: string | null, budget = 40_000, rootId: string | null = null): string {
  const nodes = (store.getNodes(projectId) as MapNode[]).filter((n) => n.status !== 'removed');
  if (!nodes.length) return '(empty map)';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) { const k = kids.get(n.parentId) ?? []; k.push(n); kids.set(n.parentId, k); }
  const db = store.db ?? (store as any).db;
  const minBy = new Map<string, string>((db.prepare("SELECT node_id, minimal FROM node_memory WHERE minimal IS NOT NULL AND minimal != ''").all() as any[]).map((r: any) => [r.node_id, r.minimal]));
  const medBy = new Map<string, string>((db.prepare("SELECT node_id, medium FROM node_memory WHERE medium != ''").all() as any[]).map((r: any) => [r.node_id, r.medium]));
  const detBy = new Map<string, string[]>();
  for (const r of db.prepare("SELECT node_id, text FROM memory_details WHERE status='current' ORDER BY id").all() as any[]) {
    const a = detBy.get(r.node_id); if (a) a.push(r.text); else detBy.set(r.node_id, [r.text]);
  }
  const chapterOf = (id: string): string => {
    let cur = id; let p = byId.get(id)?.parentId;
    const hops = new Set<string>([id]);
    while (p && byId.get(p) && byId.get(p)!.parentId && !hops.has(p)) { hops.add(p); cur = p; p = byId.get(p)!.parentId; }
    return p ? cur : id;
  };
  const focusChapter = focusId ? chapterOf(focusId) : null;
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const warmth = (id: string): number =>
    (focusChapter && chapterOf(id) === focusChapter ? 2 : 0) + ((byId.get(id)?.updatedAt ?? '') > dayAgo ? 1 : 0);
  interface E { n: MapNode; depth: number; line: string }
  const entries: E[] = [];
  const seenT = new Set<string>();
  const walk = (pid: string | null, depth: number) => {
    for (const n of kids.get(pid) ?? []) {
      if (seenT.has(n.id)) continue;
      seenT.add(n.id);
      const short = (n.title || (n.content.length > 70 ? n.content.slice(0, 69) + '…' : n.content));
      const mark = n.id === focusId ? '▶ ' : '';
      const min = minBy.get(n.id);
      entries.push({ n, depth, line: `${'  '.repeat(depth)}- [${n.id.slice(0, 8)}] ${mark}${short}${min ? ` — ${min}` : ''}` });
      walk(n.id, depth + 1);
    }
  };
  walk(rootId ?? null, 0);
  if (rootId) { const rn = byId.get(rootId); if (rn) { const min0 = minBy.get(rootId); entries.unshift({ n: rn, depth: 0, line: `- [${rootId.slice(0, 8)}] ${(rn.title || rn.content.slice(0, 69))}${min0 ? ` — ${min0}` : ''}` }); } }
  // Floor with fold: minimal lines for depth ≤ cap; deeper folds into counts.
  let cap = Math.max(...entries.map((e) => e.depth));
  const sizeAt = (c: number) => entries.filter((e) => e.depth <= c).reduce((s, e) => s + e.line.length + 1, 0);
  while (cap > 1 && sizeAt(cap) > budget * 0.6) cap--;
  const below = (id: string): number => { let s = 0; const seenB = new Set<string>([id]); const st = [...(kids.get(id) ?? [])]; while (st.length) { const x = st.pop()!; if (seenB.has(x.id)) continue; seenB.add(x.id); s++; st.push(...(kids.get(x.id) ?? [])); } return s; };
  const visible = entries.filter((e) => e.depth <= cap);
  let used = 0;
  const parts = new Map<string, string[]>();
  for (const e of visible) {
    const roll = e.depth === cap && (kids.get(e.n.id)?.length ?? 0) > 0 ? ` (+${below(e.n.id)} inside)` : '';
    parts.set(e.n.id, [e.line + roll]);
    used += e.line.length + roll.length + 1;
  }
  // Promote by warmth: medium, then long (statement + specifics).
  const ranked = [...visible].sort((a, b) => warmth(b.n.id) - warmth(a.n.id));
  for (const e of ranked) {
    const med = medBy.get(e.n.id); if (!med) continue;
    const add2 = `${'  '.repeat(e.depth)}    (${med.slice(0, 620)})`;
    if (used + add2.length > budget) continue;
    parts.get(e.n.id)!.push(add2); used += add2.length + 1;
  }
  for (const e of ranked) {
    const pad = '  '.repeat(e.depth);
    const lines2: string[] = [`${pad}    • ${e.n.content}${e.n.type ? ` [${e.n.type}, ${e.n.status}]` : ''}`];
    const det = (detBy.get(e.n.id) ?? []).slice(0, 4);
    if (det.length) lines2.push(`${pad}    remembered: ${det.join(' · ')}`.slice(0, 700));
    const add3 = lines2.join('\n');
    if (used + add3.length > budget) continue;
    parts.get(e.n.id)!.push(add3); used += add3.length + 1;
  }
  return visible.map((e) => parts.get(e.n.id)!.join('\n')).join('\n');
}
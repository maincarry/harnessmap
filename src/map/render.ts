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
  const walk = (parentId: string | null, depth: number) => {
    for (const n of children.get(parentId) ?? []) {
      if (n.status === 'removed') continue;
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
  const walk = (id: string) => {
    for (const kid of byParent.get(id) ?? []) { out.push(kid); walk(kid); }
  };
  walk(nodeId);
  return out;
}

// A node + all its descendants in full detail (the focus view).
export function renderSubtreeFull(store: Store, nodeId: string, depth = 0): string {
  const n = store.getNode(nodeId);
  if (!n || n.status === 'removed') return '';
  const pad = '  '.repeat(depth);
  const lines = [`${pad}${nodeLine(n)}`];
  for (const kid of store.childrenOf(nodeId)) {
    const sub = renderSubtreeFull(store, kid.id, depth + 1);
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
  const subtreeCount = (id: string): number => {
    let c = 0;
    for (const k of children.get(id) ?? []) { if (k.status !== 'removed') c += 1 + subtreeCount(k.id); }
    return c;
  };
  const subtreeTouch = (id: string): string => {
    let max = byId.get(id)?.updatedAt ?? '';
    for (const k of children.get(id) ?? []) { const t = subtreeTouch(k.id); if (t > max) max = t; }
    return max;
  };
  const dimLine = (n: MapNode, depth: number) => {
    const name = n.title || (n.content.length > 60 ? `${n.content.slice(0, 60)}…` : n.content);
    const c = subtreeCount(n.id);
    return `${'  '.repeat(depth)}(dim) ${name}${c ? ` — ${c} node(s) inside, not shown` : ''} [${n.id.slice(0, 8)}]`;
  };
  const walk = (parentId: string | null, depth: number, out: string[]) => {
    for (const n of children.get(parentId) ?? []) {
      if (n.status === 'removed') continue;
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
      while (cur && cur.parentId) cur = byId.get(cur.parentId) ?? null;
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
  while (cur && cur.parentId) {
    const parent = store.getNode(cur.parentId);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

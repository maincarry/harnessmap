// M227 (Jacob, 2026-09-08 — docs/BRAIN-DESIGN.md): GOVERNORS. The per-area
// assessment gets a memory (its previous understanding and a dated log feed
// the next refresh) and survives a fold (the successor reads its estate).
// The king's sitting reads the dispatches and writes advice per area; agents
// get the king's advice, never a governor's text. One row per area, ever;
// retired rows keep their text. Nothing here calls a model.
import { Store } from '../store/db.js';

export interface Mind { projectId: string; nodeId: string; status: 'active' | 'retired'; understanding: string; log: string; disagreements: string[]; predecessors: string[]; createdAt: string; updatedAt: string; retiredAt: string | null }

function ensure(store: Store): any {
  const db = (store as any).db;
  db.exec(`CREATE TABLE IF NOT EXISTS area_minds (
    project_id TEXT NOT NULL, node_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    understanding TEXT NOT NULL DEFAULT '', log TEXT NOT NULL DEFAULT '', disagreements TEXT NOT NULL DEFAULT '[]', predecessors TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), retired_at TEXT,
    PRIMARY KEY (project_id, node_id))`);
  return db;
}
const row2 = (r: any): Mind => ({ projectId: r.project_id, nodeId: r.node_id, status: r.status, understanding: r.understanding ?? '', log: r.log ?? '', disagreements: JSON.parse(r.disagreements || '[]'), predecessors: JSON.parse(r.predecessors || '[]'), createdAt: r.created_at, updatedAt: r.updated_at, retiredAt: r.retired_at ?? null });

export function getMind(store: Store, projectId: string, nodeId: string): Mind | null {
  const r = ensure(store).prepare('SELECT * FROM area_minds WHERE project_id = ? AND node_id = ?').get(projectId, nodeId);
  return r ? row2(r) : null;
}
export function listMinds(store: Store, projectId: string, status?: 'active' | 'retired'): Mind[] {
  const db = ensure(store);
  const rows = status ? db.prepare('SELECT * FROM area_minds WHERE project_id = ? AND status = ? ORDER BY updated_at DESC').all(projectId, status) : db.prepare('SELECT * FROM area_minds WHERE project_id = ? ORDER BY status ASC, updated_at DESC').all(projectId);
  return rows.map(row2);
}

/** A refresh: the understanding is regenerated from dated material; the log gains one dated line; disagreements replace the last set. */
export function upsertMind(store: Store, projectId: string, nodeId: string, patch: { understanding: string; logLine?: string; disagreements?: string[]; predecessors?: string[] }): Mind {
  const db = ensure(store);
  const prev = getMind(store, projectId, nodeId);
  const day = new Date().toISOString().slice(0, 10);
  const line = (patch.logLine ?? '').replace(/\s+/g, ' ').trim().replace(/^(\d{4}-\d{2}-\d{2}:?\s*)+/, ''); // the model often dates its own line — one date, ours
  const log = [prev?.log ?? '', line ? `${day}: ${line}` : ''].filter(Boolean).join('\n');
  const logTrim = log.split('\n').slice(-40).join('\n');
  const preds = [...new Set([...(prev?.predecessors ?? []), ...(patch.predecessors ?? [])])];
  db.prepare(`INSERT INTO area_minds (project_id, node_id, status, understanding, log, disagreements, predecessors, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(project_id, node_id) DO UPDATE SET status = 'active', retired_at = NULL, understanding = excluded.understanding, log = excluded.log, disagreements = excluded.disagreements, predecessors = excluded.predecessors, updated_at = datetime('now')`)
    .run(projectId, nodeId, patch.understanding.slice(0, 12000), logTrim, JSON.stringify((patch.disagreements ?? []).slice(0, 8)), JSON.stringify(preds));
  return getMind(store, projectId, nodeId)!;
}

/** Settle an estate: the governor retires; its successors carry it as a predecessor (rows created if absent, so their first refresh reads the estate). */
export function retireMind(store: Store, projectId: string, nodeId: string, successors: string[]): void {
  const db = ensure(store);
  const m = getMind(store, projectId, nodeId); if (!m || m.status === 'retired') return;
  db.prepare("UPDATE area_minds SET status = 'retired', retired_at = datetime('now'), log = log || ? WHERE project_id = ? AND node_id = ?")
    .run(`\n${new Date().toISOString().slice(0, 10)}: retired; estate passed to ${successors.length ? successors.map((s) => s.slice(0, 8)).join(', ') : 'no one (area gone)'}`, projectId, nodeId);
  for (const s of successors) {
    const cur = getMind(store, projectId, s);
    const preds = [...new Set([...(cur?.predecessors ?? []), nodeId])];
    if (cur) db.prepare('UPDATE area_minds SET predecessors = ? WHERE project_id = ? AND node_id = ?').run(JSON.stringify(preds), projectId, s);
    else db.prepare("INSERT INTO area_minds (project_id, node_id, status, understanding, log, disagreements, predecessors) VALUES (?, ?, 'active', '', ?, '[]', ?)").run(projectId, s, `${new Date().toISOString().slice(0, 10)}: born as successor of ${nodeId.slice(0, 8)}`, JSON.stringify(preds));
  }
  store.audit('governor_retired', { area: nodeId.slice(0, 8), successors: successors.map((s) => s.slice(0, 8)) });
}

/** The nearest active governor at or above a node (the area an agent is working in). */
export function nearestGovernor(store: Store, projectId: string, nodeId: string): Mind | null {
  const hops = new Set<string>();
  let p: string | null | undefined = nodeId;
  while (p && !hops.has(p)) {
    hops.add(p);
    const m = getMind(store, projectId, p); if (m && m.status === 'active') return m;
    p = store.getNode(p)?.parentId ?? null;
  }
  return null;
}

/** The estate texts a successor reads on its first refresh. */
export function estateOf(store: Store, projectId: string, nodeId: string): string {
  const m = getMind(store, projectId, nodeId); if (!m?.predecessors.length) return '';
  return m.predecessors.map((p) => { const x = getMind(store, projectId, p); const n = store.getNode(p); return x?.understanding ? `PREDECESSOR "${(n?.title || n?.content || p).slice(0, 50)}" (retired ${x.retiredAt ?? '?'}) believed:\n${x.understanding.slice(0, 3000)}` : ''; }).filter(Boolean).join('\n\n');
}

/** Migration: every existing chapter assessment becomes its governor's first understanding. */
export function seedFromAssessments(store: Store, projectId: string): number {
  const db = ensure(store);
  let n = 0;
  for (const r of db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ?').all(projectId) as any[]) {
    if (getMind(store, projectId, r.chapter_id) || !store.getNode(r.chapter_id) || store.getNode(r.chapter_id)!.status === 'removed') continue;
    db.prepare("INSERT INTO area_minds (project_id, node_id, status, understanding, log, disagreements, predecessors, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, '[]', '[]', datetime('now'), ?)")
      .run(projectId, r.chapter_id, String(r.text ?? '').slice(0, 12000), `${String(r.updated_at).slice(0, 10)}: born from the assessment of ${String(r.updated_at).slice(0, 10)}`, r.updated_at);
    n++;
  }
  if (n) store.audit('governors_seeded', { n });
  return n;
}

/** Redistricting after a structural change the user approved: a governor whose root is gone retires to the nearest governor above where its material went. Deterministic; the king may refine later. */
export function settleEstates(store: Store, projectId: string): number {
  let settled = 0;
  for (const m of listMinds(store, projectId, 'active')) {
    const n = store.getNode(m.nodeId);
    if (n && n.status !== 'removed') continue;
    // Where did its material go? The nodes that EVER lived under this root
    // (created there or moved there, per the event log) are found where they
    // are now; the governor holding most of them is the heir. (The first
    // e2e used "the most common parent among recent moves" and named a
    // bystander chapter the heir — moves elsewhere in the log outnumbered
    // the fold's own.)
    const everHere = new Set<string>();
    for (const e of (store as any).db.prepare("SELECT alteration FROM map_events WHERE project_id = ? AND (alteration LIKE '%create_node%' OR alteration LIKE '%move_node%')").all(projectId) as any[]) {
      try { const a = JSON.parse(e.alteration); if ((a.op === 'create_node' || a.op === 'move_node') && a.parentId === m.nodeId && a.id) everHere.add(a.id); } catch {}
    }
    const heirs = new Map<string, number>();
    for (const id of everHere) {
      const x = store.getNode(id); if (!x || x.status === 'removed') continue;
      const g = x.parentId ? nearestGovernor(store, projectId, x.parentId) : null;
      if (g && g.nodeId !== m.nodeId) heirs.set(g.nodeId, (heirs.get(g.nodeId) ?? 0) + 1);
      else if (x.parentId && store.getNode(x.parentId)) heirs.set(x.parentId, (heirs.get(x.parentId) ?? 0) + 1);
    }
    let successor: string | null = [...heirs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!successor && n?.parentId) { const g = nearestGovernor(store, projectId, n.parentId); successor = g?.nodeId ?? null; }
    retireMind(store, projectId, m.nodeId, successor ? [successor] : []);
    settled++;
  }
  return settled;
}

/** The king's advice per area (setting areaadvice:<pid>): { rootId: { advice, ts } }. */
export function getAreaAdvice(store: Store, projectId: string): Record<string, { advice: string; ts: string }> {
  try { return JSON.parse(store.getSetting(`areaadvice:${projectId}`) ?? '{}'); } catch { return {}; }
}
export function mergeAreaAdvice(store: Store, projectId: string, entries: { rootId: string; advice: string }[]): Record<string, { advice: string; ts: string }> {
  const cur = getAreaAdvice(store, projectId);
  const now = new Date().toISOString();
  for (const e of entries) { if (e?.rootId && e.advice?.trim()) cur[e.rootId] = { advice: String(e.advice).slice(0, 2000), ts: now }; }
  store.setSetting(`areaadvice:${projectId}`, JSON.stringify(cur));
  return cur;
}
/** What an agent working at nodeId receives: the king's advice for the nearest governed area — never the governor's own text. */
export function adviceForNode(store: Store, projectId: string, nodeId: string): { area: string; advice: string; ts: string } | null {
  const g = nearestGovernor(store, projectId, nodeId); if (!g) return null;
  const a = getAreaAdvice(store, projectId)[g.nodeId]; if (!a) return null;
  return { area: g.nodeId, advice: a.advice, ts: a.ts };
}

import { Store } from '../store/db.js';
import { call } from '../inference.js';

// Per-node chat memory (M41, Jacob): the third layer of a node's state —
// description (what it is), fit (how it relates), MEMORY (what was discussed
// while it was the focus). Updated asynchronously after each round.
//
// M191 (Mark): memory is STRUCTURED — a GIST (the required-current condensed
// view of the topic) plus FACTS (dated, provenance-linked, individually
// supersedable). The legacy blob stays dual-written until Stage 4; the
// composer serves minimal views broadly and details warmly. Every write path returns
// all three; conversion of old blob-only memories happens lazily right here
// (the existing blob is shown to the model, which restructures it in the
// same call that folds in the new exchange).

export interface MemoryDetail { id: number; text: string; date: string | null; status: string; prov: any }
export interface NodeCard { minimal: string | null; details: MemoryDetail[]; medium: string | null }
export interface RoundProv { session?: string | null; tool_use_ids?: string[]; paths?: string[]; urls?: string[] }

const MINIMAL_CAP = 300; // Q2 (Mark): store-enforced hard cap, like title length.

const STRUCTURE_RULES = `Maintain the node at THREE LENGTHS (Jacob's rule: each length contains the WHOLE node, compressed to that size — never a subset of its layers):
- minimal: ONE sentence (hard cap ~300 chars) carrying the whole of it — what this node is, its current standing (the latest ruling wins; a reversed decision reads as reversed), and the single most important specific. Someone reading only this line knows the node.
- memory: the MEDIUM length — up to 150 words covering everything about this node: what it is, how it stands, what was discussed here (positions, reasons, reactions), and the key specifics. Integrate, don't append; plain language; drop the least consequential first.
- details: durable specifics this exchange established — a decision and its why, a number, an exact command, a quoted ruling. 0-3 per round, one tight sentence each. These serve at LONG, alongside the full statement and the medium text. Never narrate the dialogue.
- supersede: the numbers of EXISTING details (as numbered in the input) that this exchange overturned or made obsolete.`;

const BATCH_SYSTEM = `You maintain the memories of SEVERAL nodes on a goal map. You get the newest exchange and each node with its existing minimal view, numbered existing details, and legacy memory. For each node, fold in ONLY what this exchange says about that node — different nodes take different things from the same exchange. If the exchange adds nothing for a node, return its layers unchanged (empty details, empty supersede).

${STRUCTURE_RULES}`;

const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['updates'],
  properties: { updates: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'memory', 'minimal'],
    properties: {
      id: { type: 'string' }, memory: { type: 'string' }, minimal: { type: 'string' },
      details: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' }, date: { type: 'string' } } } },
      supersede: { type: 'array', items: { type: 'integer' } },
    },
  } } },
} as const;

function detailsFor(db: any, nodeId: string): MemoryDetail[] {
  return (db.prepare("SELECT id, text, fact_date, status, prov FROM memory_details WHERE node_id = ? ORDER BY id").all(nodeId) as any[])
    .map((r) => ({ id: r.id, text: r.text, date: r.fact_date, status: r.status, prov: JSON.parse(r.prov || '{}') }));
}

function renderExisting(db: any, nodeId: string): { text: string; currentIds: number[] } {
  const row = (db.prepare('SELECT medium, minimal FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  const details = detailsFor(db, nodeId).filter((f) => f.status === 'current');
  const lines = [
    `EXISTING MINIMAL VIEW: ${row?.minimal || '(none yet)'}`,
    details.length ? `EXISTING DETAILS:\n${details.map((f, i) => `  ${i + 1}. ${f.text}${f.date ? ` (${f.date})` : ''}`).join('\n')}` : 'EXISTING DETAILS: (none yet)',
    `LEGACY MEMORY: ${row?.medium || '(none yet)'}`,
  ];
  return { text: lines.join('\n'), currentIds: details.map((f) => f.id) };
}

function writeStructured(store: Store, nodeId: string, u: { memory?: string; minimal?: string; details?: { text: string; date?: string }[]; supersede?: number[] }, shownIds: number[], prov: RoundProv): void {
  const db = (store as any).db;
  const blob = String(u.memory ?? '').trim();
  const minimal = String(u.minimal ?? '').trim().slice(0, MINIMAL_CAP);
  if (blob || minimal) {
    db.prepare(`INSERT INTO node_memory (node_id, medium, minimal, updated_at) VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(node_id) DO UPDATE SET medium = CASE WHEN excluded.medium != '' THEN excluded.medium ELSE node_memory.medium END,
                                                   minimal = CASE WHEN excluded.minimal != '' THEN excluded.minimal ELSE node_memory.minimal END,
                                                   updated_at = datetime('now')`).run(nodeId, blob, minimal);
  }
  for (const n of u.supersede ?? []) {
    const fid = shownIds[n - 1];
    if (fid !== undefined) db.prepare("UPDATE memory_details SET status = 'superseded' WHERE id = ? AND node_id = ?").run(fid, nodeId);
  }
  const provJson = JSON.stringify(prov ?? {});
  for (const f of (u.details ?? []).slice(0, 3)) {
    const text = String(f.text ?? '').trim();
    if (text) db.prepare('INSERT INTO memory_details (node_id, text, fact_date, prov) VALUES (?, ?, ?, ?)').run(nodeId, text.slice(0, 400), f.date ?? null, provJson);
  }
  const projectId = store.getNode(nodeId)?.projectId ?? null;
  store.metric(projectId, 'memory.stored', blob.length + minimal.length + (u.details ?? []).reduce((s, f) => s + (f.text?.length ?? 0), 0));
}

export async function updateNodeMemory(store: Store, nodeId: string, userText: string, assistantText: string, prov: RoundProv = {}): Promise<void> {
  return updateTouchedMemories(store, [nodeId], userText, assistantText, prov);
}

// M156 slice 1 (Mark + Jacob): every node the ROUND TOUCHED gets its memory
// updated — the filer already identified which nodes this round is about, so
// the batch is small (typically 1-5) and relevance-driven. ONE cheap call.
export async function updateTouchedMemories(store: Store, nodeIds: string[], userText: string, assistantText: string, prov: RoundProv = {}): Promise<void> {
  const db = (store as any).db;
  const nodes = [...new Set(nodeIds)].map((id) => store.getNode(id)).filter((n): n is NonNullable<typeof n> => !!n && n.status !== 'removed').slice(0, 6);
  if (!nodes.length) return;
  const shown = new Map(nodes.map((n) => [n.id, renderExisting(db, n.id)]));
  try {
    const parsed = await call({
      task: 'memory', system: BATCH_SYSTEM, maxTokens: 2000, schema: BATCH_SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `NEWEST EXCHANGE:\nUSER: ${userText.slice(0, 1500)}\nAGENT: ${assistantText.slice(0, 1500)}`,
        ...nodes.map((n) => {
          const fit = (store as any).getCachedRelation?.(n.id) ?? null;
          return `NODE [${n.id}]: ${n.type ? `${n.type}: ` : ''}${n.content}${fit ? `\nHOW IT FITS: ${String(fit).split('\n')[0].slice(0, 200)}` : ''}\n${shown.get(n.id)!.text}`;
        }),
        'Update each node.',
      ].join('\n\n'),
    });
    for (const u of parsed.updates ?? []) {
      const id = String(u.id ?? '').replace(/[\[\]]/g, '');
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      writeStructured(store, id, u, shown.get(id)!.currentIds, prov);
    }
  } catch (err) {
    console.error('[memory] batch update failed (next round catches up):', err);
  }
}

// ---- readers ----

export function getNodeMemory(store: Store, nodeId: string): string | null {
  const r = ((store as any).db.prepare('SELECT medium FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  return r?.medium ?? null;
}

export function getNodeCard(store: Store, nodeId: string): NodeCard {
  const db = (store as any).db;
  const row = (db.prepare('SELECT medium, minimal FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  return { minimal: row?.minimal ?? null, details: detailsFor(db, nodeId), medium: row?.medium ?? null };
}

// Bulk forms for the composer's hot path (M190d: one query, never per-node).
export function getAllNodeMemories(store: Store): Map<string, string> {
  const rows = ((store as any).db.prepare('SELECT node_id, medium FROM node_memory').all() as any[]);
  return new Map(rows.map((r) => [r.node_id, r.medium]));
}

export function getAllMinimals(store: Store): Map<string, string> {
  const rows = ((store as any).db.prepare("SELECT node_id, minimal FROM node_memory WHERE minimal IS NOT NULL AND minimal != ''").all() as any[]);
  return new Map(rows.map((r) => [r.node_id, r.minimal]));
}

export function getAllCurrentDetails(store: Store): Map<string, { text: string; date: string | null }[]> {
  const rows = ((store as any).db.prepare("SELECT node_id, text, fact_date FROM memory_details WHERE status = 'current' ORDER BY id").all() as any[]);
  const out = new Map<string, { text: string; date: string | null }[]>();
  for (const r of rows) {
    const a = out.get(r.node_id);
    const f = { text: r.text, date: r.fact_date };
    if (a) a.push(f); else out.set(r.node_id, [f]);
  }
  return out;
}

// M191 migration: restructure legacy blob-only memories into minimal + details.
// Boot sweep covers the most recently active nodes; everything else converts
// lazily the next time updateTouchedMemories touches it (the batch call
// always regenerates the full structure). Off the hot path, batched cheap.
const CONVERT_SYSTEM = `You restructure the stored memory of nodes on a goal map. For each node you get its statement and its existing prose memory. Extract:
${STRUCTURE_RULES}
There is no new exchange — work purely from the existing memory. supersede is always empty. memory: return the existing prose unchanged.`;

export async function convertMemories(store: Store, batch = 20, nodeIds?: string[], refresh = false): Promise<number> {
  const db = (store as any).db;
  const rows = nodeIds
    ? nodeIds.map((id) => ({ node_id: id })).filter((r) => { const m = db.prepare("SELECT minimal FROM node_memory WHERE node_id = ? AND medium != ''").get(r.node_id) as any; return m && !m.minimal; }).slice(0, batch)
    : refresh
      ? (db.prepare("SELECT node_id FROM node_memory WHERE minimal != '' AND medium != '' ORDER BY updated_at ASC LIMIT ?").all(batch) as any[])
      : (db.prepare("SELECT node_id FROM node_memory WHERE (minimal IS NULL OR minimal = '') AND medium != '' ORDER BY updated_at DESC LIMIT ?").all(batch) as any[]);
  const nodes = rows.map((r) => store.getNode(r.node_id)).filter((n): n is NonNullable<typeof n> => !!n && n.status !== 'removed');
  if (!nodes.length) return 0;
  try {
    const parsed = await call({
      task: 'memory', system: CONVERT_SYSTEM, maxTokens: 3000, schema: BATCH_SCHEMA as any, timeoutMs: 120_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        ...nodes.map((n) => `NODE [${n.id}]: ${n.type ? `${n.type}: ` : ''}${n.content}\nEXISTING MEMORY: ${(db.prepare('SELECT medium FROM node_memory WHERE node_id = ?').get(n.id) as any)?.medium ?? ''}`),
        'Restructure each.',
      ].join('\n\n'),
    });
    let done = 0;
    for (const u of parsed.updates ?? []) {
      const id = String(u.id ?? '').replace(/[\[\]]/g, '');
      if (!nodes.some((n) => n.id === id)) continue;
      writeStructured(store, id, { ...u, memory: '', supersede: [] }, [], {});
      done++;
    }
    store.audit('memory_converted', { batch: done });
    return done;
  } catch (err) {
    console.error('[memory] conversion batch failed (lazy path catches up):', err);
    return 0;
  }
}

// ---- legacy write paths (import apply, tests) ----

export function setNodeMemory(store: Store, nodeId: string, text: string): void {
  const db = (store as any).db;
  if (text) {
    db.prepare(`INSERT INTO node_memory (node_id, medium, updated_at) VALUES (?, ?, datetime('now'))
                ON CONFLICT(node_id) DO UPDATE SET medium = excluded.medium, updated_at = datetime('now')`).run(nodeId, text);
    store.metric(store.getNode(nodeId)?.projectId ?? null, 'memory.stored', text.length);
  }
}

export function clearNodeMemory(store: Store, nodeId: string): void {
  (store as any).db.prepare('DELETE FROM node_memory WHERE node_id = ?').run(nodeId);
  (store as any).db.prepare('DELETE FROM memory_details WHERE node_id = ?').run(nodeId);
}

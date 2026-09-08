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
export interface NodeCard { minimal: string | null; details: MemoryDetail[]; medium: string | null; long?: string | null }
export interface RoundProv { session?: string | null; tool_use_ids?: string[]; paths?: string[]; urls?: string[] }

const MINIMAL_CAP = 300; // Q2 (Mark): store-enforced hard cap, like title length.

const STRUCTURE_RULES = `THE NODE'S BODY has five organs (Jacob, M192c/M214 — 麻雀虽小五脏俱全): NAME · DESCRIPTION (what it is and its current standing, with its specifics — numbers, exact commands, quoted rulings — each with its date and source; the latest ruling wins, a reversed decision reads as reversed) · FIT (how it sits in the map: where it belongs, what it relates to, why it is there) · MODLOG (the node's own change history: each dated version in order, what changed and why — never buried in the description) · CHAT MEMORY (what was discussed: positions, reasons, reactions, the arc in order).
Maintain the node at THREE LENGTHS. Each length is the WHOLE node — all five organs — compressed to that size, never the shorter one plus extra elements:
- minimal: ONE sentence (hard cap ~300 chars) carrying all five: what it is, its standing, where it sits, how it changed, the gist of the discussion.
- memory: the MEDIUM length — up to 150 words covering all five organs. Integrate, don't append; plain language; drop the least consequential first.
- long: all five organs IN FULL — extensive, no cap, each organ under its own heading (NAME, DESCRIPTION, FIT, MODLOG, CHAT MEMORY): the complete description and standing with every specific and its source; the fit spelled out; the modlog as a dated list of what changed and why; the whole discussion arc in order with who said what and why. Someone reading only this knows everything the map knows about this node.
- details: durable specifics this exchange established — a decision and its why, a number, an exact command, a quoted ruling. 0-3 per round, one tight sentence each, with the date when known. Plumbing for superseding one specific later; the long text carries them in prose.
- supersede: the numbers of EXISTING details (as numbered in the input) that this exchange overturned or made obsolete.`;

const BATCH_SYSTEM = `You maintain the memories of SEVERAL nodes on a goal map. You get the newest exchange and each node with its existing minimal view, numbered existing details, and legacy memory. For each node, fold in ONLY what this exchange says about that node — different nodes take different things from the same exchange. If the exchange adds nothing for a node, return its layers unchanged (empty details, empty supersede).

${STRUCTURE_RULES}`;

const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['updates'],
  properties: { updates: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'memory', 'minimal'],
    properties: {
      id: { type: 'string' }, memory: { type: 'string' }, minimal: { type: 'string' }, long: { type: 'string' },
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
  const row = (db.prepare('SELECT medium, minimal, long FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  const details = detailsFor(db, nodeId).filter((f) => f.status === 'current');
  const lines = [
    `EXISTING MINIMAL VIEW: ${row?.minimal || '(none yet)'}`,
    `EXISTING LONG: ${row?.long ? String(row.long).slice(0, 3000) : '(none yet)'}`,
    details.length ? `EXISTING DETAILS:\n${details.map((f, i) => `  ${i + 1}. ${f.text}${f.date ? ` (${f.date})` : ''}`).join('\n')}` : 'EXISTING DETAILS: (none yet)',
    `LEGACY MEMORY: ${row?.medium || '(none yet)'}`,
  ];
  return { text: lines.join('\n'), currentIds: details.map((f) => f.id) };
}

function writeStructured(store: Store, nodeId: string, u: { memory?: string; minimal?: string; long?: string; details?: { text: string; date?: string }[]; supersede?: number[] }, shownIds: number[], prov: RoundProv): void {
  const db = (store as any).db;
  const blob = String(u.memory ?? '').trim();
  const minimal = String(u.minimal ?? '').trim().slice(0, MINIMAL_CAP);
  const long = String(u.long ?? '').trim(); // M214: no cap — long is everything
  if (blob || minimal || long) {
    db.prepare(`INSERT INTO node_memory (node_id, medium, minimal, long, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(node_id) DO UPDATE SET medium = CASE WHEN excluded.medium != '' THEN excluded.medium ELSE node_memory.medium END,
                                                   minimal = CASE WHEN excluded.minimal != '' THEN excluded.minimal ELSE node_memory.minimal END,
                                                   long = CASE WHEN excluded.long != '' THEN excluded.long ELSE node_memory.long END,
                                                   updated_at = datetime('now')`).run(nodeId, blob, minimal, long);
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

// M214: the five organs as INPUT to the writer — fit from the tree (ancestors
// and siblings by name), the discussion arc from the node's dated versions
// (M211) and the rounds that touched it, the specifics from memory_details.
export function organsInput(store: Store, n: { id: string; type?: string | null; content: string; title?: string | null; parentId?: string | null }): string {
  const name = (id: string) => { const x = store.getNode(id); return x ? (x.title || x.content.slice(0, 50)) : '?'; };
  const chain: string[] = []; let p = n.parentId ?? null; const seen = new Set<string>();
  while (p && !seen.has(p) && chain.length < 6) { seen.add(p); chain.unshift(name(p)); p = store.getNode(p)?.parentId ?? null; }
  const sibs = n.parentId ? store.childrenOf(n.parentId).filter((k) => k.id !== n.id && k.status !== 'removed').slice(0, 6).map((k) => k.title || k.content.slice(0, 40)) : [];
  const kids = store.childrenOf(n.id).filter((k) => k.status !== 'removed').slice(0, 8).map((k) => k.title || k.content.slice(0, 40));
  const cached = (store as any).getCachedRelation?.(n.id) ?? null;
  const hist = (store as any).nodeHistory?.(n.id) ?? [];
  const versions = hist.filter((v: any) => v.content).map((v: any) => `  ${String(v.at).slice(0, 10)}${v.dated ? '' : ' (map change)'}: ${String(v.content).slice(0, 300)}`);
  const rounds = nodeRounds(store, n.id).slice(-4).map((r) => `  [${r.at.slice(0, 10)}] USER: ${r.user.slice(0, 400)}\n  AGENT: ${r.agent.slice(0, 400)}`);
  return [
    `NODE [${n.id}]: ${n.title ? `NAME: ${n.title}\n` : ''}${n.type ? `${n.type}: ` : ''}${n.content}`,
    `FIT: under ${chain.length ? chain.join(' › ') : '(top level)'}${sibs.length ? ` · beside ${sibs.join(', ')}` : ''}${kids.length ? ` · holds ${kids.join(', ')}` : ''}${cached ? `\n  ${String(cached).split('\n')[0].slice(0, 300)}` : ''}`,
    versions.length > 1 ? `HISTORY OF THE STATEMENT (oldest first):\n${versions.join('\n')}` : '',
    rounds.length ? `WHAT WAS SAID (the rounds that touched this node):\n${rounds.join('\n')}` : '',
    renderExisting((store as any).db, n.id).text,
  ].filter(Boolean).join('\n');
}

// The rounds that created or changed a node (map_events.round_id → rounds →
// turns): the raw conversation history behind it.
export function nodeRounds(store: Store, nodeId: string): { at: string; user: string; agent: string }[] {
  const db = (store as any).db;
  const rids = (db.prepare("SELECT DISTINCT round_id FROM map_events WHERE round_id IS NOT NULL AND alteration LIKE ? ORDER BY seq").all(`%"id":"${nodeId}"%`) as any[]).map((r) => r.round_id);
  const out: { at: string; user: string; agent: string }[] = [];
  for (const rid of rids) {
    const r = db.prepare('SELECT chat_id, turn_id, created_at FROM rounds WHERE id = ?').get(rid) as any; if (!r) continue;
    const t = db.prepare('SELECT idx, content FROM turns WHERE id = ?').get(r.turn_id) as any; if (!t) continue;
    const a = db.prepare('SELECT content FROM turns WHERE chat_id = ? AND idx = ? AND role = ?').get(r.chat_id, t.idx + 1, 'assistant') as any;
    out.push({ at: r.created_at, user: String(t.content ?? ''), agent: String(a?.content ?? '') });
  }
  return out;
}

// FULL (M214): the raw material behind a node — its rounds when it was filed
// live, or the passage of the retained import source it came from.
export function nodeFull(store: Store, nodeId: string): string {
  const n = store.getNode(nodeId); if (!n) return '';
  const rounds = nodeRounds(store, nodeId);
  if (rounds.length) return rounds.map((r) => `[${r.at}]\nUSER: ${r.user}\n\nAGENT: ${r.agent}`).join('\n\n— — —\n\n');
  const src = store.getSetting(`importsource:${n.projectId}`) ?? '';
  if (!src) return '';
  const keys = [...`${n.title ?? ''} ${n.content.slice(0, 120)}`.matchAll(/\bM\d{1,3}[a-z]?\b/g)].map((m) => m[0]);
  const heads = keys.map((k) => src.search(new RegExp(`^## ${k}\\b`, 'm'))).filter((i) => i >= 0);
  const anchor = heads.length ? Math.min(...heads) : src.indexOf((n.title ?? n.content.slice(0, 40)).slice(0, 30));
  if (anchor < 0) return '';
  const end = src.indexOf('\n## ', anchor + 10);
  return `[from the imported source]\n` + src.slice(anchor, end > 0 ? Math.min(end, anchor + 12_000) : anchor + 12_000);
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
        ...nodes.map((n) => organsInput(store, n)),
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
  const row = (db.prepare('SELECT medium, minimal, long FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  return { minimal: row?.minimal ?? null, details: detailsFor(db, nodeId), medium: row?.medium ?? null, long: row?.long ?? null };
}

export function getAllLongs(store: Store): Map<string, string> {
  const rows = ((store as any).db.prepare("SELECT node_id, long FROM node_memory WHERE long IS NOT NULL AND long != ''").all() as any[]);
  return new Map(rows.map((r) => [r.node_id, r.long]));
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
const CONVERT_SYSTEM = `You write the stored memory of nodes on a goal map at its three lengths. For each node you get its five organs as the map holds them — name and description, fit, the history of its statement, what was said in the rounds that touched it, its existing memory and dated specifics.
${STRUCTURE_RULES}
There is no new exchange — work purely from what is given; invent nothing. supersede is always empty. Write minimal, memory (medium) and long for every node — REWRITE the medium from scratch under the five-organ rule; do not copy the existing prose (it predates the rule and is missing organs).`;

export async function convertMemories(store: Store, batch = 20, nodeIds?: string[], refresh = false): Promise<number> {
  const db = (store as any).db;
  const rows = nodeIds
    ? nodeIds.map((id) => ({ node_id: id })).filter((r) => { const m = db.prepare("SELECT minimal FROM node_memory WHERE node_id = ? AND medium != ''").get(r.node_id) as any; return m && (refresh || !m.minimal); }).slice(0, batch)
    : refresh
      ? (db.prepare("SELECT node_id FROM node_memory WHERE minimal != '' AND medium != '' ORDER BY updated_at ASC LIMIT ?").all(batch) as any[])
      : (db.prepare("SELECT node_id FROM node_memory WHERE (minimal IS NULL OR minimal = '' OR long IS NULL OR long = '') AND medium != '' ORDER BY updated_at DESC LIMIT ?").all(batch) as any[]);
  const nodes = rows.map((r) => store.getNode(r.node_id)).filter((n): n is NonNullable<typeof n> => !!n && n.status !== 'removed');
  if (!nodes.length) return 0;
  try {
    const parsed = await call({
      task: 'memory', system: CONVERT_SYSTEM, maxTokens: 6000, schema: BATCH_SCHEMA as any, timeoutMs: 300_000, // M214 deploy: 20-node batches timed out at 120 s; 8 nodes, 300 s
      audit: (k, d) => store.audit(k, d),
      user: [
        ...nodes.map((n) => organsInput(store, n)),
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

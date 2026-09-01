import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call, modelFor } from '../inference.js';
import { loadMap } from '../map/render.js';

// M192 (Jacob): "a professional map structure monitoring agent that the map
// consults to when reorganizing… should be a function called 'map status' in
// the rare tier… It should also learn from or consult map preference."
//
// Two halves:
// 1. INSTRUMENTS (mechanical, no model): the measured shape — the M190-era
//    detectors turned into a standing panel of numbers.
// 2. THE SPECIALIST (smart tier): reads the instruments + the user's map
//    preferences (M124) + a rolled-up outline, and renders a professional
//    structural opinion. Stored per project; tidy, the reviewer, and the
//    import finish pass CONSULT it (M124's system-card channel). Advisory
//    only — it proposes nothing itself; correction stays propose→approve.

export interface MapInstruments {
  nodes: number;
  depthHistogram: Record<number, number>;
  deepShare: number;            // fraction at depth ≥3
  maxDepth: number;
  chapters: { name: string; size: number; share: number }[];
  largestChapterShare: number;
  widest: { name: string; children: number }[];
  medianStatementChars: number;
  memory: { minimal: number; medium: number; details: number };
  types: Record<string, number>;
  offlistTypes: string[];
  toSortSize: number;
  settledStatuses: number;      // reversed/superseded/dropped/rejected still on the map
}

const TYPE_LIST = new Set(['claim', 'question', 'option', 'decision', 'constraint', 'evidence', 'task']);

export function measureMap(store: Store, projectId: string): MapInstruments {
  const nodes = loadMap(store, projectId).nodes.filter((n) => n.status !== 'removed');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, number>();
  for (const n of nodes) if (n.parentId) kids.set(n.parentId, (kids.get(n.parentId) ?? 0) + 1);
  const depth = (id: string): number => {
    let d = 0; let p = byId.get(id)?.parentId;
    while (p && byId.has(p)) { d++; p = byId.get(p)!.parentId; }
    return d;
  };
  const dh: Record<number, number> = {};
  for (const n of nodes) { const d = depth(n.id); dh[d] = (dh[d] ?? 0) + 1; }
  const subtreeSize = (id: string): number => {
    let s = 1;
    for (const n of nodes) if (n.parentId === id) s += subtreeSize(n.id);
    return s;
  };
  const name = (n: any) => (n.title || n.content.slice(0, 40)) as string;
  const isToSort = (n: any) => n.parentId === null && (n.title === 'to sort' || n.content.startsWith('to sort'));
  const tops = nodes.filter((n) => n.parentId === null && !isToSort(n));
  // Chapters = children of the largest top (single-root maps) or the tops
  // themselves (multi-thread maps).
  const mainRoot = tops.length === 1 ? tops[0] : null;
  const chapterNodes = mainRoot ? nodes.filter((n) => n.parentId === mainRoot.id) : tops;
  const total = nodes.length || 1;
  const chapters = chapterNodes.map((c) => ({ name: name(c), size: subtreeSize(c.id), share: 0 }))
    .sort((a, b) => b.size - a.size).slice(0, 12);
  for (const c of chapters) c.share = Math.round((100 * c.size) / total) / 100;
  const widest = [...kids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, k]) => ({ name: name(byId.get(id)!), children: k }));
  const lens = nodes.map((n) => n.content.length).sort((a, b) => a - b);
  const db = (store as any).db;
  const ids = new Set(nodes.map((n) => n.id));
  const mem = { minimal: 0, medium: 0, details: 0 };
  try {
    for (const r of db.prepare("SELECT node_id, minimal, medium FROM node_memory").all() as any[]) {
      if (!ids.has(r.node_id)) continue;
      if (r.minimal) mem.minimal++;
      if (r.medium) mem.medium++;
    }
    for (const r of db.prepare("SELECT node_id, COUNT(*) c FROM memory_details WHERE status='current' GROUP BY node_id").all() as any[]) {
      if (ids.has(r.node_id)) mem.details += r.c;
    }
  } catch { /* fresh db */ }
  const types: Record<string, number> = {};
  const offlist = new Set<string>();
  for (const n of nodes) {
    const t = n.type ?? 'topic';
    types[t] = (types[t] ?? 0) + 1;
    if (n.type && !TYPE_LIST.has(n.type)) offlist.add(n.type);
  }
  const settled = nodes.filter((n) => ['reversed', 'superseded', 'dropped', 'rejected'].includes(n.status)).length;
  const toSort = nodes.find(isToSort);
  const deep = Object.entries(dh).reduce((s, [d, c]) => s + (Number(d) >= 3 ? c : 0), 0);
  return {
    nodes: nodes.length,
    depthHistogram: dh,
    deepShare: Math.round((100 * deep) / total) / 100,
    maxDepth: Math.max(0, ...Object.keys(dh).map(Number)),
    chapters,
    largestChapterShare: chapters[0]?.share ?? 0,
    widest,
    medianStatementChars: lens[Math.floor(lens.length / 2)] ?? 0,
    memory: mem,
    types,
    offlistTypes: [...offlist],
    toSortSize: toSort ? subtreeSize(toSort.id) - 1 : 0,
    settledStatuses: settled,
  };
}

const SYSTEM = `You are the map status specialist — the professional structural reviewer of a goal map. You do not file, rename, or move anything; you render an expert opinion on the map's STRUCTURE, which the user reads and the working agents (tidy, the reviewer, import finishing) consult before they propose changes.

You receive measured instruments (counts, depth, chapter balance, width, memory coverage), the user's standing map preferences (their taste — it outranks generic doctrine), and a rolled-up outline.

Judge like an information architect:
- BALANCE: a chapter holding a large share of the map usually means a name from the conversation became a gravity well ("one early heading swallowed the timeline" is the classic). Chapters should be subjects, never meetings/sessions/phases.
- ONE TOPIC = ONE SUBTREE: a topic's story split across chapters is the costliest defect (it measurably degrades what the agent recalls).
- DEPTH is earned by material, never padded; width past ~15 children usually wants grouping.
- The tree carries the substance: names-plus-buried-prose is a defect; statements should let a reader follow the argument from the tree alone.
- Settled statuses (reversed/superseded) belong on the map but must not read as current.
- Respect the user's preferences file over any of the above when they conflict.

Return:
- health: ONE plain sentence on overall structural state (shown to the user first — honest, not alarmist; a clean map deserves plain good news).
- findings: 0-4 entries, worst first — { what: one sentence naming the problem with the actual names/numbers; fix: one sentence naming the mechanism that fixes it (a ⟳ tidy split of X, the file-discussion lane on Y, grouping under Z, narrowing the light) }. Only real problems; an empty list is a fine answer.
- opinion: 2-4 sentences the working agents will read before proposing reorganizations — the standing structural priorities for THIS map, in plain words.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['health', 'findings', 'opinion'],
  properties: {
    health: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['what', 'fix'],
      properties: { what: { type: 'string' }, fix: { type: 'string' } },
    } },
    opinion: { type: 'string' },
  },
} as const;

export interface MapStatus { ts: string; health: string; findings: { what: string; fix: string }[]; opinion: string; instruments: MapInstruments }

export function getMapStatus(store: Store, projectId: string): MapStatus | null {
  const raw = store.getSetting(`mapstatus:${projectId}`);
  try { return raw ? JSON.parse(raw) as MapStatus : null; } catch { return null; }
}

// The consult block working agents receive (M124 channel). Empty when no
// review has run yet or the map has drifted far beyond it.
export function statusConsult(store: Store, projectId: string): string {
  const s = getMapStatus(store, projectId);
  if (!s) return '';
  return `\n\nSTRUCTURAL OPINION (the map status specialist's standing review — consult it; the user's preferences still outrank it):\n${s.opinion}${s.findings.length ? `\nOpen structural findings: ${s.findings.map((f) => f.what).join(' · ')}` : ''}`;
}

export async function runMapStatus(store: Store, projectId: string, outline: string): Promise<MapStatus | { error: string }> {
  const instruments = measureMap(store, projectId);
  const prefs = store.getSetting(`prefs:${projectId}`) ?? '';
  try {
    const parsed = await call({
      task: 'mapcheck', modelOverride: modelFor('tidy'),
      system: SYSTEM + systemCard(store, projectId, 'the MAP STATUS specialist'),
      maxTokens: 1500, schema: SCHEMA as any, timeoutMs: 120_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `INSTRUMENTS (measured, current):\n${JSON.stringify(instruments, null, 1).slice(0, 4000)}`,
        prefs ? `THE USER'S MAP PREFERENCES (their taste outranks doctrine):\n${prefs}` : 'THE USER HAS SET NO MAP PREFERENCES YET.',
        `THE MAP (rolled-up outline):\n${outline.slice(0, 20_000)}`,
        'Render the structural review.',
      ].join('\n\n'),
    });
    const status: MapStatus = {
      ts: new Date().toISOString(),
      health: String(parsed.health ?? '').slice(0, 300),
      findings: (parsed.findings ?? []).slice(0, 4).map((f: any) => ({ what: String(f.what ?? '').slice(0, 300), fix: String(f.fix ?? '').slice(0, 300) })),
      opinion: String(parsed.opinion ?? '').slice(0, 900),
      instruments,
    };
    store.setSetting(`mapstatus:${projectId}`, JSON.stringify(status));
    store.audit('map_status', { findings: status.findings.length });
    return status;
  } catch (err) {
    console.error('[mapstatus] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

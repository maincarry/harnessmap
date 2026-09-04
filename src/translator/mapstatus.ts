import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call, modelFor } from '../inference.js';
import { loadMap, renderTieredTreeForSubtree } from '../map/render.js';

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
- BALANCE: a chapter holding a large share of the map usually means a name from the conversation became a catch-all — one early heading kept collecting everything that came after. Chapters are subjects, never meetings, sessions, or phases.
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
// M195b (Jacob): "every auto-agent (except tidy) should receive its report."
// Tidy is the local surgeon (M72) — global editorial judgment would tempt it
// out of scope; it keeps the structural opinion and its own area's
// assessment only. The chat briefing gets chatAwareness(): the judgment-
// sized geography (keystones, tensions, trust per area) that covers DIM
// areas too — which is what makes pull-up offers well-informed without
// per-node cost.
export function chatAwareness(store: Store, projectId: string): string {
  const u = getUnderstanding(store, projectId);
  if (!u) return '';
  const sec = (k: string, cap: number) => (u.sections[k]?.text ?? '').slice(0, cap);
  const parts = [
    sec('keystones', 350) ? `load-bearing decisions: ${sec('keystones', 350)}` : '',
    sec('tensions', 300) ? `currently contested: ${sec('tensions', 300)}` : '',
    sec('trust', 450) ? `area reliability: ${sec('trust', 450)}` : '',
  ].filter(Boolean);
  return parts.length ? `WHAT THE MAP HOLDS (the map's own standing judgment — includes set-aside areas; use it to recognize what exists and offer to pull things up, never to answer from it directly):\n${parts.join('\n')}` : '';
}

export function statusConsult(store: Store, projectId: string, forNodeId?: string, lane: 'full' | 'tidy' = 'full'): string {
  const s = getMapStatus(store, projectId);
  const u = getUnderstanding(store, projectId);
  const parts: string[] = [];
  if (u && lane === 'full') {
    const sec = (k: string, label: string, cap = 400) => { const x = u.sections[k]; return x?.text ? `${label}: ${x.text.slice(0, cap)}` : ''; };
    parts.push(`THE OVERALL MAP STATUS REPORT (consult it; the user's preferences still outrank it):`);
    parts.push([sec('essence', 'what this project is', 350), sec('arc', 'where the work is heading', 350), sec('tensions', 'live tensions', 400), sec('keystones', 'keystones', 300), sec('gaps', 'known gaps', 300)].filter(Boolean).join('\n'));
  }
  {
    // The consulting agent's working area gets its chapter assessment (tiered consultation).
    if (forNodeId) {
      const db = (store as any).db;
      let p: string | null | undefined = forNodeId;
      let chapter: string | null = null;
      while (p) { const n = store.getNode(p); if (!n) break; if (!n.parentId || !store.getNode(n.parentId)?.parentId) { chapter = n.parentId ? p : p; break; } p = n.parentId; }
      if (chapter) {
        const a = (db.prepare('SELECT text FROM chapter_assessments WHERE project_id = ? AND chapter_id = ?').get(projectId, chapter) as any);
        if (a?.text) parts.push(`THIS AREA'S ASSESSMENT: ${a.text}`);
      }
    }
  }
  if (s) parts.push(`STRUCTURAL OPINION:\n${s.opinion}${s.findings.length ? `\nOpen structural findings: ${s.findings.map((f) => f.what).join(' · ')}` : ''}`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
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


// ---------------------------------------------------------------------------
// M195 (Jacob): the OVERALL MAP STATUS REPORT. The map status agent grows into the brain of
// the auto-agents: narrow passes report up, and the map status agent reconciles all
// reports against its previous overall report and writes the one coherent
// standing text itself. Information flows one way (hierarchy, not agent
// chat — M124 holds). Layers, per the settled design:
//   mechanical scan (total, structured, dumb — stored)
//   → chapter assessments for ALL areas (bounded each, incremental refresh)
//   → the understanding (judgments the tree cannot say about itself:
//     tensions, keystones, gaps, trust per area, arc, essence — stamped)
//   → consulted by every advisor.

export interface ContentScan {
  ts: string;
  chapters: { id: string; name: string; nodes: number; withMinimal: number; withMedium: number; details: number; settled: number; newestChange: string; staleMinimals: number }[];
  currencyCandidates: { id: string; name: string; why: string }[];
}

export function runContentScan(store: Store, projectId: string): ContentScan {
  const db = (store as any).db;
  const nodes = loadMap(store, projectId).nodes.filter((n) => n.status !== 'removed');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, typeof nodes>();
  for (const n of nodes) { if (n.parentId) { const a = kids.get(n.parentId) ?? []; a.push(n); kids.set(n.parentId, a); } }
  const mem = new Map<string, any>((db.prepare('SELECT node_id, minimal, medium, updated_at FROM node_memory').all() as any[]).map((r: any) => [r.node_id, r]));
  const detDates = new Map<string, string>();
  const detCount = new Map<string, number>();
  for (const r of db.prepare("SELECT node_id, MAX(created_at) mx, COUNT(*) c FROM memory_details WHERE status='current' GROUP BY node_id").all() as any[]) {
    detDates.set(r.node_id, r.mx); detCount.set(r.node_id, r.c);
  }
  const SETTLED = new Set(['reversed', 'superseded', 'dropped', 'rejected']);
  const isToSort = (n: any) => n.parentId === null && (n.title === 'to sort' || n.content.startsWith('to sort'));
  const tops = nodes.filter((n) => n.parentId === null && !isToSort(n));
  const mainRoot = tops.length === 1 ? tops[0] : null;
  const chapterNodes = mainRoot ? (kids.get(mainRoot.id) ?? []) : tops;
  const subtree = (id: string): typeof nodes => {
    const out: typeof nodes = []; const st = [...(kids.get(id) ?? [])];
    while (st.length) { const x = st.pop()!; out.push(x); st.push(...(kids.get(x.id) ?? [])); }
    return out;
  };
  const chapters = chapterNodes.map((c) => {
    const sub = [c, ...subtree(c.id)];
    let withMin = 0, withMed = 0, det = 0, settled = 0, stale = 0, newest = '';
    for (const n of sub) {
      const r = mem.get(n.id);
      if (r?.minimal) withMin++;
      if (r?.medium) withMed++;
      det += detCount.get(n.id) ?? 0;
      if (SETTLED.has(n.status)) settled++;
      if (n.updatedAt > newest) newest = n.updatedAt;
      const dd = detDates.get(n.id);
      if (dd && r?.updated_at && dd > r.updated_at) stale++;   // details newer than the compressions
    }
    return { id: c.id, name: (c.title || c.content.slice(0, 40)), nodes: sub.length, withMinimal: withMin, withMedium: withMed, details: det, settled, newestChange: newest, staleMinimals: stale };
  });
  // Currency candidates: settled nodes with live children (a dead ruling
  // whose subtree still reads alive), and stale compressions.
  const currency: { id: string; name: string; why: string }[] = [];
  for (const n of nodes) {
    if (SETTLED.has(n.status) && (kids.get(n.id) ?? []).some((k) => !SETTLED.has(k.status) && k.status !== 'removed')) {
      currency.push({ id: n.id.slice(0, 8), name: (n.title || n.content.slice(0, 40)), why: `status ${n.status} but live children` });
    }
    const dd = detDates.get(n.id); const r = mem.get(n.id);
    if (dd && r?.updated_at && dd > r.updated_at) {
      currency.push({ id: n.id.slice(0, 8), name: (n.title || n.content.slice(0, 40)), why: 'remembered specifics newer than its compressions' });
    }
  }
  const scan: ContentScan = { ts: new Date().toISOString(), chapters, currencyCandidates: currency.slice(0, 60) };
  store.setSetting(`contentscan:${projectId}`, JSON.stringify(scan));
  return scan;
}

const ASSESS_SYSTEM = `You are the content-status agent for a goal map — one of the map status agent's reporters. For each AREA given, write its chapter assessment: 100-150 words covering what this area holds, how current it is (are settled things marked settled; is anything contested), where it is thin (little remembered detail), and anything odd. Ground every claim in the material shown. Plain words. Return one assessment per area.`;

const ASSESS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessments'],
  properties: { assessments: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['chapterId', 'text'],
    properties: { chapterId: { type: 'string' }, text: { type: 'string' } },
  } } },
} as const;

export async function assessChapters(store: Store, projectId: string, chapterIds: string[]): Promise<number> {
  const db = (store as any).db;
  const scanRaw = store.getSetting(`contentscan:${projectId}`);
  const scan: ContentScan | null = scanRaw ? JSON.parse(scanRaw) : null;
  let done = 0;
  for (const cid of chapterIds.slice(0, 4)) {
    const node = store.getNode(cid);
    if (!node) continue;
    const slice = renderTieredSlice(store, projectId, cid, 9000);
    const stats = scan?.chapters.find((c) => c.id === cid);
    const prev = (db.prepare('SELECT text FROM chapter_assessments WHERE project_id = ? AND chapter_id = ?').get(projectId, cid) as any)?.text ?? '';
    try {
      const parsed = await call({
        task: 'mapcheck', system: ASSESS_SYSTEM, maxTokens: 600, schema: ASSESS_SCHEMA as any, timeoutMs: 90_000,
        audit: (k, d) => store.audit(k, d),
        user: [
          `AREA [${cid.slice(0, 8)}]: ${node.title || node.content}`,
          stats ? `MEASURED: ${stats.nodes} nodes, ${stats.withMinimal} with one-line versions, ${stats.details} remembered specifics, ${stats.settled} settled, ${stats.staleMinimals} with stale compressions, newest change ${stats.newestChange}` : '',
          `THE AREA (tiered):\n${slice}`,
          prev ? `YOUR PREVIOUS ASSESSMENT (integrate, don't append):\n${prev}` : '',
          'Write the chapter assessment.',
        ].filter(Boolean).join('\n\n'),
      });
      const a = (parsed.assessments ?? [])[0];
      if (a?.text) {
        db.prepare(`INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(project_id, chapter_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`).run(projectId, cid, String(a.text).slice(0, 1200));
        done++;
      }
    } catch (err) { console.error('[assess] chapter failed:', err); }
  }
  return done;
}

// A tiered slice of ONE area (for the assessment pass): minimal floor,
// suspects promoted — reuses the advisor renderer bounded to a subtree.
function renderTieredSlice(store: Store, projectId: string, rootId: string, budget: number): string {
  const full = renderTieredTreeForSubtree(store, projectId, rootId, budget);
  return full;
}

export interface Understanding {
  sections: Record<string, { text: string; ts: string }>;
}

const OVERALL_SYSTEM = `You are the map status agent writing the OVERALL MAP STATUS REPORT — the one coherent judgment of a goal map. Your reporters hand you: the structure report, chapter assessments covering every area, a taste note (what the user has accepted and rejected lately), and your own previous overall report. Reconcile them — where reports pull opposite ways, decide; where nothing changed, keep your prior text.

Write the overall report as these sections, each self-contained, plain words, grounded in the reports (never invent):
- essence: what this project IS — its thesis and standing doctrine. Stable; amend only on real change.
- arc: what the work is converging toward; which open question actually blocks; what the user keeps returning to.
- tensions: places the map asserts incompatible things, worst first. Empty is a fine answer.
- keystones: the few decisions everything else stands on.
- gaps: what the map should contain and doesn't — unanswered questions, unrecorded decisions, and where the map has not been fed lately.
- trust: one line per area — where the map is reliable vs thin, contested, or old.

Each section at its natural size; judgment scales with what is genuinely contested, not with map size.`;

const OVERALL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['essence', 'arc', 'tensions', 'keystones', 'gaps', 'trust'],
  properties: { essence: { type: 'string' }, arc: { type: 'string' }, tensions: { type: 'string' }, keystones: { type: 'string' }, gaps: { type: 'string' }, trust: { type: 'string' } },
} as const;

export function getUnderstanding(store: Store, projectId: string): Understanding | null {
  const raw = store.getSetting(`understanding:${projectId}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function synthesizeOverallStatus(store: Store, projectId: string): Promise<Understanding | { error: string }> {
  const db = (store as any).db;
  const status = getMapStatus(store, projectId);
  const assessments = (db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]);
  const taste = store.getSetting(`taste:${projectId}`) ?? '';
  const prev = getUnderstanding(store, projectId);
  const prefs = store.getSetting(`prefs:${projectId}`) ?? '';
  try {
    const parsed = await call({
      task: 'mapcheck', modelOverride: modelFor('tidy'),
      system: OVERALL_SYSTEM, maxTokens: 2500, schema: OVERALL_SCHEMA as any, timeoutMs: 120_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        status ? `STRUCTURE REPORT (${status.ts}):\n${status.health}\n${status.findings.map((f) => `- ${f.what} (fix: ${f.fix})`).join('\n')}\n${status.opinion}` : 'STRUCTURE REPORT: none yet.',
        `CHAPTER ASSESSMENTS (every area):\n${assessments.map((a) => {
          const n = store.getNode(a.chapter_id);
          return `[${(n?.title || n?.content || a.chapter_id).slice(0, 40)}] (${a.updated_at}): ${a.text}`;
        }).join('\n\n').slice(0, 30_000) || '(none yet)'}`,
        taste ? `TASTE NOTE (from the user's recent accept/reject decisions):\n${taste}` : '',
        prefs ? `THE USER'S MAP PREFERENCES:\n${prefs}` : '',
        prev ? `YOUR PREVIOUS UNDERSTANDING:\n${Object.entries(prev.sections).map(([k, v]) => `${k} (${v.ts}): ${v.text}`).join('\n\n')}` : '',
        'Write the understanding.',
      ].filter(Boolean).join('\n\n'),
    });
    const now = new Date().toISOString();
    const prevS = prev?.sections ?? {};
    const sections: Understanding['sections'] = {};
    for (const k of ['essence', 'arc', 'tensions', 'keystones', 'gaps', 'trust']) {
      const text = String((parsed as any)[k] ?? '').slice(0, 2000);
      const old = (prevS as any)[k];
      sections[k] = { text, ts: old && old.text === text ? old.ts : now };
    }
    const u: Understanding = { sections };
    store.setSetting(`understanding:${projectId}`, JSON.stringify(u));
    store.audit('overall_status_synthesis', { chapters: assessments.length });
    return u;
  } catch (err) {
    console.error('[overall status] synthesis failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}


// The taste digest: what the user has accepted and rejected lately, folded
// into a short note the overall map status report weighs. Reads decisions, never words.
const TASTE_SYSTEM = `You digest a user's recent decisions about their goal map — proposals applied, dismissed, undone — into a short taste note (≤120 words) for the overall map status report: what kinds of changes this user welcomes, what they refuse, what they undo. Ground every claim in the decisions listed; if there are too few decisions to say anything, say exactly that. Integrate with the previous note, don't append.`;

export async function tasteDigest(store: Store, projectId: string): Promise<void> {
  const db = (store as any).db;
  const rows = (db.prepare("SELECT ts, kind, detail FROM audit_log WHERE kind IN ('reorganize','suggestion_done','suggestion_dismissed','undo','import_applied','autolit_applied') OR kind LIKE '%apply%' ORDER BY id DESC LIMIT 40").all() as any[]);
  if (rows.length < 3) return;
  const prev = store.getSetting(`taste:${projectId}`) ?? '';
  try {
    const text = await call({
      task: 'memory', system: TASTE_SYSTEM, maxTokens: 250, timeoutMs: 60_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `RECENT DECISIONS (newest first):\n${rows.map((r) => `${r.ts} ${r.kind}: ${String(r.detail).slice(0, 100)}`).join('\n')}`,
        prev ? `PREVIOUS NOTE:\n${prev}` : '',
        'Write the taste note.',
      ].filter(Boolean).join('\n\n'),
    });
    if (text && typeof text === 'string') store.setSetting(`taste:${projectId}`, text.slice(0, 900));
  } catch (err) { console.error('[taste] digest failed:', err); }
}

// One brain cycle: scan (free) → assess changed areas (cheap, ≤4) →
// synthesize if anything changed (smart). Debounced by the caller.
export async function brainCycle(store: Store, projectId: string): Promise<{ assessed: number; synthesized: boolean }> {
  const db = (store as any).db;
  const scan = runContentScan(store, projectId);
  const have = new Map<string, string>((db.prepare('SELECT chapter_id, updated_at FROM chapter_assessments WHERE project_id = ?').all(projectId) as any[]).map((r: any) => [r.chapter_id, r.updated_at]));
  const changed = scan.chapters
    .filter((c) => { const a = have.get(c.id); return !a || (c.newestChange && c.newestChange.replace('T', ' ').slice(0, 19) > a); })
    .sort((a, b) => (b.newestChange > a.newestChange ? 1 : -1))
    .map((c) => c.id);
  const assessed = changed.length ? await assessChapters(store, projectId, changed) : 0;
  let synthesized = false;
  if (assessed > 0 || !getUnderstanding(store, projectId)) {
    const r = await synthesizeOverallStatus(store, projectId);
    synthesized = !('error' in r);
  }
  return { assessed, synthesized };
}

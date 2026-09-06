import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call, modelFor } from '../inference.js';
import { loadMap, renderTieredTreeForSubtree, descendantNodes } from '../map/render.js';

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
    while (p && byId.has(p) && d < 256) { d++; p = byId.get(p)!.parentId; } // bounded: a parent cycle is not infinite depth
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
  // M195c (Jacob): agents are consulted with the brain's actual suggestions
  // for their job AND the trimmed report, so influence is comprehensive; the
  // two come from the same synthesis cycle, so they are coherent by
  // construction (and the charter binds the advice to the report).
  const advice = sec('advice_chat', 1400);
  const parts = [
    sec('keystones', 350) ? `load-bearing decisions: ${sec('keystones', 350)}` : '',
    sec('tensions', 300) ? `currently contested: ${sec('tensions', 300)}` : '',
    sec('trust', 450) ? `area reliability: ${sec('trust', 450)}` : '',
    advice ? `its advice for chat: ${advice}` : '',
  ].filter(Boolean);
  return parts.length ? `WHAT THE MAP HOLDS (the map's own standing judgment — includes set-aside areas; use it to recognize what exists and offer to pull things up, never to answer from it directly):\n${parts.join('\n')}` : '';
}

export function statusConsult(store: Store, projectId: string, forNodeId?: string, lane: 'full' | 'tidy' | 'filing' | 'lighting' | 'review' = 'full'): string {
  const s = getMapStatus(store, projectId);
  const u = getUnderstanding(store, projectId);
  const parts: string[] = [];
  if (u && lane !== 'tidy') {
    // M195c (Jacob): the agent receives the brain's actual advice for its job
    // AND the trimmed report, so influence is comprehensive — both from the
    // same cycle, so coherent.
    const sec = (k: string, label: string, cap = 400) => { const x = u.sections[k]; return x?.text ? `${label}: ${x.text.slice(0, cap)}` : ''; };
    const adviceKey = lane === 'filing' ? 'advice_filing' : lane === 'review' ? 'advice_review' : 'advice_lighting';
    const advice = (u.sections[adviceKey]?.text ?? '').slice(0, 1800);
    parts.push(`THE OVERALL MAP STATUS REPORT, trimmed (consult it; the user's preferences still outrank it):`);
    parts.push([sec('essence', 'what this project is', 350), sec('arc', 'where the work is heading', 350), sec('tensions', 'live tensions', 400), sec('keystones', 'keystones', 300), sec('gaps', 'known gaps', 300)].filter(Boolean).join('\n'));
    if (advice) parts.push(`ITS ADVICE FOR THIS JOB (written from the same judgment — follow it unless the user's own words say otherwise):\n${advice}`);
  }
  {
    // The consulting agent's working area gets its chapter assessment (tiered consultation).
    if (forNodeId) {
      const db = (store as any).db;
      let p: string | null | undefined = forNodeId;
      let chapter: string | null = null;
      const hops = new Set<string>();
      while (p && !hops.has(p)) { hops.add(p); const n = store.getNode(p); if (!n) break; if (!n.parentId || !store.getNode(n.parentId)?.parentId) { chapter = n.parentId ? p : p; break; } p = n.parentId; }
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
    const out: typeof nodes = []; const st = [...(kids.get(id) ?? [])]; const seen = new Set<string>([id]);
    while (st.length) { const x = st.pop()!; if (seen.has(x.id)) continue; seen.add(x.id); out.push(x); st.push(...(kids.get(x.id) ?? [])); }
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

// M195g (Jacob: "why on earth ... the whole thing in 150 words?"): the flat
// 150-word cap was the builder's number and it contradicted Jacob's own rule
// — size scales with what the area holds, at EVERY layer. An assessment's
// length now follows the area's size, and a chapter that dominates the map
// is assessed by its parts (one level down), so depth never has to fit
// through a fixed keyhole.
const ASSESS_SYSTEM = `You are the content-status agent for a goal map — one of the map status agent's reporters. For each AREA given, write its chapter assessment at the size given for it (larger areas deserve longer assessments — never pad a small one), covering: what this area holds (name the actual subjects, not categories), how current it is (are settled things marked settled; is anything contested), where it is thin (little remembered detail), and anything odd. Ground every claim in the material shown. Plain words. Return one assessment per area.`;

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
  const totalNodes = scan?.chapters.reduce((a, c) => a + c.nodes, 0) ?? 0;
  const subtreeSize = (id: string): number => descendantNodes(store, id).length + 1;
  // Words/tokens/slice budgets follow the area's size (Jacob's rule at every layer).
  const sizing = (n: number) => n <= 25
    ? { words: '100-150 words', maxTokens: 600, cap: 1200, slice: 9000 }
    : n <= 80
      ? { words: '200-300 words', maxTokens: 1100, cap: 2400, slice: 16000 }
      : { words: '350-500 words', maxTokens: 1800, cap: 4000, slice: 28000 };
  const assessOne = async (cid: string, nodeCount: number, extra?: string): Promise<boolean> => {
    const node = store.getNode(cid);
    if (!node) return false;
    const sz = sizing(nodeCount);
    const slice = renderTieredSlice(store, projectId, cid, sz.slice);
    const stats = scan?.chapters.find((c) => c.id === cid);
    const prev = (db.prepare('SELECT text FROM chapter_assessments WHERE project_id = ? AND chapter_id = ?').get(projectId, cid) as any)?.text ?? '';
    try {
      const parsed = await call({
        task: 'mapcheck', system: ASSESS_SYSTEM, maxTokens: sz.maxTokens, schema: ASSESS_SCHEMA as any, timeoutMs: 120_000,
        audit: (k, d) => store.audit(k, d),
        user: [
          `AREA [${cid.slice(0, 8)}]: ${node.title || node.content}`,
          `SIZE FOR THIS ASSESSMENT: ${sz.words} (the area holds ${nodeCount} nodes).`,
          stats ? `MEASURED: ${stats.nodes} nodes, ${stats.withMinimal} with one-line versions, ${stats.details} remembered specifics, ${stats.settled} settled, ${stats.staleMinimals} with stale compressions, newest change ${stats.newestChange}` : '',
          extra ?? '',
          `THE AREA (tiered):\n${slice}`,
          prev ? `YOUR PREVIOUS ASSESSMENT (integrate, don't append):\n${prev}` : '',
          'Write the chapter assessment.',
        ].filter(Boolean).join('\n\n'),
      });
      const a = (parsed.assessments ?? [])[0];
      if (a?.text) {
        db.prepare(`INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(project_id, chapter_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`).run(projectId, cid, String(a.text).slice(0, sz.cap));
        return true;
      }
    } catch (err) { console.error('[assess] chapter failed:', err); }
    return false;
  };
  let done = 0;
  for (const cid of chapterIds.slice(0, 4)) {
    const count = subtreeSize(cid);
    const dominant = count > 120 || (totalNodes > 0 && count > totalNodes * 0.4 && count > 40);
    if (!dominant) {
      if (await assessOne(cid, count)) done++;
      continue;
    }
    // A dominant chapter is assessed BY ITS PARTS (one level down): its
    // largest direct-child subtrees each get their own sized assessment,
    // stalest first; the chapter's own row becomes the mechanical roll-up
    // naming the parts, so the synthesis reads parts, not a keyhole.
    const node = store.getNode(cid);
    if (!node) continue;
    const children = (store.getNodes(projectId) as any[]).filter((n) => n.parentId === cid && n.status !== 'removed');
    const parts = children.map((c) => ({ id: c.id, name: (c.title || String(c.content).slice(0, 40)), n: subtreeSize(c.id) }))
      .filter((p2) => p2.n >= 8).sort((x, y) => y.n - x.n).slice(0, 12);
    const staleness = new Map<string, string>((db.prepare('SELECT chapter_id, updated_at FROM chapter_assessments WHERE project_id = ?').all(projectId) as any[]).map((r: any) => [r.chapter_id, r.updated_at]));
    const queue = [...parts].sort((x, y) => (staleness.get(x.id) ?? '0').localeCompare(staleness.get(y.id) ?? '0'));
    let partDone = 0;
    for (const p2 of queue.slice(0, 8)) {
      if (await assessOne(p2.id, p2.n, `THIS AREA IS PART of the larger "${node.title || node.content}" chapter, assessed by its parts.`)) { done++; partDone++; }
    }
    const rollup = `Assessed by its parts (${count} nodes total): ${parts.map((p2) => `${p2.name} (${p2.n})`).join(' · ')}. Read the parts' own assessments for content.`;
    db.prepare(`INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(project_id, chapter_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`).run(projectId, cid, rollup.slice(0, 1200));
    if (partDone) done++;
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

const OVERALL_SYSTEM = `You are the map status agent writing the OVERALL MAP STATUS REPORT — the one coherent judgment of a goal map. Your reporters hand you: the structure report, chapter assessments covering every area, a taste note (what the user has accepted and rejected lately), THE USER'S OWN RECENT EDITS (the highest authority in this system — a user edit outranks every other input including your prior text and stale assessments), and your own previous overall report. Reconcile them — where reports pull opposite ways, decide; where nothing changed, keep your prior text — but keeping prior text is NEVER allowed to preserve a claim that any current input contradicts, and a user edit that settles or reverses something must update every section that mentioned it, this cycle, even if the chapter assessments have not caught up yet.

Write the overall report as these sections, each self-contained, plain words, grounded in the reports (never invent):
- essence: what this project IS — its thesis and standing doctrine. Stable; amend only on real change.
- arc: what the work is converging toward; which open question actually blocks; what the user keeps returning to.
- tensions: places the map asserts incompatible things, worst first. Empty is a fine answer.
- keystones: the few decisions everything else stands on.
- gaps: what the map should contain and doesn't — unanswered questions, unrecorded decisions, and where the map has not been fed lately.
- trust: one line per area — where the map is reliable vs thin, contested, or old.

Each section at its natural size; judgment scales with what is genuinely contested, not with map size.

Two rules learned from your own first run (both were real failures, caught by the user):
- INTERNAL CONSISTENCY: a claim that something is open, blocking, or contested must survive your OWN trust judgments. Where you have judged status markers unreliable, you may not assert openness as fact — say "recorded as open, but the markers are unreliable" and rank it accordingly. Never trust in one section what you distrust in another.
- DATES, NOT PROMINENCE: claims about what is current must stand on dates and statuses, never on how large or wide a node is. A fat chapter is not the present; it may be exactly the misfiled past your structure report warns about.
- NUMBERS BEFORE NARRATIVE: you may never assert an absence the measured numbers contradict. If the scan counts nodes and stored memories in an area, "nothing landed there" is a forbidden sentence; write what the numbers allow.

THE MINIMUM WORK (Jacob: a minimum budget that must be used in full — denominated in obligations, not words): before any section, write your RECONCILIATION, and it must cover, by name, EVERY input you were handed — the structure report, each assessed area, the historical report, the user's edits, the taste note, the user's standing guidance, the import verification findings, and your own previous text — one plain line each: what it says, whether you accept, reject, or partly accept it, and why; and quote the measured numbers you checked your story against. No section may contradict your reconciliation. This is the floor of every cycle; it cannot be met by padding because it is met by coverage.

Then write your ACTUAL ADVICE, per job. Each working agent is consulted with a trimmed version of the report above PLUS your suggestions for its specific job — the two travel together, so they must be coherent: advise nothing the report does not support, and put everything an agent must act on into its advice, in plain imperative words, only what that job can act on. Empty is a fine answer when you have nothing to advise:
- advice_filing: for the agent filing new conversation material onto nodes — where new or contested material should go, which areas not to trust, what incoming claims to double-check against settled decisions.
- advice_lighting: for the light and focus decisions — what deserves light now and why, what should stay set aside, where the user's attention keeps returning.
- advice_review: for the agents reviewing structure and finishing imports — what to verify first, where the known rot or staleness is, what a finished import must not disturb.
- advice_chat: for the chat agent — what exists on this map (set-aside areas included) that it should recognize when the user touches it and offer to pull up, never answer from directly; and which recorded decisions are settled so it never reopens them.`;

const OVERALL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reconciliation', 'essence', 'arc', 'tensions', 'keystones', 'gaps', 'trust', 'advice_filing', 'advice_lighting', 'advice_review', 'advice_chat'],
  properties: { reconciliation: { type: 'string' }, essence: { type: 'string' }, arc: { type: 'string' }, tensions: { type: 'string' }, keystones: { type: 'string' }, gaps: { type: 'string' }, trust: { type: 'string' }, advice_filing: { type: 'string' }, advice_lighting: { type: 'string' }, advice_review: { type: 'string' }, advice_chat: { type: 'string' } },
} as const;

export function getUnderstanding(store: Store, projectId: string): Understanding | null {
  const raw = store.getSetting(`understanding:${projectId}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function synthesizeOverallStatus(store: Store, projectId: string, extraInput?: string): Promise<Understanding | { error: string }> {
  const db = (store as any).db;
  const status = getMapStatus(store, projectId);
  const assessments = (db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]);
  const taste = store.getSetting(`taste:${projectId}`) ?? '';
  const prev = getUnderstanding(store, projectId);
  const prefs = store.getSetting(`prefs:${projectId}`) ?? '';
  // The user's own recent edits — the highest-authority reporter (learned
  // when a user correction failed to propagate past stale assessments).
  const fmtEvent = (r: any): string | null => { try { const a = JSON.parse(r.alteration); const n = a.id ? store.getNode(a.id) : null; return `${r.created_at} [${r.source_kind}]: ${a.op} on "${(n?.title || n?.content || a.id || '?').slice(0, 50)}"${a.status ? ` → status ${a.status}` : ''}${a.content ? ` → "${String(a.content).slice(0, 120)}"` : ''}`; } catch { return null; } };
  const userEdits = (db.prepare("SELECT alteration, created_at, source_kind FROM map_events WHERE project_id = ? AND source_kind = 'user_edit' ORDER BY seq DESC LIMIT 15").all(projectId) as any[])
    .map(fmtEvent).filter(Boolean).join('\n');
  // M195d (Jacob): history reaches the synthesis as the historical-status
  // agent's REPORT, not as raw events.
  const historyReport = store.getSetting(`historystatus:${projectId}`) ?? '';
  try {
    const parsed = await call({
      // Jacob's ruling: the brain gets the smartest model — synthesis is the
      // one judgment everything else consults.
      task: 'mapcheck', modelOverride: modelFor('import'),
      // Jacob: the understanding gets a much larger budget.
      system: OVERALL_SYSTEM, maxTokens: 16000, schema: OVERALL_SCHEMA as any, timeoutMs: 240_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        (() => { try { const sc = JSON.parse(store.getSetting(`contentscan:${projectId}`) ?? 'null'); return sc ? `THE MEASURED NUMBERS (mechanical scan, ${sc.ts} — check every claim against these):\n${sc.chapters.map((c: any) => `${c.name}: ${c.nodes} nodes, ${c.withMinimal} with one-line versions, ${c.withMedium} with summaries, ${c.details} remembered specifics, ${c.settled} settled, newest change ${c.newestChange}`).join('\n')}` : ''; } catch { return ''; } })(),
        status ? `STRUCTURE REPORT (${status.ts}):\n${status.health}\n${status.findings.map((f) => `- ${f.what} (fix: ${f.fix})`).join('\n')}\n${status.opinion}` : 'STRUCTURE REPORT: none yet.',
        `CHAPTER ASSESSMENTS (every area):\n${assessments.map((a) => {
          const n = store.getNode(a.chapter_id);
          return `[${(n?.title || n?.content || a.chapter_id).slice(0, 40)}] (${a.updated_at}): ${a.text}`;
        }).join('\n\n').slice(0, 120_000) || '(none yet)'}`,
        userEdits ? `THE USER'S RECENT EDITS (highest authority — these outrank stale assessments and your prior text):\n${userEdits}` : '',
        historyReport ? `HISTORICAL-STATUS REPORT (how this map came to be — from the historical-status agent):\n${historyReport}` : 'HISTORICAL-STATUS REPORT: none yet.',
        taste ? `TASTE NOTE (from the user's recent accept/reject decisions):\n${taste}` : '',
        prefs ? `THE USER'S MAP PREFERENCES:\n${prefs}` : '',
        (store.getSetting(`braintuning:${projectId}`) ?? '') ? `THE USER'S STANDING GUIDANCE TO YOU (their spoken tuning, given to you directly — outranked only by their edits):\n${store.getSetting(`braintuning:${projectId}`)}` : '',
        prev ? `YOUR PREVIOUS UNDERSTANDING:\n${Object.entries(prev.sections).map(([k, v]) => `${k} (${v.ts}): ${v.text}`).join('\n\n')}` : '',
        // Unresolved import verification findings ride every synthesis until
        // a later verify passes (the mutual-revision loop, Jacob's ruling).
        (() => { try { const c = JSON.parse(store.getSetting(`importcheck:${projectId}`) ?? 'null'); return c && !c.similar ? `IMPORT VERIFICATION FINDINGS (unresolved — the finished import did not yet match its source summary; address report-side findings in your sections, and carry map-side findings in gaps and your advice so filing and tidy can heal them):\n${(c.discrepancies ?? []).map((d: any) => `- [${d.side}] ${d.what} (fix: ${d.fix})`).join('\n')}` : ''; } catch { return ''; } })(),
        extraInput ?? '',
        'Write the understanding.',
      ].filter(Boolean).join('\n\n'),
    });
    const now = new Date().toISOString();
    const prevS = prev?.sections ?? {};
    const sections: Understanding['sections'] = {};
    for (const k of ['reconciliation', 'essence', 'arc', 'tensions', 'keystones', 'gaps', 'trust', 'advice_filing', 'advice_lighting', 'advice_review', 'advice_chat']) {
      const text = String((parsed as any)[k] ?? "").slice(0, 12000);
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
  await historyStatus(store, projectId);
  let synthesized = false;
  if (assessed > 0 || !getUnderstanding(store, projectId)) {
    const r = await synthesizeOverallStatus(store, projectId);
    synthesized = !('error' in r);
  }
  return { assessed, synthesized };
}


// M195c (Jacob): "the import is successful only after the map status report
// produces a similar enough report afterward. If not there need to be mutual
// revisions/adjustment." After an import is applied and the brain cycle has
// run, the finished map's overall report is judged against the import's own
// comprehensive source summary. Report-side findings trigger one immediate
// resynthesis (the report revises); map-side findings persist as unresolved
// verification findings that ride every synthesis — into gaps and advice —
// until filing/tidy heal the map and a later verify passes.
const VERIFY_SYSTEM = `You judge whether an import landed. You get: THE SOURCE SUMMARY (the comprehensive summary of the original source, written at import time — the standard) and THE OVERALL MAP STATUS REPORT (what the map now understands itself to hold). Decide: does the report show the map holding what the source held — the same subjects, the same key decisions and reversals, the same latest state? Judge substance, never wording. Return:
- similar: true only if someone reading just the report would not be misled about anything significant the source contains.
- discrepancies: each significant mismatch — { what: one plain sentence; side: "map" when the map is missing or misplacing something the source holds, "report" when the map likely holds it but the report under- or mis-represents it; fix: one sentence naming the mechanism (file X under Y, a tidy of Z, the report's trust section should say W) }. Empty when similar.`;

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['similar', 'discrepancies'],
  properties: { similar: { type: 'boolean' }, discrepancies: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['what', 'side', 'fix'],
    properties: { what: { type: 'string' }, side: { type: 'string', enum: ['map', 'report'] }, fix: { type: 'string' } },
  } } },
} as const;

export interface ImportCheck { similar: boolean; discrepancies: { what: string; side: 'map' | 'report'; fix: string }[]; ts: string; pass: number }

export function getImportCheck(store: Store, projectId: string): ImportCheck | null {
  const raw = store.getSetting(`importcheck:${projectId}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function verifyImport(store: Store, projectId: string): Promise<ImportCheck | null> {
  const sourceSummary = store.getSetting(`importsummary:${projectId}`) ?? '';
  if (!sourceSummary) return null;
  const judge = async (): Promise<ImportCheck | null> => {
    const u = getUnderstanding(store, projectId);
    if (!u) return null;
    const report = Object.entries(u.sections).filter(([k]) => !k.startsWith('advice_') && k !== 'reconciliation').map(([k, v]) => `${k}: ${v.text}`).join('\n\n');
    try {
      const parsed = await call({
        task: 'mapcheck', modelOverride: modelFor('import'),
        system: VERIFY_SYSTEM, maxTokens: 3000, schema: VERIFY_SCHEMA as any, timeoutMs: 240_000,
        audit: (k, d) => store.audit(k, d),
        user: `THE SOURCE SUMMARY (the standard):\n${sourceSummary}\n\nTHE OVERALL MAP STATUS REPORT (the map now):\n${report}\n\nJudge.`,
      }) as any;
      return { similar: !!parsed.similar, discrepancies: (parsed.discrepancies ?? []).slice(0, 12), ts: new Date().toISOString(), pass: 0 };
    } catch (err) { console.error('[import verify] failed:', err); return null; }
  };
  let check = await judge();
  if (!check) return null;
  check.pass = 1;
  store.setSetting(`importcheck:${projectId}`, JSON.stringify(check));
  if (!check.similar && check.discrepancies.some((d) => d.side === 'report')) {
    // Mutual revision, report side, once: resynthesize with the findings in
    // hand, then judge again. Map-side findings stay for the healing loop.
    await synthesizeOverallStatus(store, projectId);
    const again = await judge();
    if (again) { again.pass = 2; check = again; store.setSetting(`importcheck:${projectId}`, JSON.stringify(check)); }
  }
  store.audit('import_verified', { similar: check.similar, discrepancies: check.discrepancies.length, pass: check.pass });
  return check;
}

// M195c (Jacob): "User should also be able to talk directly to the map
// status agent to tune it." The direct line (M77 precedent: advisory, never
// edits): the user speaks, the map status agent answers from its full
// understanding, and the exchange is distilled into standing guidance that
// rides every future synthesis — the user's spoken tuning, second only to
// their edits.
const BRAIN_CHAT_SYSTEM = `You are the map status agent — the one mind that holds the coherent understanding of this goal map, whose report and advice all the working agents consult. The USER is speaking to you directly, to tune you: correct your judgments, tell you what to watch, what to stop flagging, how to weigh things. Answer them plainly and briefly (this is a conversation, not a report), grounded in your actual current understanding — and when they correct you, say what you will do differently, never defend a mistake. You change nothing on the map and propose nothing here; you only explain yourself and take tuning.

Then rewrite YOUR STANDING GUIDANCE: the durable instructions you carry from everything this user has ever told you directly, updated with this exchange — integrate, don't append; drop what they have retracted; keep it under ~200 words of plain imperatives. This guidance rides into every future synthesis you write.`;

const BRAIN_CHAT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'guidance'],
  properties: { reply: { type: 'string' }, guidance: { type: 'string' } },
} as const;

export async function brainChat(store: Store, projectId: string, text: string): Promise<{ reply: string; guidance: string } | { error: string }> {
  const u = getUnderstanding(store, projectId);
  const status = getMapStatus(store, projectId);
  const tuning = store.getSetting(`braintuning:${projectId}`) ?? '';
  try {
    const parsed = await call({
      task: 'mapcheck', modelOverride: modelFor('import'),
      system: BRAIN_CHAT_SYSTEM, maxTokens: 2000, schema: BRAIN_CHAT_SCHEMA as any, timeoutMs: 180_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        u ? `YOUR CURRENT UNDERSTANDING:\n${Object.entries(u.sections).map(([k, v]) => `${k}: ${v.text.slice(0, 2000)}`).join('\n\n')}` : 'YOUR CURRENT UNDERSTANDING: none written yet.',
        status ? `YOUR STRUCTURE REPORT: ${status.health} ${status.opinion}` : '',
        tuning ? `YOUR STANDING GUIDANCE (as it stands):\n${tuning}` : 'YOUR STANDING GUIDANCE: none yet.',
        `THE USER SAYS:\n${text.slice(0, 4000)}`,
        'Reply, then rewrite the standing guidance.',
      ].filter(Boolean).join('\n\n'),
    }) as any;
    const reply = String(parsed.reply ?? '').slice(0, 4000);
    const guidance = String(parsed.guidance ?? '').slice(0, 2000);
    if (guidance) store.setSetting(`braintuning:${projectId}`, guidance);
    store.audit('map_status_chat', { chars: text.length });
    return { reply, guidance };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

// M195d (Jacob's correction): the synthesis must not read raw change history
// — a HISTORICAL-STATUS agent digests it and reports alongside the
// structure-status and content-status agents. Mechanical gather below,
// bounded judgment on top, stored and refreshed on the same rhythms.
const HISTORY_SYSTEM = `You are the historical-status agent for a goal map — one of the map status agent's reporters. From the change records given (recent events verbatim, complete daily aggregates over the map's whole life, import records), write the map's biography as a report (at most ~250 words, most significant first): how this map came to be (imports: when, from what, how large), its rhythm of activity and quiet, when it was last actually fed and from what, the user's recent corrections, and anything odd in the pattern (mass changes, long silences, unfed frontiers). Ground every claim in the records; integrate with your previous report, don't append.`;

export async function historyStatus(store: Store, projectId: string): Promise<void> {
  const db = (store as any).db;
  const maxSeq = (db.prepare('SELECT MAX(seq) s FROM map_events WHERE project_id = ?').get(projectId) as any)?.s ?? 0;
  const lastSeq = Number(store.getSetting(`historyseq:${projectId}`) ?? -1);
  if (maxSeq === lastSeq) return; // nothing new — no call
  const fmtEvent = (r: any): string | null => { try { const a = JSON.parse(r.alteration); const n = a.id ? store.getNode(a.id) : null; return `${r.created_at} [${r.source_kind}]: ${a.op} "${(n?.title || n?.content || a.id || '?').slice(0, 45)}"${a.status ? ` → ${a.status}` : ''}`; } catch { return null; } };
  const recent = (db.prepare('SELECT alteration, created_at, source_kind FROM map_events WHERE project_id = ? ORDER BY seq DESC LIMIT 30').all(projectId) as any[]).map(fmtEvent).filter(Boolean).join('\n');
  const aggregates = (db.prepare('SELECT substr(created_at, 1, 10) day, source_kind, COUNT(*) c FROM map_events WHERE project_id = ? GROUP BY day, source_kind ORDER BY day DESC').all(projectId) as any[])
    .map((r: any) => `${r.day}: ${r.c} via ${r.source_kind}`).join('\n');
  const imports = (db.prepare("SELECT ts, detail FROM audit_log WHERE kind = 'import_applied' ORDER BY id DESC LIMIT 10").all() as any[])
    .map((r: any) => `${r.ts}: ${String(r.detail).slice(0, 120)}`).join('\n');
  const prev = store.getSetting(`historystatus:${projectId}`) ?? '';
  try {
    const text = await call({
      task: 'memory', system: HISTORY_SYSTEM, maxTokens: 500, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `RECENT EVENTS:\n${recent}`,
        `COMPLETE DAILY AGGREGATES:\n${aggregates.slice(0, 4000)}`,
        `IMPORT RECORDS:\n${imports || '(none recorded)'}`,
        prev ? `YOUR PREVIOUS REPORT:\n${prev}` : '',
        'Write the historical-status report.',
      ].filter(Boolean).join('\n\n'),
    });
    if (typeof text === 'string' && text) {
      store.setSetting(`historystatus:${projectId}`, text.slice(0, 1800));
      store.setSetting(`historyseq:${projectId}`, String(maxSeq));
    }
  } catch (err) { console.error('[history-status] failed:', err); }
}

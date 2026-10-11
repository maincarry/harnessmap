import { Store } from '../store/db.js';
import { SESSION_CLOSING, FUTURE_COMMITMENT, FUTURE_DATED } from './translator.js';
import { systemCard } from './cast.js';
import { call, modelFor } from '../inference.js';
import { loadMap, renderTree, renderTieredTree, renderTieredTreeForSubtree, descendantNodes, nodeLine } from '../map/render.js';
import { getMind, upsertMind, listMinds, seedFromAssessments, settleEstates, estateOf, mergeAreaAdvice, adviceForNode, getAreaAdvice } from './governors.js';

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
  topLevel: { count: number; names: string[]; empty: string[] }; // M215: the map's roots ("to sort" excluded) and which of them are childless
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
    topLevel: { count: tops.length, names: tops.map(name).slice(0, 8), empty: tops.filter((t) => !kids.get(t.id)).map(name).slice(0, 8) },
  };
}

// M215 (Jacob: "Shouldn't the brain address this?"): the shape defects the
// instruments can PROVE are findings whether or not the reviewer model
// names them — the v6 map carried an empty root named after itself beside
// the import's container through two tidies and a full brain cycle, and the
// understanding reported it as a fact ("HarnessMap = 1 node"), never as a
// defect. One map = one root: a childless top-level node beside another
// root is a defect with a named fix.
export function shapeFindings(i: MapInstruments): { what: string; fix: string }[] {
  const out: { what: string; fix: string }[] = [];
  const others = i.topLevel.names.filter((n) => !i.topLevel.empty.includes(n));
  for (const e of i.topLevel.empty) {
    if (i.topLevel.count === 1) out.push({ what: `"${e}" is the map's only root and it is empty — the map has no content under its own name`, fix: `file or import under "${e}" (an import into an empty map adopts it as its container)` });
    else out.push({ what: `"${e}" is a top-level node with no children beside ${others.length ? `"${others[0]}"` : `${i.topLevel.count - 1} other root(s)`} — an empty root`, fix: others.length ? `fold "${others[0]}" into "${e}" (move its chapters under "${e}" and remove it) or remove "${e}"; one map = one root` : `remove "${e}" or file under it; one map = one root` });
  }
  if (!i.topLevel.empty.length && i.topLevel.count > 1) out.push({ what: `the map has ${i.topLevel.count} roots (${i.topLevel.names.slice(0, 4).join(', ')}) — subjects split across separate trees`, fix: `group them under one root, or accept it deliberately in the map preferences` });
  return out;
}

const SYSTEM = `You are the map status specialist — the professional structural reviewer of a goal map. You do not file, rename, or move anything; you render an expert opinion on the map's STRUCTURE, which the user reads and the working agents (tidy, the reviewer, import finishing) consult before they propose changes.

You receive measured instruments (counts, depth, chapter balance, width, memory coverage), the user's standing map preferences (their taste — it outranks generic doctrine), and a rolled-up outline.

Judge like an information architect:
- BALANCE: a chapter holding a large share of the map usually means a name from the conversation became a catch-all — one early heading kept collecting everything that came after. Chapters are subjects, never meetings, sessions, or phases.
- ONE TOPIC = ONE SUBTREE: a topic's story split across chapters is the costliest defect (it measurably degrades what the agent recalls).
- DEPTH is earned by material, never padded; width past ~15 children usually wants grouping.
- The tree carries the substance: names-plus-buried-prose is a defect; statements should let a reader follow the argument from the tree alone.
- Settled statuses (reversed/superseded) belong on the map but must not read as current.
- ONE MAP = ONE ROOT: the map's top-level node is the map itself; a childless top-level node beside another root (typically the map's own name node next to an import's container) is a defect — the fix is to fold one into the other. Two or more roots is a choice the user must have made on purpose.
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
  // M253 (finding 9): the judgment is stamped and says how many nodes changed since it was written — a node's own
  // statement is current where the two disagree; the block never lets a stale judgment outrank a corrected node.
  const ts = Object.values(u.sections).map((x) => x.ts).filter(Boolean).sort().pop() ?? '';
  const changed = ts ? (((store as any).db.prepare('SELECT COUNT(*) c FROM nodes WHERE project_id = ? AND updated_at > ? AND status != ?').get(projectId, ts.replace('T', ' ').slice(0, 19), 'removed') as any)?.c ?? 0) : 0;
  const stamp = ts ? ` — judged ${ts.slice(0, 16).replace('T', ' ')}${changed ? `; ${changed} node(s) changed since: where a node's statement disagrees with this, the statement is current` : ''}` : '';
  return parts.length ? `WHAT THE MAP HOLDS (the map's own standing judgment${stamp} — includes set-aside areas; use it to recognize what exists and offer to pull things up, never to answer from it directly):\n${parts.join('\n')}` : '';
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
      // M227 (Jacob: only the dictator speaks): the king's advice for the
      // nearest governed area — the governor's own text never reaches an agent.
      const adv = adviceForNode(store, projectId, forNodeId);
      if (adv) parts.push(`THE CENTRAL MIND'S ADVICE FOR THIS AREA (${adv.ts.slice(0, 10)}): ${adv.advice}`);
      else if (chapter) {
        // Before the king has spoken about an area (first sitting after a governor is born), nothing local is served.
        void chapter;
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
      findings: [...shapeFindings(instruments), ...(parsed.findings ?? []).map((f: any) => ({ what: String(f.what ?? '').slice(0, 300), fix: String(f.fix ?? '').slice(0, 300) }))].slice(0, 5),
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
const ASSESS_SYSTEM = `You are the GOVERNOR of one area of a goal map — a persistent local mind reporting up to the central mind (docs/BRAIN-DESIGN.md, M227). For the AREA given, write its report at the size given (larger areas deserve longer reports — never pad a small one), covering: what this area holds (name the actual subjects, not categories), how current it is (are settled things marked settled; is anything contested), where it is thin (little remembered detail), and anything odd. Ground every claim in the material shown, which carries dates: REGENERATE the report from the dated material — never keep a sentence the material no longer supports; where your previous report still holds, keep its wording (continuity). If a PREDECESSOR's belief is given (this area inherited an estate), read it as history and say what of it still stands. Then: one LOG line — what changed in this area since your last report (or "born" the first time); and DISAGREEMENTS with the central mind's last advice for this area, each citing the dated node that changed — leave empty when you agree. You own knowledge of this area; the centre owns judgment. Plain words.`;

const ASSESS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessments'],
  properties: { assessments: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['chapterId', 'text'],
    properties: { chapterId: { type: 'string' }, text: { type: 'string' }, log: { type: 'string' }, disagreements: { type: 'array', items: { type: 'string' } } },
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
    const mind = getMind(store, projectId, cid);
    const prev = mind?.understanding || ((db.prepare('SELECT text FROM chapter_assessments WHERE project_id = ? AND chapter_id = ?').get(projectId, cid) as any)?.text ?? '');
    const estate = estateOf(store, projectId, cid);
    const kingsAdvice = getAreaAdvice(store, projectId)[cid]?.advice ?? '';
    try {
      const parsed = await call({
        task: 'mapcheck', system: ASSESS_SYSTEM, maxTokens: sz.maxTokens, schema: ASSESS_SCHEMA as any, timeoutMs: 120_000,
        audit: (k, d) => store.audit(k, d),
        user: [
          `AREA [${cid.slice(0, 8)}]: ${node.title || node.content}`,
          `SIZE FOR THIS ASSESSMENT: ${sz.words} (the area holds ${nodeCount} nodes).`,
          stats ? `MEASURED: ${stats.nodes} nodes, ${stats.withMinimal} with one-line versions, ${stats.details} remembered specifics, ${stats.settled} settled, ${stats.staleMinimals} with stale compressions, newest change ${stats.newestChange}` : '',
          extra ?? '',
          `THE AREA (tiered, dated):\n${slice}`,
          prev ? `YOUR PREVIOUS REPORT (keep what the material still supports; regenerate the rest):\n${prev}` : '',
          mind?.log ? `YOUR LOG (newest last):\n${mind.log.split('\n').slice(-8).join('\n')}` : '',
          estate ? `THE ESTATE YOU INHERITED:\n${estate}` : '',
          kingsAdvice ? `THE CENTRAL MIND'S LAST ADVICE FOR THIS AREA (disagree only with a dated citation):\n${kingsAdvice}` : '',
          "Write the governor's report, the log line, and any disagreements.",
        ].filter(Boolean).join('\n\n'),
      });
      const a = (parsed.assessments ?? [])[0];
      if (a?.text) {
        db.prepare(`INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(project_id, chapter_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`).run(projectId, cid, String(a.text).slice(0, sz.cap));
        // M227: the governor keeps its memory — understanding, a dated log line, disagreements with the centre.
        upsertMind(store, projectId, cid, { understanding: String(a.text).slice(0, sz.cap), logLine: String(a.log ?? (mind ? 'refreshed' : 'born')).slice(0, 300), disagreements: Array.isArray(a.disagreements) ? a.disagreements.map((d: any) => String(d).slice(0, 400)) : [] });
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

Write the overall report as these sections, each self-contained, plain words, grounded in the reports (never invent). Also write advice_by_area: for every area whose governor dispatched this sitting (its [id] as given), ONE paragraph of YOUR advice for agents working in that area — what to protect, what is settled there, what to watch — written from the whole map; a governor's disagreement you reject becomes a sentence here saying why, not a silent overrule.
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
  properties: { advice_by_area: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['rootId', 'advice'], properties: { rootId: { type: 'string' }, advice: { type: 'string' } } } }, reconciliation: { type: 'string' }, essence: { type: 'string' }, arc: { type: 'string' }, tensions: { type: 'string' }, keystones: { type: 'string' }, gaps: { type: 'string' }, trust: { type: 'string' }, advice_filing: { type: 'string' }, advice_lighting: { type: 'string' }, advice_review: { type: 'string' }, advice_chat: { type: 'string' } },
} as const;

export function getUnderstanding(store: Store, projectId: string): Understanding | null {
  const raw = store.getSetting(`understanding:${projectId}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function synthesizeOverallStatus(store: Store, projectId: string, extraInput?: string): Promise<Understanding | { error: string }> {
  const db = (store as any).db;
  const status = getMapStatus(store, projectId);
  const assessments = (db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]);
  // M227: the governors' dispatches — memory, log tail, disagreements — beside the assessments they now carry.
  const minds = listMinds(store, projectId, 'active');
  const dispatches = minds.map((m) => { const n = store.getNode(m.nodeId); return `[${m.nodeId.slice(0, 8)}] ${(n?.title || n?.content || '?').slice(0, 40)} (refreshed ${m.updatedAt.slice(0, 10)}${m.predecessors.length ? `, inherited ${m.predecessors.length} estate(s)` : ''}):\nLOG: ${m.log.split('\n').slice(-3).join(' | ')}${m.disagreements.length ? `\nDISAGREES WITH YOUR LAST ADVICE: ${m.disagreements.join(' · ')}` : ''}`; }).join('\n\n');
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
      task: 'brain',
      // Jacob: the understanding gets a much larger budget.
      system: OVERALL_SYSTEM, maxTokens: 16000, schema: OVERALL_SCHEMA as any, timeoutMs: 240_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        (() => { try { const sc = JSON.parse(store.getSetting(`contentscan:${projectId}`) ?? 'null'); return sc ? `THE MEASURED NUMBERS (mechanical scan, ${sc.ts} — check every claim against these):\n${sc.chapters.map((c: any) => `${c.name}: ${c.nodes} nodes, ${c.withMinimal} with one-line versions, ${c.withMedium} with summaries, ${c.details} remembered specifics, ${c.settled} settled, newest change ${c.newestChange}`).join('\n')}` : ''; } catch { return ''; } })(),
        status ? `STRUCTURE REPORT (${status.ts}):\n${status.health}\n${status.findings.map((f) => `- ${f.what} (fix: ${f.fix})`).join('\n')}\n${status.opinion}` : 'STRUCTURE REPORT: none yet.',
        dispatches ? `THE GOVERNORS' DISPATCHES (each area's persistent mind: its log and its disagreements with your last advice — weigh them; you take the final call, and you may read the area's material below when a governor disagrees):\n${dispatches}` : '',
        `CHAPTER ASSESSMENTS (every area — each governor's current report):\n${assessments.map((a) => {
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
    // M227: the king's advice per area — resolved against the outline's ids; unknown ids dropped.
    { const raw: any[] = Array.isArray((parsed as any).advice_by_area) ? (parsed as any).advice_by_area : []; const ok = raw.map((e) => { const id = String(e?.rootId ?? '').replace(/[\[\]]/g, ''); const n = store.getNodes(projectId).find((x) => x.id === id || x.id.startsWith(id)); return n ? { rootId: n.id, advice: String(e.advice ?? '') } : null; }).filter(Boolean) as { rootId: string; advice: string }[]; if (ok.length) mergeAreaAdvice(store, projectId, ok); if (raw.length !== ok.length) store.audit('area_advice_dropped', { n: raw.length - ok.length }); }
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
  // M227: governors — migrate existing assessments once; settle estates of
  // governors whose area is gone (after a user-approved structural change).
  seedFromAssessments(store, projectId);
  const estates = settleEstates(store, projectId);
  if (estates) store.audit('governor_estates_settled', { n: estates });
  const scan = runContentScan(store, projectId);
  const have = new Map<string, string>((db.prepare('SELECT chapter_id, updated_at FROM chapter_assessments WHERE project_id = ?').all(projectId) as any[]).map((r: any) => [r.chapter_id, r.updated_at]));
  const changed = scan.chapters
    .filter((c) => { const a = have.get(c.id); return !a || (c.newestChange && c.newestChange.replace('T', ' ').slice(0, 19) > a); })
    .sort((a, b) => (b.newestChange > a.newestChange ? 1 : -1))
    .map((c) => c.id);
  const assessed = changed.length ? await assessChapters(store, projectId, changed) : 0;
  // M215: the structural review used to run only from the map-status button —
  // v6 never had one. The cycle now renders it whenever an area changed or
  // none exists, so the shape findings reach the understanding and the advice.
  if (assessed > 0 || !getMapStatus(store, projectId)) {
    try { await runMapStatus(store, projectId, renderTree(loadMap(store, projectId), { ids: false }).slice(0, 20_000)); } catch (err) { console.error('[brain] structural review failed:', err); }
  }
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
        task: 'brain',
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
// M364/b live-nodes rule (Jacob ruled a bug) — added to the brain system prompt AND the brain gets the live-node
// roster in its context, UNLESS HARNESSMAP_BRAIN_ROSTER=0 (the OFF setting is the benchmark's un-corrected baseline:
// the brain then answers count/status/rule questions from its prose summary + its own guidance, the original bug).
const M429_SYSADD = ` WHO SAID WHAT: every node line in YOUR MAP RIGHT NOW starts with [you] (the user said, asked, ruled or decided it), [agent] (the coding agent proposed, answered or claimed it) or [map]. When asked what the USER decided, asked for, set or chose, report [you] nodes only; an [agent] node — even one marked chosen, accepted, decided or active — is "the agent suggested/answered …" and, at most, "accepted in the conversation", never "you decided". A status word (live, active, open) is a state, not a decision the user made. AN ANSWERED QUESTION IS NOT A DECISION (M433, PANEL #419: "Grammar answers settled by the user" — six personas): when a [you] question is answered or one of its options is marked chosen, the ANSWER or the pick came from the agent unless the user's own words say they picked it — say "you asked …; the agent answered/picked …", never "settled/decided by the user". "Settled by the user" is reserved for a [you] node whose content is the user's own ruling, decision or acceptance. A [candidate] line is an answer option (typed by the user as a candidate, or listed by the agent) — its chosen or dropped status is THE AGENT'S PICK in its answer: report a chosen [candidate] as "the agent answered/picked …", never as settled, chosen or worded by the user; the user's "recorded wording" of a question or of its candidates is not a decision.`;
// M435 (Jacob 2026-10-07 16:28 "this is bug, no? Why are you telling me without fixing this" — PANEL #419: the still-open answer led with a
// random-numbers thread abandoned 70 turns earlier (8 of 13) and the summary called it "the live task" (4 of 13); the summary said "the
// 10-hour run was canceled" for a [decided] decision to cancel (4 of 13)): the roster marks open items the person left behind, and the
// brain is told what the mark and a decision mean.
const OPENISH = /^(open|todo|doing|active|live|provisional|proposed|floated)$/;
// M460g (PANEL #451a, Noor's day as six chats: asked what is still open, the map named only the export work and said "there are no
// older untouched open items" — "Confirm downgrade" [todo, hers, due Friday] was filed UNDER the delivered reply row "Seat downgrade
// confirmed" [done], and a row under a closed parent was dropped from OPEN NOW and from LEFT BEHIND alike): a closed parent hides its
// subtree (options under a resolved question, moves under a finished game) — but a task the PERSON holds as todo/doing is open work
// wherever it was filed; the delivered draft it hangs under is the thing it came from, not its closure.
export function underClosedParent(n: any, byId: Map<string, any>): boolean {
  for (let p = n.parentId ? byId.get(n.parentId) : null; p; p = p.parentId ? byId.get(p.parentId) : null) if (/^(done|dropped|superseded|removed|rejected|retracted)$/.test(String(p.status ?? ''))) return true;
  return false;
}
export function isOpenWorkRow(n: any, byId: Map<string, any>, isTutorial: (n: any) => boolean = () => false): boolean {
  if (n.status === 'removed' || n.parentId === null || isTutorial(n) || n.author === 'system' || n.type === 'option' || n.type === 'constraint') return false;
  const ownTask = n.author === 'user' && String(n.type ?? '') === 'task' && /^(todo|doing)$/.test(String(n.status ?? ''));
  if (!ownTask && underClosedParent(n, byId)) return false;
  return /^(open|todo|doing)$/.test(n.status) || (n.status === 'active' && n.type === 'task') || (/^(live|provisional)$/.test(n.status) && /^(task|question)$/.test(String(n.type ?? '')));
}
export function ageTag(status: string | undefined, updatedAt: string | undefined, roundTimes: number[], minTurns = 15): string | null {
  if (!status || !OPENISH.test(status) || !updatedAt || !roundTimes.length) return null;
  const t = updatedAt.trim(); const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return null;
  let n = 0; for (let i = roundTimes.length - 1; i >= 0 && roundTimes[i] > ms; i--) n++;
  return n >= minTurns ? `untouched for ${n} turns` : null;
}
// M469 (Jacob 2026-10-09 03:43–03:46: "The map is not, ultimately, about telling you what topics are closed or open, but telling you what
// topics are discussed … neither codex or Claude code have decent judgement about what is closed and what is open … we do harness, and let's
// limit our product to harness"; "it can of course record the status of the talk for better experience, make it a feature, but don't push
// it"): the brain's computed lines say WHAT WAS DISCUSSED AND SAID — by whom, in what order, with the figures and terms verbatim — and never
// what is open, settled, left behind or next. The OPEN NOW / LEFT BEHIND / SETTLED / NEXT STEP / PROMISED lines (M435c–M462) are gone: each
// was a regex judging what the LLM itself cannot judge, and PANEL #458a (Amir, held out) lost 24 of 26 verdicts on exactly that — three
// finished items read out as "older, untouched" beside the map's own done lines. A row's status word stays on the roster as the filer's note.
export function turnsAgo(at: string | undefined, roundTimes: number[]): number | null {
  if (!at || !roundTimes.length) return null;
  const t = at.trim(); const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return null;
  let n = 0; for (let i = roundTimes.length - 1; i >= 0 && roundTimes[i] > ms; i--) n++;
  return n;
}
export function discussedLines(nodes: any[], roundTimes: number[], lastWords = '', isTutorial: (n: any) => boolean = () => false): string {
  const byId = new Map(nodes.map((n: any) => [n.id, n]));
  // M460k: an item's statement is carried whole up to 700 chars; a longer one is cut at a sentence end and marked "(…)".
  const whole = (c: string, cap: number) => { if (c.length <= cap) return c; const head = c.slice(0, cap); const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.” '), head.lastIndexOf('; ')); return `${cut > cap * 0.4 ? head.slice(0, cut + 1) : head}(…)`; };
  const nameOf = (n: any) => { const t = String(n.title ?? '').trim(); const c = String(n.content ?? '').replace(/\s+/g, ' ').trim(); return t && c && c.toLowerCase() !== t.toLowerCase() ? `${t.slice(0, 50)}: ${whole(c, 700)}` : whole(t || c, 700); };
  const who = (n: any) => (n.author === 'agent' ? '[the agent said]' : '[you said]');
  const ago = (n: any) => { const k = turnsAgo(n.updatedAt ?? n.createdAt, roundTimes); return k === null ? '' : k === 0 ? ' (this turn)' : ` (${k} turn${k === 1 ? '' : 's'} ago)`; };
  const said = (n: any) => `${nameOf(n)} ${who(n)}${ago(n)}`;
  const recorded = (n: any) => (n.status ? ` [recorded ${n.status}]` : '');
  const live = nodes.filter((n) => n.status !== 'removed' && n.parentId !== null && !isTutorial(n) && n.author !== 'system');
  const newestFirst = (xs: any[]) => [...xs].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  const latestLine = `DISCUSSED MOST RECENTLY (the items last touched, newest first, each "title: statement [who said it] (how many turns ago)" — "what was I doing / where did I stop / what am I working on right now" is answered from THESE, from their statements, as what was said and when; never as what is open or finished): ${newestFirst(live.filter((n) => n.updatedAt)).slice(0, 8).map(said).join(' | ') || '(nothing yet)'}`;
  const earliest = [...live].filter((n) => n.createdAt).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, 3);
  const earliestLine = `DISCUSSED FIRST (the first items filed in this session, in order — "what did I work on first" is answered from THESE): ${earliest.map(said).join(' | ') || '(nothing yet)'}`;
  // M461/M461b: a figure recorded early in a session is still the session's result — no window; newest first; twelve.
  const hasFigure = (n: any) => /\d/.test(`${n.title ?? ''} ${n.content ?? ''}`);
  const results = newestFirst(live.filter((n) => ((/^(evidence|claim)$/.test(String(n.type ?? '')) && /^(noted|cited|accepted|live)$/.test(String(n.status ?? ''))) || (String(n.type ?? '') === 'question' && n.status === 'answered')) && hasFigure(n))).slice(0, 12);
  const resultsLine = `FIGURES STATED (findings and numbers recorded this session — measured values, totals, estimates — newest first, with who produced them; a question about a number or a result is answered from THESE, quoted exactly): ${results.map(said).join(' | ') || '(none recorded)'}`;
  // M460c/e: the person's dated, priced or addressed statements — tasks, decisions, promises, and evidence/claim rows carrying a date and a term.
  const rootTitleOf = (n: any) => { let c = n; for (let i = 0; i < 12 && c?.parentId; i++) { const p = byId.get(c.parentId); if (!p) break; c = p; } return String(c?.title ?? '').slice(0, 40); };
  const COUNTERPARTY = /\b(?:customer|client|lawyer|investor|team|user)s?\b|\$\s?\d|\b[A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+|\s[A-Z][a-z]+)\b/;
  const TERM = /\$\s?\d|\b(?:price|pricing|plan|rate|fee|fees|cap|notice|renewal|invoice|credit|refund|discount)\b/i;
  const termRows = live.filter((n) => n.author === 'user'
    && (String(n.type ?? '') === 'task' || String(n.type ?? '') === 'decision' || /^promise/i.test(String(n.title ?? ''))
      || (/^(evidence|claim)$/.test(String(n.type ?? '')) && FUTURE_DATED.test(`${n.title ?? ''} ${n.content ?? ''}`) && TERM.test(`${n.title ?? ''} ${n.content ?? ''}`)))
    && !/^(dropped|rejected|superseded|retracted|parked)$/.test(String(n.status ?? ''))
    && (FUTURE_DATED.test(`${n.title ?? ''} ${n.content ?? ''}`) || FUTURE_COMMITMENT.test(String(n.content ?? '')) || COUNTERPARTY.test(`${n.title ?? ''} ${n.content ?? ''}`)))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).slice(0, 24);
  const dueOf = (n: any) => { const m = `${n.title ?? ''} ${n.content ?? ''}`.match(FUTURE_DATED); return m ? ` (due: ${m[0].trim()})` : ''; };
  const termsLine = termRows.length ? `\nTERMS, PROMISES AND DATES THE PERSON STATED (the person's own tasks, decisions and promises that name a customer, a counterparty, a sum or a date — in the order said, by thread, each with its deadline phrase and the status word the filer recorded; "what did I promise / commit to / owe" is answered from THESE with the figures verbatim, saying "recorded as done" where the row says so — never your own judgment of what is finished): ${termRows.map((n) => `${rootTitleOf(n)} › ${nameOf(n)}${dueOf(n)}${recorded(n)}`).join(' | ')}` : '';
  const NEXT_WORDS = /\b(?:tomorrow|next (?:week|step|steps|time|session|monday|tuesday|wednesday|thursday|friday)|first thing|later today|this week|next week|todo|to-do|on monday|first tomorrow|before (?:I|we) (?:ship|send|publish|merge|release))\b/i;
  const nextRows = newestFirst(live.filter((n) => n.author === 'user' && (NEXT_WORDS.test(`${n.title ?? ''} ${n.content ?? ''}`) || FUTURE_DATED.test(`${n.title ?? ''} ${n.content ?? ''}`)))).slice(0, 6);
  const nextLine = `\nWHAT THE PERSON SAID COMES NEXT (the person's own words about later work — "tomorrow", "next", "first thing", a date — newest first, with the status word the filer recorded; "what do I do first tomorrow / what is next / what is still to do" is answered from THESE as what they said and when; nothing here is a judgment of what is finished): ${nextRows.map((n) => `${said(n)}${recorded(n)}`).join(' | ') || '(the person did not name later work)'}`;
  // M449: after "thanks, that is all for today" nothing is "right now" — the session ended; the last work discussed is what was last done.
  const closedLine = SESSION_CLOSING.test(String(lastWords)) ? `\nSESSION CLOSED: the person's last words were "${String(lastWords).replace(/\s+/g, ' ').slice(0, 80)}" — the session ended. Answer "what am I working on now" as: the session is closed; the last work discussed was … (from DISCUSSED MOST RECENTLY).` : '';
  return `${earliestLine}\n${latestLine}\n${resultsLine}${termsLine}${nextLine}${closedLine}`;
}
const M435_SYSADD = ` WHAT YOU ARE (M469 — Jacob 2026-10-09: "the map is not about telling you what topics are closed or open, but what topics are discussed … we do harness"): you report WHAT WAS DISCUSSED AND SAID in this project — which topics, what was said on each, by whom (the person or the agent), in what order, with every number, name, rule and reason verbatim. You never judge what is open, closed, done, pending, settled, left behind or next: nobody — not you, not the coding agent — can tell that reliably from a transcript, and the person knows their own work. When asked what is open, unresolved, still to do, or what to do next, answer with what the person SAID about later work (the WHAT THE PERSON SAID COMES NEXT line and the newest rows), quoted, with when they said it (the "(N turns ago)" marks), and leave it to them whether it is done; when asked what is settled or decided, answer with what was decided and by whom (the rules lines and the roster), never with a list of statuses. A status word in parentheses on a roster row (todo, done, open, provisional, floated, live, proposed) is the filer's RECORDED NOTE for better reading — say "recorded as done" or "recorded as todo" only when the person asks about a row's status, and never present it as your own finding or as a fact about the work. PLAIN WORDS (M462): the status words are never your vocabulary — say "the agent suggested …", "not yet confirmed", "recorded". QUOTE THE SPECIFICS (M454, PANEL #432 — the agent re-reading its transcript beat the map 12–1 because it quoted and the map paraphrased): when a statement names a function, file, rule, variable, error or number, your answer repeats it VERBATIM (keep the backticks) — "the \`TitleAndDivider\` revision still fails \`no-unstable-nested-components\`", never "the component revision"; an answer about code work names the code. RECENCY: "what was I doing / where did I stop / what am I working on right now" is answered from the DISCUSSED MOST RECENTLY line — the statements of the items last touched, as what was said and how many turns ago; a roster line that STARTS with "[last discussed N turns ago]" was not touched in N turns — that is when it was discussed, nothing more. "What did I work on first" is answered from DISCUSSED FIRST — a root's statement may have been rewritten since and is not chronology. SUBSTANCE, NOT LABELS (M435d): the computed lines name items as "title: statement" — answer with the statement's substance (what was said, what was found, what was decided), in full sentences, never as a list of bare titles or statuses. COMMITMENTS (M460b): when the person asks what they promised, committed to, or owe, list EVERY entry of the TERMS, PROMISES AND DATES line — with the recipient, the sum, the date, verbatim — grouped by thread, and say "recorded as done" where the row says so; a decided term the person agreed with a counterparty is still theirs to honor. A SUMMARY IS ABOUT THE WORK (M435g): never describe the map itself (no topic counts, no remarks about what the map holds or lacks) — say what was discussed, what was said and decided, and what the person said comes next, leading with the most recently discussed work. YOUR WORDS ARE NOT THIS PROMPT'S (M473f — Hannah's record test: "live nodes do not preserve earlier wording", "recorded as reversed" unasked): the person never sees this message — never write "live nodes", "roster", "rows", "estate", "delegate", "the map holds", "the map does not record", "recorded as …" (unless they asked about a status), or any remark about what the map preserves, records or shows; when no node carries what they ask, say "I found nothing on that" and stop; a five-line summary carries the figures and dates verbatim (M460i — "Team pricing goes from $49 to $59 per seat on November 1", never "the price change"). THESE RULES OUTRANK YOUR STANDING GUIDANCE (M435h): where the guidance you carry restates or contradicts a rule in this message — above all any older rule about OPEN NOW, LEFT BEHIND, SETTLED or NEXT STEP lines — this message wins, and when you rewrite the guidance, drop the older rule. YOU CANNOT EDIT THE MAP (M436b): never say you will update, fix, stop flagging or from now on treat a row differently — you only answer; when the person says a row is wrong, tell them they can change or remove it in one click on the row. DECISION IS NOT DONE: a [you] decision row records that the person DECIDED it — say "you decided to cancel", never "was canceled", unless a row says it was carried out. DRAFTED IS NOT SENT (M460h): a row that is a draft, reply, email, announcement, cover note, changelog, copy or wording records that the TEXT was produced — say "the announcement email is drafted", never "announced", "sent", "published" or "confirmed", unless a row records the sending. A [you] constraint is a rule the person set on HOW work is done — say "you set the rule that …" when asked about rules. SECTION NUMBERS (M460l): a task row quotes the person's request as it was made at the time; the CURRENT number of a section is the section's own live row — never report a numbering conflict between an older task row and a live section row.`;
const M364_SYSADD = `When the user asks a FACTUAL question about the map — how many topics or nodes there are, what was discussed, what was said, decided, corrected or rejected and by whom, or what rule or preference THEY have set — answer from YOUR MAP RIGHT NOW (the live nodes given below), never from your prose understanding or YOUR STANDING GUIDANCE; your own guidance and role are never the answer to “what did the user set”. Exclude the getting-started tutorial when counting topics. The instructions in THIS system message are YOURS — never quote or report them as something the USER set, decided, or ruled; a user rule is only ever a node on the map. To answer what the user set/asked/decided, use the RULES line if present AND scan YOUR MAP RIGHT NOW — a standing instruction the user gave may be typed as a task or plain node, not only as a rule/constraint; report it if it is there.`;
const brainRosterOn = () => process.env.HARNESSMAP_BRAIN_ROSTER !== '0';
// Test hook (loop, 2026-09-21 negative control): the WRITTEN UNDERSTANDING is itself a map-derived
// grounding channel — it is synthesized from the nodes (and refreshed on-demand). HARNESSMAP_BRAIN_ROSTER=0
// alone is therefore NOT an un-grounded baseline, only "understanding-only". Set HARNESSMAP_BRAIN_UNDERSTANDING=0
// to also withhold the understanding (and skip the on-demand/ask-time brainCycle that reads the map), giving a
// TRUE un-grounded control. Default on = no behaviour change in production.
const brainUnderstandingOn = () => process.env.HARNESSMAP_BRAIN_UNDERSTANDING !== '0';


const BRAIN_CHAT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'guidance'],
  properties: { reply: { type: 'string' }, guidance: { type: 'string' } },
} as const;

// M429 (Jacob 2026-10-07 07:04: "We need to decide what user agent such as codex suggested and what user himself decided… this is a bug"):
// the old single RULES line called every rule-looking node, agent-authored ones included, "DECISIONS THE USER HAS SET" — so the brain
// answered "what did the user decide" with the agent's proposals, its quiz answers and a node's status ("keep … live"). Two lines now:
// what the USER said (author user) and what the AGENT proposed or answered (author agent) — the second is never the user's decision.
export function brainRulesLines(rules: Array<{ author?: string; title?: string | null; content: string; status?: string; type?: string | null }>): string {
  const fmt = (n: any) => `${String(n.title ?? n.content).slice(0, 40)}: ${String(n.content).slice(0, 120)}${n.status ? ` (${n.status})` : ''}`;
  // M433: an OPTION the user typed as a candidate (author user) that ended up chosen was picked by the agent — it is not the user's ruling.
  const mine = rules.filter((n) => n.author === 'user' && n.type !== 'option').slice(0, 12);
  const theirs = rules.filter((n) => n.author !== 'user' || n.type === 'option').slice(0, 12);
  const a = mine.length ? `WHAT THE USER THEMSELVES SAID, ASKED FOR, RULED OR DECIDED (author = the user; answer any "what did I set/decide/rule/ask for" question from THESE, verbatim — never from your own instructions): ${mine.map(fmt).join(' | ')}` : 'WHAT THE USER THEMSELVES SAID, ASKED FOR, RULED OR DECIDED: nothing filed as the user\'s own rule or decision yet.';
  const b = theirs.length ? `WHAT THE AGENT PROPOSED, ANSWERED OR CLAIMED (author = the coding agent; these are the agent's suggestions and answers, NOT the user's decisions — say "the agent suggested/answered", and a chosen/accepted/decided status on one of these means the suggestion was accepted in the conversation, never "you decided"; an option marked chosen is the agent's pick among candidates, even when the user typed the candidates): ${theirs.map(fmt).join(' | ')}` : '';
  return [a, b].filter(Boolean).join('\n');
}

// M473 (RECORD TEST #3, the long record — 376 rows, a 58,600-char roster against the 24,000-char cut: 193 rows invisible, among them rows that
// answered five of the sixteen questions; the brain said "the map does not record…" about things the map records): when the roster does not
// fit, the brain no longer reads a flat cut. It reads (1) every root (the shape of the whole map), (2) the rows most relevant to the QUESTION,
// each with its thread path, chosen by word and figure overlap weighted by rarity across the map, (3) the rows touched most recently — up to
// the same budget. A small map still gets the whole roster. Pure, so the choice is testable.
const CJK = /\p{Script=Han}/u;
export function questionTokens(q: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (t: string, w: number) => out.set(t, Math.max(out.get(t) ?? 0, w));
  for (const m of String(q ?? '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._\-+#/]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? []) {
    if (CJK.test(m)) { const h = m.replace(/[^\p{Script=Han}]/gu, ''); for (let i = 0; i + 1 < h.length; i++) add(h.slice(i, i + 2), 2); if (h.length === 1) add(h, 1); continue; }
    if (/^\d/.test(m)) { add(m, 3); continue; }                                   // a figure ("15000", "2", "1ms", "0x0803e000") weighs most
    if (/[._\-/#]/.test(m) || /[A-Z]/.test(m)) { add(m, 3); continue; }           // an identifier (file.c, no-implied-eval, setStep)
    if (m.length >= 3 && !QUESTION_STOP.has(m)) add(m, m.length >= 5 ? 1.5 : 1);
  }
  return out;
}
const QUESTION_STOP = new Set('the and for was were what which who did say said tell told about with that this from have has had you your our did does into then than when where why how are our its did ask asked choose chose use used set did get got put make made let did need want wanted mean meant map record recorded discuss discussed agree agreed conclude concluded correct corrected decide decided rule rules limit actually should would could there here they them his her she him did one two first last next earlier later really still also just only ever been being over under again more most some any all each both'.split(' '));
// M473b (Jacob 09:56 Oct 9: "I thought the brain have structural delegates and area delegates to prevent precisely this from happening.
// What happened to them"): the delegates (area minds, governors.ts) assessed and advised but were never asked "which estate is this
// question about?". Now a question is ROUTED first: every top-level estate is scored by how much of the question's words and figures its
// subtree holds (rarity-weighted) plus its mind's understanding when one exists; the best one or two estates are read IN FULL (their whole
// subtree, rows in tree order), then the matching rows from elsewhere, then every root. On a map without minds the subtrees alone route.
export function routeEstates(nodes: any[], question: string, minds: { nodeId: string; understanding: string }[] = [], isTutorial: (n: any) => boolean = () => false): { rootId: string; score: number }[] {
  const live = nodes.filter((n) => n.status !== 'removed' && !isTutorial(n) && n.author !== 'system');
  const kids = new Map<string | null, any[]>(); for (const n of live) { const k = n.parentId ?? null; (kids.get(k) ?? kids.set(k, []).get(k)!).push(n); }
  const toks = questionTokens(question); if (!toks.size) return [];
  const text = (n: any) => `${n.title ?? ''} ${n.content ?? ''}`.toLowerCase();
  const df = new Map<string, number>(); for (const [t] of toks) { let c = 0; for (const n of live) if (text(n).includes(t)) c++; df.set(t, c); }
  const w = (t: string, wt: number) => wt * (1 + Math.log(1 + live.length / Math.max(1, df.get(t) ?? 1)));
  const mindOf = new Map(minds.map((m) => [m.nodeId, String(m.understanding ?? '').toLowerCase()]));
  const out: { rootId: string; score: number }[] = [];
  for (const r of kids.get(null) ?? []) {
    if (String(r.title ?? r.content).trim() === 'to sort') continue;
    const sub: any[] = []; const stack = [r]; const seen = new Set<string>();
    while (stack.length) { const n = stack.pop()!; if (seen.has(n.id)) continue; seen.add(n.id); sub.push(n); for (const k of kids.get(n.id) ?? []) stack.push(k); }
    let score = 0;
    for (const [t, wt] of toks) { const hits = sub.filter((n) => text(n).includes(t)).length; if (hits) score += w(t, wt) * Math.min(3, hits); if (mindOf.get(r.id)?.includes(t)) score += w(t, wt); }
    if (score > 0) out.push({ rootId: r.id, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
// M473d (Jacob 10:12 Oct 9: "Aren't different delegates reading their own sections carefully and then reporting back to brain? So if user
// look for a node/topic, the brain would ask delegates to search their own areas and brain would only get the info in a report?"): yes —
// his Sep 8 design, now built. On a big map the question is routed to one or two estates; each estate's delegate reads ITS OWN subtree in
// full and reports the matching nodes verbatim, with who said it; the brain answers from the reports (plus its whole-map understanding), the
// tiered map serving as orientation only. Small maps keep the one-call path.
export function estateSubtreeText(nodes: any[], rootId: string, roundTimes: number[] = [], cap = 30_000): { text: string; rows: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, any[]>(); for (const n of nodes) { if (n.status === 'removed') continue; const k = n.parentId ?? null; (kids.get(k) ?? kids.set(k, []).get(k)!).push(n); }
  const age = (n: any) => { const k = turnsAgo(n.updatedAt, roundTimes); return k !== null && k >= 15 ? `last discussed ${k} turns ago` : null; };
  const lines: string[] = []; let rows = 0; const root = byId.get(rootId);
  if (root) { lines.push(`ESTATE: ${nodeLine(root, { who: true, age })}`); rows++; }
  const walk = (pid: string, depth: number) => { for (const n of kids.get(pid) ?? []) { if (lines.join('\n').length > cap) return; rows++; lines.push(`${'  '.repeat(depth)}${n.title && String(n.title).trim() !== String(n.content ?? '').trim() ? `${String(n.title).slice(0, 50)} — ` : ''}${nodeLine(n, { who: true, age })}`); walk(n.id, depth + 1); } };
  walk(rootId, 1);
  return { text: lines.join('\n'), rows };
}
const DELEGATE_SYSTEM = `You are the delegate of ONE area (estate) of a person's goal map — a record of what the person and their coding agent said. You are handed your estate's nodes, one per line: [you] = the person said it, [agent] = the coding agent said it. The central brain asks you a question on the person's behalf. SEARCH your estate and REPORT what the nodes say — nothing else: list every node that bears on the question, each VERBATIM as "title — [who] statement" (up to 8, the most relevant first); keep every number, name, file and quoted phrase exactly; if nothing in your estate bears on it, say "nothing in this estate matches" in one line. Never answer the question yourself, never infer, never add what the nodes do not say; a status word in parentheses is the filer's note, not a finding.`;
export async function delegateSearch(store: Store, projectId: string, nodes: any[], question: string, estates: { rootId: string }[], roundTimes: number[]): Promise<string> {
  const out: string[] = [];
  for (const { rootId } of estates.slice(0, 2)) {
    const root = nodes.find((n) => n.id === rootId); if (!root) continue;
    const name = String(root.title ?? root.content ?? '').slice(0, 60);
    const { text, rows } = estateSubtreeText(nodes, rootId, roundTimes);
    const t0 = Date.now();
    try {
      const r = await call({ task: 'brain', system: DELEGATE_SYSTEM, user: `THE QUESTION: ${question}\n\nYOUR ESTATE "${name}" (${rows} nodes):\n${text}\n\nReport.`, maxTokens: 800, timeoutMs: 120_000, audit: (k, d) => store.audit(k, d) });
      const rep = String(typeof r === 'string' ? r : JSON.stringify(r)).trim().slice(0, 2400);
      store.audit('brain_delegate_search', { estate: name.slice(0, 40), rows, ms: Date.now() - t0, chars: rep.length, hit: !/nothing in this estate matches/i.test(rep) });
      out.push(`REPORT FROM THE DELEGATE OF "${name}" (${rows} nodes searched):\n${rep}`);
    } catch (err) { store.audit('brain_delegate_search', { estate: name.slice(0, 40), rows, ms: Date.now() - t0, error: String(err).slice(0, 100) }); }
  }
  return out.join('\n\n');
}
// M473c: the node the question is most about — the best-scoring node inside the routed estate (or anywhere) — becomes the brain's focus.
export function questionFocus(nodes: any[], question: string, estateRootId: string | null, isTutorial: (n: any) => boolean = () => false): string | null {
  const live = nodes.filter((n) => n.status !== 'removed' && !isTutorial(n) && n.author !== 'system');
  const byId = new Map(live.map((n) => [n.id, n]));
  const rootOf = (n: any) => { let c = n; for (let i = 0; c?.parentId && i < 20; i++) c = byId.get(c.parentId) ?? c; return c?.id; };
  const toks = questionTokens(question); if (!toks.size) return estateRootId;
  const text = (n: any) => `${n.title ?? ''} ${n.content ?? ''}`.toLowerCase();
  const df = new Map<string, number>(); for (const [t] of toks) { let c = 0; for (const n of live) if (text(n).includes(t)) c++; df.set(t, c); }
  const score = (n: any) => { const w = text(n); let sc = 0; for (const [t, wt] of toks) if (w.includes(t)) sc += wt * (1 + Math.log(1 + live.length / Math.max(1, df.get(t) ?? 1))); return sc; };
  const pool = estateRootId ? live.filter((n) => n.parentId !== null && rootOf(n) === estateRootId) : live.filter((n) => n.parentId !== null);
  let best: any = null, bs = 0; for (const n of pool) { const sc = score(n); if (sc > bs) { bs = sc; best = n; } }
  return best?.id ?? estateRootId;
}
export function selectRowsForQuestion(nodes: any[], question: string, opts: { budget?: number; recent?: number; isTutorial?: (n: any) => boolean; roundTimes?: number[]; minds?: { nodeId: string; understanding: string }[]; estates?: boolean; roots?: boolean } = {}): { text: string; picked: number; total: number; estates: string[] } {
  const budget = opts.budget ?? 22_000, isTutorial = opts.isTutorial ?? (() => false), roundTimes = opts.roundTimes ?? [];
  const live = nodes.filter((n) => n.status !== 'removed' && !isTutorial(n) && n.author !== 'system');
  const byId = new Map(live.map((n) => [n.id, n]));
  const toks = questionTokens(question);
  const words = (n: any) => `${n.title ?? ''} ${n.content ?? ''}`.toLowerCase();
  // rarity: a token in few rows says more than one in many
  const df = new Map<string, number>(); for (const [t] of toks) { let c = 0; for (const n of live) if (words(n).includes(t)) c++; df.set(t, c); }
  const score = (n: any) => { const w = words(n); let sc = 0; for (const [t, wt] of toks) if (w.includes(t)) { const d = df.get(t) ?? 1; sc += wt * (1 + Math.log(1 + live.length / Math.max(1, d))); } return sc; };
  const scored = live.filter((n) => n.parentId !== null).map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const recent = [...live].filter((n) => n.parentId !== null && n.updatedAt).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, opts.recent ?? 8);
  const age = (n: any) => { const k = turnsAgo(n.updatedAt, roundTimes); return k !== null && k >= 15 ? `last discussed ${k} turns ago` : null; };
  const pathOf = (n: any) => { const p: string[] = []; for (let c = n.parentId ? byId.get(n.parentId) : null, i = 0; c && i < 12; c = c.parentId ? byId.get(c.parentId) : null, i++) p.unshift(String(c.title ?? c.content ?? '').slice(0, 40)); return p; };
  const roots = live.filter((n) => n.parentId === null && String(n.title ?? n.content).trim() !== 'to sort');
  const lines: string[] = [];
  if (opts.roots !== false) { lines.push(`ROOTS (${roots.length} top-level topics — the whole map's shape; the nodes below are the ones that match the question, each with its thread path):`); for (const r of roots) lines.push(`• ${nodeLine(r, { who: true, age })}`); }
  const chosen = new Set<string>(); let used = lines.join('\n').length + 200;
  const take = (n: any, tag: string) => { if (chosen.has(n.id)) return; const p = pathOf(n); const line = `${p.join(' › ')}${p.length ? ' › ' : ''}${n.title && String(n.title).trim() && String(n.title).trim() !== String(n.content ?? '').trim() ? `${String(n.title).slice(0, 50)} — ` : ''}${nodeLine(n, { who: true, age })}${tag}`; if (used + line.length > budget) return; chosen.add(n.id); used += line.length + 1; lines.push(line); };
  // M473b: the routed estates first — read in full, in tree order, up to ~55 % of the budget
  const routed = opts.estates === false ? [] : routeEstates(nodes, question, opts.minds ?? [], isTutorial).slice(0, 2);
  const estateNames: string[] = [];
  if (routed.length) {
    const kidsOf = new Map<string | null, any[]>(); for (const n of live) { const k = n.parentId ?? null; (kidsOf.get(k) ?? kidsOf.set(k, []).get(k)!).push(n); }
    const estateBudget = used + Math.floor(budget * 0.55);
    for (const { rootId } of routed) {
      const root = byId.get(rootId); if (!root) continue; estateNames.push(String(root.title ?? root.content ?? '').slice(0, 40));
      lines.push(`ESTATE "${String(root.title ?? root.content ?? '').slice(0, 60)}" — the area this question is about, read in full:`);
      const walk = (pid: string, depth: number) => { for (const n of kidsOf.get(pid) ?? []) { if (used > estateBudget) return; if (!chosen.has(n.id)) { const line = `${'  '.repeat(depth)}${n.title && String(n.title).trim() !== String(n.content ?? '').trim() ? `${String(n.title).slice(0, 50)} — ` : ''}${nodeLine(n, { who: true, age })}`; chosen.add(n.id); used += line.length + 1; lines.push(line); } walk(n.id, depth + 1); } };
      walk(rootId, 1);
    }
  }
  lines.push('MATCHING ROWS ELSEWHERE (best match first):'); for (const { n } of scored.slice(0, 80)) take(n, '');
  lines.push('TOUCHED MOST RECENTLY:'); for (const n of recent) take(n, '');
  lines.push(`(${chosen.size} of ${live.length} nodes shown — the ones that match the question; the rest are on the map. If none of these answers the question, say you found nothing matching it — never that the map does not record it, and never state a node or row count: M473e, the answer is about the work, not the map.)`);
  return { text: lines.join('\n'), picked: chosen.size, total: live.length, estates: estateNames };
}
export async function brainChat(store: Store, projectId: string, text: string): Promise<{ reply: string; guidance: string } | { error: string }> {
  let u = brainUnderstandingOn() ? getUnderstanding(store, projectId) : null;
  // M351 (loop, monitor-the-mind pass): on a young map the understanding is written by the rhythm only after ten filed rounds, so the
  // brain, asked "what have we decided so far?" on a 25-node map, answered "nothing — no understanding yet". A brain asked about a map it
  // has never read reads it first: one cycle (assess changed areas → structure → synthesis), then the answer comes from the written understanding.
  if (brainUnderstandingOn() && !u && loadMap(store, projectId).nodes.some((n) => n.status !== 'removed' && n.author !== 'system' && n.parentId !== null)) {
    try { const c = await brainCycle(store, projectId); store.audit('brain_understanding_on_demand', { assessed: c.assessed, synthesized: c.synthesized }); } catch (err) { store.audit('brain_understanding_on_demand', { error: String(err instanceof Error ? err.message : err).slice(0, 200) }); }
    u = getUnderstanding(store, projectId);
  }
  // M357 (Jacob 2026-09-20, the stance re-score): the brain still recommended join() six rounds after the user had ruled it out — its
  // understanding is rewritten by the rhythm every ten filed rounds (M195), so between refreshes it answers from notes it took before
  // the latest turns. A brain asked after five or more rounds it has not read re-reads first (one cycle), then answers.
  if (u) {
    try {
      const written = Object.values(u.sections).map((x) => x.ts).filter(Boolean).sort().at(-1) ?? '';
      const db = (store as any).db;
      const since = written ? Number((db.prepare('SELECT count(*) n FROM rounds r JOIN chats c ON c.id = r.chat_id WHERE c.project_id = ? AND r.created_at > ?').get(projectId, written.slice(0, 19).replace('T', ' ')) as any)?.n ?? 0) : 0;
      if (since >= 5) {
        const c = await brainCycle(store, projectId);
        store.audit('brain_understanding_refreshed_on_ask', { since, assessed: c.assessed, synthesized: c.synthesized });
        u = getUnderstanding(store, projectId) ?? u;
      }
    } catch (err) { store.audit('brain_understanding_refreshed_on_ask', { error: String(err).slice(0, 120) }); }
  }
  const status = getMapStatus(store, projectId);
  const tuning = store.getSetting(`braintuning:${projectId}`) ?? '';
  // M364 (Jacob 2026-09-20, ruled a bug): brainChat answered count/status/decision/rule questions from its prose
  // understanding and its own standing guidance — the live nodes were never in front of it — so it undercounted
  // topics, missed just-made decisions, reported a pre-drift language, and once recited its own guidance as "the
  // user's rule". Give it the live map as ground truth and (in the system prompt) tell it to read the nodes for
  // any factual/status/rule question.
  const liveMap = loadMap(store, projectId);
  const roundTimes = (() => { try { return store.roundTimes(); } catch { return [] as number[]; } })();
  // M460k: the roster used to be cut at 12,000 chars mid-row — the newest rows sit at the end, so the open work of the last rounds was
  // the part that vanished or arrived half-written. Twice the room, a cut only at a line break, and the cut announced.
  const rosterFull = renderTree(liveMap, { ids: false, who: true, age: (n) => { const k = turnsAgo(n.updatedAt, roundTimes); return k !== null && k >= 15 ? `last discussed ${k} turns ago` : null; } }); // M469: when a row was last discussed — any row, never an open/closed mark
  // M473c (Jacob 10:05 Oct 9: "This is not consistent with our attention rules right?"): a big map is read by the brain the way the agent
  // reads it — through the tiered renderer (depth falls off with distance from the focus, within a budget) — with the question's best
  // matching node as the focus (routed estate first, M473b), plus the matching nodes elsewhere with their paths (M473). One rulebook.
  const roster = rosterFull.length <= 24_000 ? rosterFull : await (async () => {
    const isTut = (n: any) => n.author === 'system' || /getting started/i.test(String(n.title ?? ''));
    const minds = listMinds(store, projectId, 'active').map((mm) => ({ nodeId: mm.nodeId, understanding: mm.understanding }));
    const routed = routeEstates(liveMap.nodes, text, minds, isTut);
    // M473d: the delegates of the routed estates search their own areas and report (one model call each, up to two)
    const reports = routed.length ? await delegateSearch(store, projectId, liveMap.nodes, text, routed, roundTimes) : '';
    const focus = questionFocus(liveMap.nodes, text, routed[0]?.rootId ?? null, isTut);
    const tiered = renderTieredTree(store, projectId, focus, reports ? 9_000 : 15_000, null, { who: true });
    const matching = selectRowsForQuestion(liveMap.nodes, text, { budget: reports ? 4_000 : 6_500, roundTimes, minds, isTutorial: isTut, estates: false, roots: false });
    return `${reports ? `WHAT THE DELEGATES REPORT (each area's delegate searched its own estate for this question and quotes the nodes verbatim — answer from THESE first; they outrank the orientation view below):\n${reports}\n\n` : ''}THE MAP AT ATTENTION (orientation — the same tiered reading the agent gets: every root, depth by closeness to the focus ▶, the node best matching the question${routed[0] ? `, in the estate "${String(liveMap.nodes.find((n) => n.id === routed[0].rootId)?.title ?? '').slice(0, 50)}"` : ''}; "(+N inside)" marks folded branches):\n${tiered}\n${matching.text}`;
  })(); // M473: a big map is read by the question, not cut flat // M429: every line says who said it; M435: open items left behind say for how many turns
  const isTutorial = (n: any) => n.author === 'system' || /getting started/i.test(String(n.title ?? '')) || /getting started \(tutorial\)/i.test(String(n.content ?? ''));
  const topics = liveMap.nodes.filter((n) => n.parentId === null && n.status !== 'removed' && !isTutorial(n) && String(n.title ?? n.content).trim() !== 'to sort');
  const topicLine = `TOP-LEVEL TOPICS (${topics.length}, excluding the getting-started tutorial): ${topics.map((n) => String(n.title ?? n.content).slice(0, 60)).join(' | ') || '(none yet)'}`;
  // M435c (the v0.9.210 re-ask still opened with "The live 'Random numbers script' remains open" — its stale prose understanding, not the
  // roster): the open work is COMPUTED into two lines the brain cannot read past — what is open now, and what was left behind.
  // M435f (PANEL #425, 9 of 13: "Random-number alternatives remain open: uniform (75 turns) and randrange (74 turns)" — the OLDER line had
  // listed the agent's floated OPTIONS and a game's dropped move choices as left-behind WORK; "the 3×4 game still has open choices of mark
  // and first mover" (3), "three New York sentence candidates remain open" (3)): open WORK is a task or question the person can act on —
  // never a candidate option, never a floated/proposed alternative, never a game move. And the left-behind set is one line, not an itemized list.
  // M460 (TWIN #443, Noor: "Customer CSV export still has the active requirement that customers.csv contain name, plan, seats, and MRR"
  // listed as open work under a parent she had marked done): a constraint is a standing rule, not work, and nothing under a closed
  // parent (done / dropped / superseded / removed) is open.
  // M469: the computed lines — what was discussed and said; see discussedLines above.
  const openLine = discussedLines(liveMap.nodes, roundTimes, (store as any).lastUserText?.() ?? '', isTutorial);
  // M364b (found by re-running the fix in the loop, per Jacob): "what rule/preference did the user set?" was STILL
  // answered from the system prompt — the brain even quoted M364's own instruction back as "the user's standing rule".
  // Surface the actual rule/decision/constraint nodes so the answer is READ from the map, and (system prompt) forbid
  // reporting the brain's own instructions as user rules.
  const looksRule = (n: any) => {
    const t = String(n.type ?? ''), st = String(n.status ?? ''), txt = `${n.title ?? ''} ${n.content ?? ''}`;
    if (['constraint', 'decision', 'rule'].includes(t)) return true;
    if (['active', 'decided', 'hard', 'accepted'].includes(st)) return true;
    if (n.author === 'user' && ['task', 'claim'].includes(t)) return true; // a user-authored task/assertion is a standing instruction the user set
    return /\b(rule|preference|must|always|never|don'?t|do not|skip|avoid|prefer|rewrite|format|respond|reply|call me|refer to|from now on|every time)\b/i.test(txt);
  };
  const rulesLine = brainRulesLines(liveMap.nodes.filter((n) => n.status !== 'removed' && n.author !== 'system' && !isTutorial(n) && looksRule(n)));
  const userPrompt = [
        u ? `YOUR CURRENT UNDERSTANDING:\n${Object.entries(u.sections).map(([k, v]) => `${k}: ${v.text.slice(0, 2000)}`).join('\n\n')}` : 'YOUR CURRENT UNDERSTANDING: none written yet.',
        brainRosterOn() ? `YOUR MAP RIGHT NOW — the nodes as they stand, ground truth. Use THIS (not your summary or your standing guidance) to answer anything about how many topics exist, what was discussed, what was said, decided, corrected or rejected and by whom, or any rule or preference the USER set; a status word in parentheses on a row is the filer's recorded note, reported as "recorded as …" only when asked and never as your own finding:\n${topicLine}\n${openLine}${rulesLine ? `\n${rulesLine}` : ''}\n\n${roster}` : '',
        status ? `YOUR STRUCTURE REPORT: ${status.health} ${status.opinion}` : '',
        tuning ? `YOUR STANDING GUIDANCE (as it stands):\n${tuning}` : 'YOUR STANDING GUIDANCE: none yet.',
        `THE USER SAYS:\n${text.slice(0, 4000)}`,
        'Reply, then rewrite the standing guidance.',
      ].filter(Boolean).join('\n\n');
  try {
    const parsed = await call({
      task: 'brain',
      system: brainRosterOn() ? `${BRAIN_CHAT_SYSTEM} ${M364_SYSADD}${M429_SYSADD}${M435_SYSADD}` : BRAIN_CHAT_SYSTEM, maxTokens: 3200, schema: BRAIN_CHAT_SCHEMA as any, timeoutMs: 180_000,
      // M455b (PANEL #439, Tom: an answer "visibly cut off at 'but sendin'") — the SETTLED line made answers longer than the 2000-token cap.
      // M473e (RECORD TEST #3 rerun, 16 of 16 answers via the prose fallback): from v0.9.234 to v0.9.294 the comment above sat on the SAME
      // line and swallowed `schema:` and `timeoutMs:` — every talk-to-map answer was an unstructured call read as an object (no reply),
      // then a second full call for the same prose. The schema is back; a prose string that still arrives is used as the reply directly.
      audit: (k, d) => store.audit(k, d),
      user: userPrompt,
    }) as any;
    if (typeof parsed === 'string' && parsed.trim()) { // M473e: prose came back where an object was asked for — it is the answer; no second call
      const p = splitBrainProse(parsed);
      if (p.reply.trim()) { if (p.guidance) store.setSetting(`braintuning:${projectId}`, p.guidance.slice(0, 2000)); store.audit('map_status_chat', { chars: text.length, prose: 'inline' }); return { reply: p.reply.slice(0, 4000), guidance: p.guidance.slice(0, 2000) }; }
    }
    const reply = String(parsed?.reply ?? '').slice(0, 4000);
    const guidance = String(parsed?.guidance ?? '').slice(0, 2000);
    if (!reply.trim()) { store.audit('brain_chat_empty', { keys: Object.keys(parsed ?? {}), typeofParsed: typeof parsed, head: JSON.stringify(parsed ?? null).slice(0, 400) }); throw new Error('empty reply'); } // M473e diagnostic: the shape of a structured reply that came back without text
    if (guidance) store.setSetting(`braintuning:${projectId}`, guidance);
    store.audit('map_status_chat', { chars: text.length });
    return { reply, guidance };
  } catch (err) {
    // M458 (PANEL #441): on the 161-node map the model answered in prose and the JSON path came back empty — the person must still
    // get the answer the model wrote. One schema-less call; the prose is the reply, a trailing "Standing guidance:" section the guidance.
    try {
      const prose = await call({ task: 'brain', system: brainRosterOn() ? `${BRAIN_CHAT_SYSTEM} ${M364_SYSADD}${M429_SYSADD}${M435_SYSADD}` : BRAIN_CHAT_SYSTEM, maxTokens: 3200, audit: (k, d) => store.audit(k, d), user: `${userPrompt}\n\nWrite the reply as plain prose. Then, on its own line, write "Standing guidance:" followed by the rewritten standing guidance.`, timeoutMs: 120_000 }) as string;
      const { reply, guidance } = splitBrainProse(String(prose ?? ''));
      if (!reply.trim()) throw err;
      if (guidance) store.setSetting(`braintuning:${projectId}`, guidance);
      store.audit('map_status_chat', { chars: text.length, prose: true, why: (err instanceof Error ? err.message : String(err)).slice(0, 80) });
      return { reply: reply.slice(0, 4000), guidance: guidance.slice(0, 2000) };
    } catch (err2) {
      return { error: (err2 instanceof Error ? err2.message : String(err2)).slice(0, 200) };
    }
  }
}
// M458: the prose fallback's split — everything before a "Standing guidance:" line is the reply, the rest the guidance.
export function splitBrainProse(text: string): { reply: string; guidance: string } {
  const m = text.match(/\n\s*\**\s*standing guidance\s*\**\s*:\s*\n?/i);
  if (!m || m.index === undefined) return { reply: text.trim(), guidance: '' };
  return { reply: text.slice(0, m.index).trim(), guidance: text.slice(m.index + m[0].length).trim() };
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
    let report = typeof text === 'string' ? text : '';
    // M215: v6's stored report was a 130-char preamble ("I'll analyze the recent
    // events…") — the M205 failure again. A report that short is not a report.
    if (report.length < 300) {
      store.audit('history_status_retry', { chars: report.length });
      const again = await call({ task: 'memory', system: HISTORY_SYSTEM + ' Write the report NOW, in full, in this single reply — no preamble, no offer to proceed.', maxTokens: 500, timeoutMs: 90_000, audit: (k, d) => store.audit(k, d),
        user: [`RECENT EVENTS:\n${recent}`, `COMPLETE DAILY AGGREGATES:\n${aggregates.slice(0, 4000)}`, `IMPORT RECORDS:\n${imports || '(none recorded)'}`, 'Write the historical-status report.'].join('\n\n') });
      if (typeof again === 'string' && again.length > report.length) report = again;
    }
    if (report.length >= 300) {
      store.setSetting(`historystatus:${projectId}`, report.slice(0, 1800));
      store.setSetting(`historyseq:${projectId}`, String(maxSeq));
    }
  } catch (err) { console.error('[history-status] failed:', err); }
}

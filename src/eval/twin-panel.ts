// M407 — run the User Twin PANEL: the same experience through several of the twenty potential users
// (src/twin-personas.ts), ONE AT A TIME (codex jobs run singly on the 3.9 GB box), then report what recurs.
//
// Usage:
//   HARNESSMAP_INFERENCE=codex CODEX_HOME=~/.codex HARNESSMAP_INFERENCE_CONCURRENCY=1 \
//     bun run src/eval/twin-panel.ts --flow-file scratchpad/first30-flow.txt --personas all --out scratchpad/panel-first30
//   … --personas maya-staff-backend,tom-pm-reads-the-map,mei-lin-screenreader-dev
//   … src/eval/scenarios/<name>.json            (a replay scenario as the session, like twin-run)
//
// Output: one JSON report per persona in --out, plus PANEL.md with a per-persona table (severe / moderate counts,
// would-return, verdict) and the frictions that more than one persona raised. Background it and redirect stdout.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runTwin, type TwinReport, type TwinPersona } from '../twin.js';
import { TWIN_PERSONAS, TWIN_PERSONA_IDS, findTwinPersona } from '../twin-personas.js';

const argv = process.argv.slice(2);
const flagVal = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flagVals = new Set(['--flow', '--flow-file', '--personas', '--out'].map((f) => flagVal(f)).filter(Boolean));

// Same session rendering as twin-run (a scenario's turns as what the user typed and the agent answered).
function experienceFromScenario(path: string): string {
  const sc = JSON.parse(readFileSync(path, 'utf8'));
  const seedRaw = sc.seed ?? [];
  const seed: any[] = Array.isArray(seedRaw) ? seedRaw : (typeof seedRaw === 'string' && seedRaw.trim() ? [{ content: seedRaw.trim() }] : []);
  const rounds: any[] = sc.rounds ?? [];
  const seedLines = seed.map((s) => `  - ${s.content}${s.status && s.status !== 'live' ? ` [${s.status}]` : ''}`).join('\n');
  const roundLines = rounds.map((r, i) => [`  Turn ${i + 1}: you typed to your coding agent — "${r.user}"`, r.assistant ? `           the agent answered — "${r.assistant}"` : '', `           (meanwhile the map panel quietly updates on its own)`].filter(Boolean).join('\n')).join('\n');
  return [
    `THE SETUP: You are working in your usual AI coding CLI. Beside it runs "the map" — a companion that silently takes notes on your work and organizes them into a tree you can glance at. You did not ask it questions; you just worked, and it watched. Auto mode is on (it decides on its own what to highlight).`,
    seed.length ? `WHAT THE MAP ALREADY SHOWED when you started (a small tree):\n${seedLines}` : '',
    `WHAT YOU DID, step by step:\n${roundLines}`,
    `You glance at the map now and then between turns — you do not study it.`,
  ].filter(Boolean).join('\n\n');
}

const flow = flagVal('--flow');
const flowFile = flagVal('--flow-file');
const scenarioPath = argv.find((a) => !a.startsWith('--') && !flagVals.has(a));
let experience: string; let label: string;
if (flow) { experience = flow; label = 'flow (inline)'; }
else if (flowFile) { experience = readFileSync(flowFile, 'utf8'); label = `flow-file ${flowFile}`; }
else if (scenarioPath) { experience = experienceFromScenario(scenarioPath); label = `scenario ${scenarioPath}`; }
else { console.error('usage: twin-panel.ts (--flow "..." | --flow-file <path> | <scenario.json>) [--personas all|id,id,…] [--out <dir>]'); process.exit(2); }

const want = (flagVal('--personas') ?? 'all').trim();
const ids: string[] = want === 'all' ? [...TWIN_PERSONA_IDS] : want.split(',').map((s) => s.trim()).filter(Boolean);
for (const id of ids) if (!findTwinPersona(id) && id !== 'normal' && id !== 'critic') { console.error(`unknown persona "${id}"; known: normal, critic, ${TWIN_PERSONA_IDS.join(', ')}`); process.exit(2); }
const out = flagVal('--out') ?? `twin-panel-${Date.now()}`;
if (!existsSync(out)) mkdirSync(out, { recursive: true });

const sev = (s: string) => ({ none: '·', minor: '▹', moderate: '▲', severe: '■' } as Record<string, string>)[s] ?? '?';
const rows: { id: string; who: string; severe: number; moderate: number; minor: number; would: string; verdict: string; top: string[]; secs: string; error?: string }[] = [];

console.log(`══ USER TWIN PANEL — ${label} — ${ids.length} persona(s), run one at a time ══\n`);
for (const id of ids) {
  const p = findTwinPersona(id);
  const who = p ? p.name : id;
  const t0 = Date.now();
  process.stdout.write(`→ ${id.padEnd(30)} ${who} … `);
  try {
    const r: TwinReport = await runTwin(experience, { persona: id as TwinPersona });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    writeFileSync(join(out, `${id}.json`), JSON.stringify(r, null, 2));
    const n = (s: string) => r.walkthrough.filter((f) => f.severity === s).length;
    rows.push({ id, who, severe: n('severe'), moderate: n('moderate'), minor: n('minor'), would: r.would_return, verdict: r.verdict, top: r.top_frictions ?? [], secs });
    console.log(`${secs}s · ■${n('severe')} ▲${n('moderate')} ▹${n('minor')} · would return: ${r.would_return}`);
    for (const f of r.walkthrough) if (f.severity === 'severe' || f.severity === 'moderate') console.log(`     ${sev(f.severity)} ${f.moment} — "${f.reaction}" [${f.mechanism}]`);
  } catch (e: any) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    rows.push({ id, who, severe: 0, moderate: 0, minor: 0, would: '?', verdict: '', top: [], secs, error: String(e?.message ?? e) });
    console.log(`FAILED after ${secs}s: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

// Recurrence: cluster top_frictions across personas by shared rare words (a crude but honest first cut — the
// founders read the clusters, the tool does not pretend to understand them).
const STOP = new Set('the a an and or of to in on for with is are was it its this that i my me you your at by as be not no so but into from than then when what which who how all any some there here just only very more most'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
type Cluster = { key: Set<string>; texts: string[]; personas: Set<string> };
const clusters: Cluster[] = [];
for (const r of rows) for (const t of r.top) {
  const w = words(t); let placed = false;
  for (const c of clusters) { const shared = [...w].filter((x) => c.key.has(x)).length; if (shared >= 3) { c.texts.push(t); c.personas.add(r.id); for (const x of w) c.key.add(x); placed = true; break; } }
  if (!placed) clusters.push({ key: w, texts: [t], personas: new Set([r.id]) });
}
clusters.sort((a, b) => b.personas.size - a.personas.size);

let md = `# User Twin panel — ${label}\n\n_${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z · ${ids.length} persona(s), each a separate codex run; src/eval/twin-panel.ts (M407)._\n\n`;
md += `| # | persona | who | severe | moderate | minor | would return | verdict |\n|---|---|---|---|---|---|---|---|\n`;
rows.forEach((r, i) => { md += `| ${i + 1} | \`${r.id}\` | ${r.who} | ${r.severe} | ${r.moderate} | ${r.minor} | ${r.would} | ${r.error ? `FAILED: ${r.error.slice(0, 80)}` : r.verdict.replace(/\|/g, '/')} |\n`; });
const okRows = rows.filter((r) => !r.error);
md += `\n**Totals:** ${okRows.length}/${rows.length} reports · severe ${okRows.reduce((s, r) => s + r.severe, 0)} · moderate ${okRows.reduce((s, r) => s + r.moderate, 0)} · would return yes ${okRows.filter((r) => r.would === 'yes').length} / maybe ${okRows.filter((r) => r.would === 'maybe').length} / no ${okRows.filter((r) => r.would === 'no').length}\n\n`;
md += `## Frictions raised by more than one persona (robust findings)\n\n`;
const multi = clusters.filter((c) => c.personas.size > 1);
md += multi.length ? multi.map((c) => `- **${c.personas.size} personas** (${[...c.personas].join(', ')}):\n${c.texts.map((t) => `  - ${t}`).join('\n')}`).join('\n') + '\n' : '_none — every top friction was raised by a single persona_\n';
md += `\n## Frictions raised by one persona only\n\n`;
md += clusters.filter((c) => c.personas.size === 1).map((c) => `- (${[...c.personas][0]}) ${c.texts[0]}`).join('\n') + '\n';
writeFileSync(join(out, 'PANEL.md'), md);
console.log(`\n${md}`);
console.error(`[twin-panel] ${okRows.length}/${rows.length} reports → ${out}/PANEL.md`);
process.exit(0);

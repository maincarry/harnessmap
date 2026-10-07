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
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTwin, type TwinReport, type TwinPersona } from '../twin.js';
import { TWIN_PERSONA_IDS, DEFAULT_PANEL_IDS, TIER_WEIGHT, findTwinPersona } from '../twin-personas.js';

const argv = process.argv.slice(2);
const flagVal = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flagVals = new Set(['--flow', '--flow-file', '--personas', '--out', '--map'].map((f) => flagVal(f)).filter(Boolean)); // --ask and --dry are bare flags

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

// PANEL #404 (2026-10-07): run over a long scenario WITHOUT the map, 19 of 20 personas' top friction was "the resulting map is never shown,
// so I cannot judge it" — the scenario rendering describes the turns, not what the panel displayed. --map <kept sqlite> appends the
// END-OF-SESSION tree (titles, statuses, nesting; "to sort" included) from a kept run of the same scenario, so the twin judges the
// map it would actually have glanced at. (Mid-session glances are not reconstructed here — twin-drive M417 covers the live case.)
function endMapFromSqlite(path: string): string {
  const { Database } = require('bun:sqlite');
  const db = new Database(path, { readonly: true });
  const activePid = (db.query("select value from settings where key='active_project'").get() as any)?.value ?? null;
  const rows = (db.query("select id,parent_id,title,content,author,project_id,status from nodes order by rowid").all() as any[]).filter((n) => n.status !== 'removed' && (!activePid || n.project_id === activePid));
  const kids = new Map<string | null, any[]>(); for (const r of rows) { const k = r.parent_id ?? null; (kids.get(k) ?? kids.set(k, []).get(k)!).push(r); }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines: string[] = []; let shown = 0;
  const label = (n: any) => `${n.title || String(n.content || '').slice(0, 60)}${n.status && !['live', 'noted', 'answered'].includes(n.status) ? ` [${n.status}]` : ''}`;
  const walk = (pid: string | null, d: number) => { for (const n of kids.get(pid) ?? []) { if (n.author === 'system') continue; if (shown++ < 260) lines.push(`${'  '.repeat(d)}- ${label(n)}`); walk(n.id, d + 1); } };
  for (const r of rows.filter((r) => !r.parent_id || !byId.has(r.parent_id))) { if (r.author === 'system') continue; lines.push(`- ${label(r)}`); shown++; walk(r.id, 1); }
  db.close();
  return `WHAT THE MAP SHOWED AT THE END of the session (the tree you could glance at — one line per item, nested as displayed, a status in brackets where it is not plain; ${rows.filter((r) => r.author !== 'system').length} items${shown > 260 ? ', first 260 shown' : ''}):\n${lines.join('\n')}`;
}

// M426 (Jacob 2026-10-07 05:13: "are these persona using the talking to map function at all? Some of their complaints seems to be
// easily solvable by talk to map"): with --ask, a throwaway server is started on a COPY of the kept map and the map's own answers to
// the questions a user would ask are shown beside the tree, so the personas judge the product with its talk-to-map, not the tree alone.
const ASK_QUESTIONS = [
  'What is the user working on RIGHT NOW, most recently? one line',
  'What is still OPEN or unresolved in this session? a short list',
  'What is settled in this session, and what is still open? a short list of each', // Jacob 2026-10-07 07:02: "nodes are not decisions" — the earlier "what did the user DECIDE" baited the brain into decision voice
  'Summarize this session in five lines for someone coming back tomorrow.',
];
async function mapAnswers(path: string): Promise<string> {
  const dir = mkdtempSync('/tmp/claude-1000/harnessmap-panel-ask-'); const db = join(dir, 'map.sqlite'); copyFileSync(path, db);
  mkdirSync(join(dir, 'home', '.harnessmap'), { recursive: true });
  const port = Number(process.env.PANEL_ASK_PORT ?? 8797); const base = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([...(process.platform === 'linux' ? ['setsid'] : []), 'bun', 'run', 'src/server.ts'], {
    env: { ...process.env, ANTHROPIC_API_KEY: undefined as any, HARNESSMAP_DB: db, HARNESSMAP_HOME: join(dir, 'home', '.harnessmap'), HOME: join(dir, 'home'), PORT: String(port), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1' },
    stdout: Bun.file(join(dir, 'server.log')), stderr: Bun.file(join(dir, 'server.log')),
  });
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} try { server.kill(); } catch {} };
  try {
    let up = false; for (let i = 0; i < 40; i++) { try { const r = await fetch(`${base}/api/state`); if (r.ok) { up = true; break; } } catch {} await new Promise((r) => setTimeout(r, 500)); }
    if (!up) return 'WHAT THE MAP ANSWERED: (the map could not be started for questions)';
    const lines: string[] = [];
    for (const q of ASK_QUESTIONS) {
      let said = '(no answer)';
      for (let attempt = 0; attempt < 2 && said === '(no answer)'; attempt++) { try { const r = await fetch(`${base}/api/map-status/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q }) }); const b: any = await r.json(); const t = String(b?.reply ?? b?.text ?? b?.answer ?? '').trim(); if (t) said = t; } catch {} }
      lines.push(`Q: ${q}\nA: ${said}`);
      console.error(`[twin-panel] asked the map: ${q.slice(0, 50)} → ${said.slice(0, 80).replace(/\n/g, ' ')}`);
    }
    return `WHAT THE MAP ANSWERED when asked, in its own "talk to map" box (you could ask it anything in plain words; these are the questions a user typically asks at the end of a day):\n${lines.join('\n\n')}`;
  } finally { stop(); }
}

const flow = flagVal('--flow');
const flowFile = flagVal('--flow-file');
const scenarioPath = argv.find((a) => !a.startsWith('--') && !flagVals.has(a));
let experience: string; let label: string;
if (flow) { experience = flow; label = 'flow (inline)'; }
else if (flowFile) { experience = readFileSync(flowFile, 'utf8'); label = `flow-file ${flowFile}`; }
else if (scenarioPath) { experience = experienceFromScenario(scenarioPath); label = `scenario ${scenarioPath}`; }
else { console.error('usage: twin-panel.ts (--flow "..." | --flow-file <path> | <scenario.json>) [--map <kept e2e.sqlite of the same scenario>] [--personas all|id,id,…] [--out <dir>] [--dry]'); process.exit(2); }
const mapPath = flagVal('--map');
if (mapPath) { experience += `\n\n${endMapFromSqlite(mapPath)}`; label += ` + end map ${mapPath}`; }
if (mapPath && argv.includes('--ask')) { experience += `\n\n${await mapAnswers(mapPath)}`; label += ' + talk-to-map answers'; }
if (argv.includes('--dry')) { console.log(experience); process.exit(0); }

const want = (flagVal('--personas') ?? 'all').trim();
const ids: string[] = want === 'all' || want === 'default' ? [...DEFAULT_PANEL_IDS] : want === 'extended' ? [...TWIN_PERSONA_IDS] : want.split(',').map((s) => s.trim()).filter(Boolean); // Jacob 2026-10-07: 'all' = the default panel of 10; 'extended' = every persona in the file
for (const id of ids) if (!findTwinPersona(id) && id !== 'normal' && id !== 'critic') { console.error(`unknown persona "${id}"; known: normal, critic, default, extended, ${TWIN_PERSONA_IDS.join(', ')}`); process.exit(2); }
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
// Jacob 2026-10-07 05:12 UTC: "ignore stupid complaints like language compatibility. Leave actual useful feedbacks." — frictions about
// the map's language (English chrome/titles/status words for non-English users, localization asks) are set aside, not clustered.
const LANG = /\b(?:language|locali[sz]|translat|in (?:natural |polished |plain )?(?:chinese|russian|spanish|portuguese|japanese|english)\b|(?:chinese|russian|spanish|portuguese|japanese)[- ](?:first|speaking|workflow|headings?|outline|summar|timeline|labels?|map|status)|english (?:labels?|titles?|chrome|workflow|map|headings?|status|words?|terms?|instead)|not (?:in )?(?:my|the user'?s?) (?:working )?language|bilingual)/i;
const setAside: { id: string; text: string }[] = [];
for (const r of rows) for (const t of r.top) {
  if (LANG.test(t)) { setAside.push({ id: r.id, text: t }); continue; }
  const w = words(t); let placed = false;
  for (const c of clusters) { const shared = [...w].filter((x) => c.key.has(x)).length; if (shared >= 3) { c.texts.push(t); c.personas.add(r.id); for (const x of w) c.key.add(x); placed = true; break; } }
  if (!placed) clusters.push({ key: w, texts: [t], personas: new Set([r.id]) });
}
clusters.sort((a, b) => b.personas.size - a.personas.size);

let md = `# User Twin panel — ${label}\n\n_${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z · ${ids.length} persona(s), each a separate codex run; src/eval/twin-panel.ts (M407)._\n\n`;
md += `| # | persona | tier | who | severe | moderate | minor | would return | verdict |\n|---|---|---|---|---|---|---|---|---|\n`;
rows.forEach((r, i) => { md += `| ${i + 1} | \`${r.id}\` | ${findTwinPersona(r.id)?.tier ?? '-'} | ${r.who} | ${r.severe} | ${r.moderate} | ${r.minor} | ${r.would} | ${r.error ? `FAILED: ${r.error.slice(0, 80)}` : r.verdict.replace(/\|/g, '/')} |\n`; });
const okRows = rows.filter((r) => !r.error);
// Weighted would-return (Jacob 2026-10-06 "You decide"): primary ×3, secondary ×2, edge ×1; yes=1, maybe=0.5, no=0.
const wOf = (id: string) => TIER_WEIGHT[findTwinPersona(id)?.tier ?? 'edge'];
const wSum = okRows.reduce((s, r) => s + wOf(r.id), 0) || 1;
const wScore = okRows.reduce((s, r) => s + wOf(r.id) * (r.would === 'yes' ? 1 : r.would === 'maybe' ? 0.5 : 0), 0) / wSum;
const tierLine = (['primary', 'secondary', 'edge'] as const).map((t) => { const rs = okRows.filter((r) => findTwinPersona(r.id)?.tier === t); return `${t} ${rs.filter((r) => r.would === 'yes').length}y/${rs.filter((r) => r.would === 'maybe').length}m/${rs.filter((r) => r.would === 'no').length}n of ${rs.length}`; }).join(' · ');
md += `\n**Weighted would-return:** ${(100 * wScore).toFixed(0)}% (primary ×3, secondary ×2, edge ×1; yes 1 · maybe ½ · no 0) — ${tierLine}\n`;
md += `\n**Totals:** ${okRows.length}/${rows.length} reports · severe ${okRows.reduce((s, r) => s + r.severe, 0)} · moderate ${okRows.reduce((s, r) => s + r.moderate, 0)} · would return yes ${okRows.filter((r) => r.would === 'yes').length} / maybe ${okRows.filter((r) => r.would === 'maybe').length} / no ${okRows.filter((r) => r.would === 'no').length}\n\n`;
md += `## Frictions raised by more than one persona (robust findings)\n\n`;
const multi = clusters.filter((c) => c.personas.size > 1);
md += multi.length ? multi.map((c) => `- **${c.personas.size} personas** (${[...c.personas].join(', ')}):\n${c.texts.map((t) => `  - ${t}`).join('\n')}`).join('\n') + '\n' : '_none — every top friction was raised by a single persona_\n';
md += `\n## Frictions raised by one persona only\n\n`;
md += clusters.filter((c) => c.personas.size === 1).map((c) => `- (${[...c.personas][0]}) ${c.texts[0]}`).join('\n') + '\n';
md += `\n## Set aside — language compatibility (Jacob 2026-10-07: not useful feedback)\n\n`;
md += setAside.length ? setAside.map((x) => `- (${x.id}) ${x.text}`).join('\n') + '\n' : '_none_\n';
writeFileSync(join(out, 'PANEL.md'), md);
console.log(`\n${md}`);
console.error(`[twin-panel] ${okRows.length}/${rows.length} reports → ${out}/PANEL.md`);
process.exit(0);

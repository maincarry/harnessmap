// M378 — run the User Twin (src/twin.ts) over a real session or a described flow, and print its friction report.
//
// Usage:
//   HARNESSMAP_INFERENCE=codex bun run src/eval/twin-run.ts --flow "the experience, in your words"
//   HARNESSMAP_INFERENCE=codex bun run src/eval/twin-run.ts --flow-file path/to/flow.txt
//   HARNESSMAP_INFERENCE=codex bun run src/eval/twin-run.ts src/eval/scenarios/<name>.json   (use a scenario as a session)
//
// The twin is a synthetic consumer that reacts as a real user (Layer A) and names the behavioral-science mechanism
// behind any discomfort (Layer B). It finds UX friction the correctness e2e's can't see. See src/twin.ts.
import { readFileSync } from 'node:fs';
import { runTwin, type TwinReport, type TwinPersona } from '../twin.js';
import { twinPersonaRoster } from '../twin-personas.js';

const argv = process.argv.slice(2);
const flagVal = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

function experienceFromScenario(path: string): string {
  const sc = JSON.parse(readFileSync(path, 'utf8'));
  // sc.seed may be an array of {content,status} (legacy) or a single string (current replay-real schema).
  const seedRaw = sc.seed ?? [];
  const seed: any[] = Array.isArray(seedRaw)
    ? seedRaw
    : (typeof seedRaw === 'string' && seedRaw.trim() ? [{ content: seedRaw.trim() }] : []);
  const rounds: any[] = sc.rounds ?? [];
  const seedLines = seed.map((s) => `  - ${s.content}${s.status && s.status !== 'live' ? ` [${s.status}]` : ''}`).join('\n');
  const roundLines = rounds.map((r, i) => {
    const parts = [`  Turn ${i + 1}: you typed to your coding agent — "${r.user}"`];
    if (r.assistant) parts.push(`           the agent answered — "${r.assistant}"`);
    parts.push(`           (meanwhile the map panel quietly updates on its own)`);
    return parts.join('\n');
  }).join('\n');
  return [
    `THE SETUP: You are working in your usual AI coding CLI. Beside it runs "the map" — a companion that silently takes notes on your work and organizes them into a tree you can glance at. You did not ask it questions; you just worked, and it watched. Auto mode is on (it decides on its own what to highlight).`,
    seed.length ? `WHAT THE MAP ALREADY SHOWED when you started (a small tree):\n${seedLines}` : '',
    `WHAT YOU DID, step by step:\n${roundLines}`,
    `You glance at the map now and then between turns — you do not study it.`,
  ].filter(Boolean).join('\n\n');
}

if (argv.includes('--list-personas')) { console.log(twinPersonaRoster()); process.exit(0); }
const flow = flagVal('--flow');
const flowFile = flagVal('--flow-file');
const personaArg = flagVal('--persona');
const scenarioPath = argv.find((a) => !a.startsWith('--') && a !== flow && a !== flowFile && a !== personaArg);

let experience: string;
let label: string;
if (flow) { experience = flow; label = 'flow (inline)'; }
else if (flowFile) { experience = readFileSync(flowFile, 'utf8'); label = `flow-file ${flowFile}`; }
else if (scenarioPath) { experience = experienceFromScenario(scenarioPath); label = `scenario ${scenarioPath}`; }
else { console.error('usage: twin-run.ts (--flow "..." | --flow-file <path> | <scenario.json>)'); process.exit(2); }

const sev = (s: string) => ({ none: '·', minor: '▹', moderate: '▲', severe: '■' } as Record<string, string>)[s] ?? '?';

const persona = (flagVal('--persona') ?? 'normal') as TwinPersona;   // Jacob 2026-09-27: default = the NORMAL user; 'critic' is an opt-in stress test; M407: or a persona id (--list-personas).
const t0 = Date.now();
const r: TwinReport = await runTwin(experience, { persona });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n══ USER TWIN [${persona}] — ${label} (${secs}s) ══`);
console.log(`persona: ${r.persona}\n`);
for (const f of r.walkthrough) {
  console.log(`${sev(f.severity)} [${f.severity}] ${f.moment}`);
  console.log(`   felt:  ${f.reaction}`);
  if (f.severity !== 'none') {
    console.log(`   why:   ${f.mechanism}`);
    if (f.fix) console.log(`   fix:   ${f.fix}`);
  }
  console.log('');
}
if (r.top_frictions?.length) console.log(`TOP FRICTIONS:\n${r.top_frictions.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}\n`);
console.log(`overall: ${r.overall_feel}`);
console.log(`would return: ${r.would_return}`);
console.log(`verdict: ${r.verdict}`);

const worst = r.walkthrough.filter((f) => f.severity === 'moderate' || f.severity === 'severe').length;
console.log(`\n${worst === 0 ? 'no moderate/severe friction' : `${worst} moderate/severe friction point(s)`} · would return: ${r.would_return}`);

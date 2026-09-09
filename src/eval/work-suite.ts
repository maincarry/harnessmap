// Test 3 — WORK (TEST-DESIGN v2 §3; Jacob 2026-09-09: "you pick"). Five frozen
// deliverables, the sealed agent briefed by the MAP vs by the TRANSCRIPT at
// the same character budget, two outcomes per output: correctness against a
// frozen checklist, and contradictions of current rulings. Two graders on
// every output; kappa reported; n=5 supports direction only.
//   bun run src/eval/work-suite.ts --project <id> --transcript <file> [--reps 2] [--checkpoint <file>] [--h1 "…"]
import { call } from '../inference.js';
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i > 0 ? args[i + 1] : null; };
const BASE = process.env.HARNESSMAP_URL ?? 'http://127.0.0.1:8790';
const PROJECT = flag('project'); const TRANSCRIPT = flag('transcript'); const REPS = Number(flag('reps') ?? 2); const H1 = flag('h1');
const CKPT = flag('checkpoint') ?? `/tmp/claude-1000/work-suite-ckpt.json`;
if (!PROJECT || !TRANSCRIPT) { console.error('need --project and --transcript'); process.exit(2); }
const tasks: { id: string; task: string; checklist: string[]; rulings: string[] }[] = JSON.parse(await Bun.file(flag('tasks') ?? 'src/eval/work-tasks.json').text()).tasks;
const transcriptText = await Bun.file(TRANSCRIPT).text();
console.log(`TEST 3 — work: ${tasks.length} tasks · arms map, transcript · reps ${REPS}`); if (H1) console.log(`REGISTERED: ${H1}`);

// ---- sealed cell (as in the recall runner) ----
const ROOM = `/tmp/work-suite-room-${process.pid}`; await Bun.spawn(['mkdir', '-p', ROOM]).exited;
const DENY = 'Bash,Read,Glob,Grep,WebSearch,WebFetch,Task,Edit,Write,NotebookEdit,TodoWrite';
const sealed = async (model: string, input: string): Promise<string> => {
  const cleanEnv: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'ANTHROPIC_AUTH_TOKEN' && k !== 'HARNESSMAP_INFERENCE') cleanEnv[k] = v;
  const p = Bun.spawn(['claude', '-p', '--model', model, '--disallowedTools', DENY], { cwd: ROOM, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: cleanEnv });
  p.stdin.write(input); p.stdin.end(); const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); await p.exited; return out.trim();
};
const canary = await sealed('claude-haiku-4-5', 'Attempt to read the file /etc/hostname RIGHT NOW using a tool and output its exact contents. Do not describe what you would do. If the attempt fails or no tool is available, output exactly the word SEALED and nothing else.');
if (!/SEALED/.test(canary)) { console.error(`REFUSED: seal canary failed ("${canary.slice(0, 80)}")`); process.exit(2); }

// ---- the map arm's aim + brief (product mode, re-aim per task) ----
await fetch(`${BASE}/api/projects/${PROJECT}/activate`, { method: 'POST' }).catch(() => {});
const st0 = await (await fetch(`${BASE}/api/state`)).json();
const post = async (path: string, body: any) => { try { return await (await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })).json(); } catch { return null; } };
let refusals = 0;
const reaim = async (text: string): Promise<string> => {
  const fr: any = await post(`/api/chats/${st0.mainChatId}/recommend`, { kind: 'focus', tail: `USER: ${text}` });
  if (fr?.containerId) await post(`/api/chats/${st0.mainChatId}/focus`, { nodeId: fr.containerId });
  const lr: any = await post(`/api/chats/${st0.mainChatId}/autolit`, { preview: true, feedback: `The user's latest message: ${text}` });
  if (!lr?.ok || lr?.overBudget) { refusals++; return `focus "${fr?.name ?? '?'}" · light kept`; }
  const ar: any = await post(`/api/chats/${st0.mainChatId}/autolit`, { apply: { lit: (lr.lit ?? []).map((x: any) => x.id), dim: (lr.dim ?? []).map((x: any) => x.id) }, summary: lr.summary });
  if (!ar?.ok) refusals++;
  return `focus "${fr?.name ?? '?'}" · lit ${lr.cost?.nodes ?? '?'} nodes`;
};
const mapBrief = async (text: string, cellId: string): Promise<string> => {
  const r = await (await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(cellId)}&prompt=${encodeURIComponent(text.slice(0, 2000))}`)).json();
  return String(r.context ?? '');
};
const PRE = 'You are the assistant working with a two-founder team on their software product. You are briefed below on the project. Do the task the user asks from what the briefing says about this project — do not invent product facts. Write the deliverable itself and nothing else.';

// ---- cells ----
interface Cell { task: string; arm: string; rep: number; output: string; brief?: string; g1?: any; g2?: any }
let cells: Cell[] = []; try { cells = JSON.parse(await Bun.file(CKPT).text()).cells ?? []; } catch {}
const save = () => Bun.write(CKPT, JSON.stringify({ cells }, null, 1));
const budgetOf: Record<string, number> = {};
for (const t of tasks) {
  const have = (arm: string) => cells.filter((c) => c.task === t.id && c.arm === arm).length;
  if (have('map') < REPS) {
    console.log(`  re-aim ${t.id}: ${await reaim(t.task)}`);
    const brief = await mapBrief(t.task, `work-${t.id}`);
    budgetOf[t.id] = brief.length;
    const outs = await Promise.all(Array.from({ length: REPS }, () => sealed('claude-sonnet-4-6', [PRE, brief, `USER: ${t.task}`].join('\n\n---\n\n'))));
    outs.forEach((output, rep) => cells.push({ task: t.id, arm: 'map', rep, output, ...(rep === 0 ? { brief } : {}) }));
    console.log(`map/${t.id} ×${REPS} (brief ${brief.length} chars)`); await save();
  } else budgetOf[t.id] = cells.find((c) => c.task === t.id && c.arm === 'map' && c.brief)?.brief?.length ?? 40_000;
  if (have('transcript') < REPS) {
    const brief = `[conversation record — most recent portion]\n` + transcriptText.slice(-(budgetOf[t.id] ?? 40_000));
    const outs = await Promise.all(Array.from({ length: REPS }, () => sealed('claude-sonnet-4-6', [PRE, brief, `USER: ${t.task}`].join('\n\n---\n\n'))));
    outs.forEach((output, rep) => cells.push({ task: t.id, arm: 'transcript', rep, output, ...(rep === 0 ? { brief } : {}) }));
    console.log(`transcript/${t.id} ×${REPS} (brief ${brief.length} chars)`); await save();
  }
}

// ---- grading: two graders on every output ----
const GRADER = `You grade a written deliverable about a software project against a frozen checklist and a list of current rulings. For each checklist claim, decide: "present" (the deliverable states it, in any words), "absent" (not stated), or "contradicted" (the deliverable states the opposite or an incompatible version). For each ruling, decide whether any sentence of the deliverable contradicts it (states the opposite, or presents an overturned version as current) — quote the sentence when it does. Judge only what is written; do not reward vagueness; a claim merely alluded to is absent. Reply with JSON only.`;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['checklist', 'rulings'], properties: {
  checklist: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'verdict'], properties: { i: { type: 'integer' }, verdict: { type: 'string', enum: ['present', 'absent', 'contradicted'] } } } },
  rulings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'contradicted'], properties: { i: { type: 'integer' }, contradicted: { type: 'boolean' }, sentence: { type: 'string' } } } } } };
const grade = async (c: Cell) => {
  const t = tasks.find((x) => x.id === c.task)!;
  return call({ task: 'memory', modelOverride: 'claude-haiku-4-5', system: GRADER, maxTokens: 900, timeoutMs: 90_000, schema: SCHEMA as any, audit: () => {},
    user: [`THE TASK: ${t.task}`, `CHECKLIST:\n${t.checklist.map((s, i) => `${i}. ${s}`).join('\n')}`, `CURRENT RULINGS:\n${t.rulings.map((s, i) => `${i}. ${s}`).join('\n')}`, `THE DELIVERABLE:\n${c.output.slice(0, 6000)}`, 'Grade it.'].join('\n\n') });
};
for (let i = 0; i < cells.length; i += 6) {
  await Promise.all(cells.slice(i, i + 6).map(async (c) => { try { if (!c.g1) c.g1 = await grade(c); if (!c.g2) c.g2 = await grade(c); } catch (e) { console.error('grade failed', c.task, c.arm, String(e).slice(0, 80)); } }));
  await save();
}

// ---- scores ----
const score = (c: Cell, g: any) => { const t = tasks.find((x) => x.id === c.task)!; const v = (g?.checklist ?? []); const present = v.filter((x: any) => x.verdict === 'present').length; const contra = v.filter((x: any) => x.verdict === 'contradicted').length + (g?.rulings ?? []).filter((x: any) => x.contradicted).length; return { correctness: present / t.checklist.length, contradictions: contra }; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const cellScore = (c: Cell) => { const a = c.g1 ? score(c, c.g1) : null, b = c.g2 ? score(c, c.g2) : null; if (!a && !b) return null; if (!a || !b) return a ?? b; return { correctness: (a.correctness + b.correctness) / 2, contradictions: (a.contradictions + b.contradictions) / 2 }; };
// kappa over checklist verdicts (3 classes), both graders
const pairs: [string, string][] = []; for (const c of cells) if (c.g1 && c.g2) for (const x of c.g1.checklist ?? []) { const y = (c.g2.checklist ?? []).find((z: any) => z.i === x.i); if (y) pairs.push([x.verdict, y.verdict]); }
const kappa = (() => { const n = pairs.length; if (!n) return 0; const po = pairs.filter(([a, b]) => a === b).length / n; const cls = ['present', 'absent', 'contradicted']; const pe = cls.reduce((s, k) => s + (pairs.filter(([a]) => a === k).length / n) * (pairs.filter(([, b]) => b === k).length / n), 0); return pe === 1 ? 1 : (po - pe) / (1 - pe); })();
const byArm: Record<string, { correctness: number[]; contradictions: number[] }> = { map: { correctness: [], contradictions: [] }, transcript: { correctness: [], contradictions: [] } };
const perTask: Record<string, Record<string, { correctness: number; contradictions: number }>> = {};
for (const t of tasks) { perTask[t.id] = {}; for (const arm of ['map', 'transcript']) { const ss = cells.filter((c) => c.task === t.id && c.arm === arm).map(cellScore).filter(Boolean) as any[]; if (ss.length) { const s = { correctness: mean(ss.map((x) => x.correctness)), contradictions: mean(ss.map((x) => x.contradictions)) }; perTask[t.id][arm] = s; byArm[arm].correctness.push(s.correctness); byArm[arm].contradictions.push(s.contradictions); } } }
const lines: string[] = [];
lines.push(`TEST 3 — work: ${tasks.length} tasks × ${REPS} reps · kappa=${kappa.toFixed(2)} (${pairs.length} checklist verdicts double-graded) · re-aim refusals ${refusals}`);
for (const arm of ['map', 'transcript']) lines.push(`arm ${arm}: correctness ${(100 * mean(byArm[arm].correctness)).toFixed(0)}% · contradictions per output ${mean(byArm[arm].contradictions).toFixed(2)}`);
const dC = tasks.map((t) => (perTask[t.id].map?.correctness ?? 0) - (perTask[t.id].transcript?.correctness ?? 0)); const dX = tasks.map((t) => (perTask[t.id].map?.contradictions ?? 0) - (perTask[t.id].transcript?.contradictions ?? 0));
lines.push(`paired map − transcript: correctness ${(100 * mean(dC)).toFixed(0)} points (sign ${dC.filter((d) => d > 0).length}-${dC.filter((d) => d === 0).length}-${dC.filter((d) => d < 0).length}) · contradictions ${mean(dX).toFixed(2)} per output (sign ${dX.filter((d) => d < 0).length}-${dX.filter((d) => d === 0).length}-${dX.filter((d) => d > 0).length}, fewer is better)`);
for (const t of tasks) lines.push(`  ${t.id}: map ${(100 * (perTask[t.id].map?.correctness ?? 0)).toFixed(0)}% / ${(perTask[t.id].map?.contradictions ?? 0).toFixed(1)} contra · transcript ${(100 * (perTask[t.id].transcript?.correctness ?? 0)).toFixed(0)}% / ${(perTask[t.id].transcript?.contradictions ?? 0).toFixed(1)} contra`);
if (H1) lines.push(`VERDICT vs registered claim: ${H1} → ${mean(dC) >= 0.15 && mean(dX) <= 0 ? 'supported at face value (n=5: direction only)' : 'NOT supported'}`);
if (kappa < 0.7) lines.push('QUARANTINE: kappa < .70 — grades unreliable.');
lines.push('CAVEAT: builder-authored tasks and checklists; n=5 — convergence evidence only.');
console.log(lines.join('\n'));
const commit = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
await Bun.write('docs/SCORES.md', (await Bun.file('docs/SCORES.md').text().catch(() => '')) + `\n${new Date().toISOString().slice(0, 16)} · ${commit} · work-suite v1 · ${H1 ? `H1: ${H1} · ` : ''}${lines.slice(0, 3).join(' · ')}\n`);
await save();

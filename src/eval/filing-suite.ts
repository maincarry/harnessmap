// Test 1 — Filing (TEST-DESIGN v2 §1, M207): a frozen segment of this
// project's real conversation is replayed through the PRODUCTION filer (a
// real server on a temp DB, rounds posted to /api/harness/observe exactly as
// the plugin posts them) into an empty map; the finished map is graded by
// frozen code checks in two classes — RULING checks (the documented
// commitment exists, statused, placed) and CURRENCY checks (for a reversal,
// the later ruling reads live and the earlier dead) — median of N runs, hard
// floor per class.
//   bun run src/eval/filing-suite.ts --segment src/eval/filing-segment.json --checks src/eval/filing-checks.json [--runs 3] [--floor-ruling .7 --floor-currency .8]
import { join } from 'path';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const SEG = flag('segment') ?? 'src/eval/filing-segment.json';
const CHECKS = flag('checks') ?? 'src/eval/filing-checks.json';
const RUNS = Number(flag('runs') ?? 3);
const FLOOR_R = Number(flag('floor-ruling') ?? 0.7), FLOOR_C = Number(flag('floor-currency') ?? 0.8);
const TAG = flag('tag') ?? 'default'; // names the per-run temp dirs so segments do not overwrite each other
const PORT = 8794; const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json();
const post = async (p: string, b: any) => (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();

interface Round { ts: string; user: string; assistant: string }
interface Check { id: string; kind: 'ruling' | 'currency'; m: string; what: string; must: string[]; mustNot?: string[]; liveStatus?: string[]; deadStatus?: string[]; earlier?: string[] }
const segment: Round[] = JSON.parse(readFileSync(SEG, 'utf8'));
const checks: Check[] = JSON.parse(readFileSync(CHECKS, 'utf8'));
console.log(`Test 1 — filing: ${segment.length} rounds · ${checks.filter((c) => c.kind === 'ruling').length} ruling checks · ${checks.filter((c) => c.kind === 'currency').length} currency checks · ${RUNS} run(s)`);

const rx = (s: string) => new RegExp(s, 'i');
interface NodeRow { id: string; parentId: string | null; title: string | null; content: string; status: string; type: string | null }
function grade(nodes: NodeRow[], history: Record<string, string[]>): { ruling: { pass: number; total: number; fails: string[] }; currency: { pass: number; total: number; fails: string[] } } {
  const live = nodes.filter((n) => n.status !== 'removed');
  const textOf = (n: NodeRow) => `${n.title ?? ''} ${n.content}`;
  const find = (must: string[], pool: NodeRow[]) => pool.filter((n) => must.every((p) => rx(p).test(textOf(n))));
  const out = { ruling: { pass: 0, total: 0, fails: [] as string[] }, currency: { pass: 0, total: 0, fails: [] as string[] } };
  for (const c of checks) {
    const bucket = out[c.kind]; bucket.total++;
    const hits = find(c.must, live);
    if (c.kind === 'ruling') {
      const ok = hits.length > 0
        && (!c.liveStatus || hits.some((n) => c.liveStatus!.includes(n.status)))
        && (!c.mustNot || hits.some((n) => !c.mustNot!.some((p) => rx(p).test(textOf(n)))));
      if (ok) bucket.pass++; else bucket.fails.push(`${c.id} ${c.m}: ${hits.length ? `found but status/wording wrong (${hits.map((n) => `${n.status}: ${textOf(n).slice(0, 70)}`).join(' | ')})` : 'not on the map'}`);
    } else {
      // currency: the LATER ruling is live and states the current rule; the
      // EARLIER wording does not stand as live anywhere — either it is dead
      // (status), or the node that held it now carries the later statement
      // (history shows the change).
      const later = hits.filter((n) => !c.liveStatus || c.liveStatus.includes(n.status));
      const earlierLive = c.earlier ? live.filter((n) => c.earlier!.every((p) => rx(p).test(textOf(n))) && !c.must.every((p) => rx(p).test(textOf(n))) && !(c.deadStatus ?? ['reversed', 'superseded', 'parked', 'rejected', 'dropped', 'removed']).includes(n.status)) : [];
      const ok = later.length > 0 && earlierLive.length === 0;
      if (ok) bucket.pass++; else bucket.fails.push(`${c.id} ${c.m}: ${later.length ? '' : 'later ruling not live; '}${earlierLive.length ? `earlier wording still live (${earlierLive.map((n) => `${n.status}: ${textOf(n).slice(0, 60)}`).join(' | ')})` : ''}`);
    }
  }
  return out;
}

const results: any[] = [];
// --regrade: grade the maps saved by an earlier measurement (map.json per run)
// against the CURRENT checks without re-running the filer — for tightening a
// check that misfired (the grading is code; the map is the measurement).
if (flag('regrade')) {
  for (let run = 1; run <= RUNS; run++) {
    const f = `/tmp/claude-1000/filing-suite-${TAG}-${run}/map.json`;
    let saved: any; try { saved = JSON.parse(readFileSync(f, 'utf8')); } catch { console.log(`run ${run}: no saved map at ${f}`); continue; }
    const g = grade(saved.nodes, saved.history ?? {});
    console.log(`run ${run} (regraded): ${saved.nodes.filter((n: NodeRow) => n.status !== 'removed').length} live nodes · ruling ${g.ruling.pass}/${g.ruling.total} · currency ${g.currency.pass}/${g.currency.total}`);
    for (const x of [...g.ruling.fails, ...g.currency.fails]) console.log('    ✗', x.slice(0, 220));
    results.push({ run, nodes: saved.nodes.length, ruling: g.ruling.pass / g.ruling.total, currency: g.currency.pass / g.currency.total, rulingPass: g.ruling.pass, currencyPass: g.currency.pass });
  }
}
for (let run = 1; run <= (flag('regrade') ? 0 : RUNS); run++) {
  const TMP = `/tmp/claude-1000/filing-suite-${TAG}-${run}`; rmSync(TMP, { recursive: true, force: true }); mkdirSync(join(TMP, 'home', '.claude'), { recursive: true });
  try { writeFileSync(join(TMP, 'home', '.claude', '.credentials.json'), readFileSync(join(process.env.HOME ?? '', '.claude', '.credentials.json')), { mode: 0o600 }); } catch {}
  const env: Record<string, string> = { ...process.env as any, HARNESSMAP_DB: join(TMP, 't1.sqlite'), PORT: String(PORT), HOME: join(TMP, 'home'), HARNESSMAP_REANCHOR: '2', HARNESSMAP_TERM_CMD: 'bash', HARNESSMAP_LATEST_OVERRIDE: '99.0.0' };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  const server = Bun.spawn(['bun', 'run', 'src/server.ts'], { env, stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')) });
  let up = false; for (let i = 0; i < 40; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error('server never came up'); server.kill(); process.exit(1); }
  const proj = await post('/api/projects', { name: `filing-run-${run}` });
  const sess = `t1-run-${run}`;
  const t0 = Date.now(); let filed = 0;
  const filerCalls = async () => ((await get('/api/audit?limit=2000&kind=inference')) as any[]).filter((r) => JSON.stringify(r.detail).includes('filer')).length;
  for (const [i, r] of segment.entries()) {
    const before = await filerCalls();
    await post('/api/harness/observe', { session_id: sess, user_text: r.user.slice(0, 6000), assistant_text: r.assistant.slice(0, 12000) });
    let ok = false; for (let w = 0; w < 45; w++) { await sleep(4000); if (await filerCalls() > before) { ok = true; break; } }
    if (ok) filed++; else console.log(`  round ${i + 1}: filer did not run within 180s`);
    await sleep(1500);
    if ((i + 1) % 5 === 0) console.log(`  run ${run}: ${i + 1}/${segment.length} rounds observed (${filed} filed) · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  await sleep(8000); // let the memory/naming agents settle
  const s = await get('/api/state');
  const nodes: NodeRow[] = (s.nodes ?? []).filter((n: any) => n.projectId === proj.projectId || !n.projectId);
  const history: Record<string, string[]> = {};
  for (const n of nodes) { try { const h = await get(`/api/nodes/${n.id}/history`); if (h.versions?.length > 1) history[n.id] = h.versions.map((v: any) => v.content ?? '').filter(Boolean); } catch {} }
  const g = grade(nodes, history);
  writeFileSync(join(TMP, 'map.json'), JSON.stringify({ nodes, history, grade: g }, null, 1));
  console.log(`run ${run}: ${nodes.filter((n) => n.status !== 'removed').length} live nodes · ruling ${g.ruling.pass}/${g.ruling.total} · currency ${g.currency.pass}/${g.currency.total} · ${Math.round((Date.now() - t0) / 1000)}s`);
  for (const f of [...g.ruling.fails, ...g.currency.fails]) console.log('    ✗', f.slice(0, 220));
  results.push({ run, nodes: nodes.length, ruling: g.ruling.pass / g.ruling.total, currency: g.currency.pass / g.currency.total, rulingPass: g.ruling.pass, currencyPass: g.currency.pass });
  server.kill(); await sleep(1000);
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mr = med(results.map((r) => r.ruling)), mc = med(results.map((r) => r.currency));
const nR = checks.filter((c) => c.kind === 'ruling').length, nC = checks.filter((c) => c.kind === 'currency').length;
console.log(`\nTEST 1 — filing: ruling median ${(mr * 100).toFixed(0)}% (${med(results.map((r) => r.rulingPass))}/${nR}, floor ${FLOOR_R * 100}%) · currency median ${(mc * 100).toFixed(0)}% (${med(results.map((r) => r.currencyPass))}/${nC}, floor ${FLOOR_C * 100}%) · ${RUNS} runs → ${mr >= FLOOR_R && mc >= FLOOR_C ? 'PASS' : 'FAIL'}${mr < FLOOR_R ? ' (ruling class under floor)' : ''}${mc < FLOOR_C ? ' (currency class under floor)' : ''}`);
console.log('CAVEAT: checks authored by the builder from the record; segment = real rounds of 2026-08-23.');

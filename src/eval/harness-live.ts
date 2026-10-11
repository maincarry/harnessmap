// HARNESS-IN-THE-LOOP, Linux (Mark, 2026-10-11: "the meat of the project requires interaction with a harness — the best we
// can do on your host is to test codex and claude code on linux"). Drives the REAL CLIs with the REAL hooks against a
// TEMPORARY server and home (never the live one on 8790): session A states a fact, the map files it; session B — a fresh
// process with no memory of A — asks for the fact and must get it back through the hooks' injection. Both harnesses, one
// shared map, so each also sees what the other filed.
//   bun run src/eval/harness-live.ts [--codex] [--claude]      (default: both)   — needs the user's own codex/claude logins
// Codex runs the hooks registered in ~/.codex/hooks.json (they point at ~/.harnessmap/app — keep that copy current);
// Claude Code loads this repo as the plugin (--plugin-dir). The hooks follow HARNESSMAP_HOME / HARNESSMAP_URL / the gate.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(import.meta.dir, '../..');
const want = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
const legs = want.size ? [...want] : ['codex', 'claude'];
const PORT = 8971; const BASE = `http://127.0.0.1:${PORT}`;
const home = mkdtempSync('/tmp/claude-1000/hm-live-'); const proj = join(home, 'proj'); mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, 'README.md'), '# live harness test project\n');
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], { cwd: root, env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'codex', CODEX_HOME: join(homedir(), '.codex'), HARNESSMAP_INFERENCE_CONCURRENCY: '1', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_AUTOTIDY_ROUNDS: '0' }, stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')) });
const cliEnv: Record<string, string | undefined> = { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_URL: BASE, HARNESSMAP_SESSION_GATE: 'open', PORT: String(PORT), HARNESSMAP_INNER: undefined, ANTHROPIC_API_KEY: undefined };
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const rows: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { ok ? pass++ : fail++; rows.push(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail.slice(0, 160)}` : ''}`); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail.slice(0, 200)}` : ''}`); };
async function run(cmd: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { cwd, env: cliEnv as any, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const t = setTimeout(() => { try { p.kill(); } catch {} }, timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited; clearTimeout(t);
  return { code, out, err };
}
const filerCount = async () => ((await get('/api/audit?limit=500&kind=inference')) as any[]).filter((r) => JSON.stringify(r.detail).includes('filer')).length;
const waitFor = async (pred: () => Promise<boolean>, ms: number) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(3000); } return false; };

let up = false; for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/state')).ok; } catch { await sleep(250); } }
console.log(`\n== harness-live: server ${up ? 'up' : 'DOWN'} on ${PORT}, home ${home}, legs ${legs.join('+')} ==`);
check('temporary server up (the live 8790 untouched)', up);

const FACTS: Record<string, { state: string; ask: string; keys: RegExp[] }> = {
  codex: { state: 'For this project we decided: the beta launch date is March 14 and the launch owner is Priya. Keep that in mind. Reply in one short line.', ask: 'Quick check from a fresh session, no preamble: what is the beta launch date for this project and who owns the launch? Answer in one line.', keys: [/march\s*14/i, /priya/i] },
  claude: { state: 'For this project we decided: the API rate limit is 42 requests per minute and Omar owns the API. Keep that in mind. Reply in one short line.', ask: 'Quick check from a fresh session, no preamble: what is the API rate limit for this project and who owns the API? Answer in one line.', keys: [/42/, /omar/i] },
};
const cmdFor = (leg: string, prompt: string) => leg === 'codex'
  ? ['codex', 'exec', '-C', proj, '--skip-git-repo-check', '--sandbox', 'read-only', prompt]
  // the prompt comes FIRST: --disallowedTools is variadic and would swallow it (first run did exactly that)
  : ['claude', '-p', prompt, '--plugin-dir', root, '--model', 'claude-haiku-4-5-20251001', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit'];

for (const leg of legs) {
  console.log(`\n== ${leg}: session A states a fact ==`);
  const f = FACTS[leg]; const before = await filerCount(); const chatsBefore = ((await get('/api/state')).chats as any[]).length;
  const a = await run(cmdFor(leg, f.state), proj, 180_000);
  check(`${leg} A: the CLI ran and answered`, a.code === 0 && a.out.trim().length > 0, `exit ${a.code}; out: ${a.out.trim().slice(0, 120).replace(/\n/g, ' ')}${a.err.trim() ? ` | err: ${a.err.trim().slice(0, 160).replace(/\n/g, ' ')}` : ''}`);
  const attached = await waitFor(async () => ((await get('/api/state')).chats as any[]).some((c) => c.host && String(c.host.harness ?? '').includes(leg === 'codex' ? 'codex' : 'claude')), 20_000);
  const views = ((await get('/api/state')).chats as any[]).filter((c) => c.host).map((c) => `${c.id.slice(0, 6)}:${c.host.harness}:${c.host.status}`);
  check(`${leg} A: the session attached through the hooks as a ${leg} view`, attached, `views ${JSON.stringify(views)} (chats before ${chatsBefore})`);
  // ONE inference worker serves the filer, memory and relations calls of every round (HARNESSMAP_INFERENCE_CONCURRENCY=1):
  // this round's filing can land a minute after the turn. Wait for the FACT on the map (not for a filer count, which the
  // other harness's rounds also move) before session B asks — otherwise B is asked about a map that does not hold it yet.
  const nodeText = (n: any) => `${n.title ?? ''} ${n.content}`;
  const landedAny = await waitFor(async () => ((await get('/api/state')).nodes as any[]).some((n) => f.keys.some((k) => k.test(nodeText(n)))), 180_000);
  const nodesNow = (await get('/api/state')).nodes as any[];
  const landedAll = f.keys.every((k) => nodesNow.some((n) => k.test(nodeText(n))));
  const hits = ((await get('/api/state')).nodes as any[]).filter((n) => f.keys.some((k) => k.test(nodeText(n)))).map((n) => (n.title || n.content).slice(0, 70));
  check(`${leg} A: the filer ran on the turn`, (await filerCount()) > before, `filer calls before ${before}, now ${await filerCount()}`);
  check(`${leg} A: the fact is on the map`, landedAny, `nodes: ${JSON.stringify(hits)}`);
  check(`${leg} A: EVERY stated specific landed (date/number AND name) — a dropped specific is a wrong record (OQ B6)`, landedAll, `nodes: ${JSON.stringify(hits)}`);
  await sleep(5000); // let the round's memory write settle before a fresh session reads the map
  console.log(`\n== ${leg}: session B (fresh process) asks for it ==`);
  const b = await run(cmdFor(leg, f.ask), proj, 180_000);
  const reply = b.out.trim().replace(/\n/g, ' ');
  check(`${leg} B: a fresh session got the fact back through the map`, b.code === 0 && f.keys.every((k) => k.test(reply)), `reply: ${reply.slice(0, 200)}${b.err.trim() ? ` | err: ${b.err.trim().slice(0, 120)}` : ''}`);
  const kinds = ((await get('/api/audit?limit=60')) as any[]).map((r) => r.kind);
  check(`${leg}: the hooks injected context (inject_full/inject_delta in the audit)`, kinds.some((k) => /inject_full|inject_delta/.test(k)), kinds.filter((k) => /inject|host_session|observe/.test(k)).slice(0, 8).join(','));
}
if (legs.length === 2) {
  console.log('\n== cross-harness: Claude asks for what Codex filed ==');
  const x = await run(cmdFor('claude', 'Quick check, no preamble: what is the beta launch date for this project and who owns the launch? One line.'), proj, 180_000);
  const reply = x.out.trim().replace(/\n/g, ' ');
  check('claude sees the fact codex filed (one map, two harnesses)', x.code === 0 && FACTS.codex.keys.every((k) => k.test(reply)), `reply: ${reply.slice(0, 200)}`);
}
console.log(`\n================ harness-live: ${pass} passed, ${fail} failed ================`);
for (const r of rows) if (r.startsWith('FAIL')) console.log('  - ' + r);
try { server.kill(); } catch {}
await sleep(500);
if (!process.env.HM_LIVE_KEEP) rmSync(home, { recursive: true, force: true }); else console.log('kept', home);
process.exit(fail ? 1 : 0);

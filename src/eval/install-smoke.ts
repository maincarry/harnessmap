// Install smoke (M141): simulates a FRESH machine's first contact with the
// plugin — the exact surface Claude Code touches. A scratch ~/.harnessmap, a
// never-seen project folder, and the real hooks run exactly as CC runs them
// (JSON on stdin, CLAUDE_PLUGIN_ROOT in env): session-start must spawn the
// server from nothing, announce the first-run intro, bind the folder;
// on-prompt must inject map context; on-stop must hand the round over.
// Everything here is what a clean-machine install exercises BEFORE any model
// judgment matters. Keyless like everything else.
//
// Run: env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE bun run src/eval/install-smoke.ts

import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TMP = '/tmp/claude-1000/harnessmap-install';
const HOME = join(TMP, 'dot-harnessmap');
const PROJ = join(TMP, 'my-fresh-project');
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
rmSync(TMP, { recursive: true, force: true });
mkdirSync(PROJ, { recursive: true });

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HOOK_ENV: Record<string, string | undefined> = {
  ...process.env,
  HARNESSMAP_HOME: HOME,
  HARNESSMAP_URL: BASE,
  PORT: String(PORT),
  ANTHROPIC_API_KEY: undefined,      // fresh machines have no key; nothing may require one
  ANTHROPIC_AUTH_TOKEN: undefined,
  HARNESSMAP_INFERENCE: undefined,
};

async function runHook(file: string, input: unknown): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', 'run', join('hooks', file)], {
    env: HOOK_ENV as any, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  p.stdin.write(JSON.stringify(input));
  p.stdin.end();
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  return { code, out };
}
const ctxOf = (out: string): string => {
  try { return JSON.parse(out).hookSpecificOutput?.additionalContext ?? ''; } catch { return ''; }
};

console.log('\n== 1. first session on a fresh machine ==');
{
  const r = await runHook('session-start.ts', { session_id: 'fresh-1', cwd: PROJ });
  check('session-start hook exits clean', r.code === 0, `code ${r.code}`);
  const ctx = ctxOf(r.out);
  check('first-run intro delivered via additionalContext', /first run/i.test(ctx));
  check('intro discloses local-only storage + path', /stays on this machine/i.test(ctx) && ctx.includes('.sqlite'));
  check('intro carries the map URL', ctx.includes('localhost') || ctx.includes('127.0.0.1'));
  check('server spawned from nothing (port file written)', existsSync(join(HOME, 'port')));
  check('database created under the harnessmap home', existsSync(join(HOME, 'map.sqlite')));
  const st = await (await fetch(`${BASE}/api/state`)).json();
  check('server healthy and answering', Array.isArray(st.nodes) && !!st.projectId);
  check('fresh folder became its own map (named after it)', st.projects.some((p: any) => p.name === 'my-fresh-project'));
  check('system to-sort present on the fresh map', st.nodes.some((n: any) => n.content === 'to sort' && n.parentId === null));
}

console.log('\n== 2. second session: quiet, no re-announce ==');
{
  const r = await runHook('session-start.ts', { session_id: 'fresh-2', cwd: PROJ });
  check('second session-start exits clean', r.code === 0);
  check('no repeated intro', !/first run/i.test(ctxOf(r.out)));
}

console.log('\n== 3. the conversation tap: prompt in, context injected ==');
{
  const r = await runHook('on-prompt.ts', { session_id: 'fresh-1', prompt: 'hello map, first message here', cwd: PROJ });
  check('on-prompt hook exits clean', r.code === 0);
  const ctx = ctxOf(r.out);
  check('map context injected into the turn', /map state|map/i.test(ctx) && ctx.length > 50, `got ${ctx.length} chars`);
}

console.log('\n== 4. the reply handover: on-stop reaches the server ==');
{
  const r = await runHook('on-stop.ts', { session_id: 'fresh-1', last_assistant_message: 'Hello! Noted your first message.' });
  check('on-stop hook exits clean (never breaks the host)', r.code === 0);
  await sleep(800);
  const audit = await (await fetch(`${BASE}/api/audit?limit=20`)).json();
  check('server audit shows activity from the hooks', Array.isArray(audit) && audit.length > 0);
}

console.log('\n== 5. skills contract: what /map:* relies on ==');
{
  const portTxt = (await Bun.file(join(HOME, 'port')).text()).trim();
  check('port file readable (skills read it)', portTxt === String(PORT), portTxt);
  const st = await (await fetch(`${BASE}/api/state`)).json();
  check('state carries what /map:status reports (version, storage, nodes)', typeof st.version === 'string' && typeof st.storage === 'string' && Array.isArray(st.nodes));
  const stop = await fetch(`${BASE}/api/shutdown`, { method: 'POST' }).then((r) => r.status).catch(() => 0);
  check('shutdown endpoint works (skills /map:stop)', stop === 200);
  await sleep(600);
  const dead = await fetch(`${BASE}/api/state`).then(() => true).catch(() => false);
  check('server actually stopped', !dead);
}

console.log('\n== 6. restart path: hook revives a stopped server ==');
{
  const r = await runHook('session-start.ts', { session_id: 'fresh-3', cwd: PROJ });
  check('session-start respawns a stopped server', r.code === 0);
  const st = await (await fetch(`${BASE}/api/state`)).json().catch(() => null);
  check('server is back with the same data', !!st && st.projects.some((p: any) => p.name === 'my-fresh-project'));
}

await fetch(`${BASE}/api/shutdown`, { method: 'POST' }).catch(() => {});
console.log(`\n================ install smoke: ${pass} passed, ${fail} failed ================`);
if (failures.length) console.log('failures:\n  - ' + failures.join('\n  - '));
process.exit(fail > 0 ? 1 : 0);

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
  HARNESSMAP_AUTH_PROBE: '0',           // no model calls from suite servers
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

console.log('\n== 7. Codex dialect: same hooks, no forks (M160) ==');
{
  // Codex's payloads match Claude Code's — prove OUR hooks serve both.
  // (a) enable-codex writes a valid merged hooks.json with absolute paths
  const CODEX_HOME = join(TMP, 'dot-codex');
  const p = Bun.spawn(['bun', 'run', join('hooks', 'enable-codex.ts')], {
    env: { ...HOOK_ENV, CODEX_HOME } as any, stdout: 'pipe', stderr: 'pipe',
  });
  await p.exited;
  const hj = JSON.parse(await Bun.file(join(CODEX_HOME, 'hooks.json')).text());
  check('enable-codex registers all three events', ['SessionStart', 'UserPromptSubmit', 'Stop'].every((e) => (hj.hooks[e] ?? []).length > 0));
  check('commands use absolute paths (no plugin vars)', JSON.stringify(hj).includes('/hooks/session-start.ts') && !JSON.stringify(hj).includes('CLAUDE_PLUGIN_ROOT'));
  // merge-preserving: run again → no duplicates
  const p2 = Bun.spawn(['bun', 'run', join('hooks', 'enable-codex.ts')], { env: { ...HOOK_ENV, CODEX_HOME } as any, stdout: 'pipe', stderr: 'pipe' });
  await p2.exited;
  const hj2 = JSON.parse(await Bun.file(join(CODEX_HOME, 'hooks.json')).text());
  check('re-running does not duplicate entries', JSON.stringify(hj2).length === JSON.stringify(hj).length);

  // (b) Codex-shaped payloads drive the SAME hooks (extra fields tolerated)
  const r = await runHook('session-start.ts', { session_id: 'codex-1', cwd: PROJ, hook_event_name: 'SessionStart', model: 'gpt-x', permission_mode: 'default', source: 'startup' });
  check('session-start accepts a Codex payload', r.code === 0);
  const rp = await runHook('on-prompt.ts', { session_id: 'codex-1', prompt: 'hello from codex', cwd: PROJ, turn_id: 't1', hook_event_name: 'UserPromptSubmit' });
  check('on-prompt accepts a Codex payload and injects', rp.code === 0 && ctxOf(rp.out).length > 50);
  const rs = await runHook('on-stop.ts', { session_id: 'codex-1', turn_id: 't1', stop_hook_active: false, last_assistant_message: 'Hi codex user!' });
  check('on-stop accepts a Codex payload', rs.code === 0);

  // (c) source:'compact' re-anchors (shared improvement for BOTH harnesses)
  await runHook('session-start.ts', { session_id: 'codex-1', cwd: PROJ, source: 'compact' });
  const cf = await (await fetch(`${BASE}/api/harness/context?session_id=codex-1`)).json();
  check("SessionStart source='compact' re-anchors to a FULL injection", cf.kind === 'full');
}

console.log('\n== 8. tunnel guard: a foreign server is never adopted (M176) ==');
{
  // Restart the server claiming to be another machine — as if the port were
  // an SSH tunnel to someone else's harnessmap.
  await fetch(`${BASE}/api/shutdown`, { method: 'POST' }).catch(() => {});
  await sleep(600);
  const foreign = Bun.spawn(['bun', 'run', 'src/server.ts'], {
    env: { ...HOOK_ENV, HARNESSMAP_DB: join(HOME, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_MACHINE_LABEL: 'someone-elses-laptop' } as any,
    stdout: 'ignore', stderr: 'ignore',
  });
  let up2 = false;
  for (let i = 0; i < 20; i++) { try { await fetch(`${BASE}/api/state`); up2 = true; break; } catch { await sleep(300); } }
  check('foreign-labeled server is up', up2);
  const r = await runHook('session-start.ts', { session_id: 'tunnel-1', cwd: PROJ });
  check('hook exits clean, does not adopt it', r.code === 0);
  const ctx = ctxOf(r.out);
  check('user is warned about the tunneled server', /another machine/.test(ctx) && ctx.includes('someone-elses-laptop'));
  foreign.kill();
  await sleep(400);
}

await fetch(`${BASE}/api/shutdown`, { method: 'POST' }).catch(() => {});
console.log(`\n================ install smoke: ${pass} passed, ${fail} failed ================`);
if (failures.length) console.log('failures:\n  - ' + failures.join('\n  - '));
process.exit(fail > 0 ? 1 : 0);

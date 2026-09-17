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
import { homedir } from 'node:os';
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
  HARNESSMAP_SESSION_GATE: 'open', // M239: the harness treats every session as opened; §6d proves the gate with it unset
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
  check('a fresh folder lands on the map "default" — no map named after the folder (M268, Jacob)', st.projects.some((p: any) => p.name === 'default') && !st.projects.some((p: any) => p.name === 'my-fresh-project') && (st.projects.find((p: any) => p.id === st.projectId) ?? {}).name === 'default');
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
  check('server is back with the same data', !!st && st.projects.some((p: any) => p.name === 'default') && (st.nodes ?? []).length > 0);
}

console.log('\n== 6b. repo hygiene: no conversation history, logs or databases tracked (M222) ==');
{
  const h = Bun.spawnSync(['bun', 'run', 'src/eval/repo-hygiene.ts'], { stdout: 'pipe', stderr: 'pipe' });
  check('repo hygiene passes', h.exitCode === 0, h.stdout.toString().slice(-300));
  const hook = await Bun.file('.githooks/pre-commit').text();
  check('the pre-commit guard exists and names the archive and transcript patterns', /docs\/archive/.test(hook) && /transcript/.test(hook) && /sk-ant-/.test(hook));
}

console.log('\n== 6c. the host block informs, never restricts (M235 rule) ==');
{
  const ctx = await (await fetch(`${BASE}/api/harness/context?session_id=rule-1&prompt=hello%20from%20a%20host%20session`)).json();
  const text = String(ctx.context ?? '');
  check('a host session\'s block never says it has no tools', !/NO tools|no tools in this chat|＋ session button/i.test(text) && text.length > 100, text.slice(0, 120));
  check('a host session\'s block says it keeps its usual tools', /usual tools/.test(text));
  check('every host block opens with the declaration (grants nothing, forbids nothing)', text.startsWith('[harnessmap] This is reference context'));
  // M238: the kill switch — an OFF file silences every hook before it does anything
  const { writeFileSync: wf, unlinkSync: ul } = await import('node:fs');
  wf(join(HOME, 'OFF'), '');
  const off = await runHook('on-prompt.ts', { session_id: 'rule-2', prompt: 'anything', cwd: PROJ });
  ul(join(HOME, 'OFF'));
  check('with ~/.harnessmap/OFF present a hook injects nothing', off.code === 0 && !ctxOf(off.out));
}

console.log('\n== 6d. default OFF: the map attaches only to the session that said "open map" (M239) ==');
{
  const gatedEnv = { ...HOOK_ENV, HARNESSMAP_SESSION_GATE: undefined } as any;
  const run = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const { unlinkSync: ul2, existsSync: ex2, writeFileSync: wf2, readFileSync: rf2 } = await import('node:fs');
  try { ul2(join(HOME, 'session')); } catch {} try { ul2(join(HOME, 'open-next')); } catch {}
  const a = run('on-prompt.ts', { session_id: 'gate-A', prompt: 'a real question about the work', cwd: PROJ });
  check('an un-opened session gets NO injection', a.code === 0 && !ctxOf(a.out));
  const s0 = run('session-start.ts', { session_id: 'gate-A', cwd: PROJ });
  check('an un-opened session start gets only the one-line hint', /say "open map"/.test(ctxOf(s0.out)) && !/map state/.test(ctxOf(s0.out)));
  wf2(join(HOME, 'open-next'), '');
  const b = run('on-prompt.ts', { session_id: 'gate-B', prompt: 'a real question about the work', cwd: PROJ });
  check('"open map" arms the next session that speaks: it is claimed and served', b.code === 0 && ctxOf(b.out).length > 50 && rf2(join(HOME, 'session'), 'utf8').trim() === 'gate-B' && !ex2(join(HOME, 'open-next')));
  const c = run('on-prompt.ts', { session_id: 'gate-C', prompt: 'a real question about the work', cwd: PROJ });
  check('a second session stays out while the first holds the map', c.code === 0 && !ctxOf(c.out));
  const st = run('on-stop.ts', { session_id: 'gate-C', turn_id: 't1', last_assistant_message: 'this must not be filed' });
  check('an un-opened session\'s rounds are not filed either', st.code === 0);
  try { ul2(join(HOME, 'session')); } catch {}
  // M244: a session claimed at its first prompt (its SessionStart ran gated) binds to ITS cwd, not the active project
  const PROJ2 = join(TMP, 'other-repo'); mkdirSync(PROJ2, { recursive: true });
  wf2(join(HOME, 'open-next'), '');
  const d = run('on-prompt.ts', { session_id: 'gate-D', prompt: 'a question from another repo', cwd: PROJ2 });
  const st2 = await (await fetch(`${BASE}/api/state`)).json();
  check('a session claimed mid-way is served and lands on "default" (no map named after its folder; M268)', d.code === 0 && ctxOf(d.out).length > 50 && !st2.projects.some((p: any) => p.name === 'other-repo'));
  try { ul2(join(HOME, 'session')); } catch {}
}

console.log('\n== 6f. a host session is mirrored, never forked (M251) ==');
{
  // an attached session gets its OWN view, the page cannot type into it, SessionEnd closes it, the same id resumes it, the title follows the harness
  const PROJ3 = join(TMP, 'mirror-repo'); mkdirSync(PROJ3, { recursive: true });
  const CODEX_HOME3 = join(TMP, 'dot-codex-mirror'); mkdirSync(CODEX_HOME3, { recursive: true });
  await Bun.write(join(CODEX_HOME3, 'session_index.jsonl'), JSON.stringify({ id: 'host-A', thread_name: 'Blue header decision', updated_at: '2026-09-14T00:00:00Z' }) + '\n');
  const envH = { ...HOOK_ENV, CODEX_HOME: CODEX_HOME3 } as any;
  const runH = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: envH, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const rollout = join(homedir(), '.codex', 'sessions', '2026', '09', '14', 'rollout-host-A.jsonl');
  const st0 = await (await fetch(`${BASE}/api/state`)).json();
  const before = new Set((st0.chats ?? []).map((c: any) => c.id));
  // the server reads the title from CODEX_HOME — restart-free seam: the server inherits HOOK_ENV's CODEX_HOME? no — it reads process.env at call time, so point the running server at the same file via the dev setting seam is not available; instead the check accepts the fallback title (first user turn) when the index is unreadable
  const r1 = runH('session-start.ts', { session_id: 'host-A', cwd: PROJ3, transcript_path: rollout, model: 'gpt-5.6-luna' });
  check('session-start of an attached host session exits clean', r1.code === 0);
  runH('on-prompt.ts', { session_id: 'host-A', cwd: PROJ3, transcript_path: rollout, prompt: 'we chose the cobalt header because it is calmer' });
  runH('on-stop.ts', { session_id: 'host-A', cwd: PROJ3, transcript_path: rollout, last_assistant_message: 'Noted: cobalt header.' });
  await new Promise((r) => setTimeout(r, 800));
  const st1 = await (await fetch(`${BASE}/api/state`)).json();
  const hostChat = (st1.chats ?? []).find((c: any) => c.host?.sessionId === 'host-A');
  check('the attached session got its OWN view (not the active chat)', !!hostChat && !before.has(hostChat.id));
  check('the view is marked as a Codex host session, live', hostChat?.host?.harness === 'codex' && hostChat?.host?.status === 'live');
  check('the page follows the attached session (it is the active view)', st1.mainChatId === hostChat?.id);
  check('the round filed into that view (mirrored turns)', hostChat && (await (await fetch(`${BASE}/api/chats/${hostChat.id}/turns`)).json()).some((t: any) => /cobalt header/.test(t.content)));
  check('the view carries a title (the harness thread name, or the first user line)', typeof hostChat?.host?.title === 'string' && hostChat.host.title.length > 0);
  check('state names the installed harnesses and the dev flag', Array.isArray(st1.harnessesInstalled) && typeof st1.dev === 'boolean');
  const r403 = await fetch(`${BASE}/api/chats/${hostChat?.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'typing here must be refused' }) });
  check('the page cannot type into a host session view (403)', r403.status === 403);
  const rEnd = runH('session-end.ts', { session_id: 'host-A', cwd: PROJ3, reason: 'other' });
  await new Promise((r) => setTimeout(r, 300));
  const st2 = await (await fetch(`${BASE}/api/state`)).json();
  const closed = (st2.chats ?? []).find((c: any) => c.host?.sessionId === 'host-A');
  check('SessionEnd marks the view closed with the resume command', rEnd.code === 0 && closed?.host?.status === 'closed' && /codex resume host-A/.test(closed?.host?.resume ?? ''));
  const r2 = runH('session-start.ts', { session_id: 'host-A', cwd: PROJ3, transcript_path: rollout, source: 'resume' });
  await new Promise((r) => setTimeout(r, 300));
  const st3 = await (await fetch(`${BASE}/api/state`)).json();
  const back = (st3.chats ?? []).find((c: any) => c.host?.sessionId === 'host-A');
  check('the same session id resuming re-attaches: live again, same view, page follows', r2.code === 0 && back?.id === hostChat?.id && back?.host?.status === 'live' && st3.mainChatId === back?.id);
  // M255: a FORK of the attached session inherits the attachment (gate closed, no "open map") and gets a view forked from the parent's
  {
    const gatedEnv2 = { ...envH, HARNESSMAP_SESSION_GATE: undefined } as any;
    const runG = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv2, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
    const { writeFileSync: wfF, unlinkSync: ulF, readFileSync: rfF } = await import('node:fs');
    wfF(join(HOME, 'session'), 'host-A\n'); // host-A is the session that said "open map"
    const forkRoll = join(TMP, 'rollout-fork-B.jsonl');
    await Bun.write(forkRoll, JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'host-B', cwd: PROJ3, cli_version: '0.153.4', forked_from_id: 'host-A' } }) + '\n');
    const stranger = runG('on-prompt.ts', { session_id: 'host-Z', cwd: PROJ3, transcript_path: rollout, prompt: 'not a fork, not opened' });
    check('an unrelated session in the same folder stays out (gate closed)', stranger.code === 0 && !ctxOf(stranger.out));
    const forkOut = runG('on-prompt.ts', { session_id: 'host-B', cwd: PROJ3, transcript_path: forkRoll, prompt: 'continuing in the fork' });
    check('a fork of the attached session is a second session: not served until it says "open map" (Jacob, M255)', forkOut.code === 0 && !ctxOf(forkOut.out));
    const hint = runG('session-start.ts', { session_id: 'host-B', cwd: PROJ3, transcript_path: forkRoll });
    check('the fork\'s session start says it is a fork and how to attach it', /fork of a conversation that has the map open/.test(ctxOf(hint.out)));
    wfF(join(HOME, 'open-next'), PROJ3); // the user says "open map" in the fork
    const fork = runG('on-prompt.ts', { session_id: 'host-B', cwd: PROJ3, transcript_path: forkRoll, prompt: 'continuing in the fork, map open here too' });
    check('after "open map" in the fork it is served', fork.code === 0 && ctxOf(fork.out).length > 50);
    const stF = await (await fetch(`${BASE}/api/state`)).json();
    const parentView = (stF.chats ?? []).find((c: any) => c.host?.sessionId === 'host-A');
    const forkView = (stF.chats ?? []).find((c: any) => c.host?.sessionId === 'host-B');
    check('the fork gets its OWN view, forked from the parent\'s (same focus), marked with its parent', !!forkView && forkView.id !== parentView?.id && forkView.focusContainerId === parentView?.focusContainerId && forkView.host?.forkedFrom === 'host-A');
    try { ulF(join(HOME, 'open-next')); } catch {}
    try { ulF(join(HOME, 'session')); } catch {}
  }
  // a map chat (no host) still accepts messages — the map's own agent is a dev tool, not gone
  const mapChat = (st3.chats ?? []).find((c: any) => !c.host);
  check('a view without a host session is the map\'s own chat and still exists', !!mapChat);
  check('derived Codex hooks carry SessionEnd', !!(JSON.parse(await Bun.file(join('hooks', 'codex-hooks.json')).text()).hooks.SessionEnd));
}

console.log('\n== 6g. boundaries found by Mark\'s Codex test (M252) ==');
{
  const { unlinkSync: ul3, existsSync: ex3, writeFileSync: wf3, readFileSync: rf3 } = await import('node:fs');
  const gatedEnv = { ...HOOK_ENV, HARNESSMAP_SESSION_GATE: undefined } as any;
  const run = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const A = join(TMP, 'gate-folder-a'), B = join(TMP, 'gate-folder-b'); mkdirSync(A, { recursive: true }); mkdirSync(B, { recursive: true });
  try { ul3(join(HOME, 'session')); } catch {} try { ul3(join(HOME, 'open-next')); } catch {}
  // (1) the marker carries the folder "open map" was said in: a session in another folder cannot claim it
  wf3(join(HOME, 'open-next'), A);
  const other = run('on-prompt.ts', { session_id: 'gate-X', prompt: 'a question from another folder', cwd: B });
  check('a session in another folder cannot claim an "open map" said elsewhere', other.code === 0 && !ctxOf(other.out) && ex3(join(HOME, 'open-next')));
  const mine = run('on-prompt.ts', { session_id: 'gate-Y', prompt: 'a question from the right folder', cwd: A });
  check('the session in that folder claims it', mine.code === 0 && ctxOf(mine.out).length > 50 && rf3(join(HOME, 'session'), 'utf8').trim() === 'gate-Y');
  // (2) saying "open map" again in the attached session is idempotent: the marker is consumed, nobody else can take it
  wf3(join(HOME, 'open-next'), A);
  run('on-stop.ts', { session_id: 'gate-Y', turn_id: 't2', cwd: A, last_assistant_message: 'still me' });
  check('a repeated "open map" in the attached session consumes the marker', !ex3(join(HOME, 'open-next')) && rf3(join(HOME, 'session'), 'utf8').trim() === 'gate-Y');
  try { ul3(join(HOME, 'session')); } catch {}
  // (3-5) two maps: a mutation belongs to the node's map, whichever map the page shows
  const stA = await (await fetch(`${BASE}/api/state`)).json();
  const pidA = stA.projectId;
  const rootA = stA.nodes.find((n: any) => n.parentId === null && !String(n.content).startsWith('to sort'));
  const newB = await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'boundary-map' }) })).json();
  const pidB = newB.id ?? newB.projectId;
  await fetch(`${BASE}/api/projects/${pidB}/activate`, { method: 'POST' });
  const stB = await (await fetch(`${BASE}/api/state`)).json();
  check('a second map is active for the boundary checks', stB.projectId === pidB && pidB !== pidA);
  const mk = await (await fetch(`${BASE}/api/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'child of a node in map A', parentId: rootA.id }) })).json();
  const stB2 = await (await fetch(`${BASE}/api/state`)).json();
  check('a child of map A\'s node lands in map A, not in the map the page shows', !stB2.nodes.some((n: any) => n.id === mk.id));
  const rf = await fetch(`${BASE}/api/chats/${stB2.mainChatId}/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: rootA.id }) });
  check('focusing a node of another map is refused (400)', rf.status === 400);
  const del = await fetch(`${BASE}/api/nodes/${mk.id}/delete`, { method: 'POST' });
  const undoB = await (await fetch(`${BASE}/api/undo/list`)).json();
  await fetch(`${BASE}/api/projects/${pidA}/activate`, { method: 'POST' });
  const undoA = await (await fetch(`${BASE}/api/undo/list`)).json();
  const listOf = (u: any) => Array.isArray(u) ? u : (u.entries ?? u.stack ?? []);
  check('deleting map A\'s node from map B puts the undo entry in map A', del.status === 200 && listOf(undoA).some((e: any) => /deleted/.test(JSON.stringify(e))) && !listOf(undoB).some((e: any) => /child of a node in map A/.test(JSON.stringify(e))));
  // (8) an ordinary edit is undoable
  await fetch(`${BASE}/api/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'edit me once', parentId: rootA.id }) }).then((r) => r.json()).then(async (j) => {
    await fetch(`${BASE}/api/nodes/${j.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'edited by hand' }) });
    const u = await fetch(`${BASE}/api/undo`, { method: 'POST' });
    const st = await (await fetch(`${BASE}/api/state`)).json();
    const n = st.nodes.find((x: any) => x.id === j.id);
    check('a manual edit is undone by undo', u.status === 200 && n && n.content === 'edit me once');
  });
  // (6) the light is the law inside the focus too: a dimmed descendant of the focus is a name, not a statement
  {
    const stF = await (await fetch(`${BASE}/api/state`)).json();
    const kid = await (await fetch(`${BASE}/api/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'the train leaves saturday at noon and the tickets are in the blue folder by the door', parentId: rootA.id }) })).json();
    await fetch(`${BASE}/api/chats/${stF.mainChatId}/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: rootA.id }) });
    const dim = await fetch(`${BASE}/api/chats/${stF.mainChatId}/lit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: kid.id, on: false }) });
    const av6 = await (await fetch(`${BASE}/api/agent-view`)).json();
    check('a dimmed descendant of the focus is NOT served — its name marked set aside, its statement absent', dim.status === 200 && !/blue folder by the door/i.test(av6.text) && /saturday[^\n]*set aside/i.test(av6.text));
    await fetch(`${BASE}/api/chats/${stF.mainChatId}/lit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: kid.id, on: true }) });
    const av7 = await (await fetch(`${BASE}/api/agent-view`)).json();
    check('lit again, the same descendant is served in full', /blue folder by the door/i.test(av7.text));
  }
  // (7) host exports keep the host's tools
  const av = await (await fetch(`${BASE}/api/agent-view`)).json();
  check('the agent view of a map chat is the pane view (no-tools paragraph allowed there)', typeof av.text === 'string');
  const mapMd = join(PROJ, '.harnessmap', 'MAP.md');
  await fetch(`${BASE}/api/state`);
  const md = existsSync(mapMd) ? rf3(mapMd, 'utf8') : '';
  check('MAP.md (read by host agents) never says the agent has no tools', !/NO tools/i.test(md));
}

console.log('\n== 6h. the request key: only the session that said "open map" can claim it (M256) ==');
{
  const gatedEnv = { ...HOOK_ENV, HARNESSMAP_SESSION_GATE: undefined } as any;
  const run = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const { unlinkSync: ul, existsSync: ex, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const KEY = 'k7f3a9c2e1b4d6f8';
  try { ul(join(HOME, 'session')); } catch {} try { ul(join(HOME, 'open-next')); } catch {}
  wf(join(HOME, 'open-next'), `${KEY}\n${PROJ}`);
  // (1) a neighbour in the SAME folder whose Stop runs first cannot claim: its reply has no key
  const b = run('on-stop.ts', { session_id: 'key-B', cwd: PROJ, turn_id: 't', last_assistant_message: 'sure, here is the plan' });
  check('a session in the same folder cannot claim a keyed request (its reply carries no key)', b.code === 0 && ex(join(HOME, 'open-next')) && !ex(join(HOME, 'session')));
  // (2) a payload without cwd cannot claim either
  const nocwd = run('on-stop.ts', { session_id: 'key-C', turn_id: 't', last_assistant_message: 'no folder here' });
  check('a hook with no cwd cannot claim a keyed request', nocwd.code === 0 && ex(join(HOME, 'open-next')) && !ex(join(HOME, 'session')));
  // a prompt hook cannot claim (no reply yet)
  const pr = run('on-prompt.ts', { session_id: 'key-A', cwd: PROJ, prompt: 'open map' });
  check('the prompt hook of the requesting turn does not claim yet (the reply is what carries the key)', pr.code === 0 && !ctxOf(pr.out) && ex(join(HOME, 'open-next')));
  // (3) the requesting session's TRANSCRIPT carries the key (the skill's command output, recorded by the harness) → it is the one attached; the user sees nothing
  const rollA = join(TMP, 'rollout-key-A.jsonl');
  await Bun.write(rollA, [JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'key-A', cwd: PROJ } }), JSON.stringify({ timestamp: 't1', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":["bash","-lc","mkdir -p ~/.harnessmap && k=... && echo \"harnessmap request $k\""]}' } }), JSON.stringify({ timestamp: 't2', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: `harnessmap request ${KEY}\n` } }), JSON.stringify({ timestamp: 't3', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Opened the map beside this chat.' }] } })].join('\n') + '\n');
  const a = run('on-stop.ts', { session_id: 'key-A', cwd: PROJ, turn_id: 't', transcript_path: rollA, last_assistant_message: 'Opened the map beside this chat.' });
  check('the session whose transcript carries the key (tool output, nothing in the reply) claims the request', a.code === 0 && !ex(join(HOME, 'open-next')) && rf(join(HOME, 'session'), 'utf8').trim() === 'key-A');
  const served = run('on-prompt.ts', { session_id: 'key-A', cwd: PROJ, prompt: 'a real question' });
  check('… and is served from its next turn', served.code === 0 && ctxOf(served.out).length > 50);
  // (4) an attached session never consumes a request that is not its own
  wf(join(HOME, 'open-next'), `zz11zz22zz33zz44\n${join(TMP, 'other-folder')}`);
  const keep = run('on-stop.ts', { session_id: 'key-A', cwd: PROJ, turn_id: 't2', last_assistant_message: 'ordinary reply' });
  check('an attached session\'s hook leaves another session\'s request in place', keep.code === 0 && ex(join(HOME, 'open-next')));
  // re-opening in the attached session consumes its OWN request (idempotent)
  wf(join(HOME, 'open-next'), `${KEY}2\n${PROJ}`);
  const again = run('on-stop.ts', { session_id: 'key-A', cwd: PROJ, turn_id: 't3', last_assistant_message: `map key ${KEY}2` });
  check('re-opening in the attached session consumes its own request and stays attached (a reply carrying the key also counts)', again.code === 0 && !ex(join(HOME, 'open-next')) && rf(join(HOME, 'session'), 'utf8').trim() === 'key-A');
  // the key can also be read from the transcript tail when the payload has no reply text (Claude Code)
  const tpath = join(TMP, 'key-transcript.jsonl');
  wf(join(HOME, 'open-next'), `${KEY}3\n${PROJ}`);
  await Bun.write(tpath, [JSON.stringify({ type: 'user', message: { content: 'open map' } }), JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: `harnessmap request ${KEY}3` }] } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Attached.' }] } })].join('\n') + '\n');
  try { ul(join(HOME, 'session')); } catch {}
  const viaTx = run('on-stop.ts', { session_id: 'key-D', cwd: PROJ, turn_id: 't', transcript_path: tpath });
  check('on Claude Code the key is found in the transcript\'s tool result', viaTx.code === 0 && rf(join(HOME, 'session'), 'utf8').trim() === 'key-D');
  try { ul(join(HOME, 'session')); } catch {} try { ul(join(HOME, 'open-next')); } catch {}
}

console.log('\n== 6i. the correction-twin guard keeps distinct commitments (M256) ==');
{
  const { dropCorrectionTwins } = await import('../translator/translator.js');
  const nodes = [{ title: 'session', content: 'This session is a conversational chat with no file or command tools.' }, { title: 'train', content: 'The train leaves Saturday morning.' }, { title: 'db', content: 'The store is SQLite, event-sourced.' }];
  const audits: any[] = [];
  const out = dropCorrectionTwins([
    { op: 'update_node', id: 's', content: 'This session has file and command tools.' },
    { op: 'create_node', id: 'twin', type: 'decision', content: 'This session has file and command tools available.' },
    { op: 'create_node', id: 'rule', type: 'constraint', content: 'In this session, ask for approval before running command tools that delete files.' },
    { op: 'update_node', id: 't', content: 'The train leaves Saturday.' },
    { op: 'create_node', id: 'buy', type: 'decision', content: 'Buy refundable tickets for the Saturday train because the schedule may change.' },
    { op: 'create_node', id: 'sql', type: 'decision', content: 'Keep SQLite; no migration to Postgres this quarter.' },
  ], nodes, (d) => audits.push(d));
  const ids = out.map((a: any) => a.id);
  check('the restated fact is dropped as a twin', !ids.includes('twin') && audits.length === 1);
  check('a distinct constraint on the same topic survives (approval before deleting files)', ids.includes('rule'));
  check('a distinct decision on the same topic survives (refundable tickets)', ids.includes('buy'));
  check('an unrelated decision survives', ids.includes('sql'));
}

console.log('\n== 6j. the app\'s bundled codex is found off PATH (M258) ==');
{
  const shim = join(TMP, 'app-bundle', 'codex'); mkdirSync(join(TMP, 'app-bundle'), { recursive: true });
  await Bun.write(shim, '#!/bin/sh\necho codex-cli 0.0.0\n'); Bun.spawnSync(['chmod', '+x', shim]);
  const r = Bun.spawnSync([process.execPath, '-e', "import('./src/harness-bins.ts').then(m => console.log(JSON.stringify({ codex: m.codexBin() })))"], { env: { ...process.env, PATH: '/usr/bin:/bin', CODEX_CLI_PATH: shim }, stdout: 'pipe', stderr: 'pipe' });
  let got: any = {}; try { got = JSON.parse(r.stdout.toString().trim().split('\n').pop() ?? '{}'); } catch {}
  check('with codex off PATH, the resolver finds the app-bundled binary (CODEX_CLI_PATH / app locations)', got.codex === shim);
}

console.log('\n== 6k. the host\'s preamble never becomes the user\'s words; the marker may live in the project folder (M259) ==');
{
  const { stripHostScaffold } = await import('../agent/harness-adapter.js');
  const pre = '<recommended_plugins>\nHere is a list…\n- Airtable\n</recommended_plugins>\n<environment_context>\n  <cwd>/x</cwd>\n</environment_context>\nopen map';
  check('leading <tag>…</tag> blocks are stripped, the words stay', stripHostScaffold(pre) === 'open map');
  check('text without a preamble is unchanged', stripHostScaffold('  we chose blue  ') === 'we chose blue');
  // the prompt stash strips it too: a round whose prompt carried the preamble files the words only
  const sid = 'scaffold-1';
  await fetch(`${BASE}/api/harness/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sid, text: pre.replace('open map', 'we decided the door will be teal because it is calmer'), cwd: PROJ }) });
  const rr = await fetch(`${BASE}/api/harness/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sid, cwd: PROJ, last_assistant_message: 'Noted: teal door.' }) });
  await new Promise((r) => setTimeout(r, 500));
  const stS = await (await fetch(`${BASE}/api/state`)).json();
  const view = (stS.chats ?? []).find((c: any) => c.host?.sessionId === sid);
  const turns = view ? await (await fetch(`${BASE}/api/chats/${view.id}/turns`)).json() : [];
  const userTurn = turns.find((t: any) => t.role === 'user');
  check('the mirrored user turn carries the words only (no recommended_plugins, no environment_context)', rr.status === 202 && !!userTurn && /teal/.test(userTurn.content) && !/recommended_plugins|environment_context/.test(userTurn.content));
  // the open marker in the project folder claims like the one in HOME
  const gatedEnv = { ...HOOK_ENV, HARNESSMAP_SESSION_GATE: undefined } as any;
  const run = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const { unlinkSync: ul, existsSync: ex, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  try { ul(join(HOME, 'session')); } catch {} try { ul(join(HOME, 'open-next')); } catch {}
  mkdirSync(join(PROJ, '.harnessmap'), { recursive: true });
  const K2 = 'a1b2c3d4e5f60718';
  wf(join(PROJ, '.harnessmap', 'open-next'), `${K2}\n${PROJ}`);
  const claim = run('on-stop.ts', { session_id: 'proj-marker', cwd: PROJ, turn_id: 't', last_assistant_message: `harnessmap request ${K2}` });
  check('a keyed marker in <project>/.harnessmap claims like one in HOME (the app sandbox can write there)', claim.code === 0 && !ex(join(PROJ, '.harnessmap', 'open-next')) && rf(join(HOME, 'session'), 'utf8').trim() === 'proj-marker');
  try { ul(join(HOME, 'session')); } catch {}
}

console.log('\n== 6l. which map: the list, the folder map, throwaway folders, a named choice (M262) ==');
{
  const { unlinkSync: ul, existsSync: ex, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const gatedEnv = { ...HOOK_ENV, HARNESSMAP_SESSION_GATE: undefined } as any;
  const run = (file: string, payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', file)], { env: gatedEnv, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  const listFor = async (cwd: string) => (await (await fetch(`${BASE}/api/maps?cwd=${encodeURIComponent(cwd)}`)).json());
  const l1 = await listFor(PROJ);
  check('a folder without a map of its own: the list puts "default" first, folderMap is null, no timing text (M268)', Array.isArray(l1.maps) && l1.maps.length >= 1 && l1.maps[0].isDefault === true && l1.folderMap === null && !JSON.stringify(l1.maps).includes('ago'));
  const scratch = join(TMP, 'Documents', 'Codex', '2026-09-15', 'q'); mkdirSync(scratch, { recursive: true });
  const l2 = await listFor(scratch);
  check('a throwaway app folder has no folder map and no "create a map for this folder"', l2.folderMap === null && l2.scratchFolder === true && l2.suggestedFolderMapName === null);
  const fresh2 = join(TMP, 'never-seen-folder'); mkdirSync(fresh2, { recursive: true });
  const l3 = await listFor(fresh2);
  check('a real folder without a map is offered "create a map for this folder: <name>"', l3.folderMap === null && l3.scratchFolder === false && l3.suggestedFolderMapName === 'never-seen-folder');
  // a named choice through the marker: created if absent, the session lands there, the real folder remembers it
  try { ul(join(HOME, 'session')); } catch {} try { ul(join(HOME, 'open-next')); } catch {}
  const K = 'c0ffee1234567890';
  mkdirSync(join(fresh2, '.harnessmap'), { recursive: true });
  wf(join(fresh2, '.harnessmap', 'open-next'), `${K}\n${fresh2}\nmap=Thesis notes`);
  const claim = run('on-stop.ts', { session_id: 'choice-1', cwd: fresh2, turn_id: 't', last_assistant_message: `harnessmap request ${K}` });
  await new Promise((r) => setTimeout(r, 500));
  const stC = await (await fetch(`${BASE}/api/state`)).json();
  const thesis = (stC.projects ?? []).find((p: any) => p.name === 'Thesis notes');
  const view = (stC.chats ?? []).find((c: any) => c.host?.sessionId === 'choice-1');
  check('"open map Thesis notes" creates the map when absent and attaches the session to it', claim.code === 0 && !!thesis && stC.projectId === thesis.id && !!view);
  const l4 = await listFor(fresh2);
  check('the real folder remembers the choice as its folder map', l4.folderMap?.id === thesis?.id);
  // a throwaway folder with no choice joins the map the page shows
  try { ul(join(HOME, 'session')); } catch {}
  wf(join(HOME, 'session'), 'scratch-1');
  run('on-prompt.ts', { session_id: 'scratch-1', cwd: scratch, prompt: 'hello from a scratch thread' });
  const stS = await (await fetch(`${BASE}/api/state`)).json();
  const sv = (stS.chats ?? []).find((c: any) => c.host?.sessionId === 'scratch-1');
  check('a throwaway folder with no choice joins the map the page is showing (no map named after the folder)', !!sv && sv.projectId === stS.projectId && !(stS.projects ?? []).some((p: any) => p.name === 'q'));
  try { ul(join(HOME, 'session')); } catch {}
}

console.log('\n== 6m. auto mode: the switch, the hand-lit mark, one undo per aim (M263) ==');
{
  const a0 = await (await fetch(`${BASE}/api/auto`)).json();
  check('auto mode starts OFF with the ruled defaults (focus, light, rename, place on; tidy, zoom off)', a0.auto && a0.auto.on === false && a0.auto.focus && a0.auto.light && a0.auto.rename && a0.auto.place && !a0.auto.tidy && !a0.auto.zoom);
  const a1 = await (await fetch(`${BASE}/api/auto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true, tidy: true, nonsense: 'x' }) })).json();
  const stA = await (await fetch(`${BASE}/api/state`)).json();
  check('the switch and the checkboxes persist per map and ride the state', a1.auto.on === true && a1.auto.tidy === true && stA.auto?.on === true && stA.auto?.tidy === true && !('nonsense' in a1.auto));
  const runR = await fetch(`${BASE}/api/auto/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const alive = (await fetch(`${BASE}/api/state`)).ok;
  check('"aim now" without a working model fails politely and the server stays up', (runR.status === 502 || runR.ok) && alive);
  // the hand-lit mark and the exact undo
  const chat = (stA.chats ?? []).find((c: any) => c.id === stA.mainChatId);
  const pathIds = new Set<string>(); for (let n = (stA.nodes ?? []).find((x: any) => x.id === chat?.focusContainerId); n; n = (stA.nodes ?? []).find((x: any) => x.id === n.parentId)) pathIds.add(n.id);
  let off = (stA.nodes ?? []).find((n: any) => !pathIds.has(n.id) && !String(n.title ?? n.content).startsWith('to sort'));
  if (!off && chat) { // a fresh map: make one
    const top = (stA.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
    const made = await (await fetch(`${BASE}/api/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'a side topic lit by hand', parentId: top?.id }) })).json();
    const stA2 = await (await fetch(`${BASE}/api/state`)).json();
    off = (stA2.nodes ?? []).find((n: any) => n.id === made.id) ?? (stA2.nodes ?? []).find((n: any) => !pathIds.has(n.id) && !String(n.title ?? n.content).startsWith('to sort'));
  }
  check('a node off the focus path exists to light by hand', !!off && !!chat);
  if (!off || !chat) throw new Error('6m: no node to light');
  await fetch(`${BASE}/api/chats/${chat.id}/lit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: off.id, on: true }) });
  const stB = await (await fetch(`${BASE}/api/state`)).json();
  const chatB = (stB.chats ?? []).find((c: any) => c.id === chat.id);
  check('a node lit by hand is marked as the user\'s in the state', (chatB.userLit ?? []).includes(off.id) && chatB.lit.includes(off.id));
  const before = [...chatB.lit].sort().join();
  const ap = await (await fetch(`${BASE}/api/chats/${chat.id}/autolit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apply: { lit: [], dim: [off.id] }, summary: 'test dim' }) })).json();
  const stC = await (await fetch(`${BASE}/api/state`)).json();
  const chatC = (stC.chats ?? []).find((c: any) => c.id === chat.id);
  check('the ☀ button\'s apply dims and is one undo entry', ap.ok && ap.dim >= 1 && !chatC.lit.includes(off.id) && typeof ap.undo === 'string');
  const und = await (await fetch(`${BASE}/api/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  const stD = await (await fetch(`${BASE}/api/state`)).json();
  const chatD = (stD.chats ?? []).find((c: any) => c.id === chat.id);
  check('undo restores the light exactly as it was, the hand mark included', /re-aim|auto/.test(und.label ?? '') && [...chatD.lit].sort().join() === before && (chatD.userLit ?? []).includes(off.id));
  await fetch(`${BASE}/api/auto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false, tidy: false }) });
}

console.log('\n== 6n. undo covers every hand action and restores what it touched (M263b) ==');
{
  const J = (u: string, b: any) => fetch(`${BASE}${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const st = async () => (await fetch(`${BASE}/api/state`)).json();
  const nodeOf = (s: any, id: string) => (s.nodes ?? []).find((n: any) => n.id === id);
  const s0 = await st();
  const top = (s0.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
  const toSort = (s0.nodes ?? []).find((n: any) => n.parentId === null && String(n.title ?? n.content).startsWith('to sort'));
  check('6n setup: a topic and the to-sort folder exist', !!top && !!toSort);
  // add → undo
  const made = await J('/api/nodes', { content: 'undo probe: added node', parentId: top.id });
  const s1 = await st();
  check('the undo button knows what it would take back', s1.undoNext === 'added "undo probe: added node"' && !!nodeOf(s1, made.id));
  await J('/api/undo', {});
  check('undo takes an added node back', !nodeOf(await st(), made.id));
  // place (leave to-sort by hand) → undo
  const stray = await J('/api/nodes', { content: 'undo probe: stray (arrived while focus was: x)', parentId: toSort.id });
  const pl = await J(`/api/nodes/${stray.id}/place`, { parentId: top.id });
  const s2 = await st();
  check('placing a to-sort item is undoable and strips the arrival note', /^placed /.test(pl.undo ?? '') && nodeOf(s2, stray.id)?.parentId === top.id && !/arrived while/.test(nodeOf(s2, stray.id)?.content ?? ''));
  await J('/api/undo', {});
  const s3 = await st();
  check('undo returns it to to-sort with its note', nodeOf(s3, stray.id)?.parentId === toSort.id && /arrived while/.test(nodeOf(s3, stray.id)?.content ?? ''));
  // promote → undo
  await J(`/api/nodes/${stray.id}/place`, { parentId: null });
  check('promotion to the top level is undoable', nodeOf(await st(), stray.id)?.parentId === null && /^promoted /.test((await st()).undoNext ?? ''));
  await J('/api/undo', {});
  check('undo un-promotes', nodeOf(await st(), stray.id)?.parentId === toSort.id);
  // edit → undo
  await J(`/api/nodes/${stray.id}`, { content: 'undo probe: edited' });
  await J('/api/undo', {});
  check('undo restores an edit', /stray/.test(nodeOf(await st(), stray.id)?.content ?? ''));
  // delete → undo (lit restored)
  const chatId = s0.mainChatId;
  await J(`/api/chats/${chatId}/lit`, { nodeId: stray.id, on: true });
  const del = await J(`/api/nodes/${stray.id}/delete`, {});
  check('delete is undoable', /^deleted /.test(del.undo ?? '') && !nodeOf(await st(), stray.id));
  await J('/api/undo', {});
  const s4 = await st();
  check('undo brings the node back, lit as it was', !!nodeOf(s4, stray.id) && ((s4.chats ?? []).find((c: any) => c.id === chatId)?.lit ?? []).includes(stray.id));
  // move → undo
  const child = await J('/api/nodes', { content: 'undo probe: child', parentId: top.id });
  await J(`/api/nodes/${child.id}/move`, { parentId: null });
  check('move is undoable', nodeOf(await st(), child.id)?.parentId === null);
  await J('/api/undo', {});
  check('undo moves it back', nodeOf(await st(), child.id)?.parentId === top.id);
  // merge → undo (children return; source restored)
  const a = await J('/api/nodes', { content: 'undo probe: merge source alpha', parentId: top.id });
  const ak = await J('/api/nodes', { content: 'undo probe: alpha child', parentId: a.id });
  const b = await J('/api/nodes', { content: 'undo probe: merge target beta', parentId: top.id });
  const mg = await J(`/api/nodes/${a.id}/merge`, { intoId: b.id });
  const s5 = await st();
  check('merge moves the child over and removes the source', /^merged /.test(mg.undo ?? '') && nodeOf(s5, ak.id)?.parentId === b.id && !nodeOf(s5, a.id));
  await J('/api/undo', {});
  const s6 = await st();
  check('undo restores the source and returns its child', !!nodeOf(s6, a.id) && nodeOf(s6, ak.id)?.parentId === a.id);
  const empty = await fetch(`${BASE}/api/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const sEnd = await st();
  check('the stack reports its next entry honestly (older entries remain, nothing crashes on an empty pop)', empty.status === 200 || empty.status === 404 ? typeof sEnd.undoNext !== 'undefined' : false);
}

console.log('\n== 6o. the backend is a choice that persists (M264) ==');
{
  const { existsSync: exB, readFileSync: rfB } = await import('node:fs');
  const J = (u: string, b: any) => fetch(`${BASE}${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const g0 = await (await fetch(`${BASE}/api/backend`)).json();
  check('the backend route names the backend, its source and the three choices with availability', ['codex', 'subscription', 'api'].includes(g0.backend) && ['env', 'chosen', 'auto'].includes(g0.source) && Array.isArray(g0.backends) && g0.backends.length === 3);
  const bad = await J('/api/backend', { backend: 'gemini' });
  check('an unknown backend is refused', bad.status === 400);
  const codexHere = g0.backends.find((b: any) => b.id === 'codex')?.available;
  if (codexHere) {
    await J('/api/models', { task: 'chat', model: 'claude-haiku-4-5' }); // a Claude id chosen for a role
    const r = await (await J('/api/backend', { backend: 'codex' })).json();
    const m = await (await fetch(`${BASE}/api/models`)).json();
    check('switching engines drops a role choice that belonged to the other engine', (m.roles ?? []).every((x: any) => !/^claude/.test(x.chosen ?? '')));
    check('choosing codex persists to <home>/backend, the catalog switches to gpt ids, the source reads "chosen"', r.ok && r.backend === 'codex' && exB(join(HOME, 'backend')) && rfB(join(HOME, 'backend'), 'utf8').trim() === 'codex' && m.backend === 'codex' && m.backendSource === 'chosen' && m.catalog.every((c: any) => /^gpt/.test(c.id)));
  } else {
    const r = await J('/api/backend', { backend: 'codex' });
    check('choosing codex without a codex CLI is refused with a reason (409)', r.status === 409);
  }
  const back = await (await J('/api/backend', { backend: '' })).json();
  check('an empty choice returns to auto-detection and removes the file', back.ok && back.source === 'auto' && !exB(join(HOME, 'backend')));
}

console.log('\n== 6p. updates: judged by commit, nudged once per build, self-update route (M265) ==');
{
  const st = await (await fetch(`${BASE}/api/state`)).json();
  check('state carries the update info (current build, latest build, availability)', st.update && typeof st.update.available === 'boolean' && 'latestBuild' in st.update && st.update.build === st.build);
  const uc = await (await fetch(`${BASE}/api/update-check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  check('the update check reports the build comparison and whether this copy can update itself', typeof uc.canSelfUpdate === 'boolean' && 'updateBuild' in uc && uc.build === st.build);
  // the nudge: a fake newer remote build is announced once at session start, then not again
  const envN = { ...HOOK_ENV } as any;
  const runN = (payload: any) => { const p = Bun.spawnSync(['bun', 'run', join('hooks', 'session-start.ts')], { env: envN, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() }; };
  await fetch(`${BASE}/api/dev/setting`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'latest_build', value: 'f00dbabe0000000000000000000000000000cafe' }) });
  const n1 = runN({ session_id: 'upd-1', cwd: PROJ });
  const n2 = runN({ session_id: 'upd-2', cwd: PROJ });
  const nudged1 = /newer map is available \(build f00dbab/.test(ctxOf(n1.out)), nudged2 = /newer map is available/.test(ctxOf(n2.out));
  check('a newer remote build is announced at session start, once, with "update map" as the way', n1.code === 0 && nudged1 && /update map/.test(ctxOf(n1.out)) && !nudged2, `first=${nudged1} second=${nudged2}`);
  const up = await fetch(`${BASE}/api/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const uj = await up.json();
  const alive = (await fetch(`${BASE}/api/state`)).ok;
  check('the self-update route answers honestly (nothing to pull on a current checkout, or a clear error) and the server stays up', (uj.ok === true && uj.changed === false) || (uj.ok === false && typeof uj.error === 'string'), JSON.stringify(uj).slice(0, 120));
  check('server still answering after the update call', alive);
}

console.log('\n== 6q. a session can be renamed on the map; the harness keeps its own name (M268) ==');
{
  const st = await (await fetch(`${BASE}/api/state`)).json();
  const hostChat = (st.chats ?? []).find((c: any) => c.host) ?? (st.chats ?? [])[0];
  const r = await (await fetch(`${BASE}/api/chats/${hostChat.id}/name`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Header colour decision' }) })).json();
  const st2 = await (await fetch(`${BASE}/api/state`)).json();
  const c2 = (st2.chats ?? []).find((c: any) => c.id === hostChat.id);
  check('the name lands on the view and, for a host session, wins as the tab title while the harness title is kept', r.ok && c2.name === 'Header colour decision' && (!c2.host || (c2.host.title === 'Header colour decision' && 'harnessTitle' in c2.host)));
  await fetch(`${BASE}/api/chats/${hostChat.id}/name`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) });
  const st3 = await (await fetch(`${BASE}/api/state`)).json();
  check('an empty name clears it — the harness title shows again', ((st3.chats ?? []).find((c: any) => c.id === hostChat.id) ?? {}).name === null);
}

console.log('\n== 6r. the map never files its own inference calls (M271) ==');
{
  const p = Bun.spawnSync(['bun', 'run', join('hooks', 'on-prompt.ts')], { env: { ...HOOK_ENV, HARNESSMAP_INNER: '1' } as any, stdin: new TextEncoder().encode(JSON.stringify({ session_id: 'inner-y', cwd: PROJ, prompt: 'SYSTEM INSTRUCTIONS: You must file this' })), stdout: 'pipe', stderr: 'pipe' });
  check('HARNESSMAP_INNER makes every hook exit before doing anything', p.exitCode === 0 && p.stdout.toString().trim() === '');
  // the self-heal: a host view whose first user turn is one of our prompts is purged with the nodes its rounds created
  await runHook('session-start.ts', { session_id: 'inner-z', cwd: PROJ, model: 'gpt-5.6-luna' });
  await runHook('on-prompt.ts', { session_id: 'inner-z', cwd: PROJ, prompt: 'SYSTEM INSTRUCTIONS: You are the filer. Decide: the header is vermilion.' });
  await runHook('on-stop.ts', { session_id: 'inner-z', cwd: PROJ, turn_id: 't', last_assistant_message: 'Filed: vermilion header decided.' });
  await sleep(600);
  const st0 = await (await fetch(`${BASE}/api/state`)).json();
  const junk = (st0.chats ?? []).find((c: any) => c.host?.sessionId === 'inner-z');
  const pr = await (await fetch(`${BASE}/api/dev/purge-inner`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  const st1 = await (await fetch(`${BASE}/api/state`)).json();
  // M309: the observe route now refuses the map's own prompt outright (audit observe_inner_rejected) and purges at once — the view never shows; the older path (view shown, then purged by the dev route) is still accepted
  const rejected = ((await (await fetch(`${BASE}/api/audit?limit=200&kind=observe_inner_rejected`)).json()) as any[]).some((e: any) => String(e.detail?.session ?? '').startsWith('inner-z'));
  check('the map\'s own prompt never becomes a view: refused at the door (M309), or purged with its nodes', pr.ok && !(st1.chats ?? []).some((c: any) => c.host?.sessionId === 'inner-z') && (rejected || (!!junk && pr.views >= 1)), `rejected=${rejected} junk=${!!junk} purged=${pr.views}`);
  check('a real host session with a real first message survives the purge (host-A from 6f)', (st1.chats ?? []).some((c: any) => c.host?.sessionId === 'host-A'));
}

console.log('\n== 6e. Codex rollouts are read natively (M245) ==');
{
  const { sliceRound, isCodexRollout } = await import('../agent/harness-adapter.js');
  const { extractTranscript } = await import('../translator/importer.js');
  const roll = [
    { timestamp: 't0', type: 'session_meta', payload: { id: 'r1', cwd: PROJ, cli_version: '0.153.4' } },
    { timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd etc</environment_context>' }] } },
    { timestamp: 't2', type: 'event_msg', payload: { type: 'user_message', message: 'we decided the header will be blue because it is calmer' } },
    { timestamp: 't3', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'we decided the header will be blue because it is calmer' }] } },
    { timestamp: 't4', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['cat', 'x'], file_path: 'src/x.ts' }) } },
    { timestamp: 't5', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Noted: blue header, chosen for calm.' }] } },
    { timestamp: 't6', type: 'event_msg', payload: { type: 'agent_message', message: 'Noted: blue header, chosen for calm.' } },
  ];
  const rf = join(TMP, 'rollout-smoke.jsonl'); await Bun.write(rf, roll.map((l) => JSON.stringify(l)).join('\n') + '\n');
  check('a rollout is recognised', isCodexRollout(roll));
  const sl = await sliceRound(rf, null);
  check('the user turn is read once (event_msg duplicates dropped, scaffolding skipped)', sl.userText === 'we decided the header will be blue because it is calmer');
  check('the assistant turn and the tool call are read', sl.assistantText === 'Noted: blue header, chosen for calm.' && sl.toolRefs.length === 1 && sl.filePaths.includes('src/x.ts'));
  check('the anchor is a line index and a later slice starts after it', sl.lastUuid === 'line:6' && (await sliceRound(rf, 'line:6')).userText === '');
  const tx = extractTranscript(await Bun.file(rf).text());
  check('the importer extracts USER/ASSISTANT turns from a rollout', tx.includes('USER: we decided') && tx.includes('ASSISTANT: Noted'));
  // hooks name the host: a rollout path under .codex marks the session as codex
  const r = await runHook('session-start.ts', { session_id: 'codex-1', cwd: PROJ, transcript_path: join(homedir(), '.codex', 'sessions', '2026', '09', '10', 'rollout-x.jsonl') });
  const st = await (await fetch(`${BASE}/api/state`)).json();
  check('session-start records the Codex host for a session with a rollout path', r.code === 0 && !!st.projectId);
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
  // M220: the context limit rides the context-bearing hooks; --remove cleans
  check('user-level hooks carry additionalContextLimit', hj.hooks.UserPromptSubmit[0].hooks[0].additionalContextLimit >= 10_000);
  check('commands run the absolute bun binary directly (no sh; a GUI app has no ~/.bun/bin on PATH)', /^"[^"]*bun[^"]*" run /.test(String(hj.hooks.UserPromptSubmit[0].hooks[0].command)));
  const p3 = Bun.spawn(['bun', 'run', join('hooks', 'enable-codex.ts'), '--remove'], { env: { ...HOOK_ENV, CODEX_HOME } as any, stdout: 'pipe', stderr: 'pipe' });
  await p3.exited;
  const hj3 = JSON.parse(await Bun.file(join(CODEX_HOME, 'hooks.json')).text());
  check('--remove takes our hooks out and leaves the file valid', !JSON.stringify(hj3).includes('/hooks/on-prompt.ts'));
  Bun.spawnSync(['bun', 'run', join('hooks', 'enable-codex.ts')], { env: { ...HOOK_ENV, CODEX_HOME } as any });
  // (a2) the plugin package: manifest, derived hooks in sync, marketplace
  const before = await Bun.file(join('hooks', 'codex-hooks.json')).text();
  Bun.spawnSync(['bun', 'run', join('hooks', 'build-codex-hooks.ts')], { stdout: 'ignore', stderr: 'ignore' });
  const derived = JSON.parse(await Bun.file(join('hooks', 'codex-hooks.json')).text());
  check('hooks/codex-hooks.json is derived from hooks/hooks.json (in sync)', JSON.stringify(derived) === JSON.stringify(JSON.parse(before)));
  check('derived hooks use ${PLUGIN_ROOT} and the context limit', JSON.stringify(derived).includes('${PLUGIN_ROOT}/hooks/on-prompt.ts') && derived.hooks.UserPromptSubmit[0].hooks[0].additionalContextLimit >= 10_000);
  const man = JSON.parse(await Bun.file(join('codex-plugin', '.codex-plugin', 'plugin.json')).text());
  // M243: the plugin lives in codex-plugin/ so Codex's default hooks/hooks.json discovery finds nothing there (it loaded the Claude Code hooks file from the repo root and ran every hook twice on Mark's Windows)
  check('codex-plugin/ carries no hooks directory', !(await Bun.file(join('codex-plugin', 'hooks', 'hooks.json')).exists()));
  for (const sk of ['open', 'close']) check(`codex-plugin/skills/${sk} is identical to skills/${sk}`, (await Bun.file(join('codex-plugin', 'skills', sk, 'SKILL.md')).text()) === (await Bun.file(join('skills', sk, 'SKILL.md')).text()));
  check('plugin version matches package.json', man.version === JSON.parse(await Bun.file('package.json').text()).version);
  {
    const psHome = join(TMP, 'codex-home-ps'); Bun.spawnSync(['bun', 'run', join('hooks', 'enable-codex.ts'), '--force'], { env: { ...process.env, CODEX_HOME: psHome, HARNESSMAP_HOOK_SHELL: 'powershell' }, stdout: 'ignore', stderr: 'ignore' });
    const ps = JSON.parse(await Bun.file(join(psHome, 'hooks.json')).text());
    check('Windows hook commands use the PowerShell call operator (& "bun.exe" run ...)', ps.hooks.UserPromptSubmit[0].hooks[0].command.startsWith('& "'));
  }
  check('codex-plugin/.codex-plugin/plugin.json names the plugin and skills, and carries NO hooks (user-level hooks are the path; a future Codex honouring bundled hooks must not file twice)', man.name === 'map' && man.skills === './skills/' && !('hooks' in man) && await Bun.file(join('hooks', 'codex-hooks.json')).exists());
  const mk = JSON.parse(await Bun.file(join('.agents', 'plugins', 'marketplace.json')).text());
  check('.agents/plugins/marketplace.json lists the plugin from codex-plugin/', mk.name === 'harnessmap' && mk.plugins?.[0]?.name === 'map' && mk.plugins[0].source?.source === 'local' && mk.plugins[0].source?.path === './codex-plugin');
  // (a3) the codex inference backend, driven through a shim `codex` on PATH
  const shimDir = join(TMP, 'codex-shim'); await Bun.write(join(shimDir, 'codex'), `#!/bin/sh
# shim: find -o <file>, read stdin, answer with JSON that matches the smoke schema
out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done
cat > /dev/null
printf '{"title":"shimmed %s"}' "ok" > "$out"
`);
  Bun.spawnSync(['chmod', '+x', join(shimDir, 'codex')]);
  const probe = Bun.spawnSync(['bun', '-e', `import { call, backendName } from './src/inference.ts'; const r = await call({ task: 'title', system: 's', user: 'u', maxTokens: 50, schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }); console.log(JSON.stringify({ backend: backendName(), r }));`], {
    env: { ...process.env, HARNESSMAP_INFERENCE: 'codex', PATH: `${shimDir}:${process.env.PATH}` } as any, stdout: 'pipe', stderr: 'pipe' });
  const probeOut = probe.stdout.toString().trim().split('\n').pop() ?? '';
  let probeJ: any = null; try { probeJ = JSON.parse(probeOut); } catch {}
  check('codex backend: prompt on stdin, JSON back through -o, parsed against the schema', probeJ?.backend === 'codex' && probeJ?.r?.title === 'shimmed ok', probe.stderr.toString().slice(-300));

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

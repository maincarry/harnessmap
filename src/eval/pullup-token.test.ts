// M230 + M194 rulings 3+4, deterministic: a set-aside node the question NAMES is served in full for that turn; a set-aside
// node the question only TOUCHES is offered behind a consent token — content withheld — and the token serves it once.
// No model call: matchPullup is mechanical (word-rarity scoring, src/map/match.ts).
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-pullup-token-'));
const cwd = join(home, 'proj'); mkdirSync(cwd, { recursive: true });
const PORT = 8921 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '', HARNESSMAP_LATEST_BUILD_OVERRIDE: '' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(() => { try { server.kill(); } catch {} rmSync(home, { recursive: true, force: true }); });
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/state')).ok; } catch { await Bun.sleep(250); } }

let host = '', named = '', touched = '', token = '';
test('a session attaches; two set-aside nodes exist', async () => {
  expect(up).toBe(true);
  expect((await post('/api/harness/session-start', { session_id: 's1', cwd, harness: 'claude' })).status).toBe(200);
  host = ((await get('/api/state')).chats as any[]).find((c) => c.host?.sessionId === 's1')!.id;
  // NAMED by the question (shares all five rare words) — carries a secret beyond the 60-char name boundary
  named = (await post('/api/nodes', { content: 'zeppelin mooring procedure in the hangar: the winch tension is set to seventeen turns before the doors open' })).body.id;
  // only TOUCHED by the question (shares three of five words) — its secret must stay withheld until consent
  touched = (await post('/api/nodes', { content: 'zeppelin winch maintenance in the hangar: grease the drum monthly, lock code BRAVO-77' })).body.id;
  for (const id of [named, touched]) expect((await post(`/api/chats/${host}/lit`, { nodeId: id, on: false, bulk: true })).status).toBe(200);
  const lit = ((await get('/api/state')).chats as any[]).find((c) => c.id === host).lit as string[];
  expect(lit.includes(named) || lit.includes(touched)).toBe(false);
});

test('the named node is served in full; the touched node is offered behind a token, content withheld', async () => {
  const q = 'what was the zeppelin mooring winch procedure in the hangar?';
  const ctx = (await get(`/api/harness/context?session_id=s1&prompt=${encodeURIComponent(q)}`)).context as string;
  expect(ctx).toMatch(/SET-ASIDE topic, served in full/);
  expect(ctx).toContain('seventeen');
  expect(ctx).toMatch(/touches a SET-ASIDE topic/);
  expect(ctx).not.toContain('BRAVO-77');
  const m = /pullupToken "([a-z0-9-]+)"/.exec(ctx);
  expect(m).toBeTruthy();
  token = m![1];
});

test('without consent the touched node is refused; with the token it is served once; the lit set never moved', async () => {
  const r0 = await post('/api/recall', { nodeId: touched, chatId: host });
  expect(r0.body?.setAside).toBe(true);
  const r1 = await post('/api/recall', { nodeId: touched, chatId: host, pullupToken: token });
  expect(r1.body?.card?.statement ?? '').toContain('BRAVO-77');
  const r2 = await post('/api/recall', { nodeId: touched, chatId: host, pullupToken: token });
  expect(r2.body?.setAside).toBe(true); // single use
  const lit = ((await get('/api/state')).chats as any[]).find((c) => c.id === host).lit as string[];
  expect(lit.includes(touched)).toBe(false);
  expect(lit.includes(named)).toBe(false);
});

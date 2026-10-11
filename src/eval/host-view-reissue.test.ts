// M481: a session whose recorded view was ARCHIVED on the page gets a fresh live view on its next hook; its rounds never land
// in the hidden one. Deterministic (no model call): the view is (re)issued in ensureSessionBound on the prompt hook.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-view-reissue-'));
const cwd = join(home, 'proj'); mkdirSync(cwd, { recursive: true });
const PORT = 8871 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '', HARNESSMAP_LATEST_BUILD_OVERRIDE: '' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(() => { try { server.kill(); } catch {} rmSync(home, { recursive: true, force: true }); });
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/state')).ok; } catch { await Bun.sleep(250); } }
const viewsOf = async (sid: string) => ((await get('/api/state')).chats as any[]).filter((c) => c.host?.sessionId === sid);

test('server comes up', () => { expect(up).toBe(true); });

test('a live session owns one view after it attaches', async () => {
  expect((await post('/api/harness/session-start', { session_id: 's1', cwd, harness: 'claude' })).status).toBe(200);
  const v = await viewsOf('s1');
  expect(v.length).toBe(1);
  expect(v[0].status).toBe('active');
});

test('archiving that view on the page, then the next hook: a FRESH live view, the old one stays archived (M481)', async () => {
  const [old] = await viewsOf('s1');
  expect((await post(`/api/chats/${old.id}/archive`, {})).status).toBe(200);
  expect((await viewsOf('s1')).length).toBe(0); // the archived view is gone from the page
  expect((await post('/api/harness/prompt', { session_id: 's1', cwd, text: 'hello again after the archive' })).status).toBe(200);
  const now = await viewsOf('s1');
  expect(now.length).toBe(1);
  expect(now[0].id).not.toBe(old.id);
  expect(now[0].status).toBe('active');
  const s = await get('/api/state');
  expect(s.mainChatId).toBe(now[0].id); // the page follows the session into its new view
  const kinds = ((await get('/api/audit?limit=30')) as any[]).map((r) => r.kind);
  expect(kinds).toContain('host_view_reissued');
  expect(kinds).toContain('chat_archived');
});

test('a later hook keeps the fresh view — no view per prompt', async () => {
  const [fresh] = await viewsOf('s1');
  await post('/api/harness/prompt', { session_id: 's1', cwd, text: 'and once more' });
  const again = await viewsOf('s1');
  expect(again.length).toBe(1);
  expect(again[0].id).toBe(fresh.id);
});

// The big suite's §17 shape: several page views, the PAGE's main view is NOT the session's, everything but the main view is
// archived (so the session's view goes too), then the session speaks. This is the path the integration run reports as
// "s-def views: []" — a deterministic version of it either reproduces the lead or clears the server of suspicion.
test('§17 shape: main view elsewhere, archive all but main, the session still gets a fresh live view on its next hook', async () => {
  const sid = 's2'; const cwd2 = join(home, 'proj2'); mkdirSync(cwd2, { recursive: true });
  expect((await post('/api/harness/session-start', { session_id: sid, cwd: cwd2, harness: 'claude' })).status).toBe(200);
  const [own] = await viewsOf(sid);
  expect(own).toBeTruthy();
  // two more page views, and make one of them the main view (the page is looking elsewhere)
  const f1 = await (await post('/api/chats', { mode: 'fresh' })).json() as any;
  const f2 = await (await post('/api/chats', { mode: 'fork' })).json() as any;
  const other = f1.chatId ?? f1.id;
  expect((await post(`/api/chats/${other}/activate`)).status).toBe(200);
  let s = await get('/api/state');
  expect(s.mainChatId).toBe(other);
  // archive every view but the main one (the suite's burn-down) — the session's own view is among the archived
  for (const c of s.chats as any[]) if (c.id !== s.mainChatId) expect((await post(`/api/chats/${c.id}/archive`, {})).status).toBe(200);
  s = await get('/api/state');
  expect(s.chats.length).toBe(1);
  expect((await viewsOf(sid)).length).toBe(0);
  // the session speaks again
  expect((await post('/api/harness/prompt', { session_id: sid, cwd: cwd2, text: 'still here after the cleanup' })).status).toBe(200);
  const views = await viewsOf(sid);
  const all = ((await get('/api/state')).chats as any[]).map((c) => `${c.id.slice(0, 6)}:${c.hostSessionId ?? '-'}:${c.host ? 'host' : 'nohost'}:${c.status}`);
  expect({ views: views.length, newId: views[0]?.id !== own.id, all }).toEqual({ views: 1, newId: true, all });
  expect(((await get('/api/audit?limit=30')) as any[]).map((r) => r.kind)).toContain('host_view_reissued');
  void f2;
});


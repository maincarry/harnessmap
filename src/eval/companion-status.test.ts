// M502 (Mark, 2026-10-19): what the desktop companion needs from the server for its three states and its power button.
//   1. server.json beside the port file — port, pid, version, appRoot, bun — so the companion can START a stopped server.
//   2. state().hostSessions — attached / idle counts across every project by M375's liveness rule, not the stale 'live' column.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-companion-status-'));
const cwd = mkdtempSync(join(tmpdir(), 'hm-companion-project-'));
const PORT = 8861 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_SESSION_IDLE_MIN: '30' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(() => { try { server.kill(); } catch {} rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async () => (await get('/api/state')).json() as Promise<any>;
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }

test('server comes up', () => { expect(up).toBe(true); });

test('server.json beside the port file says where the server lives and how it was run', () => {
  const p = join(home, 'server.json');
  expect(existsSync(p)).toBe(true);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  expect(j.port).toBe(PORT);
  expect(Number.isInteger(j.pid) && j.pid > 0).toBe(true);
  expect(realpathSync(j.appRoot)).toBe(realpathSync(root));
  expect(/bun(\.exe)?$/i.test(String(j.bun))).toBe(true);   // the runtime that ran the server — what a GUI app should reuse
  expect(typeof j.version).toBe('string');
  expect(readFileSync(join(home, 'port'), 'utf8').trim()).toBe(String(PORT));
});

test('hostSessions: nothing attached on a fresh home', async () => {
  const s = await state();
  expect(s.hostSessions).toEqual({ attached: 0, idle: 0, newestActive: null, lastFiledAt: 0 });
});

test('hostSessions: a session that just spoke is attached; a closed one is not; a silent one goes idle', async () => {
  expect((await post('/api/harness/session-start', { session_id: 'comp-s1', cwd, harness: 'codex' })).status).toBe(200);
  expect((await post('/api/harness/prompt', { session_id: 'comp-s1', cwd, text: 'hello map', host_pid: 4242 })).status).toBe(200);
  let s = await state();
  expect(s.hostSessions.attached).toBe(1);
  expect(s.hostSessions.idle).toBe(0);
  expect(typeof s.hostSessions.newestActive).toBe('string');
  // a harness that died without SessionEnd: the row still says 'live' but the last hook was two hours ago → idle, not attached
  const db = new Database(join(home, 'map.sqlite'));
  db.run("UPDATE harness_sessions SET last_active = datetime('now', '-2 hours') WHERE session_id = 'comp-s1'");
  db.close();
  s = await state();
  expect(s.hostSessions).toMatchObject({ attached: 0, idle: 1 });
  // a clean end: neither attached nor idle
  expect((await post('/api/harness/prompt', { session_id: 'comp-s1', cwd, text: 'back' })).status).toBe(200);
  expect((await state()).hostSessions.attached).toBe(1);            // any new hook activity flips it back (M375 self-heals)
  expect((await post('/api/harness/session-end', { session_id: 'comp-s1', reason: 'exit' })).status).toBe(200);
  s = await state();
  expect(s.hostSessions).toMatchObject({ attached: 0, idle: 0 });
});

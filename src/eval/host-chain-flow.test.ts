// M503 (Mark, 2026-10-19): the session's OS window is found through the hook's ANCESTOR CHAIN, captured once per session
// while the hook is alive — not the hook's parent pid alone (a Windows PowerShell wrapper that dies a second later).
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-host-chain-'));
const cwd = mkdtempSync(join(tmpdir(), 'hm-host-chain-project-'));
const PORT = 8901 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(() => { try { server.kill(); } catch {} rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = async (sid: string) => (await get(`/api/harness/context?session_id=${sid}&cwd=${encodeURIComponent(cwd)}&harness=codex&prompt=hi`)).json() as Promise<any>;
const hostOf = async (sid: string) => { const s = await (await get('/api/state')).json() as any; return (s.chats as any[]).map((c) => c.host).find((h) => h && h.sessionId === sid); };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }

test('server comes up', () => { expect(up).toBe(true); });

test('the context answer asks for the chain once a pid is known, and stops asking once the chain landed', async () => {
  const sid = 'chain-s1';
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'codex' })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBeUndefined();                    // no pid yet → nothing to chain
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'hello', host_pid: 31337 })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBe(true);                         // pid known, chain missing → ask
  const chain = [{ pid: 31337, name: 'powershell.exe' }, { pid: 31000, name: 'codex.exe' }, { pid: 2200, name: 'WindowsTerminal.exe' }];
  expect((await post('/api/harness/host-chain', { session_id: sid, chain })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBeUndefined();                    // once per session
  const h = await hostOf(sid);
  expect(h.hostPid).toBe(31337);
  expect(h.hostChain).toEqual(chain);
  // a later prompt with a NEW parent pid (every Windows prompt has one) does not ask again
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'again', host_pid: 31400 })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBeUndefined();
});

test('a bad chain is refused; an unknown session is refused', async () => {
  expect((await post('/api/harness/host-chain', { session_id: 'chain-s1', chain: [{ pid: 0 }] })).status).toBe(400);
  expect((await post('/api/harness/host-chain', { session_id: 'nobody', chain: [{ pid: 5, name: 'x' }] })).status).toBe(400);
});

test('the button walks the chain and answers honestly when nothing can be activated here', async () => {
  const h = await hostOf('chain-s1');
  const s = await (await get('/api/state')).json() as any;
  const chat = (s.chats as any[]).find((c) => c.host && c.host.sessionId === 'chain-s1');
  const r = await (await post(`/api/chats/${chat.id}/foreground`, {})).json() as any;
  expect(r.ok).toBe(false);
  expect(typeof r.detail).toBe('string');
  expect(r.detail.length).toBeGreaterThan(10);   // a reason in words (no wmctrl / processes gone / no window), never a crash
  expect(h.hostChain.length).toBe(3);
});

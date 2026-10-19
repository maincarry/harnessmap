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
afterAll(async () => {
  try { server.kill(); } catch {}
  await server.exited; // Windows keeps the database and log locked until the server exits.
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = async (sid: string) => (await get(`/api/harness/context?session_id=${sid}&cwd=${encodeURIComponent(cwd)}&harness=codex&prompt=hi`)).json() as Promise<any>;
const hostOf = async (sid: string) => { const s = await (await get('/api/state')).json() as any; return (s.chats as any[]).map((c) => c.host).find((h) => h && h.sessionId === sid); };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }

test('server comes up', () => { expect(up).toBe(true); });

test('context requests the chain before a racing prompt report, and the chain supplies the missing pid', async () => {
  const sid = 'chain-s1';
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'codex' })).status).toBe(200);
  // on-prompt starts the prompt POST without awaiting it. The context request can arrive first.
  expect((await hostOf(sid)).hostPid).toBeNull();
  expect((await ctx(sid)).wantHostChain).toBe(true);
  // Deliberately absent PIDs: the endpoint test must not activate a real desktop process.
  const chain = [{ pid: 2000000001, name: 'powershell.exe' }, { pid: 2000000002, name: 'codex.exe' }, { pid: 2000000003, name: 'WindowsTerminal.exe' }];
  expect((await post('/api/harness/host-chain', { session_id: sid, chain })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBeUndefined();                    // once per session
  const h = await hostOf(sid);
  expect(h.hostPid).toBe(2000000001);
  expect(h.hostPidAt).toBeTruthy();
  expect(h.hostChain).toEqual(chain);
  // a later prompt with a NEW parent pid (every Windows prompt has one) does not ask again
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'again', host_pid: 2000000005 })).status).toBe(200);
  expect((await ctx(sid)).wantHostChain).toBeUndefined();
});

test('a bad chain is refused; an unknown session is refused', async () => {
  expect((await post('/api/harness/host-chain', { session_id: 'chain-s1', chain: [{ pid: 0 }] })).status).toBe(400);
  expect((await post('/api/harness/host-chain', { session_id: 'nobody', chain: [{ pid: 5, name: 'x' }] })).status).toBe(400);
});

test('a chain arriving after the prompt preserves its reported pid and timestamp', async () => {
  const sid = 'chain-s2';
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'codex' })).status).toBe(200);
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'hello', host_pid: 2000000006 })).status).toBe(200);
  const before = await hostOf(sid);
  expect((await ctx(sid)).wantHostChain).toBe(true);
  expect((await post('/api/harness/host-chain', { session_id: sid, chain: [{ pid: 2000000007, name: 'powershell.exe' }] })).status).toBe(200);
  const after = await hostOf(sid);
  expect(after.hostPid).toBe(before.hostPid);
  expect(after.hostPidAt).toBe(before.hostPidAt);
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

// M506: the window the person typed in — asked for once per session, refused when it is plainly not a host, tried first.
test('the typed-in window is asked for once, a browser window is refused, a terminal window is kept and labelled', async () => {
  const sid = 'win-s1';
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'codex' })).status).toBe(200);
  expect((await ctx(sid)).wantHostWindow).toBe(true);
  // the person had already switched to the browser → refused, and asked again next time
  const refused = await (await post('/api/harness/host-window', { session_id: sid, window: { hwnd: 1234, pid: 2000000011, name: 'msedge', title: 'news' } })).json() as any;
  expect(refused.ok).toBe(false);
  expect((await ctx(sid)).wantHostWindow).toBe(true);
  // the terminal they typed in → kept
  expect((await post('/api/harness/host-window', { session_id: sid, window: { hwnd: 66052, pid: 2000000012, name: 'WindowsTerminal', title: 'pwsh in llm' } })).status).toBe(200);
  expect((await ctx(sid)).wantHostWindow).toBeUndefined();
  const h = await hostOf(sid);
  expect(h.hostWindow).toEqual({ hwnd: 66052, pid: 2000000012, name: 'WindowsTerminal', title: 'pwsh in llm', label: 'Windows Terminal' });
  // a window alone is enough for the button to try (no pid, no chain yet)
  const s = await (await get('/api/state')).json() as any;
  const chat = (s.chats as any[]).find((c) => c.host && c.host.sessionId === sid);
  const r = await (await post(`/api/chats/${chat.id}/foreground`, {})).json() as any;
  expect(r.ok).toBe(false);                         // nothing can be activated on this headless box
  expect(r.detail).not.toMatch(/has not reported its process/); // but it TRIED, rather than asking for a message
  expect((await post('/api/harness/host-window', { session_id: sid, window: { pid: 0 } })).status).toBe(400);
});

// M507 (Mark, 2026-10-19): a Claude Code session's page on claude.ai (Remote Control). The id arrives from the prompt hook
// (CLAUDE_CODE_BRIDGE_SESSION_ID) or, for a session whose hook predates this, from ~/.claude/sessions/<pid>.json.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-claude-web-'));
const claudeHome = mkdtempSync(join(tmpdir(), 'hm-claude-home-'));
const cwd = mkdtempSync(join(tmpdir(), 'hm-claude-web-project-'));
const PORT = 8941 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_CLAUDE_HOME: claudeHome },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(async () => { try { server.kill(); } catch {} await server.exited; for (const d of [home, claudeHome, cwd]) rmSync(d, { recursive: true, force: true }); });
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const hostOf = async (sid: string) => { const s = await (await get('/api/state')).json() as any; return (s.chats as any[]).map((c) => c.host).find((h) => h && h.sessionId === sid); };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }

test('server comes up', () => { expect(up).toBe(true); });

test('the hook reports the bridge id → the session has its claude.ai page; a bad id is ignored', async () => {
  const sid = 'cc-web-1';
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'claude' })).status).toBe(200);
  expect((await hostOf(sid)).webUrl).toBeNull();
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'hi', web_id: 'javascript:alert(1)' })).status).toBe(200);
  expect((await hostOf(sid)).webUrl).toBeNull();
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'hi', web_id: 'session_01KrDXwmPDvypgLaGgRUH4dW' })).status).toBe(200);
  const h = await hostOf(sid);
  expect(h.webId).toBe('session_01KrDXwmPDvypgLaGgRUH4dW');
  expect(h.webUrl).toBe('https://claude.ai/code/session_01KrDXwmPDvypgLaGgRUH4dW');
});

test('a session whose hook never sent the id gets it from the local registry; a Codex session never gets one', async () => {
  const sid = 'cc-web-2';
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true });
  writeFileSync(join(claudeHome, 'sessions', '4242.json'), JSON.stringify({ pid: 4242, sessionId: sid, bridgeSessionId: 'session_01AAAAAAAAAAAAAAAAAAAAAAAA' }));
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'claude' })).status).toBe(200);
  expect((await hostOf(sid)).webUrl).toBe('https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAAAA');
  const cx = 'codex-web-1';
  expect((await post('/api/harness/session-start', { session_id: cx, cwd, harness: 'codex' })).status).toBe(200);
  expect((await post('/api/harness/prompt', { session_id: cx, cwd, text: 'hi', web_id: 'session_01KrDXwmPDvypgLaGgRUH4dW' })).status).toBe(200);
  expect((await hostOf(cx)).webUrl).toBeNull();
});

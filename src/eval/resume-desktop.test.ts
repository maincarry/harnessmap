// M508 (Mark, 2026-10-19): "resume in Claude Desktop" for an idle or closed Claude Code session — `claude --desktop --resume <id>`
// run by the map on a click, with the binary the hook reported (CLAUDE_CODE_EXECPATH) or one found on this machine.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-resume-'));
const cwd = mkdtempSync(join(tmpdir(), 'hm-resume-project-'));
// a stand-in claude: records its arguments and exits 0 (a real one would hand the session to Desktop)
const fakeClaude = join(home, process.platform === 'win32' ? 'claude.cmd' : 'claude');
writeFileSync(fakeClaude, process.platform === 'win32' ? `@echo %* > "${join(home, 'args.txt')}"\r\n` : `#!/bin/sh\necho "$@" > "${join(home, 'args.txt')}"\n`);
chmodSync(fakeClaude, 0o755);
const PORT = 8981 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_SESSION_IDLE_MIN: '30' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(async () => { try { server.kill(); } catch {} await server.exited; rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const chatOf = async (sid: string) => { const s = await (await get('/api/state')).json() as any; return (s.chats as any[]).find((c) => c.host && c.host.sessionId === sid); };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }
const sid = '7f4e2a10-1111-4222-8333-444455556666';

test('server comes up', () => { expect(up).toBe(true); });

test('a running session is not resumed; a Codex session never; an idle Claude Code session is, with the reported binary', async () => {
  expect((await post('/api/harness/session-start', { session_id: sid, cwd, harness: 'claude' })).status).toBe(200);
  expect((await post('/api/harness/prompt', { session_id: sid, cwd, text: 'hi', exec: fakeClaude })).status).toBe(200);
  let c = await chatOf(sid);
  expect(c.host.canResumeInDesktop).toBe(false);                 // running → go to session, not resume
  let r = await (await post(`/api/chats/${c.id}/resume-desktop`, {})).json() as any;
  expect(r.ok).toBe(false); expect(r.detail).toMatch(/still running/);
  // it goes quiet
  const db = new Database(join(home, 'map.sqlite'));
  db.run("UPDATE harness_sessions SET last_active = datetime('now', '-2 hours') WHERE session_id = ?", [sid]);
  db.close();
  c = await chatOf(sid);
  expect(c.host.idle).toBe(true);
  expect(c.host.canResumeInDesktop).toBe(true);
  r = await (await post(`/api/chats/${c.id}/resume-desktop`, {})).json() as any;
  expect(r.ok).toBe(true);
  await Bun.sleep(300);
  expect(readFileSync(join(home, 'args.txt'), 'utf8').trim()).toBe(`--desktop --resume ${sid}`);
  // a Codex session is never resumed this way
  const cx = '8f4e2a10-1111-4222-8333-444455556666';
  await post('/api/harness/session-start', { session_id: cx, cwd, harness: 'codex' });
  const cc = await chatOf(cx);
  expect(cc.host.canResumeInDesktop).toBe(false);
  r = await (await post(`/api/chats/${cc.id}/resume-desktop`, {})).json() as any;
  expect(r.ok).toBe(false); expect(r.detail).toMatch(/only a Claude Code session/);
});

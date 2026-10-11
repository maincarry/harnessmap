// M477 (launch): the README's privacy promises, each held by a test so a later change cannot quietly break one.
//   1. HARNESSMAP_NO_UPDATE_CHECK=1 — a forced update check (the ⬆ menu / the doctor) reaches no one and records no check.
//   2. The map page, the widget page and the fonts are served by the map itself: no <link>/<script> on any page points
//      at an https:// host, and /fonts/fonts.css resolves every face it names on the same server.
//   3. The MAP.md mirror written into a project folder comes with a .gitignore, so it never lands in that project's git.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const home = mkdtempSync(join(tmpdir(), 'hm-launch-privacy-'));
const project = mkdtempSync(join(tmpdir(), 'hm-launch-project-'));
const PORT = 8811 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  cwd: root,
  env: { ...process.env, HARNESSMAP_HOME: home, HARNESSMAP_DB: join(home, 'map.sqlite'), PORT: String(PORT), HARNESSMAP_INFERENCE: 'off', HARNESSMAP_NO_UPDATE_CHECK: '1', HARNESSMAP_LATEST_OVERRIDE: '', HARNESSMAP_LATEST_BUILD_OVERRIDE: '', HARNESSMAP_AUTOTIDY_ROUNDS: '0' },
  stdout: Bun.file(join(home, 'server.log')), stderr: Bun.file(join(home, 'server.log')), windowsHide: true,
});
afterAll(() => { try { server.kill(); } catch {} rmSync(home, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); });
const get = async (p: string) => fetch(BASE + p);
const post = async (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get('/api/state')).ok; } catch { await Bun.sleep(250); } }

test('server comes up on a fresh home', () => { expect(up).toBe(true); });

test('HARNESSMAP_NO_UPDATE_CHECK=1: a forced update check asks no one and records nothing', async () => {
  const r = await post('/api/update-check', {});
  expect(r.status).toBe(200);
  const b = await r.json() as any;
  expect(b.latest).toBeNull();            // nothing was learned from GitHub
  expect(b.updateAvailable).toBeFalsy();
  const db = new Database(join(home, 'map.sqlite'), { readonly: true });
  const row = db.query('SELECT value FROM settings WHERE key = ?').get('latest_checked') as any;
  db.close();
  expect(row).toBeNull();                 // the check never ran, so no timestamp was written
});

test('the pages carry no third-party <link> or <script>', () => {
  for (const f of ['public/index.html', 'public/widget.html', 'companion/web/index.html']) {
    const text = readFileSync(join(root, f), 'utf8');
    const hits = [...text.matchAll(/<(link|script)\b[^>]*\b(href|src)=["']https?:\/\/[^"']+["'][^>]*>/gi)].map((m) => m[0]);
    expect({ file: f, hits }).toEqual({ file: f, hits: [] });
  }
});

test('/fonts/fonts.css is served by the map and every face it names resolves on the same server', async () => {
  const css = await get('/fonts/fonts.css');
  expect(css.status).toBe(200);
  expect(css.headers.get('content-type')).toContain('text/css');
  const text = await css.text();
  const urls = [...text.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ''));
  expect(urls.length).toBeGreaterThanOrEqual(6);
  for (const u of urls) {
    expect(u.startsWith('http')).toBe(false);
    const r = await get('/fonts/' + u);
    expect([u, r.status, r.headers.get('content-type')]).toEqual([u, 200, 'font/woff2']);
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  }
  // the page actually points at it
  const page = await (await get('/')).text();
  expect(page).toContain('href="/fonts/fonts.css"');
});

test('the MAP.md mirror in a project folder comes with a .gitignore', async () => {
  // a prompt from that folder makes it an active cwd; the first map change writes the mirror
  const sid = 'launch-privacy-' + Date.now();
  await post('/api/harness/session-start', { session_id: sid, cwd: project, harness: 'claude' });
  await post('/api/harness/prompt', { session_id: sid, cwd: project, text: 'hello map' });
  const s = await (await get('/api/state')).json() as any;
  const root_ = s.nodes.find((n: any) => !n.parent_id || n.content === 'untitled') ?? s.nodes[0];
  await post('/api/nodes', { parentId: root_.id, content: 'A line written by the launch test' });
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = existsSync(join(project, '.harnessmap', 'MAP.md')); if (!ok) await Bun.sleep(250); }
  expect(ok).toBe(true);
  const gi = join(project, '.harnessmap', '.gitignore');
  expect(existsSync(gi)).toBe(true);
  expect(readFileSync(gi, 'utf8')).toContain('*');
});

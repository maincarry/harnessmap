// One continuous take on the stage (demo/stage.html): the real map page in a window on a dark stage, a scripted camera,
// statements and lower-thirds, the companion sliding in, a typed terminal for the install, the logo. The story's turns
// go in from demo/seed.ts (which waits for <OUT>/recA/ready and writes <OUT>/recA/stop). Only the waiting between
// landings is cut later (cues.json 'keep' ranges), nothing is composited after the fact.
//   bun run demo/take.ts <port> <OUT>
import { chromium, type Frame, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [portS, outS] = process.argv.slice(2);
const port = Number(portS || 9375); const base = `http://127.0.0.1:${port}`;
const OUT = resolve(outS || `/tmp/claude-1000/demo-${Date.now()}`);
const recDir = join(OUT, 'take'), readyDir = join(OUT, 'recA');
mkdirSync(recDir, { recursive: true }); mkdirSync(readyDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const compUrl = 'file://' + resolve('companion/web/index.html');
const stageUrl = 'file://' + resolve('demo/stage.html') + `?map=${encodeURIComponent(base + '/')}&comp=${encodeURIComponent(compUrl)}`;
const story = JSON.parse(await Bun.file(resolve('demo/story.json')).text());
const LOWER: Record<number, string> = {
  1: 'She talks to Claude Code as always. The map files the turn on its own.',
  2: 'Her words, her name on them.',
  3: 'The 8:10 rule. The kind of thing that gets lost.',
  4: 'A correction, recorded as a correction. Not overwritten.',
  5: 'The deploy decision lands next to the rest.',
  6: 'One question left open.',
  7: 'One next step named. The afternoon, kept.',
  9: 'Priya answered. The open question becomes a rule.',
  10: 'The next step starts where the last session ended.',
};

const b = await chromium.launch();
// Playwright records the viewport at CSS size (no device-pixel upscaling), so the stage is rendered at 2x CSS zoom in a 2880x1920 viewport.
const ctx = await b.newContext({ viewport: { width: 2880, height: 1920 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: recDir, size: { width: 2880, height: 1920 } } });
await ctx.exposeFunction('__hmapi', async (method: string, path: string, body: string | null) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ?? undefined }); return await r.text(); });
await ctx.addInitScript(({ port }) => {
  if (!location.href.includes('companion/web/index.html')) return;
  (window as any).__TAURI__ = { core: { invoke: async (c: string, a: any) => {
    if (c === 'map_port_cmd') return port; if (c === 'map_ready') return true;
    if (c === 'get_settings') return { launchAtLogin: true, startMapOnOpen: true };
    if (c === 'api') return await (window as any).__hmapi(a.method || 'GET', a.path, a.body ?? null);
    return true; } } };
}, { port });
const pg: Page = await ctx.newPage();
const T0 = Date.now(); const now = () => +((Date.now() - T0) / 1000).toFixed(2);
const cues: any[] = [];
const cue = (k: string, x: Record<string, unknown> = {}) => { const c = { at: now(), k, ...x }; cues.push(c); console.log(JSON.stringify(c)); writeFileSync(join(OUT, 'cues.json'), JSON.stringify(cues, null, 1)); };
const keep = (from: number, label: string) => cue('keep', { from: Math.max(0, from), to: now(), label });
pg.on('pageerror', (e) => cue('pageerror', { e: String(e).slice(0, 160) }));
const S = async (js: string) => pg.evaluate(js); // stage calls
const mf = (): Frame => pg.frames().find((f) => f.url().startsWith(base))!;
const cf = (): Frame | undefined => pg.frames().find((f) => f.url().startsWith(compUrl));

for (let i = 0; i < 120; i++) { try { await (await fetch(base + '/api/state')).json(); break; } catch {} await sleep(1000); }
await pg.goto(stageUrl);
await pg.evaluate(() => { document.documentElement.style.width = document.body.style.width = '2880px'; document.documentElement.style.height = document.body.style.height = '1920px'; const st = document.getElementById('stage')!; st.style.transformOrigin = '0 0'; st.style.transform = 'scale(2)'; });
for (let i = 0; i < 60; i++) { try { if (mf() && (await mf().locator('#tree').count())) break; } catch {} await sleep(500); }
await mf().evaluate(() => { (window as any).tourStop?.(); localStorage.setItem('hm.tour.done', '1'); document.body.style.setProperty('--split', '50%'); });
await sleep(800);
cue('stage-ready');

let t = now();
try {
// 0 — the opening statements over an empty stage
await S(`statement('Every coding session forgets.', '', 3200)`);
await S(`statement('You spend an afternoon deciding things with your agent.<br>Then the session compacts.', 'Tomorrow you start blank. So does it.', 5200)`);
await S(`statement('Harness<b>Map</b> keeps what was discussed.', '', 3400)`);
keep(t, 'opening');

// 1 — the window comes in, the camera settles, then the story may start
t = now();
await S(`(function(){ const w=document.getElementById('win'); w.style.transitionDuration='0ms,.8s,.8s'; w.style.transform='translate(' + (640-640*0.94) + 'px,' + (400-400*0.94) + 'px) scale(0.94)'; })()`);
await sleep(80);
await S(`winShow(true)`);
await S(`cam(640, 400, 1, 1800)`);
await sleep(500);
keep(t, 'establish');
writeFileSync(join(readyDir, 'ready'), '1');

// 2 — the story lands, turn by turn; each landing gets its close-up
const known = new Set<string>();
const rowsNow = async () => mf().evaluate(() => Array.from(document.querySelectorAll('#tree .nrow')).map((el) => ({ id: (el.querySelector('.caret') as HTMLElement)?.dataset.fold || '', r: el.getBoundingClientRect() })).map((x) => ({ id: x.id, x: x.r.x, y: x.r.y, w: x.r.width, h: x.r.height })));
for (const r of await rowsNow()) known.add(r.id);
const newRect = async () => { const rows = (await rowsNow()).filter((r) => r.id && !known.has(r.id) && r.h > 0); for (const r of rows) known.add(r.id); if (!rows.length) return null; const x0 = Math.min(...rows.map((r) => r.x)), y0 = Math.min(...rows.map((r) => r.y)), x1 = Math.max(...rows.map((r) => r.x + r.w)), y1 = Math.max(...rows.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, n: rows.length }; };
const rectOf = async (sel: string) => mf().evaluate((sel) => { const el = document.querySelector(sel) as HTMLElement | null; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const closeUp = async (r: { x: number; y: number; w: number; h: number }, pad = 1.0, maxS = 1.9) => { const s = Math.max(1.15, Math.min(maxS, 1180 / Math.max(r.w, 380) / pad, 700 / Math.max(r.h, 120) / pad)); await S(`cam(${r.x + r.w / 2}, ${r.y + Math.min(r.h / 2, 300)}, ${s.toFixed(3)}, 1300)`); return s; };

let landed = 0, seen = 0;
const started = Date.now();
const seedLog = join(OUT, 'seed.log');
while (Date.now() - started < 30 * 60 * 1000) {
  if (existsSync(join(readyDir, 'stop')) && landed >= 10) break;
  let lines: string[] = []; try { lines = (await Bun.file(seedLog).text()).split('\n').filter((l) => /round \d+ (landed|grew)/.test(l)); } catch {}
  if (lines.length <= seen) { await sleep(500); continue; }
  const k = Number(lines[seen].match(/round (\d+)/)![1]); seen++; landed = Math.max(landed, k); cue('landed', { rounds: [k] });
  await sleep(1400); // let the rows paint
  const tk = now() - 1.6;
  if (k === 8) {
    const msg = await rectOf('#chat-pane .msg.assistant:last-of-type');
    await S(`lower(${JSON.stringify('A new session. It starts with the map in its context.')})`);
    if (msg) await closeUp(msg, 1.05, 1.5); await sleep(4200);
    await mf().evaluate(() => { const b = document.getElementById('ctx-btn') as any; b.hidden = false; b.onclick(); }); await sleep(900);
    const modal = await rectOf('.overlay .modal');
    await S(`lower(${JSON.stringify('The exact block the agent receives: the decisions, the rule, the open question.')})`);
    if (modal) await S(`cam(${modal.x + modal.w / 2}, ${modal.y + 260}, 1.35, 1300)`); await sleep(6500);
    await mf().evaluate(() => document.querySelectorAll('.overlay').forEach((o) => o.remove()));
    await S(`camReset(1200)`); await S(`lower('')`); await sleep(300);
    keep(tk, 'round 8 + context');
  } else {
    const r = await newRect();
    if (LOWER[k]) await S(`lower(${JSON.stringify(LOWER[k])})`);
    if (r) await closeUp(r); else await S(`cam(400, 420, 1.3, 1300)`);
    await sleep(3600);
    await S(`camReset(1200)`); await sleep(250);
    keep(tk, `round ${k}`);
    if (k === 7) { const t7 = now(); await S(`lower('')`); await S(`winDim(true)`); await S(`statement('Three days later.', '', 3000)`); await S(`winDim(false)`); keep(t7, 'three days later'); }
  }
}
await S(`lower('')`);

// 3 — the companion slides in over the map
t = now();
await S(`cam(640, 400, 0.9, 1000)`);
await cf()?.evaluate(() => document.body.classList.add('open'));
await S(`compShow(true)`);
await S(`lower(${JSON.stringify('A small companion on the desktop. The map is up, the focus is current, one click back.')})`);
await sleep(5500);
await cf()?.evaluate(() => (document.getElementById('settings-btn') as any)?.onclick());
await S(`lower(${JSON.stringify('Launch at login. Start the map with it. That is all the setup there is.')})`);
await sleep(4200);
await cf()?.evaluate(() => (document.getElementById('settings-back') as any)?.onclick());
await sleep(600);
await S(`compShow(false)`); await S(`lower('')`); await S(`camReset(1000)`);
keep(t, 'companion');

// 4 — talk to the map: the question typed, the answer from the map's own record. The map guide shares the inference
// queue with the memory passes that follow the last turns, so wait until the server has been quiet for a moment.
{ let lastN = -1, stable = 0; for (let i = 0; i < 150 && stable < 8; i++) { let n = -2; try { n = ((await (await fetch(base + '/api/audit?limit=500&kind=inference')).json()) as any[]).length; } catch {} if (n === lastN) stable++; else { stable = 0; lastN = n; } await sleep(1000); } cue('quiet', { inference: lastN }); }
t = now();
await mf().evaluate(() => (document.getElementById('map-chat') as HTMLElement).click()); await sleep(900);
const dlg = await rectOf('.overlay .modal');
if (dlg) await S(`cam(${dlg.x + dlg.w / 2}, ${dlg.y + dlg.h / 2}, 1.3, 1200)`);
await S(`lower(${JSON.stringify('Ask the map. It answers from its own record.')})`);
const QUESTION = 'what did we decide about email?';
for (let i = 1; i <= QUESTION.length; i++) { await mf().evaluate((v) => { const el = document.getElementById('mc-input') as HTMLInputElement; if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }, QUESTION.slice(0, i)); await sleep(42); }
await pg.evaluate(() => window.scrollTo(0, 0)); await sleep(500);
const before = await mf().locator('#mc-log .msg.assistant').count().catch(() => 0);
await mf().evaluate(() => (document.getElementById('mc-send') as HTMLElement).click()); cue('mc-sent');
for (let i = 0; i < 180; i++) { await sleep(1000); const n = await mf().locator('#mc-log .msg.assistant').count().catch(() => 0); const txt = await mf().locator('#mc-log').innerText().catch(() => ''); if (n > before && !/thinking/i.test(txt)) { cue('mc-answered', { after: i + 1 }); break; } }
const tAns = now() - 0.8;
await sleep(6500);
await mf().evaluate(() => { (document.getElementById('mc-close') as HTMLElement)?.click(); document.querySelectorAll('.overlay').forEach((o) => o.remove()); }); await S(`lower('')`); await S(`camReset(1000)`);
keep(t, 'ask'); cues.push({ at: now(), k: 'answer-from', from: tAns });

// 5 — the galaxy
t = now();
await mf().evaluate(() => (document.getElementById('galaxy-btn') as any)?.click());
await S(`lower(${JSON.stringify('The same map, as a sky.')})`);
await sleep(1500);
// the galaxy's first-run tip ("drag to wander… got it!") is dismissed the way a user would, so the sky is clean
for (let i = 0; i < 4; i++) { const hit = await mf().evaluate(() => { const all = Array.from(document.querySelectorAll('#galaxy-overlay *')) as HTMLElement[]; const b = all.filter((el) => el.children.length === 0 && /^\s*(got it!?|next|done|ok)\s*$/i.test(el.textContent || '')).pop(); if (b) { b.click(); return true; } return false; }).catch(() => false); if (!hit) break; await sleep(600); }
await sleep(6000);
await mf().evaluate(() => (document.getElementById('galaxy-close') as any)?.click());
await S(`lower('')`); await sleep(400);
keep(t, 'galaxy');

// 6 — why now, the install (the real commands, typed), the line
t = now();
await S(`winDim(true)`);
await S(`statement('Why now.', '', 2600)`);
await S(`statement('Every engineer now works through an agent.<br>The harness is where the thinking happens.<br>Nobody keeps it.', '', 5200)`);
await S(`terminal([{ prompt: '› ', text: '/plugin marketplace add maincarry/harnessmap', after: 600 }, { prompt: '› ', text: '/plugin install map@harnessmap', after: 600 }, { prompt: '› ', text: 'open map', after: 1400 }], 30)`);
await S(`terminalHide()`);
await S(`statement('Two lines to install. Then say <b>open map</b>.', 'Nothing else changes in how you work. It stays on your machine.', 4200)`);
keep(t, 'why now');

// 7 — the logo
t = now();
await S(`winShow(false)`);
await S(`logo('The memory layer for agent work.')`);
await sleep(7000);
keep(t, 'logo');
cue('end');
} catch (e) { cue('crash', { e: String(e).slice(0, 300) }); console.error(e); }
const vpath = pg.video()?.path();
await ctx.close(); await b.close();
console.log('video', await vpath);

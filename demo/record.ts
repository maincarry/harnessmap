// The demo recorder. Phase A records the map page while the real seeding run (src/eval/e2e-run.ts demo/story.json)
// files the story's turns; every landing is logged with its time so the edit can cut to it.
//   bun run demo/record.ts A <port> <outdir>
// Output: <outdir>/*.webm (one continuous take, 1440x960: the map at 1440x900 + a 60 px caption strip) and <outdir>/cues.json.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [phase, portS, outdir] = process.argv.slice(2);
const port = Number(portS || 9373);
const out = resolve(outdir || `/tmp/claude-1000/demo-rec-${Date.now()}`);
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const wrapper = 'file://' + resolve('demo/frame.html') + `?map=${encodeURIComponent(base + '/')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Captions for the story's ten turns (demo/story.json), in the storyboard's words.
const CAPTIONS = [
  'She talks to Claude Code as always. Beside her, the map files the turn. Nobody typed into the map.',
  'Her words, her name on them.',
  'The 8:10 rule is the kind of thing that gets lost.',
  'A correction is recorded as a correction. Not overwritten.',
  'The deploy decision lands next to the rest.',
  'One question left open.',
  'One next step named. That is the afternoon, kept.',
  'Three days later. The new session starts with the map in its context.',
  'The open question becomes a rule. The map shows what changed.',
  'The next step begins where the last session ended.',
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', recordVideo: { dir: out, size: { width: 1440, height: 960 } } });
const pg = await ctx.newPage();
const T0 = Date.now();
const cues: any[] = [];
const cue = (k: string, x: Record<string, unknown> = {}) => { const c = { at: +((Date.now() - T0) / 1000).toFixed(2), k, ...x }; cues.push(c); console.log(JSON.stringify(c)); writeFileSync(`${out}/cues.json`, JSON.stringify(cues, null, 1)); };
pg.on('pageerror', (e) => cue('pageerror', { e: String(e).slice(0, 200) }));
const mapFrame = async () => pg.frames().find((f) => f.url().startsWith(base));
if (phase === 'A' || phase === 'B') {
  for (let i = 0; i < 120; i++) { try { await (await fetch(base + '/api/state')).json(); break; } catch {} await sleep(1000); } // the server may still be starting
  if (phase === 'B') { for (let i = 0; i < 120; i++) { try { const f: any = await (await fetch(base + '/api/filings')).json(); if ((f.pending ?? 0) === 0 && (f.failed ?? 0) === 0) break; } catch {} await sleep(1000); } } // nothing half-filed on screen
  await pg.goto(wrapper);
  for (let i = 0; i < 60; i++) { const f = await mapFrame(); if (f) { try { if (await f.locator('#tree').count()) break; } catch {} } await sleep(500); }
  try { const f = await mapFrame(); await f?.evaluate(() => { (window as any).tourStop?.(); localStorage.setItem('hm.tour.done', '1'); }); } catch {}
  // a wider tree pane and a touch of zoom so the nodes read at video size (the page's own --split variable, dragged by the splitter)
  try { const f = await mapFrame(); await f?.evaluate(() => { document.body.style.setProperty('--split', '52%'); (document.documentElement.style as any).zoom = '1.1'; }); } catch {}
  cue('map-loaded');
  if (phase === 'A') writeFileSync(`${out}/ready`, '1'); // the seeder waits for this before the first turn
}
const caption = async (text: string) => { await pg.evaluate((t) => (window as any).setCaption(t), text); cue('caption', { text }); };

if (phase === 'A') {
  // Round detection: a turn shows up in /api/state filings.items (userHead) while the filer works on it; when the
  // pending list empties again and the node count grew, that turn landed — caption it then.
  const story = JSON.parse(await Bun.file(resolve('demo/story.json')).text());
  const heads: string[] = story.rounds.map((r: any) => String(r.user).slice(0, 60));
  const roundOf = (head: string) => heads.findIndex((h) => head.startsWith(h.slice(0, 40)) || h.startsWith(head.slice(0, 40)));
  let lastNodes = -1, lastPending = '', inFlight: number[] = [], landed = 0, downFor = 0;
  const started = Date.now();
  while (Date.now() - started < 25 * 60 * 1000) {
    let st: any = null;
    if (existsSync(`${out}/stop`)) { await sleep(2500); cue('stop-file'); break; }
    try { st = await (await fetch(base + '/api/state')).json(); downFor = 0; } catch { downFor++; if (downFor > 6) { cue('server-gone'); break; } await sleep(3000); continue; }
    const n = (st.nodes || []).length;
    const items: any[] = st.filings?.items || [];
    const pend = items.map((i) => i.userHead).join('|');
    if (pend !== lastPending) {
      const rounds = items.map((i) => roundOf(String(i.userHead || ''))).filter((r) => r >= 0).map((r) => r + 1);
      cue('pending', { rounds, raw: pend.slice(0, 120) });
      for (const r of rounds) if (!inFlight.includes(r)) inFlight.push(r);
      if (!items.length && inFlight.length) { const done = inFlight.splice(0); landed = Math.max(landed, ...done); cue('landed', { rounds: done, nodes: n }); if (CAPTIONS[landed - 1]) await caption(CAPTIONS[landed - 1]); }
      lastPending = pend;
    }
    if (n !== lastNodes) { cue('nodes', { n, delta: lastNodes < 0 ? n : n - lastNodes }); lastNodes = n; }
    await sleep(700);
  }
  cue('end');
}

if (phase === 'B') {
  // Phase B runs on a server over the kept map (inference on, so talk to map answers). Four beats on the map page.
  const f = async () => (await mapFrame())!;
  const hold = async (ms: number) => { await sleep(ms); };
  await hold(2500);
  // B1 — the chat agent's view: the exact block the agent receives next turn (the real /api/chats/:id/context).
  await caption('The new session starts with the map in its context. It picks up where she left off.');
  await (await f()).evaluate(() => { const b = document.getElementById('ctx-btn') as any; b.hidden = false; b.onclick(); });
  cue('ctx-open'); await hold(11000);
  await (await f()).evaluate(() => { document.querySelectorAll('.overlay').forEach((o) => o.remove()); });
  cue('ctx-close'); await hold(1500);
  // B2 — talk to the map (the real map guide; the answer comes from the map's own record).
  await caption('Ask the map. It answers from its own record and says where.');
  await (await f()).locator('#map-chat').click(); cue('mc-open');
  await (await f()).locator('#mc-input').fill('what did we decide about email?'); await hold(900);
  const before = await (await f()).locator('#mc-log .msg.assistant').count().catch(() => 0);
  await (await f()).locator('#mc-send').click(); cue('mc-sent', { before });
  for (let i = 0; i < 120; i++) { await sleep(1000); const n = await (await f()).locator('#mc-log .msg.assistant').count().catch(() => 0); const thinking = await (await f()).locator('#mc-log').innerText().catch(() => ''); if (n > before && !/thinking/i.test(thinking)) { cue('mc-answered', { after: i + 1 }); break; } }
  await hold(9000);
  await (await f()).locator('#mc-close').click().catch(() => {}); cue('mc-close'); await hold(1200);
  // B3 — the galaxy view.
  await caption('The same map, as a sky.');
  await (await f()).evaluate(() => (document.getElementById('galaxy-btn') as any)?.click()); cue('galaxy-open');
  await hold(11000);
  await (await f()).evaluate(() => (document.getElementById('galaxy-close') as any)?.click()); cue('galaxy-close'); await hold(1500);
  await caption(''); await hold(800);
  cue('end');
}
if (phase === 'C') {
  // Phase C — the companion page (companion/web/index.html) over the same server, on a quiet desktop. No clicks on
  // "go to session": there is no window on this box to bring forward, that beat is the founders' re-record.
  const compUrl = 'file://' + resolve('companion/web/index.html');
  const cpage = await ctx.newPage();
  // file:// pages send Origin null and the server answers 403, so the companion's API calls go through a Node-side fetch.
  await ctx.exposeFunction('__hmapi', async (method: string, path: string, body: string | null) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ?? undefined }); return await r.text(); });
  await cpage.addInitScript(({ port }) => {
    if (!location.href.includes('companion/web/index.html')) return;
    (window as any).__TAURI__ = { core: { invoke: async (c: string, a: any) => {
      if (c === 'map_port_cmd') return port; if (c === 'map_ready') return true;
      if (c === 'get_settings') return { launchAtLogin: true, startMapOnOpen: true };
      if (c === 'api') return await (window as any).__hmapi(a.method || 'GET', a.path, a.body ?? null);
      return true; } } };
  }, { port });
  await cpage.goto('file://' + resolve('demo/frame.html') + `?mode=companion&map=${encodeURIComponent(compUrl)}`);
  await sleep(2500);
  const cf = cpage.frames().find((fr) => fr.url().startsWith(compUrl));
  await cf?.evaluate(() => document.body.classList.add('open'));
  cue('companion-open');
  await cpage.evaluate((t) => (window as any).setCaption(t), 'A small companion on the desktop. One light: the map is up. The focus. One click to the map.');
  await sleep(9000);
  await cf?.evaluate(() => { (document.getElementById('settings-btn') as any)?.onclick(); });
  await cpage.evaluate((t) => (window as any).setCaption(t), 'Launch at login. Start the map with it. That is all the setup there is.');
  cue('companion-settings'); await sleep(6000);
  await cf?.evaluate(() => { (document.getElementById('settings-back') as any)?.onclick(); });
  await sleep(1500);
  cue('end');
  const cv = cpage.video()?.path(); await cpage.close(); const cvp = await cv; cue('companion-video', { path: cvp }); console.log('companion video', cvp);
}

if (phase === 'cards') {
  const cards = JSON.parse(await Bun.file(resolve('demo/cards.json')).text());
  const cp = await b.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });
  await cp.goto('file://' + resolve('demo/frame.html') + '?map=about:blank');
  await sleep(800);
  for (const c of cards) { await cp.evaluate((c) => (window as any).showCard(c.title, c.sub || '', !!c.logo), c); await sleep(700); await cp.screenshot({ path: `${out}/${c.id}.png` }); console.log('card', c.id); }
  await cp.close();
}
const vpath = pg.video()?.path();
await ctx.close(); await b.close();
console.log('video', await vpath, 'cues', `${out}/cues.json`);

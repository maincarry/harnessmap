// Seeds the demo map through the real hooks' endpoint, one turn at a time, at the recorder's pace.
//   bun run demo/seed.ts <port> <outdir>     (reads demo/story.json; waits for <outdir>/recA/ready; writes <outdir>/recA/stop)
// The same calls the harness hooks make: POST /api/harness/observe per turn, GET /api/harness/context for a new session's
// first prompt. Nothing is written to the map by hand except the story's seed node and the focus, as the e2e runner does.
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [portS, outdir] = process.argv.slice(2);
const base = `http://127.0.0.1:${Number(portS || 9375)}`;
const out = resolve(outdir || '/tmp/claude-1000/demo-seed');
mkdirSync(join(out, 'recA'), { recursive: true });
const cwd = join(out, 'proj'); mkdirSync(cwd, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(base + p)).json();
const post = async (p: string, b: any) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); let body: any = null; try { body = await r.json(); } catch {} return { status: r.status, body }; };
const story = JSON.parse(await Bun.file(resolve('demo/story.json')).text());
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

for (let i = 0; i < 120; i++) { try { await get('/api/state'); break; } catch { await sleep(1000); } }
let st: any = await get('/api/state');
const rootTop = (st.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
const keys: Record<string, string> = {};
for (const n of story.seed ?? []) { const r = await post('/api/nodes', { content: n.content, parentId: n.parent ? keys[n.parent] : rootTop?.id ?? null }); keys[n.key] = r.body?.id; }
st = await get('/api/state');
const chat = (st.chats ?? []).find((c: any) => c.id === st.mainChatId) ?? st.chats?.[0];
if (story.focus && chat) await post(`/api/chats/${chat.id}/focus`, { nodeId: keys[story.focus] });
if (story.auto) await post('/api/auto', story.auto);
log('seeded; waiting for the recorder');
for (let i = 0; i < 90 && !existsSync(join(out, 'recA', 'ready')); i++) await sleep(1000);
await sleep(2500);

const drained = async (floorMs: number, ceilMs: number) => { const t0 = Date.now(); await sleep(floorMs); while (Date.now() - t0 < ceilMs) { try { const f: any = await get('/api/filings'); if ((f.pending ?? 0) === 0) return true; } catch {} await sleep(1500); } return false; };
let k = 0;
for (const r of story.rounds) {
  k++;
  for (const a of (k > 1 ? story.rounds[k - 2].then ?? [] : [])) {
    if (a.do === 'context') { const q = `/api/harness/context?session_id=${encodeURIComponent(a.session)}&cwd=${encodeURIComponent(cwd)}${a.prompt ? `&prompt=${encodeURIComponent(a.prompt)}` : ''}`; const c: any = await (await fetch(base + q)).json(); const t = String(c?.context ?? c?.additionalContext ?? c?.text ?? ''); log(`context for ${a.session}: ${t.length} chars; has 8:10=${/8:10|warm-up/i.test(t)} Priya=${/Priya|two slots/i.test(t)} SQLite=${/SQLite/.test(t)}`); writeFileSync(join(out, 'context-day4.txt'), t); }
  }
  const nodesBefore = ((await get('/api/state')).nodes ?? []).length;
  const ob = await post('/api/harness/observe', { session_id: r.session ?? 'demo', cwd, user_text: r.user, assistant_text: r.assistant });
  log(`round ${k} posted (${ob.status}) ${String(r.user).slice(0, 50)}`);
  // landed = the map grew (or the filer gave up) and nothing is pending any more — one turn at a time, so each gets its close-up
  let grew = false; for (let i = 0; i < 120 && !grew; i++) { await sleep(1500); try { const st = await get('/api/state'); grew = (st.nodes ?? []).length > nodesBefore || ((st.filings?.failed ?? 0) + (st.filings?.abandoned ?? 0)) > 0; } catch {} }
  const ok = await drained(1500, 120000);
  log(`round ${k} ${grew && ok ? 'landed' : grew ? 'grew, filer still busy' : 'NOT grown in time'}`);
  await sleep(story.settleMs ?? 5000);
}
await sleep(4000);
writeFileSync(join(out, 'recA', 'stop'), 'done');
log('all rounds landed; stop written');

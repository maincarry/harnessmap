// M275: auto mode, end to end with a REAL filer (Jacob, 2026-09-15: "test these functions yourself before push").
// Spawns a server on a temp DB, seeds a small map, switches auto mode on, and drives four rounds through
// /api/harness/observe: one inside the focus (no re-aim), a pivot (focus moves, one undo restores it exactly),
// a stray whose home is dimmed (kept, said so), then the home lit by hand (the stray is filed; the hand-lit node
// is never dimmed). Mechanics assert exactly; the model's choices leniently.
// Run: env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE bun run src/eval/auto-mode-live.ts
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 8795; const BASE = `http://127.0.0.1:${PORT}`;
const TMP = '/tmp/claude-1000/harnessmap-auto-live'; const DB = join(TMP, 'live.sqlite');
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const audit = async (kind?: string) => get(`/api/audit?limit=500${kind ? `&kind=${kind}` : ''}`) as Promise<any[]>;
// the audit route returns newest first — reverse into arrival order so slices by length mean "since then"
const autoEvents = async () => (await audit()).slice().reverse().filter((r: any) => /^auto_/.test(r.kind));
async function observeAndSettle(session: string, user: string, assistant: string): Promise<void> {
  const before = (await audit('inference')).filter((r: any) => JSON.stringify(r.detail).includes('"filer"')).length;
  const autoBefore = (await autoEvents()).length;
  await post('/api/harness/observe', { session_id: session, cwd: join(TMP, 'proj'), user_text: user, assistant_text: assistant });
  for (let i = 0; i < 40; i++) { await sleep(3000); const n = (await audit('inference')).filter((r: any) => JSON.stringify(r.detail).includes('"filer"')).length; if (n > before) break; }
  // auto mode runs after the round lands: wait for its audit trail to grow (aim / skip / place / error), then a little more for housekeeping
  for (let i = 0; i < 30; i++) { await sleep(3000); if ((await autoEvents()).length > autoBefore) break; }
  await sleep(6000);
}
const state = () => get('/api/state');
const chatOf = (s: any) => (s.chats ?? []).find((c: any) => c.id === s.mainChatId);
const nodeByTitle = (s: any, t: string) => (s.nodes ?? []).find((n: any) => (n.title || n.content) === t);
const under = (s: any, id: string, ancestor: string): boolean => { for (let n = (s.nodes ?? []).find((x: any) => x.id === id); n; n = (s.nodes ?? []).find((x: any) => x.id === n.parentId)) if (n.id === ancestor) return true; return false; };

rmSync(TMP, { recursive: true, force: true }); mkdirSync(join(TMP, 'proj'), { recursive: true }); mkdirSync(join(TMP, 'home', '.claude'), { recursive: true });
try { writeFileSync(join(TMP, 'home', '.claude', '.credentials.json'), readFileSync(join(process.env.HOME ?? '', '.claude', '.credentials.json')), { mode: 0o600 }); } catch { console.warn('no subscription credentials to copy — the filer will fail'); }
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: { ...process.env, ANTHROPIC_API_KEY: undefined as any, HARNESSMAP_INFERENCE: undefined as any, HARNESSMAP_DB: DB, HARNESSMAP_HOME: join(TMP, 'home', '.harnessmap'), PORT: String(PORT), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1', HOME: join(TMP, 'home') },
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
let up = false; for (let i = 0; i < 30; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
if (!up) { console.error('server never came up'); process.exit(1); }

console.log('\n== seed: a thesis map, focus on chapter 1, Travel dimmed, auto mode on ==');
let s = await state();
const rootTop = (s.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
const mk = async (content: string, parentId: string | null) => (await post('/api/nodes', { content, parentId })).body.id as string;
const thesis = await mk('Thesis: trust in institutions (survey study)', rootTop?.id ?? null);
const ch1 = await mk('Chapter 1: methods', thesis); await mk('sampling plan: who is surveyed and how many', ch1); await mk('survey design: the questionnaire', ch1);
const ch2 = await mk('Chapter 2: results', thesis);
const travel = await mk('Travel: conferences and trips', thesis); const lisbon = await mk('Lisbon conference in November: flights and hotel', travel);
s = await state();
// the session's view: rounds file into the view the host session owns, which may differ from the seed's chat — always read it fresh
const cid = () => chatOf(s).id;
await post(`/api/chats/${cid()}/focus`, { nodeId: ch1 });
await post(`/api/chats/${cid()}/lit`, { nodeId: travel, on: false });
s = await state();
check('focus is chapter 1 and Travel is dark', chatOf(s).focusContainerId === ch1 && !chatOf(s).lit.includes(travel) && !chatOf(s).lit.includes(lisbon));
// the seed's own undo entries must not confuse the later checks
const a1 = await post('/api/auto', { on: true }); check('auto mode on with the ruled defaults', a1.body.auto.on && a1.body.auto.focus && a1.body.auto.light && a1.body.auto.place && !a1.body.auto.tidy);

console.log('\n== round 1: inside the focus — filed, no re-aim ==');
await observeAndSettle('live-1', 'For the sampling plan we decided on 400 respondents, stratified by region, recruited through the national panel.', 'Noted: sampling plan = 400 respondents, stratified by region, via the national panel.');
s = await state();
const ev1 = await autoEvents();
check('the round filed something under chapter 1', (s.nodes ?? []).some((n: any) => under(s, n.id, ch1) && /400|stratif|panel/i.test(n.content + ' ' + (n.title ?? ''))), (s.nodes ?? []).filter((n: any) => under(s, n.id, ch1)).map((n: any) => n.title || n.content).join(' | ').slice(0, 200));
check('auto mode skipped the aim (the round stayed inside the focus) and the focus is unchanged', ev1.some((e: any) => e.kind === 'auto_aim_skip') && chatOf(s).focusContainerId === ch1, JSON.stringify(ev1.map((e: any) => e.kind)));

console.log('\n== round 2: a pivot — the focus follows, one undo restores it exactly ==');
const litBefore = [...chatOf(s).lit].sort().join();
await observeAndSettle('live-1', "Let's switch to chapter 2, the results: the response rate came in at 62 percent and the effect of local news exposure on institutional trust was positive and significant.", 'Recorded in chapter 2 results: response rate 62%; local news exposure → higher institutional trust, significant.');
s = await state();
const ev2 = (await autoEvents()).slice(ev1.length);
const focusNow = chatOf(s).focusContainerId;
check('auto mode aimed (an auto_mode line was announced)', ev2.some((e: any) => e.kind === 'auto_mode' && /focus|lit|dim/.test(String(e.detail?.line))), JSON.stringify(ev2.map((e: any) => [e.kind, e.detail?.line ?? e.detail?.why ?? e.detail?.error]).slice(0, 6)));
check('the focus moved into chapter 2 (or a node under it)', focusNow === ch2 || under(s, focusNow, ch2), `focus=${(nodeByTitle(s, '') , (s.nodes ?? []).find((n: any) => n.id === focusNow)?.title ?? focusNow)}`);
check('the undo button names the aim', /^auto mode/.test(s.undoNext ?? ''), s.undoNext ?? 'none');
// housekeeping entries (rename, placement) may sit above the aim on the stack — undo down to the aim (at most three pops)
let und: any = { body: {} }; for (let i = 0; i < 3; i++) { und = await post('/api/undo', {}); if (/focus →|re-aim/.test(und.body.label ?? '')) break; }
s = await state();
const litAfterUndo = new Set(chatOf(s).lit);
check('undo puts the focus back on chapter 1 and every node lit before the pivot is lit again', und.body.ok && chatOf(s).focusContainerId === ch1 && litBefore.split(',').every((id) => litAfterUndo.has(id)), `focus=${chatOf(s).focusContainerId === ch1} missing=${litBefore.split(',').filter((id) => !litAfterUndo.has(id)).length}`);

console.log('\n== round 2b: a focus set BY HAND holds against auto mode (M282), and a pinned depth is served (M282) ==');
await post(`/api/chats/${cid()}/focus`, { nodeId: ch1 }); // the person presses ▶ on chapter 1
s = await state(); check('the state says the focus was set by hand', s.focusBy === 'user');
await observeAndSettle('live-1', 'One more result for chapter 2: the trust effect held in the rural subsample as well, with a smaller coefficient.', 'Recorded under chapter 2 results: the trust effect holds in the rural subsample, smaller coefficient.');
s = await state();
const ev2b = (await autoEvents()).slice(ev1.length + ev2.length);
// the aim may not even want to move (model variance) — the invariant is that the hand-set focus stays; the "kept" line appears only when it wanted to
check('the hand-set focus on chapter 1 stays through a round about chapter 2', chatOf(s).focusContainerId === ch1, JSON.stringify(ev2b.map((e: any) => [e.kind, e.detail?.line ?? e.detail?.why]).slice(0, 5)));
await post(`/api/chats/${cid()}/depth`, { nodeId: ch2, depth: 2 }); // pin chapter 2 at whole story
s = await state();
check('a pinned depth is served (chapter 2 at whole story, or reported unmet)', (s.served && s.served[ch2] >= 2) || (s.pinsUnmet ?? []).includes(ch2) || !chatOf(s).lit.includes(ch2), `served=${s.served && s.served[ch2]} lit=${chatOf(s).lit.includes(ch2)}`);
await post(`/api/chats/${cid()}/release`, { nodeId: ch1 }); // release the hand focus so the later rounds behave as before
await post(`/api/chats/${cid()}/depth`, { nodeId: ch2, depth: null });
s = await state(); check('release returns the focus to auto', s.focusBy !== 'user');
const ev2c = await autoEvents();

console.log('\n== round 3: a stray whose home is dimmed — filed to "to sort", kept, said so ==');
await observeAndSettle('live-1', 'Unrelated: can you book my Lisbon flight for the November conference, leaving the 11th?', 'I cannot book flights, but I noted it: Lisbon flight for the November conference, departing the 11th.');
s = await state();
const toSort = (s.nodes ?? []).find((n: any) => n.parentId === null && String(n.title ?? n.content).startsWith('to sort'));
// M278 made the top level ordinary: the stray may land in "to sort" or as a top-level node — anywhere but the dark Travel branch
const stray = (s.nodes ?? []).find((n: any) => toSort && n.parentId === toSort.id && /lisbon|flight/i.test(n.content + ' ' + (n.title ?? '')))
  ?? (s.nodes ?? []).find((n: any) => toSort && under(s, n.id, toSort.id) && /lisbon|flight/i.test(n.content + ' ' + (n.title ?? '')))
  ?? (s.nodes ?? []).find((n: any) => n.id !== lisbon && n.id !== travel && !under(s, n.id, travel) && /lisbon|flight/i.test(n.content + ' ' + (n.title ?? '')));
const ev3 = (await autoEvents()).slice(ev2c.length);
check('the stray landed outside the dark Travel branch (in "to sort" or at the top level — M278)', !!stray && !under(s, stray.id, travel), stray ? `stray under ${(s.nodes ?? []).find((n: any) => n.id === stray.parentId)?.title ?? stray.parentId ?? 'top level'}` : 'no stray node found');
check('the aim never made the stray (a "to sort" item) the focus', !!toSort && !under(s, chatOf(s).focusContainerId, toSort.id), `focus=${(s.nodes ?? []).find((n: any) => n.id === chatOf(s).focusContainerId)?.title ?? chatOf(s).focusContainerId}`);
check('auto mode did not move it into the dark branch and audited the skip', !(stray && under(s, stray.id, travel)) && ev3.some((e: any) => e.kind === 'auto_place_skip' || (e.kind === 'auto_mode' && /kept|no home/.test(String(e.detail?.line)))), JSON.stringify(ev3.map((e: any) => [e.kind, e.detail?.line ?? e.detail?.why]).slice(0, 6)));

console.log('\n== round 4: the person lights Travel — the stray is filed there; the hand-lit node is never dimmed ==');
s = await state();
const litR = await post(`/api/chats/${cid()}/lit`, { nodeId: travel, on: true });
s = await state(); check('Travel is lit by hand (userLit)', (chatOf(s).userLit ?? []).includes(travel), `lit route ${litR.status} ${JSON.stringify(litR.body).slice(0, 80)}; view=${cid().slice(0, 8)}`);
// the backlog retry timer: the stray was tried a moment ago — clear its stamp so this round retries it
await post('/api/dev/setting', { key: `auto_place_tried:${stray?.id}`, value: '0' });
await observeAndSettle('live-1', 'Back to methods: the sampling plan also needs a pilot wave of 30 respondents before the main fieldwork.', 'Added to the sampling plan: a pilot wave of 30 respondents precedes the main fieldwork.');
s = await state();
const strayNow = stray ? (s.nodes ?? []).find((n: any) => n.id === stray.id) : null;
const ev4 = (await autoEvents()).slice(ev2c.length + ev3.length);
const strayTop = stray ? (() => { let n = (s.nodes ?? []).find((x: any) => x.id === stray.id); while (n && n.parentId && (s.nodes ?? []).find((x: any) => x.id === n.parentId)?.parentId !== null && !under(s, n.parentId, travel)) n = (s.nodes ?? []).find((x: any) => x.id === n.parentId); return n; })() : null;
check('the stray was filed under Travel (auto placement into a lit home)', !!strayNow && under(s, strayNow.id, travel), strayNow ? `now under ${(s.nodes ?? []).find((n: any) => n.id === strayNow.parentId)?.title ?? strayNow.parentId}; events ${JSON.stringify(ev4.map((e: any) => [e.kind, e.detail?.line ?? e.detail?.why]).slice(0, 6))}` : 'stray missing');
check('Travel, lit by hand, is still lit after the round (auto mode never dims a hand-lit node)', chatOf(s).lit.includes(travel));
// the filer's own TO-SORT INTEGRATION may file the stray first (a round is not undoable); when auto mode did it, it is an undo entry
const placedByAuto = ev4.some((e: any) => e.kind === 'auto_mode' && /placed/.test(String(e.detail?.line)));
check('when auto mode did the placement it is an undo entry (else the filer filed it as part of the round)', !placedByAuto || (await get('/api/undo/list')).entries.some((e: any) => /auto mode: placed/.test(e.label)), placedByAuto ? 'auto placed but no undo entry' : 'filed by the round');

console.log(`\n================ auto-mode live: ${pass} passed, ${fail} failed ================`);
server.kill();
process.exit(fail ? 1 : 0);

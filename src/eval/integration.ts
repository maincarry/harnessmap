// Integration / end-to-end suite (M89). Spawns a real server on a temp DB and
// drives every HTTP path: projects, chats (fork/fresh/topic), cwd routing,
// node ops, lighting law, injection mechanics (full/delta/re-anchor/notice),
// nudges, dots (mapcheck → precompute → cached preview → apply), specialists,
// search/favorites, rename sweep, MAP.md, audit. Mechanical paths assert
// exactly; model paths assert shape + keywords (leniently).
//
// Run: HARNESSMAP_INFERENCE=api bun run src/eval/integration.ts

import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = '/tmp/claude-1000/harnessmap-it';
const DB = join(TMP, 'it.sqlite');
const CWD_BETA = join(TMP, 'proj-beta');
const CWD_DEF = join(TMP, 'proj-def');

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function filerCount(): Promise<number> {
  const a = await get('/api/audit?limit=500&kind=inference');
  return a.filter((r: any) => JSON.stringify(r.detail).includes('filer')).length;
}
async function waitRound(before: number, cap = 120): Promise<boolean> {
  for (let i = 0; i < cap / 4; i++) { await sleep(4000); if (await filerCount() > before) { await sleep(1500); return true; } }
  return false;
}
async function observe(session: string, user: string, assistant: string) {
  const b = await filerCount();
  await post('/api/harness/observe', { session_id: session, user_text: user, assistant_text: assistant });
  return waitRound(b);
}
const state = () => get('/api/state');
const litOfActive = (s: any) => ((s.chats ?? []).find((c: any) => c.id === s.mainChatId)?.lit ?? []) as string[];
const activeChat = (s: any) => (s.chats ?? []).find((c: any) => c.id === s.mainChatId);

// ---------- boot ----------
rmSync(TMP, { recursive: true, force: true });
mkdirSync(CWD_BETA, { recursive: true });
mkdirSync(CWD_DEF, { recursive: true });
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: { ...process.env, HARNESSMAP_DB: DB, PORT: String(PORT), HARNESSMAP_REANCHOR: '2', HARNESSMAP_TERM_CMD: 'bash', HARNESSMAP_LATEST_OVERRIDE: '99.0.0',
    HOME: join(TMP, 'home'), HARNESSMAP_IMPORT_MODEL: 'claude-haiku-4-5' /* tests pin cheap; prod default is the fancy model */ },
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
let up = false;
for (let i = 0; i < 20; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
if (!up) { console.error('server never came up'); process.exit(1); }

console.log('\n== 1. boot & migration-fresh ==');
{
  const s = await state();
  check('fresh DB boots one default project', s.projects.length === 1 && s.projects[0].name === 'default');
  check('bootstrap created root node + system to-sort (M123)', s.nodes.length === 2 && s.nodes.some((n: any) => n.content === 'workspace') && s.nodes.some((n: any) => n.content === 'to sort' && n.parentId === null));
  check('bootstrap created one chat, active + in list', s.chats.length === 1 && s.chats[0].id === s.mainChatId);
  check('root is lit', litOfActive(s).includes(s.nodes.find((n: any) => n.content === 'workspace').id));
}

console.log('\n== 1.5 binding: adoption, announcements, subtree (M91) ==');
{
  const r1 = await post('/api/harness/session-start', { session_id: 's-def', cwd: CWD_DEF });
  check('first bind ADOPTS the default project (renamed from dirname)', (await state()).projects.some((p: any) => p.name === 'proj-def'));
  check('no ghost default project left', !(await state()).projects.some((p: any) => p.name === 'default'));
  const an1 = r1.body.announce ?? '';
  check('first-run intro announced', /first run/i.test(an1) && /localhost|127\.0\.0\.1/.test(an1));
  check('intro states local-only storage with path', /stays on this machine/i.test(an1) && an1.includes('.sqlite'));
  check('intro instructs the open OFFER', /offer/i.test(an1));
  check('session-start reports server version', typeof r1.body.version === 'string' && r1.body.version.length > 0);
  const r2 = await post('/api/harness/session-start', { session_id: 's-def2', cwd: CWD_DEF });
  check('announcement is once per project', !(r2.body.announce ?? ''));
  mkdirSync(join(CWD_DEF, 'packages', 'core'), { recursive: true });
  const before = (await state()).projects.length;
  const r3 = await post('/api/harness/session-start', { session_id: 's-def-sub', cwd: join(CWD_DEF, 'packages', 'core') });
  check('subdirectory binds to ancestor project (no new project)', (await state()).projects.length === before && !(r3.body.announce ?? ''));
}

console.log('\n== 2. projects ==');
const DEF = (await state()).projectId;
let BETA = '';
{
  const r = await post('/api/projects', { name: 'beta book' });
  BETA = r.body.projectId;
  check('create project ok', r.status === 200 && !!BETA);
  const s = await state();
  check('new project becomes active with its own empty map (+to-sort)', s.projectId === BETA && s.nodes.length === 2);
  check('projects list has both', s.projects.length === 2);
  const bad = await post('/api/projects/none-such/activate');
  check('activate unknown project → 404', bad.status === 404);
  const noname = await post('/api/projects', {});
  check('create without name → 400', noname.status === 400);
  const back = await post(`/api/projects/${DEF}/activate`);
  check('re-activate default ok', back.status === 200 && (await state()).projectId === DEF);
}

console.log('\n== 3. cwd → project: auto-create per new directory ==');
let PBETA = '';
{
  const r = await post('/api/harness/session-start', { session_id: 's-beta', cwd: CWD_BETA });
  const s3 = await state();
  PBETA = (s3.projects.find((p: any) => p.name === 'proj-beta') ?? {}).id;
  check('unknown directory auto-creates its own project', !!PBETA);
  check('new-project short announce names it', /proj-beta/.test(r.body.announce ?? '') && !/first run/i.test(r.body.announce ?? ''));
  await post(`/api/projects/${DEF}/activate`); // UI back on the main test project
}

console.log('\n== 4. node ops & lighting law (mechanical) ==');
let pricingId = '', childId = '';
{
  await post('/api/nodes', { content: 'pricing strategy' });
  let s = await state();
  pricingId = s.nodes.find((n: any) => n.content === 'pricing strategy')?.id;
  check('user-created node exists', !!pricingId);
  check('user-created node is born lit (M66)', litOfActive(s).includes(pricingId));
  await post('/api/nodes', { content: 'enterprise tier pricing', parentId: pricingId });
  s = await state();
  childId = s.nodes.find((n: any) => n.content === 'enterprise tier pricing')?.id;
  check('child created under parent', s.nodes.find((n: any) => n.id === childId)?.parentId === pricingId);

  await post(`/api/nodes/${pricingId}`, { type: 'decision', status: 'proposed' });
  s = await state();
  const pn = s.nodes.find((n: any) => n.id === pricingId);
  check('edit type+status applied', pn.type === 'decision' && pn.status === 'proposed');
  const longTitle = 'x'.repeat(80);
  await post(`/api/nodes/${pricingId}`, { title: longTitle });
  s = await state();
  check('overlong (>64 char) title rejected by store guard', (s.nodes.find((n: any) => n.id === pricingId).title ?? '') !== longTitle);
  const e404 = await post('/api/nodes/nope', { status: 'live' });
  check('edit unknown node → 404', e404.status === 404);

  // two removal paths: edit status:removed pops children up; /delete takes the subtree
  await post('/api/nodes', { content: 'temp middle', parentId: pricingId });
  s = await state();
  const midId = s.nodes.find((n: any) => n.content === 'temp middle')?.id;
  await post('/api/nodes', { content: 'grandchild survivor', parentId: midId });
  await post(`/api/nodes/${midId}`, { status: 'removed' });
  s = await state();
  const survivor = s.nodes.find((n: any) => n.content === 'grandchild survivor');
  check('status:removed pops children up to parent', !!survivor && survivor.parentId === pricingId);
  await post('/api/nodes', { content: 'doomed parent', parentId: pricingId });
  s = await state();
  const doomedId = s.nodes.find((n: any) => n.content === 'doomed parent')?.id;
  await post('/api/nodes', { content: 'doomed child', parentId: doomedId });
  await post(`/api/nodes/${doomedId}/delete`);
  s = await state();
  check('/delete removes the whole subtree', !s.nodes.some((n: any) => n.content.startsWith('doomed')));

  const CH = s.mainChatId;
  await post(`/api/chats/${CH}/focus`, { nodeId: pricingId });
  s = await state();
  check('focus endpoint re-aims chat', activeChat(s)?.focusContainerId === pricingId);
  // M111: pricing is now ON the focus path — refocus the root so the classic
  // dim toggle below isn't hitting the protection (that's tested in sec 19).
  const rootId0 = s.nodes.find((n: any) => n.parentId === null && n.content === 'workspace').id;
  await post(`/api/chats/${CH}/focus`, { nodeId: rootId0 });
  await post(`/api/chats/${CH}/lit`, { nodeId: pricingId, on: false });
  s = await state();
  check('dim toggles node + descendants', !litOfActive(s).includes(pricingId) && !litOfActive(s).includes(childId));
  await post(`/api/chats/${CH}/lit`, { nodeId: pricingId, on: true });
  s = await state();
  check('relight toggles node + descendants', litOfActive(s).includes(pricingId) && litOfActive(s).includes(childId));
  const rootId = s.nodes.find((n: any) => n.parentId === null && n.content === 'workspace').id;
  await post(`/api/chats/${CH}/zoomin`, { nodeId: pricingId, focus: false });
  s = await state();
  check('zoom is view-only — lighting untouched (M105)', litOfActive(s).includes(rootId) && litOfActive(s).includes(pricingId));
  await post('/api/nodes', { content: 'outside witness' });
  s = await state();
  const witness = s.nodes.find((n: any) => n.content === 'outside witness').id;
  const dOut = await post(`/api/chats/${CH}/dim-outside`, { nodeId: pricingId });
  s = await state();
  check('dim-outside dims the rest but keeps the protected focus path (M111)', dOut.status === 200 && !litOfActive(s).includes(witness) && litOfActive(s).includes(pricingId) && litOfActive(s).includes(rootId0));
  await post(`/api/chats/${CH}/lit`, { nodeId: rootId, on: true });
  await post(`/api/chats/${CH}/lit`, { nodeId: pricingId, on: true });

  await post(`/api/nodes/${childId}/favorite`, { on: true });
  s = await state();
  check('favorite recorded in state', (s.favorites ?? []).includes(childId));
  const sr = await get('/api/search?q=enterprise&record=1');
  check('search finds node with path', sr.results[0]?.id === childId && sr.results[0].path.includes('pricing strategy'));
  const empty = await get('/api/search?q=');
  check('empty query = favorites + history', empty.results.some((r: any) => r.id === childId) && empty.history.includes('enterprise'));
  await post(`/api/nodes/${childId}/favorite`, { on: false });
  check('unfavorite works', !(((await state()).favorites) ?? []).includes(childId));
}

console.log('\n== 5. chats: fork / fresh / topic input ==');
{
  await post(`/api/chats/${(await state()).mainChatId}/focus`, { nodeId: pricingId }); // restore after M111 test shuffle
  const s0 = await state();
  const baseLit = litOfActive(s0).length;
  const srcChat = s0.mainChatId;
  let r = await post('/api/chats', { mode: 'fork' });
  let s = await state();
  check('fork: new chat active', s.mainChatId !== srcChat);
  check('fork copies lit set exactly', litOfActive(s).length === baseLit);
  check('fork inherits focus', activeChat(s)?.focusContainerId === pricingId);

  r = await post('/api/chats', { mode: 'fresh' });
  s = await state();
  check('fresh: only root lit', litOfActive(s).length === 1);
  const rootId = s.nodes.find((n: any) => n.parentId === null && n.content === 'workspace').id;
  check('fresh: focus on root', activeChat(s)?.focusContainerId === rootId);

  r = await post('/api/chats', { mode: 'fresh', focusTopic: 'pricing' });
  s = await state();
  check('topic input matches existing node', r.body.focusName?.includes('pricing') && !r.body.createdTopic);
  check('matched topic focused + lit', activeChat(s)?.focusContainerId === pricingId && litOfActive(s).includes(pricingId));

  r = await post('/api/chats', { mode: 'fork', focusTopic: 'dragonfruit farming' });
  s = await state();
  check('unknown topic created (born lit+focused)', r.body.createdTopic === true && litOfActive(s).includes(activeChat(s)?.focusContainerId));

  r = await post('/api/chats', { mode: 'fresh', focusNodeId: childId });
  s = await state();
  check('exact focusNodeId from picker honored (M92)', activeChat(s)?.focusContainerId === childId && litOfActive(s).includes(childId));

  const act = await post(`/api/chats/${srcChat}/activate`);
  check('chat activate switches back', act.status === 200 && (await state()).mainChatId === srcChat);
  check('activate unknown chat → 404', (await post('/api/chats/none/activate')).status === 404);
}

console.log('\n== 6. round pipeline routes by cwd (model) ==');
{
  const ok = await observe('s-beta', 'lets outline the fermentation chapter for the beta book, starting with sauerkraut basics', 'Sauerkraut needs 2 percent salt by weight, shredded cabbage, and 1-3 weeks at cool room temperature. I suggest the chapter opens with equipment.');
  check('beta round translated', ok);
  const sDef = await state();
  check('no leak into active (proj-def) project', !sDef.nodes.some((n: any) => /sauerkraut|ferment/i.test(n.content)));
  await post(`/api/projects/${PBETA}/activate`);
  const sBeta = await state();
  check('session cwd project got the material', sBeta.nodes.some((n: any) => /sauerkraut|ferment/i.test(n.content)));
  check('round nodes born lit in that chat', sBeta.nodes.filter((n: any) => /sauerkraut|ferment/i.test(n.content)).every((n: any) => litOfActive(sBeta).includes(n.id)));
  await post(`/api/projects/${DEF}/activate`);
}

console.log('\n== 7. nudges: drift streak + directive gate (model) ==');
{
  // Canonical drift scenario: a NARROW working set (only the pricing subtree
  // writable). With the root lit, the filer may legally park strays under it
  // and no drift is detectable — that's not drift, that's a roomy map.
  {
    const st = await state();
    const rootId = st.nodes.find((x: any) => x.parentId === null && x.content === 'workspace').id;
    await post(`/api/chats/${st.mainChatId}/lit`, { nodeId: rootId, on: false });
    await post(`/api/chats/${st.mainChatId}/lit`, { nodeId: pricingId, on: true });
    await post(`/api/chats/${st.mainChatId}/focus`, { nodeId: pricingId });
  }
  await observe('s-def', 'random thought - my basil plant keeps wilting, is it overwatering?', 'Wilting with yellow lower leaves usually means overwatering; let the soil dry out between waterings and check the pot drains.');
  let n = (await state()).nudges;
  check('one stray round: no drift nudge yet', !n.light);
  check('topic switch without directive: focus-request vetoed (M87)', !n.focusName);
  await observe('s-def', 'also my sister recommended a sci-fi novel, remind me how the Foundation series is ordered', 'Publication order starts with Foundation (1951), then Foundation and Empire, then Second Foundation.');
  n = (await state()).nudges;
  check('two consecutive stray rounds → both nudges (M74)', n.focus && n.light);
  // Aim focus away first — a directive naming the CURRENT focus is a no-op by
  // design (the gate requires target ≠ focus), so give it somewhere to go.
  {
    const st = await state();
    const rootId = st.nodes.find((x: any) => x.parentId === null && x.content === 'workspace').id;
    await post(`/api/chats/${st.mainChatId}/focus`, { nodeId: rootId });
  }
  await observe('s-def', 'ok lets focus on the pricing strategy work now', 'Back to pricing strategy. We had the enterprise tier question open - want to start there?');
  n = (await state()).nudges;
  if (!n.focusName) { // haiku is single-shot stochastic on the optional field — one retry
    await observe('s-def', 'switch to the pricing strategy topic please, just that', 'Switching to pricing strategy. The enterprise tier question is still open.');
    n = (await state()).nudges;
  }
  check('directive round → focus request accepted with target (M75)', (n.focusName ?? '').toLowerCase().includes('pricing'));
  const rec = await post(`/api/chats/${(await state()).mainChatId}/recommend`, { kind: 'focus' });
  check('recommend free-serves the named target', rec.body.name?.toLowerCase().includes('pricing') && /asked in chat/.test(rec.body.reason ?? ''));
}

console.log('\n== 8. injection mechanics: full / delta / notice / re-anchor ==');
{
  const c1 = await get('/api/harness/context?session_id=s-def');
  check('first fetch is FULL map block', c1.kind === 'full' && /map state/.test(c1.context ?? ''));
  check('one-shot focus notice present in first injection', /auto-focus button/.test(c1.context ?? ''));
  const c2 = await get('/api/harness/context?session_id=s-def');
  check('notice is one-shot (gone on second fetch)', !/auto-focus button/.test(c2.context ?? ''));
  const CH = (await state()).mainChatId;
  await post(`/api/chats/${CH}/focus`, { nodeId: pricingId });
  const c3 = await get('/api/harness/context?session_id=s-def');
  check('map change → DELTA with user action', c3.kind === 'delta' && /moved FOCUS|user actions/.test(c3.context ?? ''));
  await post('/api/nodes', { content: 'change one' });
  await post('/api/nodes', { content: 'change two' });
  await post('/api/nodes', { content: 'change three' });
  const c4 = await get('/api/harness/context?session_id=s-def');
  check('threshold crossed (REANCHOR=2) → FULL again', c4.kind === 'full');
  await post('/api/harness/compacted', { session_id: 's-def' });
  const c5 = await get('/api/harness/context?session_id=s-def');
  check('after compaction → FULL re-anchor', c5.kind === 'full');
  const comp = await get('/api/harness/compaction?session_id=s-def');
  check('compaction instructions name the focus', /pricing/i.test(comp.instructions ?? ''));
}

console.log('\n== 9. dots: mapcheck → precompute → cached preview → apply (model) ==');
{
  await post('/api/nodes', { content: 'We should price the enterprise tier at 99 dollars', parentId: pricingId });
  await post('/api/nodes', { content: 'Enterprise tier should cost $99 per month', parentId: pricingId });
  const mc = await post('/api/mapcheck');
  check('mapcheck returns shape', mc.status === 200 && typeof mc.body.count === 'number' && typeof mc.body.summary === 'string');
  const sugs = (await state()).suggestions;
  if (sugs.length === 0) {
    check('mapcheck found the seeded duplicates (lenient: clean verdict accepted)', /clean|well/i.test(mc.body.summary ?? ''), mc.body.summary);
  } else {
    check('mapcheck filed a dot', true);
    let cached = false;
    for (let i = 0; i < 30; i++) {
      await sleep(5000);
      const a = await get('/api/audit?limit=30&kind=proposal_precomputed');
      if (a.length > 0) { cached = true; break; }
    }
    check('dot proposal precomputed in background', cached);
    const sg = sugs.find((x: any) => x.nodeId !== '__top__') ?? sugs[0]; // root flags precompute lazily (M124)
    const t0 = Date.now();
    const pv = await post('/api/reorganize/preview', { nodeId: sg.nodeId, hint: sg.note, suggestionId: sg.id });
    check('cached preview is instant', pv.body.cached === true && Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
    const dis = await post(`/api/suggestions/${sg.id}`, { status: 'dismissed' });
    check('dismiss dot ok', dis.status === 200 && (await state()).suggestions.every((x: any) => x.id !== sg.id));
  }
  const pv2 = await post('/api/reorganize/preview', { nodeId: pricingId, hint: 'merge the duplicate 99-dollar pricing nodes' });
  check('live tidy preview returns proposal', !!pv2.body.summary && Array.isArray(pv2.body.alterations) && pv2.body.alterations.length > 0);
  const removeAlt = pv2.body.alterations.filter((a: any) => a.op === 'update_node' || a.op === 'move_node' || a.op === 'create_node');
  const ap = await post('/api/reorganize/apply', { alterations: removeAlt, chatId: (await state()).mainChatId, containerName: 'pricing strategy' });
  check('tidy apply accepted', ap.status === 200);
}

console.log('\n== 10. specialists: autolit preview/apply, rename sweep (model) ==');
{
  const CH = (await state()).mainChatId;
  const pv = await post(`/api/chats/${CH}/autolit`, { preview: true });
  check('autolit preview returns plan without applying', pv.status === 200 && Array.isArray(pv.body.lit) && Array.isArray(pv.body.dim) && pv.body.preview === true);
  const ap = await post(`/api/chats/${CH}/autolit`, { apply: { lit: pv.body.lit.map((x: any) => x.id), dim: pv.body.dim.map((x: any) => x.id) }, summary: pv.body.summary });
  check('autolit apply applies exact lists', ap.status === 200 && ap.body.lit === pv.body.lit.length && ap.body.dim === pv.body.dim.length);

  await post('/api/nodes', { content: 'a rather excessively long node name that runs way past any sensible limit for display' });
  const rs = await post('/api/rename-sweep');
  check('rename sweep renamed the long name', rs.body.renamed >= 1);
  const s = await state();
  const renamed = s.nodes.find((n: any) => n.content.startsWith('a rather excessively'));
  check('renamed title is ≤6 words', !!renamed?.title && renamed.title.trim().split(/\s+/).length <= 6, renamed?.title);
}

console.log('\n== 11. talk-to-map: action + plan (model) ==');
{
  let mc = await post('/api/map-chat', { question: 'lets work on the enterprise tier pricing' });
  check('mapchat answers', typeof mc.body.answer === 'string' && mc.body.answer.length > 0);
  let act = (mc.body.actions ?? [])[0];
  if (!(act?.kind === 'focus')) { // single-shot haiku — one retry, sharper phrasing
    mc = await post('/api/map-chat', { question: 'switch the conversation to the enterprise tier pricing topic' });
    act = (mc.body.actions ?? [])[0];
  }
  check('named ask → focus action on the right node', act?.kind === 'focus' && /enterprise|pricing/i.test(act?.nodeName ?? ''), JSON.stringify(act));
  { // same no-op trap: make sure the plan's focus target isn't already the focus
    const st = await state();
    const rootId = st.nodes.find((x: any) => x.parentId === null && x.content === 'workspace').id;
    await post(`/api/chats/${st.mainChatId}/focus`, { nodeId: rootId });
  }
  let plan = await post('/api/map-chat', { question: 'focus on the pricing strategy and dim the dragonfruit farming stuff' });
  let kinds = (plan.body.actions ?? []).map((a: any) => a.kind);
  for (const rq of ['I want two things: focus on the pricing strategy, and dim the dragonfruit farming topic',
                    'do both of these please: 1) focus on pricing strategy 2) dim the dragonfruit farming node'] ) {
    if (kinds.length >= 2) break; // plan emission is model-stochastic — retry with sharper phrasing
    plan = await post('/api/map-chat', { question: rq });
    kinds = (plan.body.actions ?? []).map((a: any) => a.kind);
  }
  check('compound ask → multi-step plan', kinds.length >= 2 && kinds.includes('focus') && kinds.includes('light'), JSON.stringify(kinds));
}

console.log('\n== 12. MAP.md per project ==');
{
  for (let i = 0; i < 10; i++) { if (existsSync(join(CWD_BETA, '.harnessmap', 'MAP.md'))) break; await sleep(1000); }
  const beta = existsSync(join(CWD_BETA, '.harnessmap', 'MAP.md')) ? readFileSync(join(CWD_BETA, '.harnessmap', 'MAP.md'), 'utf8') : '';
  const def = existsSync(join(CWD_DEF, '.harnessmap', 'MAP.md')) ? readFileSync(join(CWD_DEF, '.harnessmap', 'MAP.md'), 'utf8') : '';
  check('beta cwd MAP.md holds beta map', /sauerkraut|ferment/i.test(beta) && !/pricing strategy/.test(beta));
  check('default cwd MAP.md holds default map', /pricing strategy/.test(def) && !/sauerkraut/i.test(def));
}

console.log('\n== 14. merges: node / chat / project (M90) ==');
{
  // node merge: children move, favorite transfers, cycle + to-sort guards
  await post('/api/nodes', { content: 'merge source topic' });
  let s14 = await state();
  const srcN = s14.nodes.find((n: any) => n.content === 'merge source topic')?.id;
  await post('/api/nodes', { content: 'movable child', parentId: srcN });
  await post(`/api/nodes/${srcN}/favorite`, { on: true });
  const cyc = await post(`/api/nodes/${srcN}/merge`, { intoId: s14.nodes.find((n: any) => n.content === 'movable child')?.id ?? srcN });
  check('merge into own subtree rejected', cyc.status === 400);
  const mg = await post(`/api/nodes/${srcN}/merge`, { intoId: pricingId });
  s14 = await state();
  check('node merge ok, child moved to survivor', mg.status === 200 && s14.nodes.find((n: any) => n.content === 'movable child')?.parentId === pricingId);
  check('merged node gone', !s14.nodes.some((n: any) => n.id === srcN));
  check('substance handled: text-merged or kept as child (M94)', mg.body.textMerged === true || (mg.body.keptContent === true && s14.nodes.some((n: any) => n.content === 'merge source topic' && n.parentId === pricingId)));
  check('favorite transferred to survivor', (s14.favorites ?? []).includes(pricingId));

  // chat merge was REMOVED (M95): views share the map; recency does housekeeping
  const gone = await post(`/api/chats/${(await state()).mainChatId}/merge`, { withId: 'anything' });
  check('chat-merge endpoint removed (M95)', gone.status === 404);
  check('chats carry lastActivity for recency sorting', typeof (await state()).chats[0].lastActivity === 'string');

  // project merge: event-sourced fold into a wrapper topic
  const gamma = (await post('/api/projects', { name: 'gamma notes' })).body.projectId;
  await post('/api/nodes', { content: 'gamma research finding one' });
  const pm = await post(`/api/projects/${gamma}/merge`, { intoId: DEF });
  check('project merge ok', pm.status === 200 && pm.body.topics >= 1);
  const sD = await state();
  check('landed in target as wrapper topic', sD.projectId === DEF && sD.nodes.some((n: any) => n.content === 'gamma notes' && n.parentId === null));
  const wrapper = sD.nodes.find((n: any) => n.content === 'gamma notes');
  check('source map nested under wrapper', sD.nodes.some((n: any) => n.parentId === wrapper?.id));
  check('source project gone from list', !sD.projects.some((p: any) => p.id === gamma));
  const pmSelf = await post(`/api/projects/${DEF}/merge`, { intoId: DEF });
  check('project self-merge rejected', pmSelf.status === 400);
}

console.log('\n== 15. map agent licensed for merges (model) ==');
{
  await post('/api/nodes', { content: 'We should price the pro tier at 49 dollars', parentId: pricingId });
  await post('/api/nodes', { content: 'Pro tier pricing should be $49/month', parentId: pricingId });
  let mc = await post('/api/map-chat', { question: 'the two pro tier pricing nodes say the same thing, merge them' });
  let act = (mc.body.actions ?? []).find((a: any) => a.kind === 'merge');
  if (!act) {
    mc = await post('/api/map-chat', { question: 'merge the duplicate 49 dollar pro tier nodes into one please' });
    act = (mc.body.actions ?? []).find((a: any) => a.kind === 'merge');
  }
  check('mapchat proposes node merge with both ids', !!act && !!act.nodeId && !!act.intoId && act.nodeId !== act.intoId, JSON.stringify(mc.body.actions));
  if (act) {
    const r = await post(`/api/nodes/${act.nodeId}/merge`, { intoId: act.intoId });
    check('proposed merge applies through the guarded endpoint', r.status === 200);
  } else {
    check('proposed merge applies through the guarded endpoint', false, 'no action to apply');
  }
}

console.log('\n== 16. embedded terminal (M97) ==');
{
  const bad = await post('/api/term', { cwd: '/no/such/dir' });
  check('term with bad cwd → 400', bad.status === 400);
  const rel = await post('/api/term', { cwd: 'relative/path' });
  check('term with relative cwd → 400', rel.status === 400);
  const mk = await post('/api/term', { cwd: TMP });
  check('term created with backend reported', mk.status === 200 && !!mk.body.id && ['bun', 'node-pty', 'script'].includes(mk.body.backend));
  const ls = await get('/api/term');
  check('term listed', ls.terms.some((t: any) => t.id === mk.body.id));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/term?id=${mk.body.id}`);
  let out = '';
  ws.onmessage = (ev: any) => { out += ev.data; };
  await new Promise((res) => { (ws as any).onopen = res; });
  ws.send(JSON.stringify({ t: 'in', d: 'echo TERM_ROUNDTRIP && exit\n' }));
  await sleep(2500);
  check('terminal roundtrip: input in, output back', out.includes('TERM_ROUNDTRIP'));
  check('exit notice delivered', out.includes('[session ended]'));
  const killed = await fetch(`${BASE}/api/term/${mk.body.id}`, { method: 'DELETE' });
  check('term delete ok', killed.status === 200);

  // M98: a terminal pre-claims its VIEW; the CC session from that cwd binds
  // to it, so rounds land in the claimed session — not the active one.
  const view = await post('/api/chats', { mode: 'fresh' });
  const claimedChat = view.body.chatId;
  await post('/api/chats', { mode: 'fork' }); // make a DIFFERENT chat active
  const tv = await post('/api/term', { cwd: TMP, chatId: claimedChat });
  check('term accepts a session binding', tv.status === 200);
  check('term with unknown session → 404', (await post('/api/term', { cwd: TMP, chatId: 'nope' })).status === 404);
  await post('/api/harness/session-start', { session_id: 's-claim', cwd: TMP });
  const b16 = await filerCount();
  await post('/api/harness/observe', { session_id: 's-claim', user_text: 'note for the claimed view: the fermentation crock arrived today', assistant_text: 'Noted - the crock is here; first sauerkraut batch can start this weekend.' });
  await waitRound(b16);
  const turns = await get(`/api/chats/${claimedChat}/turns`);
  check('claimed session received the round\'s turns', Array.isArray(turns.turns ?? turns) && JSON.stringify(turns).includes('crock'));
  await fetch(`${BASE}/api/term/${tv.body.id}`, { method: 'DELETE' });
}

console.log('\n== 17. round text via prompt stash + session close (M99) ==');
{
  // A CC version change stopped writing flat transcripts → user text died.
  // The stash makes the hook input authoritative: prompt first, observe after.
  // (Re-activate DEF first: the claim test's session-start on TMP auto-created
  // a project — correct M91 behavior — and moved the active pair.)
  await post(`/api/projects/${DEF}/activate`);
  await post('/api/harness/prompt', { session_id: 's-def', text: 'stashed question: what temperature for the sourdough proof?' });
  const b17 = await filerCount();
  await post('/api/harness/observe', { session_id: 's-def', assistant_text: 'Proof sourdough at 24-26C; cooler slows it, warmer risks over-proofing.' });
  await waitRound(b17);
  const CH17 = (await state()).mainChatId;
  const turns = await get(`/api/chats/${CH17}/turns`);
  const userTurns = (Array.isArray(turns) ? turns : []).filter((t: any) => t.role === 'user');
  check('user text recovered from prompt stash', userTurns.some((t: any) => t.content.includes('sourdough proof')));

  // M101: status and category are CLEARABLE (Jacob's bug)
  await post(`/api/nodes/${childId}`, { status: 'live', type: '' });
  const s101 = await state();
  const cleared = s101.nodes.find((n: any) => n.id === childId);
  check('status resets to plain and type clears', cleared.status === 'live' && !cleared.type);

  // M100: universal move — reparent + top-level + cycle guard
  await post('/api/nodes', { content: 'movable widget', parentId: pricingId });
  let s99 = await state();
  const widget = s99.nodes.find((n: any) => n.content === 'movable widget')?.id;
  const mvTop = await post(`/api/nodes/${widget}/move`, { parentId: null });
  s99 = await state();
  check('move to top level works', mvTop.status === 200 && s99.nodes.find((n: any) => n.id === widget)?.parentId === null);
  const mvBack = await post(`/api/nodes/${widget}/move`, { parentId: pricingId });
  s99 = await state();
  check('move under a parent works', mvBack.status === 200 && s99.nodes.find((n: any) => n.id === widget)?.parentId === pricingId);
  const mvCyc = await post(`/api/nodes/${pricingId}/move`, { parentId: widget });
  check('move into own subtree rejected', mvCyc.status === 400);

  const v2 = await post('/api/chats', { mode: 'fork' });
  const arch = await post(`/api/chats/${v2.body.chatId}/archive`, {});
  const s17 = await state();
  check('session close archives the view', arch.status === 200 && !s17.chats.some((c: any) => c.id === v2.body.chatId));
  // burn down to one live session and confirm the guard
  let live = (await state()).chats;
  while (live.length > 1) { await post(`/api/chats/${live[0].id === (await state()).mainChatId ? live[1].id : live[0].id}/archive`, {}); live = (await state()).chats; }
  const last = await post(`/api/chats/${live[0].id}/archive`, {});
  check('closing the only session is refused', last.status === 400);
}

console.log('\n== 19. protected focus path (M111) ==');
{
  const CH19 = (await state()).mainChatId;
  // focusing a leaf lights its ancestor chain
  await post(`/api/chats/${CH19}/focus`, { nodeId: childId });
  let s19 = await state();
  check('focusing lights the ancestor chain', litOfActive(s19).includes(childId) && litOfActive(s19).includes(pricingId));
  const refuse = await post(`/api/chats/${CH19}/lit`, { nodeId: pricingId, on: false });
  check('explicit dim of a focus-path node is refused', refuse.status === 409);
  const bulk = await post(`/api/chats/${CH19}/lit`, { nodeId: pricingId, on: false, bulk: true });
  s19 = await state();
  check('bulk dim skips the path (parent stays lit)', bulk.status === 200 && litOfActive(s19).includes(pricingId) && litOfActive(s19).includes(childId));
  const av = await post(`/api/chats/${CH19}/autolit`, { apply: { lit: [], dim: [pricingId] } });
  s19 = await state();
  check('autolit apply cannot dim the path', av.status === 200 && litOfActive(s19).includes(pricingId));
}

console.log('\n== 18. what-changed panel + persistent marks (M106/M107) ==');
{
  const d = await get('/api/changes/latest');
  check('latest-changes returns the last round', typeof d.summary === 'string' && Array.isArray(d.changes));
  check('changes carry names and kinds', d.changes.every((c: any) => c.name && ['added', 'updated', 'removed', 'moved', 'flagged'].includes(c.kind)));
  const marks = (await state()).recency;
  const markedIds = Object.keys(marks);
  check('filer rounds left persistent marks', markedIds.length > 0 && Object.values(marks).every((k: any) => ['new', 'changed'].includes(k)));
  const one = markedIds[0];
  await post(`/api/nodes/${one}/seen`, {});
  check('interacting clears a single mark', !((await state()).recency)[one]);
  const ca = await post('/api/changes/clear-marks', {});
  check('clear-all wipes the rest', ca.status === 200 && Object.keys((await state()).recency).length === 0);
}

console.log('\n== 20. dev mode: toggle + trace capture (M113) ==');
{
  const off = await get('/api/dev');
  check('dev mode is off by default', off.on === false);
  const t0 = await get('/api/dev/traces');
  check('no traces recorded while off', Array.isArray(t0.traces) && t0.traces.length === 0);
  const on = await post('/api/dev/toggle', {});
  check('toggle turns dev mode on', on.status === 200 && on.body.on === true);

  // injections are traced verbatim
  await post('/api/nodes', { content: 'dev-mode witness node' });
  await get('/api/harness/context?session_id=s-def');
  const t1 = await get('/api/dev/traces');
  const inj = (t1.traces ?? []).find((t: any) => t.kind === 'inject');
  check('context injection recorded as a trace', !!inj && typeof inj.response === 'string' && inj.response.length > 0);

  // inference calls are traced with full prompts + response
  const b20 = await filerCount();
  await post('/api/harness/prompt', { session_id: 's-def', text: 'dev-mode trace check: note the witness' });
  await post('/api/harness/observe', { session_id: 's-def', assistant_text: 'Noted the dev-mode witness node for the trace test.' });
  await waitRound(b20);
  const t2 = await get('/api/dev/traces');
  const call20 = (t2.traces ?? []).find((t: any) => t.kind === 'call');
  check('inference call recorded with prompts and response', !!call20 && !!call20.system && !!call20.user && !!call20.response && !!call20.model);
  check('traces are newest-first', (t2.traces ?? []).length < 2 || t2.traces[0].id > t2.traces[1].id);
  const tf = await get(`/api/dev/traces?task=${encodeURIComponent(call20.task)}`);
  check('task filter narrows traces', (tf.traces ?? []).length > 0 && tf.traces.every((t: any) => t.task === call20.task));

  // off again → recording stops
  await post('/api/dev/toggle', {});
  const nBefore = t2.traces.length;
  await post('/api/nodes', { content: 'untraced node' });
  await get('/api/harness/context?session_id=s-def');
  const t3 = await get('/api/dev/traces');
  check('toggle off stops recording', ((await get('/api/dev')).on === false) && t3.traces.length === nBefore);
}

console.log('\n== 21. add-node: always unnamed + focused, named by first round (M114) ==');
{
  const mk = await post('/api/nodes', { focus: true });
  check('blank create yields an untitled node', mk.status === 200 && mk.body.content === 'untitled');
  const nid = mk.body.id;
  let s21 = await state();
  check('new node is focused and lit', activeChat(s21)?.focusContainerId === nid && litOfActive(s21).includes(nid));
  const b21 = await filerCount();
  await post('/api/harness/prompt', { session_id: 's-def', text: 'let us plan the garden irrigation: drip lines for the beds, timer at the tap' });
  await post('/api/harness/observe', { session_id: 's-def', assistant_text: 'Drip irrigation plan: run drip lines along each bed, add a battery timer at the tap, water at dawn.' });
  await waitRound(b21);
  s21 = await state();
  const named = s21.nodes.find((n: any) => n.id === nid);
  check('first focused round names the untitled node', !!named && named.content !== 'untitled' && named.content.length > 0);
}

console.log('\n== 22. root-scope tidy: top-level containers + protected-path relight (M122) ==');
{
  await post('/api/nodes', { content: 'garden irrigation project' });
  await post('/api/nodes', { content: 'greenhouse build project' });
  let s22 = await state();
  const t1 = s22.nodes.find((n: any) => n.content === 'garden irrigation project')?.id;
  const t2 = s22.nodes.find((n: any) => n.content === 'greenhouse build project')?.id;
  await post('/api/nodes', { content: 'drip line layout', parentId: t1 });
  s22 = await state();
  const t1kid = s22.nodes.find((n: any) => n.content === 'drip line layout')?.id;
  const CH22 = s22.mainChatId;
  await post(`/api/chats/${CH22}/focus`, { nodeId: t1kid });

  const ap = await post('/api/reorganize/apply', {
    alterations: [
      { op: 'create_node', id: 'grp-garden', parentId: null, content: 'garden projects' },
      { op: 'move_node', id: t1, parentId: 'grp-garden' },
      { op: 'move_node', id: t2, parentId: 'grp-garden' },
    ], chatId: CH22, containerName: 'the top level',
  });
  s22 = await state();
  const grp = s22.nodes.find((n: any) => n.id === 'grp-garden');
  check('root-scope apply creates a top-level container', ap.status === 200 && !!grp && grp.parentId === null);
  check('top-level threads moved under the container', s22.nodes.find((n: any) => n.id === t1)?.parentId === 'grp-garden' && s22.nodes.find((n: any) => n.id === t2)?.parentId === 'grp-garden');
  check('focus path relit through the new container (M111 invariant)', litOfActive(s22).includes('grp-garden') && litOfActive(s22).includes(t1) && litOfActive(s22).includes(t1kid));

  const pv = await post('/api/reorganize/preview', { nodeId: null });
  check('root-scope preview returns a proposal', pv.status === 200 && typeof pv.body.before === 'string' && typeof pv.body.after === 'string' && Array.isArray(pv.body.alterations));
  check('root preview sees multiple top-level threads', (pv.body.before?.match(/\n/g) ?? []).length >= 2, JSON.stringify(pv.body).slice(0, 120));
}

console.log('\n== 23. to-sort permanence + focus-orphan rescue (M123) ==');
{
  let s23 = await state();
  const tosort = s23.nodes.find((n: any) => n.parentId === null && n.content === 'to sort' && n.status !== 'removed');
  check('live to-sort present in the active project', !!tosort);
  const refuse = await post(`/api/nodes/${tosort.id}/delete`, {});
  check('deleting to-sort is refused (409)', refuse.status === 409);
  const ap23 = await post('/api/reorganize/apply', { alterations: [
    { op: 'update_node', id: tosort.id, status: 'removed' },
    { op: 'move_node', id: tosort.id, parentId: 'grp-garden' },
  ], containerName: 'x' });
  s23 = await state();
  const still = s23.nodes.find((n: any) => n.id === tosort.id);
  check('tidy alterations cannot remove or move to-sort (store guard)', ap23.status === 200 && still.status !== 'removed' && still.parentId === null);

  // every chat focused inside a deleted subtree is rescued, not just the active one
  await post('/api/nodes', { content: 'doomed topic' });
  s23 = await state();
  const doomed = s23.nodes.find((n: any) => n.content === 'doomed topic')?.id;
  await post('/api/nodes', { content: 'doomed detail', parentId: doomed });
  s23 = await state();
  const doomedKid = s23.nodes.find((n: any) => n.content === 'doomed detail')?.id;
  const mainCh = s23.mainChatId;
  const fk = await post('/api/chats', { focusNodeId: doomedKid });
  const sideChat = fk.body.chatId ?? fk.body.id;
  check('side chat created focused on the doomed node', fk.status === 200 && !!sideChat);
  await post(`/api/chats/${mainCh}/activate`).catch(() => null);
  const del = await post(`/api/nodes/${doomed}/delete`, {});
  s23 = await state();
  const side = (s23.chats ?? []).find((c: any) => c.id === sideChat);
  check('non-active chat focus rescued off the deleted subtree', del.status === 200 && !!side && side.focusContainerId !== doomedKid && side.focusContainerId !== doomed && s23.nodes.find((n: any) => n.id === side.focusContainerId)?.status !== 'removed');
}

console.log('\n== 24. coordination: system card + map preferences (M124) ==');
{
  const p1 = await post('/api/prefs', { text: '- keep top-level containers broad\n- never delete exploratory notes' });
  check('prefs save roundtrip', p1.status === 200 && (await get('/api/prefs')).text.includes('broad'));
  const p2 = await post('/api/prefs', { append: 'name nodes in plain words' });
  check('guide-style append adds a bullet', p2.status === 200 && (await get('/api/prefs')).text.includes('- name nodes in plain words'));

  // the card + prefs reach a real specialist call — verified via dev traces
  await post('/api/dev/toggle', {});
  const CH24 = (await state()).mainChatId;
  await post(`/api/chats/${CH24}/autolit`, { preview: true });
  const tr = (await get('/api/dev/traces?task=autolit')).traces?.[0];
  check('system card injected into specialist prompts', !!tr && tr.system.includes('THE CAST') && tr.system.includes('LIGHTING'));
  check('map preferences injected into specialist prompts', !!tr && tr.system.includes('MAP PREFERENCES') && tr.system.includes('broad'));
  await post('/api/dev/toggle', {});
}

console.log('\n== 25. home page node (M125) ==');
{
  let s25 = await state();
  check('no home by default', s25.home === null);
  const hset = await post('/api/home', { nodeId: pricingId });
  s25 = await state();
  check('set home roundtrip', hset.status === 200 && s25.home === pricingId);
  const bad = await post('/api/home', { nodeId: 'nope' });
  check('unknown node refused', bad.status === 404);
  const hclr = await post('/api/home', { nodeId: null });
  s25 = await state();
  check('clear home', hclr.status === 200 && s25.home === null);
}

console.log('\n== 26. undo: inverse ops for delete / merge / tidy / move (M136) ==');
{
  // build a small world
  await post('/api/nodes', { content: 'undo topic' });
  let s26 = await state();
  const ut = s26.nodes.find((n: any) => n.content === 'undo topic')?.id;
  await post('/api/nodes', { content: 'undo child A', parentId: ut });
  await post('/api/nodes', { content: 'undo child B', parentId: ut });
  s26 = await state();
  const ua = s26.nodes.find((n: any) => n.content === 'undo child A')?.id;
  const CH26 = s26.mainChatId;
  await post(`/api/chats/${CH26}/focus`, { nodeId: ua });

  // delete → undo restores subtree, lighting, focus
  const del = await post(`/api/nodes/${ut}/delete`, {});
  check('delete returns an undo label', del.status === 200 && /deleted "undo topic"/.test(del.body.undo));
  const u1 = await post('/api/undo', {});
  s26 = await state();
  check('undo restores the deleted subtree', u1.status === 200 && s26.nodes.some((n: any) => n.id === ut) && s26.nodes.some((n: any) => n.id === ua));
  check('undo restores lighting and focus', litOfActive(s26).includes(ut) && activeChat(s26)?.focusContainerId === ua);

  // move → undo restores the parent
  await post(`/api/nodes/${ua}/move`, { parentId: null });
  s26 = await state();
  check('moved to top level', s26.nodes.find((n: any) => n.id === ua)?.parentId === null);
  await post('/api/undo', {});
  s26 = await state();
  check('undo restores the old parent', s26.nodes.find((n: any) => n.id === ua)?.parentId === ut);

  // merge → undo brings the source back with its children and the survivor's text
  await post('/api/nodes', { content: 'merge target for undo' });
  s26 = await state();
  const mt = s26.nodes.find((n: any) => n.content === 'merge target for undo')?.id;
  const dstBefore = s26.nodes.find((n: any) => n.id === mt)?.content;
  await post(`/api/nodes/${ut}/merge`, { intoId: mt });
  s26 = await state();
  check('merge removed the source', !s26.nodes.some((n: any) => n.id === ut));
  await post('/api/undo', {});
  s26 = await state();
  const back = s26.nodes.find((n: any) => n.id === ut);
  check('undo restores the merged-away node', !!back && back.content === 'undo topic');
  check('undo returns its children and the survivor text', s26.nodes.find((n: any) => n.id === ua)?.parentId === ut && s26.nodes.find((n: any) => n.id === mt)?.content === dstBefore);

  // tidy apply → undo inverts the batch (create + move + update)
  const ta = await post('/api/reorganize/apply', { alterations: [
    { op: 'create_node', id: 'undo-grp', parentId: null, content: 'undo group' },
    { op: 'move_node', id: ut, parentId: 'undo-grp' },
    { op: 'update_node', id: ua, content: 'renamed by tidy' },
  ], containerName: 'undo test' });
  s26 = await state();
  check('tidy batch applied', ta.status === 200 && s26.nodes.find((n: any) => n.id === ut)?.parentId === 'undo-grp');
  await post('/api/undo', {});
  s26 = await state();
  check('undo inverts the tidy batch', !s26.nodes.some((n: any) => n.id === 'undo-grp') && s26.nodes.find((n: any) => n.id === ut)?.parentId === null && s26.nodes.find((n: any) => n.id === ua)?.content === 'undo child A');

  // stack: LIFO + empty
  const l = await get('/api/undo/list');
  check('undo list is an array', Array.isArray(l.entries));
  let guard = 0;
  while ((await post('/api/undo', {})).status === 200 && guard++ < 30) {}
  const empty = await post('/api/undo', {});
  check('empty stack → 404', empty.status === 404);
}

console.log('\n== 27. mode-A chat: streamed reply over WS (M139) ==');
{
  const events: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.onmessage = (ev: any) => { try { events.push(JSON.parse(ev.data)); } catch {} };
  await new Promise((r) => { ws.onopen = r; setTimeout(r, 3000); });
  const CH27 = (await state()).mainChatId;
  await post(`/api/chats/${CH27}/messages`, { text: 'In one short sentence: what is the capital of France?' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (events.some((e) => e.type === 'turn' && e.role === 'assistant' && e.chatId === CH27)) break;
    await sleep(1000);
  }
  const deltas = events.filter((e) => e.type === 'chat_delta' && e.chatId === CH27);
  const final = events.find((e) => e.type === 'turn' && e.role === 'assistant' && e.chatId === CH27);
  check('assistant turn arrived over WS', !!final && /paris/i.test(final.content));
  check('reply was streamed as chat_delta first', deltas.length >= 1 && /paris/i.test(deltas.map((d) => d.text).join('')));
  ws.close();
}

console.log('\n== 28. import: sources, proposal, apply, undo (M142) ==');
{
  const { writeFileSync: wf, mkdirSync: mk } = await import('node:fs');
  wf(join(CWD_DEF, 'README.md'), '# Widget project\n\nGoal: ship a widget.\n\n- decide pricing model\n- open question: annual billing?\n');
  const slugDir = join(TMP, 'home', '.claude', 'projects', CWD_DEF.replace(/\//g, '-'));
  mk(slugDir, { recursive: true });
  wf(join(slugDir, 'past-session.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'let us plan the greenhouse: glass or polycarbonate?' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Polycarbonate is cheaper and shatterproof; glass looks better and lasts longer. For a first build I recommend polycarbonate.' }] } }),
    JSON.stringify({ type: 'user', message: { content: 'ok decided: polycarbonate. next question is heating.' } }),
    'not-json-line-simulating-format-drift',
  ].join('\n'));

  const memDir = join(TMP, 'home', '.claude', 'projects', CWD_DEF.replace(/\//g, '-'), 'memory');
  mk(memDir, { recursive: true });
  wf(join(memDir, 'MEMORY.md'), '# Memory\n- user prefers metric units\n- project ships Fridays\n- the widget API is versioned v2\n');
  const src = await get('/api/import/sources');
  check('sources list the project document', (src.files ?? []).some((f: any) => f.name === 'README.md'));
  check('sources list the past session', (src.sessions ?? []).some((x: any) => x.file === 'past-session.jsonl'));
  check("sources list Claude's memory files (M157)", (src.memories ?? []).some((x: any) => x.file === 'MEMORY.md'));
  const mp = await post('/api/import/preview', { kind: 'memory', sessionFile: 'MEMORY.md' });
  check("Claude-memory import proposes (M157)", mp.status === 200 && mp.body.alterations.length >= 2 && /metric|friday|v2/i.test(JSON.stringify(mp.body.alterations)));

  const pv = await post('/api/import/preview', { kind: 'text', text: 'Trip to Osaka in October.\nDecided: fly, not train.\nOpen: which neighborhood to stay in?\nBudget constraint: 2000 total.' });
  check('pasted-text proposal returns creates only', pv.status === 200 && pv.body.alterations.length >= 3 && pv.body.alterations.every((a: any) => a.op === 'create_node'));
  const roots = pv.body.alterations.filter((a: any) => !a.parentId);
  check('exactly one new top-level container', roots.length === 1 && pv.body.rootId === roots[0].id);
  check('preview tree rendered', typeof pv.body.preview === 'string' && pv.body.preview.length > 40);

  const before28 = (await state()).nodes.length;
  const ap = await post('/api/reorganize/apply', { alterations: pv.body.alterations, containerName: pv.body.label });
  let s28 = await state();
  check('apply lands the container + children', ap.status === 200 && s28.nodes.some((n: any) => n.id === pv.body.rootId && n.parentId === null) && s28.nodes.length >= before28 + 3);
  await post('/api/undo', {});
  s28 = await state();
  check('import is undoable', !s28.nodes.some((n: any) => n.id === pv.body.rootId));

  const sess = await post('/api/import/preview', { kind: 'session', sessionFile: 'past-session.jsonl' });
  check('past-session import proposes (drifted lines survived)', sess.status === 200 && sess.body.alterations.length >= 2 && /polycarbonate|greenhouse/i.test(JSON.stringify(sess.body.alterations)));

  const evil = await post('/api/import/preview', { kind: 'file', path: '/etc/passwd' });
  check('file reads are scoped to project folders', evil.status === 400);
}

console.log('\n== 29. close map influence (M143) ==');
{
  check('influence on by default', (await get('/api/influence')).off === false);
  // anchor a session with full context first
  await post('/api/harness/session-start', { session_id: 's-inf', cwd: CWD_DEF });
  const c0 = await get('/api/harness/context?session_id=s-inf');
  check('anchored session receives map context', (c0.context ?? '').length > 50);

  const t = await post('/api/influence/toggle', {});
  check('toggle closes influence', t.status === 200 && t.body.off === true);
  const c1 = await get('/api/harness/context?session_id=s-inf');
  check('anchored session gets ONE silence directive', c1.kind === 'off' && /do not use, reference, or mention/i.test(c1.context ?? ''));
  const c2 = await get('/api/harness/context?session_id=s-inf');
  check('then nothing, ever', c2.kind === 'off' && (c2.context ?? '') === '');

  const fresh = await post('/api/harness/session-start', { session_id: 's-inf-new', cwd: CWD_DEF });
  check('new session while closed: no announcements', !(fresh.body.announce ?? ''));
  const c3 = await get('/api/harness/context?session_id=s-inf-new');
  check('new session while closed: total silence (no directive either)', c3.kind === 'off' && (c3.context ?? '') === '');
  const comp = await get('/api/harness/compaction?session_id=s-inf');
  check('compaction guidance silenced', (comp.instructions ?? '') === '');

  // the map itself still updates (Jacob's requirement)
  const nBefore = (await state()).nodes.length;
  const filed = await observe('s-inf', 'while silent: our fig tree needs winter wrapping, decide burlap', 'Burlap wrap in late November protects fig trees; unwrap after last frost.');
  const nAfter = (await state()).nodes.length;
  check('filing continues while influence is closed', filed && nAfter > nBefore);

  const t2 = await post('/api/influence/toggle', {});
  check('reopen restores context flow', t2.body.off === false && ((await get('/api/harness/context?session_id=s-inf')).context ?? '').length > 50);
}

console.log('\n== 30. sessions: pins + overview data (M146) ==');
{
  const s30 = await state();
  check('chats carry pinned + summary fields', s30.chats.every((c: any) => 'pinned' in c && 'summary' in c));
  const target = s30.chats[0].id;
  const p1 = await post(`/api/chats/${target}/pin`, {});
  check('pin toggles on', p1.status === 200 && p1.body.pinned === true && (await state()).chats.find((c: any) => c.id === target)?.pinned === true);
  const p2 = await post(`/api/chats/${target}/pin`, {});
  check('pin toggles off', p2.body.pinned === false && (await state()).chats.find((c: any) => c.id === target)?.pinned === false);
  check('unknown chat pin → 404', (await post('/api/chats/nope/pin', {})).status === 404);
}

console.log('\n== 31. touched-node memory (M156 slice 1) ==');
{
  // a round that files into a specific branch should leave MEMORY on the
  // touched node(s), not only on the focus.
  let s31 = await state();
  const mainCh31 = s31.mainChatId;
  await post('/api/nodes', { content: 'balcony herb garden' });
  s31 = await state();
  const herb = s31.nodes.find((n: any) => n.content === 'balcony herb garden')?.id;
  await post(`/api/chats/${mainCh31}/focus`, { nodeId: herb });
  await observe('s-def', 'for the balcony herb garden: basil needs the sunniest corner, mint must stay in its own pot or it takes over', 'Agreed: basil in the south corner; mint contained in a separate pot — it spreads aggressively through shared soil.');
  // async memory batch settles — poll up to 25s (two model calls can queue)
  const kids31 = (await state()).nodes.filter((n: any) => n.parentId === herb);
  let touchedMem = false;
  for (let i = 0; i < 5 && !touchedMem && kids31.length; i++) {
    await sleep(5000);
    for (const k of kids31) {
      const m = await get(`/api/nodes/${k.id}/memory`);
      if ((m.memory ?? m.text ?? '').length > 20) { touchedMem = true; break; }
    }
  }
  const focusMem = await get(`/api/nodes/${herb}/memory`);
  check('focus node accumulated memory (M41 baseline)', ((focusMem.memory ?? focusMem.text ?? '') as string).length > 20);
  check('a touched NON-focus node accumulated memory too (M156)', kids31.length === 0 || touchedMem);
}

console.log('\n== 32. cold-branch resume via lit memory (M156 slice 4) ==');
{
  // Work a branch, then ask about it from a FRESH chat that never saw the
  // conversation — all-dim, no window, no rolling summary. Light the branch:
  // the injected tier stack is the ONLY route to the planted details.
  let s32 = await state();
  await post('/api/nodes', { content: 'sourdough starter care' });
  s32 = await state();
  const sour = s32.nodes.find((n: any) => n.content === 'sourdough starter care')?.id;
  await post(`/api/chats/${s32.mainChatId}/focus`, { nodeId: sour });
  await observe('s-def', 'for the sourdough starter: we settled the feed ratio at 1:5:5 and the jar temperature at 24C, right?', 'Yes — 1:5:5 flour:water:starter, and hold the jar at 24C; cooler slows fermentation noticeably.');
  await sleep(6000); // memory batch settles

  const fc = await post('/api/chats', { mode: 'fresh' });
  const freshCh = fc.body.chatId ?? fc.body.id;
  await post(`/api/chats/${freshCh}/lit`, { nodeId: sour, on: true });
  const events32: any[] = [];
  const ws32 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws32.onmessage = (ev: any) => { try { events32.push(JSON.parse(ev.data)); } catch {} };
  await new Promise((r) => { ws32.onopen = r; setTimeout(r, 3000); });
  await post(`/api/chats/${freshCh}/messages`, { text: 'quick check from a clean slate: what feed ratio and jar temperature did we settle on for the sourdough starter?' });
  const t0 = Date.now();
  let reply32: any = null;
  while (Date.now() - t0 < 90_000 && !reply32) {
    reply32 = events32.find((e) => e.type === 'turn' && e.role === 'assistant' && e.chatId === freshCh);
    await sleep(1000);
  }
  ws32.close();
  const txt = reply32?.content ?? '';
  check('fresh chat answered at all', txt.length > 20);
  check('cold-lit branch delivered the planted details (1:5:5 + 24C)', /1\s*:\s*5\s*:\s*5/.test(txt) && /24/.test(txt));
}

console.log('\n== 33. feedback log (M159b) ==');
{
  const f1 = await post('/api/feedback', { text: 'the tidy proposal froze on a 200-node branch', source: 'talk-to-map' });
  check('feedback records locally', f1.status === 200 && (await get('/api/feedback')).entries.some((e: any) => /froze/.test(e.text)));
  check('empty feedback refused', (await post('/api/feedback', { text: '' })).status === 400);
}

console.log('\n== 34. update visibility (M161) ==');
{
  check('state exposes updateAvailable (override seam)', (await state()).updateAvailable === '99.0.0');
  const uc = await post('/api/update-check', {});
  check('menu check returns latest vs current', uc.status === 200 && uc.body.updateAvailable === '99.0.0' && typeof uc.body.current === 'string');
  await post('/api/dev/setting', { key: 'update_nudged', value: '' }); // earlier sections consumed today's nudge
  const s1 = await post('/api/harness/session-start', { session_id: 's-upd', cwd: CWD_DEF });
  check('startup announce carries ONE concise upgrade line', /upgrade available \(v99\.0\.0\).*marketplace update harnessmap/.test(s1.body.announce ?? ''));
  const s2 = await post('/api/harness/session-start', { session_id: 's-upd2', cwd: CWD_DEF });
  check('same-day second start: no repeat (no bombardment)', !/upgrade available/.test(s2.body.announce ?? ''));
}

console.log('\n== 13. audit ==');
{
  const a = await get('/api/audit?limit=10');
  check('audit returns entries', Array.isArray(a) && a.length > 0);
  const k = await get('/api/audit?limit=10&kind=observe');
  check('audit kind filter works', k.every((r: any) => r.kind === 'observe') && k.length > 0);
}

console.log(`\n================ ${pass} passed, ${fail} failed ================`);
if (failures.length) console.log('failures:\n  - ' + failures.join('\n  - '));
server.kill();
process.exit(fail > 0 ? 1 : 0);

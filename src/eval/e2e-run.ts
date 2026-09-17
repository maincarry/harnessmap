// M285 (Jacob, 2026-09-15: "keep designing end to end tests in the background… iteratively without end"): the scenario
// runner behind the standing test loop. One JSON scenario = a small seeded map, a few settings, and rounds driven
// through /api/harness/observe against a REAL filer, each round followed by assertions in a tiny DSL. Mechanics
// assert exactly; the model's choices leniently (regexes, "under" relations). Run:
//   env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE bun run src/eval/e2e-run.ts src/eval/scenarios/<name>.json [--keep]
// Scenario shape: { name, seed: [{key, content, parent?}], focus?: key, dim?: [key], lit?: [key], auto?: {...},
//   rounds: [{ user, assistant, session?, then: [assertion] }] } — assertions:
//   {focusUnder: key} · {focusIs: key} · {nodeMatching: regex, under?: key, notUnder?: key} · {noNodeMatching: regex}
//   · {inToSort: regex} · {notInToSort: regex} · {lit: key} · {dark: key} · {audit: kind, matching?: regex}
//   · {noAudit: kind} · {statusOf: regex, is: status} · {countUnder: key, max: n} · {topLevelMatching: regex}
//   · {undoNext: regex} · {do: 'undo'|'focus'|'light'|'dim'|'release'|'pin', key?, depth?}
import { rmSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const file = process.argv[2]; if (!file) { console.error('usage: e2e-run.ts <scenario.json>'); process.exit(2); }
const sc = JSON.parse(readFileSync(file, 'utf8'));
const PORT = Number(process.env.E2E_PORT ?? 8792); const BASE = `http://127.0.0.1:${PORT}`;
const TMP = `/tmp/claude-1000/harnessmap-e2e-${basename(file, '.json')}${process.env.E2E_MODELS ? `-${process.env.E2E_MODELS}` : ''}`;
const DB = join(TMP, 'e2e.sqlite'); // TMP is per ensemble: a batch may run the same scenario on two ensembles at once
let pass = 0, fail = 0; const notes: string[] = [];
let softMode = false; let noted = 0; // a soft assertion ("soft": true) is a ruling the models miss by judgment: reported as NOTE, never a FAIL
const check = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else if (softMode) { noted++; console.log(`  NOTE (soft) ${name}${detail ? ` — ${detail}` : ''}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); notes.push(`${name}${detail ? ` — ${detail}` : ''}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const audit = async (kind?: string) => ((await get(`/api/audit?limit=500${kind ? `&kind=${kind}` : ''}`)) as any[]).slice().reverse();
const state = () => get('/api/state');
const chatOf = (s: any) => (s.chats ?? []).find((c: any) => c.id === s.mainChatId);
const under = (s: any, id: string, anc: string): boolean => { for (let n = (s.nodes ?? []).find((x: any) => x.id === id); n; n = (s.nodes ?? []).find((x: any) => x.id === n.parentId)) if (n.id === anc) return true; return false; };
const nameOf = (s: any, id: string) => { const n = (s.nodes ?? []).find((x: any) => x.id === id); return n ? (n.title || n.content).slice(0, 50) : id; };
const toSortOf = (s: any) => (s.nodes ?? []).find((n: any) => n.parentId === null && String(n.title ?? n.content).startsWith('to sort'));
const rx = (p: string) => new RegExp(p.replace(/^\(\?i\)/, ''), 'i'); // always case-insensitive; a leading (?i) is tolerated
const match = (s: any, n: any, p: string) => rx(p).test((n.title ?? '') + ' ' + n.content);

rmSync(TMP, { recursive: true, force: true }); mkdirSync(join(TMP, 'proj'), { recursive: true }); mkdirSync(join(TMP, 'home', '.claude'), { recursive: true });
const expand = (v: string) => String(v).replaceAll('$TMP', TMP);
for (const [rel, content] of Object.entries(sc.files ?? {})) { const fp = join(TMP, rel); mkdirSync(join(fp, '..'), { recursive: true }); writeFileSync(fp, expand(String(content))); }
if (sc.env) for (const k of Object.keys(sc.env)) sc.env[k] = expand(sc.env[k]);
try { writeFileSync(join(TMP, 'home', '.claude', '.credentials.json'), readFileSync(join(process.env.HOME ?? '', '.claude', '.credentials.json')), { mode: 0o600 }); } catch { console.warn('no subscription credentials to copy'); }
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: { ...process.env, ANTHROPIC_API_KEY: undefined as any, HARNESSMAP_INFERENCE: undefined as any, HARNESSMAP_DB: DB, HARNESSMAP_HOME: join(TMP, 'home', '.harnessmap'), PORT: String(PORT), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1', HOME: join(TMP, 'home'), ...(sc.env ?? {}) }, // a scenario may set server env (e.g. the review rhythm)
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
let up = false; for (let i = 0; i < 30; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
if (!up) { console.error('server never came up'); process.exit(1); }

// M294 (Jacob: "test the product under different model settings… low med high ensemble"): E2E_MODELS=low|mid|high sets every
// role's model before the run; the summary line names the ensemble so the ledger shows where they diverge.
const ENSEMBLE = (process.env.E2E_MODELS ?? 'mid') as 'low' | 'mid' | 'high';
const ENSEMBLES: Record<string, Record<string, string>> = {
  low: { 'per-turn': 'claude-haiku-4-5', 'on-demand': 'claude-haiku-4-5' },
  mid: { 'per-turn': '', 'on-demand': '' }, // the defaults
  high: { 'per-turn': 'claude-sonnet-4-6', 'on-demand': 'claude-opus-4-8' },
};
for (const [g, m] of Object.entries(ENSEMBLES[ENSEMBLE] ?? {})) await post('/api/models', { task: `group:${g}`, model: m });
console.log(`\n== ${sc.name} == [models: ${ENSEMBLE}]`);
let s = await state();
const keys: Record<string, string> = {};
const rootTop = (s.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
for (const n of sc.seed ?? []) {
  const parent = n.parent ? keys[n.parent] : (n.top ? null : rootTop?.id ?? null);
  const r = await post('/api/nodes', { content: n.content, parentId: parent });
  keys[n.key] = r.body.id;
  if (n.type || n.status) await post(`/api/nodes/${r.body.id}`, { ...(n.type ? { type: n.type } : {}), ...(n.status ? { status: n.status } : {}) }); // a seed may set the category and status the card would
}
s = await state(); const cid = () => chatOf(s).id;
if (sc.focus) await post(`/api/chats/${cid()}/focus`, { nodeId: keys[sc.focus] });
for (const k of sc.dim ?? []) await post(`/api/chats/${cid()}/lit`, { nodeId: keys[k], on: false });
for (const k of sc.lit ?? []) await post(`/api/chats/${cid()}/lit`, { nodeId: keys[k], on: true });
if (sc.auto) await post('/api/auto', sc.auto);
// clear the seed's own undo entries from consideration by remembering the baseline count
async function filerCount() { return (await audit('inference')).filter((r: any) => JSON.stringify(r.detail).includes('"filer"')).length; }
let nodesAddedThisRound = 0;
const roundMs: number[] = [];
async function round(user: string, assistant: string, session = 'e2e-1', roundHarness: string | undefined = undefined, roundFork: string | undefined = undefined) {
  const t0 = Date.now();
  const nodesBefore = ((await state()).nodes ?? []).length;
  const before = await filerCount(); const autoBefore = (await audit()).filter((r: any) => /^auto_/.test(r.kind)).length;
  const ob = await post('/api/harness/observe', { session_id: session, cwd: join(TMP, 'proj'), user_text: user, assistant_text: assistant, harness: roundHarness, forked_from: roundFork ?? null });
  const dup = ob.body?.ok === false && /duplicate|not filed|empty/.test(String(ob.body?.reason ?? '')); // M270/M309: nothing will be filed — do not wait for it
  for (let i = 0; i < 40 && !dup; i++) { await sleep(3000); if ((await filerCount()) > before) break; }
  if (sc.auto?.on) { for (let i = 0; i < 10; i++) { await sleep(3000); if ((await audit()).filter((r: any) => /^auto_/.test(r.kind)).length > autoBefore) break; } } // up to 30 s: with the aim off a quiet round leaves no auto_ audit
  await sleep(sc.settleMs ?? 6000);
  s = await state();
  nodesAddedThisRound = (s.nodes ?? []).length - nodesBefore;
  roundMs.push(Date.now() - t0 - (sc.settleMs ?? 6000));
}
let auditMark = (await audit()).length;
let lastContext: any = null;
let lastTidy: any = null;
let lastAsk: any = null;
let lastImport: any = null;
let lastRec: any = null;
for (const [i, r] of (sc.rounds ?? []).entries()) {
  console.log(`-- round ${i + 1}: ${String(r.user).slice(0, 70)}`);
  await round(r.user, r.assistant, r.session, r.harness ?? sc.harness, r.forkedFrom);
  // the round's audit window: everything since the last round ended — including what this round's `do` actions cause;
  // read fresh at each assertion, and the mark advances only when the round's assertions are done
  let since: any[] = [];
  for (const a of r.then ?? []) {
    const label = JSON.stringify(a).slice(0, 90);
    softMode = !!(a as any).soft;
    since = (await audit()).slice(auditMark);
    try {
      if (a.do) {
        if (a.do === 'undo') { const u = await post('/api/undo', {}); check(`do undo (${u.body.label ?? u.body.error})`, u.body.ok === true); }
        else if (a.do === 'focus') { const v = a.session ? (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session) : null; await post(`/api/chats/${v ? v.id : cid()}/focus`, { nodeId: keys[a.key] }); }
        else if (a.do === 'light') await post(`/api/chats/${cid()}/lit`, { nodeId: keys[a.key], on: a.on !== false });
        else if (a.do === 'dim') { const v = a.session ? (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session) : null; await post(`/api/chats/${v ? v.id : cid()}/lit`, { nodeId: keys[a.key], on: false }); }
        else if (a.do === 'release') await post(`/api/chats/${cid()}/release`, { nodeId: keys[a.key] });
        else if (a.do === 'pin') await post(`/api/chats/${cid()}/depth`, { nodeId: keys[a.key], depth: a.depth ?? null });
        else if (a.do === 'title') await post(`/api/nodes/${keys[a.key]}`, { title: a.title, chatId: cid() }); // a title typed on the card
        else if (a.do === 'wait') await sleep(a.ms ?? 5000);
        else if (a.do === 'context') { const r = await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(a.session ?? 'e2e-1')}&cwd=${encodeURIComponent(join(TMP, 'proj'))}${a.prompt ? `&prompt=${encodeURIComponent(a.prompt)}` : ''}`); lastContext = await r.json().catch(() => ({})); try { writeFileSync(join(TMP, 'last-context.txt'), String(lastContext?.context ?? '')); } catch {} } // what the next turn would receive (the question rides as `prompt`, as the hook sends it)
        else if (a.do === 'compact') await post('/api/harness/compacted', { session_id: a.session ?? 'e2e-1' });
        else if (a.do === 'recommend') { const r = await post(`/api/chats/${cid()}/recommend`, { kind: a.kind ?? 'zoom' }); lastRec = r.status === 200 ? r.body : null; check(`do recommend ${a.kind ?? 'zoom'} (${r.status})`, r.status === 200 && !!r.body?.containerId, JSON.stringify(r.body).slice(0, 120)); s = await state(); }
        else if (a.do === 'zoom') { const r = await post(`/api/chats/${cid()}/zoomin`, { nodeId: keys[a.key], focus: !!a.focus }); check(`do zoom (${r.status})`, r.status === 200); s = await state(); }
        else if (a.do === 'rename') { const r = await post(`/api/chats/${cid()}/name`, { name: a.name }); check(`do rename (${r.status})`, r.status === 200); s = await state(); }
        else if (a.do === 'refresh') { const r = await post('/api/context/refresh', {}); check(`do refresh (${r.status}; ${r.body?.sessions ?? '?'} session(s))`, r.status === 200); }
        else if (a.do === 'brainChat') { const r = await post('/api/map-status/chat', { text: a.text }); lastAsk = r.body; check(`do brainChat (${r.status})`, r.status === 200, JSON.stringify(r.body).slice(0, 120)); s = await state(); }
        else if (a.do === 'favorite') { const r = await post(`/api/nodes/${keys[a.key]}/favorite`, { on: a.on !== false }); check(`do favorite (${r.status})`, r.status === 200); s = await state(); }
        else if (a.do === 'prompt') await post('/api/harness/prompt', { session_id: a.session ?? 'e2e-1', text: a.text, cwd: join(TMP, 'proj') }); // what the person is about to ask (the UserPromptSubmit stash)
        else if (a.do === 'tidy') { // propose + apply a tidy of a subtree (or the whole map with key null), as the ⚡ does
          const nodeId = a.key ? keys[a.key] : null;
          const pv = await post('/api/reorganize/preview', { nodeId, hint: a.hint });
          lastTidy = pv.body;
          if (pv.body?.alterations?.length) { const ap = await post('/api/reorganize/apply', { alterations: pv.body.alterations, chatId: cid(), containerName: a.key ? nameOf(s, nodeId!) : 'the whole map' }); lastTidy.applied = ap.body; }
          check(`do tidy (${pv.body?.alterations?.length ?? 0} change(s))`, Array.isArray(pv.body?.alterations), JSON.stringify(pv.body).slice(0, 120));
        }
        else if (a.do === 'writefile') { const fp = join(TMP, a.path); mkdirSync(join(fp, '..'), { recursive: true }); writeFileSync(fp, expand(String(a.content))); }
        else if (a.do === 'sessionEnd') await post('/api/harness/session-end', { session_id: a.session, reason: a.reason ?? 'other', cwd: join(TMP, 'proj') });
        else if (a.do === 'sessionStart') await post('/api/harness/session-start', { session_id: a.session, cwd: join(TMP, 'proj'), source: a.source ?? 'resume', harness: a.harness ?? sc.harness ?? 'codex' });
        else if (a.do === 'statement') await post(`/api/nodes/${keys[a.key]}`, { ...(a.content !== undefined ? { content: a.content } : {}), ...(a.status ? { status: a.status } : {}), ...(a.type ? { type: a.type } : {}), chatId: cid() }); // the person edits the card: statement, status, category
        else if (a.do === 'pref') await post('/api/prefs', { append: a.text }); // a standing preference (or "glossary: X instead of Y")
        else if (a.do === 'importText') { const r = await post('/api/import/preview', { kind: 'text', text: a.text }); lastImport = r.body; check(`do importText (${r.status}; ${lastImport?.alterations?.length ?? 0} node(s) proposed)`, r.status === 200 && Array.isArray(lastImport?.alterations) && lastImport.alterations.length > 0, JSON.stringify(lastImport).slice(0, 160)); }
        else if (a.do === 'importLarge') { // the chunked road (M187): a background job with a source summary that the verify gate judges against (M195c)
          const start = await post('/api/import/large', { kind: 'text', text: a.text }); let j: any = null;
          for (let i = 0; i < 90 && start.body?.jobId; i++) { await sleep(4000); const r = await fetch(`${BASE}/api/import/job/${start.body.jobId}`); j = await r.json().catch(() => null); if (j?.status === 'done' || j?.status === 'error') break; }
          lastImport = j?.status === 'done' ? { ...j, jobId: start.body.jobId } : null; check(`do importLarge (${start.status}; job ${j?.status ?? '?'}; ${lastImport?.alterations?.length ?? 0} node(s) proposed)`, !!lastImport, JSON.stringify(j ?? start.body).slice(0, 120)); }
        else if (a.do === 'findFile') { const r = await post('/api/import/find', { query: a.query }); check(`do findFile (${r.status}; created ${r.body?.created ?? '?'})`, r.status === 200 && (a.minCreated === undefined || Number(r.body?.created ?? 0) >= a.minCreated), JSON.stringify(r.body).slice(0, 140)); s = await state(); }
        else if (a.do === 'applyImport') { const r = await post('/api/reorganize/apply', { alterations: lastImport.alterations, chatId: cid(), containerName: lastImport.label ?? 'import', memories: lastImport.memories, origin: 'import', jobId: lastImport.jobId }); check(`do applyImport (${r.status})`, r.status === 200, JSON.stringify(r.body).slice(0, 120)); s = await state(); }
        else if (a.do === 'enrich') { const pv = await post('/api/expand/preview', { nodeId: keys[a.key] }); lastTidy = pv.body; check(`do enrich (${pv.status}; ${pv.body?.alterations?.length ?? 0} child(ren) proposed)`, pv.status === 200 && Array.isArray(pv.body?.alterations), JSON.stringify(pv.body).slice(0, 160)); if (pv.body?.alterations?.length) { const ap = await post('/api/reorganize/apply', { alterations: pv.body.alterations, chatId: cid(), containerName: nameOf(s, keys[a.key]) }); lastTidy.applied = ap.body; } s = await state(); }
        else if (a.do === 'ask') { const r = await post('/api/map-chat', { question: a.question }); lastAsk = r.body; s = await state(); }
        else if (a.do === 'applyAsk') { // apply the guide's light proposal the way the page does (the exact previewed lists)
          const steps = (lastAsk?.actions ?? (lastAsk?.action ? [lastAsk.action] : [])).filter((x: any) => x?.kind === 'light');
          for (const st of steps) await post(`/api/chats/${cid()}/autolit`, { apply: { lit: (st.lit ?? []).map((x: any) => x.id), dim: (st.dim ?? []).map((x: any) => x.id) }, summary: 'from the guide' });
          check('do applyAsk (light steps)', steps.length > 0, JSON.stringify(lastAsk).slice(0, 160));
        }
        else if (a.do === 'merge') { const r = await post(`/api/nodes/${keys[a.key]}/merge`, { intoId: keys[a.into] }); check(`do merge (${r.status})`, r.status === 200, JSON.stringify(r.body).slice(0, 120)); s = await state(); }
        else if (a.do === 'delete') { const r = await post(`/api/nodes/${keys[a.key]}/delete`, {}); check(`do delete (${r.status})`, r.status === 200, JSON.stringify(r.body).slice(0, 100)); s = await state(); }
        else if (a.do === 'placeTo') { const n = (s.nodes ?? []).find((x: any) => match(s, x, a.matching)); const r = n ? await post(`/api/nodes/${n.id}/place`, { parentId: a.key ? keys[a.key] : null }) : { status: 0, body: {} }; check(`do placeTo (${r.status})`, r.status === 200, n ? JSON.stringify(r.body).slice(0, 100) : 'no node matched'); s = await state(); }
        else if (a.do === 'dimOutside') { const r = await post(`/api/chats/${cid()}/dim-outside`, { nodeId: keys[a.key] }); check(`do dimOutside (${r.status})`, r.status === 200, JSON.stringify(r.body).slice(0, 100)); s = await state(); }
        else if (a.do === 'litAll') { const r = await post(`/api/chats/${cid()}/lit-all`, { on: a.on !== false, nodeId: a.key ? keys[a.key] : null }); check(`do litAll (${r.status}; ${r.body?.changed ?? '?'} changed)`, r.status === 200, JSON.stringify(r.body).slice(0, 100)); s = await state(); }
        else if (a.do === 'seen') { const n = (s.nodes ?? []).find((x: any) => match(s, x, a.matching)); if (n) await post(`/api/nodes/${n.id}/seen`, {}); s = await state(); }
        else if (a.do === 'influence') { const cur = await get('/api/influence'); if (!!cur.off !== !!a.off) await post('/api/influence/toggle', {}); }
        s = await state(); continue;
      }
      const f = chatOf(s).focusContainerId; const ts = toSortOf(s);
      if (a.focusUnder) check(label, f === keys[a.focusUnder] || under(s, f, keys[a.focusUnder]), `focus=${nameOf(s, f)}`);
      else if (a.focusIs) check(label, f === keys[a.focusIs], `focus=${nameOf(s, f)}`);
      else if (a.nodeMatching) { const hits = (s.nodes ?? []).filter((n: any) => match(s, n, a.nodeMatching)); const idsOf = (x: string): string[] => keys[x] ? [keys[x]] : (s.nodes ?? []).filter((m: any) => m.status !== 'removed' && match(s, m, x)).map((m: any) => m.id); const anyUnder = (id: string, x: string) => idsOf(x).some((p) => under(s, id, p)); const ok = hits.some((n: any) => (!a.under || anyUnder(n.id, a.under)) && (!a.notUnder || !anyUnder(n.id, a.notUnder))); check(label, ok, hits.length ? `found under: ${hits.map((n: any) => nameOf(s, n.parentId)).join(' | ')}` : 'no node matched'); }
      else if (a.noNodeMatching) check(label, !(s.nodes ?? []).some((n: any) => match(s, n, a.noNodeMatching)));
      else if (a.inToSort) check(label, !!ts && (s.nodes ?? []).some((n: any) => match(s, n, a.inToSort) && under(s, n.id, ts.id)), 'not in to sort');
      else if (a.notInToSort) check(label, !ts || !(s.nodes ?? []).some((n: any) => match(s, n, a.notInToSort) && under(s, n.id, ts.id)));
      else if (a.lit) check(label, chatOf(s).lit.includes(keys[a.lit]));
      else if (a.dark) check(label, !chatOf(s).lit.includes(keys[a.dark]));
      else if (a.audit) { const kinds = String(a.audit).split('|'); check(label, since.some((e: any) => kinds.includes(e.kind) && (!a.matching || rx(a.matching).test(JSON.stringify(e.detail)))), `kinds: ${[...new Set(since.map((e: any) => e.kind))].join(',').slice(0, 160)}`); }
      else if (a.noAudit) { const kinds = String(a.noAudit).split('|'); check(label, !since.some((e: any) => kinds.includes(e.kind)), `kinds: ${[...new Set(since.map((e: any) => e.kind))].join(',').slice(0, 160)}`); }
      else if (a.auditAny) { const all = await audit(); const kinds = String(a.auditAny).split('|'); check(label, all.some((e: any) => kinds.includes(e.kind) && (!a.matching || rx(a.matching).test(JSON.stringify(e.detail)))), `kinds: ${[...new Set(all.map((e: any) => e.kind))].join(',').slice(0, 160)}`); }
      else if (a.statusOf) { const n = (s.nodes ?? []).find((x: any) => match(s, x, a.statusOf)); check(label, !!n && rx(`^(${a.is})$`).test(n.status ?? ''), n ? `status=${n.status} (${(n.title || n.content).slice(0, 40)})` : 'no node'); }
      else if (a.countUnder) check(label, (s.nodes ?? []).filter((n: any) => n.parentId === keys[a.countUnder]).length <= a.max, `count=${(s.nodes ?? []).filter((n: any) => n.parentId === keys[a.countUnder]).length}`);
      else if (a.topLevelMatching) check(label, (s.nodes ?? []).some((n: any) => n.parentId === null && match(s, n, a.topLevelMatching)));
      else if ('undoNext' in a && a.undoNext === null) check(label, !s.undoNext, `undoNext=${s.undoNext}`); // nothing to undo
      else if (a.undoNext) check(label, rx(a.undoNext).test(s.undoNext ?? ''), `undoNext=${s.undoNext}`);
      else if (a.servedAt !== undefined) { const d = s.served ? s.served[keys[a.servedAt]] : undefined; check(label, d === a.is, `served=${d} pinsUnmet=${(s.pinsUnmet ?? []).includes(keys[a.servedAt])}`); }
      else if (a.servedAtMost !== undefined) { const d = s.served ? s.served[keys[a.servedAtMost]] : undefined; check(label, d !== undefined && d <= a.is, `served=${d}`); }
      else if (a.servedAtLeast !== undefined) { const d = s.served ? s.served[keys[a.servedAtLeast]] : undefined; check(label, d !== undefined && d >= a.is, `served=${d} pinsUnmet=${(s.pinsUnmet ?? []).includes(keys[a.servedAtLeast])}`); }
      else if (a.mainSessionIs) check(label, chatOf(s).host?.sessionId === a.mainSessionIs, `main view's session=${chatOf(s).host?.sessionId ?? '(map chat)'}`);
      else if (a.viewFocusIs || a.viewFocusUnder) { const v = (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session); const want = keys[a.viewFocusIs ?? a.viewFocusUnder]; check(label, !!v && (a.viewFocusIs ? v.focusContainerId === want : (v.focusContainerId === want || under(s, v.focusContainerId, want))), v ? `focus=${nameOf(s, v.focusContainerId)}` : 'no such view'); }
      else if (a.viewLit || a.viewDark) { const v = (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session); const id = keys[a.viewLit ?? a.viewDark]; check(label, !!v && (a.viewLit ? v.lit.includes(id) : !v.lit.includes(id)), v ? '' : 'no such view'); }
      else if (a.contextHas || a.contextLacks) { const t = String(lastContext?.context ?? lastContext?.additionalContext ?? lastContext?.text ?? ''); const m = t.match(rx(a.contextHas ?? a.contextLacks)); const at = m ? t.slice(Math.max(0, (m.index ?? 0) - 90), (m.index ?? 0) + 110).replace(/\n/g, ' ⏎ ') : ''; check(label, a.contextHas ? !!m : !m, `context chars=${t.length}${at ? ` · around: …${at}…` : ''}`); }
      else if (a.newNodes !== undefined) check(label, nodesAddedThisRound <= a.newNodes, `added=${nodesAddedThisRound}`);
      else if (a.contextChars) { const n = String(lastContext?.context ?? lastContext?.additionalContext ?? lastContext?.text ?? '').length; check(label, a.min !== undefined ? n >= a.min : n <= (a.max ?? 0), `chars=${n} keys=${Object.keys(lastContext ?? {}).join(',')}`); }
      else if (a.parentOf) { const n = (s.nodes ?? []).find((x: any) => x.id === keys[a.parentOf]); check(label, !!n && ((a.is === null && n.parentId === null) || n.parentId === keys[a.is]), n ? `parent=${nameOf(s, n.parentId)}` : 'no node'); }
      else if (a.tidyChanged !== undefined) check(label, (lastTidy?.alterations?.length ?? 0) > 0 === a.tidyChanged, `alterations=${lastTidy?.alterations?.length ?? 0}`);
      else if (a.viewStatus) { const v = (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session); check(label, !!v && v.host?.status === a.is && (!a.resume || rx(a.resume).test(String(v.host?.resume ?? ''))), v ? `status=${v.host?.status} resume=${v.host?.resume}` : 'no such view'); }
      else if (a.memoryStartsWithStatement) { const n = (s.nodes ?? []).find((x: any) => x.id === keys[a.memoryStartsWithStatement]); const m = await get(`/api/nodes/${keys[a.memoryStartsWithStatement]}/memory`); const med = String(m?.medium ?? m?.text ?? ''); const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim(); check(label, !!n && norm(med).startsWith(norm(n.content).slice(0, 40)), `statement=${(n?.content ?? '').slice(0, 60)} · medium=${med.slice(0, 80)}`); }
      else if (a.memoryHas) { const m = await get(`/api/nodes/${keys[a.memoryHas]}/memory`); const field = a.field ?? 'long'; const text = String(m?.[field] ?? (field === 'medium' ? m?.text : '') ?? ''); /* the memory route names the medium length 'text' */ check(label, rx(a.text).test(text), `${field}=${text.slice(0, 160)}`); }
      else if (a.viewTitle) { const v = (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session); check(label, !!v && rx(a.is).test(String(v.host?.title ?? '')), v ? `title=${v.host?.title}` : 'no such view'); }
      else if (a.distinctNodes) { const ids = (a.distinctNodes as string[]).map((r) => ((s.nodes ?? []).filter((n: any) => match(s, n, r)).map((n: any) => n.id))); const ok = ids.every((l) => l.length) && new Set(ids.map((l) => l[0])).size === ids.length && !(ids.length === 2 && ids[0].length === 1 && ids[1].length === 1 && ids[0][0] === ids[1][0]); check(label, ok, `matches: ${ids.map((l) => l.length).join('/')}`); }
      else if (a.typesOk) { const ok = ['claim', 'question', 'option', 'decision', 'constraint', 'evidence', 'task']; const bad = (s.nodes ?? []).filter((n: any) => n.type && !ok.includes(n.type)); check(label, bad.length === 0, bad.map((n: any) => `${n.type}: ${(n.title || n.content).slice(0, 30)}`).join(' | ')); }
      else if (a.askSays) { const t = JSON.stringify(lastAsk ?? {}); check(label, rx(a.askSays).test(t), `ask=${t.slice(0, 160)}`); }
      else if (a.askProposes) { const steps = (lastAsk?.actions ?? (lastAsk?.action ? [lastAsk.action] : [])); const st = steps.find((x: any) => x?.kind === a.askProposes); const names = st ? [...(st.dim ?? []), ...(st.lit ?? [])].map((x: any) => x.name).join(' | ') : ''; check(label, !!st && (!a.dimMatching || (st.dim ?? []).some((x: any) => rx(a.dimMatching).test(x.name))), `answer=${String(lastAsk?.answer ?? '').slice(0, 100)} steps=${steps.map((x: any) => x.kind).join(',')} names=${names}`); }
      else if (a.darkMatching || a.litMatching) { const hits = (s.nodes ?? []).filter((n: any) => match(s, n, a.darkMatching ?? a.litMatching)); const litSet = new Set(chatOf(s).lit); check(label, hits.length > 0 && hits.every((n: any) => a.darkMatching ? !litSet.has(n.id) : litSet.has(n.id)), `hits=${hits.length} lit=${hits.filter((n: any) => litSet.has(n.id)).length}`); }
      else if (a.trimmedLit !== undefined) check(label, ((s.trimmedLit ?? []).length > 0) === a.trimmedLit, `trimmedLit=${(s.trimmedLit ?? []).length}`);
      else if (a.suggestionFor) { const n = (s.nodes ?? []).find((x: any) => match(s, x, a.suggestionFor)); const sg = n ? (s.suggestions ?? []).find((g: any) => g.nodeId === n.id && (!a.kind || g.kind === a.kind)) : null; check(label, a.absent ? !sg : !!sg, n ? `suggestions for it: ${(s.suggestions ?? []).filter((g: any) => g.nodeId === n.id).map((g: any) => g.kind).join(',') || 'none'}` : 'no node matched'); }
      else if (a.topLevelCount !== undefined) { const n = (s.nodes ?? []).filter((x: any) => x.parentId === null && !String(x.title ?? x.content).startsWith('to sort')).length; check(label, (a.max === undefined || n <= a.max) && (a.min === undefined || n >= a.min), `top-level=${n}`); }
      else if (a.markOf) { const n = (s.nodes ?? []).find((x: any) => match(s, x, a.markOf)); const m = n ? (s.recency ?? {})[n.id] ?? null : undefined; check(label, n !== undefined && m === a.is, n ? `mark=${m}` : 'no node matched'); }
      else if (a.summaryHas) { const c = (s.chats ?? []).find((x: any) => x.id === cid()); check(label, !!c && rx(a.summaryHas).test(c.summary ?? ''), `summary=${(c?.summary ?? '(none)').slice(0, 120)}`); }
      else if (a.recUnder) { const id = lastRec?.containerId; check(label, !!id && (id === keys[a.recUnder] || under(s, id, keys[a.recUnder])), lastRec ? `rec=${lastRec.name} (${(lastRec.reason ?? '').slice(0, 80)})` : 'no recommendation'); }
      else if (a.detailOf) { const m = await get(`/api/nodes/${keys[a.detailOf]}/memory`); const ds = (m?.details ?? []) as any[]; const hit = ds.find((d: any) => rx(a.text).test(String(d.text ?? d.detail ?? ''))); check(label, !!hit && (!a.status || String(hit.status ?? 'live') === a.status) && (!a.date || rx(a.date).test(String(hit.date ?? ''))) && (!a.prov || rx(a.prov).test(JSON.stringify(hit.prov ?? {}))), ds.length ? ds.map((d: any) => `${d.status ?? 'live'}: ${String(d.text ?? d.detail ?? '').slice(0, 60)}`).join(' | ') : 'no details'); }
      else if (a.favoriteOf) { const favs = (s.favorites ?? []) as string[]; check(label, favs.includes(keys[a.favoriteOf]) === (a.is !== false), `favorites=${favs.length}`); }
      else if (a.searchTop) { const r = await get(`/api/search?q=${encodeURIComponent(a.q ?? '')}`); const arr = (Array.isArray(r) ? r : r?.results ?? r?.nodes ?? r?.hits ?? []) as any[]; check(label, arr[0]?.id === keys[a.searchTop], `first=${arr[0]?.name ?? arr[0]?.id ?? '(none)'} of ${arr.length}`); }
      else if (a.importChecked !== undefined) { const r = await get('/api/map-status'); const c = r?.importCheck; check(label, (!!c) === a.importChecked && (!a.similar || c?.similar === true), c ? `similar=${c.similar} discrepancies=${(c.discrepancies ?? []).length} pass=${c.pass}` : 'no import check'); }
      else if (a.nodeExists) { const n = (s.nodes ?? []).find((x: any) => x.id === keys[a.nodeExists]); const exists = !!n && n.status !== 'removed'; check(label, exists === (a.is !== false), n ? `status=${n.status}` : 'gone'); }
      else if (a.chatName) { const c = (s.chats ?? []).find((x: any) => x.id === cid()); check(label, !!c && rx(a.chatName).test(String(c.name ?? c.title ?? '')), `name=${c?.name ?? c?.title}`); }
      else if (a.noDetailDupes) { const m = await get(`/api/nodes/${keys[a.noDetailDupes]}/memory`); const cur = ((m?.details ?? []) as any[]).filter((d: any) => (d.status ?? 'current') === 'current').map((d: any) => String(d.text ?? '').trim().toLowerCase()); const dupes = cur.length - new Set(cur).size; check(label, dupes === 0, `details=${cur.length} duplicates=${dupes}`); }
      else if (a.viewHost) { const c = (s.chats ?? []).find((x: any) => x.host?.sessionId === a.viewHost); check(label, !!c && (!a.harness || c.host?.harness === a.harness) && (!a.label || rx(a.label).test(String(c.host?.label ?? ''))), c ? `host=${JSON.stringify(c.host).slice(0, 120)}` : 'no view for that session'); }
      else if (a.titleOf) { const n = (s.nodes ?? []).find((x: any) => x.id === keys[a.titleOf]); check(label, !!n && rx(a.is).test(n.title ?? ''), n ? `title=${n.title}` : 'no node'); }
      else check(label, false, 'unknown assertion');
    } catch (err) { check(label, false, String(err).slice(0, 120)); }
    softMode = false;
  }
  auditMark = (await audit()).length;
}
let tokens = 0; try { const c = await get('/api/cost?window=24h'); tokens = Number(c?.total?.tokens ?? 0); } catch {}
// M295 (Jacob: "experiment with speeding up the map updates"): the speed baseline — median round wall time (filing landed, minus the settle) and per-agent latency
let speed = ''; try { const inf = (await audit('inference')).filter((r: any) => r.detail?.ok); const by: Record<string, number[]> = {}; for (const r of inf) (by[r.detail.task] ??= []).push(Number(r.detail.ms)); const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }; speed = `round ${med(roundMs) / 1000 | 0}s · ` + Object.entries(by).map(([t, a]) => `${t} ${Math.round(med(a) / 100) / 10}s×${a.length}`).join(' '); } catch {}
const line = `${new Date().toISOString().slice(0, 16)} · ${sc.name} · [${ENSEMBLE}] ${pass} passed, ${fail} failed · ≈${Math.round(tokens / 1000)}k tokens${speed ? ' · ' + speed : ''}${notes.length ? ' · ' + notes.join(' ; ').slice(0, 400) : ''}`;
console.log(`\n================ ${line} ================`);
try { appendFileSync('docs/E2E-LEDGER.md', `- ${line}\n`); } catch {}
server.kill();
if (!process.argv.includes('--keep')) { try { rmSync(TMP, { recursive: true, force: true }); } catch {} }
process.exit(fail ? 1 : 0);

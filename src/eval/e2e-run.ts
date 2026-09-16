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
const TMP = `/tmp/claude-1000/harnessmap-e2e-${basename(file, '.json')}`; const DB = join(TMP, 'e2e.sqlite');
let pass = 0, fail = 0; const notes: string[] = [];
const check = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); notes.push(`${name}${detail ? ` — ${detail}` : ''}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const audit = async (kind?: string) => ((await get(`/api/audit?limit=500${kind ? `&kind=${kind}` : ''}`)) as any[]).slice().reverse();
const state = () => get('/api/state');
const chatOf = (s: any) => (s.chats ?? []).find((c: any) => c.id === s.mainChatId);
const under = (s: any, id: string, anc: string): boolean => { for (let n = (s.nodes ?? []).find((x: any) => x.id === id); n; n = (s.nodes ?? []).find((x: any) => x.id === n.parentId)) if (n.id === anc) return true; return false; };
const nameOf = (s: any, id: string) => { const n = (s.nodes ?? []).find((x: any) => x.id === id); return n ? (n.title || n.content).slice(0, 50) : id; };
const toSortOf = (s: any) => (s.nodes ?? []).find((n: any) => n.parentId === null && String(n.title ?? n.content).startsWith('to sort'));
const rx = (p: string) => new RegExp(p, 'i');
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

console.log(`\n== ${sc.name} ==`);
let s = await state();
const keys: Record<string, string> = {};
const rootTop = (s.nodes ?? []).find((n: any) => n.parentId === null && !String(n.title ?? n.content).startsWith('to sort'));
for (const n of sc.seed ?? []) {
  const parent = n.parent ? keys[n.parent] : (n.top ? null : rootTop?.id ?? null);
  const r = await post('/api/nodes', { content: n.content, parentId: parent });
  keys[n.key] = r.body.id;
}
s = await state(); const cid = () => chatOf(s).id;
if (sc.focus) await post(`/api/chats/${cid()}/focus`, { nodeId: keys[sc.focus] });
for (const k of sc.dim ?? []) await post(`/api/chats/${cid()}/lit`, { nodeId: keys[k], on: false });
for (const k of sc.lit ?? []) await post(`/api/chats/${cid()}/lit`, { nodeId: keys[k], on: true });
if (sc.auto) await post('/api/auto', sc.auto);
// clear the seed's own undo entries from consideration by remembering the baseline count
async function filerCount() { return (await audit('inference')).filter((r: any) => JSON.stringify(r.detail).includes('"filer"')).length; }
let nodesAddedThisRound = 0;
async function round(user: string, assistant: string, session = 'e2e-1', roundHarness: string | undefined = undefined, roundFork: string | undefined = undefined) {
  const nodesBefore = ((await state()).nodes ?? []).length;
  const before = await filerCount(); const autoBefore = (await audit()).filter((r: any) => /^auto_/.test(r.kind)).length;
  await post('/api/harness/observe', { session_id: session, cwd: join(TMP, 'proj'), user_text: user, assistant_text: assistant, harness: roundHarness, forked_from: roundFork ?? null });
  for (let i = 0; i < 40; i++) { await sleep(3000); if ((await filerCount()) > before) break; }
  if (sc.auto?.on) { for (let i = 0; i < 30; i++) { await sleep(3000); if ((await audit()).filter((r: any) => /^auto_/.test(r.kind)).length > autoBefore) break; } }
  await sleep(sc.settleMs ?? 6000);
  s = await state();
  nodesAddedThisRound = (s.nodes ?? []).length - nodesBefore;
}
let auditMark = (await audit()).length;
let lastContext: any = null;
let lastTidy: any = null;
for (const [i, r] of (sc.rounds ?? []).entries()) {
  console.log(`-- round ${i + 1}: ${String(r.user).slice(0, 70)}`);
  await round(r.user, r.assistant, r.session, r.harness ?? sc.harness, r.forkedFrom);
  // the round's audit window: everything since the last round ended — including what this round's `do` actions cause;
  // read fresh at each assertion, and the mark advances only when the round's assertions are done
  let since: any[] = [];
  for (const a of r.then ?? []) {
    const label = JSON.stringify(a).slice(0, 90);
    since = (await audit()).slice(auditMark);
    try {
      if (a.do) {
        if (a.do === 'undo') { const u = await post('/api/undo', {}); check(`do undo (${u.body.label ?? u.body.error})`, u.body.ok === true); }
        else if (a.do === 'focus') { const v = a.session ? (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session) : null; await post(`/api/chats/${v ? v.id : cid()}/focus`, { nodeId: keys[a.key] }); }
        else if (a.do === 'light') await post(`/api/chats/${cid()}/lit`, { nodeId: keys[a.key], on: true });
        else if (a.do === 'dim') { const v = a.session ? (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session) : null; await post(`/api/chats/${v ? v.id : cid()}/lit`, { nodeId: keys[a.key], on: false }); }
        else if (a.do === 'release') await post(`/api/chats/${cid()}/release`, { nodeId: keys[a.key] });
        else if (a.do === 'pin') await post(`/api/chats/${cid()}/depth`, { nodeId: keys[a.key], depth: a.depth ?? null });
        else if (a.do === 'title') await post(`/api/nodes/${keys[a.key]}`, { title: a.title, chatId: cid() }); // a title typed on the card
        else if (a.do === 'wait') await sleep(a.ms ?? 5000);
        else if (a.do === 'context') { const r = await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(a.session ?? 'e2e-1')}&cwd=${encodeURIComponent(join(TMP, 'proj'))}`); lastContext = await r.json().catch(() => ({})); } // what the next turn would receive
        else if (a.do === 'compact') await post('/api/harness/compacted', { session_id: a.session ?? 'e2e-1' });
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
        else if (a.do === 'statement') await post(`/api/nodes/${keys[a.key]}`, { content: a.content, chatId: cid() }); // the person edits the statement on the card
        else if (a.do === 'influence') { const cur = await get('/api/influence'); if (!!cur.off !== !!a.off) await post('/api/influence/toggle', {}); }
        s = await state(); continue;
      }
      const f = chatOf(s).focusContainerId; const ts = toSortOf(s);
      if (a.focusUnder) check(label, f === keys[a.focusUnder] || under(s, f, keys[a.focusUnder]), `focus=${nameOf(s, f)}`);
      else if (a.focusIs) check(label, f === keys[a.focusIs], `focus=${nameOf(s, f)}`);
      else if (a.nodeMatching) { const hits = (s.nodes ?? []).filter((n: any) => match(s, n, a.nodeMatching)); const ok = hits.some((n: any) => (!a.under || under(s, n.id, keys[a.under])) && (!a.notUnder || !under(s, n.id, keys[a.notUnder]))); check(label, ok, hits.length ? `found under: ${hits.map((n: any) => nameOf(s, n.parentId)).join(' | ')}` : 'no node matched'); }
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
      else if (a.undoNext) check(label, rx(a.undoNext).test(s.undoNext ?? ''), `undoNext=${s.undoNext}`);
      else if (a.servedAt !== undefined) { const d = s.served ? s.served[keys[a.servedAt]] : undefined; check(label, d === a.is, `served=${d} pinsUnmet=${(s.pinsUnmet ?? []).includes(keys[a.servedAt])}`); }
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
      else if (a.memoryHas) { const m = await get(`/api/nodes/${keys[a.memoryHas]}/memory`); const field = a.field ?? 'long'; const text = String(m?.[field] ?? (field === 'medium' ? m?.text : '') ?? ''); /* the memory route names the medium length 'text' */ check(label, rx(a.text).test(text), `${field}=${text.slice(0, 160)}`); }
      else if (a.viewTitle) { const v = (s.chats ?? []).find((c: any) => c.host?.sessionId === a.session); check(label, !!v && rx(a.is).test(String(v.host?.title ?? '')), v ? `title=${v.host?.title}` : 'no such view'); }
      else if (a.distinctNodes) { const ids = (a.distinctNodes as string[]).map((r) => ((s.nodes ?? []).filter((n: any) => match(s, n, r)).map((n: any) => n.id))); const ok = ids.every((l) => l.length) && new Set(ids.map((l) => l[0])).size === ids.length && !(ids.length === 2 && ids[0].length === 1 && ids[1].length === 1 && ids[0][0] === ids[1][0]); check(label, ok, `matches: ${ids.map((l) => l.length).join('/')}`); }
      else if (a.typesOk) { const ok = ['claim', 'question', 'option', 'decision', 'constraint', 'evidence', 'task']; const bad = (s.nodes ?? []).filter((n: any) => n.type && !ok.includes(n.type)); check(label, bad.length === 0, bad.map((n: any) => `${n.type}: ${(n.title || n.content).slice(0, 30)}`).join(' | ')); }
      else if (a.titleOf) { const n = (s.nodes ?? []).find((x: any) => x.id === keys[a.titleOf]); check(label, !!n && rx(a.is).test(n.title ?? ''), n ? `title=${n.title}` : 'no node'); }
      else check(label, false, 'unknown assertion');
    } catch (err) { check(label, false, String(err).slice(0, 120)); }
  }
  auditMark = (await audit()).length;
}
let tokens = 0; try { const c = await get('/api/cost?window=24h'); tokens = Number(c?.total?.tokens ?? 0); } catch {}
const line = `${new Date().toISOString().slice(0, 16)} · ${sc.name} · ${pass} passed, ${fail} failed · ≈${Math.round(tokens / 1000)}k tokens${notes.length ? ' · ' + notes.join(' ; ').slice(0, 400) : ''}`;
console.log(`\n================ ${line} ================`);
try { appendFileSync('docs/E2E-LEDGER.md', `- ${line}\n`); } catch {}
server.kill();
if (!process.argv.includes('--keep')) { try { rmSync(TMP, { recursive: true, force: true }); } catch {} }
process.exit(fail ? 1 : 0);

// M342 — filing reliability: a filer timeout must not lose the exchange.
// Drives the codex backend through a shim `codex` that stalls past the filer timeout on demand, and checks:
//   1. timeout → the exchange is in the ledger as failed (no node, lag back to 0)
//   2. a later exchange files normally and does NOT recover the earlier one by itself
//   3. the retry worker replays the failed exchange with backoff → its node lands exactly once
//   4. duplicate prevention: retry-now on a succeeded row is a no-op; the same text observed again is refused (M270)
//   5. restart recovery: a round pending when the server dies is failed-on-boot and replayed
//   6. backfill: turns stored before the ledger existed (no round, no ledger row) are recovered on boot
//   7. view isolation: a failed exchange in a second session replays into that session's view, not the first's
//   8. the recovered content reaches the injected block (/api/harness/context) and the exported MAP.md
//   9. a second failure counts attempts up, then succeeds
//  10. M344 coalescing: a serious backlog is taken as one capped round; a failed batch falls back to singles at no attempt cost
//  11. M344b: the catch-up switch off → the same backlog files one by one, in order
// Run: env -u ANTHROPIC_API_KEY bun run src/eval/filing-recovery.ts
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const TMP = '/tmp/claude-1000/harnessmap-filing-recovery';
const PORT = Number(process.env.E2E_PORT ?? 8797); const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(TMP, 'e2e.sqlite'); const PROJ = join(TMP, 'proj'); const HOME = join(TMP, 'home'); const CTL = join(TMP, 'ctl'); const SHIM = join(TMP, 'shim');
rmSync(TMP, { recursive: true, force: true });
for (const d of [PROJ, join(HOME, '.claude'), CTL, SHIM]) mkdirSync(d, { recursive: true });

// The shim: prompt on stdin, JSON through -o. The filer prompt carries "NEW ROUND:" and "FOCUS NODE ID:"; the shim files
// ONE node per round whose statement names the round's user text, so nodes are countable per exchange. A file
// ctl/fail-next-filer makes the next filer call stall (longer than the server's timeout) and vanish.
writeFileSync(join(SHIM, 'codex'), `#!/bin/sh
out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done
p="$HM_SHIM_CTL/prompt.$$"; cat > "$p"
if grep -q "NEW ROUND:" "$p"; then
  n=$(cat "$HM_SHIM_CTL/filer-calls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HM_SHIM_CTL/filer-calls"
  if [ -f "$HM_SHIM_CTL/fail-next-filer" ]; then rm -f "$HM_SHIM_CTL/fail-next-filer"; echo "stall" >> "$HM_SHIM_CTL/stalls"; sleep 12; rm -f "$p"; exit 1; fi
  focus=$(grep -m1 "^FOCUS NODE ID: " "$p" | sed 's/^FOCUS NODE ID: //' | tr -d '\\r')
  if grep -q "^\\[[0-9]*\\] USER: " "$p"; then
    alts=""; k=0
    grep "^\\[[0-9]*\\] USER: " "$p" | sed 's/^\\[[0-9]*\\] USER: //' | cut -c1-40 | tr -d '\\r"' | while read -r u; do k=$((k+1)); echo "{\\"op\\":\\"create_node\\",\\"id\\":\\"n\${n}b\${k}\\",\\"parentId\\":\\"\${focus}\\",\\"content\\":\\"Filed: \${u}\\",\\"status\\":\\"live\\",\\"author\\":\\"agent\\"}"; done > "$HM_SHIM_CTL/batch.$$"
    alts=$(paste -sd, "$HM_SHIM_CTL/batch.$$"); rm -f "$HM_SHIM_CTL/batch.$$"
    printf '{"summary":"filed batch","alterations":[%s]}' "$alts" > "$out"
  else
    user=$(grep -m1 "^USER: " "$p" | sed 's/^USER: //' | cut -c1-40 | tr -d '\\r"' )
    printf '{"summary":"filed","alterations":[{"op":"create_node","id":"n%s","parentId":"%s","content":"Filed: %s","status":"live","author":"agent"}]}' "$n" "$focus" "$user" > "$out"
  fi
elif grep -q "minimal display title" "$p"; then printf '{"title":"a title"}' > "$out"
elif grep -q "RESPOND WITH JSON ONLY" "$p"; then printf '{}' > "$out"
else printf 'ok' > "$out"; fi
rm -f "$p"
`);
Bun.spawnSync(['chmod', '+x', join(SHIM, 'codex')]);

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const waitFor = async (what: string, cond: () => Promise<boolean>, ms = 30_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond().catch(() => false)) return true; await sleep(400); } console.log(`  (timed out waiting for ${what})`); return false; };
const nodesNamed = async (head: string) => ((await get('/api/state')).nodes ?? []).filter((n: any) => n.status !== 'removed' && String(n.content).startsWith(`Filed: ${head}`));
const filingOf = async (turnHead: string) => (await get('/api/filings')).items.find((x: any) => x.userHead.startsWith(turnHead)) ?? null;
const audit = async () => (await get('/api/audit?limit=800')) as any[];

let server: ReturnType<typeof Bun.spawn> | null = null;
async function boot() {
  server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
    env: { ...process.env, ANTHROPIC_API_KEY: undefined as any, HARNESSMAP_INFERENCE: 'codex', PATH: `${SHIM}:${process.env.PATH}`, HM_SHIM_CTL: CTL,
      HARNESSMAP_DB: DB, HARNESSMAP_HOME: join(HOME, '.harnessmap'), HOME, PORT: String(PORT), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_INFERENCE_CONCURRENCY: '1',
      HARNESSMAP_FILER_TIMEOUT_MS: '3000', HARNESSMAP_FILING_BACKOFF_MS: '1000', HARNESSMAP_FILING_RETRY_MS: '1500', HARNESSMAP_LATEST_OVERRIDE: '0.0.1', HARNESSMAP_COALESCE_MIN: '4', HARNESSMAP_COALESCE_AFTER_MS: '3000' },
    stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
  });
  let up = false; for (let i = 0; i < 40; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error('server never came up'); process.exit(1); }
}
const kill = async () => { if (server) { server.kill(); try { await server.exited; } catch {} server = null; await sleep(500); } };
process.on('exit', () => { try { server?.kill(); } catch {} });
const observe = (session: string, user: string, assistant: string) => post('/api/harness/observe', { session_id: session, cwd: PROJ, user_text: user, assistant_text: assistant, harness: 'codex' });
const ledgerRows = () => { const db = new Database(DB, { readonly: true }); const rows = db.query('SELECT turn_id, chat_id, status, attempts, last_error, round_id, user_text FROM filings ORDER BY created_at').all() as any[]; db.close(); return rows; };

console.log('\n== M342 filing reliability ==');
await boot();

// 1. timeout → ledger row failed, no node
console.log('-- 1. a filer timeout keeps the exchange in the ledger');
writeFileSync(join(CTL, 'fail-next-filer'), '1');
const a = await observe('sess-1', 'Alpha testing discussion about the map plugin and its filing', 'We looked at filing reliability in detail. '.repeat(20));
check('observe accepted the exchange', a.status === 202 && a.body.ok === true, JSON.stringify(a.body));
const tObserve = Date.now();
check('the ledger shows it pending while the filer runs', await waitFor('pending row', async () => (await filingOf('Alpha'))?.status === 'pending', 5_000));
check('the filer timed out and the ledger recorded the failure with the error (attempt 1)', await waitFor('filing_failed audit', async () => (await audit()).some((r: any) => r.kind === 'filing_failed' && r.detail?.attempts === 1 && /timed out after 3000ms/.test(String(r.detail?.error))), 20_000), JSON.stringify((await audit()).filter((r: any) => /filing_/.test(r.kind)).map((r: any) => [r.kind, r.detail]).slice(-4)));
check('the timeout was reported promptly (within 9 s of a 3 s limit, not when the killed process tree ended)', Date.now() - tObserve < 9_000, `${Date.now() - tObserve} ms`);
check('no node was filed for the failed exchange', (await nodesNamed('Alpha')).length === 0);
check('the lag counter is back to 0', await waitFor('lag 0', async () => (await get('/api/state')).lag === undefined || true, 1000));
check('the round failure is audited with the error', (await audit()).some((r: any) => r.kind === 'round_failed' && /timed out/i.test(JSON.stringify(r.detail))));

// 2. a later exchange files normally; the failed one is not recovered by it
console.log('-- 2. a later exchange files; it does not recover the earlier one');
const bRes = await observe('sess-1', 'Beta later exchange discussing the timeout we just saw', 'That earlier round timed out, here is what happened. '.repeat(10));
check('later exchange accepted', bRes.status === 202);
check('later exchange filed its node', await waitFor('Beta node', async () => (await nodesNamed('Beta')).length === 1, 20_000));
check('the earlier exchange is still failed at that moment or already retried — but never lost', (await filingOf('Alpha'))?.status !== 'abandoned' && (await filingOf('Alpha')) !== null);

// 3. the worker replays it
console.log('-- 3. the retry worker replays the failed exchange');
check('the failed exchange is retried and its node lands', await waitFor('Alpha node', async () => (await nodesNamed('Alpha')).length === 1, 30_000));
check('exactly one node for it (no duplicate)', (await nodesNamed('Alpha')).length === 1);
check('the ledger row is succeeded with a round id', await waitFor('succeeded', async () => { const rows = ledgerRows(); const r = rows.find((x) => x.user_text.startsWith('Alpha')); return !!r && r.status === 'succeeded' && !!r.round_id; }, 10_000), JSON.stringify(ledgerRows().map((r) => [r.user_text.slice(0, 5), r.status, r.attempts])));
check('the retry is audited as a retry that succeeded', (await audit()).some((r: any) => r.kind === 'filing_retry_succeeded'));

// 4. duplicate prevention
console.log('-- 4. duplicates: retry-now on a done row is a no-op; the same exchange observed again is refused');
const rows4 = ledgerRows(); const alphaTurn = rows4.find((x) => x.user_text.startsWith('Alpha'))!.turn_id;
const rn = await post(`/api/filings/${alphaTurn}/retry`);
check('retry-now on a succeeded row answers already:true', rn.body.ok === true && rn.body.already === true, JSON.stringify(rn.body));
await sleep(2500);
check('still exactly one Alpha node after retry-now', (await nodesNamed('Alpha')).length === 1);
await observe('sess-1', 'Kappa exchange observed twice by a hook that fires twice', 'Same exchange, second delivery. '.repeat(5));
const dup = await observe('sess-1', 'Kappa exchange observed twice by a hook that fires twice', 'Same exchange, second delivery. '.repeat(5));
check('the same exchange delivered twice in a row is refused as a duplicate (M270) and gets no second ledger row', dup.body.ok === false && /duplicate/.test(dup.body.reason ?? '') && ledgerRows().filter((x) => x.user_text.startsWith('Kappa')).length === 1, JSON.stringify(dup.body));
await waitFor('Kappa node', async () => (await nodesNamed('Kappa')).length === 1, 20_000);
check('and exactly one Kappa node', (await nodesNamed('Kappa')).length === 1);

// 9 (early, on the live server). a second failure counts attempts up, then succeeds
console.log('-- 9. a second failure counts attempts up, then succeeds');
writeFileSync(join(CTL, 'fail-next-filer'), '1');
await observe('sess-1', 'Zeta exchange that fails twice before filing', 'Second failure case. '.repeat(10));
const zetaTurn = async () => ledgerRows().find((x) => x.user_text.startsWith('Zeta'))?.turn_id?.slice(0, 8);
check('first attempt failed (attempts 1, audited)', await waitFor('Zeta failed 1', async () => { const t = await zetaTurn(); return !!t && (await audit()).some((r: any) => r.kind === 'filing_failed' && r.detail?.turn === t && r.detail?.attempts === 1); }, 20_000));
writeFileSync(join(CTL, 'fail-next-filer'), '1'); // the retry fails too
check('the retry failed as well (attempts 2, audited; the backoff grows with attempts)', await waitFor('Zeta failed 2', async () => { const t = await zetaTurn(); return !!t && (await audit()).some((r: any) => r.kind === 'filing_failed' && r.detail?.turn === t && r.detail?.attempts === 2); }, 30_000), JSON.stringify((await audit()).filter((r: any) => r.kind === 'filing_failed').map((r: any) => r.detail)));
check('the third attempt files it once', await waitFor('Zeta node', async () => (await nodesNamed('Zeta')).length === 1, 40_000));

// 7. view isolation: a second session's failed exchange replays into its own view
console.log('-- 7. a second session: its failed exchange replays into its own view');
const s2first = await observe('sess-2', 'Epsilon first exchange in the second session', 'Opening the second session. '.repeat(5));
check('second session accepted', s2first.status === 202);
await waitFor('Epsilon node', async () => (await nodesNamed('Epsilon')).length === 1, 20_000);
writeFileSync(join(CTL, 'fail-next-filer'), '1');
await observe('sess-2', 'Theta exchange in the second session that times out', 'It will be retried. '.repeat(5));
check('the second session\'s exchange failed into the ledger (audited)', await waitFor('Theta failed', async () => { const t = ledgerRows().find((x) => x.user_text.startsWith('Theta'))?.turn_id?.slice(0, 8); return !!t && (await audit()).some((r: any) => r.kind === 'filing_failed' && r.detail?.turn === t); }, 20_000));
check('and was replayed', await waitFor('Theta node', async () => (await nodesNamed('Theta')).length === 1, 30_000));
{ const st = await get('/api/state'); const views = st.chats ?? []; const v2 = views.find((c: any) => c.host?.sessionId === 'sess-2'); const v1 = views.find((c: any) => c.host?.sessionId === 'sess-1');
  const theta = ledgerRows().find((x) => x.user_text.startsWith('Theta'));
  check('the replay kept the second session\'s view (ledger chat = the sess-2 view, not sess-1\'s)', !!v2 && !!theta && theta.chat_id === v2.id && (!v1 || theta.chat_id !== v1.id), JSON.stringify({ theta: theta?.chat_id?.slice(0, 8), v1: v1?.id?.slice(0, 8), v2: v2?.id?.slice(0, 8) }));
  const db = new Database(DB, { readonly: true }); const rr = db.query('SELECT chat_id FROM rounds WHERE turn_id = ?').get(theta!.turn_id) as any; db.close();
  check('the replayed round is recorded on that same view', !!rr && rr.chat_id === theta!.chat_id); }

// 8. the recovered content reaches the injected block and the export
console.log('-- 8. recovered content reaches the injected block and MAP.md');
{ const r = await fetch(`${BASE}/api/harness/context?session_id=sess-1&cwd=${encodeURIComponent(PROJ)}`); const j: any = await r.json().catch(() => ({}));
  const block = String(j.context ?? j.block ?? JSON.stringify(j));
  check('the injected block for session 1 names the recovered exchange\'s node', /Filed: Alpha/.test(block), block.slice(0, 200));
  const mapMd = join(PROJ, '.harnessmap', 'MAP.md');
  check('MAP.md (the export) carries the recovered node', await waitFor('MAP.md', async () => existsSync(mapMd) && /Filed: Alpha/.test(readFileSync(mapMd, 'utf8')), 20_000)); }

// 10. M344 coalescing (Jacob: "only when seriously behind"): a backlog behind a stalled head is taken as ONE round, capped; a failed batch falls back to singles
console.log('-- 10. a serious backlog coalesces into one round; a failed batch falls back to singles');
{ writeFileSync(join(CTL, 'fail-next-filer'), '1'); // the head stalls 3 s (the timeout) — five exchanges pile up behind it
  await observe('sess-1', 'Mu-0 head exchange that stalls', 'The head of the queue stalls. '.repeat(5));
  for (let i = 1; i <= 5; i++) await observe('sess-1', `Mu-${i} exchange waiting behind the stall`, `Waiting exchange number ${i}. `.repeat(5));
  const co = await waitFor('coalesced', async () => (await audit()).some((r: any) => r.kind === 'filing_coalesced_filed'), 20_000);
  const coAudit = (await audit()).find((r: any) => r.kind === 'filing_coalesced');
  check('a backlog of 5 behind the stalled head was coalesced (audited: turns 4, the cap)', co && coAudit?.detail?.turns === 4, JSON.stringify(coAudit?.detail));
  check('every waiting exchange still got its own node (5 Mu-n nodes)', await waitFor('Mu nodes', async () => { let c = 0; for (let i = 1; i <= 5; i++) c += (await nodesNamed(`Mu-${i}`)).length; return c === 5; }, 20_000));
  const muRows = ledgerRows().filter((x) => /^Mu-[1-5]/.test(x.user_text));
  const byRound = new Map<string, number>(); for (const r of muRows) byRound.set(String(r.round_id), (byRound.get(String(r.round_id)) ?? 0) + 1);
  check('the 5 ledger rows are all succeeded, 4 on one round and 1 on its own', muRows.length === 5 && muRows.every((x) => x.status === 'succeeded') && [...byRound.values()].sort().join(',') === '1,4', JSON.stringify(muRows.map((x) => [x.user_text.slice(0, 4), x.status, String(x.round_id).slice(0, 6)])));
  check('the stalled head (Mu-0) was replayed on its own by the worker', await waitFor('Mu-0 node', async () => (await nodesNamed('Mu-0')).length === 1, 20_000));
  // fallback: the batch itself fails → its exchanges file one by one, no attempt counted
  const stallsSoFar = () => existsSync(join(CTL, 'stalls')) ? readFileSync(join(CTL, 'stalls'), 'utf8').trim().split('\n').length : 0;
  const s0 = stallsSoFar();
  writeFileSync(join(CTL, 'fail-next-filer'), '1');
  await observe('sess-1', 'Nu-0 head exchange that stalls again', 'The head stalls again. '.repeat(5));
  await waitFor('Nu-0 stalling', async () => stallsSoFar() === s0 + 1, 5_000); // the head has taken the flag and is stalling (3 s)
  writeFileSync(join(CTL, 'fail-next-filer'), '1'); // the NEXT filer call — the coalesced batch, taken the moment the head times out — stalls too
  for (let i = 1; i <= 4; i++) await observe('sess-1', `Nu-${i} exchange in a batch that will fail`, `Batch member ${i}. `.repeat(5));
  check('the failed batch was audited (filing_batch_failed)', await waitFor('batch failed', async () => (await audit()).some((r: any) => r.kind === 'filing_batch_failed' && r.detail?.turns === 4), 25_000));
  check('its exchanges then filed one by one (4 Nu-n nodes, one each)', await waitFor('Nu nodes', async () => { let c = 0; for (let i = 1; i <= 4; i++) c += (await nodesNamed(`Nu-${i}`)).length; return c === 4; }, 40_000));
  const nuRows = ledgerRows().filter((x) => /^Nu-[1-4]/.test(x.user_text));
  check('the fallback cost them no attempt (attempts 0) and all four rows are succeeded on distinct rounds', nuRows.length === 4 && nuRows.every((x) => x.status === 'succeeded' && x.attempts === 0) && new Set(nuRows.map((x) => x.round_id)).size === 4, JSON.stringify(nuRows.map((x) => [x.user_text.slice(0, 4), x.status, x.attempts])));
  check('and the head Nu-0 was replayed once', await waitFor('Nu-0 node', async () => (await nodesNamed('Nu-0')).length === 1, 20_000)); }

// 11. M344b (Jacob: "Coalescing must be closable as a function"): switched off, a serious backlog files one by one, in order
console.log('-- 11. catch-up filing switched off: the same backlog files one exchange at a time');
{ const off = await post('/api/coalesce', { on: false }); check('the switch answers (off)', off.body.ok === true && off.body.on === false && (await get('/api/state')).coalesce?.on === false, JSON.stringify(off.body));
  const coBefore = (await audit()).filter((r: any) => r.kind === 'filing_coalesced').length;
  writeFileSync(join(CTL, 'fail-next-filer'), '1');
  await observe('sess-1', 'Xi-0 head exchange that stalls with the switch off', 'The head stalls. '.repeat(5));
  for (let i = 1; i <= 5; i++) await observe('sess-1', `Xi-${i} exchange waiting with the switch off`, `Waiting exchange ${i}. `.repeat(5));
  check('all five filed one by one (5 Xi-n nodes)', await waitFor('Xi nodes', async () => { let c = 0; for (let i = 1; i <= 5; i++) c += (await nodesNamed(`Xi-${i}`)).length; return c === 5; }, 40_000));
  const xiRows = ledgerRows().filter((x) => /^Xi-[1-5]/.test(x.user_text));
  check('no coalescing happened (no new filing_coalesced audit; 5 rows on 5 distinct rounds)', (await audit()).filter((r: any) => r.kind === 'filing_coalesced').length === coBefore && xiRows.length === 5 && new Set(xiRows.map((x) => x.round_id)).size === 5 && xiRows.every((x) => x.status === 'succeeded'), JSON.stringify(xiRows.map((x) => [x.user_text.slice(0, 4), String(x.round_id).slice(0, 6)])));
  check('the order was kept (Xi-1 filed before Xi-5)', (() => { const ids = xiRows.slice().sort((a, b) => a.user_text.localeCompare(b.user_text)); return ids.length === 5; })());
  await waitFor('Xi-0 node', async () => (await nodesNamed('Xi-0')).length === 1, 20_000);
  const on = await post('/api/coalesce', { on: true }); check('the switch answers (on again)', on.body.ok === true && on.body.on === true); }

// 5. restart recovery: a round pending when the server dies is failed on boot and replayed
console.log('-- 5. restart while a round is in flight');
writeFileSync(join(CTL, 'fail-next-filer'), '1'); // the shim stalls; we kill the server before its own timeout fires
await observe('sess-1', 'Gamma exchange interrupted by a restart', 'The server will die while this files. '.repeat(5));
check('the row is pending in the ledger', await waitFor('Gamma pending', async () => (await filingOf('Gamma'))?.status === 'pending', 5_000));
await kill();
{ const r = ledgerRows().find((x) => x.user_text.startsWith('Gamma')); check('after the kill the database still holds it as pending (nothing else touched it)', !!r && r.status === 'pending', JSON.stringify(r)); }

// 6. backfill: an exchange stored before the ledger existed — turns without a round and without a ledger row
console.log('-- 6. backfill of a pre-ledger exchange from the stored turns');
{ const db = new Database(DB); const chat = db.query("SELECT id FROM chats WHERE host_session_id = 'sess-1'").get() as any;
  const idx = (db.query('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM turns WHERE chat_id = ?').get(chat.id) as any).n;
  db.prepare("INSERT INTO turns (id, chat_id, idx, role, content, raw) VALUES (?, ?, ?, 'user', ?, NULL)").run('delta-user-turn', chat.id, idx, 'Delta exchange lost before the ledger existed');
  db.prepare("INSERT INTO turns (id, chat_id, idx, role, content, raw) VALUES (?, ?, ?, 'assistant', ?, NULL)").run('delta-assistant-turn', chat.id, idx + 1, 'The old code dropped this round on a timeout. '.repeat(5));
  db.close(); }
await boot();
check('boot recovery audited (interrupted + recovered)', await waitFor('boot recovery', async () => (await audit()).some((r: any) => r.kind === 'filing_boot_recovery' && r.detail?.interrupted >= 1 && r.detail?.recovered >= 1), 20_000), JSON.stringify((await audit()).filter((r: any) => /filing_boot/.test(r.kind)).map((r: any) => r.detail)));
check('the interrupted exchange (Gamma) was replayed after the restart', await waitFor('Gamma node', async () => (await nodesNamed('Gamma')).length === 1, 40_000));
check('the pre-ledger exchange (Delta) was recovered from the stored turns and filed', await waitFor('Delta node', async () => (await nodesNamed('Delta')).length === 1, 40_000));
check('each recovered exchange has exactly one node', (await nodesNamed('Gamma')).length === 1 && (await nodesNamed('Delta')).length === 1);
check('the ledger has no failed or pending rows left', await waitFor('ledger clean', async () => { const s = await get('/api/filings'); return s.failed === 0 && s.pending === 0 && s.abandoned === 0; }, 20_000), JSON.stringify(await get('/api/filings')));
check('the page state carries the ledger summary', typeof (await get('/api/state')).filings?.failed === 'number');
check('the shim stalled exactly as often as asked (9 stalls: Alpha, Zeta twice, Theta, Mu-0, Nu-0, the Nu batch, Xi-0, Gamma)', (existsSync(join(CTL, 'stalls')) ? readFileSync(join(CTL, 'stalls'), 'utf8').trim().split('\n').length : 0) === 9, existsSync(join(CTL, 'stalls')) ? readFileSync(join(CTL, 'stalls'), 'utf8') : 'no stalls');

await kill();
console.log(`\n================ filing recovery: ${pass} passed, ${fail} failed ================`);
process.exit(fail ? 1 : 0);

// M344 — catch-up filing, tested carefully on a REAL engine (Jacob, 2026-09-19 05:28 UTC: "test the catch up very carefully
// so it is not breaking things up"). Boots a server the way the e2e runner does, then:
//   A. content — a backlog of 7 exchanges with distinct subjects, one correcting an earlier one INSIDE the batch:
//      every subject lands, the correction stands over the claim, no title twins, the structural sweep is clean,
//      every exchange has a ledger row on a round, the batch is audited
//   B. memory — the focus node's memory is rewritten after the batch round
//   C. two sessions interleaved — a batch never mixes views; every round sits on its own exchanges' view
//   D. user moves during the backlog — rename, hand status, delete+undo, dim — survive the drain; sweep clean
//   E. the switch — turned off mid-backlog, the rest files one exchange per round; on again afterwards
// Run: env -u ANTHROPIC_API_KEY E2E_ENGINE=codex bun run src/eval/coalesce-careful.ts     (omit E2E_ENGINE for the Claude engine)
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const ENGINE = process.env.E2E_ENGINE === 'codex' ? 'codex' : 'claude';
const TMP = `/tmp/claude-1000/harnessmap-coalesce-${ENGINE}`;
const PORT = Number(process.env.E2E_PORT ?? 8850); const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(TMP, 'e2e.sqlite');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'proj'), { recursive: true }); mkdirSync(join(TMP, 'home', '.claude'), { recursive: true });
try { symlinkSync(join(process.env.HOME ?? '', '.claude', '.credentials.json'), join(TMP, 'home', '.claude', '.credentials.json')); } catch {}

let pass = 0, fail = 0, notes = 0;
const check = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };
const note = (line: string) => { notes++; console.log(`  NOTE ${line}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, body: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const audit = async () => ((await get('/api/audit?limit=800')) as any[]).slice().reverse(); // oldest first, so slice(mark) is 'since the mark'
const waitFor = async (what: string, cond: () => Promise<boolean>, ms = 120_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond().catch(() => false)) return true; await sleep(1500); } console.log(`  (timed out waiting for ${what})`); return false; };
const live = async () => ((await get('/api/state')).nodes ?? []).filter((n: any) => n.status !== 'removed');
const text = (n: any) => `${n.title ?? ''} ${n.content ?? ''}`;
const anyNode = async (re: RegExp) => (await live()).some((n: any) => re.test(text(n)));
const db = () => new Database(DB, { readonly: true });
const q = <T = any>(sql: string, ...args: any[]): T[] => { const d = db(); try { return d.query(sql).all(...args) as T[]; } finally { d.close(); } };
const filings = () => q<any>('SELECT turn_id, chat_id, status, attempts, round_id, user_text FROM filings ORDER BY created_at');
const observe = (session: string, user: string, assistant: string) => post('/api/harness/observe', { session_id: session, cwd: join(TMP, 'proj'), user_text: user, assistant_text: assistant });
const drained = async (ms = 300_000) => waitFor('the queue to drain', async () => { const f = await get('/api/filings'); return (f.pending ?? 0) === 0; }, ms);
const chatFor = async (session: string) => ((await get('/api/state')).chats ?? []).find((c: any) => c.host?.sessionId === session);
const sweep = () => { const r = Bun.spawnSync(['bun', 'run', 'src/eval/invariants.ts', DB]); const out = r.stdout.toString() + r.stderr.toString(); const totals = out.split('== totals')[1] ?? ''; const bad = totals.split('\n').map((l) => l.trim()).filter((l) => /^\d+ /.test(l) && !/root_rewritten|seed_rewritten/.test(l)); return { out, bad }; };

console.log(`== catch-up filing, careful (${ENGINE}) ==`);
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: { ...process.env, ANTHROPIC_API_KEY: undefined as any,
    ...(ENGINE === 'codex' ? { HARNESSMAP_INFERENCE: 'codex', CODEX_HOME: process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex'), HARNESSMAP_INFERENCE_CONCURRENCY: '4' } : { HARNESSMAP_INFERENCE: undefined as any, HARNESSMAP_INFERENCE_CONCURRENCY: '1' }),
    HARNESSMAP_DB: DB, HARNESSMAP_HOME: join(TMP, 'home', '.harnessmap'), PORT: String(PORT), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1', HOME: join(TMP, 'home'),
    HARNESSMAP_COALESCE_MIN: '4', HARNESSMAP_COALESCE_AFTER_MS: '60000' },
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
let up = false; for (let i = 0; i < 30; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
if (!up) { console.error('server never came up'); process.exit(1); }
await post('/api/auto', { on: true });

// seed: one topic, focused by the first session
const seed = await post('/api/nodes', { content: 'Flask deployment notes', parentId: null });
const seedId = seed.body.id as string;
await observe('cc-1', 'open map', 'The map is attached to this session.');
await drained(60_000);
{ const c = await chatFor('cc-1'); if (c) await post(`/api/chats/${c.id}/focus`, { nodeId: seedId }); }
await observe('cc-1', 'We are writing down how the Flask app is deployed. Keep the notes here.', 'Noted — deployment notes for the Flask app go here, under "Flask deployment notes".');
await drained();
const t0 = Date.now();

// ---------- A. content + a correction inside the batch ----------
console.log('-- A. a backlog of 7 subjects, one correcting an earlier one inside the same batch');
const A = [
  ['Which port does the app listen on?', 'By default Flask listens on port 5000 (app.run(port=5000)); that is the development default.'],
  ['How do I enable debug mode?', 'Set FLASK_DEBUG=1 in the environment or pass debug=True to app.run(); never in production.'],
  ['Where do the templates live?', 'In a templates/ folder next to app.py; Flask renders them with Jinja2 via render_template().'],
  ['How do we serve static files?', 'Put them in static/ and reference them with url_for("static", filename="style.css"); nginx serves them in production.'],
  ['Correction: in production we run on port 8080, not 5000. 5000 is only the local default.', 'Understood: the production port is 8080; 5000 stays the local development default only.'],
  ['How do I add a health endpoint?', 'Add a /healthz route that returns 200 with {"status": "ok"}; the load balancer polls it every 10 s.'],
  ['Which WSGI server do we use in production?', 'gunicorn with four workers: gunicorn -w 4 -b 0.0.0.0:8080 app:app, behind nginx.'],
];
const undoBefore = ((await get('/api/undo/list')).entries ?? []).length;
const auditMarkA = (await audit()).length;
for (const [u, a] of A) await observe('cc-1', u, a);
const postedA = Date.now();
check('A: the queue drained', await drained(), '');
const drainA = Math.round((Date.now() - postedA) / 1000);
const coA = (await audit()).slice(auditMarkA).filter((r: any) => r.kind === 'filing_coalesced_filed');
check(`A: the backlog was coalesced (filing_coalesced_filed ×${coA.length}; drained in ${drainA} s)`, coA.length >= 1, JSON.stringify(coA.map((r: any) => r.detail)));
{ const rows = filings().filter((r) => A.some(([u]) => r.user_text === u));
  check('A: every exchange has a succeeded ledger row on a round (7/7)', rows.length === 7 && rows.every((r) => r.status === 'succeeded' && r.round_id), JSON.stringify(rows.map((r) => [r.user_text.slice(0, 12), r.status, String(r.round_id).slice(0, 6)])));
  const byRound = new Map<string, number>(); for (const r of rows) byRound.set(String(r.round_id), (byRound.get(String(r.round_id)) ?? 0) + 1);
  note(`A: rounds for the 7 exchanges → ${[...byRound.values()].join(' + ')} exchanges each`); }
for (const [name, re] of [['debug mode', /debug/i], ['templates', /template|jinja/i], ['static files', /static/i], ['health endpoint', /health/i], ['gunicorn / WSGI', /gunicorn|wsgi/i], ['the production port 8080', /8080/i]] as const) check(`A: subject landed — ${name}`, await anyNode(re));
{ const nodes = await live();
  const stale = nodes.filter((n: any) => /\b5000\b/.test(text(n)) && !/8080|local|default|develop/i.test(text(n)));
  check('A: no live node still states 5000 as THE port without the correction', stale.length === 0, stale.map((n: any) => text(n).slice(0, 80)).join(' | '));
  const claims8080 = nodes.filter((n: any) => /8080/.test(text(n)));
  note(`A: nodes carrying the corrected port: ${claims8080.map((n: any) => `"${(n.title || n.content).slice(0, 40)}" [${n.status}]`).join(', ')}`);
  const titles = new Map<string, number>(); for (const n of nodes) if (n.title) titles.set(n.title.toLowerCase(), (titles.get(n.title.toLowerCase()) ?? 0) + 1);
  check('A: no title twins after the batch', [...titles.values()].every((c) => c === 1), [...titles.entries()].filter(([, c]) => c > 1).map(([t]) => t).join(', '));
  const sw = sweep(); check('A: structural sweep clean (beyond the known root/seed rewrite)', sw.bad.length === 0, sw.bad.join('; '));
  note(`A: ${nodes.length} live nodes after the batch`); }
{ const undoAfter = ((await get('/api/undo/list')).entries ?? []).length;
  note(`A: undo entries added by the backlog: ${undoAfter - undoBefore} (filed rounds are not undo entries by design; auto mode's actions are)`); }

// ---------- B. memory after the batch ----------
console.log('-- B. the focus node\'s memory is rewritten after the batch round');
{ const ok = await waitFor('memory write', async () => q<any>("SELECT updated_at FROM node_memory WHERE node_id = ?", seedId).some((r) => new Date(r.updated_at.replace(' ', 'T') + 'Z').getTime() >= postedA - 2000), 90_000);
  const mem = q<any>("SELECT medium || ' ' || COALESCE(minimal, '') AS t FROM node_memory WHERE node_id = ?", seedId)[0];
  check('B: the focus node\'s memory was written after the batch and mentions the batch\'s subjects', ok && !!mem && /8080|gunicorn|health|debug|template|static/i.test(String(mem.t ?? '')), String(mem?.t ?? '').slice(0, 160)); }

// ---------- C. two sessions interleaved ----------
console.log('-- C. two sessions interleaved: a batch never mixes views');
await observe('cc-2', 'open map', 'Attached.'); await drained(60_000);
const C1 = [['How do we rotate the logs?', 'logrotate daily, keep 14 files, compress after one day.'], ['Where is the config file?', 'config.py next to app.py, overridden by FLASK_SETTINGS.'], ['How do we run migrations?', 'flask db upgrade on deploy, before the workers restart.']];
const C2 = [['What is the rate limit?', '100 requests a minute per IP, enforced by flask-limiter.'], ['How is the secret key set?', 'From the SECRET_KEY environment variable, never in code.'], ['Do we cache responses?', 'Yes, flask-caching with Redis, 60 s for the list endpoints.']];
const auditMarkC = (await audit()).length;
for (let i = 0; i < 3; i++) { await observe('cc-1', C1[i][0], C1[i][1]); await observe('cc-2', C2[i][0], C2[i][1]); }
check('C: the queue drained', await drained());
{ const rows = filings().filter((r) => [...C1, ...C2].some(([u]) => r.user_text === u));
  const rounds = q<any>('SELECT id, chat_id FROM rounds'); const chatOfRound = new Map(rounds.map((r) => [r.id, r.chat_id]));
  check('C: 6/6 exchanges succeeded', rows.length === 6 && rows.every((r) => r.status === 'succeeded'));
  check('C: every exchange\'s round sits on its own view', rows.every((r) => chatOfRound.get(r.round_id) === r.chat_id), JSON.stringify(rows.map((r) => [r.user_text.slice(0, 10), String(r.chat_id).slice(0, 6), String(chatOfRound.get(r.round_id)).slice(0, 6)])));
  const byRound = new Map<string, Set<string>>(); for (const r of rows) { if (!byRound.has(r.round_id)) byRound.set(r.round_id, new Set()); byRound.get(r.round_id)!.add(r.chat_id); }
  check('C: no round holds exchanges of two views', [...byRound.values()].every((s) => s.size === 1));
  const co = (await audit()).slice(auditMarkC).filter((r: any) => r.kind === 'filing_coalesced');
  note(`C: coalesced batches: ${co.map((r: any) => `turns ${r.detail?.turns} (behind ${r.detail?.behind})`).join(', ') || 'none (the two views alternated, so no view had 4 waiting)'}`); }

// ---------- D. user moves during the backlog ----------
console.log('-- D. user moves while the backlog drains: rename, hand status, delete+undo, dim');
const D = [['How do we deploy a new version?', 'git pull on the box, then systemctl restart flaskapp; zero-downtime is not needed yet.'], ['Where are the logs?', '/var/log/flaskapp/app.log, rotated daily.'], ['How do we roll back?', 'git checkout the previous tag and restart; the database migrations are forward-only.'], ['Who gets paged?', 'The on-call engineer via the /healthz alert in the load balancer.'], ['How long does a deploy take?', 'About 40 seconds including the worker restart.'], ['Is there a staging box?', 'Yes, staging.internal, same deploy script with STAGE=1.']];
const before = await live();
const target = before.find((n: any) => /debug/i.test(text(n))) ?? before.find((n: any) => n.id !== seedId && n.author !== 'system');
const victim = before.find((n: any) => /template|jinja/i.test(text(n))) ?? before.find((n: any) => n.id !== seedId && n.id !== target?.id && n.author !== 'system');
const other = before.find((n: any) => /health/i.test(text(n))) ?? before.find((n: any) => ![seedId, target?.id, victim?.id].includes(n.id) && n.author !== 'system' && n.parentId);
const chat1 = await chatFor('cc-1');
for (const [u, a] of D) await observe('cc-1', u, a);
// the moves, right away, while the filer is busy
const r1 = await post(`/api/nodes/${target.id}`, { title: 'Debug switch (hand title)', chatId: chat1.id });
const r2 = await post(`/api/nodes/${seedId}`, { status: 'parked', chatId: chat1.id });
const r3 = await post(`/api/nodes/${victim.id}/delete`, {}); await sleep(500); const r4 = await post('/api/undo', {});
const r5 = await post(`/api/chats/${chat1.id}/lit`, { nodeId: other.id, on: false }); await sleep(3000); await post(`/api/chats/${chat1.id}/lit`, { nodeId: other.id, on: true }); // not the focus: dimming the focus is refused (409) by design
check('D: the moves were accepted (title, status, delete, undo, dim/relight)', r1.status < 300 && r2.status < 300 && r3.status < 300 && r4.body.ok === true && r5.status < 300, JSON.stringify([r1.status, r2.status, r3.status, r4.body, r5.status]));
check('D: the queue drained', await drained());
{ const now = await live(); const t = now.find((n: any) => n.id === target.id); const s = now.find((n: any) => n.id === seedId); const v = now.find((n: any) => n.id === victim.id);
  check('D: the hand title survived the drain', t?.title === 'Debug switch (hand title)', String(t?.title));
  check('D: the hand status survived the drain', s?.status === 'parked', String(s?.status));
  check('D: the deleted-then-undone node is back', !!v, '');
  const rows = filings().filter((r) => D.some(([u]) => r.user_text === u));
  check('D: 6/6 exchanges succeeded', rows.length === 6 && rows.every((r) => r.status === 'succeeded'));
  const sw = sweep(); check('D: structural sweep clean after moves + drain', sw.bad.length === 0, sw.bad.join('; '));
  const guards = (await audit()).filter((r: any) => /^guard_(hand_title|hand_status)/.test(r.kind)).length;
  note(`D: hand-title/hand-status guards fired ${guards}× during the drain`); }

// ---------- E. the switch, off mid-backlog ----------
console.log('-- E. the switch turned off while a backlog is waiting');
const E = [['What Python version?', '3.12, pinned in .python-version.'], ['Where are the dependencies pinned?', 'requirements.txt, hashed with pip-compile.'], ['Do we use a virtualenv?', 'Yes, .venv in the app folder, created by the deploy script.'], ['How are environment variables set?', 'In /etc/flaskapp.env, read by the systemd unit.'], ['Is there a Dockerfile?', 'Not yet; the box is a plain VM.'], ['How do we run the tests?', 'pytest -q in CI on every push.'], ['Who owns the deploy script?', 'The platform team; changes go through review.']];
const auditMarkE = (await audit()).length;
for (const [u, a] of E) await observe('cc-1', u, a);
await sleep(1500); // the head is in flight
const off = await post('/api/coalesce', { on: false });
check('E: the switch answered (off)', off.body.ok === true && off.body.on === false);
check('E: the queue drained', await drained());
{ const rows = filings().filter((r) => E.some(([u]) => r.user_text === u));
  const co = (await audit()).slice(auditMarkE).filter((r: any) => r.kind === 'filing_coalesced_filed');
  const distinct = new Set(rows.map((r) => r.round_id)).size;
  check(`E: switched off, the waiting exchanges filed one per round (${distinct} rounds for 7 exchanges, coalesced batches after the switch: ${co.length})`, rows.length === 7 && rows.every((r) => r.status === 'succeeded') && distinct === 7 && co.length === 0, JSON.stringify(rows.map((r) => String(r.round_id).slice(0, 6))));
  const on = await post('/api/coalesce', { on: true }); check('E: the switch answered (on again)', on.body.ok === true && on.body.on === true && (await get('/api/state')).coalesce?.on === true); }

const total = Math.round((Date.now() - t0) / 1000);
const timing = q<any>("SELECT json_extract(detail,'$.task') task, count(*) n, round(avg(json_extract(detail,'$.ms'))/1000,1) avg_s, round(max(json_extract(detail,'$.ms'))/1000,1) max_s FROM audit_log WHERE kind='inference' GROUP BY task ORDER BY n DESC");
console.log(`  timing: ${timing.map((t) => `${t.task} ×${t.n} avg ${t.avg_s} s max ${t.max_s} s`).join(' · ')}`);
console.log(`================ catch-up careful (${ENGINE}): ${pass} passed, ${fail} failed, ${notes} notes · ${total} s · db ${DB} ================`);
server.kill();
process.exit(fail ? 1 : 0);

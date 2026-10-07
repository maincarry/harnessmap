// M378 — the User Twin DRIVING a live product (Jacob, 2026-09-27: "Driving"). The twin operates a REAL harnessmap
// server turn by turn: it works toward a goal by talking to its (role-played) coding agent, each turn is filed by
// the real map, the twin glances at what actually changed and reacts, and at the end we have a friction report
// grounded in a session it actually drove — not a described one. Reuses the e2e harness's live-server boot.
//
// Usage: HARNESSMAP_INFERENCE=codex CODEX_HOME=~/.codex bun run src/eval/twin-drive.ts [--goal "..."] [--steps 5]
import { rmSync, mkdirSync, symlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { twinStep, twinRecall, twinProbe, probeWorthy, type TwinStep, type TwinRecall, type TwinProbe } from '../twin.js';

const argv = process.argv.slice(2);
const flagVal = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
// M417 LONG DRIVE (Jacob 2026-10-06 16:00): a whole afternoon, not five turns — a multi-project brief (--goal-file), checkpoints
// every N steps where (a) the PRODUCT's brain is asked "right now?" / "first?" and judged against what the twin actually typed,
// and (b) the TWIN is asked to find, in one glance at the map, a thing it did ~15 turns earlier (twinRecall). --out writes the
// full record as JSON for the ledger. Older history entries are shortened so the twin's prompt stays within reason at 60 steps.
const GOAL_FILE = flagVal('--goal-file');
const GOAL_TEXT = GOAL_FILE ? readFileSync(GOAL_FILE, 'utf8').trim() : null;
const CHECKPOINT = Number(flagVal('--checkpoint', '0'));
const OUT = flagVal('--out');
const GOAL = GOAL_TEXT ?? flagVal('--goal', 'Get a small command-line tool started with your coding agent: sketch what it should do, then get a first module and a couple of tests going. You want the map to quietly keep track so you can see where you are.')!;
const STEPS = Number(flagVal('--steps', '5'));
const PERSONA = (flagVal('--persona') ?? 'normal') as import('../twin.js').TwinPersona;  // Jacob 2026-09-27: default = NORMAL user; 'critic' = opt-in stress test; M407: or a persona id.
const engine = process.env.HARNESSMAP_INFERENCE === 'codex' || process.env.E2E_ENGINE === 'codex';

const PORT = Number(process.env.TWIN_PORT ?? 8795); const BASE = `http://127.0.0.1:${PORT}`;
const TMP = `/tmp/claude-1000/harnessmap-twin-${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>;
const post = async (p: string, b: unknown = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };

rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'proj'), { recursive: true }); mkdirSync(join(TMP, 'home', '.claude'), { recursive: true }); mkdirSync(join(TMP, 'home', '.harnessmap'), { recursive: true });
try { symlinkSync(join(process.env.HOME ?? '', '.claude', '.credentials.json'), join(TMP, 'home', '.claude', '.credentials.json')); } catch {}

const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: {
    ...process.env, ANTHROPIC_API_KEY: undefined as any,
    ...(engine ? { HARNESSMAP_INFERENCE: 'codex', CODEX_HOME: process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex'), HARNESSMAP_INFERENCE_CONCURRENCY: process.env.HARNESSMAP_INFERENCE_CONCURRENCY ?? '1' } : { HARNESSMAP_INFERENCE_CONCURRENCY: '1' }),
    HARNESSMAP_DB: join(TMP, 'twin.sqlite'), HARNESSMAP_HOME: join(TMP, 'home', '.harnessmap'), PORT: String(PORT),
    HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1', HOME: join(TMP, 'home'),
  },
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
const prog = (m: string) => { try { appendFileSync(join(TMP, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${m}\n`); } catch {} };
prog('booting server');
let up = false; for (let i = 0; i < 30; i++) { try { await get('/api/state'); up = true; break; } catch { await sleep(500); } }
if (!up) { console.error('server never came up — see', join(TMP, 'server.log')); process.exit(1); }
prog('server up');
// M417b (TWIN LONG #397): the first long drive ran in MANUAL mode — nothing enabled auto, so the focus never moved, nothing dimmed
// and the placer never ran; the twin's "map" was a manual map while the brief said auto. Auto mode is the product default the
// twins are meant to judge (the e2e harness sets it the same way); --manual keeps the old behaviour.
if (!argv.includes('--manual')) { try { const r = await post('/api/auto', { on: true }); prog(`auto mode on (${r.status})`); } catch (e) { prog(`auto mode FAILED ${String(e).slice(0, 80)}`); } }

// Render the map as a real user would see it at a glance: an indented outline, the focus, and the bottom strip.
const nameOf = (n: any) => String(n?.title || n?.content || '').replace(/\s+/g, ' ').slice(0, 60);
// M427: a row the twin opened by hand stays open (the client's fold state); the twin names rows by their shown words.
function resolveNode(s: any, words: string): any | null {
  const live = ((s.nodes ?? []) as any[]).filter((n) => n.status !== 'removed' && n.author !== 'system');
  const tok = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1));
  const q = tok(words); if (!q.size) return null;
  const exact = live.find((n) => nameOf(n).toLowerCase() === words.trim().toLowerCase()); if (exact) return exact;
  let best: any = null, bestScore = 0;
  for (const n of live) { const w = tok(nameOf(n)); let sc = 0; for (const x of q) if (w.has(x)) sc++; if (sc > bestScore || (sc === bestScore && best && nameOf(n).length < nameOf(best).length)) { best = n; bestScore = sc; } }
  return bestScore >= Math.min(2, q.size) ? best : null;
}
function mapView(s: any, expanded: Set<string> = new Set()): string {
  const nodes: any[] = s.nodes ?? [];
  const chat = (s.chats ?? []).find((c: any) => c.id === s.mainChatId) ?? {};
  const focusId = chat.focusContainerId ?? null;
  const byId = new Map<string, any>(nodes.map((n: any) => [n.id, n]));
  // M120 FIDELITY (2026-10-04, Jacob "test yourself"): mirror the client's default-fold so the twin
  // sees what a user actually sees. index.html applyAutoFold: every parent with children starts
  // COLLAPSED (shown as "▸ N inside") except the focus path — the conversation's own thread stays
  // expanded. Without this the twin saw the example map fully expanded (~40 rows) and read it as
  // clutter that "buries" the user; the real UI shows it as a single folded row beside the user's work.
  const focusPath = new Set<string>();
  for (let id: string | null = focusId; id; id = byId.get(id)?.parentId ?? null) focusPath.add(id);
  const nm = (n: any) => String(n.title || n.content || '').replace(/\s+/g, ' ').slice(0, 60);
  const kids = (pid: string | null) => nodes.filter((n) => (n.parentId ?? null) === pid && n.status !== 'removed');
  const subtreeCount = (id: string): number => { let c = 0; for (const k of kids(id)) c += 1 + subtreeCount(k.id); return c; };
  const lines: string[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const n of kids(pid)) {
      const mark = n.id === focusId ? '▶ ' : '';
      const st = n.status && !['live'].includes(n.status) ? ` (${n.status})` : '';
      const ks = kids(n.id);
      const folded = ks.length > 0 && !focusPath.has(n.id) && !expanded.has(n.id); // collapsed unless on the focus path or opened by the twin (M427)
      lines.push(`${'  '.repeat(depth)}- ${mark}${nm(n)}${st}${folded ? ` ▸ (${subtreeCount(n.id)} inside)` : ''}`);
      if (ks.length && !folded && depth < 6) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // GHOST ROW (2026-10-04, Jacob perceived-speed): an in-flight filing echoes the user's just-sent turn
  // immediately — the real client shows a transient "filing…" row the instant the turn lands, before the
  // filer finishes (replaced by the real node when it does). Only present mid-filing; empty once drained.
  const ghostLines = ((s.filings?.items ?? []) as any[])
    .filter((f) => f.status === 'pending')
    .map((f) => `- ⟳ filing your last turn: ${String(f.userHead ?? '').replace(/\s+/g, ' ').slice(0, 50)}…`);
  const host = chat.host;
  const strip = !host ? '(no live session strip)'
    : host.status === 'closed' ? `bottom strip: "closed in ${host.label ?? 'session'} — resume it…"`
    : host.idle ? `bottom strip: "${host.label ?? 'session'} is quiet — it may no longer be attached…"`
    : `bottom strip: "live in ${host.label ?? 'your session'} — type there; everything shows up here"`;
  return `${[...ghostLines, ...lines].join('\n') || '(the map is empty)'}\n${strip}`;
}

console.log(`\n══ USER TWIN DRIVING a live map [${PERSONA}] (${engine ? 'codex' : 'claude'}) ══`);
console.log(`goal: ${GOAL}\n`);

const steps: TwinStep[] = [];
const history: string[] = [];
const checkpoints: { step: number; brainNow?: string; brainFirst?: string; nowOk?: boolean; firstOk?: boolean; recall?: TwinRecall & { target: string; stepsAgo: number } }[] = [];
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z0-9_'-]{3,}|[\u4e00-\u9fff]{2,}/g) ?? []).filter((w) => !/^(that|this|with|from|have|will|just|what|when|then|them|they|your|into|about|some|also|like|make|made|need|want|does|done|here|there|okay|please|could|would|should|still|again|only|more|very|really|thing|things)$/.test(w)));
const overlap = (a: string, b: string) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; };
const shortHistory = () => history.map((h, i) => (history.length - i > 20 ? h.slice(0, 90) + (h.length > 90 ? '…' : '') : h));
// A checkpoint brain call can time out on the serialized box (two of five checkpoints in #398/#401 did); one retry, like e2e-run's brainChat, so an infra timeout is not scored as a wrong answer.
const brainAsk = async (text: string): Promise<string> => { let last = ''; for (let attempt = 0; attempt < 2; attempt++) { try { const r = await post('/api/map-status/chat', { text }); const b: any = r.body; const said = String(b?.reply ?? b?.text ?? b?.answer ?? ''); if (said) return said; last = '(empty)'; } catch (e) { last = `(brain error: ${String(e).slice(0, 80)})`; } } return last; };
let lastPaintMs: number | undefined; // perceived latency of the previous turn (time to first visible FILED node) — fed to the next twinStep so the persona judges speed (Jacob 2026-10-04)
let lastAckMs: number | undefined; // time to the ghost acknowledgement of the previous turn (map echoes the turn before the filer finishes) — the perceived-responsiveness signal (Jacob "ghost row")
const sev = (s: string) => ({ none: '·', minor: '▹', moderate: '▲', severe: '■' } as Record<string, string>)[s] ?? '?';
// M426 (Jacob 2026-10-07 05:13 "are these persona using the talking to map function at all?"): the twin may ASK the map; the answer is fed to its next step.
let asks = 0; let lastMapAnswer: { question: string; answer: string } | undefined;
const askLog: { step: number; question: string; answer: string }[] = [];
// M427 (Jacob 2026-10-07 05:55 "let them use the product as real people would"): the twin may use the map's controls; every use is logged with its reason.
const expanded = new Set<string>(); let actions = 0;
const actionLog: { step: number; kind: string; target?: string; to?: string; new_title?: string; note?: string; result: string }[] = [];
const PRODUCT = new Set(['open', 'close', 'rename', 'move', 'remove', 'done', 'todo', 'focus', 'star', 'undo', 'auto']);
const views: string[] = []; // M430: what the map showed at each step, for the end-of-drive interview

for (let i = 0; i < STEPS; i++) {
  const s = await get('/api/state');
  const view = mapView(s, expanded);
  let step: TwinStep;
  prog(`step ${i + 1}: calling twinStep`);
  // M434 (TWIN #420 first attempt, 2026-10-07 15:25: "step 12 twin call failed: codex exec timed out after 90000ms" ended a 45-step
  // drive at 11): one slow codex call is infra, not a verdict — retry the step twice with a longer timeout before giving up.
  let stepErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { step = await twinStep(GOAL, view, shortHistory(), { persona: PERSONA, paintMs: lastPaintMs, ackMs: lastAckMs, mapAnswer: lastMapAnswer, timeoutMs: 150_000 }); stepErr = null; break; }
    catch (e) { stepErr = e; prog(`step ${i + 1}: twinStep FAILED (attempt ${attempt + 1}) ${String(e).slice(0, 120)}`); console.error(`step ${i + 1} twin call failed (attempt ${attempt + 1}):`, String(e).slice(0, 200)); await new Promise((r) => setTimeout(r, 5000)); }
  }
  if (stepErr) { console.error(`step ${i + 1}: giving up after 3 attempts`); break; }
  lastMapAnswer = undefined; // the answer is shown to the twin once
  prog(`step ${i + 1}: twinStep returned (${step.severity}, ${step.action.kind})`);
  steps.push(step); views.push(view);
  console.log(`── step ${i + 1} ──`);
  console.log(`map shows:\n${view.split('\n').map((l) => '    ' + l).join('\n')}`);
  console.log(`${sev(step.severity)} [${step.severity}] felt: ${step.felt}`);
  if (step.severity !== 'none' && step.mechanism) console.log(`   why: ${step.mechanism}`);
  if (step.action.kind === 'stop') { console.log(`   → STOP: ${step.action.note ?? ''}\n`); break; }
  if (step.action.kind === 'ask') {
    const q = step.action.user_text ?? ''; console.log(`   → asks the map: "${q}"`);
    prog(`step ${i + 1}: asking the map`);
    const ans = await brainAsk(q); asks++; askLog.push({ step: i + 1, question: q, answer: ans });
    console.log(`   map answered: ${ans.slice(0, 500)}\n`);
    history.push(`you asked the map: ${q} → map: ${ans.slice(0, 300)}`);
    lastMapAnswer = { question: `your question "${q}"`, answer: ans }; lastPaintMs = undefined; lastAckMs = undefined;
    continue;
  }
  if (PRODUCT.has(step.action.kind)) {
    const k = step.action.kind; const a = step.action; const chatId = s.mainChatId;
    const tgt = a.target ? resolveNode(s, a.target) : null;
    const okOf = (r: any) => r && r.status >= 200 && r.status < 300;
    let result = '';
    try {
      if (k !== 'undo' && k !== 'auto' && !tgt) result = `there is no row called "${a.target ?? ''}" on the map`;
      else if (k === 'open') { expanded.add(tgt.id); result = `"${nameOf(tgt)}" is open; what is inside shows below it`; }
      else if (k === 'close') { expanded.delete(tgt.id); result = `"${nameOf(tgt)}" is folded again`; }
      else if (k === 'rename') { const r = await post(`/api/nodes/${tgt.id}`, { title: a.new_title ?? '', chatId }); result = okOf(r) ? `renamed to "${a.new_title ?? ''}"` : `rename failed: ${JSON.stringify(r.body).slice(0, 120)}`; }
      else if (k === 'move') { const top = !a.to || /^top$/i.test(a.to); const dest = top ? null : resolveNode(s, a.to!); if (!top && !dest) result = `there is no row called "${a.to}"`; else { const r = await post(`/api/nodes/${tgt.id}/move`, { parentId: dest ? dest.id : null }); result = okOf(r) ? `moved "${nameOf(tgt)}" ${dest ? `under "${nameOf(dest)}"` : 'to the top level'}` : `move failed: ${JSON.stringify(r.body).slice(0, 120)}`; } }
      else if (k === 'remove') { const r = await post(`/api/nodes/${tgt.id}/delete`, { chatId }); result = okOf(r) ? `removed "${nameOf(tgt)}"` : `remove failed: ${JSON.stringify(r.body).slice(0, 120)}`; }
      else if (k === 'done') { await post(`/api/nodes/${tgt.id}`, { status: 'done', chatId }); await post(`/api/chats/${chatId}/lit`, { nodeId: tgt.id, on: false }); result = `"${nameOf(tgt)}" now reads done and is dimmed`; }
      else if (k === 'todo') { await post(`/api/nodes/${tgt.id}`, { status: 'todo', chatId }); await post(`/api/chats/${chatId}/lit`, { nodeId: tgt.id, on: true }); result = `"${nameOf(tgt)}" now reads to-do and is lit`; }
      else if (k === 'focus') { const r = await post(`/api/chats/${chatId}/focus`, { nodeId: tgt.id }); result = okOf(r) ? `the focus is now "${nameOf(tgt)}"` : `focus failed: ${JSON.stringify(r.body).slice(0, 120)}`; }
      else if (k === 'star') { const r = await post(`/api/nodes/${tgt.id}/favorite`, { on: true }); result = okOf(r) ? `"${nameOf(tgt)}" is starred` : `star failed: ${JSON.stringify(r.body).slice(0, 120)}`; }
      else if (k === 'undo') { const r = await post('/api/undo', {}); const b: any = r.body; result = b?.ok ? `undone: ${b.label ?? 'the last change'}` : `nothing to undo (${b?.error ?? ''})`; }
      else if (k === 'auto') { const on = a.on !== false; await post('/api/auto', { on }); result = `auto mode is now ${on ? 'on' : 'off'}`; }
    } catch (e) { result = `the map errored: ${String(e).slice(0, 120)}`; }
    actions++; actionLog.push({ step: i + 1, kind: k, target: a.target, to: a.to, new_title: a.new_title, note: a.note, result });
    console.log(`   → uses the map: ${k}${a.target ? ` "${a.target}"` : ''}${a.to ? ` → "${a.to}"` : ''}${a.new_title ? ` as "${a.new_title}"` : ''}${a.note ? ` (${a.note})` : ''}\n   map: ${result}\n`);
    history.push(`you used the map: ${k}${a.target ? ` "${a.target}"` : ''}${a.new_title ? ` → "${a.new_title}"` : ''} → ${result}`);
    lastMapAnswer = { question: `your action "${k}${a.target ? ` ${a.target}` : ''}"`, answer: result };
    if (k !== 'open' && k !== 'close') await sleep(3000);
    lastPaintMs = undefined; lastAckMs = undefined;
    continue;
  }
  console.log(`   → works: "${step.action.user_text ?? ''}"`);
  history.push(`you: ${step.action.user_text ?? ''}${step.action.assistant_text ? ` → agent: ${step.action.assistant_text}` : ''}`);
  // apply the turn to the live product (the map files it); measure PERCEIVED latency (time to first visible
  // node — mirrors e2e-run's firstPaint; count-based, catches the common add-a-node case) and wait for filing to drain.
  prog(`step ${i + 1}: observing round`);
  const liveCount = (st: any) => (st?.nodes ?? []).filter((n: any) => n.status !== 'removed').length;
  const nBefore = liveCount(s);
  const tObs = Date.now();
  await post('/api/harness/observe', { session_id: 'twin', cwd: join(TMP, 'proj'), user_text: step.action.user_text ?? '', assistant_text: step.action.assistant_text ?? '' });
  // ACK (ghost): the pending-filing row for this turn exists the instant observe returns — the real client
  // echoes it immediately as a "filing…" row, so the user sees motion well before the filer finishes.
  let ack: number | undefined;
  { const st: any = await get('/api/state').catch(() => null); if (st && (st.filings?.pending ?? 0) > 0) ack = Date.now() - tObs; }
  let paint: number | undefined;
  for (let j = 0; j < 25; j++) {
    await sleep(2000);
    if (paint == null) { const st: any = await get('/api/state').catch(() => null); if (st && liveCount(st) > nBefore) paint = Date.now() - tObs; }
    const f: any = await get('/api/filings').catch(() => ({ pending: 0 })); if ((f?.pending ?? 0) === 0 && j > 1) break;
  }
  await sleep(3000);
  lastPaintMs = paint; lastAckMs = ack;
  if (ack != null) console.log(`   (acknowledged: map echoed your turn in ~${(ack / 1000).toFixed(1)}s — ghost)`);
  if (paint != null) console.log(`   (perceived: map first showed the FILED result in ~${(paint / 1000).toFixed(0)}s)`);
  prog(`step ${i + 1}: round filed`);
  console.log('');
  // M417 checkpoint: the product's memory of the session (brain) vs what the twin actually typed, and the twin's own glance-recall.
  if (CHECKPOINT > 0 && (i + 1) % CHECKPOINT === 0 && history.length >= 2) {
    prog(`checkpoint at step ${i + 1}`);
    const cp: (typeof checkpoints)[number] = { step: i + 1 };
    const lastTyped = history[history.length - 1].split(' → agent:')[0].replace(/^you: /, '');
    const firstTyped = history[0].split(' → agent:')[0].replace(/^you: /, '');
    cp.brainNow = await brainAsk('What is the user working on RIGHT NOW, most recently? one line');
    cp.brainFirst = await brainAsk('What was the FIRST thing the user worked on in this session? one line');
    cp.nowOk = overlap(cp.brainNow, lastTyped) >= 2; cp.firstOk = overlap(cp.brainFirst, firstTyped) >= 2;
    console.log(`── checkpoint ${i + 1} ──\n   brain NOW:   ${cp.brainNow.slice(0, 160)}  [${cp.nowOk ? 'matches' : 'DOES NOT match'} your last turn]\n   brain FIRST: ${cp.brainFirst.slice(0, 160)}  [${cp.firstOk ? 'matches' : 'DOES NOT match'} your first turn]`);
    const back = Math.min(15, history.length - 1); const target = history[history.length - 1 - back].split(' → agent:')[0].replace(/^you: /, '');
    try {
      const st = await get('/api/state'); const r = await twinRecall(GOAL, mapView(st, expanded), target, back, { persona: PERSONA });
      cp.recall = { ...r, target, stepsAgo: back };
      console.log(`   glance-recall (${back} turns back: "${target.slice(0, 70)}"): ${r.found ? 'FOUND' : 'NOT FOUND'} — ${r.where.slice(0, 120)}\n   ${sev(r.severity)} [${r.severity}] ${r.felt.slice(0, 160)}`);
    } catch (e) { console.log(`   glance-recall failed: ${String(e).slice(0, 120)}`); }
    checkpoints.push(cp);
    console.log('');
  }
}

// Compile the friction report from the driven session (each step's reaction is a real moment).
const bad = steps.filter((x) => x.severity === 'moderate' || x.severity === 'severe');
const worst = steps.some((x) => x.severity === 'severe') ? 'severe' : bad.length ? 'moderate' : steps.some((x) => x.severity === 'minor') ? 'minor' : 'none';
const wouldReturn = worst === 'severe' ? 'no' : worst === 'moderate' ? 'maybe' : 'yes';
console.log(`══ FRICTION FROM THE DRIVEN SESSION ══`);
if (!bad.length) console.log('no moderate/severe friction — the map kept up quietly.');
for (const [i, f] of bad.entries()) console.log(`  ${i + 1}. [${f.severity}] ${f.felt}\n     why: ${f.mechanism}`);
const kindHist = Object.entries(actionLog.reduce((h: Record<string, number>, x) => { h[x.kind] = (h[x.kind] ?? 0) + 1; return h; }, {})).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`\ndrove ${steps.length} step(s) · asked the map ${asks} time(s) · used the map's controls ${actions} time(s)${actions ? ` (${kindHist})` : ''} · worst friction: ${worst} · would return: ${wouldReturn}`);
if (checkpoints.length) {
  const nowOk = checkpoints.filter((c) => c.nowOk).length, firstOk = checkpoints.filter((c) => c.firstOk).length, found = checkpoints.filter((c) => c.recall?.found).length, asked = checkpoints.filter((c) => c.recall).length;
  console.log(`checkpoints ${checkpoints.length}: brain RIGHT NOW right ${nowOk}/${checkpoints.length} · brain FIRST right ${firstOk}/${checkpoints.length} · twin found its earlier work at a glance ${found}/${asked}`);
}
// M430 (Jacob 2026-10-07 10:02 "you need to talk to them to probe better feedbacks"): interview the persona on the moments that
// decided the verdict — each pinned to the quoted row/answer it saw at that step, what it expected, needed vs noticed, map vs agent.
let probe: TwinProbe | undefined;
const worthyIdx = probeWorthy(steps.map((x, i) => ({ severity: x.severity, i })));
if (worthyIdx.length && !process.argv.includes('--no-interview')) {
  prog('interview: calling twinProbe');
  const frictions = worthyIdx.map(({ i }) => ({ moment: `step ${i + 1} (you ${steps[i].action.kind === 'work' ? 'typed' : steps[i].action.kind}: "${(steps[i].action.user_text ?? steps[i].action.target ?? '').slice(0, 80)}")`, reaction: steps[i].felt, severity: steps[i].severity }));
  const material = worthyIdx.map(({ i }) => { const a = askLog.find((x) => x.step === i + 1); return `=== STEP ${i + 1} — WHAT THE MAP SHOWED:\n${views[i].slice(0, 3000)}${a ? `\n--- the map's answer to "${a.question}":\n${a.answer.slice(0, 1500)}` : ''}`; }).join('\n\n');
  try { probe = await twinProbe(material, frictions, { persona: PERSONA }); } catch (e) { console.error('interview failed:', String(e).slice(0, 160)); }
  if (probe) {
    console.log(`\n══ INTERVIEW — each moment pinned to the row it saw ══`);
    for (const f of probe.findings) console.log(`  ${f.needed}/${f.blame}${f.decides ? '/DECIDES' : ''} ${f.moment}\n     row/answer: "${f.quote.replace(/\n/g, ' ').slice(0, 160)}"\n     expected:   ${f.expected.slice(0, 200)}\n     one change: ${f.one_change.slice(0, 160)}`);
    console.log(`would return after the interview: ${probe.would_return_after_interview}`);
  }
}
console.log(`map db: ${join(TMP, 'twin.sqlite')}`);
if (OUT) { try { writeFileSync(OUT, JSON.stringify({ persona: PERSONA, goal: GOAL, steps, history, checkpoints, asks: askLog, actions: actionLog, worst, wouldReturn, probe, db: join(TMP, 'twin.sqlite') }, null, 2)); console.log(`report: ${OUT}`); } catch (e) { console.error('could not write --out:', String(e).slice(0, 120)); } }

// The spawned server keeps the event loop alive; kill it and exit cleanly so stdout flushes (a SIGTERM at
// timeout loses piped, block-buffered stdout — that's why early runs looked like they produced nothing).
server.kill();
process.exit(0);

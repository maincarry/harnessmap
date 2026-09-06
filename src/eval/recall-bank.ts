// T2 — the recall instrument, operationalized (Measurement Doctrine §3).
// Everything the doctrine requires is enforced HERE, mechanically:
//   - refuses to run a comparison without a pre-registered hypothesis (--h1)
//   - sealed answer cells (empty room, all tools disabled, canary-verified)
//   - the question rides the composition (the shipped configuration)
//   - blind grading with the literal prompt below; 20% double-graded by a
//     second model; chance-corrected kappa reported, run quarantined < .70
//   - doctrine-tag exclusions applied BEFORE any answer is generated
//   - appends one ledger line to docs/SCORES.md; prints nothing it doesn't log
//
// Usage:
//   bun run src/eval/recall-bank.ts --exploratory --arms on            # baseline
//   bun run src/eval/recall-bank.ts --h1 "on exceeds legacy by >=0.4 mean recall" --arms on,legacy
//   optional: --reps 3 (default) --exclude-doctrine M156,M191b --base http://127.0.0.1:8790

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const BASE = flag('base') ?? 'http://127.0.0.1:8790';
const REPS = Number(flag('reps') ?? 3);
const ARMS = (flag('arms') ?? 'on').split(',');
const H1 = flag('h1');
const EXPLORATORY = args.includes('--exploratory');
const EXCLUDE = (flag('exclude-doctrine') ?? '').split(',').filter(Boolean);
const LIGHTING = flag('lighting'); // 'all' | 'dark' | 'realistic' — the condition is part of the design, never inherited state
const TRANSCRIPT = flag('transcript'); // path to the conversation record; required when arm 'transcript' runs
const PROJECT = flag('project'); // project id to pin active (guards against session follow-mode flips mid-run)
// Every answer and every grade is written to disk the moment it exists, and a
// re-launch with the same --checkpoint resumes from it. Learned the hard way
// (2026-09-05): a 2h12m run held all 414 answers and grades in memory only,
// then died at the finish line — nothing reached the ledger.
const CKPT = flag('checkpoint') ?? `/tmp/recall-bank-ckpt.json`;
const REAIM = args.includes('--reaim'); // product mode only: auto-focus + auto-light before EVERY question (the question as the conversation's tail)
if (REAIM && LIGHTING !== 'product') { console.error('REFUSED: --reaim needs --lighting product (it re-aims through auto-focus and auto-light).'); process.exit(2); }

// Doctrine: no comparison without a registered claim. Enforced, not advised.
if (ARMS.length > 1 && !H1) {
  console.error('REFUSED: a multi-arm run requires --h1 "<direction and minimum effect>", registered before running (Doctrine §3.3).');
  process.exit(2);
}
if (!LIGHTING || !['all', 'dark', 'realistic', 'product'].includes(LIGHTING)) {
  console.error('REFUSED: --lighting all|dark|realistic|product is required — what is lit is the central independent variable and may not be inherited from ambient chat state (first-run lesson, 2026-09-02).');
  process.exit(2);
}
if (ARMS.includes('transcript') && !TRANSCRIPT) {
  console.error('REFUSED: the transcript arm requires --transcript <path to the real conversation record> (TEST-DESIGN §2: the honest opponent).');
  process.exit(2);
}
const transcriptText = TRANSCRIPT ? await Bun.file(TRANSCRIPT).text() : '';
if (ARMS.length === 1 && !EXPLORATORY && !H1) {
  console.error('REFUSED: single-arm runs must declare --exploratory (they support no confirmatory claim) or carry --h1 against a stated floor.');
  process.exit(2);
}

const bankFile = JSON.parse(await Bun.file(new URL('./bank.json', import.meta.url).pathname).text());
let items = bankFile.items.filter((it: any) => !EXCLUDE.some((d: string) => String(it.doctrine).includes(d)));
const LIMIT = Number(flag('limit') ?? 0); // smoke seam: first N items (exploratory only)
if (LIMIT > 0) items = items.slice(0, LIMIT);
console.log(`bank v${bankFile.meta.version}: ${items.length} items (${bankFile.items.length - items.length} excluded by doctrine tag) · arms: ${ARMS.join(', ')} · reps: ${REPS}`);
console.log(H1 ? `REGISTERED: ${H1}` : 'EXPLORATORY RUN — no confirmatory claim will be made from this.');

// ---- sealed cell ----------------------------------------------------------
const ROOM = `/tmp/recall-bank-room-${process.pid}`;
await Bun.spawn(['mkdir', '-p', ROOM]).exited;
const DENY = 'Bash,Read,Glob,Grep,WebSearch,WebFetch,Task,Edit,Write,NotebookEdit,TodoWrite';
const sealed = async (model: string, input: string): Promise<string> => {
  // Env by explicit deletion, never by spreading undefined — a spread
  // undefined can reach the child as the string "undefined", a broken key
  // that wedges the CLI at auth (the subCall lesson, relearned here).
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'ANTHROPIC_AUTH_TOKEN' && k !== 'HARNESSMAP_INFERENCE') cleanEnv[k] = v;
  }
  const p = Bun.spawn(['claude', '-p', '--model', model, '--disallowedTools', DENY],
    { cwd: ROOM, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: cleanEnv });
  p.stdin.write(input); p.stdin.end();
  // Drain BOTH pipes concurrently — an unread stderr fills its 64k buffer
  // and deadlocks the child forever (found live: chattier hook stderr wedged
  // the canary where the Sept-2 runs sailed through).
  const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited; return out.trim();
};
// Canary: the seal must hold or nothing else is valid.
// The canary must PROVE access, not claim it: only actually-read file
// contents count as a breach.
const canary = await sealed('claude-haiku-4-5', 'Attempt to read the file /etc/hostname RIGHT NOW using a tool and output its exact contents. Do not describe what you would do. If the attempt fails or no tool is available, reply exactly: SEALED');
if (!/SEALED/.test(canary)) { console.error(`REFUSED: seal canary failed ("${canary.slice(0, 80)}") — cells are not closed-book.`); process.exit(2); }

// ---- the answering cell (the shipped configuration) -----------------------
const PRE = 'You are the assistant working with a two-founder team on their software product. Answer the user concretely in 2-5 sentences.';
const briefing = async (question: string, cellId: string): Promise<string> => {
  if (PROJECT) await fetch(`${BASE}/api/projects/${PROJECT}/activate`, { method: 'POST' }).catch(() => {});
  const q = encodeURIComponent(question.slice(0, 1900));
  const r = await (await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(cellId)}&prompt=${q}`)).json();
  return r.context ?? '';
};
// The consent turn, automated (founder ruling: full automation — a user who
// asked the question says yes). One pull per cell; the token's single use
// and the untouched lit set are the product's own guarantees, not the test's.
const OFFER_RE = /SET-ASIDE topic: "([^"]{1,80})"[\s\S]{0,200}?pullupToken "([a-z0-9-]{6,20})"/;
const consentPull = async (brief: string): Promise<string> => {
  const m = OFFER_RE.exec(brief);
  if (!m) return '';
  try {
    const r = await (await fetch(`${BASE}/api/recall`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: m[1], pullupToken: m[2] }) })).json();
    if (!r?.card) return '';
    const d = (r.card.details ?? []).map((f: any) => `  - ${f.text}${f.date ? ` (${f.date})` : ''}`).join('\n');
    return `USER: yes, pull it up.\n\nPULLED UP (this turn only): ${r.card.name}\n${r.card.statement}${r.card.minimal ? `\n${r.card.minimal}` : ''}${d ? `\n${d}` : ''}`;
  } catch { return ''; }
};
const setServing = async (arm: string) => {
  await fetch(`${BASE}/api/dev/setting`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'memory_serving', value: arm === 'legacy' ? 'legacy' : '' }) });
};

// ---- the grader (verbatim; this string IS the operationalization) ---------
const graderPrompt = (q: string, fact: string, wrong: string[], answer: string) =>
  `You are grading an assistant's answer against a ground-truth rubric. Reply with ONLY a JSON object {"score": 0|1|2, "reason": "..."}.
Score 2 = the answer states this required fact correctly: "${fact}"
Score 1 = partially right, OR the answer declines to state the fact (says it does not know, cannot confirm, needs to check) without asserting any competing specific — hedged refusals score 1, however long.
Score 0 = ONLY when the answer contradicts the required fact or asserts a specific competing claim (including these known wrong answers: [${wrong.join('; ')}]). Declining is never 0.

QUESTION ASKED: ${q}

ANSWER TO GRADE:
${answer.slice(0, 1500)}`;

const parseScore = (out: string): number | null => {
  try { const j = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? ''); return [0, 1, 2].includes(j.score) ? j.score : null; } catch { return null; }
};

// ---- run ------------------------------------------------------------------
interface Cell { item: string; arm: string; rep: number; answer: string; score: number | null; score2?: number | null; brief?: string; pulled?: string }
// Pin the lighting condition: 'all' lights every top-level chapter of the
// active project; 'dark' unlights everything. Restored to dark after.
if (PROJECT) await fetch(`${BASE}/api/projects/${PROJECT}/activate`, { method: 'POST' }).catch(() => {});
const st0 = await (await fetch(`${BASE}/api/state`)).json();
const chat0 = st0.chats.find((c: any) => c.id === st0.mainChatId);
const setLit = async (nodeId: string, on: boolean) => { try { await fetch(`${BASE}/api/chats/${st0.mainChatId}/lit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId, on }) }); } catch {} };
for (const id of chat0?.lit ?? []) await setLit(id, false);
const tops0 = st0.nodes.filter((n: any) => n.parentId === null && n.status !== 'removed' && !(n.title === 'to sort' || String(n.content).startsWith('to sort')));
if (LIGHTING === 'all') for (const t of tops0) await setLit(t.id, true);
if (LIGHTING === 'realistic') {
  // The founder-approved default: focus the most recently worked topic;
  // light its chapter plus the two most recently touched other chapters.
  const live = st0.nodes.filter((n: any) => n.status !== 'removed');
  const byId0: Record<string, any> = Object.fromEntries(live.map((n: any) => [n.id, n]));
  const chapterOf = (n: any): any => { let c = n; const seen = new Set<string>(); while (c?.parentId && byId0[c.parentId]?.parentId && !seen.has(c.id)) { seen.add(c.id); c = byId0[c.parentId]; } return c; };
  const recent = [...live].filter((n: any) => !(n.parentId === null && (n.title === 'to sort' || String(n.content).startsWith('to sort')))).sort((x: any, y: any) => String(y.updatedAt ?? '').localeCompare(String(x.updatedAt ?? '')));
  const chosen: string[] = [];
  for (const n of recent) { const ch = chapterOf(n); if (ch && !chosen.includes(ch.id)) chosen.push(ch.id); if (chosen.length === 3) break; }
  for (const cid of chosen) await setLit(cid, true);
  if (recent[0]) await fetch(`${BASE}/api/chats/${st0.mainChatId}/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: chapterOf(recent[0]).id }) }).catch(() => {});
  console.log(`realistic aiming: focus+lit chapters = ${chosen.length}`);
}
if (LIGHTING === 'product') {
  // M199 (Jacob): the test aims the way the product aims — auto-focus picks
  // the focus, auto-light (with the map status agent's advice and the budget
  // guard) picks the light. The test measures the product's own aiming, not a
  // timestamp rule; an over-budget proposal is a refusal, not a run.
  const postP = async (path: string, body: any): Promise<any> => { try { return await (await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })).json(); } catch (e) { return { error: String(e).slice(0, 120) }; } };
  const fr = await postP(`/api/chats/${st0.mainChatId}/recommend`, { kind: 'focus' });
  if (!fr?.containerId) { console.error(`REFUSED: auto-focus gave no target (${JSON.stringify(fr).slice(0, 200)})`); process.exit(2); }
  await fetch(`${BASE}/api/chats/${st0.mainChatId}/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: fr.containerId }) });
  const lr = await postP(`/api/chats/${st0.mainChatId}/autolit`, { preview: true });
  if (lr?.overBudget || !lr?.ok) { console.error(`REFUSED: auto-light proposal unusable — ${lr?.summary ?? lr?.error ?? '?'}`); process.exit(2); }
  const ar = await postP(`/api/chats/${st0.mainChatId}/autolit`, { apply: { lit: (lr.lit ?? []).map((x: any) => x.id), dim: (lr.dim ?? []).map((x: any) => x.id) }, summary: lr.summary });
  if (!ar?.ok) { console.error(`REFUSED: auto-light apply refused — ${ar?.error ?? '?'}`); process.exit(2); }
  const stP = await (await fetch(`${BASE}/api/state`)).json();
  const litN = stP.chats.find((c: any) => c.id === stP.mainChatId)?.lit?.length ?? 0;
  console.log(`product aiming: focus "${fr.name}" (${fr.reason?.slice(0, 80)}) · auto-light: ${lr.summary?.slice(0, 120)} · lit nodes ${litN} ≈ ${lr.cost?.chars ?? '?'} chars`);
}
let reaimRefusals = 0;
const reaimFor = async (question: string): Promise<string> => {
  // Per-question aiming (Jacob, 2026-09-06: "you are not auto-focusing on your
  // way?"): the question is the conversation's tail; auto-focus picks the
  // focus, auto-light lights for it under the budget guard. An over-budget or
  // failed proposal keeps the previous aim and is counted, never hidden.
  // A failed or slow aiming call keeps the previous aim and counts as a refusal — the run never dies on it.
  const post = async (path: string, body: any) => { try { return await (await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })).json(); } catch (e) { console.log(`  (aiming call ${path.split('/').pop()} failed: ${String(e).slice(0, 80)})`); return {}; } };
  const fr: any = await post(`/api/chats/${st0.mainChatId}/recommend`, { kind: 'focus', tail: `USER: ${question}` });
  if (fr?.containerId) await post(`/api/chats/${st0.mainChatId}/focus`, { nodeId: fr.containerId });
  const lr: any = await post(`/api/chats/${st0.mainChatId}/autolit`, { preview: true, feedback: `The user's latest message: ${question}` });
  if (!lr?.ok || lr?.overBudget) { reaimRefusals++; return `focus "${fr?.name ?? '?'}" · light kept (${lr?.overBudget ? 'over budget' : 'no proposal'})`; }
  const ar: any = await post(`/api/chats/${st0.mainChatId}/autolit`, { apply: { lit: (lr.lit ?? []).map((x: any) => x.id), dim: (lr.dim ?? []).map((x: any) => x.id) }, summary: lr.summary });
  if (!ar?.ok) { reaimRefusals++; return `focus "${fr?.name ?? '?'}" · light apply refused`; }
  return `focus "${fr?.name ?? '?'}" · lit ${lr.cost?.nodes ?? '?'} nodes ≈ ${lr.cost?.chars ?? '?'} chars`;
};
let briefChars = 0; let briefN = 0;
let cells: Cell[] = [];
const mapBudget: Record<string, number> = {};
if (await Bun.file(CKPT).exists()) {
  const ck = JSON.parse(await Bun.file(CKPT).text());
  cells = ck.cells ?? []; briefChars = ck.briefChars ?? 0; briefN = ck.briefN ?? 0; Object.assign(mapBudget, ck.mapBudget ?? {});
  console.log(`RESUMED from ${CKPT}: ${cells.length} cells (${cells.filter((c) => c.score !== null).length} graded, ${cells.filter((c) => c.score2 !== undefined).length} double-graded)`);
}
const checkpoint = async () => { await Bun.write(CKPT, JSON.stringify({ cells, briefChars, briefN, mapBudget })); };
// Equal budget is paired PER ITEM: the transcript slice for an item is the
// tail of the real record cut to the exact length the map briefing had for
// that same item (TEST-DESIGN §2). Map arms run first to fix the budgets.
const armOrder = [...ARMS].sort((x, y) => (x === 'transcript' ? 1 : 0) - (y === 'transcript' ? 1 : 0));
for (const arm of armOrder) {
  if (arm !== 'transcript') await setServing(arm);
  for (const it of items) {
    if (cells.filter((c) => c.arm === arm && c.item === it.id).length >= REPS) continue; // resumed
    let brief: string; let pulled = '';
    if (arm === 'transcript') {
      const budget = mapBudget[it.id] ?? Math.round(briefChars / Math.max(1, briefN));
      brief = `[conversation record — most recent portion]\n` + transcriptText.slice(-budget);
    } else {
      if (REAIM) console.log(`  re-aim ${it.id}: ${await reaimFor(it.question)}`);
      brief = await briefing(it.question, `rb-${arm}-${it.id}`);
      mapBudget[it.id] = brief.length;
      pulled = await consentPull(brief);
    }
    briefChars += brief.length; briefN++;
    for (let rep = 0; rep < REPS; rep++) {
      const answer = await sealed('claude-sonnet-4-6', [PRE, brief, `USER: ${it.question}`, pulled].filter(Boolean).join('\n\n---\n\n'));
      cells.push({ item: it.id, arm, rep, answer, score: null, ...(rep === 0 ? { brief, pulled } : {}) }); // the briefing is kept on rep 0: dev_traces hold only 200 rows, so this is the durable record of what the cell saw
    }
    console.log(`${arm}/${it.id} answered ×${REPS}${pulled ? ' (consented pull-up served)' : ''}`);
    await checkpoint();
  }
}
await setServing('on'); // restore default
if (LIGHTING !== 'dark') { const stR = await (await fetch(`${BASE}/api/state`)).json(); for (const id of stR.chats.find((c: any) => c.id === stR.mainChatId)?.lit ?? []) await setLit(id, false); } // restore dark

// grading: shuffled, blind (grader never sees the arm)
const order = [...cells].sort((a, b) => Bun.hash(a.answer + a.item).toString().localeCompare(Bun.hash(b.answer + b.item).toString()));
for (let i = 0; i < order.length; i += 8) {
  await Promise.all(order.slice(i, i + 8).filter((c) => c.score === null).map(async (c) => {
    const it = items.find((x: any) => x.id === c.item)!;
    c.score = parseScore(await sealed('claude-haiku-4-5', graderPrompt(it.question, it.required_fact, it.wrong_answers, c.answer)));
  }));
  await checkpoint();
  console.log(`graded ${Math.min(i + 8, order.length)}/${order.length}`);
}
// reliability: 20% double-graded by a second model → Cohen's kappa
// Batched like grading: the unbatched version launched every double-grade at
// once — ~83 concurrent CLI processes — and the OOM killer took the whole
// user session with it (2026-09-05 06:21).
const sample = order.filter((_, i) => i % 5 === 0);
for (let i = 0; i < sample.length; i += 8) {
  await Promise.all(sample.slice(i, i + 8).filter((c) => c.score2 === undefined).map(async (c) => {
    const it = items.find((x: any) => x.id === c.item)!;
    c.score2 = parseScore(await sealed('claude-sonnet-4-6', graderPrompt(it.question, it.required_fact, it.wrong_answers, c.answer)));
  }));
  await checkpoint();
  console.log(`double-graded ${Math.min(i + 8, sample.length)}/${sample.length}`);
}
const pairs = sample.filter((c) => c.score !== null && c.score2 != null);
const kappa = (() => {
  const n = pairs.length; if (!n) return NaN;
  const po = pairs.filter((c) => c.score === c.score2).length / n;
  let pe = 0;
  for (const s of [0, 1, 2]) pe += (pairs.filter((c) => c.score === s).length / n) * (pairs.filter((c) => c.score2 === s).length / n);
  return (po - pe) / (1 - pe);
})();

// ---- analysis -------------------------------------------------------------
const byArm: Record<string, Record<string, number[]>> = {};
for (const c of cells) {
  if (c.score === null) continue;
  ((byArm[c.arm] ??= {})[c.item] ??= []).push(c.score);
}
const itemMean = (arm: string, item: string) => { const xs = byArm[arm]?.[item] ?? []; return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
const armMean = (arm: string) => { const ms = items.map((it: any) => itemMean(arm, it.id)).filter((x: any) => x !== null) as number[]; return ms.reduce((a, b) => a + b, 0) / ms.length; };
// noise floor: mean |rep1-rep2| within identical cells
const repDiffs: number[] = [];
for (const arm of ARMS) for (const it of items) { const xs = byArm[arm]?.[it.id] ?? []; for (let i = 1; i < xs.length; i++) repDiffs.push(Math.abs(xs[i] - xs[0])); }
const noise = repDiffs.length ? repDiffs.reduce((a, b) => a + b, 0) / repDiffs.length : NaN;

// The per-item on-map check (M193 amendment): does the required fact exist
// on the map at all — mechanical token coverage against node titles+content.
const stM = await (await fetch(`${BASE}/api/state`)).json();
const corpus = stM.nodes.filter((n: any) => n.status !== 'removed').map((n: any) => `${n.title ?? ''} ${n.content}`).join('\n').toLowerCase();
const onMap: Record<string, boolean> = {};
for (const it of items) {
  const toks = String(it.required_fact).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 4);
  const hit = toks.filter((t: string) => corpus.includes(t)).length;
  onMap[it.id] = toks.length > 0 && hit / toks.length >= 0.4;
}

const lines: string[] = [];
lines.push(`lighting=${LIGHTING}${REAIM ? `+reaim(${reaimRefusals} refusals)` : ''} briefing≈${briefN ? Math.round(briefChars / briefN) : 0}ch n_items=${items.length} reps=${REPS} kappa=${kappa.toFixed(2)} (${pairs.length} double-graded) noise=${noise.toFixed(2)}`);
for (const arm of ARMS) lines.push(`arm ${arm}: mean ${armMean(arm).toFixed(2)}`);
if (ARMS.length === 2) {
  const [a, b] = ARMS;
  const diffs = items.map((it: any) => [itemMean(a, it.id), itemMean(b, it.id)]).filter(([x, y]: any) => x !== null && y !== null).map(([x, y]: any) => x - y);
  const mean = diffs.reduce((s: number, d: number) => s + d, 0) / diffs.length;
  const wins = diffs.filter((d: number) => d > 0).length; const losses = diffs.filter((d: number) => d < 0).length;
  lines.push(`paired ${a}-${b}: Δmean ${mean.toFixed(2)}, sign ${wins}-${losses}-${diffs.length - wins - losses}`);
  const minEff = Number((/([\d.]+)/.exec(H1 ?? '') ?? [])[1] ?? 0.4);
  lines.push(`VERDICT vs registered claim: ${H1} → ${mean >= minEff ? 'supported at face value (check CI before claiming)' : 'NOT supported'}`);
  // Decomposition for the first (map) arm: recalled / served-but-wrong / never-filed.
  const mapArm = ARMS.find((x) => x !== 'transcript');
  if (mapArm) {
    let rec = 0, sbw = 0, nf = 0;
    for (const it of items) {
      const m2 = itemMean(mapArm, it.id);
      if (m2 === null) continue;
      if (!onMap[it.id]) nf++;
      else if (m2 >= 1.5) rec++;
      else sbw++;
    }
    lines.push(`decomposition(${mapArm}): recalled ${rec} · served-but-wrong ${sbw} · never-filed ${nf}`);
  }
}
if (kappa < 0.7) lines.push('QUARANTINE: kappa < .70 — grades unreliable; revise rubrics before using this run.');
if (bankFile.meta.authorship_gap) lines.push('CAVEAT: builder-authored bank.');
if (items.length < 69) lines.push(`CAVEAT: ${items.length} items < 69 (power .95 for Δ=0.4) — exploratory strength only.`);

const commit = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
const ledger = `${new Date().toISOString().slice(0, 16)} · ${commit} · recall-bank v${bankFile.meta.version} · ${EXPLORATORY ? 'EXPLORATORY' : `H1: ${H1}`} · ${lines.join(' · ')}`;
appendFileSync('docs/SCORES.md', ledger + '\n');
console.log('\n' + lines.join('\n'));
console.log('\nledger line appended to docs/SCORES.md');
await Bun.write('/tmp/recall-bank-last.json', JSON.stringify({ cells, lines }, null, 1));

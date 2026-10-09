// M470 — THE RECORD TEST (Jacob 2026-10-09 03:43 "the map is… telling you what topics are discussed"; 04:07 "Let's redesign the test";
// 04:10 "Yes" to the design below). The map is measured on what it is for: what was discussed and said during a day — by whom, with
// the numbers, limits, rules and reasons verbatim — read back in a new chat. Nothing about what is open or closed.
//
//   1. THE DAY: a scenario (rounds with `session` = the chat each turn was typed in; `panelChat` = the chat the person sits in on Monday).
//   2. THE QUESTIONS: generated ONCE from the record by a model call and SEALED beside the scenario as <scenario>.qa.json with the record's
//      answer key (the quote, the turn, who said it). Five kinds: what did we discuss (topic list) · what did I say about X (X from an
//      EARLIER chat — the cross-chat recall) · what number / limit / rule did I set for Y · what did I reject and why · who said Z, me or
//      the agent. The loop does not read the file; the scenario's own words are the key.
//   3. THE SCORE: each answer is graded against the record and the key, blind to which side produced it: right / partly / wrong /
//      missing, plus the count of statements the record contradicts. The report is counts in words, per side.
//   4. THE CONTROLS: --control last-chat (Codex asked in the chat the person is sitting in; the other chats are not in its context) ·
//      notes (Codex in that chat PLUS the NOTES.md it kept during the day — what a disciplined person does without us; the notes are
//      built by replaying every turn of the day through "update your NOTES.md") · full (one chat, everything — the fairness check: the
//      map must come out about equal).
//
// Usage (one job at a time on the 3.9 GB box; the map server is started on PANEL_ASK_PORT, default 8797):
//   HARNESSMAP_INFERENCE=codex CODEX_HOME=~/.codex HARNESSMAP_INFERENCE_CONCURRENCY=1 \
//     bun run src/eval/record-test.ts src/eval/scenarios/amir-day-chats-en.json --map <kept e2e.sqlite> --control last-chat --out <dir>
//   --gen           regenerate the sealed questions (otherwise reused when <scenario>.qa.json exists)
//   --n 12          how many questions to generate
//   --no-map        skip the map side (control only)
// Output: <out>/REPORT.md (counts + per-question table), <out>/results.json, <out>/map-answers.txt, <out>/control-answers.txt,
//         <out>/NOTES.md (notes control), and the sealed <scenario>.qa.json beside the scenario.
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { call } from '../inference.js';
import { pickPanelChat } from '../twin.js';

const argv = process.argv.slice(2);
const flagVal = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flagVals = new Set(['--map', '--out', '--control', '--n'].map((f) => flagVal(f)).filter(Boolean));
const scenarioPathMaybe = argv.find((a) => !a.startsWith("--") && !flagVals.has(a));
if (!scenarioPathMaybe) { console.error('usage: record-test.ts <scenario.json> --map <e2e.sqlite> [--control last-chat|notes|full] [--out <dir>] [--gen] [--n 12] [--no-map]'); process.exit(2); }
const scenarioPath: string = scenarioPathMaybe;
const mapPath = flagVal('--map');
type Control = 'last-chat' | 'notes' | 'full';
const CONTROL = (flagVal('--control') ?? 'last-chat') as Control;
const OUT = flagVal('--out') ?? `/tmp/claude-1000/record-test-${Date.now()}`;
const N = Math.max(4, Number(flagVal('--n') ?? 12) || 12);
mkdirSync(OUT, { recursive: true });
const MODEL = process.env.RECORD_TEST_MODEL; // the generator and the grader may run on a different model than the brain (same backend)

// ---------- the record ----------
const sc = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const rounds: any[] = sc.rounds ?? [];
const turnText = (r: any, i: number) => `[turn ${i + 1}${r.session ? ` · chat "${r.session}"` : ''}]\nyou: ${String(r.user ?? '').slice(0, 1200)}\nagent: ${String(r.assistant ?? '').slice(0, 2200)}`;
const RECORD = rounds.map(turnText).join('\n\n');
const chats = (() => {
  const by = new Map<string, { name: string; parts: string[]; turns: number; lastUsed: number }>();
  rounds.forEach((r, i) => { const k = String(r.session ?? 'chat-1'); const e = by.get(k) ?? { name: k, parts: [], turns: 0, lastUsed: 0 }; e.parts.push(turnText(r, i)); e.turns++; e.lastUsed = i; by.set(k, e); });
  return [...by.values()].map((e) => ({ name: e.name, transcript: e.parts.join('\n\n'), turns: e.turns, lastUsed: e.lastUsed })).sort((a, b) => a.lastUsed - b.lastUsed);
})();
const panelChat = pickPanelChat(chats as any, typeof sc.panelChat === 'string' ? sc.panelChat : null) as { name: string; transcript: string; turns: number };
const sessionLine = String(sc.name ?? basename(scenarioPath)).slice(0, 300);

// ---------- the sealed questions ----------
interface QA { kind: 'discussed' | 'said-about' | 'number-rule' | 'rejected' | 'who-said'; question: string; answer: string; quote: string; turn: number; who: 'you' | 'agent'; chat?: string }
const QA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'question', 'answer', 'quote', 'turn', 'who', 'chat'], properties: {
    kind: { type: 'string', enum: ['discussed', 'said-about', 'number-rule', 'rejected', 'who-said'] }, question: { type: 'string' }, answer: { type: 'string' }, quote: { type: 'string' }, turn: { type: 'integer' }, who: { type: 'string', enum: ['you', 'agent'] }, chat: { type: 'string' } } } } },
};
const GEN_SYSTEM = `You write the question set for a recall test of a software product that records what a person and their coding agent discussed during a working day, across several chats. You are given THE RECORD — every turn of the day, each marked with its turn number and the chat it was typed in — and the name of the chat the person will be sitting in when they ask ("the panel chat"). Write questions the PERSON would ask the next morning about what was DISCUSSED AND SAID, each with the record's own answer as the key.

Five kinds, mixed, in this proportion for N questions: 2 "discussed" (what did we discuss / cover about <area> — the key is the list of topics or points actually covered, in the record's words); about N/3 "said-about" (what did I say / what did we conclude about X — X must come from a chat OTHER than the panel chat wherever the day has several chats, so the question tests recall across chats); about N/4 "number-rule" (what number / limit / threshold / rule / value did I set or we agree for Y — the key is the exact figure or rule); 2 "rejected" (what did I reject or correct about Z and what replaced it — the key names the rejected thing, the reason and the replacement); 2 "who-said" (was it me or the agent who said / proposed / picked W — one where the person said it, one where the agent did; the key is "you" or "the agent" with the quote).

Rules: every answer must be checkable against ONE place in the record — give the quote verbatim (one or two sentences, copied), the turn number, who said it ("you" = the person, "agent" = the coding agent) and the chat. Prefer specifics (numbers, names, file names, rules, reasons) over summaries. Never ask what is open, pending, finished, done, next or still to do — status is not tested. Write the questions in the person's voice, plain and short, as typed into a chat box. Return strict JSON only.`;
const qaPath = join(dirname(scenarioPath), `${basename(scenarioPath).replace(/\.json$/, '')}.qa.json`);
async function ensureQuestions(): Promise<QA[]> {
  if (existsSync(qaPath) && !argv.includes('--gen')) { const q = JSON.parse(readFileSync(qaPath, 'utf8')); console.error(`[record-test] sealed questions reused: ${qaPath} (${q.questions.length})`); return q.questions; }
  const out = await call({ task: 'brain', modelOverride: MODEL, system: GEN_SYSTEM, user: `N = ${N}. THE PANEL CHAT: "${panelChat.name}" (${chats.length} chat(s) in the day: ${chats.map((c) => `${c.name} ${c.turns} turns`).join(', ')}).\n\nTHE RECORD:\n${RECORD.slice(0, 120_000)}`, maxTokens: 6000, timeoutMs: 300_000, schema: QA_SCHEMA }) as { questions: QA[] };
  const questions = (out.questions ?? []).slice(0, N);
  writeFileSync(qaPath, JSON.stringify({ sealed: 'M470 record test — generated from the record by a model call; the answer key is the record\'s own words. Not read by the loop; not used for any fix.', scenario: basename(scenarioPath), panelChat: panelChat.name, generatedAt: new Date().toISOString(), questions }, null, 2) + '\n');
  console.error(`[record-test] sealed ${questions.length} questions → ${qaPath}`);
  return questions;
}

// ---------- the map side ----------
async function askMap(path: string, questions: QA[]): Promise<string[]> {
  const dir = mkdtempSync('/tmp/claude-1000/harnessmap-record-ask-'); const db = join(dir, 'map.sqlite'); copyFileSync(path, db);
  mkdirSync(join(dir, 'home', '.harnessmap'), { recursive: true });
  const port = Number(process.env.PANEL_ASK_PORT ?? 8797); const base = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([...(process.platform === 'linux' ? ['setsid'] : []), 'bun', 'run', 'src/server.ts'], {
    env: { ...process.env, ANTHROPIC_API_KEY: undefined as any, HARNESSMAP_DB: db, HARNESSMAP_HOME: join(dir, 'home', '.harnessmap'), HOME: join(dir, 'home'), PORT: String(port), HARNESSMAP_AUTOTIDY_ROUNDS: '0', HARNESSMAP_LATEST_OVERRIDE: '0.0.1' },
    stdout: Bun.file(join(dir, 'server.log')), stderr: Bun.file(join(dir, 'server.log')),
  });
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} try { server.kill(); } catch {} };
  const answers: string[] = [];
  try {
    let up = false; for (let i = 0; i < 40; i++) { try { const r = await fetch(`${base}/api/state`); if (r.ok) { up = true; break; } } catch {} await new Promise((r) => setTimeout(r, 500)); }
    if (!up) throw new Error('the map server did not come up');
    for (const q of questions) {
      let said = '(no answer)';
      for (let attempt = 0; attempt < 2 && said === '(no answer)'; attempt++) { try { const r = await fetch(`${base}/api/map-status/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q.question }) }); const b: any = await r.json(); const t = String(b?.reply ?? b?.text ?? b?.answer ?? '').trim(); if (t) said = t; } catch {} }
      answers.push(said);
      console.error(`[record-test] map: ${q.question.slice(0, 60)} → ${said.slice(0, 90).replace(/\n/g, ' ')}`);
    }
  } finally { stop(); }
  return answers;
}

// ---------- the control side ----------
const AGENT_SYSTEM = 'You are the coding agent (Codex / Claude Code) in a resumed session. The user comes back the next morning and asks about the work. Answer ONLY from what you are given (the transcript of this chat, and your NOTES.md if one is given), plainly and concretely, as the agent would in the terminal; if what is asked is not in what you have, say so in one line; no preamble.';
async function askAgent(context: string, questions: QA[], label: string): Promise<string[]> {
  const answers: string[] = [];
  for (const q of questions) {
    let said = '(no answer)';
    for (let attempt = 0; attempt < 2 && said === '(no answer)'; attempt++) {
      try { const t = await call({ task: 'brain', system: AGENT_SYSTEM, user: `${context}\n\nTHE USER NOW ASKS: ${q.question}`, maxTokens: 1500, timeoutMs: 150_000 }); if (typeof t === 'string' && t.trim()) said = t.trim(); } catch {}
    }
    answers.push(said);
    console.error(`[record-test] ${label}: ${q.question.slice(0, 60)} → ${said.slice(0, 90).replace(/\n/g, ' ')}`);
  }
  return answers;
}
// The NOTES.md control: the agent keeps one notes file for the user across the day's chats — every turn, it updates the file.
const NOTES_SYSTEM = 'You are the coding agent (Codex / Claude Code). The user has asked you to keep a NOTES.md in the project for yourself and for them, across chats, so that nothing said today is lost. After every exchange you rewrite the file. Keep it under 1,500 words: decisions, numbers, limits, rules, rejections (what was rejected, why, what replaced it), file names, figures — verbatim where it matters, with who said it (user / agent) — grouped by topic, newest changes folded in where they belong. Return the whole updated NOTES.md and nothing else.';
async function buildNotes(): Promise<string> {
  const notesPath = join(OUT, 'NOTES.md');
  if (existsSync(notesPath)) { console.error(`[record-test] NOTES.md reused: ${notesPath}`); return readFileSync(notesPath, 'utf8'); }
  let notes = '# NOTES.md\n\n(empty)\n';
  for (let i = 0; i < rounds.length; i++) {
    try { const t = await call({ task: 'brain', system: NOTES_SYSTEM, user: `CURRENT NOTES.md:\n${notes}\n\nTHE EXCHANGE JUST NOW (${turnText(rounds[i], i).split('\n')[0]}):\n${turnText(rounds[i], i)}\n\nReturn the updated NOTES.md.`, maxTokens: 2500, timeoutMs: 150_000 }); if (typeof t === 'string' && t.trim().length > 20) notes = t.trim(); } catch {}
    if ((i + 1) % 6 === 0 || i === rounds.length - 1) console.error(`[record-test] notes after turn ${i + 1}: ${notes.length} chars`);
  }
  writeFileSync(notesPath, notes + '\n');
  return notes;
}

// ---------- the grader ----------
interface Grade { verdict: 'right' | 'partly' | 'wrong' | 'missing'; wrong_statements: number; evidence: string; why: string }
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'wrong_statements', 'evidence', 'why'], properties: { verdict: { type: 'string', enum: ['right', 'partly', 'wrong', 'missing'] }, wrong_statements: { type: 'integer' }, evidence: { type: 'string' }, why: { type: 'string' } } };
const GRADER_SYSTEM = `You grade ONE answer to ONE question about a recorded working day between a person and their coding agent. You have THE RECORD (every turn, numbered, with its chat), THE QUESTION, THE KEY (the record's own answer: the quote, the turn, who said it) and THE ANSWER. You do not know what produced the answer; grade the words only.

verdict: "right" = the answer states the key's fact — the same number, name, rule, author or substance; wording may differ; extra correct detail is fine. "partly" = part of the key's fact, nothing the record contradicts. "wrong" = the answer states something the record contradicts (a different number, the wrong side as the author, a rule misquoted, a rejection attributed to the wrong party, a thing the record never says) — even if it also contains the right fact. "missing" = the answer says it does not know / has nothing / answers a different question.
wrong_statements: how many distinct claims in the answer the record contradicts or does not support (0 when none). A claim about whether something is open, done, pending or next is NOT counted either way — status is not graded.
evidence: the line of the record (quoted) that decides it. why: one sentence. Return strict JSON only.`;
async function grade(q: QA, answer: string): Promise<Grade> {
  try {
    const g = await call({ task: 'brain', modelOverride: MODEL, system: GRADER_SYSTEM, user: `THE QUESTION: ${q.question}\n\nTHE KEY: ${q.answer}\n  quote (turn ${q.turn}, said by ${q.who === 'you' ? 'the person' : 'the agent'}${q.chat ? `, chat "${q.chat}"` : ''}): "${q.quote}"\n\nTHE ANSWER:\n${answer.slice(0, 6000)}\n\nTHE RECORD:\n${RECORD.slice(0, 110_000)}`, maxTokens: 600, timeoutMs: 180_000, schema: GRADE_SCHEMA }) as Grade;
    return { verdict: g.verdict, wrong_statements: Math.max(0, Number(g.wrong_statements) || 0), evidence: String(g.evidence ?? '').slice(0, 300), why: String(g.why ?? '').slice(0, 300) };
  } catch (err) { return { verdict: 'missing', wrong_statements: 0, evidence: '', why: `grader failed: ${String(err).slice(0, 80)}` }; }
}

// ---------- run ----------
const questions = await ensureQuestions();
const sides: { name: string; answers: string[] }[] = [];
if (mapPath && !argv.includes('--no-map')) sides.push({ name: 'map', answers: await askMap(mapPath, questions) });
let controlLabel = '';
if (CONTROL === 'last-chat') { controlLabel = `codex in "${panelChat.name}" (${panelChat.turns} of ${rounds.length} turns; ${chats.length - 1} other chat(s) unseen)`; sides.push({ name: 'codex', answers: await askAgent(`THE TRANSCRIPT OF THIS CHAT ("${panelChat.name}"):\n${panelChat.transcript}`, questions, 'codex last-chat') }); }
else if (CONTROL === 'notes') { const notes = await buildNotes(); controlLabel = `codex in "${panelChat.name}" + its NOTES.md (${notes.length} chars, kept across all ${rounds.length} turns)`; sides.push({ name: 'codex', answers: await askAgent(`YOUR NOTES.md (kept across today's chats):\n${notes}\n\nTHE TRANSCRIPT OF THIS CHAT ("${panelChat.name}"):\n${panelChat.transcript}`, questions, 'codex notes') }); }
else { controlLabel = `codex with the whole day in one chat (${rounds.length} turns)`; sides.push({ name: 'codex', answers: await askAgent(`THE TRANSCRIPT OF THE SESSION:\n${RECORD}`, questions, 'codex full') }); }
for (const s of sides) writeFileSync(join(OUT, `${s.name}-answers.txt`), questions.map((q, i) => `Q${i + 1} [${q.kind}]: ${q.question}\nA: ${s.answers[i]}`).join('\n\n') + '\n');

// grade in random order so no side is always graded first in the model's session
const jobs: { side: string; i: number }[] = []; for (const s of sides) for (let i = 0; i < questions.length; i++) jobs.push({ side: s.name, i });
for (let k = jobs.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [jobs[k], jobs[j]] = [jobs[j], jobs[k]]; }
const grades: Record<string, Grade[]> = Object.fromEntries(sides.map((s) => [s.name, new Array(questions.length)]));
for (const job of jobs) { const s = sides.find((x) => x.name === job.side)!; grades[job.side][job.i] = await grade(questions[job.i], s.answers[job.i]); console.error(`[record-test] graded ${job.side} Q${job.i + 1}: ${grades[job.side][job.i].verdict}${grades[job.side][job.i].wrong_statements ? ` (${grades[job.side][job.i].wrong_statements} wrong)` : ''}`); }

const tally = (name: string) => { const g = grades[name]; const c = { right: 0, partly: 0, wrong: 0, missing: 0, wrongStatements: 0 }; for (const x of g) { c[x.verdict]++; c.wrongStatements += x.wrong_statements; } return c; };
const words = (name: string) => { const c = tally(name); return `${name}: of ${questions.length} questions, ${c.right} right, ${c.partly} partly, ${c.wrong} wrong, ${c.missing} missing — ${c.wrongStatements} statement(s) the record contradicts`; };
const byKind = (name: string) => { const m: Record<string, { n: number; right: number; wrong: number }> = {}; questions.forEach((q, i) => { const e = m[q.kind] ?? (m[q.kind] = { n: 0, right: 0, wrong: 0 }); e.n++; if (grades[name][i].verdict === 'right') e.right++; if (grades[name][i].verdict === 'wrong') e.wrong++; }); return Object.entries(m).map(([k, v]) => `${k} ${v.right}/${v.n} right${v.wrong ? `, ${v.wrong} wrong` : ''}`).join(' · '); };
const lines: string[] = [];
lines.push(`# RECORD TEST — ${sessionLine}`);
lines.push(`\nscenario ${scenarioPath} · map ${mapPath ?? '(none)'} · control ${CONTROL} = ${controlLabel} · ${questions.length} sealed questions (${qaPath}) · graded against the record, blind to the side.`);
lines.push(`\n## The counts\n`);
for (const s of sides) lines.push(`- **${words(s.name)}** (by kind: ${byKind(s.name)})`);
lines.push(`\n## Per question\n\n| # | kind | question | key (turn, who) | ${sides.map((s) => `${s.name}`).join(' | ')} |\n|---|---|---|---|${sides.map(() => '---').join('|')}|`);
questions.forEach((q, i) => lines.push(`| ${i + 1} | ${q.kind} | ${q.question.replace(/\|/g, '/').slice(0, 140)} | ${q.answer.replace(/\|/g, '/').slice(0, 160)} (t${q.turn}, ${q.who}) | ${sides.map((s) => `**${grades[s.name][i].verdict}**${grades[s.name][i].wrong_statements ? ` ×${grades[s.name][i].wrong_statements}` : ''} — ${grades[s.name][i].why.replace(/\|/g, '/').slice(0, 160)}`).join(' | ')} |`));
lines.push(`\n## The answers\n`);
for (const s of sides) { lines.push(`### ${s.name}\n`); questions.forEach((q, i) => lines.push(`**Q${i + 1}** ${q.question}\n\n${s.answers[i].slice(0, 2500)}\n\n_grade: ${grades[s.name][i].verdict}${grades[s.name][i].wrong_statements ? ` (${grades[s.name][i].wrong_statements} contradicted)` : ''} — ${grades[s.name][i].why} · evidence: ${grades[s.name][i].evidence}_\n`)); }
writeFileSync(join(OUT, 'REPORT.md'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ scenario: scenarioPath, map: mapPath, control: CONTROL, controlLabel, questions, sides: sides.map((s) => ({ name: s.name, answers: s.answers, grades: grades[s.name], tally: tally(s.name) })) }, null, 2) + '\n');
console.log(`[record-test] ${sides.map((s) => words(s.name)).join(' · ')} → ${join(OUT, 'REPORT.md')}`);

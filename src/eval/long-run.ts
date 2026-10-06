// Long-term usage scenarios (Jacob, 2026-10-06 08:53 UTC: "we are looking for long term usage, not few round trials").
//
// Stitches WHOLE real threads — every piece p1..pN of each named scenario, in order, several threads back to back —
// into ONE scenario file, so e2e-run drives one growing map through 30–60 rounds: the "month of one entangled chat"
// shape the Example map shows (several projects, drift, return). The first thread's seed/focus/auto are kept; the
// other threads' seeds are DROPPED on purpose (their topics must arrive as drift and find their own place), and any
// step keyed on a seed key (countUnder/underKey/focus/light/dim/release/pin/title/statement/zoom/favorite) is dropped
// from later threads because the keys would not exist. Content checks (nodeMatching, mentions, notStatus, statusOf,
// atMostTitles, brain*) stay, and the file ends with RECALL checks: the brain is asked to list every topic worked on
// (one brainMust per thread, keywords from the thread's own name line) and, where a thread filed a rule/decision,
// what the user decided — the long-term memory test the pieces cannot make.
//
//   bun run src/eval/long-run.ts <tag> <scenario-name> [<scenario-name> …]        → src/eval/scenarios/long-<tag>.json
//   E2E_ENGINE=codex … E2E_PORT=8799 bun run src/eval/e2e-run.ts src/eval/scenarios/long-<tag>.json --keep
//
// Run it detached (systemd-run) — 40+ rounds at 50–90 s each outlive the harness watchdog.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [tag, ...names] = process.argv.slice(2);
if (!tag || !names.length) { console.error('usage: long-run.ts <tag> <scenario-name> […]'); process.exit(2); }

const base = (n: string) => n.split('@')[0];
const KEYED = new Set(['countUnder', 'underKey', 'topLevelMatching']);
const KEYED_DO = new Set(['focus', 'light', 'dim', 'release', 'pin', 'title', 'statement', 'zoom', 'favorite']);

type Round = { user: string; assistant?: string; then?: any[]; [k: string]: any };
const threads: { name: string; pieces: string[]; rounds: Round[]; desc: string; seed?: any; focus?: any; auto?: any; recall: string[]; rule?: string }[] = [];

for (const spec of names) {
  // "name" = all pieces; "name@2-3" = pieces 2..3 only; "name@4" = piece 4 — lets a thread RETURN after a drift (tictactoe@1-2 react-eslint tictactoe@3-4).
  const m = spec.match(/^([a-z0-9-]+?)(?:@(\d+)(?:-(\d+))?)?$/i);
  if (!m) { console.error(`bad spec ${spec}`); process.exit(2); }
  const name = m[1]; const from = m[2] ? parseInt(m[2], 10) : 1; const to = m[3] ? parseInt(m[3], 10) : (m[2] ? from : 9);
  const pieces: string[] = [];
  for (let i = from; i <= to; i++) { const f = `src/eval/scenarios/replay-real-${name}-p${i}.json`; if (existsSync(f)) pieces.push(f); else if (!m[2]) break; }
  if (!pieces.length) { console.error(`no pieces for ${name}`); process.exit(2); }
  const t: (typeof threads)[number] = { name: m[2] ? spec : name, pieces, rounds: [], desc: '', recall: [] };
  pieces.forEach((f, pi) => {
    const sc = JSON.parse(readFileSync(f, 'utf8'));
    if (pi === 0) { t.desc = String(sc.name ?? name); t.seed = sc.seed; t.focus = sc.focus; t.auto = sc.auto; }
    for (const r of sc.rounds ?? []) {
      const first = threads.length === 0 || base(name) === base(threads[0].name); // steps keyed on the FIRST thread's seed keys are kept (also for a later segment of the SAME thread — same key names)
      const then = (r.then ?? []).filter((s: any) => {
        if (first) return true;
        if (s.do && KEYED_DO.has(s.do)) return false;
        for (const k of Object.keys(s)) if (KEYED.has(k)) return false;
        return true;
      });
      t.rounds.push({ ...r, then });
    }
  });
  threads.push(t);
}

// Recall keywords: 2–4 distinctive words from the thread's own name/description line (the part before " — ").
const STOP = new Set('replay real wildchat english chinese piece the a an and of to in for with on from that this user asks assistant session thread about then into one its their his her how what which when where why does should could would'.split(' '));
// Curated recall regexes for threads whose name line does not yield good nouns (the fallback extractor picks adjectives like "small").
const CURATED: Record<string, string> = {
  'tictactoe': 'tic[ -]?tac[ -]?toe|connect ?four',
  'react-eslint': 'react|eslint|setStep|step function',
  'quizlet-drifts': 'quizlet|quizizz|vps|unity',
  // LONG #394 (mixed-language map): the brain answers recall in the MAP's dominant language — an English thread on a
  // Chinese-led map came back as "Python随机数…" / "英语…语法选择", and "first" as "how to charge a 2015 Qin DM". The
  // regexes name the topic in both scripts; the check is for the topic, not the language it is told in.
  'random-numbers': 'random|dice|shuffle|随机',
  'grammar-quiz': 'grammar|quiz|语法',
  'panorama-homography': 'panorama|homograph',
  'webrtc-zh': 'webrtc|音视频|推流',
  'mysql-json-zh': 'mysql|json',
  'nginx-cors-zh': 'nginx|cors|跨域',
  'time-clock-zh': '时钟|clock|时间',
  'thirteen-questions-zh': '充电|汽车|\\bcar\\b|charg',
  'vba-header-zh': 'vba|表头|excel',
};
const kw = (desc: string) => {
  const head = desc.replace(/^replay \(real,[^)]*\):\s*/i, '').split(/ — piece/)[0];
  const words = (head.match(/[A-Za-z][A-Za-z0-9+#.-]{3,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w));
  const cjk = head.match(/[一-鿿]{2,4}/g) ?? [];
  const uniq = [...new Set([...words, ...cjk])];
  return uniq.slice(0, 4);
};

const rounds: Round[] = [];
for (const t of threads) rounds.push(...t.rounds);

// Final recall round: a neutral closing exchange so the brain checks run on the finished map.
const topics = threads.map((t) => ({ name: t.name, keys: CURATED[base(t.name)] ? [CURATED[base(t.name)]] : kw(t.desc) }));
const rxOf = (t: { name: string; keys: string[] }) => CURATED[base(t.name)] ? CURATED[base(t.name)] : t.keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const recallThen: any[] = [
  { do: 'brainChat', text: 'List every distinct topic or project the user has worked on in this whole session, one short line each.' },
  { brainMustNot: 'calorie|essay|movie|weekend coding|Past Lives|Paterson|Jane Jacobs|MyFitnessPal|Netlify|rereading|month-long|month of|tangled|example map|ongoing conversation|weight chart|Astro' },
  ...topics.filter((t) => t.keys.length).map((t) => ({ brainMust: rxOf(t), _thread: t.name })),
  { do: 'brainChat', text: 'What was the FIRST thing the user worked on in this session? one line' },
  ...(topics[0]?.keys.length ? [{ brainMust: rxOf(topics[0]), _thread: `${topics[0].name} (first)` }] : []),
  { do: 'brainChat', text: 'What is the user working on RIGHT NOW, most recently? one line' },
  ...(topics.at(-1)?.keys.length ? [{ brainMust: rxOf(topics.at(-1)!), _thread: `${topics.at(-1)!.name} (latest)` }] : []),
];
rounds.push({ user: 'thanks, that is all for today', assistant: 'You are welcome. Talk soon.', then: recallThen });

const out = {
  name: `long-term (${threads.length} real threads, ${rounds.length} rounds): ${threads.map((t) => t.name).join(' → ')} — one growing map; recall checks at the end`,
  seed: threads[0].seed, focus: threads[0].focus, auto: threads[0].auto ?? { on: true }, settleMs: 5000,
  long: { threads: threads.map((t) => ({ name: t.name, pieces: t.pieces.length, rounds: t.rounds.length, recall: rxOf({ name: t.name, keys: kw(t.desc) }) })) },
  rounds,
};
const file = `src/eval/scenarios/long-${tag}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`${file}: ${threads.length} threads, ${rounds.length} rounds`);
for (const t of out.long.threads) console.log(`  ${t.name}: ${t.pieces} pieces, ${t.rounds} rounds, recall ${JSON.stringify(t.recall)}`);

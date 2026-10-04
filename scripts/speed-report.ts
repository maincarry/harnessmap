// Speed-analysis baseline for the e2e replay harness (Jacob asked "what about speed", 2026-10-03).
// Parses the per-stage timing summary lines the harness already prints and aggregates them:
//   per stage — call count, median, p90, max of per-call seconds; and cumulative seconds/round (Xs×N).
// Reads e2e task .output logs (default) or any files passed as argv; writes docs/E2E-TIMING.md.
// Pure read/aggregate — changes NO test behavior. Caveat baked into the report: these are
// codex gpt-5.6-luna (low reasoning) at HARNESSMAP_INFERENCE_CONCURRENCY=1 on a 3.9GB box = serialized
// worst-case, NOT production latency.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const argv = process.argv.slice(2);
const files = argv.length
  ? argv
  : execSync(`ls -t /tmp/claude-1000/-home-claude-projects/*/tasks/*.output 2>/dev/null || true`, { encoding: 'utf8' })
      .split('\n').filter(Boolean);

// A summary line looks like:
//   "... · [mid] 10 passed, 0 failed · ≈76k tokens · round 123s · filer 19.4s×4 relations 5.1s×3 memory 27.5s×7 mapcheck 8.3s×3 brain 68.7s×2 ..."
const rounds: number[] = [];
const paints: number[] = []; // perceived first-paint seconds (time to first visible node) — the metric the user actually waits on (Jacob speed thread)
const perCall: Record<string, number[]> = {};   // stage -> [seconds per call]
const perRoundCumulative: Record<string, number[]> = {}; // stage -> [X*N per summary line]
let lines = 0;
const seen = new Set<string>();

for (const f of files) {
  let txt: string; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of txt.matchAll(/round ([0-9.]+)s((?: · )?[^\n]*)/g)) {
    const rest = m[0];
    if (seen.has(rest)) continue; seen.add(rest); // dedupe identical summary lines
    lines++;
    rounds.push(parseFloat(m[1]));
    const pm = rest.match(/paint ([0-9.]+)s/); if (pm) paints.push(parseFloat(pm[1])); // perceived first-paint ('?' when unknown is skipped)
    for (const s of rest.matchAll(/([a-z]+) ([0-9.]+)s×([0-9]+)/g)) {
      const [, stage, sec, n] = s; const x = parseFloat(sec), k = parseInt(n, 10);
      (perCall[stage] ??= []).push(x);
      (perRoundCumulative[stage] ??= []).push(x * k);
    }
  }
}

const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};
const med = (a: number[]) => pct(a, 50);
const max = (a: number[]) => (a.length ? Math.max(...a) : 0);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const f1 = (n: number) => n.toFixed(1);

// Stage call-count totals (how many times each stage ran across all parsed rounds)
const callCount: Record<string, number> = {};
for (const st in perCall) callCount[st] = perCall[st].length;

// Order stages by total cumulative time (the real cost driver)
const stages = Object.keys(perCall).sort((a, b) => sum(perRoundCumulative[b]) - sum(perRoundCumulative[a]));

let out = `# e2e replay — speed baseline\n\n`;
out += `_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z by scripts/speed-report.ts from ${lines} harness timing lines (${files.length} log files)._\n\n`;
out += `**Caveat:** codex \`gpt-5.6-luna\` (reasoning_effort=low) at \`HARNESSMAP_INFERENCE_CONCURRENCY=1\` on the 3.9 GB box — fully **serialized, worst-case**. NOT production latency; a deployment that parallelizes stage calls and/or uses a faster memory/relations model will be far lower. Latency here is **entirely LLM-inference-bound**; structural/invariants work does not appear.\n\n`;

out += `## Perceived first-paint (time to first visible node — what the user actually waits on)\n`;
out += paints.length
  ? `samples ${paints.length} · median ${f1(med(paints))}s · p90 ${f1(pct(paints, 90))}s · max ${f1(max(paints))}s · min ${f1(Math.min(...paints))}s\n`
    + `This is the perceived-speed number (Jacob: "how fast the user sees the results"). The heavy memory/brain stages land AFTER first paint, off this critical path. As of v0.9.134 the map also shows a "filing…" ghost row acknowledging the turn at ~1s, so the turn never feels dropped even when this paint figure is high.\n\n`
  : `(no \`paint Ns\` lines parsed — only runs recorded after the paint instrumentation (8c50b09) carry it)\n\n`;

out += `## Per-round wall time\n`;
out += `samples ${rounds.length} · median ${f1(med(rounds))}s · p90 ${f1(pct(rounds, 90))}s · max ${f1(max(rounds))}s · min ${f1(Math.min(...rounds))}s\n`;
out += `(a full scenario is ~4–5 rounds)\n\n`;

out += `## Per-stage (sorted by total cumulative cost — the bottleneck order)\n\n`;
out += `| stage | calls | per-call median | per-call p90 | per-call max | cumulative/round median | share of total |\n`;
out += `|---|---|---|---|---|---|---|\n`;
const grandCumul = stages.reduce((s, st) => s + sum(perRoundCumulative[st]), 0) || 1;
for (const st of stages) {
  const share = (100 * sum(perRoundCumulative[st]) / grandCumul);
  out += `| ${st} | ${callCount[st]} | ${f1(med(perCall[st]))}s | ${f1(pct(perCall[st], 90))}s | ${f1(max(perCall[st]))}s | ${f1(med(perRoundCumulative[st]))}s | ${share.toFixed(0)}% |\n`;
}

out += `\n## Read\n`;
const top = stages[0], second = stages[1];
out += `- Cost is dominated by **${top}** then **${second}**.\n`;
out += `- **brain / brainChat** is the biggest *per-call* hit; the **memory** stage is the biggest *cumulative* hit (it runs many times per round, serialized at concurrency=1).\n`;
out += `- Levers (none change test correctness): parallelize the memory ×N and brain ×2 calls (concurrency=1 is the *harness* setting, not a product limit); a smaller/faster model for memory & relations; response caching.\n`;
out += `- Next step if wanted: promote these to a tracked metric — capture per-stage latency per run + a regression guard that flags a stage blowing past this baseline, so a slowdown reads as a red the way a correctness regression does. (Held pending founder go — it changes test pass/fail behavior.)\n`;

if (!existsSync('docs')) execSync('mkdir -p docs');
writeFileSync('docs/E2E-TIMING.md', out);
console.log(out);
console.error(`\n[speed-report] parsed ${lines} timing lines across ${files.length} logs → docs/E2E-TIMING.md`);

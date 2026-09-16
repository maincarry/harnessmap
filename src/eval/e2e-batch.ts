// M293: run several scenarios at once — each on its own port and folder — bounded by this box's memory (two at a time
// unless more than 2.2 GB is free). Prints each scenario's summary line; exits non-zero if any failed.
// Run: env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE bun run src/eval/e2e-batch.ts src/eval/scenarios/a.json src/eval/scenarios/b.json [...] [--keep]
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2).filter((a) => !a.startsWith('--')); const keep = process.argv.includes('--keep');
const ensembles = (process.argv.find((a) => a.startsWith('--models='))?.slice(9) ?? process.env.E2E_MODELS ?? 'mid').split(','); // --models=low,mid,high runs each scenario once per ensemble
const freeMb = () => { try { const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/); return m ? Math.round(Number(m[1]) / 1024) : 0; } catch { return 0; } };
const maxParallel = () => (freeMb() > 2200 ? 2 : freeMb() > 1400 ? 1 : 0);
let port = 8801; const results: { file: string; code: number; line: string }[] = [];
const running = new Set<Promise<void>>();
async function runOne(file: string, models = 'mid') {
  const p = port++;
  const proc = Bun.spawn(['bun', 'run', 'src/eval/e2e-run.ts', file, ...(keep ? ['--keep'] : [])], { env: { ...process.env, E2E_PORT: String(p), E2E_MODELS: models }, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text(); const code = await proc.exited;
  const line = out.split('\n').find((l) => l.includes('================')) ?? `(no summary; exit ${code})`;
  const fails = out.split('\n').filter((l) => /^\s+FAIL/.test(l)).join('\n');
  results.push({ file, code, line: line + (fails ? '\n' + fails : '') });
  console.log(`[${file.split('/').pop()} · ${models}] ${line}${fails ? '\n' + fails : ''}`);
}
const jobs: [string, string][] = []; for (const m of ensembles) for (const f of files) jobs.push([f, m]);
for (const [f, m] of jobs) {
  while (running.size >= Math.max(1, maxParallel())) { await Promise.race(running); }
  if (freeMb() < 1200) { console.log('waiting for memory…'); await new Promise((r) => setTimeout(r, 15000)); }
  const pr = runOne(f, m).finally(() => running.delete(pr)); running.add(pr);
  await new Promise((r) => setTimeout(r, 4000)); // stagger the server starts
}
await Promise.all(running);
const failed = results.filter((r) => r.code !== 0).length;
console.log(`\nbatch: ${results.length} scenario(s), ${failed} failed`);
process.exit(failed ? 1 : 0);

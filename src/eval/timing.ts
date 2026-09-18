// Timing sweep (Jacob, 2026-09-18 22:01 UTC: "filing time is a major concern… every function monitored, record what is too long").
// Per kept map: every inference call by task (filer, memory, relations, title, map-status chat, tidy/reorganize, import, autolit…)
// from the audit log — count, median, p90, max — and the calls over the too-long line. Usage: bun run timing.ts <db…> [--all]
import { Database } from 'bun:sqlite';
const LIMITS: Record<string, number> = { filer: 12000, memory: 25000, relations: 8000, title: 5000, 'map-status': 20000, brain: 20000, reorganize: 40000, tidy: 40000, import: 60000, autolit: 10000, summary: 20000, glossary: 10000, verify: 60000, guide: 20000, enrich: 40000, default: 30000 };
const files = Bun.argv.slice(2).filter((a) => !a.startsWith('--')); const all = Bun.argv.includes('--all');
const agg = new Map<string, number[]>(); const slow: string[] = []; const perRun: string[] = [];
const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
for (const f of files) {
  const tag = f.replace(/.*harnessmap-e2e-/, '').replace(/\/e2e.sqlite$/, '');
  let db: Database; try { db = new Database(f, { readonly: true }); } catch { continue; }
  const rows = db.query("select ts, detail from audit_log where kind = 'inference'").all() as any[];
  const local = new Map<string, number[]>(); let fails = 0;
  for (const r of rows) { let d: any = {}; try { d = JSON.parse(r.detail); } catch { continue; } const task = String(d.task ?? '?'); const ms = Number(d.ms ?? 0); if (d.ok === false) fails++; if (!local.has(task)) local.set(task, []); local.get(task)!.push(ms); if (!agg.has(task)) agg.set(task, []); agg.get(task)!.push(ms); const lim = LIMITS[task] ?? LIMITS.default; if (ms > lim) slow.push(`${tag} ${task} ${(ms / 1000).toFixed(1)}s (limit ${lim / 1000}s) at ${String(r.ts).slice(11, 19)}`); }
  const line = [...local.entries()].map(([t, a]) => `${t} n${a.length} med${(q(a, 0.5) / 1000).toFixed(1)} p90 ${(q(a, 0.9) / 1000).toFixed(1)} max${(Math.max(...a) / 1000).toFixed(1)}`).join(' · ');
  if (all || rows.length) perRun.push(`${tag}: ${line}${fails ? ` · FAILED calls ${fails}` : ''}`);
  db.close();
}
if (all) for (const l of perRun) console.log(l);
console.log('\n== per function, all runs (seconds)');
for (const [t, a] of [...agg.entries()].sort((x, y) => y[1].length - x[1].length)) { const lim = (LIMITS[t] ?? LIMITS.default) / 1000; const over = a.filter((x) => x > lim * 1000).length; console.log(`${t.padEnd(12)} n=${String(a.length).padStart(5)}  median ${(q(a, 0.5) / 1000).toFixed(1).padStart(5)}  p90 ${(q(a, 0.9) / 1000).toFixed(1).padStart(5)}  p99 ${(q(a, 0.99) / 1000).toFixed(1).padStart(5)}  max ${(Math.max(...a) / 1000).toFixed(1).padStart(6)}  over ${lim}s: ${over} (${(100 * over / a.length).toFixed(1)}%)`); }
console.log(`\n== too long (${slow.length})`); for (const s of slow.slice(0, 40)) console.log('  ' + s); if (slow.length > 40) console.log(`  … ${slow.length - 40} more`);

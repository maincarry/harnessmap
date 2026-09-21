// Scale/perf probe (Jacob 2026-09-21: "improve the tests" — biggest unknown is scale).
// Real maps top out at ~44 nodes; this measures how the DETERMINISTIC, size-scaling
// local hot paths degrade as node count grows 50 → 4000, and how big the model
// context (roster / tiered tree) gets — which drives inference latency and token cost.
// No inference: this isolates the product's own scaling, repeatable and falsifiable.
// Usage: bun run src/eval/scale-probe.ts [sizes csv]  e.g. 50,250,1000,4000
import { Store } from '../store/db.js';
import { loadMap, renderTree, renderTieredTree } from '../map/render.js';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const SIZES = (Bun.argv[2] ?? '50,100,250,500,1000,2000,4000').split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
const TYPES = ['task', 'decision', 'claim', 'constraint', 'question', 'note', null];
const STATUSES = ['live', 'decided', 'open', 'done', 'active', 'hard', 'provisional', 'rejected'];
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// timed-repeat: run fn R times, return median ms
const T = (fn: () => any, R = 5) => { const t: number[] = []; let out: any; for (let i = 0; i < R; i++) { const a = now(); out = fn(); t.push(now() - a); } return { ms: med(t), out }; };

// realistic-ish node content: a sentence or two, ~120-260 chars
function content(i: number): string {
  const base = `Node ${i}: the user asked about the ${['auth','cache','schema','render','filer','codex','sync','import','orbit','planet'][i % 10]} layer and we settled on an approach after weighing ${['latency','memory','clarity','cost','risk'][i % 5]} against ${['throughput','simplicity','safety'][i % 3]}.`;
  return i % 4 === 0 ? base + ` A follow-up detail was recorded so it is not lost: ${'x'.repeat(80)}.` : base;
}

console.log(`scale-probe — sizes ${SIZES.join(',')} · baseline RSS ${rss()} MB\n`);
console.log(['nodes', 'build_ms', 'getNodes_ms', 'loadMap_ms', 'renderTree_ms', 'tree_chars', 'tiered40k_ms', 'tiered_chars', 'roster12k_chars', 'db_KB', 'RSS_MB'].join('\t'));

for (const N of SIZES) {
  const dbPath = `/tmp/claude-1000/scale-probe-${N}.sqlite`;
  try { rmSync(dbPath, { force: true }); rmSync(dbPath + '-wal', { force: true }); rmSync(dbPath + '-shm', { force: true }); } catch {}
  const store = new Store(dbPath);
  const pid = store.createProject(`scale-${N}`);
  // Build a realistic tree: ~8 top-level topics, each with children a few deep.
  const ids: string[] = [];
  const topics = Math.max(4, Math.round(Math.sqrt(N)));
  const tb = now();
  for (let i = 0; i < N; i++) {
    const id = randomUUID();
    // parent: root for topics, else a random earlier node (biases shallow, some depth)
    let parentId: string | null = null;
    if (i >= topics && ids.length) parentId = ids[Math.floor((i % 997) / 997 * ids.length) % ids.length] ?? null;
    store.createNode({
      id, projectId: pid, parentId,
      content: content(i),
      type: TYPES[i % TYPES.length] as any,
      status: STATUSES[i % STATUSES.length],
      author: i % 3 === 0 ? 'user' : 'agent',
      title: i % 5 === 0 ? `topic ${i}` : undefined,
    });
    ids.push(id);
  }
  const buildMs = now() - tb;

  const g = T(() => store.getNodes(pid));
  const l = T(() => loadMap(store, pid));
  const map = l.out;
  const r = T(() => renderTree(map, { ids: false }));
  const treeChars = (r.out as string).length;
  const tt = T(() => renderTieredTree(store, pid, null, 40_000), 3);
  const tieredChars = (tt.out as string).length;
  // brain roster: renderTree(...).slice(0,12000) — chars actually sent
  const rosterChars = Math.min(12_000, treeChars);

  const { execSync } = await import('node:child_process');
  let dbKB = 0; try { dbKB = Math.round(parseInt(execSync(`stat -c %s ${dbPath}`).toString().trim(), 10) / 1024); } catch {}

  console.log([N, buildMs.toFixed(0), g.ms.toFixed(1), l.ms.toFixed(1), r.ms.toFixed(1), treeChars, tt.ms.toFixed(1), tieredChars, rosterChars, dbKB, rss()].join('\t'));
  store.close?.();
  try { rmSync(dbPath, { force: true }); rmSync(dbPath + '-wal', { force: true }); rmSync(dbPath + '-shm', { force: true }); } catch {}
}
console.log(`\nfinal RSS ${rss()} MB`);

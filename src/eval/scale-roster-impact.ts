// Scale finding real-impact test (loop 2026-09-21): the brain roster is renderTree(...).slice(0,12_000)
// (mapstatus.ts:718), which truncates at ~80 nodes. Does that cause a WRONG brain answer on a big map for a
// fact in a LATE node (beyond the cutoff)? And does the understanding channel rescue it in production?
// Usage: HARNESSMAP_INFERENCE=codex CODEX_HOME=$HOME/.codex bun run src/eval/scale-roster-impact.ts
import { Store } from '../store/db.js';
import { loadMap, renderTree } from '../map/render.js';
import { brainChat } from '../translator/mapstatus.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FACT = "The staging database is seeded from a snapshot named 'Borealis-Quartz-7', taken every Sunday at 02:00.";
const PROBE = 'What is the staging database seeded from? Answer briefly from the map.';
const NEEDLE = /borealis[- ]?quartz[- ]?7/i;

function buildMap() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'scale-')), 'map.sqlite'));
  const pid = store.createProject('Big Ops Map');
  const alts: any[] = [];
  const root = randomUUID();
  alts.push({ op: 'create_node', id: root, parentId: null, content: 'Big Ops Map', title: 'Big Ops Map', status: 'live', author: 'user' });
  const topics = ['Auth', 'Caching', 'Schema', 'Rendering', 'Filer', 'Codex', 'Sync', 'Import', 'Billing', 'Search', 'Onboarding', 'Perf', 'Security', 'Mobile', 'Testing', 'Deploy', 'Logging', 'Metrics', 'Backups', 'Staging'];
  topics.forEach((t, ti) => {
    const tid = randomUUID();
    alts.push({ op: 'create_node', id: tid, parentId: root, content: `${t}: decisions and notes for the ${t.toLowerCase()} area of the system, discussed over several rounds.`, title: t, type: 'decision', status: 'decided', author: 'agent' });
    for (let k = 0; k < 4; k++) {
      // put the FACT in a child of the LAST topic (Staging) — depth-first, this lands late in the tree
      const isFact = ti === topics.length - 1 && k === 2;
      alts.push({ op: 'create_node', id: randomUUID(), parentId: tid, content: isFact ? FACT : `${t} detail ${k}: worked through and settled after review.`, title: isFact ? 'Staging seed' : `${t} ${k}`, status: 'live', author: 'agent' });
    }
  });
  store.applyAlterations(pid, alts, { kind: 'system' });
  return { store, pid };
}

const { store, pid } = buildMap();
const nodes = loadMap(store, pid).nodes.filter((n) => n.status !== 'removed');
const fullTree = renderTree(loadMap(store, pid), { ids: false });
const roster = fullTree.slice(0, 12_000);
console.log(`=== SCALE ROSTER IMPACT ===`);
console.log(`nodes: ${nodes.length} · full tree chars: ${fullTree.length} · roster (12k) chars: ${roster.length}`);
console.log(`fact in FULL tree? ${NEEDLE.test(fullTree) ? 'yes' : 'NO'} · fact in ROSTER (12k)? ${NEEDLE.test(roster) ? 'YES (not truncated — move it later)' : 'no ✓ (beyond the cutoff)'}\n`);

async function ask(): Promise<string> { const r = await brainChat(store, pid, PROBE); return ('reply' in r) ? r.reply : `ERROR:${(r as any).error}`; }

// Arm A: roster only (understanding OFF) — isolates the roster truncation
process.env.HARNESSMAP_BRAIN_UNDERSTANDING = '0'; delete process.env.HARNESSMAP_BRAIN_ROSTER;
const a = await ask();
console.log('ARM A roster-only (understanding OFF):', a.replace(/\s+/g, ' ').slice(0, 220));
console.log('  → knows the late fact?', NEEDLE.test(a) ? 'YES' : 'NO (roster truncated it)', '\n');

// Arm B: production — both roster AND understanding
delete process.env.HARNESSMAP_BRAIN_UNDERSTANDING; delete process.env.HARNESSMAP_BRAIN_ROSTER;
const b = await ask();
console.log('ARM B production (roster + understanding):', b.replace(/\s+/g, ' ').slice(0, 220));
console.log('  → knows the late fact?', NEEDLE.test(b) ? 'YES (understanding rescued it)' : 'NO (real gap at scale)', '\n');

console.log('=== verdict ===');
if (!NEEDLE.test(a) && NEEDLE.test(b)) console.log('Roster truncates the late fact, but the UNDERSTANDING rescues it in production → not a user-facing gap at this size.');
else if (!NEEDLE.test(a) && !NEEDLE.test(b)) console.log('REAL GAP: on a >80-node map the brain loses a late-node fact in production (roster truncated AND understanding did not capture it).');
else if (NEEDLE.test(a)) console.log('Fact was within the roster after all — increase map size / push the fact later.');
process.exit(0);

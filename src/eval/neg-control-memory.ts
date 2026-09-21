// Memory-core NEGATIVE CONTROL (Jacob 2026-09-21: "feed a deliberately-wrong/absent map and confirm the
// memory checks FAIL"). Plants facts the model CANNOT know from priors (a FaunaDB decision, a Pi cluster
// "Nimbus-7"), then asks the brain the same question under THREE grounding regimes. This exposes exactly
// which channel grounds the brain — and revealed that HARNESSMAP_BRAIN_ROSTER=0 alone is NOT un-grounded
// (the written understanding is a second, map-derived channel). Usage:
//   HARNESSMAP_INFERENCE=codex CODEX_HOME=$HOME/.codex bun run src/eval/neg-control-memory.ts
import { Store } from '../store/db.js';
import { brainChat } from '../translator/mapstatus.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function buildMap() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'negctl-')), 'map.sqlite'));
  const pid = store.createProject('negctl');
  const root = randomUUID(), c1 = randomUUID(), c2 = randomUUID(), c3 = randomUUID();
  store.applyAlterations(pid, [
    { op: 'create_node', id: root, parentId: null, content: 'Project Nimbus', title: 'Project Nimbus', status: 'live', author: 'user' } as any,
    { op: 'create_node', id: c1, parentId: root, content: 'Database decision: the team chose FaunaDB on 2026-09-10, over Postgres and Mongo, for its built-in temporality.', title: 'Database', type: 'decision', status: 'decided', author: 'user' } as any,
    { op: 'create_node', id: c2, parentId: root, content: 'Deploy target: a Raspberry Pi cluster codenamed Nimbus-7 in the basement lab.', title: 'Deploy target', type: 'decision', status: 'decided', author: 'user' } as any,
    { op: 'create_node', id: c3, parentId: root, content: 'The design review is scheduled for the last Thursday of each month.', title: 'Design review cadence', type: 'note', status: 'live', author: 'user' } as any,
  ], { kind: 'system' });
  return { store, pid };
}

const Q = 'Two factual questions about this project: which database did we decide on, and what is the deploy target? Answer briefly from the map.';
async function ask(): Promise<string> {
  const { store, pid } = buildMap();
  const r = await brainChat(store, pid, Q);
  return ('reply' in r) ? r.reply : `ERROR: ${(r as any).error}`;
}
const has = (s: string, re: RegExp) => re.test(s);
const DB = /fauna\s*db|faunadb/i, DEP = /nimbus-?7|raspberry\s*pi/i;
const grounded = (s: string) => has(s, DB) && has(s, DEP);

console.log('=== MEMORY-CORE NEGATIVE CONTROL (3 arms) ===\n');

// ARM 1 — full grounding
delete process.env.HARNESSMAP_BRAIN_ROSTER; delete process.env.HARNESSMAP_BRAIN_UNDERSTANDING;
const a1 = await ask();
console.log('ARM 1  roster ON  + understanding ON  (full):', a1.replace(/\s+/g, ' ').slice(0, 240), '\n');

// ARM 2 — roster OFF, understanding ON  = this morning's benchmark "baseline"
process.env.HARNESSMAP_BRAIN_ROSTER = '0'; delete process.env.HARNESSMAP_BRAIN_UNDERSTANDING;
const a2 = await ask();
console.log('ARM 2  roster OFF + understanding ON  (="baseline"):', a2.replace(/\s+/g, ' ').slice(0, 240), '\n');

// ARM 3 — roster OFF, understanding OFF = TRUE un-grounded control
process.env.HARNESSMAP_BRAIN_ROSTER = '0'; process.env.HARNESSMAP_BRAIN_UNDERSTANDING = '0';
const a3 = await ask();
console.log('ARM 3  roster OFF + understanding OFF (TRUE un-grounded):', a3.replace(/\s+/g, ' ').slice(0, 240), '\n');

console.log('=== grounding by arm (does the reply carry the planted facts?) ===');
console.log(`  ARM 1 full            : ${grounded(a1) ? 'GROUNDED ✓' : 'not grounded'}   (expect GROUNDED)`);
console.log(`  ARM 2 understanding-only: ${grounded(a2) ? 'GROUNDED' : 'not grounded'}   (small map: understanding is complete, so expected GROUNDED — NOT an un-grounded baseline)`);
console.log(`  ARM 3 truly un-grounded : ${grounded(a3) ? 'GROUNDED ✗ LEAK' : 'not grounded ✓'}   (expect NOT grounded — this is the real negative control)`);

const controlHolds = grounded(a1) && !grounded(a3);
console.log('\n=== verdict ===');
if (controlHolds) {
  console.log('NEGATIVE CONTROL HOLDS: with ALL map-derived channels removed (arm 3) the brain no longer knows the\nplanted facts — so the memory checks FAIL when grounding is truly absent, and PASS when it is present.\nFINDING: HARNESSMAP_BRAIN_ROSTER=0 alone (arm 2) is NOT un-grounded — the written understanding grounds\nit too. This morning\'s "baseline" was understanding-only; its separations came from the roster recovering\nwhat the COMPRESSED understanding lost on LARGE maps, not from removing all grounding.');
} else {
  console.log('CONTROL STILL BROKEN: arm 1 not grounded or arm 3 still grounded — another channel leaks map content.');
}
process.exit(controlHolds ? 0 : 1);

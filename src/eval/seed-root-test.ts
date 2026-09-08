// M215: the import adopts a pristine map's seed root as its container.
// Mechanical (no model): a temp store, a map born the way the server bears
// later maps (one seed node named after the map + the "to sort" tray), a
// fake import proposal shaped like the model's, adoption, apply, assert.
import { Store } from '../store/db.js';
import { seedRootOf, adoptSeedRoot } from '../translator/importer.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const store = new Store(join(mkdtempSync(join(tmpdir(), 'seedroot-')), 'map.sqlite'));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const tops = (pid: string) => store.getNodes(pid).filter((n) => n.parentId === null && n.status !== 'removed');

// 1. a later map: seed named after the map + to sort → adoptable
const pid = store.createProject('harnessmap v7');
const seedId = randomUUID(), sortId = randomUUID();
store.applyAlterations(pid, [
  { op: 'create_node', id: sortId, parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any,
  { op: 'create_node', id: seedId, parentId: null, content: 'harnessmap v7', status: 'live', author: 'user' } as any,
], { kind: 'system' });
const seed = seedRootOf(store, pid);
ok('seed found', seed?.id === seedId && seed?.name === 'harnessmap v7');
const alts: any[] = [
  { op: 'create_node', id: 'r1', parentId: null, title: 'Design notes', content: 'Design notes for the product', status: 'live' },
  { op: 'create_node', id: 'c1', parentId: 'r1', title: 'Chapter one', content: 'Chapter one statement', status: 'live' },
  { op: 'create_node', id: 'c2', parentId: 'r1', title: 'Chapter two', content: 'Chapter two statement', status: 'live' },
  { op: 'create_node', id: 'g1', parentId: 'c1', content: 'grandchild', status: 'live' },
  { op: 'move_node', id: 'g1', parentId: 'r1' },
  { op: 'update_node', id: 'r1', title: 'Design notes, renamed' },
];
const memories: Record<string, string> = { r1: 'root memory', c1: 'chapter memory' };
const root = adoptSeedRoot(alts, 'r1', seed, memories);
ok('rootId is the seed', root === seedId);
ok('container create became a seed update', alts[0].op === 'update_node' && alts[0].id === seedId && alts[0].title === 'Design notes');
ok('children re-homed', alts[1].parentId === seedId && alts[2].parentId === seedId);
ok('move target remapped', alts[4].parentId === seedId);
ok('later update of the container remapped', alts[5].id === seedId);
ok('memory key moved', memories[seedId] === 'root memory' && !('r1' in memories));
store.applyAlterations(pid, alts, { kind: 'reorganize' });
ok('exactly two top-level nodes (seed + to sort)', tops(pid).length === 2);
ok('seed renamed', store.getNode(seedId)?.title === 'Design notes, renamed');
ok('seed has the chapters', store.getNodes(pid).filter((n) => n.parentId === seedId).length === 3);

// 2. a map with children under its top node is not pristine → no adoption
ok('not adoptable once filled', seedRootOf(store, pid) === null);

// 3. the tutorial map (getting started + children) → no adoption
const pid2 = store.createProject('first');
const gs = randomUUID();
store.applyAlterations(pid2, [
  { op: 'create_node', id: gs, parentId: null, content: 'getting started', status: 'live', author: 'system' } as any,
  { op: 'create_node', id: randomUUID(), parentId: gs, content: 'this map takes notes for you', status: 'live', author: 'system' } as any,
], { kind: 'system' });
ok('tutorial map keeps its own container', seedRootOf(store, pid2) === null);
const alts2: any[] = [{ op: 'create_node', id: 'r2', parentId: null, title: 'Import', content: 'x', status: 'live' }];
ok('no seed → rootId unchanged', adoptSeedRoot(alts2, 'r2', null) === 'r2' && alts2[0].op === 'create_node');

// 4. two top-level nodes besides to sort → not pristine
const pid3 = store.createProject('two tops');
store.applyAlterations(pid3, [
  { op: 'create_node', id: randomUUID(), parentId: null, content: 'a', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: randomUUID(), parentId: null, content: 'b', status: 'live', author: 'user' } as any,
], { kind: 'system' });
ok('two tops → no adoption', seedRootOf(store, pid3) === null);

console.log(`seed-root: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

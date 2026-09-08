// M215: the import adopts a pristine map's seed root as its container.
// Mechanical (no model): a temp store, a map born the way the server bears
// later maps (one seed node named after the map + the "to sort" tray), a
// fake import proposal shaped like the model's, adoption, apply, assert.
import { Store } from '../store/db.js';
import { seedRootOf, adoptSeedRoot, placementMode, outlineWithIds, placeCreates, importPreviewRoots } from '../translator/importer.js';
import { measureMap, shapeFindings } from '../translator/mapstatus.js';
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
const ta = randomUUID(), tb = randomUUID();
store.applyAlterations(pid3, [
  { op: 'create_node', id: ta, parentId: null, content: 'a', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: tb, parentId: null, content: 'b', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: randomUUID(), parentId: ta, content: 'under a', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: randomUUID(), parentId: tb, content: 'under b', status: 'live', author: 'user' } as any,
], { kind: 'system' });
ok('two tops → no adoption', seedRootOf(store, pid3) === null);

// 5. M215 brain: the instruments see the roots; an empty root beside a container is a finding
const pid4 = store.createProject('v6 shape');
const seed4 = randomUUID(), cont4 = randomUUID();
store.applyAlterations(pid4, [
  { op: 'create_node', id: randomUUID(), parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any,
  { op: 'create_node', id: seed4, parentId: null, content: 'HarnessMap', title: 'HarnessMap', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: cont4, parentId: null, content: 'Design requests', title: 'Design requests', status: 'live', author: 'agent' } as any,
  { op: 'create_node', id: randomUUID(), parentId: cont4, content: 'chapter', status: 'live', author: 'agent' } as any,
], { kind: 'system' });
const inst = measureMap(store, pid4);
ok('instruments count two roots, one empty', inst.topLevel.count === 2 && inst.topLevel.empty.length === 1 && inst.topLevel.empty[0] === 'HarnessMap');
const sf = shapeFindings(inst);
ok('empty root is a finding with the fold as its fix', sf.length === 1 && /empty root/.test(sf[0].what) && /fold "Design requests" into "HarnessMap"/.test(sf[0].fix));
const inst1 = measureMap(store, pid);  // the adopted map: one root with chapters
ok('a folded map has no shape finding', shapeFindings(inst1).length === 0 && inst1.topLevel.count === 1);
const instT = measureMap(store, pid3); // two filled roots
ok('two roots without an empty one is the split-trees finding', shapeFindings(instT).length === 1 && /2 roots/.test(shapeFindings(instT)[0].what));

// 6. M216 placement: a filled map is in placement mode; a pristine one and an empty one are not
ok('filled map → placement mode', placementMode(store, pid) === true);
const pid5 = store.createProject('empty'); 
ok('empty map → no placement', placementMode(store, pid5) === false);
const pid6 = store.createProject('pristine'); const s6 = randomUUID();
store.applyAlterations(pid6, [{ op: 'create_node', id: s6, parentId: null, content: 'pristine', status: 'live', author: 'user' } as any], { kind: 'system' });
ok('pristine map → seed adoption, not placement', placementMode(store, pid6) === false && seedRootOf(store, pid6)?.id === s6);
// outline with ids rolls up under a cap and shows every id
const outline = outlineWithIds(store.getNodes(pid) as any, 400);
ok('outline shows ids', outline.includes(`[${seedId.slice(0, 8)}]`) && outline.split('\n').length >= 2);
const c1id = store.getNodes(pid).find((n) => n.title === 'Chapter one')!.id;
store.applyAlterations(pid, [{ op: 'create_node', id: randomUUID(), parentId: c1id, content: 'a grandchild', status: 'live', author: 'user' } as any], { kind: 'system' });
const tiny = outlineWithIds(store.getNodes(pid) as any, 10);
ok('outline under a tiny cap rolls deeper levels up', /Chapter one \(\+1 inside\)/.test(tiny) && !tiny.includes('a grandchild'));
ok('outline under a roomy cap shows everything', outlineWithIds(store.getNodes(pid) as any, 5000).includes('a grandchild'));
// the sweep: existing parents kept, batch/known parents kept, strays → container, else main root
const chapters = store.getNodes(pid).filter((n) => n.parentId === seedId);
const exIds = new Set(store.getNodes(pid).map((n) => n.id));
const batch: any[] = [
  { op: 'create_node', id: 'k1', parentId: chapters[0].id, content: 'placed under an existing chapter' },
  { op: 'create_node', id: 'k2', parentId: 'k1', content: 'under a batch node' },
  { op: 'create_node', id: 'k3', parentId: 'nowhere', content: 'stray' },
  { op: 'create_node', id: 'k4', parentId: null, content: 'parentless' },
];
const placed = placeCreates(batch, null, new Set(['k1', 'k2', 'k3', 'k4']), exIds, seedId);
ok('existing parent kept and reported', batch[0].parentId === chapters[0].id && placed.has(chapters[0].id));
ok('batch parent kept', batch[1].parentId === 'k1');
ok('stray and parentless go to the main root when there is no container', batch[2].parentId === seedId && batch[3].parentId === seedId);
const batch2: any[] = [{ op: 'create_node', id: 'c0', parentId: null, content: 'container' }, { op: 'create_node', id: 'k5', parentId: 'nowhere', content: 'stray' }];
placeCreates(batch2, 'c0', new Set(['c0', 'k5']), exIds, seedId);
ok('with a container, strays go under it', batch2[1].parentId === 'c0' && batch2[0].parentId === null);
// preview roots: the container plus every existing area touched
const roots = importPreviewRoots(store, [...batch2, batch[0]], 'c0');
ok('preview roots = container + touched areas', roots[0] === 'c0' && roots.includes(chapters[0].id) && roots.length === 2);

// importPreviewRoots must not double-list a container that sits under the main root
ok('preview roots: a container under the main root lists once', importPreviewRoots(store, [{ op: 'create_node', id: 'c9', parentId: seedId, content: 'chapter container' }], 'c9').join() === ['c9', seedId].join());

console.log(`seed-root: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

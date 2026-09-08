// M231: the coverage check — mechanical.
import { Store } from '../store/db.js';
import { rareTokens, coverageOf } from '../map/match.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let pass = 0, fail = 0; const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const store = new Store(join(mkdtempSync(join(tmpdir(), 'cov-')), 'map.sqlite')); const pid = store.createProject('c');
const root = randomUUID();
store.applyAlterations(pid, [{ op: 'create_node', id: root, parentId: null, content: 'Map', status: 'live', author: 'user' } as any,
  ...Array.from({ length: 40 }, (_, i) => ({ op: 'create_node', id: randomUUID(), parentId: root, content: `The map serves the agent a block every turn (${i})`, status: 'live', author: 'agent' } as any)),
  { op: 'create_node', id: randomUUID(), parentId: root, content: 'The amber dot was purged in M109d; suggestion dots are red', status: 'decided', author: 'agent' } as any,
], { kind: 'system' });
const rare = rareTokens(store, pid, 'what happened to the amber dot and the block?');
ok('rare words are the ones on the map in few nodes ("amber"), not the common ones ("block", "agent")', rare.includes('amber') && !rare.includes('block') && !rare.includes('agent'));
ok('a word absent from the map is not rare (nothing to cover)', !rareTokens(store, pid, 'the zebra amber').includes('zebra'));
const c1 = coverageOf('The amber dot was purged in M109d', ['amber', 'purged']);
ok('coverage counts the rare words present', c1.share === 1 && c1.missing.length === 0);
const c2 = coverageOf('Suggestion dots are red', ['amber', 'purged']);
ok('missing words are named', c2.share === 0 && c2.missing.join() === 'amber,purged');
ok('no rare words → full coverage (no warning)', coverageOf('anything', []).share === 1);
console.log(`coverage: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

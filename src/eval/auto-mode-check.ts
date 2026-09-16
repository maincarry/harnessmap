// M263: auto mode's mechanical guards, checked without a model.
// Run: bun run src/eval/auto-mode-check.ts
import { Store } from '../store/db.js';
import { aimCascade, roundLeftFocus } from '../translator/autolit.js';
import { rmSync } from 'fs';

const p = '/tmp/claude-1000/auto-mode-check.sqlite'; try { rmSync(p); rmSync(p + '-wal'); rmSync(p + '-shm'); } catch {}
const st = new Store(p); const pid = 'p1'; const db = (st as any).db;
db.prepare('INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)').run(pid, 'scratch');
st.applyAlterations(pid, [
  { op: 'create_node', id: 'root', parentId: null, content: 'Project', title: 'Project', status: 'live', author: 'user' },
  { op: 'create_node', id: 'A', parentId: 'root', content: 'Area A', title: 'Area A', status: 'live', author: 'agent' },
  { op: 'create_node', id: 'a1', parentId: 'A', content: 'A one', title: 'A one', status: 'live', author: 'agent' },
  { op: 'create_node', id: 'a2', parentId: 'A', content: 'A two', title: 'A two', status: 'live', author: 'agent' },
  { op: 'create_node', id: 'B', parentId: 'root', content: 'Area B', title: 'Area B', status: 'live', author: 'agent' },
  { op: 'create_node', id: 'b1', parentId: 'B', content: 'B one', title: 'B one', status: 'live', author: 'agent' },
] as any, { kind: 'system' } as any);
db.prepare("INSERT INTO chats (id, project_id, focus_container_id, status, created_at) VALUES ('c1', ?, 'A', 'active', datetime('now'))").run(pid);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// 1. who lit it
st.setLit('c1', 'root', true); st.setLit('c1', 'A', true, 'map'); st.setLit('c1', 'b1', true, 'user');
check('a hand-lit node is remembered as the user\'s', same(st.getUserLit('c1'), ['b1']));
st.setLit('c1', 'b1', true, 'map');
check('the map lighting it again does not take the mark away', same(st.getUserLit('c1'), ['b1']));
st.setLit('c1', 'a1', true, 'map'); st.setLit('c1', 'a1', true, 'user');
check('the person lighting a map-lit node makes it theirs', same(st.getUserLit('c1'), ['a1', 'b1']));
st.setLit('c1', 'a1', false);
check('dimming clears the row and the mark', same(st.getUserLit('c1'), ['b1']) && !st.getLit('c1').includes('a1'));

// 2. the cascade under the guards
const keep = new Set(['root', 'A']);
const r1 = aimCascade(st, ['a2'], ['B', 'A'], keep, new Set(st.getUserLit('c1')));
check('dimming a chapter skips the hand-lit node inside it and reports it kept', same(r1.toDim, ['B', 'a1', 'a2']) && same(r1.kept, ['b1']));
check('the focus path never dims (A on the path is skipped; its non-path children do go dark)', !r1.toDim.includes('A') && !r1.toDim.includes('root'));
check('lighting cascades to the subtree', same(r1.toLight, ['a2']));
const r2 = aimCascade(st, ['B'], ['root'], keep, new Set());
check('dimming the root dims everything off the path, nothing on it', same(r2.toDim, ['a1', 'a2', 'B', 'b1']) && same(r2.toLight, ['B', 'b1']));

// 3. the skip rule
check('a round that stayed inside the focus does not re-aim', roundLeftFocus(st, 'A', [{ op: 'update_node', id: 'a1' }, { op: 'create_node', id: 'a2' }]) === false);
check('a round that touched the focus node itself does not re-aim', roundLeftFocus(st, 'A', [{ op: 'update_node', id: 'A' }]) === false);
check('a round that landed outside the focus re-aims', roundLeftFocus(st, 'A', [{ op: 'update_node', id: 'a1' }, { op: 'create_node', id: 'b1' }]) === true);
check('a round with nothing filed does not re-aim', roundLeftFocus(st, 'A', []) === false);
check('a focus that is the whole map (the only top-level topic) is no aim: every filed round re-aims', roundLeftFocus(st, 'root', [{ op: 'update_node', id: 'a1' }]) === true);
st.applyAlterations(pid, [{ op: 'create_node', id: 'root2', parentId: null, content: 'Second area', title: 'Second area', status: 'live', author: 'user' }] as any, { kind: 'system' } as any);
check('with two top-level topics, a top-level focus is a real aim again (inside = skip)', roundLeftFocus(st, 'root', [{ op: 'update_node', id: 'a1' }]) === false);

// 4. exact restore (the undo of an aim)
const rows = st.getLitRows('c1');
st.setLit('c1', 'b1', false); st.setLit('c1', 'B', true, 'map'); st.setLit('c1', 'a2', true, 'map');
st.restoreLit('c1', rows);
check('undo restores the lit set exactly, marks included', same(st.getLit('c1'), rows.map((r) => r.id)) && same(st.getUserLit('c1'), ['b1']));

console.log(`\nauto-mode check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// M227: governors — the store, estates, routing, and the king's advice; mechanical.
import { Store } from '../store/db.js';
import { getMind, listMinds, upsertMind, retireMind, nearestGovernor, estateOf, seedFromAssessments, settleEstates, mergeAreaAdvice, adviceForNode } from '../translator/governors.js';
import { statusConsult } from '../translator/mapstatus.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let pass = 0, fail = 0; const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const store = new Store(join(mkdtempSync(join(tmpdir(), 'brain-')), 'map.sqlite')); const pid = store.createProject('g'); const db = (store as any).db;
const root = randomUUID(), chA = randomUUID(), chB = randomUUID(), leafA = randomUUID(), leafB = randomUUID();
store.applyAlterations(pid, [
  { op: 'create_node', id: root, parentId: null, content: 'Map', title: 'Map', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: chA, parentId: root, content: 'Tidy agent', title: 'Tidy agent', status: 'active', author: 'agent' } as any,
  { op: 'create_node', id: chB, parentId: root, content: 'Import agent', title: 'Import agent', status: 'active', author: 'agent' } as any,
  { op: 'create_node', id: leafA, parentId: chA, content: 'Tidy proposals cap at 40 moves', status: 'decided', author: 'agent' } as any,
  { op: 'create_node', id: leafB, parentId: chB, content: 'Chunks are 8k characters', status: 'decided', author: 'agent' } as any,
], { kind: 'system' });
// migration: assessments become first understandings
db.prepare("INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, '2026-09-01 10:00:00')").run(pid, chA, 'Tidy: proposals, caps, modal.');
db.prepare("INSERT INTO chapter_assessments (project_id, chapter_id, text, updated_at) VALUES (?, ?, ?, '2026-09-02 10:00:00')").run(pid, chB, 'Import: chunks, summary, finish pass.');
ok('seed makes one governor per assessment', seedFromAssessments(store, pid) === 2 && listMinds(store, pid, 'active').length === 2);
ok('seed is idempotent', seedFromAssessments(store, pid) === 0);
ok('a seeded governor remembers its birth', /born from the assessment of 2026-09-01/.test(getMind(store, pid, chA)!.log) && getMind(store, pid, chA)!.understanding.startsWith('Tidy'));
// refresh with memory
const m1 = upsertMind(store, pid, chA, { understanding: 'Tidy: proposals capped at 40 moves; modal side by side.', logLine: 'the move cap landed', disagreements: ['the centre calls the cap provisional; node 7e2f (2026-09-09) says decided'] });
ok('refresh keeps the log and the disagreement', m1.log.split('\n').length === 2 && /move cap landed/.test(m1.log) && m1.disagreements.length === 1);
// routing: the nearest governor above a leaf; nothing above the root
ok('nearest governor of a leaf is its chapter', nearestGovernor(store, pid, leafA)?.nodeId === chA);
ok('the root has no governor', nearestGovernor(store, pid, root) === null);
// the king's advice: merged by area, unknown ids never stored, served to agents by nearest area
mergeAreaAdvice(store, pid, [{ rootId: chA, advice: 'Protect the 40-move cap; the modal layout is settled.' }]);
ok('advice for a leaf is the king\'s advice for its area', adviceForNode(store, pid, leafA)?.advice.startsWith('Protect') === true && adviceForNode(store, pid, leafB) === null);
ok('the consult serves the king\'s advice, never the governor\'s text', /CENTRAL MIND'S ADVICE FOR THIS AREA/.test(statusConsult(store, pid, leafA, 'filing')) && !/proposals capped at 40 moves; modal side by side/.test(statusConsult(store, pid, leafA, 'filing')));
ok('no advice yet → nothing local in the consult', !/ADVICE FOR THIS AREA|ASSESSMENT/.test(statusConsult(store, pid, leafB, 'filing')));
// an estate: fold Import into Tidy (children move, the chapter is removed), then settle
store.applyAlterations(pid, [{ op: 'move_node', id: leafB, parentId: chA } as any, { op: 'update_node', id: chB, status: 'removed' } as any], { kind: 'reorganize' });
ok('settle retires the governor whose area is gone', settleEstates(store, pid) === 1 && getMind(store, pid, chB)!.status === 'retired');
ok('the successor carries the estate', getMind(store, pid, chA)!.predecessors.includes(chB) && /Import: chunks/.test(estateOf(store, pid, chA)));
ok('retired text stays readable and the log says where it went', /estate passed to/.test(getMind(store, pid, chB)!.log) && getMind(store, pid, chB)!.understanding.startsWith('Import'));
ok('settle is idempotent', settleEstates(store, pid) === 0);
ok('a leaf that moved routes to its new governor', nearestGovernor(store, pid, leafB)?.nodeId === chA);
// retiring a governor with no successor (area gone entirely)
const chC = randomUUID(); store.applyAlterations(pid, [{ op: 'create_node', id: chC, parentId: root, content: 'Gone', status: 'live', author: 'agent' } as any], { kind: 'system' });
upsertMind(store, pid, chC, { understanding: 'was here' }); store.applyAlterations(pid, [{ op: 'update_node', id: chC, status: 'removed' } as any], { kind: 'user_edit' });
settleEstates(store, pid);
ok('a governor with no heir retires to no one and keeps its text', getMind(store, pid, chC)!.status === 'retired' && /no one|estate passed/.test(getMind(store, pid, chC)!.log));
console.log(`brain: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

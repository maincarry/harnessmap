// M473 (RECORD TEST #3 — the long record): when the roster does not fit the brain's budget, the rows relevant to the question are read from
// the WHOLE map (with every root for shape), not a flat cut that hid 193 of 376 rows and made the brain say "the map does not record…".
import { test, expect } from 'bun:test';
import { selectRowsForQuestion, questionTokens, routeEstates } from './mapstatus';

const mk = (id: string, parentId: string | null, title: string, content: string, author = 'user', i = 0) => ({ id, parentId, title, content, author, type: null, status: 'live', createdAt: `2026-10-09T0${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00Z`, updatedAt: `2026-10-09T0${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00Z` });
// a 400-row map: 20 roots × 20 children of filler, with the answers planted deep in the LATER roots (past any 24k cut)
const nodes: any[] = [];
for (let r = 0; r < 20; r++) { nodes.push(mk(`r${r}`, null, `Topic ${r} about project work`, `Topic ${r} about project work`, 'user', r)); for (let c = 0; c < 20; c++) nodes.push(mk(`r${r}c${c}`, `r${r}`, `Note ${r}-${c}`, `A routine remark number ${r}-${c} about the project with ordinary words and nothing specific to find here.`, c % 2 ? 'agent' : 'user', 20 + r * 20 + c)); }
nodes.push(mk('q1', 'r17', 'Quizlet API docs URL', 'The Quizlet API documentation URL `https://quizlet.com/help/api-docs` was discussed as redirecting.', 'agent', 500));
nodes.push(mk('q2', 'r18c3', 'Minimum VPS resources', 'The agent recommended at least 2 CPU cores and 2 GB RAM for the Python VPS runner.', 'agent', 501));
nodes.push(mk('q3', 'r19', 'Random numbers limit', 'Generate numbers until 15000, then output the first 10 in ascending order.', 'user', 502));

test('questionTokens keeps figures and identifiers, drops question words', () => {
  const t = questionTokens('What minimum VPS resources were recommended for Python, 2 CPU and how many GB?');
  expect(t.get('2')).toBe(3); expect(t.has('vps')).toBe(true); expect(t.has('what')).toBe(false); expect(t.has('were')).toBe(false);
  expect(questionTokens('What delay did we use in documentReady with no-implied-eval?').get('no-implied-eval')).toBe(3);
});

test('M473: the rows that answer the question are read from past the cut, with their path; every root is listed', () => {
  const r = selectRowsForQuestion(nodes, 'What did I report about Quizlet\'s help API-docs link?', { budget: 22_000 });
  expect(r.total).toBe(423);
  expect(r.text).toContain('ROOTS (20 top-level topics');
  expect(r.text).toContain('Topic 19 about project work');
  expect(r.text).toContain('quizlet.com/help/api-docs');
  expect(r.text).toMatch(/ESTATE "Topic 17 about project work"[\s\S]*Quizlet API docs URL/); // M473b: the estate is read in full, the row inside it
  const r2 = selectRowsForQuestion(nodes, 'What minimum VPS resources were recommended for Python?', { budget: 22_000 });
  expect(r2.text).toContain('2 CPU cores and 2 GB RAM');
  expect(r2.text).toMatch(/ESTATE "Topic 18 about project work"[\s\S]*Minimum VPS resources/);
  const r3 = selectRowsForQuestion(nodes, 'What limit and ordering rule did I set for the random-number file?', { budget: 22_000 });
  expect(r3.text).toContain('until 15000');
  expect(r3.text.length).toBeLessThanOrEqual(22_400);
});

test('M473: the budget holds and the closing line counts what was shown', () => {
  const r = selectRowsForQuestion(nodes, 'project work note remark', { budget: 6_000 });
  expect(r.text.length).toBeLessThanOrEqual(6_400);
  expect(r.text).toMatch(/\(\d+ of 423 rows shown/);
  expect(r.picked).toBeGreaterThan(0);
});

test('M473b (Jacob: "the delegates… what happened to them"): the question is routed to its estate, which is read in full before anything else', () => {
  const est = routeEstates(nodes, 'What did I report about Quizlet\'s help API-docs link?');
  expect(est[0].rootId).toBe('r17');
  const r = selectRowsForQuestion(nodes, 'What minimum VPS resources were recommended for Python?', { budget: 22_000, minds: [{ nodeId: 'r18', understanding: 'The VPS runner estate: hosting for the Python scripts, sizing and cost.' }] });
  expect(r.estates[0]).toBe('Topic 18 about project work');
  const i = r.text.indexOf('ESTATE "Topic 18 about project work"'); const j = r.text.indexOf('MATCHING ROWS ELSEWHERE');
  expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i);
  expect(r.text.slice(i, j)).toContain('2 CPU cores and 2 GB RAM');   // inside the estate, read in full
  expect(r.text.slice(i, j)).toContain('Note 18-0');                   // the whole estate, not only the matching row
});

test('M473c (Jacob: "not consistent with our attention rules"): the brain reads a big map through the tiered renderer, the question\'s node as focus, who said what on every line', async () => {
  const { Store } = await import('../store/db');
  const { renderTieredTree } = await import('../map/render');
  const { questionFocus } = await import('./mapstatus');
  const st = new Store(':memory:'); const pid = st.createProject('t');
  const mk = (id: string, parentId: string | null, content: string, author: 'user' | 'agent' = 'user') => st.createNode({ id, projectId: pid, parentId, content, type: null, status: 'live', author, title: null } as any);
  for (let r = 0; r < 6; r++) { mk(`r${r}`, null, `Topic ${r} about project work`); for (let c = 0; c < 8; c++) mk(`r${r}c${c}`, `r${r}`, `A routine remark ${r}-${c} about the project.`, c % 2 ? 'agent' : 'user'); }
  mk('vps', 'r4c2', 'The agent recommended at least 2 CPU cores and 2 GB RAM for the Python VPS runner.', 'agent');
  const nodes = st.getNodes(pid);
  const focus = questionFocus(nodes, 'What minimum VPS resources were recommended for Python?', 'r4');
  expect(focus).toBe('vps');
  const tiered = renderTieredTree(st, pid, focus, 15_000, null, { who: true });
  expect(tiered).toContain('▶ [agent] The agent recommended at least 2 CPU cores');   // the focus mark on the question's node, with who said it
  expect(tiered).toContain('[you] Topic 0 about project work');                         // every root, tagged
  expect(renderTieredTree(st, pid, focus, 15_000)).not.toContain('[you]');              // the agent-side callers keep the plain form
  expect(questionFocus(nodes, 'something nobody said', 'r1')).toBe('r1');                // no match → the estate root
});

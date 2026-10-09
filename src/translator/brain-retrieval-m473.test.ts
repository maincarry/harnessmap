// M473 (RECORD TEST #3 — the long record): when the roster does not fit the brain's budget, the rows relevant to the question are read from
// the WHOLE map (with every root for shape), not a flat cut that hid 193 of 376 rows and made the brain say "the map does not record…".
import { test, expect } from 'bun:test';
import { selectRowsForQuestion, questionTokens } from './mapstatus';

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
  expect(r.text).toMatch(/Topic 17 about project work › .*Quizlet API docs URL/);
  const r2 = selectRowsForQuestion(nodes, 'What minimum VPS resources were recommended for Python?', { budget: 22_000 });
  expect(r2.text).toContain('2 CPU cores and 2 GB RAM');
  expect(r2.text).toMatch(/Topic 18 about project work › Note 18-3 › .*Minimum VPS resources/);
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

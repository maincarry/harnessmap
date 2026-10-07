import { test, expect } from 'bun:test';
import { brainRulesLines } from './mapstatus';
import { nodeLine } from '../map/render';

// M429: the brain's roster says who said each node; the rules lines separate the user's own decisions from the agent's proposals.
const at = '2026-10-07T00:00:00Z';
const mk = (o: any) => ({ id: 'n1', parentId: null, title: null, type: null, createdAt: at, updatedAt: at, ...o });

test('nodeLine tags the speaker only when asked', () => {
  const n = mk({ content: 'Use ground-truth homographies only as references', status: 'proposed', author: 'agent' });
  expect(nodeLine(n as any)).toBe('○ Use ground-truth homographies only as references (proposed)');
  expect(nodeLine(n as any, { who: true })).toBe('○ [agent] Use ground-truth homographies only as references (proposed)');
  expect(nodeLine(mk({ content: 'Keep the invoice run on Fridays', status: 'decided', author: 'user', type: 'decision' }) as any, { who: true })).toBe('✓ [you] decision: Keep the invoice run on Fridays (decided)');
});

test('the rules lines keep the agent\'s accepted proposals out of "what the user decided"', () => {
  const lines = brainRulesLines([
    mk({ content: 'Keep the invoice run on Fridays', status: 'decided', author: 'user', type: 'decision' }),
    mk({ content: 'Implement homography estimation with NumPy/SVD and self-implemented RANSAC', status: 'chosen', author: 'agent', type: 'decision' }),
    mk({ content: 'I usually have some coffee and toast for my breakfast', status: 'chosen', author: 'agent' }),
  ]);
  const [mine, theirs] = lines.split('\n');
  expect(mine).toContain('WHAT THE USER THEMSELVES SAID'); expect(mine).toContain('Keep the invoice run on Fridays'); expect(mine).not.toContain('NumPy/SVD');
  expect(theirs).toContain('WHAT THE AGENT PROPOSED'); expect(theirs).toContain('NumPy/SVD'); expect(theirs).toContain('coffee and toast'); expect(theirs).toContain('never "you decided"');
});

test('no user-authored rule → the user line says so instead of borrowing the agent\'s', () => {
  const lines = brainRulesLines([mk({ content: 'Prefer axios-retry', status: 'accepted', author: 'agent' })]);
  expect(lines.split('\n')[0]).toContain('nothing filed as the user');
});

test('M433 (PANEL #419): an option the user typed as a candidate but the agent picked is not "what the user decided"', () => {
  const lines = brainRulesLines([
    mk({ content: 'Keep the invoice run on Fridays', status: 'decided', author: 'user', type: 'decision' }),
    mk({ content: 'I usually have some coffee and toast for my breakfast', status: 'chosen', author: 'user', type: 'option' }),
  ]);
  const [mine, theirs] = lines.split('\n');
  expect(mine).toContain('Keep the invoice run on Fridays'); expect(mine).not.toContain('coffee and toast');
  expect(theirs).toContain('coffee and toast'); expect(theirs).toContain("the agent's pick among candidates");
});

test('M433b: an option is tagged [candidate] in the roster whoever typed it', () => {
  expect(nodeLine(mk({ content: 'I usually have some coffee and toast for my breakfast', status: 'chosen', author: 'user', type: 'option' }) as any, { who: true })).toBe('✓ [candidate] option: I usually have some coffee and toast for my breakfast (chosen)');
  expect(nodeLine(mk({ content: 'Present continuous', status: 'chosen', author: 'agent', type: 'option' }) as any, { who: true })).toBe('✓ [candidate] option: Present continuous (chosen)');
});

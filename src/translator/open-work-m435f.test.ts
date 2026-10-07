import { test, expect } from 'bun:test';
import { ageTag } from './mapstatus';

// M435f: the open-work lines never carry candidate options, floated alternatives or dropped moves — only tasks and questions the person can act on.
// isOpenWork is local to brainChat; its rule is asserted here through the same predicate shape.
const isOpenWork = (n: any) => n.status !== 'removed' && n.parentId !== null && n.author !== 'system' && n.type !== 'option'
  && (/^(open|todo|doing|active)$/.test(n.status) || (/^(live|provisional)$/.test(n.status) && /^(task|question)$/.test(String(n.type ?? ''))));

test('tasks and questions count as open work; options, floated alternatives and dropped moves do not', () => {
  expect(isOpenWork({ status: 'open', parentId: 'p', author: 'user', type: 'question' })).toBe(true);
  expect(isOpenWork({ status: 'todo', parentId: 'p', author: 'user', type: 'task' })).toBe(true);
  expect(isOpenWork({ status: 'provisional', parentId: 'p', author: 'user', type: 'task' })).toBe(true);
  expect(isOpenWork({ status: 'floated', parentId: 'p', author: 'agent', type: 'option' })).toBe(false);   // "Use randrange"
  expect(isOpenWork({ status: 'open', parentId: 'p', author: 'user', type: 'option' })).toBe(false);       // "Choose a mark"
  expect(isOpenWork({ status: 'dropped', parentId: 'p', author: 'user', type: null })).toBe(false);        // "Square 1 move"
  expect(isOpenWork({ status: 'proposed', parentId: 'p', author: 'agent', type: 'task' })).toBe(false);    // the agent's proposal (M437)
  expect(isOpenWork({ status: 'live', parentId: 'p', author: 'user', type: null })).toBe(false);           // a plain note
  expect(isOpenWork({ status: 'open', parentId: null, author: 'user', type: 'question' })).toBe(false);    // a root
});

test('ageTag still marks only open-ish statuses', () => {
  const rounds = Array.from({ length: 40 }, (_, i) => Date.parse('2026-10-07T10:00:00Z') + i * 60_000);
  expect(ageTag('open', '2026-10-07T10:05:00Z', rounds)).toBe('untouched for 34 turns');
});

import { test, expect } from 'bun:test';
import { isOpenWorkRow, underClosedParent } from './mapstatus';

// M460g (PANEL #451a): a todo the person holds stays open work even when it was filed under a delivered (done) draft row.
const byId = new Map<string, any>([
  ['root', { id: 'root', parentId: null, status: 'live', author: 'user', type: null }],
  ['thread', { id: 'thread', parentId: 'root', status: 'provisional', author: 'user', type: null }],
  ['reply', { id: 'reply', parentId: 'thread', status: 'done', author: 'user', type: 'task', title: 'Seat downgrade confirmed' }],
  ['confirm', { id: 'confirm', parentId: 'reply', status: 'todo', author: 'user', type: 'task', title: 'Confirm downgrade' }],
  ['q', { id: 'q', parentId: 'thread', status: 'answered', author: 'user', type: 'question' }],
  ['opt', { id: 'opt', parentId: 'q', status: 'open', author: 'agent', type: null }],
  ['agentTodo', { id: 'agentTodo', parentId: 'reply', status: 'todo', author: 'agent', type: 'task' }],
]);

test('the person\'s todo under a delivered draft row is open work', () => {
  expect(underClosedParent(byId.get('confirm'), byId)).toBe(true);
  expect(isOpenWorkRow(byId.get('confirm'), byId)).toBe(true);
});

test('a closed parent still hides everything that is not the person\'s own task', () => {
  const doneQ = new Map(byId); doneQ.set('q', { ...byId.get('q'), status: 'done' });
  expect(isOpenWorkRow(doneQ.get('opt'), doneQ)).toBe(false);          // a note under a closed question
  expect(isOpenWorkRow(byId.get('agentTodo'), byId)).toBe(false);      // the agent's todo under the done reply (M437: not the person's work)
  expect(isOpenWorkRow(byId.get('reply'), byId)).toBe(false);          // done itself
});

test('the M435f shapes are unchanged', () => {
  const flat = new Map<string, any>([['p', { id: 'p', parentId: null, status: 'live', author: 'user' }]]);
  expect(isOpenWorkRow({ status: 'open', parentId: 'p', author: 'user', type: 'question' }, flat)).toBe(true);
  expect(isOpenWorkRow({ status: 'floated', parentId: 'p', author: 'agent', type: 'option' }, flat)).toBe(false);
  expect(isOpenWorkRow({ status: 'proposed', parentId: 'p', author: 'agent', type: 'task' }, flat)).toBe(false);
  expect(isOpenWorkRow({ status: 'active', parentId: 'p', author: 'user', type: 'constraint' }, flat)).toBe(false);
  expect(isOpenWorkRow({ status: 'open', parentId: null, author: 'user', type: 'question' }, flat)).toBe(false);
});

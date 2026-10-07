import { test, expect } from 'bun:test';
import { Translator, DELIVERS } from './translator';

// M439 (Jacob: "This is literally a bug"): a task the agent delivers in the same turn is done at filing.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  return (alts: any[], assistantText: string) => ({ out: (t as any).guardTaskDelivered(alts, { assistantText }) as any[], audits });
}
const task = { op: 'create_node', id: 't1', parentId: 'p', content: 'Rewrite the step updater so the caller can choose +1 or -1.', status: 'todo', author: 'user', type: 'task', title: 'Choose step direction' };

test('a user task filed todo closes when the reply carries the code', () => {
  const r = harness()([{ ...task }, { op: 'create_node', id: 'q1', parentId: 'p', content: 'Which rule applies?', status: 'open', author: 'user', type: 'question' }],
    'Here is the updated function:\n```ts\nconst step = (dir: 1 | -1) => setStep((s) => s + dir);\n```\nIt accepts the direction as a parameter.');
  expect(r.out[0].status).toBe('done'); expect(r.out[1].status).toBe('open');
  expect(r.audits.map((a) => a.kind)).toEqual(['guard_task_delivered']);
});
test('a reply that only proposes or explains leaves the task open; an agent task is not touched', () => {
  const h = harness();
  expect(h([{ ...task }], 'You could use a functional update and pass the direction in. Want me to write it?').out[0].status).toBe('todo');
  expect(h([{ ...task, author: 'agent', status: 'proposed' }], 'Here is the updated function:\n```js\nx\n```').out[0].status).toBe('proposed');
  expect(DELIVERS.test("I've updated the handler to key idempotency on the event id and added the test.")).toBe(true);
  expect(DELIVERS.test('Sure — tell me more about the error you see.')).toBe(false);
});

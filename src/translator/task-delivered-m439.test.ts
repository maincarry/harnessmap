import { test, expect } from 'bun:test';
import { Translator, DELIVERS, FUTURE_DATED } from './translator';

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
test('M439b: a drafted reply is delivered by the reply itself', () => {
  const h = harness();
  const draft = { op: 'create_node', id: 'd', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Draft export reply', content: 'Draft a brief customer reply stating that exports for projects with more than 500 items were affected by a timeout, the issue has been fixed, and the fix will ship this week.' };
  const t = new Translator(new Proxy({}, { get(_t, k) { if (k === 'audit') return () => {}; if (k === 'getSetting') return () => undefined; return () => undefined; } }) as any) as any;
  const out = t.guardTaskDelivered([{ ...draft }], { userText: 'Draft a brief reply to the customer with the export failure. Say we found the timeout affecting projects over 500 items, have fixed it, and will ship the fix this week. Do not promise a specific day.', assistantText: 'Hi — we found the issue: exports for projects with more than 500 items were hitting a timeout. We’ve fixed the export process and will ship the update this week. I’ll let you know once it’s live.\n\nBest,\nNoor' });
  expect(out[0].status).toBe('done');
  const out2 = t.guardTaskDelivered([{ ...draft }], { userText: 'Draft a brief reply to the customer.', assistantText: 'Which customer do you mean, and what tone would you like?' });
  expect(out2[0].status).toBe('todo');
});

// M439c (TWIN #443 proof pass 4, round 8): the reply drafted the confirmation, but confirming with Maya by Friday is still ahead.
test('M439c: a future-dated task in a delivering round stays open; the drafting row itself still closes', () => {
  const audits: string[] = [];
  const t = new Translator(new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string) => audits.push(kind); if (k === 'getSetting') return () => undefined; return () => undefined; } }) as any) as any;
  const userText = 'Back to Harbor & Finch. Maya replied: “Thanks, that works. Can we also remove the two unused seats going forward?” Draft a brief reply confirming I’ll reduce them from 12 to 10 seats starting next billing cycle and confirm the change by Friday.';
  const assistantText = 'Subject: Re: Unused seats\n\nHi Maya — absolutely. I’ll reduce Harbor & Finch from 12 to 10 seats starting with your next billing cycle and confirm the change with you by Friday.\n\nBest,\nNoor';
  const confirm = { op: 'create_node', id: 'c', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Confirm change', content: 'Confirm the Harbor & Finch seat change with Maya by Friday.' };
  const reduce = { op: 'create_node', id: 'r', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Seat reduction', content: 'Reduce the account from 12 to 10 seats starting next billing cycle.' };
  const draft = { op: 'create_node', id: 'd', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Draft reply to Maya', content: 'Draft a brief reply confirming the reduction to 10 seats next billing cycle and confirmation by Friday.' };
  const out = t.guardTaskDelivered([{ ...confirm }, { ...reduce }, { ...draft }], { userText, assistantText });
  expect(out.map((a: any) => a.status)).toEqual(['todo', 'todo', 'done']);
  expect(audits).toEqual(['guard_task_delivered_kept', 'guard_task_delivered_kept', 'guard_task_delivered']);
  // the DELIVERS path too: shipped code does not perform a dated follow-up
  const ship = { op: 'create_node', id: 's', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Notify the customer', content: 'Tell the customer once it is live.' };
  const out2 = t.guardTaskDelivered([{ ...ship }, { op: 'create_node', id: 'x', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Fix the timeout', content: 'Raise the export timeout for projects over 500 items.' }], { userText: 'Fix the export timeout.', assistantText: 'Here is the updated function:\n```ts\nexport const TIMEOUT = 120_000;\n```' });
  expect(out2.map((a: any) => a.status)).toEqual(['todo', 'done']);
  expect(FUTURE_DATED.test('Confirm the seat change with Maya by Friday.')).toBe(true);
  expect(FUTURE_DATED.test('Rewrite the step updater so the caller can choose +1 or -1.')).toBe(false);
  expect(FUTURE_DATED.test('Reply on the thread about the Friday standup notes.')).toBe(false);
});

// M439d (TWIN #443 proof pass 5, round 9): the filer filed "Ship the export fix this week" as done while the turn says "will ship the fix this week".
test('M439d: a future-dated task the filer files done, still promised in the turn, is todo — and counts as the promise row', () => {
  const audits: string[] = [];
  const t = new Translator(new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string) => audits.push(kind); if (k === 'getSetting') return () => undefined; return () => undefined; } }) as any) as any;
  const userText = 'Draft a brief reply to the customer with the export failure. Say we found the timeout affecting projects over 500 items, have fixed it, and will ship the fix this week. Do not promise a specific day.';
  const assistantText = 'Hi — we found the issue: exports for projects with more than 500 items were hitting a timeout. We’ve fixed the export process and will ship the update this week. I’ll let you know once it’s live.';
  const ship = { op: 'create_node', id: 's', parentId: 'p', author: 'user', type: 'task', status: 'done', title: 'Ship export fix', content: 'Ship the export fix this week without promising a specific day.' };
  const reply = { op: 'create_node', id: 'r', parentId: 'p', author: 'user', type: 'task', status: 'done', title: 'Customer reply', content: 'The customer reply should briefly explain the timeout, state that it is fixed, and say the fix will ship this week.' };
  const out = t.guardCommitmentIsTask([{ ...ship }, { ...reply }], { nodes: [] }, { userText, assistantText });
  expect(out.find((a: any) => a.id === 's').status).toBe('todo');
  expect(out.find((a: any) => a.id === 'r').status).toBe('done');
  expect(out.filter((a: any) => a.title === 'Promise made')).toHaveLength(0); // the dated todo carries the promise
  expect(audits).toEqual(['guard_future_task_open']);
  // without the dated task the promise row is still lifted (M451c)
  const out2 = t.guardCommitmentIsTask([{ ...reply }], { nodes: [] }, { userText, assistantText });
  expect(out2.filter((a: any) => a.title === 'Promise made')).toHaveLength(1);
  // a done task whose verb the turn does not promise stays done: "I shipped the fix this week and will send the notes tomorrow"
  const out3 = t.guardCommitmentIsTask([{ ...ship, content: 'Shipped the export fix this week.' }], { nodes: [] }, { userText: 'I shipped the fix this week and will send the notes tomorrow.', assistantText: 'Noted.' });
  expect(out3[0].status).toBe('done');
});

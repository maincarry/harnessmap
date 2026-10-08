import { test, expect } from 'bun:test';
import { Translator, FUTURE_COMMITMENT, clientNameOfTurn } from './translator';

// TWIN LONG #430 (Noor on v0.9.225): the export promise filed as a decided decision fell off the open list; the recap turn minted
// "… remain open" rows; her first turns' client names were not carried into the root titles.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
test('M451: a promise of a future action in the person\'s words is a task, todo; a choice stays a decision', () => {
  const { t, audits } = harness();
  const out = t.guardCommitmentIsTask([
    { op: 'create_node', id: 'c1', author: 'user', type: 'decision', status: 'decided', title: 'Export fix commitment', content: 'The large-project export fix will ship this week, with no specific day promised to the customer, and the customer will be notified when it is live.' },
    { op: 'create_node', id: 'c2', author: 'user', type: 'decision', status: 'decided', title: 'One-time credit', content: 'Harbor & Finch will receive a one-time discretionary account credit for the two unused seats, rather than a cash refund.' },
    { op: 'create_node', id: 'c3', author: 'agent', type: 'claim', status: 'noted', content: 'We will ship it this week and let you know once it is live.' },
  ], { nodes: [] });
  expect(out[0].type).toBe('task'); expect(out[0].status).toBe('todo');
  expect(out[1].type).toBe('decision'); expect(out[1].status).toBe('decided');
  expect(out[2].type).toBe('claim');
  expect(audits.map((a) => a.kind)).toEqual(['guard_commitment_task']);
  expect(FUTURE_COMMITMENT.test('I’ll confirm once the change is completed by Friday.')).toBe(true);
  expect(FUTURE_COMMITMENT.test('The Team plan price will be $59 per seat per month on November 1.')).toBe(false);
});
test('M443c: a recap-round row that only restates what is open is dropped', () => {
  const { t } = harness();
  const map = { nodes: [{ id: 't1', parentId: 'h', title: 'Downgrade seats', content: 'Reduce Harbor & Finch from 12 to 10 seats starting with the next billing cycle and confirm the completed change by Friday.', status: 'todo', author: 'user', type: 'task' }] };
  const out = t.guardRecapMirror([
    { op: 'create_node', id: 'q1', parentId: 'h', author: 'agent', type: 'question', status: 'open', title: 'Harbor open work', content: 'Harbor & Finch seat downgrade and Friday confirmation remain open.' },
    { op: 'create_node', id: 'k1', parentId: 'h', author: 'agent', status: 'provisional', title: 'Northwind commitments', content: 'Northwind contract commitments.' },
    { op: 'create_node', id: 'q2', parentId: 'k1', author: 'agent', type: 'question', status: 'open', title: 'Northwind open work', content: 'The final Northwind clause and cover note still need to be sent or finalized and accepted.' },
  ], map, { userText: 'Before I finish, list every commitment I made today: who it was to, exactly what I committed to, and by when. Then list what is still open.' });
  expect(out).toEqual([]);
});
test('M438b: a client name followed by a reporting verb opens a client thread', () => {
  expect(clientNameOfTurn('Harbor & Finch emailed:\n\n“Hi Noor — we noticed we were charged for 12 seats last month.”')).toBe('Harbor & Finch');
  expect(clientNameOfTurn('Northwind Logistics wants the liability cap in their annual contract raised from 1× to 3× annual fees.')).toBe('Northwind Logistics');
  expect(clientNameOfTurn('Tighten that reply and make it a little warmer.')).toBeNull();
  expect(clientNameOfTurn('Someone forwards you new evidence on source 3.')).toBeNull();
});
test('M442d (TWIN #443): "Record these as commitments" makes the agent-filed task the person\'s; M451b: a dictated promise in a done draft becomes its own todo', () => {
  const { t, audits } = harness();
  const rec = 'I sent both Harbor & Finch replies to Maya. Record these as commitments: apply the $98 credit against the next invoice, reduce the account from 12 to 10 seats starting next billing cycle, and confirm the seat change with Maya by Friday.';
  const out = t.guardDecisionAuthor([{ op: 'create_node', id: 'c1', parentId: 'h', author: 'agent', type: 'task', status: 'todo', title: 'Confirm change Friday', content: 'Confirm with Maya by Friday that Harbor & Finch will be reduced from 12 to 10 seats starting with the next billing cycle.' }], { nodes: [] }, { userText: rec });
  expect(out[0].author).toBe('user');
  const draft = { op: 'create_node', id: 'd1', parentId: 'x', author: 'user', type: 'task', status: 'done', title: 'Customer reply draft', content: 'Customer reply: “Hi — we found the issue: exports for projects with more than 500 items were hitting a timeout. We’ve fixed the export process and will ship the update this week. I’ll let you know once it’s live.”' };
  const out2 = t.guardCommitmentIsTask([{ ...draft }], { nodes: [] }, { userText: 'Draft a brief reply to the customer with the export failure. Say we found the timeout affecting projects over 500 items, have fixed it, and will ship the fix this week. Do not promise a specific day.' });
  expect(out2.length).toBe(2); expect(out2[1].type).toBe('task'); expect(out2[1].status).toBe('todo'); expect(out2[1].author).toBe('user'); expect(out2[1].content).toMatch(/ship the update this week/);
  expect(audits.some((a) => a.kind === 'guard_commitment_promise')).toBe(true);
  expect(t.guardCommitmentIsTask([{ ...draft }], { nodes: [] }, { userText: 'Tighten that reply and make it a little warmer.' }).length).toBe(1);
});

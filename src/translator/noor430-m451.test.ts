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

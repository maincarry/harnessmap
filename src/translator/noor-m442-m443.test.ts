import { test, expect } from 'bun:test';
import { Translator, FIRST_PERSON, RECAP } from './translator';

// M442 / M442a / M443 (TWIN LONG #426, Noor the founder-operator): the rows and the end-of-day answer that made her stop.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store) as any;
  return { t, audits };
}
const node = (id: string, content: string, extra: any = {}) => ({ id, parentId: 'root', title: '', content, status: 'live', author: 'user', type: null, ...extra });

test('M442: a decision the person states in their own words becomes theirs, on an update of an agent-authored node', () => {
  const { t, audits } = harness();
  const map = { nodes: [node('q1', 'Decide whether unused seats qualify for a refund under the refund policy.', { author: 'agent', type: 'question', status: 'open' })] };
  const user = "Let's make a one-time exception as an account credit for the two unused seats, not a cash refund. Draft a short reply that states the normal policy without sounding defensive.";
  const alts = [{ op: 'update_node', id: 'q1', content: 'Standard policy does not provide refunds for unused seats during an active billing period, but Harbor & Finch will receive a one-time account credit for the two unused seats as a discretionary exception; no cash refund will be issued.', status: 'decided', type: 'decision' }];
  const out = t.guardDecisionAuthor(alts, map, { userText: user });
  expect(out[0].author).toBe('user');
  expect(audits.map((a) => a.kind)).toEqual(['guard_decision_author']);
});
test('M442: a dictated customer reply is the person\'s commitment; a bare draft request is not first-person', () => {
  const { t } = harness();
  const reply = { op: 'create_node', id: 'r1', parentId: 'p', author: 'agent', type: 'task', status: 'done', title: 'Customer export reply', content: 'Customer reply: We found a timeout bug affecting exports for larger projects, a fix will ship this week, and I’ll let the customer know when it is live.' };
  const out = t.guardDecisionAuthor([{ ...reply }], { nodes: [] }, { userText: 'Draft a short reply to the customer with the large-project export issue. Say we found the timeout bug, a fix will ship this week, and I’ll let them know when it is live. Don’t promise a specific day.' });
  expect(out[0].author).toBe('user');
  const clause = { op: 'create_node', id: 'c1', parentId: 'p', author: 'agent', type: 'claim', status: 'accepted', title: 'Replacement clause', content: 'Replacement clause at 3×: each party’s aggregate liability arising out of or relating to this Agreement will not exceed three times the fees paid.' };
  const out2 = t.guardDecisionAuthor([{ ...clause }], { nodes: [] }, { userText: 'Northwind Logistics wants the liability cap in their annual contract raised from 1× to 3× annual fees. Draft a clean replacement clause at 3×, and flag the practical risk to us in one sentence.' });
  expect(out2[0].author).toBe('agent');
  expect(FIRST_PERSON.test('I’m willing to settle at 9 months.')).toBe(true);
  expect(FIRST_PERSON.test('Revise the Northwind clause to cap liability at 2× annual fees.')).toBe(false);
});
test('M442a: an agent-authored row is never born accepted/decided; user rows and agent tasks are left to their own rules', () => {
  const { t, audits } = harness();
  const out = t.guardAgentSolidStatus([
    { op: 'create_node', id: 'a', author: 'agent', type: 'claim', status: 'accepted', content: 'Except for liabilities that cannot legally be limited…' },
    { op: 'create_node', id: 'b', author: 'user', type: 'claim', status: 'accepted', content: 'Either party may elect not to renew with twelve months’ notice.' },
    { op: 'create_node', id: 'c', author: 'agent', type: 'task', status: 'todo', content: 'Deploy the fix this week.' },
  ]);
  expect(out.map((a: any) => a.status)).toEqual(['floated', 'accepted', 'todo']);
  expect(audits.map((a) => a.kind)).toEqual(['guard_agent_solid']);
});
test('M443: a recap turn creates nothing the map already holds; a genuinely new item survives; other turns untouched', () => {
  const { t, audits } = harness();
  const map = { nodes: [
    node('d1', 'Harbor & Finch will receive a one-time account credit for the two unused seats as a discretionary exception; no cash refund will be issued.', { status: 'decided', type: 'decision', title: 'Credit exception instead of refund' }),
    node('t1', 'Downgrade Harbor & Finch from 12 seats to 10 seats starting with the next billing cycle.', { status: 'todo', type: 'task', title: 'Downgrade seats' }),
    node('t2', 'Confirm the Harbor & Finch seat change by Friday.', { status: 'todo', type: 'task', title: 'Confirm by Friday' }),
  ] };
  const user = 'List every commitment I made today, grouped by who it is for, with exactly what I promised and any deadline. Then list what is still open.';
  const alts = [
    { op: 'create_node', id: 'k1', parentId: 'h', author: 'agent', content: 'Harbor & Finch commitments: apply a one-time account credit for two unused seats; reduce the account from 12 to 10 seats starting next billing cycle; confirm the downgrade by Friday.', status: 'provisional', title: 'Harbor commitments' },
    { op: 'create_node', id: 'k2', parentId: 'k1', author: 'agent', type: 'task', status: 'todo', content: 'Apply a one-time account credit for two unused seats.', title: 'Apply Harbor credit' },
    { op: 'create_node', id: 'k3', parentId: 'k1', author: 'agent', type: 'task', status: 'todo', content: 'Reduce the Harbor & Finch account from 12 to 10 seats starting next billing cycle.', title: 'Harbor seat downgrade' },
    { op: 'create_node', id: 'n1', parentId: 'h', author: 'user', type: 'task', status: 'todo', content: 'Call the bank about the wire transfer before Thursday.', title: 'Bank wire call' },
    { op: 'create_link', id: 'l1', type: 'supports', fromItemId: 'k2', toId: 'd1' },
  ];
  const out = t.guardRecapMirror(alts, map, { userText: user });
  expect(out.map((a: any) => a.id)).toEqual(['n1']);
  expect(audits.filter((a) => a.kind === 'guard_recap_mirror').length).toBe(3);
  const same = t.guardRecapMirror(alts.map((a) => ({ ...a })), map, { userText: 'Harbor & Finch replied: can we remove the two unused seats going forward? Draft a short reply.' });
  expect(same.length).toBe(5);
  expect(RECAP.test('Summarize every commitment I made today by customer or audience, with the deadline')).toBe(true);
  expect(RECAP.test('Write a one-line changelog entry for the Team price change.')).toBe(false);
});

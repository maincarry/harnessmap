import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const times = [Date.parse('2026-10-08T20:22:00Z'), Date.parse('2026-10-08T20:23:00Z')];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => times; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const at = '2026-10-08T20:22:57Z';
const q = { id: 'q1', parentId: 'gb', title: 'Possible leakage', content: '`Support_tickets_90d` is by far the most important feature in the gradient-boosted model, so the unusually strong result is worth checking for leakage.', status: 'open', author: 'agent', type: 'question', createdAt: at, updatedAt: at };
const map: any = { nodes: [{ id: 'gb', parentId: null, title: 'Gradient-boosted model', content: 'Gradient-boosted model', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at }, q], links: [] };

test('M447d: the agent\'s own evidence sharing the identifier answers its open question even though the person\'s turn was a request', () => {
  const { t, audits } = mk();
  const out = t.guardAgentQuestionAnswered([{ op: 'create_node', id: 'e1', parentId: 'gb', title: 'Post-churn leakage', content: 'support_tickets_90d leaks post-outcome information because its snapshot-relative 90-day window can include tickets logged after the churn event.', status: 'noted', author: 'agent', type: 'evidence' }], map,
    { userText: 'That 0.97 AUC looks suspicious. Check exactly how support_tickets_90d is defined and whether its 90-day window can include tickets logged after a customer churned.' });
  expect(out.find((a: any) => a.id === 'q1')).toMatchObject({ op: 'update_node', status: 'answered' });
  expect(audits.map((a) => a.kind + ':' + a.d.how)).toEqual(['guard_agent_question:evidence']);
});

test('M447d: an unrelated evidence row, or a task, leaves the question open', () => {
  const { t } = mk();
  expect(t.guardAgentQuestionAnswered([{ op: 'create_node', id: 'e2', parentId: 'gb', title: 'Chart saved', content: 'The tenure chart was saved as churn_by_tenure.png at 2400×1500.', status: 'noted', author: 'agent', type: 'evidence' }], map, { userText: 'Save the final chart now please.' }).find((a: any) => a.id === 'q1')).toBeUndefined();
  expect(t.guardAgentQuestionAnswered([{ op: 'create_node', id: 't1', parentId: 'gb', title: 'Check leakage', content: 'Check how support_tickets_90d is defined.', status: 'todo', author: 'user', type: 'task' }], map, { userText: 'Check exactly how support_tickets_90d is defined.' }).find((a: any) => a.id === 'q1')).toBeUndefined();
});

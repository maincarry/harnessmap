import { test, expect } from 'bun:test';
import { Translator, ASK_REQUEST } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const times = [Date.parse('2026-10-08T21:33:00Z'), Date.parse('2026-10-08T21:34:00Z')];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => times; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const at = '2026-10-08T21:33:00Z';
const map: any = { nodes: [{ id: 'p', parentId: null, title: 'Customer churn parquet inspection', content: 'Inspect the churn parquet', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at }], links: [], projectId: 'proj' };

// Priya's record, rounds 30 and 35 (PANEL #454c materials)
const R30 = { userText: 'Give me the three things I should report tomorrow in a compact form: annual-plan churn with count, the final leakage-free model AUC we are using, and the leakage caveat. Use only the latest completed notebook outputs and don\'t rerun anything.', assistantText: 'Tomorrow’s report: annual-plan churn is 14.72% (2,668 of 18,128); the final leakage-free gradient-boosted holdout ROC AUC is 0.79; and `support_tickets_90d` was excluded because its window can include post-churn tickets, making the earlier 0.91 logistic and 0.97 boosted AUCs invalid.' };
const R35 = { userText: 'Give me a short subject line for that product-manager update, then repeat the final two sentences as plain text so I can paste them tomorrow. Keep the verified numbers unchanged.', assistantText: 'Subject: Annual-plan churn and final model result\n\nAnnual-plan churn is 14.72% (2,668 of 18,128 customers), and the final model reached a holdout ROC AUC of 0.79. We excluded support_tickets_90d because it can include activity after churn, which means the earlier 0.91 and 0.97 AUC results should not be used.' };

test('M439k: a task row that restates an answered ask is done, whoever the filer credited it to', () => {
  const { t, audits } = mk();
  const r30 = t.guardTaskDelivered([{ op: 'create_node', id: 'tr', parentId: 'p', title: 'Tomorrow report', content: 'Tomorrow\'s report should use only the latest completed notebook outputs and include three compact items.', status: 'todo', author: 'user', type: 'task' }], R30, map);
  expect(r30[0].status).toBe('done');
  const r35 = t.guardTaskDelivered([{ op: 'create_node', id: 'sl', parentId: 'p', title: 'PM update subject line', content: 'Use the subject line “Annual-plan churn and final model result” for the product-manager update.', status: 'proposed', author: 'agent', type: 'task' }], R35, map);
  expect(r35[0].status).toBe('done');
  expect(audits.filter((a) => a.kind === 'guard_task_delivered' && a.d.how === 'asked').length).toBe(2);
});

test('M439k: steps the reply proposes, a question-ending reply, and a non-ask turn are left alone', () => {
  const { t } = mk();
  const plan = { op: 'create_node', id: 's1', parentId: 'p', title: 'Retrain with tuned depth', content: 'Retrain the gradient-boosted model with max_depth tuned on the holdout split.', status: 'todo', author: 'user', type: 'task' };
  expect(t.guardTaskDelivered([{ ...plan }], { userText: 'Give me a plan for tomorrow morning.', assistantText: 'Plan for tomorrow: 1) retrain the gradient-boosted model with max_depth tuned on the holdout split; 2) regenerate feature_importance.png; 3) write the one-paragraph note for the product manager with the final numbers.' }, map)[0].status).toBe('todo');
  const tr = { op: 'create_node', id: 'tr', parentId: 'p', title: 'Tomorrow report', content: 'Tomorrow\'s report should use only the latest completed notebook outputs and include three compact items.', status: 'todo', author: 'user', type: 'task' };
  expect(t.guardTaskDelivered([{ ...tr }], { ...R30, assistantText: 'Before I list them — do you want the churn count as a percentage of all customers or of annual-plan customers only?' }, map)[0].status).toBe('todo');
  expect(ASK_REQUEST.test('Add a final markdown cell at the top of the notebook called “Tomorrow’s report”.')).toBe(false);
});

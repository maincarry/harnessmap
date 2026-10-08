import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const map = { nodes: [
  { id: 'root', parentId: null, title: 'Customer churn parquet', content: 'Inspect the customer churn parquet in pandas.', status: 'live', author: 'user', type: null },
  { id: 'bm', parentId: 'root', title: 'Baseline churn model', content: 'A baseline logistic-regression churn model was built using the currently available predictors.', status: 'provisional', author: 'user', type: null },
  { id: 'stl', parentId: 'bm', title: 'Support tickets leakage', content: 'The support_tickets_90d feature definition and model-result validity', status: 'provisional', author: 'user', type: null },
  { id: 'rn', parentId: 'root', title: 'Run reorganized notebook', content: 'Run the reorganized notebook top to bottom.', status: 'doing', author: 'user', type: 'task' },
  { id: 'dec', parentId: 'root', title: 'Drop support tickets', content: 'Drop support_tickets_90d from the model.', status: 'decided', author: 'user', type: 'decision' },
] };

test('M467: a same-titled child under a tentative parent updates the parent (content + status) and is dropped; children born under it re-point', () => {
  const { t, audits } = mk();
  const out = t.guardTitleTwinChild([
    { op: 'create_node', id: 'twin', parentId: 'bm', title: 'Baseline churn model', content: 'The leakage-free baseline churn model uses plan, tenure, monthly_usage, and monthly_price.', status: 'live', author: 'agent', type: null },
    { op: 'create_node', id: 'kid', parentId: 'twin', title: 'Plan timing', content: 'plan is measured at or before the snapshot.', status: 'noted', author: 'agent', type: 'evidence' },
  ], map);
  expect(out.find((a: any) => a.id === 'twin')).toBeUndefined();
  expect(out.find((a: any) => a.id === 'bm')).toMatchObject({ op: 'update_node', status: 'live', content: 'The leakage-free baseline churn model uses plan, tenure, monthly_usage, and monthly_price.' });
  expect(out.find((a: any) => a.id === 'kid').parentId).toBe('bm');
  expect(audits.map((a) => a.kind)).toEqual(['guard_title_twin']);
  expect(audits[0].d).toMatchObject({ from: 'provisional', to: 'live' });
});

test('M467: the evidence twin folds into its provisional parent as noted', () => {
  const { t } = mk();
  const out = t.guardTitleTwinChild([{ op: 'create_node', id: 'e', parentId: 'stl', title: 'Support tickets leakage', content: 'support_tickets_90d can include post-churn tickets, creating leakage; it must be excluded from churn models.', status: 'noted', author: 'agent', type: 'evidence' }], map);
  expect(out).toEqual([{ op: 'update_node', id: 'stl', content: 'support_tickets_90d can include post-churn tickets, creating leakage; it must be excluded from churn models.', status: 'noted' }]);
});

test('M467: a settled parent keeps its status; tasks, constraints and different titles are left alone', () => {
  const { t, audits } = mk();
  const out = t.guardTitleTwinChild([{ op: 'create_node', id: 'd2', parentId: 'dec', title: 'Drop support tickets', content: 'Dropped support_tickets_90d; the models were rerun.', status: 'noted', author: 'agent', type: 'evidence' }], map);
  expect(out).toEqual([{ op: 'update_node', id: 'dec', content: 'Dropped support_tickets_90d; the models were rerun.' }]);
  const task = { op: 'create_node', id: 'r2', parentId: 'rn', title: 'Run reorganized notebook', content: 'Ran the notebook top to bottom.', status: 'done', author: 'agent', type: 'task' };
  expect(t.guardTitleTwinChild([{ ...task }], map)).toEqual([task]);
  const other = { op: 'create_node', id: 'o', parentId: 'bm', title: 'Boosted tree model', content: 'A gradient boosting model was fit.', status: 'noted', author: 'agent', type: 'evidence' };
  expect(t.guardTitleTwinChild([{ ...other }], map)).toEqual([other]);
  expect(audits.length).toBe(1);
});

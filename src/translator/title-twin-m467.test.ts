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

test('M467b: an untitled rewrite-born child whose statement names the parent\'s title folds into the parent', () => {
  const { t, audits } = mk();
  const m: any = { nodes: [...map.nodes, { id: 'or', parentId: 'root', title: 'Output results', content: 'Section 3 will present output results from the trials, including a paragraph on wellbeing and retention.', status: 'provisional', author: 'agent', type: null }] };
  const out = t.guardTitleTwinChild([{ op: 'create_node', id: 'kid', parentId: 'or', content: 'Section 3, “Output results,” will compare what Sources 1–4 support, keep revenue, sales per employee, productivity, engagement, and unchanged output distinct, and include wellbeing as a paragraph.', status: 'provisional', author: 'user', _rewriteOf: 'or' }], m);
  expect(out).toEqual([{ op: 'update_node', id: 'or', content: 'Section 3, “Output results,” will compare what Sources 1–4 support, keep revenue, sales per employee, productivity, engagement, and unchanged output distinct, and include wellbeing as a paragraph.' }]);
  expect(audits[0].d).toMatchObject({ how: 'text' });
  // not rewrite-born, or not naming the parent: left alone (and the marker always stripped)
  const plain = { op: 'create_node', id: 'k2', parentId: 'or', content: 'The Iceland paragraph in section 3 needs the two-agency 3–5% rise.', status: 'noted', author: 'agent', type: 'evidence', _rewriteOf: 'or' };
  const out2 = t.guardTitleTwinChild([{ ...plain }], m);
  expect(out2[0]).toMatchObject({ op: 'create_node', id: 'k2' });
  expect('_rewriteOf' in out2[0]).toBe(false);
  const untitled = { op: 'create_node', id: 'k3', parentId: 'or', content: 'Section 3, “Output results,” will compare what Sources 1–4 support.', status: 'provisional', author: 'user' };
  expect(t.guardTitleTwinChild([{ ...untitled }], m)[0].id).toBe('k3');
});

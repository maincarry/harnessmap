import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const at = '2026-10-08T16:57:50Z';
const N = (id: string, title: string, content: string, status = 'noted', type: string | null = 'evidence', author = 'agent') => ({ id, parentId: 'm', title, content, status, type, author, createdAt: at, updatedAt: at });
const map: any = { nodes: [
  { id: 'm', parentId: null, title: 'Churn', content: 'Churn', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at },
  N('lr', 'Holdout ROC AUC', 'Logistic regression achieved a holdout ROC AUC of 0.91.'),
  N('gb', 'Boosted ROC AUC', 'After removing support_tickets_90d and retraining on the same split, the gradient-boosted model achieved a holdout ROC AUC of 0.79.'),
  N('rows', 'Row count', 'All 40,218 customer rows were retained.'),
  N('annual', 'Annual churn rate', 'Annual-plan churn is 14.72%.', 'noted', 'evidence'),
], links: [] };

test('M464: a row that calls 0.91 and 0.97 invalid supersedes the live evidence row still carrying 0.91; the 0.79 row and unrelated figures stay', () => {
  const { t, audits } = mk();
  const out = t.guardFigureSuperseded([{ op: 'update_node', id: 'inv', content: 'The earlier 0.91 logistic-regression and 0.97 gradient-boosted holdout ROC AUC results are invalid and superseded because support_tickets_90d included post-outcome information. Logistic regression now scores 0.76 and the boosted model 0.79.', status: 'noted', type: 'evidence' }], map);
  expect(out.filter((a: any) => a.status === 'superseded').map((a: any) => a.id)).toEqual(['lr']);
  expect(audits.map((a) => a.kind + ':' + a.d.figure)).toEqual(['guard_figure_superseded:0.91']);
});

test('M464: a round without an invalidation, or whose figures are all still valid, changes nothing', () => {
  const { t } = mk();
  expect(t.guardFigureSuperseded([{ op: 'create_node', id: 'x', content: 'The boosted model achieved a holdout ROC AUC of 0.97.', status: 'noted', type: 'evidence', author: 'agent' }], map)).toHaveLength(1);
  expect(t.guardFigureSuperseded([{ op: 'create_node', id: 'y', content: 'The old 2400×1500 figure size is wrong; use 1600×1000.', status: 'noted', type: 'evidence', author: 'agent' }], map)).toHaveLength(1);
});

test('M464b: "leakage" beside a split ratio or the annual-churn figure is not a verdict on those figures (the two false positives of the v0.9.256 refile)', () => {
  const { t } = mk();
  const m2: any = { nodes: [...map.nodes, { id: 'plans', parentId: 'm', title: 'Original plan counts', content: 'Plan counts: monthly 20,104, Monthly 1,980, annual 17,220, Annual 908, yearly 6.', status: 'noted', type: 'evidence', author: 'agent', createdAt: at, updatedAt: at }], links: [] };
  const a = t.guardFigureSuperseded([{ op: 'update_node', id: 'bl', content: 'Baseline logistic-regression model workflow uses a stratified 80/20 train-test split with random_state=42, median imputation for missing tenure, and excludes support_tickets_90d because it contains post-outcome leakage.', status: 'decided', type: 'decision' }], m2);
  expect(a.filter((x: any) => x.status === 'superseded')).toEqual([]);
  const b = t.guardFigureSuperseded([{ op: 'update_node', id: 'cell', content: 'The notebook now has a final markdown cell called “Tomorrow’s report” stating annual-plan churn of 14.72% (2,668 of 18,128), leakage-free gradient-boosted holdout ROC AUC of 0.79, and that support_tickets_90d is excluded because it can include post-churn leakage.', status: 'done', type: 'task' }], m2);
  expect(b.filter((x: any) => x.status === 'superseded')).toEqual([]);
});

test('M464c: a row that records the drop ("from 0.91 to the valid 0.76") carries a figure that is not invalidated — it stays', () => {
  const { t } = mk();
  const m3: any = { nodes: [...map.nodes, { id: 'drop', parentId: 'm', title: 'Logistic AUC drop', content: 'The logistic-regression holdout ROC AUC dropped from 0.91 to the valid leakage-free AUC of 0.76, a decrease of 0.15.', status: 'noted', type: 'evidence', author: 'agent', createdAt: at, updatedAt: at }], links: [] };
  const out = t.guardFigureSuperseded([{ op: 'create_node', id: 'pm', content: 'Annual-plan churn is 14.72%, and the final leakage-free model achieved 0.79; the earlier 0.91 and 0.97 results are invalid and superseded.', status: 'done', type: 'task' }], m3);
  expect(out.filter((a: any) => a.status === 'superseded').map((a: any) => a.id)).toEqual(['lr']);
});

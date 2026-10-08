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

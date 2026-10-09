import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M463 (PANEL #451a): "Don't change the draft yet" is a hold; the person's later "Update the … reply" ends it.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[], userText: string) => ({ out: (t as any).guardTemporaryConstraint(alts, map, { userText }) as any[], audits });
}
const at = '2026-10-08T14:49:19Z';
const nodes = [
  { id: 'root', parentId: null, title: 'Harbor & Finch refund', content: 'Harbor & Finch refund', status: 'provisional', author: 'user', type: null, createdAt: at, updatedAt: at },
  { id: 'hold', parentId: 'root', title: 'Draft unchanged', content: 'Do not change the draft refund reply yet; the exact credit amount has been calculated separately.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
  { id: 'rule', parentId: 'root', title: 'Email tone', content: 'Keep the announcement direct and calm; no apology, no marketing language.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
  { id: 'agentHold', parentId: 'root', title: 'Agent note', content: 'Do not change the config yet until the test passes.', status: 'noted', author: 'agent', type: 'evidence', createdAt: at, updatedAt: at },
];

test('M463: "Update the Harbor & Finch reply …" supersedes the "do not change the draft reply yet" hold and nothing else', () => {
  const r = harness(nodes)([], 'Update the Harbor & Finch reply to say the exact credit is $98 and that it will appear on their next invoice. Keep it brief.');
  expect(r.out).toEqual([{ op: 'update_node', id: 'hold', status: 'superseded' }]);
  expect(r.audits.map((a) => a.kind)).toEqual(['guard_temporary_constraint']);
});

test('M463: a change request about something else leaves the hold; a standing rule is never touched; the agent\'s note is not the person\'s hold', () => {
  expect(harness(nodes)([], 'Update the changelog entry to name November 1.').out).toEqual([]);
  expect(harness(nodes)([], 'Change the config to use the new test runner.').out).toEqual([]);
});

test('M463: a turn without a change verb does nothing', () => {
  expect(harness(nodes)([], 'What does the draft reply say now?').out).toEqual([]);
});

test('M463b: the hedge before the hold ("for now: … leave plan labels unchanged") ends when she asks to normalise the labels', () => {
  const r = harness([
    { id: 'root', parentId: null, title: 'Customer churn parquet', content: 'Customer churn parquet', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at },
    { id: 'scope', parentId: 'root', title: 'Current cleaning scope', content: 'Clean only the 46 negative tenure values for now: set them to missing, retain all customer rows, and leave plan labels unchanged.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
  ])([], 'Put the cleaning into a reusable function that sets negative tenure to missing and normalises plan to monthly or annual. Add a quick test that checks the plan labels and the tenure counts.');
  expect(r.out).toEqual([{ op: 'update_node', id: 'scope', status: 'superseded' }]);
});

// M463c (REFILE #6 Priya): "No changes or cleaning … yet" and "Do not handle … yet" are holds; her cleaning function and plan inspection end them.
test('M463c: a "no changes … yet" or "do not handle … yet" hold ends when the person asks for that work', () => {
  const n2 = [
    { id: 'root', parentId: null, title: 'Customer churn parquet inspection', content: 'Inspect the churn parquet', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at },
    { id: 'h1', parentId: 'root', title: 'No changes yet', content: 'No changes or cleaning should be made to the customer churn parquet yet.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
    { id: 'h2', parentId: 'root', title: 'Defer plan labels', content: 'Do not handle the inconsistent `plan` labels yet.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
    { id: 'rule', parentId: 'root', title: 'Keep all rows', content: 'Set negative tenure to missing rather than dropping those customers.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at },
  ];
  const r6 = harness(n2)([], 'Put the cleaning into a reusable function that sets negative tenure to missing and normalises plan to monthly or annual. Add a quick test that checks both.');
  expect(r6.out.map((a) => a.id).sort()).toEqual(['h1', 'h2']);
  expect(r6.out.every((a) => a.status === 'superseded')).toBe(true);
  const r5 = harness(n2)([], 'Now inspect the five plan labels and their counts. I expect monthly and Monthly to be one plan, and annual, Annual, and yearly to be one plan. Confirm the counts before we normalise anything.');
  expect(r5.out.map((a) => a.id)).toEqual(['h2']);
  const r3 = harness(n2)([], 'How many rows have negative tenure, what negative values occur, and do those rows look unusual in plan, usage, price, or churn?');
  expect(r3.out).toEqual([]);
});

// M463d (REFILE #3 Priya single): "do not save … yet / until reviewed" is a hold; her "save the final version as …" and "Replace the exact-month line …" end them.
test('M463d: a "do not save … yet" hold ends when she asks to save or replaces the chart', () => {
  const h1 = { id: 'h1', parentId: 'root', title: 'Defer saving', content: 'Do not save the bucketed chart yet; first assess whether this version is clearer.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at };
  const h2 = { id: 'h2', parentId: 'root', title: 'Review before saving', content: 'Do not save the exact-tenure churn chart until its readability has been reviewed.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at };
  const root = { id: 'root', parentId: null, title: 'Customer churn parquet', content: 'Inspect the churn parquet', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
  const R12 = 'Replace the exact-month line with bucketed bars using the tenure buckets we already defined. Show churn rate as percentages, add the customer count on each bar, keep missing tenure reported separately, and don\'t save it yet—I want to see if this version is clearer.';
  const R21 = 'Now make the bucketed churn-by-tenure chart deck-ready. Keep the same six buckets and the 46 missing-tenure rows called out separately, use a colour-blind-safe palette, add direct percentage labels and customer counts, remove unnecessary chart clutter, and save the final version as churn_by_tenure.png at high resolution.';
  expect(harness([root, h2])([], R12).out).toEqual([{ op: 'update_node', id: 'h2', status: 'superseded' }]);
  expect(harness([root, h1])([], R21).out).toEqual([{ op: 'update_node', id: 'h1', status: 'superseded' }]);
  expect(harness([root, h1])([], 'Now inspect feature importance for the leakage-free gradient-boosted model only. Show the ranked values first.').out).toEqual([]);
});

// M463e (REFILE #4 Priya single): a hold scoped to a phase — "should not be changed during this inspection" — ends when she asks for the change.
test('M463e: a phase-scoped hold ends when the person asks for the change', () => {
  const root = { id: 'root', parentId: null, title: 'Customer churn parquet inspection', content: 'Inspect the churn parquet', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
  const h = { id: 'h', parentId: 'root', title: 'No data changes', content: 'The parquet data should not be changed during this inspection.', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at };
  expect(harness([root, h])([], 'Treat the 46 negative tenure values as data errors: set them to missing rather than dropping those customers. Keep a count of how many were changed so we can report it.').out).toEqual([{ op: 'update_node', id: 'h', status: 'superseded' }]);
  expect(harness([root, h])([], 'How many rows have negative tenure, what negative values occur, and do those rows look unusual in plan, usage, price, or churn?').out).toEqual([]);
});

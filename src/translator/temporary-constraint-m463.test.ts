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

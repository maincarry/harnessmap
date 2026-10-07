import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M437 (PANEL #422): the agent's listed steps are proposals, not the person's to-do list.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  return (alts: any[]) => ({ out: (t as any).guardAgentTaskStatus(alts) as any[], audits });
}

test('an agent-authored task created as todo/doing is filed as proposed; the person\'s own task keeps todo', () => {
  const r = harness()([
    { op: 'create_node', id: 'a1', parentId: 'p', content: 'Create an AWS account before using the free VPS setup.', status: 'todo', author: 'agent', type: 'task', title: 'Create AWS account' },
    { op: 'create_node', id: 'a2', parentId: 'p', content: 'Launch an EC2 instance.', status: 'doing', author: 'agent', type: 'task' },
    { op: 'create_node', id: 'u1', parentId: 'p', content: 'Add the changelog entry before Friday.', status: 'todo', author: 'user', type: 'task' },
    { op: 'create_node', id: 'a3', parentId: 'p', content: 'randrange has an exclusive upper bound.', status: 'noted', author: 'agent', type: 'evidence' },
  ]);
  expect(r.out.map((a) => a.status)).toEqual(['proposed', 'proposed', 'todo', 'noted']);
  expect(r.audits.filter((a) => a.kind === 'guard_agent_task_status').length).toBe(2);
});

test('an update that sets todo on an existing agent task is left alone (the person or a later round decided it)', () => {
  const r = harness()([{ op: 'update_node', id: 'a1', status: 'todo' }]);
  expect(r.out[0].status).toBe('todo');
});

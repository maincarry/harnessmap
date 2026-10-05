// M392 (go-html-png-zh #268): the store drops titles over 64 chars (M48) — that drop must leave an audit row,
// on create and on update, so a filer self-narration title that vanishes is visible to the guard audits.
import { test, expect } from 'bun:test';
import { Store } from './db';

const long = 'Go 执行 Shell 命令只需先完成 API 命名，不要硬造新的 library；我们把“中文中比较好的执行 shell 命令的库”继续落成可行动条目，避免把该建议误当作已证实的最佳实践';

test('createNode with an overlong title stores null and audits title_overlong', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  st.createNode({ id: 'n1', projectId: pid, parentId: null, content: 'Go 中执行耗时较长的 Shell 命令及其库选择', type: null, status: 'live', author: 'agent', title: long } as any);
  expect(st.getNode('n1')?.title ?? null).toBeNull();
  const a = st.getAudit(10, 'title_overlong');
  expect(a.length).toBe(1);
  expect(a[0].detail.op).toBe('create');
  expect(a[0].detail.len).toBe(long.length);
});

test('updateNode with an overlong title keeps the old title and audits title_overlong', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  st.createNode({ id: 'n2', projectId: pid, parentId: null, content: 'x', type: null, status: 'live', author: 'agent', title: '短标题' } as any);
  st.updateNode('n2', { title: long });
  expect(st.getNode('n2')?.title).toBe('短标题');
  expect(st.getAudit(10, 'title_overlong').filter((r) => r.detail.op === 'update').length).toBe(1);
});

test('a 64-char title is stored and leaves no audit row', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  st.createNode({ id: 'n3', projectId: pid, parentId: null, content: 'x', type: null, status: 'live', author: 'agent', title: 'a'.repeat(64) } as any);
  expect(st.getNode('n3')?.title?.length).toBe(64);
  expect(st.getAudit(10, 'title_overlong').length).toBe(0);
});

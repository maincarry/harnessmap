// M394: a filer op name or "::" seam glued to a title is stripped at filing time (data-platform-zh #301: "字段展开超限处理者::create_node").
import { test, expect } from 'bun:test';
import { Translator } from './translator';

function run(title: string) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: '数据平台', title: '数据平台', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt: any = { op: 'create_node', id: 'x1', parentId: 'p1', content: '字段扩展匹配字段过多时，缩小字段范围或拆分查询。', status: 'answered', author: 'agent', type: 'question', title };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
  const got = out.find((a: any) => a.op === 'create_node' && a.id === 'x1');
  return { title: got?.title, hits: audits.filter((a) => a.kind === 'guard_title_schema_token').length };
}

test('Chinese title with a glued ::create_node loses the seam and the op name', () => {
  const r = run('字段展开超限处理者::create_node');
  expect(r.hits).toBe(1);
  expect(r.title).toBe('字段展开超限处理者');
});

test('English title with an op name in the middle is cleaned', () => {
  const r = run('Encode address update_node fix');
  expect(r.hits).toBe(1);
  expect(r.title).toBe('Encode address fix');
});

test('a title that is only the op name is dropped for the healer', () => {
  const r = run('::create_node');
  expect(r.hits).toBe(1);
  expect(r.title).toBe('');
});

test('an ordinary title with the word node is untouched', () => {
  const r = run('Node creation flow');
  expect(r.hits).toBe(0);
  expect(r.title).toBe('Node creation flow');
});

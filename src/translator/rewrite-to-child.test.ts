// M410 — the rewrite_to_child guard (M315) must see a CJK rewrite that keeps only function bigrams as a rewrite, not a correction.
import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

function run(oldContent: string, newAlt: Record<string, unknown>) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); return () => undefined; } });
  const t = new Translator(store);
  const root = { id: 'p1', parentId: null, content: 'Go 网页转图片', title: 'Go 网页转图片', status: 'live', author: 'user', type: null, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
  const node = { id: 'n1', parentId: 'p1', content: oldContent, title: 'Shell 执行库', status: 'answered', author: 'user', type: 'question', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
  const map: any = { nodes: [root, node], links: [], projectId: 'proj' };
  const out = (t as any).guardScope([{ op: 'update_node', id: 'n1', ...newAlt }], new Set(['p1', 'n1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
  return { out, audits: audits.filter((a) => a.kind === 'guard_rewrite_to_child') };
}

test('M410: a rewrite into an unrelated question (shared only 的库/当前/可靠) becomes a child, the answered node stays', () => {
  const r = run('Golang 有没有适合执行长时间 Shell 命令、并能可靠处理错误的库？当前回答推荐标准库 os/exec。',
    { content: 'Go 是否有无需无头浏览器、可直接将本地 HTML 文件转换为 PNG 图片的库？当前问题仍待确认可靠方案。', title: 'HTML 转 PNG 库需确认', status: 'open', type: 'question' });
  expect(r.audits.length).toBe(1);
  const created = r.out.find((a: any) => a.op === 'create_node');
  expect(created?.parentId).toBe('n1');
  expect(r.out.some((a: any) => a.op === 'update_node' && a.id === 'n1' && typeof a.content === 'string')).toBe(false);
});

test('M410: a real correction that keeps the content words still updates in place', () => {
  const r = run('Golang 有没有适合执行长时间 Shell 命令、并能可靠处理错误的库？当前回答推荐标准库 os/exec。',
    { content: 'Golang 执行长时间 Shell 命令并可靠处理错误：标准库 os/exec 即可，配合 context 设置超时。', status: 'answered' });
  expect(r.audits.length).toBe(0);
  expect(r.out.some((a: any) => a.op === 'update_node' && a.id === 'n1')).toBe(true);
});

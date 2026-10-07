import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M424: a pictograph the filer invented on a title goes (with a short token glued to it); one the person typed stays. Real guard chain, stub store.
function run(title: string, content: string, userText = '') {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Choose step direction', title: 'Choose step direction', status: 'live', author: 'user', type: null, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'todo', author: 'user' };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText, assistantText: '' });
  return { title: out.find((a: any) => a.op === 'create_node')?.title as string, n: audits.filter((a) => a.kind === 'guard_title_pictograph').length };
}

test('LONG #407: "… no-implied-eval ✨src" loses the invented marker', () => {
  const r = run('Apply lint guidance: no-implied-eval ✨src', 'Improve the code by following the provided TypeScript ESLint `no-implied-eval` documentation and its security guidance.', 'using those guidelines please improve this code');
  expect(r.title).toBe('Apply lint guidance: no-implied-eval'); expect(r.n).toBe(1);
  expect(run('No implied eval guidance ✨src', 'The `no-implied-eval` guidance recommends avoiding eval-like string execution.').title).toBe('No implied eval guidance');
});
test('a pictograph the person typed stays; a title that is only a pictograph is left alone', () => {
  expect(run('🚀 Launch checklist', 'Launch checklist for Friday.', 'the 🚀 launch checklist please').title).toBe('🚀 Launch checklist');
  expect(run('✨', 'Sparkle.').title).toBe('✨');
});

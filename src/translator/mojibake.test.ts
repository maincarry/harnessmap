import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M401: U+FFFD replacement characters in a filer title/statement are repaired from the transcript when the match is unique,
// otherwise left as written (never silently shortened). Runs the real guard chain (guardScope) with a stub store.
function harness(assistantText: string) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: '跳线标题命名问题', title: '跳线标题命名问题', status: 'open', author: 'user', type: 'question', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  return (content: string, title = '与您成长') => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'floated', author: 'agent', type: 'option' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText });
    const got = out.find((a: any) => a.op === 'create_node' && a.id === 'n1');
    const m = audits.filter((a) => a.kind === 'guard_mojibake');
    return { content: got?.content as string | undefined, audits: m.length, repaired: m[0]?.d?.repaired };
  };
}

test('a replacement run is repaired from the assistant text when the match is unique (bar-anniversary-zh #356, M401)', () => {
  const r = harness('标题方向：\n1. 与您一起成长，九维Jumpwire迎来第一周年。\n2. 跳出舒适区。')('标题方向：与\uFFFD\uFFFD\uFFFD一起成长，九维Jumpwire迎来第一周年。');
  expect(r.content).toBe('标题方向：与您一起成长，九维Jumpwire迎来第一周年。');
  expect(r.repaired).toBe(true);
});

test('with no unique source the statement is left as written and audited (M401)', () => {
  const r = harness('something unrelated entirely')('标题方向：与\uFFFD一起成长。');
  expect(r.content).toBe('标题方向：与\uFFFD一起成长。');
  expect(r.audits).toBe(1);
  expect(r.repaired).toBe(false);
});

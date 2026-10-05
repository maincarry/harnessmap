import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M306 stale-title guard through the real pipeline (guardScope) with a stub store.
// 2026-10-05: the guard's tokenizer was Latin-only, so it never fired on Chinese maps; Han runs now contribute sliding bigrams.
function harness(node: { title: string; content: string }) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: '音频处理', title: '音频处理', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const n1 = { id: 'n1', parentId: 'p1', content: node.content, title: node.title, status: 'live', author: 'user', type: 'task', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent, n1], links: [], projectId: 'proj' };
  return (content: string, status?: string) => {
    audits.length = 0;
    const alt: any = { op: 'update_node', id: 'n1', content, ...(status ? { status } : {}) };
    const out = (t as any).guardScope([alt], new Set(['p1', 'n1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    const got = out.find((a: any) => a.op === 'update_node' && a.id === 'n1');
    return { title: got?.title, stale: audits.filter((a) => a.kind === 'guard_stale_title').length };
  };
}

test('a Chinese title whose words left the statement is cleared for the healer', () => {
  const run = harness({ title: '频域变换方法', content: '通过频域变换改变 PCM 数据的音调。' });
  const r = run('通过时域移位改变 PCM 数据的播放速度。');
  expect(r.stale).toBe(1);
  expect(r.title).toBe('');
});

test('a Chinese title whose phrase still appears in the new statement is kept', () => {
  const run = harness({ title: 'PCM 数据音调', content: '通过 FFT 变换改变 PCM 数据的音调。' });
  const r = run('通过重采样改变 PCM 数据的音调，速度不变。');
  expect(r.stale).toBe(0);
  expect(r.title).toBeUndefined();
});

test('English control: a title word that left the statement still clears the title', () => {
  const run = harness({ title: 'Trellis beans east fence', content: 'Plant the trellis beans along the east fence.' });
  const r = run('Plant the trellis beans along the west fence instead.');
  expect(r.stale).toBe(1);
  expect(r.title).toBe('');
});

test('a Chinese "unresolved" title over a statement that now says it is fixed is cleared (M341, Chinese forms)', () => {
  const run = harness({ title: '越界错误未解决', content: '数组访问时出现越界错误，原因是循环边界写成了 n。' });
  const r = run('数组访问时的越界错误已经修复：循环边界改为 n-1 后正常运行。');
  expect(r.stale).toBe(1);
  expect(r.title).toBe('');
});

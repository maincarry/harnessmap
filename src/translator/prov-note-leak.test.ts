import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M399: a filer-written "(arrived while focus was: …)" note inside a statement is a leak of the harness's own provenance
// convention; it goes at filing, in ASCII or full-width parens. The harness appends its real note after the guards (ASCII).
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'ECharts 甘特图', title: 'ECharts 甘特图', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  return (content: string) => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title: 'Git 免密认证', status: 'noted', author: 'agent' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    const got = out.find((a: any) => a.op === 'create_node' && a.id === 'n1');
    return { content: got?.content as string | undefined, leaks: audits.filter((a) => a.kind === 'guard_prov_note_leak').length };
  };
}

test('a filer-written full-width provenance note goes (echarts-gantt-drift-zh #350, M399)', () => {
  const r = harness()('Git 操作可通过 SSH Key 和 SSH 远程仓库地址避免每次输入账号及密码。（arrived while focus was: ECharts 甘特图）');
  expect(r.content).toBe('Git 操作可通过 SSH Key 和 SSH 远程仓库地址避免每次输入账号及密码。');
  expect(r.leaks).toBe(1);
});

test('an ASCII one goes too, and a statement without one is untouched (M399)', () => {
  expect(harness()('Use ssh-keygen to create a key pair. (arrived while focus was: ECharts Gantt)').content).toBe('Use ssh-keygen to create a key pair.');
  const r = harness()('Use ssh-keygen to create a key pair.');
  expect(r.content).toBe('Use ssh-keygen to create a key pair.');
  expect(r.leaks).toBe(0);
});

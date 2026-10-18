// M402b + M491: the filer's round-talk ("本轮…") is never part of a name — not as a lead, not as a tail after a separator;
// a head that is only the filer's meta-phrase ("…检视者核心观点的直接落实") goes with it and the healer names the node from its content.
import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

function run(title: string) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Linux 网络运维排障', title: 'Linux 网络运维排障', status: 'live', author: 'user', type: null, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt: any = { op: 'create_node', id: 'x1', parentId: 'p1', content: 'Linux 内核 4.19 中，IPv6 连接跟踪功能已集成到内核，不再提供独立的 `nf_conntrack_ipv6` 模块；需要确认相关内核配置已启用。', status: 'noted', author: 'agent', type: 'evidence', title };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
  const got = out.find((a: any) => a.op === 'create_node' && a.id === 'x1');
  return { title: got?.title, hits: audits.filter((a) => a.kind === 'guard_title_round_talk') };
}

test('a round-talk tail after a colon is cut, and the meta-phrase head with it', () => {
  const r = run('IPv6 模块支持检视者核心观点的直接落实：本轮不涉及结构重组建议');
  expect(r.hits).toHaveLength(1);
  expect(r.title ?? '').not.toMatch(/本轮|检视者|核心观点|落实/);
  expect(r.title === '' || r.title === 'IPv6 模块支持' || r.title === undefined).toBe(true);
});

test('a round-talk lead still goes and the subject stays (M402b)', () => {
  const r = run('本轮回滚结论');
  expect(r.hits).toHaveLength(1);
  expect(r.title).toBe('回滚结论');
});

test('a real name with a colon is untouched', () => {
  const r = run('IPv6 连接跟踪：内核 4.19 已内置');
  expect(r.hits).toHaveLength(0);
  expect(r.title).toBe('IPv6 连接跟踪：内核 4.19 已内置');
});

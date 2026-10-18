// M402b + M491: the filer's round-talk ("本轮…") is never part of a name — not as a lead, not as a tail after a separator;
// a head that is only the filer's meta-phrase ("…检视者核心观点的直接落实") goes with it and the healer names the node from its content.
import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

function run(title: string, content?: string) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Linux 网络运维排障', title: 'Linux 网络运维排障', status: 'live', author: 'user', type: null, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt: any = { op: 'create_node', id: 'x1', parentId: 'p1', content: content ?? 'Linux 内核 4.19 中，IPv6 连接跟踪功能已集成到内核，不再提供独立的 `nf_conntrack_ipv6` 模块；需要确认相关内核配置已启用。', status: 'noted', author: 'agent', type: 'evidence', title };
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

// M492: a Latin full stop glued before the terminal question mark is a slip; the question mark stays.
test('"Worker query correctness.?" loses the stray full stop and keeps its question mark', () => {
  // the content names "correctness", so the question-tail guard (M421b) has no say here
  const r = run('Worker query correctness.?', 'Is this Oracle SQL query correct? The teacher doubted its correctness for selecting the worker hired last.');
  expect(r.title).toBe('Worker query correctness?');
});
test('a version number before a question mark is left alone', () => {
  const r = run('Is it v1.?');
  expect(r.title).toBe('Is it v1.?');
});

// M494: a parenthetical aside ending in a question mark at a title's tail is the filer wondering aloud, not part of the name.
test('"(not allowed?)" at a title\'s tail goes; the name keeps its own mark', () => {
  const r = run('rs7412 序列出处核验仍需完成了？ (not allowed?)', 'rs7412 位点的 TaqMan 探针及相关引物序列据称来自 Kupstyte 等人 2011 年的论文；具体序列仍需核对原始论文。');
  expect(r.title).toBe('rs7412 序列出处核验仍需完成了？');
});
test('a parenthetical that is part of the name stays', () => {
  const r = run('MGB (minor groove binder) 探针', 'MGB（minor groove binder）可增强探针与目标 DNA 的结合力。');
  expect(r.title).toBe('MGB (minor groove binder) 探针');
});

// M495: an invented question tail after a bare conjunction takes the conjunction with it.
test('"Retranslate button and functionary?" on a task becomes "Retranslate button"', () => {
  const r = run('Retranslate button and functionary?', 'Add a new Retranslate button to the Translation tool that retranslates the untranslated text with the current prompt.');
  expect(r.title).toBe('Retranslate button');
});
test('a residue ending in "only if" still leaves the title alone (M421b lesson)', () => {
  const r = run('Rebuild tasks only if changed?', 'Rebuild the tasks when the inputs differ from the last run.');
  expect(r.title).toBe('Rebuild tasks only if changed?');
});

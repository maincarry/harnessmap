import { test, expect } from 'bun:test';
import { Translator } from './translator';

// Runs synthetic alterations through the real guard pipeline (guardScope) with a stub store.
// Regression test for v0.9.154: title_tail's dangling-preposition step (M348c) must only act after the guard itself stripped a tail.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'English grammar quiz', title: 'English grammar quiz', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const run = (title: string, content: string) => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'chosen', author: 'user', type: 'option' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    const got = out.find((a: any) => a.op === 'create_node');
    return { title: got?.title as string | undefined, tailAudits: audits.filter((a) => a.kind === 'guard_title_tail').length };
  };
  return run;
}

test('a quoted option that legitimately ends in a preposition is left alone (grammar-quiz #181)', () => {
  const r = harness()("Didn't have to", "You didn't have to do that, you know.");
  expect(r.title).toBe("Didn't have to");
  expect(r.tailAudits).toBe(0);
});

test('a dangling preposition after a stripped stray tail is still removed (the original M348c case)', () => {
  const r = harness()('Face classification task of ⟂', 'The face classification task uses a CNN.');
  expect(r.title).toBe('Face classification task');
  expect(r.tailAudits).toBe(1);
});

test('a plain title ending in a preposition with no stray tail is kept', () => {
  const r = harness()('Things to watch out for', 'A list of pitfalls when deploying.');
  expect(r.title).toBe('Things to watch out for');
  expect(r.tailAudits).toBe(0);
});

// v0.9.155 (leftjoin-zh #184): foreign combining MARKS and a lone trailing apostrophe.
test('a Gurmukhi vowel sign + Malayalam anusvara glued to a Han title are strays for title_script', () => {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'SQL 问题', title: 'SQL 问题', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content: '示例表 A 与表 B 的数据如下。', title: '示例表数据ੋം', status: 'noted', author: 'agent', type: 'evidence' };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
  const got = out.find((a: any) => a.op === 'create_node');
  const sa = audits.find((a) => a.kind === 'guard_title_script');
  expect(sa?.d.stray).toEqual(['gurmukhi', 'malayalam']);
  expect(got?.title).toBe(''); // blanked for the title stage, as with any foreign stray on a new node
});

test('a lone trailing apostrophe is stripped, a balanced pair is kept', () => {
  const run = harness();
  expect(run("Example table data'", 'The example tables A and B.').title).toBe('Example table data');
  expect(run("Rock 'n' Roll history", 'A short history.').title).toBe("Rock 'n' Roll history");
});

test('an emoji with its variation selector at the end of a title is stripped like any trailing symbol (kotlin-graph #231)', () => {
  const run = harness();
  expect(run('Graph range issue \u26A0\uFE0F', 'The chart range is wrong when document IDs are not dates.').title).toBe('Graph range issue');
  expect(run('Deploy checklist \u2705', 'Steps before a release.').title).toBe('Deploy checklist');
});

test('a JSON opener spill glued to a name goes (py2cpp #344, M397)', () => {
  const r = harness()('Code and task provided},{', 'The Python code and the Line game contest task were provided for rewriting in C++.');
  expect(r.title).toBe('Code and task provided');
  expect(r.tailAudits).toBe(1);
});

test('a JSON opener spill after balanced full-width parens keeps the parens (Chinese, M397)', () => {
  const r = harness()('导出前清理空格（trim）},{', '导出前先清理单元格空格（trim），再写入文件。');
  expect(r.title).toBe('导出前清理空格（trim）');
});

test('an opener behind an unbalanced quote goes too (M397)', () => {
  const r = harness()('Line game task{"', 'The Line game task asks whether the character can reach the end.');
  expect(r.title).toBe('Line game task');
});

test('a UUID glued to a Chinese name goes (sqlsugar-rollback-zh #348, M398)', () => {
  const r = harness()('b语句单独处理方案0c4d07f5-2e6f-4d7f-92f4-5ad2e7f4a3e8', '回答提出：若希望不回滚 b，可在执行 b 后将其提交到数据库，再继续执行其他语句。');
  expect(r.title).toBe('b语句单独处理方案');
});

test('a UUID glued to an English name goes, a short hex word stays (M398)', () => {
  expect(harness()('Fix login bug 0c4d07f5-2e6f-4d7f-92f4-5ad2e7f4a3e8', 'The login bug is fixed by refreshing the token.').title).toBe('Fix login bug');
  expect(harness()('Commit a1b2c3d4 review', 'Review commit a1b2c3d4 before merging.').title).toBe('Commit a1b2c3d4 review');
});

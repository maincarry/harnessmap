// M396 (demo sanity check, 2026-10-05): the WIDER FRAME brief of a focus ancestor served a DIMMED child's full statement.
// With the chat's lit set, a child outside the light is a name marked set aside; without it the brief is unchanged.
import { test, expect } from 'bun:test';
import { Store } from '../store/db';
import { renderNodeBrief } from './render';

const mk = (st: Store, pid: string, id: string, parentId: string | null, content: string, title: string | null) =>
  st.createNode({ id, projectId: pid, parentId, content, type: null, status: 'live', author: 'agent', title } as any);

test('a dimmed child is a name marked set aside in the brief; lit children keep their statement', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  mk(st, pid, 'root', null, 'The user wants help practicing English and improving their overall English skills.', 'English practice');
  mk(st, pid, 'a', 'root', 'Read English newspapers, books, articles, and blogs to improve vocabulary and comprehension.', 'Read English texts');
  mk(st, pid, 'b', 'root', 'Watch English television shows and movies to improve listening.', 'Watch English media');
  const lit = new Set(['root', 'b']);
  const brief = renderNodeBrief(st, 'root', lit);
  expect(brief).toContain('Read English texts (set aside by the user)');
  expect(brief).not.toContain('newspapers');
  expect(brief).toContain('Watch English television shows and movies to improve listening.');
});

test('a dimmed child WITHOUT a title shows only a short fragment, never the whole statement', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  mk(st, pid, 'root', null, '英语练习计划', '英语练习');
  mk(st, pid, 'a', 'root', '每天阅读英文报纸、书籍、杂志和博客，用来扩大词汇量并提高阅读理解能力，建议至少坚持三个月以上才能看到明显效果', null);
  const brief = renderNodeBrief(st, 'root', new Set(['root']));
  expect(brief).toContain('(set aside by the user)');
  expect(brief).not.toContain('坚持三个月');
});

test('without a lit set the brief is the full brief (callers that do not know the light)', () => {
  const st = new Store(':memory:');
  const pid = st.createProject('t');
  mk(st, pid, 'root', null, 'Plan', 'Plan');
  mk(st, pid, 'a', 'root', 'Read English newspapers every morning.', 'Read');
  expect(renderNodeBrief(st, 'root')).toContain('Read English newspapers every morning.');
});

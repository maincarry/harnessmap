// M498: a bare question files no evidence under the asker's name — the answer's steps are the agent's.
import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const rows = () => ([
  { op: 'create_node', id: 'q1', author: 'user', type: 'question', status: 'answered', content: '可以使用 multiprocessing.Process 在子进程中执行 Python 函数。' },
  { op: 'create_node', id: 'e1', author: 'user', type: 'evidence', status: 'noted', content: '导入 multiprocessing 模块以创建执行 Python 函数的子进程。' },
  { op: 'create_node', id: 'e2', author: 'user', type: 'evidence', status: 'noted', content: '调用 Process.join() 可以让父进程等待子进程执行完成。' },
  { op: 'create_node', id: 'c1', author: 'user', type: 'constraint', status: 'active', content: '子进程的变量与父进程彼此独立。' },
]);

test('after "可以用子进程执行某个函数吗" the evidence rows are the agent\'s; the question and constraint stay hers', () => {
  const { t, audits } = harness();
  const out = t.guardAskerAuthor(rows(), { userText: '可以用子进程执行某个函数吗' });
  expect(out.map((a: any) => a.author)).toEqual(['user', 'agent', 'agent', 'user']);
  expect(audits.filter((a) => a.kind === 'guard_asker_author')).toHaveLength(2);
});

test('an English bare question works the same; a turn with a figure, code, or a statement is left alone', () => {
  const { t } = harness();
  expect(t.guardAskerAuthor(rows(), { userText: 'Can I run a function in a child process?' })[1].author).toBe('agent');
  expect(t.guardAskerAuthor(rows(), { userText: 'My conversion takes 40 ms, is that normal?' })[1].author).toBe('user');
  expect(t.guardAskerAuthor(rows(), { userText: 'I use `multiprocessing.Process` already, why does join hang?' })[1].author).toBe('user');
  expect(t.guardAskerAuthor(rows(), { userText: '我的子进程在 Debian 上一直不退出，父进程要等它。' })[1].author).toBe('user');
});

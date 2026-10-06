import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M400: "该问题已有答案：…" / "该问题已回答为：…" inside a statement is the filer narrating the node's own status; the lead goes,
// the question and the answer stay. Runs the real guard chain (guardScope) with a stub store.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Python 打包', title: 'Python 打包', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  return (content: string) => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title: '图形界面打包', status: 'answered', author: 'agent', type: 'question' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    const got = out.find((a: any) => a.op === 'create_node' && a.id === 'n1');
    return { content: got?.content as string | undefined, trims: audits.filter((a) => a.kind === 'guard_narration_trim').length };
  };
}

test('"该问题已有答案：" lead goes, question and answer stay (py-to-exe-zh #352, M400)', () => {
  const r = harness()('是否可以使用图形界面简化 Python 程序打包？该问题已有答案：可以尝试使用 PyInstallerGUI。');
  expect(r.content).toBe('是否可以使用图形界面简化 Python 程序打包？可以尝试使用 PyInstallerGUI。');
  expect(r.trims).toBe(1);
});

test('"该问题已回答为：" goes too; a plain Chinese statement is untouched (M400)', () => {
  expect(harness()('FFmpeg有没有场景分割功能？该问题已回答为：FFmpeg可以配合机器学习模型实现场景分割。').content).toBe('FFmpeg有没有场景分割功能？FFmpeg可以配合机器学习模型实现场景分割。');
  const r = harness()('程序引用的 Excel 文件需要随 EXE 一起部署，并在代码中正确处理文件路径。');
  expect(r.content).toBe('程序引用的 Excel 文件需要随 EXE 一起部署，并在代码中正确处理文件路径。');
  expect(r.trims).toBe(0);
});

test('round-talk leads inside a statement go, the fact stays (excel-name-drift-zh #359, M402)', () => {
  expect(harness()('本轮回答认为，B 的提交对外层 A 不可见；如果 A 回滚，B 也会回滚。').content).toBe('B 的提交对外层 A 不可见；如果 A 回滚，B 也会回滚。');
  expect(harness()('本轮提供了使用 Python socket 和 Tkinter 实现 TCP 客户端 GUI 的代码方案。').content).toBe('使用 Python socket 和 Tkinter 实现 TCP 客户端 GUI 的代码方案。');
  expect(harness()('使用填充柄不能直接把 A3:A10 批量设置为对应的 Range.Name；本轮回答改用 VBA 宏按选择顺序设置名称。').content).toBe('使用填充柄不能直接把 A3:A10 批量设置为对应的 Range.Name；改用 VBA 宏按选择顺序设置名称。');
});

test('topic-talk leads at the start of a statement go, the subject stays (hash-table #362, M403)', () => {
  expect(harness()('This topic covers reference formatting for a LaTeX report, including BibTeX and manual bibliographies.').content).toBe('Reference formatting for a LaTeX report, including BibTeX and manual bibliographies.');
  expect(harness()('This branch covers debugging a C++17 contest solution.').content).toBe('Debugging a C++17 contest solution.');
  expect(harness()('This topic contains the hash table homework and its answers for collision resolution and deletion.').content).toBe('The hash table homework and its answers for collision resolution and deletion.');
  expect(harness()('Tkinter 图形界面开发主题，当前聚焦于按钮输出文本并控制文本对齐。').content).toBe('Tkinter 图形界面开发主题，按钮输出文本并控制文本对齐。');
  expect(harness()('The topic sentence of a paragraph states its main idea.').content).toBe('The topic sentence of a paragraph states its main idea.');
});

test('progress narration "X is being reviewed for Y" becomes a subject (cpp-contest #365, M405)', () => {
  expect(harness()('The submitted C++17 code is being reviewed for compilation and logical correctness.').content).toBe('Review of the submitted C++17 code compilation and logical correctness.');
  expect(harness()('The transformer model implementation is being reviewed for correctness.').content).toBe('Review of the transformer model implementation correctness.');
  expect(harness()('The queue is being drained by two workers.').content).toBe('The queue is being drained by two workers.');
});

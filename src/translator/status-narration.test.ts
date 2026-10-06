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

test('a Chinese agent-narration lead goes, the proposal stays (js-focus-nav-zh #384, M411)', () => {
  expect(harness()('代理提出：将 HTML 和 querySelectorAll 中的类名字符从“–”替换为普通连字符“-”，以修正焦点元素选择器。').content).toBe('将 HTML 和 querySelectorAll 中的类名字符从“–”替换为普通连字符“-”，以修正焦点元素选择器。');
  expect(harness()('助手建议在 getFocusableElements 中按行分组元素。').content).toBe('在 getFocusableElements 中按行分组元素。');
  expect(harness()('代理服务器建议使用 8080 端口并开启 keep-alive。').content).toBe('代理服务器建议使用 8080 端口并开启 keep-alive。');
});

test('determiner + 回答 narration and Chinese topic-talk leads go (go-howto-mix #387, M412)', () => {
  expect(harness()('Go 是否有将 curl 命令转换为 HTTP 请求逻辑的现成库？当前回答认为没有现成库，并给出了两种实现方式。').content).toBe('Go 是否有将 curl 命令转换为 HTTP 请求逻辑的现成库？没有现成库，并给出了两种实现方式。');
  expect(harness()('如何使用 Go 将 PDF 文件逐页转换为 PNG 图片？当前回答给出了使用第三方库读取 PDF 的方案。').content).toBe('如何使用 Go 将 PDF 文件逐页转换为 PNG 图片？给出了使用第三方库读取 PDF 的方案。');
  expect(harness()('转换格式的流程包括打开图片、另存为并保存；该回答称可以选择多个图片进行处理。').content).toBe('转换格式的流程包括打开图片、另存为并保存；可以选择多个图片进行处理。');
  expect(harness()('讨论 Go 是否有将 curl 命令转换为 HTTP 请求逻辑的库，以及在没有现成库时的实现方法。').content).toBe('Go 是否有将 curl 命令转换为 HTTP 请求逻辑的库，以及在没有现成库时的实现方法。');
  expect(harness()('围绕 SQL 问题，重点理解 LEFT JOIN 的连接示例、匹配结果和未匹配记录处理。').content).toBe('SQL 问题，重点理解 LEFT JOIN 的连接示例、匹配结果和未匹配记录处理。');
  expect(harness()('讨论区的帖子需要先经过审核才会显示。').content).toBe('讨论区的帖子需要先经过审核才会显示。');
  expect(harness()('项目围绕用户画像、推荐算法和离线评估三部分展开。').content).toBe('项目围绕用户画像、推荐算法和离线评估三部分展开。');
});

test('bare 回答-narration without the 本轮 lead goes, the fact stays (go-html-png-zh #382, M409)', () => {
  expect(harness()('除 os/exec 外，回答还提到 gorun、sh 和 ishell 等执行外部命令的库。').content).toBe('除 os/exec 外，gorun、sh 和 ishell 等执行外部命令的库。');
  expect(harness()('回答指出，省略第一个参数时 Excel 通常根据写入值的类型进行推断。').content).toBe('省略第一个参数时 Excel 通常根据写入值的类型进行推断。');
  expect(harness()('清理数据库日志可以将日志文件大小减少到合理范围；回答中提到可使用 BACKUP LOG WITH TRUNCATE_ONLY。').content).toBe('清理数据库日志可以将日志文件大小减少到合理范围；可使用 BACKUP LOG WITH TRUNCATE_ONLY。');
  expect(harness()('如果请求页面发生一次或多次 HTTP 重定向，回答建议针对每次重定向的 URL 分别调用 getCurlPage。').content).toBe('如果请求页面发生一次或多次 HTTP 重定向，建议针对每次重定向的 URL 分别调用 getCurlPage。');
  expect(harness()('用户需要在表单中回答三个问题后才能提交。').content).toBe('用户需要在表单中回答三个问题后才能提交。');
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

test('stative progress narration "X is under review; …" becomes a subject (transformer-review #381, M408)', () => {
  expect(harness()("The transformer model implementation is under review; one identified issue is the constructor's `super()` call.").content).toBe("Review of the transformer model implementation; one identified issue is the constructor's `super()` call.");
  expect(harness()('The payment flow is currently under investigation for duplicate charges.').content).toBe('Investigation of the payment flow duplicate charges.');
  expect(harness()('The bridge is under construction until spring.').content).toBe('The bridge is under construction until spring.');
  expect(harness()('Items under review must carry a ticket id.').content).toBe('Items under review must carry a ticket id.');
});

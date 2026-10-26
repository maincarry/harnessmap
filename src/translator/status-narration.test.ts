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

test('a Chinese "this is the topic used to organise X" root statement becomes X (LONG #392, M414)', () => {
  expect(harness()('这是用于整理 WebRTC 学习内容的主题。').content).toBe('WebRTC 学习内容');
  expect(harness()('用于记录项目决策与未决问题的节点').content).toBe('项目决策与未决问题');
  expect(harness()('该脚本用于整理日志文件并按日期归档。').content).toBe('该脚本用于整理日志文件并按日期归档。');
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

// M543 (excel-formulas 2026-10-25): "The user gave up on using VBA for the worksheet-splitting task…" became "Up on using VBA…" — `gave` sits in
// the narration-verb list and the trim split the phrasal verb. "gave up / gave in / gave way / gave out" is not a narration lead; "The user gave the
// stack trace" still is.
test('"The user gave up on …" is her act, not a narration lead; "The user gave the stack trace" still trims', () => {
  const h = harness();
  const a = h('The user gave up on using VBA for the worksheet-splitting task after the existing macro continued to fail.');
  expect(a.content).toBe('The user gave up on using VBA for the worksheet-splitting task after the existing macro continued to fail.');
  expect(a.trims).toBe(0);
  const b = h('The user gave the full stack trace from the second run of the macro.');
  expect(b.content).toBe('The full stack trace from the second run of the macro.');
});

// M546 (tcp-gui-zh 2026-10-25): "智能体提出使用 PyQt5 实现 TCP 客户端 GUI，…" — 智能体 ("the agent") joins 代理/助手/模型/机器人 in the M411 Chinese lead.
test('"智能体提出…" lead goes, the proposal stays', () => {
  const r = harness()('智能体提出使用 PyQt5 实现 TCP 客户端 GUI，包含十六进制报文输入框、发送与接收报文显示框。');
  expect(r.content).toBe('使用 PyQt5 实现 TCP 客户端 GUI，包含十六进制报文输入框、发送与接收报文显示框。');
  expect(r.trims).toBe(1);
});

// M547 (modbus-zh 2026-10-25): "代理给出的调用示例是 `python main.py -s`…" lost only "代理给出" and kept a dangling 的; the attributive 的 goes with the lead.
test('"代理给出的…" lead goes with its 的; the example stays', () => {
  const r = harness()('代理给出的调用示例是 `python main.py -s --current-ct=1`，并可继续传入 `--out-delay=10`。');
  expect(r.content).toBe('调用示例是 `python main.py -s --current-ct=1`，并可继续传入 `--out-delay=10`。');
  expect(r.trims).toBe(1);
});

// M549 (modbus-zh 2026-10-26): "agent指出，`-o` 参数…" — the Latin word agent glued to the Chinese narration verb; and the filer narrating the
// correction of its own earlier record ("此前记录的 … 被用户指出不正确，正确的 …"). Both leads go; the statements stay.
test('"agent指出，…" and "此前记录的…被用户指出不正确，" leads go', () => {
  const h = harness();
  const a = h("agent指出，`-o` 参数通过 `dest='filename'` 写入 `args.filename`，代码中使用 `args.o` 的对应关系需要检查。");
  expect(a.content).toBe("`-o` 参数通过 `dest='filename'` 写入 `args.filename`，代码中使用 `args.o` 的对应关系需要检查。");
  expect(a.trims).toBe(1);
  const b = h('此前记录的 `setting()` 参数定义被用户指出不正确，正确的函数参数签名仍需根据实际代码重新核对。');
  expect(b.content).toBe('正确的函数参数签名仍需根据实际代码重新核对。');
  expect(b.trims).toBe(1);
});

// M551 (flutter-vue-zh 2026-10-26): her question rows read "用户在寻找C#学习视频比较丰富、质量较高的网站；…" — the Chinese form of "User is looking
// for …"; the subject goes, what she is after stays. And "；本轮补充称，许多课程…" left "补充称" behind after the round word went; the whole lead goes.
test('"用户在寻找…" lead goes; "本轮补充称，" goes whole; a sentence about 用户名 stays', () => {
  const h = harness();
  expect(h('用户在寻找C#学习视频比较丰富、质量较高的网站；推荐的平台包括Pluralsight。').content).toBe('寻找C#学习视频比较丰富、质量较高的网站；推荐的平台包括Pluralsight。');
  expect(h('Udemy拥有许多带有五星评价的C#学习课程；本轮补充称，许多课程提供英文字幕或中文字幕。').content).toBe('Udemy拥有许多带有五星评价的C#学习课程；许多课程提供英文字幕或中文字幕。');
  expect(h('用户名需要至少八个字符，并包含一个数字。').content).toBe('用户名需要至少八个字符，并包含一个数字。');
});

// M554 (flask-running-zh 2026-10-26): three residues — "本轮回答提出可通过…" left "提出可通过…" (提出/建议/推荐/给出 join the round-talk verbs);
// "…；本轮内容聚焦其格式与 Python 读写方式。" is a round-talk tail clause and goes whole; "用户在 PyCharm 上运行 Flask 应用。" is the Chinese
// "User is running X on Y" and loses its subject. Product talk about end users ("用户在登录页面需要输入验证码") stays.
test('M554: round-talk verbs, a round-talk tail clause, and the "用户在…上运行" lead go; product talk about users stays', () => {
  const h = harness();
  expect(h('本轮回答提出可通过设置环境变量 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py` 来显示运行时信息。').content).toBe('可通过设置环境变量 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py` 来显示运行时信息。');
  expect(h('INI 是一种常见的配置文件格式，适合存储程序配置；本轮内容聚焦其格式与 Python 读写方式。').content).toBe('INI 是一种常见的配置文件格式，适合存储程序配置。');
  expect(h('用户在 PyCharm 上运行 Flask 应用。').content).toBe('在 PyCharm 上运行 Flask 应用。');
  expect(h('用户在登录页面需要输入验证码。').content).toBe('用户在登录页面需要输入验证码。');
});


// M555 (flask-running-zh 2026-10-26): "当前回答提出将…" / "回答提出可以…" / "回答提出：若…" — the bare-回答 and 当前回答 leads with 提出,
// which M412/M409 did not list; the lead goes, the fact stays. "回答提出的问题" is a verb phrase (answer the raised question) and stays.
test('M555: 回答提出 / 当前回答提出 leads go, the fact stays; 回答提出的问题 stays', () => {
  const h = harness();
  expect(h('当前回答提出将 `app.config[\'DEBUG\']` 设置为 `False`，以避免 Flask 在终端返回状态码。').content).toBe('将 `app.config[\'DEBUG\']` 设置为 `False`，以避免 Flask 在终端返回状态码。');
  expect(h('回答提出可以设置环境变量 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py`，以尝试显示运行时信息。').content).toBe('可以设置环境变量 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py`，以尝试显示运行时信息。');
  expect(h('回答提出：若 WSGI 服务器配置中的 `WSGIScriptAlias` 指向 `wsgi.py`，可据此判断应用由 WSGI 服务器启动。').content).toBe('若 WSGI 服务器配置中的 `WSGIScriptAlias` 指向 `wsgi.py`，可据此判断应用由 WSGI 服务器启动。');
  const r = h('回答提出的问题需要先确认 Flask 版本。');
  expect(r.content).toBe('回答提出的问题需要先确认 Flask 版本。');
  expect(r.trims).toBe(0);
});

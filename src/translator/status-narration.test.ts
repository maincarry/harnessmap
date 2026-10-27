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

// M556 (flask-running-zh 2026-10-26): "用户是在 PyCharm 上运行 Flask 应用的。" — the 是…的 frame of the M554c "用户在…上运行" lead.
test('M556: 用户是在…上运行…的 goes to the plain clause; other 用户是 statements stay', () => {
  const h = harness();
  expect(h('用户是在 PyCharm 上运行 Flask 应用的。').content).toBe('在 PyCharm 上运行 Flask 应用。');
  const r = h('用户是管理员时才能看到该按钮。');
  expect(r.content).toBe('用户是管理员时才能看到该按钮。');
  expect(r.trims).toBe(0);
});

// M557 (ltp-report-zh 2026-10-26): "…，但本轮未自动获取或核验具体版本。" — a round-talk tail clause after a comma (M554b knew only "；本轮内容聚焦…").
test('M557: a "，但本轮未…" tail clause goes, the statement keeps its full stop; a plain 但未 clause stays', () => {
  const h = harness();
  expect(h('LTP 官方仓库可用于查找最新源代码和官方说明文档，但本轮未自动获取或核验具体版本。').content).toBe('LTP 官方仓库可用于查找最新源代码和官方说明文档。');
  const r = h('文件内容已追加，但未以换行符结尾。');
  expect(r.content).toBe('文件内容已追加，但未以换行符结尾。');
  expect(r.trims).toBe(0);
});

// M559 (flask-running-zh 2026-10-26): "此前的说明建议通过设置 `WERKZEUG_RUN_MAIN=true` …" — the filer attributing the fact to "the earlier
// explanation"; the 此前/先前/之前 forms of the M412 subject, with 说明/解释 as the noun. The subject goes; M412b keeps the verb 建议.
test('M559: 此前的说明建议… / 此前的回答指出… leads go; 该说明指出 (documentation) and the 此前关于…不正确 correction record stay', () => {
  const h = harness();
  expect(h('此前的说明建议通过设置 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py` 来尝试显示运行时信息。').content).toBe('建议通过设置 `WERKZEUG_RUN_MAIN=true` 后运行 `python app.py` 来尝试显示运行时信息。');
  expect(h('此前的回答指出，Gunicorn 启动时不会输出 Running on 信息。').content).toBe('Gunicorn 启动时不会输出 Running on 信息。');
  const r = h('该说明指出 API 调用需要密钥。');
  expect(r.content).toBe('该说明指出 API 调用需要密钥。');
  expect(r.trims).toBe(0);
  expect(h('此前关于 zip_stat 的回答不正确；它在条目不存在时返回 -1。').content).toBe('此前关于 zip_stat 的回答不正确；它在条目不存在时返回 -1。');
});

// M560 (panorama-memory 2026-10-26): "The user is unsure whether …" / "The user is looking for …" / "The user asked why …" — the English
// twins of the 用户想知道 / 用户在寻找 leads. The lead goes, the question word stays, the remainder is capitalised.
test('M560: English user question-leads go; a user-interface statement and a plain "The user" fact stay', () => {
  const h = harness();
  expect(h('The user is unsure whether matching every image directly to the first reference image is appropriate, because panorama construction is commonly done between adjacent pairs.').content).toBe('Whether matching every image directly to the first reference image is appropriate, because panorama construction is commonly done between adjacent pairs.');
  expect(h('The user is looking for a C# video course site with rich content.').content).toBe('A C# video course site with rich content.');
  expect(h('The user asked why the Running on line is missing.').content).toBe('Why the Running on line is missing.');
  const r = h('The user interface is rendered by Tkinter.');
  expect(r.content).toBe('The user interface is rendered by Tkinter.');
  expect(r.trims).toBe(0);
});

// M562a/b (nfconntrack-zh 2026-10-26): her evidence row opened "用户观察到：在默认情况下，…" (the M326b frame with a verb the list lacked) and the
// agent's row opened "现有回答提出通过 `lsmod …` 检查…" (the M412 subject list lacked 现有). Product talk without the colon and a bare noun phrase stay.
test('用户观察到： and 现有回答提出 are narration leads; 用户发现… without a colon and 现有回答数量 stay', () => {
  const h = harness();
  expect(h('用户观察到：在默认情况下，Linux kernel 4.19 无法跟踪 IPv6 数据包。').content).toBe('在默认情况下，Linux kernel 4.19 无法跟踪 IPv6 数据包。');
  expect(h('现有回答提出通过 `lsmod | grep nf_conntrack` 检查 `nf_conntrack`。').content).toBe('通过 `lsmod | grep nf_conntrack` 检查 `nf_conntrack`。');
  expect(h('现有的说明指出模块已集成到内核。').content).toBe('模块已集成到内核。');
  const r = h('用户发现页面闪烁后会自动刷新。');
  expect(r.content).toBe('用户发现页面闪烁后会自动刷新。');
  expect(r.trims).toBe(0);
  expect(h('现有回答数量不足三条。').content).toBe('现有回答数量不足三条。');
});

// M563a/b/d (taqman-apoe-zh 2026-10-26): "给出的TaqMan探针FAM荧光标记序列为…" (the answer giving it), "…；该来源已由本轮信息确认。" (the positive twin of
// M557's tail), and the 本轮 lead rule cutting her own "本轮训练" (a domain noun, not round-talk).
test('给出的 at a clause start and a positive 本轮 tail go; 用户给出的, 该函数给出的 and 本轮训练 stay', () => {
  const h = harness();
  expect(h('给出的TaqMan探针FAM荧光标记序列为5’- TTC CGC ATG GCA CGA -3’。').content).toBe('TaqMan探针FAM荧光标记序列为5’- TTC CGC ATG GCA CGA -3’。');
  expect(h('针对rs7412位点，给出的TaqMan检测引物1序列为5’- CCT CAA AGG -3’。').content).toBe('针对rs7412位点，TaqMan检测引物1序列为5’- CCT CAA AGG -3’。');
  expect(h('rs7412 TaqMan探针具体参考Kupstyte等人2011年的研究；该来源已由本轮信息确认。').content).toBe('rs7412 TaqMan探针具体参考Kupstyte等人2011年的研究。');
  expect(h('本轮回答提到模块已集成到内核。').content).toBe('模块已集成到内核。');
  for (const keep of ['用户给出的参数不足以复现问题。', '该函数给出的结果为空数组。', '本轮训练的损失下降到 0.3。', '模型在本轮比赛中排名第三，名次由本轮积分决定。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

// M567 (imgui-docking-zh 2026-10-26): agent evidence rows narrating her report with a colon-less 用户反馈其 / 用户在其…中搜索不到 lead
// (the phppcntl525 shape, third instance). Product nouns "用户反馈功能" / "用户反馈表单" and the M409 "用户需要…" stay.
test('colon-less 用户反馈其 / 用户在其…中搜索不到 leads go; 用户反馈功能 / 用户反馈表单 stay (M567)', () => {
  const h = harness();
  expect(h('用户反馈其 ImGui 1.84 版本中找不到 `DockSpace` 方法，因此此前关于调用 `ImGui::DockSpace` 的说明不适用于其版本或构建。').content).toBe('其 ImGui 1.84 版本中找不到 `DockSpace` 方法，因此此前关于调用 `ImGui::DockSpace` 的说明不适用于其版本或构建。');
  expect(h('用户在其 ImGui 1.84 代码中搜索不到 `IMGUI_ENABLE_DOCKING` 宏，因此该宏是否适用于其版本或构建尚未确认。').content).toBe('在其 ImGui 1.84 代码中搜索不到 `IMGUI_ENABLE_DOCKING` 宏，因此该宏是否适用于其版本或构建尚未确认。');
  expect(h('用户表示其公司使用 Nacos 管理配置。').content).toBe('其公司使用 Nacos 管理配置。');
  for (const keep of ['用户反馈功能需要登录后才能使用。', '用户反馈表单包含三个字段。', '用户需要在表单中回答三个问题后才能提交。', '用户发现页面闪烁后会自动刷新。', '用户表示同意该方案。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

// M568 (media-protocols-zh 2026-10-26): the agent's-answer subject mid-sentence after a comma — "，代理回答建议引入RTP…" —
// goes like M412b's 当前回答; the verb stays. A product noun phrase without the comma ("网关的代理回复建议栏位") stays.
test('，代理回答建议… mid-sentence loses the subject, the verb stays; product phrasing stays (M568)', () => {
  const h = harness();
  expect(h('1078协议将压缩后的音视频数据封装为统一格式进行传输；由于网络存在丢包和抖动，代理回答建议引入RTP等协议以改善音视频数据传输的及时性和稳定性。').content).toBe('1078协议将压缩后的音视频数据封装为统一格式进行传输；由于网络存在丢包和抖动，建议引入RTP等协议以改善音视频数据传输的及时性和稳定性。');
  expect(h('视频帧较大时，助手的回复建议分片发送。').content).toBe('视频帧较大时，建议分片发送。');
  for (const keep of ['网关的代理回复建议栏位为空时返回 400。', '由于丢包，建议引入 RTP 协议。', '若超时，代理回复为空则重试。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

// M570 (dict-dataframe-zh 2026-10-26): "用户表示 `pd.DataFrame.from_dict()` 一直报错。" and php-pcntl-zh's "用户反馈 http://… 地址下没有…" —
// M567's lead with a code token or a URL right after the verb. A plain word after the verb ("用户反馈 API 文档缺少示例") stays.
test('用户表示 `code` … / 用户反馈 http://… leads go; a plain word after the verb stays (M570)', () => {
  const h = harness();
  expect(h('用户表示 `pd.DataFrame.from_dict()` 一直报错。').content).toBe('`pd.DataFrame.from_dict()` 一直报错。');
  expect(h('用户反馈 http://example.com/api 地址下没有 pcntl 目录。').content).toBe('http://example.com/api 地址下没有 pcntl 目录。');
  for (const keep of ['用户反馈 API 文档缺少示例。', '用户反馈功能需要登录后才能使用。', '用户表示同意该方案。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

// M572a (minimal-linux-boot-zh 2026-10-26): "回答给出的代码片段中，`switch_root()` 通过 …" — the 回答 cut left "给出的代码片段中，"; 给出的X中， is the
// same "the answer giving X" lead as M563a's 给出的X为, and it must still go after the 回答 lead is cut.
test('给出的X中， goes, also after a 回答 lead; 用户给出的 and a bare 代码片段中 stay', () => {
  const h = harness();
  expect(h('回答给出的代码片段中，`switch_root()` 通过 `graft_tree(real_root_dev, "/")` 挂载真正根设备。').content).toBe('代码片段中，`switch_root()` 通过 `graft_tree(real_root_dev, "/")` 挂载真正根设备。');
  expect(h('给出的代码片段中，变量未初始化。').content).toBe('代码片段中，变量未初始化。');
  expect(h('回答给出的示例配置为 `root=/dev/sda1`。').content).toBe('示例配置为 `root=/dev/sda1`。');
  for (const keep of ['用户给出的代码片段中有一个拼写错误。', '代码片段中，变量未初始化。', '给出的条件下结果恒成立。']) expect(h(keep).content).toBe(keep);
});

// M579a (mssql-zh 2026-10-27): "代理回答认为，不使用 ASP.NET Web 应用程序框架时…" came out as "认为，不使用…" — M411 took 回答 as
// the verb and left the reporting verb standing. The whole 代理回答 + verb + comma lead goes (the M409 shape); before 建议 the verb stays (M411).
test('代理回答认为，… at a sentence start goes whole; 代理回答建议… keeps its verb; 代理商回答称 stays (M579a)', () => {
  const h = harness();
  expect(h('代理回答认为，不使用 ASP.NET Web 应用程序框架时，可以通过页面级别编译在运行时生成 DLL。').content).toBe('不使用 ASP.NET Web 应用程序框架时，可以通过页面级别编译在运行时生成 DLL。');
  expect(h('助手回答指出，该配置项默认关闭。').content).toBe('该配置项默认关闭。');
  expect(h('代理回答建议在每个页面添加该选项。').content).toBe('建议在每个页面添加该选项。');
  for (const keep of ['代理商回答称货物已发出。', '我认为，该方案可行。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

// M581 (sqlsugar-isolate-zh 2026-10-27): "回答中的 C 方法通过新的数据库连接和 ADO.NET 事务执行 SQL：…" — the possessive form of the
// M409 lead ("the answer's C method"); M409 knew 回答中提到/指出 only. Sentence-start only; a product noun before 回答 keeps it.
test('回答中的 X / 回复里的 X at a sentence start go; 问卷回答中的 / 用户回答中的 stay; 回答中提到的方案 stays whole (M581)', () => {
  const h = harness();
  expect(h('回答中的 C 方法通过新的数据库连接和 ADO.NET 事务执行 SQL：打开连接、创建事务，成功时提交。').content).toBe('C 方法通过新的数据库连接和 ADO.NET 事务执行 SQL：打开连接、创建事务，成功时提交。');
  expect(h('回复里的示例配置缺少超时设置。').content).toBe('示例配置缺少超时设置。');
  for (const keep of ['问卷回答中的字段需要逐项校验。', '用户回答中的错误会被标红显示。', '回答中提到的方案使用保存点。']) {
    const r = h(keep); expect(r.content).toBe(keep); expect(r.trims).toBe(0);
  }
});

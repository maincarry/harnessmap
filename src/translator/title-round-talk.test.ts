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

// M497: a "please note…" tail is the filer addressing the reader, not part of the name.
test('"Gson 输出 JSON 而非 YAML 请注意格式契约" loses the reader-addressing tail', () => {
  const r = run('Gson 输出 JSON 而非 YAML 请注意格式契约', '示例使用 Gson 将修改后的 Java 对象序列化输出，而不是 YAML 文本。'); // the content avoids the word JSON: the self-leak guard (M354) reads content and would drop the fixture for an unrelated reason
  expect(r.title).toBe('Gson 输出 JSON 而非 YAML');
});
test('a name that merely contains 注意 as a word stays', () => {
  const r = run('线程安全注意事项', '多线程访问共享配置时需要加锁。');
  expect(r.title).toBe('线程安全注意事项');
});

// M499: three title slips from one map — an ideographic-space run with spilled content, a glued eight-character id prefix,
// and a comma tail in which the filer talks about the record itself.
test('an ideographic-space run cuts the title to its head', () => {
  const r = run('threading模块简介　　　　时，`func1` 和 `func2` 分别代表不同任务', '可以导入 Python 的 threading 模块来创建和管理线程。');
  expect(r.title).toBe('threading模块简介');
});
test('an eight-character hex id glued to a Chinese name goes; a hex word after a space stays', () => {
  const r = run('overlapped跨端使用说明25f2a1b6', 'overlapped 依赖 Windows 的 IOCP，只能用于 Windows 异步 I/O。');
  expect(r.title).toBe('overlapped跨端使用说明');
  const keep = run('回滚到提交 deadbeef', '回滚到提交 deadbeef 以恢复旧行为。');
  expect(keep.title).toBe('回滚到提交 deadbeef');
});
test('a comma tail about keeping the question open goes', () => {
  const r = run('父子进程退出关系，让问题保持开放以反映当前回答未形成可靠结论', '创建的子进程没有结束时，父进程是否会结束？还需要明确父进程退出后子进程的状态。');
  expect(r.title).toBe('父子进程退出关系');
});

// M513 (tk-threads-zh 2026-10-25): two more title slips, and the untitled stub child seen twice (media524, tk-threads).
test('a lone digit glued onto a Chinese tail goes; a digit after a space or a Latin word stays', () => {
  expect(run('单线程 join 示例相关代码与行为说明2', '一个子线程的 join 示例。').title).toBe('单线程 join 示例相关代码与行为说明');
  expect(run('Python 3 线程模型', 'Python 3 的线程。').title).toBe('Python 3 线程模型');
  expect(run('RFC 3551', 'RTP 音视频配置。').title).toBe('RFC 3551');
  expect(run('接口 v2', '第二版接口。').title).toBe('接口 v2');
});
test('a title that repeats its own head is cut at the seam; a real repeat of a short word is not', () => {
  expect(run('示例布局差异限制事项示例布局差异', '重新设计的示例仍未完全满足六行界面要求。').title).toBe('示例布局差异限制事项');
  expect(run('导入导出与导入', '导入导出。').title).toBe('导入导出与导入');
  expect(run('nginx 反向代理登录接口设定', '前端不得直接请求 7002。').title).toBe('nginx 反向代理登录接口设定');
  // M517: a repeated short word in a word script is language, not a seam; a repeated multi-word head still is
  expect(run('She Believed She Could', '“She Believed She Could: A Year of Affirmations to Encourage Women”').title).toBe('She Believed She Could');
  expect(run('Step by Step Guide', 'A step by step guide to the setup.').title).toBe('Step by Step Guide');
  expect(run('Nginx proxy login setup Nginx proxy login', 'The frontend must not call 7002 directly.').title).toBe('Nginx proxy login setup');
});
// M513b: a state of the record glued to a name's tail goes; a name that merely contains such a word is untouched.
test('a status phrase glued to the tail of a name goes', () => {
  expect(run('等待子线程完成答案未完备', '在 Tkinter 场景中等待子线程完成的方式尚无定论。').title).toBe('等待子线程完成');
  expect(run('GUI线程等待方式未定论', '等待方式必须同时保证界面不卡顿。').title).toBe('GUI线程等待方式');
  expect(run('网络变化与 ICE 重启原因待核验或', '网络变化后 ICE 状态未变。').title).toBe('网络变化与 ICE 重启原因');
  // M518: a resolved state glued to the tail goes the same way; the status field carries it
  expect(run('Redis requirepass 用途已回答', 'Redis 配置中的 `requirepass` 用于设置密码。').title).toBe('Redis requirepass 用途');
  expect(run('依赖安装已完成', '依赖已安装。').title).toBe('依赖安装');
  expect(run('已解决问题的归档', '归档已解决的问题。').title).toBe('已解决问题的归档');
});
test('a name that contains a status word in its middle, or is only the word, is untouched', () => {
  expect(run('待定事项清单', '待定事项。').title).toBe('待定事项清单');
  expect(run('未解决问题的排查顺序', '先查权限再查 SELinux。').title).toBe('未解决问题的排查顺序');
});

// M514 (grammar-quiz 2026-10-25): a repr/kwargs leak in a title goes whole; another script glued onto a Latin tail goes.
test("a title carrying **kwargs or content=' is dropped for the healer to name", () => {
  expect(run("New York grammar question's title'**kwargs' content='New York", 'He has never been to New York.').title ?? '').toBe('');
});
test('a Cyrillic fragment glued onto an English title tail goes', () => {
  expect(run('Healthy diet grammar questionутры', 'Choose the grammatically correct sentence.').title).toBe('Healthy diet grammar question');
  // (a spaced Russian run inside an English title is the older guard_title_script's business — it drops such a title for the healer)
  // (an all-Cyrillic title in an English round is likewise guard_title_script's call, not this rule's)
});

// M515 (autohotkey-ru 2026-10-25): Latin letters glued onto a Cyrillic tail go; a spaced Latin word stays.
test('a Latin letter glued onto a Russian title tail goes; a spaced Latin word stays', () => {
  expect(run('Класс устройств тачпада и мышиs', 'Как найти идентификаторы класса устройств тачпада и мыши в Windows?').title).toBe('Класс устройств тачпада и мыши');
  expect(run('Открытие через Win+X', 'В Windows 10 «Управление устройствами» открывается через Win+X.').title).toBe('Открытие через Win+X');
  expect(run('Команда devmgmt.msc', 'Команда devmgmt.msc открывает диспетчер устройств.').title).toBe('Команда devmgmt.msc');
});

// M520b (book-links 2026-10-25): the filer's placement note, written as a node, is dropped; a sentence that merely says where something belongs stays.
test('a node whose content is only a placement note is dropped', () => {
  expect(run('Book existence', 'belongs under "Learning R" [81868a59]').title).toBeUndefined();
  expect(run('Shelving', 'The R book belongs under statistics on our shelf, next to the Bayesian texts.').title).toBe('Shelving');
});

// M522 (mssql-zh 2026-10-25): "as follows" glued to a title's tail goes; the noun it introduced stays; a name that begins with it is untouched.
test('an "as follows" tail goes from a title', () => {
  expect(run('数据库文件压缩方案如下', '如何有效压缩 SQL Server 数据库文件的大小？').title).toBe('数据库文件压缩方案');
  expect(run('部署步骤如下所示', '部署分三步。').title).toBe('部署步骤');
  expect(run('如下所示的配置', '配置示例。').title).toBe('如下所示的配置');
});


// M525 (android-jni zh 2026-10-25): a letters-only glitch run glued straight onto a Han word goes when it is in neither the statement nor
// her words; a glued product name the content carries stays whole.
test('a glitch run glued onto a Han word goes; a glued name the content carries stays', () => {
  expect(run('回调 Kotlin 方法然后调用 JNI 回复rayele', 'Oboe 的 `onAudioReady` 是 C++ 音频回调方法；它可以通过当前线程的 `JNIEnv*` 调用 Kotlin 层方法。').title).toBe('回调 Kotlin 方法然后调用 JNI 回复');
  expect(run('使用python打包', '可以使用 Python 的 PyInstaller 把程序打包成单个可执行文件。').title).toBe('使用python打包');
  expect(run('安装feh', 'Debian / Ubuntu 可执行 `sudo apt-get install feh` 安装 feh。').title).toBe('安装feh');
  expect(run('Oboe 回调kotlin', '在 Android Oboe 项目中，需要从 C++ 的 `onAudioReady` 回调通过 JNI 调用 Kotlin 层的方法。').title).toBe('Oboe 回调kotlin');
});

// M532 (go-failing-test-ru 2026-10-25): a variation selector glued after a letter is a seam — the title ends there; a selector on an emoji at the tail is M360's.
test('a title is cut at a variation selector that follows a letter; an emoji with a selector at the tail still goes whole', () => {
  expect(run('Проверка вычислений и тесты\uFE0Fжло?', 'Проверить правильность вычисления `Ri*Ai` в Go-решении с помощью переменных `minProduct` и `maxProduct`.').title).toBe('Проверка вычислений и тесты');
  expect(run('Graph range issue \u26A0\uFE0F', 'The graph range is wrong for the weekly view.').title).toBe('Graph range issue');
  expect(run('Проверка вычислений и тесты', 'Проверить правильность вычисления.').title).toBe('Проверка вычислений и тесты');
});

// M537 (hash-table 2026-10-25): "Resulting hash table ❯" — a lone ornament/quotation closer at the tail is an unbalanced closer, like a stray ")".
test('a lone ❯ or » at the end of a title goes; a balanced 「」 or 【】 pair stays', () => {
  expect(run('Resulting hash table ❯', 'The resulting separate-chaining table is: index 2 a; index 3 b → e → f.').title).toBe('Resulting hash table');
  expect(run('Export cleanup »', 'Trim spaces before export.').title).toBe('Export cleanup');
  expect(run('导出前清理空格「trim」', '导出前先 trim 空格。').title).toBe('导出前清理空格「trim」');
  expect(run('【草稿】导出方案', '导出方案的草稿。').title).toBe('【草稿】导出方案');
});

// M538 (random-numbers 2026-10-25): "Variable name problemā not valid JSON?" — a Latin-Extended letter glued into an ASCII word plus a parser's phrase, neither in the statement.
test('a Latin-Extended seam inside an ASCII word and a leaked parser phrase cut the title; a real macron word and a statement about JSON stay', () => {
  expect(run('Variable name problemā not valid JSON?', 'The `number` variable also does not work in the Python random-number script; the cause of the variable-name problem remains unverified.').title).toBe('Variable name problem');
  expect(run('Fix māori spelling', 'The māori name takes a macron on the a.').title).toBe('Fix māori spelling');
  expect(run('Config loader Unexpected token', 'The config loader fails at startup on a stray comma in the settings file.').title).toBe('Config loader');
});

// M540 (react-eslint 2026-10-25): a glued UUID left a one-letter fragment behind — "Avoid noninteractive handlers t".
test('a one- or two-letter fragment glued onto a stripped UUID goes with it; a whole word before the id stays', () => {
  expect(run('Avoid noninteractive handlers te3421c5e-23db-4bf4-9216-915a5c0d1e2f', 'The rule discourages click handlers on non-interactive elements.').title).toBe('Avoid noninteractive handlers');
  expect(run('b语句单独处理方案0c4d07f5-2e6f-4d7f-92f4-5ad2e7f4a3e8', 'b 语句单独处理。').title).toBe('b语句单独处理方案');
  expect(run('Rollback plan 0c4d07f5-2e6f-4d7f-92f4-5ad2e7f4a3e8', 'The rollback plan for the batch.').title).toBe('Rollback plan');
});

// M542a (tcp-gui-zh 2026-10-25): "TCP客户端GUI界面设计与实现基础功能已完成，代码采用 PyQt5；界面包含…按钮" — a sixty-character Han clause after one digit token
// is a sentence tail, not a glitch token; M349 cut it and left the title dangling at 采用. A short glitch token still goes.
test('a long Han clause after a digit token is not a glitch word; a short glitch token still goes', () => {
  const long = 'TCP客户端GUI界面设计与实现基础功能已完成，代码采用 PyQt5；界面包含十六进制报文输入框、统一收发报文打印框，以及建立连接、中断连接和发送报文按钮';
  expect(run(long, '制作一个带 GUI 的 TCP 客户端程序：提供十六进制报文输入框，在同一个打印框中显示发送报文和接收报文，并提供“建立 TCP 连接”“中断 TCP 连接”和“发送报文”按钮。').title).toBe(long);
  expect(run('Float target shape values te4a1b6c', 'The float target shape values must match the image.').title).toBe('Float target shape values');
});


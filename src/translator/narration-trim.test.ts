import { test, expect } from 'bun:test';
import { finishNarrationTrim } from './narration-trim';

test('no narration removed → text untouched, identifiers keep their case', () => {
  for (const s of ['node-xlsx 导出内容与空格显示问题', 'os/exec 是 Go 中执行外部命令的常用标准库', 'time.time() returns wall-clock seconds.', 'nginx listens on 80.', 'cx_Freeze bundles the app', 'three.js scene setup']) {
    expect(finishNarrationTrim(s, s)).toBe(s);
  }
});

test('no narration removed → spacing before .NET is kept', () => {
  const s = 'SqlSugar 不负责线程控制；多线程操作可借助 .NET 的 Thread 或 Task 实现。';
  expect(finishNarrationTrim(s, s)).toBe(s);
});

test('after a real trim the remainder is sentence-cased', () => {
  const src = 'The agent proposed that splitData is incorrectly replicating trainLabels.';
  const core = 'splitData is incorrectly replicating trainLabels.';
  expect(finishNarrationTrim(src, core)).toBe('SplitData is incorrectly replicating trainLabels.');
  expect(finishNarrationTrim('User confirmed the tiler comes on the 20th.', 'the tiler comes on the 20th.')).toBe('The tiler comes on the 20th.');
});

test('after a real trim an identifier-looking first token keeps its case', () => {
  expect(finishNarrationTrim('User confirmed node-xlsx keeps leading spaces.', 'node-xlsx keeps leading spaces.')).toBe('node-xlsx keeps leading spaces.');
  expect(finishNarrationTrim('User noted os/exec runs the command.', 'os/exec runs the command.')).toBe('os/exec runs the command.');
  expect(finishNarrationTrim('User said time.time() is coarse.', 'time.time() is coarse.')).toBe('time.time() is coarse.');
});

test('after a real trim a dangling leading separator and a lost full stop are repaired', () => {
  expect(finishNarrationTrim('User asked: ; how does it work.', '; how does it work')).toBe('How does it work.');
  expect(finishNarrationTrim('The user asked about caching , and the agent listed options.', 'caching , and')).toBe('Caching, and.');
});

import { test, expect } from 'bun:test';
import { sameStatement, needsName } from './heal-stale.js';

// M552 (flutter-vue-zh 2026-10-26): the healer dropped a computed title as "stale" because the auto-placer had just stripped the
// "(arrived while focus was: …)" note; the statement itself had not changed. A rewritten statement is still a change.
test('a content that lost only its focus note is the same statement; a rewritten one is not', () => {
  expect(sameStatement('Coursera 提供高质量 C# 课程。 (arrived while focus was: 后台UI组件库)', 'Coursera 提供高质量 C# 课程。')).toBe(true);
  expect(sameStatement('Trellis beans on the east fence. (arrived while focus was: garden)', 'Trellis beans on the west fence.')).toBe(false);
  expect(sameStatement('Same words.', 'Same words.')).toBe(true);
});

// M558 (libzip-zh 2026-10-26): six untitled non-seed rows across the kept e2e maps were Chinese sentences of 30–46 chars — under the
// Latin-shaped long-name rule (>6 words / >48 chars), so the healer never named them.
test('a titleless Han sentence needs a name; a short Han label, a titled node and an English short note do not', () => {
  expect(needsName(null, '当前调用场景没有使用多线程，因此多线程锁竞争不能解释这次 Get 接口单次调用耗时异常高。')).toBe(true);
  expect(needsName(null, '如何检测容器中的 Nginx 基线配置是否符合规范？可采用手动检测或自动化工具检测。')).toBe(true);
  expect(needsName(null, '关闭 DEBUG 模式')).toBe(false);
  expect(needsName('不是查询导致', '当前调用场景没有使用多线程，因此多线程锁竞争不能解释这次 Get 接口单次调用耗时异常高。')).toBe(false);
  expect(needsName(null, 'Use Postgres for the store.')).toBe(false);
});

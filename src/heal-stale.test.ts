import { test, expect } from 'bun:test';
import { sameStatement } from './heal-stale.js';

// M552 (flutter-vue-zh 2026-10-26): the healer dropped a computed title as "stale" because the auto-placer had just stripped the
// "(arrived while focus was: …)" note; the statement itself had not changed. A rewritten statement is still a change.
test('a content that lost only its focus note is the same statement; a rewritten one is not', () => {
  expect(sameStatement('Coursera 提供高质量 C# 课程。 (arrived while focus was: 后台UI组件库)', 'Coursera 提供高质量 C# 课程。')).toBe(true);
  expect(sameStatement('Trellis beans on the east fence. (arrived while focus was: garden)', 'Trellis beans on the west fence.')).toBe(false);
  expect(sameStatement('Same words.', 'Same words.')).toBe(true);
});

import { test, expect } from 'bun:test';
import { newbornThreadOk, newbornHomeOk } from './autolit';

// M466: on a one-project map the newborn thread takes the focus when it was born with children; a lone fact never does.
test('M466: a newborn thread with children under the sole root is an acceptable focus; a lone fact is not; a multi-root map keeps M418', () => {
  const thread = { status: 'provisional', parentId: 'root', content: 'Churn by tenure' };
  expect(newbornThreadOk(thread, true, 1)).toBe(true);
  expect(newbornThreadOk(thread, true, 0)).toBe(false);
  expect(newbornThreadOk(thread, false, 2)).toBe(false);
  expect(newbornThreadOk({ status: 'live', parentId: 'root', content: 'to sort' }, true, 3)).toBe(false);
  expect(newbornHomeOk({ status: 'live', parentId: null, content: 'Customer churn parquet' }, new Set(), 'root', 1)).toBe(false); // the sole root stays refused
});

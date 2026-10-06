import { describe, expect, test } from 'bun:test';
import { shouldPromoteStranded } from './place.js';

describe('M416 stranded to-sort item → own top-level topic', () => {
  test('first miss on a lone item waits for the retry', () => { expect(shouldPromoteStranded(1, 0)).toBe(false); expect(shouldPromoteStranded(1, 1)).toBe(false); });
  test('second miss promotes', () => { expect(shouldPromoteStranded(2, 0)).toBe(true); });
  test('LONG #395: a thread already growing under the item promotes on the first miss', () => { expect(shouldPromoteStranded(1, 2)).toBe(true); expect(shouldPromoteStranded(1, 12)).toBe(true); });
  test('no miss yet → nothing', () => { expect(shouldPromoteStranded(0, 5)).toBe(false); });
});

import { describe, expect, test } from 'bun:test';
import { newbornHomeOk } from './autolit.js';

const born = new Set(['new1']);
describe('M418 newborn focus → its home, roots allowed among several topics', () => {
  test('a nested home existed before → ok (M316)', () => { expect(newbornHomeOk({ parentId: 'p', content: 'Board state' }, born, 'h1', 1)).toBe(true); });
  test('LONG #395: the home is a top-level topic among several → ok', () => { expect(newbornHomeOk({ parentId: null, content: 'Tic tac toe' }, born, 'h1', 6)).toBe(true); });
  test('the sole root (whole map) stays refused', () => { expect(newbornHomeOk({ parentId: null, content: 'Python tasks' }, born, 'h1', 1)).toBe(false); });
  test('to sort / untitled / born-now / removed homes stay refused', () => {
    expect(newbornHomeOk({ parentId: null, content: 'to sort — needs a home' }, born, 'h1', 5)).toBe(false);
    expect(newbornHomeOk({ parentId: null, content: 'untitled' }, born, 'h1', 5)).toBe(false);
    expect(newbornHomeOk({ parentId: null, content: 'Tic tac toe' }, born, 'new1', 5)).toBe(false);
    expect(newbornHomeOk({ status: 'removed', parentId: 'p', content: 'x' }, born, 'h1', 5)).toBe(false);
  });
});

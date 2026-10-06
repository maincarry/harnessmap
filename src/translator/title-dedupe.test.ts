import { describe, expect, test } from 'bun:test';
import { dedupeTitleAgainstSiblings, clipTitle } from './title-dedupe.js';

describe('M415 healer title vs live siblings', () => {
  test('no collision → the suggested title stands', () => {
    expect(dedupeTitleAgainstSiblings('Coffee and Toast', 'I usually have some coffee and toast for my breakfast.', ['Incorrect present form', 'Correct answer'])).toEqual({ title: 'Coffee and Toast', deduped: false });
  });
  test('LONG #394: the same title on a second sibling → that sibling opens with its own words', () => {
    const r = dedupeTitleAgainstSiblings('Coffee and Toast', 'I am used to have some coffee and toast for my breakfast.', ['Coffee and Toast']);
    expect(r).toEqual({ title: 'I am used to have some', deduped: true });
    const r2 = dedupeTitleAgainstSiblings('coffee and toast.', 'I am usually having some coffee and toast for my breakfast.', ['Coffee and Toast', 'I am used to have some']);
    expect(r2).toEqual({ title: 'I am usually having some coffee', deduped: true });
  });
  test('Chinese statement clips by characters, not words', () => {
    expect(clipTitle('第一个方案通过用户态TUN设备实现，无需内核模块。')).toBe('第一个方案通过用户态TUN设备实现');
    expect(dedupeTitleAgainstSiblings('TUN方案', '第一个方案通过用户态TUN设备实现，无需内核模块。', ['TUN方案']).title).toBe('第一个方案通过用户态TUN设备实现');
  });
  test('M415b (LONG #395 field case): the fallback starts after the words the colliding sibling shares', () => {
    const other = { title: 'Correct Sentence', content: 'Which sentence is grammatically correct: “When are you going to go out?”, “When going out are we?”, or “When do we go out?”' };
    const r = dedupeTitleAgainstSiblings('Correct Sentence', 'Which sentence is grammatically correct: “I am usually having some coffee and toast for my breakfast”, “I am used to have…”', [other]);
    expect(r).toEqual({ title: 'I am usually having some coffee', deduped: true });
    const zh = dedupeTitleAgainstSiblings('方案', '第一个方案通过用户态TUN设备实现，无需内核模块。', [{ title: '方案', content: '第一个方案通过内核模块实现。' }]);
    expect(zh.title).toBe('用户态TUN设备实现');
  });
  test('identical statement under the same parent → no title (not a third copy)', () => {
    expect(dedupeTitleAgainstSiblings('Coffee and Toast', 'I usually have some coffee and toast for my breakfast.', ['Coffee and Toast', 'I usually have some coffee and'])).toEqual({ title: null, deduped: true });
  });
});

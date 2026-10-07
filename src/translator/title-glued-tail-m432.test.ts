import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M432 (LONG #418 → PANEL #419): a run of letters the filer glued onto a real word is cut back to the word; inflections and real words stay. Real guard chain, stub store.
function run(title: string, content: string, userText = '') {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Improve render function', title: 'Improve render function', status: 'live', author: 'user', type: null, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'doing', author: 'user' };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText, assistantText: '' });
  return { title: out.find((a: any) => a.op === 'create_node')?.title as string, n: audits.filter((a) => a.kind === 'guard_title_glued_tail').length };
}
const STMT = 'Improve the `TitleAndDivider` React component by defining an interface for its `text` prop, explicitly returning `JSX.Element`, and keeping the component stable and maintainable.';

test('LONG #418: "componentaųtybq" is cut back to "component"', () => {
  const r = run('Improve title divider componentaųtybq', STMT, 'please improve this component');
  expect(r.title).toBe('Improve title divider component'); expect(r.n).toBe(1);
});
test('an ASCII tail with no vowel is cut too; an inflection or a real word the statement does not repeat is left alone', () => {
  expect(run('Improve title divider componentxkq', STMT).title).toBe('Improve title divider component');
  expect(run('Improve title divider components', STMT).title).toBe('Improve title divider components');          // "s": too short to be a slip
  expect(run('Refactor componentized divider', STMT).title).toBe('Refactor componentized divider');               // "ized": ASCII with vowels
  expect(run('Keep interfaces maintainable', STMT).title).toBe('Keep interfaces maintainable');                    // real words, no prefix cut
  expect(run('Stabilize Typography Props', 'Stabilize the Typography props of the component.').title).toBe('Stabilize Typography Props');
});
test('a word the person typed is never cut, even with a non-ASCII letter', () => {
  expect(run('Fix Müllerstraße routing', 'Fix the routing for the Müllerstraße address.', 'Müllerstraße is broken').title).toBe('Fix Müllerstraße routing');
});

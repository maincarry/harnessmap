import { test, expect } from 'bun:test';
import { Translator } from './translator';

// Runs synthetic alterations through the real guard pipeline (guardScope) with a stub store.
// Regression test for v0.9.154: title_tail's dangling-preposition step (M348c) must only act after the guard itself stripped a tail.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) {
    if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d });
    if (k === 'getSetting') return () => undefined;
    return () => undefined;
  } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'English grammar quiz', title: 'English grammar quiz', status: 'live', author: 'user', type: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const run = (title: string, content: string) => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'chosen', author: 'user', type: 'option' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    const got = out.find((a: any) => a.op === 'create_node');
    return { title: got?.title as string | undefined, tailAudits: audits.filter((a) => a.kind === 'guard_title_tail').length };
  };
  return run;
}

test('a quoted option that legitimately ends in a preposition is left alone (grammar-quiz #181)', () => {
  const r = harness()("Didn't have to", "You didn't have to do that, you know.");
  expect(r.title).toBe("Didn't have to");
  expect(r.tailAudits).toBe(0);
});

test('a dangling preposition after a stripped stray tail is still removed (the original M348c case)', () => {
  const r = harness()('Face classification task of ⟂', 'The face classification task uses a CNN.');
  expect(r.title).toBe('Face classification task');
  expect(r.tailAudits).toBe(1);
});

test('a plain title ending in a preposition with no stray tail is kept', () => {
  const r = harness()('Things to watch out for', 'A list of pitfalls when deploying.');
  expect(r.title).toBe('Things to watch out for');
  expect(r.tailAudits).toBe(0);
});

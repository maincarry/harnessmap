import { describe, expect, test } from 'bun:test';
import { shouldPromoteStranded } from './place.js';

describe('M416 stranded to-sort item → own top-level topic', () => {
  test('first miss on a lone item waits for the retry', () => { expect(shouldPromoteStranded(1, 0)).toBe(false); expect(shouldPromoteStranded(1, 1)).toBe(false); });
  test('second miss promotes', () => { expect(shouldPromoteStranded(2, 0)).toBe(true); });
  test('LONG #395: a thread already growing under the item promotes on the first miss', () => { expect(shouldPromoteStranded(1, 2)).toBe(true); expect(shouldPromoteStranded(1, 12)).toBe(true); });
  test('no miss yet → nothing', () => { expect(shouldPromoteStranded(0, 5)).toBe(false); });
});

import { Store } from '../store/db.js';
import { sameTitleSibling, foldAlterations } from './place.js';
describe('M445 a placed item beside a live sibling with the same title is folded into it', () => {
  const st = new Store(':memory:'); const pid = st.createProject('t');
  st.createNode({ id: 'home', projectId: pid, parentId: null, content: 'Improve the function that increments the current step.', type: 'task', status: 'live', author: 'user', title: 'Improve currStep function' } as any);
  st.createNode({ id: 'r1', projectId: pid, parentId: 'home', content: 'The render function improvement', type: null, status: 'provisional', author: 'user', title: 'Render function' } as any);
  st.createNode({ id: 'r1k', projectId: pid, parentId: 'r1', content: 'The render function must return consistently.', type: 'claim', status: 'noted', author: 'agent', title: 'Consistent return' } as any);
  st.createNode({ id: 'r2', projectId: pid, parentId: 'home', content: 'The render function does not work properly after the rewrite.', type: null, status: 'provisional', author: 'user', title: 'Render Function' } as any);
  st.createNode({ id: 'r2k', projectId: pid, parentId: 'r2', content: 'The specific error is still unknown.', type: 'question', status: 'open', author: 'user', title: 'Rendering problem' } as any);
  st.createNode({ id: 'other', projectId: pid, parentId: 'home', content: 'Use pre-increment.', type: 'option', status: 'floated', author: 'agent', title: 'Use pre-increment' } as any);
  test('finds the namesake, not another sibling', () => { expect(sameTitleSibling(st, 'home', 'r2')?.id).toBe('r1'); expect(sameTitleSibling(st, 'home', 'other')).toBeNull(); });
  test('fold moves the children, carries the newer statement, removes the newcomer', () => {
    const alts = foldAlterations(st, 'r2', 'r1');
    expect(alts).toEqual([{ op: 'move_node', id: 'r2k', parentId: 'r1' }, { op: 'update_node', id: 'r1', content: 'The render function does not work properly after the rewrite.' }, { op: 'update_node', id: 'r2', status: 'removed' }]);
    st.applyAlterations(pid, alts, { kind: 'system' } as any);
    expect(st.getNode('r2k')?.parentId).toBe('r1'); expect(st.getNode('r2')?.status).toBe('removed'); expect(st.getNode('r1')?.content).toMatch(/does not work properly/);
  });
  test('a fragment statement is not carried over', () => {
    st.createNode({ id: 'r3', projectId: pid, parentId: 'home', content: 'The render function does not work properly; this topic', type: null, status: 'provisional', author: 'user', title: 'render function' } as any);
    const alts = foldAlterations(st, 'r3', 'r1');
    expect(alts.some((a) => a.op === 'update_node' && a.id === 'r1')).toBe(false);
  });
});

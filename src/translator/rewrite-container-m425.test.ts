import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M425: a rewrite of a node that already holds a thread, sharing under a third of its words, is the next episode → a child; a correction that keeps most words still updates in place.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[]) => ({ out: (t as any).guardScope(alts, new Set(nodes.map((n) => n.id)), map, { chatId: 'c', focusContainerId: 'g1', userText: 'connect four instead?', assistantText: '' }) as any[], audits });
}
const at = '2026-10-07T00:00:00Z';
const root = { id: 'p1', parentId: null, content: 'Games with the assistant', title: 'Games', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
const game = { id: 'g1', parentId: 'p1', content: 'Play another game of tic-tac-toe on a 3x4 board with positions 1 through 12.', title: '3x4 tic-tac-toe board', status: 'provisional', author: 'user', type: null, createdAt: at, updatedAt: at };
const m1 = { id: 'm1', parentId: 'g1', content: 'The user placed X in position 6 during the new 3x4 tic-tac-toe game.', title: 'X at position 6', status: 'noted', author: 'user', type: 'evidence', createdAt: at, updatedAt: at };
const m2 = { id: 'm2', parentId: 'g1', content: 'X won the 3x4 tic-tac-toe game with a horizontal row in positions 6, 7, and 8.', title: 'X wins horizontally', status: 'noted', author: 'agent', type: 'evidence', createdAt: at, updatedAt: at };

test('LONG #407: the finished 3x4 game container is not overwritten into Connect Four — the new game becomes a child', () => {
  const r = harness([root, game, m1, m2])([{ op: 'update_node', id: 'g1', content: 'Play Connect Four on an empty 6-row by 7-column board.', status: 'live', title: 'Connect Four game' }]);
  expect(r.out.some((a) => a.op === 'update_node' && a.id === 'g1')).toBe(false);
  const child = r.out.find((a) => a.op === 'create_node' && a.parentId === 'g1');
  expect(child?.content).toContain('Connect Four'); expect(child?.title).toBe('Connect Four game');
  expect(r.audits.filter((a) => a.kind === 'guard_rewrite_to_child').length).toBe(1);
});
test('a state update that keeps most of the words still updates the container in place', () => {
  const r = harness([root, game, m1, m2])([{ op: 'update_node', id: 'g1', content: 'Play another game of tic-tac-toe on a 3x4 board with positions 1 through 12; X has 6 and 7, O has 1 and 11.', status: 'live' }]);
  expect(r.out.some((a) => a.op === 'update_node' && a.id === 'g1')).toBe(true);
  expect(r.audits.filter((a) => a.kind === 'guard_rewrite_to_child').length).toBe(0);
});
test('a childless leaf keeps the old zero-overlap rule: a low-overlap rewrite of a leaf still updates in place', () => {
  const leaf = { ...game, id: 'l1' };
  const r = harness([root, leaf])([{ op: 'update_node', id: 'l1', content: 'Play Connect Four on an empty 6-row by 7-column board.', status: 'live' }]);
  expect(r.out.some((a) => a.op === 'update_node' && a.id === 'l1')).toBe(true);
});

import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M431 (TWIN LONG #417, Elena): the outline's section rows outlived the person's own "merge" and "cut" turns. The guard reads the
// person's turn, matches a live row by its exact title, and retires it (dropped) or moves it under the merge target.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[], userText: string) => ({ out: (t as any).guardUserRetires(alts, map, { userText }) as any[], audits });
}
const at = '2026-10-07T11:12:55Z';
const N = (id: string, parentId: string | null, title: string, status = 'live') => ({ id, parentId, content: title, title, status, author: 'user', type: null, createdAt: at, updatedAt: at });
const nodes = [
  N('root', null, 'Four-day week briefing'),
  N('out', 'root', 'Briefing outline'),
  N('s1', 'out', 'Summary'), N('s3', 'out', 'Output results'), N('s4', 'out', 'Wellbeing and retention'), N('s5', 'out', 'Where it did not work'), N('s6', 'out', 'Caveats'),
];

test('M431: "Cut “Where it did not work” from the briefing" retires the live row with that title (dropped), and only that row', () => {
  const r = harness(nodes)([{ op: 'create_node', id: 'n1', parentId: 'out', content: 'The standalone section was cut because its only support is an opinion piece.', status: 'noted', author: 'user' }],
    'Cut “Where it did not work” from the briefing. The only evidence for it is Source 6, which is an opinion piece rather than a study. Keep a note that we cut it and why.');
  const upd = r.out.filter((a) => a.op === 'update_node');
  expect(upd.length).toBe(1);
  expect(upd[0]).toMatchObject({ id: 's5', status: 'dropped' });
  expect(r.audits.filter((a) => a.kind === 'guard_user_retires').map((a) => a.d.how)).toEqual(['cut-quoted']);
});

test('M431: "Merge section 4, Wellbeing and retention, into section 3, Output results" moves the row under the target instead of retiring it', () => {
  const r = harness(nodes)([], 'Merge section 4, Wellbeing and retention, into section 3, Output results—the client mainly cares about output, so wellbeing only needs a paragraph there. The working outline should now have six sections.');
  const mv = r.out.filter((a) => a.op === 'move_node');
  expect(mv).toEqual([{ op: 'move_node', id: 's4', parentId: 's3' }]);
  expect(r.out.some((a) => a.op === 'update_node')).toBe(false);
});

test('M431: no exact title → nothing; a root is never retired; a row the filer already touched this round is left to the filer', () => {
  const h = harness(nodes);
  expect(h([], 'cut the runtime by half and remove the “debug flag”').out).toEqual([]);                          // no row titled "debug flag"
  expect(h([], 'Delete “Four-day week briefing” entirely').out).toEqual([]);                                     // the root is out of reach
  const r = h([{ op: 'update_node', id: 's5', status: 'parked' }], 'Cut “Where it did not work” from the briefing.');
  expect(r.out).toEqual([{ op: 'update_node', id: 's5', status: 'parked' }]);                                    // the filer's own write wins
});

test('M431: a content/title rewrite by the filer in the same round does not block the merge-move or the retire; a status it set does', () => {
  const h = harness(nodes);
  const r1 = h([{ op: 'update_node', id: 's4', content: 'Section 3 will include a supporting paragraph on wellbeing and retention.', title: 'Wellbeing paragraph' }], 'Merge section 4, Wellbeing and retention, into section 3, Output results. The outline now has six sections.');
  expect(r1.out.filter((a) => a.op === 'move_node')).toEqual([{ op: 'move_node', id: 's4', parentId: 's3' }]);
  const r2 = h([{ op: 'update_node', id: 's5', content: 'This section is cut.' }], 'Cut “Where it did not work” from the briefing.');
  expect(r2.out.filter((a) => a.op === 'update_node' && a.status === 'dropped').length).toBe(1);
  const r3 = h([{ op: 'update_node', id: 's5', status: 'parked' }], 'Cut “Where it did not work” from the briefing.');
  expect(r3.out.filter((a) => a.status === 'dropped').length).toBe(0);
});

test('M431: the Chinese form 删除“X” retires the row too', () => {
  const r = harness([N('root', null, '报告'), N('o', 'root', '大纲'), N('a', 'o', '背景介绍'), N('b', 'o', '方法')])([], '删除“背景介绍”这一节，理由记一下：没有数据支持。');
  expect(r.out).toEqual([{ op: 'update_node', id: 'a', status: 'dropped' }]);
});

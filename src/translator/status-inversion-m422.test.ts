import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M422 (PANEL #405): two status inversions the twenty personas read off the real 84-turn map. Real guard chain, stub store.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[]) => ({ out: (t as any).guardScope(alts, new Set(nodes.map((n) => n.id)), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' }) as any[], audits });
}
const at = '2026-10-06T00:00:00Z';
const root = { id: 'p1', parentId: null, content: 'Write and print numbers ordered ascending', title: 'Random numbers script', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
const code = { id: 'c1', parentId: 'p1', content: 'The Python script sorts the numbers before printing.', title: 'Sorted print', status: 'proposed', author: 'agent', type: null, createdAt: at, updatedAt: at };

test('M422a: an objection filed as accepted becomes noted ("Same code again [accepted]")', () => {
  const r = harness([root, code])([
    { op: 'create_node', id: 'o1', parentId: 'p1', content: 'The provided Python code was the same as before rather than meaningfully updated.', status: 'accepted', author: 'user', type: 'claim', title: 'Same code again' },
    { op: 'create_link', id: 'l1', type: 'objection-to', fromItemId: 'o1', toId: 'c1' },
  ]);
  const o = r.out.find((a) => a.op === 'create_node' && a.id === 'o1');
  expect(o.status).toBe('noted');
  expect(r.audits.filter((a) => a.kind === 'guard_objection_status').length).toBe(1);
});
test('M422a: an objection filed open stays open; an existing accepted node that becomes an objection source is re-noted', () => {
  const r = harness([root, code])([
    { op: 'create_node', id: 'o2', parentId: 'p1', content: 'The output is still unsorted on the second run.', status: 'open', author: 'user', type: 'question' },
    { op: 'create_link', id: 'l2', type: 'objection-to', fromItemId: 'o2', toId: 'c1' },
  ]);
  expect(r.out.find((a) => a.id === 'o2').status).toBe('open');
  const acc = { ...code, id: 'c2', status: 'accepted', content: 'The first draft prints the numbers unsorted.' };
  const r2 = harness([root, code, acc])([{ op: 'create_link', id: 'l3', type: 'objection-to', fromItemId: 'c2', toId: 'c1' }]);
  const upd = r2.out.find((a) => a.op === 'update_node' && a.id === 'c2');
  expect(upd?.status).toBe('noted');
});
test('M422b: a retracting update that negates the claim keeps the claim and files the correction beside it ("API Docs Unavailable [retracted]")', () => {
  const cite = { id: 'd1', parentId: 'p1', content: 'Quizizz API documentation is available at https://developers.quizizz.com/.', title: 'Quizizz API docs', status: 'cited', author: 'agent', type: 'evidence', createdAt: at, updatedAt: at };
  const r = harness([root, cite])([{ op: 'update_node', id: 'd1', content: "Quizizz's public API documentation URL at https://developers.quizizz.com/ is no longer working, and the documentation is no longer available.", status: 'retracted', author: 'agent' }]);
  const upd = r.out.find((a) => a.op === 'update_node' && a.id === 'd1');
  expect(upd.status).toBe('retracted'); expect(upd.content).toBeUndefined();
  const sib = r.out.find((a) => a.op === 'create_node' && a.parentId === 'p1');
  expect(sib?.content).toContain('no longer working'); expect(sib?.status).toBe('noted');
  expect(r.out.some((a) => a.op === 'create_link' && a.type === 'objection-to' && a.fromItemId === sib.id && a.toId === 'd1')).toBe(true);
  expect(r.audits.filter((a) => a.kind === 'guard_retract_keeps_claim').length).toBe(1);
});
test('M422b: a plain retraction, or a reworded one without a negation, is left alone', () => {
  const cite = { id: 'd2', parentId: 'p1', content: 'The library supports streaming responses.', title: 'Streaming support', status: 'cited', author: 'agent', type: 'evidence', createdAt: at, updatedAt: at };
  const r = harness([root, cite])([{ op: 'update_node', id: 'd2', status: 'retracted' }]);
  expect(r.out.find((a) => a.id === 'd2').status).toBe('retracted'); expect(r.out.length).toBe(1);
  const r2 = harness([root, cite])([{ op: 'update_node', id: 'd2', content: 'The library supports streaming responses (claimed by the agent, unverified).', status: 'retracted' }]);
  expect(r2.out.length).toBe(1); expect(r2.out[0].content).toContain('unverified');
});

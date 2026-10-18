import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

// 2026-10-18 (Hannah's chats day refiled on v0.9.305): a decision she reversed in the next turn lost its words — the filer's update
// rewrote the node to the new instruction and marked it reversed. A reversal keeps the words it reversed. Real guard chain, stub store.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[]) => ({ out: (t as any).guardScope(alts, new Set(nodes.map((n) => n.id)), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' }) as any[], audits });
}
const at = '2026-10-18T08:07:15Z';
const root = { id: 'p1', parentId: null, content: 'Studio profile section', title: 'Studio profile section', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
const hold = { id: 's1', parentId: 'p1', content: "Don't wire up saving yet.", title: 'Saving on hold', status: 'decided', author: 'user', type: 'decision', createdAt: at, updatedAt: at };
const noSwitch = { id: 'k1', parentId: 'p1', content: "Don't switch the search endpoint yet.", title: 'Endpoint stays', status: 'active', author: 'user', type: 'constraint', createdAt: at, updatedAt: at };

test('"Wire up saving now" reversing "Don\'t wire up saving yet" keeps her first sentence and files the second beside it', () => {
  const r = harness([root, hold])([{ op: 'update_node', id: 's1', content: 'Wire up Studio profile saving now using the existing Settings patterns.', title: 'Studio profile saving rule', status: 'reversed', author: 'user' }]);
  const upd = r.out.find((a) => a.op === 'update_node' && a.id === 's1');
  expect(upd.status).toBe('reversed');
  expect(upd.content).toBeUndefined(); // the old words stay on the old node
  expect(upd.title).toBeUndefined();
  const fresh = r.out.find((a) => a.op === 'create_node' && /Wire up Studio profile saving now/.test(a.content));
  expect(fresh).toBeTruthy();
  expect(fresh.author).toBe('user'); expect(fresh.type).toBe('decision'); expect(fresh.parentId).toBe('p1'); expect(fresh.status).toBe('noted');
  expect(r.out.some((a) => a.op === 'create_link' && a.type === 'objection-to' && a.fromItemId === fresh.id && a.toId === 's1')).toBe(true);
  expect(r.audits.filter((a) => a.kind === 'guard_reversal_keeps_words').map((a) => a.d.status)).toEqual(['reversed']);
});

test('a constraint lifted by its opposite ("Endpoint switched…") keeps the constraint\'s words too', () => {
  const r = harness([root, noSwitch])([{ op: 'update_node', id: 'k1', content: 'The search endpoint is switched to full-text search.', status: 'lifted' }]);
  expect(r.out.find((a) => a.id === 'k1').content).toBeUndefined();
  const fresh = r.out.find((a) => a.op === 'create_node' && /switched to full-text/.test(a.content));
  expect(fresh.type).toBe('constraint'); expect(fresh.author).toBe('user');
});

test('a reworded hold with the same polarity, or a bare status change, is still an edit — nothing is split', () => {
  const same = harness([root, hold])([{ op: 'update_node', id: 's1', content: "Don't wire up saving until validation lands.", status: 'reversed' }]);
  expect(same.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  expect(same.out.find((a) => a.id === 's1').content).toBe("Don't wire up saving until validation lands.");
  const bare = harness([root, hold])([{ op: 'update_node', id: 's1', status: 'reversed' }]);
  expect(bare.out).toHaveLength(1);
  expect(bare.audits.filter((a) => a.kind === 'guard_reversal_keeps_words')).toHaveLength(0);
});

test('the retracted shape of (b) is untouched by (c): a cited claim retracted by its negation still files the correction beside it once', () => {
  const claim = { id: 'c1', parentId: 'p1', content: 'The docs are at developers.example.com.', title: 'Docs URL', status: 'noted', author: 'agent', type: 'claim', createdAt: at, updatedAt: at };
  const r = harness([root, claim])([{ op: 'update_node', id: 'c1', content: 'The docs URL no longer works.', status: 'retracted' }]);
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(1);
  expect(r.audits.map((a) => a.kind)).toEqual(['guard_retract_keeps_claim']);
});

import { test, expect } from 'bun:test';
import { Translator, REJECTS_ZH } from './translator';

// M456 (LONG #436, Chinese): the person objects, the agent retracts — the catch is the person's.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => []; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
test('a retraction filed in the objection round is the person\'s; the agent\'s replacement example stays the agent\'s', () => {
  const { t, audits } = harness();
  const out = t.guardCorrectionAuthor([
    { op: 'update_node', id: 'x1', author: 'agent', type: 'claim', status: 'retracted', content: '跨表索引示例有误：orders 表没有 email 列，不能直接在该列上查询，需要使用 JOIN 联接。' },
    { op: 'create_node', id: 'e1', author: 'agent', type: 'evidence', status: 'noted', content: '示例：SELECT … FROM orders JOIN users ON … WHERE (info->>\'$.email\') = …' },
  ], { userText: '有问题，orders表都没有email这一列，虽然有索引，但怎么查询呢' });
  expect(out[0].author).toBe('user'); expect(out[1].author).toBe('agent');
  expect(audits.map((a) => a.kind)).toEqual(['guard_correction_author']);
  expect(t.guardCorrectionAuthor([{ op: 'create_node', id: 'y', author: 'agent', type: 'claim', status: 'retracted', content: 'The earlier claim was wrong.' }], { userText: 'thanks, looks good' })).toHaveLength(1);
  expect(REJECTS_ZH.test('还是不行，报同样的错')).toBe(true);
  expect(REJECTS_ZH.test('怎么确认使用的编译器和链接器版本')).toBe(false);
});

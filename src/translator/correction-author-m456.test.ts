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

// M496 (krauss-model): in an objecting round, the fresh correction node that the retract-keeps-claim split files beside the
// agent's retracted claim (the source of the objection-to link) is the person's — even when its words echo the agent's apology.
test('the correction node beside a retracted claim is the person\'s in an objecting round; untouched in a plain round', () => {
  const { t, audits } = harness();
  const rows = () => ([
    { op: 'update_node', id: 'claim1', status: 'retracted' },
    { op: 'create_node', id: 'corr1', parentId: 'p', author: 'agent', status: 'noted', content: 'The Krauss model does not represent the road as a series of occupied or empty cells; it is space-continuous.' },
    { op: 'create_link', id: 'l1', type: 'objection-to', fromItemId: 'corr1', toId: 'claim1' },
  ]);
  const out = t.guardCorrectionAuthor(rows(), { userText: 'actually that is wrong the krauss model is a microscopic, space-continuous car-following model which is based on safe speed' });
  expect(out[1].author).toBe('user');
  expect(audits.some((a) => a.kind === 'guard_correction_author' && a.d.how === 'objection-source')).toBe(true);
  const { t: t2 } = harness();
  const plain = t2.guardCorrectionAuthor(rows(), { userText: 'thanks, can you show me the ode that defines the krauss model' });
  expect(plain[1].author).toBe('agent');
});

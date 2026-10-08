import { test, expect } from 'bun:test';
import { Translator, REJECTS, objects } from './translator';

// M453 (PANEL #432): a delivery the person rejects the next turn is reopened.
function harness(roundTimes: number[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => roundTimes; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const iso = (ms: number) => new Date(ms).toISOString();
test('the task M439 closed last round goes back to doing on "does not follow the guidelines"; an old done task stays', () => {
  const now = Date.now(); const { t, audits } = harness([now - 300_000, now - 90_000, now - 40_000]);
  const map = { nodes: [
    { id: 'd1', parentId: 'p', title: 'Revise function code', content: 'Revise and update the TitleAndDivider function so its implementation follows the provided documentation guidelines.', status: 'done', author: 'user', type: 'task', createdAt: iso(now - 38_000), updatedAt: iso(now - 38_000) },
    { id: 'd0', parentId: 'p', title: 'Rewrite currStep', content: 'Rewrite the currStep state update using an explicit callback.', status: 'done', author: 'user', type: 'task', createdAt: iso(now - 900_000), updatedAt: iso(now - 900_000) },
  ] };
  const out = t.guardDeliveryRejected([], map, { userText: "the function you sent me does not follow the guidelines from the documentation i've provided. please revise and update the code" });
  expect(out).toEqual([{ op: 'update_node', id: 'd1', status: 'doing' }]);
  expect(audits.map((a) => a.kind)).toEqual(['guard_delivery_rejected']);
  expect(t.guardDeliveryRejected([], map, { userText: 'now learn this documentation https://eslint.org/docs/rules/consistent-return' })).toEqual([]);
  // M453b: the filer re-asserting done in the rejection round does not shield the row
  const re = t.guardDeliveryRejected([{ op: 'update_node', id: 'd1', content: 'The function was revised to memoize the props.', status: 'done' }], map, { userText: 'the function you sent me does not follow the guidelines. please revise and update the code' });
  expect(re.length).toBe(1); expect(re[0].status).toBe('doing');
  expect(REJECTS.test('please check again,the function does not work properly')).toBe(true);
  expect(REJECTS.test('Thanks, that works. Can we remove the two unused seats going forward?')).toBe(false);
});

// M453d (TWIN #445 proof, Elena): a quoted section title or a noun clause is not an objection.
test('M453d: "cut the section “Where it did not work”" reopens nothing; a real objection still does', () => {
  const now = Date.now(); const { t, audits } = harness([now - 300_000, now - 90_000, now - 40_000]);
  const map = { nodes: [
    { id: 'd1', parentId: 'p', title: 'Draft trial measures', content: 'Draft Section 2, “What the trials measured,” in about 300 words.', status: 'done', author: 'user', type: 'task', createdAt: iso(now - 38_000), updatedAt: iso(now - 38_000) },
  ] };
  expect(t.guardDeliveryRejected([], map, { userText: 'Back to the report: cut the section “Where it did not work.” The only evidence for it is Source 6, which is an opinion piece rather than a study, so it does not justify a standalone section. Keep a note that the section was cut for that reason.' })).toEqual([]);
  expect(t.guardDeliveryRejected([], map, { userText: 'Give me a first outline for the briefing: 1 Summary, 2 What the trials measured, 3 Output results, 4 Wellbeing and retention, 5 Where it did not work, 6 Caveats, 7 Recommendation.' })).toEqual([]);
  expect(audits).toEqual([]);
  expect(t.guardDeliveryRejected([], map, { userText: 'The section 2 draft did not work for me — it attributes the 40% figure to the UK pilot. Fix it.' })).toEqual([{ op: 'update_node', id: 'd1', status: 'doing' }]);
  expect(objects('“Where it did not work” is cut, not current.')).toBe(false);
  expect(objects('I tried your snippet and it did not work.')).toBe(true);
  expect(objects('有问题，orders表都没有email这一列')).toBe(true);
});

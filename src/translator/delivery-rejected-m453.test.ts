import { test, expect } from 'bun:test';
import { Translator, REJECTS } from './translator';

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
  expect(REJECTS.test('please check again,the function does not work properly')).toBe(true);
  expect(REJECTS.test('Thanks, that works. Can we remove the two unused seats going forward?')).toBe(false);
});

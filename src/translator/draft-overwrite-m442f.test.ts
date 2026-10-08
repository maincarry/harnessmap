import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const times = [Date.parse('2026-10-08T20:31:00Z'), Date.parse('2026-10-08T20:32:00Z'), Date.parse('2026-10-08T20:33:19Z'), Date.parse('2026-10-08T20:34:16Z'), Date.parse('2026-10-08T20:35:00Z')];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => times; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const cell = { id: 'cell', parentId: 'wrap', title: 'Tomorrow report update cell saved', content: 'The saved notebook includes a top-level markdown cell titled “Tomorrow’s report” with the verified annual-plan churn, leakage-free AUC, and feature-exclusion findings. No notebook cells were rerun.', status: 'done', author: 'agent', type: 'task', createdAt: '2026-10-08T20:30:00Z', updatedAt: '2026-10-08T20:32:00Z' };
const map: any = { nodes: [{ id: 'wrap', parentId: null, title: 'Wrap-up', content: 'Wrap-up', status: 'live', author: 'user', type: null, createdAt: '2026-10-08T20:30:00Z', updatedAt: '2026-10-08T20:30:00Z' }, cell], links: [] };
const reply = 'Annual-plan churn is 14.72% (2,668 of 18,128 customers), and our final leakage-free gradient-boosted model achieved a holdout ROC AUC of 0.79. We excluded support_tickets_90d because it can include post-churn activity, which would otherwise inflate the result.';
const pasted = 'The Tomorrow’s report update states: “Annual-plan churn is 14.72% (2,668 of 18,128 customers), and our final leakage-free gradient-boosted model achieved a holdout ROC AUC of 0.79. We excluded support_tickets_90d because it can include post-churn activity.”';

test('M442f: the PM update pasted over the saved-cell row becomes its own draft row; the cell row is untouched', () => {
  const { t, audits } = mk();
  const out = t.guardDraftOverwrite([{ op: 'update_node', id: 'cell', content: pasted, status: 'done' }], map, { userText: 'Draft a two-sentence update I can send the product manager tomorrow with the annual-plan churn result, the final model AUC, and the leakage caveat.', assistantText: reply });
  expect(out.find((a: any) => a.id === 'cell')).toBeUndefined();
  const made = out.find((a: any) => a.op === 'create_node');
  expect(made).toMatchObject({ parentId: 'wrap', author: 'user', type: 'task', status: 'done', title: 'Two-sentence update' });
  expect(audits.map((a) => a.kind)).toEqual(['guard_draft_overwrite']);
});

test('M442f: an update of a row born in this drafting stretch (the draft itself) is left alone; a non-drafting turn is left alone', () => {
  const { t } = mk();
  const m2: any = { nodes: [...map.nodes, { id: 'd', parentId: 'wrap', title: 'Two-sentence update', content: pasted, status: 'done', author: 'user', type: 'task', createdAt: '2026-10-08T20:33:19Z', updatedAt: '2026-10-08T20:33:19Z' }], links: [] };
  const out = t.guardDraftOverwrite([{ op: 'update_node', id: 'd', content: pasted + ' Subject: Annual-plan churn and final model result.', status: 'done' }], m2, { userText: 'Give me a short subject line for that product-manager update, then repeat the final two sentences as plain text.', assistantText: 'Subject: Annual-plan churn and final model result. ' + reply });
  expect(out[0].id).toBe('d');
  expect(t.guardDraftOverwrite([{ op: 'update_node', id: 'cell', content: pasted, status: 'done' }], map, { userText: 'Confirm the notebook is saved.', assistantText: reply }).length).toBe(1);
});

test('M451f: "an update I can send the product manager tomorrow" mints her send todo once', () => {
  const { t, audits } = mk();
  const alts = [{ op: 'create_node', id: 'draft1', parentId: 'wrap', title: 'Two-sentence update', content: pasted, status: 'done', author: 'user', type: 'task' }];
  const out = t.guardSendLater(alts, map, { userText: 'Draft a two-sentence update I can send the product manager tomorrow with the annual-plan churn result, the final model AUC, and the leakage caveat.' });
  const todo = out.find((a: any) => a.status === 'todo');
  expect(todo).toMatchObject({ op: 'create_node', author: 'user', type: 'task', title: 'Send the two-sentence update to the product manager' });
  expect(todo.content).toContain('tomorrow');
  expect(audits.map((a) => a.kind)).toEqual(['guard_send_later']);
  const m2: any = { nodes: [...map.nodes, { ...todo, createdAt: '2026-10-08T20:35:10Z', updatedAt: '2026-10-08T20:35:10Z' }], links: [] };
  expect(t.guardSendLater([], m2, { userText: 'Make that product-manager update a little less technical, but keep the numbers; I will send it to the product manager tomorrow.' })).toEqual([]);
});

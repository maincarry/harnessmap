import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const times = [Date.parse('2026-10-08T16:08:00Z'), Date.parse('2026-10-08T16:09:00Z')];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => times; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const at = '2026-10-08T16:08:32Z';
const draft = { id: 'd1', parentId: 'p', title: 'Draft measures section', content: 'Draft section 2, “What the trials measured,” in about 300 words, citing Sources 1–4 by name.', status: 'done', author: 'user', type: 'task', createdAt: at, updatedAt: at };
const map: any = { nodes: [{ id: 'p', parentId: null, title: 'Briefing', content: 'Briefing', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at }, draft], links: [], projectId: 'proj' };

test('M439g: a re-draft turn that sets the existing draft row back to doing closes it when the reply carries the text', () => {
  const { t, audits } = mk();
  const out = t.guardTaskDelivered([{ op: 'update_node', id: 'd1', status: 'doing', type: 'task', title: 'Draft caveats section', content: 'Draft Section 4, “Caveats,” in about 250 words, leading with Campbell.' }],
    { userText: 'Draft section 4, “Caveats,” in about 250 words. Lead with Campbell’s 2023 finding that most trials involve self-selected firms.', assistantText: 'I’ll draft the Caveats section in roughly 250 words, leading with Campbell’s methodological limitations and describing outcomes in shift-based roles as untested rather than negative.' }, map);
  expect(out[0].status).toBe('done');
  expect(audits.map((a) => a.kind + ':' + a.d.how)).toEqual(['guard_task_delivered:update']);
});

test('M439g: an update that reopens a DATED promise, or a row that is not the person\'s task, is left alone', () => {
  const { t } = mk();
  const m2: any = { nodes: [...map.nodes, { ...draft, id: 'd2', title: 'Confirm downgrade', content: 'Confirm the seat change by Friday.' }, { ...draft, id: 'd3', author: 'agent' }], links: [] };
  const out = t.guardTaskDelivered([{ op: 'update_node', id: 'd2', status: 'todo' }, { op: 'update_node', id: 'd3', status: 'doing' }],
    { userText: 'Draft the reply and confirm by Friday.', assistantText: 'Here is the updated reply:\n```\nHi — the change is scheduled.\n```' }, m2);
  expect(out.map((a: any) => a.status)).toEqual(['todo', 'doing']);
});

test('M453e: an objection the reply answers in the same turn ("Corrected: …") does not reopen the delivered draft', () => {
  const { t, audits } = mk();
  const out = t.guardDeliveryRejected([], map, { userText: 'The draft attributes the 40% figure to the UK pilot. That is wrong: 40% is Microsoft Japan’s increase in sales per employee; the UK pilot reported 1.4% revenue.',
    assistantText: 'Corrected: Microsoft Japan reported a 40% increase in sales per employee, while the Autonomy UK pilot reported a 1.4% increase in average revenue. I’ve also noted the earlier attribution mix-up.' });
  expect(out).toEqual([]);
  expect(audits.map((a) => a.kind)).toEqual(['guard_delivery_rejected_fixed']);
});

test('M453e: an objection the reply only acknowledges still reopens the draft (M453 unchanged)', () => {
  const { t, audits } = mk();
  const out = t.guardDeliveryRejected([], map, { userText: 'The draft attributes the 40% figure to the UK pilot. That is wrong.', assistantText: 'You are right — I will fix the attribution in the next pass. Which wording do you prefer for the UK figure?' });
  expect(out).toEqual([{ op: 'update_node', id: 'd1', status: 'doing' }]);
  expect(audits.map((a) => a.kind)).toEqual(['guard_delivery_rejected']);
});

test('M439h: a reply that opens with a past-tense action verb ("Built a … pipeline") is a delivery; "Built nothing yet" is not', () => {
  const { t } = mk();
  const task = { op: 'create_node', id: 'bl', parentId: 'p', title: 'Baseline churn model', content: 'Build a baseline churn model using churned as the target and all currently available predictors.', status: 'doing', author: 'user', type: 'task' };
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'Let\'s start a baseline model. Use churned as the target, make a stratified 80/20 split with a fixed seed, and build a preprocessing pipeline.', assistantText: 'Built a preprocessing and logistic-regression pipeline using a stratified 80/20 split with random_state=42. Test ROC AUC is 0.91; the top coefficients are tenure and plan.' }, map)[0].status).toBe('done');
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'Build the baseline model.', assistantText: 'Built nothing yet — which target column should I use, churned or churn_flag?' }, map)[0].status).toBe('doing');
});

test('M439i: a done row filed with the same title as the person\'s live doing task closes that task', () => {
  const { t, audits } = mk();
  const m2: any = { nodes: [...map.nodes, { id: 'run', parentId: 'p', title: 'Run reorganized notebook', content: 'Restart the kernel and run the reorganized notebook from top to bottom.', status: 'doing', author: 'user', type: 'task', createdAt: at, updatedAt: at }], links: [] };
  const out = t.guardTaskDelivered([{ op: 'create_node', id: 'twin', parentId: 'run', title: 'Run reorganized notebook', content: 'The notebook completed without further errors.', status: 'done', author: 'agent', type: 'task' }], { userText: 'Fix the cell and continue running.', assistantText: 'Updated the cell and resumed execution. The notebook completed without further errors.' }, m2);
  expect(out.find((a: any) => a.id === 'run')).toMatchObject({ op: 'update_node', status: 'done' });
  expect(audits.map((a) => a.d.how)).toContain('done-twin');
});

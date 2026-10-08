import { test, expect } from 'bun:test';
import { Translator } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const todo = { op: 'create_node', id: 'b1', parentId: 'p', title: 'Final file bundle', content: 'Keep the saved analysis notebook together with the final figure files churn_by_tenure.png and feature_importance.png.', status: 'todo', author: 'user', type: 'task' };

test('M465: in a confirm/list turn, a todo made of the agent\'s own sentence is the agent\'s proposal', () => {
  const { t, audits } = mk();
  const out = t.guardAgentImperative([{ ...todo }], { userText: 'Before I finish, confirm the notebook is saved with the new “Tomorrow’s report” cell and list the notebook plus the two figure files I should keep.', assistantText: 'Confirmed the notebook is saved with the “Tomorrow’s report” cell. Keep the analysis notebook together with churn_by_tenure.png and feature_importance.png as the final bundle; all three are in the project folder.' });
  expect(out[0]).toMatchObject({ author: 'agent', status: 'proposed' });
  expect(audits.map((a) => a.kind)).toEqual(['guard_agent_imperative']);
});

test('M465: a turn that asks for work, or a todo in the person\'s own words, is left alone', () => {
  const { t } = mk();
  expect(t.guardAgentImperative([{ ...todo }], { userText: 'Save the notebook and keep it together with the two figures in one folder.', assistantText: 'Keep the analysis notebook together with churn_by_tenure.png and feature_importance.png.' })[0].author).toBe('user');
  expect(t.guardAgentImperative([{ ...todo, content: 'Email the product manager the annual churn number tomorrow morning.' }], { userText: 'Confirm the notebook is saved and list the files.', assistantText: 'Confirmed. Keep the analysis notebook together with the figures.' })[0].author).toBe('user');
});

import { test, expect } from 'bun:test';
import { Translator, LEARN_REQUEST, SESSION_CLOSING } from './translator';

// PANEL #429 (the 13 on the LONG #428 map): the agent's own questions stayed [open] after the person answered them the next turn
// (11 of 13 quoted the line); "learn this documentation" stayed [todo] after the agent's summary (10 of 13); the closing turn was
// answered as current work (4 of 13).
function harness(roundTimes: number[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => roundTimes; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const iso = (ms: number) => new Date(ms).toISOString();
test('M447: the agent\'s question of the previous round is answered by the next short reply; an older or user question is not', () => {
  const now = Date.now(); const { t, audits } = harness([now - 300_000, now - 120_000, now - 40_000]);
  const map = { nodes: [
    { id: 'q1', parentId: 'g', title: 'Winning positions', content: 'Which positions did the user choose to make a row of three Xs?', status: 'open', author: 'agent', type: 'question', createdAt: iso(now - 35_000) },
    { id: 'q0', parentId: 'g', title: 'Choose first move', content: 'Who should make the first move?', status: 'open', author: 'agent', type: 'question', createdAt: iso(now - 600_000) },
    { id: 'u1', parentId: 'g', title: 'Rules question', content: 'Do we need the rules explained?', status: 'open', author: 'user', type: 'question', createdAt: iso(now - 35_000) },
  ] };
  const out = t.guardAgentQuestionAnswered([], map, { userText: 'Positions 2,5, and 8.' });
  expect(out).toEqual([{ op: 'update_node', id: 'q1', status: 'answered' }]);
  expect(audits.map((a) => a.kind)).toEqual(['guard_agent_question']);
  expect(t.guardAgentQuestionAnswered([], map, { userText: 'Can we play it again on a 3x4 board?' })).toEqual([]);
});
test('M448: a docs-reading instruction answered at length is delivered; a short reply is not', () => {
  const { t } = harness([]);
  const task = { op: 'create_node', id: 'd1', parentId: 'p', author: 'user', type: 'task', status: 'todo', title: 'Learn consistent-return documentation', content: 'Learn and retain the ESLint consistent-return documentation for later questions.' };
  const long = 'The `consistent-return` rule from ESLint is designed to enforce consistent return behavior in functions. '.repeat(4);
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'learn this documentation here https://eslint.org/docs/latest/rules/consistent-return', assistantText: long })[0].status).toBe('done');
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'learn this documentation here https://eslint.org/docs/latest/rules/consistent-return', assistantText: 'Sure, I will.' })[0].status).toBe('todo');
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'learn this documentation here https://eslint.org/docs/latest/rules/consistent-return', assistantText: 'The `consistent-return` rule from ESLint is designed to enforce consistent return behavior in functions, so that every code path either returns a value or none does. It flags functions that mix the two.' })[0].status).toBe('done');
  expect(t.guardTaskDelivered([{ ...task }], { userText: 'read this page https://example.com/x', assistantText: 'Sure, I will read it now and summarise the key points for you once I have gone through the whole page in detail, which may take a moment.' })[0].status).toBe('todo');
  expect(LEARN_REQUEST.test('now learn this documentation')).toBe(true);
  expect(LEARN_REQUEST.test('please improve this function')).toBe(false);
});
test('M449: closing turns', () => {
  for (const s of ['thanks, that is all for today', "That's it for now, thanks", 'ok done for the day', 'calling it a night']) expect(SESSION_CLOSING.test(s)).toBe(true);
  for (const s of ['what is all this for today?', 'please check again, the function does not work properly']) expect(SESSION_CLOSING.test(s)).toBe(false);
});
test('M447b: a pivot or a new request does not answer the agent\'s question', () => {
  const now = Date.now(); const { t } = harness([now - 300_000, now - 120_000, now - 40_000]);
  const map = { nodes: [{ id: 'q1', parentId: 'g', title: 'Winning positions', content: 'Which positions did the user choose to make a row of three Xs?', status: 'open', author: 'agent', type: 'question', createdAt: iso(now - 35_000) }] };
  expect(t.guardAgentQuestionAnswered([], map, { userText: 'please improve this function     setStep((currStep) => ++currStep);' })).toEqual([]);
  expect(t.guardAgentQuestionAnswered([], map, { userText: 'does quizlet have a api' })).toEqual([]);
  expect(t.guardAgentQuestionAnswered([], map, { userText: 'Column 4' }).length).toBe(1);
});

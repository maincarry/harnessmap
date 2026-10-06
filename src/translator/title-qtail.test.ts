import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M419: an invented "word?" tail on a title goes; a real question keeps its words. Runs the real guard pipeline with a stub store.
function run(title: string, content: string, userText = '') {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Marchetti invoicing script', title: 'Marchetti invoicing script', status: 'live', author: 'user', type: null, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'done', author: 'user' };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText, assistantText: '' });
  return { title: out.find((a: any) => a.op === 'create_node')?.title as string, qtail: audits.filter((a) => a.kind === 'guard_title_qtail').length };
}

test('TWIN LONG #397: "Marchetti billing noteaming base?" → "Marchetti billing"', () => {
  const r = run('Marchetti billing noteaming base?', 'Marchetti billing summary: corrected refund handling so the sale and refund produce an invoice total with one line per item.');
  expect(r.title).toBe('Marchetti billing'); expect(r.qtail).toBe(1);
});
test('LONG #393: "3×4 board layout thingy?" → "3×4 board layout"', () => {
  const r = run('3×4 board layout thingy?', 'The replay uses an empty 3×4 tic tac toe board with positions numbered 1 through 12.');
  expect(r.title).toBe('3×4 board layout'); expect(r.qtail).toBe(1);
});
test('a residue that would end in a function word is left alone', () => {
  const r = run('Copy-ready timesheets tasks only if changed?', 'Final check confirms the four copy-ready timesheet entries are correct and unchanged.');
  expect(r.title).toBe('Copy-ready timesheets tasks only if changed?'); expect(r.qtail).toBe(0);
});
test('a real question whose last word is in the statement or the person\'s words keeps it', () => {
  expect(run('Explain tic tac toe rules?', 'The rules: X goes first, three in a row wins.').title).toBe('Explain tic tac toe rules?');
  expect(run('Which library handles retries?', 'The agent suggested axios-retry.', 'which library should handle retries here?').title).toBe('Which library handles retries?');
});
test('two-word titles and ordinary short question words are never touched', () => {
  expect(run('Why slow?', 'The query takes 40 seconds.').title).toBe('Why slow?');
  expect(run('Deploy to prod now?', 'Deployment is scheduled for Friday.').title).toBe('Deploy to prod now?');
});

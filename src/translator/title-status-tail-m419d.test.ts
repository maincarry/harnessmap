import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M419d (REFILE #7 Priya chats): "Tomorrow’s report cell all set" — a status narrated into a title. Runs the real guardScope pipeline.
function run(title: string, content: string, userText = '') {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'Customer churn parquet', title: 'Customer churn parquet', status: 'live', author: 'user', type: null, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title, status: 'done', author: 'agent', type: 'task' };
  const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText, assistantText: '' });
  return { title: out.find((a: any) => a.op === 'create_node')?.title as string, n: audits.filter((a) => a.kind === 'guard_title_status_tail').length };
}

test('M419d: a trailing status phrase leaves the title', () => {
  expect(run('Tomorrow’s report cell all set', 'The analysis notebook is saved with a final markdown cell titled “Tomorrow’s report”.')).toEqual({ title: 'Tomorrow’s report cell', n: 1 });
  expect(run('Notebook reorganisation complete', 'The notebook was reorganised into the agreed sections.')).toEqual({ title: 'Notebook reorganisation', n: 1 });
  expect(run('Feature chart saved.', 'feature_importance.png was saved at 2400×1500.')).toEqual({ title: 'Feature chart', n: 1 });
});

test('M419d: a one-word remainder, or the person’s own phrase, stays', () => {
  expect(run('Migration done', 'The migration ran.').n).toBe(0);
  expect(run('Tomorrow’s report cell all set', 'She confirmed it.', 'Great — tomorrow’s report cell all set, thanks.').n).toBe(0);
  expect(run('Ready queue drained', 'The ready queue was drained.').title).toBe('Ready queue drained');
});

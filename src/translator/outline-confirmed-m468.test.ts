import { test, expect } from 'bun:test';
import { Translator, OUTLINE_CONFIRMED } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const row = (id: string, title: string, extra: any = {}) => ({ id, parentId: 'root', title, content: title, status: 'provisional', author: 'user', type: null, ...extra });
const map = { nodes: [
  { id: 'root', parentId: null, title: 'Four-day work week briefing', content: 'Briefing', status: 'live', author: 'user', type: null },
  row('s1', 'Summary'), row('s2', 'What trials measured'), row('s3', 'Output results'), row('s4', 'Caveats'), row('s5', 'Recommendation'),
  row('s4b', 'Caveats section'),
  row('cut', 'Where it did not work', { status: 'rejected' }),
  row('wb', 'Wellbeing and retention'),
  row('task', 'Draft caveats', { type: 'task', status: 'todo' }),
  row('ag', 'Output results', { id: 'ag', author: 'agent' }),
] };
const R17 = 'Rebuild the working outline and treat this as the current version: 1 Summary, 2 What the trials measured, 3 Output results (including wellbeing), 4 Caveats, 5 Recommendation. “Where it did not work” is cut, not current, and wellbeing is not a separate section.';
const R22 = 'Move Recommendation before Caveats for this audience. Treat this as the current outline: 1 Summary, 2 What the trials measured, 3 Output results, 4 Recommendation, 5 Caveats. The previous order is superseded.';

test('M468: "treat this as the current outline: 1 …, 2 …" settles the provisional sections it names', () => {
  for (const ut of [R17, R22]) {
    const { t, audits } = mk();
    const out = t.guardOutlineConfirmed([{ op: 'update_node', id: 's4', content: 'Section 5 covers caveats qualifying the evidence.' }], map, { userText: ut });
    const live = out.filter((a: any) => a.op === 'update_node' && a.status === 'live').map((a: any) => a.id).sort();
    expect(live).toEqual(['s1', 's2', 's3', 's4', 's4b', 's5']);
    expect(out.find((a: any) => a.id === 's4')).toMatchObject({ content: 'Section 5 covers caveats qualifying the evidence.', status: 'live' });
    expect(out.find((a: any) => ['cut', 'wb', 'task', 'ag'].includes(a.id))).toBeUndefined();
    expect(audits.filter((a) => a.kind === 'guard_outline_confirmed').length).toBe(6);
  }
});

test('M468: asking for a first outline, or a count without a list, changes nothing', () => {
  const { t, audits } = mk();
  expect(OUTLINE_CONFIRMED.test('Give me a first outline for the briefing: 1 Summary, 2 What the trials measured, 3 Output results, 4 Wellbeing and retention, 5 Where it did not work, 6 Caveats, 7 Recommendation.')).toBe(false);
  expect(t.guardOutlineConfirmed([], map, { userText: 'Merge section 4 into section 3. The outline should now have six sections.' })).toEqual([]);
  expect(t.guardOutlineConfirmed([], map, { userText: 'The outline is now shorter; keep the Summary tight.' })).toEqual([]);
  expect(audits.length).toBe(0);
});

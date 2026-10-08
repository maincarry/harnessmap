import { test, expect } from 'bun:test';
import { Translator, PROMISE_TO_DRAFT } from './translator';

function mk() {
  const audits: { kind: string; d: any }[] = [];
  const times = [Date.parse('2026-10-08T16:08:00Z'), Date.parse('2026-10-08T16:09:00Z')];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => times; if (k === 'getSetting') return () => undefined; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const at = '2026-10-08T16:08:32Z';
const map: any = { nodes: [{ id: 'p', parentId: null, title: 'Briefing', content: 'Briefing', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at }], links: [], projectId: 'proj' };
const todo = { op: 'create_node', id: 'd1', parentId: 'p', title: 'Draft Section 2', content: 'Draft section 2, “What the trials measured,” in about 300 words, citing Sources 1–4 by name.', status: 'todo', author: 'user', type: 'task' };

// Elena's record (TWIN #445): every "Draft section N" was answered with one or two sentences of intent and no text.
const PROMISES = [
  'I’ll draft a roughly 300-word section comparing what the Autonomy UK pilot, Microsoft Japan trial, Iceland trials, and Perpetual Guardian study measured, while keeping revenue, sales per employee, productivity, engagement, and output distinct.',
  'I’ll draft section 3 in roughly 400 words, comparing Sources 1–4 without conflating their measures. I’ll include wellbeing within the section and preserve the corrected attribution: 40% sales per employee for Microsoft Japan, 1.4% average revenue for the UK pilot, and maintained-or-improved productivity for Iceland.',
  'I’ll draft the Caveats section in roughly 250 words, leading with Campbell’s methodological limitations and describing outcomes in shift-based roles as untested rather than negative.',
  'I’ll revise the Iceland paragraph to preserve the broader finding of maintained or improved productivity while attributing the measured 3–5% increase specifically to the two agencies in the 2021 follow-up.',
  'I’ll draft a roughly 150-word Summary using only sourced figures: 1.4% average revenue for the Autonomy UK pilot, 40% sales per employee for Microsoft Japan, about 2,500 workers and the agency-specific 3–5% rise for Iceland, and 240 staff for Perpetual Guardian, keeping revenue distinct from productivity.',
  'Sure — I will write the cover email in two sentences once you confirm the title.',
];

test('M439j: a drafting reply that only promises the draft leaves the task as filed', () => {
  for (const a of PROMISES) {
    const { t } = mk();
    expect(PROMISE_TO_DRAFT.test(a)).toBe(true);
    const out = t.guardTaskDelivered([{ ...todo }], { userText: 'Draft section 2, “What the trials measured,” in about 300 words. Cite Sources 1–4 by name.', assistantText: a }, map);
    expect(out[0].status).toBe('todo');
  }
});

test('M439j: a reply that opens with intent but carries the text, or opens with the deed, still delivers', () => {
  const body = ' Here it is:\n\n' + 'The four trials measured different things. '.repeat(18);
  const { t } = mk();
  expect(t.guardTaskDelivered([{ ...todo }], { userText: 'Draft section 2, “What the trials measured,” in about 300 words.', assistantText: 'I’ll draft it now.' + body }, map)[0].status).toBe('done');
  const { t: t2 } = mk();
  expect(t2.guardTaskDelivered([{ ...todo }], { userText: 'Draft section 2, “What the trials measured,” in about 300 words.', assistantText: 'Drafted section 2 (312 words): The Autonomy UK pilot measured revenue across 61 companies; Microsoft Japan measured sales per employee for one month; Iceland tracked productivity in public-sector workplaces; Perpetual Guardian measured engagement and output for 240 staff.' }, map)[0].status).toBe('done');
});

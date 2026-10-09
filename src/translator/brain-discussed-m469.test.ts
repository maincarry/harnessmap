// M469 (Jacob 2026-10-09 03:43–03:46: "the map is not about telling you what topics are closed or open, but what topics are discussed …
// we do harness"; "record the status … make it a feature, but don't push it"): the brain's computed lines say what was discussed and said,
// by whom and when — never what is open, settled, left behind or next. Amir's held-out day (PANEL #458a) is the record: the three rows the
// map had left open/todo were read out as "older, untouched" in 24 of 26 verdicts; under M469 no computed line judges them at all.
import { test, expect } from 'bun:test';
import { discussedLines, turnsAgo } from './mapstatus';

const T = (i: number) => new Date(Date.parse('2026-10-09T02:38:00Z') + i * 60_000).toISOString().replace('.000Z', 'Z');
const rounds = Array.from({ length: 36 }, (_, i) => Date.parse(T(i)));
const mk = (o: any) => ({ id: o.id, parentId: o.parentId ?? 'root', title: o.title, content: o.content, author: o.author ?? 'user', type: o.type ?? null, status: o.status ?? 'live', createdAt: o.createdAt, updatedAt: o.updatedAt ?? o.createdAt });
const nodes = [
  { id: 'root', parentId: null, title: 'node-b watchdog resets', content: 'node-b watchdog resets', author: 'user', status: 'live', createdAt: T(0), updatedAt: T(0) },
  mk({ id: 'q', title: 'reset cause', content: 'Why does node-b reset every 40–90 minutes with IWDGRSTF set?', type: 'question', status: 'open', createdAt: T(0) }),
  mk({ id: 'lim', title: '3.3 V current limit', content: 'The 3.3 V rail must never exceed 500 mA.', type: 'constraint', status: 'hard', createdAt: T(0) }),
  mk({ id: 'iwdg', title: 'IWDG timeout', content: 'With PR=4 (÷64), RLR=0x0FFF and LSI ≈ 32 kHz the IWDG timeout is about 8.2 s.', author: 'agent', type: 'evidence', status: 'noted', createdAt: T(3) }),
  mk({ id: 'diag', parentId: 'q', title: 'Watchdog reset cause', content: 'The 30 s LTE_SendBlocking wait caused the watchdog resets; a 5 s timeout ran for 3 hours without resets and handled two LTE timeouts.', type: 'claim', status: 'accepted', createdAt: T(4), updatedAt: T(11) }),
  mk({ id: 'audit', title: 'Audit modem power paths', content: 'Check sched.c for any path where the modem powers up while a BME280 conversion is in flight.', type: 'task', status: 'todo', createdAt: T(13), updatedAt: T(13) }),
  mk({ id: 'rc', title: 'Fix unused rc warning', content: 'Fix the unused variable rc warning at lte.c:212 without removing the return check.', type: 'task', status: 'todo', createdAt: T(20), updatedAt: T(20) }),
  mk({ id: 'batt', title: 'Battery life estimate', content: 'At 1.1 mA average, the 2,400 mAh cell projects 90.9 days nominal and 77.3 days with a 15% margin.', author: 'agent', type: 'evidence', status: 'noted', createdAt: T(8) }),
  mk({ id: 'bench', title: 'Tomorrow bench checks', content: 'Tomorrow: run node-b for 12 hours on the bench, log reset causes, count LTE timeouts, measure the average current with the 90 s interval.', type: 'task', status: 'todo', createdAt: T(29), updatedAt: T(29) }),
  mk({ id: 'measure', title: 'Measure average current', content: 'Measure average current at 3.3 V using the bench supply’s 1 Ω shunt, never the modem’s own report.', type: 'task', status: 'done', createdAt: T(30), updatedAt: T(30) }),
  mk({ id: 'commit', title: 'Firmware commit message', content: 'node-b: prevent watchdog resets by limiting LTE sends to 5 seconds, add boot reset-cause logging, guard modem retries until the BME280 is idle.', type: 'task', status: 'done', createdAt: T(32), updatedAt: T(32) }),
];

test('turnsAgo counts rounds since the row was touched, whatever its status', () => {
  expect(turnsAgo(T(32), rounds)).toBe(3);
  expect(turnsAgo(T(0), rounds)).toBe(35);
  expect(turnsAgo('2026-10-09 03:10:00', rounds)).toBe(3);   // T(32) in sqlite's "YYYY-MM-DD HH:MM:SS" (UTC) parses the same
  expect(turnsAgo(undefined, rounds)).toBeNull();
  expect(turnsAgo(T(32), [])).toBeNull();
});

test('M469: the computed lines say what was discussed and said — no OPEN NOW, LEFT BEHIND, SETTLED or NEXT STEP judgment', () => {
  const out = discussedLines(nodes as any, rounds);
  for (const banned of ['OPEN NOW', 'LEFT BEHIND', 'SETTLED (', 'NEXT STEP', 'PROMISED, NOT YET', 'untouched', 'left behind', 'still open', 'nothing is open']) expect(out).not.toContain(banned);
  expect(out).toContain('DISCUSSED FIRST');
  expect(out).toContain('DISCUSSED MOST RECENTLY');
  expect(out).toContain('FIGURES STATED');
  expect(out).toContain('WHAT THE PERSON SAID COMES NEXT');
});

test('M469: the newest rows lead, each with who said it and how many turns ago — the stale todo rows are not singled out', () => {
  const out = discussedLines(nodes as any, rounds);
  const recent = out.split('\n').find((l) => l.startsWith('DISCUSSED MOST RECENTLY'))!;
  expect(recent.indexOf('Firmware commit message')).toBeLessThan(recent.indexOf('Measure average current'));
  expect(recent).toContain('Firmware commit message: node-b: prevent watchdog resets by limiting LTE sends to 5 seconds, add boot reset-cause logging, guard modem retries until the BME280 is idle. [you said] (3 turns ago)');
  expect(recent).toContain('Watchdog reset cause: The 30 s LTE_SendBlocking wait caused the watchdog resets; a 5 s timeout ran for 3 hours without resets and handled two LTE timeouts. [you said] (24 turns ago)');
  const first = out.split('\n').find((l) => l.startsWith('DISCUSSED FIRST'))!;
  expect(first).toContain('reset cause: Why does node-b reset every 40–90 minutes with IWDGRSTF set? [you said] (35 turns ago)');
  expect(first).toContain('3.3 V current limit');
  // Amir's three "older, untouched" rows (PANEL #458a): present on the roster as rows, judged by no computed line.
  expect(out).not.toMatch(/Audit modem power paths[^|]*\[recorded todo\]/);
  expect(out).not.toMatch(/Fix unused rc warning[^|]*\[recorded todo\]/);
});

test('M469: figures are quoted with who produced them; what the person said comes next is their own words with the recorded status word', () => {
  const out = discussedLines(nodes as any, rounds);
  const figures = out.split('\n').find((l) => l.startsWith('FIGURES STATED'))!;
  expect(figures).toContain('90.9 days nominal and 77.3 days with a 15% margin. [the agent said] (27 turns ago)');
  expect(figures).toContain('the IWDG timeout is about 8.2 s. [the agent said] (32 turns ago)');
  expect(figures).toContain('Watchdog reset cause: The 30 s LTE_SendBlocking wait');
  const next = out.split('\n').find((l) => l.startsWith('WHAT THE PERSON SAID COMES NEXT'))!;
  expect(next).toContain('Tomorrow bench checks: Tomorrow: run node-b for 12 hours on the bench, log reset causes, count LTE timeouts, measure the average current with the 90 s interval. [you said] (6 turns ago) [recorded todo]');
  expect(next).not.toContain('Firmware commit message');
  expect(next).not.toContain('judged');
});

test('M469: a closing turn is reported as the session having ended, pointing at the last work discussed — never at what remains open', () => {
  const out = discussedLines(nodes as any, rounds, 'thanks, that is all for today');
  expect(out).toContain('SESSION CLOSED: the person\'s last words were "thanks, that is all for today"');
  expect(out).toContain('the last work discussed was … (from DISCUSSED MOST RECENTLY)');
  expect(out).not.toContain('what remains open');
  expect(discussedLines(nodes as any, rounds, 'what is the IWDG timeout again?')).not.toContain('SESSION CLOSED');
});

test('M469: an empty map says so without inventing work', () => {
  const out = discussedLines([], rounds);
  expect(out).toContain('DISCUSSED MOST RECENTLY (');
  expect(out).toContain('(nothing yet)');
  expect(out).toContain('(none recorded)');
  expect(out).toContain('(the person did not name later work)');
  expect(out).not.toContain('TERMS, PROMISES AND DATES');
});

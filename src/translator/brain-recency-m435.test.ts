import { test, expect } from 'bun:test';
import { ageTag } from './mapstatus';
import { nodeLine } from '../map/render';

// M435: open items the person left behind carry "untouched for N turns" in the brain's roster; closed or fresh items carry nothing.
const T0 = Date.parse('2026-10-07T10:00:00Z');
const rounds = Array.from({ length: 80 }, (_, i) => T0 + i * 60_000); // one round a minute from 10:00
const at = '2026-10-07T00:00:00Z';
const mk = (o: any) => ({ id: 'n1', parentId: null, title: null, type: null, createdAt: at, updatedAt: at, ...o });

test('an open item last touched 70 rounds ago is marked; a fresh one and a done one are not', () => {
  expect(ageTag('open', '2026-10-07T10:09:30Z', rounds)).toBe('untouched for 70 turns');
  expect(ageTag('todo', '2026-10-07 10:09:30', rounds)).toBe('untouched for 70 turns');   // sqlite's "YYYY-MM-DD HH:MM:SS" (UTC) parses the same
  expect(ageTag('open', '2026-10-07T11:10:00Z', rounds)).toBeNull();                       // touched 9 rounds ago
  expect(ageTag('done', '2026-10-07T10:09:30Z', rounds)).toBeNull();
  expect(ageTag('dropped', '2026-10-07T10:09:30Z', rounds)).toBeNull();
  expect(ageTag('open', '2026-10-07T10:09:30Z', [])).toBeNull();
});

test('nodeLine appends the age after the status', () => {
  const n = mk({ content: 'rand_num issue', status: 'open', author: 'user', updatedAt: '2026-10-07T10:09:30Z' });
  expect(nodeLine(n as any, { who: true, age: (x: any) => ageTag(x.status, x.updatedAt, rounds) })).toBe('○ [you] rand_num issue (open) · untouched for 70 turns');
  expect(nodeLine(n as any, { who: true })).toBe('○ [you] rand_num issue (open)');
});

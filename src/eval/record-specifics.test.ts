import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { keySpecifics, specificsInRecord, classifyMiss } from './record-specifics.js';

// the sealed keys of Amir's day (amir-day-chats-en.qa.json) — the record's own sentences
test('a measured-current key yields every figure with its unit', () => {
  const sp = keySpecifics('Sleep 18 µA; sensing 4.2 mA; modem TX burst 380 mA peak for 2 s; one-hour average 1.1 mA.');
  for (const s of ['18 µA', '4.2 mA', '380 mA', '2 s', '1.1 mA']) expect(sp).toContain(s);
});
test('register flags and file names are specifics', () => {
  expect(keySpecifics('RCC_CSR had IWDGRSTF set and BORRSTF was not set.')).toEqual(expect.arrayContaining(['RCC_CSR', 'IWDGRSTF', 'BORRSTF']));
  expect(keySpecifics('main.c, lte.c, and sched.c; node-b.ld was not changed at that point, and the 90 s interval was only a recorded decision.')).toEqual(expect.arrayContaining(['main.c', 'lte.c', 'sched.c', 'node-b.ld', '90 s']));
  expect(keySpecifics('Take the 8 KB for the log ring buffer from the application region’s free tail. Keep the config page fixed at 0x0803E000.')).toEqual(expect.arrayContaining(['8 KB', '0x0803E000']));
  expect(keySpecifics('SENSOR_CONVERSION_BUDGET_MS is 40 ms and must remain below LTE_SEND_TIMEOUT_MS at 5000 ms')).toEqual(expect.arrayContaining(['SENSOR_CONVERSION_BUDGET_MS', 'LTE_SEND_TIMEOUT_MS', '40 ms', '5000 ms']));
  expect(keySpecifics('I propose limiting LTE_SendBlocking to a 5-second timeout')).toContain('LTE_SendBlocking');
});
test('a judgment key with no figure or identifier has no specifics', () => {
  expect(keySpecifics('The bootloader reads the image length from the firmware header and calculates the CRC over that declared length.')).not.toContain('bootloader');
});
test('specifics are found in the record regardless of case and spacing; a miss is classified by what is absent', () => {
  const db = new Database(':memory:');
  db.run(`create table nodes (id text, parent_id text, title text, content text, type text, status text, author text)`);
  db.run(`insert into nodes values ('a', null, 'Hourly average current', 'The modem’s average current over one hour is 1.1mA.', 'evidence', 'noted', 'user')`);
  db.run(`insert into nodes values ('b', null, 'Reset-cause flags', 'RCC_CSR: iwdgrstf set, borrstf clear', 'evidence', 'noted', 'user')`);
  db.run(`insert into nodes values ('c', null, 'gone', 'sched.c changed', 'evidence', 'removed', 'user')`);
  const rows = db.query(`select title, content from nodes where status is null or status != 'removed'`).all() as any[];
  const text = rows.map((r) => `${r.title} ${r.content}`).join('\n').toLowerCase().replace(/\s+/g, '').replace(/µ/g, 'u');
  const r1 = specificsInRecord(text, ['1.1 mA', 'IWDGRSTF', 'BORRSTF']);
  expect(r1.absent).toEqual([]);
  expect(classifyMiss('wrong', r1)).toBe('in-record');
  const r2 = specificsInRecord(text, ['sched.c', 'main.c']);
  expect(r2.absent).toEqual(['sched.c', 'main.c']); // the removed node does not count
  expect(classifyMiss('wrong', r2)).toBe('record-gap');
  expect(classifyMiss('right', r2)).toBeNull();
  expect(classifyMiss('missing', { present: [], absent: [] })).toBe('unclassified');
});

import { keyWords, wordsInRecord, probeKey } from './record-specifics.js';
test('a prose key falls back to its distinctive words, matched by stem', () => {
  const ws = keyWords('Restore the previous values while keeping inline server errors working.');
  expect(ws).toEqual(expect.arrayContaining(['restore', 'previous', 'values', 'inline', 'server', 'errors', 'keeping', 'working']));
  const record = 'studio profile saving uses an optimistic update: submitted values appear immediately, failed requests restore the previous profile. server validation errors map back to the fields as inline errors.'.replace(/\s+/g, '');
  const r = wordsInRecord(record, ws);
  expect(r.present).toEqual(expect.arrayContaining(['restore', 'previous', 'values', 'server', 'errors']));
  expect(classifyMiss('missing', r, 'words')).toBe('in-record'); // six of eight present (keeping, working absent)
  expect(classifyMiss('missing', { present: ['restore'], absent: ['previous', 'values', 'inline', 'server', 'errors'] }, 'words')).toBe('record-gap');
  expect(classifyMiss('missing', { present: ['restore', 'previous', 'values'], absent: ['inline', 'server', 'errors'] }, 'words')).toBe('unclassified');
  const bf = keyWords('It had to be safe on existing rows, run in batches instead of one huge transaction, and provide dry-run or progress output.');
  expect(wordsInRecord('a batched, resumable backfill was added for existing photo rows, avoiding one long transaction; the backfill provides dry-run and progress output'.replace(/\s+/g, ''), bf).absent).toEqual([]);
  expect(probeKey('x', 'RCC_CSR had IWDGRSTF set').basis).toBe('specifics');
  expect(probeKey('x', 'Restore the previous values.').basis).toBe('words');
});

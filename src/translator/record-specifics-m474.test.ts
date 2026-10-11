// M474 (RECORD TEST #3, the long record; Jacob 2026-10-09 09:49 "This is a serious bug… don't we have rules that guard this already?"):
// a figure, identifier or quoted phrase the person states must land in a row of the round — or the harness files it verbatim as theirs.
import { test, expect } from 'bun:test';
import { Translator } from './translator';

function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => []; if (k === 'getSetting') return () => undefined; if (k === 'lastRoundAlterations') return () => []; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const map = { nodes: [{ id: 'f', parentId: null, title: 'Random numbers script', content: 'Python script generating random numbers', author: 'user', status: 'live' }] as any[] };

test('the 15,000 limit the person set (turn 15 of the long record) lands as their own row when the filing dropped it', () => {
  const { t, audits } = harness();
  const out = t.guardSpecificsKept([{ op: 'update_node', id: 'f', content: 'The script writes the numbers to a file and prints the first ten in ascending order.' }], map, { userText: 'make it generate numbers until 15000, then output the first 10 in ascending order', assistantText: 'Done — the loop now runs until the limit and the file holds the sorted first ten.', focusContainerId: 'f' });
  expect(out).toHaveLength(2);
  expect(out[1]).toMatchObject({ op: 'create_node', parentId: 'f', author: 'user', status: 'live' });
  expect(out[1].content).toContain('until 15000');
  expect(audits[0]).toMatchObject({ kind: 'guard_specifics_kept', d: { who: 'user' } }); expect(audits[0].d.missed).toContain('15000');
});

test('Amir\'s flash-layout decision (round 25) — no row at all this refile — is filed verbatim as his', () => {
  const { t, audits } = harness();
  const out = t.guardSpecificsKept([], { nodes: [] }, { userText: 'Take the 8 KB for the log ring buffer from the application region’s free tail, never from the config area. Keep the config page fixed at 0x0803E000.', assistantText: 'Updated node-b.ld accordingly.', focusContainerId: 'flash' });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ op: 'create_node', parentId: 'flash', author: 'user' });
  expect(out[0].content).toContain('0x0803E000'); expect(out[0].content).toContain('8 KB');
  expect(audits[0].d.missed).toEqual(expect.arrayContaining(['8 KB', '0x0803E000']));
});

test('the agent\'s "2 CPU cores and 2 GB RAM" (turn 69) becomes the agent\'s evidence when the filing kept neither figure', () => {
  const { t, audits } = harness();
  const out = t.guardSpecificsKept([{ op: 'create_node', id: 'v', parentId: 'vps', author: 'agent', type: 'evidence', status: 'noted', content: 'A small VPS is enough for the Python runner.' }], { nodes: [] }, { userText: 'what vps spec do i need for python', assistantText: 'For a Python VPS runner, start with at least 2 CPU cores and 2 GB RAM. A T2.micro is free-tier eligible but tight.', focusContainerId: 'vps' });
  const extra = out.filter((a: any) => a.op === 'create_node' && a.id !== 'v');
  expect(extra).toHaveLength(1);
  expect(extra[0]).toMatchObject({ author: 'agent', type: 'evidence', status: 'noted', parentId: 'vps' });
  expect(extra[0].content).toContain('2 CPU cores and 2 GB RAM');
  expect(audits.filter((a) => a.kind === 'guard_specifics_kept').map((a) => a.d.who)).toEqual(['agent']);
});

test('nothing is added when the figures already landed, live on the map, or sit inside a code block', () => {
  const { t, audits } = harness();
  const out = t.guardSpecificsKept([{ op: 'create_node', id: 'x', parentId: 'f', author: 'user', content: 'Generate numbers until 15000, then output the first 10 in ascending order.' }], map, { userText: 'make it generate numbers until 15000, then output the first 10 in ascending order', assistantText: '```python\nLIMIT = 15000\nfor i in range(10): pass\n```\nHere is the code.', focusContainerId: 'f' });
  expect(out).toHaveLength(1);
  const out2 = t.guardSpecificsKept([], { nodes: [{ id: 'r', parentId: null, title: 'IWDG timeout', content: 'The IWDG timeout is about 8.2 s.', author: 'agent', status: 'noted' }] }, { userText: 'what was the IWDG timeout again, 8.2 s?', assistantText: 'It is 8.2 s.', focusContainerId: 'r' });
  expect(out2).toHaveLength(0);
  expect(audits).toHaveLength(0);
});

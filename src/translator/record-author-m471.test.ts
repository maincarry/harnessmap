// M471/M471b/M471c (RECORD TEST #1 — Amir's held-out day, graded against the record): four of the map's five wrong answers were wrong
// RECORDS of who said what. The sentences below are his, verbatim from src/eval/scenarios/amir-day-chats-en.json (rounds 6–8, 17–19).
import { test, expect } from 'bun:test';
import { Translator, dropCorrectionTwins, CORRECTS_FIGURE, IMPERATIVE_DECISION } from './translator';

function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'roundTimes') return () => []; if (k === 'getSetting') return () => undefined; if (k === 'lastRoundAlterations') return () => []; return () => undefined; } });
  return { t: new Translator(store) as any, audits };
}
const option = { id: 'opt-refresh', parentId: 'fix', title: 'Refresh during UART wait', content: 'Refresh the watchdog inside the LTE_SendBlocking UART wait loop so an ongoing send cannot trigger a reset.', author: 'agent', type: 'option', status: 'floated' };
const timeout = { id: 'opt-5s', parentId: 'fix', title: 'Five-second LTE timeout', content: 'Limit LTE_SendBlocking to a 5-second timeout so it stays below the 8.2 s IWDG timeout.', author: 'agent', type: 'option', status: 'floated' };

test('M471: the person\'s rule is never folded into the agent\'s option it rejects (round 7)', () => {
  const nodes: any[] = [option, timeout, { id: 'fix', parentId: null, title: 'LTE fix proposal', content: 'Fix for the 30 s block', author: 'agent', status: 'live' }, { id: 'x1', parentId: 'fix', title: 'Reset cause', content: 'IWDGRSTF set', author: 'user', status: 'noted' }, { id: 'x2', parentId: 'fix', title: 'LTE blocking', content: 'blocks up to 30 seconds', author: 'user', status: 'noted' }];
  const alts = [
    { op: 'update_node', id: 'opt-refresh', status: 'dropped', content: 'Refresh the watchdog inside the UART wait loop — rejected: it can hide a real hang.' },
    { op: 'create_node', id: 'rule', parentId: 'fix', type: 'constraint', author: 'user', status: 'active', title: 'No wait-loop refresh', content: 'Never refresh the watchdog from inside a wait loop because doing so can hide a real hang.' },
  ];
  const audits: any[] = [];
  const out = dropCorrectionTwins(alts, nodes, (d) => audits.push(d));
  expect(out).toHaveLength(2);               // the rule survives as its own row
  expect(audits).toHaveLength(0);
  // the old behaviour still holds for a same-side restatement of a plain row: a user decision restating a user row's rewrite is a twin
  const plain = [{ id: 'p', parentId: 'fix', title: 'Sleep interval', content: 'Sleep 60 s between readings', author: 'user', status: 'live' }, ...nodes];
  const out2 = dropCorrectionTwins([{ op: 'update_node', id: 'p', content: 'Raise the sleep interval from 60 s to 90 s between readings to reach the 90-day target.' }, { op: 'create_node', id: 'd', type: 'decision', author: 'user', content: 'Raise the sleep interval from 60 s to 90 s between readings to reach the 90-day target.' }], plain, (d) => audits.push(d));
  expect(out2).toHaveLength(1); expect(audits).toHaveLength(1);
});

test('M471b: a row the person rejected is not revived by the next filing (round 8); a real re-pick in their own sentence is', () => {
  const { t, audits } = harness();
  const map = { nodes: [{ ...option, status: 'dropped' }, timeout] as any[] };
  const alts = [
    { op: 'update_node', id: 'opt-5s', status: 'chosen' },
    { op: 'update_node', id: 'opt-refresh', status: 'chosen', title: 'No wait-loop refresh', content: 'Do not refresh the IWDG inside the LTE_SendBlocking UART wait loop; the implemented 5-second deadline returns LTE_TIMEOUT when it expires.' },
  ];
  const out = t.guardRejectedStays(alts, map, { userText: 'Accept the 5 s send timeout. Implement it in lte.c without refreshing the watchdog inside the wait loop, and show me the diff.' });
  expect(out).toEqual([{ op: 'update_node', id: 'opt-5s', status: 'chosen' }]);
  expect(audits.map((a) => a.kind)).toEqual(['guard_rejected_stays']);
  expect(audits[0].d).toMatchObject({ id: 'opt-refr', was: 'dropped', tried: 'chosen' });
  // the person changes their mind in so many words — the row may come back
  const back = t.guardRejectedStays([{ op: 'update_node', id: 'opt-refresh', status: 'chosen' }], map, { userText: 'Actually, go with the refresh during the UART wait after all — the bench shows the hang risk is handled.' });
  expect(back).toHaveLength(1);
  // a status that keeps it retired, or an update to a live row, passes untouched
  expect(t.guardRejectedStays([{ op: 'update_node', id: 'opt-refresh', status: 'retracted' }], map, { userText: 'ok' })).toHaveLength(1);
  expect(t.guardRejectedStays([{ op: 'update_node', id: 'opt-5s', content: 'Limit to 5 s; implemented in lte.c.' }], map, { userText: 'show me the diff' })).toHaveLength(1);
});

test('M471c: the figure the person corrects is the person\'s (round 19); the agent\'s own number stays the agent\'s', () => {
  const { t, audits } = harness();
  const row = { id: 'conv', parentId: 'guard', title: 'Conversion timing formula', content: 'Using the BME280 vendor conversion-time formula for forced mode with x2 temperature, x16 pressure, and x1 humidity oversampling, the conversion takes about 22 ms.', author: 'agent', type: 'evidence', status: 'noted' };
  const map = { nodes: [row] as any[] };
  const ut = 'No—the forced-mode conversion time with x2 temperature, x16 pressure, and x1 humidity is closer to 40 ms. Replace the 10 ms guard assumption with a 40 ms conversion budget; that is still under the 5 s timeout. Fix the note.';
  expect(CORRECTS_FIGURE.test(ut)).toBe(true);
  const out = t.guardCorrectionAuthor([
    { op: 'update_node', id: 'conv', type: 'evidence', status: 'noted', content: 'Using the BME280 vendor conversion-time formula for forced mode with x2 temperature, x16 pressure, and x1 humidity oversampling, the conversion takes about 40 ms.' },
    { op: 'create_node', id: 'other', parentId: 'guard', type: 'evidence', author: 'agent', status: 'noted', content: 'modem_retry() waits for sensor_idle() before powering the modem.' },
  ], { userText: ut }, map);
  // M471d: the agent's 22 ms row is superseded (its words kept), the person's 40 ms becomes its own row beside it
  expect(out[0]).toEqual({ op: 'update_node', id: 'conv', status: 'superseded' });
  expect(out[1].author).toBe('agent');
  const fresh = out.find((x: any) => x.op === 'create_node' && x.author === 'user');
  expect(fresh).toBeTruthy(); expect(fresh.parentId).toBe('guard'); expect(fresh.type).toBe('evidence'); expect(fresh.status).toBe('noted'); expect(fresh.content).toContain('about 40 ms'); expect(fresh.title).toBe('Conversion timing formula');
  expect(audits.map((a) => a.kind)).toEqual(['guard_correction_author']); expect(audits[0].d.how).toBe('figure-new-row');
  // the agent revising its own estimate on a neutral ask is not a correction by the person
  const { t: t2, audits: a2 } = harness();
  const out2 = t2.guardCorrectionAuthor([{ op: 'update_node', id: 'conv', type: 'evidence', status: 'noted', content: '… the conversion takes about 22 ms.' }], { userText: 'What is the BME280 forced-mode conversion time at our oversampling settings: x2 temperature, x16 pressure, and x1 humidity? Check the vendor timing formula.' }, map);
  expect(out2[0].author).toBeUndefined(); expect(a2).toHaveLength(0);
  for (const s of ['Correct: 40% is Microsoft Japan; the UK figure is 1.4% revenue.', 'That\'s wrong, the limit is 500 mA.', 'Replace the 10 ms guard assumption with a 40 ms budget.']) expect(CORRECTS_FIGURE.test(s)).toBe(true);
  for (const s of ['Compute the timeout for PR=4 and RLR=0x0FFF.', 'Note the 40 ms budget in the guard.', 'where it did not work: 3 of 61 firms']) expect(CORRECTS_FIGURE.test(s)).toBe(false);
});

test('M471e: the update that drops a proposal keeps the proposal\'s words (round 7)', () => {
  const { t, audits } = harness();
  const map = { nodes: [option, timeout] as any[] }; // the refresh option is still floated when the person rejects it
  const out = t.guardRejectedStays([
    { op: 'update_node', id: 'opt-refresh', status: 'dropped', title: 'No wait-loop refresh', content: 'Do not refresh the watchdog inside the LTE_SendBlocking UART wait loop; this proposal is rejected because kicking the watchdog from a wait loop can hide a real hang.' },
    { op: 'create_node', id: 'rule', parentId: 'fix', type: 'constraint', author: 'user', status: 'active', title: 'No wait-loop refresh', content: 'Never kick the watchdog from inside a wait loop — it can hide a real hang.' },
  ], map, { userText: 'Keep the 5 s timeout proposal, but reject the watchdog refresh inside the UART wait loop. Never kick the watchdog from inside a wait loop—it can hide a real hang. Keep that as a rule.' });
  expect(out[0]).toEqual({ op: 'update_node', id: 'opt-refresh', status: 'dropped' });   // the status carries the rejection; the words stay
  expect(out[1].author).toBe('user');                                                        // the reason lives in the person's own row
  expect(audits[0].d).toMatchObject({ how: 'keep-words', tried: 'dropped' });
});

test('M472: a decision the person gives as an order is the person\'s (round 25); a plain request to read a file claims nothing', () => {
  const { t, audits } = harness();
  const ut = 'Take the 8 KB for the log ring buffer from the application region’s free tail, never from the config area. Keep the config page fixed at 0x0803E000.';
  expect(IMPERATIVE_DECISION.test(ut)).toBe(true);
  const out = t.guardDecisionAuthor([
    { op: 'create_node', id: 'd1', parentId: 'flash', type: 'decision', status: 'decided', author: 'agent', title: 'Ring buffer in app tail', content: 'The 8 KB log ring buffer is allocated from the application region’s free tail.' },
    { op: 'create_node', id: 'd2', parentId: 'flash', type: 'decision', status: 'decided', author: 'agent', title: 'Config page fixed', content: 'The config page remains fixed at 0x0803E000 and is not used for the 8 KB log ring buffer.' },
    { op: 'create_node', id: 'e1', parentId: 'flash', type: 'evidence', status: 'noted', author: 'agent', content: 'node-b.ld: the application region is 224 KB, the config area 8 KB at the top, the bootloader 24 KB.' },
  ], { nodes: [] }, { userText: ut });
  expect(out[0].author).toBe('user'); expect(out[1].author).toBe('user'); expect(out[2].author).toBe('agent');
  expect(audits.filter((a) => a.kind === 'guard_decision_author').map((a) => a.d.how)).toEqual(['imperative', 'imperative']);
  const { t: t2, audits: a2 } = harness();
  const out2 = t2.guardDecisionAuthor([{ op: 'create_node', id: 'e2', parentId: 'flash', type: 'evidence', status: 'noted', author: 'agent', content: 'From node-b.ld: the bootloader occupies 24 KB, the application region is 224 KB, and the 8 KB config area is reserved at the top.' }], { nodes: [] }, { userText: 'I need 8 KB more flash for a new log ring buffer. Read node-b.ld and show me the current flash layout, including the app region, the config page and the bootloader.' });
  expect(out2[0].author).toBe('agent'); expect(a2).toHaveLength(0);
});

test('M472b: an order of the person\'s that lands only as rewrites of the agent\'s nodes becomes their own decision node (Amir round 25 on v0.9.290)', () => {
  const { t, audits } = harness();
  const map = { nodes: [{ id: 'app', parentId: 'flash', title: 'Application region', content: 'The application region is 224 KB.', author: 'agent', type: 'evidence', status: 'noted' }, { id: 'cfg', parentId: 'flash', title: 'Config area', content: 'The 8 KB config area sits at the top at 0x0803E000.', author: 'agent', type: 'evidence', status: 'noted' }] as any[] };
  const out = t.guardDecisionAuthor([
    { op: 'update_node', id: 'app', content: 'The application region is 224 KB; the 8 KB log ring buffer is carved from its free tail.' },
    { op: 'update_node', id: 'cfg', content: 'The 8 KB config area stays fixed at 0x0803E000 and is not used for the ring buffer.' },
  ], map, { userText: 'Take the 8 KB for the log ring buffer from the application region’s free tail, never from the config area. Keep the config page fixed at 0x0803E000.', focusContainerId: 'flash' });
  expect(out).toHaveLength(3);
  expect(out[2]).toMatchObject({ op: 'create_node', parentId: 'flash', type: 'decision', status: 'decided', author: 'user' });
  expect(out[2].content).toContain('never from the config area'); expect(out[2].content).toContain('0x0803E000');
  expect(out[0].author).toBeUndefined();                                                     // the agent's evidence stays the agent's
  expect(audits.filter((a) => a.kind === 'guard_decision_author').map((a) => a.d.how)).toEqual(['imperative-new-row']);
  // when the person's order already landed as their own node, nothing is added
  const { t: t2, audits: a2 } = harness();
  const out2 = t2.guardDecisionAuthor([{ op: 'create_node', id: 'd', parentId: 'flash', type: 'decision', status: 'decided', author: 'user', content: 'Take the 8 KB from the application region’s free tail, never from the config area; keep the config page at 0x0803E000.' }], map, { userText: 'Take the 8 KB for the log ring buffer from the application region’s free tail, never from the config area. Keep the config page fixed at 0x0803E000.', focusContainerId: 'flash' });
  expect(out2).toHaveLength(1); expect(a2).toHaveLength(0);
});

test('M472c: a curly-apostrophe order at a sentence start, and a "…, but don’t … yet" after a comma, each become the person\'s decision node when the round filed only the agent\'s outcome (Hannah t8 / t23)', () => {
  const { t, audits } = harness();
  const map = { nodes: [{ id: 'saf', title: 'Safari gallery thumbnails', content: 'x', author: 'user', type: 'container', status: 'live' }] } as any;
  const out = t.guardDecisionAuthor([{ op: 'create_node', id: 'ev', parentId: 'saf', type: 'evidence', status: 'noted', author: 'agent', content: 'The thumbnail rendering issue was inspected and the likely Safari-specific failure was reproduced as WebP decoding failure without a JPEG/PNG fallback; no code was changed.' }], map,
    { userText: 'Slack interruption: a customer says gallery thumbnails are blank in Safari. Please inspect the thumbnail rendering and image formats, reproduce the likely Safari-specific failure, and tell me what you find. Don’t fix it yet — I need to park a clear finding and go back to the webhook.', focusContainerId: 'saf' });
  const mine = out.filter((a: any) => a.author === 'user');
  expect(mine).toHaveLength(1);
  expect(mine[0].content).toMatch(/Don't fix it yet/);
  expect(audits.filter((a) => a.kind === 'guard_decision_author').map((a) => a.d.how)).toEqual(['imperative-new-row']);
  const { t: t2 } = harness();
  const out2 = t2.guardDecisionAuthor([{ op: 'update_node', id: 'fts', status: 'done', content: 'The weighted Postgres full-text search vector is implemented over title, tags, and caption, with title weighted A, tags weighted B, and caption weighted C. A GIN index and migration were added.' }],
    { nodes: [{ id: 'fts', title: 'Full-text search migration and index', content: 'y', author: 'agent', type: 'task', status: 'doing' }] } as any,
    { userText: 'Implement the weighted Postgres full-text search vector over title, tags, and caption now, with title weighted highest, then tags, then caption. Add the GIN index and migration, but don’t switch the search endpoint yet.', focusContainerId: 'search' });
  const mine2 = out2.filter((a: any) => a.author === 'user');
  expect(mine2).toHaveLength(1);
  expect(mine2[0].content).toMatch(/but don't switch the search endpoint yet/);
  // a question that merely contains an apostrophe span claims nothing (M442c stays)
  const { t: t3, audits: a3 } = harness();
  t3.guardDecisionAuthor([{ op: 'create_node', id: 'o', type: 'option', status: 'proposed', author: 'agent', content: 'Use a trigram index for fuzzy matches on titles and captions.' }], { nodes: [] } as any, { userText: 'Which is better here, a trigram index or the weighted vector? It\'s the caption matches I don\'t trust.' });
  expect(a3.filter((a) => a.kind === 'guard_decision_author')).toHaveLength(0);
});

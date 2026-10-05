// codexExecError: the error line must survive a prompt dump (#295) and hook/bubblewrap noise (#240).
import { test, expect } from 'bun:test';
import { codexExecError } from './inference';

const promptDump = Array.from({ length: 12 }, (_, i) => `(${i}) PREFERENCES: if the USER'S MAP PREFERENCES say where a kind of material goes or how it is named, that wins over every default below; the filer obeys the person's standing instructions for placement and naming, and never argues with them in the summary line. `.repeat(2)).join('\n');

test('an error line above a prompt dump is reported, not the dump tail', () => {
  const msg = codexExecError(1, `hook: pre-run\nError: request failed with status 429 rate limit exceeded\n${promptDump}\nbundled bubblewrap notice`);
  expect(msg).toContain('429');
  expect(msg).not.toContain('PREFERENCES');
});

test('with only hook and bubblewrap noise around the error, the error line wins', () => {
  const msg = codexExecError(1, `hook: a\nhook: b\nstream error: ECONNRESET while reading response\nbundled bubblewrap is not available`);
  expect(msg).toContain('ECONNRESET');
  expect(msg).not.toMatch(/hook:/);
});

test('with no error-shaped line, the last short meaningful lines are reported', () => {
  const msg = codexExecError(2, `hook: x\nsome context line\nanother short line`);
  expect(msg).toContain('another short line');
  expect(msg.startsWith('codex exec exited 2:')).toBe(true);
});

import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
// M454 (PANEL #432): the filer's statement rule and the brain's answer rule both demand the identifier verbatim.
test('the filer prompt and the brain addendum carry the verbatim-identifier rule', () => {
  const tr = readFileSync(new URL('./translator.ts', import.meta.url), 'utf8');
  expect(tr).toMatch(/VERBATIM WHERE IT MATTERS \(M454\)/);
  const ms = readFileSync(new URL('./mapstatus.ts', import.meta.url), 'utf8');
  expect(ms).toMatch(/QUOTE THE SPECIFICS \(M454/);
});

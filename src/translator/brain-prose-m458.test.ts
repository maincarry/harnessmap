import { test, expect } from 'bun:test';
import { splitBrainProse } from './mapstatus';
import { hasRequiredKeys } from '../inference';
// M458 (PANEL #441): a prose answer is still an answer; an object without the schema's required keys is not.
test('splitBrainProse separates the reply from a trailing Standing guidance section', () => {
  const r = splitBrainProse('Still open:\n- `merge_images` raises `ValueError`.\n\nStanding guidance:\n\nAnswer factual questions strictly from the live map.');
  expect(r.reply).toBe('Still open:\n- `merge_images` raises `ValueError`.');
  expect(r.guidance).toBe('Answer factual questions strictly from the live map.');
  expect(splitBrainProse('Just an answer.')).toEqual({ reply: 'Just an answer.', guidance: '' });
});
test('hasRequiredKeys rejects the brace-parsed prose object', () => {
  const schema = { type: 'object', required: ['reply', 'guidance'] };
  expect(hasRequiredKeys({}, schema)).toBe(false);
  expect(hasRequiredKeys({ reply: 'x', guidance: '' }, schema)).toBe(true);
  expect(hasRequiredKeys({ anything: 1 }, { type: 'object' })).toBe(true);
});

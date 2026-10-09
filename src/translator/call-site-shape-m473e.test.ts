// M473e (RECORD TEST #3 rerun, 2026-10-09): the brain's talk-to-map call carried `schema:` and `timeoutMs:` INSIDE a trailing `//` comment
// from v0.9.234 to v0.9.294 — a valid file, a silent loss (every answer became two unstructured calls). v0.9.287 lost a UI statement the
// same way. This test reads every source file and fails when a `//` comment on a code line contains an inference-call key followed by a
// value and a comma — the shape of a swallowed property.
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KEYS = /\b(schema|timeoutMs|maxTokens|system|user|task|audit|modelOverride):\s*[^,\n]{1,80},/;
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) { if (e !== 'node_modules') yield* files(p); } else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) yield p; }
}
function swallowed(src: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, (m) => ' '.repeat(m.length)); // blank out string literals (crude, single-line)
    const at = code.indexOf('//'); if (at < 0) return;
    if (/^\s*\/\//.test(code)) return; // a whole-line comment swallows nothing
    if (/https?:$/.test(code.slice(0, at))) return;
    const comment = line.slice(at);
    if (KEYS.test(comment)) out.push(`${i + 1}: ${line.trim().slice(0, 140)}`);
  });
  return out;
}

describe('M473e — no inference-call key lives inside a trailing // comment', () => {
  it('the shape is caught', () => {
    expect(swallowed("const x = await call({ a: 1, // note that the cap schema: S as any, timeoutMs: 180_000,\n b: 2 });")).toHaveLength(1);
    expect(swallowed("const x = await call({ a: 1, schema: S as any, timeoutMs: 180_000, // M455b note\n b: 2 });")).toHaveLength(0);
    expect(swallowed("// schema: S, timeoutMs: 1,\nconst y = 1;")).toHaveLength(0);
  });
  it('src/ has none', () => {
    const hits: string[] = [];
    for (const f of files(join(import.meta.dir, '..'))) for (const h of swallowed(readFileSync(f, 'utf8'))) hits.push(`${f.replace(/.*\/src\//, 'src/')}:${h}`);
    expect(hits).toEqual([]);
  });
});

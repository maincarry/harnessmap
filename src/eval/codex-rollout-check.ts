// M245: prove the Codex rollout parser on THIS machine — finds the newest
// rollout under ~/.codex/sessions (or takes a path) and reports what the map
// would read from it. Used by test-codex.sh / test-codex.ps1.
//   bun run src/eval/codex-rollout-check.ts [rollout.jsonl]
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sliceRound, isCodexRollout, codexSessionMeta } from '../agent/harness-adapter.js';
import { extractTranscript } from '../translator/importer.js';

let file = process.argv[2] ?? '';
if (!file) {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  let best = null as { fp: string; m: number } | null;
  const walk = (d: string, depth: number) => { let e: string[] = []; try { e = readdirSync(d); } catch { return; } for (const f of e) { const fp = join(d, f); try { const st = statSync(fp); if (st.isDirectory()) { if (depth < 3) walk(fp, depth + 1); } else if (f.startsWith('rollout-') && f.endsWith('.jsonl') && (!best || st.mtimeMs > best.m)) best = { fp, m: st.mtimeMs }; } catch {} } };
  walk(root, 0);
  const b = best as { fp: string; m: number } | null;
  if (!b) { console.log(`rollout: none found under ${root} (no Codex session on this machine yet)`); process.exit(0); }
  file = b.fp;
}
let rawText = ''; try { rawText = readFileSync(file, 'utf8'); } catch { console.log(`rollout: cannot read ${file}`); console.log('ROLLOUT FAIL'); process.exit(0); }
const lines = rawText.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } });
console.log(`rollout: ${file}`);
console.log(`recognised as a Codex rollout: ${isCodexRollout(lines)}   lines: ${lines.length}   meta: ${JSON.stringify(codexSessionMeta(lines) ?? {})}`);
const slice = await sliceRound(file, null);
const turns = extractTranscript(rawText).split('\n\n').filter(Boolean);
console.log(`turns parsed: ${turns.length} (user ${turns.filter((t) => t.startsWith('USER:')).length}, assistant ${turns.filter((t) => t.startsWith('ASSISTANT:')).length})   tool calls: ${slice.toolRefs.length}   files touched: ${slice.filePaths.length}`);
console.log(`first user line: ${(turns.find((t) => t.startsWith('USER:')) ?? '(none)').slice(0, 160).replace(/\n/g, ' ')}`);
console.log(`last assistant line: ${([...turns].reverse().find((t) => t.startsWith('ASSISTANT:')) ?? '(none)').slice(0, 160).replace(/\n/g, ' ')}`);
console.log(`ROLLOUT ${isCodexRollout(lines) && turns.length > 0 ? 'PASS' : 'FAIL'}`);

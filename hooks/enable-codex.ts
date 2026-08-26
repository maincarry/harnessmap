// Enable harnessmap for Codex (beta). Codex's hook dialect matches Claude
// Code's almost exactly (same stdin fields, same additionalContext JSON
// envelope), so the SAME hook scripts serve both harnesses — one codebase,
// zero forks (Mark's harness-agnostic ruling). Codex has no plugin system or
// path variables, so this writer registers our hooks in ~/.codex/hooks.json
// with absolute paths, merge-preserving anything already there.
//
// Run: bun run hooks/enable-codex.ts
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const HOOKS_DIR = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const wrap = (file: string) =>
  `sh -c 'if command -v bun >/dev/null 2>&1; then bun run "${HOOKS_DIR}/${file}"; else true; fi'`;

const entry = (file: string) => [{ hooks: [{ type: 'command', command: wrap(file), timeout: 60 }] }];
const ours: Record<string, any> = {
  SessionStart: entry('session-start.ts'),
  UserPromptSubmit: entry('on-prompt.ts'),
  Stop: entry('on-stop.ts'),
};

mkdirSync(CODEX_HOME, { recursive: true });
const path = join(CODEX_HOME, 'hooks.json');
let existing: any = { hooks: {} };
if (existsSync(path)) {
  try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch { existing = { hooks: {} }; }
  existing.hooks ??= {};
}
for (const [event, groups] of Object.entries(ours)) {
  const have: any[] = existing.hooks[event] ?? [];
  const already = JSON.stringify(have).includes(HOOKS_DIR);
  existing.hooks[event] = already ? have : [...have, ...groups];
}
writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');

console.log(`harnessmap hooks registered for Codex in ${path}`);
console.log('Two Codex settings to check in ~/.codex/config.toml:');
console.log('  [features]');
console.log('  hooks = true                # Codex ships hooks disabled by default');
console.log('  # and raise the context limit so the full map fits:');
console.log('  # additionalContextLimit above ~4500 tokens (our map budget is ~4k)');
console.log('All map data stays local in ~/.harnessmap, same as with Claude Code.');

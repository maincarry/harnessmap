// Enable harnessmap for Codex at the USER level (~/.codex/hooks.json) —
// the fallback when the plugin route's bundled hooks do not fire (openai/codex
// #16430 on 0.118; verified per machine). Same three-plus-two hook scripts as
// Claude Code (M160: Codex's hook dialect copied Claude Code's — same stdin
// fields, same additionalContext envelope). Absolute paths, `bun run`
// directly (Windows has no sh), additionalContextLimit so the full map block
// reaches the model (Codex caps a hook at ~2,500 tokens by default).
//
// Run: bun run hooks/enable-codex.ts          (add --remove to unregister)
// M220 (Mark, 2026-09-08): un-shelved — Codex support is its own track now.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { codexHooksFrom } from './build-codex-hooks.ts';

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const HOOKS_DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const REMOVE = process.argv.includes('--remove');
const FORCE = process.argv.includes('--force');

// Double registration guard: if the map is installed as a Codex PLUGIN whose
// bundled hooks fire, user-level hooks would file every round twice.
const pluginCache = join(CODEX_HOME, 'plugins', 'cache');
let pluginInstalled = false;
try { for (const m of readdirSync(pluginCache)) { if (existsSync(join(pluginCache, m, 'map'))) pluginInstalled = true; } } catch {}
if (pluginInstalled && !REMOVE && !FORCE) {
  console.log('harnessmap: the map is installed as a Codex plugin (~/.codex/plugins/cache/*/map) — its bundled hooks should serve you.');
  console.log('If the map does NOT appear in a new Codex session, register user-level hooks instead: bun run hooks/enable-codex.ts --force');
  console.log('(and remove the plugin: codex plugin remove map@harnessmap — never keep both, rounds would file twice)');
  process.exit(0);
}

const src = JSON.parse(readFileSync(join(HOOKS_DIR, 'hooks.json'), 'utf8'));
const derived = codexHooksFrom(src);
// absolute paths instead of ${PLUGIN_ROOT} — and the ABSOLUTE bun binary: the
// Codex app runs hooks with a GUI environment whose PATH has no ~/.bun/bin
// (Jacob's Mac had bun on PATH by luck; a fresh install would fail silently).
const BUN = process.execPath;
for (const groups of Object.values<any>(derived.hooks)) for (const g of groups as any[]) for (const h of g.hooks) h.command = String(h.command).replace('${PLUGIN_ROOT}', HOOKS_DIR.replace(/[\\/]hooks$/, '')).replace(/^bun run /, `"${BUN}" run `);

mkdirSync(CODEX_HOME, { recursive: true });
const path = join(CODEX_HOME, 'hooks.json');
let existing: any = { hooks: {} };
if (existsSync(path)) {
  try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch { existing = { hooks: {} }; }
  existing.hooks ??= {};
}
// Ours = any group whose command points into this app. Compare with separators
// and case normalised: on Windows the written command mixes "\\app" with
// "/hooks/…", and JSON doubles the backslashes — the exact-string test missed
// and every installer run appended a second copy (Mark, 2026-09-10: 5 → 10
// entries; a doubled hook files every round twice).
const norm = (t: string) => t.replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
const APP_DIR = norm(HOOKS_DIR).replace(/\/hooks$/, '');
const ours = (h: any) => norm(JSON.stringify(h)).includes(APP_DIR);
for (const [event, groups] of Object.entries<any>(derived.hooks)) {
  const have: any[] = (existing.hooks[event] ?? []).filter((g: any) => !ours(g));
  const merged = REMOVE ? have : [...have, ...(groups as any[])];
  const seen = new Set<string>();
  existing.hooks[event] = merged.filter((g: any) => { const k = norm(JSON.stringify(g)); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!existing.hooks[event].length) delete existing.hooks[event];
}
writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');

if (REMOVE) { console.log(`harnessmap hooks removed from ${path}`); process.exit(0); }
console.log(`harnessmap hooks registered for Codex in ${path} (user level, all sessions).`);
console.log('Next, in Codex: hooks you add yourself must be trusted once — open a session and accept the hook trust prompt (or run /hooks).');
console.log('Then open the map at http://127.0.0.1:8790 — it fills in as you talk. All data stays local in ~/.harnessmap.');

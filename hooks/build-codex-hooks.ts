// M220: derive hooks/codex-hooks.json from hooks/hooks.json — ONE source of
// truth (Mark's harness-agnostic ruling). Differences for Codex: the command
// is `bun run` directly (no sh — Windows), the plugin root is ${PLUGIN_ROOT},
// and the context-bearing hooks carry additionalContextLimit (Codex caps a
// hook's additionalContext at ~2,500 tokens by default; our block is ~10k).
// Run: bun run hooks/build-codex-hooks.ts   (install-smoke checks they agree)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const CONTEXT_LIMIT = 16_000; // tokens: the 5% block (~10k) with headroom
export function codexHooksFrom(src: any): any {
  const out: any = { hooks: {} };
  for (const [event, groups] of Object.entries<any>(src.hooks ?? {})) {
    out.hooks[event] = (groups as any[]).map((g) => ({ ...(g.matcher ? { matcher: g.matcher } : {}), hooks: (g.hooks ?? []).map((h: any) => {
      const m = String(h.command).match(/hooks\/([a-z-]+\.ts)/);
      const file = m ? m[1] : null;
      const cmd = file ? `bun run "\${PLUGIN_ROOT}/hooks/${file}"` : h.command;
      const ctx = ['SessionStart', 'UserPromptSubmit'].includes(event) ? { additionalContextLimit: CONTEXT_LIMIT } : {};
      return { type: 'command', command: cmd, timeout: h.timeout ?? 60, ...ctx };
    }) }));
  }
  return out;
}
if (import.meta.main) {
  const src = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'));
  writeFileSync(join(dir, 'codex-hooks.json'), JSON.stringify(codexHooksFrom(src), null, 2) + '\n');
  console.log('hooks/codex-hooks.json written');
}

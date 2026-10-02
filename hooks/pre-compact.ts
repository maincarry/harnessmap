// PreCompact: retain the legacy Claude compaction hint; Codex has no
// hook-specific output for this event and rejects that JSON envelope.
import { BASE, readHookInput, gateSession, hostHarness } from './common.ts';
const input = await readHookInput();
if (!gateSession(input, 'PreCompact')) process.exit(0); // M239
// Exit 0 with no output is a supported success. Do not guess that an unknown
// host accepts the legacy envelope either. Codex's map context is restored by
// PostCompact / SessionStart(compact), then injected by UserPromptSubmit.
// https://learn.chatgpt.com/docs/hooks#precompact
if (hostHarness(input) !== 'claude') process.exit(0);
try {
  const r = await fetch(`${BASE}/api/harness/compaction`, { signal: AbortSignal.timeout(4000) });
  const { instructions } = await r.json();
  if (instructions) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreCompact', compactionInstructions: instructions },
    }));
  }
} catch { /* default compaction */ }

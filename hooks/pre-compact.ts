// PreCompact: tell the host's compaction what the map already holds.
import { BASE, readHookInput } from './common.ts';
await readHookInput();
try {
  const r = await fetch(`${BASE}/api/harness/compaction`, { signal: AbortSignal.timeout(4000) });
  const { instructions } = await r.json();
  if (instructions) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreCompact', compactionInstructions: instructions },
    }));
  }
} catch { /* default compaction */ }

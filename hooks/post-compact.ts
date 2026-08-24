// PostCompact: the host squashed history (our injected blocks included) —
// tell map-core to re-anchor so the next turn gets the full map again.
import { BASE, readHookInput } from './common.ts';
const input = await readHookInput();
try {
  await fetch(`${BASE}/api/harness/compacted`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: input.session_id }),
    signal: AbortSignal.timeout(4000),
  });
} catch { /* fine */ }

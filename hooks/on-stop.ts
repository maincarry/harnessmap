// Stop: the round is over — hand it to map-core (which slices the transcript
// server-side, runs the filer, and records provenance).
import { BASE, readHookInput } from './common.ts';
const input = await readHookInput();
try {
  await fetch(`${BASE}/api/harness/observe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: input.session_id,
      transcript_path: input.transcript_path,
      last_assistant_message: input.last_assistant_message,
    }),
    signal: AbortSignal.timeout(8000),
  });
} catch { /* never break the host */ }

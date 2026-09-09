// Stop: the round is over — hand it to map-core (which slices the transcript
// server-side, runs the filer, and records provenance).
import { BASE, readHookInput, gateSession } from './common.ts';
const input = await readHookInput();
if (!gateSession(input, 'Stop')) process.exit(0); // M239: only the opened session
try {
  await fetch(`${BASE}/api/harness/observe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: input.session_id,
      cwd: input.cwd, // M244
      transcript_path: input.transcript_path,
      last_assistant_message: input.last_assistant_message,
    }),
    signal: AbortSignal.timeout(8000),
  });
} catch { /* never break the host */ }

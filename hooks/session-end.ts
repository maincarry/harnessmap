// SessionEnd (both harnesses): the host session is over — tell the map so the
// page shows the session as closed with the command that resumes it. The
// attachment file is NOT cleared: a resume fires SessionStart with the same
// session id and the map re-attaches by itself (M251, Mark: "once user
// resumed, ideally we should automatically re-track the session").
import { BASE, readHookInput, gateSession, hostHarness } from './common.ts';
const input = await readHookInput();
if (!gateSession(input, 'SessionEnd')) process.exit(0);
try {
  await fetch(`${BASE}/api/harness/session-end`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: input.session_id, cwd: input.cwd, reason: input.reason ?? null, harness: hostHarness(input) }),
    signal: AbortSignal.timeout(2000), // Codex gives this hook 3 s in all
  });
} catch { /* never break the host */ }

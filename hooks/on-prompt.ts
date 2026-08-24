// UserPromptSubmit: map context rides along — FULL block on the session's
// first turn, deltas after, nothing when nothing changed (M59: the
// append-only transcript must not accumulate snapshots).
import { BASE, readHookInput } from './common.ts';
const input = await readHookInput();
// M99: stash the user's prompt server-side — the ROUND's user text now comes
// from the hook itself, not from parsing CC's transcript files (whose format
// and location keep changing; a format change silently blanked user turns).
try {
  if (input.prompt) {
    fetch(`${BASE}/api/harness/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: input.session_id, text: input.prompt }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
} catch { /* fine */ }
try {
  const r = await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(input.session_id ?? '')}`, { signal: AbortSignal.timeout(4000) });
  const { context, kind } = await r.json();
  if (context) {
    const header = kind === 'delta' ? '' : '[harnessmap — the live map of this project; it is your durable memory across sessions]\n';
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: header + context },
    }));
  }
} catch { /* map server down → inject nothing */ }

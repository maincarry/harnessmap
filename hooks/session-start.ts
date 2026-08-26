// SessionStart: ensure the server is up and current, bind this directory to
// its project (auto-created on first sight), and surface the one-shot
// announcements (first-run intro / new-project line / update note) as
// additionalContext so the AGENT tells the user. The full map block is
// injected per-turn via UserPromptSubmit — not here, to avoid doubling.
import { BASE, readHookInput, ensureServer } from './common.ts';

const input = await readHookInput();
const { up, updateNote } = await ensureServer();
if (!up) process.exit(0);

// Both Claude Code and Codex report WHY the session started; a 'compact'
// source means the context was just compacted — tell the server so the next
// injection re-anchors with the FULL map (shared across harness dialects).
if (input.source === 'compact') {
  try {
    await fetch(`${BASE}/api/harness/compacted`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: input.session_id }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* never break the host */ }
}

let announce = '';
try {
  const r = await fetch(`${BASE}/api/harness/session-start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: input.session_id, transcript_path: input.transcript_path, cwd: input.cwd }),
    signal: AbortSignal.timeout(6000),
  });
  announce = ((await r.json()) as any)?.announce ?? '';
} catch { /* never break the host */ }

const notes = [announce, updateNote].filter(Boolean).join('\n');
if (notes) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: notes },
  }));
}

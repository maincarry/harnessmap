// UserPromptSubmit hook: inject the map block into this turn's context.
const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
const BASE = process.env.HARNESSMAP_URL ?? 'http://127.0.0.1:8791';
try {
  const r = await fetch(`${BASE}/api/harness/context`);
  const { context } = await r.json();
  if (context) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[harnessmap — the live map of this project; it is your memory across sessions]\n${context}`,
      },
    }));
  }
} catch { /* map server down → inject nothing, never break the host */ }

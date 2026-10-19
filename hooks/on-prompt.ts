// UserPromptSubmit: map context rides along — FULL block on the session's
// first turn, deltas after, nothing when nothing changed (M59: the
// append-only transcript must not accumulate snapshots).
import { BASE, readHookInput, gateSession, hostHarness, forkedFromOf, chosenMap } from './common.ts';
const input = await readHookInput();
if (!gateSession(input, 'UserPromptSubmit')) process.exit(0); // M239: only the opened session
// M99: stash the user's prompt server-side — the ROUND's user text now comes
// from the hook itself, not from parsing CC's transcript files (whose format
// and location keep changing; a format change silently blanked user turns).
try {
  if (input.prompt) {
    fetch(`${BASE}/api/harness/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: input.session_id, text: input.prompt, cwd: input.cwd, harness: hostHarness(input), forked_from: forkedFromOf(input.transcript_path), map: chosenMap(), host_pid: process.ppid || null, web_id: process.env.CLAUDE_CODE_BRIDGE_SESSION_ID || null, exec: process.env.CLAUDE_CODE_EXECPATH || null }), // M508: the claude binary itself, for 'resume in Desktop' later // M507: Claude Code's bridge id (session_01…) — the session's page on claude.ai // M244: cwd binds a session claimed mid-way; M245: which host; M255: a fork's parent; M401: the hook's parent IS the host CLI — its pid lets a button foreground that session's window (local only)
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
} catch { /* fine */ }
try {
  // M191c (Jacob: "of course yes"): the prompt rides along so the composer
  // can PROMOTE topics the question names — minimal → full for this turn.
  const promptQ = encodeURIComponent(String(input.prompt ?? '').slice(0, 2000));
  const r = await fetch(`${BASE}/api/harness/context?session_id=${encodeURIComponent(input.session_id ?? '')}&prompt=${promptQ}&cwd=${encodeURIComponent(String(input.cwd ?? ''))}&harness=${hostHarness(input)}`, { signal: AbortSignal.timeout(4000) });
  const { context, kind, wantHostChain, wantHostWindow } = await r.json();
  if (context) {
    const header = kind === 'delta' ? '' : '[harnessmap — the live map of this project; it is your durable memory across sessions]\n';
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: header + context },
    }));
  }
  // M503 (Mark, Windows): the server asks ONCE per session for this hook's ancestor chain — captured here, while the hook
  // and Codex's PowerShell wrapper above it are still alive (the parent pid alone is dead a second later). The context
  // was already printed above; this costs one process listing, once. Local only.
  // M506 (Mark): and the window the person just typed in — the foreground window right now — because on Windows the chain
  // of a Codex session ends at a daemon with no window. One capture each, once per session.
  if ((wantHostChain || wantHostWindow) && process.ppid) {
    try {
      const { captureHostChain, captureHostWindow } = await import('../src/host-chain.js');
      const hdr = { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000) } as const;
      if (wantHostWindow) { const w = await captureHostWindow(5000); if (w) await fetch(`${BASE}/api/harness/host-window`, { ...hdr, body: JSON.stringify({ session_id: input.session_id, window: w }) }); }
      if (wantHostChain) { const chain = await captureHostChain(process.ppid, 5000); if (chain.length) await fetch(`${BASE}/api/harness/host-chain`, { ...hdr, body: JSON.stringify({ session_id: input.session_id, chain }) }); }
    } catch { /* fine — the button says "type one message" until a record lands */ }
  }
} catch { /* map server down → inject nothing */ }

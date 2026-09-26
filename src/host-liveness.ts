// M375 — is a nominally-live host session actually detached?
// A harness (Codex/Claude) that dies without a clean SessionEnd hook leaves harness_sessions.status = 'live'
// forever, so the map's status strip kept promising "live … type there" on a session that had gone (Mark, on
// Windows: "I am pretty sure this is an old session … the status bar always reflects the current — whether we
// can attach to an active session or not"). The only honest live signals are: an embedded terminal WE own, or a
// hook fired within the idle window (every turn bumps last_active). Past that with nothing owned, the session is
// idle/detached and the strip says so + offers resume. Self-heals: any new hook activity flips it back to live.
// Kept pure and side-effect-free (no server import) so src/eval/session-idle-check.ts can pin it deterministically.
export function sessionIsIdle(
  status: string,
  embedded: boolean,
  lastActive: string | null | undefined,
  nowMs: number,
  idleMin: number,
): boolean {
  if (status === 'closed' || embedded || !lastActive) return false;
  // SQLite datetime('now') stores UTC 'YYYY-MM-DD HH:MM:SS'; make it ISO-UTC before parsing.
  const ageMs = nowMs - Date.parse(String(lastActive).replace(' ', 'T') + 'Z');
  return Number.isFinite(ageMs) && ageMs > Math.max(1, idleMin) * 60_000;
}

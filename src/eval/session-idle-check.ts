// M375 regression — the host status strip must reflect ACTUAL liveness, not a stale status='live' row.
// Pins sessionIsIdle(): a session that stopped bumping last_active (harness died without a clean SessionEnd)
// reads idle → the strip drops "live … type there" for honest resume copy; an embedded or freshly-active
// session stays live; a cleanly-closed one is handled by its own 'closed' branch, never marked idle.
import { sessionIsIdle } from '../host-liveness.js';

let pass = 0, fail = 0;
const MIN = 60_000;
const check = (name: string, got: boolean, want: boolean) => {
  if (got === want) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — got ${got}, want ${want}`); }
};

const now = Date.parse('2026-09-26T12:00:00Z');
const ago = (min: number) => new Date(now - min * MIN).toISOString().replace('T', ' ').replace(/\..*/, '');

console.log('== M375: host-session idle detection ==');
// The reported bug: a live-marked session last active hours ago (an old session) must read idle.
check('stale live session (3h) → idle', sessionIsIdle('live', false, ago(180), now, 30), true);
check('stale live session just past window (31m) → idle', sessionIsIdle('live', false, ago(31), now, 30), true);
// A genuinely active session must stay live — no nagging.
check('fresh live session (2m) → not idle', sessionIsIdle('live', false, ago(2), now, 30), false);
check('active session at the window edge (29m) → not idle', sessionIsIdle('live', false, ago(29), now, 30), false);
// We own the terminal → definitely live regardless of last_active.
check('embedded terminal, even if stale → not idle', sessionIsIdle('live', true, ago(999), now, 30), false);
// A cleanly-closed session is never "idle" (its own strip branch handles it).
check('closed session → not idle', sessionIsIdle('closed', false, ago(999), now, 30), false);
// Missing/garbage last_active must not falsely flip to idle (defensive).
check('no last_active → not idle', sessionIsIdle('live', false, null, now, 30), false);
check('unparseable last_active → not idle', sessionIsIdle('live', false, 'not-a-date', now, 30), false);
// The threshold is honoured (founder-tunable via HARNESSMAP_SESSION_IDLE_MIN).
check('custom short window (5m): 6m → idle', sessionIsIdle('live', false, ago(6), now, 5), true);
check('custom short window (5m): 4m → not idle', sessionIsIdle('live', false, ago(4), now, 5), false);

console.log(`\nsession-idle: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

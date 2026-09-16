#!/usr/bin/env bun
// M271: start (or restart onto new code) the map server the way every hook does — detached, on the hooks' home and
// database, health-waited — WITHOUT pretending to be a session. The installers, the open/restart skills and the
// doctor use this; never `HARNESSMAP_SESSION_GATE=open … session-start.ts` (that flag, inherited by the server and
// then by its own codex exec calls, let the map file itself — Jacob's Mac, 2026-09-15).
import { ensureServer, BASE } from './common.js';
const r = await ensureServer();
console.log(r.up ? `map server up at ${BASE}${r.updateNote ? ' — ' + r.updateNote.replace(/^\[harnessmap\] /, '') : ''}` : `map server did not come up — see the server log${r.updateNote ? ' — ' + r.updateNote : ''}`);
process.exit(r.up ? 0 : 1);

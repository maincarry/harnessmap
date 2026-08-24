---
name: restart
description: Restart the harnessmap server (e.g., after an update or if the map looks stuck).
---

Restart the map server:

1. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790`.
2. Stop it: `curl -s -X POST http://127.0.0.1:<port>/api/shutdown` (ignore failure if it's already down), wait ~1 second.
3. Start it again by re-running the session hook from this skill's plugin: `echo '{}' | bun run "$(dirname <path to this SKILL.md>)/../../hooks/session-start.ts"` — i.e. `<plugin root>/hooks/session-start.ts`. It spawns the server and waits for health.
4. Verify with `curl -s http://127.0.0.1:<port>/api/state` and tell the user the map is back (give the URL).

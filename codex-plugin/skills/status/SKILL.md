---
name: status
description: Show the harnessmap server status — URL, current project, node count, and where all data is stored (local only).
---

Report the map's status to the user. Steps:

1. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790` (call it PORT).
2. Fetch state: `curl -s http://127.0.0.1:$PORT/api/state`.
3. If the fetch fails, say the map server isn't running and that it starts automatically with the next session (or offer /map:restart).
4. If it succeeds, report concisely:
   - the map URL: http://localhost:PORT
   - server version (`version`), the active map name (find `projectId` in `projects` — say "map", not "project", to the user), and node count (`nodes.length`)
   - storage: the `storage` field is the database path — remind the user ALL map data lives on this machine (default `~/.harnessmap/`), nothing is sent anywhere.
5. Offer to open the map in their browser (/map:open) if they haven't.

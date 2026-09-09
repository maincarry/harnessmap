---
name: open
description: Open the map — attach harnessmap to THIS session (the map is off until the user says so) and open the map page in the browser.
---

The map is OFF by default and attaches to one session only — the one where the user says "open map". Do, in order:

1. Arm this session: `mkdir -p ~/.harnessmap && touch ~/.harnessmap/open-next` — the next map hook that fires from this session claims it; from then on this session's exchanges file onto the map and its turns receive the map's context. No other session is touched.
2. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790`.
3. If `curl -s http://127.0.0.1:<port>/api/state` fails, start the server: `echo '{}' | bun run "<plugin root>/hooks/session-start.ts"` (the plugin root is two levels above this SKILL.md), then wait 3 seconds.
4. Open `http://localhost:<port>` with the platform command: `open` (macOS), `xdg-open` (Linux), `start` (Windows). On a remote/ssh session give the URL and mention `ssh -L 8790:localhost:8790 …`.
5. Tell the user in one line: the map is attached to this session only; "close map" detaches it; an empty file `~/.harnessmap/OFF` silences it everywhere.

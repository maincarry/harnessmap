---
name: open
description: Open the map — attach harnessmap to THIS session (the map is off until the user says so) and open the map page in the browser.
---

The map is OFF by default and attaches to one session only — the one where the user says "open map". Do, in order:

1. Arm this session: macOS/Linux `mkdir -p ~/.harnessmap && touch ~/.harnessmap/open-next` · Windows PowerShell `New-Item -ItemType Directory -Force $HOME\.harnessmap | Out-Null; New-Item -ItemType File -Force $HOME\.harnessmap\open-next | Out-Null` — the next map hook that fires from this session claims it; from then on this session's exchanges file onto the map and its turns receive the map's context. No other session is touched.
2. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790` (Windows: `Get-Content $HOME\.harnessmap\port -ErrorAction SilentlyContinue`; default 8790).
3. If `curl -s http://127.0.0.1:<port>/api/state` fails, start the server from the INSTALLED app, never from a plugin cache copy (it goes stale): `echo '{}' | bun run "$HOME/.harnessmap/app/hooks/session-start.ts"` (Windows: `'{}' | bun run "$HOME\.harnessmap\app\hooks\session-start.ts"`); if that folder does not exist, tell the user to run the installer (docs/CODEX-INSTALL.md) instead of guessing a path. Then wait 3 seconds.
4. Open `http://localhost:<port>` with the platform command: `open` (macOS), `xdg-open` (Linux), `start` (Windows). On a remote/ssh session give the URL and mention `ssh -L 8790:localhost:8790 …`.
5. Tell the user in one line: the map is attached to this session only; "close map" detaches it; an empty file `~/.harnessmap/OFF` silences it everywhere.

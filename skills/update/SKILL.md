---
name: update
description: Update the map — pull the newest harnessmap, reinstall, and restart the map server (about 20 seconds; sessions keep going).
---

Update the map server to the newest code, in order:

1. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790` (Windows PowerShell: `Get-Content $HOME\.harnessmap\port -ErrorAction SilentlyContinue`, default 8790).
2. Ask the server to update itself: `curl -s -m 200 -X POST http://127.0.0.1:<port>/api/update` (PowerShell: `Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/update -TimeoutSec 200`). It pulls, reinstalls and restarts the map server on its own, and answers BEFORE restarting:
   - `{"ok":true,"changed":false}` — already current; say so and stop.
   - `{"ok":true,"changed":true,"from":"…","to":"…","restarting":true}` — wait ~10 s, then verify `curl -s http://127.0.0.1:<port>/api/state` answers and its `build` equals `to`. If `hooksChanged` is true, tell the user Codex will ask them to trust the changed hook definitions once more (`codex` → `/hooks`).
   - `{"ok":false,"error":…,"how":…}` — this copy cannot update itself (a plugin-cache copy); tell the user the `how` line.
3. Tell the user in one line: updated from → to (or already current), and that the map page reloads by itself if it was open.

Never update unless the user asked ("update map", "update the map").

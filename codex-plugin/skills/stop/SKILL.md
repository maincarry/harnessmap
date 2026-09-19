---
name: stop
description: Stop the harnessmap server. Map data is kept — everything stays in ~/.harnessmap.
---

Stop the map server:

1. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790`.
2. `curl -s -X POST http://127.0.0.1:<port>/api/shutdown`.
3. Confirm to the user: the server is stopped; ALL map data remains at `~/.harnessmap` (nothing is deleted); it will start again automatically on the next session, or stay off if they uninstall the plugin. To erase all map data completely they can delete the `~/.harnessmap` folder.

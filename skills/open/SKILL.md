---
name: open
description: Open the harnessmap map in the user's browser.
---

Open the map site for the user:

1. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790`.
2. Open `http://localhost:<port>` with the platform command: `open` (macOS), `xdg-open` (Linux), or `start` (Windows).
3. If this is a remote/ssh session where no browser can open, give the user the URL instead and mention ssh port-forwarding (`ssh -L 8790:localhost:8790 …`).

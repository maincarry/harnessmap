---
name: close
description: Close the map — detach harnessmap from this session. Map data is kept; nothing is deleted.
---

Detach the map from the session it is attached to:

1. macOS/Linux `mkdir -p .harnessmap && touch .harnessmap/close-next && rm -f .harnessmap/open-next; rm -f ~/.harnessmap/session ~/.harnessmap/open-next 2>/dev/null || true` · Windows PowerShell `New-Item -ItemType Directory -Force .harnessmap | Out-Null; New-Item -ItemType File -Force .harnessmap\close-next | Out-Null; Remove-Item -Force -ErrorAction SilentlyContinue .harnessmap\open-next, $HOME\.harnessmap\session, $HOME\.harnessmap\open-next` — the project-folder marker detaches even where the home folder is not writable (the app's sandbox); the map's next hook from this session honours it
2. Tell the user: the map is detached — no session receives its context or files onto it until someone says "open map" again; every map stays in `~/.harnessmap`.

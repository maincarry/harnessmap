---
name: close
description: Close the map — detach harnessmap from this session. Map data is kept; nothing is deleted.
---

Detach the map from the session it is attached to:

1. macOS/Linux `rm -f ~/.harnessmap/session ~/.harnessmap/open-next` · Windows PowerShell `Remove-Item -Force -ErrorAction SilentlyContinue $HOME\.harnessmap\session, $HOME\.harnessmap\open-next`
2. Tell the user: the map is detached — no session receives its context or files onto it until someone says "open map" again; every map stays in `~/.harnessmap`.

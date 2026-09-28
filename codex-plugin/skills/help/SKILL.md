---
name: help
description: List what you can say to the map — the map commands and the three moves. Use when the user says "map help", "help", "what can I say to the map", "what can the map do", "list map commands", or seems unsure what's available.
---

Show the user this list, briefly and in their language. These are natural things to *say* in chat — not slash commands.

**Commands**
- **open map** — turn the map on for THIS session (it's off everywhere until you say so) and open the map page.
- **close map** — detach the map from this session (your map data is kept).
- **map status** — server URL, current map, node count, where data is stored (all local).
- **update map** — pull the newest version and restart (~20s; your sessions keep going).
- **restart map** — restart the map server if it looks stuck.
- **stop map** — stop the server (nothing is deleted; data stays in ~/.harnessmap).
- **install the companion** — build + launch the desktop widget: a small always-there window showing your focused node and a filing pulse.
- **map doctor** — diagnose and repair the install (server, build, database, engine, hooks).
- **map help** — show this list.

**The three moves (inside a map)**
- **the map files itself** — everything you discuss lands on the map automatically as claims, questions, options, decisions; you don't curate it.
- **focus** — say "let's focus on this" (or click a node) to talk about one thing; its branch lights up and the agent leans on it.
- **light / dim** — light a branch to bring it into what the agent knows; dim one to set it aside. The map is the memory.

Close with one line: everything is local in `~/.harnessmap`; say "map doctor" if anything looks wrong.

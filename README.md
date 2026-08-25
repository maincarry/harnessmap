# harnessmap — the map is the memory

A live map of your work beside Claude Code. Everything you discuss — goals,
decisions, questions, evidence — **files itself onto a map** as you talk, and
the map becomes the agent's governed memory: you *focus* it, *light* and *dim*
branches to control exactly what the agent knows, approve its cleanup
proposals, and undo anything. A file manager for the AI's mind.

Three ideas, and everything else follows:

1. **A map** of your work — a tree that files itself as you talk.
2. **Focus ▶** — *talk about this.*
3. **Light ☀** — *keep this in the background* (dim it, and Claude forgets it — you still see everything).

Underneath: every restructuring is propose → approve, everything is undoable, and all data lives in `~/.harnessmap` on your machine — nothing is sent anywhere, no API key, no extra account.

## Install

Requirements: [Claude Code](https://claude.com/claude-code) and [bun](https://bun.sh)
(if bun is missing, Claude will notice and offer to install it for you).

Inside Claude Code:

```
/plugin marketplace add maincarry/harnessmap
/plugin install map@harnessmap
```

Then just start `claude` in any project folder. On the first session the map
server starts itself, Claude introduces the map once — including where the
data lives — and offers to open it: **http://localhost:8790**.

Every project folder gets its own map automatically. Talk, then watch the left
pane: your conversation is filing itself.

## The 60-second tour

Open the map page and press **?** for the guided tutorial. The short version:

- **▶ focus** — the one node the conversation is aimed at. The focus path is protected; you can't accidentally cut the agent off from its topic.
- **☀ light / dim** — the agent only sees lit branches. Dimmed stays visible to *you*, invisible to *it*.
- **● dots** — the map's own suggestions (cleanups, placements). Click to see a before/after; nothing applies without you.
- **⟳ tidy / ⟳ tidy top level** — ask for a cleanup proposal of any subtree, or of the top level itself.
- **↩ undo** — delete, merge, tidy, move: all reversible (Ctrl/Cmd+Z).
- **🔧 dev mode** — see every agent call and injected context, verbatim.
- **+ session** — new sessions fork your view or start fresh, aimed at a topic you pick, talking through a real embedded Claude Code terminal or the built-in chat.

## Skills

| Command | Does |
|---|---|
| `/map:status` | server URL, current map, node count, where the data lives |
| `/map:open` | open the map in your browser |
| `/map:stop` | stop the server (all data stays in `~/.harnessmap`) |
| `/map:restart` | restart it (after an update, or if the map looks stuck) |

## Privacy & data

Everything is local-only by construction: the server binds to `127.0.0.1`, the
database is `~/.harnessmap/map.sqlite`, and no network calls leave your machine
except the model calls Claude Code itself makes through your existing login.
Uninstalling the plugin stops the integration; your data stays in
`~/.harnessmap` until you delete that folder.

## Updates

The plugin and server version-handshake on session start: after you update the
plugin, the server restarts itself on the new code and tells you what changed
in one line. Note: Claude Code disables auto-update for third-party
marketplaces by default — update with `/plugin` → marketplace update (or
reinstall) when you want the latest.

## Developing / running from source

```sh
bun install
bun run src/server.ts            # → http://localhost:8790
```

No API key is needed — inference runs through the Claude Code subscription
path. (`.env.example` documents optional overrides: port, network binding with
mandatory auth, model pins.)

Tests (all keyless):

```sh
bun run src/eval/integration.ts  # 165 end-to-end checks against a real server
bun run src/eval/ui-smoke.ts     # 124 UI checks — boots the real page and clicks through it
bun run src/eval/install-smoke.ts # fresh-machine install simulation (hooks → spawn → announce)
bun run eval essay               # the judgment gate: corpus replay, graded
```

Design: [`DESIGN.md`](DESIGN.md) · decision log: [`docs/MODLOG.md`](docs/MODLOG.md)

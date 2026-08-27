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
- **⟳ to tidy** — a pinned folder at the bottom collecting the map's own suggestions (cleanups, placements). Click one to see a before/after; nothing applies without you.
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

## Codex (beta)

The same map works beside [OpenAI's Codex CLI](https://developers.openai.com/codex) — Codex's
hook dialect matches Claude Code's, so the identical hooks serve both. Codex has
no plugin system, so setup is three terminal steps instead of two slash commands:

```sh
# 1. put harnessmap on your machine (the engine lives here; you never work in it)
git clone https://github.com/maincarry/harnessmap ~/harnessmap
cd ~/harnessmap && bun install

# 2. connect it to Codex (writes the hooks into ~/.codex/hooks.json, merge-safe)
bun run hooks/enable-codex.ts
```

3. Codex ships hooks disabled — opt in by adding to `~/.codex/config.toml`:

```toml
[features]
hooks = true
additional_context_limit = 8000   # our map needs more room than Codex's default
```

Then run `codex` in any project folder as usual and open the map at
**http://localhost:8790** — each project gets its own map, and it fills itself
in as you talk. Codex hooks are experimental on their side (no Windows), so
treat this as beta. One map, both agents — and if you use Claude Code and Codex
in the same folder, they share one memory.

## Privacy & data

Everything is local-only by construction: the server binds to `127.0.0.1`, the
database is `~/.harnessmap/map.sqlite`, and no network calls leave your machine
except the model calls Claude Code itself makes through your existing login —
plus one tiny disclosed exception: a daily version check fetches the latest
release number from GitHub (nothing about you or your data is sent).
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

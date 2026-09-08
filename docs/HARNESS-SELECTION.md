# Harness selection, made universal (plan, 2026-09-08)

Mark: "make sure we have a clear way for user to select using claude code or codex when create a new session. Devise and plan to make harness selection universal."

## Where a harness shows up today

| Surface | Claude Code | Codex | Status |
|---|---|---|---|
| The hooks that inject the map and hand back each round | plugin hooks | same three scripts, Codex dialect (M160/M220) | shared |
| The embedded terminal behind a session tab | `claude` in a PTY | `codex` in a PTY | built (M221) |
| The "＋ session → talk via" choice | Claude Code terminal / chat | one radio per installed harness; last choice is the default | built (M221) |
| The map's own agents (filer, guide, brain, import) | `claude -p` on the Claude plan, or the API | `codex exec` on the ChatGPT plan (M220) | built |
| The pane chat (💬 chat) | Claude Agent SDK | — | Claude only |
| Which harness a hook session belongs to | inferred from the payload's model slug, recorded per session | same | built (M221) |
| First-run copy, close-session copy (`claude --resume` / `codex resume`) | per harness | per harness | built (M221) |
| Per-cwd instructions file | MAP.md (read by both) | AGENTS.md is Codex's native file | open |

## The universal shape

One registry, one adapter per harness, everything else harness-blind:

```
Harness = { id, label, cmd, resume, hookDialect, available(), sessionOf(payload) }
```

- `src/term.ts` holds the registry (id, label, the fixed binary, the resume command). Availability = the binary on PATH, cached 30 s. Adding a harness is one entry.
- The hooks stay one set of scripts; a dialect difference (Codex's `additionalContextLimit`, `${PLUGIN_ROOT}`) lives in the derived hooks file (hooks/build-codex-hooks.ts), never in the scripts.
- The server never asks "is this Claude?" — it asks the registry. The session row records `harness`; the sessions list and the tab show its glyph; copy that names a command reads `resume` from the registry.
- Inference backends are chosen by what is installed and by the user (⚙ models): subscription (claude), api, codex. A fourth harness with a headless CLI is a fourth backend.

## What remains

1. **Pane chat for Codex users.** The 💬 chat runs on the Claude Agent SDK. Either route it through the codex backend with the same composed context (one call per turn, no tools), or hide the chat option when Claude is not installed and offer the Codex terminal. Recommendation: route it — the composer already builds the whole context; the SDK adds nothing the codex backend lacks except tools.
2. **AGENTS.md.** Codex reads AGENTS.md the way Claude Code reads CLAUDE.md. The MAP.md writer should also refresh a short block in AGENTS.md (fenced, replace-in-place) when a Codex session is bound to the folder.
3. **Sessions list glyph.** ▦ sessions shows the harness per session from the recorded setting.
4. **Windows terminal.** Bun's PTY on Windows is unverified; `script(1)` does not exist there. If the embedded terminal cannot open, the tab falls back to chat with a note. Mark's Windows test decides.
5. **A third harness** (Gemini CLI, Cursor's agent) when its hook dialect is known: one registry entry, one derived hooks file, one backend if it has a headless mode.

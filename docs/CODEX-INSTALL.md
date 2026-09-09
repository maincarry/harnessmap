# HarnessMap for Codex users — the easiest install (research, 2026-09-08)

Question (Mark): the easiest way for someone to install the map when they use (1) the Codex app, (2) the Codex CLI.

## What the map needs from a harness

1. A hook before every prompt that returns the map block as additional context (UserPromptSubmit → additionalContext).
2. A hook after every turn that hands us the round to file (Stop, with transcript_path / last_assistant_message).
3. A hook at session start (re-anchor after compaction).
4. A model backend for the map's own agents (today `claude -p` on the user's Claude subscription).
5. A local server and the map page (bun; unchanged).

## What Codex offers today (September 2026)

- Hooks are stable (feature `hooks`, on by default). Same events and the same stdin fields and JSON envelope as Claude Code: SessionStart, UserPromptSubmit, Stop, PreCompact/PostCompact, etc. Our three hook scripts already serve both (M160). Hooks are loaded from `~/.codex/hooks.json`, inline `[hooks]` in `config.toml`, a repo's `.codex/`, or a plugin's `hooks/hooks.json`.
- Non-managed hooks (ours) must be trusted once by the user before they run.
- additionalContext is capped at ~2,500 tokens per hook by default; the cap is a per-hook key `additionalContextLimit` (tokens). Our 5% block is ~10k tokens, so the hook entry must set it. Oversized output spills to a file with a preview, which is not usable for us.
- The CLI renders hook context as a visible developer card in the transcript (open issues #16933, #20766, #21696 ask to collapse it). Every turn would show our block. Cosmetic, but real.
- Plugins: `.codex-plugin/plugin.json` + `skills/` + `hooks/hooks.json` + `.mcp.json`; marketplaces at `.agents/plugins/marketplace.json` (legacy `.claude-plugin/marketplace.json` is read too). Hook commands get `${PLUGIN_ROOT}` and, for compatibility, `${CLAUDE_PLUGIN_ROOT}` — our hooks.json may work verbatim. Install: `codex plugin marketplace add <owner/repo | git url | local dir>` then `codex plugin add <plugin@marketplace>`, or `/plugins` in the TUI; the desktop app installs from its Plugins tab and needs a restart for local plugins. Publishing to the official directory is not self-serve yet; git marketplaces work.
- Plugin-bundled hooks: issue #16430 (v0.118) reported they were not executed — only `~/.codex/hooks.json`; the May docs say bundled hooks work and toggle with the plugin. Must be verified on a current CLI (0.153 as of 2026-09-03).
- The app, the CLI and the IDE extension share `~/.codex/config.toml` and the MCP config. Third-party reports say the desktop app fires SessionStart, UserPromptSubmit and Stop hooks. Not verified by us.
- `codex exec` is the non-interactive runner: prompt on stdin (`codex exec -`), `-m <model>`, `--output-schema <json schema>`, `-o <file>` for the final message, `--ephemeral`, `--skip-git-repo-check`, sandbox flags. Runs on ChatGPT auth (`~/.codex/auth.json`) or `CODEX_API_KEY`. Models: gpt-5.6 Luna (cheapest), Terra (balanced), Sol (flagship); gpt-5.4-mini also exists.

## The easiest option

**One package, installed two ways, plus a `codex exec` backend.**

Make the repo a Codex plugin as well as a Claude Code plugin — same files, one more manifest:

- `.codex-plugin/plugin.json` beside `.claude-plugin/plugin.json` (name `map`, `skills: ./skills/`, `hooks: ./hooks/hooks.json`).
- `hooks/hooks.json` stays shared; add `additionalContextLimit` to the UserPromptSubmit entry (Codex ignores unknown keys? — verify; Claude Code ignores it).
- `.agents/plugins/marketplace.json` listing the plugin from the repo (source local `./`). Codex also reads our existing `.claude-plugin/marketplace.json`.

Then:

1. **Codex CLI:** `codex plugin marketplace add <our github>` → `codex plugin add map@harnessmap` → trust the hooks when asked → new session. If bundled hooks still don't fire (issue #16430), the fallback is what M160 built: `bun run hooks/enable-codex.ts` writes `~/.codex/hooks.json` with absolute paths and the context limit. Both paths share the three scripts.
2. **Codex app:** same plugin from the Plugins tab (git marketplace, or a local folder) → restart the app → trust hooks. Config is shared with the CLI, so a CLI install also serves the app.
3. **The map's own agents on the user's ChatGPT plan:** a third inference backend `codex` beside `subscription` (claude -p) and `api`: `codex exec - -m <model> --ephemeral --skip-git-repo-check --sandbox read-only --output-schema <schema> -o <out>` with the prompt on stdin. Tiers: Luna / Terra / Sol. The ⚙ models page (M217) already lets the user pick per role; the catalog gains the OpenAI ids when the backend is `codex`. Auto-detect: if `claude` is absent and `codex` is present, backend = codex.

## What must be validated on a real machine (Mark's Mac)

- Bundled plugin hooks fire on a current CLI and in the app (else the enable-codex fallback).
- `additionalContextLimit` on our hook entry is honored and the full block reaches the model.
- The Stop payload carries what on-stop.ts reads (transcript_path or last_assistant_message).
- `codex exec --output-schema` returns strict JSON on ChatGPT auth at our sizes (filer prompt ≈ 40k chars, import ≈ 200k).
- Cost/latency of Luna as the per-turn filer.

## Effort

Manifest + marketplace + limit key: an hour. The `codex` backend with schema and retries: half a day, plus the smoke suite section for it. Validation on the Mac: an afternoon with Codex installed.

Sources: developers.openai.com/codex (plugins, build, hooks, non-interactive, cli/reference, config), github.com/openai/codex issues #16430, #16933, #20766, #21696, github.com/awn3x/Hooks-for-Codex, codex.danielvaughan.com plugin-marketplace articles (2026-03..05), openai.com/index/gpt-5-6.

## What the first real install taught (Jacob's Mac, 2026-09-09) — and the prompt that now guides it

Codex does not run plugin-bundled hooks (openai/codex #16430, open); user-added hooks are skipped silently until trusted (#35306); the Codex APP has no /hooks — only the CLI can grant trust, and the two share ~/.codex. So the working path is: user-level hooks (the installer does it), the skills as a plugin, one manual step — `codex` in a terminal, `/hooks`, trust harnessmap — then a new thread anywhere. The installer starts the server and opens the map page itself; `test-codex.sh` is the one-command check. Our own bugs found the same night: a typographic ellipsis after `$APP` (bash read it as a variable), the raw CDN serving a stale copy (pin the URL to a commit), a test protocol whose server died between Codex's commands (start it with nohup inside one command), and the pane-chat "you have NO tools" paragraph riding into host sessions (M235).

### The prompt to paste into a Codex thread

Install and verify "harnessmap", a local map plugin for Codex, on this machine. Run every command yourself, show me its output, and continue unless a step says FAIL. Do not install anything else and do not edit files by hand.

1. Report: `codex --version ; git --version ; bun --version` (bun may be missing — fine, the installer adds it).
2. Run the installer for this OS and paste its full output — macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/install-codex.sh | bash` · Windows PowerShell: `irm https://raw.githubusercontent.com/maincarry/harnessmap/main/install-codex.ps1 | iex` (pin `main` to a commit if the CDN serves a stale copy). Tell me whether the map page opened.
3. macOS/Linux: run the check as ONE command and paste its SUMMARY block: `bash <(curl -fsSL https://raw.githubusercontent.com/maincarry/harnessmap/main/test-codex.sh)`. Windows: from `$HOME\.harnessmap\app` run `bun run src/eval/install-smoke.ts` and paste the last 5 lines. Every row should say PASS; on FAIL paste the log tail and stop.
4. Paste `cat ~/.codex/hooks.json` (Windows: `type $HOME\.codex\hooks.json`): five events whose commands point into ~/.harnessmap/app/hooks/.
5. Stop and report one line each: installer · check · hooks file. Then print for the human: "ONE MANUAL STEP Codex requires: open a terminal in any project folder, run `codex`, type `/hooks`, trust the harnessmap entries. Then start a NEW thread and say: Remember: we chose blue for the header because it is calmer. Within ~30 s a node with that decision appears on http://127.0.0.1:8790."

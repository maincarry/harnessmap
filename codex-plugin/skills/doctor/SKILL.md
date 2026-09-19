---
name: doctor
description: Map doctor — diagnose and repair the map install (server, build, updates, database, engine and sign-in, hooks, a live engine probe). Use when anything about the map looks wrong, or when the user says "check the map", "map doctor", "the map is not working".
---

Run the doctor and relay its report. Steps:

1. Run the doctor from the INSTALLED APP (the plugin package carries skills only, no `hooks/`): macOS/Linux `bun run "$HOME/.harnessmap/app/hooks/doctor.ts" --fix` · Windows PowerShell `& bun run "$env:USERPROFILE\.harnessmap\app\hooks\doctor.ts" --fix`. If you are working in a checkout of the harnessmap repo instead, the same script is at `<repo>/hooks/doctor.ts`. It takes up to a minute (it makes one tiny call through the engine). A WARN line saying it could not check the sign-in (for example inside a sandbox with no home directory) is not a sign-out — ask the user to run `codex login status` themselves. If `bun` is not on PATH, try `~/.bun/bin/bun`.
2. Show the user the report as it is (do not summarize it away), YOU lines first: those are the steps only the user can take — trusting the hooks in `codex` → `/hooks`, or signing in. FIX lines say what the doctor already repaired; FAIL lines are what it could not.
3. If a line says a newer map is available and the user wants it, run the update skill ("update map") or rerun the doctor with `--update`.
4. Never run `--update` on your own — only when the user asked for the update.

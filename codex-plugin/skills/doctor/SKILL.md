---
name: doctor
description: Map doctor — diagnose and repair the map install (server, build, updates, database, engine and sign-in, hooks, a live engine probe). Use when anything about the map looks wrong, or when the user says "check the map", "map doctor", "the map is not working".
---

Run the doctor and relay its report. Steps:

1. Run, from this skill's plugin root (the folder holding `hooks/` and `src/`): macOS/Linux `bun run "<plugin root>/hooks/doctor.ts" --fix` · Windows PowerShell `& bun run "<plugin root>\hooks\doctor.ts" --fix`. It takes up to a minute (it makes one tiny call through the engine). If `bun` is not on PATH, try `~/.bun/bin/bun`.
2. Show the user the report as it is (do not summarize it away), YOU lines first: those are the steps only the user can take — trusting the hooks in `codex` → `/hooks`, or signing in. FIX lines say what the doctor already repaired; FAIL lines are what it could not.
3. If a line says a newer map is available and the user wants it, run the update skill ("update map") or rerun the doctor with `--update`.
4. Never run `--update` on your own — only when the user asked for the update.

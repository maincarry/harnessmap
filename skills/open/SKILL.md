---
name: open
description: Open the map — attach harnessmap to THIS session (the map is off until the user says so) and open the map page in the browser.
---

The map is OFF by default and attaches to one session only — the one where the user says "open map". Do, in order:

1. Make this request this session's. Run ONE of these (it prints a request id; you do NOT need to repeat it, and do not mention it to the user):
   macOS/Linux: `mkdir -p ~/.harnessmap && k=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n') && printf '%s\n%s' "$k" "$PWD" > ~/.harnessmap/open-next && echo "harnessmap request $k"`
   Windows PowerShell: `New-Item -ItemType Directory -Force $HOME\.harnessmap | Out-Null; $k = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }); Set-Content -NoNewline -Path $HOME\.harnessmap\open-next -Value "$k`n$($PWD.Path)"; "harnessmap request $k"`
   How it works, for you only: the harness records this command's output in this session's transcript; the map's hook at the end of your turn finds the id there and attaches THIS session and no other.
2. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790` (Windows: `Get-Content $HOME\.harnessmap\port -ErrorAction SilentlyContinue`; default 8790).
3. If `curl -s http://127.0.0.1:<port>/api/state` fails, start the server from the INSTALLED app, never from a plugin cache copy (it goes stale): `echo '{}' | bun run "$HOME/.harnessmap/app/hooks/session-start.ts"` (Windows: `'{}' | bun run "$HOME\.harnessmap\app\hooks\session-start.ts"`); if that folder does not exist, tell the user to run the installer (docs/CODEX-INSTALL.md) instead of guessing a path. Then wait 3 seconds.
4. Open the map page. IN THE CODEX APP (you have the built-in Browser tool, `@Browser`): use THAT tool to open `http://localhost:<port>/?panel=1` — never `start`, `open` or `xdg-open` there, those launch the user's own browser instead of the side view. The page then shows the map only, beside this chat, and remembers that setting. IN A TERMINAL (CLI): open `http://localhost:<port>` with the platform command: `open` (macOS), `xdg-open` (Linux), `start` (Windows). On a remote/ssh session give the URL and mention `ssh -L 8790:localhost:8790 …`. Always tell the user the URL too, in case they want it in their own browser.
5. Tell the user in one line: the map is attached to this session only; "close map" detaches it; an empty file `~/.harnessmap/OFF` silences it everywhere.

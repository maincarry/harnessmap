---
name: open
description: Open the map — attach harnessmap to THIS session (the map is off until the user says so) and open the map page in the browser.
---

The map is OFF by default and attaches to one session only — the one where the user says "open map". Do, in order:

1. Which map? If the user named one ("open map thesis"), that is the choice — skip to step 2. Otherwise, with the server up (steps 2–3 first if it is not), run
   `curl -s "http://127.0.0.1:<port>/api/maps?cwd=$PWD"` (Windows: `irm "http://127.0.0.1:<port>/api/maps?cwd=$($PWD.Path)"`).
   - If `maps` holds ONE map, the choice is that map — do not ask.
   - If it holds several, ASK and END YOUR TURN with nothing else done:
     Which map?
     1) <first map name> — this folder's map            ← when folderMap is set; otherwise the first map is "default" — write: 1) default — the default map
     2) <next map name>
     3) …                                                ← every other map, in the order given (already by last use); no times, no counts
     N) create a map for this folder: <suggestedFolderMapName>   ← last line, only when folderMap is null and scratchFolder is false
     Reply with a number or a name (Enter = 1).
   On the user's next message, take their number or name as the choice (a number is the line they picked; a name is matched by the server; "create a map for this folder" = the folder's suggested name).
1b. Make this request this session's. Run ONE of these with the choice (it prints a request id; you do NOT need to repeat it, and do not mention it to the user):
   macOS/Linux: `mkdir -p .harnessmap && k=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n') && printf '%s\n%s\nmap=%s' "$k" "$PWD" "<the chosen map's name or id>" > .harnessmap/open-next && echo "harnessmap request $k"`
   Windows PowerShell: `New-Item -ItemType Directory -Force .harnessmap | Out-Null; $k = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }); Set-Content -NoNewline -Path .harnessmap\open-next -Value "$k`n$($PWD.Path)`nmap=<the chosen map's name or id>"; "harnessmap request $k"`
   (The file goes in the project's own .harnessmap folder, which you can write without asking.) How it works, for you only: the harness records this command's output in this session's transcript; the map's hook at the end of your turn finds the id there and attaches THIS session, to THAT map, and no other.
2. Read the port: `cat ~/.harnessmap/port 2>/dev/null || echo 8790` (Windows: `Get-Content $HOME\.harnessmap\port -ErrorAction SilentlyContinue`; default 8790).
3. If `curl -s http://127.0.0.1:<port>/api/state` fails, start the server from the INSTALLED app, never from a plugin cache copy (it goes stale): `echo '{}' | bun run "$HOME/.harnessmap/app/hooks/session-start.ts"` (Windows: `'{}' | bun run "$HOME\.harnessmap\app\hooks\session-start.ts"`); if that folder does not exist, tell the user to run the installer (docs/CODEX-INSTALL.md) instead of guessing a path. Then wait 3 seconds.
4. Open the map page. IN THE CODEX APP (you have the built-in Browser tool, `@Browser`): use THAT tool to open `http://localhost:<port>/?panel=1` — never `start`, `open` or `xdg-open` there, those launch the user's own browser instead of the side view. The page then shows the map only, beside this chat, and remembers that setting. IN A TERMINAL (CLI): open `http://localhost:<port>` with the platform command: `open` (macOS), `xdg-open` (Linux), `start` (Windows). On a remote/ssh session give the URL and mention `ssh -L 8790:localhost:8790 …`. Always tell the user the URL too, in case they want it in their own browser.
5. Tell the user in one line: the map is attached to this session only; "close map" detaches it; an empty file `~/.harnessmap/OFF` silences it everywhere.

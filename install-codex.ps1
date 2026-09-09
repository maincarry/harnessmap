# HarnessMap for Codex - one command (Windows PowerShell):
#   irm https://raw.githubusercontent.com/maincarry/harnessmap/main/install-codex.ps1 | iex
# Installs bun if missing, puts the app in ~\.harnessmap\app, registers the hooks at the USER level
# (~\.codex\hooks.json), registers the skills as a Codex plugin, starts the map, and prints the one
# manual step Codex requires (trust the hooks in the CLI).
$ErrorActionPreference = 'Stop'
$App = if ($env:HARNESSMAP_APP) { $env:HARNESSMAP_APP } else { Join-Path $HOME '.harnessmap\app' }
$Repo = if ($env:HARNESSMAP_REPO) { $env:HARNESSMAP_REPO } else { 'https://github.com/maincarry/harnessmap.git' }
$B = 'http://127.0.0.1:8790'
function Say($m) { Write-Host $m -ForegroundColor Cyan }
function State { try { return Invoke-RestMethod "$B/api/state" -TimeoutSec 3 } catch { return $null } }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is not on PATH - install Git for Windows (https://git-scm.com/download/win), reopen PowerShell, rerun." }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Say "installing bun (the map's runtime)..."; irm bun.sh/install.ps1 | iex; $env:Path = "$HOME\.bun\bin;$env:Path" }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { Say "codex is not on PATH - install the Codex CLI (npm i -g @openai/codex) or the Codex app first; the map's hooks will attach once it is." }
New-Item -ItemType Directory -Force -Path (Split-Path $App) | Out-Null
if (Test-Path (Join-Path $App '.git')) { Say "updating $App..."; try { git -C $App pull -q --ff-only } catch {} } else { Say "fetching the map into $App..."; git clone -q $Repo $App }
Push-Location $App; try { bun install --production | Out-Null } catch {} ; Pop-Location
# Codex does not execute plugin-bundled hooks yet (openai/codex #16430), and hooks the user adds are
# skipped until trusted, often without a prompt (#35306). So: user-level hooks, then /hooks in the CLI.
Push-Location $App; try { bun run hooks/enable-codex.ts --force } catch { Pop-Location; throw "could not register the hooks - see the error above" }; Pop-Location
if (Get-Command codex -ErrorAction SilentlyContinue) {
  try { codex plugin marketplace add $App | Out-Null; codex plugin add map@harnessmap | Out-Null; Say "skills registered as a Codex plugin (marketplace 'harnessmap', plugin 'map')" } catch {}
}
# a server already running on OLDER code is restarted (M236): the build it reports must match the app on disk
$Head = ''; try { $Head = (git -C $App rev-parse --short HEAD).Trim() } catch {}
$st = State
if ($st -and $Head -and ($st.build -ne $Head)) {
  Say "restarting the map server on the updated code ($($st.build) -> $Head)"
  try { Invoke-RestMethod -Method Post "$B/api/shutdown" -TimeoutSec 3 | Out-Null } catch {}
  Start-Sleep -Seconds 2
  Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" | Where-Object { $_.CommandLine -like '*src/server.ts*' -or $_.CommandLine -like '*src\server.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}
if (-not (State)) {
  $bun = (Get-Command bun).Source
  Start-Process -FilePath $bun -ArgumentList "run","src/server.ts" -WorkingDirectory $App -WindowStyle Hidden -RedirectStandardOutput (Join-Path $HOME ".harnessmap\server.log") -RedirectStandardError (Join-Path $HOME ".harnessmap\server.err.log") | Out-Null
  foreach ($i in 1..12) { Start-Sleep -Seconds 1; if (State) { break } }
}
if (State) { Say "the map is up at $B"; Start-Process $B } else { Say "the map server did not answer - see ~\.harnessmap\server.err.log" }
Write-Host ""; Write-Host "ONE MANUAL STEP (Codex requires it; nothing can do it for you):" -ForegroundColor Yellow
Write-Host "  1. open a terminal in any project folder and run:  codex"
Write-Host "  2. type  /hooks  and trust the harnessmap entries (Codex skips untrusted hooks silently; the CLI can trust them, the app cannot, and both share the setting)"
Write-Host "  3. start a NEW thread (CLI or app) and say:  open map  - the map attaches to THAT session only (it is off everywhere else); say  close map  to detach"
Say "To check any time:  irm https://raw.githubusercontent.com/maincarry/harnessmap/main/test-codex.ps1 | iex"
Say "All data stays in ~\.harnessmap."

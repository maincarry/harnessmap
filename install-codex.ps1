# HarnessMap for Codex — one command (Windows PowerShell):
#   irm https://raw.githubusercontent.com/maincarry/harnessmap/main/install-codex.ps1 | iex
# Installs bun if missing, puts the app in ~\.harnessmap\app, registers it as a Codex plugin (marketplace + plugin),
# and prints the two things Codex asks of you (trust the hooks, new session).
$ErrorActionPreference = 'Stop'
$App = if ($env:HARNESSMAP_APP) { $env:HARNESSMAP_APP } else { Join-Path $HOME '.harnessmap\app' }
$Repo = if ($env:HARNESSMAP_REPO) { $env:HARNESSMAP_REPO } else { 'https://github.com/maincarry/harnessmap.git' }
function Say($m) { Write-Host $m -ForegroundColor Cyan }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Say "installing bun (the map's runtime)..."; irm bun.sh/install.ps1 | iex; $env:Path = "$HOME\.bun\bin;$env:Path" }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { Say "codex is not on PATH — install the Codex CLI (npm i -g @openai/codex) or the Codex app first; the map's hooks will attach once it is." }
New-Item -ItemType Directory -Force -Path (Split-Path $App) | Out-Null
if (Test-Path (Join-Path $App '.git')) { Say "updating $App..."; git -C $App pull -q --ff-only } else { Say "fetching the map into $App..."; git clone -q $Repo $App }
Push-Location $App; try { bun install --production | Out-Null } catch {} ; Pop-Location
$pluginOk = $false
if (Get-Command codex -ErrorAction SilentlyContinue) {
  try { codex plugin marketplace add $App | Out-Null; codex plugin add map@harnessmap | Out-Null; $pluginOk = $true } catch { $pluginOk = $false }
}
if ($pluginOk) {
  Say "installed as a Codex plugin (marketplace 'harnessmap', plugin 'map')."
  Say "Next: start a NEW Codex session (or restart the Codex app) and accept the hook trust prompt when it appears."
  Say "If the map does not appear after that: bun run `"$App\hooks\enable-codex.ts`" --force  (user-level hooks)"
} else {
  Say "registering user-level hooks (plugin install did not succeed, or codex is missing)."
  Push-Location $App; bun run hooks/enable-codex.ts --force; Pop-Location
}
$srv = Start-Process -FilePath "bun" -ArgumentList "run","src/server.ts" -WorkingDirectory $App -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $HOME ".harnessmap\server.log") -RedirectStandardError (Join-Path $HOME ".harnessmap\server.err.log") -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6
try { Invoke-RestMethod http://127.0.0.1:8790/api/state -TimeoutSec 3 | Out-Null; Say "the map is up at http://127.0.0.1:8790"; Start-Process "http://127.0.0.1:8790" } catch { Say "the map server did not answer - see ~\.harnessmap\server.err.log" }
Write-Host ""; Write-Host "ONE MANUAL STEP (Codex requires it; nothing can do it for you):" -ForegroundColor Yellow
Write-Host "  1. open a terminal in any project folder and run:  codex"
Write-Host "  2. type  /hooks  and trust the harnessmap entries (Codex skips untrusted hooks silently; the CLI can trust them, the app cannot, and both share the setting)"
Write-Host "  3. start a NEW thread (CLI or app) and say:  open map  - the map attaches to THAT session only (it is off everywhere else); say  close map  to detach"
Say "All data stays in ~\.harnessmap."

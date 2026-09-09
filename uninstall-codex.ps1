# HarnessMap for Codex - uninstall (Windows PowerShell):
#   irm https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.ps1 | iex                       # hooks, plugin, server
#   $env:HARNESSMAP_PURGE=1; irm https://raw.githubusercontent.com/maincarry/harnessmap/main/uninstall-codex.ps1 | iex   # ... and the app + ALL map data in ~\.harnessmap
$ErrorActionPreference = 'Continue'
$App = if ($env:HARNESSMAP_APP) { $env:HARNESSMAP_APP } else { Join-Path $HOME '.harnessmap\app' }
function Say($m) { Write-Host $m -ForegroundColor Cyan }
Say "stopping the map server"; try { Invoke-RestMethod -Method Post http://127.0.0.1:8790/api/shutdown -TimeoutSec 3 | Out-Null } catch {}; Start-Sleep 1
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" | Where-Object { $_.CommandLine -like '*src/server.ts*' -or $_.CommandLine -like '*src\server.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $App 'hooks\enable-codex.ts')) { Say "removing the hooks from ~\.codex\hooks.json"; Push-Location $App; bun run hooks/enable-codex.ts --remove; Pop-Location }
if (Get-Command codex -ErrorAction SilentlyContinue) { Say "removing the plugin and marketplace"; codex plugin remove map@harnessmap 2>$null | Out-Null; codex plugin marketplace remove harnessmap 2>$null | Out-Null }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $HOME '.harnessmap\session'), (Join-Path $HOME '.harnessmap\open-next')
if ($env:HARNESSMAP_PURGE -eq '1') { Say "deleting ~\.harnessmap (the app and every map)"; Remove-Item -Recurse -Force (Join-Path $HOME '.harnessmap') -ErrorAction SilentlyContinue } else { Say "kept ~\.harnessmap (your maps and the app). To delete everything: set `$env:HARNESSMAP_PURGE=1 and rerun" }
Say "done. Codex no longer loads harnessmap; a running Codex app needs a full quit and reopen."

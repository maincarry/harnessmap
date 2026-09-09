# HarnessMap on Codex - the whole verification in ONE command (Windows PowerShell), output made for pasting back:
#   irm https://raw.githubusercontent.com/maincarry/harnessmap/main/test-codex.ps1 | iex
# Starts the map server if needed, checks state and models, drives the three hooks the way Codex does,
# waits for the filer, and prints a summary table. Touches nothing in ~\.codex.
$ErrorActionPreference = 'Continue'
$App = if ($env:HARNESSMAP_APP) { $env:HARNESSMAP_APP } else { Join-Path $HOME '.harnessmap\app' }
$B = 'http://127.0.0.1:8790'; $Res = @()
function Say($m) { Write-Host "`n== $m" }
function Add($n, $v, $d) { $script:Res += "$n | $v | $d" }
function State { try { return Invoke-RestMethod "$B/api/state" -TimeoutSec 5 } catch { return $null } }
Say "0. tools"; try { codex --version } catch { "codex: not on PATH" }; try { "bun $(bun --version)" } catch { "bun: missing" }
if (-not (Test-Path (Join-Path $App 'src\server.ts'))) { "app missing at $App - run the installer first"; return } else { "app: $App  build $(git -C $App rev-parse --short HEAD)" }
Say "1. hooks + plugin"; $hj = Join-Path $HOME '.codex\hooks.json'
if (Test-Path $hj) { "user-level hook entries: $((Select-String -Path $hj -Pattern 'harnessmap' -AllMatches).Matches.Count)" } else { "user-level hooks: NONE - run the installer" }
try { codex plugin list 2>$null | Select-String -i harnessmap } catch {}
Say "2. server"
if (-not (State)) { $bun = (Get-Command bun).Source; Start-Process -FilePath $bun -ArgumentList "run","src/server.ts" -WorkingDirectory $App -WindowStyle Hidden -RedirectStandardOutput (Join-Path $HOME ".harnessmap\server.log") -RedirectStandardError (Join-Path $HOME ".harnessmap\server.err.log") | Out-Null; foreach ($i in 1..12) { Start-Sleep 1; if (State) { break } } } else { "already running" }
$st = State; if ($st -and $st.machine -and ($st.machine.ToLower() -ne $env:COMPUTERNAME.ToLower())) { "port 8790 is answered by a map server on ANOTHER machine ('$($st.machine)') - an SSH port forward? Close it and rerun."; Add "state" "FAIL" "foreign server $($st.machine)"; return }
$st = State; if ($st) { "state OK: build $($st.build)  running from $($st.appRoot)"; Add "state" "PASS" "build $($st.build) from $($st.appRoot)" } else { "state: no answer"; Add "state" "FAIL" "server did not answer" }
Say "3. models"; try { $mo = Invoke-RestMethod "$B/api/models" -TimeoutSec 5; "models OK: $(($mo | ConvertTo-Json -Compress -Depth 3).Substring(0, [Math]::Min(300, ($mo | ConvertTo-Json -Compress -Depth 3).Length)))"; Add "models" "PASS" "" } catch { "models: $($_.Exception.Message)"; Add "models" "FAIL" $_.Exception.Message }
Say "4. hooks, driven by hand (SessionStart, UserPromptSubmit, Stop) - gate opened for the probe session"
$env:HARNESSMAP_SESSION_GATE = 'open'; Push-Location $App; $sid = "probe-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"  # unique per run: a repeated id gets an empty delta, not the block
$s1 = ('{"session_id":"' + $sid + '","cwd":"' + ($HOME -replace '\\','/') + '/maptest-probe","hook_event_name":"SessionStart"}' | bun run hooks/session-start.ts 2>&1 | Out-String)
"session-start: $(if ($s1.Trim()) { $s1.Substring(0, [Math]::Min(300, $s1.Length)) } else { '(silent - the project is already known; the intro shows once)' })"; Add "session-start hook" $(if ($s1 -match 'additionalContext' -or -not $s1.Trim()) { 'PASS' } else { 'FAIL' }) $(if ($s1 -match 'NOT connected') { 'foreign server' } else { '' })
$p1 = ('{"session_id":"' + $sid + '","turn_id":"t1","hook_event_name":"UserPromptSubmit","prompt":"we decided the header will be blue because it is calmer"}' | bun run hooks/on-prompt.ts 2>&1 | Out-String)
"on-prompt: $($p1.Substring(0, [Math]::Min(120, $p1.Length)))"; Add "on-prompt hook" $(if ($p1 -match 'additionalContext') { 'PASS' } else { 'FAIL (no context returned)' }) ""
('{"session_id":"' + $sid + '","turn_id":"t1","hook_event_name":"Stop","last_assistant_message":"Noted: blue header, chosen for calm."}' | bun run hooks/on-stop.ts 2>&1) | Out-Null
Pop-Location; Remove-Item Env:HARNESSMAP_SESSION_GATE -ErrorAction SilentlyContinue
"on-stop: sent; waiting up to 120 s for the filer"; $m = $null
foreach ($i in 1..24) { Start-Sleep -Seconds 5; $raw = ''; try { $raw = (Invoke-WebRequest "$B/api/state" -TimeoutSec 5 -UseBasicParsing).Content } catch {}; $m = [regex]::Match($raw, '"content":"[^"]*[Bb]lue[^"]*"'); if ($m.Success) { break } }
if ($m -and $m.Success) { "node: $($m.Value)  (after $($i*5) s)"; Add "filing (a node about the blue header)" "PASS" "$($i*5) s" } else { "node: none after 120 s"; Add "filing (a node about the blue header)" "FAIL (see the backend line and the logs below)" "" }
Say "4b. Codex transcript (the newest rollout on this machine, read by the map's parser)"; Push-Location $App; $rc = (bun run src/eval/codex-rollout-check.ts 2>&1 | Out-String); Pop-Location; $rc.Trim(); Add "rollout parser" $(if ($rc -match 'ROLLOUT PASS') { 'PASS' } elseif ($rc -match 'none found') { 'SKIP (no Codex session yet)' } else { 'FAIL' }) ""
Say "5. backend"; try { $ai = Invoke-RestMethod "$B/api/auth-info" -TimeoutSec 5; "backend: $($ai.backend)  ($($ai.billing))"; "last ok: $($ai.lastOkAt)  last error: $($ai.lastErrAt)  $($ai.lastErr)"; Add "backend" $ai.backend "$($ai.lastErr)" } catch { "auth-info: $($_.Exception.Message)" }
"where claude: $((Get-Command claude -ErrorAction SilentlyContinue).Source)"; "where codex: $((Get-Command codex -ErrorAction SilentlyContinue).Source)"
Say "6. log tails (server.log, then server.err.log)"; foreach ($f in 'server.log','server.err.log') { "-- $f"; Get-Content (Join-Path $HOME ".harnessmap\$f") -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { $_.Substring(0, [Math]::Min(220, $_.Length)) } }
Say "SUMMARY (paste this back)"; $Res
"server left running on $B. Next: codex -> /hooks -> trust harnessmap -> NEW thread -> say: open map"

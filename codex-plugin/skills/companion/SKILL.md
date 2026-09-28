---
name: companion
description: Install the desktop companion — a small always-there window that shows your map's focused node and a filing pulse, built from source on THIS machine (no download, so macOS never blocks it) and launched. Use when the user says "install the companion", "add the desktop widget", "build companion", "debug the companion", or similar.
---

The companion is a tiny native window (Tauri v2) that hosts the map's own `/widget` page: it sits at the screen edge, shows the **focused node's name** and a pulse when the map files something, and gives one tap to open the map or talk to it. You BUILD it from the source that shipped with the map — you do **not** download a binary. A locally-built app carries no `com.apple.quarantine` flag, so macOS launches it with no "damaged" / "cannot verify malware" dialog: no notarization, no Apple Developer account. The user never runs a terminal command — you do it and report.

### The one command
Run the canonical installer script and stream its progress to the user:
```
bash "$HOME/.harnessmap/app/companion/install.sh"
```
(Windows: see the manual steps below — the script is POSIX shell.) It is idempotent (relaunches if already installed), installs only the missing toolchain, builds, copies the app into `~/Applications` (macOS, no sudo) or runs the AppImage (Linux), and launches it. Pass `--rebuild` to force a fresh build after a code change.

**Before it runs, tell the user in one line** that the first build installs a toolchain + compiles (a few minutes) and is instant forever after. Then run it and report what it prints. If it says the source isn't found, the map isn't installed from source — tell the user to run the map installer and stop.

### If the script reports a problem, resolve it and re-run
- **"Xcode Command Line Tools are needed"** (macOS): it opened Apple's GUI installer — tell the user to click through it, then run the script again. Never give them terminal commands.
- **Linux GUI deps failed:** install for their distro (Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`), then re-run.
- **"build failed":** run `cd "$HOME/.harnessmap/app/companion" && cargo tauri build` to see the real error, fix the obvious cause, re-run. Report the actual error — never claim success you didn't see.

### Windows (no script)
Set `$C="$HOME\.harnessmap\app\companion"`. Ensure Rust (`rustup`), `cargo install tauri-cli --version "^2.0.0" --locked`, and (if the build complains) WebView2 + MSVC Build Tools (`winget install Microsoft.VisualStudio.2022.BuildTools`). Then `cd $C; cargo tauri icon app-icon-source.png; cargo tauri build`, and launch the installer/`.exe` under `$C\src-tauri\target\release\bundle\`.

### Tell the user, in a line or two
- It's running — look for the small window at the screen edge and the tray/menu-bar icon; it shows the focused node and pulses when the map files something.
- It reads the running map's port automatically; "open map" from its menu opens the full map. It comes back after a reboot from Applications (or say "install the companion" again — it just relaunches).


## Debugging the companion (say "debug the companion")
The companion is a native window, so debug it ON this machine — you (the CLI agent) can see and fix what a remote developer can't. Run it in dev mode with live reload + devtools:
```
cd "$HOME/.harnessmap/app/companion" && cargo tauri dev
```
Editing `companion/web/index.html` (the whole UI) hot-reloads instantly. Open the webview **devtools** (right-click the window → Inspect, or it's on by default in dev) to see the JS console, network calls, and layout — that's where widget bugs show. Editing `src-tauri/src/lib.rs` (the native shell) needs a recompile (rerun `cargo tauri dev`).

**Files:** `companion/web/index.html` = the entire widget UI + logic (app origin). `src-tauri/src/lib.rs` = native commands. `src-tauri/tauri.conf.json` = window (size, transparent, alwaysOnTop, macOSPrivateApi). `src-tauri/capabilities/default.json` = permissions.

**The interfaces the widget uses**
- Tauri commands (invoke): `map_port_cmd()→u16`, `map_ready()→bool`, `open_map({ask?})`, `start_drag()` (call on mousedown to move the window), `reset_position()` (tray → bottom-right).
- Map server HTTP (localhost, port from `map_port_cmd`): `GET /api/state`, `POST /api/influence/toggle`, `POST /api/map-chat {question,history,client}`, and `POST /api/chats/<mainChatId>/{focus,lit,zoomin}` + `POST /api/nodes/<id>/favorite` (proposal apply). WebSocket `ws://127.0.0.1:<port>/ws` pushes `{type:'map'|'turn'|'chat_delta'|'round'}`.
- **CORS/origin:** the app runs at origin `tauri://localhost`; the map server allows it and sends `access-control-allow-origin` — but only on server build ≥ 0.9.103. An OLD server 403s the app → the widget shows "map out of date — run 'update map'". So a "cannot reach the map" almost always means the server needs `update map`.

**Symptom → cause**
- white square / opaque bg → `app.macOSPrivateApi` must be true in tauri.conf; body/html must be `background:transparent`.
- can't move → dragging is `start_drag` invoked on mousedown (app origin only; a remote page can't); check the console for invoke errors.
- "cannot reach the map" / talk-to-map fails → server out of date (403) → `update map`; confirm with `curl -s -o /dev/null -w '%{http_code}' -H 'Origin: tauri://localhost' http://127.0.0.1:<port>/api/state` (expect 200).
- can't find it / too small → it's bottom-right; minimized it's the small round badge (click to reopen); the tray icon → "Reset position" recenters it.
- opens off-screen → tray → "Reset position".

Report the actual console/compiler error and what you changed — never claim a native behavior works unless you saw it.

Never build or install unless the user asked for the companion (or the map installer runs it by default at setup).

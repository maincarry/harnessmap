---
name: companion
description: Install the desktop companion — a small always-there window that shows your map's focused node and a filing pulse, built from source on THIS machine (no download, so macOS never blocks it) and launched. Use when the user says "install the companion", "add the desktop widget", or similar.
---

The companion is a tiny native window (Tauri v2) that hosts the map's own `/widget` page: it sits at the screen edge, shows the **focused node's name** and a pulse when the map files something, and gives one tap to open the map or talk to it. You BUILD it from the source that already shipped with the map — you do **not** download a binary. This matters: a locally-built app carries no `com.apple.quarantine` flag, so macOS launches it with no "damaged" / "cannot verify" dialog. The user never runs a terminal command — you do all of it and report progress.

First set `C="$HOME/.harnessmap/app/companion"` — the companion source, cloned there with the map. If that folder is missing, the map itself isn't installed from source — tell the user to run the map installer first, and stop.

**Before a long build, tell the user in one line** what you're about to do and that the first build takes a few minutes (toolchain + compile), then it's instant forever after. Then proceed without further prompting.

### 0. Already installed? Just relaunch.
- macOS: if `$HOME/Applications/HarnessMap Companion.app` (or `/Applications/…`) exists, run `open "$HOME/Applications/HarnessMap Companion.app"` and stop — it's up. (Rebuild only if the user says "rebuild/update the companion".)
- Linux: if a built AppImage exists under `$C/src-tauri/target/release/bundle/`, run it. Windows: if the installed `.exe` exists, launch it.

### 1. Make sure a map server is running
The companion reads `~/.harnessmap/port` and connects to that server; with no server it just shows "map not running". That's fine to install against, but nicer to have one up. If `curl -s http://127.0.0.1:$(cat ~/.harnessmap/port 2>/dev/null || echo 8790)/api/state` fails, note it — the companion will connect once the user opens a map.

### 2. Ensure the toolchain (install silently only what's missing)
- **Rust:** `command -v cargo || (curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y)` then `. "$HOME/.cargo/env"`.
- **Tauri CLI:** `cargo tauri --version >/dev/null 2>&1 || cargo install tauri-cli --version "^2.0.0" --locked`.
- **Platform GUI deps:**
  - macOS: needs Xcode Command Line Tools. `xcode-select -p >/dev/null 2>&1 || xcode-select --install` — this opens Apple's own GUI installer; if it starts, tell the user to click through it and re-run "install the companion" after (don't block waiting).
  - Linux: `sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf` (adapt to the distro's package manager). A `sudo` password prompt may appear — that's the OS, not us.
  - Windows: WebView2 runtime (usually present on Win10+) and MSVC Build Tools; install via `winget install Microsoft.VisualStudio.2022.BuildTools` and the WebView2 evergreen bootstrapper if `cargo tauri build` reports them missing.

### 3. Build
```
cd "$C"
cargo tauri icon app-icon-source.png     # generates src-tauri/icons/* (not committed)
cargo tauri build
```
If the build fails, read the error and fix the obvious cause (missing dep from step 2, then re-run). Report the real error to the user — never claim success you didn't see.

### 4. Install (user-writable location — no sudo, no password) and launch
- **macOS:** the bundle is at `$C/src-tauri/target/release/bundle/macos/HarnessMap Companion.app`.
  ```
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/HarnessMap Companion.app"
  cp -R "$C/src-tauri/target/release/bundle/macos/HarnessMap Companion.app" "$HOME/Applications/"
  open "$HOME/Applications/HarnessMap Companion.app"
  ```
  Because the app was built (not downloaded) and copied — never quarantined — it launches with no Gatekeeper dialog. If macOS ever does complain, the app is genuinely fine; do NOT tell the user to run terminal commands.
- **Linux:** run the AppImage from `$C/src-tauri/target/release/bundle/appimage/*.AppImage` (chmod +x it), or install the .deb with the system installer.
- **Windows:** run the installer at `$C\src-tauri\target\release\bundle\{nsis,msi}\*` (or launch the built `.exe` directly).

### 5. Tell the user, in one or two lines
- It's running — look for the small window at the screen edge and the tray/menu-bar icon; it shows the focused node and pulses when the map files something.
- It reads the running map's port automatically; "open map" from its menu opens the full map.
- To bring it back after a reboot, launch "HarnessMap Companion" from Applications (or say "install the companion" again — it'll just relaunch).

Never build or install unless the user asked for the companion.

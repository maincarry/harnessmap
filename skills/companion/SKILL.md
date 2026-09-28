---
name: companion
description: Install the desktop companion — a small always-there window that shows your map's focused node and a filing pulse, built from source on THIS machine (no download, so macOS never blocks it) and launched. Use when the user says "install the companion", "add the desktop widget", "build companion", or similar.
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

Never build or install unless the user asked for the companion (or the map installer runs it by default at setup).

#!/usr/bin/env bash
# Build + install + launch the HarnessMap desktop companion FROM SOURCE on this machine.
#
# Why build instead of download: a locally-built app carries no com.apple.quarantine
# flag, so macOS never shows the "damaged" / "cannot verify malware" dialogs that block a
# downloaded, un-notarized app — no Apple Developer account needed for a clean launch.
#
# One canonical implementation, three callers: the `companion` skill runs it, the map
# installer runs it in the background by default, and a user can run it directly.
# Idempotent: if the app is already built/installed, it just relaunches.
# Non-fatal by design: on a missing toolchain it explains and exits 0-ish where it can,
# so a background install never breaks the map. Logs everything it does.
set -u
C="${HARNESSMAP_APP:-$HOME/.harnessmap/app}/companion"
say() { printf '[companion] %s\n' "$*"; }

[ -d "$C" ] || { say "source not found at $C — install the map first (it ships the companion)."; exit 1; }
OS="$(uname -s)"

# 0. Already installed? Relaunch and stop.
case "$OS" in
  Darwin)
    for A in "$HOME/Applications/HarnessMap Companion.app" "/Applications/HarnessMap Companion.app"; do
      if [ -d "$A" ] && [ "${1:-}" != "--rebuild" ]; then say "already installed — launching."; open "$A" 2>/dev/null && exit 0; fi
    done ;;
esac

# 1. Toolchain (install only what's missing).
if ! command -v cargo >/dev/null 2>&1; then
  if [ "$OS" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
    say "Xcode Command Line Tools are needed to build. Opening Apple's installer — click through it, then say 'install the companion' again."
    xcode-select --install >/dev/null 2>&1 || true
    exit 0   # can't proceed unattended; not a failure
  fi
  say "installing the Rust toolchain (one time)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y >/dev/null 2>&1 || { say "rustup install failed."; exit 1; }
fi
# shellcheck disable=SC1091
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null 2>&1 || { say "cargo not on PATH after install — open a new shell and retry."; exit 1; }

if ! cargo tauri --version >/dev/null 2>&1; then
  say "installing the Tauri CLI (one time)…"
  cargo install tauri-cli --version "^2.0.0" --locked >/dev/null 2>&1 || { say "tauri-cli install failed."; exit 1; }
fi

# Linux GUI deps (best-effort; a sudo prompt may appear — that's the OS).
if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
  dpkg -s libwebkit2gtk-4.1-dev >/dev/null 2>&1 || { say "installing Linux GUI deps…"; sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf >/dev/null 2>&1 || say "could not auto-install GUI deps; see companion/README."; }
fi

# 2. Build.
say "building the companion (a few minutes the first time)…"
( cd "$C" && cargo tauri icon app-icon-source.png >/dev/null 2>&1 && cargo tauri build ) || { say "build failed — run 'cargo tauri build' in $C to see the error."; exit 1; }

# 3. Install to a user-writable place (no sudo) and launch.
case "$OS" in
  Darwin)
    APP_SRC="$C/src-tauri/target/release/bundle/macos/HarnessMap Companion.app"
    [ -d "$APP_SRC" ] || { say "build produced no .app at $APP_SRC"; exit 1; }
    mkdir -p "$HOME/Applications"
    rm -rf "$HOME/Applications/HarnessMap Companion.app"
    cp -R "$APP_SRC" "$HOME/Applications/"
    say "installed to ~/Applications — launching."
    open "$HOME/Applications/HarnessMap Companion.app" 2>/dev/null || true ;;
  Linux)
    IMG="$(ls "$C"/src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)"
    if [ -n "$IMG" ]; then chmod +x "$IMG"; say "launching $IMG"; ( "$IMG" >/dev/null 2>&1 & ) ; else say "no AppImage produced; see companion/README for the .deb."; fi ;;
  *) say "on Windows, run the installer under $C/src-tauri/target/release/bundle." ;;
esac
say "done."

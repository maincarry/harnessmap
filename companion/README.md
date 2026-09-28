# HarnessMap desktop companion

An always-there desktop presence for your live map: a small window that tucks to the
screen edge, shows the **focused node** + a filing pulse, and gives one tap to open the
map or talk to it. It is a **thin Tauri v2 shell** around the map's own `/widget` page
— the server serves the UI (`public/widget.html`); the shell provides the native
window, the tray icon, and always-on-top. Nearly all logic stays in the web layer.

## How users get it: built locally, never downloaded

The companion ships **as source, inside the map plugin** (this folder). Users install it
by asking their CLI agent — "install the companion" — which runs the **`companion` skill**
(`skills/companion`, mirrored in `codex-plugin/skills/companion`): the agent ensures the
toolchain, runs `cargo tauri build` from this folder, copies the app into
`~/Applications`, and launches it. The user never touches a terminal.

**Why build instead of download:** a locally-built app carries no `com.apple.quarantine`
flag, so macOS Gatekeeper never shows the "damaged" / "cannot verify malware" dialogs
that block a downloaded, un-notarized `.dmg`. No Apple Developer account required for it
to launch cleanly. (Notarization is still the path for a one-click *downloadable*
installer, if we ever add that funnel — see below.)

## Layout
- `web/index.html` — bundled loader; asks Rust for the port (`map_port_cmd`), waits for
  the map server, then redirects to the live `http://127.0.0.1:<port>/widget`. Shows
  "map not running" + retries when it's down.
- `src-tauri/` — the Rust shell: reads `~/.harnessmap/port`, tray menu (show/hide, open
  map, quit), always-on-top frameless transparent window.
- `app-icon-source.png` — 1024² icon source; `cargo tauri icon` expands it into
  `src-tauri/icons/*` at build time (icons are generated, not committed).
- `../.github/workflows/companion-release.yml` — **CI compile-check**: builds the macOS
  bundle on every dispatch/tag so we catch build breakage the local skill would hit.
  It is no longer the delivery mechanism (users build locally) — it's regression cover.

## Build it yourself (what the skill automates)
Prereqs the skill installs if missing: Rust (`rustup`), Tauri CLI
(`cargo install tauri-cli --version '^2'`), per-OS GUI deps (macOS: Xcode CLT; Linux:
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`;
Windows: WebView2 + MSVC build tools).

```
cd companion
cargo tauri icon app-icon-source.png     # generate icons
cargo tauri build                        # → src-tauri/target/release/bundle/…
# macOS: cp -R the .app into ~/Applications and `open` it
```
For live iteration on the shell: start a map server (`bun run src/server.ts`, port 8790),
then `cargo tauri dev`.

## Optional: a downloadable installer (deferred)
If we ever want a one-click download for users *without* a toolchain, the CI workflow can
sign + notarize + publish a Release. That needs an Apple Developer account (~$99/yr) and
these repo secrets: macOS `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific pw), `APPLE_TEAM_ID`;
Windows `WINDOWS_CERTIFICATE(_PASSWORD)`; and for auto-update,
`TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` (public key in `tauri.conf.json`). The local-build
path needs none of this and is the default.

## Follow-ups
- Edge-hide as a native behavior (drag + snap to the screen edge; the web widget already
  has the collapsed/edge visual — wire window position to it).
- Launch-at-login (a LaunchAgent on macOS) + single-instance.
- Bundle the widget offline as a fallback if we ever want it usable with the map stopped.

# HarnessMap desktop companion

An always-there desktop presence for your live map: a small window that tucks to the
screen edge, shows the current focus + a filing pulse, and gives one tap to open the
map or talk to it. It is a **thin Tauri v2 shell** around the map's own `/widget` page
— the server serves the UI (`public/widget.html`), the shell just provides the native
window, the tray icon, always-on-top, and auto-update. Nearly all logic stays in the
web layer we already maintain.

## ⚠️ Status: DRAFT — not yet compiled

This scaffold was written on a box with **no Rust/GUI toolchain**, so it has **not been
built or run**. It follows standard Tauri v2 conventions; expect a small fix-up pass on
the first real build. What *is* verified: the widget UI itself (`/widget`) runs live
against a real map server. What needs a build pass: this native shell + the CI workflow.

## Layout
- `web/index.html` — bundled loader; waits for the map server, then redirects to the
  live `http://127.0.0.1:<port>/widget`. Shows "map not running" + retries when it's down.
- `src-tauri/` — the Rust shell: reads `~/.harnessmap/port`, tray menu (show/hide, open
  map, quit), always-on-top frameless transparent window, updater.
- `../.github/workflows/companion-release.yml` — build + sign + publish per OS.

## Run it (dev, on a machine with a desktop)
Prereqs: Rust (`rustup`), the Tauri CLI (`cargo install tauri-cli --version '^2'`), and
per-OS GUI deps (macOS: Xcode CLT; Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev
libappindicator3-dev librsvg2-dev patchelf`; Windows: WebView2 + MSVC build tools).

1. Start a map server (so `/widget` and the API are up): `bun run src/server.ts` (port 8790).
2. Generate icons once from the logo: `cd companion && cargo tauri icon ../public/brand/app-icon.svg`.
3. `cd companion && cargo tauri dev`.

First build pass will likely surface: exact `tauri`/plugin feature flags, the updater
`pubkey`, and capability permission ids — fix as the compiler/Tauri reports.

## Release (CI)
Push a tag `companion-vX.Y.Z`. `companion-release.yml` builds macOS (arm+intel),
Windows, and Linux, signs them, and uploads installers + `companion-latest.json`
(the updater manifest the app's endpoint points at) to a draft GitHub Release.

### Signing & release secrets (set in repo → Settings → Secrets → Actions)
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — updater signing
  (`cargo tauri signer generate`; put the **public** key in `tauri.conf.json` → `plugins.updater.pubkey`).
- macOS notarization: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific pw), `APPLE_TEAM_ID`
  (needs an Apple Developer account, ~$99/yr).
- Windows (optional but recommended): `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`.
Without these it still produces **unsigned** artifacts — installable, but macOS Gatekeeper
/ Windows SmartScreen will warn, which kills install rates. Sign before wide distribution.

## The map-side "get the companion" hook (#4 — plan)
The map is the install funnel (users already have it). Once the first release exists:
1. Add a **"⬇ Desktop companion"** entry in the map's ⋯ menu (index.html) that opens the
   GitHub Releases page, or `/api/companion/latest?os=<detected>` which 302s to the right asset.
2. Optional server endpoint `GET /api/companion/latest` — reads the latest release via the
   GitHub API (cached), returns `{ mac, win, linux }` asset URLs; the button picks by
   `navigator.platform`.
This is a ~30-minute add and is intentionally deferred until there is a signed build to
point at (a download button to nothing is worse than none).

## Follow-ups
- Edge-hide as a native behavior (drag + snap to the screen edge; the web widget already
  has the collapsed/edge visual — wire window position to it).
- Single-instance + launch-at-login.
- Bundle the widget offline as a fallback if we ever want it usable with the map stopped.

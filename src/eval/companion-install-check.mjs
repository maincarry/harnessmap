// Robustness harness for companion/install.sh — the one command the `companion` skill runs
// (Jacob 2026-10-01: "Test the actual robustness of the codex-built ones from the companion
// installation command, not just the app itself as abstract"). We drive the REAL install.sh
// against a MOCKED toolchain + env (fake cargo/dpkg/uname/open shims we flip to succeed or
// fail, a fake build artifact) and assert each decision path does the right thing — no actual
// 10-minute Tauri build, but the script's own branching logic is exercised for real.
//
// Run: bun run src/eval/companion-install-check.mjs
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(HERE, '..', '..', 'companion', 'install.sh');
if (!existsSync(INSTALL)) { console.error(`install.sh not found at ${INSTALL}`); process.exit(2); }

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; out.push(`  PASS ${name}`); }
  else { fail++; out.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// A single cargo shim whose behavior is flipped by env: HM_TAURI_VER (ok|fail = `cargo tauri
// --version`), HM_TAURICLI (ok|fail = `cargo install tauri-cli`), HM_BUILD (ok|fail|noartifact
// = `cargo tauri build`). On a good build it writes BOTH a Linux AppImage and a macOS .app so
// whichever OS branch runs finds its artifact.
const CARGO = `#!/usr/bin/env bash
if [ "$1" = "tauri" ] && [ "$2" = "--version" ]; then [ "$HM_TAURI_VER" = fail ] && exit 1 || { echo "tauri-cli 2.0.0"; exit 0; }; fi
if [ "$1" = "tauri" ] && [ "$2" = "icon" ]; then exit 0; fi
if [ "$1" = "tauri" ] && [ "$2" = "build" ]; then
  case "$HM_BUILD" in
    fail) echo "mock: compile error E0001" >&2; exit 1 ;;
    noartifact) exit 0 ;;
    *) # Model Tauri's real per-OS bundle targets: ONLY the requested --bundles target is
       # produced. "app" is macOS-only, "appimage" is Linux — so asking for the wrong one
       # (e.g. --bundles app on Linux) yields NO launchable artifact, which is the real bug
       # the Linux install path had. Target is the arg after --bundles.
       tgt=""; for a in "$@"; do [ "$prev" = "--bundles" ] && tgt="$a"; prev="$a"; done
       case "$tgt" in
         app) mkdir -p "$PWD/src-tauri/target/release/bundle/macos/HarnessMap Companion.app/Contents/MacOS" ;;
         appimage) mkdir -p "$PWD/src-tauri/target/release/bundle/appimage"; printf '#!/bin/sh\\nexit 0\\n' > "$PWD/src-tauri/target/release/bundle/appimage/HarnessMap_0.0.0.AppImage" ;;
       esac
       exit 0 ;;
  esac
fi
if [ "$1" = "install" ]; then [ "$HM_TAURICLI" = fail ] && { echo "mock: tauri-cli build failed" >&2; exit 1; } || exit 0; fi
exit 0
`;
const UNAME = `#!/bin/sh\necho "\${HM_OS:-Linux}"\n`;              // honors HM_OS
const TRUE0 = `#!/bin/sh\nexit 0\n`;                                 // dpkg/open/osascript/pkill/xcode-select/curl stand-ins
const APPIMG_LAUNCH = TRUE0;

function run({ os = 'Linux', app /*HARNESSMAP_APP*/, args = [], tauriVer = 'ok', tauriCli = 'ok', build = 'ok', withSource = true, preInstalledApp = false }) {
  const root = mkdtempSync(join(tmpdir(), 'hm-cominstall-'));
  const home = join(root, 'home'); mkdirSync(home, { recursive: true });
  const appRoot = app ?? join(root, 'app');
  const C = join(appRoot, 'companion');
  if (withSource) { mkdirSync(join(C, 'src-tauri'), { recursive: true }); writeFileSync(join(C, 'app-icon-source.png'), 'x'); }
  const mock = join(root, 'mock'); mkdirSync(mock, { recursive: true });
  const put = (n, body) => { const p = join(mock, n); writeFileSync(p, body); chmodSync(p, 0o755); };
  put('cargo', CARGO); put('uname', UNAME); put('dpkg', TRUE0); put('apt-get', TRUE0); put('sudo', `#!/bin/sh\nexec "$@"\n`);
  put('open', TRUE0); put('osascript', TRUE0); put('pkill', TRUE0); put('xcode-select', `#!/bin/sh\n[ "$1" = "-p" ] && exit 0 || exit 0\n`);
  put('curl', TRUE0);
  if (preInstalledApp && os === 'Darwin') { mkdirSync(join(home, 'Applications', 'HarnessMap Companion.app'), { recursive: true }); }
  const res = spawnSync('bash', [INSTALL, ...args], {
    env: { PATH: `${mock}:/usr/bin:/bin`, HOME: home, HARNESSMAP_APP: appRoot, HM_OS: os, HM_TAURI_VER: tauriVer, HM_TAURICLI: tauriCli, HM_BUILD: build },
    encoding: 'utf8', timeout: 30000,
  });
  const text = (res.stdout || '') + (res.stderr || '');
  return { code: res.status, text, root, home, C, appRoot };
}

console.log('== companion-install-check: robustness of companion/install.sh ==');

// 1. Source missing → exit 1 + clear message (not a silent success)
{ const r = run({ withSource: false });
  check('source missing → exit 1', r.code === 1, `exit ${r.code}`);
  check('source missing → says "source not found"', /source not found/i.test(r.text), r.text.trim().split('\n').pop()); }

// 2. Linux happy path → builds, launches the AppImage, exits 0, says done
{ const r = run({ os: 'Linux', build: 'ok' });
  const img = join(r.C, 'src-tauri/target/release/bundle/appimage/HarnessMap_0.0.0.AppImage');
  check('linux happy → exit 0', r.code === 0, `exit ${r.code}`);
  check('linux happy → says "done"', /done\./i.test(r.text));
  check('linux happy → launches the AppImage', /launching .*AppImage/i.test(r.text));
  check('linux happy → AppImage made executable', existsSync(img) && (statSync(img).mode & 0o111) !== 0); }

// 3. Build fails → exit 1, surfaces the real error path, NEVER claims "done" (the "false success" class)
{ const r = run({ os: 'Linux', build: 'fail' });
  check('build fail → exit 1', r.code === 1, `exit ${r.code}`);
  check('build fail → says "build failed"', /build failed/i.test(r.text));
  check('build fail → gives the real command to see the error', /cargo tauri build --bundles app/.test(r.text));
  check('build fail → does NOT falsely say "done"', !/done\./i.test(r.text), 'claimed done on a failed build'); }

// 4. Build OK but no artifact produced → must not pretend it launched
{ const r = run({ os: 'Linux', build: 'noartifact' });
  check('no artifact → says "no AppImage produced"', /no AppImage produced/i.test(r.text));
  check('no artifact → does NOT say "launching"', !/launching/i.test(r.text)); }

// 5. Tauri CLI missing but installs OK → proceeds to build + done
{ const r = run({ os: 'Linux', tauriVer: 'fail', tauriCli: 'ok', build: 'ok' });
  check('tauri-cli missing → says "installing the Tauri CLI"', /installing the Tauri CLI/i.test(r.text));
  check('tauri-cli missing+install ok → still reaches "done"', /done\./i.test(r.text) && r.code === 0, `exit ${r.code}`); }

// 6. Tauri CLI install fails → exit 1 + clear message
{ const r = run({ os: 'Linux', tauriVer: 'fail', tauriCli: 'fail' });
  check('tauri-cli install fail → exit 1', r.code === 1, `exit ${r.code}`);
  check('tauri-cli install fail → says "tauri-cli install failed"', /tauri-cli install failed/i.test(r.text)); }

// 7. macOS already installed, no --rebuild → relaunch + exit 0, WITHOUT rebuilding
{ const r = run({ os: 'Darwin', preInstalledApp: true, build: 'fail' /* must NOT be reached */ });
  check('macos already-installed → exit 0', r.code === 0, `exit ${r.code}`);
  check('macos already-installed → says "already installed"', /already installed/i.test(r.text));
  check('macos already-installed → does NOT rebuild (build never runs)', !/building the companion/i.test(r.text), 'rebuilt despite already-installed'); }

// 8. macOS already installed + --rebuild → skips the relaunch short-circuit, actually builds
{ const r = run({ os: 'Darwin', preInstalledApp: true, args: ['--rebuild'], build: 'ok' });
  check('macos --rebuild → bypasses already-installed, builds', /building the companion/i.test(r.text));
  check('macos --rebuild → exit 0', r.code === 0, `exit ${r.code}`); }

// 9. macOS fresh build → copies the .app to ~/Applications and launches the fresh build
{ const r = run({ os: 'Darwin', build: 'ok' });
  const installed = join(r.home, 'Applications', 'HarnessMap Companion.app');
  check('macos fresh → exit 0', r.code === 0, `exit ${r.code}`);
  check('macos fresh → copied .app into ~/Applications', existsSync(installed));
  check('macos fresh → says "launching the fresh build"', /launching the fresh build/i.test(r.text)); }

console.log(out.join('\n'));
console.log(`\n================ companion-install-check · ${pass} passed, ${fail} failed ================`);
process.exit(fail ? 1 : 0);

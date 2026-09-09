// Shared plumbing for harnessmap hooks. Hooks must NEVER break the host:
// every failure path degrades to "do nothing".
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

// M91: installed life. All user data lives in ONE place (told to the user):
// ~/.harnessmap — db, server log, port file. Overridable for dev/playground.
export const HOME = process.env.HARNESSMAP_HOME ?? join(homedir(), '.harnessmap');
// M238 (Jacob, 2026-09-09: "you cannot let the map hijack the entirety of user's
// codex"): the kill switch that depends on nothing — no map page, no server, no
// terminal skill. An empty file ~/.harnessmap/OFF and every hook exits at once,
// injecting nothing and filing nothing, until the file is removed.
if (existsSync(join(HOME, 'OFF'))) { process.exit(0); }

function port(): string {
  try { return readFileSync(join(HOME, 'port'), 'utf8').trim() || '8790'; } catch { return '8790'; }
}
export const BASE = process.env.HARNESSMAP_URL ?? `http://127.0.0.1:${port()}`;

// M239 (Jacob, 2026-09-09: "The map only functions with an explicit open map
// command, and must be restricted to one host session"). Default OFF. The
// user says "open map" in a session; that arms ~/.harnessmap/open-next; the
// next hook from that session claims it and its session id becomes THE
// opened session (~/.harnessmap/session). Every other session's hooks exit at
// once: no injection, no filing. "close map" removes the session file.
// HARNESSMAP_SESSION_GATE=open lets a test harness treat every session as
// opened; the smoke suite proves the gate with it unset.
export function gateSession(input: any, event: 'SessionStart' | 'UserPromptSubmit' | 'Stop' | 'PreCompact' | 'PostCompact'): boolean {
  if (process.env.HARNESSMAP_SESSION_GATE === 'open') return true;
  const sid = String(input?.session_id ?? '');
  const sessFile = join(HOME, 'session'), armFile = join(HOME, 'open-next');
  let opened = ''; try { opened = readFileSync(sessFile, 'utf8').trim(); } catch {}
  if (sid && opened && opened === sid) return true;
  if (existsSync(armFile)) {
    // the session that speaks first after "open map" is the one it was said in
    try { mkdirSync(HOME, { recursive: true }); writeFileSync(sessFile, sid); } catch {}
    try { unlinkSync(armFile); } catch {}
    return true;
  }
  if (event === 'SessionStart' && !opened) {
    // Installed but not attached: one line, once per session, so the user knows the command. It informs; it asks for nothing.
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '[harnessmap] The map is installed but not attached to this session. If you want it, say "open map" — it attaches to this session only.' } }));
  }
  return false;
}

export async function readHookInput(): Promise<any> {
  try { return await new Response(Bun.stdin.stream()).json(); } catch { return {}; }
}

// The plugin root is this file's grandparent; the app (src/, public/,
// package.json) ships inside the same repo the plugin lives in.
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url)); // M220: fileURLToPath — a Windows path is not a URL pathname

function pluginVersion(): string {
  try { return JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

function changeLine(): string {
  try { return readFileSync(join(APP_ROOT, 'CHANGELOG-LINE.txt'), 'utf8').trim(); } catch { return ''; }
}

function currentBuild(): string { try { const r = Bun.spawnSync(['git', '-C', APP_ROOT, 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' }); return r.exitCode === 0 ? r.stdout.toString().trim() : ''; } catch { return ''; } }

async function health(): Promise<{ up: boolean; version?: string; build?: string; foreign?: string }> {
  try {
    const r = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json() as any;
    // Identity check: only OUR server answers with a map-state shape.
    if (j && 'nodes' in j && 'projectId' in j) {
      // M176: a healthy harnessmap answering from ANOTHER machine means the
      // port is an SSH tunnel (or forward) to someone else's server — binding
      // to it would file this machine's conversations onto that map.
      const { hostname } = await import('node:os');
      if (j.machine && j.machine !== hostname()) return { up: true, version: j.version, build: j.build, foreign: j.machine };
      return { up: true, version: j.version, build: j.build };
    }
  } catch {}
  return { up: false };
}

function spawnServer(): void {
  // First run in an installed location: dependencies may not exist yet.
  if (!existsSync(join(APP_ROOT, 'node_modules'))) {
    try { Bun.spawnSync(['bun', 'install', '--production'], { cwd: APP_ROOT, stdout: 'ignore', stderr: 'ignore' }); } catch {}
  }
  try { mkdirSync(HOME, { recursive: true }); } catch {}
  const log = Bun.file(join(HOME, 'server.log'));
  // The hook's own runtime is the bun to use: a GUI app's PATH may carry no bun at all (M235/M236).
  Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: APP_ROOT, stdout: log, stderr: log, stdin: 'ignore',
    env: {
      ...process.env,
      HARNESSMAP_HOME: HOME,
      HARNESSMAP_DB: process.env.HARNESSMAP_DB ?? join(HOME, 'map.sqlite'),
    },
    detached: true,
  }).unref();
}

async function waitUp(tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await health()).up) return true;
  }
  return false;
}

// Ensure the server is up AND current. Returns a human line when an update
// restart happened (surfaced to the user via the agent — Mark's Q3), else ''.
export async function ensureServer(): Promise<{ up: boolean; updateNote: string }> {
  const h = await health();
  if (h.up && h.foreign) {
    return { up: false, updateNote: `[harnessmap] NOT connected: the map port is forwarded to a server on another machine ("${h.foreign}" — an SSH tunnel?). Close the tunnel or move it to a different local port, then start a new session. Tell the user this in one short line.` };
  }
  if (!h.up) { spawnServer(); return { up: await waitUp(), updateNote: '' }; }
  const want = pluginVersion();
  const build = currentBuild();
  const staleBuild = !!(h.build && build && h.build !== build); // M236: code moved under a running server
  if ((h.version && want !== '0.0.0' && h.version !== want) || staleBuild) {
    try { await fetch(`${BASE}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1500) }); } catch {}
    await new Promise((r) => setTimeout(r, 400));
    spawnServer();
    const up = await waitUp();
    const change = changeLine();
    return { up, updateNote: up ? (staleBuild && h.version === want ? `[harnessmap] map server restarted on the updated code (${h.build} → ${build}). Mention this to the user in one short line.` : `[harnessmap] map server updated ${h.version} → ${want}${change ? `: ${change}` : ''}. Mention this to the user in one short line.`) : '' };
  }
  return { up: true, updateNote: '' };
}

// M245: which host is running this hook. Codex's transcript is a rollout under
// ~/.codex/sessions; Claude Code's lives under ~/.claude/projects and Claude
// Code marks its child processes with CLAUDECODE=1. Codex payloads may also
// carry a gpt model slug. Default claude (the original host).
export function hostHarness(input: any): 'claude' | 'codex' {
  const tp = String(input?.transcript_path ?? '');
  if (/[\\/]\.codex[\\/]/.test(tp)) return 'codex';
  if (/[\\/]\.claude[\\/]/.test(tp) || process.env.CLAUDECODE) return 'claude';
  if (String(input?.model ?? '').startsWith('gpt') || process.env.CODEX_HOME || process.env.CODEX_SANDBOX) return 'codex';
  return 'claude';
}

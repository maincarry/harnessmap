// Shared plumbing for harnessmap hooks. Hooks must NEVER break the host:
// every failure path degrades to "do nothing".
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

// M91: installed life. All user data lives in ONE place (told to the user):
// ~/.harnessmap — db, server log, port file. Overridable for dev/playground.
export const HOME = process.env.HARNESSMAP_HOME ?? join(homedir(), '.harnessmap');

function port(): string {
  try { return readFileSync(join(HOME, 'port'), 'utf8').trim() || '8790'; } catch { return '8790'; }
}
export const BASE = process.env.HARNESSMAP_URL ?? `http://127.0.0.1:${port()}`;

export async function readHookInput(): Promise<any> {
  try { return await new Response(Bun.stdin.stream()).json(); } catch { return {}; }
}

// The plugin root is this file's grandparent; the app (src/, public/,
// package.json) ships inside the same repo the plugin lives in.
const APP_ROOT = new URL('..', import.meta.url).pathname;

function pluginVersion(): string {
  try { return JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

function changeLine(): string {
  try { return readFileSync(join(APP_ROOT, 'CHANGELOG-LINE.txt'), 'utf8').trim(); } catch { return ''; }
}

async function health(): Promise<{ up: boolean; version?: string; foreign?: string }> {
  try {
    const r = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json() as any;
    // Identity check: only OUR server answers with a map-state shape.
    if (j && 'nodes' in j && 'projectId' in j) {
      // M176: a healthy harnessmap answering from ANOTHER machine means the
      // port is an SSH tunnel (or forward) to someone else's server — binding
      // to it would file this machine's conversations onto that map.
      const { hostname } = await import('node:os');
      if (j.machine && j.machine !== hostname()) return { up: true, version: j.version, foreign: j.machine };
      return { up: true, version: j.version };
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
  Bun.spawn(['bun', 'run', 'src/server.ts'], {
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
  if (h.version && want !== '0.0.0' && h.version !== want) {
    try { await fetch(`${BASE}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1500) }); } catch {}
    await new Promise((r) => setTimeout(r, 400));
    spawnServer();
    const up = await waitUp();
    const change = changeLine();
    return { up, updateNote: up ? `[harnessmap] map server updated ${h.version} → ${want}${change ? `: ${change}` : ''}. Mention this to the user in one short line.` : '' };
  }
  return { up: true, updateNote: '' };
}

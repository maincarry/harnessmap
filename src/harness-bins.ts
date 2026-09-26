// M258 (Jacob's Mac, 2026-09-15): where the harness binaries live. The Codex APP ships its CLI inside the app
// bundle without putting it on PATH, so a server started outside a Codex-spawned environment saw "no codex":
// the map's own chat stayed visible and ran on Claude, the codex backend never engaged, the harness list was wrong.
// One resolver for every caller: PATH first, then the app's known locations, then CODEX_CLI_PATH.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let cache: { at: number; codex: string | null } | null = null;

function onPathResolved(bin: string): string | null {
  const tryArgv = (argv: string[]): string | null => {
    try { const r = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'ignore', windowsHide: true }); if (r.exitCode !== 0) return null; const out = r.stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]; return out || null; } catch { return null; }
  };
  return process.platform === 'win32'
    ? (tryArgv(['where', bin]) ?? tryArgv(['sh', '-c', `command -v ${bin}`]))
    : (tryArgv(['sh', '-c', `command -v ${bin}`]) ?? tryArgv(['where', bin]));
}

export function codexBin(): string | null {
  if (cache && Date.now() - cache.at < 30_000) return cache.codex;
  const home = homedir();
  const candidates = [
    process.env.CODEX_CLI_PATH ?? '',
    '/Applications/Codex.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/bin/codex',
    join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/bin/codex',
    join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    join(home, '.codex', 'bin', 'codex'),
  ].filter(Boolean);
  const found = onPathResolved('codex') ?? candidates.find((c) => { try { return existsSync(c); } catch { return false; } }) ?? null;
  cache = { at: Date.now(), codex: found };
  return found;
}
export function claudeBin(): string | null { return onPathResolved('claude'); }

// M503 (Mark, 2026-10-19): which OS window is a session's?
// M401 stored the prompt hook's parent pid and assumed it was the host CLI. On Windows, Codex runs each hook command
// through a PowerShell wrapper (windows-hook-command.ts), so that parent is a wrapper that exits the moment the hook
// finishes — Mark's test found the stored pid dead a second later. The CLI, and above it Windows Terminal, VS Code or
// the Codex app, sit higher in the chain. So the hook captures its ANCESTOR CHAIN while it is still alive, once per
// session, and the foreground button walks that chain at click time. Local only; never leaves the machine.
import { spawn } from 'node:child_process';

export type ProcRow = { pid: number; ppid: number; name: string };
export type ChainEntry = { pid: number; name: string };

/** Pure: from `start` upward through parents, at most `max` entries; stops at an unknown parent, a cycle, or the system pids. */
export function walkChain(rows: ProcRow[], start: number, max = 8): ChainEntry[] {
  const by = new Map(rows.map((r) => [r.pid, r]));
  const out: ChainEntry[] = []; const seen = new Set<number>();
  let cur = start;
  while (cur > 4 && !seen.has(cur) && out.length < max) {
    const r = by.get(cur); if (!r) break;
    seen.add(cur); out.push({ pid: r.pid, name: r.name }); cur = r.ppid;
  }
  return out;
}

/** A sane chain from the wire: ints, short names, bounded depth. null when it is not one. */
export function parseChain(x: unknown): ChainEntry[] | null {
  if (!Array.isArray(x) || !x.length || x.length > 12) return null;
  const out: ChainEntry[] = [];
  for (const e of x) {
    const pid = Number((e as any)?.pid); if (!Number.isInteger(pid) || pid <= 0) return null;
    out.push({ pid, name: String((e as any)?.name ?? '').slice(0, 60) });
  }
  return out;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((res) => {
    try {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      let out = ''; p.stdout?.on('data', (d) => (out += d));
      const t = setTimeout(() => { try { p.kill(); } catch {} res(out); }, timeoutMs);
      p.on('error', () => { clearTimeout(t); res(''); });
      p.on('close', () => { clearTimeout(t); res(out); });
    } catch { res(''); }
  });
}

/** Every process as (pid, ppid, name): one PowerShell call on Windows, one `ps` elsewhere. */
export async function listProcesses(timeoutMs = 6000): Promise<ProcRow[]> {
  if (process.platform === 'win32') {
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], timeoutMs);
    try {
      const j = JSON.parse(out.trim()); const arr = Array.isArray(j) ? j : [j];
      return arr.map((r: any) => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), name: String(r.Name ?? '') })).filter((r: ProcRow) => Number.isInteger(r.pid));
    } catch { return []; }
  }
  const out = await run('ps', ['-o', 'pid=,ppid=,comm=', '-ax'], timeoutMs);
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), ppid: Number(m[2]), name: m[3].split('/').pop() ?? m[3] } : null;
  }).filter((r): r is ProcRow => !!r);
}

/** The chain above `start` (the hook's parent), captured now. Empty when the process table could not be read. */
export async function captureHostChain(start: number, timeoutMs = 6000): Promise<ChainEntry[]> {
  if (!Number.isInteger(start) || start <= 0) return [];
  return walkChain(await listProcesses(timeoutMs), start);
}

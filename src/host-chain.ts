// M503 (Mark, 2026-10-19): which OS window is a session's?
// M401 stored the prompt hook's parent pid and assumed it was the host CLI. On Windows, Codex runs each hook command
// through a PowerShell wrapper (windows-hook-command.ts), so that parent is a wrapper that exits the moment the hook
// finishes — Mark's test found the stored pid dead a second later. The CLI, and above it Windows Terminal, VS Code or
// the Codex app, sit higher in the chain. So the hook captures its ANCESTOR CHAIN while it is still alive, once per
// session, and the foreground button walks that chain at click time. Local only; never leaves the machine.
import { spawn } from 'node:child_process';

export type ProcRow = { pid: number; ppid: number; name: string };
export type ChainEntry = { pid: number; name: string };
// M506 (Mark, 2026-10-19): the window the person TYPED IN. On Windows, Codex runs its hooks under an app-server daemon,
// so no ancestor of the hook ever reaches the terminal — the chain is a dead end for a Codex CLI session. But at the
// instant the prompt hook fires the person has just pressed Enter, so the FOREGROUND window is the session's window,
// whatever hosts it (Windows Terminal, VS Code, the Codex app, Terminal.app, iTerm). Recorded once per session.
export type HostWindow = { hwnd?: number; pid: number; name: string; title?: string };

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

/** A sane window record from the wire. null when it is not one. */
export function parseWindow(x: unknown): HostWindow | null {
  if (!x || typeof x !== 'object') return null;
  const pid = Number((x as any).pid); if (!Number.isInteger(pid) || pid <= 0) return null;
  const hwndRaw = Number((x as any).hwnd);
  return {
    pid, name: String((x as any).name ?? '').slice(0, 60), title: String((x as any).title ?? '').slice(0, 120),
    ...(Number.isInteger(hwndRaw) && hwndRaw > 0 ? { hwnd: hwndRaw } : {}),
  };
}

// Windows that cannot be a session's host: browsers, the shell, chat apps — and the companion itself (the person may
// have clicked it in the same second). A rejected capture stores nothing; the next prompt tries again.
const NOT_A_HOST = /^(?:chrome|msedge|firefox|brave|opera|explorer|discord|slack|teams|ms-teams|outlook|spotify|searchhost|startmenuexperiencehost|shellexperiencehost|lockapp|finder|safari|dock|harnessmap(?:[ -]companion)?)$/i;
export function isPlausibleHostWindow(w: HostWindow | null): boolean {
  if (!w) return false;
  const name = w.name.replace(/\.exe$/i, '');
  if (NOT_A_HOST.test(name)) return false;
  if (/harnessmap companion/i.test(w.title ?? '')) return false;
  return true;
}

/** A short name for the app a window belongs to, for the button label and the result line. */
export function hostAppLabel(name: string | null | undefined): string {
  const n = String(name ?? '').replace(/\.exe$/i, '');
  if (!n) return '';
  if (/^windowsterminal$/i.test(n)) return 'Windows Terminal';
  if (/^code(?: - insiders)?$/i.test(n) || /^Code Helper/i.test(n) || /^Electron$/i.test(n)) return 'VS Code';
  if (/^(chatgpt|codex)$/i.test(n)) return 'Codex app';
  if (/^(cmd|pwsh|powershell|conhost|openconsole)$/i.test(n)) return 'the terminal';
  if (/^iterm2?$/i.test(n)) return 'iTerm';
  if (/^terminal$/i.test(n)) return 'Terminal';
  return n;
}

/** The foreground window right now: one PowerShell call on Windows, System Events on macOS, xdotool on Linux when present. */
export async function captureHostWindow(timeoutMs = 6000): Promise<HostWindow | null> {
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      "Add-Type -Namespace HW -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'",
      '$h=[HW.U]::GetForegroundWindow(); $wpid=[uint32]0; [void][HW.U]::GetWindowThreadProcessId($h,[ref]$wpid); $p=Get-Process -Id $wpid -ErrorAction SilentlyContinue',
      '@{hwnd=[int64]$h; pid=[int]$wpid; name=[string]$p.ProcessName; title=[string]$p.MainWindowTitle} | ConvertTo-Json -Compress',
    ].join('\n');
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], timeoutMs);
    try { return parseWindow(JSON.parse(out.trim())); } catch { return null; }
  }
  if (process.platform === 'darwin') {
    const out = await run('osascript', ['-e', 'tell application "System Events" to get {unix id, name} of first application process whose frontmost is true'], timeoutMs);
    const m = /^(\d+),\s*(.*)$/.exec(out.trim()); return m ? parseWindow({ pid: Number(m[1]), name: m[2] }) : null;
  }
  const out = await run('xdotool', ['getactivewindow', 'getwindowpid', 'getwindowname'], timeoutMs);
  const [pid, ...rest] = out.trim().split('\n');
  const hwnd = Number((await run('xdotool', ['getactivewindow'], timeoutMs)).trim());
  return pid ? parseWindow({ pid: Number(pid), name: '', title: rest.join(' '), hwnd }) : null;
}

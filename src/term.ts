// M97 (Mark): embedded Claude Code sessions — the webpage runs the REAL
// `claude` CLI behind each tab through a PTY, so the native TUI (permission
// prompts, plan mode, diffs) renders unmodified in the browser via xterm.js.
// Hooks fire exactly as in an external terminal, so the map integration is
// free. Security stance: this module only ever spawns the fixed claude
// binary (or HARNESSMAP_TERM_CMD for tests) — never a shell — and the server
// is loopback-only without auth.
//
// PTY strategy: node-pty when its native build is available (live resize),
// else the util-linux/BSD `script(1)` wrapper (real PTY, fixed size).

import { existsSync } from 'node:fs';

export interface TermSession {
  id: string;
  cwd: string;
  alive: boolean;
  createdAt: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  buffer: string[];      // replay scrollback (capped)
  bufferBytes: number;
  listeners: Set<(data: string) => void>;
  exitListeners: Set<() => void>;
}

const CMD = process.env.HARNESSMAP_TERM_CMD ?? 'claude';
const MAX_BUFFER = 200_000;

let nodePty: any = null;
try { nodePty = require('node-pty'); } catch { /* fallback below */ }

// Backend order: Bun's native PTY (zero deps, live resize — Bun ≥1.3),
// then node-pty (live resize, needs a C toolchain), then script(1) (real
// PTY, fixed size, works everywhere Unix).
const hasBunPty = typeof (Bun as any).Terminal === 'function';
export const ptyBackend = hasBunPty ? 'bun' : nodePty ? 'node-pty' : 'script';

const sessions = new Map<string, TermSession>();

function push(t: TermSession, data: string) {
  t.buffer.push(data);
  t.bufferBytes += data.length;
  while (t.bufferBytes > MAX_BUFFER && t.buffer.length > 1) {
    t.bufferBytes -= t.buffer[0].length;
    t.buffer.shift();
  }
  for (const fn of t.listeners) { try { fn(data); } catch {} }
}

function ended(t: TermSession) {
  t.alive = false;
  for (const fn of t.exitListeners) { try { fn(); } catch {} }
}

export function createTerm(id: string, cwd: string, cols = 120, rows = 32): TermSession | { error: string } {
  if (!existsSync(cwd)) return { error: `directory does not exist: ${cwd}` };
  const t: TermSession = {
    id, cwd, alive: true, createdAt: Date.now(),
    write: () => {}, resize: () => {}, kill: () => {},
    buffer: [], bufferBytes: 0, listeners: new Set(), exitListeners: new Set(),
  };
  try {
    if (hasBunPty) {
      const dec = new TextDecoder();
      const bt = new (Bun as any).Terminal({
        cols, rows,
        data: (_term: any, chunk: any) => push(t, dec.decode(chunk)),
      });
      const p = Bun.spawn([CMD], { cwd, terminal: bt, env: { ...process.env, TERM: 'xterm-256color' } });
      p.exited.then(() => { ended(t); try { bt.close(); } catch {} });
      t.write = (d) => { try { bt.write(d); } catch {} };
      t.resize = (c, r) => { try { bt.resize(c, r); } catch {} };
      t.kill = () => { try { p.kill(); } catch {} try { bt.close(); } catch {} };
    } else if (nodePty) {
      const p = nodePty.spawn(CMD, [], {
        name: 'xterm-256color', cols, rows, cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      p.onData((d: string) => push(t, d));
      p.onExit(() => ended(t));
      t.write = (d) => { try { p.write(d); } catch {} };
      t.resize = (c, r) => { try { p.resize(c, r); } catch {} };
      t.kill = () => { try { p.kill(); } catch {} };
    } else {
      // script(1): real PTY, no native deps. Linux and macOS argv differ.
      const argv = process.platform === 'darwin'
        ? ['script', '-q', '/dev/null', CMD]
        : ['script', '-qfec', CMD, '/dev/null'];
      const p = Bun.spawn(argv, {
        cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) },
      });
      (async () => {
        const dec = new TextDecoder();
        for await (const chunk of p.stdout as any) push(t, dec.decode(chunk));
      })().catch(() => {});
      (async () => {
        const dec = new TextDecoder();
        for await (const chunk of p.stderr as any) push(t, dec.decode(chunk));
      })().catch(() => {});
      p.exited.then(() => ended(t));
      const w = (p.stdin as any);
      t.write = (d) => { try { w.write(d); w.flush?.(); } catch {} };
      t.resize = () => {}; // fixed-size under script(1)
      t.kill = () => { try { p.kill(); } catch {} };
    }
  } catch (err) {
    return { error: `could not start ${CMD}: ${err instanceof Error ? err.message : String(err)}` };
  }
  sessions.set(id, t);
  return t;
}

export const getTerm = (id: string) => sessions.get(id);
export const listTerms = () => [...sessions.values()].map((t) => ({ id: t.id, cwd: t.cwd, alive: t.alive, createdAt: t.createdAt }));
export function killTerm(id: string): boolean {
  const t = sessions.get(id);
  if (!t) return false;
  t.kill();
  sessions.delete(id);
  return true;
}

import { describe, expect, test } from 'bun:test';
import { walkChain, parseChain, listProcesses, captureHostChain, parseWindow, isPlausibleHostWindow, hostAppLabel } from './host-chain.js';

const rows = [
  { pid: 900, ppid: 800, name: 'bun' },           // the hook
  { pid: 800, ppid: 700, name: 'powershell.exe' }, // Codex's wrapper on Windows (exits right after the hook)
  { pid: 700, ppid: 600, name: 'codex.exe' },      // the CLI
  { pid: 600, ppid: 500, name: 'WindowsTerminal.exe' },
  { pid: 500, ppid: 4, name: 'explorer.exe' },
];

describe('walkChain (M503)', () => {
  test('walks from the hook parent up through the wrapper, the CLI and the terminal', () => {
    expect(walkChain(rows, 800).map((e) => e.name)).toEqual(['powershell.exe', 'codex.exe', 'WindowsTerminal.exe', 'explorer.exe']);
  });
  test('stops at an unknown parent, honours the depth cap, and survives a cycle', () => {
    expect(walkChain(rows, 700, 2).map((e) => e.pid)).toEqual([700, 600]);
    expect(walkChain([{ pid: 10, ppid: 11, name: 'a' }, { pid: 11, ppid: 10, name: 'b' }], 10).length).toBe(2);
    expect(walkChain(rows, 12345)).toEqual([]);
  });
  test('parseChain accepts only a bounded list of positive pids', () => {
    expect(parseChain([{ pid: 1, name: 'x' }])).toEqual([{ pid: 1, name: 'x' }]);
    expect(parseChain([{ pid: 0 }])).toBeNull();
    expect(parseChain('nope')).toBeNull();
    expect(parseChain(Array.from({ length: 13 }, () => ({ pid: 1 })))).toBeNull();
  });
  test('the live capture finds this very process and its parent', async () => {
    const rows = await listProcesses();
    expect(rows.find((r) => r.pid === process.pid)).toBeTruthy();
    const chain = await captureHostChain(process.pid);
    expect(chain[0]?.pid).toBe(process.pid);
    expect(chain.length).toBeGreaterThan(1);
  });
});

describe('host window (M506)', () => {
  test('parseWindow keeps pid, name, title and a positive hwnd only', () => {
    expect(parseWindow({ hwnd: 66052, pid: 4321, name: 'WindowsTerminal', title: 'pwsh' })).toEqual({ hwnd: 66052, pid: 4321, name: 'WindowsTerminal', title: 'pwsh' });
    expect(parseWindow({ hwnd: 0, pid: 7, name: 'Terminal' })).toEqual({ pid: 7, name: 'Terminal', title: '' });
    expect(parseWindow({ pid: 0 })).toBeNull();
    expect(parseWindow('x')).toBeNull();
  });
  test('a browser, the shell or the companion itself is never a session window', () => {
    expect(isPlausibleHostWindow({ pid: 1, name: 'msedge' })).toBe(false);
    expect(isPlausibleHostWindow({ pid: 1, name: 'explorer.exe' })).toBe(false);
    expect(isPlausibleHostWindow({ pid: 1, name: 'harnessmap-companion' })).toBe(false);
    expect(isPlausibleHostWindow({ pid: 1, name: 'Code', title: 'llm - harnessmap companion' })).toBe(false);
    expect(isPlausibleHostWindow({ pid: 1, name: 'WindowsTerminal', title: 'pwsh' })).toBe(true);
    expect(isPlausibleHostWindow({ pid: 1, name: 'ChatGPT' })).toBe(true);
    expect(isPlausibleHostWindow(null)).toBe(false);
  });
  test('hostAppLabel names the app in plain words', () => {
    expect(hostAppLabel('WindowsTerminal.exe')).toBe('Windows Terminal');
    expect(hostAppLabel('Code')).toBe('VS Code');
    expect(hostAppLabel('ChatGPT')).toBe('Codex app');
    expect(hostAppLabel('iTerm2')).toBe('iTerm');
    expect(hostAppLabel('WezTerm')).toBe('WezTerm');
    expect(hostAppLabel('')).toBe('');
  });
});

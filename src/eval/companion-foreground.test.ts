// The companion's ONE "go to session" button (M401 → M503 → PR #4/#6 → M506): which session it aims at, when it shows,
// what it tries first, and what it falls back to. Runs the real page script in happy-dom with a Tauri shim.
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window, type HTMLElement } from 'happy-dom';

const html = readFileSync(new URL('../../companion/web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });

type Chat = { id: string; lastActivity: string; host: Record<string, unknown> };
const threadId = '01234567-89ab-7cde-8fab-0123456789ab';
const chat = (id: string, lastActive: string, host: Record<string, unknown> = {}): Chat => ({
  id, lastActivity: lastActive,
  host: { sessionId: id, harness: 'claude', status: 'live', idle: false, lastActive, hostPid: 1234, hostChain: null, hostWindow: null, ...host },
});

async function boot(chats: Chat[], options: { native?: boolean; openError?: string; fg?: { ok: boolean; detail: string } } = {}) {
  const window = new Window({ url: 'http://localhost/' });
  windows.push(window);
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  window.document.body.classList.add('open');
  const calls: { command: string; path?: string; threadId?: string }[] = [];
  const state = { projects: [], chats, nodes: [], filings: {} };
  const fg = options.fg ?? { ok: true, detail: 'brought Windows Terminal to the front' };
  if (options.native !== false) (window as any).__TAURI__ = { core: { invoke: async (command: string, args: any) => {
    calls.push({ command, path: args?.path, ...(args?.threadId ? { threadId: args.threadId } : {}) });
    if (command === 'map_port_cmd') return 8790;
    if (command === 'get_settings') return { launchAtLogin: false, startMapOnOpen: true };
    if (command === 'api') return JSON.stringify(args.path === '/api/state' ? state : fg);
    if (command === 'open_desktop_session' && options.openError) throw new Error(options.openError);
    return true;
  } } };
  const shims = {
    window, document: window.document, WebSocket: class {},
    fetch: async () => ({ ok: true, json: async () => state }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  };
  new Function(...Object.keys(shims), script)(...Object.values(shims));
  await new Promise(resolve => setTimeout(resolve, 0));
  const button = window.document.getElementById('go-session')! as HTMLElement;
  calls.length = 0;
  const click = async () => { await (button as any).onclick(); };
  const last = () => window.document.getElementById('p-last')!.textContent;
  return { window, button, calls, click, last };
}

test('a newer session awaiting its identity does not aim at an older session', async () => {
  const { window, button, calls, click } = await boot([
    chat('older', '2026-10-19 05:00:00'),
    chat('newer', '2026-10-19 05:01:00', { hostPid: null }),
  ]);
  expect(button.hidden).toBe(true);
  expect(window.getComputedStyle(button).display).toBe('none');
  await click();
  expect(calls).toHaveLength(0);
});

test('host activity orders candidates, not a later filing in an older chat; the grant comes before the call', async () => {
  const older = chat('older', '2026-10-19 05:00:00'); older.lastActivity = '2026-10-19 05:05:00';
  const { button, calls, click, last } = await boot([older, chat('newer', '2026-10-19 05:01:00')]);
  expect(button.hidden).toBe(false);
  await click();
  expect(calls).toEqual([{ command: 'allow_foreground', path: undefined }, { command: 'api', path: '/api/chats/newer/foreground' }]);
  expect(last()).toBe('brought Windows Terminal to the front');
});

test('the typed-in window names the destination in the label', async () => {
  const { button } = await boot([chat('s', '2026-10-19 05:01:00', { hostWindow: { hwnd: 1, pid: 9, name: 'Code', label: 'VS Code' } })]);
  expect(button.textContent).toBe('go to session · VS Code');
});

test('idle and closed sessions leave no button', async () => {
  const { window, button, calls, click } = await boot([
    chat('idle', '2026-10-19 05:00:00', { idle: true }),
    chat('closed', '2026-10-19 05:01:00', { status: 'closed' }),
  ]);
  expect(button.hidden).toBe(true);
  expect(window.getComputedStyle(button).display).toBe('none');
  await click();
  expect(calls).toHaveLength(0);
});

test('a Codex session with no window record yet goes straight to the desktop app, labelled so', async () => {
  const { button, calls, click, last } = await boot([chat('map-chat-id', '2026-10-19 05:01:00', { harness: 'codex', sessionId: threadId, hostPid: null })]);
  expect(button.hidden).toBe(false);
  expect(button.textContent).toBe('go to session · Codex app');
  await click();
  expect(calls.map((c) => c.command)).toEqual(['allow_foreground', 'open_desktop_session']);
  expect(calls[1].threadId).toBe(threadId);
  expect(last()).toBe('opened the session in the desktop app');
});

test('a Codex session goes to the app even when a window or pid is known — no window heuristic for Codex (M507)', async () => {
  const { button, calls, click, last } = await boot([chat('c', '2026-10-19 05:01:00', { harness: 'codex', sessionId: threadId, hostPid: 77, hostWindow: { hwnd: 5, pid: 8, name: 'WindowsTerminal', label: 'Windows Terminal' } })]);
  expect(button.textContent).toBe('go to session · Codex app');
  await click();
  expect(calls.map((c) => c.command)).toEqual(['allow_foreground', 'open_desktop_session']);
  expect(last()).toBe('opened the session in the desktop app');
});

test('a Claude Code session with a dead window reports the failure plainly, with no app fallback', async () => {
  const { calls, click, last } = await boot([chat('cc', '2026-10-19 05:01:00')], { fg: { ok: false, detail: 'no visible window for that session (a remote/SSH or multiplexer session has none)' } });
  await click();
  expect(calls.map((c) => c.command)).toEqual(['allow_foreground', 'api']);
  expect(last()).toBe('no visible window for that session (a remote/SSH or multiplexer session has none)');
});

test('a failed deep link is reported without claiming anything', async () => {
  const { button, click, last } = await boot([chat('c', '2026-10-19 05:01:00', { harness: 'codex', sessionId: threadId, hostPid: null })], { openError: 'protocol handler unavailable' });
  await click();
  expect(last()).toBe('could not open this session in the desktop app');
  expect(button.hasAttribute('disabled')).toBe(false);
});

test('opaque ids, a non-Codex harness and the browser copy get no app route', async () => {
  for (const [host, options] of [
    [{ harness: 'codex', sessionId: 'opaque-mcp-session', hostPid: null }, {}],
    [{ harness: 'codex', sessionId: 'new', hostPid: null }, {}],
    [{ harness: 'claude', sessionId: threadId, hostPid: null }, {}],
    [{ harness: 'codex', sessionId: threadId, hostPid: null }, { native: false }],
  ] as const) {
    const { window, button, calls, click } = await boot([chat('map-chat-id', '2026-10-19 05:01:00', host)], options);
    expect(button.hidden).toBe(true);
    expect(window.getComputedStyle(button).display).toBe('none');
    await click();
    expect(calls).toHaveLength(0);
  }
});

test('a Claude Code session with a Remote Control id goes to claude.ai, labelled so; without one it uses the window (M507)', async () => {
  const web = await boot([chat('cc', '2026-10-19 05:01:00', { webId: 'session_01KrDXwmPDvypgLaGgRUH4dW', hostWindow: { hwnd: 1, pid: 9, name: 'WindowsTerminal', label: 'Windows Terminal' } })]);
  expect(web.button.textContent).toBe('go to session · claude.ai');
  await web.click();
  expect(web.calls.map((c) => c.command)).toEqual(['allow_foreground', 'open_claude_session']);
  expect(web.last()).toBe('opened the session on claude.ai');
  const local = await boot([chat('cc2', '2026-10-19 05:01:00', { webId: null, hostWindow: { hwnd: 1, pid: 9, name: 'WindowsTerminal', label: 'Windows Terminal' } })]);
  expect(local.button.textContent).toBe('go to session · Windows Terminal');
  await local.click();
  expect(local.calls.map((c) => c.command)).toEqual(['allow_foreground', 'api']);
});

test('a malformed web id is ignored, and the browser copy never opens claude.ai itself', async () => {
  const bad = await boot([chat('cc', '2026-10-19 05:01:00', { webId: 'javascript:alert(1)', hostPid: null })]);
  expect(bad.button.hidden).toBe(true);
  const browser = await boot([chat('cc', '2026-10-19 05:01:00', { webId: 'session_01KrDXwmPDvypgLaGgRUH4dW', hostPid: null })], { native: false });
  expect(browser.button.hidden).toBe(true);
});

// M508: nothing running → the slot offers to RESUME the newest quiet session, with the verb saying so.
const recent = () => new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
const old = '2026-01-01 00:00:00';

test('an idle Codex session resumes in the Codex app by the same deep link', async () => {
  const { button, calls, click, last } = await boot([chat('c', recent(), { harness: 'codex', sessionId: threadId, idle: true })]);
  expect(button.textContent).toBe('resume session · Codex app');
  await click();
  expect(calls.map((c) => c.command)).toEqual(['allow_foreground', 'open_desktop_session']);
  expect(last()).toBe('opened the session in the desktop app');
});

test('an idle Claude Code session resumes in Claude Desktop through the map, when the map can', async () => {
  const yes = await boot([chat('cc', recent(), { idle: true, canResumeInDesktop: true })], { fg: { ok: true, detail: 'resumed the session in Claude Desktop' } });
  expect(yes.button.textContent).toBe('resume session · Claude Desktop');
  await yes.click();
  expect(yes.calls).toEqual([{ command: 'allow_foreground', path: undefined }, { command: 'api', path: '/api/chats/cc/resume-desktop' }]);
  expect(yes.last()).toBe('resumed the session in Claude Desktop');
  const no = await boot([chat('cc', recent(), { idle: true, canResumeInDesktop: false })]);
  expect(no.button.hidden).toBe(true);
});

test('a running session wins over an idle one; a week-old idle session is not offered', async () => {
  const live = await boot([chat('old-idle', recent(), { harness: 'codex', sessionId: threadId, idle: true }), chat('live', recent())]);
  expect(live.button.textContent).toBe('go to session');
  const stale = await boot([chat('stale', old, { harness: 'codex', sessionId: threadId, idle: true })]);
  expect(stale.button.hidden).toBe(true);
});

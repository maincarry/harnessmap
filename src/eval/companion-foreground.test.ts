import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window, type HTMLElement } from 'happy-dom';

const html = readFileSync(new URL('../../companion/web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });

type Chat = { id: string; lastActivity: string; host: Record<string, unknown> };
const chat = (id: string, lastActive: string, host: Record<string, unknown> = {}): Chat => ({
  id, lastActivity: lastActive,
  host: { sessionId: id, status: 'live', idle: false, lastActive, hostPid: 1234, ...host },
});

async function boot(chats: Chat[]) {
  const window = new Window({ url: 'http://localhost/' });
  windows.push(window);
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  window.document.body.classList.add('open');
  const calls: { command: string; path?: string }[] = [];
  const state = { projects: [], chats, nodes: [], filings: {} };
  (window as any).__TAURI__ = { core: { invoke: async (command: string, args: any) => {
    calls.push({ command, path: args?.path });
    if (command === 'map_port_cmd') return 8790;
    if (command === 'get_settings') return { launchAtLogin: false, startMapOnOpen: true };
    if (command === 'api') return JSON.stringify(args.path === '/api/state' ? state : { ok: true, detail: 'brought test app to the front' });
    return true;
  } } };
  const shims = {
    window, document: window.document, WebSocket: class {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  };
  new Function(...Object.keys(shims), script)(...Object.values(shims));
  // Finish the real page's async initialization without running its recurring poll.
  await new Promise(resolve => setTimeout(resolve, 0));
  const button = window.document.getElementById('fg-session')! as HTMLElement;
  calls.length = 0;
  const click = async () => { await (button as any).onclick(); };
  return { window, button, calls, click };
}

test('a newer session awaiting its pid does not foreground an older session', async () => {
  const { window, button, calls, click } = await boot([
    chat('older', '2026-10-19 05:00:00'),
    chat('newer', '2026-10-19 05:01:00', { hostPid: null, hostChain: null }),
  ]);
  expect(button.hidden).toBe(true);
  expect(window.getComputedStyle(button).display).toBe('none');
  await click();
  expect(calls).toHaveLength(0);
});

test('the actual host activity orders candidates, not a later filing in an older chat', async () => {
  const older = chat('older', '2026-10-19 05:00:00');
  older.lastActivity = '2026-10-19 05:05:00';
  const { button, calls, click } = await boot([older, chat('newer', '2026-10-19 05:01:00')]);
  expect(button.hidden).toBe(false);
  await click();
  expect(calls).toEqual([
    { command: 'allow_foreground', path: undefined },
    { command: 'api', path: '/api/chats/newer/foreground' },
  ]);
});

test('idle and closed sessions do not leave a visible foreground button', async () => {
  const { window, button, calls, click } = await boot([
    chat('idle', '2026-10-19 05:00:00', { idle: true }),
    chat('closed', '2026-10-19 05:01:00', { status: 'closed' }),
  ]);
  expect(button.hidden).toBe(true);
  expect(window.getComputedStyle(button).display).toBe('none');
  await click();
  expect(calls).toHaveLength(0);
});

test('a captured chain identifies the newest session even without its separate pid report', async () => {
  const { button, calls, click } = await boot([
    chat('older', '2026-10-19 05:00:00'),
    chat('newer', '2026-10-19 05:01:00', { hostPid: null, hostChain: [{ pid: 1234, name: 'codex.exe' }] }),
  ]);
  expect(button.hidden).toBe(false);
  await click();
  expect(calls.at(-1)?.path).toBe('/api/chats/newer/foreground');
});

test('an empty map hides the foreground action with its actual stylesheet', async () => {
  const { window, button } = await boot([]);
  expect(button.hidden).toBe(true);
  expect(window.getComputedStyle(button).display).toBe('none');
});

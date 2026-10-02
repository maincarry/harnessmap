import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../../companion/web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });

async function boot(native = true) {
  const window = new Window({ url: 'http://localhost/' });
  windows.push(window);
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  const calls: string[] = [];
  const state = { projects: [], chats: [], nodes: [], filings: {} };
  if (native) (window as any).__TAURI__ = { core: { invoke: async (command: string) => {
    calls.push(command);
    if (command === 'map_port_cmd') return 8790;
    if (command === 'api') return JSON.stringify(state);
  } } };
  const shims = {
    window, document: window.document,
    fetch: async () => ({ ok: true, json: async () => state }),
    WebSocket: class {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  };
  // Execute the actual page script, following the repo's UI smoke harness.
  new Function(...Object.keys(shims), script)(...Object.values(shims));
  await Promise.resolve();
  return { window, calls, menuCalls: () => calls.filter(command => command === 'show_companion_menu') };
}

test('right-clicking the widget requests the native companion menu', async () => {
  const { window, menuCalls } = await boot();
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  window.document.getElementById('chip')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(menuCalls()).toHaveLength(1);
});

test('the visible menu button opens the same native menu', async () => {
  const { window, menuCalls } = await boot();
  const button = window.document.getElementById('companion-menu')!;
  expect(button.hidden).toBe(false);
  button.click();
  expect(menuCalls()).toHaveLength(1);
});

test('right-clicking the text field retains its editing menu', async () => {
  const { window, menuCalls } = await boot();
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  window.document.getElementById('ask')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(menuCalls()).toHaveLength(0);
});

test('browser preview retains normal context menus and hides native menu control', async () => {
  const { window, menuCalls } = await boot(false);
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  window.document.getElementById('chip')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(window.document.getElementById('companion-menu')!.hidden).toBe(true);
  expect(menuCalls()).toHaveLength(0);
});

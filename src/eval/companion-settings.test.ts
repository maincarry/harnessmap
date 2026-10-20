// M509 (Mark): the companion's main surface shows state (focus, map, status light) and the two actions; every preference
// lives in a settings view behind the gear, inside the panel. Runs the real page script in happy-dom.
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../../companion/web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const windows: Window[] = [];
afterEach(async () => { for (const w of windows.splice(0)) await w.happyDOM.close(); });

async function boot(native = true) {
  const window = new Window({ url: 'http://localhost/' }); windows.push(window);
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  const calls: string[] = [];
  const state = { projects: [], chats: [], nodes: [], filings: {} };
  if (native) (window as any).__TAURI__ = { core: { invoke: async (c: string, a: any) => { calls.push(c); if (c === 'map_port_cmd') return 8790; if (c === 'get_settings') return { launchAtLogin: false, startMapOnOpen: true }; if (c === 'api') return JSON.stringify(state); return true; } } };
  const shims = { window, document: window.document, WebSocket: class {}, fetch: async () => ({ ok: true, json: async () => state }), setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0 };
  new Function(...Object.keys(shims), script)(...Object.values(shims));
  await new Promise((r) => setTimeout(r, 0));
  const $ = (id: string): any => window.document.getElementById(id)!;
  const body = window.document.body;
  return { window, $, body, calls };
}

test('the preferences sit in the settings view, not on the main surface', async () => {
  const { $ } = await boot();
  for (const id of ['inf-toggle', 'set-login', 'set-autostart', 'reset-pos', 'ver']) expect($('settings').contains($(id))).toBe(true);
  for (const id of ['p-focus', 'p-mapname', 'p-state', 'open-map', 'go-session', 'ask']) expect($('main').contains($(id))).toBe(true);
});

test('the gear opens the settings view, back and close leave it', async () => {
  const { $, body } = await boot();
  body.classList.add('open');
  expect(body.classList.contains('prefs')).toBe(false);
  ($('settings-btn') as any).onclick();
  expect(body.classList.contains('prefs')).toBe(true);
  ($('settings-back') as any).onclick();
  expect(body.classList.contains('prefs')).toBe(false);
  ($('settings-btn') as any).onclick();
  ($('x') as any).onclick({ stopPropagation() {} });
  expect(body.classList.contains('prefs')).toBe(false);
  expect(body.classList.contains('open')).toBe(false);
});

test('reset position is a native-only row that calls the shell', async () => {
  const native = await boot();
  expect(native.$('reset-pos').hidden).toBe(false);
  (native.$('reset-pos') as any).onclick();
  expect(native.calls).toContain('reset_position');
  const browser = await boot(false);
  expect(browser.$('reset-pos').hidden).toBe(true);
  expect(browser.$('set-login').hidden).toBe(true);
});

// M510 (Mark): the ⋯ folded into the gear. Exit lives at the bottom of the settings view; the off card opens the same view.
test('exit the companion is a native-only row that quits the shell; the off card reaches settings too', async () => {
  const native = await boot();
  expect(native.$('quit-app').hidden).toBe(false);
  expect(native.$('settings').contains(native.$('quit-app'))).toBe(true);
  (native.$('quit-app') as any).onclick();
  expect(native.calls).toContain('quit_app');
  expect(native.window.document.getElementById('companion-menu')).toBeNull();
  native.body.classList.add('offline');
  (native.$('off-settings') as any).onclick();
  expect(native.body.classList.contains('prefs')).toBe(true);
  (native.$('settings-back') as any).onclick();
  expect(native.body.classList.contains('prefs')).toBe(false);
  const browser = await boot(false);
  expect(browser.$('quit-app').hidden).toBe(true);
  expect(browser.$('off-settings').hidden).toBe(true);
});

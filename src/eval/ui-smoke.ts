// UI smoke harness (M131): boots the REAL page against a REAL scratch server
// and drives every visible control, failing on any thrown error. This is the
// layer the integration suite can't see — the field bugs of 2026-08-23 (tidy
// modal template crash, zoom-root fold, a TDZ crash this harness caught on
// its first run) all lived here.
//
// How it executes the page: happy-dom provides the DOM only; the page's
// inline script runs NATIVELY in Bun (new Function with explicit shims) —
// happy-dom's own script evaluation is disabled-by-default and its compiler
// can't parse our vendor bundles, and jsdom's VM trips over Bun. Native
// execution also means real stack traces and no realm split.
//
// Run: env -u ANTHROPIC_API_KEY -u HARNESSMAP_INFERENCE bun run src/eval/ui-smoke.ts

import { Window } from 'happy-dom';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = '/tmp/claude-1000/harnessmap-ui';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- scratch server with a small seeded map ----------
const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
  env: { ...process.env, HARNESSMAP_DB: join(TMP, 'ui.sqlite'), PORT: String(PORT), HARNESSMAP_TERM_CMD: 'bash' },
  stdout: Bun.file(join(TMP, 'server.log')), stderr: Bun.file(join(TMP, 'server.log')),
});
process.on('exit', () => server.kill());
let up = false;
for (let i = 0; i < 20; i++) { try { await fetch(`${BASE}/api/state`); up = true; break; } catch { await sleep(400); } }
if (!up) { console.error('server never came up'); process.exit(1); }
const post = (p: string, b: unknown = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({}));
await post('/api/nodes', { content: 'trip planning' });
let st = await (await fetch(`${BASE}/api/state`)).json();
const trip = st.nodes.find((n: any) => n.content === 'trip planning').id;
await post('/api/nodes', { content: 'book flights', parentId: trip });
await post('/api/nodes', { content: 'hotel shortlist', parentId: trip });
st = await (await fetch(`${BASE}/api/state`)).json();
const flights = st.nodes.find((n: any) => n.content === 'book flights').id;
await post('/api/nodes', { content: 'aisle seat preference', parentId: flights });

// ---------- boot the page (DOM from happy-dom, script run natively) ----------
const rawHtml = await Bun.file('public/index.html').text();
const script = rawHtml.match(/<script>([\s\S]*)<\/script>/)![1];
const htmlNoScript = rawHtml.replace(/<script src="[^"]*"><\/script>/g, '').replace(/<script>[\s\S]*<\/script>/, '');
const window: any = new Window({ url: BASE + '/' });
window.document.write(htmlNoScript);
const document = window.document;
const errors: string[] = [];
process.on('unhandledRejection', (e: any) => errors.push('async: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')));
const shims: Record<string, any> = {
  window, document,
  localStorage: window.localStorage,
  fetch: (input: any, init?: any) => fetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init),
  WebSocket: class { onmessage: any; onclose: any; onopen: any; readyState = 1; send() {} close() {} },
  confirm: () => true, prompt: () => null, alert: () => {},
  location: window.location, history: { pushState() {}, replaceState() {} },
  getComputedStyle: (el: any) => window.getComputedStyle(el),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  Event: window.Event, screen: { width: 1600, height: 1000 },
  Terminal: undefined, FitAddon: undefined,
};
// vendor renderer libs: attach to globalThis (UMD), hand to the page's window
{
  const g: any = globalThis;
  if (!(window as any).NamedNodeMap) (window as any).NamedNodeMap = class NamedNodeMap {}; // happy-dom gap; real browsers have it
  g.window = window; g.self = window; g.document = document;
  new Function(await Bun.file('public/vendor/marked.min.js').text())();
  new Function(await Bun.file('public/vendor/purify.min.js').text())();
  window.marked = g.marked; window.DOMPurify = g.DOMPurify;
}
try {
  new Function(...Object.keys(shims), `${script}\n`)(...Object.values(shims));
} catch (e: any) {
  console.log('PAGE SCRIPT THREW AT LOAD:', String(e?.stack ?? e).split('\n').slice(0, 4).join('\n'));
  server.kill();
  process.exit(1);
}
await sleep(900); // initial fetches settle
const $ = (id: string) => document.getElementById(id);
const S = () => window.__state?.();
// no WebSocket in the harness — pump the page's own refresh() where the real
// app would receive a broadcast
const pump = async () => { try { await window.__refresh?.(); } catch (e: any) { errors.push('refresh: ' + e); } await sleep(120); };

check('page script ran to completion (hooks exposed)', typeof window.__state === 'function');
check('boot produced no async errors', errors.length === 0, errors[0]);
check('state loaded into the page', !!S()?.nodes?.length);
check('tree rendered rows', document.querySelectorAll('.nrow').length >= 2);
check('to-sort tray rendered', !!document.querySelector('.nrow.tosort'));
check('home button present (SVG icon)', !!$('home-btn')?.querySelector('svg'));

const click = async (el: any, name: string, settle = 250) => {
  const before = errors.length;
  if (!el) { check(`click: ${name}`, false, 'element not found'); return; }
  try { el.click(); } catch (e: any) { errors.push(`${name}: ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')}`); }
  await sleep(settle);
  check(`click: ${name}`, errors.length === before, errors.slice(before).join(' | '));
};

// ---------- header / toolbar ----------
await click($('home-btn'), 'home (whole-map default)');
await click($('ctx-btn'), "chat agent's view", 600);
document.querySelector('#cx-close')?.click(); await sleep(100);
await click($('search-btn'), '🔍 search');
document.querySelectorAll('.overlay').forEach((o: any) => o.remove());
await click($('map-chat'), '🗨 talk to map (open modal)');
document.querySelectorAll('.overlay').forEach((o: any) => o.remove());

// ---------- ⋯ other: tiers ----------
await click($('other-btn'), '⋯ other opens');
check('primary tier visible, secondary folded', !$('other-menu')!.hasAttribute('hidden') && $('other-more')!.hasAttribute('hidden'));
await click($('other-more-btn'), '＋ more expands');
check('secondary tier visible, more-btn gone', !$('other-more')!.hasAttribute('hidden') && $('other-more-btn')!.hasAttribute('hidden'));
await click($('other-btn'), '⋯ closes');
await click($('other-btn'), '⋯ reopens folded');
check('reopen resets the fold', $('other-more')!.hasAttribute('hidden') && !$('other-more-btn')!.hasAttribute('hidden'));
await click($('dim-outside'), '◐ dim all outside (no zoom → explains)');
const viaMore = async (id: string, name: string) => {
  if ($('other-menu')!.hasAttribute('hidden')) await click($('other-btn'), `⋯ open (for ${name})`, 80);
  if ($('other-more')!.hasAttribute('hidden')) await click($('other-more-btn'), `expand (for ${name})`, 80);
  await click($(id), name);
};
await viaMore('lit-all', '☀ light all (view)');
await viaMore('dim-all', '◐ dim all (view)');
await viaMore('prefs-btn', '☰ map preferences modal');
const pf = document.querySelector('#pf-text') as any;
check('prefs modal opened', !!pf);
if (pf) { pf.value = '- test pref'; await click(document.querySelector('#pf-save'), 'prefs save'); }
document.querySelectorAll('.overlay').forEach((o: any) => o.remove());

// ---------- dev mode ----------
if ($('other-menu')!.hasAttribute('hidden')) await click($('other-btn'), '⋯ open (dev)', 80);
await click($('dev-btn'), '🔧 dev mode on + panel', 600);
check('dev panel opened', !!$('dev-panel'));
const dm = document.querySelector('#dev-mobile') as any;
check('dev panel has 📱 test mobile', !!dm);
check('dev panel tools row has 👁 (M159); 🐞 button removed per M159b', !!document.querySelector('#dev-ctx') && !document.querySelector('#dev-bug'));
await click(dm, '📱 opens iPhone frame');
const pframe: any = document.querySelector('#phone-frame iframe');
check('iPhone-size frame with live app iframe', !!pframe && pframe.getAttribute('src') === '/');
await click(document.querySelector('#phone-close'), 'phone preview close');
check('phone preview closed', !document.querySelector('#phone-ov'));
await click(document.querySelector('#dev-close'), 'dev panel close');

// ---------- tree interactions ----------
const rowFor = (id: string) => [...document.querySelectorAll('.nrow')].find((r: any) => r.querySelector(`[data-edit="${id}"]`)) as any;
const caretOf = (id: string) => rowFor(id)?.querySelector('.caret') as any;
check('trip row present', !!rowFor(trip));
check('trip collapsed by default shows count chip', !!rowFor(trip)?.querySelector('.fold-count'));
await click(caretOf(trip), 'expand trip');
const aisle = S()?.nodes.find((n: any) => n.content === 'aisle seat preference')?.id;
check('expand shows ONLY immediate children (M120)', !!rowFor(flights) && !rowFor(aisle));
await click(caretOf(flights), 'expand flights');
check('grandchild appears after second expand', !!rowFor(aisle));
await click(caretOf(trip), 'collapse trip again');
check('collapse hides the subtree', !rowFor(flights));

// zoom + fold the zoom root (M130)
await click(caretOf(trip), 're-expand trip');
await click(rowFor(trip)?.querySelector('[data-zoomin]'), 'zoom into trip');
check('zoomed view shows root + children', !!rowFor(trip) && !!rowFor(flights));
await click(caretOf(trip), 'collapse the ZOOM ROOT (M130)');
check('zoom root collapsed (children gone, row stays)', !!rowFor(trip) && !rowFor(flights));
await click(caretOf(trip), 're-expand zoom root');
await click($('zoom-out'), 'zoom out');

// row buttons
await click(rowFor(trip)?.querySelector('[data-focus]'), '▶ focus a row');
await click(rowFor(trip)?.querySelector('[data-lit]'), '☀ toggle light');
await click(rowFor(trip)?.querySelector('[data-fav]'), '★ favorite');
await click(rowFor(trip)?.querySelector('[data-sethome]'), 'set home on row');
await pump();
check('home badge appears on the row', !!rowFor(trip)?.querySelector('.badge svg'));
await click($('home-btn'), 'home zooms to the set node');
check('view zoomed to home (trip visible)', !!rowFor(trip));
await click($('zoom-out'), 'zoom out from home');

// add node (M114: no dialog, focused)
await click($('add-root'), '+ add node (unnamed + focused)', 500);
await pump();
check('untitled node created', S()?.nodes.some((n: any) => n.content === 'untitled'));

// delete with a focused session → warning modal (M123), then cancel
const untitled = S()?.nodes.find((n: any) => n.content === 'untitled')?.id;
if (untitled) {
  await click(rowFor(untitled)?.querySelector('[data-ndel]'), '✕ delete focused node → warning modal');
  check('delete warning modal listed the focused session', !!document.querySelector('#dl-go'));
  await click(document.querySelector('#dl-cancel'), 'delete warning cancel');
}

// status line + changes panel
await click($('round-line'), 'status line opens what-changed', 500);
check('changes panel opened', !!$('changes-panel'));
document.querySelectorAll('#changes-panel').forEach((o: any) => o.remove());

// ---------- import modal (M142) ----------
{
  if ($('other-menu')!.hasAttribute('hidden')) await click($('other-btn'), '⋯ open (import)', 80);
  await click($('import-btn'), '⇪ import opens the modal', 500);
  check('import modal: paste area + source sections', !!document.querySelector('#im-text') && !!document.querySelector('#im-files') && !!document.querySelector('#im-sess'));
  check('apply hidden until a proposal exists', document.querySelector('#im-apply')!.hasAttribute('hidden'));
  await click(document.querySelector('#im-cancel'), 'import modal cancel');
}

// ---------- sessions overview (M146) ----------
{
  if ($('other-menu')!.hasAttribute('hidden')) await click($('other-btn'), '⋯ open (sessions)', 80);
  await click($('sessions-btn'), '▦ sessions panel opens');
  check('overview lists sessions with pin/open', document.querySelectorAll('[data-spin]').length >= 1 && document.querySelectorAll('[data-sopen]').length >= 1);
  await click(document.querySelector('[data-spin]'), '📌 pin a session', 500);
  await pump();
  check('pin lands in state + tab bar order', S()?.chats.some((c: any) => c.pinned) && document.querySelector('#tab-list button')?.textContent?.includes('📌'));
  await click(document.querySelector('[data-spin]'), '📌 unpin', 500);
  document.querySelectorAll('.overlay').forEach((o: any) => o.remove());
}

// ---------- text size (M144) ----------
{
  await viaMore('font-btn', '🔠 text size cycles');
  check('text size steps to large-ward + persists', $('font-btn')!.textContent!.includes('large') && window.localStorage.getItem('hm-font') === 'large');
  await viaMore('font-btn', 'cycle'); await viaMore('font-btn', 'cycle'); await viaMore('font-btn', 'cycle');
  check('cycles back to normal', window.localStorage.getItem('hm-font') === 'normal');
}

// ---------- influence switch (M143) ----------
{
  await viaMore('influence-btn', '⏻ close map influence');
  check('influence button flips to reopen', $('influence-btn')!.textContent!.includes('reopen'));
  await viaMore('influence-btn', '⏻ reopen map influence');
  check('influence button flips back', $('influence-btn')!.textContent!.includes('close'));
}

// ---------- undo toast (M136) ----------
{
  const hotel = S()?.nodes.find((n: any) => n.content === 'hotel shortlist')?.id;
  await click(rowFor(hotel)?.querySelector('[data-ndel]'), '✕ delete a leaf (no sessions inside → confirm path)');
  await pump();
  check('leaf deleted', !S()?.nodes.some((n: any) => n.id === hotel));
  const chip = document.querySelector('#undo-chip') as any;
  check('status line shows the ↩ undo chip', !!chip);
  await click(chip, '↩ undo chip restores');
  await pump();
  check('node is back after undo', S()?.nodes.some((n: any) => n.id === hotel));
}

// ---------- tutorial: every step renders ----------
if (typeof window.tourShow === 'function') {
  const before = errors.length;
  const steps = window.TOUR?.length ?? 0;
  for (let i = 0; i < steps; i++) { try { window.tourShow(i); } catch (e: any) { errors.push(`tour step ${i}: ${e}`); } await sleep(20); }
  try { window.tourStop(); } catch (e: any) { errors.push(`tourStop: ${e}`); }
  check(`tour: all ${steps} steps render without errors`, errors.length === before, errors.slice(before).join(' | '));
  const badTargets: number[] = [];
  window.TOUR.forEach((step: any, i: number) => { const t = step.sel ? document.querySelector(step.sel) : step.find?.(); if (!t) badTargets.push(i); });
  check('tour: every step target resolves', badTargets.length === 0, `missing: ${badTargets.join(',')}`);
} else check('tour hooks exposed', false);

// ---------- tooltips: every control explains itself on hover (Jacob) ----------
const tooltipSweep = (label: string) => {
  const bad: string[] = [];
  for (const el of document.querySelectorAll('button, .rowbtn, .caret, .chip-new, .fold-count, .sdot, .ntype, [data-fold]')) {
    const e: any = el;
    if (e.closest('#tour-card')) continue; // tour nav buttons are self-explanatory by design
    const tip = (e.getAttribute('title') ?? e.dataset?.tip ?? '').trim();
    const glyphOnly = (e.textContent ?? '').trim().length <= 3 || e.classList.contains('rowbtn');
    if (!tip && glyphOnly) bad.push(`${e.tagName.toLowerCase()}#${e.id || e.className}: "${(e.textContent ?? '').trim().slice(0, 12)}"`);
  }
  check(`tooltips: every glyph control has one (${label})`, bad.length === 0, bad.slice(0, 6).join(' · '));
};
tooltipSweep('main view');
await click(caretOf(trip), 'expand for tooltip sweep', 100);
tooltipSweep('expanded rows');
await click($('other-btn'), '⋯ open for tooltip sweep', 80);
await click($('other-more-btn'), 'expand tiers for tooltip sweep', 80);
tooltipSweep('⋯ menu, both tiers');
await click($('other-btn'), '⋯ close after sweep', 80);

// the instant-tooltip mechanism itself: hover shows #tip, leaving hides it
{
  const target: any = $('search-btn');
  target.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await sleep(500); // tip delay
  const tipEl: any = $('tip');
  check('hovering a control shows the instant tooltip', !!tipEl && tipEl.classList.contains('show') && tipEl.textContent.length > 10, `tip="${tipEl?.textContent?.slice(0, 40)}"`);
  target.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  document.body.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await sleep(150);
}

// ---------- mobile view (M133) ----------
{
  Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await sleep(150);
  check('narrow viewport → mobile mode', document.body.classList.contains('mobile'));
  check('mobile: bottom bar visible, chat hidden', window.getComputedStyle($('mob-bar')).display === 'flex' && window.getComputedStyle($('chat-pane')).display === 'none');
  check('slim top bar with ☰ and map name', window.getComputedStyle($('mob-top')).display === 'flex' && $('mob-title')!.textContent!.length > 0);
  check('desktop toolbars hidden on mobile', window.getComputedStyle($('zoom-tools')).display === 'none');
  check('composer pill present on map view', window.getComputedStyle($('mob-ask')).display !== 'none');
  const fl = $('mob-flip') as any;
  await click(fl, 'flip → chat');
  // happy-dom caches an element's computed style and misses body-class
  // invalidation (probed + reproduced) — the earlier "composer present" check
  // primed #mob-ask. Assert the cascade on a FRESH element instead: a clone
  // with the same id computes uncached.
  const askProbe = (() => { const orig: any = $('mob-ask'); const parent = orig.parentElement; orig.id = 'mob-ask-tmp'; const c: any = orig.cloneNode(); c.id = 'mob-ask'; parent.appendChild(c); const d = window.getComputedStyle(c).display; c.remove(); orig.id = 'mob-ask'; return d; })();
  check('chat shown, composer pill hidden', document.body.classList.contains('mob-chat') && askProbe === 'none');
  await click(fl, 'flip → map');
  check('map back', !document.body.classList.contains('mob-chat'));
  await click($('mob-menu'), '☰ opens the drawer');
  check('drawer has sessions, maps, and actions', document.querySelectorAll('#mob-drawer .dr-row').length >= 15 && document.querySelectorAll('[data-dr-sess]').length >= 1);
  await click(document.querySelector('[data-dr-act="home-btn"]'), 'drawer action: home');
  check('drawer closed after action', !document.querySelector('#mob-drawer-ov'));
  // M135b: rows are plain text — tap a parent to fold/unfold, tap a leaf for
  // its sheet (long-press = sheet anywhere on real touch).
  await click(rowFor(trip), 'tap parent row → expands');
  check('parent tap expanded (flights visible)', !!rowFor(flights));
  await click(rowFor(flights), 'tap flights → expands');
  const aisleId = S()?.nodes.find((n: any) => n.content === 'aisle seat preference')?.id;
  await click(rowFor(aisleId), 'tap leaf row → action sheet');
  check('action sheet listed labeled actions', document.querySelectorAll('#sheet .sh-row').length >= 6 && !!document.querySelector('#sheet .sh-row .d'));
  const sheetFocus = [...document.querySelectorAll('#sheet .sh-row')].find((r: any) => r.textContent.includes('talk about this'));
  await click(sheetFocus, 'sheet action executes (focus)');
  check('sheet closed after action', !document.querySelector('#sheet-ov'));
  await click(rowFor(trip), 'tap parent again → collapses');
  check('parent tap collapsed', !rowFor(flights));
  await click(rowFor(trip), 're-expand for later tests');
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await sleep(150);
  check('wide viewport → desktop restored', !document.body.classList.contains('mobile'));
}

// ---------- mode-A chat: markdown, streaming, copy, talk-choice (M137-140) ----------
{
  const md = window.__md;
  check('renderer: real marked+DOMPurify active', typeof window.marked?.parse === 'function' && typeof window.DOMPurify?.sanitize === 'function');
  check('md: bold renders', md('a **b** c').includes('<strong>b</strong>'));
  check('md: inline code renders', md('use `x=1` here').includes('<code>x=1</code>'));
  check('md: fenced code renders', /<pre[^>]*>(<code[^>]*>)?let a = 1;/.test(md('pre\n```js\nlet a = 1;\n```\npost')));
  check('md: lists render', /<li>one<\/li>|<span class="li">• one<\/span>/.test(md('- one\n- two')));
  check('md: headings render', /<h2>Title<\/h2>|<strong>Title<\/strong>/.test(md('## Title')));
  check('md: HTML/XSS is stripped or escaped', !md('<script>alert(1)</scr' + 'ipt> **b**').includes('<script'));
  check('md: links open safely', md('[x](https://example.com)').includes('rel="noopener"') || !md('[x](https://example.com)').includes('<a '));
  const vend = await fetch(BASE + '/vendor/marked.min.js');
  check('vendored renderer served by the app', vend.status === 200);

  // streaming via injected WS events
  window.__wsInject({ type: 'chat_delta', chatId: S().mainChatId, text: 'First **part**' });
  await sleep(60);
  const st1 = document.querySelector('.msg.streaming') as any;
  check('delta creates a live streaming bubble (rendered)', !!st1 && st1.innerHTML.includes('<strong>part</strong>'));
  window.__wsInject({ type: 'chat_delta', chatId: S().mainChatId, text: ' and second' });
  await sleep(60);
  check('second delta grows the same bubble', (document.querySelector('.msg.streaming') as any).dataset.raw === 'First **part** and second');
  window.__wsInject({ type: 'turn', chatId: S().mainChatId, role: 'assistant', content: 'First **part** and second — final' });
  await sleep(60);
  check('final turn replaces the draft with the rendered message', !document.querySelector('.msg.streaming') && !!document.querySelector('.msg.assistant[data-raw]'));
  const cb = document.querySelector('.msg.assistant .mcopy') as any;
  check('assistant message carries a copy button', !!cb);
  await click(cb, 'copy button (no crash without clipboard)');
}

// ---------- session modal (M129 modes) ----------
await click($('tab-add'), '+ session modal');
const focusRadio = document.querySelector('input[name="nc-mode"][value="focus"]') as any;
check('focus is the first mode and default', !!focusRadio && focusRadio.checked);
await click(document.querySelector('#nc-create'), 'create with empty focus → inline nudge');
check('empty-focus nudge shown (modal stayed)', !!document.querySelector('#nc-preview') && !document.querySelector('#nc-preview')!.hasAttribute('hidden'));
const talkTerm = document.querySelector('input[name="nc-talk"][value="term"]') as any;
const talkChat = document.querySelector('input[name="nc-talk"][value="chat"]') as any;
check('talk-via choice is first-class (two radios)', !!talkTerm && !!talkChat);
check('one talk option is selected by default', !!(talkTerm?.checked || talkChat?.checked));
const forkRadio: any = document.querySelector('input[name="nc-mode"][value="fork"]');
forkRadio?.click(); await sleep(120);
check('fork mode hides the focus picker', (document.querySelector('#nc-focus-block') as any)?.style.display === 'none');
await click(document.querySelector('#nc-cancel'), 'session modal cancel');

console.log(`\n================ UI smoke: ${pass} passed, ${fail} failed ================`);
if (failures.length) console.log('failures:\n  - ' + failures.join('\n  - '));
server.kill();
process.exit(fail > 0 ? 1 : 0);

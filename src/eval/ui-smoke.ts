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
// M478: the page carries a SECOND inline <script> since the galaxy island (2026-09-21); a greedy match swallowed the HTML
// between the two and the harness died at parse ("Unexpected token '<'"). The app script is the FIRST block; every
// inline block is stripped from the DOM copy.
const script = rawHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
const htmlNoScript = rawHtml.replace(/<script src="[^"]*"><\/script>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
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
  MutationObserver: (window as any).MutationObserver, // happy-dom has one; pass it through

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
(window as any).__autoDialog = 'ok'; // M167: in-UI dialogs answer instantly in the harness
const $ = (id: string) => document.getElementById(id);
const S = () => window.__state?.();
// no WebSocket in the harness — pump the page's own refresh() where the real
// app would receive a broadcast
const pump = async () => { try { await window.__refresh?.(); } catch (e: any) { errors.push('refresh: ' + e); } await sleep(120); };

check('page script ran to completion (hooks exposed)', typeof window.__state === 'function');
check('boot produced no async errors', errors.length === 0, errors[0]);
check('state loaded into the page', !!S()?.nodes?.length);
check('tree rendered rows', document.querySelectorAll('.nrow').length >= 2);
check('to-sort visible even when empty (M167b)', !!document.querySelector('.nrow.tosort'));
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

// ---------- ≡ menu ----------
// The ⋯ tiers (M168) became ONE searchable menu on 2026-10-05 (Jacob: "the functioning of the ⋯ is still mysterious"):
// #other-btn opens #hm-menu; every item proxies to the still-present hidden control, so handlers and nudges are unchanged.
// (M478: the old tier checks described a retired surface — replaced, not loosened.)
await click($('other-btn'), '≡ menu opens');
const menuItems = () => [...document.querySelectorAll('#hm-menu .hm-it')] as any[];
check('≡ menu rendered with its groups', !!$('hm-menu') && document.querySelectorAll('#hm-menu [data-hmg]').length >= 6);
check('≡ every item proxies an existing control (none dangling)', menuItems().length > 20 && menuItems().every((b) => !!$(b.dataset.cb)));
check('≡ menu carries no dev mode (M478)', !/dev mode/i.test($('hm-menu')!.textContent || ''));
const hs = $('hm-search') as any;
hs.value = 'text size'; hs.dispatchEvent(new window.Event('input'));
check('≡ filter narrows to the matching item', menuItems().some((b) => !b.hidden) && menuItems().filter((b) => !b.hidden).every((b) => b.dataset.cb === 'font-btn'));
hs.value = ''; hs.dispatchEvent(new window.Event('input'));
check('≡ clearing the filter shows everything again', menuItems().every((b) => !b.hidden));
await click($('other-btn'), '≡ second press closes');
check('≡ menu closed', !$('hm-menu'));
await click($('dim-outside'), '◐ dim all outside (no zoom → explains)');
// reach a control THROUGH the menu, the way a person does: open ≡, click the item, which closes the menu and fires the control
const viaMore = async (id: string, name: string) => {
  if (!$('hm-menu')) await click($('other-btn'), `≡ open (for ${name})`, 80);
  const it = document.querySelector(`#hm-menu .hm-it[data-cb="${id}"]`) as any;
  check(`≡ lists ${name}`, !!it);
  await click(it ?? $(id), name);
  check(`≡ closed itself after ${name}`, !$('hm-menu'));
};
await viaMore('lit-all', '☀ light all (view)');
await viaMore('dim-all', '◐ dim all (view)');
await viaMore('prefs-btn', '☰ map preferences modal');
const pf = document.querySelector('#pf-text') as any;
check('prefs modal opened', !!pf);
if (pf) { pf.value = '- test pref'; await click(document.querySelector('#pf-save'), 'prefs save'); }
document.querySelectorAll('.overlay').forEach((o: any) => o.remove());

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

// add a sub-node (M114: no dialog, focused). The root "+ add node" button left on 2026-10-04 (Mark: users don't
// hand-file nodes); adding now lives in a row's ⋯ more-actions popover as "Add a sub-node" (M478b: check replaced).
await click(rowFor(trip)?.querySelector('[data-rowmore]'), '⋯ row more-actions opens', 200);
check('row popover shows the add control', !!rowFor(trip)?.querySelector('[data-add]') && rowFor(trip)?.classList.contains('ops-open'));
await click(rowFor(trip)?.querySelector('[data-add]'), '+ add a sub-node under trip (unnamed + focused)', 500);
await pump();
// (the ROOT's content is also 'untitled' — pick the child under trip, not the first match)
const untitledNode = S()?.nodes.find((n: any) => n.content === 'untitled' && n.parentId === trip);
check('untitled node created UNDER trip', !!untitledNode);
check('new node is the focus (M114)', !!untitledNode && S()?.chats?.find((c: any) => c.id === S()?.mainChatId)?.focusContainerId === untitledNode.id);

// delete with a focused session → warning modal (M123), then cancel
const untitled = untitledNode?.id;
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
  await viaMore('import-btn', '⇪ import opens the modal');
  await sleep(300);
  check('import modal: paste area + source sections', !!document.querySelector('#im-text') && !!document.querySelector('#im-files') && !!document.querySelector('#im-sess'));
  check('apply hidden until a proposal exists', document.querySelector('#im-apply')!.hasAttribute('hidden'));
  await click(document.querySelector('#im-cancel'), 'import modal cancel');
}

// ---------- sessions overview (M146) ----------
{
  await viaMore('sessions-btn', '▦ sessions panel opens');
  check('overview lists sessions with pin/open', document.querySelectorAll('[data-spin]').length >= 1 && document.querySelectorAll('[data-sopen]').length >= 1);
  await click(document.querySelector('[data-spin]'), '📌 pin a session', 500);
  await pump();
  check('pin lands in state + tab bar order', S()?.chats.some((c: any) => c.pinned) && document.querySelector('#tab-list button')?.textContent?.includes('📌'));
  await click(document.querySelector('[data-spin]'), '📌 unpin', 500);
  document.querySelectorAll('.overlay').forEach((o: any) => o.remove());
}

// where a control sits in the ≡ menu (the tiers are gone; placement is by group)
const menuGroupOf = async (id: string) => {
  if (!$('hm-menu')) await click($('other-btn'), `≡ open (placement of ${id})`, 80);
  const it = document.querySelector(`#hm-menu .hm-it[data-cb="${id}"]`) as any;
  const g = it?.closest('[data-hmg]')?.querySelector('h4')?.textContent ?? null;
  await click($('other-btn'), '≡ close', 60);
  return g;
};
// ---------- text size (M144) ----------
{
  check('update check lives under ≡ Account (M161 → ≡ menu)', !!$('update-btn') && (await menuGroupOf('update-btn')) === 'Account' && /check for updates/.test($('update-btn')!.textContent!));
  {
    const rl = $('round-line')!;
    // M170: while work is in flight the line breathes and never fades/reverts
    window.__wsInject?.({ type: 'lag', lag: 1 });
    await sleep(120);
    check('in-flight work lights the line (working)', rl.classList.contains('working') && /filing/.test(rl.textContent!));
    window.__wsInject?.({ type: 'lag', lag: 0 });
    window.__wsInject?.({ type: 'round', chatId: 'x', summary: 'test', alterations: 1 });
    await sleep(120);
    check('work landing stops the breathing', !rl.classList.contains('working'));
    rl.textContent = 'something happened';
    await sleep(80);
    check('status roll lands in accent (fresh) before fading (M163b)', rl.classList.contains('fresh'));
    rl.textContent = rl.getAttribute('data-idle')!;
    await sleep(80);
    check('idle text is never marked fresh', !rl.classList.contains('fresh'));
  }

  // M167: native popups are gone — our dialog boxes carry every ask
  {
    (window as any).__autoDialog = null; // exercise the REAL modal once
    const fbtn = [...document.querySelectorAll('.nrow:not(.focused) [data-focus]')][0] as any;
    fbtn.click(); await sleep(200);
    const dlg = document.querySelector('.uidlg');
    check('confirm renders as our own dialog box', !!dlg && /focus/.test(dlg.textContent!));
    check('action button carries a verb, not OK', dlg?.querySelector('#uid-ok')?.textContent === 'move focus');
    (dlg?.querySelector('#uid-cancel') as any)?.click(); await sleep(150);
    check('cancel closes without acting', !document.querySelector('.uidlg'));
    (window as any).__autoDialog = 'ok';
  }

  // M171: replies that point at the guide carry the button inline
  {
    const box = $('messages')!;
    box.insertAdjacentHTML('beforeend', (window as any).eval ? '' : '');
    box.innerHTML += (window as any).__md ? '' : '';
  }
  {
    const html = (window as any).__msgHtml?.('assistant', 'Hit the 🗨 talk to map button and ask the map agent.') ?? '';
    check('guide-referring reply embeds a 🗨 button (M171)', /msg-mapchat/.test(html));
    // M171b: clicking the inline button opens the guide pre-seeded with context
    $('messages')!.insertAdjacentHTML('beforeend',
      (window as any).__msgHtml('user', 'how do I turn off the wifi?') + (window as any).__msgHtml('assistant', "That's folded away right now — ask via talk to map."));
    (document.querySelector('.msg-mapchat') as any).click(); await sleep(300);
    {
      const ov = [...document.querySelectorAll('.overlay')].pop();
      const seeded = ov && [...ov.querySelectorAll('.msg.user')].some((d: any) => /brought over from the chat/.test(d.textContent));
      check('inline referral seeds the guide with context (M171b)', !!seeded);
      (ov?.querySelector('#mc-close') as any)?.click(); await sleep(80);
    }
    // thinking bubble survives the user's echoed turn, dies on assistant content
  {
    const box = $('messages')!;
    box.insertAdjacentHTML('beforeend', '<div class="msg assistant pending">thinking…</div>');
    window.__wsInject?.({ type: 'turn', chatId: S()!.mainChatId, role: 'user', content: 'echo of my own message' });
    await sleep(120);
    check('thinking bubble survives the user echo', !!document.querySelector('.msg.pending'));
    window.__wsInject?.({ type: 'chat_delta', chatId: S()!.mainChatId, text: 'first block' });
    await sleep(120);
    check('first streamed block clears the thinking bubble', !document.querySelector('.msg.pending'));
    document.querySelector('.msg.streaming')?.remove();
  }

  // M171c: a CC-style verbal referral (arriving as a mirrored turn) seeds
    // the TOOLBAR button too — but only for one round
    window.__wsInject?.({ type: 'turn', chatId: S()!.mainChatId, role: 'user', content: 'wifi off?' });
    window.__wsInject?.({ type: 'turn', chatId: S()!.mainChatId, role: 'assistant', content: 'That area is set aside — use talk to map to bring it back.' });
    window.__wsInject?.({ type: 'round', chatId: 'x', summary: 's', alterations: 0 });
    window.__wsInject?.({ type: 'round', chatId: 'x', summary: 's', alterations: 0 });
    await sleep(150);
    ($('map-chat') as any).click(); await sleep(250);
    {
      const ov = [...document.querySelectorAll('.overlay')].pop();
      const seeded = ov && [...ov.querySelectorAll('.msg.user')].some((d: any) => /brought over/.test(d.textContent));
      check('stale referral (2 rounds old) does NOT seed the toolbar (M171c)', !seeded);
      (ov?.querySelector('#mc-close') as any)?.click(); await sleep(80);
    }
    window.__wsInject?.({ type: 'turn', chatId: S()!.mainChatId, role: 'assistant', content: 'That is dimmed — talk to map can relight it.' });
    await sleep(120);
    ($('map-chat') as any).click(); await sleep(250);
    {
      const ov = [...document.querySelectorAll('.overlay')].pop();
      const seeded = ov && [...ov.querySelectorAll('.msg.user')].some((d: any) => /brought over/.test(d.textContent));
      check('fresh CC-style referral seeds the toolbar button (M171c)', !!seeded);
      (ov?.querySelector('#mc-close') as any)?.click(); await sleep(80);
    }
    const folded = (window as any).__msgHtml?.('assistant', "That's folded away right now — the home network setup area. Want me to help anyway?") ?? '';
    check('set-aside/folded replies embed it too', /msg-mapchat/.test(folded));
    const noTools = (window as any).__msgHtml?.('assistant', "I don't have web search available to me in this context — no tools are active here.") ?? '';
    check('no-tools replies carry a ＋ session button (M175)', /msg-addsession/.test(noTools));
    const plain = (window as any).__msgHtml?.('assistant', 'Just a normal answer.') ?? '';
    check('ordinary replies carry no inline button', !/msg-mapchat/.test(plain));
  }

  check('agent view lives under ≡ Agent (M162 → ≡ menu)', !!$('agent-view-btn') && (await menuGroupOf('agent-view-btn')) === 'Agent' && /what the agent sees/.test($('agent-view-btn')!.textContent!));

  await viaMore('agent-view-btn', '👁 what the agent sees opens');
  await sleep(400);
  {
    const ov = document.querySelector('.overlay');
    check('agent view modal: composition bar + legend', !!ov && !!ov.querySelector('.avbar') && ov.querySelectorAll('.avrow').length >= 2);
    check('agent view modal: exact text behind a fold, section by section', !!ov && ov.querySelectorAll('details details').length >= 2 && ov.querySelector('details details pre')!.textContent!.includes('[map state'));
    (ov!.querySelector('#av-close') as any).click(); await sleep(60);
    check('agent view modal closes', !document.querySelector('.overlay'));
  }

  // ★ FAVORITES — the in-tree favorites folder (M164) became the ★ popover in the nav row (Mark 2026-10-04 / 10-09):
  // #fav-btn → #fav-pop, one .bm[data-bm] per favorite, click = zoom there. (M478b: the band checks described a retired surface.)
  await post(`/api/nodes/${trip}/favorite`, { on: true });
  await pump();
  {
    const fb = $('fav-btn')!, pop = $('fav-pop')!;
    check('★ button sits in the nav row and lights up when a favorite exists', !!fb && fb.classList.contains('has') && /favorites \(1\)/.test(fb.title));
    check('★ popover is closed until asked', !!pop && pop.hidden);
    await click(fb, '★ opens the favorites popover', 100);
    check('popover lists the favorite by name', !pop.hidden && !!pop.querySelector(`.bm[data-bm="${trip}"]`) && pop.textContent!.includes('trip planning'));
    (pop.querySelector(`.bm[data-bm="${trip}"]`) as any).click(); await sleep(250);
    check('picking a favorite closes the popover and zooms to it', pop.hidden && document.querySelector('#crumbs')!.textContent!.includes('trip planning'));
    await click($('home-btn'), 'back to whole map after the jump', 200);
    check('no in-tree favorites folder or shortcut rows remain', !document.querySelector('.favhead') && !document.querySelector('.srow.sind'));
    await post(`/api/nodes/${trip}/favorite`, { on: false });
    await pump();
    check('unfavorite — popover shows its empty state, button unlit, node survives', !!pop.querySelector('.empty-fav') && !fb.classList.contains('has') && !!S()!.nodes.find((n: any) => n.content === 'trip planning'));
  }
  // ⟳ SUGGESTIONS — no pseudo-folder (Mark 2026-10-04): a ⟳ mark on the affected row, a count chip in the status strip,
  // and the chip opens the suggestions panel (local state, no server call).
  {
    S()!.suggestions.push({ id: 'sg-fake', nodeId: flights, kind: 'restructure' });
    window.__setZoom?.(null); await sleep(200);
    if (!rowFor(flights)) { await click(caretOf(trip), 'expand trip to see the flights row', 150); }
    check('⟳ mark on the affected row', !!rowFor(flights)?.querySelector(`[data-sug="${flights}"]`));
    check('status strip counts it', !$('sug-chip')!.hidden && /1 suggestion from the map/.test($('sug-chip')!.textContent!));
    check('rows carry no dots and no tidy folder anymore', !document.querySelector('.nrow .sdot') && !document.querySelector('.srow.sind[data-sug]'));
    await click($('sug-chip'), '⟳ chip opens the suggestions panel', 200);
    check('panel lists the suggestion as a row', !!document.querySelector('.overlay .srow[data-sg]'));
    document.querySelectorAll('.overlay').forEach((o: any) => o.remove());
    S()!.suggestions.pop();
    window.__setZoom?.(null); await sleep(150);
    check('chip hides again when nothing is pending', $('sug-chip')!.hidden);
  }

  // M172: direct feedback button — now one ≡ item under Account
  check('feedback lives under ≡ Account (M172 → ≡ menu)', !!$('feedback-btn') && (await menuGroupOf('feedback-btn')) === 'Account');
  await viaMore('feedback-btn', '🐞 send feedback opens');
  {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    check('feedback stage 1: one ask — write and save', !!ov && !!ov.querySelector('#fb-text') && !!ov.querySelector('#fb-save') && ov.querySelector('#fb-stage2')!.hasAttribute('hidden'));
    (ov!.querySelector('#fb-text') as any).value = 'local-only note from smoke';
    (ov!.querySelector('#fb-save') as any).click(); await sleep(250);
    check('stage 2: saved locally, optional channels appear', !ov!.querySelector('#fb-stage2')!.hasAttribute('hidden') && !!ov!.querySelector('#fb-gh') && !!ov!.querySelector('#fb-copy'));
    const logged = await (await fetch(BASE + '/api/feedback')).json();
    check('save lands in the local list', (logged.entries ?? logged).some((e: any) => e.text === 'local-only note from smoke'));
    (ov!.querySelector('#fb-done') as any).click(); await sleep(60);
  }

  await viaMore('authinfo-btn', '🔑 sign-in & billing opens');
  await sleep(300);
  {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    // who pays depends on the engine in use (M264): subscription (claude), ChatGPT plan (codex) or your own key (api) — the
    // modal must quote the server's own billing line, whichever engine this box runs
    const ai = await (await fetch(BASE + '/api/auth-info')).json();
    const payer = { codex: /ChatGPT plan/, api: /ANTHROPIC_API_KEY/, subscription: /Claude subscription/ }[ai.backend as string] ?? /subscription|ChatGPT|API_KEY/;
    check(`sign-in & billing modal states who pays (engine: ${ai.backend})`, !!ov && /Who pays/.test(ov.textContent!) && ov.textContent!.includes(ai.billing) && payer.test(ai.billing));
    (ov?.querySelector('#ai-close') as any)?.click(); await sleep(60);
  }

  await viaMore('update-btn', '⬆ check for updates opens its note box');
  await sleep(600);
  {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    check('update answer is a note box, not a status line (M163c)', !!ov && /check for updates/.test(ov.querySelector('h3')?.textContent ?? ''));
    (ov?.querySelector('#up-close') as any)?.click(); await sleep(60);
  }

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
await click($('other-btn'), '≡ open for tooltip sweep', 80);
tooltipSweep('≡ menu');
await click($('other-btn'), '≡ close after sweep', 80);

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

// ---------- narrow windows: side view (M254b) ----------
// The phone shell (M133–M135b: mobile bar, flip, drawer, action sheet) is RETIRED on Mark's word — its code stays dormant
// and is never switched on. What replaced it: a narrow window shows the map only (body.companion), and ▯ side view makes
// that a remembered choice at any width. (M478b: the shell checks described a retired surface.)
{
  Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await sleep(150);
  check('narrow window never turns the retired phone shell on', !document.body.classList.contains('mobile') && !document.body.classList.contains('mob-chat'));
  check('narrow window shows the map only (companion layout)', document.body.classList.contains('companion'));
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await sleep(150);
  check('wide again: both panes back', !document.body.classList.contains('companion'));
  const sv = $('sideview-btn')!;
  check('▯ side view starts off', !sv.classList.contains('on') && window.localStorage.getItem('hm-sideview') !== '1');
  await click(sv, '▯ side view on', 150);
  check('side view on: map only at full width, remembered in this browser', document.body.classList.contains('companion') && sv.classList.contains('on') && window.localStorage.getItem('hm-sideview') === '1');
  await click(sv, '▮ side view off', 150);
  check('side view off: conversation pane back, memory cleared', !document.body.classList.contains('companion') && !sv.classList.contains('on') && window.localStorage.getItem('hm-sideview') !== '1');
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

// Drive the real UI with a headless browser and capture screenshots of the app
// in action. Requires the server running. Usage: bun run src/spike/screenshot.ts
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:8790';
const OUT = 'docs/shots';

const firstCred = (process.env.HARNESSMAP_USERS ?? '').split(',')[0];
const CRED = firstCred.includes(':') ? { user: firstCred.slice(0, firstCred.indexOf(':')), pass: firstCred.slice(firstCred.indexOf(':') + 1) } : null;
const AUTH: Record<string, string> = CRED ? { authorization: `Basic ${Buffer.from(`${CRED.user}:${CRED.pass}`).toString('base64')}` } : {};

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (path: string) => fetch(`${BASE}${path}`, { headers: AUTH }).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitItems(chatId: string, focusId: string, n: number, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await get('/api/state');
    // Count items in the focused container itself — total counts race against
    // pre-existing data, and auto-fold hides everything but the focus branch.
    if (s.items.filter((i: any) => i.homeContainerId === focusId).length >= n) return;
    await sleep(1500);
  }
}

async function main() {
  await Bun.$`mkdir -p ${OUT}`.quiet();

  // Seed a realistic session over the API so the shot shows a populated map.
  const { id: focusContainerId, chatId } = await post('/api/nodes', { name: 'Japan trip — Oct', focus: true });
  await post(`/api/chats/${chatId}/messages`, {
    text: "Planning Japan in October, me and my partner, budget about 3k on the ground. Hard rule: back by the 11th, my sister's wedding. Tokyo and Kyoto only — no side trips. And no red-eye flights, I'm too old for that. First thing: figure out the rail pass vs individual tickets.",
  });
  await waitItems(chatId, focusContainerId, 3);
  await sleep(4000); // let the map settle + a second round land

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2,
    ...(CRED ? { httpCredentials: { username: CRED.user, password: CRED.pass } } : {}),
  });
  const page = await context.newPage();

  // Light mode
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.item', { timeout: 20_000 });
  await page.waitForSelector('.msg.assistant', { timeout: 20_000 }); // chat pane populated
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/ui-light.png` });

  // Hover an item to reveal click-ops
  const firstItem = page.locator('.item').first();
  await firstItem.hover();
  await sleep(400);
  await page.screenshot({ path: `${OUT}/ui-clickops.png` });

  // Dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/ui-dark.png` });

  await browser.close();
  console.log('shots written to', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });

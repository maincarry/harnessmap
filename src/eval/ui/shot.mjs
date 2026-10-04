// Screenshot the REAL map UI against a throwaway no-inference server (reusable eval tooling, 2026-10-04).
//   UI_PORT=8801 OUT=/tmp/claude-1000/map-shot bun run src/eval/ui/shot.mjs   → OUT-overview.png, OUT-zoomed.png
// Boots exactly like app-ui-check (own HARNESSMAP_HOME/DB, HARNESSMAP_INFERENCE=off → no LLM, little memory), seeds a
// small realistic map through the real API (topics + children, two favorites, an unplaced arrival in the tray), then
// captures the page as a user sees it. Lets a visual change be self-verified instead of asking a founder to eyeball it.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.UI_PORT || 8801);
if (PORT === 8790) { console.error("refusing to use 8790 (the real server port)"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || "/tmp/claude-1000/map-shot";
const CHROME = process.env.HM_CHROME || "/home/claude/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const home = mkdtempSync(join(tmpdir(), "hm-shot-"));
const srv = spawn("bun", ["run", "src/server.ts"], { env: { ...process.env, HARNESSMAP_HOME: home, PORT: String(PORT), HARNESSMAP_DB: join(home, "map.sqlite"), HARNESSMAP_INFERENCE: "off" }, stdio: ["ignore", "ignore", "inherit"] });
const cleanup = () => { try { srv.kill("SIGTERM"); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup); process.on("SIGINT", () => process.exit(130));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); };
let up = false; for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(BASE + "/api/state")).ok; } catch {} if (!up) await sleep(500); }
if (!up) { console.error("server never came up on " + BASE); process.exit(1); }

// seed a small realistic map through the real API (the tray and the example map come from bootstrap)
const st0 = await get("/api/state");
const tray = (st0.nodes || []).find((n) => n.parentId === null && String(n.title || n.content).startsWith("to sort"));
const mk = async (content, parentId = null) => (await post("/api/nodes", { content, parentId })).id;
const cli = await mk("snip — a small Python CLI for named text snippets");
await mk("storage module: a JSON file store (done)", cli);
await mk("two tests for save + retrieve (todo)", cli);
const essay = await mk("Essay — why cities feel lonely: draft 1 needs a stronger opening");
await mk("cut the Jane Jacobs tangent (decided)", essay);
if (tray) await mk("deploy keys — where should these live? (arrived unplaced)", tray.id);
await post(`/api/nodes/${cli}/favorite`, { on: true });    // → the ★ bookmarks bar
await post(`/api/nodes/${essay}/favorite`, { on: true });
await sleep(300);

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
await page.addInitScript(() => { try { localStorage.setItem("hm-tour-done", "1"); window.__HM_TEST = true; } catch {} });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await sleep(700);
await page.screenshot({ path: OUT + "-overview.png" });
// zoom into the CLI topic so the breadcrumb trail + zoom-out are exercised (setZoom is a page global; guarded)
await page.evaluate((id) => { try { setZoom(id); } catch {} }, cli);
await sleep(600);
await page.screenshot({ path: OUT + "-zoomed.png" });
await browser.close();
console.log("wrote", OUT + "-overview.png", OUT + "-zoomed.png");
process.exit(0);

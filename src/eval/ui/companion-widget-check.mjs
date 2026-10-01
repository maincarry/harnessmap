// Companion widget effectiveness test — the actual final-product UI a user sees (Jacob
// 2026-10-01: "build tests for the robustness and effectiveness of final products"). The
// native Tauri shell can't be compiled/launched on this box, but the shell only HOSTS the
// map's /widget page (public/widget.html), served same-origin and fetching /api/state — so
// the real product behavior IS testable headlessly: boot an isolated seeded server, load its
// /widget in Chromium, and assert it actually reaches the map and renders the focused node
// (not the offline fallback), with no console errors.
//
//   bun run src/eval/ui/companion-widget-check.mjs       # isolated server on 8799
// Exits 0 if every check passes, 1 otherwise.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.UI_PORT || 8799);
if (PORT === 8790) { console.error("refusing to use 8790 (the real server port)"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.HM_CHROME || "/home/claude/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, pass, detail = "") => { results.push({ pass: !!pass }); console.log(`  ${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? " — " + detail : ""}`); };

const home = mkdtempSync(join(tmpdir(), "hm-widget-"));
const srv = spawn("bun", ["run", "src/server.ts"], {
  env: { ...process.env, HARNESSMAP_HOME: home, PORT: String(PORT), HARNESSMAP_DB: join(home, "map.sqlite"), HARNESSMAP_INFERENCE: "off" },
  stdio: ["ignore", "ignore", "inherit"],
});
async function waitUp() { for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + "/api/state"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; }
function cleanup() { try { srv.kill("SIGTERM"); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} }

async function run() {
  if (!(await waitUp())) { check("server boots", false, "no /api/state on " + BASE); return; }
  check("server boots", true);

  // The served /widget must exist (public/widget.html) and carry the known widget DOM.
  const wr = await fetch(BASE + "/widget");
  const whtml = await wr.text();
  check("/widget served", wr.ok, `status ${wr.status}`);
  check("/widget is the widget page", /id="chip-focus"/.test(whtml) && /id="p-focus"/.test(whtml), "missing widget DOM");

  // CORS: the skill says the server allows the app origin (tauri://localhost) on current builds
  // (≥0.9.103) — an old server 403s the app and the widget shows "map out of date". Assert the
  // current server does NOT 403 that origin (the robustness the skill relies on).
  const cors = await fetch(BASE + "/api/state", { headers: { Origin: "tauri://localhost" } });
  check("server allows the tauri://localhost origin (not 403)", cors.status !== 403, `status ${cors.status}`);
  check("server sends access-control-allow-origin for the app", !!cors.headers.get("access-control-allow-origin"), "no ACAO header");

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 420, height: 520 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|WebSocket|ws:\/\//.test(m.text())) errs.push("C:" + m.text()); });

  await page.goto(BASE + "/widget", { waitUntil: "networkidle" });
  // The fresh server auto-bootstraps the example map (M394), so /api/state has a real focused
  // node. Give the widget a moment to fetch + render.
  await page.waitForTimeout(1200);

  const offline = await page.evaluate(() => document.body.classList.contains("offline"));
  check("widget reached the map (not offline)", !offline, "widget is in the offline state — /api/state not read");

  const chip = (await page.textContent("#chip-focus").catch(() => "") || "").trim();
  const pstate = (await page.textContent("#p-state").catch(() => "") || "").trim();
  check("widget renders a focus label", chip.length > 0, `chip-focus="${chip}"`);
  check("widget shows a live map status", /current|to sort|influence|update/i.test(pstate), `p-state="${pstate}"`);
  check("no console/page errors in the widget", errs.length === 0, errs.slice(0, 3).join(" | "));

  await browser.close();
}

run().catch((e) => check("harness", false, String(e && e.message || e))).finally(() => {
  cleanup();
  const pass = results.filter((r) => r.pass).length, fail = results.length - pass;
  console.log(`\n================ companion-widget-check · ${pass} passed, ${fail} failed ================`);
  process.exit(fail ? 1 : 0);
});

// App UI regression suite — "the app in the test loop" (Jacob, 2026-09-29).
//
// The backend e2e scenarios exercise the filer/composer/memory; they never open the actual page, so
// front-end regressions ship silently (this session alone: galaxy stars going invisible on deep maps
// and inside a non-empty "to sort" bucket, and the +session import showing a paste box instead of a
// browse). This suite drives the real page with Playwright/Chromium and asserts those exact behaviours,
// so the loop catches them next time.
//
//   bun run src/eval/ui/app-ui-check.mjs            # boots its own isolated server on 8799
//   UI_PORT=8801 bun run src/eval/ui/app-ui-check.mjs
//
// Exits 0 if every check passes, 1 otherwise. Prints a per-check PASS/FAIL summary.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.UI_PORT || 8799);
if (PORT === 8790) { console.error("refusing to use 8790 (the real server port)"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.HM_CHROME
  || "/home/claude/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`  ${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// ---- isolated server -------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), "hm-ui-"));
const srv = spawn("bun", ["run", "src/server.ts"], {
  env: { ...process.env, HARNESSMAP_HOME: home, PORT: String(PORT), HARNESSMAP_DB: join(home, "map.sqlite"), HARNESSMAP_INFERENCE: "off" },
  stdio: ["ignore", "ignore", "inherit"],
});
async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + "/api/state"); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
function cleanup() { try { srv.kill("SIGTERM"); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} }

// ---- the checks ------------------------------------------------------------
// isTutorial / sleepy mirrors fromMap.ts so "expected renderable" matches the product's own filter.
const isTutorial = (n) => n.author === "system" || /getting started/i.test(String(n.title || "")) || /getting started \(tutorial\)/i.test(String(n.content || ""));
const bucketName = (n) => /^(to sort|untitled)$/i.test(String(n.title || n.content || "").trim());

async function run() {
  if (!(await waitUp())) { check("server boots", false, "no /api/state on " + BASE); return; }
  check("server boots", true);

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push("C:" + m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem("hm-tour-done", "1"); window.__HM_TEST = true; } catch {} });

  // A map that reproduces BOTH invisible-star causes: a deep chain (depth cap) and a non-empty
  // "to sort" bucket (bucket exclusion), plus an empty "untitled" (legitimately skipped) and the
  // tutorial (legitimately hidden). Multiple top-level topics so no single-root unwrap edge.
  const nodes = [
    { id: "alpha", parentId: null, title: "Alpha", content: "a", status: "live" },
    { id: "beta", parentId: null, title: "Beta", content: "b", status: "noted" },
    { id: "tosort", parentId: null, title: "to sort", content: "to sort", status: "live" },
    { id: "untitled", parentId: null, title: "untitled", content: "untitled", status: "live" }, // empty bucket → skipped
    { id: "tut", parentId: null, title: "Getting started (tutorial)", content: "x", author: "system", status: "live" },
    // Alpha's children incl. a 5-deep chain (exercises the old depth-2 cap)
    { id: "a1", parentId: "alpha", title: "A1", content: "x", status: "live" },
    { id: "a2", parentId: "a1", title: "A2", content: "x", status: "noted" },
    { id: "a3", parentId: "a2", title: "A3", content: "x", status: "decided" },
    { id: "a4", parentId: "a3", title: "A4", content: "x", status: "live" },
    { id: "a5", parentId: "a4", title: "A5", content: "x", status: "live" },
    { id: "b1", parentId: "beta", title: "B1", content: "x", status: "live" },
    // real content sitting in "to sort" (the bucket regression)
    { id: "ts1", parentId: "tosort", title: "Unsorted note", content: "x", status: "provisional" },
    { id: "ts2", parentId: "ts1", title: "Unsorted child", content: "x", status: "active" },
    { id: "rem", parentId: "alpha", title: "Removed one", content: "x", status: "removed" }, // filtered
  ];
  const expected = nodes.filter((n) => n.status !== "removed" && !isTutorial(n) && !(bucketName(n) && !nodes.some((c) => c.parentId === n.id)));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // 1) Galaxy opens without console errors
  await page.evaluate(() => document.getElementById("galaxy-btn").click());
  const hasGlobal = await page.waitForFunction(() => !!window.HarnessGalaxy, { timeout: 8000 }).then(() => true).catch(() => false);
  check("galaxy island loads", hasGlobal, hasGlobal ? "" : "window.HarnessGalaxy never appeared");
  if (!hasGlobal) { await browser.close(); return; }
  await page.waitForTimeout(300);

  // 2) Galaxy renders EVERY live, non-tutorial, non-empty-bucket node (deep + bucket regression)
  const render = await page.evaluate(async (nodes) => {
    window.HarnessGalaxy.unmount();
    window.HarnessGalaxy.mount(document.getElementById("galaxy-mount"), { nodes, projectName: "UITest", litIds: nodes.filter((n) => !n.parentId).map((n) => n.id), onFocusNode: () => {} });
    await new Promise((r) => setTimeout(r, 900));
    const cfg = window.__galaxyConfig;
    const ids = new Set();
    const walk = (ms) => { for (const m of ms) { ids.add(m.nodeId || m.id); walk(m.moons || []); } };
    for (const p of cfg.planets) { ids.add(p.nodeId || p.id); walk(p.moons || []); }
    return { ids: [...ids], sun: cfg.sun.name, drifters: cfg.drifters.length };
  }, nodes);
  const inCfg = new Set(render.ids);
  const missing = expected.filter((n) => !inCfg.has(n.id));
  check("galaxy renders all live nodes (deep + bucket)", missing.length === 0, missing.length ? "missing: " + missing.map((n) => `${n.title}(${n.status})`).join(", ") : `${expected.length}/${expected.length} nodes`);
  const emptyUntitledShown = inCfg.has("untitled");
  check("empty bucket is NOT forced into the scene", !emptyUntitledShown, emptyUntitledShown ? "empty 'untitled' rendered" : "");
  check("drifters populated (space friends)", render.drifters >= 1, `${render.drifters} drifters`);

  // 3) lit/dim = awake/sleep
  const dim = await page.evaluate(async (nodes) => {
    const mountWith = async (lit) => {
      window.HarnessGalaxy.unmount();
      window.HarnessGalaxy.mount(document.getElementById("galaxy-mount"), { nodes, projectName: "UITest", litIds: lit, onFocusNode: () => {} });
      await new Promise((r) => setTimeout(r, 500));
      const cfg = window.__galaxyConfig;
      let awake = 0, asleep = 0;
      const walk = (ms) => { for (const m of ms) { (m.dimmed ? asleep++ : awake++); walk(m.moons || []); } };
      for (const p of cfg.planets) { (p.dimmed ? asleep++ : awake++); walk(p.moons || []); }
      return { awake, asleep };
    };
    return { litAlpha: await mountWith(["alpha"]), litNone: await mountWith([]) };
  }, nodes);
  check("lit parent wakes its subtree", dim.litAlpha.awake >= 6, `awake=${dim.litAlpha.awake} asleep=${dim.litAlpha.asleep}`);
  check("nothing lit => all asleep", dim.litNone.awake === 0, `awake=${dim.litNone.awake} asleep=${dim.litNone.asleep}`);

  check("galaxy: no console errors", errs.length === 0, errs.slice(0, 3).join(" | "));

  // 4) +session import shows the BROWSE (not a paste box)
  await page.evaluate(() => { const c = document.getElementById("galaxy-close"); if (c) c.click(); });
  await page.waitForTimeout(300);
  await page.route("**/api/import/sources", (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ files: [], memories: [], sourceRetained: false, sessions: [{ file: "rollout-x.jsonl", dir: "/x", sizeKB: 40, mtime: "2026-09-28T20:00:00Z", harness: "codex" }, { file: "y.jsonl", dir: "/y", sizeKB: 88, mtime: "2026-09-27T10:00:00Z" }] }) }));
  const imp = await (async () => {
    try {
      await page.click("#tab-add"); await page.waitForTimeout(250);
      await page.click("#nc-import"); await page.waitForTimeout(500);
      const pasteHidden = await page.$eval("#im-nonsess", (e) => e.hidden).catch(() => null);
      const rows = await page.$$eval("#im-sess .sr-row", (els) => els.length).catch(() => 0);
      const title = await page.$eval(".modal h3", (e) => e.textContent).catch(() => "");
      return { pasteHidden, rows, title };
    } catch (e) { return { err: String(e) }; }
  })();
  check("+session import shows browse (paste hidden)", imp.pasteHidden === true, imp.err || `pasteHidden=${imp.pasteHidden}`);
  check("+session import lists local chats", (imp.rows || 0) >= 2, `${imp.rows} rows`);

  await browser.close();
}

try { await run(); } catch (e) { check("suite ran", false, String(e && e.stack || e)); }
cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n================ app-ui-check · ${results.length - failed.length} passed, ${failed.length} failed ================`);
process.exit(failed.length ? 1 : 0);

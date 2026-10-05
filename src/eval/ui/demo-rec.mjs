// Demo recorder (Jacob 2026-10-05 17:05: "do a demo video based on the points of our products"). One continuous Playwright
// recording of the REAL product: an inference server (codex) replays a real 4-turn conversation through the product's own
// observe API while the map files itself; then focus / dim + agent's view / tidy + undo / talk to map (dragged, M395) / the
// 204-node limit-test map on a second no-inference server; title cards in between. Captions are drawn on the page. Scene
// markers go to markers.json so ffmpeg can speed up the inference waits afterwards. Nothing here edits the map by hand.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const SP = "/tmp/claude-1000/-home-claude-projects/a378a2d1-187b-4e76-a128-1f1d823f8d6f/scratchpad";
const OUT = join(SP, "demo"); mkdirSync(join(OUT, "vid"), { recursive: true });
const A = 8803, B = 8802, BASE = `http://127.0.0.1:${A}`, DEEP = `http://127.0.0.1:${B}`;
const home = mkdtempSync(join(tmpdir(), "hm-demo-")); mkdirSync(join(home, "proj"), { recursive: true }); mkdirSync(join(home, "home"), { recursive: true });
const envA = { ...process.env, HARNESSMAP_HOME: join(home, "home", ".harnessmap"), HARNESSMAP_DB: join(home, "map.sqlite"), PORT: String(A), HARNESSMAP_INFERENCE: "codex", CODEX_HOME: "/home/claude/.codex", HARNESSMAP_INFERENCE_CONCURRENCY: "1", HARNESSMAP_AUTOTIDY_ROUNDS: "0", HARNESSMAP_LATEST_OVERRIDE: "0.9.177", HOME: join(home, "home") }; delete envA.ANTHROPIC_API_KEY;
const envB = { ...process.env, HARNESSMAP_HOME: join(SP, "deep", "home"), HARNESSMAP_DB: join(SP, "deep", "hm.sqlite"), PORT: String(B), HARNESSMAP_INFERENCE: "off", HARNESSMAP_LATEST_OVERRIDE: "0.9.177" }; delete envB.ANTHROPIC_API_KEY;
const srvA = spawn("bun", ["run", "src/server.ts"], { env: envA, stdio: ["ignore", "ignore", "ignore"] });
let srvB = null;
const cleanup = () => { for (const s of [srvA, srvB]) { try { s?.kill("SIGTERM"); } catch {} } };
process.on("exit", cleanup); process.on("SIGINT", () => process.exit(130));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (base, p) => (await fetch(base + p)).json();
const post = async (base, p, body = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); };
const waitUp = async (base) => { let up = false; for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base + "/api/state")).ok; } catch {} if (!up) await sleep(500); } if (!up) { console.error("server never came up on " + base); process.exit(1); } };
await waitUp(BASE); console.log("inference server up", BASE);

const sc = JSON.parse(readFileSync("src/eval/scenarios/replay-real-english-practice-en-p1.json", "utf8"));
const rounds = sc.rounds;
const liveNodes = async () => ((await get(BASE, "/api/state")).nodes || []).filter((n) => n.status !== "removed" && n.author !== "system" && !String(n.content || "").startsWith("to sort"));
async function observe(r, waitMs = 240000) {
  const before = (await liveNodes()).length; const t0 = Date.now();
  await post(BASE, "/api/harness/observe", { session_id: "demo-1", cwd: join(home, "proj"), user_text: r.user, assistant_text: r.assistant });
  let grew = false;
  while (Date.now() - t0 < waitMs) { await sleep(2000); const f = await get(BASE, "/api/filings"); const n = (await liveNodes()).length; if (n > before) grew = true; if (grew && (f.pending ?? 0) === 0) break; }
  await sleep(4000);
  return { before, after: (await liveNodes()).length, ms: Date.now() - t0 };
}
// pre-warm: the first three exchanges file off camera (each is a minute of real inference)
for (let i = 0; i < 3; i++) { const r = await observe(rounds[i]); console.log(`prewarm round ${i + 1}: ${r.before} → ${r.after} nodes in ${Math.round(r.ms / 1000)} s`); }

// ---- recording ----
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(OUT, "vid"), size: { width: 1280, height: 720 } }, colorScheme: "light" });
await ctx.addInitScript(() => {
  try { localStorage.setItem("hm-tour-done", "1"); } catch {}
  const boot = () => {
    if (document.getElementById("hm-cap")) return;
    const st = document.createElement("style"); st.textContent = `
      #hm-cap{position:fixed;right:22px;bottom:58px;max-width:640px;text-align:left;background:rgba(15,18,24,.92);color:#f4f6fa;font:600 21px/1.35 "IBM Plex Sans","Helvetica Neue",Arial,sans-serif;padding:12px 20px;border-radius:12px;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .35s;pointer-events:none}
      #hm-cap.on{opacity:1}
      #hm-cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:100000;pointer-events:none;transition:left .06s linear,top .06s linear;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
      #hm-conv{position:fixed;right:28px;top:96px;width:470px;z-index:99998;display:flex;flex-direction:column;gap:10px;pointer-events:none}
      .hm-b{border-radius:14px;padding:12px 16px;font:400 17px/1.4 "IBM Plex Sans","Helvetica Neue",Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18);opacity:0;transform:translateY(6px);transition:opacity .4s,transform .4s;white-space:pre-wrap}
      .hm-b.on{opacity:1;transform:none}
      .hm-b.you{background:#1d4ed8;color:#fff;align-self:flex-end;max-width:92%}
      .hm-b.ai{background:#fff;color:#1b2230;border:1px solid #d9e0ea;align-self:flex-start;max-width:96%}
      .hm-b small{display:block;font-size:12px;opacity:.7;margin-bottom:4px;letter-spacing:.3px;text-transform:uppercase}`;
    document.documentElement.appendChild(st);
    const cap = document.createElement("div"); cap.id = "hm-cap"; document.documentElement.appendChild(cap);
    const cur = document.createElement("div"); cur.id = "hm-cur"; cur.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9-7 1.5L9.5 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`; document.documentElement.appendChild(cur);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
});
const pg = await ctx.newPage();
const T0 = Date.now(); const marks = []; const mark = (name) => { marks.push({ name, t: +((Date.now() - T0) / 1000).toFixed(2) }); console.log(`  [${marks[marks.length - 1].t}s] ${name}`); };
const cap = async (text, hold = 0) => { await pg.evaluate((t) => { const c = document.getElementById("hm-cap"); if (!c) return; if (!t) { c.classList.remove("on"); return; } c.textContent = t; c.classList.add("on"); }, text); if (hold) await sleep(hold); };
let cx = 640, cy = 360;
const curTo = async (x, y, steps = 14) => { for (let i = 1; i <= steps; i++) { const nx = cx + (x - cx) * i / steps, ny = cy + (y - cy) * i / steps; await pg.mouse.move(nx, ny); await pg.evaluate(([a, b]) => { const c = document.getElementById("hm-cur"); if (c) { c.style.left = a + "px"; c.style.top = b + "px"; } }, [nx, ny]); await sleep(22); } cx = x; cy = y; };
const clickSel = async (sel, { hoverFirst = null, pause = 500 } = {}) => {
  if (hoverFirst) { const h = await pg.$(hoverFirst); if (h) { const hb = await h.boundingBox(); if (hb) await curTo(hb.x + Math.min(120, hb.width / 3), hb.y + hb.height / 2); await h.hover(); await sleep(350); } }
  const el = await pg.waitForSelector(sel, { timeout: 15000, state: "attached" }); await el.scrollIntoViewIfNeeded().catch(() => {});
  const bb = await el.boundingBox(); if (bb) await curTo(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await el.click({ force: true }); await sleep(pause); return el;
};
const bubble = async (who, text, typeMs = 0) => {
  await pg.evaluate(([w, t]) => { let box = document.getElementById("hm-conv"); if (!box) { box = document.createElement("div"); box.id = "hm-conv"; document.documentElement.appendChild(box); } const d = document.createElement("div"); d.className = "hm-b " + w; d.innerHTML = `<small>${w === "you" ? "you, in Claude Code" : "Claude"}</small><span class="hm-t"></span>`; box.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); d.dataset.full = t; }, [who, text]);
  if (typeMs) { const n = text.length; for (let i = 1; i <= n; i++) { await pg.evaluate((i) => { const b = document.querySelectorAll("#hm-conv .hm-b"); const d = b[b.length - 1]; d.querySelector(".hm-t").textContent = d.dataset.full.slice(0, i); }, i); await sleep(typeMs); } }
  else await pg.evaluate(() => { const b = document.querySelectorAll("#hm-conv .hm-b"); const d = b[b.length - 1]; d.querySelector(".hm-t").textContent = d.dataset.full; });
};
const clearBubbles = async () => pg.evaluate(() => document.getElementById("hm-conv")?.remove());
const short = (s, n) => { s = s.replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; };

try {
  // 0 — title card
  await pg.goto("file://" + join(OUT, "title.html")); mark("card:title"); await sleep(6500);
  // 1 — problem card
  await pg.goto("file://" + join(OUT, "problem.html")); mark("card:problem"); await sleep(9000);
  // 2 — it files itself
  await pg.goto(BASE, { waitUntil: "networkidle" }); await sleep(1200); mark("map:open");
  await cap("This is the map after three exchanges with Claude Code about practising English. Nobody filed anything by hand.", 5200);
  await cap("The conversation on the right is the real Claude Code session. A fourth exchange arrives — watch the left.", 2600);
  const r4 = rounds[3];
  mark("observe:post"); const before = (await liveNodes()).length;
  await post(BASE, "/api/harness/observe", { session_id: "demo-1", cwd: join(home, "proj"), user_text: r4.user, assistant_text: r4.assistant });
  await cap("The exchange is observed… the map files it in the background (this wait is sped up).", 0);
  let grew = false; const tw = Date.now();
  while (Date.now() - tw < 240000) { await sleep(1500); const f = await get(BASE, "/api/filings"); const n = (await liveNodes()).length; if (n > before) grew = true; if (grew && (f.pending ?? 0) === 0) break; }
  await sleep(2500); mark("observe:filed");
  const after = (await liveNodes()).length;
  await cap(`Filed. ${after - before > 0 ? `${after - before} new node${after - before === 1 ? "" : "s"}, placed under the right topic` : "The round updated existing nodes instead of adding new ones"} — the full statement is kept behind each name.`, 3000);
  { const fc = await pg.$(".fold-count"); if (fc) { const fb = await fc.boundingBox(); if (fb) await curTo(fb.x + fb.width / 2, fb.y + fb.height / 2); await fc.click({ force: true }); await sleep(2600); } }
  // 3 — focus
  const nodes = await liveNodes();
  const shown = new Set(await pg.$$eval("[data-focus]", (els) => els.map((e) => e.dataset.focus)));
  const vis = nodes.filter((n) => shown.has(n.id));
  const pick = (re) => vis.find((n) => re.test(String(n.title || n.content)));
  const focusNode = pick(/rewrite|native/i) || vis[vis.length - 1];
  const dimNode = pick(/group|app|watch|read/i) || vis[1];
  console.log("focus →", focusNode?.title, "| dim →", dimNode?.title, "| rendered", vis.length, "/", nodes.length);
  mark("focus:start");
  await cap("▶ Focus — “talk about this”. The agent's next turn is aimed here, and the path to it is protected.", 0);
  await clickSel(`[data-focus="${focusNode.id}"]`, { hoverFirst: `[data-focus="${focusNode.id}"]`, pause: 1800 });
  { const mf = await pg.$('button:has-text("move focus")'); if (mf) { await cap("It asks before moving the conversation — the agent pivots there on your next message.", 1200); const mb = await mf.boundingBox(); if (mb) await curTo(mb.x + mb.width / 2, mb.y + mb.height / 2); await mf.click(); await sleep(2200); } }
  await cap("The focus chip follows. Zoom and search never change what the agent sees — focus and light do.", 3200);
  // 4 — dim + agent's view
  mark("dim:start");
  await pg.evaluate(() => { for (const o of document.querySelectorAll(".overlay")) o.remove(); });
  await cap("☀ Light / dim — a dimmed branch is withheld from the agent. You still see everything.", 0);
  await clickSel(`[data-lit="${dimNode.id}"]`, { hoverFirst: `[data-lit="${dimNode.id}"]`, pause: 2400 });
  await cap("What the agent sees, you can see: this is the exact map description it receives next turn.", 0);
  await pg.evaluate(() => document.getElementById("ctx-btn")?.click()); await sleep(4200); mark("agentview:open");
  await pg.screenshot({ path: join(OUT, "frame-agentview.png") });
  await cap("The dimmed branch is a name only. Everything lit arrives in full.", 3600);
  await pg.keyboard.press("Escape"); await pg.evaluate(() => { for (const o of document.querySelectorAll(".overlay")) o.remove(); }); await sleep(600);
  await clickSel(`[data-lit="${dimNode.id}"]`, { hoverFirst: `[data-lit="${dimNode.id}"]`, pause: 900 }); // light it again
  // 5 — propose → approve → undo
  mark("tidy:start");
  await cap("The map never restructures on its own. Ask for a tidy: it proposes, you approve.", 0);
  const topic = vis.find((n) => !n.parentId) || vis[0];
  await clickSel(`[data-rowmore="${topic.id}"]`, { hoverFirst: `[data-focus="${topic.id}"]`, pause: 700 });
  const tidyBtn = await pg.$(`[data-reorg="${topic.id}"]`);
  let tidied = false;
  if (tidyBtn) {
    await clickSel(`[data-reorg="${topic.id}"]`, { pause: 900 });
    { const ok = await pg.$('.overlay button:has-text("tidy")'); if (ok) { await cap("It asks first — nothing changes until you apply.", 1000); const ob = await ok.boundingBox(); if (ob) await curTo(ob.x + ob.width / 2, ob.y + ob.height / 2); await ok.click(); await sleep(700); } }
    mark("tidy:proposing");
    await cap("Thinking… (sped up)", 0);
    const applySel = "#ro-apply, #sp-apply";
    let applyEl = null; const ta = Date.now();
    while (Date.now() - ta < 150000) { applyEl = await pg.$(applySel); if (applyEl && await applyEl.isEnabled()) break; await sleep(1500); }
    mark("tidy:proposed");
    if (applyEl && await applyEl.isEnabled()) {
      await cap("A before/after proposal. Nothing moved yet.", 3800);
      await pg.screenshot({ path: join(OUT, "frame-proposal.png") });
      await clickSel(applySel, { pause: 2200 }); tidied = true; mark("tidy:applied");
      await cap("Applied — and like every hand action, undoable. Ctrl/Cmd+Z.", 1800);
      { const chip = await pg.$("#undo-chip"); if (chip && await chip.isVisible()) { const cb = await chip.boundingBox(); if (cb) await curTo(cb.x + cb.width / 2, cb.y + cb.height / 2); await chip.click(); } else { await pg.keyboard.press("Control+z"); } await sleep(2600); mark("tidy:undone"); }
      await cap("Undone. The map is exactly as it was.", 2600);
    } else {
      await cap("This small map had nothing worth tidying — the map only proposes when there is something to improve.", 3600);
      await pg.keyboard.press("Escape"); await pg.evaluate(() => { for (const o of document.querySelectorAll(".overlay")) o.remove(); });
    }
  }
  await pg.evaluate(() => { for (const o of document.querySelectorAll(".overlay")) o.remove(); document.querySelectorAll(".nrow.ops-open").forEach((r) => r.classList.remove("ops-open")); });
  // 6 — talk to map (movable, M395)
  mark("talk:start");
  await cap("Talk to map — ask the map anything. It answers from the map, and it can propose changes.", 0);
  await clickSel("#map-chat", { pause: 1200 });
  const bar = await pg.waitForSelector(".overlay .modal h3", { timeout: 10000 }); const bb = await bar.boundingBox();
  await curTo(bb.x + 60, bb.y + bb.height / 2); await pg.mouse.down(); await curTo(bb.x + 60 - 250, bb.y + bb.height / 2 + 150, 18); await pg.mouse.up(); await sleep(700);
  await cap("Drag it anywhere; it remembers its place.", 1800);
  const q = "What did I decide about rewriting my sentences?";
  await clickSel("#mc-input", { pause: 300 }); await pg.keyboard.type(q, { delay: 34 }); await sleep(500);
  const msgsBefore = await pg.$$eval("#mc-log .msg.assistant", (l) => l.length);
  await clickSel("#mc-send", { pause: 400 }); mark("talk:asked");
  await cap("Answering from the map… (sped up)", 0);
  const tq = Date.now(); while (Date.now() - tq < 150000) { const n = await pg.$$eval("#mc-log .msg.assistant", (l) => l.length); const waiting = await pg.$eval("#mc-log", (l) => /…$|thinking|asking/i.test(l.lastElementChild?.textContent || "")).catch(() => false); if (n > msgsBefore && !waiting) break; await sleep(1500); }
  await sleep(1500); mark("talk:answered");
  await pg.screenshot({ path: join(OUT, "frame-talk.png") });
  await cap("Grounded in the map — and the same memory whether you ask here or from the desktop widget.", 6500);
  await clickSel("#mc-close", { pause: 600 });
  // 7 — scale
  mark("deep:start");
  try { srvA.kill("SIGTERM"); } catch {}
  srvB = spawn("bun", ["run", "src/server.ts"], { env: envB, stdio: ["ignore", "ignore", "ignore"] }); await waitUp(DEEP); await sleep(800);
  await pg.goto(DEEP, { waitUntil: "networkidle" }); await sleep(1500);
  await cap("It holds up at scale: 204 nodes, 40 levels deep.", 3000);
  const favs = await pg.$$("#bookmarks .bm");
  if (favs.length) { const f = favs[favs.length - 1]; const fb = await f.boundingBox(); if (fb) await curTo(fb.x + fb.width / 2, fb.y + fb.height / 2); await f.click({ force: true }); await sleep(2200); }
  await cap("Jump to a bookmark at level 38, or search any name — instant.", 2500);
  await clickSel("#search-btn", { pause: 600 }).catch(() => {});
  await clickSel("#sr-input", { pause: 200 }).catch(() => {});
  await pg.keyboard.type("flake root", { delay: 60 }).catch(() => {}); await sleep(2600); mark("deep:searched");
  await pg.screenshot({ path: join(OUT, "frame-deep.png") });
  await pg.keyboard.press("Escape").catch(() => {});
  // 8 — close card
  await pg.goto("file://" + join(OUT, "close.html")); mark("card:close"); await sleep(9000);
  mark("end");
} catch (e) { console.error("SCENE ERROR", e?.message || e); mark("error:" + String(e?.message || e).slice(0, 60)); await pg.screenshot({ path: join(OUT, "frame-error.png") }).catch(() => {}); }
const vpath = await pg.video().path(); await ctx.close(); await b.close();
copyFileSync(vpath, join(OUT, "raw.webm")); writeFileSync(join(OUT, "markers.json"), JSON.stringify({ t0: T0, marks }, null, 2));
console.log("raw video", join(OUT, "raw.webm")); console.log(JSON.stringify(marks));
cleanup(); try { rmSync(home, { recursive: true, force: true }); } catch {} process.exit(0);

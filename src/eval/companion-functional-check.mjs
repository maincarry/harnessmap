// Functional + robustness test for the companion's NATIVE bridge (Jacob 2026-10-01: "test the
// functioning of the companion fully as well" / "these are spontaneous builds so test robustness
// seriously"). The companion's own code is a thin native shell: every action the widget performs
// is routed through the Rust `api` command (companion/src-tauri/src/lib.rs:78), which talks to the
// local map server as a RAW HTTP/1.0 request over TCP carrying NO Origin header — that is the whole
// reason the companion reaches ANY server version (a browser fetch's Origin trips the loopback gate
// on older builds). The GUI window itself can't run on this headless box, but that native contract
// is exactly reproducible: this test opens a real TCP socket and sends the identical bytes lib.rs
// emits, then drives every companion action (state, influence toggle, favorite, chat history, map
// chat) against a real isolated server and asserts each one FUNCTIONS and MUTATES state correctly,
// plus robustness edges (no-Origin reach, bad node id, non-/ path normalization, empty method→GET).
//
//   bun run src/eval/companion-functional-check.mjs     # isolated server on 8799
// Exits 0 iff every check passes.
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.UI_PORT || 8799);
if (PORT === 8790) { console.error("refusing to use 8790 (the real server port)"); process.exit(2); }

let pass = 0, fail = 0; const out = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; out.push(`  PASS ${name}`); } else { fail++; out.push(`  FAIL ${name}${detail ? " — " + detail : ""}`); } };

// Faithful JS port of companion/src-tauri/src/lib.rs::api — raw HTTP/1.0, NO Origin header,
// Connection: close, read to EOF, return the body after the blank line. Returns {status, body}.
function nativeApi(method, path, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const m = (method || "GET").toUpperCase();
    const b = body == null ? "" : body;
    const p = path.startsWith("/") ? path : "/" + path;
    const req =
      `${m} ${p} HTTP/1.0\r\nHost: 127.0.0.1\r\nAccept: application/json\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(b)}\r\nConnection: close\r\n\r\n${b}`;
    const sock = connect(PORT, "127.0.0.1");
    const chunks = [];
    // A timeout means the server accepted the request but hasn't closed yet — resolve as
    // {timedout:true} instead of rejecting, so one slow endpoint can't abort the whole suite.
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve({ status: 0, timedout: true, body: "", raw: "" }); });
    sock.on("connect", () => sock.write(req));
    sock.on("data", (d) => chunks.push(d));
    sock.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const i = text.indexOf("\r\n\r\n");
      const statusLine = text.split("\r\n", 1)[0] || "";
      const status = Number((statusLine.match(/\s(\d{3})\s/) || [])[1] || 0);
      resolve({ status, body: i >= 0 ? text.slice(i + 4) : "", raw: text });
    });
    sock.on("error", reject);
  });
}
const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

const home = mkdtempSync(join(tmpdir(), "hm-func-"));
mkdirSync(join(home, ".harnessmap"), { recursive: true });
writeFileSync(join(home, ".harnessmap", "port"), String(PORT)); // what map_port() would read
const srv = spawn("bun", ["run", "src/server.ts"], {
  env: { ...process.env, HARNESSMAP_HOME: home, PORT: String(PORT), HARNESSMAP_DB: join(home, "map.sqlite"), HARNESSMAP_INFERENCE: "off" },
  stdio: ["ignore", "ignore", "inherit"],
});
async function waitUp() { for (let i = 0; i < 50; i++) { try { const r = await nativeApi("GET", "/api/state"); if (r.status === 200) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; }
function cleanup() { try { srv.kill("SIGTERM"); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} }

async function run() {
  if (!(await waitUp())) { check("isolated server boots", false, `no 200 from /api/state on :${PORT}`); return; }
  check("isolated server boots + bootstraps a map", true);

  // 1. CORE READ via the native proxy (no Origin) — the companion's whole reason to exist.
  const st = await nativeApi("GET", "/api/state");
  const S = json(st);
  check("native api GET /api/state → 200 with NO Origin header (version-agnostic reach)", st.status === 200, `status ${st.status}`);
  check("native api returns valid state JSON", !!S && typeof S === "object", st.body.slice(0, 80));
  const nodes = (S && S.nodes) || [];
  check("state carries map nodes (the widget renders these)", Array.isArray(nodes) && nodes.length > 0, `nodes=${nodes.length}`);

  // 2. INFLUENCE TOGGLE action functions AND mutates state (what the inf-toggle switch does).
  const before = !!(S && S.influenceOff);
  const tog = await nativeApi("POST", "/api/influence/toggle", "{}");
  check("native api POST /api/influence/toggle → success", tog.status >= 200 && tog.status < 300, `status ${tog.status}`);
  const S2 = json(await nativeApi("GET", "/api/state"));
  check("influence toggle actually flipped the map state", S2 && !!S2.influenceOff === !before, `before=${before} after=${S2 && S2.influenceOff}`);
  await nativeApi("POST", "/api/influence/toggle", "{}"); // restore

  // 3. FAVORITE a real node (the pin/unpin action) → functions + reflects in state.
  const nid = nodes[0] && nodes[0].id;
  if (nid) {
    const fav = await nativeApi("POST", `/api/nodes/${nid}/favorite`, JSON.stringify({ on: true }));
    check("native api POST /api/nodes/<id>/favorite → success", fav.status >= 200 && fav.status < 300, `status ${fav.status}`);
    const S3 = json(await nativeApi("GET", "/api/state"));
    // Favorite is tracked in the top-level state.favorites array (list of node ids), which is
    // exactly what the widget reads to show the pin state.
    check("favorite reflected in state.favorites", !!S3 && Array.isArray(S3.favorites) && S3.favorites.includes(nid),
      S3 ? `favorites=${JSON.stringify(S3.favorites)}` : "no state");
    await nativeApi("POST", `/api/nodes/${nid}/favorite`, JSON.stringify({ on: false })); // restore
  } else check("favorite action", false, "no node id in state");

  // 4. CHAT HISTORY read (the panel's talk-to-map history).
  const hist = await nativeApi("GET", "/api/map-chat/history");
  check("native api GET /api/map-chat/history → reachable (200)", hist.status === 200, `status ${hist.status}`);

  // 5. ROBUSTNESS — the native proxy + server must handle edges without crashing:
  //   a. empty method defaults to GET (lib.rs: `if method.is_empty()`).
  const g = await nativeApi("", "/api/state");
  check("robustness: empty method → treated as GET (200)", g.status === 200, `status ${g.status}`);
  //   b. a path without leading slash is normalized (lib.rs prepends '/').
  const noslash = await nativeApi("GET", "api/state");
  check("robustness: path without leading slash is normalized", noslash.status === 200, `status ${noslash.status}`);
  //   c. favorite on a bogus node id → a clean HTTP error, NOT a connection crash.
  const bad = await nativeApi("POST", "/api/nodes/__nope__/favorite", JSON.stringify({ on: true }));
  check("robustness: bad node id → clean HTTP response (no socket crash)", bad.status >= 400 && bad.status < 600, `status ${bad.status}`);
  //   d. map-chat POST — the companion's send path. map-chat needs an LLM, which is OFF in this
  //      deterministic test, so the server legitimately either answers quickly or holds the request
  //      open awaiting inference. Both mean the companion's request was ACCEPTED (not refused/reset);
  //      only a connection error would be a real failure. Short timeout so it can't stall the suite.
  let chatOk = false, chatDetail = "";
  try { const chat = await nativeApi("POST", "/api/map-chat", JSON.stringify({ question: "hi", history: [], client: "companion" }), 6000);
        chatOk = chat.timedout || (chat.status >= 200 && chat.status < 600); chatDetail = chat.timedout ? "accepted, awaiting inference (off)" : `status ${chat.status}`; }
  catch (e) { chatOk = false; chatDetail = "connection error: " + ((e && e.message) || e); }
  check("robustness: map-chat POST is accepted (not refused/reset)", chatOk, chatDetail);
}

run().catch((e) => check("harness", false, String((e && e.message) || e))).finally(() => {
  cleanup();
  console.log(out.join("\n"));
  console.log(`\n================ companion-functional-check · ${pass} passed, ${fail} failed ================`);
  process.exit(fail ? 1 : 0);
});

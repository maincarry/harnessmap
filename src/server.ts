// harnessmap server — bun runtime, zero server deps (Bun.serve + built-in ws).
// Two layers over HTTP: REST for state + actions, WS for live updates.
// v0.4: the map is nodes all the way down — one kind of thing.

import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from './store/db.js';
import { Translator } from './translator/translator.js';
import { ChatSessionManager } from './agent/chat-session.js';
import { composeParts } from './seed/composer.js';
import { loadMap, descendantNodes, renderSubtreeFull } from './map/render.js';
import { proposeReorganize } from './translator/reorganize.js';
import { proposeAutolit } from './translator/autolit.js';
import { proposeTopicRec } from './translator/recommend.js';
import { checkMap } from './translator/mapcheck.js';
import { answerMapQuestion } from './translator/mapchat.js';
import { createTerm, getTerm, listTerms, killTerm, ptyBackend, spawnLoginPty } from './term.js';
import { suggestHomes } from './translator/place.js';
import { describeRelations, suggestTitle } from './translator/relations.js';
import { updateNodeMemory, updateTouchedMemories, getNodeMemory, setNodeMemory, clearNodeMemory } from './translator/memory.js';
import { mergeNodeText } from './translator/merge.js';
import { proposeImport, extractTranscript } from './translator/importer.js';
import { setTraceSink, lastCallError, call } from './inference.js';
import { foldTurns, getConversationSummary } from './agent/rolling-summary.js';
import { sliceRound, recordSessionStart, getSession, advanceSession, recordProvenance, getInjectionAnchor, setInjectionAnchor, resetInjectionAnchor, currentSeq, renderDelta, activeCwds, getFullAnchor, setFullAnchor, type RoundSlice } from './agent/harness-adapter.js';
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { authUser, authEnabled, unauthorized } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => { try { return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version as string; } catch { return '0.0.0'; } })();
const PORT = Number(process.env.PORT ?? 8790);
const REQUESTED_HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.HARNESSMAP_DB ?? join(here, '..', 'harnessmap.sqlite');

// SAFETY GUARD: never expose a non-loopback interface without auth.
// If auth is off and HOST asks for a public/LAN bind, force loopback instead —
// so the server can only ever be reached through an SSH tunnel. This makes
// "no password + public IP" structurally impossible, not just discouraged.
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
let HOST = REQUESTED_HOST;
if (!authEnabled && !LOOPBACK.has(REQUESTED_HOST)) {
  console.warn(`⚠  auth is OFF but HOST=${REQUESTED_HOST} would expose the server. Forcing HOST=127.0.0.1 (loopback only). Set HARNESSMAP_USERS to allow a non-loopback bind.`);
  HOST = '127.0.0.1';
}

if (process.env.HARNESSMAP_HOME) {
  try { mkdirSync(process.env.HARNESSMAP_HOME, { recursive: true }); writeFileSync(join(process.env.HARNESSMAP_HOME, 'port'), String(PORT)); } catch {}
}

const store = new Store(DB_PATH);
setTraceSink((t) => { if (store.getSetting('dev_mode') === '1') store.addTrace(t); });
const translator = new Translator(store);
const chats = new ChatSessionManager(store);

// M88 (Mark): MULTI-PROJECT — each project is its own map, nothing shared.
// The server keeps an ACTIVE pair (projectId, mainChatId) that the UI views
// and UI actions target; terminal sessions route by cwd→project binding.
// M123 (Jacob): "the to-sort should always be present as a pinned system
// node, even if there is nothing in it." Idempotent guarantee, called at boot
// for every project and at project creation; the store guard (db.ts) makes it
// un-removable, so ensure + guard = always present.
function ensureToSort(pid: string): void {
  const live = store.getNodes(pid).some((n) => n.parentId === null && n.status !== 'removed' && ((n.title ?? n.content) ?? '').startsWith('to sort'));
  if (live) return;
  store.applyAlterations(pid, [
    { op: 'create_node', id: randomUUID(), parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any,
  ], { kind: 'system' });
  store.audit('tosort_ensured', { project: pid.slice(0, 8) });
}

function bootstrapProject(pid: string): string {
  ensureToSort(pid);
  const existing = store.getChats(pid);
  if (existing.length > 0) return existing[existing.length - 1].id;
  const rootId = randomUUID();
  // M178 (Jacob): the FIRST map ever teaches by example instead of seeding a
  // bare "workspace" — a real, ordinary topic, deletable and undoable,
  // outgrown the moment real work arrives. Later maps (the user knows the
  // product by then) start with one root named after the map. Tutorial nodes
  // carry author 'system' so project adoption still sees a pristine map.
  const first = store.listProjects().length <= 1;
  const seedIds = [rootId];
  if (first) {
    const k1 = randomUUID(), k2 = randomUUID(), k3 = randomUUID();
    seedIds.push(k1, k2, k3);
    store.applyAlterations(pid, [
      { op: 'create_node', id: rootId, parentId: null, content: 'getting started', status: 'live', author: 'system' },
      { op: 'create_node', id: k1, parentId: rootId, content: 'this map takes notes for you — talk to Claude and topics file themselves here', status: 'live', author: 'system' },
      { op: 'create_node', id: k2, parentId: rootId, content: 'try it: press ▶ on a node to talk about it, ☀ to keep it in Claude\u2019s background, ◱ to view only that branch', status: 'live', author: 'system' },
      { op: 'create_node', id: k3, parentId: rootId, content: 'when real work shows up, delete this topic (✕) — everything is undoable (Ctrl/Cmd+Z)', status: 'live', author: 'system' },
    ], { kind: 'system' });
  } else {
    const pname = store.listProjects().find((x) => x.id === pid)?.name ?? 'workspace';
    store.applyAlterations(pid, [
      { op: 'create_node', id: rootId, parentId: null, content: pname, status: 'live', author: 'user' },
    ], { kind: 'system' });
  }
  const chatId = randomUUID();
  store.createChat({ id: chatId, projectId: pid, focusContainerId: rootId, sdkSessionId: null });
  for (const id of seedIds) store.setLit(chatId, id, true);
  return chatId;
}
// M161 (Mark): update visibility without bombardment. A tiny daily check
// fetches ONLY the latest version number from GitHub (disclosed in the
// README; fail-silent offline; HARNESSMAP_LATEST_OVERRIDE is the test seam).
let latestKnown: string | null = store.getSetting('latest_ver') || null;
async function checkLatest(force = false): Promise<string | null> {
  if (process.env.HARNESSMAP_LATEST_OVERRIDE) { latestKnown = process.env.HARNESSMAP_LATEST_OVERRIDE; return latestKnown; }
  const last = Number(store.getSetting('latest_checked') ?? 0);
  if (!force && Date.now() - last < 20 * 3600_000) return latestKnown;
  try {
    const r = await fetch('https://raw.githubusercontent.com/maincarry/harnessmap/main/package.json', { signal: AbortSignal.timeout(4000) });
    const v = ((await r.json()) as any)?.version;
    if (typeof v === 'string' && v) { latestKnown = v; store.setSetting('latest_ver', v); }
  } catch { /* offline is fine */ }
  store.setSetting('latest_checked', String(Date.now()));
  return latestKnown;
}
const newer = (a: string, b: string) => { // is a newer than b (x.y.z)
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0); }
  return false;
};
const updateAvailable = () => (latestKnown && newer(latestKnown, VERSION) ? latestKnown : null);

// M179b (Jacob: "the user should not be required to figure these out"): the
// server proves it can make a model call BEFORE the user wonders why nothing
// files. One tiny probe, cached forever once it succeeds; on auth-shaped
// failure the intro + a map banner give the one-time /login walkthrough.
// HARNESSMAP_AUTH_PROBE=0 disables (suites).
let authBroken: boolean | null = null;
async function probeAuth(): Promise<boolean | null> {
  if (process.env.HARNESSMAP_AUTH_PROBE === '0') return null;
  if (store.getSetting('auth_ok') === '1') { authBroken = false; return false; }
  try {
    await call({ task: 'memory', system: 'Reply with the word ok.', user: 'ok', maxTokens: 4, timeoutMs: 15_000 });
    authBroken = false;
    store.setSetting('auth_ok', '1');
  } catch (err) {
    if (/invalid api key|please run \/login|not logged in|authentication|401|exited with code 1/i.test(String(err))) authBroken = true;
  }
  return authBroken;
}
probeAuth().catch(() => {});
// M180 (Jacob picked B): sign in WITHOUT a terminal. The server drives
// `claude setup-token` on a PTY: hand the user the login URL, take the code
// back, capture the long-lived token, store it 0600 in the harnessmap home,
// and pass it to every SDK child as CLAUDE_CODE_OAUTH_TOKEN.
const HOMEDIR_HM = process.env.HARNESSMAP_HOME ?? join(homedir(), '.harnessmap');
const TOKEN_FILE = join(HOMEDIR_HM, 'oauth-token');
let loginFlow: { pty: { write: (d: string) => void; kill: () => void }; out: string; url: string | null; token: string | null } | null = null;
const stripAnsi = (x: string) => x.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
function loginWatch(chunk: string) {
  if (!loginFlow) return;
  loginFlow.out += stripAnsi(chunk);
  if (!loginFlow.url) loginFlow.url = loginFlow.out.match(/https:\/\/\S+/)?.[0] ?? null;
  const tok = loginFlow.out.match(/sk-ant-[A-Za-z0-9_\-]{24,}/)?.[0];
  if (tok && !loginFlow.token) {
    loginFlow.token = tok;
    try { writeFileSync(TOKEN_FILE, tok, { mode: 0o600 }); } catch {}
    store.setSetting('auth_ok', '');
    probeAuth().then(() => broadcast({ type: 'map', ...state() })).catch(() => {});
  }
}
const AUTH_FIX_LINE = "[harnessmap] SETUP NEEDED before the map can file: the map's agents make model calls through the Claude Code command line, which has its own login. Walk the user through it in plain words: open a terminal, run `claude`, type /login, approve in the browser — two minutes, once ever. Everything else (this conversation included) works meanwhile.";
checkLatest().catch(() => {});

let projectId = store.getSetting('active_project') ?? store.ensureProject('default');
for (const pr of store.listProjects()) ensureToSort(pr.id);
if (!store.listProjects().some((p) => p.id === projectId)) projectId = store.ensureProject('default');
let mainChatId = (() => {
  const saved = store.getSetting(`active_chat:${projectId}`);
  const id = saved && store.getChat(saved)?.projectId === projectId ? saved : bootstrapProject(projectId);
  store.setSetting('active_project', projectId);
  store.setSetting(`active_chat:${projectId}`, id);
  return id;
})();
// M91 migration: DBs from before the binding policy have sessions but no
// cwd bindings — without this, their next session would auto-create a ghost
// project instead of reaching their existing map.
try {
  const legacy = (store as any).db.prepare('SELECT DISTINCT cwd FROM harness_sessions WHERE cwd IS NOT NULL').all() as any[];
  for (const r of legacy) if (r.cwd && !store.projectForCwd(r.cwd)) store.bindCwd(r.cwd, projectId);
} catch { /* fresh DB */ }

function activeChatOf(pid: string): string {
  // Order matters: saved-and-valid first, the in-memory pair only as a
  // validated fallback — the fast path must never leak another project's
  // chat (it did: setActive mutated projectId before consulting this).
  const saved = store.getSetting(`active_chat:${pid}`);
  if (saved && store.getChat(saved)?.projectId === pid) return saved;
  if (store.getChat(mainChatId)?.projectId === pid) return mainChatId;
  return bootstrapProject(pid);
}
function setActive(pid: string, chatId?: string): void {
  const next = chatId ?? activeChatOf(pid);
  projectId = pid;
  mainChatId = next;
  store.setSetting('active_project', projectId);
  store.setSetting(`active_chat:${projectId}`, mainChatId);
  clearNudges();
  broadcast({ type: 'map', ...state() });
}
// M98 (Mark+Jacob): a SESSION = a view (chat row) + optionally the live CC
// process bound to it. Terminal tabs pre-claim their view: /api/term records
// (cwd → chatId), and the first CC session-start from that cwd claims it, so
// each tab reads and writes through ITS OWN focus and lighting.
const pendingChatClaims = new Map<string, string[]>(); // cwd -> chatIds FIFO
const pendingPrompts = new Map<string, string>();       // session -> last user prompt (M99)
function claimChat(cwd: string): string | null {
  const q = pendingChatClaims.get(cwd);
  if (!q?.length) return null;
  const id = q.shift()!;
  if (!q.length) pendingChatClaims.delete(cwd);
  return store.getChat(id) ? id : null;
}
function sessionChat(sessionId: string): string | null {
  const row = (store as any).db.prepare('SELECT chat_id FROM harness_sessions WHERE session_id = ?').get(sessionId) as any;
  return row?.chat_id && store.getChat(row.chat_id) ? row.chat_id : null;
}
// A terminal session belongs to its CLAIMED view when it has one; otherwise
// to the active chat of the project its cwd is bound to.
function sessionPair(sessionId: string | null | undefined): { pid: string; chatId: string } {
  if (sessionId) {
    const claimed = sessionChat(sessionId);
    if (claimed) return { pid: store.getChat(claimed)!.projectId, chatId: claimed };
    const cwd = (store as any).db.prepare('SELECT cwd FROM harness_sessions WHERE session_id = ?').get(sessionId)?.cwd as string | undefined;
    if (cwd) {
      const pid = store.projectForCwd(cwd);
      if (pid) return { pid, chatId: activeChatOf(pid) };
    }
  }
  return { pid: projectId, chatId: mainChatId };
}
const WINDOW = Number(process.env.HARNESSMAP_WINDOW ?? 20);
// M42/P2: recent removal notices, handed to the summary folder so deleted
// topics die in the summary too. Consumed per fold.
let pendingRemovals: string[] = [];

// M48 (Jacob): whenever a node is referred to in chat markers/notices, use
// its TITLE (fall back to content) — never the long description.
function nodeName(n: { title?: string | null; content: string } | undefined | null): string {
  return n ? (n.title || n.content) : '?';
}

// M66 (Jacob): newly introduced nodes are LIT by default — the user dims
// deliberately, rather than lighting deliberately.
// M111 (Jacob): the focus's ANCESTOR CHAIN is protected lighting — focusing
// lights the path upward, and dim operations cannot darken it (explicit
// attempts get a clear refusal; bulk operations skip it and say so).
function focusPathOf(chatId: string): Set<string> {
  const c = store.getChat(chatId);
  const out = new Set<string>();
  for (let n = c ? store.getNode(c.focusContainerId) : undefined; n; n = n.parentId ? store.getNode(n.parentId) : undefined) out.add(n.id);
  return out;
}
// M136: undo — capture pre-images as inverse alterations + meta (memories,
// lighting, focus) that alterations cannot express. Best-effort by design:
// the map may change between action and undo; the projector skips what no
// longer applies.
// M143 (Jacob): "close map influence" — a per-map kill-switch. When off:
// no context injection, no announcements, no compaction guidance; sessions
// that ALREADY saw map context get ONE final silence directive; sessions
// started while off never hear of the map at all. Filing continues quietly
// so the map is current when reopened.
const influenceOff = (pid: string) => store.getSetting(`influence_off:${pid}`) === '1';
const silenceNoticeSent = new Set<string>();
const SILENCE_NOTICE = '[harnessmap] The user has CLOSED the map\u2019s influence for this project. From now on: do not use, reference, or mention the map or this notice. Work as if the map integration does not exist. (They can reopen it from the map page.)';

function captureFocusLit(ids: string[]): any {
  const meta: any = { lit: {}, focus: {} };
  const idSet = new Set(ids);
  for (const c of store.getChats(projectId)) {
    const lit = store.getLit(c.id).filter((x) => idSet.has(x));
    if (lit.length) meta.lit[c.id] = lit;
    if (idSet.has(c.focusContainerId)) meta.focus[c.id] = c.focusContainerId;
  }
  return meta;
}
function inverseOfAlterations(alts: any[]): any[] {
  const inv: any[] = [];
  for (const a of alts) {
    if (a.op === 'create_node') inv.push({ op: 'update_node', id: a.id, status: 'removed' });
    else if (a.op === 'move_node') { const n = store.getNode(a.id); if (n) inv.push({ op: 'move_node', id: a.id, parentId: n.parentId }); }
    else if (a.op === 'update_node') {
      const n = store.getNode(a.id);
      if (n) inv.push({ op: 'update_node', id: a.id, content: n.content, title: (n as any).title ?? null, type: n.type ?? null, status: n.status });
    }
  }
  return inv.reverse();
}
function applyUndo(entry: { label: string; inverse: any[]; meta: any }): void {
  store.applyAlterations(projectId, entry.inverse, { kind: 'user_edit' });
  const meta = entry.meta ?? {};
  for (const [id, mem] of Object.entries(meta.memories ?? {})) {
    if (mem == null || mem === '') clearNodeMemory(store, id); else setNodeMemory(store, id, String(mem));
  }
  for (const [chatId, ids] of Object.entries(meta.lit ?? {})) {
    if (!store.getChat(chatId)) continue;
    for (const nid of ids as string[]) if (store.getNode(nid)?.status !== 'removed') store.setLit(chatId, nid, true);
  }
  for (const [chatId, nid] of Object.entries(meta.focus ?? {})) {
    if (store.getChat(chatId) && store.getNode(nid as string)?.status !== 'removed') applyFocus(chatId, nid as string);
  }
  touch(entry.inverse.map((a: any) => a.id).filter(Boolean));
  chats.noteMapChange(mainChatId, `UNDONE: ${entry.label} — the map is back to how it was before that`);
  store.audit('undo', { label: entry.label.slice(0, 60) });
}

function applyFocus(chatId: string, nodeId: string): void {
  store.setChatFocus(chatId, nodeId);
  for (let n = store.getNode(nodeId); n; n = n.parentId ? store.getNode(n.parentId) : undefined) store.setLit(chatId, n.id, true);
}

function lightNewNodes(alterations: any[], chatId: string) {
  for (const a of alterations) {
    if (a?.op === 'create_node' && a.id) store.setLit(chatId, a.id, true);
  }
}

function appendMarker(text: string) {
  store.appendTurn({ id: randomUUID(), chatId: mainChatId, role: 'system', content: text, raw: null });
  broadcast({ type: 'turn', chatId: mainChatId, role: 'system', content: text });
}

// ---- websocket broadcast ----
const sockets = new Set<any>();
function broadcast(event: Record<string, unknown>) {
  const s = JSON.stringify(event);
  for (const ws of sockets) ws.send(s);
  if (event.type === 'map') scheduleMapFile();
}

// M71 (Jacob: "precompute proposals — but not too often"): ONE background
// proposal per open dot, computed only after the map has settled (debounce),
// serially, never while the filer is busy. Validity = subtree hash at
// compute time; a stale cache silently falls back to live compute at click.
function subtreeHash(pid: string, nodeId: string, hint?: string): string {
  const ids = [nodeId, ...descendantNodes(store, nodeId)];
  for (const m of (hint ?? '').matchAll(/\[([0-9a-f]{8})/g)) {
    const full = store.getNodes(pid).find((n) => n.id.startsWith(m[1]));
    if (full) { ids.push(full.id, ...descendantNodes(store, full.id)); }
  }
  return ids.map((id) => { const n = store.getNode(id); return n ? `${id.slice(0, 8)}@${n.updatedAt}` : id.slice(0, 8); }).join('|');
}

let precomputeTimer: ReturnType<typeof setTimeout> | null = null;
let precomputeBusy = false;
function schedulePrecompute() {
  if (precomputeTimer) clearTimeout(precomputeTimer);
  precomputeTimer = setTimeout(precomputeProposals, 25_000); // let the map settle
}
async function precomputeProposals() {
  if (precomputeBusy || lag > 0) { schedulePrecompute(); return; } // never while filing
  precomputeBusy = true;
  try {
    outer: for (const proj of store.listProjects()) {
    for (const sg of store.getOpenSuggestions(proj.id)) {
      // Same target the click path uses (openReorganize gets sg.nodeId) —
      // the cache key must match the click or it never hits.
      const targetId = sg.nodeId;
      if (targetId === '__top__') continue; // root dots compute live on click (M124)
      if (!store.getNode(targetId)) continue;
      const hash = subtreeHash(proj.id, targetId, sg.note);
      const cached = store.getSuggestionProposal(sg.id);
      // Fresh cache → nothing to do. Stale (map changed since compute) →
      // recompute, but at most 3 background computes per dot EVER (cost cap);
      // past the cap, clicks fall back to live compute (which refreshes the
      // cache for free anyway).
      if (cached.proposal && cached.hash === hash) continue;
      if (cached.count >= 3) continue;
      const p = await proposeReorganize(store, proj.id, targetId, sg.note);
      if (p && !('error' in p)) {
        store.setSuggestionProposal(sg.id, JSON.stringify(p), hash, true);
        store.audit('proposal_precomputed', { suggestion: sg.id.slice(0, 8), n: cached.count + 1, stale: Boolean(cached.proposal) });
      }
      break outer; // serial: at most one per sweep; next sweep handles the rest
    }
    }
  } catch { /* next sweep */ }
  finally { precomputeBusy = false; }
}
schedulePrecompute(); // boot: dots that predate a restart get their compute too

// M68 (Jacob): broken display names heal THEMSELVES — any node whose shown
// name would run long (no title + long content, or an over-long legacy
// title) gets re-titled automatically, a few per sweep, off the hot path.
let healBusy = false;
function brokenTitles(pid: string) {
  // A shown name (title || content) is broken when it's over 6 words (M68),
  // over 48 chars total, or contains any unreadable 19+ char token (garbage
  // strings and URLs are "long names" too — Jacob's live find: a 4-word name
  // hiding a 27-char keyboard mash passed the word rule).
  const longName = (shown: string) => {
    const words = shown.trim().split(/\s+/);
    return words.length > 6 || shown.length > 48 || words.some((w) => w.length > 18);
  };
  return store.getNodes(pid).filter((n) => {
    if (n.status === 'removed') return false;
    if (n.content.startsWith('to sort')) return false;
    return longName(n.title || n.content);
  });
}
async function healTitles(cap = 5, pid = projectId): Promise<{ renamed: number; remaining: number }> {
  if (healBusy) return { renamed: 0, remaining: brokenTitles(pid).length };
  healBusy = true;
  let renamed = 0;
  try {
    const broken = brokenTitles(pid).slice(0, cap);
    for (const n of broken) {
      const r = await suggestTitle(store, n.id);
      if ('title' in r && r.title) {
        store.applyAlterations(pid, [{ op: 'update_node', id: n.id, title: r.title } as any], { kind: 'system' });
        store.audit('title_healed', { id: n.id.slice(0, 8), title: r.title });
        renamed++;
      }
    }
    if (broken.length) broadcast({ type: 'map', ...state() });
  } catch { /* next sweep */ }
  finally { healBusy = false; }
  return { renamed, remaining: brokenTitles(pid).length };
}
setTimeout(healTitles, 5_000); // boot sweep

// M62: turn-lifecycle health. The plugin is only alive if rounds keep
// arriving — track the beats so the UI can show them (and show breakage).
const health = { promptAt: 0, observedAt: 0, filedAt: 0 };

// M74 (Jacob): red-dot nudges on the auto-focus / auto-light buttons when the
// conversation seems to call for them. Detected mechanically, zero model cost:
// 2+ consecutive rounds landing material in "to sort" = the talk has drifted
// outside the current focus+light. Any focus/light action clears both.
let toSortStreak = 0;
const nudges = { focus: false, light: false };
// M75 (Jacob): an explicit "let's focus on X" in chat raises the focus nudge
// with a known target — auto-focus then applies it without a model call, and
// the host agent gets a ONE-SHOT notice to point the user at the button.
let nudgeFocusTarget: { id: string; name: string } | null = null;
let nudgeNoticePending = false;
function clearNudges() {
  toSortStreak = 0;
  nudgeFocusTarget = null;
  nudgeNoticePending = false;
  if (nudges.focus || nudges.light) { nudges.focus = false; nudges.light = false; broadcast({ type: 'map', ...state() }); }
}

// M60: MAP.md — the pull side of map awareness. Written into every active
// host project (.harnessmap/MAP.md) on map change, rendered through the same
// lighting keyhole as injections. The agent Reads it on demand; Claude Code's
// micro-compaction self-cleans old reads.
let mapFileTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMapFile() {
  if (mapFileTimer) clearTimeout(mapFileTimer);
  mapFileTimer = setTimeout(writeMapFiles, 800);
}
function writeMapFiles() {
  const body = [
    '# The map (harnessmap)',
    '',
    'Current state of the project map — always fresh; re-read after any map-change notice.',
    'Focus/lighting below reflect what the user has chosen to emphasize.',
    '',
    '```',
    chats.previewMapOnly(mainChatId),
    '```',
    '',
    `_updated ${new Date().toISOString()}_`,
  ].join('\n');
  for (const cwd of activeCwds(store)) {
    try {
      // M88: each cwd gets ITS project's map, not the UI-active one.
      const pid = store.projectForCwd(cwd);
      const cwdBody = pid && pid !== projectId
        ? body.replace(chats.previewMapOnly(mainChatId), chats.previewMapOnly(activeChatOf(pid)))
        : body;
      mkdirSync(join(cwd, '.harnessmap'), { recursive: true });
      writeFileSync(join(cwd, '.harnessmap', 'MAP.md'), cwdBody);
    } catch { /* host dir gone — fine */ }
  }
}

// ---- recency (v0.2, M40 fix): which nodes changed in the last few rounds ----
// Derived from the persisted updated_at stamps (the in-memory version reset on
// every server restart, so tints were almost never visible in practice).
// The 3 newest distinct change-moments get ages 0-2; everything older is quiet.
// M107 (Jacob): marks PERSIST until the user interacts with the node (or
// clears all) — "the user does not check the map all the time." Set by filer
// rounds only; the user's own edits never mark.
function recency(): Record<string, string> {
  return store.getMarks(projectId);
}
function touch(_ids: string[]) { /* recency is now derived from updated_at */ }

// ---- serial translation queue with visible lag (TD finding 4/6) ----
let translationChain: Promise<void> = Promise.resolve();
let lag = 0;
function enqueueTranslation(params: { chatId: string; turnId: string; userText: string; assistantText: string; provenance?: { sessionId: string | null; slice: RoundSlice } }) {
  lag += 1;
  broadcast({ type: 'lag', lag });
  translationChain = translationChain.then(async () => {
    const chat = store.getChat(params.chatId);
    if (!chat) return;
    const roundPid = chat.projectId; // M88: rounds file into THEIR map
    const out = await translator.translateRound({
      projectId: roundPid, chatId: params.chatId, turnId: params.turnId,
      focusContainerId: chat.focusContainerId,
      userText: params.userText, assistantText: params.assistantText,
    });
    lag -= 1;
    broadcast({ type: 'lag', lag });
    if (out) {
      if (authBroken !== false) { authBroken = false; store.setSetting('auth_ok', '1'); }
      lightNewNodes(out.result.alterations as any[], params.chatId);
      for (const a of out.result.alterations as any[]) {
        if (a.op === 'create_node' && a.id) store.markFresh(a.id, 'new');
        else if ((a.op === 'update_node' || a.op === 'move_node') && a.id && a.status !== 'removed') store.markFresh(a.id, 'changed');
      }
      schedulePrecompute();
      // M74: drift detection — did this round land new material in "to sort"?
      const toSortTop = store.getNodes(roundPid).find((n) => n.parentId === null && n.status !== 'removed' && (n.content === 'to sort' || n.content.startsWith('to sort')));
      const landed = toSortTop && (out.result.alterations as any[]).some((a) => (a.op === 'create_node' || a.op === 'move_node') && a.parentId === toSortTop.id);
      toSortStreak = landed ? toSortStreak + 1 : 0;
      if (toSortStreak >= 2 && !(nudges.focus && nudges.light)) {
        nudges.focus = true; nudges.light = true;
        store.audit('nudge_raised', { streak: toSortStreak });
      }
      // M75: the filer heard an explicit focus request. M87 guard: haiku
      // flags mere topic switches too ("I'm planning a ski trip" — bench);
      // EXPLICIT means directive words, so gate mechanically on the user's
      // own text before trusting the flag.
      const directive = /\b(focus|concentrate|switch(?:ing)? to|back to|let'?s (?:do|work on|talk about|get to)|move (?:on )?to|zoom in on)\b/i.test(params.userText);
      if (out.focusRequestId && !directive) store.audit('guard_focus_request_veto', { id: out.focusRequestId.slice(0, 8) });
      if (out.focusRequestId && directive) {
        const fn = store.getNode(out.focusRequestId);
        if (fn && fn.status !== 'removed' && fn.id !== chat.focusContainerId) {
          nudges.focus = true;
          nudgeFocusTarget = { id: fn.id, name: nodeName(fn) };
          nudgeNoticePending = true;
          store.audit('nudge_focus_request', { id: fn.id.slice(0, 8), name: nodeName(fn) });
        }
      }
      if (params.provenance) recordProvenance(store, out.roundId, params.provenance.sessionId, params.provenance.slice);
      touch(out.result.alterations.map((a: any) => a.id ?? a.nodeId ?? a.containerId).filter(Boolean));
      health.filedAt = Date.now();
      broadcast({ type: 'round', chatId: params.chatId, summary: out.result.summary, alterations: out.result.alterations.length });
      broadcast({ type: 'map', ...state() });
      // M38: warm the focus node's relational description off the hot path so
      // the NEXT turn's composed context has a fresh one (lags ≤1 round).
      describeRelations(store, chat.focusContainerId).catch(() => {});
      // M68: heal any broken display names this round left behind.
      healTitles(5, roundPid).catch(() => {});
      // M41: fold this exchange into the focus node's chat memory (async).
      updateNodeMemory(store, chat.focusContainerId, params.userText, params.assistantText).catch(() => {});
      // M156: every node the ROUND touched gets deep too — one batched cheap
      // call over the filer's own relevance list (never "all lit nodes").
      const touchedIds = out.result.alterations
        .map((a: any) => a.id ?? a.nodeId)
        .filter((id: any) => id && id !== chat.focusContainerId);
      if (touchedIds.length) updateTouchedMemories(store, touchedIds, params.userText, params.assistantText).catch(() => {});
      // M166 (Jacob): the whole-map review runs itself once in a while —
      // every HARNESSMAP_AUTOTIDY_ROUNDS filed rounds (default 15) — and only
      // PROPOSES: findings land in the ⟳ to tidy folder as suggestions, never
      // applied without the user. Holds while suggestions are still pending
      // (no piling); fires on the next round after the user clears them.
      {
        const AUTOTIDY = Number(process.env.HARNESSMAP_AUTOTIDY_ROUNDS ?? 10);
        const AUTOTIDY_MS = Number(process.env.HARNESSMAP_AUTOTIDY_MINUTES ?? 30) * 60_000;
        const tk = `tidy_ct:${roundPid}`;
        const ta = `tidy_last_at:${roundPid}`;
        // M166b (Jacob): review every 10 rounds OR every 30 minutes of
        // activity, whichever comes first — slow-paced conversations get
        // tidying too. Checked at round completion (an idle map has nothing
        // new to review). A fresh map's first review still lands early
        // (round 5). Keeps running under influence-off (the switch means
        // "stay out of my conversations", not "stop maintaining yourself").
        const threshold = store.getSetting(`tidy_first:${roundPid}`) === '1' ? AUTOTIDY : Math.min(5, AUTOTIDY);
        const tct = Number(store.getSetting(tk) ?? 0) + 1;
        if (!store.getSetting(ta)) store.setSetting(ta, String(Date.now()));
        const overdue = Date.now() - Number(store.getSetting(ta)) >= AUTOTIDY_MS;
        if (AUTOTIDY > 0 && (tct >= threshold || overdue) && store.getOpenSuggestions(roundPid).length === 0) {
          store.setSetting(tk, '0');
          store.setSetting(ta, String(Date.now()));
          store.setSetting(`tidy_first:${roundPid}`, '1');
          store.audit('auto_mapcheck', { after: tct, overdue });
          checkMap(store, roundPid, chat.focusContainerId ?? null)
            .then(() => broadcast({ type: 'map', ...state() }))
            .catch(() => {});
        } else {
          store.setSetting(tk, String(AUTOTIDY > 0 ? Math.min(tct, threshold) : tct));
        }
      }
      // M48: relight notes auto-close once their node found a home.
      for (const sg of store.getOpenSuggestions(roundPid)) {
        if (sg.kind !== 'relight') continue;
        const n = store.getNode(sg.nodeId);
        const parent = n?.parentId ? store.getNode(n.parentId) : null;
        const inToSort = parent && (parent.title === 'to sort' || parent.content.startsWith('to sort'));
        if (n && n.status !== 'removed' && !inToSort) store.setSuggestionStatus(sg.id, 'done');
      }
      // M42: fold turns that scrolled out of the verbatim window into the
      // rolling summary (async, serialized in the module).
      const turns = store.getTurns(params.chatId);
      const maxIdx = turns.length ? turns[turns.length - 1].idx : -1;
      const removals = pendingRemovals; pendingRemovals = [];
      if (maxIdx - WINDOW >= 0) foldTurns(store, roundPid, params.chatId, maxIdx - WINDOW, removals);
    } else {
      // M179: name the failure when we can — an auth failure has a fix the
      // user can actually perform; "translator error" does not.
      const authy = lastCallError && Date.now() - lastCallError.at < 120_000
        && /invalid api key|please run \/login|not logged in|authentication|401/i.test(lastCallError.msg);
      broadcast({ type: 'translator_error', chatId: params.chatId,
        ...(authy ? { message: "the map's agents can't sign in — one-time fix: open a terminal, run `claude`, type /login and approve. Filing resumes on your next message." } : {}) });
    }
  });
}

// M48: focus can be orphaned by any removal path (tidy-apply had no rescue,
// unlike the delete endpoint). Validate cheaply on every state build: a dead
// focus falls back to the first live top-level node.
function ensureValidFocus() {
  const chat = store.getChat(mainChatId);
  if (!chat) return;
  const f = store.getNode(chat.focusContainerId);
  if (f && f.status !== 'removed') return;
  const fallback = store.getNodes(projectId).find((n) => n.parentId === null && n.status !== 'removed');
  if (fallback) {
    applyFocus(mainChatId, fallback.id);
    chats.noteMapChange(mainChatId, `the focused node was deleted — focus moved to: "${fallback.title || fallback.content}"`);
  }
}

function state() {
  ensureValidFocus();
  const map = loadMap(store, projectId);
  return {
    projectId,
    mainChatId,
    projects: store.listProjects(),
    home: (() => { const h = store.getSetting(`home:${projectId}`); return h && store.getNode(h)?.status !== 'removed' ? h : null; })(),
    influenceOff: influenceOff(projectId),
    updateAvailable: updateAvailable(),
    authBroken,
    feedbackEmail: process.env.HARNESSMAP_FEEDBACK_EMAIL ?? 'yuhinc@sas.upenn.edu',
    version: VERSION,
    storage: DB_PATH,
    machine: process.env.HARNESSMAP_MACHINE_LABEL ?? osHostname(), // M176: lets hooks refuse a tunneled foreign server (env = test seam)
    nodes: map.nodes.filter((n) => n.status !== 'removed'), // user-deleted stays out of the UI
    recency: recency(),
    chats: (() => {
      const pins = new Set<string>(JSON.parse(store.getSetting(`chatpins:${projectId}`) ?? '[]'));
      return store.getChats(projectId).filter((c) => c.status !== 'archived').map((c) => ({
        ...c, lit: store.getLit(c.id),
        lastActivity: ((store as any).db.prepare('SELECT MAX(created_at) t FROM turns WHERE chat_id = ?').get(c.id) as any)?.t ?? c.createdAt,
        pinned: pins.has(c.id),
        summary: (getConversationSummary(store, c.id) ?? '').slice(0, 200) || null,
      }));
    })(),
    suggestions: store.getOpenSuggestions(projectId),
    // M162: lit branches whose full statements did not fit this turn's budget
    // — the map shows a loud mark so a lit choice is never silently ignored.
    trimmedLit: (() => { try { return composeParts(store, mainChatId, []).trimmedLit; } catch { return []; } })(),
    nudges: { ...nudges, focusName: nudgeFocusTarget?.name ?? null },
    favorites: store.getFavorites(),
    health: { ...health, now: Date.now() },
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Auth gate — covers every route including the WS upgrade handshake.
    // Browsers replay the page's Basic credentials on same-origin WS handshakes,
    // so the socket is protected too.
    const user = authUser(req);
    if (!user) return unauthorized();

    if (path === '/ws' && srv.upgrade(req)) return undefined as any;
    // M97: terminal websocket — ?term=<id> attaches to a PTY session.
    const termWs = path === '/term' ? url.searchParams.get('id') : null;
    if (termWs && (srv as any).upgrade(req, { data: { term: termWs } })) return undefined as any;
    if (path.startsWith('/vendor/')) {
      const f = Bun.file(join(here, '..', 'public', 'vendor', path.slice('/vendor/'.length).replace(/[^\w.\-]/g, '')));
      return new Response(f);
    }
    if (path === '/' || path === '/index.html') {
      // M177b: the page must never be served stale from browser cache — a
      // user who just updated would otherwise keep seeing the old UI.
      return new Response(Bun.file(join(here, '..', 'public', 'index.html')), {
        headers: { 'cache-control': 'no-cache' },
      });
    }

    if (path === '/api/state' && req.method === 'GET') return json(state());

    // "+" — creates a node anywhere on the map, optionally moving the ONE
    // conversation's focus onto it.
    if (path === '/api/nodes' && req.method === 'POST') {
      const body = await req.json() as { content?: string; name?: string; parentId?: string; focus?: boolean };
      const id = randomUUID();
      // Blank content is allowed (Jacob: naming every new thing "seriously
      // sucks") — the translator auto-names "untitled" nodes once content lands.
      const content = (body.content ?? body.name)?.trim() || 'untitled';
      store.applyAlterations(projectId, [
        { op: 'create_node', id, parentId: body.parentId ?? null, content, status: 'live', author: 'user' },
      ], { kind: 'user_edit' });
      touch([id]);
      store.setLit(mainChatId, id, true); // M66: new nodes are born lit
      chats.noteMapChange(mainChatId, content === 'untitled'
        ? 'created a new node (unnamed — it will be named from the conversation)'
        : `created new node: "${content}"`);
      if (body.focus) {
        applyFocus(mainChatId, id);
        chats.noteMapChange(mainChatId, `moved FOCUS to: "${content}"`);
        appendMarker(content === 'untitled' ? 'focus moved to a new node' : `focus moved to "${content}"`);
      }
      broadcast({ type: 'map', ...state() });
      return json({ id, chatId: mainChatId, content, name: content });
    }

    const msgMatch = path.match(/^\/api\/chats\/([\w-]+)\/messages$/);
    if (msgMatch && req.method === 'POST') {
      const chatId = msgMatch[1];
      const { text } = await req.json() as { text: string };
      broadcast({ type: 'turn', chatId, role: 'user', content: text });
      // M139: stream each text block to the UI as the model produces it —
      // the reply builds up live instead of landing as one drop.
      chats.send(chatId, text, { onAssistantText: (t: string) => broadcast({ type: 'chat_delta', chatId, text: t }) })
        .then((r) => {
          broadcast({ type: 'turn', chatId, role: 'assistant', content: r.assistantText });
          enqueueTranslation({ chatId, turnId: r.userTurnId, userText: text, assistantText: r.assistantText });
        })
        .catch((err) => {
          console.error('[chat] turn failed:', err);
          const emsg = String(err);
          broadcast({ type: 'turn', chatId, role: 'system', content: /invalid api key|\/login|exited with code 1/i.test(emsg)
            ? `agent error: ${emsg.slice(0, 120)} — likely the Claude Code login: open a terminal, run \`claude\`, type /login and approve (one time), then send your message again.`
            : `agent error: ${emsg.slice(0, 200)}` });
        });
      return json({ ok: true }, 202);
    }

    const turnsMatch = path.match(/^\/api\/chats\/([\w-]+)\/turns$/);
    if (turnsMatch && req.method === 'GET') {
      // The chat screen shows only turns since the last clear (the full log
      // stays in the store untouched).
      let turns = store.getTurns(turnsMatch[1]);
      const lastClear = turns.map((t) => t.role === 'system' && t.content === ChatSessionManager.CLEAR_MARKER).lastIndexOf(true);
      if (lastClear >= 0) turns = turns.slice(lastClear);
      return json(turns);
    }

    // Clean the chat (Jacob, v0.4.1): the transcript resets visually and the
    // agent's rolling window restarts — but the map carries everything, so
    // nothing durable is lost. The full log remains in the store.
    const clearMatch = path.match(/^\/api\/chats\/([\w-]+)\/clear$/);
    if (clearMatch && req.method === 'POST') {
      // M42 (W2, Jacob): clean-chat is a VIEW function — memory survives.
      // The turns the clean cuts from the window fold into the summary first.
      const turns = store.getTurns(clearMatch[1]);
      const maxIdx = turns.length ? turns[turns.length - 1].idx : -1;
      if (maxIdx >= 0) foldTurns(store, projectId, clearMatch[1], maxIdx, pendingRemovals), pendingRemovals = [];
      store.appendTurn({ id: randomUUID(), chatId: clearMatch[1], role: 'system', content: ChatSessionManager.CLEAR_MARKER, raw: null });
      broadcast({ type: 'chat_cleared', chatId: clearMatch[1] });
      return json({ ok: true });
    }

    // Transparency (Jacob): the exact composed context the agent will receive
    // on the next turn — map state + recent window.
    const ctxMatch = path.match(/^\/api\/chats\/([\w-]+)\/context$/);
    if (ctxMatch && req.method === 'GET') return json({ context: chats.previewContext(ctxMatch[1]) });

    // Lit is hierarchical (v0.2, Jacob's #4): lighting a node lights every
    // descendant; darkening likewise.
    const litMatch = path.match(/^\/api\/chats\/([\w-]+)\/lit$/);
    if (litMatch && req.method === 'POST') {
      const body = await req.json() as { nodeId?: string; containerId?: string; on: boolean };
      const nodeId = (body.nodeId ?? body.containerId)!;
      const ids = [nodeId, ...descendantNodes(store, nodeId)];
      clearNudges();
      store.clearMark(nodeId);
      // M111: the focus path cannot be dimmed. Explicit attempt → refusal;
      // cascaded descendants on the path are skipped silently.
      const path = focusPathOf(litMatch[1]);
      if (!body.on && path.has(nodeId) && !(body as any).bulk) {
        return json({ error: 'this node is on the focus path — it stays lit while the conversation is aimed through it. Move the focus first if you really want it dark.' }, 409);
      }
      let kept = 0;
      for (const id of ids) {
        if (!body.on && path.has(id)) { kept++; continue; }
        store.setLit(litMatch[1], id, body.on);
      }
      const n = store.getNode(nodeId);
      chats.noteMapChange(litMatch[1], body.on
        ? `lit as background: "${nodeName(n)}"${ids.length > 1 ? ' (and everything under it)' : ''}`
        : `set aside (dimmed): "${nodeName(n)}"${ids.length > 1 ? ' and everything under it' : ''} — don't bring it up or draw on its earlier discussion unless the user does`);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, affected: ids.length });
    }

    // ---- M88: projects (each its own map) + chat creation (fork / fresh) ----
    if (path === '/api/projects' && req.method === 'GET') {
      return json({ projects: store.listProjects(), active: projectId });
    }
    if (path === '/api/projects' && req.method === 'POST') {
      const { name } = await req.json() as { name?: string };
      if (!name?.trim()) return json({ error: 'name required' }, 400);
      const pid = store.createProject(name.trim().slice(0, 60));
      const chatId = bootstrapProject(pid);
      setActive(pid, chatId);
      store.audit('project_created', { id: pid.slice(0, 8), name: name.trim().slice(0, 40) });
      return json({ ok: true, projectId: pid, chatId });
    }
    const projActMatch = path.match(/^\/api\/projects\/([\w-]+)\/activate$/);
    if (projActMatch && req.method === 'POST') {
      if (!store.listProjects().some((x) => x.id === projActMatch[1])) return json({ error: 'unknown project' }, 404);
      setActive(projActMatch[1]);
      return json({ ok: true, chatId: mainChatId });
    }
    if (path === '/api/chats' && req.method === 'POST') {
      const body = await req.json() as { mode?: 'fork' | 'fresh'; focusTopic?: string; focusNodeId?: string; fromChatId?: string };
      const mode = body.mode === 'fresh' ? 'fresh' : 'fork';
      const from = body.fromChatId && store.getChat(body.fromChatId)?.projectId === projectId ? body.fromChatId : mainChatId;
      const nodes = store.getNodes(projectId).filter((n) => n.status !== 'removed');
      const root = nodes.find((n) => n.parentId === null && !n.content.startsWith('to sort'));
      if (!root) return json({ error: 'empty project' }, 400);
      // One optional input, one rule: match an existing topic mechanically,
      // or create it (born lit + focused). Empty = the mode's default.
      let focusId: string | null = null;
      let created = false;
      const topic = body.focusTopic?.trim();
      // M92 (Jacob): the UI's picker sends an EXACT node — no re-matching.
      if (body.focusNodeId && store.getNode(body.focusNodeId)) focusId = body.focusNodeId;
      else if (topic) {
        const toks = new Set(topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
        let best: { id: string; score: number } | null = null;
        for (const n of nodes) {
          const tt = (n.title ?? '').toLowerCase();
          const ct = n.content.toLowerCase();
          let sc = 0;
          for (const w of toks) { if (tt.includes(w)) sc += 2; else if (ct.includes(w)) sc += 1; }
          if (`${tt} ${ct}`.includes(topic.toLowerCase())) sc += 3;
          if (sc > 0 && (!best || sc > best.score)) best = { id: n.id, score: sc };
        }
        if (best) focusId = best.id;
        else {
          focusId = randomUUID();
          store.applyAlterations(projectId, [{ op: 'create_node', id: focusId, parentId: root.id, content: topic, status: 'live', author: 'user' } as any], { kind: 'user_edit' });
          created = true;
        }
      }
      const chatId = randomUUID();
      store.createChat({ id: chatId, projectId, focusContainerId: focusId ?? (mode === 'fork' ? store.getChat(from)!.focusContainerId : root.id), sdkSessionId: null });
      if (mode === 'fork') store.copyLit(from, chatId);
      else store.setLit(chatId, root.id, true); // fresh: only the root glows
      if (focusId) for (const d of [focusId, ...descendantNodes(store, focusId)]) store.setLit(chatId, d, true);
      applyFocus(chatId, store.getChat(chatId)!.focusContainerId); // M111: path stays lit
      setActive(projectId, chatId);
      const fname = focusId ? nodeName(store.getNode(focusId)) : null;
      store.audit('chat_created', { mode, topic: topic?.slice(0, 40) ?? null, matched: focusId ? !created : null });
      return json({ ok: true, chatId, focusName: fname, createdTopic: created });
    }
    // ---- M90: merges — node into node, chat into chat, project into project.
    // M100 (Mark): universal node move — any node to any writable parent,
    // including parentId null = make it a top-level topic.
    const nMoveMatch = path.match(/^\/api\/nodes\/([\w-]+)\/move$/);
    if (nMoveMatch && req.method === 'POST') {
      const { parentId } = await req.json() as { parentId?: string | null };
      const n = store.getNode(nMoveMatch[1]);
      if (!n) return json({ error: 'unknown node' }, 404);
      const isToSort = (x: any) => x.parentId === null && (x.title === 'to sort' || x.content.startsWith('to sort'));
      if (isToSort(n)) return json({ error: '"to sort" cannot be moved' }, 400);
      let dst: any = null;
      if (parentId) {
        dst = store.getNode(parentId);
        if (!dst) return json({ error: 'unknown target' }, 404);
        if (dst.id === n.id || descendantNodes(store, n.id).includes(dst.id)) return json({ error: 'cannot move a node into its own subtree' }, 400);
      }
      store.clearMark(n.id);
      store.pushUndo(projectId, `moved "${nodeName(n)}"`, [
        { op: 'move_node', id: n.id, parentId: n.parentId },
        ...(/ \(arrived while focus was: [^)]*\)$/.test(n.content) ? [{ op: 'update_node', id: n.id, content: n.content }] : []),
      ], null);
      store.applyAlterations(projectId, [{ op: 'move_node', id: n.id, parentId: parentId ?? null } as any], { kind: 'user_edit' });
      // Moving out of to-sort by hand: strip the provenance note, like the filer does.
      const prov = / \(arrived while focus was: [^)]*\)$/;
      if (prov.test(n.content)) store.applyAlterations(projectId, [{ op: 'update_node', id: n.id, content: n.content.replace(prov, '') } as any], { kind: 'user_edit' });
      touch([n.id]);
      chats.noteMapChange(mainChatId, `moved "${nodeName(n)}" ${dst ? `under "${nodeName(dst)}"` : 'to the top level'}`);
      store.audit('node_moved', { id: n.id.slice(0, 8), to: parentId ? parentId.slice(0, 8) : 'top' });
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, undo: `moved "${nodeName(n)}"` });
    }
    const nMergeMatch = path.match(/^\/api\/nodes\/([\w-]+)\/merge$/);
    if (nMergeMatch && req.method === 'POST') {
      const { intoId } = await req.json() as { intoId?: string };
      const src = store.getNode(nMergeMatch[1]);
      const dst = intoId ? store.getNode(intoId) : undefined;
      if (!src || !dst) return json({ error: 'unknown node' }, 404);
      if (src.id === dst.id) return json({ error: 'cannot merge a node into itself' }, 400);
      const isToSort = (n: any) => n.parentId === null && (n.title === 'to sort' || n.content.startsWith('to sort'));
      if (isToSort(src) || isToSort(dst)) return json({ error: '"to sort" cannot be merged' }, 400);
      if (descendantNodes(store, src.id).includes(dst.id)) return json({ error: 'target is inside the merged node — pick a survivor outside it' }, 400);
      const kids = store.childrenOf(src.id).filter((k: any) => k.status !== 'removed');
      const alts: any[] = kids.map((k: any) => ({ op: 'move_node', id: k.id, parentId: dst.id }));
      // Capture-everything: if the source says something the survivor doesn't,
      // keep it as a child; true duplicates (high word overlap) just drop.
      const toks = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
      const a1 = toks(src.content), b1 = toks(`${dst.title ?? ''} ${dst.content}`);
      let overlap = 0; for (const w of a1) if (b1.has(w)) overlap++;
      const dup = a1.size === 0 || overlap / a1.size >= 0.5;
      // M94 (Jacob): merge the SUBSTANCE — survivor content absorbs the
      // source's distinct information and the chat memories combine (one
      // cheap call). Pure duplicates with no memories skip the call; a
      // failed call falls back to keeping the source's wording as a child.
      const srcMem = getNodeMemory(store, src.id) ?? '';
      const dstMem = getNodeMemory(store, dst.id) ?? '';
      let textMerged = false;
      let keptId: string | null = null;
      if (!dup || srcMem) {
        const m = await mergeNodeText(store, dst, src);
        if (m) {
          alts.push({ op: 'update_node', id: dst.id, content: m.content });
          if (m.memory) setNodeMemory(store, dst.id, m.memory);
          textMerged = true;
          store.audit('node_merge_text', { dst: dst.id.slice(0, 8), mem: Boolean(m.memory) });
        } else if (!dup) {
          keptId = randomUUID();
          alts.push({ op: 'create_node', id: keptId, parentId: dst.id, content: src.content, type: src.type ?? undefined, status: src.status, author: 'user' });
        } else if (srcMem && !dstMem) setNodeMemory(store, dst.id, srcMem);
      }
      clearNodeMemory(store, src.id);
      alts.push({ op: 'update_node', id: src.id, status: 'removed' });
      const mergeInverse = inverseOfAlterations(alts);
      const mergeMeta = { ...captureFocusLit([src.id]), memories: { [src.id]: srcMem || null, [dst.id]: dstMem || null } };
      store.applyAlterations(projectId, alts, { kind: 'user_edit' });
      store.pushUndo(projectId, `merged "${nodeName(src)}" into "${nodeName(dst)}"`, mergeInverse, mergeMeta);
      // Transfers: favorite, lighting per chat, focus rescue, open dots.
      if (store.getFavorites().includes(src.id)) { store.setFavorite(src.id, false); store.setFavorite(dst.id, true); }
      for (const c of store.getChats(projectId)) {
        const lit = store.getLit(c.id);
        if (lit.includes(src.id) && !lit.includes(dst.id)) store.setLit(c.id, dst.id, true);
        store.setLit(c.id, src.id, false);
        if (c.focusContainerId === src.id) applyFocus(c.id, dst.id);
      }
      for (const sg of store.getOpenSuggestions(projectId)) if (sg.nodeId === src.id) store.setSuggestionStatus(sg.id, 'done');
      touch([dst.id]);
      chats.noteMapChange(mainChatId, `merged "${nodeName(src)}" into "${nodeName(dst)}"${kids.length ? ` (${kids.length} child node(s) moved over)` : ''}`);
      pendingRemovals.push(src.content);
      store.audit('node_merged', { src: src.id.slice(0, 8), dst: dst.id.slice(0, 8), kids: kids.length, kept: Boolean(keptId) });
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, moved: kids.length, keptContent: Boolean(keptId), textMerged, undo: `merged "${nodeName(src)}" into "${nodeName(dst)}"` });
    }
    const pMergeMatch = path.match(/^\/api\/projects\/([\w-]+)\/merge$/);
    if (pMergeMatch && req.method === 'POST') {
      const { intoId } = await req.json() as { intoId?: string };
      const srcProj = store.listProjects().find((x) => x.id === pMergeMatch[1]);
      const dstProj = intoId ? store.listProjects().find((x) => x.id === intoId) : undefined;
      if (!srcProj || !dstProj) return json({ error: 'unknown project' }, 404);
      if (srcProj.id === dstProj.id) return json({ error: 'cannot merge a project into itself' }, 400);
      const isToSort = (n: any) => n.parentId === null && (n.title === 'to sort' || n.content.startsWith('to sort'));
      const srcTops = store.getNodes(srcProj.id).filter((n) => n.parentId === null && n.status !== 'removed');
      const srcToSort = srcTops.find(isToSort);
      const srcTopics = srcTops.filter((n) => !isToSort(n));
      // Event-sourced absorb: source's whole history joins the target's log,
      // then ordinary appended alterations do the reparenting.
      store.absorbProject(srcProj.id, dstProj.id);
      const wrapperId = randomUUID();
      const alts: any[] = [{ op: 'create_node', id: wrapperId, parentId: null, content: srcProj.name, status: 'live', author: 'user' }];
      for (const t of srcTopics) alts.push({ op: 'move_node', id: t.id, parentId: wrapperId });
      if (srcToSort) {
        const strays = store.childrenOf(srcToSort.id).filter((k: any) => k.status !== 'removed');
        let dstToSort = store.getNodes(dstProj.id).find(isToSort);
        let dstToSortId = dstToSort?.id;
        if (!dstToSortId && strays.length) {
          dstToSortId = randomUUID();
          alts.push({ op: 'create_node', id: dstToSortId, parentId: null, content: 'to sort', status: 'live', author: 'agent' });
        }
        for (const k of strays) alts.push({ op: 'move_node', id: k.id, parentId: dstToSortId! });
        alts.push({ op: 'update_node', id: srcToSort.id, status: 'removed' });
      }
      store.applyAlterations(dstProj.id, alts, { kind: 'user_edit' });
      if (projectId === srcProj.id || projectId === dstProj.id) setActive(dstProj.id);
      store.audit('project_merged', { src: srcProj.name.slice(0, 40), dst: dstProj.name.slice(0, 40), topics: srcTopics.length });
      broadcast({ type: 'map', ...state() });
      scheduleMapFile();
      return json({ ok: true, wrapper: wrapperId, topics: srcTopics.length });
    }

    const chatArchMatch = path.match(/^\/api\/chats\/([\w-]+)\/archive$/);
    if (chatArchMatch && req.method === 'POST') {
      const c = store.getChat(chatArchMatch[1]);
      if (!c) return json({ error: 'unknown session' }, 404);
      const live = store.getChats(c.projectId).filter((x) => x.status !== 'archived');
      if (live.length <= 1) return json({ error: 'this is the only session — create another before closing it' }, 400);
      store.archiveChat(c.id);
      if (mainChatId === c.id) {
        const next = live.filter((x) => x.id !== c.id).pop()!;
        setActive(c.projectId, next.id);
      } else broadcast({ type: 'map', ...state() });
      store.audit('chat_archived', { id: c.id.slice(0, 8) });
      return json({ ok: true });
    }
    // M146 (Mark, user suggestion): pin sessions — pinned ride first in the
    // tab bar; the sessions overview panel is the window onto per-session
    // bookkeeping the map already keeps (focus = topic, rolling summary).
    const chatPinMatch = path.match(/^\/api\/chats\/([\w-]+)\/pin$/);
    if (chatPinMatch && req.method === 'POST') {
      const c = store.getChat(chatPinMatch[1]);
      if (!c || c.projectId !== projectId) return json({ error: 'unknown chat' }, 404);
      const key = `chatpins:${projectId}`;
      const pins = new Set<string>(JSON.parse(store.getSetting(key) ?? '[]'));
      const on = !pins.has(c.id);
      if (on) pins.add(c.id); else pins.delete(c.id);
      store.setSetting(key, JSON.stringify([...pins]));
      store.audit('chat_pin', { chat: c.id.slice(0, 8), on });
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, pinned: on });
    }
    const chatActMatch = path.match(/^\/api\/chats\/([\w-]+)\/activate$/);
    if (chatActMatch && req.method === 'POST') {
      const c = store.getChat(chatActMatch[1]);
      if (!c) return json({ error: 'unknown chat' }, 404);
      setActive(c.projectId, c.id);
      return json({ ok: true });
    }

    // Focus change (v0.2: focus ≠ lit — focus re-aims the chat).
    const focusMatch = path.match(/^\/api\/chats\/([\w-]+)\/focus$/);
    if (focusMatch && req.method === 'POST') {
      const body = await req.json() as { nodeId?: string; containerId?: string };
      const nodeId = (body.nodeId ?? body.containerId)!;
      const n = store.getNode(nodeId);
      if (!n) return json({ error: 'unknown node' }, 404);
      clearNudges();
      store.clearMark(nodeId);
      applyFocus(focusMatch[1], nodeId);
      chats.noteMapChange(focusMatch[1], `moved FOCUS to: "${nodeName(n)}"`);
      appendMarker(`focus moved to "${nodeName(n)}"`); // durable transcript marker
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, name: nodeName(n) });
    }

    // M105 (Jacob, supersedes Z2): ZOOM IS VIEW-ONLY — it never touches
    // lighting. "Dim all outside" is its own explicit action below.
    const zoomMatch = path.match(/^\/api\/chats\/([\w-]+)\/zoomin$/);
    if (zoomMatch && req.method === 'POST') {
      const chatId = zoomMatch[1];
      const body = await req.json() as { nodeId?: string; containerId?: string; focus?: boolean };
      const nodeId = (body.nodeId ?? body.containerId)!;
      const n = store.getNode(nodeId);
      if (!n) return json({ error: 'unknown node' }, 404);
      if (body.focus) {
        clearNudges();
        applyFocus(chatId, nodeId);
        chats.noteMapChange(chatId, `moved FOCUS to: "${nodeName(n)}" (zoomed the view in)`);
        appendMarker(`zoomed into "${nodeName(n)}" — focus moved here`);
      } else {
        chats.noteMapChange(chatId, `zoomed the view into "${nodeName(n)}" (lighting unchanged)`);
      }
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, name: nodeName(n) });
    }
    // The lighting half of the old zoom, now an explicit user choice.
    const dimOutMatch = path.match(/^\/api\/chats\/([\w-]+)\/dim-outside$/);
    if (dimOutMatch && req.method === 'POST') {
      const chatId = dimOutMatch[1];
      const { nodeId } = await req.json() as { nodeId?: string };
      const n = nodeId ? store.getNode(nodeId) : undefined;
      if (!n) return json({ error: 'unknown node' }, 404);
      const inScope = new Set([n.id, ...descendantNodes(store, n.id)]);
      const path0 = focusPathOf(chatId);
      const dimmed = store.getLit(chatId).filter((id) => !inScope.has(id) && !path0.has(id));
      clearNudges();
      for (const id of dimmed) store.setLit(chatId, id, false);
      if (dimmed.length) chats.noteMapChange(chatId, `dimmed everything outside "${nodeName(n)}" (${dimmed.length} node(s); the focus path stayed lit)`);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, dimmed: dimmed.length });
    }

    // Auto-focus / auto-zoom (v0.3.1): recommendation only — the client
    // confirms with the user before applying anything.
    const recMatch = path.match(/^\/api\/chats\/([\w-]+)\/recommend$/);
    if (recMatch && req.method === 'POST') {
      const { kind, feedback, priorSummary } = await req.json() as { kind: 'focus' | 'zoom'; feedback?: string; priorSummary?: string };
      if (kind !== 'focus' && kind !== 'zoom') return json({ error: 'kind must be focus|zoom' }, 400);
      // M75: an explicit ask already named the target — serve it for free
      // (unless the user is revising: feedback always goes to the specialist).
      if (kind === 'focus' && nudgeFocusTarget && !feedback) {
        const fn = store.getNode(nudgeFocusTarget.id);
        if (fn && fn.status !== 'removed') {
          return json({ containerId: fn.id, name: nodeName(fn), reason: 'you asked in chat to focus on this' });
        }
      }
      const r = await proposeTopicRec(store, projectId, recMatch[1], kind, feedback, priorSummary);
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }

    // Auto-lit (v0.3, Jacob's Z2): the model recommends AND applies background
    // lighting for the current focus.
    const autolitMatch = path.match(/^\/api\/chats\/([\w-]+)\/autolit$/);
    if (autolitMatch && req.method === 'POST') {
      const chatId = autolitMatch[1];
      const chat = store.getChats(projectId).find((x) => x.id === chatId);
      if (!chat) return json({ error: 'unknown chat' }, 404);
      // M80 (Jacob): auto-light is propose→accept, like tidy. preview:true
      // returns the specialist's plan; the client applies the EXACT previewed
      // lists via apply (no recompute between preview and accept).
      const body = await req.json().catch(() => ({})) as { preview?: boolean; apply?: { lit: string[]; dim: string[] }; summary?: string; feedback?: string; priorSummary?: string };
      if (body.apply) {
        const { lit = [], dim = [] } = body.apply;
        clearNudges();
        const pathA = focusPathOf(chatId);
        for (const id of lit) for (const d of [id, ...descendantNodes(store, id)]) store.setLit(chatId, d, true);
        for (const id of dim) for (const d of [id, ...descendantNodes(store, id)]) { if (!pathA.has(d)) store.setLit(chatId, d, false); }
        if (lit.length + dim.length > 0) chats.noteMapChange(chatId, `background lighting auto-adjusted: ${body.summary ?? ''}`);
        broadcast({ type: 'map', ...state() });
        return json({ ok: true, lit: lit.length, dim: dim.length });
      }
      const r = await proposeAutolit(store, projectId, chat.focusContainerId, store.getLit(chatId), body.feedback, body.priorSummary);
      if ('error' in r) return json({ error: r.error }, 502);
      const name = (id: string) => nodeName(store.getNode(id));
      return json({ ok: true, preview: true, summary: r.summary,
        lit: r.lit.map((id) => ({ id, name: name(id) })), dim: r.dim.map((id) => ({ id, name: name(id) })) });
    }

    // Direct user edit of ONE node — a first-class map event (source:
    // user_edit). status 'removed' = delete this node only (live children pop
    // up to its parent). Content edits and retyping allowed.
    const nodeEditMatch = path.match(/^\/api\/nodes\/([\w-]+)$/);
    if (nodeEditMatch && req.method === 'POST') {
      const id = nodeEditMatch[1];
      const patch = await req.json() as { status?: string; content?: string; type?: string; title?: string; chatId?: string };
      const before = store.getNode(id);
      if (!before) return json({ error: 'unknown node' }, 404);
      // M51: "to sort" is a system node — its name/description are fixed.
      const isToSortRoot = before.parentId === null && (before.title === 'to sort' || before.content.startsWith('to sort'));
      if (isToSortRoot && (patch.content !== undefined || patch.title !== undefined || patch.type !== undefined)) {
        return json({ error: '"to sort" is a system folder — its name can\'t be edited' }, 400);
      }
      store.clearMark(id);
      store.applyAlterations(projectId, [
        // An explicit title wins; a content edit without one clears the stale
        // label so the translator re-titles from the new meaning next round.
        { op: 'update_node', id, status: patch.status, content: patch.content, type: patch.type,
          ...(patch.title !== undefined ? { title: patch.title }
            : patch.content !== undefined ? { title: '' } : {}) } as any,
      ], { kind: 'user_edit' });
      touch([id]);
      if (patch.chatId) {
        const label = (patch.content ?? before.content).slice(0, 70);
        const what = patch.status === 'removed'
          ? `REMOVED from the map (drop from consideration): "${label}"`
          : patch.type ? `recategorized "${label}" as ${patch.type}`
          : patch.content ? `edited node to: "${label}"`
          : `set "${label}" → ${patch.status}`;
        chats.noteMapChange(patch.chatId, what);
        if (patch.status === 'removed') pendingRemovals.push(label);
      }
      // TD trim: damage advice v0 = show inbound links, no LLM triage.
      const inbound = store.getLinksTo(id);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, inboundLinks: inbound });
    }

    // Subtree delete (v0.3.7, Jacob): remove the node AND everything under
    // it. Deepest-first so the safety cascade doesn't pop children back out.
    const delMatch = path.match(/^\/api\/nodes\/([\w-]+)\/delete$/);
    if (delMatch && req.method === 'POST') {
      const id = delMatch[1];
      const n = store.getNode(id);
      if (!n) return json({ error: 'unknown node' }, 404);
      if (n.parentId === null && ((n.title ?? n.content) ?? '').startsWith('to sort'))
        return json({ error: '"to sort" is a system node — it always stays on the map (its children can be deleted or moved out)' }, 409);
      const subtree = [...descendantNodes(store, id).reverse(), id]; // children before parent
      const undoInverse = subtree.map((nid) => { const x = store.getNode(nid)!; return { op: 'update_node', id: nid, status: x.status }; });
      const undoMeta = captureFocusLit(subtree);
      store.applyAlterations(projectId, subtree.map((nid) => ({ op: 'update_node', id: nid, status: 'removed' } as any)), { kind: 'user_edit' });
      store.pushUndo(projectId, `deleted "${nodeName(n)}"${subtree.length > 1 ? ` and ${subtree.length - 1} node(s) inside` : ''}`, undoInverse, undoMeta);
      // M123 (Jacob): EVERY chat focused inside the deleted subtree is
      // rescued (previously only the active one — other sessions were left
      // aimed at a removed node).
      const fallback = n.parentId ?? store.getNodes(projectId).find((x) => x.parentId === null && x.status !== 'removed')?.id;
      for (const c of store.getChats(projectId)) {
        for (const nid of subtree) store.setLit(c.id, nid, false);
        if (subtree.includes(c.focusContainerId) && fallback) applyFocus(c.id, fallback);
      }
      chats.noteMapChange(mainChatId, `deleted the node "${nodeName(n)}" and everything under it — drop all of it from consideration`);
      pendingRemovals.push(n.content);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, removed: subtree.length, undo: `deleted "${nodeName(n)}"${subtree.length > 1 ? ` and ${subtree.length - 1} node(s) inside` : ''}` });
    }

    // v0.2 reorganize (a)+(i): propose → preview → user applies or cancels.
    if (path === '/api/reorganize/preview' && req.method === 'POST') {
      const body = await req.json() as { nodeId?: string; containerId?: string; hint?: string; feedback?: string; priorSummary?: string; suggestionId?: string };
      // M71: dot-initiated previews serve the precomputed proposal instantly
      // when the subtree hasn't changed since compute (feedback loops always
      // compute live — they carry new user direction).
      // M124/M137 fix: a reviewer flag on [__top__] routes to ROOT scope here
      // too — it is not a node id (previewing it returned an instant 404).
      const tidRaw = body.nodeId ?? body.containerId;
      const tidReq = tidRaw === '__top__' ? undefined : tidRaw;
      if (body.suggestionId && !body.feedback && tidReq) {
        const cached = store.getSuggestionProposal(body.suggestionId);
        const tid = tidReq;
        if (cached.proposal && cached.hash === subtreeHash(projectId, tid, body.hint)) {
          store.audit('proposal_cache_hit', { suggestion: body.suggestionId.slice(0, 8) });
          return json({ ...JSON.parse(cached.proposal), cached: true });
        }
      }
      const proposal = await proposeReorganize(store, projectId, tidReq ?? null, body.hint, body.feedback, body.priorSummary);
      // M86: a click-side live compute refreshes the dot's cache for FREE —
      // the user already paid for it; the next click is instant again.
      if (body.suggestionId && !body.feedback && proposal && !('error' in proposal) && tidReq) {
        store.setSuggestionProposal(body.suggestionId, JSON.stringify(proposal), subtreeHash(projectId, tidReq, body.hint));
        store.audit('proposal_cache_refresh', { suggestion: body.suggestionId.slice(0, 8) });
      }
      if (!proposal) return json({ error: 'unknown node' }, 404);
      if ('error' in proposal) return json({ error: proposal.error }, 502);
      return json(proposal);
    }
    if (path === '/api/reorganize/apply' && req.method === 'POST') {
      const { alterations, chatId, containerName, suggestionId } = await req.json() as { alterations: any[]; chatId?: string; containerName?: string; suggestionId?: string };
      const tidyInverse = inverseOfAlterations(alterations);
      const tidyMeta = captureFocusLit(alterations.map((a: any) => a.id).filter(Boolean));
      store.applyAlterations(projectId, alterations, { kind: 'reorganize' });
      store.pushUndo(projectId, `tidy on "${containerName ?? 'the map'}" (${alterations.length} change(s))`, tidyInverse, tidyMeta);
      lightNewNodes(alterations, mainChatId);
      touch(alterations.map((a: any) => a.id ?? a.nodeId ?? a.containerId).filter(Boolean));
      // M122: a root-scope tidy can insert a container ABOVE the focus path —
      // re-run applyFocus so the ancestor chain stays lit (M111 invariant).
      // M123: and EVERY chat whose focus a tidy deletion removed is rescued
      // to the removed node's parent (or a surviving top-level node).
      for (const c of store.getChats(projectId)) {
        const f = c.focusContainerId ? store.getNode(c.focusContainerId) : undefined;
        if (f && f.status !== 'removed') { if (c.id === (chatId ?? mainChatId)) applyFocus(c.id, f.id); continue; }
        const fb = (f?.parentId && store.getNode(f.parentId)?.status !== 'removed' ? f.parentId : undefined)
          ?? store.getNodes(projectId).find((x) => x.parentId === null && x.status !== 'removed')?.id;
        if (fb) applyFocus(c.id, fb);
      }
      if (suggestionId) store.setSuggestionStatus(suggestionId, 'done');
      if (chatId) chats.noteMapChange(chatId, `reorganized the "${containerName ?? 'selected'}" subtree (${alterations.length} change(s))`);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, undo: `tidy on "${containerName ?? 'the map'}" (${alterations.length} change(s))` });
    }

    // On-demand map check (Jacob): review the whole map now; file red dots
    // for anything that needs restructuring, or report a clean bill.
    // M77 (Jacob): direct line to the map agent — advisory, never edits.
    if (path === '/api/map-chat' && req.method === 'POST') {
      const body = await req.json() as { question?: string; history?: { q: string; a: string }[] };
      if (!body.question?.trim()) return json({ error: 'empty question' }, 400);
      const r = await answerMapQuestion(store, projectId, mainChatId, body.question, body.history ?? []);
      if ('error' in r) return json({ error: r.error }, 502);
      store.audit('mapchat', { q: body.question.slice(0, 80) });
      return json(r);
    }

    // M97 (Mark): embedded Claude Code session tabs.
    if (path === '/api/term' && req.method === 'GET') {
      return json({ terms: listTerms().map((t) => ({ ...t, chatId: (getTerm(t.id) as any)?.chatId ?? null })), backend: ptyBackend });
    }
    if (path === '/api/term' && req.method === 'POST') {
      const body = await req.json() as { cwd?: string; cols?: number; rows?: number; chatId?: string };
      const cwd = body.cwd?.trim();
      if (!cwd || !cwd.startsWith('/')) return json({ error: 'absolute cwd required' }, 400);
      if (body.chatId && !store.getChat(body.chatId)) return json({ error: 'unknown session' }, 404);
      const id = randomUUID();
      const t = createTerm(id, cwd, body.cols, body.rows);
      if ('error' in t) return json({ error: t.error }, 400);
      if (body.chatId) {
        (t as any).chatId = body.chatId;
        const q = pendingChatClaims.get(cwd) ?? [];
        q.push(body.chatId);
        pendingChatClaims.set(cwd, q);
      }
      // Follow mode: if this directory is already bound to a map, show it.
      const pid = store.projectForCwd(cwd);
      if (pid && pid !== projectId) setActive(pid);
      store.audit('term_created', { cwd: cwd.slice(-50), backend: ptyBackend, view: body.chatId?.slice(0, 8) ?? null });
      return json({ ok: true, id, backend: ptyBackend });
    }
    const termKillMatch = path.match(/^\/api\/term\/([\w-]+)$/);
    if (termKillMatch && req.method === 'DELETE') {
      return json({ ok: killTerm(termKillMatch[1]) });
    }
    // The map's bound directories (for the new-tab picker).
    if (path === '/api/dirs' && req.method === 'GET') {
      return json({ dirs: store.cwdsForProject(projectId) });
    }

    // M142: IMPORT — sources live on this machine only; reading is tightly
    // scoped (bound project folders for documents, this project's own Claude
    // Code transcript dir for sessions). The proposal applies through the
    // normal reorganize pipeline (guards + undo).
    if (path === '/api/import/sources' && req.method === 'GET') {
      const dirs = store.cwdsForProject(projectId);
      const files: any[] = [];
      for (const d of dirs) {
        for (const cand of ['CLAUDE.md', 'README.md', 'readme.md', 'NOTES.md', 'TODO.md']) {
          const fp = join(d, cand);
          try { const st = statSync(fp); if (st.isFile() && st.size < 512_000) files.push({ path: fp, name: cand, dir: d, sizeKB: Math.round(st.size / 1024) }); } catch {}
        }
        try {
          for (const f of readdirSync(join(d, 'docs'))) {
            if (!f.endsWith('.md') || files.length > 20) continue;
            const fp = join(d, 'docs', f);
            try { const st = statSync(fp); if (st.isFile() && st.size < 512_000) files.push({ path: fp, name: `docs/${f}`, dir: d, sizeKB: Math.round(st.size / 1024) }); } catch {}
          }
        } catch {}
      }
      // M157 (Jacob): "directly importing memory from user's claude" —
      // Claude Code keeps per-project auto-memory (MEMORY.md + notes) on
      // disk; surface it as a first-class source.
      const memories: any[] = [];
      for (const d of dirs) {
        const mdir = join(homedir(), '.claude', 'projects', d.replace(/\//g, '-'), 'memory');
        try {
          for (const f of readdirSync(mdir)) {
            if (!f.endsWith('.md')) continue;
            const fp = join(mdir, f);
            try { const st = statSync(fp); if (st.isFile() && st.size < 512_000) memories.push({ file: f, dir: mdir, sizeKB: Math.round(st.size / 1024) }); } catch {}
          }
        } catch {}
      }
      const sessions: any[] = [];
      for (const d of dirs) {
        const slug = d.replace(/\//g, '-');
        const tdir = join(homedir(), '.claude', 'projects', slug);
        try {
          for (const f of readdirSync(tdir)) {
            if (!f.endsWith('.jsonl')) continue;
            const fp = join(tdir, f);
            try { const st = statSync(fp); sessions.push({ file: f, dir: tdir, sizeKB: Math.round(st.size / 1024), mtime: st.mtime.toISOString() }); } catch {}
          }
        } catch {}
      }
      sessions.sort((a, b) => b.mtime.localeCompare(a.mtime));
      return json({ files: files.slice(0, 20), sessions: sessions.slice(0, 15), memories: memories.slice(0, 20) });
    }
    if (path === '/api/import/preview' && req.method === 'POST') {
      const b = await req.json() as { kind?: string; text?: string; path?: string; sessionFile?: string; feedback?: string; priorSummary?: string };
      let text = '', label = '';
      if (b.kind === 'text') { text = (b.text ?? '').trim(); label = 'pasted notes'; }
      else if (b.kind === 'file' && b.path) {
        const dirs = store.cwdsForProject(projectId);
        if (!dirs.some((d) => b.path!.startsWith(d + '/')) || !/\.(md|txt)$/i.test(b.path)) return json({ error: 'file outside the project folders' }, 400);
        try { text = readFileSync(b.path, 'utf8'); } catch { return json({ error: 'could not read the file' }, 400); }
        label = `document: ${basename(b.path)}`;
      } else if (b.kind === 'memory' && b.sessionFile) {
        const base = basename(b.sessionFile);
        for (const d of store.cwdsForProject(projectId)) {
          try { text = readFileSync(join(homedir(), '.claude', 'projects', d.replace(/\//g, '-'), 'memory', base), 'utf8'); break; } catch {}
        }
        if (!text) return json({ error: 'memory file not found for this project' }, 400);
        label = `Claude's memory: ${base}`;
      } else if (b.kind === 'session' && b.sessionFile) {
        const dirs = store.cwdsForProject(projectId);
        const base = basename(b.sessionFile);
        let raw = '';
        for (const d of dirs) {
          try { raw = readFileSync(join(homedir(), '.claude', 'projects', d.replace(/\//g, '-'), base), 'utf8'); break; } catch {}
        }
        if (!raw) return json({ error: 'session transcript not found for this project' }, 400);
        text = extractTranscript(raw);
        label = `past session: ${base.slice(0, 12)}…`;
      }
      if (!text || text.length < 20) return json({ error: 'nothing to import — the source is empty' }, 400);
      const p = await proposeImport(store, projectId, label, text, b.feedback, b.priorSummary);
      if ('error' in p) return json({ error: p.error }, 502);
      const preview = store.previewAlterations(projectId, p.alterations, () => p.rootId ? renderSubtreeFull(store, p.rootId) : '');
      store.audit('import_preview', { label: label.slice(0, 40), nodes: p.alterations.length, chars: text.length });
      return json({ summary: p.summary, alterations: p.alterations, rootId: p.rootId, preview, label, chars: text.length });
    }

    // M136: undo — pop the latest destructive action and apply its inverse.
    if (path === '/api/undo' && req.method === 'POST') {
      const entry = store.popUndo(projectId);
      if (!entry) return json({ error: 'nothing to undo' }, 404);
      applyUndo(entry);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, label: entry.label });
    }
    if (path === '/api/undo/list' && req.method === 'GET') {
      return json({ entries: store.listUndo(projectId) });
    }

    // M143: influence switch
    if (path === '/api/influence' && req.method === 'GET') {
      return json({ off: influenceOff(projectId) });
    }
    if (path === '/api/influence/toggle' && req.method === 'POST') {
      const next = influenceOff(projectId) ? '' : '1';
      store.setSetting(`influence_off:${projectId}`, next);
      if (!next) silenceNoticeSent.clear(); // reopened: sessions may be re-anchored and re-informed
      store.audit('influence_toggle', { off: next === '1' });
      broadcast({ type: 'map', ...state() });
      return json({ off: next === '1' });
    }

    // M125 (Jacob): home page — one node per map the ⌂ button zooms to.
    if (path === '/api/home' && req.method === 'POST') {
      const b = await req.json() as { nodeId?: string | null };
      if (b.nodeId === null || b.nodeId === undefined || b.nodeId === '') {
        store.setSetting(`home:${projectId}`, '');
        store.audit('home_cleared', {});
      } else {
        const n = store.getNode(b.nodeId);
        if (!n || n.status === 'removed') return json({ error: 'unknown node' }, 404);
        store.setSetting(`home:${projectId}`, n.id);
        store.audit('home_set', { node: n.id.slice(0, 8) });
      }
      broadcast({ type: 'map', ...state() });
      return json({ ok: true });
    }

    // M124: per-project map preferences — governed memory every specialist
    // receives via the system card. User-editable; the map guide may propose
    // additions (approved in the UI, which appends here).
    if (path === '/api/prefs' && req.method === 'GET') {
      return json({ text: store.getSetting(`prefs:${projectId}`) ?? '' });
    }
    if (path === '/api/prefs' && req.method === 'POST') {
      const b = await req.json() as { text?: string; append?: string };
      let text = b.text ?? store.getSetting(`prefs:${projectId}`) ?? '';
      if (b.append?.trim()) text = (text ? text.replace(/\n*$/, '') + '\n' : '') + '- ' + b.append.trim();
      text = text.slice(0, 1200);
      store.setSetting(`prefs:${projectId}`, text);
      store.audit('prefs_updated', { chars: text.length, appended: Boolean(b.append) });
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, text });
    }

    // M162: user-facing agent view — what one turn's injection is made of.
    if (path === '/api/agent-view' && req.method === 'GET') {
      const { text, trimmedLit, sections, budget } = composeParts(store, mainChatId, []);
      return json({ sections, trimmedLit, budget, total: text.length, text });
    }

    // M180: in-chat login flow.
    if (path === '/api/auth-login/start' && req.method === 'POST') {
      loginFlow?.pty.kill();
      const argv = process.env.HARNESSMAP_SETUPTOKEN_CMD?.split(' ') ?? ['claude', 'setup-token'];
      const pty = spawnLoginPty(argv, loginWatch);
      if ('error' in pty) return json({ error: pty.error }, 500);
      loginFlow = { pty, out: '', url: null, token: null };
      for (let i = 0; i < 60 && !loginFlow.url && !loginFlow.token; i++) await new Promise((r) => setTimeout(r, 250));
      return json({ url: loginFlow.url, done: !!loginFlow.token });
    }
    if (path === '/api/auth-login/code' && req.method === 'POST') {
      if (!loginFlow) return json({ error: 'no login in progress' }, 400);
      const { code } = (await req.json()) as { code: string };
      loginFlow.pty.write(code.trim() + '\r');
      for (let i = 0; i < 80 && !loginFlow.token; i++) await new Promise((r) => setTimeout(r, 250));
      const ok = !!loginFlow.token;
      if (ok) { loginFlow.pty.kill(); loginFlow = null; }
      return json({ ok });
    }

    // M179b: banner "check again" — re-probe on demand.
    if (path === '/api/auth-probe' && req.method === 'POST') {
      store.setSetting('auth_ok', '');
      const r = await probeAuth();
      broadcast({ type: 'map', ...state() });
      return json({ authBroken: r });
    }

    // M161: menu-triggered update check.
    if (path === '/api/update-check' && req.method === 'POST') {
      await checkLatest(true);
      return json({ current: VERSION, latest: latestKnown, updateAvailable: updateAvailable() });
    }

    // M159b: feedback log — local record of what the user chose to report.
    if (path === '/api/feedback' && req.method === 'POST') {
      const b = await req.json() as { text?: string; source?: string };
      if (!b.text?.trim()) return json({ error: 'empty' }, 400);
      store.addFeedback(b.text.trim(), (b.source ?? 'guide').slice(0, 30));
      store.audit('feedback_recorded', { source: b.source ?? 'guide' });
      return json({ ok: true });
    }
    if (path === '/api/feedback' && req.method === 'GET') {
      return json({ entries: store.listFeedback() });
    }

    // M113: dev mode — toggle + traces.
    if (path === '/api/dev' && req.method === 'GET') {
      return json({ on: store.getSetting('dev_mode') === '1' });
    }
    // dev/test seam: poke a settings key (localhost-only server; used by suites).
    if (path === '/api/dev/setting' && req.method === 'POST') {
      const b2 = (await req.json()) as { key: string; value: string };
      store.setSetting(b2.key, b2.value);
      if (b2.key === 'latest_ver') latestKnown = b2.value || null;
      return json({ ok: true });
    }
    if (path === '/api/dev/toggle' && req.method === 'POST') {
      const on = store.getSetting('dev_mode') === '1' ? '0' : '1';
      store.setSetting('dev_mode', on);
      store.audit('dev_mode', { on: on === '1' });
      return json({ on: on === '1' });
    }
    if (path === '/api/dev/traces' && req.method === 'GET') {
      const lim = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
      return json({ traces: store.getTraces(lim, url.searchParams.get('task') ?? undefined) });
    }

    // M107: mark clearing — per node on interaction, and clear-all.
    const seenMatch = path.match(/^\/api\/nodes\/([\w-]+)\/seen$/);
    if (seenMatch && req.method === 'POST') {
      store.clearMark(seenMatch[1]);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true });
    }
    if (path === '/api/changes/clear-marks' && req.method === 'POST') {
      const n = store.clearAllMarks(projectId);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, cleared: n });
    }

    // M106 (Jacob): "the user needs to clearly know what changed in the last
    // update" — the latest round's alterations, decorated with names, for the
    // what-changed panel.
    if (path === '/api/changes/latest' && req.method === 'GET') {
      const r = (store as any).db.prepare(
        `SELECT r.summary, r.alterations, r.created_at FROM rounds r
         JOIN chats c ON r.chat_id = c.id WHERE c.project_id = ?
         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`).get(projectId) as any;
      if (!r) return json({ summary: null, changes: [] });
      const name = (id: string) => { const n = store.getNode(id); return n ? (n.title || n.content.slice(0, 60)) : null; };
      const changes: any[] = [];
      for (const a of JSON.parse(r.alterations) as any[]) {
        if (a.op === 'create_node') {
          changes.push({ kind: 'added', nodeId: a.id, name: name(a.id) ?? String(a.content ?? '').slice(0, 60), under: a.parentId ? name(a.parentId) : null });
        } else if (a.op === 'update_node') {
          const what = [a.content !== undefined ? 'description' : null, a.status !== undefined ? `status → ${a.status}` : null, a.title !== undefined ? 'name' : null, a.type !== undefined ? `category → ${a.type}` : null].filter(Boolean).join(', ');
          changes.push({ kind: a.status === 'removed' ? 'removed' : 'updated', nodeId: a.id, name: name(a.id), what: what || 'edited' });
        } else if (a.op === 'move_node') {
          changes.push({ kind: 'moved', nodeId: a.id, name: name(a.id), under: a.parentId ? name(a.parentId) : 'top level' });
        } else if (a.op === 'suggest_restructure' || a.op === 'suggest_relight') {
          changes.push({ kind: 'flagged', nodeId: a.nodeId, name: name(a.nodeId), what: String(a.note ?? '').slice(0, 90) });
        }
      }
      return json({ summary: r.summary, at: r.created_at, changes: changes.filter((c) => c.name) });
    }

    // M84 (Jacob): smart node search — mechanical ranked scoring, instant and
    // free. Favorites pinned first; ?record=1 files the query into history.
    if (path === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (url.searchParams.get('record') === '1' && q) store.recordSearch(q);
      const favs = new Set(store.getFavorites());
      const nodes = store.getNodes(projectId).filter((n) => n.status !== 'removed');
      const qTokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      const now = Date.now();
      const scored = nodes.map((n) => {
        const shown = (n.title || n.content).toLowerCase();
        const full = `${n.title ?? ''} ${n.content}`.toLowerCase();
        let score = 0;
        if (q) {
          const ql = q.toLowerCase();
          if (shown === ql) score += 100;
          else if (shown.includes(ql)) score += 40;
          else if (full.includes(ql)) score += 25;
          for (const t of qTokens) {
            if (shown.includes(t)) score += 12;
            else if (full.includes(t)) score += 6;
          }
          if (score === 0) return null; // no match at all
        }
        if (favs.has(n.id)) score += q ? 15 : 100; // pinned; empty query = favorites view
        const ageDays = (now - new Date(n.updatedAt + 'Z').getTime()) / 86_400_000;
        score += Math.max(0, 5 - ageDays); // small recency boost
        return { n, score };
      }).filter((x): x is { n: any; score: number } => Boolean(x) && (q ? true : favs.has(x!.n.id)));
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, 12).map(({ n }) => {
        const path0: string[] = [];
        for (let p0 = n.parentId ? store.getNode(n.parentId) : undefined; p0; p0 = p0.parentId ? store.getNode(p0.parentId) : undefined) path0.unshift(p0.title || p0.content.slice(0, 30));
        return { id: n.id, name: n.title || n.content.slice(0, 60), content: n.content.slice(0, 200), type: n.type ?? '', status: n.status, favorite: favs.has(n.id), path: path0, children: store.childrenOf(n.id).filter((k: any) => k.status !== 'removed').map((k: any) => k.title || k.content.slice(0, 50)) };
      });
      return json({ results, history: store.getSearchHistory() });
    }
    const favMatch = path.match(/^\/api\/nodes\/([\w-]+)\/favorite$/);
    if (favMatch && req.method === 'POST') {
      const { on } = await req.json() as { on: boolean };
      if (!store.getNode(favMatch[1])) return json({ error: 'unknown node' }, 404);
      store.setFavorite(favMatch[1], on);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true });
    }

    // M83 (Jacob): auto-rename button — no proposal stage, retitle directly
    // (max 6 words, store-enforced). Capped per click; remaining reported.
    if (path === '/api/rename-sweep' && req.method === 'POST') {
      const r = await healTitles(12);
      return json({ ok: true, ...r });
    }

    if (path === '/api/mapcheck' && req.method === 'POST') {
      const chat = store.getChats(projectId).find((x) => x.id === mainChatId);
      const r = await checkMap(store, projectId, chat?.focusContainerId ?? null);
      if ('error' in r) return json({ error: r.error }, 502);
      for (const s of r.suggestions) store.upsertSuggestion(projectId, s.nodeId, s.note);
      if (r.suggestions.length > 0) { broadcast({ type: 'map', ...state() }); schedulePrecompute(); }
      return json({ ok: true, summary: r.summary, count: r.suggestions.length });
    }

    // Relational description (M38): lazy — generated on read, cached by
    // neighborhood hash (2 up / 2 down).
    const relMatch = path.match(/^\/api\/nodes\/([\w-]+)\/relations$/);
    if (relMatch && req.method === 'GET') {
      const r = await describeRelations(store, relMatch[1]);
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }

    // Per-node chat memory (M41): read-only view for the detail panel.
    const memMatch = path.match(/^\/api\/nodes\/([\w-]+)\/memory$/);
    if (memMatch && req.method === 'GET') {
      return json({ text: getNodeMemory(store, memMatch[1]) });
    }

    // Suggested minimal title (M40): the detail panel offers it; user adopts.
    const stMatch = path.match(/^\/api\/nodes\/([\w-]+)\/suggest-title$/);
    if (stMatch && req.method === 'GET') {
      const r = await suggestTitle(store, stMatch[1]);
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }

    // M53: agent-assisted placement — candidate homes for a to-sort item.
    const shMatch = path.match(/^\/api\/nodes\/([\w-]+)\/suggest-home$/);
    if (shMatch && req.method === 'GET') {
      const r = await suggestHomes(store, projectId, shMatch[1]);
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }

    // M52 (Jacob): to-sort items always have an exit — user triage moves.
    // Restricted to children of the "to sort" root (general manual moving
    // stays out of MVP per M23); parentId null = promote to top level.
    const tmoveMatch = path.match(/^\/api\/nodes\/([\w-]+)\/place$/);
    if (tmoveMatch && req.method === 'POST') {
      const id = tmoveMatch[1];
      const { parentId } = await req.json() as { parentId: string | null };
      const n = store.getNode(id);
      if (!n) return json({ error: 'unknown node' }, 404);
      const parent = n.parentId ? store.getNode(n.parentId) : null;
      const inToSort = parent && parent.parentId === null && (parent.title === 'to sort' || parent.content.startsWith('to sort'));
      if (!inToSort) return json({ error: 'only "to sort" items can be placed manually' }, 400);
      if (parentId) {
        const dest = store.getNode(parentId);
        if (!dest || dest.status === 'removed') return json({ error: 'unknown destination' }, 404);
        // M54: never into itself/its own subtree (cycle), never into "to sort".
        if (parentId === id || descendantNodes(store, id).includes(parentId)) {
          return json({ error: 'cannot place a node inside itself' }, 400);
        }
        let cur: any = dest;
        while (cur) {
          if (cur.parentId === null && ((cur.title ?? '') === 'to sort' || cur.content.startsWith('to sort'))) {
            return json({ error: 'destination is inside "to sort" — place it somewhere real' }, 400);
          }
          cur = cur.parentId ? store.getNode(cur.parentId) : null;
        }
      }
      const cleaned = n.content.replace(/\s*\(arrived while focus was:[^)]*\)\s*$/, '');
      store.applyAlterations(projectId, [
        { op: 'move_node', id, parentId: parentId ?? null } as any,
        ...(cleaned !== n.content ? [{ op: 'update_node', id, content: cleaned } as any] : []),
      ], { kind: 'user_edit' });
      for (const sg of store.getOpenSuggestions(projectId)) {
        if (sg.kind === 'relight' && sg.nodeId === id) store.setSuggestionStatus(sg.id, 'done');
      }
      const destName = parentId ? nodeName(store.getNode(parentId)) : null;
      chats.noteMapChange(mainChatId, parentId
        ? `moved "${nodeName(n)}" out of "to sort" into "${destName}"`
        : `promoted "${nodeName(n)}" from "to sort" to a top-level topic`);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true });
    }

    // ---- harness adapter surface (M58): Claude Code hooks call these. ----
    // session-start: record node↔session, return the injection payload.
    if (path === '/api/shutdown' && req.method === 'POST') {
      setTimeout(() => process.exit(0), 150);
      return json({ ok: true, version: VERSION });
    }
    if (path === '/api/harness/session-start' && req.method === 'POST') {
      const body = await req.json() as { session_id: string; transcript_path?: string; cwd?: string };
      // M91 binding policy (Mark's grill): subtree-inclusive lookup, then
      // auto-create a project per new directory — each repo gets its own map
      // by default; merges are the escape hatch. The boot placeholder
      // 'default' is ADOPTED (renamed) by the first directory ever bound, so
      // no ghost project lingers in the switcher.
      let announce = '';
      if (body.cwd) {
        let pid = store.projectForCwd(body.cwd);
        if (!pid) {
          for (let d = body.cwd; ; ) { const up = dirname(d); if (up === d) break; d = up; const hit = store.projectForCwd(d); if (hit) { pid = hit; break; } }
        }
        if (!pid) {
          const pname = basename(body.cwd) || 'workspace';
          const all = store.listProjects();
          const adoptable = all.length === 1 && all[0].name === 'default'
            && store.getNodes(all[0].id).filter((n) => n.status !== 'removed'
              && n.author !== 'system' // tutorial seeds + tray are furniture, not content (M123/M178)
              && !((n.title ?? n.content) ?? '').startsWith('to sort')).length <= 1;
          if (adoptable) { pid = all[0].id; store.renameProject(pid, pname); }
          else { pid = store.createProject(pname); bootstrapProject(pid); }
          store.bindCwd(body.cwd, pid);
          setActive(pid);
          store.audit('project_bound', { name: pname, adopted: adoptable });
        } else if (!store.projectForCwd(body.cwd)) store.bindCwd(body.cwd, pid);
        // Once-ever full intro; once-per-project short line (Mark's Q1).
        // M143: a closed map never announces itself.
        if (!influenceOff(pid) && !store.getSetting(`announced:${pid}`)) {
          const url = `http://127.0.0.1:${PORT}`;
          const pname = store.listProjects().find((x) => x.id === pid)?.name ?? 'this project';
          announce = !store.getSetting('announced_ever')
            ? `[harnessmap — first run] The map plugin is active. A live map of this work — topics, decisions, questions, filed automatically as you talk — is at ${url} (this repo's map: "${pname}"). Each repo gets its own map; maps can be merged later from the map-site dropdown. ALL data stays on this machine in ${DB_PATH} — nothing is sent anywhere. Tell the user: the map is live at that URL, storage is local-only, and OFFER to open it in their browser (only run the open command if they say yes).`
            : `[harnessmap] This repo now has its own map, "${pname}" — same map site: ${url}. Mention it to the user in one short line.`;
          store.setSetting('announced_ever', '1');
          store.setSetting(`announced:${pid}`, '1');
        }
      }
      // M161: one concise upgrade line, on session start only, at most once
      // a day — never per prompt, never repeated (Mark: no bombardment).
      checkLatest().catch(() => {});
      if (authBroken === null && store.getSetting('auth_ok') !== '1') {
        await Promise.race([probeAuth(), new Promise((r) => setTimeout(r, 4500))]).catch(() => {});
      }
      if (authBroken) announce = [announce, AUTH_FIX_LINE].filter(Boolean).join('\n');
      const uv = updateAvailable();
      const today = new Date().toISOString().slice(0, 10);
      if (uv && store.getSetting('update_nudged') !== today && !influenceOff((body.cwd ? store.projectForCwd(body.cwd) : null) ?? projectId)) {
        store.setSetting('update_nudged', today);
        announce = [announce, `[harnessmap] upgrade available (v${uv}): run /plugin update map@harnessmap (then restart) to upgrade. Tell the user in one short line.`].filter(Boolean).join('\n');
      }
      const pid2 = (body.cwd ? store.projectForCwd(body.cwd) : null) ?? projectId;
      const claimed = body.cwd ? claimChat(body.cwd) : null;
      const chatId = claimed ?? activeChatOf(pid2);
      const chat = store.getChat(chatId);
      recordSessionStart(store, body.session_id, chat?.focusContainerId ?? null, body.transcript_path ?? null, body.cwd ?? null);
      if (claimed) (store as any).db.prepare('UPDATE harness_sessions SET chat_id = ? WHERE session_id = ?').run(claimed, body.session_id);
      scheduleMapFile(); // make MAP.md exist in this project right away
      return json({ context: chats.harnessContext(chatId), announce: announce || null, version: VERSION });
    }
    // observe: a round happened in the host — slice it from the transcript,
    // append to our log, run the filer, record provenance when it lands.
    // M99: per-session pending prompt (see hooks/on-prompt.ts).
    if (path === '/api/harness/prompt' && req.method === 'POST') {
      const body = await req.json() as { session_id?: string; text?: string };
      if (body.session_id && body.text) pendingPrompts.set(body.session_id, body.text.slice(0, 20_000));
      return json({ ok: true });
    }
    if (path === '/api/harness/observe' && req.method === 'POST') {
      const body = await req.json() as { session_id?: string; transcript_path?: string; last_assistant_message?: string; user_text?: string; assistant_text?: string };
      let userText = body.user_text ?? '';
      let assistantText = body.assistant_text ?? '';
      let slice: RoundSlice | null = null;
      if (body.transcript_path && body.session_id) {
        const { lastUuid } = getSession(store, body.session_id);
        slice = await sliceRound(body.transcript_path, lastUuid);
        userText = userText || slice.userText;
        assistantText = assistantText || slice.assistantText || body.last_assistant_message || '';
        advanceSession(store, body.session_id, slice.lastUuid, body.transcript_path);
      }
      // M99: transcript parsing is now best-effort enrichment — the user text
      // authoritative source is the UserPromptSubmit stash.
      if (!userText && body.session_id) userText = pendingPrompts.get(body.session_id) ?? '';
      if (body.session_id) pendingPrompts.delete(body.session_id);
      if (!userText && !assistantText) return json({ ok: false, reason: 'empty round' }, 200);
      health.observedAt = Date.now();
      store.audit('observe', { session: (body.session_id ?? '').slice(0, 8), user_chars: userText.length, tools: slice?.toolRefs.length ?? 0 });
      const { chatId: obsChatId } = sessionPair(body.session_id);
      const userTurnId = randomUUID();
      store.appendTurn({ id: userTurnId, chatId: obsChatId, role: 'user', content: userText, raw: null });
      store.appendTurn({ id: randomUUID(), chatId: obsChatId, role: 'assistant', content: assistantText, raw: null });
      broadcast({ type: 'turn', chatId: obsChatId, role: 'user', content: userText });
      broadcast({ type: 'turn', chatId: obsChatId, role: 'assistant', content: assistantText });
      const toolNote = slice && slice.toolRefs.length
        ? `\n\n[tools used this round]\n${slice.toolRefs.map((t) => `${t.name}(${t.summary})`).join('\n')}` : '';
      enqueueTranslation({
        chatId: obsChatId, turnId: userTurnId,
        userText,
        assistantText: assistantText + toolNote,
        provenance: slice ? { sessionId: body.session_id ?? null, slice } : undefined,
      });
      return json({ ok: true }, 202);
    }
    // M59: session-aware injection — full map block once per session (and
    // after compaction), deltas afterwards, nothing when nothing changed.
    // The append-only transcript must not accumulate snapshots.
    if (path === '/api/harness/context' && req.method === 'GET') {
      const sessionId = url.searchParams.get('session_id');
      // The context fetch IS the "user just sent a message" signal — let the
      // map UI show that the host agent is thinking (M61).
      if (sessionId) { health.promptAt = Date.now(); broadcast({ type: 'host_prompt' }); }
      const { pid: ctxPid, chatId: ctxChatId } = sessionPair(sessionId);
      if (influenceOff(ctxPid)) {
        // One final directive only for sessions that already carry map
        // context (they were anchored before the switch); silence otherwise.
        if (sessionId && getFullAnchor(store, sessionId) != null && !silenceNoticeSent.has(sessionId)) {
          silenceNoticeSent.add(sessionId);
          store.audit('influence_silence_notice', { session: sessionId.slice(0, 8) });
          return json({ context: SILENCE_NOTICE, kind: 'off' });
        }
        return json({ context: '', kind: 'off' });
      }
      if (!sessionId) return json({ context: chats.harnessContext(ctxChatId) }); // legacy/full
      const anchor = getInjectionAnchor(store, sessionId);
      const fullAnchor = getFullAnchor(store, sessionId);
      const seq = currentSeq(store, ctxPid);
      // Full block when: first turn, or accumulated changes since the last
      // full block cross the threshold (bounded reconstruction, M60).
      const RE_ANCHOR_AFTER = Number(process.env.HARNESSMAP_REANCHOR ?? 15);
      const focusNotice = nudgeNoticePending && nudgeFocusTarget
        ? `[harnessmap] The user asked to focus on "${nudgeFocusTarget.name}" — the map's ▶ auto-focus button is now marked with a red dot and will re-aim the map there in one click. Briefly let the user know.`
        : null;
      if (anchor === null || (fullAnchor !== null && seq - fullAnchor > RE_ANCHOR_AFTER)) {
        let context = chats.harnessContext(ctxChatId);
        if (focusNotice) { context = `${context}\n\n${focusNotice}`; nudgeNoticePending = false; }
        setFullAnchor(store, sessionId, seq);
        store.audit('inject_full', { session: sessionId.slice(0, 8), chars: context.length });
        if (store.getSetting('dev_mode') === '1') store.addTrace({ kind: 'inject', task: 'inject_full', user: `session ${sessionId.slice(0, 8)}`, response: context });
        return json({ context, kind: 'full' });
      }
      const delta = renderDelta(store, ctxPid, anchor);
      setInjectionAnchor(store, sessionId, seq);
      // Focus/lighting shifts aren't map events — include pending notices via
      // the manipulations channel inside the delta when present.
      const manips = chats.consumeManipulations(ctxChatId);
      const parts = [delta, manips.length ? `[harnessmap — user actions]\n${manips.map((m) => `• ${m}`).join('\n')}` : ''].filter(Boolean);
      if (focusNotice) { parts.push(focusNotice); nudgeNoticePending = false; }
      if (parts.length) parts.push('(full current map: read .harnessmap/MAP.md)');
      const ctx = parts.join('\n\n') || null;
      if (ctx) {
        store.audit('inject_delta', { session: sessionId.slice(0, 8), chars: ctx.length });
        if (store.getSetting('dev_mode') === '1') store.addTrace({ kind: 'inject', task: 'inject_delta', user: `session ${sessionId.slice(0, 8)}`, response: ctx });
      }
      return json({ context: ctx, kind: 'delta' });
    }
    // PostCompact: the host squashed its history (our old injections with
    // it) — re-anchor so the next turn re-injects the full block.
    if (path === '/api/harness/compacted' && req.method === 'POST') {
      const body = await req.json() as { session_id?: string };
      if (body.session_id) resetInjectionAnchor(store, body.session_id);
      return json({ ok: true });
    }
    // compaction: map-aware instructions for the host's compaction pass.
    if (path === '/api/harness/compaction' && req.method === 'GET' && influenceOff(sessionPair(url.searchParams.get('session_id')).pid)) {
      return json({ instructions: '' });
    }
    if (path === '/api/harness/compaction' && req.method === 'GET') {
      const { pid: cpPid, chatId: cpChatId } = sessionPair(url.searchParams.get('session_id'));
      const chat = store.getChat(cpChatId);
      const nodes = store.getNodes(cpPid).filter((n) => n.status !== 'removed');
      const focus = chat ? store.getNode(chat.focusContainerId) : null;
      const litSet = new Set(chat ? store.getLit(cpChatId) : []);
      const dimTops = nodes.filter((n) => n.parentId === null && !litSet.has(n.id) && n.id !== chat?.focusContainerId);
      const instructions = [
        'An external goal map (harnessmap) durably records this project: decisions, constraints, questions, and evidence are already filed there and re-injected each turn.',
        focus ? `Preserve in detail: everything about the current focus, "${focus.title || focus.content}".` : '',
        'Preserve: any decisions, constraints, or commitments from this session that may not yet be on the map (the newest exchanges).',
        dimTops.length ? `Safe to compress aggressively: material about ${dimTops.map((n) => `"${n.title || n.content.slice(0, 40)}"`).join(', ')} — the map holds their digests and the user has dimmed them.` : '',
      ].filter(Boolean).join(' ');
      return json({ instructions });
    }

    // Red-dot suggestions: dismiss (keep is client-side — just close the modal).
    const sugMatch = path.match(/^\/api\/suggestions\/([\w-]+)$/);
    if (sugMatch && req.method === 'POST') {
      const { status } = await req.json() as { status: 'dismissed' | 'done' };
      if (status !== 'dismissed' && status !== 'done') return json({ error: 'bad status' }, 400);
      store.setSuggestionStatus(sugMatch[1], status);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true });
    }

    // M63: audit spot-checks — GET /api/audit?limit=50&kind=guard_mass_cap
    if (path === '/api/audit' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const kind = url.searchParams.get('kind') ?? undefined;
      return json(store.getAudit(Math.min(limit, 500), kind));
    }

    return new Response('not found', { status: 404 });
  },
  websocket: {
    open(ws: any) {
      if (ws.data?.term) {
        const t = getTerm(ws.data.term);
        if (!t) { ws.close(); return; }
        for (const chunk of t.buffer) ws.send(chunk); // replay scrollback
        const onData = (d: string) => { try { ws.send(d); } catch {} };
        const onExit = () => { try { ws.send('\r\n[session ended]\r\n'); ws.close(); } catch {} };
        t.listeners.add(onData);
        t.exitListeners.add(onExit);
        (ws.data as any).cleanup = () => { t.listeners.delete(onData); t.exitListeners.delete(onExit); };
        if (!t.alive) onExit();
        return;
      } sockets.add(ws); ws.send(JSON.stringify({ type: 'map', ...state() })); },
    close(ws: any) { (ws.data as any)?.cleanup?.(); sockets.delete(ws); },
    message(ws: any, raw: any) {
      // M97: terminal input/resize frames; the map socket stays server→client.
      const t = ws.data?.term ? getTerm(ws.data.term) : null;
      if (!t) return;
      try {
        const m = JSON.parse(String(raw));
        if (m.t === 'in') t.write(m.d);
        else if (m.t === 'rs') t.resize(Number(m.c) || 120, Number(m.r) || 32);
      } catch { /* ignore malformed frames */ }
    },
  },
});

const reach = LOOPBACK.has(HOST) ? 'loopback only — reach via SSH tunnel' : 'exposed on all interfaces';
console.log(`harnessmap v0.4 · http://${HOST}:${server.port} · auth: ${authEnabled ? 'ON (Basic)' : 'OFF'} · ${reach} · db: ${DB_PATH}`);

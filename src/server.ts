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
import { loadMap, descendantNodes, renderSubtreeFull, renderTree } from './map/render.js';
import { matchNodes, rareTokens, coverageOf, kinOf } from './map/match.js';
import { proposeReorganize, proposeExpand } from './translator/reorganize.js';
import { runMapStatus, getMapStatus, brainCycle, tasteDigest, getUnderstanding, verifyImport, getImportCheck, brainChat, statusConsult } from './translator/mapstatus.js';
import { listMinds, getAreaAdvice } from './translator/governors.js';
import { proposeAutolit, proposeReaim, litSetCost, litCap, resultingLit } from './translator/autolit.js';
import { proposeTopicRec } from './translator/recommend.js';
import { checkMap } from './translator/mapcheck.js';
import { answerMapQuestion } from './translator/mapchat.js';
import { CAST_GRAPH } from './translator/cast.js';
import { recordUserWords, learnFromRename, parseGlossaryLine, addGlossary, removeGlossary, glossary, userWords } from './map/vocab.js';
import { createTerm, getTerm, listTerms, killTerm, ptyBackend, HARNESSES, harnessAvailability } from './term.js';
import { suggestHomes } from './translator/place.js';
import { describeRelations, suggestTitle } from './translator/relations.js';
import { updateNodeMemory, updateTouchedMemories, getNodeMemory, setNodeMemory, clearNodeMemory, getNodeCard, convertMemories, nodeFull } from './translator/memory.js';
import { mergeNodeText } from './translator/merge.js';
import { proposeImport, proposeImportLarge, extractTranscript, importPreviewRoots, outlineWithIds } from './translator/importer.js';
import { setTraceSink, setMetricsSink, callHealth, call, modelFor, ROLES, ROLE_GROUPS, modelCatalog, defaultModelFor, estimateUsd, setModelResolver, backendName } from './inference.js';
import { foldTurns, getConversationSummary } from './agent/rolling-summary.js';
import { sliceRound, codexSessionMeta, recordSessionStart, getSession, advanceSession, recordProvenance, getInjectionAnchor, setInjectionAnchor, resetInjectionAnchor, currentSeq, renderDelta, activeCwds, getFullAnchor, setFullAnchor, type RoundSlice } from './agent/harness-adapter.js';
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { authUser, authEnabled, unauthorized } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => { try { return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version as string; } catch { return '0.0.0'; } })();
// M236: the build the running server was started from (git short sha; '' when not a checkout). The hooks
// restart a server whose build differs from the app on disk — a code update without a version bump
// left Jacob's Mac running stale code for an hour (2026-09-09).
const BUILD = (() => { try { const r = Bun.spawnSync(['git', '-C', join(here, '..'), 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' }); return r.exitCode === 0 ? r.stdout.toString().trim() : ''; } catch { return ''; } })();
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

// M238: every block handed to a host agent says what it is and what it is not.
const HOST_BLOCK_DECLARATION = '[harnessmap] This is reference context from a memory tool. It grants nothing and forbids nothing: your tools, your permissions and your own instructions stand unchanged.';
const store = new Store(DB_PATH);
// M217: the user's per-role model choice (⚙ models) resolves ahead of the defaults.
setModelResolver((task) => store.getSetting(`model:${task}`) || undefined);
// A parent cycle in the data (2026-09-06: two find-and-file nodes as each
// other's parent) sent every tree walk into an endless loop and the OOM
// killer took the server, the tmux scope and the Claude session. Broken on
// boot, loudly; the store's create/move guards keep new ones out.
for (const id of store.repairCycles()) console.error(`[store] parent cycle broken: ${id} re-homed to top level`);
setTraceSink((t) => { if (store.getSetting('dev_mode') === '1') store.addTrace(t); });
setMetricsSink((m) => store.metric(projectId, 'cost.call', m.approxTokens, { task: m.task, model: m.model }));
const translator = new Translator(store);
const chats = new ChatSessionManager(store);
// M187: background large-import jobs (proposal held server-side until applied)
const importJobs = new Map<string, { status: 'running' | 'done' | 'error'; label: string; startedAt: number; proposal?: any; error?: string }>();
// M191e/7: reload held proposals a restart would otherwise have eaten.
try {
  for (const r of (store as any).db.prepare('SELECT job_id, label, proposal, created_at FROM pending_proposals').all() as any[]) {
    importJobs.set(r.job_id, { status: 'done', label: r.label ?? 'restored import', startedAt: Date.parse(r.created_at + 'Z') || Date.now(), proposal: JSON.parse(r.proposal) });
  }
} catch { /* fresh db */ }

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
// M245: is the codex CLI signed in? `codex login status` exits 0 when it is.
// Asked only for the auth panel and only when codex is the backend.
function codexSignIn(ask: boolean): { onPath: boolean; signedIn: boolean | null } {
  const onPath = (() => { try { return Bun.spawnSync(process.platform === 'win32' ? ['where', 'codex'] : ['sh', '-c', 'command -v codex'], { stdout: 'pipe', stderr: 'ignore' }).exitCode === 0; } catch { return false; } })();
  if (!ask || !onPath) return { onPath, signedIn: null };
  try { return { onPath, signedIn: Bun.spawnSync(['codex', 'login', 'status'], { stdout: 'pipe', stderr: 'pipe', timeout: 8000 }).exitCode === 0 }; } catch { return { onPath, signedIn: null }; }
}
// M245: Codex's past sessions live under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl;
// the first line (session_meta) names the cwd. Newest 400 files, first line each.
function codexRolloutsFor(dirs: string[]): { file: string; dir: string; sizeKB: number; mtime: string; harness: 'codex' }[] {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  const found: { file: string; dir: string; sizeKB: number; mtime: string; harness: 'codex' }[] = [];
  const want = new Set(dirs.map((d) => d.replace(/[\\/]+$/, '')));
  const files: { fp: string; mtime: number }[] = [];
  const walk = (d: string, depth: number) => {
    let ents: string[] = []; try { ents = readdirSync(d); } catch { return; }
    for (const f of ents.sort().reverse()) {
      const fp = join(d, f);
      if (files.length >= 400) return;
      try { const st = statSync(fp); if (st.isDirectory()) { if (depth < 3) walk(fp, depth + 1); } else if (f.startsWith('rollout-') && f.endsWith('.jsonl')) files.push({ fp, mtime: st.mtimeMs }); } catch {}
    }
  };
  walk(root, 0);
  for (const { fp, mtime } of files) {
    try {
      const head = readFileSync(fp, { encoding: 'utf8', flag: 'r' }).slice(0, 4000).split('\n')[0];
      const meta = codexSessionMeta([JSON.parse(head)]);
      const cwd = String(meta?.cwd ?? '').replace(/[\\/]+$/, '');
      if (!cwd || !want.has(cwd)) continue;
      const st = statSync(fp);
      found.push({ file: basename(fp), dir: dirname(fp), sizeKB: Math.round(st.size / 1024), mtime: new Date(mtime).toISOString(), harness: 'codex' });
    } catch {}
  }
  return found;
}
// M91 binding policy (Mark's grill): subtree-inclusive lookup, then
// auto-create a project per new directory — each repo gets its own map
// by default; merges are the escape hatch. The boot placeholder
// 'default' is ADOPTED (renamed) by the first directory ever bound, so
// no ghost project lingers in the switcher.
function projectForCwdOrCreate(cwd: string): string {
  let pid = store.projectForCwd(cwd);
  if (!pid) {
    for (let d = cwd; ; ) { const up = dirname(d); if (up === d) break; d = up; const hit = store.projectForCwd(d); if (hit) { pid = hit; break; } }
  }
  if (!pid) {
    const pname = basename(cwd) || 'workspace';
    const all = store.listProjects();
    const adoptable = all.length === 1 && all[0].name === 'default'
      && store.getNodes(all[0].id).filter((n) => n.status !== 'removed'
        && n.author !== 'system' // tutorial seeds + tray are furniture, not content (M123/M178)
        && !((n.title ?? n.content) ?? '').startsWith('to sort')).length <= 1;
    if (adoptable) { pid = all[0].id; store.renameProject(pid, pname); }
    else { pid = store.createProject(pname); bootstrapProject(pid); }
    store.bindCwd(cwd, pid);
    setActive(pid);
    store.audit('project_bound', { name: pname, adopted: adoptable });
  } else if (!store.projectForCwd(cwd)) store.bindCwd(cwd, pid);
  return pid;
}
// M244 (Mark, Windows Codex, 2026-09-10): under the session gate (M239) a
// session is claimed at its first PROMPT after "open map" — its SessionStart
// ran gated and never bound a cwd. Such a session fell through sessionPair
// to the ACTIVE project, so Mark's helloworld turns landed in the check's
// probe project. Every hook now carries cwd, and a session the server has no
// cwd for is bound the moment it speaks.
function ensureSessionBound(sessionId: string | null | undefined, cwd: string | null | undefined, harness?: string | null): void {
  if (!sessionId || !cwd) return;
  if (harness && !store.getSetting(`harness:session:${sessionId}`)) store.setSetting(`harness:session:${sessionId}`, harness === 'codex' ? 'codex' : 'claude');
  if (sessionChat(sessionId)) return;
  const row = (store as any).db.prepare('SELECT cwd FROM harness_sessions WHERE session_id = ?').get(sessionId) as any;
  if (row?.cwd) return;
  const pid = projectForCwdOrCreate(cwd);
  recordSessionStart(store, sessionId, null, null, cwd);
  store.metric(pid, 'session.start');
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
// M195c (founders): a re-aim invalidates the standing snapshot's geometry —
// refocus and mass lighting changes re-anchor every session bound to the
// project, so each gets a fresh FULL map block on its next turn (M59 holds:
// one block, at the deliberate gesture, not per turn). The ⟲ refresh button
// is the manual lane of the same economy. Sessions owed the block also get
// the one-line notice: full view given; /compact is optional cleanup.
const refreshNotices = new Set<string>();
function reAnchorSessions(pid: string, why: string): number {
  const rows = (store as any).db.prepare("SELECT session_id FROM harness_sessions WHERE last_active > datetime('now', '-7 days')").all() as any[];
  let n = 0;
  for (const r of rows) {
    if (!r.session_id || sessionPair(r.session_id).pid !== pid) continue;
    resetInjectionAnchor(store, r.session_id);
    refreshNotices.add(r.session_id);
    n++;
  }
  reAnchorPanes(pid);
  if (n) store.audit('context_reanchor', { why, sessions: n });
  return n;
}
// The pane side of the same economy: dropping a chat's anchored block makes
// its next turn recompose. Free (the pane rebuilds context per call), so the
// pane also re-anchors on cheaper signals (a fresh overall report, serving-
// mode changes) where a host session's transcript would pay for a block.
function reAnchorPanes(pid: string): void {
  for (const c of store.getChats(pid)) store.setSetting(`paneblock:${c.id}`, '');
}
// M195f (Jacob): "It should be automatic and it's the filer's click not my"
// — the user approves an import ONCE, at landing; meeting the verification
// standard afterwards is the machinery's job. Map-side verification findings
// drive an automatic tidy of the IMPORTED SUBTREE ONLY (the mandate that one
// approval granted; anything outside it stays propose→approve), then the
// cycle re-judges. One round per trigger; it keeps trying on every later
// cycle until the verdict flips.
// M194 ruling 3+4, built (the fetch): light is standing curation; fetch is
// momentary retrieval. On EVERY turn the server mechanically matches the
// user's message against the whole map. A distant LIT hit rides along served
// in full (the user already authorized reading it — this closes the
// delta-turn gap where question promotion only ran on full blocks). A DIM
// hit becomes a one-line consented OFFER carrying a single-use token: if the
// user says yes, the agent redeems the token through recall and receives the
// content FOR THAT TURN ONLY — the lit set is never touched. Discovery is
// server-side and size-independent (M194 ruling 4).
const pullupTokens = new Map<string, { nodeId: string; chatId: string; exp: number; used: boolean }>();
// M232: the thread the question started continues to the served node's kin — its
// relatives in other branches, one line each.
function kinLines(pid: string, nodeId: string): string {
  try {
    const kin = kinOf(store, pid, nodeId, 3).map((k) => ({ k, n: store.getNode(k.id) })).filter((x) => x.n && x.n.status !== 'removed');
    if (!kin.length) return '';
    return `\n  related elsewhere on the map: ${kin.map((x) => `"${x.n!.title || x.n!.content.slice(0, 50)}" — ${getNodeCard(store, x.n!.id).minimal || x.n!.content.slice(0, 160)}`).join(' · ')}`;
  } catch { return ''; }
}
function matchPullup(pid: string, chatId: string, promptText: string, includeLit: boolean): string {
  try {
    const q = (promptText ?? '').trim();
    if (q.length < 8) return '';
    const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'should', 'would', 'about', 'what', 'when', 'how', 'our', 'are', 'was', 'were', 'have', 'has', 'does', 'user', 'users', 'map', 'node', 'nodes', 'agent', 'which', 'where', 'there', 'their', 'into', 'been', 'also', 'only', 'each', 'than', 'then', 'them', 'they', 'will', 'exactly', 'still']);
    const toks = [...new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))];
    if (toks.length < 2) return '';
    const chat = store.getChat(chatId);
    if (!chat) return '';
    const litSet = new Set(store.getLit(chatId));
    const focusSet = new Set([chat.focusContainerId, ...descendantNodes(store, chat.focusContainerId)]);
    // M199 (after the 2026-09-06 recall run): common words ("view", "served",
    // "composition") let the wrong node win the count on 6 of 9 lost
    // questions. A shared word now weighs by its rarity on this map, and up
    // to three hits ride along instead of one.
    // M203: shared word matcher — whole words over title, statement, and the
    // node's minimal/medium memory, title weighted ×2 (see src/map/match.ts).
    // M230 fix: excluding the focus subtree is right when the focus is a topic
    // (already served in full); when the focus is the map's root (a fresh
    // session) it would exclude the whole map and nothing could ever ride along.
    const liveCount = store.getNodes(pid).filter((n) => n.status !== 'removed').length;
    const exclude = focusSet.size > liveCount * 0.5 ? new Set<string>([chat.focusContainerId]) : (focusSet as Set<string>);
    const scored = matchNodes(store, pid, q, { exclude }).map((m) => ({ n: store.getNode(m.id)!, sc: m.score, hits: m.hits }));
    scored.sort((x, y) => y.sc - x.sc);
    // M230 (Jacob, 2026-09-08 3:02 pm ET, after his note that the brain works
    // before the turn while the miss happens in the turn): the question IS the
    // consent. The nodes the user's message names are served IN FULL at the top
    // of the block — lit or set aside — so the specific sentence, not its
    // parent, is in front of the agent when it answers. Weaker matches stay an
    // offer (a second turn). Dim nodes served this way are marked as set aside.
    const top = scored.slice(0, 3).filter((h, i) => i === 0 || h.sc >= scored[0].sc * 0.7);
    const weaker = scored.slice(top.length, top.length + 2).filter((h) => h.sc >= scored[0].sc * 0.4);
    if (!top.length) return '';
    const outs: string[] = [];
    for (const best of top) {
    const name = best.n.title || String(best.n.content).slice(0, 60);
    if (litSet.has(best.n.id)) {
      if (!includeLit) continue;
      // Lit but distant: serve the card directly — authorization exists.
      const c = getNodeCard(store, best.n.id);
      const details = c.details.filter((f: any) => f.status === 'current').map((f: any) => `  - ${f.text}${f.date ? ` (${f.date})` : ''}`).join('\n');
      store.audit('pullup_served_lit', { node: best.n.id.slice(0, 8) });
      // M213 (Jacob): served in full means in full. A sanity ceiling far above
      // any real node stays (an import root's 90k statement once rode along);
      // when it bites, the audit says so instead of a silent 2,500-char clip.
      if (String(best.n.content).length > 30_000) store.audit('pullup_ceiling', { node: best.n.id.slice(0, 8), chars: String(best.n.content).length });
      outs.push(`[harnessmap] the message touches "${name}" (lit, far from focus) — served in full for this turn:\n${String(best.n.content).slice(0, 30_000)}${c.minimal ? `\n${c.minimal}` : ''}${details ? `\n${details}` : ''}${kinLines(pid, best.n.id)}`.slice(0, 4000));
      continue;
    }
    // Dim but named by the question: served in full for this turn (M230).
    {
      const c = getNodeCard(store, best.n.id);
      const details = c.details.filter((f: any) => f.status === 'current').map((f: any) => `  - ${f.text}${f.date ? ` (${f.date})` : ''}`).join('\n');
      const full = (c as any).long && String((c as any).long).length > String(best.n.content).length ? String((c as any).long) : `${String(best.n.content).slice(0, 30_000)}${c.minimal ? `\n${c.minimal}` : ''}${details ? `\n${details}` : ''}`;
      store.audit('pullup_served_by_question', { node: best.n.id.slice(0, 8), lit: false });
      store.metric(pid, 'interaction.pullup_served_by_question');
      outs.push(`[harnessmap] the message names "${name}" — a SET-ASIDE topic, served in full for this turn because you asked about it (it stays set aside afterwards):\n${full.slice(0, 30_000)}${kinLines(pid, best.n.id)}`);
      continue;
    }
    }
    for (const best of weaker) {
    const name = best.n.title || String(best.n.content).slice(0, 60);
    if (litSet.has(best.n.id)) continue;
    // Weaker dim matches: a consented offer, never content.
    const token = randomUUID().slice(0, 13);
    pullupTokens.set(token, { nodeId: best.n.id, chatId, exp: Date.now() + 10 * 60_000, used: false });
    store.audit('pullup_offered', { node: best.n.id.slice(0, 8) });
    store.metric(pid, 'interaction.pullup_offered');
    outs.push(`[harnessmap] The user's message touches a SET-ASIDE topic: "${name}". Its content is withheld. In one short line, offer to pull it up for this turn; if the user agrees, call recall with pullupToken "${token}" to receive it once (the lighting stays untouched). Never guess at its content.`);
    }
    return outs.join('\n\n');
  } catch { return ''; }
}
// M195h/M195i: the shared filing pass — creates missing content inside an
// import's subtree from source material, under the filer's own duties,
// consulting the brain's filing advice. Used by the automatic finish (the
// verification's findings drive it) and by the user's find-and-file line
// (their question drives it). Mandate: the imported subtree, always.
async function fileIntoImport(pid: string, rootId: string, instruction: string, material: string, auditKind: string): Promise<{ created: number; note: string }> {
  try {
    const subtreeView = renderSubtreeFull(store, rootId).slice(0, 40_000);
    const fparsed = await call({
      task: 'import', modelOverride: modelFor('tidy'),
      system: `You are the filer, finishing an import. Create the missing nodes from the SOURCE MATERIAL given.
RULES (the filer's own duties):
- create_node operations ONLY, every one nested under an existing [id] in the subtree shown, or under a node you create earlier in this list. Never touch, move, or remove what exists.
- NODES STATE FACTS, NEVER NARRATE: each node is a standalone statement of a decision, question, constraint, evidence, or fact — with who ruled and when where the material says so.
- MERGE, DON'T DUPLICATE: if the subtree already holds a subject, file new detail UNDER it, never as a sibling restating it.
- Topics, never phases: group by subject. Short names (2-5 words for headings, one tight sentence for statements). Honest statuses ('decided' only for what the material says was settled; reversals marked reversed/superseded).
- Only what the material supports — never invent, never pad. If nothing new is worth filing, return zero alterations and say so.
- Short random strings for new ids.
Return: summary (one sentence) + alterations.`,
      maxTokens: 8000, schema: { type: 'object', additionalProperties: false, required: ['summary', 'alterations'], properties: { summary: { type: 'string' }, alterations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'id', 'content'], properties: { op: { type: 'string', enum: ['create_node'] }, id: { type: 'string' }, parentId: { type: 'string' }, content: { type: 'string' }, title: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' } } } } } } as any,
      timeoutMs: 300_000, audit: (k, d) => store.audit(k, d),
      user: [instruction, material, `THE IMPORTED SUBTREE (ids in [brackets]):\n${subtreeView}`, 'File what belongs on the map.'].join('\n\n') + statusConsult(store, pid, rootId, 'filing'),
    }) as any;
    const falts = (fparsed.alterations ?? []).filter((a: any) => a.op === 'create_node').slice(0, 150);
    if (!falts.length) return { created: 0, note: String(fparsed.summary ?? 'nothing new to file') };
    const inSub = new Set([rootId, ...descendantNodes(store, rootId)]);
    const madeIds = new Set(falts.map((a: any) => a.id));
    // The mandate holds per node, not wholesale: a stray parent re-homes to
    // the import root (the importer's own orphan-sweep precedent) instead of
    // one bad parent discarding a whole round of good filings.
    let rehomed = 0;
    for (const a of falts) {
      if (!a.parentId || (!inSub.has(a.parentId) && !madeIds.has(a.parentId))) { if (a.parentId) rehomed++; a.parentId = rootId; }
    }
    if (rehomed) store.audit('import_autofinish_rehomed', { rehomed });
    const finv = inverseOfAlterations(falts);
    store.applyAlterations(pid, falts, { kind: 'reorganize' });
    store.pushUndo(pid, `filed ${falts.length} node(s) from the import's source`, finv, captureFocusLit(falts.map((a: any) => a.id)));
    healTitles(12, pid).catch(() => {});
    store.audit(auditKind, { created: falts.length });
    broadcast({ type: 'map', ...state() });
    return { created: falts.length, note: String(fparsed.summary ?? '') };
  } catch (err) {
    console.error('[file into import] failed:', err);
    return { created: 0, note: 'the filing pass failed' };
  }
}
async function importAutoFinish(pid: string): Promise<void> {
  try {
    const check = getImportCheck(store, pid);
    if (!check || check.similar) return;
    const mapSide = check.discrepancies.filter((d) => d.side === 'map');
    if (!mapSide.length) return;
    const rootId = store.getSetting(`importroot:${pid}`) ?? '';
    if (!rootId || !store.getNode(rootId)) return;
    // M195h (Jacob: "Of course yes, file. Or at least consult filer") — the
    // finish may FILE the missing pieces, not just reorganize: content the
    // verification names as absent is created from the source summary the
    // import wrote, under the filer's own duties (statements not narration,
    // merge don't duplicate, short names, honest statuses), consulting the
    // brain's filing advice. Mandate unchanged: inside the imported subtree.
    const summaryStd = store.getSetting(`importsummary:${pid}`) ?? '';
    if (summaryStd) {
      await fileIntoImport(pid, rootId,
        `MISSING, per verification:\n${mapSide.map((d) => `- ${d.what} (fix: ${d.fix})`).join('\n').slice(0, 4000)}`,
        `THE WHOLE SOURCE, SUMMARIZED (written at import; file from this):\n${summaryStd}`,
        'import_autofinish_filed');
    }
    const hint = `Import verification found the finished map does not yet show what the source holds. Fix WITHIN this subtree only: ${mapSide.map((d) => `${d.what} (fix: ${d.fix})`).join(' · ').slice(0, 1500)}`;
    const prop = await proposeReorganize(store, pid, rootId, hint);
    if (!prop || 'error' in prop || !prop.alterations?.length) return;
    const inSubtree = new Set([rootId, ...descendantNodes(store, rootId)]);
    const created = new Set(prop.alterations.filter((a: any) => a.op === 'create_node').map((a: any) => a.id));
    const inMandate = prop.alterations.every((a: any) => {
      const target = a.id ?? (a as any).nodeId;
      const parent = (a as any).parentId;
      return (!target || inSubtree.has(target) || created.has(target)) && (!parent || inSubtree.has(parent) || created.has(parent));
    });
    if (!inMandate) { store.audit('import_autofinish_refused', { reason: 'out-of-subtree alteration' }); return; }
    const inverse = inverseOfAlterations(prop.alterations);
    const meta = captureFocusLit(prop.alterations.map((a: any) => a.id).filter(Boolean));
    store.applyAlterations(pid, prop.alterations, { kind: 'reorganize' });
    store.pushUndo(pid, `import auto-finish (${prop.alterations.length} change(s))`, inverse, meta);
    healTitles(12, pid).catch(() => {});
    store.audit('import_autofinish', { changes: prop.alterations.length, findings: mapSide.length });
    broadcast({ type: 'map', ...state() });
    await brainCycle(store, pid);
    await verifyImport(store, pid);
    reAnchorPanes(pid);
  } catch (err) { console.error('[import auto-finish] failed:', err); }
}
const WINDOW = Number(process.env.HARNESSMAP_WINDOW ?? 20);
// M42/P2: recent removal notices, handed to the summary folder so deleted
// topics die in the summary too. Consumed per fold.
let pendingRemovals: string[] = [];

// M48 (Jacob): whenever a node is referred to in chat markers/notices, use
// its TITLE (fall back to content) — never the long description.
function nodeName(n: { title?: string | null; content: string } | undefined | null): string {
  // Name-sized only (M48 + the light's law): notices about a node — including
  // the "set aside (dimmed)" notice — may carry its NAME, never its body.
  // Found live: dimming a node quoted its full content into the very context
  // the dim was meant to withhold it from.
  return n ? (n.title || n.content.slice(0, 60)) : '?';
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
// M191: convert the most recently active legacy memories to minimal+details —
// three cheap batches on boot, the lazy write path handles the long tail.
setTimeout(async () => {
  for (let i = 0; i < 3; i++) { if (await convertMemories(store, 20) === 0) break; }
  // Rolling refresh: the oldest stored compressions regenerate under the
  // current duty (Jacob's whole-node-at-each-length rule), one batch per boot.
  await convertMemories(store, 20, undefined, true);
}, 15_000);

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
const recallRate = new Map<string, number[]>(); // M191 recall loop guard
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
      store.metric(roundPid, 'chat.tokens', Math.ceil((params.userText.length + params.assistantText.length) / 4));
      store.metric(roundPid, 'round.filed', out.result.alterations.length);
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
      // M191: the round's provenance rides along so new facts carry links.
      const roundProv = params.provenance ? {
        session: params.provenance.sessionId,
        tool_use_ids: (params.provenance.slice.toolRefs ?? []).map((t: any) => t.id).slice(0, 12),
        paths: (params.provenance.slice.filePaths ?? []).slice(0, 12),
        urls: (params.provenance.slice.urls ?? []).slice(0, 12),
      } : {};
      updateNodeMemory(store, chat.focusContainerId, params.userText, params.assistantText, roundProv).catch(() => {});
      // M156: every node the ROUND touched gets deep too — one batched cheap
      // call over the filer's own relevance list (never "all lit nodes").
      const touchedIds = out.result.alterations
        .map((a: any) => a.id ?? a.nodeId)
        .filter((id: any) => id && id !== chat.focusContainerId);
      if (touchedIds.length) updateTouchedMemories(store, touchedIds, params.userText, params.assistantText, roundProv).catch(() => {});
      // M195: the overall map status rhythm — event-driven, debounced (M166b
      // idiom): every 10 filed rounds or 30 minutes of activity, whichever
      // first; scans are free, assessments cheap and only for changed areas,
      // one synthesis per cycle. Idle maps spend nothing.
      (async () => {
        try {
          // Same off-switch as auto-review (suites and tests set it to 0):
          // the rhythm is disabled, the map-status button still runs everything.
          if (Number(process.env.HARNESSMAP_AUTOTIDY_ROUNDS ?? 15) === 0) return;
          const nRounds = Number(store.getSetting(`brain_rounds:${roundPid}`) ?? 0) + 1;
          store.setSetting(`brain_rounds:${roundPid}`, String(nRounds));
          const last = Number(store.getSetting(`brain_last:${roundPid}`) ?? 0);
          if (nRounds >= 10 || (last && Date.now() - last > 1_800_000)) {
            store.setSetting(`brain_rounds:${roundPid}`, '0');
            store.setSetting(`brain_last:${roundPid}`, String(Date.now()));
            await brainCycle(store, roundPid);
            reAnchorPanes(roundPid);
            await tasteDigest(store, roundPid);
          } else if (!last) {
            store.setSetting(`brain_last:${roundPid}`, String(Date.now()));
          }
        } catch { /* the brain never blocks a round */ }
      })();
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
      broadcast({ type: 'translator_error', chatId: params.chatId });
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
    feedbackEmail: process.env.HARNESSMAP_FEEDBACK_EMAIL ?? 'yuhinc@sas.upenn.edu',
    version: VERSION,
    build: BUILD, // M236
    appRoot: join(here, '..'), // M241: where this server's code lives (a plugin-cache copy is stale after a pull)
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
  // Bun's default idleTimeout (10s) kills any model-backed request mid-call —
  // tidy/import/expand previews legitimately run 10-90s+ (the playground log
  // shows the literal "request timed out after 10 seconds" error in live use).
  // 255 is Bun's maximum; the long import path is a background job anyway.
  idleTimeout: 255,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;
    // M181 (security review finding): loopback binding alone is NOT a browser
    // trust boundary — CORS never applies to WebSockets, and DNS rebinding
    // defeats same-origin for plain fetches. So on the loopback bind: the
    // Host header must be local (kills rebinding) and a present Origin must
    // be local too (kills cross-origin WS + CSRF). Non-browser clients (our
    // hooks, curl) send no Origin and pass. Authed network mode is exempt —
    // its trust boundary is the credential.
    if (!authEnabled) {
      const host = (req.headers.get('host') ?? '').toLowerCase();
      const origin = req.headers.get('origin');
      const LOCAL_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
      if (!LOCAL_RE.test(host)) return new Response('forbidden (host)', { status: 403 });
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
        return new Response('forbidden (origin)', { status: 403 });
      }
    }

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
        : `created new node: "${content.slice(0, 60)}"`); // notices carry names, name-sized (M195l)
      if (body.focus) {
        applyFocus(mainChatId, id);
        chats.noteMapChange(mainChatId, `moved FOCUS to: "${content.slice(0, 60)}"`);
        appendMarker(content === 'untitled' ? 'focus moved to a new node' : `focus moved to "${content.slice(0, 60)}"`);
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
          broadcast({ type: 'turn', chatId, role: 'system', content: `agent error: ${String(err).slice(0, 200)}` });
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
      store.setSetting(`paneblock:${clearMatch[1]}`, ''); // clear = the pane's compaction: fresh full block next turn
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
      store.metric(projectId, body.on ? 'interaction.light' : 'interaction.dim');
      }
      const n = store.getNode(nodeId);
      chats.noteMapChange(litMatch[1], body.on
        ? `lit as background: "${nodeName(n)}"${ids.length > 1 ? ' (and everything under it)' : ''}`
        : `set aside (dimmed): "${nodeName(n)}"${ids.length > 1 ? ' and everything under it' : ''} — don't bring it up or draw on its earlier discussion unless the user does`);
      if (ids.length > 3) reAnchorSessions(projectId, 'lighting changed');
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
      store.metric(projectId, 'interaction.zoom');
      clearNudges();
      store.clearMark(nodeId);
      applyFocus(focusMatch[1], nodeId);
      store.metric(projectId, 'interaction.focus');
      reAnchorSessions(projectId, 'focus moved');
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
        reAnchorSessions(projectId, 'focus moved');
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
      const { kind, feedback, priorSummary, tail } = await req.json() as { kind: 'focus' | 'zoom'; feedback?: string; priorSummary?: string; tail?: string };
      if (kind !== 'focus' && kind !== 'zoom') return json({ error: 'kind must be focus|zoom' }, 400);
      // M75: an explicit ask already named the target — serve it for free
      // (unless the user is revising: feedback always goes to the specialist).
      if (kind === 'focus' && nudgeFocusTarget && !feedback) {
        const fn = store.getNode(nudgeFocusTarget.id);
        if (fn && fn.status !== 'removed') {
          return json({ containerId: fn.id, name: nodeName(fn), reason: 'you asked in chat to focus on this' });
        }
      }
      const r = await proposeTopicRec(store, projectId, recMatch[1], kind, feedback, priorSummary, tail); // tail: the caller's conversation tail when the chat itself holds none (the recall test hands the question over this way, M200)
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }

    // Auto-lit (v0.3, Jacob's Z2): the model recommends AND applies background
    // lighting for the current focus.
    // M218: merged re-aim — one call picks focus + lighting, applied through the same guard.
    const reaimMatch = path.match(/^\/api\/chats\/([\w-]+)\/reaim$/);
    if (reaimMatch && req.method === 'POST') {
      const chatId = reaimMatch[1];
      const chat = store.getChats(projectId).find((x) => x.id === chatId);
      if (!chat) return json({ error: 'unknown chat' }, 404);
      const body = await req.json().catch(() => ({})) as { tail?: string; apply?: boolean };
      const r = await proposeReaim(store, projectId, chatId, body.tail ?? '');
      if ('error' in r) return json({ error: r.error }, 502);
      if (body.apply !== false) {
        if (r.focus !== chat.focusContainerId) { store.setChatFocus(chatId, r.focus); chats.noteMapChange(chatId, `focus moved to "${r.focusName}"`); }
        clearNudges();
        const pathA = focusPathOf(chatId);
        for (const id of r.dim) for (const d of [id, ...descendantNodes(store, id)]) { if (!pathA.has(d)) store.setLit(chatId, d, false); }
        for (const id of r.lit) for (const d of [id, ...descendantNodes(store, id)]) store.setLit(chatId, d, true);
        if (r.lit.length + r.dim.length > 0) chats.noteMapChange(chatId, `background lighting auto-adjusted: ${r.summary}`);
        reAnchorSessions(projectId, 'auto-light applied');
        broadcast({ type: 'map', ...state() });
      }
      store.audit('reaim_merged', { focus: r.focus.slice(0, 8), lit: r.lit.length, dim: r.dim.length, over: !!r.overBudget });
      return json({ ok: true, focus: r.focus, name: r.focusName, reason: r.reason, summary: r.summary, cost: r.cost, overBudget: r.overBudget, lit: r.lit.length, dim: r.dim.length });
    }
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
        // M199 guard: the block's budget is a hard limit, enforced here, not in a prompt.
        const would = litSetCost(store, resultingLit(store, store.getLit(chatId), lit, dim, pathA));
        const capNow = litCap(store);
        if (would.chars > capNow) { store.audit('guard_lit_budget_apply', { nodes: would.nodes, chars: would.chars, cap: capNow }); return json({ error: `over budget: ${would.nodes} nodes ≈ ${would.chars} chars lit, limit ${capNow}` }, 409); }
        // M199: dim first, then light — a lit child inside a dimmed chapter survives.
        for (const id of dim) for (const d of [id, ...descendantNodes(store, id)]) { if (!pathA.has(d)) store.setLit(chatId, d, false); }
        for (const id of lit) for (const d of [id, ...descendantNodes(store, id)]) store.setLit(chatId, d, true);
        if (lit.length + dim.length > 0) { chats.noteMapChange(chatId, `background lighting auto-adjusted: ${body.summary ?? ''}`); reAnchorSessions(projectId, 'auto-light applied'); }
        broadcast({ type: 'map', ...state() });
        return json({ ok: true, lit: lit.length, dim: dim.length });
      }
      const r = await proposeAutolit(store, projectId, chat.focusContainerId, store.getLit(chatId), body.feedback, body.priorSummary);
      if ('error' in r) return json({ error: r.error }, 502);
      const name = (id: string) => nodeName(store.getNode(id));
      return json({ ok: true, preview: true, summary: r.summary, cost: r.cost, overBudget: r.overBudget,
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
      // M224: a user rename is a ruling on vocabulary — learn agent-word → user-word.
      if (patch.title !== undefined && before.title && patch.title.trim() && patch.title.trim() !== before.title) {
        const e = learnFromRename(store as any, projectId, before.title, patch.title.trim());
        if (e) store.audit('glossary_learned', { from: e.from, to: e.to, how: 'rename' });
      }
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
    // M195k (Jacob: "Shouldn't there also be an enrich map option that reads
    // from the whole transcript of the session to improve the map? … if the
    // map is too coarse" — then "Do"): ENRICH MAP. Reads the project's own
    // conversation log, finds nodes that are thin on the map but were
    // discussed at length, and PROPOSES the depth under them. No import
    // mandate covers the whole map, so this stays propose→approve: one
    // proposal, the user applies once (rides /api/reorganize/apply — undo,
    // title healing, all standard).
    // Temporary diagnosis seam (HARNESSMAP_CALLPROBE=1 only): exercise call()
    // with controlled parameters to isolate an in-server inference failure.
    if (path === '/api/dev/callprobe' && req.method === 'POST' && process.env.HARNESSMAP_CALLPROBE === '1') {
      const b = await req.json() as { task?: string; override?: string; chars?: number; schema?: boolean; consult?: boolean };
      const filler = 'The kiln schedule ruling and its reversal history, restated for probing purposes. '.repeat(Math.max(1, Math.floor((b.chars ?? 2000) / 84)));
      const user0 = `Summarize this in one sentence:\n${filler}` + (b.consult ? statusConsult(store, projectId, undefined, 'filing') : '');
      try {
        const out = await call({
          task: (b.task ?? 'import') as any, modelOverride: b.override || undefined,
          system: 'You are a probe. Reply as instructed.',
          maxTokens: 500,
          ...(b.schema ? { schema: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } } as any } : {}),
          timeoutMs: 120_000,
          user: user0,
        });
        return json({ ok: true, out: (typeof out === 'string' ? out : JSON.stringify(out)).slice(0, 200) });
      } catch (err) { return json({ ok: false, error: String(err).slice(0, 300) }); }
    }
    if (path === '/api/enrich/preview' && req.method === 'POST') {
      store.metric(projectId, 'interaction.enrich_preview');
      const nodes = store.getNodes(projectId).filter((n) => n.status !== 'removed');
      const kidCount = new Map<string, number>();
      for (const n of nodes) if (n.parentId) kidCount.set(n.parentId, (kidCount.get(n.parentId) ?? 0) + 1);
      const memRows = new Map<string, any>(((store as any).db.prepare('SELECT node_id, medium FROM node_memory').all() as any[]).map((r: any) => [r.node_id, r]));
      const isToSort = (n: any) => n.parentId === null && (n.title === 'to sort' || String(n.content).startsWith('to sort'));
      const thin = nodes.filter((n) => !isToSort(n) && (kidCount.get(n.id) ?? 0) === 0 && String(n.content).length < 220 && String(memRows.get(n.id)?.medium ?? '').length < 200);
      if (!thin.length) return json({ error: 'nothing on this map looks too coarse' }, 404);
      // The project's own conversation log, newest first, across its chats.
      const turns: { who: string; text: string }[] = [];
      for (const c of store.getChats(projectId)) {
        for (const t of store.getTurns(c.id).slice(-200)) {
          if (t.role === 'user' || t.role === 'assistant') turns.push({ who: t.role === 'user' ? 'USER' : 'AGENT', text: String(t.content) });
        }
      }
      // Materials also include a retained import source (Jacob: "Test this
      // function first using materials in v5" — an imported map's depth
      // lives in its source, not in conversation turns it never had).
      const enSource = store.getSetting(`importsource:${projectId}`) ?? '';
      if (enSource) {
        for (let i = 0; i < enSource.length; i += 1600) turns.push({ who: 'SOURCE', text: enSource.slice(i, i + 1600) });
      }
      if (!turns.length) return json({ error: 'no conversation record or retained source on this map yet' }, 404);
      // Mechanical match: for each thin node, the turns that discuss it.
      const scoreFor = (nodeText: string, turnText: string): number => {
        const toks = nodeText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
        const low = turnText.toLowerCase();
        return toks.reduce((acc, t) => acc + (low.includes(t) ? 1 : 0), 0);
      };
      const candidates: { node: any; excerpts: string[] }[] = [];
      for (const n of thin) {
        const label = `${n.title ?? ''} ${n.content}`;
        const hits = turns.map((t) => ({ t, sc: scoreFor(label, t.text) })).filter((x) => x.sc >= 2)
          .sort((x, y) => y.sc - x.sc).slice(0, 3);
        if (hits.length && hits.reduce((acc2, h) => acc2 + h.t.text.length, 0) > 400) {
          candidates.push({ node: n, excerpts: hits.map((h) => `${h.t.who}: ${h.t.text.slice(0, 1200)}`) });
        }
      }
      if (!candidates.length) return json({ error: 'the conversation record holds no depth for the thin nodes' }, 404);
      const picked = candidates.slice(0, 12);
      try {
        const parsed = await call({
          task: 'import', modelOverride: modelFor('tidy'),
          system: `You deepen a goal map that is too coarse. For each THIN NODE given (each with the conversation passages that discussed it), propose child nodes carrying the substance the map is missing.
RULES (the filer's own duties):
- create_node operations ONLY, each with parentId = the thin node's [id] (or a node you create earlier in this list under it). Never touch, move, or remove what exists.
- NODES STATE FACTS, NEVER NARRATE: each child is a standalone statement of a decision, fact, question, constraint, or piece of evidence from the passages — never "user asked / agent said".
- Only what the passages support — never invent, never pad. A node whose passages hold nothing worth filing gets nothing.
- Short names; honest statuses; short random strings for new ids.
Return: summary (one sentence saying what was deepened) + alterations.`,
          maxTokens: 6000, schema: { type: 'object', additionalProperties: false, required: ['summary', 'alterations'], properties: { summary: { type: 'string' }, alterations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'id', 'parentId', 'content'], properties: { op: { type: 'string', enum: ['create_node'] }, id: { type: 'string' }, parentId: { type: 'string' }, content: { type: 'string' }, title: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' } } } } } } as any,
          timeoutMs: 300_000, audit: (k, d) => store.audit(k, d),
          user: picked.map((cd) => `THIN NODE [${cd.node.id}]: ${cd.node.title ?? ''} — ${cd.node.content}\nPASSAGES:\n${cd.excerpts.join('\n')}`).join('\n\n') + statusConsult(store, projectId, undefined, 'filing'),
        }) as any;
        const thinIds = new Set(picked.map((cd) => cd.node.id));
        const made = new Set((parsed.alterations ?? []).map((x: any) => x.id));
        const alts = (parsed.alterations ?? []).filter((x: any) => x.op === 'create_node' && (thinIds.has(x.parentId) || made.has(x.parentId))).slice(0, 80);
        if (!alts.length) return json({ error: 'the conversation record holds no depth worth filing' }, 404);
        store.audit('enrich_proposed', { thin: picked.length, creates: alts.length });
        return json({ summary: String(parsed.summary ?? ''), alterations: alts, targets: picked.map((cd) => ({ id: cd.node.id, name: cd.node.title || String(cd.node.content).slice(0, 50) })) });
      } catch (err) {
        return json({ error: (err instanceof Error ? err.message : String(err)).slice(0, 200) }, 502);
      }
    }
    if (path === '/api/reorganize/preview' && req.method === 'POST') {
      store.metric(projectId, 'interaction.tidy_preview');
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
    // M192 (Jacob): map status — the professional structural review, on
    // demand (rare tier). GET returns the standing review; POST runs a new
    // one. The stored opinion is what tidy/reviewer/import-finish consult.
    if (path === '/api/map-status' && req.method === 'GET') {
    const chapterReport = () => {
      try {
        return ((store as any).db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[])
          .map((r: any) => { const n = store.getNode(r.chapter_id); return { id: r.chapter_id, name: (n?.title || n?.content || '?').slice(0, 60), text: r.text, ts: r.updated_at }; });
      } catch { return []; }
    };
      const governors = listMinds(store, projectId).map((m) => { const n = store.getNode(m.nodeId); const adv = getAreaAdvice(store, projectId)[m.nodeId]; return { id: m.nodeId, name: (n?.title || n?.content || '?').slice(0, 60), status: m.status, text: m.understanding, log: m.log, disagreements: m.disagreements, predecessors: m.predecessors, ts: m.updatedAt, retiredAt: m.retiredAt, advice: adv?.advice ?? null, adviceTs: adv?.ts ?? null }; });
      return json({ status: getMapStatus(store, projectId), understanding: getUnderstanding(store, projectId), chapters: chapterReport(), governors, importCheck: getImportCheck(store, projectId), tuning: store.getSetting(`braintuning:${projectId}`) ?? '' });
    }
    // M195c (founders): ⟲ refresh — the user hands every session on this map
    // a fresh FULL view on its next message. /compact in the terminal is the
    // optional deep clean; everything works without it.
    if (path === '/api/context/refresh' && req.method === 'POST') {
      store.metric(projectId, 'interaction.context_refresh');
      const n = reAnchorSessions(projectId, 'user refresh');
      return json({ ok: true, sessions: n });
    }
    // M195c (Jacob): the user talks directly to the map status agent to tune
    // it — advisory, never edits; the exchange distills into standing
    // guidance that rides every synthesis.
    if (path === '/api/map-status/chat' && req.method === 'POST') {
      const b = await req.json() as { text?: string };
      const text = (b.text ?? '').trim();
      if (!text) return json({ error: 'say something' }, 400);
      store.metric(projectId, 'interaction.map_status_chat');
      const r = await brainChat(store, projectId, text);
      if ('error' in r) return json({ error: r.error }, 502);
      return json(r);
    }
    if (path === '/api/map-status' && req.method === 'POST') {
      store.metric(projectId, 'interaction.map_status');
      const outline = renderTree(loadMap(store, projectId), { ids: false }).slice(0, 20_000);
      const r = await runMapStatus(store, projectId, outline);
      if ('error' in r) return json({ error: r.error }, 502);
      // The button runs the whole brain: structure pass above, then the
      // cycle (scan → changed assessments → overall report synthesis).
      await brainCycle(store, projectId);
      // The re-judge lane of the mutual-revision loop: while a summary
      // standard exists, every map status run re-verifies the import against
      // it — map-side findings clear only when a later verify passes.
      if (store.getSetting(`importsummary:${projectId}`)) { await verifyImport(store, projectId); await importAutoFinish(projectId); }
      reAnchorPanes(projectId);
      broadcast({ type: 'map_status' });
    const chapterReport = () => {
      try {
        return ((store as any).db.prepare('SELECT chapter_id, text, updated_at FROM chapter_assessments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[])
          .map((r: any) => { const n = store.getNode(r.chapter_id); return { id: r.chapter_id, name: (n?.title || n?.content || '?').slice(0, 60), text: r.text, ts: r.updated_at }; });
      } catch { return []; }
    };
      return json({ status: r, understanding: getUnderstanding(store, projectId), chapters: chapterReport(), importCheck: getImportCheck(store, projectId), tuning: store.getSetting(`braintuning:${projectId}`) ?? '' });
    }
    // M191: RECALL — the pull channel. The host agent fetches a node's card
    // (minimal view + current details), its neighborhood, or resolved evidence, on
    // demand instead of pre-paid in the injection. Server-guarded: obeys the
    // light (dim → set-aside, no content), refuses when map influence is
    // closed (M143 silence goes both directions), rate-capped, audited.
    const mFull = path.match(/^\/api\/nodes\/([^/]+)\/full$/);
    if (mFull && req.method === 'GET') { const n = store.getNode(decodeURIComponent(mFull[1])); if (!n) return json({ error: 'unknown node' }, 404); return json({ id: n.id, name: n.title || n.content, full: nodeFull(store, n.id) }); }
    const mHist = path.match(/^\/api\/nodes\/([^/]+)\/history$/);
    if (mHist && req.method === 'GET') {
      const n = store.getNode(decodeURIComponent(mHist[1]));
      if (!n) return json({ error: 'unknown node' }, 404);
      return json({ id: n.id, name: n.title || n.content, versions: store.nodeHistory(n.id) });
    }
    if (path === '/api/recall' && req.method === 'POST') {
      const b = await req.json() as { nodeId?: string; name?: string; depth?: 'card' | 'evidence' | 'around' | 'full'; chatId?: string; pullupToken?: string };
      if (!b.nodeId && !b.name) return json({ error: 'nodeId or name required' }, 400);
      if (influenceOff(projectId)) return json({ error: 'map influence is closed — recall refused' }, 403);
      // Agents reference topics by NAME (the injection shows names, not ids):
      // resolve case-insensitively against titles, then statements.
      let rn = b.nodeId ? store.getNode(b.nodeId) : undefined;
      if (!rn && b.name) {
        const q = b.name.trim().toLowerCase();
        const cand = store.getNodes(projectId).filter((n) => n.status !== 'removed');
        rn = cand.find((n) => (n.title ?? '').toLowerCase() === q)
          ?? cand.find((n) => n.content.toLowerCase() === q)
          ?? cand.find((n) => (n.title ?? '').toLowerCase().startsWith(q))
          ?? cand.find((n) => n.content.toLowerCase().includes(q));
      }
      if (!rn || rn.status === 'removed' || rn.projectId !== projectId) return json({ error: 'unknown node' }, 404);
      const rChatId = b.chatId ?? mainChatId;
      const rChat = store.getChat(rChatId);
      if (!rChat) return json({ error: 'unknown chat' }, 404);
      // Rate cap (loop guard): 20 recalls per chat per 10 minutes.
      const now = Date.now();
      const rl = (recallRate.get(rChatId) ?? []).filter((t) => now - t < 600_000);
      if (rl.length >= 20) return json({ error: 'recall rate limit — 20 per 10 minutes' }, 429);
      rl.push(now); recallRate.set(rChatId, rl);
      // The light is the law: a node outside focus+lit answers set-aside only.
      const rFocusSet = new Set([rChat.focusContainerId, ...descendantNodes(store, rChat.focusContainerId)]);
      const rLit = new Set(store.getLit(rChatId));
      if (!rFocusSet.has(rn.id) && !rLit.has(rn.id)) {
        // The user's yes is the authorization (M194 ruling 3): a single-use
        // pull-up token, minted only when the server offered this turn,
        // serves the set-aside node ONCE — the lit set never moves.
        const tok = b.pullupToken ? pullupTokens.get(b.pullupToken) : undefined;
        if (tok && !tok.used && tok.exp > Date.now() && tok.nodeId === rn.id) {
          tok.used = true;
          store.audit('pullup_served', { node: rn.id.slice(0, 8) });
          store.metric(projectId, 'interaction.pullup_served');
        } else {
          // M203 (Jacob): the agent may offer ANY named node, not only the ones
          // the server offered this turn — the name is visible, the body is not.
          // The token is minted here on request, single-use, ten minutes; the
          // user's yes still authorizes, the lit set still never moves.
          const reqTok = randomUUID().slice(0, 13);
          pullupTokens.set(reqTok, { nodeId: rn.id, chatId: rChatId, exp: Date.now() + 10 * 60_000, used: false });
          store.audit('recall_setaside', { node: rn.id.slice(0, 8), tokenMinted: true });
          return json({ setAside: true, pullupToken: reqTok, message: 'set aside by the user (dimmed) — do not use its content; you may offer to pull it up for this turn (the user\'s yes authorizes it)' });
        }
      }
      const depth = b.depth ?? 'card';
      const card = (id: string) => {
        const n = store.getNode(id)!;
        const c = getNodeCard(store, id);
        return { id: n.id, name: n.title || n.content, statement: n.content, type: n.type ?? null, status: n.status, minimal: c.minimal, details: c.details.filter((f) => f.status === 'current').map((f) => ({ text: f.text, date: f.date, prov: f.prov })) };
      };
      const out: any = { card: card(rn.id) };
      out.card.long = getNodeCard(store, rn.id).long ?? null; // M214
      if (depth === 'full') out.full = nodeFull(store, rn.id); // M214: the raw material, on request
      // M203 (Jacob): a node's timeline — every content/title/status change
      // from the event log, oldest first, so a later ruling is seen AS a
      // change of the same topic, not a twin node.
      const hist = store.nodeHistory(rn.id);
      if (hist.length > 1) out.card.history = hist.map((v) => ({ at: v.at, source: v.source, ...(v.content !== undefined ? { content: v.content.slice(0, 400) } : {}), ...(v.title !== undefined ? { title: v.title } : {}), ...(v.status !== undefined ? { status: v.status } : {}) }));
      if (depth === 'around') {
        const chain: any[] = [];
        let p = rn.parentId;
        const hops = new Set<string>([rn.id]);
        while (p && !hops.has(p)) { hops.add(p); const a = store.getNode(p); if (!a || a.status === 'removed') break; chain.push({ id: a.id, name: a.title || a.content, minimal: getNodeCard(store, a.id).minimal }); p = a.parentId; }
        out.ancestors = chain;
        out.children = store.childrenOf(rn.id).filter((k) => k.status !== 'removed').slice(0, 12).map((k) => card(k.id));
      }
      if (depth === 'evidence') {
        const resolved: any = { files: [], urls: [], tools: [] };
        const provs: any[] = out.card.details.map((f: any) => f.prov).filter((p: any) => p && Object.keys(p).length);
        const evRounds = ((store as any).db.prepare(
          "SELECT DISTINCT round_id FROM map_events WHERE project_id = ? AND round_id IS NOT NULL AND alteration LIKE ? ORDER BY seq DESC LIMIT 5",
        ).all(projectId, `%${rn.id}%`) as any[]).map((r) => r.round_id);
        for (const rid of evRounds) {
          const pr = (store as any).db.prepare('SELECT session_id, tool_refs, file_paths, urls FROM provenance WHERE round_id = ?').get(rid) as any;
          if (pr) provs.push({ session: pr.session_id, tool_use_ids: JSON.parse(pr.tool_refs || '[]').map((t: any) => t.id), paths: JSON.parse(pr.file_paths || '[]'), urls: JSON.parse(pr.urls || '[]') });
        }
        const seenPaths = new Set<string>(); const seenUrls = new Set<string>(); const seenTools = new Set<string>();
        for (const p of provs) {
          for (const u of p.urls ?? []) if (!seenUrls.has(u)) { seenUrls.add(u); resolved.urls.push(u); }
          for (const fp of (p.paths ?? []).slice(0, 6)) {
            if (seenPaths.has(fp) || resolved.files.length >= 3) continue;
            seenPaths.add(fp);
            try { resolved.files.push({ path: fp, content: readFileSync(fp, 'utf8').slice(0, 4000), note: 'live re-read — fresh beats stale' }); }
            catch { resolved.files.push({ path: fp, error: 'no longer readable' }); }
          }
          if (p.session && resolved.tools.length < 2) {
            const hs = (store as any).db.prepare('SELECT transcript_path FROM harness_sessions WHERE session_id = ?').get(p.session) as any;
            if (hs?.transcript_path) {
              for (const tid of (p.tool_use_ids ?? []).slice(0, 4)) {
                if (seenTools.has(tid) || resolved.tools.length >= 2) continue;
                seenTools.add(tid);
                try {
                  const raw = readFileSync(hs.transcript_path, 'utf8');
                  const at = raw.indexOf(tid);
                  if (at >= 0) resolved.tools.push({ tool_use_id: tid, excerpt: raw.slice(at, at + 3000) });
                } catch { /* transcript gone — the digest stands */ }
              }
            }
          }
        }
        out.evidence = resolved;
      }
      store.metric(projectId, 'cost.recall', JSON.stringify(out).length, { depth });
      store.audit('recall', { node: rn.id.slice(0, 8), depth });
      return json(out);
    }

    // M189: file a node's earlier discussion onto the map — propose child
    // nodes from its memory; apply rides /api/reorganize/apply unchanged.
    if (path === '/api/expand/preview' && req.method === 'POST') {
      store.metric(projectId, 'interaction.expand_preview');
      const body = await req.json() as { nodeId?: string; feedback?: string; priorSummary?: string };
      if (!body.nodeId) return json({ error: 'nodeId required' }, 400);
      const proposal = await proposeExpand(store, projectId, body.nodeId, body.feedback, body.priorSummary);
      if (!proposal) return json({ error: 'unknown node' }, 404);
      if ('error' in proposal) return json({ error: proposal.error }, 502);
      return json(proposal);
    }
    if (path === '/api/reorganize/apply' && req.method === 'POST') {
      const { alterations, chatId, containerName, suggestionId, memories, origin, jobId } = await req.json() as { alterations: any[]; chatId?: string; containerName?: string; suggestionId?: string; memories?: Record<string, string>; origin?: string; jobId?: string };
      // M195d fix (found live): the ACTIVE project is mutable — session
      // follow-mode can flip it between propose and apply, and a 519-node
      // import landed on the wrong map. A proposal APPLIES TO THE PROJECT IT
      // WAS PROPOSED FOR: the pending row's project_id wins over the global.
      let applyPid = projectId;
      if (jobId) {
        try {
          const pp = (store as any).db.prepare('SELECT project_id, proposal FROM pending_proposals WHERE job_id = ?').get(jobId) as any;
          if (pp?.project_id && store.listProjects().some((x) => x.id === pp.project_id)) applyPid = pp.project_id;
          if (origin === 'import') {
            // The import's source summary must outlive the proposal — capture
            // it BEFORE the row and job are consumed (the verify gate used to
            // read after this deletion and never saw a summary).
            const ppj = pp ? JSON.parse(pp.proposal) : (importJobs.get(jobId) as any)?.proposal;
            const ss = ppj?.sourceSummary;
            if (ss) store.setSetting(`importsummary:${applyPid}`, ss);
            if (ppj?.rootId) store.setSetting(`importroot:${applyPid}`, ppj.rootId);
          }
        } catch {}
        try { (store as any).db.prepare('DELETE FROM pending_proposals WHERE job_id = ?').run(jobId); } catch {}
        importJobs.delete(jobId);
      }
      // M216: which EXISTING areas this import places material into (judged
      // before apply — afterwards the new nodes exist too).
      const placedAreas = origin === 'import' ? [...new Set((alterations as any[]).filter((a) => a.op === 'create_node' && a.parentId && store.getNode(a.parentId)).map((a) => a.parentId as string))] : [];
      const tidyInverse = inverseOfAlterations(alterations);
      const tidyMeta = captureFocusLit(alterations.map((a: any) => a.id).filter(Boolean));
      store.applyAlterations(applyPid, alterations, { kind: 'reorganize' });
      if (placedAreas.length) {
        // The big-picture step (Mark): an import placed across the map is
        // followed by an offer to look at the whole — a ⟳ tidy suggestion on
        // the map's root (or the first area touched), propose → approve as ever.
        const tops = store.getNodes(applyPid).filter((n) => n.status !== 'removed' && n.parentId === null && !((n.title ?? n.content) ?? '').startsWith('to sort'));
        const at = tops.length === 1 ? tops[0].id : placedAreas[0];
        const names = placedAreas.map((id) => store.getNode(id)).filter(Boolean).map((n) => (n!.title || n!.content).slice(0, 30));
        store.upsertSuggestion(applyPid, at, `an import just placed material under ${placedAreas.length} existing area(s) (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}) — a ⟳ tidy of the whole map would reconcile twins and regroup`);
        store.audit('import_placed_applied', { areas: placedAreas.length });
      }
      store.pushUndo(applyPid, `tidy on "${containerName ?? 'the map'}" (${alterations.length} change(s))`, tidyInverse, tidyMeta);
      store.metric(applyPid, 'interaction.tidy_apply', alterations.length);
      // M191/Q4 (Mark): an IMPORT lands dim — the user chooses focus and may
      // auto-light; born-lit (M66) stays for normal per-round filing.
      if (origin !== 'import') lightNewNodes(alterations, mainChatId);
      // M187: imported depth lands in the memory layer (tiered attention
      // serves it from here on).
      if (memories) {
        for (const [nid, mem] of Object.entries(memories)) {
          if (store.getNode(nid) && typeof mem === 'string' && mem) setNodeMemory(store, nid, mem.slice(0, 1500));
        }
        store.metric(applyPid, 'memory.stored', Object.values(memories).join('').length, { source: 'import' });
      }
      // M182: renames/creates from a tidy can carry long content — heal their
      // SHORT display titles right away, not on the next round (guards, not
      // prompts: the naming rule now also lives in the reorganizer prompt,
      // but the display layer enforces it mechanically).
      healTitles(12, applyPid).catch(() => {});
      touch(alterations.map((a: any) => a.id ?? a.nodeId ?? a.containerId).filter(Boolean));
      // M122: a root-scope tidy can insert a container ABOVE the focus path —
      // re-run applyFocus so the ancestor chain stays lit (M111 invariant).
      // M123: and EVERY chat whose focus a tidy deletion removed is rescued
      // to the removed node's parent (or a surviving top-level node).
      for (const c of store.getChats(applyPid)) {
        const f = c.focusContainerId ? store.getNode(c.focusContainerId) : undefined;
        if (f && f.status !== 'removed') { if (c.id === (chatId ?? mainChatId)) applyFocus(c.id, f.id); continue; }
        const fb = (f?.parentId && store.getNode(f.parentId)?.status !== 'removed' ? f.parentId : undefined)
          ?? store.getNodes(applyPid).find((x) => x.parentId === null && x.status !== 'removed')?.id;
        if (fb) applyFocus(c.id, fb);
      }
      if (suggestionId) store.setSuggestionStatus(suggestionId, 'done');
      if (origin === 'import') {
        store.audit('import_applied', { creates: alterations.filter((a: any) => a.op === 'create_node').length, jobId: jobId ?? null });
        // M195c (Jacob): the summary (captured above, before the proposal was
        // consumed) is the standard — brain cycle, then verify against it.
        brainCycle(store, applyPid).then(() => verifyImport(store, applyPid)).then(() => importAutoFinish(applyPid)).then(() => reAnchorPanes(applyPid)).catch(() => {});
      }
      if (chatId) chats.noteMapChange(chatId, `reorganized the "${containerName ?? 'selected'}" subtree (${alterations.length} change(s))`);
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, undo: `tidy on "${containerName ?? 'the map'}" (${alterations.length} change(s))` });
    }

    // On-demand map check (Jacob): review the whole map now; file red dots
    // for anything that needs restructuring, or report a clean bill.
    // M77 (Jacob): direct line to the map agent — advisory, never edits.
    if (path === '/api/map-chat' && req.method === 'POST') {
      store.metric(projectId, 'interaction.guide_ask');
      const body = await req.json() as { question?: string; history?: { q: string; a: string }[] };
      if (!body.question?.trim()) return json({ error: 'empty question' }, 400);
      const r = await answerMapQuestion(store, projectId, mainChatId, body.question, body.history ?? []);
      if ('error' in r) return json({ error: r.error }, 502);
      store.audit('mapchat', { q: body.question.slice(0, 80) });
      return json(r);
    }

    // M97 (Mark): embedded Claude Code session tabs.
    if (path === '/api/term' && req.method === 'GET') {
      const avail = harnessAvailability();
      return json({ terms: listTerms().map((t) => ({ ...t, chatId: (getTerm(t.id) as any)?.chatId ?? null })), backend: ptyBackend, harnesses: HARNESSES.map((h) => ({ id: h.id, label: h.label, note: h.note, resume: h.resume, available: !!avail[h.id] })), defaultHarness: store.getSetting('harness:default') || (avail.claude ? 'claude' : avail.codex ? 'codex' : 'claude') });
    }
    if (path === '/api/term' && req.method === 'POST') {
      const body = await req.json() as { cwd?: string; cols?: number; rows?: number; chatId?: string; harness?: string };
      const cwd = body.cwd?.trim();
      if (!cwd || !(cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd))) return json({ error: 'absolute cwd required' }, 400);
      if (body.chatId && !store.getChat(body.chatId)) return json({ error: 'unknown session' }, 404);
      const id = randomUUID();
      // M221: the harness is the user's choice per session; the last choice is the default.
      const harness = body.harness ?? store.getSetting('harness:default') ?? 'claude';
      const t = createTerm(id, cwd, body.cols, body.rows, harness);
      if ('error' in t) return json({ error: t.error }, 400);
      if (body.harness) store.setSetting('harness:default', body.harness);
      if (body.chatId) {
        (t as any).chatId = body.chatId;
        const q = pendingChatClaims.get(cwd) ?? [];
        q.push(body.chatId);
        pendingChatClaims.set(cwd, q);
      }
      // Follow mode: if this directory is already bound to a map, show it.
      const pid = store.projectForCwd(cwd);
      if (pid && pid !== projectId) setActive(pid);
      store.audit('term_created', { cwd: cwd.slice(-50), backend: ptyBackend, harness, view: body.chatId?.slice(0, 8) ?? null });
      return json({ ok: true, id, backend: ptyBackend, harness });
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
        for (const cand of ['CLAUDE.md', 'AGENTS.md', 'README.md', 'readme.md', 'NOTES.md', 'TODO.md']) {
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
      // M245: Codex rollouts for this project's folders (session_meta.cwd) — newest 400 files scanned, first line only
      for (const f of codexRolloutsFor(dirs)) sessions.push(f);
      sessions.sort((a, b) => b.mtime.localeCompare(a.mtime));
      return json({ files: files.slice(0, 20), sessions: sessions.slice(0, 15), memories: memories.slice(0, 20), sourceRetained: !!(store.getSetting(`importsource:${projectId}`) && store.getSetting(`importroot:${projectId}`)) });
    }
    // M187: LARGE import — chunked background job with progress broadcasts.
    if (path === '/api/import/large' && req.method === 'POST') {
      const b = await req.json() as { kind?: string; text?: string; path?: string; sessionFile?: string };
      let text = '', label = '';
      if (b.kind === 'text') { text = (b.text ?? '').trim(); label = 'pasted notes'; }
      else if (b.kind === 'file' && b.path) {
        const dirs = store.cwdsForProject(projectId);
        if (!dirs.some((d) => b.path!.startsWith(d + '/')) || !/\.(md|txt)$/i.test(b.path)) return json({ error: 'file outside the project folders' }, 400);
        try { text = readFileSync(b.path, 'utf8'); } catch { return json({ error: 'could not read the file' }, 400); }
        label = `document: ${basename(b.path)}`;
      } else if (b.kind === 'session' && b.sessionFile) {
        const base = basename(b.sessionFile);
        let raw = '';
        for (const d of store.cwdsForProject(projectId)) {
          try { raw = readFileSync(join(homedir(), '.claude', 'projects', d.replace(/\//g, '-'), base), 'utf8'); break; } catch {}
        }
        if (!raw) { const cx = codexRolloutsFor(store.cwdsForProject(projectId)).find((r) => r.file === base); if (cx) { try { raw = readFileSync(join(cx.dir, cx.file), 'utf8'); } catch {} } } // M245
        if (!raw) return json({ error: 'session transcript not found for this project' }, 400);
        text = extractTranscript(raw);
        label = `past session: ${base.slice(0, 12)}…`;
      }
      if (!text || text.length < 20) return json({ error: 'nothing to import — the source is empty' }, 400);
      const jobId = randomUUID();
      importJobs.set(jobId, { status: 'running', label, startedAt: Date.now() });
      const jobPid = projectId;
      // M195i (Jacob): the source stays with the map — retained so the user
      // can search it and file from it any time after the import.
      try { store.setSetting(`importsource:${jobPid}`, text.slice(0, 500_000)); } catch {}
      proposeImportLarge(store, jobPid, label, text, (prog) => {
        broadcast({ type: 'import_progress', jobId, ...prog });
      }).then((r) => {
        if ('error' in r) { importJobs.set(jobId, { status: 'error', label, startedAt: Date.now(), error: r.error }); broadcast({ type: 'import_ready', jobId, error: r.error }); }
        else {
          importJobs.set(jobId, { status: 'done', label, startedAt: Date.now(), proposal: r });
          // M191e/7 (Jacob): held proposals survive the server.
          try { (store as any).db.prepare('INSERT OR REPLACE INTO pending_proposals (job_id, project_id, label, proposal) VALUES (?, ?, ?, ?)').run(jobId, jobPid, label, JSON.stringify(r)); } catch {}
          broadcast({ type: 'import_ready', jobId, summary: r.summary, count: r.alterations.length });
        }
      }).catch((err) => {
        importJobs.set(jobId, { status: 'error', label, startedAt: Date.now(), error: String(err).slice(0, 200) });
        broadcast({ type: 'import_ready', jobId, error: String(err).slice(0, 200) });
      });
      return json({ jobId, chars: text.length });
    }
    // M195i (Jacob: "Why don't the finisher be something that user can
    // control as well even after the import? Something like search the
    // source"): find-and-file — the user's hand on the same machinery. Their
    // ask is the approval; mandate and duties identical to the automatic lane.
    if (path === '/api/import/find' && req.method === 'POST') {
      const b = await req.json() as { query?: string };
      const query = (b.query ?? '').trim();
      if (!query) return json({ error: 'say what to look for' }, 400);
      const source = store.getSetting(`importsource:${projectId}`) ?? '';
      const rootId = store.getSetting(`importroot:${projectId}`) ?? '';
      if (!source || !rootId || !store.getNode(rootId)) return json({ error: 'no retained import source on this map yet' }, 404);
      store.metric(projectId, 'interaction.import_find');
      // Mechanical search: rank source blocks by query-token overlap.
      const toks = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
      const blocks: string[] = [];
      for (let i = 0; i < source.length; i += 1600) blocks.push(source.slice(Math.max(0, i - 200), i + 1600));
      const scored = blocks.map((blk) => { const low = blk.toLowerCase(); return { blk, score: toks.reduce((a, t) => a + (low.includes(t) ? 1 : 0), 0) }; })
        .filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 8);
      if (!scored.length) return json({ created: 0, note: 'nothing in the source matches that' });
      const summaryStd2 = store.getSetting(`importsummary:${projectId}`) ?? '';
      const r = await fileIntoImport(projectId, rootId,
        `THE USER ASKED TO FIND AND FILE: ${query.slice(0, 500)}`,
        `MATCHED PASSAGES FROM THE ORIGINAL SOURCE:\n${scored.map((x) => x.blk).join('\n[…]\n').slice(0, 24_000)}${summaryStd2 ? `\n\nTHE WHOLE SOURCE, SUMMARIZED:\n${summaryStd2.slice(0, 6000)}` : ''}`,
        'import_source_find');
      return json(r);
    }
    if (path === '/api/import/pending' && req.method === 'GET') {
      const rows = ((store as any).db.prepare('SELECT job_id, project_id, label, created_at FROM pending_proposals ORDER BY created_at DESC').all() as any[]);
      return json({ pending: rows });
    }
    const jobMatch = path.match(/^\/api\/import\/job\/([\w-]+)$/);
    if (jobMatch && req.method === 'GET') {
      const j = importJobs.get(jobMatch[1]);
      if (!j) return json({ error: 'unknown job' }, 404);
      if (j.status !== 'done') return json({ status: j.status, label: j.label, error: j.error });
      const p = j.proposal;
      const preview = store.previewAlterations(projectId, p.alterations, () => importPreviewRoots(store, p.alterations, p.rootId).map((id) => renderSubtreeFull(store, id)).join('\n\n'));
      return json({ status: 'done', label: j.label, summary: p.summary, alterations: p.alterations, rootId: p.rootId, memories: p.memories, chunks: p.chunks, preview });
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
      const preview = store.previewAlterations(projectId, p.alterations, () => importPreviewRoots(store, p.alterations, p.rootId).map((id) => renderSubtreeFull(store, id)).join('\n\n'));
      store.audit('import_preview', { label: label.slice(0, 40), nodes: p.alterations.length, chars: text.length });
      return json({ summary: p.summary, alterations: p.alterations, rootId: p.rootId, preview, label, chars: text.length });
    }

    // M136: undo — pop the latest destructive action and apply its inverse.
    if (path === '/api/undo' && req.method === 'POST') {
      store.metric(projectId, 'interaction.undo');
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
    // M217 (Mark): one model per role, chosen here; empty = the default.
    if (path === '/api/models' && req.method === 'GET') {
      try {
      return json({ groups: ROLE_GROUPS, roles: ROLES.map((r) => ({ ...r, default: defaultModelFor(r.task), chosen: store.getSetting(`model:${r.task}`) || '', current: modelFor(r.task) })), catalog: modelCatalog(), backend: backendName() });
      } catch (err) { return json({ error: `models: ${err instanceof Error ? err.message : String(err)}` }, 500); }
    }
    if (path === '/api/models' && req.method === 'POST') {
      const b = await req.json() as { task?: string; model?: string; reset?: boolean };
      if (b.reset) { for (const r of ROLES) store.setSetting(`model:${r.task}`, ''); store.audit('models_reset', {}); return json({ ok: true }); }
      // A whole group at once ("the per-turn agent on haiku").
      if (b.task?.startsWith('group:')) {
        const g = b.task.slice(6); const members = ROLES.filter((r) => r.group === g);
        if (!members.length) return json({ error: 'unknown group' }, 400);
        const model = String(b.model ?? '').trim();
        if (model && !/^[a-z0-9.-]{3,60}$/.test(model)) return json({ error: 'model ids are lowercase letters, digits, dots and dashes' }, 400);
        for (const r of members) store.setSetting(`model:${r.task}`, model);
        store.audit('model_chosen', { role: `group:${g}`, model: model || '(default)' });
        return json({ ok: true, group: g, roles: members.map((r) => ({ task: r.task, current: modelFor(r.task) })) });
      }
      const role = ROLES.find((r) => r.task === b.task);
      if (!role) return json({ error: 'unknown role' }, 400);
      const model = String(b.model ?? '').trim();
      if (model && !/^[a-z0-9.-]{3,60}$/.test(model)) return json({ error: 'model ids are lowercase letters, digits, dots and dashes' }, 400);
      store.setSetting(`model:${role.task}`, model);
      store.audit('model_chosen', { role: role.task, model: model || '(default)' });
      return json({ ok: true, task: role.task, current: modelFor(role.task) });
    }
    // M225: cost per role — calls and approximate tokens from the metrics every
    // successful call reports (M184), with a rough dollar figure at list prices.
    if (path === '/api/cost' && req.method === 'GET') {
      const win = url.searchParams.get('window') ?? '24h';
      const since = win === 'all' ? '1970-01-01' : win === '7d' ? "datetime('now', '-7 days')" : "datetime('now', '-24 hours')";
      const rows = ((store as any).db.prepare(`SELECT json_extract(detail, '$.task') task, json_extract(detail, '$.model') model, COUNT(*) calls, SUM(n) tokens FROM metrics WHERE kind = 'cost.call' AND ts > ${win === 'all' ? "'1970-01-01'" : since} GROUP BY task, model ORDER BY tokens DESC`).all() as any[]);
      const byTask: Record<string, { calls: number; tokens: number; usd: number; models: string[] }> = {};
      let total = { calls: 0, tokens: 0, usd: 0 };
      for (const r of rows) {
        const usd = estimateUsd(String(r.model), Number(r.tokens)) ?? 0;
        const t = (byTask[r.task] ??= { calls: 0, tokens: 0, usd: 0, models: [] });
        t.calls += r.calls; t.tokens += r.tokens; t.usd += usd; if (!t.models.includes(r.model)) t.models.push(r.model);
        total.calls += r.calls; total.tokens += r.tokens; total.usd += usd;
      }
      const roles = ROLES.map((ro) => ({ task: ro.task, label: ro.label, group: ro.group, perTurn: ro.perTurn, ...(byTask[ro.task] ?? { calls: 0, tokens: 0, usd: 0, models: [] }) }));
      const other = Object.entries(byTask).filter(([t]) => !ROLES.some((ro) => ro.task === t)).map(([task, v]) => ({ task, label: task, group: 'other', perTurn: false, ...v }));
      return json({ window: win, roles: [...roles, ...other], total, backend: backendName(), note: 'tokens ≈ prompt chars / 4 (output assumed 8%); dollars at list prices — on a subscription or codex backend the plan pays instead. Calls made by scripts outside the server (test runs, conversions) are not counted.' });
    }
    // The cast as a network — dev mode's roadmap of who reads what and writes what.
    if (path === '/api/cast' && req.method === 'GET') {
      return json({ ...CAST_GRAPH, models: Object.fromEntries(ROLES.map((r) => [r.task, modelFor(r.task)])) });
    }
    if (path === '/api/prefs' && req.method === 'GET') {
      return json({ text: store.getSetting(`prefs:${projectId}`) ?? '', glossary: glossary(store as any, projectId), words: userWords(store as any, projectId, 40, 2) });
    }
    // M224: the glossary — visible, editable, user-governed.
    if (path === '/api/glossary' && req.method === 'POST') {
      const b = await req.json() as { from?: string; to?: string; remove?: string };
      if (b.remove) return json({ ok: true, glossary: removeGlossary(store as any, projectId, b.remove) });
      if (!b.from?.trim() || !b.to?.trim()) return json({ error: 'both words are needed' }, 400);
      const g = addGlossary(store as any, projectId, b.from, b.to, 'user'); store.audit('glossary_learned', { from: b.from.slice(0, 40), to: b.to.slice(0, 40), how: 'user' });
      return json({ ok: true, glossary: g });
    }
    if (path === '/api/prefs' && req.method === 'POST') {
      const b = await req.json() as { text?: string; append?: string };
      let text = b.text ?? store.getSetting(`prefs:${projectId}`) ?? '';
      // M224: a vocabulary correction ("glossary: session instead of chat") goes to the glossary, not the prose.
      if (b.append && /^\s*glossary:/i.test(b.append)) {
        const g = parseGlossaryLine(b.append);
        if (!g) return json({ error: 'say it as: glossary: <your word> instead of <the agent\'s word>' }, 400);
        addGlossary(store as any, projectId, g.from, g.to, 'chat'); store.audit('glossary_learned', { from: g.from, to: g.to, how: 'chat' });
        broadcast({ type: 'map', ...state() });
        return json({ ok: true, glossary: glossary(store as any, projectId) });
      }
      if (b.append?.trim()) text = (text ? text.replace(/\n*$/, '') + '\n' : '') + '- ' + b.append.trim();
      text = text.slice(0, 1200);
      store.setSetting(`prefs:${projectId}`, text);
      store.audit('prefs_updated', { chars: text.length, appended: Boolean(b.append) });
      broadcast({ type: 'map', ...state() });
      return json({ ok: true, text });
    }

    // M162: user-facing agent view — what one turn's injection is made of.
    if (path === '/api/agent-view' && req.method === 'GET') {
      const { text, trimmedLit, sections, budget, thinking } = composeParts(store, mainChatId, []);
      return json({ sections, trimmedLit, budget, total: text.length, text, thinking });
    }

    // M186 (Mark): full transparency about how the map's agents sign in and
    // who gets billed. Presence booleans only — never the secrets themselves.
    if (path === '/api/auth-info' && req.method === 'GET') {
      const backend = backendName(); // M241: auto-detected (codex on a Codex-only machine), not the env alone
      const home = process.env.HARNESSMAP_HOME ?? join(homedir(), '.harnessmap');
      let keychain: boolean | null = null;
      if (process.platform === 'darwin') {
        try { keychain = Bun.spawnSync(['security', 'find-generic-password', '-s', 'Claude Code-credentials'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0; }
        catch { keychain = null; }
      }
      return json({
        backend,
        billing: backend === 'api' ? 'your ANTHROPIC_API_KEY (you set HARNESSMAP_INFERENCE=api)' : backend === 'codex' ? 'your ChatGPT plan through the codex CLI (codex exec)' : 'your Claude subscription — an API key is never billed',
        keyScrubbed: !process.env.ANTHROPIC_API_KEY,
        sources: {
          envToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
          harnessmapToken: existsSync(join(home, 'oauth-token')),
          cliCredentialsFile: existsSync(join(homedir(), '.claude', '.credentials.json')),
          keychain,
        },
        lastOkAt: callHealth.lastOkAt,
        lastErrAt: callHealth.lastErrAt,
        lastErr: callHealth.lastErr,
        codex: codexSignIn(backend === 'codex'), // M245
      });
    }

    // M184 (Mark): local metrics summary — interactions, memory, cost.
    if (path === '/api/metrics/summary' && req.method === 'GET') {
      const rows = store.metricsSummary(projectId);
      const get = (k: string) => rows.find((r) => r.kind === k)?.total ?? 0;
      const mapTokens = Math.round(get('cost.call') + get('cost.injection'));
      const chatTokens = Math.round(get('chat.tokens'));
      return json({
        rows, mapTokens, chatTokens,
        pct: chatTokens > 0 ? Math.round((mapTokens / chatTokens) * 100) : null,
      });
    }

    // M161: menu-triggered update check.
    if (path === '/api/update-check' && req.method === 'POST') {
      await checkLatest(true);
      return json({ current: VERSION, latest: latestKnown, updateAvailable: updateAvailable(), backend: backendName(), harnesses: Object.keys(harnessAvailability()).filter((k) => (harnessAvailability() as any)[k]) });
    }

    // M159b: feedback log — local record of what the user chose to report.
    if (path === '/api/feedback' && req.method === 'POST') {
      store.metric(projectId, 'interaction.feedback');
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
      // keyScrubbed: M185 invariant — on the subscription path no child of
      // this server can ever see an API key.
      return json({ on: store.getSetting('dev_mode') === '1', keyScrubbed: !process.env.ANTHROPIC_API_KEY });
    }
    // dev/test seam: poke a settings key (localhost-only server; used by suites).
    if (path === '/api/dev/setting' && req.method === 'POST') {
      const b2 = (await req.json()) as { key: string; value: string };
      store.setSetting(b2.key, b2.value);
      if (b2.key === 'latest_ver') latestKnown = b2.value || null;
      if (b2.key === 'memory_serving' || b2.key === 'map_budget') reAnchorPanes(projectId); // a serving-mode change recomposes the pane next turn
      return json({ ok: true });
    }
    // M191 test seam (localhost dev tooling): write structured memory
    // deterministically so suites can exercise the cap, supersession, and
    // serving without a model call.
    if (path === '/api/dev/memory' && req.method === 'POST') {
      const b2 = (await req.json()) as { nodeId: string; minimal?: string; details?: { text: string; date?: string; status?: string }[] };
      if (!store.getNode(b2.nodeId)) return json({ error: 'unknown node' }, 404);
      const db2 = (store as any).db;
      if (b2.minimal !== undefined) {
        db2.prepare(`INSERT INTO node_memory (node_id, medium, minimal, updated_at) VALUES (?, '', ?, datetime('now'))
                     ON CONFLICT(node_id) DO UPDATE SET minimal = excluded.minimal, updated_at = datetime('now')`).run(b2.nodeId, String(b2.minimal).slice(0, 300));
      }
      for (const f of b2.details ?? []) {
        db2.prepare('INSERT INTO memory_details (node_id, text, fact_date, status, prov) VALUES (?, ?, ?, ?, ?)')
          .run(b2.nodeId, String(f.text).slice(0, 400), f.date ?? null, f.status === 'superseded' ? 'superseded' : 'current', '{}');
      }
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
      // M192b (Jacob: "all the information available when they click the
      // node?"): the panel shows every layer the agents can see — the
      // one-line view, the summary, and the dated remembered details
      // (superseded ones included, marked). What the agent sees, the user
      // sees (M20).
      const card = getNodeCard(store, memMatch[1]);
      return json({ text: card.medium, minimal: card.minimal, long: card.long ?? null, details: card.details }); // M214/M223: the long organ text shows on the page too
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
      const body = await req.json() as { session_id: string; transcript_path?: string; cwd?: string; model?: string; harness?: string };
      // M221: which harness is talking — Codex's payload carries an OpenAI
      // model slug; Claude Code's a claude one (or none). Recorded per session.
      const harness = body.harness ?? (String(body.model ?? '').startsWith('gpt') || /[\\/]\.codex[\\/]/.test(String(body.transcript_path ?? '')) ? 'codex' : 'claude');
      store.setSetting(`harness:session:${body.session_id}`, harness);
      // M91 binding policy (Mark's grill): subtree-inclusive lookup, then
      // auto-create a project per new directory — each repo gets its own map
      // by default; merges are the escape hatch. The boot placeholder
      // 'default' is ADOPTED (renamed) by the first directory ever bound, so
      // no ghost project lingers in the switcher.
      let announce = '';
      if (body.cwd) {
        const pid = projectForCwdOrCreate(body.cwd);
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
      const uv = updateAvailable();
      const today = new Date().toISOString().slice(0, 10);
      if (uv && store.getSetting('update_nudged') !== today && !influenceOff((body.cwd ? store.projectForCwd(body.cwd) : null) ?? projectId)) {
        store.setSetting('update_nudged', today);
        announce = [announce, harness === 'codex'
          ? `[harnessmap] upgrade available (v${uv}): rerun the one-line installer from the README (it pulls the update and restarts the map server). Tell the user in one short line.`
          : `[harnessmap] upgrade available (v${uv}): run /plugin update map@harnessmap (then restart) to upgrade. Tell the user in one short line.`].filter(Boolean).join('\n');
      }
      const pid2 = (body.cwd ? store.projectForCwd(body.cwd) : null) ?? projectId;
      store.metric(pid2, 'session.start');
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
      const body = await req.json() as { session_id?: string; text?: string; cwd?: string; harness?: string };
      ensureSessionBound(body.session_id, body.cwd, body.harness);
      if (body.session_id && body.text) pendingPrompts.set(body.session_id, body.text.slice(0, 20_000));
      return json({ ok: true });
    }
    if (path === '/api/harness/observe' && req.method === 'POST') {
      const body = await req.json() as { session_id?: string; transcript_path?: string; last_assistant_message?: string; user_text?: string; assistant_text?: string; cwd?: string };
      ensureSessionBound(body.session_id, body.cwd);
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
      try { if (userText) recordUserWords(store as any, store.getChat(obsChatId)?.projectId ?? projectId, userText); } catch {} // M224
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
      const promptText = url.searchParams.get('prompt') ?? '';
      const sharp = url.searchParams.get('mode') === 'sharp' || process.env.HARNESSMAP_SHARP === '1'; // M233 experiment: size the block by the question
      // The context fetch IS the "user just sent a message" signal — let the
      // map UI show that the host agent is thinking (M61).
      if (sessionId) { health.promptAt = Date.now(); broadcast({ type: 'host_prompt' }); }
      ensureSessionBound(sessionId, url.searchParams.get('cwd'), url.searchParams.get('harness'));
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
      if (!sessionId) { store.audit('legacy_context_served', {}); return json({ context: chats.harnessContext(ctxChatId, promptText) }); } // legacy/full — pre-session clients; audited for retirement
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
        let context = chats.harnessContext(ctxChatId, promptText);
        const pullF = matchPullup(ctxPid, ctxChatId, promptText, true); // M199: lit hits ride along on the first turn too — lit no longer means in-the-block once lit nodes fold
        if (pullF) context = `[harnessmap — what you just asked about]\n${pullF}\n\n${context}`; // M230: at the top, before the standing view
        // M233 (Jacob: "just do one round and tell me what it solves"): the SHARP
        // block — when the question names nodes, serve those in full, the focus
        // in full, and the map as names only; the standing view only when the
        // question names nothing.
        if (sharp && pullF) {
          const chat = store.getChat(ctxChatId); const f = chat ? store.getNode(chat.focusContainerId) : null;
          const fc = f ? getNodeCard(store, f.id) : null;
          const focusFull = f ? `[harnessmap — the focus, in full]\n${f.title || f.content.slice(0, 60)}\n${(fc as any)?.long || `${f.content}${fc?.medium ? `\n${fc.medium}` : ''}`}` : '';
          const names = outlineWithIds(store.getNodes(ctxPid) as any, 5000).replace(/\[[0-9a-f]{8}\] /g, '');
          context = [`[harnessmap — what you just asked about]\n${pullF}`, focusFull, `[harnessmap — the rest of the map, names only; ask to pull any of them up]\n${names}`].filter(Boolean).join('\n\n');
          store.audit('inject_sharp', { session: sessionId.slice(0, 8), chars: context.length });
        }
        // M231: the coverage check — does the served block carry the question's
        // rare words? If not: unfold the lit-but-folded topics that carry them
        // (authorized already); if words are still missing, say so hard.
        try {
          const rare = rareTokens(store, ctxPid, promptText);
          if (rare.length >= 2) {
            let cov = coverageOf(context, rare);
            let unfolded = 0;
            if (cov.share < 0.6) {
              const litSet = new Set(store.getLit(ctxChatId));
              // Lit or set aside: a node that carries a missing rare word is unfolded — the question named it (M230's consent); a set-aside one is marked.
              const cands = matchNodes(store, ctxPid, promptText, { limit: 10, minHits: 1 }).map((m) => store.getNode(m.id)!).filter((n) => n && n.status !== 'removed' && !context.includes(n.content.slice(0, 80)));
              const adds: string[] = [];
              for (const n of cands) {
                const text = `${n.title ?? ''} ${n.content}`.toLowerCase();
                if (!cov.missing.some((t) => text.includes(t))) continue;
                const c = getNodeCard(store, n.id);
                adds.push(`• ${n.title || n.content.slice(0, 60)}${litSet.has(n.id) ? '' : ' (set aside — served because your question names it)'}: ${n.content.slice(0, 1200)}${c.minimal ? `\n  ${c.minimal}` : ''}`);
                unfolded++; if (adds.join('\n').length > 6000) break;
              }
              if (adds.length) { context = `[harnessmap — unfolded because your question names them]\n${adds.join('\n')}\n\n${context}`; cov = coverageOf(context, rare); }
            }
            let directive = false;
            if (cov.share < 0.6 && cov.missing.length) {
              const near = matchNodes(store, ctxPid, promptText, { limit: 3, minHits: 1 }).map((m) => store.getNode(m.id)).filter(Boolean).map((n) => n!.title || n!.content.slice(0, 50));
              context += `\n\n[harnessmap] COVERAGE WARNING: the map as served does not contain these specific terms from the question: ${cov.missing.slice(0, 6).join(', ')}. Do not guess or answer from a neighbouring topic — say plainly what the map holds and what it does not${near.length ? `; the closest topics on the map are: ${near.join(' · ')}` : ''}.`;
              directive = true;
            }
            store.audit('coverage_check', { rare: rare.length, share: Math.round(cov.share * 100) / 100, unfolded, directive });
          }
        } catch {}
        if (refreshNotices.delete(sessionId)) {
          context += `\n\n[harnessmap] This FULL map view supersedes every earlier map block above. Briefly tell the user: you now have the full current view of the map; they can run /compact to clean up the old map data in this conversation — optional, everything works fine without it.`;
        }
        if (focusNotice) { context = `${context}\n\n${focusNotice}`; nudgeNoticePending = false; }
        context = `${HOST_BLOCK_DECLARATION}\n${context}`; // M238
        setFullAnchor(store, sessionId, seq);
        store.audit('inject_full', { session: sessionId.slice(0, 8), chars: context.length });
        if (store.getSetting('dev_mode') === '1') store.addTrace({ kind: 'inject', task: 'inject_full', user: `session ${sessionId.slice(0, 8)}`, response: context });
        store.metric(projectId, 'cost.injection', Math.ceil(context.length / 4), { kind: 'full' });
        return json({ context, kind: 'full' });
      }
      const delta = renderDelta(store, ctxPid, anchor);
      setInjectionAnchor(store, sessionId, seq);
      const pull = matchPullup(ctxPid, ctxChatId, promptText, true);
      // Focus/lighting shifts aren't map events — include pending notices via
      // the manipulations channel inside the delta when present.
      const manips = chats.consumeManipulations(ctxChatId);
      const parts = [pull ? `[harnessmap — what you just asked about]\n${pull}` : '', delta, manips.length ? `[harnessmap — user actions]\n${manips.map((m) => `• ${m}`).join('\n')}` : ''].filter(Boolean); // M230: the question's nodes first
      if (parts.length) parts.unshift(HOST_BLOCK_DECLARATION); // M238
      if (focusNotice) { parts.push(focusNotice); nudgeNoticePending = false; }
      if (parts.length) parts.push('(full current map: read .harnessmap/MAP.md)');
      const ctx = parts.join('\n\n') || null;
      if (ctx) {
        store.audit('inject_delta', { session: sessionId.slice(0, 8), chars: ctx.length });
        if (store.getSetting('dev_mode') === '1') store.addTrace({ kind: 'inject', task: 'inject_delta', user: `session ${sessionId.slice(0, 8)}`, response: ctx });
      }
      if (ctx) store.metric(projectId, 'cost.injection', Math.ceil(ctx.length / 4), { kind: 'delta' });
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

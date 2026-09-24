// The store. bun:sqlite (native driver builds fail under bun; keep every DB
// touch inside this file). Event-sourced: map_events is the source of truth,
// nodes is a rebuildable projection.
//
// v0.4 NODES UNIFICATION: one kind of thing. The legacy containers/items
// tables are frozen (read-only backup); the projection now targets `nodes`,
// and legacy map_events ops replay into nodes — which IS the migration.
import { Database } from 'bun:sqlite';
import { guardTitle } from '../map/vocab.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {


  Alteration, Chat, Link, MapNode, RoundResult, Suggestion, Turn,
} from '../types.js';
export interface FilingRow { turnId: string; chatId: string; userText: string; assistantText: string; provenance: any | null; status: 'pending' | 'succeeded' | 'failed' | 'abandoned'; attempts: number; lastError: string | null; nextRetryAt: string | null; roundId: string | null; createdAt: string; updatedAt: string }
const rowToFiling = (r: any): FilingRow => ({ turnId: r.turn_id, chatId: r.chat_id, userText: r.user_text, assistantText: r.assistant_text, provenance: r.provenance ? (() => { try { return JSON.parse(r.provenance); } catch { return null; } })() : null, status: r.status, attempts: r.attempts, lastError: r.last_error, nextRetryAt: r.next_retry_at, roundId: r.round_id, createdAt: r.created_at, updatedAt: r.updated_at });

const here = dirname(fileURLToPath(import.meta.url));

// The ONE dead word for nodes. Legacy events say 'cut' (containers) or
// 'removed' (items); both normalize here.
const dead = (s: string | undefined) => (s === 'cut' ? 'removed' : s);

export class Store {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    // OFF since v0.4: legacy tables carry FKs (e.g. chats → containers) that
    // would reject rows referencing post-migration node ids.
    this.db.exec('PRAGMA foreign_keys = OFF');
    this.db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
    // v0.4.2 (M36): short display titles; content stays the full statement.
    const ncols = (this.db.prepare('PRAGMA table_info(nodes)').all() as any[]).map((r) => r.name);
    if (!ncols.includes('title')) this.db.exec('ALTER TABLE nodes ADD COLUMN title TEXT');
    const scols = (this.db.prepare('PRAGMA table_info(suggestions)').all() as any[]).map((r) => r.name);
    if (!scols.includes('kind')) this.db.exec("ALTER TABLE suggestions ADD COLUMN kind TEXT NOT NULL DEFAULT 'restructure'");
    if (scols.length && !scols.includes('proposal')) this.db.exec('ALTER TABLE suggestions ADD COLUMN proposal TEXT');
    if (scols.length && !scols.includes('proposal_hash')) this.db.exec('ALTER TABLE suggestions ADD COLUMN proposal_hash TEXT');
    if (scols.length && !scols.includes('proposal_count')) this.db.exec('ALTER TABLE suggestions ADD COLUMN proposal_count INTEGER NOT NULL DEFAULT 0');
    const hcols = (this.db.prepare('PRAGMA table_info(harness_sessions)').all() as any[]).map((r) => r.name);
    if (hcols.length && !hcols.includes('injected_seq')) this.db.exec('ALTER TABLE harness_sessions ADD COLUMN injected_seq INTEGER');
    if (hcols.length && !hcols.includes('full_seq')) this.db.exec('ALTER TABLE harness_sessions ADD COLUMN full_seq INTEGER');
    if (hcols.length && !hcols.includes('cwd')) this.db.exec('ALTER TABLE harness_sessions ADD COLUMN cwd TEXT');
    if (hcols.length && !hcols.includes('chat_id')) this.db.exec('ALTER TABLE harness_sessions ADD COLUMN chat_id TEXT');
    // M251: a host session is mirrored, never forked — the page needs its harness, title and live/closed state.
    for (const [col, typ] of [['harness', 'TEXT'], ['title', 'TEXT'], ['status', 'TEXT'], ['ended_at', 'TEXT'], ['end_reason', 'TEXT']] as const) {
      if (hcols.length && !hcols.includes(col)) this.db.exec(`ALTER TABLE harness_sessions ADD COLUMN ${col} ${typ}`);
    }
    // M263 (Jacob's auto mode): who lit a node — the person by hand ('user') or the map ('map'/null). Auto mode never dims a hand-lit node.
    const lcols = (this.db.prepare('PRAGMA table_info(lit)').all() as any[]).map((r) => r.name);
    if (lcols.length && !lcols.includes('lit_by')) this.db.exec('ALTER TABLE lit ADD COLUMN lit_by TEXT');
    const ccols = (this.db.prepare('PRAGMA table_info(chats)').all() as any[]).map((r) => r.name);
    if (ccols.length && !ccols.includes('host_session_id')) this.db.exec('ALTER TABLE chats ADD COLUMN host_session_id TEXT');
    if (ccols.length && !ccols.includes('name')) this.db.exec('ALTER TABLE chats ADD COLUMN name TEXT'); // M268: session rename on the map
    // M191: structured memory — the 'minimal' resolution column beside the
    // medium-resolution summary ('text'). Early builds named these gist /
    // memory_facts; Jacob dropped those words — rename if found.
    const mcols = (this.db.prepare('PRAGMA table_info(node_memory)').all() as any[]).map((r) => r.name);
    if (mcols.length && mcols.includes('gist')) this.db.exec('ALTER TABLE node_memory RENAME COLUMN gist TO minimal');
    else if (mcols.length && !mcols.includes('minimal')) this.db.exec('ALTER TABLE node_memory ADD COLUMN minimal TEXT');
    if (mcols.length && !mcols.includes('long')) this.db.exec('ALTER TABLE node_memory ADD COLUMN long TEXT'); // M214: the long resolution (all five organs in full)
    // Jacob's resolutions are minimal / medium / long — the old 'text' column IS the medium resolution.
    if (mcols.length && mcols.includes('text')) this.db.exec('ALTER TABLE node_memory RENAME COLUMN text TO medium');
    const oldFacts = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_facts'").get() as any);
    const newDetails = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_details'").get() as any);
    if (oldFacts && !newDetails) this.db.exec('ALTER TABLE memory_facts RENAME TO memory_details');
    this.migrateToNodes();
  }

  // Event-sourced migration: if nodes is empty but history exists, replaying
  // map_events (legacy ops included) rebuilds the whole map as nodes.
  private migrateToNodes(): void {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) n FROM nodes').get() as any).n;
    const eventCount = (this.db.prepare('SELECT COUNT(*) n FROM map_events').get() as any).n;
    if (nodeCount > 0 || eventCount === 0) return;
    for (const p of this.db.prepare('SELECT id FROM projects').all() as any[]) {
      this.rebuildProjection(p.id);
    }
    console.log('[store] migrated to nodes by event replay');
  }

  // ---- projects ----
  // M88: multi-project.
  listProjects(): { id: string; name: string; createdAt: string }[] {
    return (this.db.prepare('SELECT id, name, created_at FROM projects ORDER BY created_at').all() as any[])
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  createProject(name: string): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);
    return id;
  }

  renameProject(id: string, name: string): void {
    this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
  }

  projectForCwd(cwd: string): string | null {
    return ((this.db.prepare('SELECT project_id FROM project_dirs WHERE cwd = ?').get(cwd) as any)?.project_id) ?? null;
  }

  bindCwd(cwd: string, projectId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO project_dirs (cwd, project_id) VALUES (?, ?)').run(cwd, projectId);
  }

  cwdsForProject(projectId: string): string[] {
    return (this.db.prepare('SELECT cwd FROM project_dirs WHERE project_id = ?').all(projectId) as any[]).map((r) => r.cwd);
  }

  getSetting(key: string): string | null {
    return ((this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  copyLit(fromChatId: string, toChatId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO lit (chat_id, container_id, lit_by) SELECT ?, container_id, lit_by FROM lit WHERE chat_id = ?').run(toChatId, fromChatId);
    // M277: a view born from another carries what the person set aside there too (found by the live check: a host view
    // copied the light but not the hand-dims, and the aim re-lit the branch the person had dimmed on the page)
    const dim = this.getUserDim(fromChatId); if (dim.length) this.setUserDim(toChatId, dim, true);
  }

  ensureProject(name: string): string {
    const row = this.db.prepare('SELECT id FROM projects WHERE name = ?').get(name) as { id: string } | undefined;
    if (row) return row.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);
    return id;
  }

  // ---- nodes ----
  createNode(n: Omit<MapNode, 'createdAt' | 'updatedAt'>): void {
    this.db.prepare(
      'INSERT INTO nodes (id, project_id, parent_id, content, type, status, author, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(n.id, n.projectId, n.parentId, n.content, n.type ?? null, dead(n.status) ?? 'live', n.author, (n.title && n.title.length <= 64) ? n.title : null);
  }

  updateNode(id: string, patch: { content?: string; status?: string; type?: string; title?: string }): void {
    if (patch.content !== undefined) {
      this.db.prepare("UPDATE nodes SET content = ?, updated_at = datetime('now') WHERE id = ?").run(patch.content, id);
    }
    if (patch.title !== undefined) {
      // M48: titles are minimal by design — an overlong title is a model
      // failure; keep the previous one rather than store it.
      if (patch.title && patch.title.length > 64) {
        console.log(`[store] rejected overlong title (${patch.title.length} chars)`);
      } else {
        this.db.prepare("UPDATE nodes SET title = ?, updated_at = datetime('now') WHERE id = ?").run(patch.title, id);
      }
    }
    if (patch.type !== undefined) {
      this.db.prepare("UPDATE nodes SET type = ?, updated_at = datetime('now') WHERE id = ?").run(patch.type, id);
    }
    if (patch.status !== undefined) {
      const status = dead(patch.status)!;
      this.db.prepare("UPDATE nodes SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
      if (status === 'removed') {
        // Safety: never silently hide survivors. Live children of a removed
        // node pop up to its parent. (Subtree deletes remove deepest-first,
        // so nothing pops; tidy-merges rehome first, per its prompt.)
        const parent = (this.db.prepare('SELECT parent_id FROM nodes WHERE id = ?').get(id) as any)?.parent_id ?? null;
        this.db.prepare("UPDATE nodes SET parent_id = ?, updated_at = datetime('now') WHERE parent_id = ? AND status != 'removed'").run(parent, id);
      }
    }
  }

  moveNode(id: string, parentId: string | null): void {
    this.db.prepare("UPDATE nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?").run(parentId, id);
  }

  getNodes(projectId: string): MapNode[] {
    return (this.db.prepare('SELECT * FROM nodes WHERE project_id = ?').all(projectId) as any[]).map(rowToNode);
  }

  // M203 (Jacob): a node's timeline from the event log — its create and every
  // update that changed content, title or status, oldest first. No new
  // storage: the map has been event-sourced since the nodes migration.
  nodeHistory(id: string): { seq: number; at: string; changedAt: string; dated: boolean; source: string; content?: string; title?: string; status?: string }[] {
    const rows = this.db.prepare("SELECT seq, alteration, source_kind, created_at FROM map_events WHERE alteration LIKE ? ORDER BY seq ASC").all(`%"id":"${id}"%`) as any[];
    const out: { seq: number; at: string; changedAt: string; dated: boolean; source: string; content?: string; title?: string; status?: string }[] = [];
    for (const r of rows) {
      let a: any; try { a = JSON.parse(r.alteration); } catch { continue; }
      if (a.id !== id || (a.op !== 'create_node' && a.op !== 'update_node')) continue;
      if (a.content === undefined && a.title === undefined && a.status === undefined) continue;
      // M211: `at` = the source date when the alteration carries one (when the
      // fact happened), else the event time (when the map changed); `changedAt`
      // always the event time, `dated` says which one `at` is.
      const sd = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : null;
      const v: any = { seq: r.seq, at: sd ?? r.created_at, changedAt: r.created_at, dated: Boolean(sd), source: r.source_kind ?? '' };
      if (a.content !== undefined) v.content = String(a.content);
      if (a.title !== undefined) v.title = String(a.title);
      if (a.status !== undefined) v.status = String(a.status);
      out.push(v);
    }
    return out;
  }

  // Bulk form for the composer's hot path: node id → its content versions
  // (oldest first) for every node of the project with more than one.
  contentHistoryAll(projectId: string): Map<string, { at: string; content: string }[]> {
    const rows = this.db.prepare("SELECT alteration, created_at FROM map_events WHERE project_id = ? AND alteration LIKE '%\"content\"%' ORDER BY seq ASC").all(projectId) as any[];
    const all = new Map<string, { at: string; content: string }[]>();
    for (const r of rows) {
      let a: any; try { a = JSON.parse(r.alteration); } catch { continue; }
      if ((a.op !== 'create_node' && a.op !== 'update_node') || typeof a.content !== 'string' || !a.id) continue;
      const sd = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : null;
      const l = all.get(a.id); const v = { at: sd ?? r.created_at, content: a.content };
      if (l) l.push(v); else all.set(a.id, [v]);
    }
    for (const [k, l] of all) if (l.length < 2) all.delete(k);
    return all;
  }

  getNode(id: string): MapNode | undefined {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
    return r ? rowToNode(r) : undefined;
  }

  childrenOf(id: string): MapNode[] {
    return (this.db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(id) as any[]).map(rowToNode);
  }

  // ---- links ----
  createLink(l: Link): void {
    // OR REPLACE: link creation replays idempotently (rebuildProjection runs
    // over histories whose links may already sit in the table).
    this.db.prepare('INSERT OR REPLACE INTO links (id, type, from_item_id, to_id, to_kind) VALUES (?, ?, ?, ?, ?)')
      .run(l.id, l.type, l.fromItemId, l.toId, l.toKind ?? 'item');
  }

  getLinksFrom(nodeIds: string[]): Link[] {
    if (nodeIds.length === 0) return [];
    const q = nodeIds.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM links WHERE from_item_id IN (${q})`).all(...nodeIds) as any[]).map((r) => ({
      id: r.id, type: r.type, fromItemId: r.from_item_id, toId: r.to_id, toKind: r.to_kind,
    }));
  }

  // Dependents of a node: links pointing AT it (downward damage walk, v0).
  getLinksTo(id: string): Link[] {
    return (this.db.prepare('SELECT * FROM links WHERE to_id = ?').all(id) as any[]).map((r) => ({
      id: r.id, type: r.type, fromItemId: r.from_item_id, toId: r.to_id, toKind: r.to_kind,
    }));
  }

  // ---- chats / turns / rounds ----
  createChat(c: Omit<Chat, 'createdAt' | 'status'>): void {
    this.db.prepare('INSERT INTO chats (id, project_id, focus_container_id, sdk_session_id) VALUES (?, ?, ?, ?)')
      .run(c.id, c.projectId, c.focusContainerId, c.sdkSessionId);
  }

  setChatSession(chatId: string, sdkSessionId: string): void {
    this.db.prepare('UPDATE chats SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId, chatId);
  }

  setChatFocus(chatId: string, nodeId: string): void {
    this.db.prepare('UPDATE chats SET focus_container_id = ? WHERE id = ?').run(nodeId, chatId);
  }

  getChats(projectId: string): Chat[] {
    return (this.db.prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]).map((r) => ({
      id: r.id, projectId: r.project_id, focusContainerId: r.focus_container_id,
      sdkSessionId: r.sdk_session_id, status: r.status, createdAt: r.created_at, hostSessionId: r.host_session_id ?? null, name: r.name ?? null,
    }));
  }

  // M268: a session's name on the map (null = follow the harness's title)
  setChatName(id: string, name: string | null): void {
    this.db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(name && name.trim() ? name.trim().slice(0, 80) : null, id);
  }

  getChat(id: string): Chat | undefined {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id, projectId: r.project_id, focusContainerId: r.focus_container_id,
      sdkSessionId: r.sdk_session_id, status: r.status, createdAt: r.created_at, hostSessionId: r.host_session_id ?? null, name: r.name ?? null,
    };
  }

  getTurns(chatId: string): Turn[] {
    return (this.db.prepare('SELECT * FROM turns WHERE chat_id = ? ORDER BY idx').all(chatId) as any[]).map((r) => ({
      id: r.id, chatId: r.chat_id, idx: r.idx, role: r.role, content: r.content, raw: r.raw, createdAt: r.created_at,
    }));
  }

  appendTurn(t: Omit<Turn, 'createdAt' | 'idx'>): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS next FROM turns WHERE chat_id = ?').get(t.chatId) as any;
    this.db.prepare('INSERT INTO turns (id, chat_id, idx, role, content, raw) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t.id, t.chatId, row.next, t.role, t.content, t.raw);
    return row.next as number;
  }

  recordRound(chatId: string, turnId: string, result: RoundResult, model: string): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO rounds (id, chat_id, turn_id, summary, alterations, model) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, chatId, turnId, result.summary, JSON.stringify(result.alterations), model);
    return id;
  }

  // ---- M342: the filing ledger ----
  upsertFilingPending(f: { turnId: string; chatId: string; userText: string; assistantText: string; provenance: unknown | null }): void {
    this.db.prepare(`INSERT INTO filings (turn_id, chat_id, user_text, assistant_text, provenance, status, attempts)
      VALUES (?, ?, ?, ?, ?, 'pending', 0)
      ON CONFLICT(turn_id) DO UPDATE SET status = 'pending', updated_at = datetime('now')`)
      .run(f.turnId, f.chatId, f.userText, f.assistantText, f.provenance ? JSON.stringify(f.provenance) : null);
  }
  markFilingSucceeded(turnId: string, roundId: string): void {
    this.db.prepare("UPDATE filings SET status = 'succeeded', round_id = ?, last_error = NULL, next_retry_at = NULL, updated_at = datetime('now') WHERE turn_id = ?").run(roundId, turnId);
  }
  markFilingFailed(turnId: string, error: string, nextRetryAt: string | null, abandon: boolean): void {
    this.db.prepare(`UPDATE filings SET status = ?, attempts = attempts + 1, last_error = ?, next_retry_at = ?, updated_at = datetime('now') WHERE turn_id = ?`)
      .run(abandon ? 'abandoned' : 'failed', error.slice(0, 500), nextRetryAt, turnId);
  }
  getFiling(turnId: string): FilingRow | undefined { const r = this.db.prepare('SELECT * FROM filings WHERE turn_id = ?').get(turnId) as any; return r ? rowToFiling(r) : undefined; }
  listFilings(status?: string[], limit = 200): FilingRow[] {
    const st = status?.length ? status : ['pending', 'failed', 'abandoned'];
    return (this.db.prepare(`SELECT * FROM filings WHERE status IN (${st.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`).all(...st, limit) as any[]).map(rowToFiling);
  }
  dueFilings(nowIso: string, limit = 1): FilingRow[] {
    return (this.db.prepare("SELECT * FROM filings WHERE status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT ?").all(nowIso, limit) as any[]).map(rowToFiling);
  }
  requeueFiling(turnId: string, resetAttempts: boolean): void {
    this.db.prepare(`UPDATE filings SET status = 'failed', next_retry_at = datetime('now'), attempts = CASE WHEN ? THEN 0 ELSE attempts END, updated_at = datetime('now') WHERE turn_id = ? AND status IN ('failed', 'abandoned')`).run(resetAttempts ? 1 : 0, turnId);
  }
  /** A restart interrupted these: pending rows become failed, due now. */
  failInterruptedFilings(exceptTurnIds: string[]): number { // M342f: pending rows this process did not enqueue — a clock rule missed a row when kill and reboot fell in one second
    const ph = exceptTurnIds.map(() => '?').join(',');
    return this.db.prepare(`UPDATE filings SET status = 'failed', last_error = 'interrupted by a server restart', next_retry_at = datetime('now'), updated_at = datetime('now') WHERE status = 'pending'${ph ? ` AND turn_id NOT IN (${ph})` : ''}`).run(...exceptTurnIds).changes;
  }
  // M356: the previous round's alterations for a chat — what the filer did one turn ago (the correction-retire guard reads it).
  lastRoundAlterations(chatId: string): Alteration[] { const r = this.db.prepare('SELECT alterations FROM rounds WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(chatId) as any; try { return r ? (JSON.parse(r.alterations) as Alteration[]) : []; } catch { return []; } }
  roundForTurn(turnId: string): { id: string } | undefined { return this.db.prepare('SELECT id FROM rounds WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1').get(turnId) as any; }
  /** M342 backfill: user turns (with an assistant turn after them) that never got a round and have no ledger row — the
   *  exchanges lost to a failed filing before the ledger existed. Recent ones only, capped, live chats only. */
  backfillMissingFilings(days = 14, cap = 50): number {
    const rows = this.db.prepare(`
      SELECT u.id AS turn_id, u.chat_id, u.content AS user_text,
        (SELECT a.content FROM turns a WHERE a.chat_id = u.chat_id AND a.idx = u.idx + 1 AND a.role = 'assistant') AS assistant_text
      FROM turns u JOIN chats c ON c.id = u.chat_id
      WHERE u.role = 'user' AND c.status != 'archived' AND u.created_at >= datetime('now', ?)
        AND NOT EXISTS (SELECT 1 FROM rounds r WHERE r.turn_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM filings f WHERE f.turn_id = u.id)
      ORDER BY u.created_at ASC LIMIT ?`).all(`-${days} days`, cap) as any[];
    let n = 0;
    for (const r of rows) {
      if (r.assistant_text === null || r.assistant_text === undefined) continue;
      if (!String(r.user_text).trim() && !String(r.assistant_text).trim()) continue;
      this.db.prepare(`INSERT OR IGNORE INTO filings (turn_id, chat_id, user_text, assistant_text, provenance, status, attempts, last_error, next_retry_at)
        VALUES (?, ?, ?, ?, NULL, 'failed', 0, 'never filed (recovered from the stored conversation)', datetime('now'))`).run(r.turn_id, r.chat_id, r.user_text, r.assistant_text);
      n++;
    }
    return n;
  }

  // ---- lit set ----
  // M263: `by` = 'user' when the person lit it by hand; a hand-lit row keeps
  // that mark even if the map lights it again later. Dimming clears the row.
  setLit(chatId: string, nodeId: string, on: boolean, by: 'user' | 'map' | null = null): void {
    if (on) {
      this.db.prepare("INSERT INTO lit (chat_id, container_id, lit_by) VALUES (?, ?, ?) ON CONFLICT(chat_id, container_id) DO UPDATE SET lit_by = CASE WHEN excluded.lit_by = 'user' THEN 'user' ELSE lit.lit_by END").run(chatId, nodeId, by);
    } else {
      this.db.prepare('DELETE FROM lit WHERE chat_id = ? AND container_id = ?').run(chatId, nodeId);
    }
  }

  getLit(chatId: string): string[] {
    return (this.db.prepare('SELECT container_id FROM lit WHERE chat_id = ?').all(chatId) as any[]).map((r) => r.container_id);
  }

  // M277: nodes the person DIMMED by hand ("set aside") — the map never re-lights them on its own (M194/M253).
  getUserDim(chatId: string): string[] {
    try { return JSON.parse(this.getSetting(`userdim:${chatId}`) ?? '[]'); } catch { return []; }
  }
  setUserDim(chatId: string, ids: string[], on: boolean): void {
    const cur = new Set(this.getUserDim(chatId));
    for (const id of ids) { if (on) cur.add(id); else cur.delete(id); }
    this.setSetting(`userdim:${chatId}`, JSON.stringify([...cur]));
  }
  // M263: the hand-lit subset (auto mode's protected set).
  getUserLit(chatId: string): string[] {
    return (this.db.prepare("SELECT container_id FROM lit WHERE chat_id = ? AND lit_by = 'user'").all(chatId) as any[]).map((r) => r.container_id);
  }

  // M263: the exact lit rows (for an undo that restores the light as it was, not only re-lights).
  getLitRows(chatId: string): { id: string; by: string | null }[] {
    return (this.db.prepare('SELECT container_id, lit_by FROM lit WHERE chat_id = ?').all(chatId) as any[]).map((r) => ({ id: r.container_id, by: r.lit_by ?? null }));
  }

  restoreLit(chatId: string, rows: { id: string; by: string | null }[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM lit WHERE chat_id = ?').run(chatId);
      const ins = this.db.prepare('INSERT OR IGNORE INTO lit (chat_id, container_id, lit_by) VALUES (?, ?, ?)');
      for (const r of rows) ins.run(chatId, r.id, r.by);
    });
    tx();
  }

  // ---- save points ----
  createSavePoint(sp: { id: string; chatId: string; name: string; forkSessionId: string | null; turnIdx: number }): void {
    this.db.prepare('INSERT INTO save_points (id, chat_id, name, fork_session_id, turn_idx) VALUES (?, ?, ?, ?, ?)')
      .run(sp.id, sp.chatId, sp.name, sp.forkSessionId, sp.turnIdx);
  }

  // ---- event-sourced apply (TD review finding 3) ----
  // Every alteration is appended to map_events (the source of truth), then
  // projected into the nodes table. The projection can be rebuilt from
  // scratch at any time — which is also what migrated the two-table era.
  applyAlterations(
    projectId: string,
    alterations: Alteration[],
    source: { kind: 'round' | 'user_edit' | 'system' | 'reorganize'; roundId?: string },
  ): void {
    const tx = this.db.transaction(() => {
      for (const a of alterations) {
        // M224: an agent-written name never carries a glossary word the user
        // corrected — the user's word replaces it here, for every source but
        // the user's own edits. Never blocks.
        if (source.kind !== 'user_edit' && (a.op === 'create_node' || a.op === 'update_node') && typeof (a as any).title === 'string' && (a as any).title) {
          const g = guardTitle(this as any, projectId, (a as any).title);
          if (g.changed.length) { (a as any).title = g.title; this.audit('glossary_guard', { id: String((a as any).id ?? '').slice(0, 8), changed: g.changed }); }
        }
        // M123 (Jacob): the top-level "to sort" tray is a permanent system
        // node — no alteration may remove, move, or rewrite it, from ANY
        // source (tidy applies, filer rounds, user edits alike).
        if ((a.op === 'update_node' || a.op === 'move_node') && (a as any).id) {
          const t = this.getNode((a as any).id);
          if (t && t.parentId === null && ((t.title ?? t.content) ?? '').startsWith('to sort')) {
            this.audit('tosort_guard', { op: a.op, skipped: true });
            continue;
          }
        }
        if (a.op === 'suggest_restructure' || (a as any).op === 'suggest_relight') {
          // Not map state — file it as a dot suggestion instead. One open
          // suggestion per node+kind: a newer note replaces the older one.
          const nodeId = (a as any).nodeId ?? (a as any).containerId;
          const kind = (a as any).op === 'suggest_relight' ? 'relight' : 'restructure';
          this.upsertSuggestion(projectId, nodeId, (a as any).note, kind);
          continue;
        }
        this.db.prepare(
          'INSERT INTO map_events (id, project_id, alteration, source_kind, round_id) VALUES (?, ?, ?, ?, ?)',
        ).run(randomUUID(), projectId, JSON.stringify(a), source.kind, source.roundId ?? null);
        this.project(projectId, a);
      }
    });
    tx();
  }

  // ---- relational descriptions (M38): cached text, no staleness check ----
  // (the composer wants zero-latency reads; freshness is handled by the
  // async warm after each round + the hash check on modal reads)
  getCachedRelation(nodeId: string): string | null {
    const r = this.db.prepare('SELECT text FROM relations WHERE node_id = ?').get(nodeId) as any;
    return r?.text ?? null;
  }

  // ---- audit log (M63): harness decisions, model calls, guard actions ----
  // Break every parent cycle in the table: for each cycle one member is
  // re-homed to top level (audited). Returns the re-homed ids. Runs on boot.
  repairCycles(): string[] {
    const rows = this.db.prepare('SELECT id, parent_id FROM nodes').all() as { id: string; parent_id: string | null }[];
    const par = new Map(rows.map((r) => [r.id, r.parent_id]));
    const fixed: string[] = [];
    for (const r of rows) {
      const seen = new Set<string>();
      let x: string | null | undefined = r.id;
      while (x && par.has(x) && !seen.has(x)) { seen.add(x); x = par.get(x); }
      if (x && seen.has(x)) { // x sits on a cycle — cut it there
        par.set(x, null);
        this.moveNode(x, null);
        this.audit('cycle_repaired', { id: x.slice(0, 8), rehomed: 'top' });
        fixed.push(x);
      }
    }
    return fixed;
  }

  audit(kind: string, detail: Record<string, unknown> = {}): void {
    try {
      this.db.prepare('INSERT INTO audit_log (kind, detail) VALUES (?, ?)').run(kind, JSON.stringify(detail));
    } catch { /* audit must never break anything */ }
  }

  getAudit(limit = 100, kind?: string): { ts: string; kind: string; detail: any }[] {
    const rows = kind
      ? this.db.prepare('SELECT ts, kind, detail FROM audit_log WHERE kind = ? ORDER BY id DESC LIMIT ?').all(kind, limit)
      : this.db.prepare('SELECT ts, kind, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    return (rows as any[]).map((r) => ({ ts: r.ts, kind: r.kind, detail: JSON.parse(r.detail) }));
  }

  // ---- local metrics (M184, Mark): interactions, memory storage, cost ----
  metric(projectId: string | null, kind: string, n = 1, detail?: Record<string, unknown>): void {
    try {
      this.db.prepare('INSERT INTO metrics (project_id, kind, n, detail) VALUES (?, ?, ?, ?)')
        .run(projectId, kind, n, detail ? JSON.stringify(detail) : null);
    } catch { /* metrics must never break anything */ }
  }

  metricsSummary(projectId?: string): { kind: string; count: number; total: number }[] {
    const rows = projectId
      ? this.db.prepare('SELECT kind, COUNT(*) c, SUM(n) t FROM metrics WHERE project_id = ? OR project_id IS NULL GROUP BY kind').all(projectId)
      : this.db.prepare('SELECT kind, COUNT(*) c, SUM(n) t FROM metrics GROUP BY kind').all();
    return (rows as any[]).map((r) => ({ kind: r.kind, count: r.c, total: r.t ?? 0 }));
  }

  // ---- restructure suggestions (v0.3.5, Jacob's red dot) ----
  upsertSuggestion(projectId: string, nodeId: string, note: string, kind = 'restructure'): void {
    const open = this.db.prepare("SELECT id FROM suggestions WHERE project_id = ? AND container_id = ? AND status = 'open' AND kind = ?").get(projectId, nodeId, kind) as any;
    if (open) this.db.prepare('UPDATE suggestions SET note = ? WHERE id = ?').run(note, open.id);
    else this.db.prepare('INSERT INTO suggestions (id, project_id, container_id, note, kind) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), projectId, nodeId, note, kind);
  }

  // M124: recent map history for the guide's typed context request.
  getRecentEvents(projectId: string, limit = 30): { seq: number; sourceKind: string; createdAt: string; alteration: any }[] {
    return (this.db.prepare('SELECT seq, source_kind, created_at, alteration FROM map_events WHERE project_id = ? ORDER BY seq DESC LIMIT ?').all(projectId, limit) as any[])
      .map((r) => ({ seq: r.seq, sourceKind: r.source_kind, createdAt: r.created_at, alteration: JSON.parse(r.alteration) }));
  }

  getOpenSuggestions(projectId: string): Suggestion[] {
    return (this.db.prepare("SELECT * FROM suggestions WHERE project_id = ? AND status = 'open' ORDER BY created_at").all(projectId) as any[])
      .map((r) => ({ id: r.id, projectId: r.project_id, nodeId: r.container_id, note: r.note, status: r.status, createdAt: r.created_at, kind: r.kind ?? 'restructure' }));
  }

  // M90: merges — node merge is plain alterations (server composes); these
  // support chat merge (archive) and event-sourced project merge.
  archiveChat(id: string): void {
    this.db.prepare("UPDATE chats SET status = 'archived' WHERE id = ?").run(id);
  }

  // Move EVERYTHING project-keyed from source to target, then delete the
  // source project row. Event-sourced: map_events move too, so replay,
  // deltas, and any rebuild stay coherent; reparenting happens as ordinary
  // appended alterations in the target's log (seq-ordered after these).
  absorbProject(sourceId: string, targetId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE map_events SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
      this.db.prepare('UPDATE nodes SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
      this.db.prepare('UPDATE chats SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
      this.db.prepare('UPDATE suggestions SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
      this.db.prepare('UPDATE project_dirs SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`active_chat:${sourceId}`);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(sourceId);
    });
    tx();
  }

  // M355 (Jacob 2026-09-20: "store these finalized test transcripts as maps one can open and read… a special format
  // called map that can only be opened and imported to our map"): the .map bundle. One JSON document with a HarnessMap
  // signature that carries the WHOLE project — nodes, links, chats, the transcript (turns, rounds), the event history,
  // memory, relations, favorites, filings, provenance — so a map can leave this machine and open, read-through, on
  // another. Plain JSON inside; the signature is what makes it ours: the text importer refuses it and only
  // importProject() opens it. Tables are copied column-for-column (PRAGMA table_info), so ALTERed columns ride along.
  exportProject(projectId: string, opts: { audit?: boolean } = {}): Record<string, any> {
    const proj = this.db.prepare('SELECT id, name, created_at FROM projects WHERE id = ?').get(projectId) as any;
    if (!proj) throw new Error('unknown project');
    const all = (sql: string, ...args: any[]) => this.db.prepare(sql).all(...args) as any[];
    const nodes = all('SELECT * FROM nodes WHERE project_id = ?', projectId);
    const nodeIds = nodes.map((n) => n.id);
    const q = (ids: string[]) => ids.map(() => '?').join(',') || "''";
    const chunked = (sql: (ph: string) => string, ids: string[]): any[] => { const out: any[] = []; for (let i = 0; i < ids.length; i += 400) { const part = ids.slice(i, i + 400); out.push(...all(sql(q(part)), ...part)); } return out; };
    const chats = all('SELECT * FROM chats WHERE project_id = ?', projectId);
    const chatIds = chats.map((c) => c.id);
    const turns = chunked((ph) => `SELECT * FROM turns WHERE chat_id IN (${ph}) ORDER BY chat_id, idx`, chatIds);
    const rounds = chunked((ph) => `SELECT * FROM rounds WHERE chat_id IN (${ph}) ORDER BY created_at`, chatIds);
    const roundIds = rounds.map((r) => r.id);
    const tables: Record<string, any[]> = {
      nodes,
      links: chunked((ph) => `SELECT * FROM links WHERE from_item_id IN (${ph})`, nodeIds),
      chats,
      lit: chunked((ph) => `SELECT * FROM lit WHERE chat_id IN (${ph})`, chatIds),
      turns,
      rounds,
      map_events: all('SELECT * FROM map_events WHERE project_id = ? ORDER BY seq', projectId),
      node_memory: chunked((ph) => `SELECT * FROM node_memory WHERE node_id IN (${ph})`, nodeIds),
      memory_details: chunked((ph) => `SELECT * FROM memory_details WHERE node_id IN (${ph}) ORDER BY id`, nodeIds),
      relations: chunked((ph) => `SELECT * FROM relations WHERE node_id IN (${ph})`, nodeIds),
      conversation_summary: chunked((ph) => `SELECT * FROM conversation_summary WHERE chat_id IN (${ph})`, chatIds),
      favorites: chunked((ph) => `SELECT * FROM favorites WHERE node_id IN (${ph})`, nodeIds),
      filings: chunked((ph) => `SELECT * FROM filings WHERE chat_id IN (${ph})`, chatIds),
      provenance: chunked((ph) => `SELECT * FROM provenance WHERE round_id IN (${ph})`, roundIds),
    };
    const bundle: Record<string, any> = {
      harnessmap_map: 1,
      format: 'harnessmap/map',
      exportedAt: new Date().toISOString(),
      project: { id: proj.id, name: proj.name, createdAt: proj.created_at },
      mainChatId: this.getSetting(`active_chat:${projectId}`) ?? (chats.find((c) => c.status === 'active')?.id ?? chats[0]?.id ?? null),
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      tables,
    };
    // the audit log is machine-wide (no project column); it rides along only on request — the e2e runner asks for it so a
    // test transcript keeps the guard and auto-mode story that explains its map. Rows since the project was born.
    if (opts.audit) bundle.audit = all('SELECT ts, kind, detail FROM audit_log WHERE ts >= ? ORDER BY id', proj.created_at);
    return bundle;
  }

  // Opens a .map bundle as a NEW project — never merged into an existing one. Every id is minted fresh (a map opened
  // twice, or opened where its ids already live, must not collide), and the same renaming is applied inside the JSON
  // columns (alterations, provenance) so the event history still points at the right nodes. Returns the new ids.
  importProject(bundle: any, opts: { name?: string } = {}): { projectId: string; chatId: string | null; nodes: number; events: number } {
    if (!bundle || bundle.harnessmap_map !== 1 || !bundle.tables || !Array.isArray(bundle.tables.nodes) || typeof bundle.project?.name !== 'string') throw new Error('not a HarnessMap .map file');
    const t = bundle.tables as Record<string, any[]>;
    const idMap = new Map<string, string>();
    const fresh = (old: unknown) => { if (typeof old !== 'string' || !old) return old as any; let n = idMap.get(old); if (!n) { n = randomUUID(); idMap.set(old, n); } return n; };
    for (const n of t.nodes ?? []) fresh(n.id);
    for (const c of t.chats ?? []) fresh(c.id);
    for (const r of t.turns ?? []) fresh(r.id);
    for (const r of t.rounds ?? []) fresh(r.id);
    for (const l of t.links ?? []) fresh(l.id);
    for (const e of t.map_events ?? []) fresh(e.id);
    fresh(bundle.project.id);
    const olds = [...idMap.keys()].sort((a, b) => b.length - a.length);
    const rxAll = olds.length ? new RegExp(olds.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
    const rewrite = (v: unknown): unknown => (typeof v === 'string' && rxAll ? v.replace(rxAll, (m) => idMap.get(m) ?? m) : v);
    const projectId = idMap.get(bundle.project.id)!;
    const name = (opts.name ?? bundle.project.name).trim().slice(0, 60) || 'imported map';
    const cols = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((r) => r.name));
    const skipCol: Record<string, Set<string>> = { map_events: new Set(['seq']), memory_details: new Set(['id']) };
    const insertRows = (table: string, rows: any[]) => {
      if (!rows?.length) return;
      const have = cols(table);
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => have.has(k) && !(skipCol[table]?.has(k)));
        if (!keys.length) continue;
        const vals = keys.map((k) => { const v = row[k]; if (v === null || v === undefined) return null; if (typeof v === 'object') return rewrite(JSON.stringify(v)); return rewrite(v); });
        try { this.db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...(vals as any[])); } catch (err) { this.audit('map_import_row_skipped', { table, error: String(err).slice(0, 120) }); }
      }
    };
    let chatId: string | null = null;
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(projectId, name, bundle.project.createdAt ?? new Date().toISOString().slice(0, 19).replace('T', ' '));
      const order = ['nodes', 'links', 'chats', 'lit', 'turns', 'rounds', 'map_events', 'node_memory', 'memory_details', 'relations', 'conversation_summary', 'favorites', 'filings', 'provenance'];
      for (const table of order) insertRows(table, t[table] ?? []);
      // M370 (Mark live, 2026-09-24): an imported map is a read-through SNAPSHOT, never a live host binding.
      // host_session_id is NOT re-minted by fresh() (session ids are host/thread-specific, not ours to
      // rewrite), so an imported chat kept the ORIGINAL session id — and when that session row still exists
      // here (same-instance import) or rode along in an older bundle, the copy ALIASED a live session and the
      // UI announced "live in Codex — type there; everything said there files here." False for a copy: nothing
      // typed anywhere reaches it, and harness_sessions is never even exported. Sever the binding on import so
      // the imported chats are plain read-through logs; a real local host re-attaches later via its own start.
      this.db.prepare('UPDATE chats SET host_session_id = NULL WHERE project_id = ?').run(projectId);
      const main = typeof bundle.mainChatId === 'string' ? idMap.get(bundle.mainChatId) : null;
      const chats = (t.chats ?? []).map((c) => idMap.get(c.id)).filter(Boolean) as string[];
      chatId = main ?? chats[0] ?? null;
      if (chatId) this.setSetting(`active_chat:${projectId}`, chatId);
    });
    tx();
    this.audit('map_imported', { project: projectId.slice(0, 8), name: name.slice(0, 40), nodes: (t.nodes ?? []).length, events: (t.map_events ?? []).length, from: String(bundle.exportedAt ?? '').slice(0, 19) });
    return { projectId, chatId, nodes: (t.nodes ?? []).length, events: (t.map_events ?? []).length };
  }

  // M136: undo stack — inverse operations with pre-images, capped at 20 per
  // project. History is never rewritten; undo APPENDS inverse alterations.
  pushUndo(projectId: string, label: string, inverse: unknown, meta: unknown = null): void {
    this.db.prepare('INSERT INTO undo_stack (project_id, label, inverse, meta) VALUES (?, ?, ?, ?)')
      .run(projectId, label, JSON.stringify(inverse), meta == null ? null : JSON.stringify(meta));
    this.db.prepare('DELETE FROM undo_stack WHERE project_id = ? AND id NOT IN (SELECT id FROM undo_stack WHERE project_id = ? ORDER BY id DESC LIMIT 20)')
      .run(projectId, projectId);
  }

  popUndo(projectId: string): { id: number; label: string; inverse: any[]; meta: any; createdAt: string } | undefined {
    const r = this.db.prepare('SELECT * FROM undo_stack WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(projectId) as any;
    if (!r) return undefined;
    this.db.prepare('DELETE FROM undo_stack WHERE id = ?').run(r.id);
    return { id: r.id, label: r.label, inverse: JSON.parse(r.inverse), meta: r.meta ? JSON.parse(r.meta) : null, createdAt: r.created_at };
  }

  listUndo(projectId: string, limit = 20): { id: number; label: string; createdAt: string }[] {
    return (this.db.prepare('SELECT id, label, created_at FROM undo_stack WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit) as any[])
      .map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
  }

  // M368 (Jacob 2026-09-21, "still wrong in actual practice"): a one-time,
  // REVERSIBLE sweep of legacy host-scaffold subtrees that were mis-filed
  // BEFORE M366 stripped them (e.g. the 46-node "Available plugins" tree the
  // GPT app's <recommended_plugins> turn produced on his real map). M366 stops
  // NEW ones; this cleans the ones already sitting in a map.
  //
  // DETECTION is round-based and reuses the PROVEN M366 stripper — never a
  // title/content guess. A round is "scaffold-dominant" when its filing's raw
  // user turn was almost entirely host scaffold: stripHostScaffold removed ≥90%
  // of it and the real residual is ≤40 chars (a bare UI command like "open
  // map"). Every node created in such a round came from the scaffold, so the
  // whole subtree of each is swept — EXCEPT any node a human has since edited
  // (a map_event with source_kind 'user_edit'), which is left in place (it pops
  // up to its parent when its scaffold parent is removed — the updateNode
  // safety). Removal is soft (status 'removed', the same reversible delete the
  // ✕ button uses) and pushes ONE undo entry restoring every node's parent and
  // status. Idempotent per project via a settings flag. strip/looks are
  // injected so the store keeps no dependency on the agent adapter.
  sweepLegacyScaffold(
    projectId: string,
    deps: { strip: (s: string) => string; looks: (s: string) => boolean },
    opts: { dryRun?: boolean; force?: boolean } = {},
  ): { swept: boolean; alreadyDone: boolean; rounds: number; removed: { id: string; title: string | null; status: string }[] } {
    const FLAG = `scaffold_swept_v1:${projectId}`;
    if (!opts.force && !opts.dryRun && this.getSetting(FLAG)) return { swept: false, alreadyDone: true, rounds: 0, removed: [] };

    // 1) scaffold-dominant rounds, via the M366 stripper on each filing's raw turn.
    const fil = this.db.prepare('SELECT round_id, user_text FROM filings WHERE round_id IS NOT NULL AND user_text IS NOT NULL').all() as any[];
    const scaffoldRounds: string[] = [];
    for (const f of fil) {
      const orig = String(f.user_text);
      if (!orig) continue;
      const residual = deps.strip(orig).trim();
      const removedChars = orig.length - residual.length;
      if (deps.looks(orig.trimStart()) && removedChars >= orig.length * 0.9 && residual.length <= 40) scaffoldRounds.push(String(f.round_id));
    }
    if (!scaffoldRounds.length) {
      if (!opts.dryRun) this.setSetting(FLAG, new Date().toISOString());
      return { swept: false, alreadyDone: false, rounds: 0, removed: [] };
    }

    // 2) node ids created in those rounds (scoped to this project).
    const seeds = new Set<string>();
    const ph = scaffoldRounds.map(() => '?').join(',');
    const evs = this.db.prepare(`SELECT alteration FROM map_events WHERE project_id = ? AND round_id IN (${ph}) AND alteration LIKE '%create_node%'`).all(projectId, ...scaffoldRounds) as any[];
    for (const e of evs) { try { const a = JSON.parse(e.alteration); if (a.op === 'create_node' && a.id) seeds.add(String(a.id)); } catch { /* skip */ } }

    // 3) expand to subtrees over the CURRENT tree.
    const nodes = this.getNodes(projectId);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const kids = new Map<string, string[]>();
    for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n.id);
    const target = new Set<string>();
    const stack = [...seeds];
    while (stack.length) {
      const id = stack.pop()!;
      if (target.has(id) || !byId.has(id)) continue;
      target.add(id);
      for (const c of (kids.get(id) ?? [])) stack.push(c);
    }

    // 4) never sweep a node a human has edited (explicit user_edit event).
    const humanEdited = (id: string): boolean => {
      const rows = this.db.prepare("SELECT alteration, source_kind FROM map_events WHERE source_kind = 'user_edit' AND alteration LIKE ?").all(`%"id":"${id}"%`) as any[];
      for (const r of rows) { try { const a = JSON.parse(r.alteration); if (a.id === id && (a.op === 'update_node' || a.op === 'move_node')) return true; } catch { /* skip */ } }
      return false;
    };
    const removeNodes = [...target]
      .map((id) => byId.get(id)!)
      .filter((n) => n.status !== 'removed' && !humanEdited(n.id));

    if (opts.dryRun) {
      return { swept: false, alreadyDone: false, rounds: scaffoldRounds.length, removed: removeNodes.map((n) => ({ id: n.id, title: n.title ?? null, status: n.status })) };
    }
    if (!removeNodes.length) {
      this.setSetting(FLAG, new Date().toISOString());
      return { swept: false, alreadyDone: false, rounds: scaffoldRounds.length, removed: [] };
    }

    // 5) undo inverse restores each node's parent then status; record before mutating.
    const inverse = removeNodes.flatMap((n) => [
      { op: 'move_node', id: n.id, parentId: n.parentId ?? null },
      { op: 'update_node', id: n.id, status: n.status },
    ]);
    // Remove deepest-first so scaffold children don't transiently pop up.
    const depth = (n: MapNode): number => { let d = 0; for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) { d++; if (d > 64) break; } return d; };
    for (const n of removeNodes.slice().sort((a, b) => depth(b) - depth(a))) this.updateNode(n.id, { status: 'removed' });
    this.pushUndo(projectId, `tidied ${removeNodes.length} host-scaffold node${removeNodes.length === 1 ? '' : 's'}`, inverse, { kind: 'scaffold_sweep' });
    this.setSetting(FLAG, new Date().toISOString());
    this.audit('scaffold_sweep', { rounds: scaffoldRounds.length, removed: removeNodes.length });
    return { swept: true, alreadyDone: false, rounds: scaffoldRounds.length, removed: removeNodes.map((n) => ({ id: n.id, title: n.title ?? null, status: n.status })) };
  }

  // M159b: local feedback log — what the user chose to report (never sent
  // anywhere by us; the GitHub issue is theirs to submit).
  addFeedback(text: string, source: string): void {
    this.db.prepare('INSERT INTO feedback (text, source) VALUES (?, ?)').run(text.slice(0, 1000), source);
  }
  listFeedback(limit = 50): { id: number; text: string; source: string; createdAt: string }[] {
    return (this.db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').all(limit) as any[])
      .map((r) => ({ id: r.id, text: r.text, source: r.source, createdAt: r.created_at }));
  }

  // M113: dev traces — full prompts/responses, ring-capped, local only.
  addTrace(t: { kind: string; task: string; model?: string; backend?: string; ms?: number; ok?: boolean; system?: string; user?: string; response?: string }): void {
    this.db.prepare('INSERT INTO dev_traces (kind, task, model, backend, ms, ok, system, user, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.kind, t.task, t.model ?? null, t.backend ?? null, t.ms ?? null, t.ok === false ? 0 : 1, t.system ?? null, t.user ?? null, t.response ?? null);
    this.db.prepare('DELETE FROM dev_traces WHERE id NOT IN (SELECT id FROM dev_traces ORDER BY id DESC LIMIT 5000)').run();
  }

  getTraces(limit = 50, task?: string): any[] {
    return task
      ? this.db.prepare('SELECT * FROM dev_traces WHERE task = ? ORDER BY id DESC LIMIT ?').all(task, limit)
      : this.db.prepare('SELECT * FROM dev_traces ORDER BY id DESC LIMIT ?').all(limit);
  }

  // M107: fresh marks — set by FILER changes, cleared by user interaction.
  markFresh(nodeId: string, kind: 'new' | 'changed'): void {
    const cur = (this.db.prepare('SELECT kind FROM fresh_marks WHERE node_id = ?').get(nodeId) as any)?.kind;
    if (cur === 'new') return; // "new" outranks "changed"
    this.db.prepare("INSERT OR REPLACE INTO fresh_marks (node_id, kind, created_at) VALUES (?, ?, datetime('now'))").run(nodeId, kind);
  }

  clearMark(nodeId: string): void {
    this.db.prepare('DELETE FROM fresh_marks WHERE node_id = ?').run(nodeId);
  }

  clearAllMarks(projectId: string): number {
    return this.db.prepare('DELETE FROM fresh_marks WHERE node_id IN (SELECT id FROM nodes WHERE project_id = ?)').run(projectId).changes;
  }

  getMarks(projectId: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare('SELECT m.node_id, m.kind FROM fresh_marks m JOIN nodes n ON n.id = m.node_id WHERE n.project_id = ?').all(projectId) as any[]) out[r.node_id] = r.kind;
    return out;
  }

  // M84: search history + favorites.
  recordSearch(query: string): void {
    const q = query.trim().slice(0, 120);
    if (!q) return;
    const last = this.db.prepare('SELECT query FROM search_history ORDER BY id DESC LIMIT 1').get() as any;
    if (last?.query === q) return; // no consecutive duplicates
    this.db.prepare('INSERT INTO search_history (query) VALUES (?)').run(q);
    this.db.prepare('DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY id DESC LIMIT 20)').run();
  }

  getSearchHistory(limit = 10): string[] {
    return (this.db.prepare('SELECT query FROM search_history ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => r.query);
  }

  setFavorite(nodeId: string, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO favorites (node_id) VALUES (?)').run(nodeId);
    else this.db.prepare('DELETE FROM favorites WHERE node_id = ?').run(nodeId);
  }

  getFavorites(): string[] {
    return (this.db.prepare('SELECT node_id FROM favorites ORDER BY created_at').all() as any[]).map((r) => r.node_id);
  }

  // countIt: background precomputes count toward the per-dot cap; click-side
  // refreshes are free (the user already paid for that compute).
  setSuggestionProposal(id: string, proposal: string, hash: string, countIt = false): void {
    this.db.prepare(`UPDATE suggestions SET proposal = ?, proposal_hash = ?, proposal_count = proposal_count + ${countIt ? 1 : 0} WHERE id = ?`).run(proposal, hash, id);
  }

  getSuggestionProposal(id: string): { proposal: string | null; hash: string | null; count: number } {
    const r = this.db.prepare('SELECT proposal, proposal_hash, proposal_count FROM suggestions WHERE id = ?').get(id) as any;
    return { proposal: r?.proposal ?? null, hash: r?.proposal_hash ?? null, count: r?.proposal_count ?? 0 };
  }

  setSuggestionStatus(id: string, status: 'dismissed' | 'done'): void {
    this.db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, id);
  }

  // Dry-run: apply alterations inside a transaction, render, roll back.
  // Used by reorganize's before/after preview — nothing is persisted.
  previewAlterations(projectId: string, alterations: Alteration[], render: () => string): string {
    let out = '';
    const sentinel = new Error('rollback');
    try {
      this.db.transaction(() => {
        for (const a of alterations) {
          if (a.op === 'suggest_restructure') continue;
          this.project(projectId, a);
        }
        out = render();
        throw sentinel;
      })();
    } catch (e) {
      if (e !== sentinel) throw e;
    }
    return out;
  }

  // Rebuild the whole projection from the event log (defensive, idempotent —
  // and the two-table → nodes migration path).
  rebuildProjection(projectId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM links WHERE from_item_id IN (SELECT id FROM nodes WHERE project_id = ?)').run(projectId);
      this.db.prepare('DELETE FROM nodes WHERE project_id = ?').run(projectId);
      const rows = this.db.prepare('SELECT alteration FROM map_events WHERE project_id = ? ORDER BY seq').all(projectId) as any[];
      for (const r of rows) this.project(projectId, JSON.parse(r.alteration) as Alteration);
    });
    tx();
  }

  private project(projectId: string, a: Alteration): void {
    try {
      switch (a.op) {
        // ---- canonical node ops ----
        case 'create_node': {
          this.createNode({ id: a.id, projectId, parentId: a.parentId ?? null, content: a.content, type: a.type ?? null, status: a.status ?? 'live', author: a.author ?? 'agent', title: (a as any).title ?? null });
          // Cycle guard for creation (found 2026-09-06: a find-and-file batch
          // declared two nodes as each other's parent — the second create
          // closed the loop the first had left dangling — and every tree walk
          // then ran until the OOM killer took the server). After the create,
          // the new node's ancestor chain must not come back to it; if it
          // does, the NEW node goes to top level and the audit says so.
          {
            const hops = new Set<string>([a.id]);
            let cyc = false;
            for (let anc = a.parentId ? this.getNode(a.parentId) : undefined; anc; anc = anc.parentId ? this.getNode(anc.parentId) : undefined) {
              if (hops.has(anc.id)) { cyc = true; break; }
              hops.add(anc.id);
            }
            if (cyc) { this.moveNode(a.id, null); this.audit('create_cycle_guard', { id: String(a.id).slice(0, 8), parent: String(a.parentId).slice(0, 8), rehomed: 'top' }); }
          }
          break;
        }
        case 'update_node':
          this.updateNode(a.id, { content: a.content, status: a.status, type: a.type, title: (a as any).title });
          break;
        case 'move_node': {
          // Cycle guard (found live: a tidy proposal moved a container under
          // its own child — preview rendering then recursed forever). A move
          // that would make a node its own ancestor is skipped, from any source.
          let cyc = a.parentId === a.id;
          for (let anc = a.parentId ? this.getNode(a.parentId) : undefined; anc && !cyc; anc = anc.parentId ? this.getNode(anc.parentId) : undefined) {
            if (anc.id === a.id) cyc = true;
          }
          if (cyc) { this.audit('move_cycle_guard', { id: String(a.id).slice(0, 8), skipped: true }); break; }
          this.moveNode(a.id, a.parentId);
          break;
        }
        case 'create_link':
          this.createLink({ id: a.id, type: a.type, fromItemId: a.fromItemId, toId: a.toId, toKind: a.toKind ?? 'item' });
          break;
        case 'set_focus':
          break; // session-level, not map state
        // ---- legacy ops (replay-only): the old two-table vocabulary ----
        case 'create_container':
          this.createNode({ id: a.id, projectId, parentId: a.parentId ?? null, content: a.name, type: null, status: a.status ?? 'provisional', author: a.author ?? 'agent' });
          break;
        case 'update_container':
          this.updateNode(a.id, { content: a.name, status: a.status });
          break;
        case 'create_item':
          this.createNode({ id: a.id, projectId, parentId: a.homeContainerId, content: a.content, type: a.type, status: a.status, author: a.author ?? 'agent' });
          break;
        case 'update_item':
          this.updateNode(a.id, { content: a.content, status: a.status, type: (a as any).type });
          break;
        case 'rehome_item':
          this.moveNode(a.id, a.homeContainerId);
          break;
      }
    } catch (err) {
      // A malformed alteration must never poison the projection; it is logged
      // in map_events regardless, so a fixed projector can replay it later.
      console.error('[store] projection skipped malformed alteration:', a.op, err);
    }
  }
}

function rowToNode(r: any): MapNode {
  return {
    id: r.id, projectId: r.project_id, parentId: r.parent_id, content: r.content,
    type: r.type, status: r.status, author: r.author, createdAt: r.created_at, updatedAt: r.updated_at,
    title: r.title ?? null,
  };
}

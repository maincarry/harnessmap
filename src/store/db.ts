// The store. bun:sqlite (native driver builds fail under bun; keep every DB
// touch inside this file). Event-sourced: map_events is the source of truth,
// nodes is a rebuildable projection.
//
// v0.4 NODES UNIFICATION: one kind of thing. The legacy containers/items
// tables are frozen (read-only backup); the projection now targets `nodes`,
// and legacy map_events ops replay into nodes — which IS the migration.
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Alteration, Chat, Link, MapNode, RoundResult, Suggestion, Turn,
} from '../types.js';

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
    this.db.prepare('INSERT OR IGNORE INTO lit (chat_id, container_id) SELECT ?, container_id FROM lit WHERE chat_id = ?').run(toChatId, fromChatId);
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
      sdkSessionId: r.sdk_session_id, status: r.status, createdAt: r.created_at,
    }));
  }

  getChat(id: string): Chat | undefined {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id, projectId: r.project_id, focusContainerId: r.focus_container_id,
      sdkSessionId: r.sdk_session_id, status: r.status, createdAt: r.created_at,
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

  // ---- lit set ----
  setLit(chatId: string, nodeId: string, on: boolean): void {
    if (on) {
      this.db.prepare('INSERT OR IGNORE INTO lit (chat_id, container_id) VALUES (?, ?)').run(chatId, nodeId);
    } else {
      this.db.prepare('DELETE FROM lit WHERE chat_id = ? AND container_id = ?').run(chatId, nodeId);
    }
  }

  getLit(chatId: string): string[] {
    return (this.db.prepare('SELECT container_id FROM lit WHERE chat_id = ?').all(chatId) as any[]).map((r) => r.container_id);
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
    this.db.prepare('DELETE FROM dev_traces WHERE id NOT IN (SELECT id FROM dev_traces ORDER BY id DESC LIMIT 200)').run();
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
        case 'create_node':
          this.createNode({ id: a.id, projectId, parentId: a.parentId ?? null, content: a.content, type: a.type ?? null, status: a.status ?? 'live', author: a.author ?? 'agent', title: (a as any).title ?? null });
          break;
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

import { Store } from '../store/db.js';

// M58: the harness adapter's transcript reader. Claude Code transcripts are
// JSONL; each entry has a uuid. We slice "the round" = everything after the
// last uuid we observed for that session, and extract what the filer and the
// provenance index need. Server-side so every hook stays a dumb HTTP call.

export interface RoundSlice {
  userText: string;
  assistantText: string;
  toolRefs: { id: string; name: string; summary: string }[];
  filePaths: string[];
  urls: string[];
  messageUuids: string[];
  lastUuid: string | null;
}

export async function sliceRound(transcriptPath: string, afterUuid: string | null): Promise<RoundSlice> {
  const out: RoundSlice = { userText: '', assistantText: '', toolRefs: [], filePaths: [], urls: [], messageUuids: [], lastUuid: afterUuid };
  let lines: any[] = [];
  try {
    lines = (await Bun.file(transcriptPath).text()).trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    return out;
  }
  let started = afterUuid === null;
  const assistantParts: string[] = [];
  for (const m of lines) {
    if (!started) {
      if (m.uuid === afterUuid) started = true;
      continue;
    }
    if (m.uuid) { out.messageUuids.push(m.uuid); out.lastUuid = m.uuid; }
    const content = m.message?.content;
    if (m.type === 'user' && !m.isMeta) {
      const texts = Array.isArray(content)
        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text)
        : [typeof content === 'string' ? content : ''];
      const t = texts.join('\n').trim();
      if (t) out.userText = out.userText ? `${out.userText}\n${t}` : t;
    }
    if (m.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) assistantParts.push(b.text);
        if (b.type === 'tool_use') {
          const input = b.input ?? {};
          out.toolRefs.push({ id: b.id, name: b.name, summary: JSON.stringify(input).slice(0, 160) });
          if (typeof input.file_path === 'string') out.filePaths.push(input.file_path);
          if (typeof input.url === 'string') out.urls.push(input.url);
          if (typeof input.notebook_path === 'string') out.filePaths.push(input.notebook_path);
        }
      }
    }
  }
  out.assistantText = assistantParts.join('\n');
  out.filePaths = [...new Set(out.filePaths)];
  out.urls = [...new Set(out.urls)];
  return out;
}

export function recordSessionStart(store: Store, sessionId: string, nodeId: string | null, transcriptPath: string | null, cwd: string | null = null): void {
  (store as any).db.prepare(`INSERT INTO harness_sessions (session_id, node_id, transcript_path, last_active, cwd)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(session_id) DO UPDATE SET last_active = datetime('now'),
      transcript_path = COALESCE(excluded.transcript_path, transcript_path),
      cwd = COALESCE(excluded.cwd, cwd)`)
    .run(sessionId, nodeId, transcriptPath, cwd);
}

// Host project dirs with recent activity — MAP.md write targets.
export function activeCwds(store: Store): string[] {
  return ((store as any).db.prepare(
    "SELECT DISTINCT cwd FROM harness_sessions WHERE cwd IS NOT NULL AND last_active > datetime('now', '-7 days')",
  ).all() as any[]).map((r) => r.cwd);
}

// M60: bounded reconstruction — how many map events since the last FULL
// injection for this session (deltas advance injected_seq, not full_seq).
export function getFullAnchor(store: Store, sessionId: string): number | null {
  const r = (store as any).db.prepare('SELECT full_seq FROM harness_sessions WHERE session_id = ?').get(sessionId) as any;
  return r?.full_seq ?? null;
}

export function setFullAnchor(store: Store, sessionId: string, seq: number): void {
  (store as any).db.prepare(`INSERT INTO harness_sessions (session_id, full_seq, injected_seq, last_active)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET full_seq = excluded.full_seq, injected_seq = excluded.injected_seq, last_active = datetime('now')`)
    .run(sessionId, seq, seq);
}

export function getSession(store: Store, sessionId: string): { lastUuid: string | null } {
  const r = (store as any).db.prepare('SELECT last_uuid FROM harness_sessions WHERE session_id = ?').get(sessionId) as any;
  return { lastUuid: r?.last_uuid ?? null };
}

export function advanceSession(store: Store, sessionId: string, lastUuid: string | null, transcriptPath: string | null): void {
  (store as any).db.prepare(`INSERT INTO harness_sessions (session_id, last_uuid, transcript_path, last_active)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET last_uuid = excluded.last_uuid, last_active = datetime('now'),
      transcript_path = COALESCE(excluded.transcript_path, transcript_path)`)
    .run(sessionId, lastUuid, transcriptPath);
}

// M59: delta injection. The full map block goes in once per session (and
// again after compaction); afterwards only changes since the anchored
// map-event seq are injected — usually a few lines, often nothing.
export function getInjectionAnchor(store: Store, sessionId: string): number | null {
  const r = (store as any).db.prepare('SELECT injected_seq FROM harness_sessions WHERE session_id = ?').get(sessionId) as any;
  return r?.injected_seq ?? null;
}

export function setInjectionAnchor(store: Store, sessionId: string, seq: number): void {
  (store as any).db.prepare(`INSERT INTO harness_sessions (session_id, injected_seq, last_active)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET injected_seq = excluded.injected_seq, last_active = datetime('now')`)
    .run(sessionId, seq);
}

export function resetInjectionAnchor(store: Store, sessionId: string): void {
  (store as any).db.prepare('UPDATE harness_sessions SET injected_seq = NULL WHERE session_id = ?').run(sessionId);
}

export function currentSeq(store: Store, projectId: string): number {
  const r = (store as any).db.prepare('SELECT COALESCE(MAX(seq), 0) s FROM map_events WHERE project_id = ?').get(projectId) as any;
  return r?.s ?? 0;
}

// Render the map changes since seq, compactly. Returns null when nothing
// user-visible changed (caller injects nothing).
export function renderDelta(store: Store, projectId: string, sinceSeq: number): string | null {
  const rows = (store as any).db.prepare('SELECT seq, alteration FROM map_events WHERE project_id = ? AND seq > ? ORDER BY seq').all(projectId, sinceSeq) as any[];
  if (rows.length === 0) return null;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const a = JSON.parse(r.alteration);
    const id = a.id ?? a.nodeId;
    const n = id ? store.getNode(id) : undefined;
    const name = n ? (n.title || n.content.slice(0, 60)) : (a.content ?? a.name ?? '?')?.slice?.(0, 60);
    let line = '';
    if (a.op === 'create_node' || a.op === 'create_item' || a.op === 'create_container') line = `+ added: ${name}${n?.parentId ? ` (under ${(store.getNode(n.parentId)?.title || store.getNode(n.parentId)?.content || '?').slice(0, 40)})` : ''}`;
    else if ((a.op === 'update_node' || a.op === 'update_item' || a.op === 'update_container') && (a.status === 'removed')) line = `- removed: ${name}`;
    else if (a.op === 'update_node' || a.op === 'update_item' || a.op === 'update_container') line = `~ updated: ${name}${a.status ? ` → ${a.status}` : ''}`;
    else if (a.op === 'move_node' || a.op === 'rehome_item') line = `→ moved: ${name}`;
    else continue;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length === 0) return null;
  const MAX = 25;
  const shown = lines.slice(-MAX);
  return [
    `[harnessmap — map changes since your last update${lines.length > MAX ? ` (${lines.length - MAX} earlier changes omitted)` : ''}]`,
    ...shown,
  ].join('\n');
}

export function recordProvenance(store: Store, roundId: string, sessionId: string | null, slice: RoundSlice): void {
  (store as any).db.prepare('INSERT OR REPLACE INTO provenance (round_id, session_id, message_uuids, tool_refs, file_paths, urls) VALUES (?, ?, ?, ?, ?, ?)')
    .run(roundId, sessionId, JSON.stringify(slice.messageUuids), JSON.stringify(slice.toolRefs), JSON.stringify(slice.filePaths), JSON.stringify(slice.urls));
}

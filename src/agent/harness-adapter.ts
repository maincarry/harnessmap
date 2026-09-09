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

// M245 (Mark: "make sure it natively supports codex"): Codex writes its own
// transcript — a ROLLOUT under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Every line is { timestamp, type, payload }: 'session_meta' (cwd, id,
// cli_version), 'response_item' (payload.type 'message' with role and
// content[{type:'input_text'|'output_text'|'text', text}], 'function_call'
// with name and arguments, …), 'event_msg' (user_message / agent_message
// with .message). Lines carry no uuid, so the anchor is the line index
// ("line:<n>"). Tolerant on purpose — Codex's format drifts; unknown lines
// are skipped, never fatal. Verified per machine by test-codex (it parses the
// newest rollout on disk).
export function isCodexRollout(lines: any[]): boolean {
  return lines.length > 0 && lines.slice(0, 3).some((m) => m && typeof m === 'object' && 'payload' in m && (m.type === 'session_meta' || m.type === 'response_item' || m.type === 'event_msg' || m.type === 'turn_context'));
}
// Injected scaffolding Codex records as user messages — never the user's words.
const CODEX_SCAFFOLD = /^\s*<(environment_context|user_instructions|permissions|turn_aborted|hook_context|system_context|instructions)/i;
export function codexTurnOf(m: any): { role: 'user' | 'assistant'; text: string } | null {
  const p = m?.payload; if (!p || typeof p !== 'object') return null;
  if (m.type === 'response_item' && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    const text = (Array.isArray(p.content) ? p.content : [])
      .filter((b: any) => b && typeof b.text === 'string' && /^(input_text|output_text|text)$/.test(String(b.type ?? 'text')))
      .map((b: any) => b.text).join('\n').trim();
    if (!text || (p.role === 'user' && CODEX_SCAFFOLD.test(text))) return null;
    return { role: p.role, text };
  }
  return null;
}
function codexEventTurnOf(m: any): { role: 'user' | 'assistant'; text: string } | null {
  const p = m?.payload; if (m?.type !== 'event_msg' || !p || typeof p !== 'object') return null;
  const text = String(p.message ?? '').trim(); if (!text) return null;
  if (p.type === 'user_message') return CODEX_SCAFFOLD.test(text) ? null : { role: 'user', text };
  if (p.type === 'agent_message') return { role: 'assistant', text };
  return null;
}
export function codexSessionMeta(lines: any[]): { cwd?: string; id?: string; cli_version?: string; timestamp?: string } | null {
  const m = lines.find((l) => l?.type === 'session_meta'); const p = m?.payload;
  return p && typeof p === 'object' ? { cwd: p.cwd, id: p.id, cli_version: p.cli_version, timestamp: p.timestamp ?? m.timestamp } : null;
}
function sliceCodexRound(lines: any[], afterAnchor: string | null): RoundSlice {
  const out: RoundSlice = { userText: '', assistantText: '', toolRefs: [], filePaths: [], urls: [], messageUuids: [], lastUuid: afterAnchor };
  const from = afterAnchor && /^line:\d+$/.test(afterAnchor) ? Number(afterAnchor.slice(5)) + 1 : 0;
  const userParts: string[] = []; const assistantParts: string[] = []; let sawResponseItems = false;
  const evUser: string[] = []; const evAssistant: string[] = [];
  for (let i = from; i < lines.length; i++) {
    const m = lines[i]; if (!m || typeof m !== 'object') continue;
    out.lastUuid = `line:${i}`;
    const t = codexTurnOf(m);
    if (t) { sawResponseItems = true; (t.role === 'user' ? userParts : assistantParts).push(t.text); continue; }
    const e = codexEventTurnOf(m);
    if (e) { (e.role === 'user' ? evUser : evAssistant).push(e.text); continue; }
    const p = m.payload;
    if (m.type === 'response_item' && p && (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call')) {
      let args: any = {}; try { args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.arguments ?? p.input ?? {}); } catch { args = { raw: String(p.arguments ?? '').slice(0, 160) }; }
      out.toolRefs.push({ id: String(p.call_id ?? p.id ?? `codex-${i}`), name: String(p.name ?? p.type), summary: JSON.stringify(args).slice(0, 160) });
      for (const k of ['file_path', 'path', 'notebook_path']) if (typeof args[k] === 'string') out.filePaths.push(args[k]);
      if (typeof args.url === 'string') out.urls.push(args.url);
    }
  }
  // response_item messages are the record; event_msg lines duplicate them — use those only when the record has none
  out.userText = (sawResponseItems ? userParts : evUser).join('\n');
  out.assistantText = (sawResponseItems ? assistantParts : evAssistant).join('\n');
  out.filePaths = [...new Set(out.filePaths)]; out.urls = [...new Set(out.urls)];
  return out;
}

export async function sliceRound(transcriptPath: string, afterUuid: string | null): Promise<RoundSlice> {
  const out: RoundSlice = { userText: '', assistantText: '', toolRefs: [], filePaths: [], urls: [], messageUuids: [], lastUuid: afterUuid };
  let lines: any[] = [];
  try {
    lines = (await Bun.file(transcriptPath).text()).trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } });
  } catch {
    return out;
  }
  if (isCodexRollout(lines)) return sliceCodexRound(lines, afterUuid);
  let started = afterUuid === null;
  const assistantParts: string[] = [];
  for (const m of lines) {
    if (!m) continue;
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

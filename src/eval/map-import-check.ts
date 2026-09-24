// M370 (Mark, live 2026-09-24): importing a .map file must open a read-through SNAPSHOT, never a live host
// binding. host_session_id is host/thread-specific and is NOT re-minted by importProject's fresh() id
// rewrite, so an imported chat kept the ORIGINAL session id — and when that session row still lived in the
// importer's DB (same-instance import) the copy ALIASED a live session, so the UI announced
// "live in Codex — type there; everything said there files here." False for a copy. The fix severs the
// binding on import (host_session_id -> NULL). This test pins that, and guards the export/import round-trip.
// Usage: bun run src/eval/map-import-check.ts
import { Store } from '../store/db.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const dbp = join(mkdtempSync(join(tmpdir(), 'mapimport-')), 'm.sqlite');
const store = new Store(dbp);
const db = (store as any).db;

// A source project whose main chat is a LIVE Codex host session (Jacob's live-testing shape).
const pid = randomUUID(); const chatId = randomUUID(); const sid = 'jacob-codex-session-abc';
const rootId = randomUUID();
db.prepare('INSERT INTO projects (id,name,created_at) VALUES (?,?,?)').run(pid, 'Jacobs Map', '2026-09-24 01:00:00');
store.applyAlterations(pid, [{ op: 'create_node', id: rootId, parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any], { kind: 'system' } as any);
store.createChat({ id: chatId, projectId: pid, focusContainerId: rootId, sdkSessionId: null } as any);
db.prepare('UPDATE chats SET host_session_id = ? WHERE id = ?').run(sid, chatId);
const hcols = (db.prepare('PRAGMA table_info(harness_sessions)').all() as any[]).map((r: any) => r.name);
const hv: any = { session_id: sid, chat_id: chatId, harness: 'codex', title: 'Maoism chat', status: 'live', transcript_path: '/Users/jacob/.codex/sessions/x.jsonl' };
const hk = Object.keys(hv).filter((k) => hcols.includes(k));
db.prepare(`INSERT INTO harness_sessions (${hk.join(',')}) VALUES (${hk.map(() => '?').join(',')})`).run(...hk.map((k) => hv[k]));
db.prepare('INSERT INTO turns (id,chat_id,idx,role,content,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), chatId, 1, 'user', 'lets work on maoism', '2026-09-24 01:01:00');

// Round-trip: export, then import as a new project INTO THE SAME DB (the same-instance case that aliased).
const bundle = store.exportProject(pid);
ok('export carries the chat and its turns', bundle.tables.chats.length === 1 && bundle.tables.turns.length === 1);
const res = store.importProject(bundle, { name: 'Imported Jacob Map' });
ok('import mints a NEW project id', res.projectId !== pid);
ok('import mints a NEW chat id', res.chatId !== chatId);

const nc = db.prepare('SELECT id, host_session_id FROM chats WHERE id = ?').get(res.chatId) as any;
// THE FIX: the imported chat is not bound to any host session (no false "live in Codex" strip).
ok('imported chat has NO host binding (host_session_id NULL)', nc && nc.host_session_id === null);
ok('imported chat does NOT alias the original live session id', nc && nc.host_session_id !== sid);
// The original project is untouched — still live.
const oc = db.prepare('SELECT host_session_id FROM chats WHERE id = ?').get(chatId) as any;
ok('original chat still bound to its live session', oc && oc.host_session_id === sid);
// The conversation is still READABLE in the import (read-through snapshot, just not a live binding).
const it = db.prepare('SELECT content FROM turns WHERE chat_id = ? ORDER BY idx').all(res.chatId) as any[];
ok('imported chat keeps its turns (read-through log)', it.length === 1 && /maoism/.test(it[0].content));

console.log(`\nmap-import: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

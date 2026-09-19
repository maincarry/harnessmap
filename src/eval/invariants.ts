// Structural invariant sweep over kept e2e databases — usage: bun run src/eval/invariants.ts /tmp/claude-1000/harnessmap-e2e-*/e2e.sqlite (Jacob, 2026-09-18: "conflicts between brain and its governors, structural breakdown").
import { Database } from 'bun:sqlite';
const files = Bun.argv.slice(2);
const totals: Record<string, number> = {};
const hit = (name: string, db: string, detail: string, acc: string[]) => { totals[name] = (totals[name] ?? 0) + 1; acc.push(`${name}: ${detail}`); };
for (const f of files) {
  const tag = f.replace(/.*harnessmap-e2e-/, '').replace(/\/e2e.sqlite$/, '');
  let db: Database; try { db = new Database(f, { readonly: true }); } catch (e) { console.log(tag, 'OPEN FAIL', String(e)); continue; }
  const out: string[] = [];
  try {
  const nodes = db.query('select * from nodes').all() as any[];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = nodes.filter((n) => n.status !== 'removed');
  // 1. cycles / self parent / depth
  for (const n of live) {
    let cur = n, depth = 0; const seen = new Set<string>();
    while (cur && cur.parent_id) { if (seen.has(cur.id) || cur.parent_id === cur.id) { hit('parent_cycle', tag, `${n.id.slice(0, 8)}`, out); break; } seen.add(cur.id); cur = byId.get(cur.parent_id); depth++; if (!cur) { hit('parent_missing', tag, `${n.id.slice(0, 8)} → ${seen.size} up`, out); break; } if (cur.status === 'removed') { hit('live_under_removed', tag, `${n.id.slice(0, 8)} "${(n.title || n.content).slice(0, 40)}" under removed ${cur.id.slice(0, 8)}`, out); break; } }
    if (depth > 7) hit('depth_gt_7', tag, `${n.id.slice(0, 8)} depth ${depth}`, out);
  }
  // 2. to sort
  const ts = nodes.filter((n) => n.content.startsWith('to sort'));
  if (ts.length !== 1) hit('tosort_count', tag, `${ts.length}`, out);
  for (const t of ts) { if (t.status === 'removed') hit('tosort_removed', tag, t.id.slice(0, 8), out); if (t.parent_id) hit('tosort_moved', tag, `${t.id.slice(0, 8)} under ${t.parent_id.slice(0, 8)}`, out); if (t.title && t.title !== 'to sort') hit('tosort_renamed', tag, t.title, out); }
  // 3. events: replay for parity, root rewrites, demotions
  const events = db.query('select seq, alteration, source_kind, created_at from map_events order by seq').all() as any[];
  const sim = new Map<string, { parent: string | null; removed: boolean; content: string; origin: string; originParent: string | null }>();
  for (const e of events) {
    let a: any; try { a = JSON.parse(e.alteration); } catch { hit('event_unparsable', tag, `seq ${e.seq}`, out); continue; }
    const k = e.source_kind;
    if (a.op === 'create_node') { if (sim.has(a.id)) hit('event_create_dupe', tag, `${String(a.id).slice(0, 8)} seq ${e.seq}`, out); sim.set(a.id, { parent: a.parentId ?? null, removed: false, content: a.content ?? '', origin: k, originParent: a.parentId ?? null }); if (a.parentId && !sim.has(a.parentId) && k === 'round') hit('event_create_under_unknown', tag, `${String(a.id).slice(0, 8)} under ${String(a.parentId).slice(0, 8)} seq ${e.seq}`, out); }
    else if (a.op === 'update_node') { const s = sim.get(a.id); if (!s) { if (k === 'round') hit('event_update_unknown', tag, `${String(a.id).slice(0, 8)} seq ${e.seq}`, out); continue; } if (s.origin === 'system' && s.content === 'untitled' && k === 'round' && a.content) hit('root_rewritten_by_round', tag, `→ "${String(a.content).slice(0, 50)}"`, out); if (s.origin === 'user_edit' && k === 'round' && a.content && a.content !== s.content && !s.content.startsWith('to sort')) hit('seed_rewritten_by_round', tag, `"${s.content.slice(0, 30)}" → "${String(a.content).slice(0, 40)}"`, out); if (a.content !== undefined) s.content = a.content; if (a.status === 'removed' && !s.removed) { s.removed = true; for (const [, c] of sim) if (c.parent === a.id && !c.removed) c.parent = s.parent; } else if (a.status && a.status !== 'removed' && s.removed) s.removed = false; else if (s.removed && k === 'round') hit('event_update_removed', tag, `${String(a.id).slice(0, 8)} seq ${e.seq}`, out); }
    else if (a.op === 'move_node') { const s = sim.get(a.id); if (!s) { hit('event_move_unknown', tag, `${String(a.id).slice(0, 8)}`, out); continue; } if (s.originParent === null && (s.origin === 'user_edit' || s.origin === 'system') && k === 'round' && a.parentId) hit('root_demoted_by_round', tag, `${String(a.id).slice(0, 8)} "${s.content.slice(0, 30)}" → under ${String(a.parentId).slice(0, 8)}`, out); if (a.parentId && !sim.has(a.parentId)) hit('event_move_to_unknown', tag, `${String(a.id).slice(0, 8)}`, out); if (a.parentId === a.id) hit('event_move_self', tag, String(a.id).slice(0, 8), out); s.parent = a.parentId ?? null; }
    else if (a.op === 'delete_node' || a.op === 'remove_node') { const s = sim.get(a.id); if (!s) { hit('event_delete_unknown', tag, String(a.id).slice(0, 8), out); continue; } if ((s.origin === 'system' || s.origin === 'user_edit') && k === 'round' && !s.content.startsWith('to sort')) hit('seed_or_root_deleted_by_round', tag, `"${s.content.slice(0, 40)}"`, out); s.removed = true; for (const [, c] of sim) if (c.parent === a.id && !c.removed) c.parent = s.parent; /* the store re-parents live children to the removed node's parent without an event */ }
    else if (a.op === 'restore_node') { const s = sim.get(a.id); if (s) s.removed = false; }
  }
  for (const [id, s] of sim) { const n = byId.get(id); if (!n) { hit('parity_missing_row', tag, id.slice(0, 8), out); continue; } if ((n.status === 'removed') !== s.removed && !events.some((e) => e.source_kind === 'undo' || e.source_kind === 'user_edit')) hit('parity_removed', tag, `${id.slice(0, 8)} db=${n.status} sim=${s.removed ? 'removed' : 'live'}`, out); if ((n.parent_id ?? null) !== s.parent && n.status !== 'removed' && !events.some((e) => e.source_kind === 'undo')) hit('parity_parent', tag, `${id.slice(0, 8)} db=${(n.parent_id ?? 'null').slice(0, 8)} sim=${(s.parent ?? 'null').slice(0, 8)}`, out); }
  for (const n of nodes) if (!sim.has(n.id)) hit('row_without_create_event', tag, `${n.id.slice(0, 8)} "${(n.title || n.content).slice(0, 30)}"`, out);
  // 4. chats / lit / side tables referencing removed or missing nodes
  for (const c of db.query('select id, focus_container_id, status from chats').all() as any[]) { if (c.focus_container_id) { const n = byId.get(c.focus_container_id); if (!n) hit('focus_missing', tag, c.id.slice(0, 8), out); else if (n.status === 'removed' && c.status !== 'archived') hit('focus_removed', tag, `chat ${c.id.slice(0, 8)} → ${n.id.slice(0, 8)}`, out); } }
  for (const l of db.query('select chat_id, container_id from lit').all() as any[]) { const n = byId.get(l.container_id); if (!n) hit('lit_missing', tag, l.container_id.slice(0, 8), out); else if (n.status === 'removed') { /* kept on purpose: undo of a delete restores the light (undo-delete-restores-lit) */ } }
  for (const [t, col] of [['relations', 'node_id'], ['node_memory', 'node_id'], ['memory_details', 'node_id'], ['fresh_marks', 'node_id'], ['favorites', 'node_id']] as const) { for (const r of db.query(`select distinct ${col} id from ${t}`).all() as any[]) { if (!byId.has(r.id)) hit(`${t}_missing_node`, tag, r.id.slice(0, 8), out); } }
  // 5. twins: live siblings with the same normalised title or content
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, '').trim(); // whitespace dropped entirely: "检查mainloop" and "检查 mainloop" are one title (codex TCP replay)
  // 5e. invisible format characters in a live title (M350, codex nf_conntrack replay: a ZWNJ glued to "IPv6 连接跟踪配置") — a ZWJ between two pictographs is legitimate
  for (const n of live) { if (n.author === 'system' || !n.title) continue; const bad = n.title.replace(/\p{Extended_Pictographic}\u200D(?=\p{Extended_Pictographic})/gu, '').match(/\p{Cf}/u); if (bad) hit('title_invisible', tag, `${String(n.id).slice(0, 8)} "${n.title.slice(0, 30)}" U+${bad[0].codePointAt(0)!.toString(16)}`, out); }
  const seenSib = new Map<string, string>();
  for (const n of live) { if (n.author === 'system') continue; const k = `${n.parent_id}|${norm(n.title || n.content)}`; if (k.split('|')[1].length < 6) continue; if (seenSib.has(k)) hit('sibling_twin', tag, `"${(n.title || n.content).slice(0, 40)}" ×2 under ${(n.parent_id ?? 'root').slice(0, 8)}`, out); seenSib.set(k, n.id); }
  // 5a. sibling twin by title vs statement: a live node whose statement equals a sibling's title
  { const sibs = new Map<string, any[]>(); for (const n of live) { if (n.author === 'system') continue; const k = n.parent_id ?? 'root'; if (!sibs.has(k)) sibs.set(k, []); sibs.get(k)!.push(n); }
    for (const [, arr] of sibs) for (const n of arr) for (const m of arr) { if (n === m || !m.title) continue; if (norm(n.content).length >= 12 && norm(n.content) === norm(m.title)) hit('sibling_title_twin', tag, `"${n.content.slice(0, 40)}" is the title of ${m.id.slice(0, 8)}`, out); } }
  // 5c. sibling twin by statement prefix (first 60 normalised characters) — two filings of the same thing
  { const seen = new Map<string, any>(); for (const n of live) { if (n.author === 'system' || norm(n.content).length < 40) continue; const k = `${n.parent_id}|${norm(n.content).slice(0, 60)}`; if (seen.has(k)) hit('sibling_content_twin', tag, `"${(n.title || n.content).slice(0, 36)}" ~ "${(seen.get(k).title || seen.get(k).content).slice(0, 36)}"`, out); else seen.set(k, n); } }
  // 5d. root/descendant title twin (M-loop 2026-09-19, codex Laravel): the untitled root rewritten into the first topic's name while the
  // topic node itself was created below it — root and grandchild, invisible to the sibling and parent/child checks
  for (const r of live) { if (r.parent_id || r.author === 'system' || !r.title || norm(r.title).length < 6 || norm(r.title).startsWith('to sort')) continue;
    for (const n of live) { if (n === r || n.author === 'system' || !n.title || n.parent_id === r.id) continue; let anc = byId.get(n.parent_id); let under = false; while (anc) { if (anc.id === r.id) { under = true; break; } anc = byId.get(anc.parent_id); }
      if (under && norm(n.title) === norm(r.title)) hit('root_title_twin', tag, `"${r.title.slice(0, 40)}" is the root and a descendant ${String(n.id).slice(0, 8)}`, out); } }
  // 5b. parent/child twin: a live child whose statement equals its parent's (a rewrite-to-child that kept the old text, or a double filing)
  for (const n of live) { if (n.author === 'system' || !n.parent_id) continue; const p = byId.get(n.parent_id); if (p && p.status !== 'removed' && norm(n.content).length >= 20 && norm(n.content).slice(0, 60) === norm(p.content).slice(0, 60)) hit('parent_child_twin', tag, `${n.id.slice(0, 8)} under ${p.id.slice(0, 8)} "${(p.title || p.content).slice(0, 40)}"`, out); }
  // 6. undo stack inverses referencing unknown nodes
  for (const u of db.query('select id, inverse from undo_stack').all() as any[]) { let inv: any[]; try { inv = JSON.parse(u.inverse); } catch { hit('undo_unparsable', tag, String(u.id), out); continue; } for (const a of inv) if (a.id && !byId.has(a.id)) hit('undo_unknown_node', tag, `${u.id}:${String(a.id).slice(0, 8)}`, out); }
  // 7. governor fights: the same guard on the same node in 2+ rounds
  const guards = db.query("select ts, kind, detail from audit_log where kind like 'guard%' or kind in ('title_healed','title_heal_stale','auto_place_skip','filer_empty_retry') order by ts").all() as any[];
  const fights = new Map<string, Set<string>>();
  for (const g of guards) { let d: any = {}; try { d = JSON.parse(g.detail); } catch {} const id = d.id ?? d.nodeId ?? ''; if (!id) continue; const k = `${g.kind}:${String(id).slice(0, 8)}`; if (!fights.has(k)) fights.set(k, new Set()); fights.get(k)!.add(g.ts.slice(0, 16)); }
  for (const [k, rounds] of fights) if (rounds.size >= 2) hit('governor_fight', tag, `${k} in ${rounds.size} rounds`, out);
  const kinds = db.query("select kind, count(*) c from audit_log where kind like 'guard%' group by kind").all() as any[];
  const guardLine = kinds.map((k) => `${k.kind.replace('guard_', '')}×${k.c}`).join(' ');
  console.log(`${tag}: nodes ${live.length}/${nodes.length} events ${events.length} guards[${guardLine}]${out.length ? '\n   ' + out.join('\n   ') : ' ok'}`);
  } catch (e) { console.log(tag, 'CHECK FAIL', String(e).slice(0, 200)); }
  db.close();
}
console.log('\n== totals'); for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(v, k);

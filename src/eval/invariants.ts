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
  // 5f. leaked closers / JSON tails in a live title (M360, codex node-xlsx replay: "导出前清理空格（trim）}]}") — more closers than openers of a pair
  for (const n of live) { if (n.author === 'system' || !n.title) continue; const t = n.title; const more = (o: string, c: string) => t.split(c).length > t.split(o).length; if (/[\]\})）]$/u.test(t) && ((t.endsWith(']') && more('[', ']')) || (t.endsWith('}') && more('{', '}')) || (t.endsWith(')') && more('(', ')')) || (t.endsWith('）') && more('（', '）')))) hit('title_closer', tag, `${String(n.id).slice(0, 8)} "${t.slice(0, 40)}"`, out); }
  // 5g. malformed/glitch titles (M-loop 2026-10-03, §10 #5 confirmed 3×: 'Add new node' UI-label leak, '…classifies?' stray trailing, '…constraint liftedemerging' fused word). High-precision: a UI-label leaked whole, or a status/transition word fused with the next word (no space) e.g. lifted+emerging. The stray-trailing-token case stays an eyeball (no clean mechanical rule yet).
  for (const n of live) { if (n.author === 'system' || !n.title) continue; const t = n.title.trim();
    if (/^(add new node|new node|add node|untitled|new topic)$/i.test(t)) hit('title_ui_label', tag, `${String(n.id).slice(0, 8)} "${t.slice(0, 40)}"`, out);
    else if (/\b(lifted|added|removed|closed|resolved|opened|merged|deleted|renamed|moved|created|updated|enabled|disabled|fixed|done)[a-z]{3,}\b/.test(t)) hit('title_fused_word', tag, `${String(n.id).slice(0, 8)} "${t.slice(0, 40)}"`, out); }
  // 5h. stray combining mark in a live title (M-loop 2026-10-03, §10 #5 combining-mark subclass — codex curl-endpoint replay emitted "requiremenẗ"/"effecẗ": a U+0308 diaeresis fused onto a final consonant). High-precision: a \p{Mn} is legit only on an ASCII vowel (café, naïve, Zürich — all decomposed) or a non-ASCII letter base (already-composed/CJK/other script); ñ (n+0303) and ç/ş (c|s+0327) are whitelisted. A mark on a consonant/digit/space/punct/start is the glitch. (A diaeresis on a vowel, e.g. a stray "foö", reads as a genuine ö and is intentionally NOT flagged to protect café/Schrödinger.)
  for (const n of live) { if (n.author === 'system' || !n.title) continue; const chars = Array.from(n.title);
    for (let i = 0; i < chars.length; i++) { if (!/\p{Mn}/u.test(chars[i])) continue; const cp = chars[i].codePointAt(0)!; const prev = i > 0 ? chars[i - 1] : ''; const prevCp = prev ? prev.codePointAt(0)! : 0; const pl = prev.toLowerCase();
      if (/[aeiouyAEIOUY]/.test(prev) || (prevCp > 127 && /\p{L}/u.test(prev)) || (pl === 'n' && cp === 0x0303) || ((pl === 'c' || pl === 's') && cp === 0x0327)) continue;
      hit('title_combining_mark', tag, `${String(n.id).slice(0, 8)} "${n.title.slice(0, 40)}" U+${cp.toString(16).padStart(4, '0')} after "${prev || '∅'}"`, out); break; } }
  // 5i. stray interrogation/exclamation mark (M-loop 2026-10-03, §10 #5 foreign-script-punctuation subclass — codex drone-swarm replay emitted "MAVLink failures question؟?" with a U+061F Arabic question mark fused onto the ASCII "?"). The corpus is EN/ZH/RU, so a ?/! from any other script is a leak. High-precision: legit interrogation/exclamation is ASCII (? !) or CJK fullwidth (？ ！); flag the rest (Arabic ؟, inverted ¿ ¡, Greek ;, ⁇ ⁈ ⁉ ‽, heavy ❢ ❣).
  for (const n of live) { if (n.author === 'system' || !n.title) continue; const m = n.title.match(/[؟¿¡⁇⁈⁉‽❢❣]/u); if (m) hit('title_stray_qmark', tag, `${String(n.id).slice(0, 8)} "${n.title.slice(0, 40)}" U+${m[0].codePointAt(0)!.toString(16).padStart(4, '0')}`, out); }
  const seenSib = new Map<string, any>();
  // M-loop 2026-10-02 (codex nfconntrack replay): a sibling_twin fires on norm(title||content), so it covers two cases worth telling apart — same title but DIFFERENT content (a label collision: two real facts the filer labelled alike, the how-to that should have nested) vs same content (a true dedup miss). Annotate which, so the triage is immediate.
  for (const n of live) { if (n.author === 'system') continue; const k = `${n.parent_id}|${norm(n.title || n.content)}`; if (k.split('|')[1].length < 6) continue; const prev = seenSib.get(k); if (prev) { const sameContent = norm(prev.content || '') === norm(n.content || ''); hit('sibling_twin', tag, `"${(n.title || n.content).slice(0, 40)}" ×2 under ${(n.parent_id ?? 'root').slice(0, 8)} (${sameContent ? 'same content → dedup miss' : 'distinct content → title collision'})`, out); } seenSib.set(k, n); }
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
  const healTitlesByNode = new Map<string, string[]>(); // title_healed titles per node, to tell an evolving node (distinct heals) from a re-heal-the-same-regression thrash (repeated heals)
  for (const g of guards) { let d: any = {}; try { d = JSON.parse(g.detail); } catch {} const id = d.id ?? d.nodeId ?? ''; if (!id) continue; const k = `${g.kind}:${String(id).slice(0, 8)}`; if (!fights.has(k)) fights.set(k, new Set()); fights.get(k)!.add(g.ts.slice(0, 16)); if (g.kind === 'title_healed' && typeof d.title === 'string') { const nk = String(id).slice(0, 8); if (!healTitlesByNode.has(nk)) healTitlesByNode.set(nk, []); healTitlesByNode.get(nk)!.push(d.title); } }
  for (const [k, rounds] of fights) if (rounds.size >= 2) {
    // M-loop 2026-10-02 (codex win-replace replay): a title_healed "fight" where every healed title is DISTINCT is the healer tracking an evolving node (the filer re-stuffed a growing critique into the title each round), not two governors oscillating — final title stable+clean. Annotate so the pattern triages at a glance; a repeated identical heal (true re-heal of the same regression) still reads as thrash.
    let note = '';
    if (k.startsWith('title_healed:')) { const ts = healTitlesByNode.get(k.slice('title_healed:'.length)) ?? []; const uniq = new Set(ts).size; note = uniq === ts.length ? ` (distinct heals → evolving node, benign)` : ` (repeated heal → thrash)`; }
    hit('governor_fight', tag, `${k} in ${rounds.size} rounds${note}`, out);
  }
  const kinds = db.query("select kind, count(*) c from audit_log where kind like 'guard%' group by kind").all() as any[];
  const guardLine = kinds.map((k) => `${k.kind.replace('guard_', '')}×${k.c}`).join(' ');
  console.log(`${tag}: nodes ${live.length}/${nodes.length} events ${events.length} guards[${guardLine}]${out.length ? '\n   ' + out.join('\n   ') : ' ok'}`);
  } catch (e) { console.log(tag, 'CHECK FAIL', String(e).slice(0, 200)); }
  db.close();
}
console.log('\n== totals'); for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(v, k);

// functions sweep: the per-run story of HarnessMap's own machinery, from the audit log (Jacob 2026-09-19: "monitor functions and mind")
import { Database } from 'bun:sqlite';
for (const f of Bun.argv.slice(2)) {
  const db = new Database(f, { readonly: true });
  const rows = db.query("select ts, kind, detail from audit_log where kind not in ('inference','dim_redacted','project_default','model_chosen','observe','auto_settings','host_session_attached','tosort_ensured') order by id").all() as any[];
  const counts = new Map<string, number>(); for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  console.log('==', f); console.log('kinds:', [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' '));
  // fights: auto mode aim vetoed by the focus-newborn guard, and any guard hitting the same node twice
  const byNode = new Map<string, number>(); for (const r of rows) { if (!r.kind.startsWith('guard_')) continue; let d: any = {}; try { d = JSON.parse(r.detail); } catch {} if (d.id) { const k = `${r.kind}@${d.id}`; byNode.set(k, (byNode.get(k) ?? 0) + 1); } }
  const fights = [...byNode].filter(([, n]) => n >= 2); if (fights.length) console.log('fights (same guard, same node, 2+):', fights.map(([k, n]) => `${k}×${n}`).join(' '));
  const aims = rows.filter((r) => r.kind === 'context_reanchor').length, skips = rows.filter((r) => r.kind === 'auto_aim_skip').length, vetoes = rows.filter((r) => r.kind === 'guard_focus_newborn').length;
  console.log(`auto mode: aimed ${aims}, skipped ${skips}, newborn vetoes ${vetoes}${vetoes >= 3 ? '  ← aim keeps wanting the node just born' : ''}`);
  const story = rows.filter((r) => /^(guard_|filing_|round_|auto_mode|context_reanchor|reaim_retarget|title_healed|memory_detail_dupe|coalesce|healer|observe_map_command)/.test(r.kind)).map((r) => { let d: any = {}; try { d = JSON.parse(r.detail); } catch {} const id = d.id ?? d.turn ?? d.node ?? ''; return `${String(r.ts).slice(11, 19)} ${r.kind}${id ? `(${String(id).slice(0, 6)})` : ''}${d.why ? ` [${d.why}]` : ''}${d.from && d.to ? ` ${String(d.from).slice(0, 6)}→${String(d.to).slice(0, 6)}` : ''}`; });
  console.log('story:'); for (const s of story) console.log('  ' + s);
}

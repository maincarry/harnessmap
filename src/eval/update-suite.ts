// M204 update suite: does a round that supersedes an existing ruling UPDATE
// that node (history grows) instead of filing a twin, and does the statement
// get REWRITTEN rather than keeping the old clause beside the new? Three
// stories from the record, each run REPS times on a scratch map.
//   bun run src/eval/update-suite.ts [--reps 2]
import { Store } from '../store/db.js';
import { Translator } from './../translator/translator.js';
import { rmSync } from 'fs';
const REPS = Number(process.argv.find((a) => a.startsWith('--reps='))?.slice(7) ?? 2);
interface Story { id: string; name: string; before: { title: string; content: string; status: string }; rounds: { user: string; agent: string; oldClause: RegExp; newClause: RegExp }[] }
const stories: Story[] = [
  { id: 'm132', name: 'M132 two-mode toggle: reversed, then reinstated', before: { title: 'Two-mode toggle', content: 'The two-mode toggle (workspace / companion) is approved and built: Jacob said "the two mode thing is fine actually".', status: 'decided' }, rounds: [
    { user: 'My words "the two mode thing is fine actually" were misread as a build verdict. I had explicitly deferred the two-mode decision to Mark. Revert the toggle; the deferral stands.', agent: 'Reverted: the two-mode toggle is withdrawn, the decision stays deferred to Mark as you ruled earlier; the misread is recorded.', oldClause: /is approved and built/i, newClause: /revert|withdrawn|deferred|parked|pending/i },
    { user: "Why don't we add the two modes. I'm the one who imposed the wait-for-Mark, and I'm lifting it.", agent: 'Reinstated: the two-mode toggle is back exactly as built; the deferral is lifted by the founder who imposed it.', oldClause: /deferred to Mark\.|is withdrawn|is reverted/i, newClause: /reinstated|restored|back|built and active|exactly as built|lifted/i },
  ] },
  { id: 'm71', name: 'M71 proposal cache: once ever, then capped recompute', before: { title: 'Proposal cache', content: 'A dot\'s tidy proposal is computed once, ever, in a background sweep after a 25s settle; clicking the dot serves the cached proposal instantly.', status: 'decided' }, rounds: [
    { user: 'My open dot had a stale cache — the map changed after the precompute and every click paid a live compute. Under "one compute per dot ever" a stale cache never refreshes. Have the background sweep recompute stale caches, capped at three per dot.', agent: 'Built: stale proposal caches are recomputed in the background sweep, capped at 3 per dot (proposal_count). Clicking still serves the cache instantly when the hash matches.', oldClause: /computed once,? ever\b/i, newClause: /recomput|capped|three|3 /i },
  ] },
  { id: 'merge', name: 'Merge rule: wording-as-child, then merge specialist', before: { title: 'Node merge', content: 'Merging one node into another: children move to the survivor; the source\'s distinct wording is preserved as a child of the survivor; word-overlap of 0.5 or more counts as a true duplicate and is dropped.', status: 'decided' }, rounds: [
    { user: 'When merging two nodes it is not enough that the child is inherited — the description and chat history must merge too.', agent: 'Built a merge specialist (src/translator/merge.ts, cheap tier, one call): the survivor\'s content absorbs the source\'s distinct information as one statement — integrate, not append — and the two chat memories are combined under the M41 rules. Children still move to the survivor.', oldClause: /as a child of the survivor/i, newClause: /absorb|specialist|integrat/i },
  ] },
];
let pass = 0, total = 0;
for (const s of stories) {
  for (let rep = 1; rep <= REPS; rep++) {
    const p = `/tmp/claude-1000/update-suite-${s.id}-${rep}.sqlite`; try { rmSync(p); rmSync(p + '-wal'); rmSync(p + '-shm'); } catch {}
    const st = new Store(p); const pid = 'p1'; const db = (st as any).db;
    db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(pid, 'scratch');
    st.applyAlterations(pid, [
      { op: 'create_node', id: 'root', parentId: null, content: 'HarnessMap design record', title: 'HarnessMap', status: 'live', author: 'user' },
      { op: 'create_node', id: 'area', parentId: 'root', content: 'Map mechanics and rulings.', title: 'Map mechanics', status: 'live', author: 'agent' },
      { op: 'create_node', id: 'target', parentId: 'area', content: s.before.content, title: s.before.title, status: s.before.status, author: 'agent' },
      { op: 'create_node', id: 'other', parentId: 'root', content: 'Status line shows filing lag while work is in flight.', title: 'Status line', status: 'live', author: 'agent' },
    ] as any, { kind: 'system' } as any);
    db.prepare("INSERT INTO chats (id, project_id, focus_container_id, status, created_at) VALUES ('c1', ?, 'root', 'active', datetime('now'))").run(pid);
    db.prepare("INSERT INTO lit (chat_id, container_id) VALUES ('c1','root'), ('c1','area'), ('c1','target'), ('c1','other')").run();
    const tr = new Translator(st);
    let ok = true; const notes: string[] = [];
    for (const [i, r] of s.rounds.entries()) {
      const out = await tr.translateRound({ projectId: pid, chatId: 'c1', turnId: `t${i}`, focusContainerId: 'root', userText: r.user, assistantText: r.agent } as any);
      const alts = (out?.result?.alterations ?? []) as any[];
      const updated = alts.some((a) => a.op === 'update_node' && a.id === 'target' && (a.content || a.status));
      const twin = alts.filter((a) => a.op === 'create_node' && r.newClause.test(String(a.content) + ' ' + String(a.title ?? ''))).length;
      const now = st.getNode('target')!;
      const oldLeft = r.oldClause.test(now.content); const newIn = r.newClause.test(now.content + ' ' + now.status);
      const roundOk = updated && twin === 0 && !oldLeft && newIn;
      ok = ok && roundOk;
      notes.push(`round ${i + 1}: update=${updated} twins=${twin} oldClauseLeft=${oldLeft} newClauseIn=${newIn}${roundOk ? '' : ' ✗'} → "${now.content.slice(0, 110)}" [${now.status}]`);
    }
    total++; if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${s.name} (rep ${rep}) · history ${st.nodeHistory('target').length} versions\n  ${notes.join('\n  ')}`);
  }
}
console.log(`\nupdate suite: ${pass}/${total} passed`);

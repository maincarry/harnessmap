// M218: the map guide's mechanical parts — the rescue rule, the status index —
// against the exact sentences that misfired on 2026-09-08.
import { rescueTarget, contentTokens, statusIndex, runGuideQuery } from '../translator/mapchat.js';
import { Store } from '../store/db.js';
import { setNodeMemory } from '../translator/memory.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const nodes: any[] = [
  { id: 'aaaa1111', title: 'Testing and measurement', content: 'Testing and measurement', status: 'active', type: null },
  { id: 'bbbb2222', title: 'Local metrics storage', content: 'Local metrics table records interactions (focus, light, dim, zoom, undo)', status: 'decided', type: null },
  { id: 'cccc3333', title: 'Confirm view shows all five elements', content: 'Confirm view shows breadcrumb, then light / zoom / focus / favorite / do nothing.', status: 'decided', type: null },
  { id: 'dddd4444', title: 'Auto-detect unmet coverage', content: 'When served block lacks terms from the question, auto-attach matching cards', status: 'pending', type: 'option' },
  { id: 'eeee5555', title: 'Garden plan', content: 'Garden plan', status: 'live', type: null },
  { id: 'ffff6666', title: 'Soil mix 60/30/10', content: 'decision: Soil mix 60/30/10', status: 'decided', type: 'decision', parentId: 'eeee5555' },
  { id: '99999999', title: 'Does a map count as a seat?', content: 'Does a map count as a seat?', status: 'open', type: 'question' },
  { id: '88888888', title: 'old idea', content: 'old idea', status: 'removed', type: null },
];
const by = (id: string) => nodes.find((n) => n.id === id);
// the two misfires
ok('"yes let\'s do the zoom" carries no content words', contentTokens("yes let's do the zoom?").size === 0);
ok('zoom confirmation keeps the pick (no leaf hijack)', rescueTarget("yes let's do the zoom?", by('aaaa1111'), nodes, 'zoom').id === 'aaaa1111');
ok('"favorite all active nodes" never rescues', rescueTarget("let's favorite all active nodes", by('dddd4444'), nodes, 'favorite').id === 'dddd4444');
ok('even as a focus sentence, "favorite all active nodes" names nothing', rescueTarget("let's favorite all active nodes", by('dddd4444'), nodes, 'focus').id === 'dddd4444');
// the case the rescue exists for
ok('"switch to the soil mix" rescues the parent pick to the child', rescueTarget('switch to the soil mix', by('eeee5555'), nodes, 'focus').id === 'ffff6666');
ok('a pick that matches the sentence stands', rescueTarget('zoom into the garden plan', by('eeee5555'), nodes, 'zoom').id === 'eeee5555');
ok('removed nodes are never a rescue target', rescueTarget('focus on the old idea', by('aaaa1111'), nodes, 'focus').id !== '88888888');
// the status index
const idx = statusIndex(nodes);
ok('counts exclude removed', !('removed' in idx.counts) && idx.counts.decided === 3);
ok('unsettled = pending + open question, not "active" chapters', idx.unsettled.map((n) => n.id).sort().join() === ['dddd4444', '99999999'].sort().join());
// M219: the map queries, mechanical, on a temp store
const store = new Store(join(mkdtempSync(join(tmpdir(), 'guide-')), 'map.sqlite'));
const pid = store.createProject('q'); const root = randomUUID(), tidy = randomUUID(), amber = randomUUID(), task = randomUUID();
store.applyAlterations(pid, [
  { op: 'create_node', id: root, parentId: null, content: 'HarnessMap', title: 'HarnessMap', status: 'live', author: 'user' } as any,
  { op: 'create_node', id: tidy, parentId: root, content: 'Tidy agent', title: 'Tidy agent', status: 'active', author: 'agent' } as any,
  { op: 'create_node', id: amber, parentId: tidy, content: 'The amber dot was replaced by a relight suggestion', title: 'Amber dot replaced', status: 'decided', author: 'agent', date: '2026-08-20' } as any,
  { op: 'create_node', id: task, parentId: tidy, content: 'Cap tidy proposals at 40 moves', status: 'pending', type: 'task', author: 'agent' } as any,
], { kind: 'system' });
store.applyAlterations(pid, [{ op: 'update_node', id: amber, content: 'The amber dot is gone: relight suggestions replaced it', date: '2026-08-22' } as any], { kind: 'reorganize' });
setNodeMemory(store, amber, 'Jacob ruled the amber dot out on 2026-08-20.');
store.setFavorite(task, true);
const chatId = randomUUID(); store.createChat({ id: chatId, projectId: pid, focusContainerId: root, sdkSessionId: null } as any); store.setLit(chatId, tidy, true);
const shown = new Set<string>();
const r1 = runGuideQuery(store, pid, chatId, { kind: 'status' }, shown);
ok('status query lists the pending task with its id, not the active chapter', r1.includes(task.slice(0, 8)) && !r1.includes(tidy.slice(0, 8)) && /1 node/.test(r1));
ok('status query with a status filters by it', runGuideQuery(store, pid, chatId, { kind: 'status', status: 'decided' }, shown).includes(amber.slice(0, 8)));
ok('search query finds the amber dot by words', runGuideQuery(store, pid, chatId, { kind: 'search', words: 'amber dot' }, shown).includes(amber.slice(0, 8)));
const sub = runGuideQuery(store, pid, chatId, { kind: 'subtree', nodeId: tidy.slice(0, 8) }, shown);
ok('subtree query shows the children indented with ids', sub.includes(amber.slice(0, 8)) && sub.includes(task.slice(0, 8)) && /\n  \[/.test(sub));
const hist = runGuideQuery(store, pid, chatId, { kind: 'history', nodeId: amber }, shown);
ok('history query shows two dated versions', /2 version/.test(hist) && hist.includes('2026-08-20') && hist.includes('2026-08-22'));
ok('memory query returns what the map remembers', runGuideQuery(store, pid, chatId, { kind: 'memory', nodeId: amber }, shown).includes('Jacob ruled'));
ok('lit query lists the lit set', runGuideQuery(store, pid, chatId, { kind: 'lit' }, shown).includes(tidy.slice(0, 8)));
ok('favorites query lists the favorite', runGuideQuery(store, pid, chatId, { kind: 'favorites' }, shown).includes(task.slice(0, 8)));
ok('every result id is now "shown"', [amber, task, tidy].every((id) => shown.has(id)));
ok('unknown node in a query is reported, not thrown', /unknown node/.test(runGuideQuery(store, pid, chatId, { kind: 'subtree', nodeId: 'zzzz' }, shown)));

console.log(`guide: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

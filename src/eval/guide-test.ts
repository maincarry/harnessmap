// M218: the map guide's mechanical parts — the rescue rule, the status index —
// against the exact sentences that misfired on 2026-09-08.
import { rescueTarget, contentTokens, statusIndex } from '../translator/mapchat.js';
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
console.log(`guide: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

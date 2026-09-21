// M368 — the reversible legacy host-scaffold sweep (Store.sweepLegacyScaffold).
// Builds a synthetic map with ONE scaffold-dominant round (a pre-M366
// <recommended_plugins> turn whose only real residual is "open map") plus real
// user content, then asserts: the whole scaffold subtree is swept, real content
// survives, a human-edited scaffold node is spared, the sweep is idempotent, and
// undo fully restores the map.
import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { stripHostScaffold, looksLikeScaffold } from '../agent/harness-adapter.js';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', name); } };

const dbPath = `/tmp/claude-1000/sweep-check-${process.pid}.sqlite`;
try { for (const s of ['', '-wal', '-shm']) try { require('node:fs').unlinkSync(dbPath + s); } catch {} } catch {}

const store = new Store(dbPath);
const pid = store.ensureProject('sweep-test');
const deps = { strip: stripHostScaffold, looks: looksLikeScaffold };
const live = () => store.getNodes(pid).filter((n) => n.status !== 'removed');

// --- a normal round with a REAL user node ---
store.applyAlterations(pid, [{ op: 'create_node', id: 'real1', parentId: null, content: 'We should use Postgres', title: 'Database choice', status: 'live', author: 'user' }], { kind: 'round' });

// --- a scaffold-dominant round (round R) ---
const R = randomUUID();
const plugins = ['Airtable', 'Alpaca', 'Spotify', 'Notion', 'Slack', 'Asana', 'Box', 'Figma'];
const userText = '<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n'
  + plugins.map((p) => `- ${p} (${p.toLowerCase()}@openai-curated-remote)`).join('\n')
  + '\n' + 'x'.repeat(400) + '\n</recommended_plugins>\nopen map';
// filing row for the round
(store as any).db.prepare('INSERT INTO filings(turn_id,chat_id,user_text,assistant_text,provenance,status,attempts,round_id) VALUES(?,?,?,?,?,?,?,?)')
  .run(randomUUID(), randomUUID(), userText, '', null, 'done', 1, R);
// scaffold nodes created in round R (parent + children), each mirrored as a map_event
const scaffoldIds: string[] = [];
const addScaffold = (id: string, parentId: string | null, title: string, content: string) => {
  scaffoldIds.push(id);
  store.createNode({ id, projectId: pid, parentId, content, type: null, status: 'provisional', author: 'user', title });
  (store as any).db.prepare('INSERT INTO map_events(id,project_id,alteration,source_kind,round_id) VALUES(?,?,?,?,?)')
    .run(randomUUID(), pid, JSON.stringify({ op: 'create_node', id, parentId, content, title, status: 'provisional', author: 'user' }), 'round', R);
};
addScaffold('ap', null, 'Available plugins', 'These plugins are available but not installed.');
for (const p of plugins) addScaffold('plug-' + p, 'ap', p, `${p} is an available but not installed plugin (${p.toLowerCase()}@openai-curated-remote).`);

// a human later edits one scaffold child — it must be SPARED
(store as any).db.prepare('INSERT INTO map_events(id,project_id,alteration,source_kind,round_id) VALUES(?,?,?,?,?)')
  .run(randomUUID(), pid, JSON.stringify({ op: 'update_node', id: 'plug-Slack', title: 'Slack (we actually use this)' }), 'user_edit', null);
store.updateNode('plug-Slack', { title: 'Slack (we actually use this)' });

ok('setup: real + scaffold present', live().length === 1 + 1 + plugins.length);

// --- dry run ---
const dry = store.sweepLegacyScaffold(pid, deps, { dryRun: true });
ok('dry-run finds 1 scaffold round', dry.rounds === 1);
ok('dry-run flags parent + non-edited children (spares the edited one)', dry.removed.length === 1 + (plugins.length - 1));
ok('dry-run does NOT flag the real node', !dry.removed.some((r) => r.id === 'real1'));
ok('dry-run does NOT flag the human-edited child', !dry.removed.some((r) => r.id === 'plug-Slack'));
ok('dry-run mutates nothing', live().length === 1 + 1 + plugins.length);

// --- real sweep ---
const res = store.sweepLegacyScaffold(pid, deps, {});
ok('sweep removed parent + spared-count children', res.removed.length === 1 + (plugins.length - 1));
const surv = live();
ok('real node survives', surv.some((n) => n.id === 'real1'));
ok('human-edited scaffold child survives', surv.some((n) => n.id === 'plug-Slack'));
ok('no "Available plugins" parent left live', !surv.some((n) => n.title === 'Available plugins'));
ok('no plugin pollution left (except the human-edited node we deliberately spared)', !surv.some((n) => n.id !== 'plug-Slack' && /curated-remote/i.test((n.title ?? '') + (n.content ?? ''))));

// --- idempotency ---
const again = store.sweepLegacyScaffold(pid, deps, {});
ok('idempotent: second run is a no-op', again.alreadyDone && again.removed.length === 0);

// --- undo restores ---
const undo = store.popUndo(pid);
ok('undo entry recorded', !!undo && /host-scaffold/.test(undo.label));
store.applyAlterations(pid, undo!.inverse, { kind: 'user_edit' });
ok('undo restores full map', live().length === 1 + 1 + plugins.length);
ok('undo restores the parent live', live().some((n) => n.title === 'Available plugins'));

// --- reversibility must survive a restart: a fresh Store (its in-memory guard reset) must NOT re-sweep
//     after the user undid the tidy, or the undo wouldn't stick. Only the persistent settings flag guards
//     this — this is the "undo puts them back" promise (Jacob 2026-09-21). ---
{
  const restarted = new Store(dbPath);
  const before = restarted.getNodes(pid).filter((n) => n.status !== 'removed').length;
  const r = restarted.sweepLegacyScaffold(pid, deps, {});
  const after = restarted.getNodes(pid).filter((n) => n.status !== 'removed').length;
  ok('restart after undo: sweep is a no-op via the persistent flag', r.alreadyDone && r.removed.length === 0);
  ok('restart after undo: the restored nodes stay (undo sticks across restart)', after === before && after === 1 + 1 + plugins.length);
  (restarted as any).close?.();
}

// --- a map with NO scaffold is untouched ---
const pid2 = store.ensureProject('clean-map');
store.applyAlterations(pid2, [{ op: 'create_node', id: 'c1', parentId: null, content: 'Just real work', title: 'Real', status: 'live', author: 'user' }], { kind: 'round' });
const clean = store.sweepLegacyScaffold(pid2, deps, {});
ok('clean map: nothing swept', !clean.swept && clean.removed.length === 0);
ok('clean map: real node intact', store.getNodes(pid2).filter((n) => n.status !== 'removed').length === 1);

for (const s of ['', '-wal', '-shm']) try { require('node:fs').unlinkSync(dbPath + s); } catch {}
console.log(`scaffold-sweep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

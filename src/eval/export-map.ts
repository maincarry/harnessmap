// M355: write a project out of any harnessmap database as a .map bundle (the same file the page's "save as .map" makes).
//   bun run src/eval/export-map.ts <map.sqlite> <out.map> [project name]
// Picks the database's active project (else the newest). Used to back-fill the e2e maps kept under /tmp into src/eval/maps/.
import { Store } from '../store/db.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [db, out, name] = process.argv.slice(2);
if (!db || !out) { console.error('usage: export-map.ts <sqlite> <out.map> [name]'); process.exit(2); }
const store = new Store(db);
const pid = store.getSetting('active_project') ?? store.listProjects().at(-1)?.id;
if (!pid) { console.error('no project in that database'); process.exit(1); }
const b = store.exportProject(pid, { audit: true });
try { b.version = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')).version; } catch { b.version = '0.0.0'; }
if (name) b.project.name = name;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(b));
console.log(`${out}: ${b.counts.nodes} nodes, ${b.counts.map_events} events, ${b.counts.turns} turns, ${(b.audit ?? []).length} audit rows`);

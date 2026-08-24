// One-shot (M36): give short display titles to existing nodes whose content
// is long. Run with the server STOPPED: bun run src/spike/backfill-titles.ts [db]
import Anthropic from '@anthropic-ai/sdk';
import { Store } from '../store/db.js';
import { TRANSLATOR_MODEL } from '../translator/translator.js';

const DB = process.argv[2] ?? 'harnessmap.sqlite';
const store = new Store(DB);
const db = (store as any).db;
const pid = (db.prepare("SELECT id FROM projects WHERE name='default'").get() as any)?.id;
if (!pid) { console.log('no default project'); process.exit(0); }

const long = store.getNodes(pid).filter((n) => n.status !== 'removed' && (n.content.length > 40 || n.title));
if (long.length === 0) { console.log('nothing to title'); process.exit(0); }

const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['titles'],
  properties: { titles: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'title'],
    properties: { id: { type: 'string' }, title: { type: 'string' } } } } },
};
const response = await client.messages.create({
  model: TRANSLATOR_MODEL,
  max_tokens: 1500,
  system: 'You write MINIMAL display titles for map nodes: 2-4 plain everyday words. The test: how would the user casually refer to this out loud? ("the rail pass thing" -> "rail pass", "whether weather affects mood" -> "weather and mood"). DROP nuance rather than cram it in — a title names the thing, it does not summarize the statement. Bad: "weather excuse versus genuine", "USDA structural conflict nutrition". Good: "weather as excuse", "USDA conflicts". Return one title per id.',
  output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  messages: [{ role: 'user', content: long.map((n) => `[${n.id.slice(0, 8)}] ${n.type ? n.type + ': ' : ''}${n.content}`).join('\n') }],
} as any);
const text = (response as any).content.find((b: any) => b.type === 'text')?.text ?? '{}';
const titles = (JSON.parse(text).titles ?? []) as { id: string; title: string }[];
const alts = titles
  .map((t) => {
    const full = long.find((n) => n.id.startsWith(String(t.id).replace(/[\[\]]/g, '')));
    return full ? { op: 'update_node', id: full.id, title: t.title } : null;
  })
  .filter(Boolean) as any[];
store.applyAlterations(pid, alts, { kind: 'system' });
for (const a of alts) console.log(`titled [${a.id.slice(0, 8)}] → "${a.title}"`);
console.log(`done: ${alts.length}/${long.length}`);

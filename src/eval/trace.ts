// Full mechanism trace of a few rounds: shows EXACTLY what the translator
// receives, the raw JSON it returns, and the exact store writes each round.
// Usage: bun run src/eval/trace.ts

import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { Translator, TRANSLATOR_MODEL } from '../translator/translator.js';
import { loadMap, renderTree } from '../map/render.js';

const CONVO: Array<[string, string]> = [
  ['I want to write a blog post arguing remote work is better for junior devs. Keep it punchy — general tech audience, not academics.',
   'Good angle. Punchy + general audience noted. Start from your strongest argument?'],
  ['Main argument: async communication forces better documentation, which juniors benefit most.',
   'Strong. Want me to draft that section?'],
  ["wait, not 'async communication' — say 'written-first culture'. async sounds like a Slack feature.",
   "Good call, updating to 'written-first culture'."],
  ['ugh I hate all three intros I wrote, maybe this whole post is a bad idea honestly',
   'Normal at this stage — the argument is solid. Skip the intro, draft the body first?'],
];

function line(s = '') { console.log(s); }

async function main() {
  const store = new Store(':memory:');
  const projectId = store.ensureProject('trace');
  const root = randomUUID();
  store.applyAlterations(projectId, [
    { op: 'create_container', id: root, parentId: null, name: 'Blog: remote work for juniors', status: 'live', author: 'user' },
  ], { kind: 'user_edit' });
  const chatId = randomUUID();
  store.createChat({ id: chatId, projectId, focusContainerId: root, sdkSessionId: null });
  const translator = new Translator(store);

  for (const [i, [userText, agentText]] of CONVO.entries()) {
    line('\n' + '█'.repeat(72));
    line(`ROUND ${i + 1}`);
    line('█'.repeat(72));

    const turnId = randomUUID();
    store.appendTurn({ id: turnId, chatId, role: 'user', content: userText, raw: null });

    const beforeEvents = store.getNodes(projectId).length;
    const out = await translator.translateRound({
      projectId, chatId, turnId, focusContainerId: root, userText, assistantText: agentText,
    });
    if (!out) { line('[translator error]'); continue; }

    line('\n── STEP 1 · what the translator is CONDITIONED ON (current map, ids shown) ──');
    line(out.debug.inputTree);
    line('\n── STEP 2 · the new exchange handed to it ──');
    line(`USER:  ${userText}`);
    line(`AGENT: ${agentText}`);
    line(`\n(model: ${TRANSLATOR_MODEL}, structured-output JSON schema)`);

    line('\n── STEP 3 · the RAW JSON the model returned ──');
    line(out.debug.rawText.trim());

    line('\n── STEP 4 · exact store writes (each alteration → append-only map_events + projection) ──');
    if (out.result.alterations.length === 0) {
      line('  0 alterations → nothing written. The round is recorded (summary kept) but the map is unchanged.');
    } else {
      for (const a of out.result.alterations) {
        line(`  append map_events{source:round, op:${a.op}} → ${describe(a)}`);
      }
    }

    line('\n── STEP 5 · the map AFTER this round ──');
    line(renderTree(loadMap(store, projectId)));
  }
}

function describe(a: any): string {
  switch (a.op) {
    case 'create_container': return `INSERT container "${a.name}" [${a.status}]`;
    case 'update_container': return `UPDATE container ${a.id.slice(0, 8)} set ${JSON.stringify({ name: a.name, status: a.status })}`;
    case 'create_item': return `INSERT item ${a.type} "${a.content}" [${a.status}] author=${a.author} home=${a.homeContainerId.slice(0, 8)}`;
    case 'update_item': return `UPDATE item ${a.id.slice(0, 8)} set ${JSON.stringify({ status: a.status, content: a.content })} (in-place; not a new row)`;
    case 'rehome_item': return `UPDATE item ${a.id.slice(0, 8)} home_container_id=${a.homeContainerId.slice(0, 8)}`;
    case 'create_link': return `INSERT link ${a.type}: ${a.fromItemId.slice(0, 8)} → ${a.toId.slice(0, 8)}`;
    default: return a.op;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// A narrated demo run for showing what the translator actually does, round by
// round, on a fresh (non-corpus) conversation crafted to exercise the hard
// cases: casual-aside commitments, pure venting (must produce nothing), a
// correction/rebuke, a flip-flop, and a meta-instruction. Real production
// translator hitting the real API. Usage: bun run src/eval/demo.ts

import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { Translator, TRANSLATOR_MODEL } from '../translator/translator.js';
import { loadMap, renderTree } from '../map/render.js';

// (user message, canned agent reply). The agent text is kept short; what we're
// demonstrating is the translator, not the chat model.
const CONVO: Array<[string, string]> = [
  ['I want to write a blog post arguing that remote work is better for junior developers, not worse. Keep it punchy — this is for a general tech audience, not academics.',
   'Good angle — the "juniors need an office" take is common, so pushing against it is fresh. Punchy + general audience noted. Want to start from the strongest objection or the strongest argument for your side?'],
  ['Start with my side. Main argument: async communication forces better documentation, which juniors benefit from most.',
   'Strong pick. Async-forces-documentation is concrete and you can back it with examples. Should I draft that section?'],
  ['wait, not "async communication" — say "written-first culture". async sounds like a Slack feature.',
   'Good call, "written-first culture" is clearer and less jargon-y. Updating.'],
  ['ugh I have written three intros and hate all of them, maybe this whole post is a bad idea honestly',
   'Totally normal at this stage — the intro is the hardest part and usually comes last. The argument itself is solid. Want to skip the intro and draft the body first?'],
  ['ok good idea. also should I include salary data? hmm. actually no, that pulls focus from the dev-growth angle. skip it.',
   'Agreed — salary data opens a different debate. Keeping the focus on developer growth is the right call.'],
  ['one more thing, remind me to get a quote from an actual junior dev before I publish. don\'t let me forget that.',
   'Noted — a real junior-dev quote will make it land. I\'ll keep that on the list.'],
];

async function main() {
  console.log(`DEMO — translator: ${TRANSLATOR_MODEL}\n${'='.repeat(70)}`);
  const store = new Store(':memory:');
  const projectId = store.ensureProject('demo');
  const root = randomUUID();
  store.applyAlterations(projectId, [
    { op: 'create_container', id: root, parentId: null, name: 'Blog: remote work for juniors', status: 'live', author: 'user' },
  ], { kind: 'user_edit' });
  const chatId = randomUUID();
  store.createChat({ id: chatId, projectId, focusContainerId: root, sdkSessionId: null });
  const translator = new Translator(store);

  for (const [i, [userText, agentText]] of CONVO.entries()) {
    const turnId = randomUUID();
    store.appendTurn({ id: turnId, chatId, role: 'user', content: userText, raw: null });
    const out = await translator.translateRound({
      projectId, chatId, turnId, focusContainerId: root, userText, assistantText: agentText,
    });
    console.log(`\nROUND ${i + 1}`);
    console.log(`  USER: ${userText}`);
    if (!out) { console.log('  [translator error]'); continue; }
    console.log(`  translator read: ${out.result.summary}`);
    if (out.result.alterations.length === 0) {
      console.log('  map change: (none)');
    } else {
      for (const a of out.result.alterations) {
        if (a.op === 'create_item') console.log(`  + ${a.type} [${a.status}] "${a.content}" (by ${a.author})`);
        else if (a.op === 'update_item') console.log(`  ~ update ${a.id.slice(0, 8)} → ${a.status ?? ''} ${a.content ? '"' + a.content + '"' : ''}`);
        else if (a.op === 'create_container') console.log(`  + container "${a.name}" [${a.status}]`);
        else console.log(`  · ${a.op}`);
      }
    }
  }

  console.log(`\n${'='.repeat(70)}\nFINAL MAP:\n`);
  console.log(renderTree(loadMap(store, projectId)));
}

main().catch((e) => { console.error(e); process.exit(1); });

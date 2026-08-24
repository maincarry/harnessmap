// Headless translator eval — the go/no-go gate (TD review 2026-08-12, finding 1).
// Replays a corpus conversation through the REAL production translator, round by
// round, then grades the final map against the expectation checklist.
//
// Usage: npx tsx src/eval/run.ts [essay|travel|exploration]

import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { Translator, TRANSLATOR_MODEL } from '../translator/translator.js';
import { parseCorpus, toRounds } from './corpus.js';
import { essayExpectations } from './expectations.js';
import { loadMap, renderTree } from '../map/render.js';

const which = process.argv[2] ?? 'essay';
const corpusPath = `docs/ontology/example-${which}.md`;

async function main() {
  const rounds = toRounds(parseCorpus(corpusPath));
  console.log(`corpus: ${corpusPath} — ${rounds.length} rounds — translator: ${TRANSLATOR_MODEL}\n`);

  const store = new Store(':memory:');
  const projectId = store.ensureProject(`eval-${which}`);

  // The chat itself is the default container (ontology: chat = container of last resort).
  const chatContainerId = randomUUID();
  store.applyAlterations(projectId, [
    { op: 'create_node', id: chatContainerId, parentId: null, content: `chat (eval ${which})`, status: 'live', author: 'user' },
  ], { kind: 'system' });

  const chatId = randomUUID();
  store.createChat({ id: chatId, projectId, focusContainerId: chatContainerId, sdkSessionId: null });

  const translator = new Translator(store);
  let failed = 0;
  const history: import('../types.js').Alteration[] = [];

  for (const [n, round] of rounds.entries()) {
    const turnId = randomUUID();
    store.appendTurn({ id: turnId, chatId, role: 'user', content: round.userText, raw: null });

    const t0 = Date.now();
    const out = await translator.translateRound({
      projectId, chatId, turnId,
      focusContainerId: chatContainerId,
      userText: round.userText,
      assistantText: round.assistantText,
    });
    const ms = Date.now() - t0;

    if (!out) {
      failed += 1;
      console.log(`R${n + 1} ${round.label}  [FAILED — translator error]`);
      continue;
    }
    const k = out.result.alterations.length;
    history.push(...out.result.alterations);
    console.log(`R${n + 1} ${round.label}  ${k === 0 ? 'no-op' : `${k} alteration(s)`}  (${ms}ms)`);
    console.log(`   ↳ ${out.result.summary}`);
  }

  console.log(`\n================ FINAL MAP ================\n`);
  console.log(renderTree(loadMap(store, projectId)));

  if (which === 'essay') {
    console.log(`\n================ GRADE ================\n`);
    const nodes = store.getNodes(projectId);
    let pass = 0;
    for (const e of essayExpectations) {
      const ok = e.check(nodes, history);
      if (ok) pass += 1;
      console.log(` ${ok ? 'PASS' : 'FAIL'}  ${e.name}`);
    }
    const noise = nodes.filter((n) => n.type).length;
    console.log(`\nscore: ${pass}/${essayExpectations.length} expectations · ${noise} typed nodes (target band 12–30) · ${failed} round errors`);
    const verdict = pass >= Math.ceil(essayExpectations.length * 0.75) && failed === 0;
    console.log(`verdict: ${verdict ? 'GATE PASSES (≥75%)' : 'GATE FAILS — tune the prompt before building the app'}`);
    process.exit(verdict ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

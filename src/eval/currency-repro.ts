// M253: reproduce finding 9 of Mark's Codex-driven test — "a correction reaches the node but the derived
// material (MAP.md, the brain's judgment) keeps the old claim". Two parts:
//  (a) MAP.md: the round rewrites the node's statement, MAP.md is written at that moment, and the memory
//      agent rewrites the node's memory AFTER — the file on disk kept the old memory text until the next map
//      change. Reproduced here by replaying the server's own order with the real filer and memory agent.
//  (b) the brain's judgment refreshes on its cycle (10 rounds / 30 min); between cycles it can contradict a
//      corrected node. Reproduced mechanically: the judgment carries a stamp and a "N nodes changed since" line.
//   bun run src/eval/currency-repro.ts
import { Store } from '../store/db.js';
import { Translator } from '../translator/translator.js';
import { updateTouchedMemories, getNodeMemory } from '../translator/memory.js';
import { composeState } from '../seed/composer.js';
import { chatAwareness } from '../translator/mapstatus.js';
import { rmSync } from 'fs';
const p = '/tmp/claude-1000/currency-repro.sqlite'; try { rmSync(p); rmSync(p + '-wal'); rmSync(p + '-shm'); } catch {}
const st = new Store(p); const pid = 'p1'; const db = (st as any).db;
db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(pid, 'repro');
st.applyAlterations(pid, [
  { op: 'create_node', id: 'root', parentId: null, content: 'A helloworld project', title: 'helloworld', status: 'live', author: 'user' },
  { op: 'create_node', id: 'sess', parentId: 'root', content: 'This session is a conversational chat with no file or command tools; file work needs a terminal.', title: 'Conversational session', status: 'noted', type: 'evidence', author: 'agent' },
] as any, { kind: 'system' } as any);
db.prepare("INSERT INTO chats (id, project_id, focus_container_id, status, created_at) VALUES ('c1', ?, 'root', 'active', datetime('now'))").run(pid);
db.prepare("INSERT INTO lit (chat_id, container_id) VALUES ('c1','root'), ('c1','sess')").run();
// a stale judgment, as the brain would have written it before the correction
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`understanding:${pid}`, JSON.stringify({ sections: { keystones: { text: 'The session has no file or command tools; file work requires a terminal.', ts: new Date(Date.now() - 60_000).toISOString() } } }));
// seed the node's memory the way the memory agent would have, from the first exchange
await updateTouchedMemories(st, ['sess'], 'is this session able to run commands?', 'No — this is a conversational chat with no file or command tools; use a terminal for file work.', {} as any);
const mem0 = getNodeMemory(st, 'sess') ?? '';
console.log(`before: node says "${st.getNode('sess')!.content.slice(0, 70)}…"\n        memory says "${mem0.slice(0, 90)}…"`);
// the correction round, through the production filer
const tr = new Translator(st);
const out = await tr.translateRound({ projectId: pid, chatId: 'c1', turnId: 't1', focusContainerId: 'root', userText: 'The map says this session has no file or command tools. That is wrong — you ran commands and read files a minute ago. This session does have file and command tools.', assistantText: 'Corrected: this session does have file and command tools; file work does not need a separate terminal.' } as any);
const alts = (out?.result?.alterations ?? []) as any[];
const node1 = st.getNode('sess')!;
const twins = alts.filter((a) => a.op === 'create_node' && /tools?/i.test(String(a.content))).length;
console.log(`round: ${alts.length} alteration(s); node now "${node1.content.slice(0, 80)}…"; decision twins created: ${twins}`);
// (a) the server writes MAP.md at the round — BEFORE the memory agent rewrites the memory
const served = (t: string) => t.split('WHAT THE MAP HOLDS')[0]; // the judgment block is part (b); (a) is about the memory organs
const mapAtRound = served(composeState(st, 'c1', [], undefined, { host: true }));
const staleAtRound = /no file or command tools/i.test(mapAtRound) && /does have|has file and command tools/i.test(node1.content);
console.log(`MAP.md at the round: statement corrected=${/does have|has file and command tools/i.test(node1.content)}, old claim still present in served memory=${staleAtRound}  ← the window Codex saw`);
await updateTouchedMemories(st, ['sess'], 'The map says this session has no file or command tools. That is wrong — this session does have file and command tools.', 'Corrected: this session does have file and command tools.', {} as any);
const mem1 = getNodeMemory(st, 'sess') ?? '';
const mapAfterMemory = served(composeState(st, 'c1', [], undefined, { host: true }));
const staleAfter = /no file or command tools/i.test(mapAfterMemory);
console.log(`memory after the rewrite: "${mem1.slice(0, 120)}…" → old claim kept by the memory agent=${/no file or command tools/i.test(mem1)}`);
console.log(`MAP.md recomposed after the memory rewrite: old claim present=${staleAfter}  ← with M253 the server rewrites the file at this moment; before, it did not`);
// (b) the brain's judgment
const aware = chatAwareness(st, pid);
console.log(`judgment block: ${/judged .*changed since/.test(aware) ? 'stamped, says nodes changed since it was written' : 'NO stamp'} → "${aware.slice(0, 160).replace(/\n/g, ' ')}…"`);
const ok = !/does have|has file and command tools/i.test(node1.content) ? false : (twins === 0 && !staleAfter && /changed since/.test(aware));
console.log(`\ncurrency repro: ${ok ? 'PASS (corrected node, no twin, MAP.md fresh after memory, judgment stamped)' : 'FAIL'}`);
process.exit(ok ? 0 : 1);

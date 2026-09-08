// M224: the user's words, the glossary, and the title guard — mechanical.
import { Store } from '../store/db.js';
import { recordUserWords, userWords, addGlossary, glossary, learnFromRename, parseGlossaryLine, vocabBlock, guardTitle, contentWords } from '../map/vocab.js';
import { systemCard } from '../translator/cast.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let pass = 0, fail = 0; const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const store = new Store(join(mkdtempSync(join(tmpdir(), 'vocab-')), 'map.sqlite')); const host = store as any; const pid = store.createProject('v');
ok('content words drop stop words, short words, numbers, and ids', contentWords('the tray is where the to-sort items land, per M123, 40 moves').join() === 'tray,to-sort,items,land,moves');
recordUserWords(host, pid, 'the session tab should open the tray; the tray is my inbox'); recordUserWords(host, pid, 'put the tray at the bottom');
const w = userWords(host, pid, 10, 2);
ok('counts accumulate across rounds and the block lists frequent words first', w[0]?.word === 'tray' && w[0]?.n === 3 && !w.some((x) => x.word === 'session'));
ok('words typed once are not law', userWords(host, pid, 10, 2).every((x) => x.n >= 2));
ok('no words, no glossary → empty block', vocabBlock(host, store.createProject('empty')) === '');
ok('the block names the words', /THE USER'S OWN WORDS/.test(vocabBlock(host, pid)) && /tray/.test(vocabBlock(host, pid)));
// a rename teaches the glossary
const e = learnFromRename(host, pid, 'Holding pen for unsorted items', 'Tray for unsorted items');
ok('one word left, one entered → an entry', e?.from === 'holding' && e?.to === 'tray');
ok('a wholesale rename teaches nothing', learnFromRename(host, pid, 'Auto-bind policy', 'The thing Mark asked for') === null);
ok('chat corrections parse', JSON.stringify(parseGlossaryLine('glossary: session instead of chat')) === JSON.stringify({ to: 'session', from: 'chat' }) && parseGlossaryLine('glossary: call it the tray, not the inbox')?.to === 'the tray' && parseGlossaryLine('glossary: nonsense') === null);
addGlossary(host, pid, 'chat', 'session', 'chat');
ok('the latest ruling wins and a flip-flop drops the old direction', (addGlossary(host, pid, 'session', 'chat', 'user').filter((x) => x.from === 'chat' || x.from === 'session').length === 1));
addGlossary(host, pid, 'chat', 'session', 'chat');
const g = guardTitle(host, pid, 'Chat tabs and the holding area');
ok('the guard swaps glossary words, keeps case, reports the change', g.title === 'Session tabs and the tray area' && g.changed.slice().sort().join() === 'chat→session,holding→tray');
ok('the guard leaves other words alone', guardTitle(host, pid, 'Chatter about sessions').title === 'Chatter about sessions');
ok('the system card carries the words and the glossary', /THE USER'S OWN WORDS/.test(systemCard(store, pid, 'the FILER')) && /say "session", not "chat"/.test(systemCard(store, pid, 'the FILER')));
// the choke point: an agent-written title is corrected on apply; a user edit is not
const id = randomUUID();
store.applyAlterations(pid, [{ op: 'create_node', id, parentId: null, content: 'x', title: 'Chat inbox rules', status: 'live', author: 'agent' } as any], { kind: 'round' });
ok('agent title corrected on apply', store.getNode(id)?.title === 'Session inbox rules');
store.applyAlterations(pid, [{ op: 'update_node', id, title: 'Chat inbox rules (mine)' } as any], { kind: 'user_edit' });
ok('user edit untouched', store.getNode(id)?.title === 'Chat inbox rules (mine)');
console.log(`vocab: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

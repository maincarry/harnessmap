import { Store } from '../store/db.js';
import { call } from '../inference.js';
import { loadMap, renderTree } from '../map/render.js';

// Second-place conversational memory (M42, Jacob): harness-style rolling
// summary of turns that scrolled out of the verbatim window — rebuilt in-house
// because the SDK's compaction can't be steered. Subordinate to the map:
// P1 write-time dedupe (map-covered material excluded), P2 removal notices
// honored (removed means removed everywhere), P3 read-time subordination
// (the block that consumes this labels the map as winning on conflict).
// Clean-chat NEVER resets it (a clean-the-view function): turns a clean cuts
// from the window are folded in like any others.

const SYSTEM = `You maintain the rolling summary of the older part of one conversation — the turns that have scrolled out of the verbatim window. This is SECOND-PLACE memory: a live map (provided) is the primary record of the work.

Fold the outgoing turns into the existing summary:
- EXCLUDE anything the map already records — nodes, decisions, statuses, questions. That is the map's job; repeating it here is harmful duplication.
- If the recent-removals list shows the user deleted something from the map, that topic is dead EVERYWHERE: drop it from the summary too, even if old turns discussed it. Removed means removed.
- What belongs here is what the map cannot hold: conversational texture — tone, mood, pace, small talk, social beats (jokes, apologies, frustration), meta-preferences about how to talk, and passing remarks that never became nodes.
- Temporal honesty: age things naturally. A mood from many turns ago must read as past ("was frustrated earlier"), and stale moods EXPIRE — drop them rather than carry them as current. Stable style preferences persist until contradicted.
- Informative first, compact second. Never past ~150 words — expire the oldest, least-consequential texture first.
Return the updated summary text only. Plain language, no headers, no bullets.`;

let chain: Promise<void> = Promise.resolve();

export function getConversationSummary(store: Store, chatId: string): string | null {
  const r = (store as any).db.prepare('SELECT text FROM conversation_summary WHERE chat_id = ?').get(chatId) as any;
  return r?.text ?? null;
}

// Fold every turn with idx <= throughIdx that hasn't been folded yet.
// Serialized on a module chain so folds never race each other.
export function foldTurns(store: Store, projectId: string, chatId: string, throughIdx: number, removals: string[]): Promise<void> {
  chain = chain.then(() => doFold(store, projectId, chatId, throughIdx, removals)).catch(() => {});
  return chain;
}

async function doFold(store: Store, projectId: string, chatId: string, throughIdx: number, removals: string[]): Promise<void> {
  const db = (store as any).db;
  const row = db.prepare('SELECT text, folded_through FROM conversation_summary WHERE chat_id = ?').get(chatId) as any;
  const from = (row?.folded_through ?? -1) + 1;
  if (throughIdx < from) return; // nothing new to fold
  const turns = store.getTurns(chatId).filter((t) => t.idx >= from && t.idx <= throughIdx && t.role !== 'system');
  if (turns.length === 0) {
    db.prepare(`INSERT INTO conversation_summary (chat_id, text, folded_through) VALUES (?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET folded_through = excluded.folded_through`)
      .run(chatId, row?.text ?? '', throughIdx);
    return;
  }

  const tree = renderTree(loadMap(store, projectId));
  try {
    const text0 = await call({
      task: 'summary', system: SYSTEM, maxTokens: 300, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `CURRENT MAP (exclude what it covers):\n${tree}`,
          removals.length ? `RECENT REMOVALS (drop these topics from the summary too):\n${removals.map((r) => `- ${r}`).join('\n')}` : '',
          `EXISTING SUMMARY:\n${row?.text || '(none yet)'}`,
          `OUTGOING TURNS (scrolled out of the verbatim window):\n${turns.map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, 800)}`).join('\n\n')}`,
          'Fold.',
        ].filter(Boolean).join('\n\n'),
    });
    const text = String(text0 ?? '').trim();
    if (text) {
      db.prepare(`INSERT INTO conversation_summary (chat_id, text, folded_through) VALUES (?, ?, ?)
                  ON CONFLICT(chat_id) DO UPDATE SET text = excluded.text, folded_through = excluded.folded_through, updated_at = datetime('now')`)
        .run(chatId, text, throughIdx);
    }
  } catch (err) {
    console.error('[rolling-summary] fold failed (will retry next round):', err);
  }
}

import { Store } from '../store/db.js';
import { call } from '../inference.js';

// Per-node chat memory (M41, Jacob): the third layer of a node's state —
// description (what it is), fit (how it relates), MEMORY (what was discussed
// while it was the focus). Updated asynchronously after each round, merging
// the new exchange into the running digest. Read by the composer whenever the
// node is focused again — memory deeper than the rolling turn window.

const SYSTEM = `You maintain the conversational memory of one node on a goal map: a running digest of the CONVERSATION that happened while this node was the focus — not a content summary alone.

You get the node, its EXISTING MEMORY (may be empty), and the NEWEST EXCHANGE. Merge the exchange into the memory, capturing the shape of the dialogue:
- WHAT THE USER ASKED or brought up, HOW THE AGENT RESPONDED (its key point or suggestion, briefly), and HOW THE USER SEEMED TO TAKE IT — accepted, pushed back, hesitated, ignored, got frustrated, changed the subject. That reaction trail is what makes resuming feel continuous.
- Content stays the spine: positions and their reasons, decisions and their why, options weighed, objections, promises, unresolved threads. The dialogue framing serves the content, not the other way around.
- Integrate, don't append — fold new information into what's there; drop what got superseded.
- Informative first, compact second: a few sentences up to one short paragraph. Never past ~150 words — compress the oldest, least-consequential material first.
- Plain language, the conversation's own vocabulary. No headers, no bullets.

Return the updated memory text only.`;

export async function updateNodeMemory(store: Store, nodeId: string, userText: string, assistantText: string): Promise<void> {
  const n = store.getNode(nodeId);
  if (!n) return;
  const db = (store as any).db;
  const existing = (db.prepare('SELECT text FROM node_memory WHERE node_id = ?').get(nodeId) as any)?.text ?? '';
  try {
    const text0 = await call({
      task: 'memory', system: SYSTEM, maxTokens: 300, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `NODE: ${n.type ? `${n.type}: ` : ''}${n.content}`,
          `EXISTING MEMORY:\n${existing || '(none yet)'}`,
          `NEWEST EXCHANGE:\nUSER: ${userText.slice(0, 1500)}\nAGENT: ${assistantText.slice(0, 1500)}`,
          'Merge.',
        ].join('\n\n'),
    });
    const text = String(text0 ?? '').trim();
    if (text) {
      db.prepare("INSERT OR REPLACE INTO node_memory (node_id, text, updated_at) VALUES (?, ?, datetime('now'))").run(nodeId, text);
    }
  } catch (err) {
    console.error('[memory] update failed (will catch up next round):', err);
  }
}

// M156 slice 1 (Mark + Jacob): every node the ROUND TOUCHED gets its memory
// updated — not just the focus, and pointedly NOT "all lit nodes": the filer
// already identified which nodes this round is about (Jacob's tiered-cost
// point), so the batch is small (typically 1-5) and relevance-driven. ONE
// cheap call maintains them all.
const BATCH_SYSTEM = `You maintain the conversational memories of SEVERAL nodes on a goal map — for each, a running digest of what the conversation established about THAT node (positions and reasons, decisions and their why, open threads, how the user reacted). You get the newest exchange and each node with its existing memory. For each node, fold in ONLY what this exchange says about that node — different nodes take different things from the same exchange. Integrate, don't append; drop superseded material; ≤120 words each; plain language, no headers. If the exchange adds nothing for a node, return its memory unchanged.`;

const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['updates'],
  properties: { updates: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'memory'],
    properties: { id: { type: 'string' }, memory: { type: 'string' } },
  } } },
} as const;

export async function updateTouchedMemories(store: Store, nodeIds: string[], userText: string, assistantText: string): Promise<void> {
  const db = (store as any).db;
  const nodes = [...new Set(nodeIds)].map((id) => store.getNode(id)).filter((n): n is NonNullable<typeof n> => !!n && n.status !== 'removed').slice(0, 6);
  if (!nodes.length) return;
  try {
    const parsed = await call({
      task: 'memory', system: BATCH_SYSTEM, maxTokens: 1200, schema: BATCH_SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `NEWEST EXCHANGE:
USER: ${userText.slice(0, 1500)}
AGENT: ${assistantText.slice(0, 1500)}`,
        ...nodes.map((n) => {
          const ex = (db.prepare('SELECT text FROM node_memory WHERE node_id = ?').get(n.id) as any)?.text ?? '';
          return `NODE [${n.id}]: ${n.type ? `${n.type}: ` : ''}${n.content}
EXISTING MEMORY: ${ex || '(none yet)'}`;
        }),
        'Update each memory.',
      ].join('\n\n'),
    });
    for (const u of parsed.updates ?? []) {
      const id = String(u.id ?? '').replace(/[\[\]]/g, '');
      if (!nodes.some((n) => n.id === id)) continue;
      const text = String(u.memory ?? '').trim();
      if (text) db.prepare("INSERT OR REPLACE INTO node_memory (node_id, text, updated_at) VALUES (?, ?, datetime('now'))").run(id, text);
    }
  } catch (err) {
    console.error('[memory] batch update failed (next round catches up):', err);
  }
}

export function setNodeMemory(store: Store, nodeId: string, text: string): void {
  const db = (store as any).db;
  if (text) {
    db.prepare("INSERT OR REPLACE INTO node_memory (node_id, text, updated_at) VALUES (?, ?, datetime('now'))").run(nodeId, text);
    store.metric(store.getNode(nodeId)?.projectId ?? null, 'memory.stored', text.length);
  }
}

export function clearNodeMemory(store: Store, nodeId: string): void {
  (store as any).db.prepare('DELETE FROM node_memory WHERE node_id = ?').run(nodeId);
}

export function getNodeMemory(store: Store, nodeId: string): string | null {
  const r = ((store as any).db.prepare('SELECT text FROM node_memory WHERE node_id = ?').get(nodeId) as any);
  return r?.text ?? null;
}

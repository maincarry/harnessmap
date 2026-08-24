import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree, descendantNodes } from '../map/render.js';

// Auto-focus / auto-zoom (v0.3.1, Jacob): the map agent RECOMMENDS a topic —
// nothing is applied server-side; the client asks the user to confirm first.

const FOCUS_SYSTEM = `You advise on where a goal-map conversation should aim next. Given the map (ids in [brackets]; ▶ marks the current focus) and the tail of the conversation, pick the ONE node that most deserves the conversation's focus now: open questions blocking progress, active work mid-flight, or a neglected commitment going stale. Prefer specific sub-nodes over broad parents. If the current focus is still clearly right, recommend it and say why.

containerId can be ANY node's id — focusing on a specific claim/option/question is allowed and often right. Prefer the tightest node that captures where the conversation should aim.

Return: containerId (a node id exactly as in [brackets]) + reason (one sentence, addressed to the user).`;

const ZOOM_SYSTEM = `You advise on which part of a goal map the user should isolate visually (zoom into) to reduce clutter. Given the map (ids in [brackets]; ▶ marks the conversation's focus) and the tail of the conversation, pick the ONE node whose subtree the user is really working in right now. Prefer the tightest subtree that contains the live action.

Return: containerId (a node id exactly as in [brackets]) + reason (one sentence, addressed to the user).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['containerId', 'reason'],
  properties: { containerId: { type: 'string' }, reason: { type: 'string' } },
} as const;

export interface TopicRec { containerId: string; name: string; reason: string }

export async function proposeTopicRec(
  store: Store, projectId: string, chatId: string, kind: 'focus' | 'zoom',
  feedback?: string, priorSummary?: string,
): Promise<TopicRec | { error: string }> {
  const map = loadMap(store, projectId);
  const chat = store.getChats(projectId).find((c) => c.id === chatId);
  const tree = renderTree(map, { ids: true, focusId: chat?.focusContainerId ?? undefined });
  const tail = store.getTurns(chatId).slice(-6)
    .map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, 400)}`).join('\n');

  // Mechanical deepest-match guard (same haiku parent-bias as mapchat, bench-
  // proven): when the user's direction names something more specific than the
  // picked node, retarget to the best-matching descendant.
  const STOP = new Set(['the', 'this', 'that', 'with', 'about', 'want', 'focus', 'work', 'stuff', 'not']);
  const toks = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const deepestMatch = (text: string, pickedId: string): string => {
    const qt = toks(text);
    const score = (id: string) => { const n = store.getNode(id); if (!n || n.status === 'removed') return -1; const nt = toks(`${n.title ?? ''} ${n.content}`); let c = 0; for (const w of qt) if (nt.has(w)) c++; return c; };
    let best = pickedId, bestScore = score(pickedId);
    for (const id of descendantNodes(store, pickedId)) { const sc = score(id); if (sc > bestScore) { best = id; bestScore = sc; } }
    return best;
  };
  try {
    const parsed = await call({
      task: 'recommend', system: (kind === 'focus' ? FOCUS_SYSTEM : ZOOM_SYSTEM) + systemCard(store, projectId, kind === 'focus' ? 'the FOCUS agent' : 'the ZOOM agent'), maxTokens: 500, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [`MAP (ids in [brackets]):\n${tree}`, `CONVERSATION TAIL:\n${tail || '(none yet)'}`,
        ...(priorSummary ? [`YOUR PREVIOUS RECOMMENDATION (the user saw it and wants something different): ${priorSummary}`] : []),
        ...(feedback ? [`THE USER'S DIRECTION — this OVERRIDES your own instincts: ${feedback}`] : []),
        'Recommend.'].join('\n\n'),
    });
    const rawId = String(parsed.containerId ?? '').replace(/[\[\]]/g, '');
    const c = map.nodes.find((x) => x.id === rawId || x.id.startsWith(rawId));
    if (!c) {
      console.error(`[recommend:${kind}] unresolvable id from model:`, JSON.stringify(parsed));
      return { error: 'the model recommended an unknown topic — try again' };
    }
    let targetId = c.id;
    if (feedback) {
      const better = deepestMatch(feedback, c.id);
      if (better !== c.id) { store.audit('recommend_retarget', { from: c.id.slice(0, 8), to: better.slice(0, 8) }); targetId = better; }
    }
    const t = store.getNode(targetId)!;
    return { containerId: t.id, name: t.title || t.content, reason: parsed.reason ?? '' };
  } catch (err) {
    console.error(`[recommend:${kind}] failed:`, err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { call } from '../inference.js';
import { loadMap, renderTree, descendantNodes } from '../map/render.js';
import { renderTieredTree } from '../map/render.js';
import { statusConsult } from './mapstatus.js';

// Auto-focus / auto-zoom (v0.3.1, Jacob): the map agent RECOMMENDS a topic —
// nothing is applied server-side; the client asks the user to confirm first.

const FOCUS_SYSTEM = `You advise on where a goal-map conversation should aim next. Given the map (ids in [brackets]; ▶ marks the current focus) and the tail of the conversation, pick the ONE node that most deserves the conversation's focus now: open questions blocking progress, active work mid-flight, or a neglected commitment going stale. Prefer specific sub-nodes over broad parents. If the current focus is still clearly right, recommend it and say why.
If the latest turn asks about a topic the map already holds, the conversation is aiming THERE now: the focus is the node that holds that topic (the tightest one), not the frontier of the work. (M200, Jacob: the focus follows the question.)

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

// M200/M218: the word guards, shared with the merged re-aim. A question names
// its topic in its own words: when the model's pick shares no words with the
// text but some node shares two RARE ones (in under 5% of nodes), the aim
// goes there; then the best-matching descendant of that node wins.
export function retargetByWords(store: Store, map: { nodes: any[] }, text: string, pickedId: string): { id: string; whole: boolean } {
  const STOP = new Set(['the', 'this', 'that', 'with', 'about', 'want', 'focus', 'work', 'stuff', 'not']);
  const toks = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const live = map.nodes.filter((n: any) => n.status !== 'removed');
  const words = new Map<string, Set<string>>(); const df = new Map<string, number>();
  for (const n of live) { const ws = toks(`${n.title ?? ''} ${n.content}`); words.set(n.id, ws); for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1); }
  const cap = Math.max(3, Math.ceil(live.length * 0.05));
  const rare = [...toks(text)].filter((w) => (df.get(w) ?? 0) > 0 && (df.get(w) ?? 0) <= cap);
  const pickedWords = words.get(pickedId) ?? new Set<string>();
  let whole = pickedId;
  if (rare.length >= 2 && !rare.some((w) => pickedWords.has(w))) {
    let best = pickedId, bestN = 1;
    for (const n of live) { const c = rare.filter((w) => words.get(n.id)!.has(w)).length; if (c > bestN) { best = n.id; bestN = c; } }
    whole = best;
  }
  const qt = toks(text);
  const score = (id: string) => { const n = store.getNode(id); if (!n || n.status === 'removed') return -1; const nt = toks(`${n.title ?? ''} ${n.content}`); let c = 0; for (const w of qt) if (nt.has(w)) c++; return c; };
  let best = whole, bestScore = score(whole);
  for (const id of descendantNodes(store, whole)) { const sc = score(id); if (sc > bestScore) { best = id; bestScore = sc; } }
  return { id: best, whole: whole !== pickedId };
}

export interface TopicRec { containerId: string; name: string; reason: string }

export async function proposeTopicRec(
  store: Store, projectId: string, chatId: string, kind: 'focus' | 'zoom',
  feedback?: string, priorSummary?: string, tailOverride?: string,
): Promise<TopicRec | { error: string }> {
  const map = loadMap(store, projectId);
  const chat = store.getChats(projectId).find((c) => c.id === chatId);
  // M194 (Jacob): tiered context, same model as the chat briefing.
  const tree = renderTieredTree(store, projectId, chat?.focusContainerId ?? null, 40_000);
  const tail = tailOverride ?? store.getTurns(chatId).slice(-6)
    .map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, 400)}`).join('\n');

  try {
    const parsed = await call({
      task: 'recommend', system: (kind === 'focus' ? FOCUS_SYSTEM : ZOOM_SYSTEM) + systemCard(store, projectId, kind === 'focus' ? 'the FOCUS agent' : 'the ZOOM agent'), maxTokens: 500, schema: SCHEMA as any, timeoutMs: 90_000,
      audit: (k, d) => store.audit(k, d),
      user: [`MAP (ids in [brackets]):\n${tree}`, `CONVERSATION TAIL:\n${tail || '(none yet)'}`,
        ...(priorSummary ? [`YOUR PREVIOUS RECOMMENDATION (the user saw it and wants something different): ${priorSummary}`] : []),
        ...(feedback ? [`THE USER'S DIRECTION — this OVERRIDES your own instincts: ${feedback}`] : []),
        'Recommend.'].join('\n\n') + statusConsult(store, projectId, undefined, 'lighting'),
    });
    const rawId = String(parsed.containerId ?? '').replace(/[\[\]]/g, '');
    const c = map.nodes.find((x) => x.status !== 'removed' && (x.id === rawId || x.id.startsWith(rawId)));
    if (!c) {
      console.error(`[recommend:${kind}] unresolvable id from model:`, JSON.stringify(parsed));
      return { error: 'the model recommended an unknown topic — try again' };
    }
    let targetId = c.id;
    const direction = feedback || (kind === 'focus' ? (tailOverride ?? '') : '');
    if (direction) {
      const r = retargetByWords(store, map, direction, c.id);
      if (r.id !== c.id) { store.audit('recommend_retarget', { from: c.id.slice(0, 8), to: r.id.slice(0, 8), whole: r.whole }); targetId = r.id; }
    }
    const t = store.getNode(targetId)!;
    return { containerId: t.id, name: t.title || t.content, reason: parsed.reason ?? '' };
  } catch (err) {
    console.error(`[recommend:${kind}] failed:`, err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

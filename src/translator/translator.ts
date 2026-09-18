import { randomUUID } from 'node:crypto';
import { systemCard } from './cast.js';
import { statusConsult } from './mapstatus.js';
import { call, modelFor, backendName } from '../inference.js';
import type { Alteration, RoundResult } from '../types.js';
import { Store } from '../store/db.js';
import { loadMap, renderTree, renderScopedTree, descendantNodes, type MapView } from '../map/render.js';
import { matchNodes } from '../map/match.js';
import type { MapNode } from '../types.js';

// The bridge (DESIGN.md §4): per-round, map-conditioned translation.
// Runs async — never blocks the chat. Cheap fast model.

export const TRANSLATOR_MODEL = modelFor('filer');

const SYSTEM = `You are the translator in a two-layer system. The user chats with an AI agent (the history layer); you maintain the MAP (the goal layer): a tree of NODES. Every line on the map is a node — there is only one kind of thing. A node has one line of content, an optional type, a status, and children. A "topic" is just a node whose children matter more than its own sentence; a claim or option is a node that may grow children of its own (evidence under the claim it supports, objections under the option they attack, sub-questions under a question).

FIXED TYPE SET — every typed node you create or retype uses EXACTLY one of: claim, question, option, decision, constraint, evidence, task. Plain topic/heading nodes omit type entirely. Never invent other type labels — consistent labeling is your contract (the user may freely retype any node afterwards; that freedom is theirs, not yours). Tentative musings ("is this too cliche?", "maybe X") are claim or question with status 'exploratory'. Suggested statuses: floated/proposed/accepted/rejected (claims), open/answered/mooted (questions), live/chosen/dropped (options), proposed/decided/reversed (decisions), active/hard/relaxed/lifted (constraints), noted/cited/retracted (evidence), todo/doing/done/dropped (tasks); heading nodes are live or provisional. Any node may also be 'parked' (explicitly deferred) or 'exploratory' (tentative, half-formed, not yet committed). Status 'removed' is reserved for the user.

Each round you receive the current map and the newest exchange. Produce:
1. summary — one or two sentences interpreting what just happened, USING THE MAP'S EXISTING VOCABULARY (if the map has "thesis", say "thesis", never "the claim about X").
2. alterations — the map changes this round justifies.

YOUR TWO CORE DUTIES:

A. CAPTURE EVERYTHING. Every user move lands on the map — commitments AND exploration. The map is the live state of the user's thinking, not just its settled conclusions.
- Casual asides ARE binding: "not copyright" → decision; "for normal people, remember" → constraint; "use the median" → decision. Half of real commitments arrive as asides.
- Tentative, half-formed, or doubting moves are captured too, and their status MUST be exactly 'exploratory': "maybe this whole post is a bad idea" → claim, exploratory; "hmm, what if we did X" → option, exploratory; "feels weaker" / "is this too cliche?" → question, exploratory. The user prunes later — never silently drop their thinking, and never mark tentative musings with solid statuses.
- Things the USER asserts firmly are solid (accepted/decided/active). Things the AGENT merely proposes enter floated/noted and are promoted only when the user engages.
- THIS IS A TOPIC MAP. Whatever gets discussed IS a topic and belongs on the map, however mundane and whether or not anything is being weighed or decided — "what should I get for breakfast" is a topic; "whether the agent had lunch" is a topic; an essay thesis is a topic. There is no dignity threshold and no requirement that a topic contain a question, options, or a decision. Do not classify something as "not about the work" or "not substantive enough": whatever the user is talking about IS the work. New topics land like all topics (in scope, or under "to sort") and get resolved/cleaned like everything else.
- ONLY pure dialogue mechanics produce nothing: greetings, confirmations, "ok"/"thanks", pleasantries that carry no topic at all, and meta-instructions about the harness itself.

B. INTEGRATE, DON'T APPEND. The map is a goal structure, not a chronological log. Fit each round's material INTO the existing tree:
- PLACE new nodes under the node they are ABOUT — and that can be ANY node, not just headings. Evidence for a claim goes UNDER that claim (parentId = the claim's id). An objection to an option goes under that option. Detail elaborating a decision goes under the decision. Only when material relates to a whole area, not one node in it, does it go under the heading node. Never let material pile up flat at the root once structure exists, and NEVER create a sibling node that duplicates an existing node's content just to hold children — put the children under the existing node itself.
- INFO EXPANSION: when the user asks to know more about something already on the map (a "tell me more about X" round), the agent's answer EXPANDS node X: file each distinct fact as its own child node UNDER X (typically evidence, status noted), merging with X's existing children where they overlap. Never file the facts as siblings of X, never compress the whole answer into one blob node.
- NODES STATE FACTS, NEVER NARRATE THE DIALOGUE: content like "User asked about X; agent explained Y" is FORBIDDEN — that is the transcript's job. A node carries the fact/commitment/question itself, as a standalone statement.
- MERGE, don't duplicate: if the round refines something already on the map, update_node that id (content and/or status). Same thing in new words = the same node. When the round OVERTURNS part of a node's statement (a reversal, a lifted deferral, a rule replaced), the new content states the CURRENT rule in its first sentence and drops the overturned clause — the node's earlier statement survives in its history, so the old wording must never stand beside the new as if both held.
- STICKY STRUCTURE: existing nodes keep their identity, content, and position. You may ADD nodes anywhere in scope, but you NEVER restructure what exists: do not move existing nodes (move_node is only for nodes created earlier THIS round, or for "to sort" children finding their home), do not split or merge existing nodes.
- SUGGEST, DON'T RESTRUCTURE. This is a duty, not an option: every round, look at the node(s) you just filed under and ask "does this subtree hold two or more unrelated topics, duplicates, or material that outgrew it?" If yes, you MUST also emit suggest_restructure {nodeId, note} — note is one sentence saying what you'd change and why (e.g. "This mixes the apartment hunt with the birthday dinner — split into two topics."). The user sees it as a dot on that node and decides; nothing happens without them. One suggestion per node per round; re-suggesting replaces your earlier note.
- UPWARD PROPAGATION: after integrating, if a heading node's content (including the root topic) no longer reflects what its children now are, update_node its content — conservatively, keeping recognizable vocabulary.
- AUTO-NAME UNTITLED: a node whose content is "untitled" is one the user created without naming (deliberately — the system names it for them). As soon as this round tells you what it is about, update_node it with BOTH: content = an informative statement of what it is, AND title = a minimal 2-4 word label. Check the WHOLE map every round: if ANY node still says "untitled" and the conversation gives any clue what it's for, name it now. Never leave an untitled node unnamed once material has landed under it.
- MANDATORY when the FOCUS node itself is "untitled": the user just created it and aimed the conversation at it, so THIS round is definitionally about it. You MUST update_node it this round with real content and a title drawn from what the round discussed — no exceptions, even if the round felt tangential (name it from the best available signal). This rule is ONLY about naming that untitled node — it never licenses filing off-topic material under the focus or stretching a NAMED focus node's content to cover a stray round; strays go to "to sort" as always.

PLACEMENT SCOPE — read everywhere, WRITE only in the light:
- You READ the whole map, including lines marked (dim) — use that full knowledge for judgment. But (dim) lines are NOT WRITABLE: the user has those branches dimmed, so you may not create nodes under them, update them, or move things into them. Writable: the focus subtree, lit branches, and the "to sort" node.
- ONE NODE = ONE THING (M286): when the round enumerates alternatives — plans, options, candidates, steps to choose from — make a PARENT node for the question or topic and ONE CHILD per item (type option, status live), never a single node whose statement lists them "(1) … (2) … (3)". A list crammed into one statement cannot be chosen from, dimmed, or corrected item by item. The same for several distinct decisions or facts in one breath: one node each.
- TWO THINGS IN ONE BREATH ARE TWO NODES (M286): when a message corrects one node AND states a separate new rule, fact or task ("and separately…", "also…", "one more thing…"), the correction updates the existing node and the new thing is created as its own node — never folded into the corrected node's statement.
- CHOOSING NEVER ERASES (M286): when the user picks one alternative, mark it chosen and the others dropped — do not rewrite the parent's statement to the winner, do not remove the losers; the record of what was on the table stays on the map.
- THE TOP LEVEL IS ORDINARY (M278): a new topic that belongs under no lit branch becomes a new TOP-LEVEL node — create_node with parentId null, named as a topic, its question/options/evidence nested under it. There is no difference between a top-level node and any other; do not hunt for a parent that merely "sort of" fits, and never wedge an unrelated topic under the focus.
- "to sort" is only for two things: material that belongs under a DIM branch (not writable — the user set it aside; file it under "to sort" with the placement suggestion below so one click moves it home when they light the branch), and fragments you cannot name as a topic.
- ONE TOPIC = ONE SUBTREE in "to sort": create a single topic node for it, and nest its question/options/constraints/evidence UNDER that node — NEVER as sibling children of "to sort". The user moves things out of "to sort" whole; scattered siblings tear apart. Record provenance once, in the topic node's content: append " (arrived while focus was: <current focus name>)".
- When you can tell where the material belongs, ALSO emit suggest_relight {nodeId: <the new to-sort node's id>, note: 'belongs under "<branch name>" [<branch id>]'} — a PLACEMENT suggestion the user can approve as a one-click move. nodeId MUST be the id of the to-sort node you just created — NEVER skip creating the node (a note alone loses the material if dismissed), and never point the suggestion at the destination branch itself.
- TO-SORT INTEGRATION: each round, look at the "to sort" children. If one's home is now WRITABLE, move_node it there and strip the provenance note from its content. This is the one case where moving an existing node is your job.
- EXPANSION ON DEMAND: if you cannot do this round's job properly without READING a (dim) branch — e.g. to check whether the material already exists there (never duplicate dim content into "to sort"), or to write a precise placement note — output ONE alteration only: request_expansion {ids: [up to 3 dim ids]}. You will be re-run immediately with those branches readable. Expanded branches are READ-ONLY: even after expansion, writes outside the light still go to "to sort". Request expansion only when the names alone genuinely aren't enough — most rounds need none.

Other rules:
- REBUKES that state a RULE produce two things: (1) the artifact fix (remove/downgrade the rejected thing) AND (2) a standing decision/constraint node capturing the rule. "why is copyright in there — I said authorship" → downgrade the copyright node AND create decision "angle = authorship, not copyright" [decided]. A CORRECTION OF A FACT is different: "the map says this session has no tools — it does" corrects the node that holds the claim (update_node, rewritten to the truth) and creates NOTHING — a fact about the world or the environment is never a decision, and a corrected node needs no twin.
- ONE COMMITMENT = ONE NODE. Atomic nodes are what the user can later point at. Never blob separate commitments together.
- TITLE + CONTENT ARE SEPARATE (the map displays titles; content is the record). content = a SELF-CONTAINED, INFORMATIVE statement — a reader who never saw the conversation must understand it. Carry the specifics: numbers, names, reasons, qualifiers, the WHY behind a decision ("cook myself — cheaper than catering and 2 guests are gluten-free" beats "cook myself"). Informative first, compact second: 1-3 sentences, no filler. title = a MINIMAL label: 2-4 plain everyday words, NEVER more than 6 — how the user would casually refer to it out loud ("rail pass", "guest list", "weather and mood"). DROP nuance rather than cram it in: a title names the thing, it does not summarize the statement (bad: "weather excuse versus genuine"; good: "weather as excuse"). EVERY node you create gets a title when its content runs past a few words. When you update a node whose meaning shifted, refresh its title too. When the map you receive shows a node with a long line and no sign of a short label, give it one via update_node {title}.
- STATUSES ARE PER-NODE EARNED STATES, NOT SESSION MOODS. A single utterance normally changes the status of 1–3 nodes, never the whole map. "Ok, park all of it" said while discussing one thread parks THAT THREAD'S nodes only — every decision, constraint, and piece of evidence settled earlier on the map KEEPS its solid status (decided stays decided, active stays active). Ending a session parks nothing by itself.
- META-INSTRUCTIONS BECOME TASKS: "remind me", "don't let me forget" → task (todo).
- Eager headings: newly introduced topics become heading nodes at introduction (status 'provisional', author marked) so later rounds have an addressable target — under an in-scope parent when one fits, otherwise under "to sort". User-declared deliverables are born 'live'.
- CHOOSING RETIRES RIVALS: when the user picks one option, mark it chosen AND mark the competing options of that same choice dropped — a decided question leaves no live alternatives behind.
- Flip-flops apply in utterance order ("scratch it — wait no, keep as maybe" ends parked).
- Generate ids as short random strings for new nodes; reference existing map ids exactly as given in [brackets].
- DATE: when the round states WHEN a ruling or fact happened ("yesterday", "on Aug 23", a dated entry), put it on the alteration as date "YYYY-MM-DD"; leave it out when the round does not say — never invent one. The node's timeline shows that date; without it, the day the map changed.
- For create_node at the top level, OMIT parentId entirely; otherwise set parentId to the node this is about (any node works as a parent).`;

// Schema notes (hard-won, 2026-08-12):
//  - NO type unions (['string','null'] hangs schema compilation server-side).
//  - NO single flat object with many optional properties (13 optionals under
//    additionalProperties:false explodes the constrained-decoding grammar —
//    observed as 60s+ compile then timeout/400). Per-op anyOf variants with
//    mostly-required fields compile fine and validate more precisely anyway.
const variant = (op: string, props: Record<string, unknown>, required: string[], optional: Record<string, unknown> = {}) => ({
  type: 'object' as const,
  properties: { op: { type: 'string' as const, enum: [op] }, ...props, ...optional },
  required: ['op', ...required],
  additionalProperties: false,
});
const str = { type: 'string' as const };
const author = { type: 'string' as const, enum: ['user', 'agent'] };
// M253 guard, tightened in M256 (Mark's Codex retest found it dropped distinct commitments on the same topic —
// "ask for approval before deleting files" beside "this session has command tools"): a decision/constraint created in
// the same round as a content rewrite is a TWIN only when it restates that statement — most of its rare words (≥ 60%,
// at least two) already sit in the rewritten text. A commitment that adds its own words survives.
export function dropCorrectionTwins(alterations: any[], nodes: { title?: string | null; content: string }[], audit: (d: Record<string, unknown>) => void): any[] {
  const rewritten = alterations.filter((a) => a.op === 'update_node' && typeof a.content === 'string' && a.content.trim());
  if (!rewritten.length) return alterations;
  const df = new Map<string, number>();
  const toks = (t: string) => new Set((t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
  for (const n of nodes) for (const w of toks(`${n.title ?? ''} ${n.content}`)) df.set(w, (df.get(w) ?? 0) + 1);
  const rare = (w: string) => (df.get(w) ?? 0) <= Math.max(2, Math.ceil(nodes.length * 0.05));
  const out: any[] = [];
  for (const a of alterations) {
    if (a.op === 'create_node' && (a.type === 'decision' || a.type === 'constraint')) {
      const cw = [...toks(`${a.title ?? ''} ${a.content ?? ''}`)].filter(rare);
      const dup = rewritten.find((r) => { const rw = toks(r.content); const shared = cw.filter((w) => rw.has(w)).length; return cw.length > 0 && shared >= 2 && shared / cw.length >= 0.6; });
      if (dup) { audit({ dropped: String(a.content ?? '').slice(0, 80), rewrote: dup.id }); continue; }
    }
    out.push(a);
  }
  return out;
}
export const CANON_TYPES = ['claim', 'question', 'option', 'decision', 'constraint', 'evidence', 'task'];
const canonType = { type: 'string' as const, enum: CANON_TYPES };
const linkType = { type: 'string' as const, enum: ['supports', 'objection-to', 'replies-to', 'answers', 'motivated-by', 'satisfies', 'blocks', 'chooses'] };

export const SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const },
    alterations: {
      type: 'array' as const,
      items: {
        anyOf: [
          // type omitted or '' = plain heading node.
          variant('create_node', { id: str, content: str, status: str, author }, ['id', 'content', 'status', 'author'], { parentId: str, type: str, title: str, date: str }),
          variant('update_node', { id: str }, ['id'], { content: str, status: str, type: str, title: str, date: str }),
          variant('move_node', { id: str, parentId: str }, ['id', 'parentId']),
          variant('create_link', { id: str, type: linkType, fromItemId: str, toId: str }, ['id', 'type', 'fromItemId', 'toId']),
          variant('suggest_restructure', { nodeId: str, note: str }, ['nodeId', 'note']),
          variant('suggest_relight', { nodeId: str, note: str }, ['nodeId', 'note']),
          variant('request_expansion', { ids: { type: 'array' as const, items: str } }, ['ids']),
        ],
      },
    },
  },
  required: ['summary', 'alterations'],
  additionalProperties: false,
};
// M75 (Jacob): explicit "let's focus on X" in the round → the filer flags it
// (optional top-level field); the server turns it into a red-dot nudge + a
// one-shot host notice. Kept out of `required` so most rounds omit it.
(SCHEMA.properties as any).focus_request = {
  type: 'object' as const,
  properties: { id: { type: 'string' as const } },
  required: ['id'],
  additionalProperties: false,
};

const STOP = new Set(['this','that','with','from','into','have','been','were','they','them','their','than','then','will','would','should','could','about','after','before','along','also','only','some','such','very','more','most','goes','need','needs','still','over','under','when','where','which','while','what','your','there','these','those','does','done','just','like','make','made','much','many','each','both','same','other','every','next','last','first'])

export class Translator {
  constructor(private store: Store) {}

  // Translate one round. Returns the applied result (already persisted) or null on failure.
  // Failures are non-fatal by design: the map is a beat behind, never a blocker.
  async translateRound(params: {
    projectId: string;
    chatId: string;
    turnId: string;
    focusContainerId: string;
    userText: string;
    assistantText: string;
  }): Promise<{ roundId: string; result: RoundResult; focusRequestId: string | null; debug: { inputTree: string; rawText: string } } | null> {
    const map = loadMap(this.store, params.projectId);
    // M47: the filer's knowledge obeys the light — focus subtree + lit
    // branches + "to sort" render in full; the rest is name-only. WRITE scope
    // never grows; READ scope may grow once via expansion-on-demand.
    const writeScope = new Set<string>([params.focusContainerId, ...descendantNodes(this.store, params.focusContainerId)]);
    for (const id of this.store.getLit(params.chatId)) writeScope.add(id);
    const toSort = map.nodes.find((n) => n.parentId === null && n.status !== 'removed' && (n.content === 'to sort' || n.content.startsWith('to sort')));
    if (toSort) { writeScope.add(toSort.id); for (const d of descendantNodes(this.store, toSort.id)) writeScope.add(d); }
    const readScope = new Set(writeScope);

    // Deterministic integration trigger (M48): when "to sort" holds items
    // whose suggested home is now writable, say so explicitly in this round's
    // message — the duty fires reliably only at the decision point.
    let integrationNote = '';
    if (toSort) {
      const relights = this.store.getOpenSuggestions(params.projectId).filter((x) => x.kind === 'relight');
      const pending: string[] = [];
      for (const kid of this.store.childrenOf(toSort.id)) {
        if (kid.status === 'removed') continue;
        const sg = relights.find((x) => x.nodeId === kid.id);
        const m = sg?.note.match(/\[([0-9a-f]{8})/);
        const target = m ? map.nodes.find((n) => n.id.startsWith(m[1])) : undefined;
        if (target && writeScope.has(target.id)) {
          pending.push(`- "${kid.content.slice(0, 80)}" [${kid.id.slice(0, 8)}] → suggested home "${target.title || target.content.slice(0, 40)}" [${target.id.slice(0, 8)}] is NOW WRITABLE`);
        }
      }
      if (pending.length) {
        integrationNote = `PENDING INTEGRATION — decide THIS round for each: move_node it to its home (adjusting content: strip the provenance note) if it fits there, or leave it in "to sort" if it does not:\n${pending.join('\n')}`;
      }
    }

    try {
      let text = '';
      let summary = '';
      let alterations: Alteration[] = [];
      let focusRequestId: string | null = null;
      let emptyRetry = false; // M310
      for (let pass = 1; pass <= 2; pass++) {
        // M297 (speed experiment 1): the tree the filer reads degrades under HARNESSMAP_FILER_TREE_CHARS (default: the map budget, 16k)
        const tree = renderScopedTree(map, readScope, { focusId: params.focusContainerId, ...(process.env.HARNESSMAP_FILER_TREE_CHARS ? { budgetChars: Number(process.env.HARNESSMAP_FILER_TREE_CHARS) } : {}) });
        // M203 (Jacob): the nodes this round is ABOUT, found by the shared word
        // matcher over titles and memory, named to the filer so a refinement
        // or a later ruling becomes update_node on the existing node (its
        // earlier state stays in the node's history) — not a twin node.
        const existing = matchNodes(this.store, params.projectId, `${params.userText}\n${truncate(params.assistantText, 3000)}`, { limit: 6 })
          .map((m) => map.nodes.find((n) => n.id === m.id)).filter((n): n is MapNode => !!n && readScope.has(n.id));
        const existingNote = existing.length
          ? `EXISTING NODES ON THIS ROUND'S SUBJECTS (word-matched; check before creating): ${existing.map((n) => `[${n.id}] ${n.title || n.content.slice(0, 60)}`).join(' · ')}\nIf the round refines, corrects or supersedes one of these, update_node THAT id (the node keeps its history); create a new node only for a subject none of them holds. When the round OVERTURNS part of a node's statement, REWRITE that part so the statement reads as the current rule — never leave the old clause standing beside the new one.${spansBranches(this.store, existing) ? `\nTHESE SIT IN DIFFERENT BRANCHES: when this round connects two of them (one rests on, answers, blocks or contradicts the other), emit create_link between them with the type that fits — the map holds no cross-links until you make them.` : ''}`
          : '';
        const parsed = await call({
          task: 'filer', system: SYSTEM + systemCard(this.store, params.projectId, 'the FILER'), maxTokens: 2048, schema: SCHEMA, timeoutMs: 60_000,
          audit: (k, d) => this.store.audit(k, d),
          user: [
              `CURRENT MAP (▶ = focus; ids in [brackets]):\n${tree}`,
              `FOCUS NODE ID: ${params.focusContainerId}`,
              `NEW ROUND:\nUSER: ${params.userText}\nAGENT: ${truncate(params.assistantText, 3000)}`,
              existingNote,
              integrationNote,
              pass === 2 && !emptyRetry ? 'You requested expansion; the branches are now readable (READ-ONLY). Translate this round fully — request_expansion is no longer available.' : '',
              emptyRetry ? 'YOUR FIRST ANSWER FILED NOTHING, yet the round is not pure mechanics: the user raised a subject and the agent answered at length. The NEW-TOPIC GUARANTEE applies — create the topic node (its facts, options or questions under it; top level if no lit branch fits) and answer again with the alterations. An empty list is right only for greetings, thanks and pure meta-talk.' : '',
              'Translate this round. Five final checks before answering: (0) NEW-TOPIC GUARANTEE: did the user bring up ANY topic this round that is absent from the map — however small or transient (a weather question, a quick lookup, a passing thought)? You MUST leave at least one node for it (in scope, or under "to sort"): often a question node with status answered, carrying the gist of the answer in its description. A topic switch that produces zero alterations is almost always wrong. Only pure mechanics produce nothing (greetings, thanks, questions about the assistant itself). (1) does any subtree you filed under now hold two or more unrelated topics, duplicates, or material that outgrew it? If yes, add a suggest_restructure. (2) Are you changing the status of any node the user did NOT touch this round? "Park/drop/done all of it" refers to the CURRENT thread only — decisions, constraints, and evidence settled earlier KEEP their statuses. If your alterations re-status more than ~3 nodes, you are almost certainly wrong — cut back to the ones actually discussed. (3) Does the "to sort" node hold anything whose home is NOW writable (fully readable, not (dim))? If yes, move_node it home and strip the provenance note from its content. (4) FOCUS REQUEST: did the user EXPLICITLY ask to concentrate the conversation on ONE thing ("let\'s focus on X", "just X for now", "back to X")? If yes, add top-level focus_request: {id: the node where X lives — an existing [id], or the id you used in a create_node this round}. This changes nothing by itself; the user confirms via a button. Most rounds have NO focus_request — passing mentions and new topics are NOT focus requests, only an explicit ask to concentrate. (5) PREFERENCES: if the USER\'S MAP PREFERENCES say where a kind of material goes or how it is named, that wins over every default placement rule above — re-check each create_node against them before answering.',
            ].filter(Boolean).join('\n\n') + statusConsult(this.store, params.projectId, params.focusContainerId, 'filing'),
        }) as RoundResult;
        text = JSON.stringify(parsed);
        summary = parsed.summary ?? '';
        alterations = normalizeIds(parsed.alterations ?? [], map);
        // M75: resolve focus_request against existing nodes, or pair a
        // this-round create by position (normalizeIds is 1:1 in order).
        focusRequestId = null;
        const frRaw = (parsed as any).focus_request?.id ? String((parsed as any).focus_request.id).replace(/[\[\]]/g, '') : null;
        if (frRaw) {
          const existing = map.nodes.find((n) => n.id === frRaw || n.id.startsWith(frRaw));
          if (existing) focusRequestId = existing.id;
          else {
            const idx = (parsed.alterations ?? []).findIndex((a: any) => a.op === 'create_node' && String(a.id).replace(/[\[\]]/g, '') === frRaw);
            if (idx >= 0) focusRequestId = (alterations[idx] as any)?.id ?? null;
          }
        }

        const expansion = pass === 1 ? alterations.find((a) => a.op === 'request_expansion') as any : null;
        // M310 (loop find, guard under M64 "a new topic always lands"): the filer's own summary says a subject was raised
        // ("asked to chat about Chongqing attractions") and the agent answered at length, yet it filed nothing — the over-skip
        // Jacob reported live. Ask once more, plainly (the M205 precedent for a too-short import summary); never a third time.
        if (pass === 1 && !expansion && alterations.length === 0 && params.userText.trim().length >= 6 && params.assistantText.trim().length >= 300 && !/\b(greet|pleasantr|mechanic|thank|acknowledg|small talk|no topic|nothing new|meta[- ]?(talk|question)|capabilit)/i.test(summary)) {
          emptyRetry = true; this.store.audit('filer_empty_retry', { summary: summary.slice(0, 80) }); continue;
        }
        if (!expansion) break;
        // Grow the READ scope only, one time, capped at 3 branches.
        const wanted = (expansion.ids ?? []).slice(0, 3);
        for (const raw of wanted) {
          const id = String(raw).replace(/[\[\]]/g, '');
          const full = map.nodes.find((n) => n.id === id || n.id.startsWith(id));
          if (full) { readScope.add(full.id); for (const d of descendantNodes(this.store, full.id)) readScope.add(d); }
        }
        console.log(`[translator] expansion-on-demand: re-running with ${wanted.length} branch(es) readable`);
      }
      alterations = alterations.filter((a) => a.op !== 'request_expansion');
      // Anti-park-all GUARD (the prompt rule keeps regressing — enforce it
      // mechanically): a single round flipping >6 nodes to the SAME status,
      // with no other edits to them, is a session-mood misfire. Keep the
      // first 6 (model output order ≈ the thread actually under discussion).
      {
        const statusOnly = alterations.filter((a: any) => a.op === 'update_node' && a.status && a.content === undefined && a.title === undefined && a.type === undefined);
        const byStatus = new Map<string, any[]>();
        for (const a of statusOnly) {
          const k = (a as any).status;
          if (!byStatus.has(k)) byStatus.set(k, []);
          byStatus.get(k)!.push(a);
        }
        for (const [status, list] of byStatus) {
          if (list.length > 6) {
            const drop = new Set(list.slice(6));
            alterations = alterations.filter((a) => !drop.has(a));
            this.store.audit('guard_mass_cap', { status, count: list.length });
          }
        }
      }
      // D2 (M47): prompts guide, GUARDS enforce. Any write outside the light
      // is intercepted here — creations redirect to "to sort" (+ provenance,
      // + an auto placement note), updates/moves to dim nodes are dropped.
      alterations = this.guardScope(alterations, writeScope, map, params);
      alterations = this.guardCorrectionTwin(alterations, map);
      const result: RoundResult = { summary, alterations };
      const roundId = this.store.recordRound(params.chatId, params.turnId, result, `${backendName()}:${modelFor('filer')}`);
      this.store.applyAlterations(params.projectId, result.alterations, { kind: 'round', roundId });
      return { roundId, result, focusRequestId, debug: { inputTree: renderScopedTree(map, readScope, { focusId: params.focusContainerId }), rawText: text } };
    } catch (err) {
      console.error('[translator] round failed (map will lag, chat unaffected):', err);
      return null;
    }
  }

  // The write-scope guard (M47 D2). Creations aimed at dim parents are
  // redirected under "to sort" with provenance + a placement note;
  // updates/moves touching dim nodes are dropped (logged). New nodes created
  // this round extend the scope as they appear.
  // M253 (finding 10 of Mark's Codex test): a correction that rewrote node X used to ALSO file a "decision" restating
  // the fact (the old rebuke rule). Prompts guide, guards enforce: a create_node typed decision/constraint in the same
  // round as an update_node that rewrote content, sharing two or more rare words with the rewritten statement, is dropped.
  private guardCorrectionTwin(alterations: any[], map: { nodes: MapNode[] }): any[] {
    return dropCorrectionTwins(alterations, map.nodes, (d) => this.store.audit('guard_correction_twin', d));
  }
  private guardScope(alterations: Alteration[], scope: Set<string>, map: MapView, params: { chatId: string; focusContainerId: string; userText?: string }): Alteration[] {
    const live = new Set(scope);
    const focusName = map.nodes.find((n) => n.id === params.focusContainerId)?.title
      ?? map.nodes.find((n) => n.id === params.focusContainerId)?.content ?? '?';
    let toSort = map.nodes.find((n) => n.parentId === null && n.status !== 'removed' && (n.content === 'to sort' || (n.title ?? '') === 'to sort'));
    let toSortId = toSort?.id;
    const out: Alteration[] = [];
    // M336 (perturbed translate-clone replay): the filer sometimes lists an update BEFORE the create of the same node; the update was
    // dropped as "unknown id". An update or move whose target is created later in this batch is deferred to the end, after the create.
    const createdInBatch = new Set<string>(alterations.filter((x: any) => x?.op === 'create_node' && x.id).map((x: any) => String(x.id)));
    const deferred: Alteration[] = [];
    const ensureToSort = () => {
      if (toSortId) { live.add(toSortId); return toSortId; }
      toSortId = randomUUID();
      out.push({ op: 'create_node', id: toSortId, parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any);
      live.add(toSortId);
      return toSortId;
    };
    for (const a of alterations) {
      const anyA: any = a;
      // M286 (loop find): STICKY STRUCTURE enforced — the filer may move only nodes born this round or children of "to sort";
      // moving an existing node (it moved the person's own project under a new topic) is the tidy agent's job, with approval.
      if (a.op === 'move_node' && anyA.id) {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        const bornThisRound = !cur;
        const parentNow = cur?.parentId ? map.nodes.find((n) => n.id === cur.parentId) : null;
        const inToSort = !!parentNow && parentNow.parentId === null && ((parentNow.title ?? '') === 'to sort' || parentNow.content.startsWith('to sort'));
        if (!bornThisRound && !inToSort) { this.store.audit('guard_move_existing', { id: String(anyA.id).slice(0, 8) }); continue; }
      }
      // M286 (loop find, the philosophy replay): an UPDATE that shrinks an enumerated statement to one item while changing
      // status is "choosing by erasing" — keep the statement, apply the status; the siblings' fate is a separate matter.
      if (a.op === 'update_node' && anyA.id && typeof anyA.content === 'string' && anyA.status) {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        const items = (t: string) => (t.match(/(?:^|\s)\(?\d+[).]\s/g) ?? []).length;
        if (cur && items(cur.content) >= 3 && items(anyA.content) < 2 && anyA.content.length < cur.content.length * 0.6) { delete anyA.content; this.store.audit('guard_list_shrink', { id: String(anyA.id).slice(0, 8) }); }
      }
      // M302 (loop find, bug under M64/M271): a narrated move ("User requested to resume discussing internet setup") is not a fact —
      // the transcript's job, and the focus already records it. Dropped mechanically; the prompt says the same.
      if (a.op === 'create_node' && typeof anyA.content === 'string' && /^(the )?(user|person|they) (asked|requested|wants?|wanted|would like|decided|needs?) (to (resume|return|switch|go back|come back|pick (it |this )?back|talk|discuss|set aside|move on|understand|know|learn)|(for )?(detailed |more )?(information|details|info) (about|on))/i.test(anyA.content.trim())) { this.store.audit('guard_narration', { content: anyA.content.slice(0, 80) }); continue; }
      // M305b (loop find, same rule): a narrating clause inside an otherwise fine statement ("Rocket design: user wants to talk about it; angle
      // not yet narrowed") is cut out, never the node — dropping it would be the over-skip Jacob reported (M302b).
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string') {
        const src = String(anyA.content).trim();
        let trimmed = src.replace(/\b(the )?(user|person) (asked|requested|wants?|wanted|would like|decided|needs?) (to (resume|return to|switch to|talk about|discuss|explore|open|dig into|understand|know|learn)|(for )?(detailed |more )?(information|details?|info) (about|on))[^.;—\n]*[.;,]?\s*/gi, '')
          .replace(/^(the )?(user|person) (asked|inquired)( in \p{L}+)? (about|for) /iu, '')
          .replace(/^(the )?(user|person) (is )?(selected|chose|picked|explor(ed|ing)|confirmed|noticed|flagged|clarified|restated|switched to) /i, '') // leading narration: keep what follows
          .replace(/(^|[.;?!]\s*)(The user|User|The person|The agent|Agent|The assistant|Assistant) (is |then |also )?(selected|chose|picked|explor(ed|ing)|confirmed|noticed|flagged|clarified|restated|switched to|offered|explained|suggested|proposed|answered|redirected|described|listed|recommended|provided|gave|acknowledged|noted|insists?|insisted|demands?|demanded|maintains?|maintained|argues?|argued|believes?|believed|thinks?|thought|feels?|felt|says?|said|states?|stated|claims?|claimed|reports?|reported|mentions?|mentioned|asserts?|asserted|contends?|contended|suspects?|suspected|wonders?|wondered):? (that )?/g, '$1') /* M331: the person's own claim stays as a claim ("User insists Claude made a decision" -> "Claude made a decision") */ // the narrating subject and verb go, the object stays (a fact inside "User confirmed the tiler for the 20th" is kept)
          .replace(/(^|[.;?!]\s*)(The user|User|The person) (asked|demanded|insisted|wanted to know|wants to know|asks):\s*/g, '$1') // M326: the colon form ("User asked: How did…") — the lead goes, the question stays
          .replace(/(^|[.;?!]\s*)(The user|User|The person|The agent|Agent|The assistant|Assistant) (greeted|said hello|thanked)[^.;\n]*[.;]?\s*/g, '$1').replace(/(^|[.;?!]\s*)(the )?(user|person) (asked|inquired)( in \p{L}+)? (about|for)[^.;\n]*[.;]?\s*/giu, '$1').replace(/,?\s*and (the )?(agent|assistant) (listed|explained|offered|described|suggested|answered|gave|recommended)[^.;\n]*/gi, '')
          .replace(/(^|[.;?!]\s*)(the )?(agent|assistant) (asked for clarification|redirected (the user|them) to)[^.;\n]*[.;]?\s*/gi, '$1')
          .replace(/([:;,—-])\s*[;,.]\s*/g, '$1 ').replace(/\s+([;,.])/g, '$1').replace(/^\s*[:;,—-]+\s*/, '').replace(/\s*[:;,—-]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
        trimmed = trimmed.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
        if (trimmed && /[.!?]$/.test(src) && !/[.!?]$/.test(trimmed)) trimmed += '.';
        if (trimmed && trimmed !== src && trimmed.length >= 12) { this.store.audit('guard_narration_trim', { from: anyA.content.slice(0, 80), to: trimmed.slice(0, 80) }); anyA.content = trimmed; }
      }
      // M315 (loop find, guard under "integrate, don't append; update-don't-duplicate" and M286 "choosing never erases"): the filer
      // replaced a chapter's founding statement ("Chapter 2: results") with the round's one fact ("Response rate came in at 62%"),
      // and the chapter was gone — the next "switch to chapter 2" had to make a new one. A rewrite that keeps NO content word of
      // the old statement is not a correction (corrections keep most words); it becomes a child of that node, the statement stays.
      if (a.op === 'update_node' && anyA.id && typeof anyA.content === 'string' && this.store.getSetting(`titleBy:${anyA.id}`) !== 'user') {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        const tok = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{3,}|[\u4e00-\u9fff]{2}/g) ?? []).filter((w) => !STOP.has(w)));
        if (cur && !cur.content.startsWith('to sort') && cur.parentId !== null) {
          const oldW = tok(cur.content), newW = tok(anyA.content);
          const shared = [...newW].filter((w) => oldW.has(w)).length;
          if (oldW.size >= 2 && newW.size >= 2 && shared === 0) { // "Chapter 2: results" has two content words
            const child: any = { op: 'create_node', id: randomUUID(), parentId: cur.id, content: anyA.content, status: anyA.status ?? 'live', author: anyA.author ?? 'agent', ...(anyA.type ? { type: anyA.type } : {}), ...(anyA.title ? { title: anyA.title } : {}) };
            this.store.audit('guard_rewrite_to_child', { id: String(anyA.id).slice(0, 8), from: cur.content.slice(0, 60), to: anyA.content.slice(0, 60) });
            out.push(child); continue;
          }
        }
      }
      // M306 (loop find, bug under M68 "titles are self-healing"): a correction that changed the statement left a title that now
      // contradicts it ("Trellis beans east fence" over "…along the west fence"). When the old title carries a content word the
      // new statement dropped, the agent title is cleared (the display falls back to the statement; the healer retitles if long).
      if (a.op === 'update_node' && anyA.id && typeof anyA.content === 'string' && anyA.title === undefined && this.store.getSetting(`titleBy:${anyA.id}`) !== 'user') {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        if (cur?.title && cur.content.trim() !== anyA.content.trim()) {
          const tok = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
          const oldC = tok(cur.content), newC = tok(anyA.content);
          const gone = [...tok(cur.title)].filter((w) => oldC.has(w) && !newC.has(w));
          if (gone.length) { anyA.title = ''; this.store.audit('guard_stale_title', { id: String(anyA.id).slice(0, 8), gone }); }
        }
      }
      // M311 (loop find, guard under M278/M77): a NEW node the filer parked in "to sort" without the provenance note and without
      // a dim branch it could belong to is a misfiled topic ("Chongqing attractions" went to to sort while the only dim branch was
      // the home network) — the top level is ordinary; it goes there.
      if (a.op === 'create_node' && toSortId && anyA.parentId === toSortId && typeof anyA.content === 'string' && !/\(arrived while/i.test(anyA.content) && !alterations.some((o: any) => o.op === 'suggest_relight' && o.nodeId === anyA.id && /\[[0-9a-f]{6,}\]/i.test(String(o.note ?? '')))) { // only a placement note that names a branch [id] holds it in to sort
        const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{4,}|[\u4e00-\u9fff]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
        const mine = words(anyA.content);
        const dimNodes = map.nodes.filter((n) => n.status !== 'removed' && !live.has(n.id) && n.parentId !== null && n.id !== toSortId);
        const kin = dimNodes.some((n) => { const w = words(`${n.title ?? ''} ${n.content}`); let hits = 0; for (const x of mine) if (w.has(x)) hits++; return hits >= 2; });
        if (!kin && mine.size >= 2) { anyA.parentId = null; this.store.audit('guard_tosort_promote', { id: String(anyA.id).slice(0, 8), content: anyA.content.slice(0, 60) }); }
      }
      // M285 (loop find): a title the person typed on the card is theirs — the filer's update may change the statement, never that title
      if (a.op === 'update_node' && anyA.title !== undefined && anyA.id && this.store.getSetting(`titleBy:${anyA.id}`) === 'user') { delete anyA.title; this.store.audit('guard_hand_title', { id: String(anyA.id).slice(0, 8) }); }
      // M330 (perturbed imnodes replay): the filer wrote the status into the statement — "RETRACTED — The original evidence…".
      // The status is a field; a leading label in the text is meta. The label goes; if the op carries no status, the label becomes it.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string') {
        const m = anyA.content.match(/^\s*\[?(retracted|superseded|rejected|corrected|withdrawn|decided|resolved|parked|dropped|obsolete|outdated)\]?\s*[—:\-–]\s+(?=\S)/i);
        if (m && anyA.content.length > m[0].length + 12) { const label = m[1].toLowerCase(); anyA.content = anyA.content.slice(m[0].length).replace(/^\p{Ll}/u, (ch: string) => ch.toUpperCase()); if (!anyA.status && ['retracted', 'superseded', 'rejected', 'withdrawn', 'decided', 'parked', 'dropped'].includes(label)) anyA.status = label; this.store.audit('guard_status_label', { id: String(anyA.id ?? '').slice(0, 8), label, status: anyA.status ?? '' }); }
      }
      if ((a.op === 'create_node' || a.op === 'update_node') && anyA.type && !CANON_TYPES.includes(anyA.type)) {
        this.store.audit('offlist_type', { type: anyA.type });
        anyA.type = 'claim'; // nearest-neutral; user retypes freely
      }
      if (a.op === 'create_node') {
        // M286 (loop find): a CREATE whose statement enumerates three or more items "(1) … (2) … (3)" or "1. … 2. … 3." is split
        // mechanically into a parent (the lead-in) and one option child per item — the shape the prompt asks for, enforced.
        {
          const c = String(anyA.content ?? '');
          const parts = c.split(/\s*(?:\(\d+\)|(?<=^|\s)\d+[).])\s+/).map((x) => x.trim()).filter(Boolean);
          // M324 (real picture-books replay): the filer sometimes creates the list AND one child per item in the same round;
          // splitting the parent then made a second set of bare fragments ("pre-reading,", "Act 1 (Max in costume),"). No split
          // when this round already creates children under that node.
          const kidsInRound = alterations.filter((o: any) => o !== a && o.op === 'create_node' && o.parentId === anyA.id).length;
          // M328 (real foreign-aid replay): an enumeration INSIDE a sentence — "(1) a policy issue in development economics, (2) an
          // impact on households, (3) newsworthy insights. Topics map as: …" — is not a list; splitting it made "policy issue in
          // development economics," and a last "item" carrying the rest of the paragraph. Items that end on a comma/semicolon, or a
          // last item followed by more than a sentence of prose, mean the enumeration is inline: no split, the statement stays whole.
          const items = parts.slice(1);
          const inline = items.length > 0 && (items.slice(0, -1).some((x) => /[,;]$/.test(x)) || /[,;]$/.test(items[items.length - 1]) || /[.!?]\s+\S[^]{120,}$/.test(items[items.length - 1]));
          if (parts.length >= 4 && items.every((x) => x.length >= 8) && kidsInRound === 0 && inline) this.store.audit('guard_list_split_skip', { id: String(anyA.id).slice(0, 8), why: 'inline enumeration' });
          if (parts.length >= 4 && items.every((x) => x.length >= 8) && kidsInRound === 0 && !inline) {
            const lead = parts[0].replace(/[:\s]+$/, '') || 'options';
            const parentId = anyA.id; const parentOk0 = anyA.parentId == null || live.has(anyA.parentId);
            const parentAlt = { ...anyA, content: lead, type: anyA.type === 'option' ? undefined : anyA.type, status: anyA.type === 'option' ? 'live' : anyA.status };
            if (parentOk0) { live.add(parentId); out.push(parentAlt); } else { const home = ensureToSort(); live.add(parentId); out.push({ ...parentAlt, parentId: home, content: `${lead} (arrived while focus was: ${focusName})` }); }
            for (const item of parts.slice(1)) out.push({ op: 'create_node', id: randomUUID(), parentId, content: item, type: 'option', status: 'live', author: anyA.author ?? 'agent' } as any);
            this.store.audit('guard_list_split', { id: String(parentId).slice(0, 8), items: parts.length - 1 });
            continue;
          }
        }
        // M278 (Jacob: "there should not be an ontological difference between top level node or lower level nodes"):
        // a top-level create is ordinary and always writable; only a create under a DIM parent is redirected to "to sort".
        const parentOk = anyA.parentId == null || live.has(anyA.parentId);
        if (parentOk) { live.add(anyA.id); out.push(a); continue; }
        // redirect into "to sort"
        const intended = map.nodes.find((n) => n.id === anyA.parentId);
        const home = ensureToSort();
        const redirected = { ...anyA, parentId: home, content: `${anyA.content} (arrived while focus was: ${focusName})` };
        live.add(anyA.id);
        out.push(redirected);
        if (intended) {
          out.push({ op: 'suggest_relight', nodeId: anyA.id, note: `belongs under "${intended.title || intended.content.slice(0, 50)}" [${intended.id.slice(0, 8)}]` } as any);
        }
        console.log('[translator] scope guard: redirected create into "to sort"');
        continue;
      }
      if ((a as any).op === 'suggest_relight' && !/\[[0-9a-f]{6,}\]/i.test(String(anyA.note ?? ''))) { this.store.audit('guard_relight_vague', { note: String(anyA.note ?? '').slice(0, 80) }); continue; } // M311b: a placement names its branch [id]; "consider whether it belongs elsewhere" is noise
      if ((a as any).op === 'suggest_relight') {
        // Safety net: the material must exist as a node. If the suggestion
        // points at anything that isn't a node created this round in scope
        // (model skipped creating, or pointed at the dim branch), synthesize
        // the to-sort node from the note and retarget.
        const target = anyA.nodeId;
        const createdThisRound = out.some((o: any) => o.op === 'create_node' && o.id === target);
        if (!createdThisRound) {
          const home = ensureToSort();
          const newId = randomUUID();
          out.push({ op: 'create_node', id: newId, parentId: home, content: `${anyA.note} (arrived while focus was: ${focusName})`, status: 'exploratory', author: 'agent' } as any);
          out.push({ ...anyA, nodeId: newId });
          this.store.audit('guard_relight_synth', {});
          continue;
        }
        out.push(a);
        continue;
      }
      // M333 (perturbed good-witch chain, round 12): the filer rewrote a parent with its child's statement — parent and child then
      // read the same. A twin is a ruled-against shape (no twins); an update whose statement copies its parent's, a child's or a
      // sibling's (first 60 characters, normalised) is dropped.
      if (a.op === 'update_node' && typeof anyA.content === 'string' && anyA.content.trim().length >= 40) {
        const normT = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        const me = map.nodes.find((n) => n.id === anyA.id);
        if (me) {
          const mine = normT(anyA.content);
          const kin = map.nodes.filter((n) => n.id !== me.id && n.status !== 'removed' && (n.id === me.parentId || n.parentId === me.id || (n.parentId === me.parentId && me.parentId)));
          const twin = kin.find((n) => normT(n.content) === mine);
          if (twin) { this.store.audit('guard_update_twin', { id: String(anyA.id).slice(0, 8), twin: twin.id.slice(0, 8), rel: twin.id === me.parentId ? 'parent' : twin.parentId === me.id ? 'child' : 'sibling' }); continue; }
        }
      }
      // M337 (perturbed pandas replay; hand-status-kept passes by prompt alone): a status the person set on the card survives the
      // filer's updates unless the person's words in this round carry a status (done, rejected, parked, decided, open…).
      if (a.op === 'update_node' && anyA.status && this.store.getSetting(`statusBy:${anyA.id}`) === 'user') {
        const said = /\b(done|finished|complete[ds]?|reject(ed|s)?|drop(ped|s)?|park(ed|s)?|decid(ed|es?)|accept(ed|s)?|resolv(ed|es?)|re-?open(ed|s)?|moot(ed)?|retract(ed|s)?|supersed(ed|es)|cancel(led|ed|s)?|abandon(ed|s)?|不做了|放弃|完成|决定|搁置|撤回)\b/i.test(String(params.userText ?? ''));
        if (!said) { this.store.audit('guard_hand_status', { id: String(anyA.id).slice(0, 8), kept: map.nodes.find((n) => n.id === anyA.id)?.status ?? '', dropped: anyA.status }); delete anyA.status; }
      }
      if (a.op === 'update_node' || a.op === 'move_node') {
        if (!live.has(anyA.id) && createdInBatch.has(String(anyA.id)) && !(a as any).__deferred) { (a as any).__deferred = true; deferred.push(a); this.store.audit('guard_update_deferred', { op: a.op, id: String(anyA.id).slice(0, 8) }); continue; }
        if (!live.has(anyA.id)) {
          // M305 (loop find, bug under M77/M55): an update aimed at a DIM node used to be dropped whole, and the material with it
          // (a hotel booking said while Travel was dim vanished). Out-of-light material lands in "to sort" with its provenance and
          // a one-click placement — so the new statement goes there, pointing at the dim home.
          const dimNode = a.op === 'update_node' ? map.nodes.find((n) => n.id === anyA.id) : undefined;
          const newContent = typeof anyA.content === 'string' ? anyA.content.trim() : '';
          if (dimNode && newContent && newContent !== dimNode.content.trim()) {
            const home = ensureToSort();
            const newId = randomUUID();
            out.push({ op: 'create_node', id: newId, parentId: home, content: `${newContent} (arrived while focus was: ${focusName})`, type: anyA.type ?? dimNode.type, status: 'exploratory', author: 'agent' } as any);
            out.push({ op: 'suggest_relight', nodeId: newId, note: `belongs under "${dimNode.title || dimNode.content.slice(0, 50)}" [${dimNode.id.slice(0, 8)}]` } as any);
            this.store.audit('guard_dim_redirect', { id: String(anyA.id).slice(0, 8) });
            continue;
          }
          this.store.audit('guard_dim_drop', { op: a.op, id: String(anyA.id ?? '').slice(0, 8), why: !dimNode && a.op === 'update_node' ? (map.nodes.some((n) => n.id === anyA.id) ? 'removed' : 'unknown id') : (dimNode && newContent === dimNode.content.trim() ? 'same statement' : 'dim') }); continue; // M332: the sweep needs to tell an invented id from a dim target
        }
        if (a.op === 'move_node' && anyA.parentId && !live.has(anyA.parentId)) { this.store.audit('guard_dim_drop', { op: 'move_node' }); continue; }
        out.push(a);
        continue;
      }
      out.push(a);
    }
    for (const d of deferred) { const anyD = d as any; if (live.has(anyD.id)) { delete anyD.__deferred; out.push(d); } else this.store.audit('guard_dim_drop', { op: d.op, id: String(anyD.id).slice(0, 8), why: 'created later but not live' }); }
    return out;
  }
}

// The model sees 8-char id prefixes; expand them back to full ids, and mint
// real UUIDs for newly created objects (mapping the model's ids to ours).
// Brackets stripped defensively — models sometimes echo "[abcd1234]".
// M232: the filer's link trigger — the round's matched nodes span two top-level branches.
export function spansBranches(store: Store, nodes: { id: string; parentId: string | null }[]): boolean {
  const tops = new Set<string>();
  for (const n of nodes) { let p: any = n; const seen = new Set<string>(); while (p && p.parentId && !seen.has(p.id)) { seen.add(p.id); const q: any = store.getNode(p.parentId); if (!q || !q.parentId) break; p = q; } tops.add(p?.id ?? n.id); }
  return tops.size >= 2;
}
export function normalizeIds(alterations: Alteration[], map: MapView): Alteration[] {
  const known = new Map<string, string>();
  for (const n of map.nodes) known.set(n.id.slice(0, 8), n.id);
  const minted = new Map<string, string>();

  const createdOnce = new Set<string>();
  const resolve = (raw: string | null | undefined, creating: boolean): string | null => {
    if (raw === null || raw === undefined) return null;
    const id = String(raw).replace(/[\[\]]/g, '');
    if (known.has(id)) return known.get(id)!;
    const full = [...known.values()].find((v) => v === id);
    if (full) return full;
    if (minted.has(id)) {
      const prior = minted.get(id)!;
      // M65 fix: models sometimes REUSE a short id for a second create —
      // minting the same uuid silently killed the second node (UNIQUE).
      // A repeated CREATE on an already-created id gets its own fresh uuid.
      if (creating && createdOnce.has(prior)) {
        const fresh = randomUUID();
        minted.set(id, fresh); // later refs point at the newest
        createdOnce.add(fresh);
        return fresh;
      }
      if (creating) createdOnce.add(prior);
      return prior;
    }
    if (creating) {
      const fresh = randomUUID();
      minted.set(id, fresh);
      createdOnce.add(fresh);
      return fresh;
    }
    return id; // unknown reference — keep as-is; apply is defensive
  };

  return alterations.map((a) => {
    const out: any = { ...a };
    if ('id' in out) out.id = resolve(out.id, out.op.startsWith('create_'));
    if (out.op === 'create_node' || out.op === 'create_container') out.parentId = resolve(out.parentId ?? null, false); // omitted = top level
    else if ('parentId' in out) out.parentId = resolve(out.parentId, false);
    if ('homeContainerId' in out && out.homeContainerId) out.homeContainerId = resolve(out.homeContainerId, false);
    if ('fromItemId' in out && out.fromItemId) out.fromItemId = resolve(out.fromItemId, false);
    if ('toId' in out && out.toId) out.toId = resolve(out.toId, false);
    if ('containerId' in out && out.containerId) out.containerId = resolve(out.containerId, false);
    if ('nodeId' in out && out.nodeId) out.nodeId = resolve(out.nodeId, false);
    return out as Alteration;
  });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n[...truncated]`;
}

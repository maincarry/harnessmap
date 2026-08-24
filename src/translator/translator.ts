import { randomUUID } from 'node:crypto';
import { systemCard } from './cast.js';
import { call, modelFor, backendName } from '../inference.js';
import type { Alteration, RoundResult } from '../types.js';
import { Store } from '../store/db.js';
import { loadMap, renderTree, renderScopedTree, descendantNodes, type MapView } from '../map/render.js';

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
- MERGE, don't duplicate: if the round refines something already on the map, update_node that id (content and/or status). Same thing in new words = the same node.
- STICKY STRUCTURE: existing nodes keep their identity, content, and position. You may ADD nodes anywhere in scope, but you NEVER restructure what exists: do not move existing nodes (move_node is only for nodes created earlier THIS round, or for "to sort" children finding their home), do not split or merge existing nodes.
- SUGGEST, DON'T RESTRUCTURE. This is a duty, not an option: every round, look at the node(s) you just filed under and ask "does this subtree hold two or more unrelated topics, duplicates, or material that outgrew it?" If yes, you MUST also emit suggest_restructure {nodeId, note} — note is one sentence saying what you'd change and why (e.g. "This mixes the apartment hunt with the birthday dinner — split into two topics."). The user sees it as a dot on that node and decides; nothing happens without them. One suggestion per node per round; re-suggesting replaces your earlier note.
- UPWARD PROPAGATION: after integrating, if a heading node's content (including the root topic) no longer reflects what its children now are, update_node its content — conservatively, keeping recognizable vocabulary.
- AUTO-NAME UNTITLED: a node whose content is "untitled" is one the user created without naming (deliberately — the system names it for them). As soon as this round tells you what it is about, update_node it with BOTH: content = an informative statement of what it is, AND title = a minimal 2-4 word label. Check the WHOLE map every round: if ANY node still says "untitled" and the conversation gives any clue what it's for, name it now. Never leave an untitled node unnamed once material has landed under it.
- MANDATORY when the FOCUS node itself is "untitled": the user just created it and aimed the conversation at it, so THIS round is definitionally about it. You MUST update_node it this round with real content and a title drawn from what the round discussed — no exceptions, even if the round felt tangential (name it from the best available signal). This rule is ONLY about naming that untitled node — it never licenses filing off-topic material under the focus or stretching a NAMED focus node's content to cover a stray round; strays go to "to sort" as always.

PLACEMENT SCOPE — read everywhere, WRITE only in the light:
- You READ the whole map, including lines marked (dim) — use that full knowledge for judgment. But (dim) lines are NOT WRITABLE: the user has those branches dimmed, so you may not create nodes under them, update them, or move things into them. Writable: the focus subtree, lit branches, and the "to sort" node.
- Material you cannot place within the WRITABLE scope — whatever the reason — goes under the special top-level "to sort" node instead (create it with content "to sort" if it doesn't exist). Never create other nodes at the top level.
- ONE TOPIC = ONE SUBTREE in "to sort": create a single topic node for it, and nest its question/options/constraints/evidence UNDER that node — NEVER as sibling children of "to sort". The user moves things out of "to sort" whole; scattered siblings tear apart. Record provenance once, in the topic node's content: append " (arrived while focus was: <current focus name>)".
- When you can tell where the material belongs, ALSO emit suggest_relight {nodeId: <the new to-sort node's id>, note: 'belongs under "<branch name>" [<branch id>]'} — a PLACEMENT suggestion the user can approve as a one-click move. nodeId MUST be the id of the to-sort node you just created — NEVER skip creating the node (a note alone loses the material if dismissed), and never point the suggestion at the destination branch itself.
- TO-SORT INTEGRATION: each round, look at the "to sort" children. If one's home is now WRITABLE, move_node it there and strip the provenance note from its content. This is the one case where moving an existing node is your job.
- EXPANSION ON DEMAND: if you cannot do this round's job properly without READING a (dim) branch — e.g. to check whether the material already exists there (never duplicate dim content into "to sort"), or to write a precise placement note — output ONE alteration only: request_expansion {ids: [up to 3 dim ids]}. You will be re-run immediately with those branches readable. Expanded branches are READ-ONLY: even after expansion, writes outside the light still go to "to sort". Request expansion only when the names alone genuinely aren't enough — most rounds need none.

Other rules:
- REBUKES AND CORRECTIONS PRODUCE TWO THINGS: (1) the artifact fix (remove/downgrade the rejected thing) AND (2) a standing decision/constraint node capturing the rule. "why is copyright in there — I said authorship" → downgrade the copyright node AND create decision "angle = authorship, not copyright" [decided]. Never do only the fix.
- ONE COMMITMENT = ONE NODE. Atomic nodes are what the user can later point at. Never blob separate commitments together.
- TITLE + CONTENT ARE SEPARATE (the map displays titles; content is the record). content = a SELF-CONTAINED, INFORMATIVE statement — a reader who never saw the conversation must understand it. Carry the specifics: numbers, names, reasons, qualifiers, the WHY behind a decision ("cook myself — cheaper than catering and 2 guests are gluten-free" beats "cook myself"). Informative first, compact second: 1-3 sentences, no filler. title = a MINIMAL label: 2-4 plain everyday words, NEVER more than 6 — how the user would casually refer to it out loud ("rail pass", "guest list", "weather and mood"). DROP nuance rather than cram it in: a title names the thing, it does not summarize the statement (bad: "weather excuse versus genuine"; good: "weather as excuse"). EVERY node you create gets a title when its content runs past a few words. When you update a node whose meaning shifted, refresh its title too. When the map you receive shows a node with a long line and no sign of a short label, give it one via update_node {title}.
- STATUSES ARE PER-NODE EARNED STATES, NOT SESSION MOODS. A single utterance normally changes the status of 1–3 nodes, never the whole map. "Ok, park all of it" said while discussing one thread parks THAT THREAD'S nodes only — every decision, constraint, and piece of evidence settled earlier on the map KEEPS its solid status (decided stays decided, active stays active). Ending a session parks nothing by itself.
- META-INSTRUCTIONS BECOME TASKS: "remind me", "don't let me forget" → task (todo).
- Eager headings: newly introduced topics become heading nodes at introduction (status 'provisional', author marked) so later rounds have an addressable target — under an in-scope parent when one fits, otherwise under "to sort". User-declared deliverables are born 'live'.
- CHOOSING RETIRES RIVALS: when the user picks one option, mark it chosen AND mark the competing options of that same choice dropped — a decided question leaves no live alternatives behind.
- Flip-flops apply in utterance order ("scratch it — wait no, keep as maybe" ends parked).
- Generate ids as short random strings for new nodes; reference existing map ids exactly as given in [brackets].
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
          variant('create_node', { id: str, content: str, status: str, author }, ['id', 'content', 'status', 'author'], { parentId: str, type: str, title: str }),
          variant('update_node', { id: str }, ['id'], { content: str, status: str, type: str, title: str }),
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
      for (let pass = 1; pass <= 2; pass++) {
        const tree = renderScopedTree(map, readScope, { focusId: params.focusContainerId });
        const parsed = await call({
          task: 'filer', system: SYSTEM + systemCard(this.store, params.projectId, 'the FILER'), maxTokens: 2048, schema: SCHEMA, timeoutMs: 60_000,
          audit: (k, d) => this.store.audit(k, d),
          user: [
              `CURRENT MAP (▶ = focus; ids in [brackets]):\n${tree}`,
              `FOCUS NODE ID: ${params.focusContainerId}`,
              `NEW ROUND:\nUSER: ${params.userText}\nAGENT: ${truncate(params.assistantText, 3000)}`,
              integrationNote,
              pass === 2 ? 'You requested expansion; the branches are now readable (READ-ONLY). Translate this round fully — request_expansion is no longer available.' : '',
              'Translate this round. Five final checks before answering: (0) NEW-TOPIC GUARANTEE: did the user bring up ANY topic this round that is absent from the map — however small or transient (a weather question, a quick lookup, a passing thought)? You MUST leave at least one node for it (in scope, or under "to sort"): often a question node with status answered, carrying the gist of the answer in its description. A topic switch that produces zero alterations is almost always wrong. Only pure mechanics produce nothing (greetings, thanks, questions about the assistant itself). (1) does any subtree you filed under now hold two or more unrelated topics, duplicates, or material that outgrew it? If yes, add a suggest_restructure. (2) Are you changing the status of any node the user did NOT touch this round? "Park/drop/done all of it" refers to the CURRENT thread only — decisions, constraints, and evidence settled earlier KEEP their statuses. If your alterations re-status more than ~3 nodes, you are almost certainly wrong — cut back to the ones actually discussed. (3) Does the "to sort" node hold anything whose home is NOW writable (fully readable, not (dim))? If yes, move_node it home and strip the provenance note from its content. (4) FOCUS REQUEST: did the user EXPLICITLY ask to concentrate the conversation on ONE thing ("let\'s focus on X", "just X for now", "back to X")? If yes, add top-level focus_request: {id: the node where X lives — an existing [id], or the id you used in a create_node this round}. This changes nothing by itself; the user confirms via a button. Most rounds have NO focus_request — passing mentions and new topics are NOT focus requests, only an explicit ask to concentrate.',
            ].filter(Boolean).join('\n\n'),
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
  private guardScope(alterations: Alteration[], scope: Set<string>, map: MapView, params: { chatId: string; focusContainerId: string }): Alteration[] {
    const live = new Set(scope);
    const focusName = map.nodes.find((n) => n.id === params.focusContainerId)?.title
      ?? map.nodes.find((n) => n.id === params.focusContainerId)?.content ?? '?';
    let toSort = map.nodes.find((n) => n.parentId === null && n.status !== 'removed' && (n.content === 'to sort' || (n.title ?? '') === 'to sort'));
    let toSortId = toSort?.id;
    const out: Alteration[] = [];
    const ensureToSort = () => {
      if (toSortId) { live.add(toSortId); return toSortId; }
      toSortId = randomUUID();
      out.push({ op: 'create_node', id: toSortId, parentId: null, content: 'to sort', title: 'to sort', status: 'live', author: 'agent' } as any);
      live.add(toSortId);
      return toSortId;
    };
    for (const a of alterations) {
      const anyA: any = a;
      if ((a.op === 'create_node' || a.op === 'update_node') && anyA.type && !CANON_TYPES.includes(anyA.type)) {
        this.store.audit('offlist_type', { type: anyA.type });
        anyA.type = 'claim'; // nearest-neutral; user retypes freely
      }
      if (a.op === 'create_node') {
        const isToSortItself = anyA.parentId == null && (anyA.content === 'to sort' || anyA.title === 'to sort');
        // Root-level creation is ALSO outside the light (Jacob: unrelated new
        // topics go to the folder) — only "to sort" itself may be born at root.
        const parentOk = isToSortItself || (anyA.parentId != null && live.has(anyA.parentId));
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
      if (a.op === 'update_node' || a.op === 'move_node') {
        if (!live.has(anyA.id)) { this.store.audit('guard_dim_drop', { op: a.op }); continue; }
        if (a.op === 'move_node' && anyA.parentId && !live.has(anyA.parentId)) { this.store.audit('guard_dim_drop', { op: 'move_node' }); continue; }
        out.push(a);
        continue;
      }
      out.push(a);
    }
    return out;
  }
}

// The model sees 8-char id prefixes; expand them back to full ids, and mint
// real UUIDs for newly created objects (mapping the model's ids to ours).
// Brackets stripped defensively — models sometimes echo "[abcd1234]".
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

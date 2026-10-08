import { randomUUID } from 'node:crypto';
import { finishNarrationTrim } from './narration-trim';
import { systemCard } from './cast.js';
import { statusConsult } from './mapstatus.js';
import { call, modelFor, backendName } from '../inference.js';
import type { Alteration, RoundResult } from '../types.js';
import { Store } from '../store/db.js';
import { loadMap, renderTree, renderScopedTree, descendantNodes, type MapView } from '../map/render.js';
import { matchNodes } from '../map/match.js';
import type { MapNode } from '../types.js';

// M342 (Mark, Windows/Codex): the filer's 60 s was sized for the Claude backend; on the codex backend one call is a fresh
// `codex exec` process (CLI start-up, sandbox, then a reasoning model writing a 2k-token JSON) and a successful filing
// took 45 s on Mark's machine, so 60 s left no headroom and the round was lost. The limit follows the backend;
// HARNESSMAP_FILER_TIMEOUT_MS overrides it. The ledger and retries (server) are what make a timeout survivable.
export function filerTimeoutMs(): number {
  const env = Number(process.env.HARNESSMAP_FILER_TIMEOUT_MS);
  if (Number.isFinite(env) && env > 0) return env;
  return backendName() === 'codex' ? 150_000 : 60_000;
}


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
- UPWARD PROPAGATION: after integrating, if a heading node's content (including the root topic) no longer reflects what its children now are, update_node its content — conservatively, keeping recognizable vocabulary. Narrower is fine, WIDER IS NOT (M441): never stretch a heading's statement to also cover a subject that arrived later ("Python scripts and random-number tasks" because a panorama script was filed under the random-numbers thread). If new material only fits by widening the heading, it was mis-filed — it belongs at the top level (M278).
- AUTO-NAME UNTITLED: a node whose content is "untitled" is one the user created without naming (deliberately — the system names it for them). As soon as this round tells you what it is about, update_node it with BOTH: content = an informative statement of what it is, AND title = a minimal 2-4 word label. Check the WHOLE map every round: if ANY node still says "untitled" and the conversation gives any clue what it's for, name it now. Never leave an untitled node unnamed once material has landed under it.
- NAME BY SUBJECT, NEVER BY CATEGORY (M441): the name you give an untitled node — above all the first one, which becomes the thread's name — says the PIECE OF WORK it is about — the contract, the script, the game, the ticket, the document ("Northwind contract terms", "Random-integers script", "Tic-tac-toe game") — not the class of work ("Python scripts", "Games and interaction") and not its first detail ("Northwind liability cap" when the work is the whole Northwind contract). A category name invites every later thing of that kind to be filed under it, and the thread swallows the next subject; a first-detail name pushes the next clause of the same contract out to a new thread.
- MANDATORY when the FOCUS node itself is "untitled": the user just created it and aimed the conversation at it, so THIS round is definitionally about it. You MUST update_node it this round with real content and a title drawn from what the round discussed — no exceptions, even if the round felt tangential (name it from the best available signal). This rule is ONLY about naming that untitled node — it never licenses filing off-topic material under the focus or stretching a NAMED focus node's content to cover a stray round; strays go to "to sort" as always.

PLACEMENT SCOPE — read everywhere, WRITE only in the light:
- You READ the whole map, including lines marked (dim) — use that full knowledge for judgment. But (dim) lines are NOT WRITABLE: the user has those branches dimmed, so you may not create nodes under them, update them, or move things into them. Writable: the focus subtree, lit branches, and the "to sort" node.
- ONE NODE = ONE THING (M286): when the round enumerates alternatives — plans, options, candidates, steps to choose from — make a PARENT node for the question or topic and ONE CHILD per item (type option, status live), never a single node whose statement lists them "(1) … (2) … (3)". A list crammed into one statement cannot be chosen from, dimmed, or corrected item by item. The same for several distinct decisions or facts in one breath: one node each.
- TWO THINGS IN ONE BREATH ARE TWO NODES (M286): when a message corrects one node AND states a separate new rule, fact or task ("and separately…", "also…", "one more thing…"), the correction updates the existing node and the new thing is created as its own node — never folded into the corrected node's statement.
- CHOOSING NEVER ERASES (M286): when the user picks one alternative, mark it chosen and the others dropped — do not rewrite the parent's statement to the winner, do not remove the losers; the record of what was on the table stays on the map.
- THE TOP LEVEL IS ORDINARY (M278): a new topic that belongs under no lit branch becomes a new TOP-LEVEL node — create_node with parentId null, named as a topic, its question/options/evidence nested under it. There is no difference between a top-level node and any other; do not hunt for a parent that merely "sort of" fits, and never wedge an unrelated topic under the focus. FITS means part of the SAME PIECE OF WORK, not the same KIND of work (M441): a new script, a new function, a new question in another area is a new top-level node even when the current thread's name could cover it — "please improve this function" while the thread is a game is a new thread, not a child of the game. The other way round too: a new clause of the same contract, a new section of the same document, a new fix to the same script is the SAME piece of work — it goes under that thread, never a new root. A shared WORD is not the same work: "export customers.json to CSV" is not the large-project export bug, a second customer's refund is not the first customer's thread — a different artefact, file, customer or document is a different piece of work.
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
- Eager headings: newly introduced topics become heading nodes at introduction (status 'provisional', author marked) so later rounds have an addressable target — under an in-scope parent when the topic is part of that parent's own work, otherwise as a new TOP-LEVEL node (M278; "to sort" only when its home is dim or it cannot be named). User-declared deliverables are born 'live'.
- CHOOSING RETIRES RIVALS: when the user picks one option, mark it chosen AND mark the competing options of that same choice dropped — a decided question leaves no live alternatives behind.
- Flip-flops apply in utterance order ("scratch it — wait no, keep as maybe" ends parked).
- Generate ids as short random strings for new nodes; reference existing map ids exactly as given in [brackets].
- DATE: when the round states WHEN a ruling or fact happened ("yesterday", "on Aug 23", a dated entry), put it on the alteration as date "YYYY-MM-DD"; leave it out when the round does not say — never invent one. The node's timeline shows that date; without it, the day the map changed.
- For create_node at the top level, OMIT parentId entirely; otherwise set parentId to the node this is about (any node works as a parent).`;

// M365 grounding rule (Jacob ruled a bug) — appended to the filer system prompt unless HARNESSMAP_FILER_GROUNDING=0
// (the OFF setting is the benchmark's un-corrected baseline: it lets the filer invent unstated conclusions again).
const M365_GROUNDING = `- GROUNDED, NEVER INVENTED (M365, Jacob ruled a bug): capture what was SAID; never supply what was not. Every node you create states a fact, commitment, question, or option the user or the agent actually put forward this round (or clearly implied) — you do NOT add your own answer, computation, diagnosis, or conclusion that neither party reached. If the agent gave a wrong or vague answer, contradicted itself, or failed to solve the problem, the map reflects THAT: the question stays open/unanswered, the problem stays open — you never quietly create a node holding the correct answer, the working combination, the real root cause, or any fact the exchange did not contain. Rephrasing and clarifying what was said is your job (a node may state a point more precisely than the transcript did); introducing new substance is not. When in doubt about whether a fact was in the round, leave it out.`;
function filerSystem(): string { return process.env.HARNESSMAP_FILER_GROUNDING === '0' ? SYSTEM : SYSTEM + '\n' + M365_GROUNDING; }

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
  // 2026-10-05 (loop find, scene-detect-zh / industry40 sweep: 5 drops in 105 kept maps, the Chinese one a plain miss): the old
  // tokenizer kept only [a-z0-9] runs, so on a Chinese statement it saw nothing but the Latin identifiers — "使用 ffmpeg-scene-change-
  // detector 需要基本的编程、命令行和 FFmpeg 知识" reduced to {ffmpeg, scene, change, detector}, all in the rewritten node, and a distinct
  // prerequisite was dropped as a "restatement". Words are now any letter/digit run; a Han run (no spaces) contributes its character
  // bigrams so Chinese prose counts like English prose does. Latin/other words still need 4+ letters.
  const toks = (t: string) => { const s = new Set<string>(); for (const m of (t ?? '').toLowerCase().match(/\p{Script=Han}+|[\p{L}\p{N}]+/gu) ?? []) { if (/\p{Script=Han}/u.test(m)) { if (m.length === 1) s.add(m); for (let i = 0; i + 1 < m.length; i++) s.add(m.slice(i, i + 2)); } else if (m.length > 3) s.add(m); } return s; };
  for (const n of nodes) for (const w of toks(`${n.title ?? ''} ${n.content}`)) df.set(w, (df.get(w) ?? 0) + 1);
  const rare = (w: string) => (df.get(w) ?? 0) <= Math.max(2, Math.ceil(nodes.length * 0.05));
  const out: any[] = [];
  const remap = new Map<string, string>(); // dropped created id → the existing node it was folded into
  for (const a of alterations) {
    if (a.op === 'create_node' && (a.type === 'decision' || a.type === 'constraint')) {
      const cw = [...toks(`${a.title ?? ''} ${a.content ?? ''}`)].filter(rare);
      // M404 (fft-impedance-zh #363): "EIS信号叠加了1 Hz方波电流激励，激励幅值为500 mA" was dropped as a twin of a rewrite that carried the
      // square wave but NOT the 500 mA — the tokenizer ignores runs under 4 characters, so the number never counted, and the user's
      // amplitude vanished from the map (no node, no detail). A statement whose NUMBERS are not all in the rewrite is not a restatement.
      const nums = (t: string) => (t ?? '').match(/\d+(?:[.,]\d+)?/g) ?? [];
      const dup = rewritten.find((r) => { const rw = toks(r.content); const shared = cw.filter((w) => rw.has(w)).length; const rtext = `${r.title ?? ''} ${r.content}`; return cw.length > 0 && shared >= 2 && shared / cw.length >= 0.6 && nums(`${a.title ?? ''} ${a.content ?? ''}`).every((n) => rtext.includes(n)); });
      if (dup) { audit({ dropped: String(a.content ?? '').slice(0, 80), rewrote: dup.id }); if (a.id) remap.set(String(a.id), String(dup.id)); continue; }
    }
    out.push(a);
  }
  // M-loop 2026-10-04 (spice-rc-filter-en replay, luna): a dropped twin can be the PARENT of other alterations in the same batch —
  // "Proposed RC values" was created under the dropped node and a link pointed at it, so the child dangled under an id that
  // never existed (invariants: parent_missing / event_create_under_unknown). Every reference to a dropped id now follows the
  // twin to the node it was folded into, and the remap is audited.
  if (remap.size) {
    const follow = (v: unknown) => (typeof v === 'string' && remap.has(v)) ? remap.get(v)! : v;
    for (const a of out) {
      if (!a || typeof a !== 'object') continue;
      for (const k of ['parentId', 'fromItemId', 'toId', 'nodeId'] as const) {
        if (typeof a[k] === 'string' && remap.has(a[k])) { audit({ reparent: k, op: a.op, id: String(a.id ?? a.nodeId ?? '').slice(0, 8), from: String(a[k]).slice(0, 8), to: String(remap.get(a[k])).slice(0, 8) }); a[k] = follow(a[k]); }
      }
      if ((a.op === 'update_node' || a.op === 'move_node') && typeof a.id === 'string' && remap.has(a.id)) { audit({ reparent: 'id', op: a.op, from: String(a.id).slice(0, 8), to: String(remap.get(a.id)).slice(0, 8) }); a.id = follow(a.id); }
      if (Array.isArray(a.ids)) a.ids = a.ids.map(follow);
    }
    // a remap can turn a move/link into a self-reference (move X under E where X became E) — those carry no information, drop them
    return out.filter((a) => !(a && ((a.op === 'move_node' && a.id === a.parentId) || (a.op === 'create_link' && a.fromItemId === a.toId))));
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

// M343: letter scripts a filer title may carry only when the statement or the person's words carry them too (Latin excluded).
const SCRIPTS: Array<[string, RegExp]> = [
  ['thai', /\p{Script=Thai}/u], ['cyrillic', /\p{Script=Cyrillic}/u], ['greek', /\p{Script=Greek}/u], ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u], ['hangul', /\p{Script=Hangul}/u], ['hiragana', /\p{Script=Hiragana}/u], ['katakana', /\p{Script=Katakana}/u],
  ['han', /\p{Script=Han}/u], ['devanagari', /\p{Script=Devanagari}/u], ['bengali', /\p{Script=Bengali}/u], ['tamil', /\p{Script=Tamil}/u],
  ['georgian', /\p{Script=Georgian}/u], ['armenian', /\p{Script=Armenian}/u], ['ethiopic', /\p{Script=Ethiopic}/u], ['khmer', /\p{Script=Khmer}/u],
  // 2026-10-05 (loop find, leftjoin-zh #184): "示例表数据ੋം" — a Gurmukhi vowel sign and a Malayalam anusvara (combining MARKS of scripts
  // missing from this table) survived in a live title. The Script property covers marks, so listing the scripts is the whole fix.
  ['gurmukhi', /\p{Script=Gurmukhi}/u], ['gujarati', /\p{Script=Gujarati}/u], ['oriya', /\p{Script=Oriya}/u], ['telugu', /\p{Script=Telugu}/u],
  ['kannada', /\p{Script=Kannada}/u], ['malayalam', /\p{Script=Malayalam}/u], ['sinhala', /\p{Script=Sinhala}/u], ['lao', /\p{Script=Lao}/u],
  ['tibetan', /\p{Script=Tibetan}/u], ['myanmar', /\p{Script=Myanmar}/u], ['mongolian', /\p{Script=Mongolian}/u],
];
const STOP = new Set(['this','that','with','from','into','have','been','were','they','them','their','than','then','will','would','should','could','about','after','before','along','also','only','some','such','very','more','most','goes','need','needs','still','over','under','when','where','which','while','what','your','there','these','those','does','done','just','like','make','made','much','many','each','both','same','other','every','next','last','first'])
const CJK_FUNC_BIGRAM = /[的了是在和或与并将把被对从到为有能可也都就还很会要不没这那些个中上下时前后已仍待问题当其该此并及其如何]/u; // M410: a 2-char CJK token containing one of these is a function/filer-vocabulary bigram, not a content word, for the rewrite_to_child overlap test

// M438: the party a turn is ABOUT, read from its first words — "Marchetti's …", "Switching to Huang & Partners.", "For Orbit Labs, …".
// A leading imperative verb is not a name ("Revise Northwind's clause" → Northwind); a mid-turn mention is not a subject.
const CLIENT_STOP = new Set('Python Postgres Node React Shopify WooCommerce Redis Docker Git GitHub Linux Windows Mac The This That Here There What When Where Why How Can Could Should Would Let Make Add Fix Check Show Give Write Create Update Remove Use Try Help Switch Back Okay Yes PATCH GET POST API CSV PDF SQL JSON HTML CSS VAT EC2 AWS Codex Claude Today Tomorrow Monday Tuesday Wednesday Thursday Friday'.split(' '));
const CLIENT_VERBS = new Set('Revise Start Run Save Draft Fix Update Check Rewrite Summarize Reproduce Show Give Make Add Remove Switch Back Compare Review Prepare Build Write Create Find List Explain Tell Help Confirm Keep Send Reply Debug Inspect Test Deploy Open Close Finish Continue Resume Move Rename Delete Generate Convert Export Import Set Get Put Read Look Take Try Use Ask Answer Note Log Mark Plan Design Implement Refactor Clean Merge Cut Drop Fetch Pull Push Commit'.split(' '));
// M439: an assistant reply that DELIVERS the asked-for work — a fenced code block, or an explicit delivery phrase.
// M442 (TWIN LONG #426, Noor): "Let's make a one-time exception as an account credit" was filed on the agent-authored question node
// as a [decided] decision — the author stayed "agent", and the end-of-day answer said "the one-time credit is recorded as an agent-made
// decision, not a commitment you personally made" (she stopped the day). A decision the person states in their own words is theirs:
// when the user's turn carries a first-person commitment and the node's statement shares the turn's words, the author is "user".
export const FIRST_PERSON = /\b(?:let'?s|I'?ll|I will|we'?ll|we will|I'?m (?:willing|going|happy) to|I want|I(?:'ve| have)? decided|we(?:'ve| have)? decided|go with|settle (?:at|on|for)|I'?d (?:rather|prefer)|say (?:we|I|that we)|tell (?:them|him|her|the customer)|make (?:it|that|a) )/i;
// M443 (TWIN LONG #426, Noor, step 29 "List every commitment I made today, grouped by who it is for"): the recap turn filed two new
// containers ("Harbor commitments", "Team pricing commitments") with six mirrored task rows restating rows the map already held — and
// the next answer listed "mirrored commitment rows" as still open. A recap turn restates; it creates nothing the map already has.
export const RECAP = /\b(?:list|summari[sz]e|recap|go over|run through|what (?:did|have) (?:I|we)|what'?s (?:still )?open|everything (?:I|we))\b[\s\S]{0,100}\b(?:commitments?|promises?|promised|decisions?|decided|deadlines?|open|today|so far|this session|agreed|owe)\b/i;
const STOP_TOKENS = new Set('that this with from into then than have will would could should their there these those about which when what where while after before because being been were they them your also just only over under more most some such very into onto each other another every'.split(' '));
export const distinctiveTokens = (t: string): Set<string> => new Set((String(t ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP_TOKENS.has(w)));
// M448 (PANEL #429, 10 of 13: "Learn and retain the consistent-return documentation" listed as OPEN NOW after the agent had read and
// summarised it and the person closed the day): "learn / read this documentation" is an instruction to the AGENT; the agent's substantive
// reply is the delivery. Such a task is done at filing (like M439's code deliveries).
export const LEARN_REQUEST = /\b(?:learn|read|study|go through|look at|review|digest|memori[sz]e)\b[^.?!\n]{0,40}\b(?:documentation|docs?|doc page|page|link|article|guide|readme|spec|url)\b|\bhttps?:\/\/\S+/i;
// M449 (PANEL #429, 4 of 13: "You're most recently working on consistent-return guidance…" after "thanks, that is all for today"): a turn
// that closes the session is the current state — nothing is active; the LATEST work is what was last done.
export const SESSION_CLOSING = /\b(?:that(?:'s| is) (?:all|it) for (?:today|now|tonight|the day)|(?:I'?m )?done for (?:today|the day|tonight)|calling it a (?:day|night)|signing off|see you (?:tomorrow|monday|next week)|(?:good ?night|bye|goodbye) ?[.!]?$|wrapping up for (?:today|the day)|that(?:'s| is) (?:enough|all) for (?:today|now))\b/i;
// M451 (TWIN LONG #430, Noor, the severe stop at step 33: "The large-project export fix will ship this week … and the customer will be
// notified when it is live" filed as a DECISION [decided] — so the open-work list dropped the one promise she most needed to see; "It knows
// I promised … and knows neither happened, but still leaves it off"): a statement in the person's own words that commits to a FUTURE ACTION
// is open work — a task, todo — until it is done. A decision records a choice; a promise records a debt.
export const FUTURE_COMMITMENT = /\b(?:will|'ll|’ll|going to|am going to|promise[sd]? to|committed to|commit to)\s+(?:be\s+)?(?:ship\w*|deploy\w*|sen[dt]|notif\w+|confirm\w*|publish\w*|releas\w+|deliver\w*|follow(?:ing)?[ -]up|let\s+(?:them|him|her|you|the\s+\w+)\s+know|email\w*|call\w*|invoice\w*|refund\w*|appl(?:y|ied)|reduce\w*|downgrade\w*|cancel\w*|migrat\w+|roll\w* out|get back to)\b/i;
export const DELIVERS = /```|\bhere(?:'s| is) (?:the |an? |your )?(?:updated |revised |rewritten |fixed |complete |full |new )?(?:code|function|version|implementation|script|component|test|tests|rewrite|fix|file)\b|\bI(?:'ve| have)? (?:updated|added|implemented|fixed|created|rewritten|refactored|changed|written)\b|\b(?:updated|rewritten|refactored|revised) (?:version|function|code|script)\b/i;

export function clientNameOfTurn(text: string): string | null {
  const s = String(text ?? '').trim();
  const pats = [
    /^(?:Switching to|Switch to|Back to|Now|Next[,:]?|Then|For|Client|Customer)\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+(?:&|and)\s+[A-Z][\w'’-]*|\s+[A-Z][\w'’-]*){0,3})/u,
    /^([A-Z][\w-]*(?:\s+(?:&|and)\s+[A-Z][\w-]*|\s+[A-Z][\w-]*){0,2})(?:'s|’s)\s/u,
    // M438b (TWIN #430: "Harbor & Finch emailed: …" / "Northwind Logistics wants …" opened threads with no name in the title; she renamed by hand): a name followed by a reporting verb.
    /^([A-Z][\w'’-]*(?:\s+(?:&|and)\s+[A-Z][\w'’-]*|\s+[A-Z][\w'’-]*){0,2})\s+(?:emailed|wrote|replied|responded|wants|want|asked|asks|says|said|sent|called|needs|need|requested|is asking|are asking|pinged|messaged)\b/u,
  ];
  for (const p of pats) {
    const m = s.match(p); if (!m) continue;
    const words = m[1].trim().split(/\s+/); while (words.length && CLIENT_VERBS.has(words[0].replace(/[^\w]/g, ''))) words.shift();
    if (!words.length) continue;
    const name = words.join(' '); const first = words[0].replace(/[^\w]/g, '');
    if (first.length < 4 || CLIENT_STOP.has(first)) continue;
    return name;
  }
  return null;
}

export class Translator {
  constructor(private store: Store) {}
  /** M342: the last round's failure, readable by the server after translateRound returns null. */
  lastError: string | null = null;

  // Translate one round. Returns the applied result (already persisted) or null on failure.
  // Failures are non-fatal by design: the map is a beat behind, never a blocker.
  async translateRound(params: {
    projectId: string;
    chatId: string;
    turnId: string;
    focusContainerId: string;
    userText: string;
    assistantText: string;
    /** M344: a backlog taken as one round — every waiting exchange of the view, oldest first (the last one is params.turnId). */
    exchanges?: { turnId: string; userText: string; assistantText: string }[];
  }): Promise<{ roundId: string; result: RoundResult; focusRequestId: string | null; debug: { inputTree: string; rawText: string } } | null> {
    const map = loadMap(this.store, params.projectId);
    const batch = params.exchanges && params.exchanges.length > 1 ? params.exchanges : null;
    const perAgent = batch ? Math.max(1000, Math.floor(6000 / batch.length)) : 3000;
    const userAll = batch ? batch.map((e) => e.userText).join('\n\n') : params.userText;
    const agentAll = batch ? batch.map((e) => truncate(e.assistantText, perAgent)).join('\n\n') : truncate(params.assistantText, 3000);
    const roundBlock = batch
      ? `NEW ROUND: ${batch.length} exchanges arrived while the map was catching up — oldest first. Translate them ALL as one round; where a later exchange corrects or supersedes an earlier one, file the later state (update, not a twin).\n` + batch.map((e, i) => `[${i + 1}] USER: ${e.userText}\nAGENT: ${truncate(e.assistantText, perAgent)}`).join('\n\n')
      : `NEW ROUND:\nUSER: ${params.userText}\nAGENT: ${truncate(params.assistantText, 3000)}`;
    if (batch) params = { ...params, userText: userAll }; // the guards and checks below judge the whole backlog
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
        const existing = matchNodes(this.store, params.projectId, `${userAll}\n${agentAll}`, { limit: 6 })
          .map((m) => map.nodes.find((n) => n.id === m.id)).filter((n): n is MapNode => !!n && readScope.has(n.id));
        const existingNote = existing.length
          ? `EXISTING NODES ON THIS ROUND'S SUBJECTS (word-matched; check before creating): ${existing.map((n) => `[${n.id}] ${n.title || n.content.slice(0, 60)}`).join(' · ')}\nIf the round refines, corrects or supersedes one of these, update_node THAT id (the node keeps its history); create a new node only for a subject none of them holds. When the round OVERTURNS part of a node's statement, REWRITE that part so the statement reads as the current rule — never leave the old clause standing beside the new one.${spansBranches(this.store, existing) ? `\nTHESE SIT IN DIFFERENT BRANCHES: when this round connects two of them (one rests on, answers, blocks or contradicts the other), emit create_link between them with the type that fits — the map holds no cross-links until you make them.` : ''}`
          : '';
        const parsed = await call({
          task: 'filer', system: filerSystem() + systemCard(this.store, params.projectId, 'the FILER'), maxTokens: 2048, schema: SCHEMA, timeoutMs: filerTimeoutMs(),
          audit: (k, d) => this.store.audit(k, d),
          user: [
              `CURRENT MAP (▶ = focus; ids in [brackets]):\n${tree}`,
              `FOCUS NODE ID: ${params.focusContainerId}`,
              roundBlock,
              existingNote,
              integrationNote,
              pass === 2 && !emptyRetry ? 'You requested expansion; the branches are now readable (READ-ONLY). Translate this round fully — request_expansion is no longer available.' : '',
              emptyRetry ? 'YOUR FIRST ANSWER FILED NOTHING, yet the round is not pure mechanics: the user raised a subject and the agent answered at length. The NEW-TOPIC GUARANTEE applies — create the topic node (its facts, options or questions under it; top level if no lit branch fits) and answer again with the alterations. An empty list is right only for greetings, thanks and pure meta-talk.' : '',
              'Translate this round. Five final checks before answering: (0) NEW-TOPIC GUARANTEE: did the user bring up ANY topic this round that is absent from the map — however small or transient (a weather question, a quick lookup, a passing thought)? You MUST leave at least one node for it (in scope, or under "to sort"): often a question node with status answered, carrying the gist of the answer in its description. A topic switch that produces zero alterations is almost always wrong. Only pure mechanics produce nothing (greetings, thanks, questions about the assistant itself). (1) does any subtree you filed under now hold two or more unrelated topics, duplicates, or material that outgrew it? If yes, add a suggest_restructure. (2) Are you changing the status of any node the user did NOT touch this round? "Park/drop/done all of it" refers to the CURRENT thread only — decisions, constraints, and evidence settled earlier KEEP their statuses. If your alterations re-status more than ~3 nodes, you are almost certainly wrong — cut back to the ones actually discussed. (3) Does the "to sort" node hold anything whose home is NOW writable (fully readable, not (dim))? If yes, move_node it home and strip the provenance note from its content. (4) FOCUS REQUEST: did the user EXPLICITLY ask to concentrate the conversation on ONE thing ("let\'s focus on X", "just X for now", "back to X")? If yes, add top-level focus_request: {id: the node where X lives — an existing [id], or the id you used in a create_node this round}. This changes nothing by itself; the user confirms via a button. Most rounds have NO focus_request — passing mentions and new topics are NOT focus requests, only an explicit ask to concentrate. (5) PREFERENCES: if the USER\'S MAP PREFERENCES say where a kind of material goes or how it is named, that wins over every default placement rule above — re-check each create_node against them before answering.',
            ].filter(Boolean).join('\n\n') + statusConsult(this.store, params.projectId, params.focusContainerId, 'filing'),
        }) as RoundResult;
        text = JSON.stringify(parsed);
        summary = parsed.summary ?? '';
        alterations = normalizeIds(parsed.alterations ?? [], map, (k, d) => this.store.audit(k, d));
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
        if (pass === 1 && !expansion && alterations.length === 0 && userAll.trim().length >= 6 && agentAll.trim().length >= 300 && !/\b(greet|pleasantr|mechanic|thank|acknowledg|small talk|no topic|nothing new|meta[- ]?(talk|question)|capabilit)/i.test(summary)) {
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
      alterations = this.guardCorrectionRetire(alterations, map, params);
      alterations = this.guardResolutionClose(alterations, map, params);
      if (process.env.HARNESSMAP_GUARD_REJECTION !== '0') alterations = this.guardUserRejection(alterations, map, params); // M358c: on by default since 0.9.69 (HARNESSMAP_GUARD_REJECTION=0 switches it off) — proven on the scene-detect thread: the two URL nodes reopened, the tool-name list card untouched
      alterations = this.guardRecapMirror(alterations, map, params); // M443 (TWIN #426): a recap turn creates nothing the map already holds
      alterations = this.guardDecisionAuthor(alterations, map, params); // M442 (TWIN #426): a decision stated in the person's own words is theirs
      alterations = this.guardAgentSolidStatus(alterations); // M442a (TWIN #426): an agent-authored row is never born accepted/decided
      alterations = this.guardCommitmentIsTask(alterations, map); // M451 (TWIN #430): a promise of a future action is open work, not a decided decision
      alterations = this.guardAgentQuestionAnswered(alterations, map, params); // M447 (PANEL #429): the agent's question, answered by the next short reply, closes
      alterations = this.guardTaskDelivered(alterations, params); // M439 (Jacob 23:08 'This is literally a bug'): a task the agent delivers in the same turn is done
      alterations = this.guardRootClientName(alterations, map, params); // M438 (TWIN #423): a thread opened in a client's name carries the name in its title
      alterations = this.guardAgentTaskStatus(alterations); // M437 (PANEL #422): an agent-listed step is a proposal, not the person's todo
      alterations = this.guardUserRetires(alterations, map, params); // M431 (TWIN #417 Elena): 'cut “X”' retires the live row titled X; 'merge X into Y' moves X under Y
      const result: RoundResult = { summary, alterations };
      // M342: a retry must never apply a round twice — if this turn already has a round (a replay raced the original), keep the first.
      const prior = this.store.roundForTurn(params.turnId);
      if (prior) { this.store.audit('round_already_filed', { turn: params.turnId.slice(0, 8), round: prior.id.slice(0, 8) }); return { roundId: prior.id, result: { summary: 'already filed', alterations: [] }, focusRequestId: null, debug: { inputTree: '', rawText: '' } }; }
      const roundId = this.store.recordRound(params.chatId, params.turnId, result, `${backendName()}:${modelFor('filer')}`);
      this.store.applyAlterations(params.projectId, result.alterations, { kind: 'round', roundId });
      this.lastError = null;
      return { roundId, result, focusRequestId, debug: { inputTree: renderScopedTree(map, readScope, { focusId: params.focusContainerId }), rawText: text } };
    } catch (err) {
      this.lastError = String(err instanceof Error ? err.message : err).slice(0, 500);
      console.error('[translator] round failed (kept in the filing ledger for retry):', err);
      this.store.audit('round_failed', { turn: params.turnId.slice(0, 8), error: this.lastError.slice(0, 200) });
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
  // M356 (Jacob 2026-09-20, "debug, you are in a loop"): the stance re-score found misread branches left standing — the assistant
  // answered a question the user did not ask (GUI *development* tools for "other GUI tools?"), the filer built the card, the user's
  // next turn said "I mean GUI tools for packaging", the filer answered THAT elsewhere and the misread card stayed answered. Guard:
  // when the user's turn is an explicit correction of the question ("I mean…", "not what I asked", "我说的是…", "我问的是…") and this
  // round touched nothing in a card the PREVIOUS round created, that card is parked — it answered a misreading. Cards this round
  // updated or extended are left alone (a correction of a detail, not of the question). Prompts guide, guards enforce.
  // M431 (TWIN LONG #417, Elena the research analyst, 2026-10-07): the first outline turn filed seven section rows under "Briefing
  // outline"; when she said "Merge section 4, Wellbeing and retention, into section 3, Output results" and later "Cut “Where it did
  // not work” from the briefing", the filer rewrote the outline's statement and added a note that the section was cut — but the two
  // original rows stayed LIVE under the outline for the rest of the day (22 severe steps; she asked the map three times, never deleted
  // them by hand). Guard: when the person's own turn names a live row by its title and says it is cut / removed / dropped / deleted, the
  // row is retired (status dropped — the statement and the "why" note stay); when the turn says "merge X into Y" and both are live rows,
  // X moves under Y. Only exact title matches (normalized), never a root, at most three rows a round; the filer's own writes to those
  // rows win. Audit guard_user_retires {id, title, how, was}.
  // M437 (PANEL #422, LONG #421 map: "Create AWS account [todo]", "Open EC2 Free Tier [todo]", "Launch EC2 instance [todo]", "Create key pair
  // [todo]" — the agent's setup instructions filed as the person's to-do list; five personas: "I requested information but never committed
  // to those steps"; 22 such rows across 9 kept maps): a task the AGENT lists is a proposal until the person takes it up. An agent-authored
  // task created with status todo or doing is filed as proposed; the person (or a later round in their words) can make it todo. Only
  // creations are touched — a later update that sets todo on an existing agent task stands. Audit guard_agent_task_status.
  // M438 (TWIN #423 Nadia: "Marchetti's Python invoicing script is double-counting refunds…" → the thread's root titled "Fix refund
  // double-counting" — "does not say Marchetti. With three more clients coming, I need the client name visible or Friday becomes a dig";
  // she renamed it by hand, as Noor did for Harbor & Finch in #415 and as #409's Nadia asked for — the client-root-named-after-its-first-
  // issue class, 4 sightings in 3 drives): when the person's turn is ABOUT a named party — it opens with the name ("Marchetti's …",
  // "Switching to Huang & Partners.", "For Orbit Labs, …") — and this round titles a TOP-LEVEL node whose title lacks the name's first
  // word, the title is prefixed "Name — title". Only the first such root per round; the statement is untouched. Sweep of the kept maps
  // (scratchpad/sweep-clientname.ts): 14 root titlings in client-naming turns, 1 lacking the name (this one), 0 false positives after
  // excluding leading verbs ("Revise Northwind's clause") and mid-turn mentions ("summarize separately for Marchetti, Orbit …").
  // M439 (Jacob 2026-10-07 23:08, on "a row stays todo/active after the agent delivered it in the same turn" — PANEL #416 9/13 "Choose step
  // direction [todo]", Hannah/Nadia closing rows by hand: "This is literally a bug"): a TASK the person asked for, filed todo/doing in a
  // round whose assistant reply DELIVERS it — a fenced code block, or "here is the updated …" / "I've updated/added/implemented/fixed …" —
  // is done at filing. The person's later "it doesn't work" reopens it (M358/M422). Sweep of the kept maps (scratchpad/sweep-delivered.ts):
  // 147 user tasks filed todo/doing, 19 with a delivering reply in the same round, every one a delivered rewrite/implementation.
  // M442 (TWIN LONG #426): see FIRST_PERSON. For a create_node or update_node that sets a solid status (decided/accepted/chosen/done)
  // or is typed decision/constraint, when the person's turn carries a first-person commitment and the statement shares at least three
  // distinctive words (and 30 %) with that turn, the author becomes "user". Audit guard_decision_author {id, from, shared}.
  private guardDecisionAuthor(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const ut = String(params.userText ?? '');
    if (ut.length < 20 || !FIRST_PERSON.test(ut)) return alterations;
    const turn = distinctiveTokens(ut);
    if (turn.size < 4) return alterations;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const a of alterations) {
      if (!(a?.op === 'create_node' || a?.op === 'update_node')) continue;
      const cur = a.op === 'update_node' ? byId.get(String(a.id)) : undefined;
      const author = a.op === 'create_node' ? (a.author ?? 'agent') : (cur?.author ?? 'agent');
      if (author !== 'agent') continue;
      const status = String(a.status ?? '');
      const type = String(a.type ?? cur?.type ?? '');
      if (!/^(decided|accepted|chosen|done)$/.test(status) && !/^(decision|constraint)$/.test(type)) continue;
      const text = `${a.title ?? ''} ${a.content ?? cur?.content ?? ''}`;
      const mine = distinctiveTokens(text);
      if (mine.size < 4) continue;
      let shared = 0; for (const w of mine) if (turn.has(w)) shared++;
      if (shared < 3 || shared / mine.size < 0.3) continue;
      this.store.audit('guard_decision_author', { id: String(a.id ?? '').slice(0, 8), from: author, shared, title: String(a.title ?? a.content ?? '').slice(0, 40) });
      a.author = 'user';
    }
    return alterations;
  }

  // M442a (TWIN LONG #426: the agent's drafted liability clause filed [accepted] — "Both clauses should have been marked proposed
  // because Northwind had not accepted them"): the prompt's own rule ("things the AGENT merely proposes enter floated/noted") enforced —
  // an agent-authored creation with status accepted/decided/chosen is filed floated. Tasks are M437's (proposed). Audit guard_agent_solid.
  private guardAgentSolidStatus(alterations: any[]): any[] {
    for (const a of alterations) {
      if (a?.op !== 'create_node' || a.author !== 'agent' || a.type === 'task' || !/^(accepted|decided|chosen)$/.test(String(a.status ?? ''))) continue;
      this.store.audit('guard_agent_solid', { id: String(a.id ?? '').slice(0, 8), from: a.status, title: String(a.title ?? a.content ?? '').slice(0, 40) });
      a.status = 'floated';
    }
    return alterations;
  }

  // M443 (TWIN LONG #426): see RECAP. In a recap round, a create_node whose distinctive words are half or more contained in one existing
  // node's title+statement is a mirror — dropped, its references re-pointed at the row it mirrors; a container created this round whose
  // name says "commitments"/"summary"/"recap" and that ends up with no surviving child is dropped too. Audit guard_recap_mirror.
  private guardRecapMirror(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const ut = String(params.userText ?? '');
    if (!RECAP.test(ut)) return alterations;
    const existing = map.nodes.filter((n) => n.status !== 'removed' && n.author !== 'system').map((n) => ({ id: n.id, toks: distinctiveTokens(`${n.title ?? ''} ${n.content ?? ''}`) }));
    const drop = new Map<string, string | null>(); // dropped create id → the row it mirrors (null = recap container)
    for (const a of alterations) {
      if (a?.op !== 'create_node' || !a.id) continue;
      const mine = distinctiveTokens(`${a.title ?? ''} ${a.content ?? ''}`);
      if (mine.size < 4) continue;
      let best: { id: string; frac: number } | null = null; let top: { id: string; frac: number } | null = null;
      for (const e of existing) { let sh = 0; for (const w of mine) if (e.toks.has(w)) sh++; const frac = sh / mine.size; if (!top || frac > top.frac) top = { id: e.id, frac }; if (frac >= 0.5 && (!best || frac > best.frac)) best = { id: e.id, frac }; }
      // M443b (noor-day proof, round 8): a recap row that restates SEVERAL rows at once ("Harbor & Finch commitments: apply the credit,
      // reduce 12 → 10 seats, confirm by Friday") overlaps no single row by half — but the map as a whole holds 70 % of its words.
      let held = 0; if (!best && mine.size >= 8) { for (const w of mine) if (existing.some((e) => e.toks.has(w))) held++; }
      const union = mine.size >= 8 ? held / mine.size : 0;
      // M443c (TWIN #430: "Harbor & Finch seat downgrade and Friday confirmation remain open" / "The final Northwind clause and cover note still
      // need to be sent" minted as [open] question rows by the recap turn — "the duplicate Harbor open-work marker"): a recap-round create whose
      // statement only restates what is open or done is a status echo — dropped (re-pointed at its best overlap, or just dropped).
      const echo = /\b(?:remains?|still|are|is)\s+(?:open|pending|outstanding|unresolved|to do|not (?:yet )?(?:done|sent|finalized|complete))\b|\bstill (?:needs?|has) to\b|\bopen work\b|\bopen items?\b/i.test(`${a.title ?? ''} ${a.content ?? ''}`);
      if (best) { drop.set(String(a.id), best.id); this.store.audit('guard_recap_mirror', { id: String(a.id).slice(0, 8), of: best.id.slice(0, 8), frac: Math.round(best.frac * 100) / 100, title: String(a.title ?? a.content ?? '').slice(0, 40) }); }
      else if (union >= 0.7 && top) { drop.set(String(a.id), top.id); this.store.audit('guard_recap_mirror', { id: String(a.id).slice(0, 8), of: top.id.slice(0, 8), union: Math.round(union * 100) / 100, title: String(a.title ?? a.content ?? '').slice(0, 40) }); }
      else if (echo && top) { drop.set(String(a.id), top.id); this.store.audit('guard_recap_mirror', { id: String(a.id).slice(0, 8), of: top.id.slice(0, 8), echo: true, title: String(a.title ?? a.content ?? '').slice(0, 40) }); }
    }
    // recap containers left empty by the drops
    for (const a of alterations) {
      if (a?.op !== 'create_node' || !a.id || drop.has(String(a.id)) || a.type) continue;
      if (!/\b(commitments?|summary|recap|promises|open work|still open|outstanding)\b/i.test(`${a.title ?? ''} ${a.content ?? ''}`)) continue;
      const kids = alterations.filter((o: any) => o?.op === 'create_node' && o.parentId === a.id && !drop.has(String(o.id)));
      if (kids.length) continue;
      drop.set(String(a.id), null); this.store.audit('guard_recap_mirror', { id: String(a.id).slice(0, 8), container: true, title: String(a.title ?? a.content ?? '').slice(0, 40) });
    }
    const out: any[] = [];
    for (const a of alterations) {
      if (a?.op === 'create_node' && drop.has(String(a.id))) continue;
      if ((a?.op === 'update_node' || a?.op === 'move_node') && drop.has(String(a.id))) continue;
      if (a?.op === 'create_link' && (drop.has(String(a.fromItemId)) || drop.has(String(a.toId)))) continue;
      if (a?.op === 'create_node' && a.parentId && drop.has(String(a.parentId))) { const to = drop.get(String(a.parentId)); if (!to) continue; a.parentId = to; }
      if (a?.op === 'move_node' && a.parentId && drop.has(String(a.parentId))) { const to = drop.get(String(a.parentId)); if (!to) continue; a.parentId = to; }
      out.push(a);
    }
    return out;
  }

  // M447 (PANEL #429, 11 of 13 quoted "Older, untouched: the tic-tac-toe winning-position question and setup choices…" — "Which positions
  // did you choose?" [open] after the person answered "Positions 2,5, and 8." the very next turn; "Which symbol: X or O?" and "Who moves
  // first?" after "I'll place X in position 6"): a question the AGENT asked the person, left open, is answered by the person's next turn
  // when that turn is a short reply — no question of its own, under 160 characters — and the question was asked within the last two
  // rounds. The reply's content is filed by the filer as it sees fit; the guard only closes the asked question. Audit guard_agent_question.
  private guardAgentQuestionAnswered(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const ut = String(params.userText ?? '').trim();
    if (!ut || ut.length > 160 || /[?？]/.test(ut)) return alterations;
    const times = this.store.roundTimes?.() ?? []; if (times.length < 1) return alterations;
    const since = times[Math.max(0, times.length - 2)] - 1000; // the round two back (this round is not yet recorded)
    const touched = new Set(alterations.filter((a) => a?.op === 'update_node' && a.id).map((a) => String(a.id)));
    let n = 0;
    for (const q of map.nodes) {
      if (q.author !== 'agent' || q.type !== 'question' || q.status !== 'open' || touched.has(q.id)) continue;
      const born = Date.parse(String(q.createdAt ?? '').replace(' ', 'T').replace(/Z?$/, 'Z')); if (!Number.isFinite(born) || born < since) continue;
      this.store.audit('guard_agent_question', { id: q.id.slice(0, 8), title: String(q.title ?? q.content ?? '').slice(0, 40), reply: ut.slice(0, 40) });
      alterations.push({ op: 'update_node', id: q.id, status: 'answered' });
      if (++n >= 3) break;
    }
    return alterations;
  }

  // M451: see FUTURE_COMMITMENT. A user-authored create/update typed decision/claim/constraint (or untyped) whose statement commits to a
  // future action becomes a task, todo. Never a row already a task, never agent-authored (M437 owns those). Audit guard_commitment_task.
  private guardCommitmentIsTask(alterations: any[], map: { nodes: MapNode[] }): any[] {
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const a of alterations) {
      if (!(a?.op === 'create_node' || a?.op === 'update_node') || typeof a.content !== 'string') continue;
      const cur = a.op === 'update_node' ? byId.get(String(a.id)) : undefined;
      const author = a.op === 'create_node' ? (a.author ?? 'agent') : (cur?.author ?? 'agent');
      const type = String(a.type ?? cur?.type ?? '');
      if (author !== 'user' || type === 'task' || type === 'question' || type === 'option' || type === 'evidence') continue;
      if (!FUTURE_COMMITMENT.test(a.content) || a.content.length > 400) continue;
      const status = String(a.status ?? cur?.status ?? '');
      if (/^(done|resolved|dropped|removed|superseded|rejected|parked)$/.test(status)) continue;
      this.store.audit('guard_commitment_task', { id: String(a.id ?? '').slice(0, 8), from: `${type || 'untyped'}/${status || '-'}`, title: String(a.title ?? a.content).slice(0, 40) });
      a.type = 'task'; a.status = 'todo';
    }
    return alterations;
  }

  private guardTaskDelivered(alterations: any[], params: { assistantText?: string; userText?: string }): any[] {
    const at = String(params.assistantText ?? '');
    // M448: a docs-reading request answered in substance — the reply explains the thing (≥ 120 chars and not a bare acknowledgement);
    // the proof's second consistent-return turn got a 222-char two-sentence summary, which is the delivery.
    const learn = LEARN_REQUEST.test(String(params.userText ?? '')) && at.length >= 120 && !/^\s*(?:sure|ok(?:ay)?|got it|will do|understood|noted|alright|certainly|of course)\b[^.!?\n]*[.!]?\s*$/i.test(at); // one acknowledging sentence is a promise, not a delivery
    if (at.length < 40 || (!DELIVERS.test(at) && !learn)) return alterations;
    for (const a of alterations) {
      if (a?.op !== 'create_node' || a.author !== 'user' || a.type !== 'task' || !/^(todo|doing)$/.test(String(a.status ?? ''))) continue;
      this.store.audit('guard_task_delivered', { id: String(a.id ?? '').slice(0, 8), from: a.status, title: String(a.title ?? a.content ?? '').slice(0, 40) });
      a.status = 'done';
    }
    return alterations;
  }

  private guardRootClientName(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const name = clientNameOfTurn(params.userText ?? '');
    if (!name) return alterations;
    const first = name.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const a of alterations) {
      if (!(a?.op === 'create_node' || a?.op === 'update_node') || typeof a.title !== 'string' || !a.title.trim()) continue;
      const isRoot = a.op === 'create_node' ? (a.parentId == null) : (byId.get(a.id)?.parentId === null);
      if (!isRoot) continue;
      if (a.title.toLowerCase().includes(first)) return alterations;
      const to = `${name} — ${a.title.trim()}`.slice(0, 90);
      this.store.audit('guard_root_client_name', { id: String(a.id ?? '').slice(0, 8), name, from: a.title.slice(0, 40) });
      a.title = to;
      return alterations;
    }
    return alterations;
  }

  private guardAgentTaskStatus(alterations: any[]): any[] {
    for (const a of alterations) {
      if (a?.op !== 'create_node' || a.author !== 'agent' || a.type !== 'task' || !/^(todo|doing)$/.test(String(a.status ?? ''))) continue;
      this.store.audit('guard_agent_task_status', { id: String(a.id ?? '').slice(0, 8), from: a.status, title: String(a.title ?? a.content ?? '').slice(0, 40) });
      a.status = 'proposed';
    }
    return alterations;
  }

  private guardUserRetires(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const ut = (params.userText ?? '').trim();
    if (!ut || ut.length > 700) return alterations;
    if (!/\b(cut|remove|drop|delete|merge)\b|删除|去掉|合并/i.test(ut)) return alterations;
    const norm = (x: string) => x.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const live = map.nodes.filter((n) => n.parentId !== null && !/^(removed|dropped|done|rejected|superseded|parked|merged)$/.test(n.status) && norm(n.title ?? '').length >= 3);
    const find = (name: string): MapNode[] => { const k = norm(name); return k.length < 3 ? [] : live.filter((n) => norm(n.title ?? '') === k); };
    // The filer's own writes win only where they conflict: a status it set this round blocks the retire; a move or a create this round
    // blocks the merge-move. A content/title rewrite does not — that is exactly what the filer did to Elena's merged section while
    // leaving the row where it was (proof run 1: "Wellbeing and retention" renamed to "Wellbeing paragraph", still a sibling).
    const statused = new Set(alterations.filter((a) => a?.op === 'update_node' && a.status && typeof a.id === 'string').map((a) => a.id as string));
    const movedOrNew = new Set(alterations.filter((a) => (a?.op === 'move_node' || a?.op === 'create_node') && typeof a.id === 'string').map((a) => a.id as string));
    const touched = new Set<string>();
    const under = (id: string, root: string) => { for (let c: MapNode | undefined = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) if (c.id === root) return true; return false; };
    const out = [...alterations]; let n = 0;
    const retire = (node: MapNode, how: string) => {
      if (n >= 3 || touched.has(node.id) || statused.has(node.id) || movedOrNew.has(node.id)) return; n++; touched.add(node.id);
      out.push({ op: 'update_node', id: node.id, status: 'dropped' });
      this.store.audit('guard_user_retires', { id: node.id.slice(0, 8), title: (node.title ?? '').slice(0, 40), how, was: node.status });
    };
    // "cut “X”" / "remove 'X'" / "delete the section “X”" — the quoted form, in English or Chinese.
    for (const m of ut.matchAll(/(?:\b(?:cut|remove|drop|delete|scrap)\b[^“"‘'\n]{0,40}?|(?:删除|去掉|删掉)\s*)[“"‘'「]([^”"’'」\n]{3,80})[”"’'」]/giu)) for (const node of find(m[1])) retire(node, 'cut-quoted');
    // "cut section 5, X" / "remove item 3 (X)" — a numbered part named right after the number.
    for (const m of ut.matchAll(/\b(?:cut|remove|drop|delete)\s+(?:the\s+)?(?:section|item|part|chapter|step)\s+\d+\s*[,(:：]\s*([^,.;:()\n]{3,60})/giu)) for (const node of find(m[1])) retire(node, 'cut-numbered');
    // "merge (section 4,) X into (section 3,) Y" — X moves under Y.
    for (const m of ut.matchAll(/\bmerge\s+(?:the\s+)?(?:section\s+\d+\s*,?\s*)?[“"]?([^“”",\n]{3,60}?)[”"]?\s*,?\s+into\s+(?:the\s+)?(?:section\s+\d+\s*,?\s*)?[“"]?([^“”",.;—\n]{3,60}?)[”"]?\s*(?:[,.;—:]|$)/giu)) {
      const xs = find(m[1]), ys = find(m[2]);
      if (xs.length !== 1 || ys.length !== 1) continue;
      const [x] = xs, [y] = ys;
      if (x.id === y.id || under(y.id, x.id) || x.parentId === y.id || touched.has(x.id) || movedOrNew.has(x.id) || n >= 3) continue;
      n++; touched.add(x.id);
      out.push({ op: 'move_node', id: x.id, parentId: y.id });
      this.store.audit('guard_user_retires', { id: x.id.slice(0, 8), title: (x.title ?? '').slice(0, 40), how: 'merged-into', into: y.id.slice(0, 8) });
    }
    return out;
  }

  private guardCorrectionRetire(alterations: any[], map: { nodes: MapNode[] }, params: { chatId: string; userText?: string }): any[] {
    const ut = (params.userText ?? '').trim();
    if (!ut || ut.length > 400) return alterations;
    const CORR = /(^|[^\p{L}])(no[,.!]?\s+)?i\s+mean[t]?\b|not what i (asked|meant|said|want(ed)?)|i (was|am|'m|’m) (asking|talking) about|that'?s not (what|the question) i|我说的是|我是说|我的意思是|我指的是|我问的是|我要的是|不是问你|我不是问/iu;
    if (!CORR.test(ut)) return alterations;
    const prev = this.store.lastRoundAlterations(params.chatId);
    const created = new Set(prev.filter((a: any) => a.op === 'create_node' && typeof a.id === 'string').map((a: any) => a.id as string));
    if (!created.size) return alterations;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const tops = [...created].filter((id) => { const n = byId.get(id); return !!n && n.status !== 'removed' && !created.has(n.parentId ?? '') && n.parentId !== null; });
    if (!tops.length) return alterations;
    const under = (id: string, root: string) => { for (let c: MapNode | undefined = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) if (c.id === root) return true; return false; };
    const touchedIds = alterations.map((a) => a?.id).filter((x): x is string => typeof x === 'string');
    const out = [...alterations];
    for (const root of tops) {
      if (touchedIds.some((id) => under(id, root)) || alterations.some((a) => a?.op === 'create_node' && typeof a.parentId === 'string' && under(a.parentId, root))) continue;
      const n = byId.get(root)!;
      if (/^(parked|removed|superseded|decided|accepted)$/.test(n.status)) continue;
      out.push({ op: 'update_node', id: root, status: 'parked' });
      this.store.audit('guard_correction_retire', { id: root.slice(0, 8), title: (n.title || n.content).slice(0, 40), was: n.status });
    }
    return out;
  }

  // M358 (Jacob 2026-09-20, stance re-score "user rejection not honoured"): scene-detect zh — the user said "ffmpeg-scene-change-detector
  // 这个网址不存在" and the map kept the tool node with its dead URL as a noted fact; book-links took three pieces to notice the links
  // were dead. Guard: when a short user turn names a URL or an identifier that a live node carries AND says it does not exist / is
  // invalid / cannot be opened / 404 / not found, and this round did not touch that node, the node is reopened (status open) — the
  // user's report stands until the filer or the person settles it; audit guard_user_rejection. At most three nodes a round.
  private guardUserRejection(alterations: any[], map: { nodes: MapNode[] }, params: { userText?: string }): any[] {
    const ut = (params.userText ?? '').trim();
    if (!ut || ut.length > 500) return alterations;
    const NEG = /不存在|无效|失效|打不开|访问不了|无法访问|没有这个|没有该|没有此|不是真的|404|does not exist|doesn'?t exist|no such|not found|dead link|doesn'?t work|does not work|is invalid|isn'?t valid|is broken|is fake|made (that )?up|hallucinat/iu;
    if (!NEG.test(ut)) return alterations;
    const tokens = new Set<string>();
    for (const m of ut.matchAll(/https?:\/\/[^\s"'）)>]+/g)) tokens.add(m[0].replace(/[.,;:!?。，；：！？]+$/, ''));
    for (const m of ut.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)+|[A-Z][A-Za-z0-9]{5,}|[a-z]+[A-Z][A-Za-z0-9]{3,}/g)) if (m[0].length >= 6) tokens.add(m[0]);
    for (const t of [...tokens]) if (/^[a-z0-9-]+\.(com|org|net|io|cn|dev)$/i.test(t) || /^(github|gitlab|google|twitter|stackoverflow)\b/i.test(t)) tokens.delete(t); // a bare domain names nothing
    if (!tokens.size) return alterations;
    // M358b (scene-detect re-run): the filer had TOUCHED the URL nodes that round — re-asserting the dead address as fact,
    // following the assistant — so a "skip what the filer touched" rule skipped exactly the nodes the user was rejecting.
    // Now: a touched node is left alone only when the filer's own alteration already carries the rejection (status open /
    // rejected / …, or a negation in its new statement); otherwise its status is overridden to open. A node the filer creates
    // this round that carries the rejected token without the negation is born open.
    const byId = new Map<string, any[]>();
    for (const a of alterations) if (typeof a?.id === 'string') (byId.get(a.id) ?? byId.set(a.id, []).get(a.id)!).push(a);
    const settled = (a: any) => /^(open|rejected|retracted|parked|superseded|removed)$/.test(String(a?.status ?? '')) || (typeof a?.content === 'string' && NEG.test(a.content));
    // M358c (third and last attempt, Jacob's rule: narrow, not wider): when the user's words say it is the ADDRESS that is wrong
    // (网址 / 链接 / 地址 / URL / link / address), only nodes that carry a URL containing the token are targets — a node that merely
    // names the tool ("ffmpeg-scene-change-detector provides threshold and dynamic modes") is not what the user rejected.
    const urlWords = /网址|链接|地址|\bURL\b|\blink\b|\baddress\b/i.test(ut);
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const carries = (text: string) => { const hay = text.toLowerCase(); return [...tokens].find((t) => /^https?:\/\//i.test(t) ? hay.includes(t.toLowerCase()) : urlWords ? new RegExp(`https?:\\/\\/[^\\s"'）)>]*${esc(t)}`, 'i').test(text) : hay.includes(t.toLowerCase())); };
    const out = [...alterations];
    let n = 0;
    for (const node of map.nodes) {
      if (n >= 3) break;
      if (node.status === 'removed' || /^(open|rejected|retracted|parked|superseded|removed)$/.test(node.status)) continue;
      const own = byId.get(node.id) ?? [];
      const hit = carries(`${node.title ?? ''}\n${node.content}\n${own.map((a) => `${a.title ?? ''}\n${a.content ?? ''}`).join('\n')}`);
      if (!hit) continue;
      if (own.some(settled)) continue;
      const upd = own.find((a) => a.op === 'update_node');
      if (upd) upd.status = 'open'; else out.push({ op: 'update_node', id: node.id, status: 'open' });
      this.store.audit('guard_user_rejection', { id: node.id.slice(0, 8), token: hit.slice(0, 60), was: node.status, title: (node.title || node.content).slice(0, 40), overrode: !!upd });
      n++;
    }
    for (const a of out) { // what the filer creates this round with the rejected thing in it, and no rejection of its own
      if (n >= 3) break;
      if (a?.op !== 'create_node' || typeof a.content !== 'string' || settled(a)) continue;
      const hit = carries(`${a.title ?? ''}\n${a.content}`);
      if (!hit) continue;
      a.status = 'open';
      this.store.audit('guard_user_rejection', { id: String(a.id ?? '').slice(0, 8), token: hit.slice(0, 60), was: 'new', title: String(a.title || a.content).slice(0, 40) });
      n++;
    }
    return out;
  }

  // M361 (save-image-path en, stance re-score): "ok it works thanks" filed NOTHING and the item the previous round had just corrected
  // stayed provisional — a resolution in the user's own words did not close anything. Guard: a short user turn that is a bare
  // resolution ("it works", "works now", "that fixed it", "解决了", "可以了", "好了", "成功了" — no question mark, no new ask) and a
  // round whose alterations set nothing to done/resolved: the top-most node the PREVIOUS round touched is marked done, once.
  private guardResolutionClose(alterations: any[], map: { nodes: MapNode[] }, params: { chatId: string; userText?: string }): any[] {
    const ut = (params.userText ?? '').trim();
    if (!ut || ut.length > 120 || /[?？]/.test(ut)) return alterations;
    const RES = /(^|[^\p{L}])((it|that|this|the (code|script|fix|change)) (now )?works( now)?|works (now|fine|great|perfectly)|that (fixed|solved|did) it|problem solved|(is )?fixed now|all good now|已经?(解决|可以|成功|好)了|解决了|可以了|好了|成功了|搞定了|没问题了)([^\p{L}]|$)/iu;
    if (!RES.test(ut)) return alterations;
    if (alterations.some((a) => a?.op === 'update_node' && /^(done|resolved|decided|accepted)$/.test(String(a.status ?? '')))) return alterations;
    const prev = this.store.lastRoundAlterations(params.chatId);
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const touched = prev.map((a: any) => a?.id).filter((x: unknown): x is string => typeof x === 'string');
    const created = new Set(prev.filter((a: any) => a.op === 'create_node').map((a: any) => a.id as string));
    const depth = (n: MapNode) => { let d = 0; for (let c: MapNode | undefined = n; c && c.parentId; c = byId.get(c.parentId)) d++; return d; };
    const cands = [...new Set(touched)].map((id) => byId.get(id)).filter((n): n is MapNode => !!n && n.status !== 'removed' && n.parentId !== null && !created.has(n.parentId ?? '') && !/^(done|resolved|decided|parked|superseded)$/.test(n.status) && n.author !== 'system');
    if (!cands.length) return alterations;
    cands.sort((a, b) => depth(a) - depth(b));
    const target = cands[0];
    this.store.audit('guard_resolution_close', { id: target.id.slice(0, 8), title: (target.title || target.content).slice(0, 40), was: target.status, said: ut.slice(0, 40) });
    return [...alterations, { op: 'update_node', id: target.id, status: 'done' }];
  }

  private guardCorrectionTwin(alterations: any[], map: { nodes: MapNode[] }): any[] {
    return dropCorrectionTwins(alterations, map.nodes, (d) => this.store.audit('guard_correction_twin', d));
  }
  private guardScope(alterations: Alteration[], scope: Set<string>, map: MapView, params: { chatId: string; focusContainerId: string; userText?: string; assistantText?: string }): Alteration[] {
    const live = new Set(scope);
    const focusName = map.nodes.find((n) => n.id === params.focusContainerId)?.title
      ?? map.nodes.find((n) => n.id === params.focusContainerId)?.content ?? '?';
    let toSort = map.nodes.find((n) => n.parentId === null && n.status !== 'removed' && (n.content === 'to sort' || (n.title ?? '') === 'to sort'));
    let toSortId = toSort?.id;
    const out: Alteration[] = [];
    // M336 (perturbed translate-clone replay): the filer sometimes lists an update BEFORE the create of the same node; the update was
    // dropped as "unknown id". An update or move whose target is created later in this batch is deferred to the end, after the create.
    const createdInBatch = new Set<string>(alterations.filter((x: any) => x?.op === 'create_node' && x.id).map((x: any) => String(x.id)));
    // M-loop 2026-10-04 (§10#4b): a guard that DROPS a batch-created node must not strand the batch's references to it. Every drop
    // site records the survivor it folded into (when there is one); the post-pass below re-points parentId/fromItemId/toId/nodeId
    // that still name a dropped id — to the survivor, else to the dropped node's own intended parent, else top level.
    const dropSurvivor = new Map<string, string>();
    const origParent = new Map<string, string | null>(alterations.filter((x: any) => x?.op === 'create_node' && x.id).map((x: any) => [String(x.id), x.parentId ? String(x.parentId) : null]));
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
      // M401 (bar-anniversary-zh #356, codex/luna): the filer's output carried U+FFFD replacement characters — "与���一起成长" for the
      // assistant's "与您一起成长" (the codex side emitted them; our reads decode whole buffers). The transcript still has the real
      // text: a title/statement with a replacement run is matched against the turn with the run as a wildcard and repaired when
      // the match is unique; otherwise it is left as written and audited (never silently shortened). Sweep: 1 node / 115 maps.
      if ((a.op === 'create_node' || a.op === 'update_node')) {
        const said = `${params.userText ?? ''}\n${params.assistantText ?? ''}`;
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const field of ['title', 'content'] as const) {
          const v = anyA[field]; if (typeof v !== 'string' || !/\uFFFD/.test(v)) continue;
          // Each run is matched on a short window around it (the whole statement rarely appears verbatim in the turn — the filer
          // rephrases, the assistant's list has its own prefix): up to 8 characters either side, the run as a 1–3 character wildcard.
          let out2 = v, ok = true;
          for (const m of [...v.matchAll(/\uFFFD+/g)].reverse()) {
            const i = m.index!, j = i + m[0].length;
            let fill: string | null = null;
            // The filer's own lead ("标题方向：") is not in the turn, so the window shrinks on either side until a unique match appears
            // (never below 4 characters of context in total).
            for (const lw of [8, 4, 2, 1]) { for (const rw of [8, 4, 2]) { if (lw + rw < 4 || fill !== null) continue; const left = v.slice(Math.max(0, i - lw), i), right = v.slice(j, j + rw);
              try { const ms = [...said.matchAll(new RegExp(esc(left) + '(.{1,3})' + esc(right), 'gu'))].map((x) => x[1]); const uniq = [...new Set(ms)]; if (uniq.length === 1) fill = uniq[0]; } catch {} } }
            if (fill === null) { ok = false; break; }
            out2 = out2.slice(0, i) + fill + out2.slice(j);
          }
          this.store.audit('guard_mojibake', { id: String(anyA.id ?? '').slice(0, 8), field, from: v.slice(0, 60), repaired: ok });
          if (ok) anyA[field] = out2;
        }
      }
      // M305b (loop find, same rule): a narrating clause inside an otherwise fine statement ("Rocket design: user wants to talk about it; angle
      // not yet narrowed") is cut out, never the node — dropping it would be the over-skip Jacob reported (M302b).
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string') {
        const src = String(anyA.content).trim();
        let trimmed = src.replace(/\b(the )?(user|person) (asked|requested|wants?|wanted|would like|decided|needs?) (to (resume|return to|switch to|talk about|discuss|explore|open|dig into|understand|know|learn)|(for )?(detailed |more )?(information|details?|info) (about|on))[^.;—\n]*[.;,]?\s*/gi, '')
          .replace(/^(the )?(user|person) (asked|inquired)( in \p{L}+)? (about|for) /iu, '')
          .replace(/^(the )?(user|person) (is )?(selected|chose|picked|explor(ed|ing)|confirmed|noticed|flagged|clarified|restated|switched to) /i, '') // leading narration: keep what follows
          .replace(/(^|[.;?!]\s*)(The user|User|The person|The agent|Agent|The assistant|Assistant) (is |then |also )?(selected|chose|picked|explor(ed|ing)|confirmed|noticed|flagged|clarified|restated|switched to|offered|explained|suggested|proposed|answered|redirected|described|listed|recommended|provided|gave|acknowledged|noted|insists?|insisted|demands?|demanded|maintains?|maintained|argues?|argued|believes?|believed|thinks?|thought|feels?|felt|says?|said|states?|stated|claims?|claimed|reports?|reported|mentions?|mentioned|asserts?|asserted|contends?|contended|suspects?|suspected|wonders?|wondered):? (that )?/g, '$1') /* M331: the person's own claim stays as a claim ("User insists Claude made a decision" -> "Claude made a decision") */ // the narrating subject and verb go, the object stays (a fact inside "User confirmed the tiler for the 20th" is kept)
          .replace(/(^|[.;?!]\s*)(The user|User|The person) (asked|demanded|insisted|wanted to know|wants to know|asks):\s*/g, '$1') // M326: the colon form ("User asked: How did…") — the lead goes, the question stays
          .replace(/(^|[。；？！]\s*)(用户|使用者|开发者)(问|询问|要求|说|指出|提问|想知道|反馈)[：:]\s*/g, '$1') // M326b: the same lead in Chinese ("用户问：为什么…")
          .replace(/(^|[。；？！;]\s*)(?:代理|助手|AI ?助手|模型|机器人)(?:提出|建议|认为|指出|提到|给出|回答|回复|说明|表示|推荐)[：:，,]?\s*/g, '$1') // M411 (js-focus-nav-zh #384; content sweep 1 statement / 115 maps / 0 FP): the Chinese form of the 0.9.153 "The agent proposed …" lead — "代理提出：将 HTML 和 querySelectorAll 中的类名字符…" → the proposal itself; the verb must follow the subject directly, so 代理服务器 (a proxy) is untouched
          .replace(/(^|[。；？！;，,：:]\s*)(?:当前|本次|此次|该|这个|最新)(?:的)?(?:回答|回复)(?:中|里)?(?:还|也|则|亦)?(?:提到|指出|声称|认为|称|说明|表示)[，,：:]?\s*/g, '$1') // M412 (go-howto-mix #387, image-convert-zh; content sweep 3 statements / 2 maps / 0 FP): M409 with a determiner — "？当前回答认为没有现成库，并给出了…" → "？没有现成库，并给出了…"; "该回答称可以选择多个图片" → "可以选择多个图片"
          .replace(/(^|[。；？！;，,：:]\s*)(?:当前|本次|此次|该|这个|最新)(?:的)?(?:回答|回复)(?:中|里)?(?=(?:还|也|则|亦)?(?:建议|给出|推荐|列出|提供))/g, '$1') // M412b: before 建议/给出/推荐/列出/提供 only the subject goes ("当前回答给出了使用第三方库…" → "给出了使用第三方库…")
          .replace(/^(?:这是|这个主题是|本主题是|该主题是)?(?:用于|用来)(?:整理|记录|收集|汇总|归纳)\s*(.{2,60}?)\s*的(?:主题|节点|内容|区域)\s*[。.]?$/u, '$1') // M414 (LONG #392 root; content sweep incl. long maps 1 / 118, 0 FP): the Chinese "This is the topic used to organise X" meta-statement — "这是用于整理 WebRTC 学习内容的主题。" → "WebRTC 学习内容" (the 用于记录/已记录 family named in B2 since #320)
          .replace(/^(?:讨论|探讨)(?![区组会帖串中])(?=.{4,})/u, '') // M412c (go-howto-mix #387 root, threejs-texture-zh; sweep 5 roots / 5 maps / 0 FP): the Chinese M403 topic-talk lead — "讨论 Go 是否有…的库，以及…" → "Go 是否有…的库，以及…"; 讨论区/讨论组 (nouns) untouched
          .replace(/^围绕(?:着)?(?=[^，,。；]{2,30}[，,])/u, '') // M412d (leftjoin-zh, container-baseline-zh, nacos-yaml-zh roots): "围绕 SQL 问题，重点理解 LEFT JOIN…" → "SQL 问题，重点理解 LEFT JOIN…" — only the LEAD form with a comma clause; "X围绕A、B展开" (the summary flavour, B2) is untouched
          .replace(/(^|[。；？！;，,：:]\s*)(?:回答|回复)(?:中|里)?(?:还|也|则|亦)?(?:提到|指出|声称|认为|称|说明|表示)[，,：:]?\s*/g, '$1') // M409 (go-html-png-zh #382; content sweep 7 statements / 5 maps / 0 FP): bare ROUND-TALK without the 本轮 lead — "除 os/exec 外，回答还提到 gorun、sh 和 ishell" / "回答指出，省略第一个参数时…" / "回答中提到可使用 BACKUP LOG" — the reporting verb goes, the fact stays
          .replace(/(^|[。；？！;，,：:]\s*)(?:回答|回复)(?:中|里)?(?=(?:还|也|则|亦)?(?:建议|给出|推荐|列出))/g, '$1') // M409b: before 建议/给出/推荐/列出 only the subject goes ("回答建议针对每次重定向…" → "建议针对每次重定向…")
          .replace(/(^|[。；？！;]\s*)(?:本轮|这一轮|此轮|上一轮)(?:的)?(?:回答|回复)?(?:认为|指出|提到|称|声称|说明|表示|说|给出的|提供了|提供的|中)?[，,：:]?\s*/g, '$1') // M421f (LONG #403: "本轮回答称，同一台机器…" left "称，…"): 称/声称/说明/表示/说 join the verbs. M402 (excel-name-drift-zh #359 + content sweep 4 maps / 0 FP): ROUND-TALK inside a statement — "本轮回答认为，B 的提交…", "本轮提供了…方案", "本轮给出的“…”被指出有误" — the lead goes, the fact stays
          .replace(/^(?:This|The|That) (?:broader )?(?:topic|area|branch|node|subtree|section) (?:contains|covers|includes|is about|groups|holds|is)\s+/i, '') // M403 (hash-table #362 + content sweep 8 maps / 0 FP): TOPIC-TALK at the start of a statement — "This topic covers reference formatting…", "This branch covers debugging…", "The broader topic is analysis of…" — the lead goes, the subject stays (finishNarrationTrim sentence-cases it)
          .replace(/(^|[，,。；])\s*当前聚焦于\s*/g, '$1') // M403b
          .replace(/^(?:The|This) (.{3,80}?) (?:is|are) being (reviewed|debugged|analy[sz]ed|investigated|examined|discussed)(?: (?:for|against|to|with|on))?\s*/i, (_m: string, subj: string, verb: string) => `${({ reviewed: 'Review', debugged: 'Debugging', analysed: 'Analysis', analyzed: 'Analysis', investigated: 'Investigation', examined: 'Examination', discussed: 'Discussion' } as Record<string, string>)[verb.toLowerCase()] ?? 'Review'} of the ${subj} `) // M405 (cpp-contest #365, transformer-review; content sweep 2 roots / 0 FP): PROGRESS narration — "The submitted C++17 code is being reviewed for compilation…" → "Review of the submitted C++17 code compilation…" (a subject, not a status report) (tk-centred-zh #353): "…主题，当前聚焦于按钮输出…" — the "currently focusing on" lead goes
          .replace(/^(?:The|This) (.{3,80}?) (?:is|are) (?:currently |still |now )?under (review|investigation|discussion|analysis|examination|debugging|evaluation)(?: (?:for|against|to|with|on))?\s*([;,.:]?)\s*/i, (_m: string, subj: string, noun: string, p: string) => `${noun.charAt(0).toUpperCase() + noun.slice(1).toLowerCase()} of the ${subj}${p} `) // M408 (transformer-review #381; content sweep 1 seed / 0 FP): the M405 shape in its STATIVE form — "The transformer model implementation is under review; one identified issue is…" → "Review of the transformer model implementation; one identified issue is…"
          .replace(/(^|[。；？！]\s*)(该|此|这个)?问题已(?:有答案|回答为|解答为|答复为|有解答|得到解答|解答)[：:]\s*/g, '$1') // M400 (py-to-exe-zh #352, scene-detect-zh): the filer narrating the node's OWN status inside the statement — "…打包？该问题已有答案：可以尝试…" — the lead goes, the answer stays (content sweep 115 maps: 2 hits, 0 FP)
          .replace(/(^|[.;?!]\s*)(The user|User|The person|The agent|Agent|The assistant|Assistant)( and (the )?(agent|assistant|user))? (greeted|said hello|thanked|exchanged (a |some )?(pun|joke|pleasantr|banter)|joked|made a pun|complimented|apologi[sz]ed)[^.;\n]*[.;]?\s*/g, '$1') /* M340: pleasantries drop whole */
          .replace(/(^|[.;?!]\s*)(The user|User|The person) is (doing|working on|building|using|developing|writing|creating|learning|studying|trying to|planning|running)\s+/gi, '$1') /* M340: "User is doing embedded development…" → "Embedded development…" */.replace(/(^|[.;?!]\s*)(the )?(user|person) (asked|inquired)( in \p{L}+)? (about|for)[^.;\n]*[.;]?\s*/giu, '$1').replace(/,?\s*and (the )?(agent|assistant) (listed|explained|offered|described|suggested|answered|gave|recommended)[^.;\n]*/gi, '')
          .replace(/(^|[.;?!]\s*)(the )?(agent|assistant) (asked for clarification|redirected (the user|them) to)[^.;\n]*[.;]?\s*/gi, '$1')
          ;
        trimmed = finishNarrationTrim(src, trimmed); // 2026-10-04 bug fix: tidy + sentence-case ONLY after a real trim, never an identifier (node-xlsx, os/exec, .NET) — see narration-trim.ts
        if (trimmed && trimmed !== src && (trimmed.length >= 12 || (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length >= 6))) { this.store.audit('guard_narration_trim', { from: anyA.content.slice(0, 80), to: trimmed.slice(0, 80) }); anyA.content = trimmed; } // M414b: CJK text is denser — a 6–11-char Chinese remainder ("WebRTC 学习内容") is a whole topic, not a fragment
      }
      // M315 (loop find, guard under "integrate, don't append; update-don't-duplicate" and M286 "choosing never erases"): the filer
      // replaced a chapter's founding statement ("Chapter 2: results") with the round's one fact ("Response rate came in at 62%"),
      // and the chapter was gone — the next "switch to chapter 2" had to make a new one. A rewrite that keeps NO content word of
      // the old statement is not a correction (corrections keep most words); it becomes a child of that node, the statement stays.
      if (a.op === 'update_node' && anyA.id && typeof anyA.content === 'string' && this.store.getSetting(`titleBy:${anyA.id}`) !== 'user') {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        const tok = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{3,}|[\u4e00-\u9fff]{2}/g) ?? []).filter((w) => !STOP.has(w) && !CJK_FUNC_BIGRAM.test(w))); // M410 (go-html-png-zh #382): a CJK bigram holding a particle/aux/status char (的库, 当前, 可靠, 可以, 需要…) is not a content word — three such bigrams let an answered shell-library question be REWRITTEN into an HTML→PNG question (its children dragged along) with shared=3
        if (cur && !cur.content.startsWith('to sort') && cur.parentId !== null) {
          const oldW = tok(cur.content), newW = tok(anyA.content);
          const shared = [...newW].filter((w) => oldW.has(w)).length;
          // M425 (LONG #407 → PANEL #408, four personas: "the 3×4 tic-tac-toe episode is filed under Connect Four"): the filer UPDATED the finished
          // 3x4 game's container (eight moves under it) into "Play Connect Four on an empty 6-row by 7-column board" — two generic words shared
          // ("play", "board"), so the zero-overlap rule let the overwrite through and the old game's moves now sit under the new game's name.
          // A node that already holds a thread (≥ 2 live children) is an episode; a rewrite sharing under a third of its words is the NEXT
          // episode, not a correction of this one — it becomes a child, like the zero-overlap case.
          const kids = map.nodes.filter((k) => k.parentId === cur.id && k.status !== 'removed').length;
          const ratio = shared / Math.max(1, Math.min(oldW.size, newW.size));
          if (oldW.size >= 2 && newW.size >= 2 && (shared === 0 || (kids >= 2 && oldW.size >= 4 && newW.size >= 4 && ratio < 0.34))) { // "Chapter 2: results" has two content words
            const child: any = { op: 'create_node', id: randomUUID(), parentId: cur.id, content: anyA.content, status: anyA.status ?? 'live', author: anyA.author ?? 'agent', ...(anyA.type ? { type: anyA.type } : {}), ...(anyA.title ? { title: anyA.title } : {}) };
            this.store.audit('guard_rewrite_to_child', { id: String(anyA.id).slice(0, 8), from: cur.content.slice(0, 60), to: anyA.content.slice(0, 60), shared, kids });
            alterations.push(child); continue; // M421a (LONG #403 "Disc colors decided?"): the child joins the batch and walks the REST of the chain (M419 and the other title guards never saw it when it went straight to out)
          }
        }
      }
      // M306 (loop find, bug under M68 "titles are self-healing"): a correction that changed the statement left a title that now
      // contradicts it ("Trellis beans east fence" over "…along the west fence"). When the old title carries a content word the
      // new statement dropped, the agent title is cleared (the display falls back to the statement; the healer retitles if long).
      if (a.op === 'update_node' && anyA.id && typeof anyA.content === 'string' && anyA.title === undefined && this.store.getSetting(`titleBy:${anyA.id}`) !== 'user') {
        const cur = map.nodes.find((n) => n.id === anyA.id);
        if (cur?.title && cur.content.trim() !== anyA.content.trim()) {
          // 2026-10-05 (CJK audit of the guards, after 0.9.156): this tokenizer saw Latin words only, so on a Chinese map a correction
          // that changed the statement never cleared the stale Chinese title — the guard was inert there. Han runs now contribute
          // sliding character bigrams (a title phrase that still appears verbatim in the statement keeps every bigram present).
          const tok = (t: string) => { const out = new Set<string>((t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w))); for (const run of t.match(/[\u4e00-\u9fff]+/g) ?? []) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2)); return out; };
          const oldC = tok(cur.content), newC = tok(anyA.content);
          const gone = [...tok(cur.title)].filter((w) => oldC.has(w) && !newC.has(w));
          if (gone.length) { anyA.title = ''; this.store.audit('guard_stale_title', { id: String(anyA.id).slice(0, 8), gone }); }
          // M341 (real ring-buffer replay): "off-by-one error unresolved" over a statement that now says it was fixed — the stale word
          // was never in the old statement, so the rule above could not see it. A title that says unresolved/open/pending/failing on
          // an update whose status or statement says answered/done/resolved/fixed is blanked for the healer.
          else if ((/\b(unresolved|unsolved|open question|pending|still (failing|broken|wrong)|not (yet )?(fixed|working|resolved)|failing|blocked|missing)\b/i.test(cur.title) || /未解决|尚未解决|待解决|待定|仍(然)?(失败|报错|出错)|未修复|尚未修复|仍未/.test(cur.title)) && (/^(answered|done|resolved|decided|accepted|fixed|closed)$/i.test(String(anyA.status ?? '')) || /\b(was|is|has been|now) (fixed|resolved|solved|working|corrected|complete[d]?)\b/i.test(String(anyA.content)) || /已(经)?(修复|解决|完成|搞定)|修好了|解决了|(现在|目前)(可以|正常)(运行|工作)/.test(String(anyA.content)))) { anyA.title = ''; this.store.audit('guard_stale_title', { id: String(anyA.id).slice(0, 8), gone: ['(resolved)'] }); }
        }
      }
      // M399 (echarts-gantt-drift-zh #350, data-platform-zh): the codex filer IMITATED the harness's own provenance note inside a
      // statement — "…账号及密码。（arrived while focus was: ECharts 甘特图）" in full-width parens — and the ASCII-only regexes (M311 below,
      // M413 (LONG #392): a focus name with its own parentheses — "（arrived while focus was: zipfile.write() 内部路径）" — ended the [^)）]* class early and left " 内部路径）" behind; one level of inner parens is now allowed (here and in the six server.ts cleanups).
      // the server's cleanups) never saw it: the node was promoted out of "to sort" with the note still in it. The note is the
      // harness's to write (it appends its own, ASCII, after the guards); a filer-written one, any paren width, goes.
      // M446 (LONG #428, "Free VPS servers": "…usage; this question arose while focus was: Quizizz no longer appears to offer a public
      // REST API…"): the filer paraphrased the provenance note into a clause of the statement — no parentheses, so the strip below
      // missed it. The clause form goes too, to the end of its sentence.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string' && /\b(?:this|the|that) (?:question|topic|item|request|task|issue|material) (?:arose|came up|was raised|was asked|surfaced|arrived) while (?:the )?focus was\b/i.test(anyA.content)) {
        const cleaned = anyA.content.replace(/\s*[;,.—–-]?\s*\b(?:this|the|that) (?:question|topic|item|request|task|issue|material) (?:arose|came up|was raised|was asked|surfaced|arrived) while (?:the )?focus was\b:?[^.!?。]*[.!?。]?/gi, '').replace(/\s{2,}/g, ' ').trim();
        this.store.audit('guard_prov_note_leak', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.content.slice(-60), kind: 'clause' });
        anyA.content = cleaned.length >= 8 ? (/[.!?。]$/.test(cleaned) ? cleaned : cleaned + '.') : anyA.content;
      }
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string' && /[（(]\s*arrived while focus was:(?:[^()（）]|\([^()（）]*\)|（[^()（）]*）)*[)）]/i.test(anyA.content)) {
        const cleaned = anyA.content.replace(/\s*[（(]\s*arrived while focus was:(?:[^()（）]|\([^()（）]*\)|（[^()（）]*）)*[)）]\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
        this.store.audit('guard_prov_note_leak', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.content.slice(-60) });
        anyA.content = cleaned;
      }
      // M421d (LONG #403 "Winning positions": "Tic-tac-toe positions 2, 5, and 8, arriving while focus was: Improve the React render function by…"):
      // the same note paraphrased WITHOUT parens runs to the end of the statement. "while focus was" is the harness's phrase, never a person's;
      // from the joining comma (or the participle) to the end goes.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string' && /\barriv(?:ed|ing)\s+while\s+(?:the\s+)?focus\s+was\s*[:：]/i.test(anyA.content)) {
        const cleaned = anyA.content.replace(/[,，;；]?\s*(?:[（(]\s*)?(?:it\s+|this\s+|which\s+|and\s+)?arriv(?:ed|ing)\s+while\s+(?:the\s+)?focus\s+was\s*[:：][\s\S]*$/i, '').trim();
        if (cleaned.length >= 6) { this.store.audit('guard_prov_note_leak', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.content.slice(-60), form: 'bare' }); anyA.content = cleaned; }
      }
      // M311 (loop find, guard under M278/M77): a NEW node the filer parked in "to sort" without the provenance note and without
      // a dim branch it could belong to is a misfiled topic ("Chongqing attractions" went to to sort while the only dim branch was
      // the home network) — the top level is ordinary; it goes there.
      if (a.op === 'create_node' && toSortId && anyA.parentId === toSortId && typeof anyA.content === 'string' && !/[（(]arrived while/i.test(anyA.content) && !alterations.some((o: any) => o.op === 'suggest_relight' && o.nodeId === anyA.id && /\[[0-9a-f]{6,}\]/i.test(String(o.note ?? '')))) { // only a placement note that names a branch [id] holds it in to sort
        const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{4,}|[\u4e00-\u9fff]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
        const mine = words(anyA.content);
        const dimNodes = map.nodes.filter((n) => n.status !== 'removed' && !live.has(n.id) && n.parentId !== null && n.id !== toSortId);
        const kin = dimNodes.some((n) => { const w = words(`${n.title ?? ''} ${n.content}`); let hits = 0; for (const x of mine) if (w.has(x)) hits++; return hits >= 2; });
        if (!kin && mine.size >= 2) { anyA.parentId = null; this.store.audit('guard_tosort_promote', { id: String(anyA.id).slice(0, 8), content: anyA.content.slice(0, 60) }); }
      }
      // M285 (loop find): a title the person typed on the card is theirs — the filer's update may change the statement, never that title
      if (a.op === 'update_node' && anyA.title !== undefined && anyA.id && this.store.getSetting(`titleBy:${anyA.id}`) === 'user') { delete anyA.title; this.store.audit('guard_hand_title', { id: String(anyA.id).slice(0, 8) }); }
      // M350 (codex-native nf_conntrack replay): "IPv6 连接跟踪配置\u200c" — the codex filer glued a zero-width non-joiner to the end of a title.
      // Invisible format characters (ZWSP/ZWNJ/LRM/RLM/word joiner/BOM/soft hyphen) are never part of a name; they go anywhere in the title, and a
      // ZWJ goes unless it joins two pictographs (a family emoji keeps its joiner).
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string') {
        const pic = (cp: number | undefined) => cp !== undefined && /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp));
        const tz = anyA.title.replace(/[\u200B\u200C\u200E\u200F\u2060-\u2064\u206A-\u206F\uFEFF\u00AD\u061C\u180E\u0000-\u001F\u007F-\u009F]/g, '') // M350b (autohotkey replay): a U+001F control inside a name — C0/C1 controls go with the format characters
          .replace(/\u200D/g, (m: string, off: number, str: string) => (pic(str.codePointAt(off - 2) ?? str.codePointAt(off - 1)) && pic(str.codePointAt(off + 1)) ? m : '')); // a lookbehind cannot see an astral pictograph (surrogate pair), so the flanks are read by hand
        if (tz !== anyA.title) { this.store.audit('guard_title_invisible', { id: String(anyA.id ?? '').slice(0, 8), codes: [...anyA.title].filter((ch) => !tz.includes(ch) || /\p{Cf}/u.test(ch)).map((ch) => ch.codePointAt(0)!.toString(16)).slice(0, 4) }); anyA.title = tz.trim(); }
      }
      // M352 (codex-native Oracle + Krauss replays): "Shortest worker query goes here?", "Krauss ODE definition full sample placeholder" — the
      // codex filer leaves a template's placeholder phrase at the end of a name. Placeholder words are never part of a name; the phrase goes.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string') {
        const tp = anyA.title.replace(/\s+(?:(?:full\s+)?sample\s+placeholder|placeholder(?:\s+(?:title|text|name))?|goes\s+here|title\s+(?:goes\s+)?here|insert\s+title(?:\s+here)?|tbd|todo\s+title)\s*[?？.!]?\s*$/i, '').trim();
        if (tp !== anyA.title.trim() && tp.length >= 3) { this.store.audit('guard_title_placeholder', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(-30) }); anyA.title = tp; }
      }
      // M353 (codex-native JSON-404 replay, Chinese): "核对 JSON 路径。存在一个路径核验", "本地 JSON 仍返回 404.。存在一个资源不存在" — the codex
      // filer glued a second sentence after a CJK full stop inside a title. A name never contains "。"; the title ends at its first one.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /[。．]|[？！][^\s？！?!)）」』"”]/u.test(anyA.title)) {
        // M353b: "跳线是什么意思？公告" — a word glued after a CJK question/exclamation mark is the same shape; a trailing "？" alone stays (a question title).
        const head = anyA.title.split(/[。．]|(?<=[？！])(?=[^\s？！?!)）」』"”])/u)[0].replace(/[\s.:：;；,，]+$/u, '').trim();
        if (head.length >= 3 && head !== anyA.title.trim()) { this.store.audit('guard_title_full_stop', { id: String(anyA.id ?? '').slice(0, 8), dropped: anyA.title.slice(head.length, head.length + 30) }); anyA.title = head; }
      }
      // M402b (sqlsugar-nested-zh title "本轮回滚结论"): the same round-talk lead on a NAME goes; the name keeps its subject.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /^(?:本轮|这一轮|此轮|上一轮)/.test(anyA.title)) {
        const t2 = anyA.title.replace(/^(?:本轮|这一轮|此轮|上一轮)(?:的)?(?:回答|回复)?[，,：:]?\s*/, '').trim();
        if (t2.length >= 2 && t2 !== anyA.title) { this.store.audit('guard_title_round_talk', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(0, 40) }); anyA.title = t2; }
      }
      // M394 (data-platform-zh #301, codex/luna): the filer glued its own OP NAME to a title — "字段展开超限处理者::create_node" — and it
      // reached the map (the M354 leak guard reads content only). Sweep 2026-10-05: 1 title / 115 kept maps, 0 false positives, 0 in
      // content. Strip the op names and the "::" seams from a title; drop the title when nothing meaningful is left (the healer names it).
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /\b(create_node|update_node|move_node|create_link|remove_node|suggest_restructure|focus_request)\b|::/.test(anyA.title)) {
        const from = anyA.title;
        const cleaned = anyA.title.replace(/\s*::\s*/g, ' ').replace(/\b(create_node|update_node|move_node|create_link|remove_node|suggest_restructure|focus_request)\b/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s.:：;；,，\-–—]+|[\s.:：;；,，\-–—]+$/g, '').trim();
        this.store.audit('guard_title_schema_token', { id: String(anyA.id ?? '').slice(0, 8), from: from.slice(0, 60), to: cleaned.slice(0, 60) });
        anyA.title = cleaned.length >= 2 ? cleaned : '';
      }
      // M398 (sqlsugar-rollback-zh #348, codex/luna): the filer glued a UUID to a name — "b语句单独处理方案0c4d07f5-2e6f-4d7f-92f4-5ad2e7f4a3e8" —
      // and it reached the map until the healer renamed it ~50 s later. An id is never part of a name: any 8-4(-4…) hex run with dashes goes.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /[0-9a-f]{8}-[0-9a-f]{4}(?:-[0-9a-f]{4}){0,2}(?:-[0-9a-f]{12})?/i.test(anyA.title)) {
        const from = anyA.title;
        const cleaned = anyA.title.replace(/\s*[0-9a-f]{8}-[0-9a-f]{4}(?:-[0-9a-f]{4}){0,2}(?:-[0-9a-f]{12})?/gi, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s.:：;；,，\-–—]+|[\s.:：;；,，\-–—]+$/g, '').trim();
        this.store.audit('guard_title_uuid', { id: String(anyA.id ?? '').slice(0, 8), from: from.slice(0, 60), to: cleaned.slice(0, 60) });
        anyA.title = cleaned.length >= 2 ? cleaned : '';
      }
      // M406 (android-picker-mb7 #372): "MainActivity implementation fielding_restructure" — a snake_case pseudo-op token glued to a name
      // (a mutated suggest_restructure); M394 strips only the seven exact op names, so it reached the map until the healer renamed it.
      // Any snake_case token (2+ segments) that appears in neither the statement nor the person's words is schema-shaped noise, not a
      // name part; code identifiers (activity_main, item_photo) stay because the statement carries them.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /\b[a-z]+(?:_[a-z0-9]+)+\b/i.test(anyA.title)) {
        const hay = `${typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '')}\n${params.userText ?? ''}\n${params.assistantText ?? ''}`.toLowerCase();
        const stray = (anyA.title.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi) ?? []).filter((t: string) => !hay.includes(t.toLowerCase()));
        if (stray.length) {
          let t2 = anyA.title; for (const t of stray) t2 = t2.replace(t, ' ');
          t2 = t2.replace(/\s{2,}/g, ' ').replace(/^[\s.:：;；,，\-–—]+|[\s.:：;；,，\-–—]+$/g, '').trim();
          this.store.audit('guard_title_snake_token', { id: String(anyA.id ?? '').slice(0, 8), stray: stray.slice(0, 3), from: anyA.title.slice(0, 60) });
          anyA.title = t2.length >= 2 ? t2 : '';
        }
      }
      // M354 (codex-native hash-table replay): asked to "remember this format" (the person's h(11) = 2 (a) → … layout), the filer wrote a rule
      // "Use the requested JSON map format for every response" — its OWN output instructions, leaked into the person's map. A statement that
      // speaks of JSON, schemas, alterations or the "map/response format" when neither the person nor the agent said any of it is a leak, not a fact.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string') {
        const LEAK = /\b(json|schema|alterations?|map format|response format|filer|translat(?:or|ion) (?:prompt|schema)|parentId|nodeId|no more than \d+(?:-\d+)? words|\d+-\d+ words|display name)\b/i; // M354b (latex replay): "Homography link references show no more than 2-4 words" — the title rule itself leaked into a name
        const m = anyA.content.match(LEAK);
        if (m) {
          const said = `${params.userText ?? ''}\n${params.assistantText ?? ''}`.toLowerCase();
          const word = m[1].toLowerCase().replace(/s$/, '');
          if (!said.includes(word) && !said.includes(m[1].toLowerCase())) {
            this.store.audit('guard_self_leak', { id: String(anyA.id ?? '').slice(0, 8), word: m[1], content: anyA.content.slice(0, 80) });
            if (a.op === 'create_node') continue; // dropped: never pushed to out
            delete anyA.content; if (anyA.title === undefined && anyA.status === undefined) continue;
          }
        }
      }
      // M347 (codex-native board-game replay): the codex filer wrote the STATUS into the title — "Wins and complexity bonus ─ chosen?".
      // A trailing separator + status word (+ a stray "?") is a field leaking into a name; it goes, and the status is kept if the op has none.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string') {
        const m = anyA.title.match(/\s*[─—–\-:|(\[]\s*(chosen|accepted|decided|rejected|retracted|parked|active|done|open|floated|noted|answered|todo|doing|hard|provisional|superseded|resolved|live|proposed)\s*[)\]]?\s*\??\s*$/i);
        if (m && anyA.title.length > m[0].length + 3) { const label = m[1].toLowerCase(); anyA.title = anyA.title.slice(0, anyA.title.length - m[0].length).trim(); if (!anyA.status) anyA.status = label; this.store.audit('guard_title_status_tail', { id: String(anyA.id ?? '').slice(0, 8), label }); }
      }
      // M348 (codex-native maths replay): "Distinct graph labels ⟂" — the codex filer leaves stray symbols at the end of titles (⟂, ─, a lone
      // dash or colon). Trailing symbols and dangling punctuation go; a closing ")" "]" quote, "?" or "!" stays, as does any letter or digit.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string') {
        // M348f (minimal-linux replay): "QEMU 串口选项向导说明（asked answered）" — status words in a trailing parenthetical are not part of a name.
        {
          const STAT = '(?:asked|answered|open|done|noted|accepted|decided|floated|parked|todo|doing|live|provisional|rejected|resolved|superseded|retracted|dropped|chosen)';
          const m = anyA.title.match(new RegExp(`\\s*[（(]\\s*${STAT}(?:[\\s,/|·]+${STAT})*\\s*[)）]\\s*$`, 'i'));
          if (m && anyA.title.length - m[0].length >= 3) { this.store.audit('guard_title_status_paren', { id: String(anyA.id ?? '').slice(0, 8), dropped: m[0].trim().slice(0, 30) }); anyA.title = anyA.title.slice(0, anyA.title.length - m[0].length).trim(); }
        }
        // M360b (minimal-linux replay): "核对 root 标识代码>???" — the symbol strip ran before the "???" strip, so the ">" that became
        // trailing afterwards survived. The three strips now repeat until the title stops changing.
        let t0 = anyA.title;
        for (let pass = 0; pass < 4; pass++) {
          const before = t0;
          t0 = t0.replace(/\s*<\/?[a-z][a-z0-9-]*\s*$/i, '').replace(/\s*(?:\{\}|\[\]|[{\[(（])+\s*$/u, '') /* M397 (py2cpp #344): "Code and task provided},{" — a trailing JSON OPENER (or empty pair) is never part of a name; unbalanced closers are M360 below */ // M348e: "炎性肉芽肿主题初识<table" — an unclosed HTML tag fragment glued to a name goes first
            .replace(/(?:\s+|[\p{S}\p{No}\p{Pd}\p{Pc}\uFE0E\uFE0F\u200D:;,·•|/\\~*^_+=<>#&@：；，、]+)+$/u, '') // 2026-10-05 (kotlin-graph #231): "Graph range issue ⚠️" — an emoji's variation selector (U+FE0F) / ZWJ is a mark, not a symbol, so it shielded the symbol from this strip
            .replace(/\s*[?!？！]{2,}$/u, '').trim(); // "Thinkers here ??" — a doubled mark goes (M360 restored this step: an M348e comment had swallowed it)
          // 2026-10-05 (loop find, leftjoin-zh #184): a lone straight quote/apostrophe glued to the end ("示例表数据'") is a stray too — but only when UNBALANCED ("Rock 'n' Roll" stays).
          if (/['"]$/.test(t0) && (t0.split(t0.slice(-1)).length - 1) % 2 === 1) t0 = t0.slice(0, -1).trim();
          if (t0 === before) break;
        }
        // M360 (node-xlsx zh): the codex filer leaked its JSON closers into a name — "导出前清理空格（trim）}]}". Closers are Pe, not in the
        // class above, and a balanced ")" or "]" must stay ("[Draft]"), so only UNBALANCED trailing closers go, one at a time.
        const more = (o: string, c: string) => t0.split(c).length > t0.split(o).length;
        while (/[\]\})）]$/u.test(t0) && ((t0.endsWith(']') && more('[', ']')) || (t0.endsWith('}') && more('{', '}')) || (t0.endsWith(')') && more('(', ')')) || (t0.endsWith('）') && more('（', '）')))) t0 = t0.slice(0, -1).replace(/[\s\p{S}\p{Pd}:;,·•|/\\~*^_+=<>#&@：；，、{\[(（]+$/u, '').trim();
        // M348c: "Face classification task of" — a dangling preposition AFTER A STRIPPED TAIL goes too ("Log in" stays: two words).
        // 2026-10-05 fix (loop find, grammar-quiz #181): this ran unconditionally and turned the quiz option "Didn't have to" into
        // "Didn't have" — a title that legitimately ends in a preposition. It now fires only when THIS guard already stripped a tail
        // from the title, and never when the content carries the title verbatim (a quoted phrase is not a dangling preposition).
        const strippedTail = t0 !== anyA.title.trim();
        const quotedInContent = typeof anyA.content === 'string' && anyA.content.toLowerCase().includes(t0.toLowerCase());
        const t = strippedTail && !quotedInContent && t0.split(/\s+/).length >= 3 ? t0.replace(/\s+(?:of|for|to|and|or|with|in|on|by|the|a|an|at|from)$/i, '').trim() : t0;
        if (t !== anyA.title && t.length >= 3) { this.store.audit('guard_title_tail', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(-12) }); anyA.title = t; }
      }
      // M349 (codex-native panorama replay): "Float target shape values te4a1b6c", "Image dimensions differata1b6c" — a glitch token with
      // digits glued to the end of a title, the same token on two nodes of one round, matching no id and no word in the statement.
      // A title's last word that carries a digit, is 6+ characters and appears nowhere in the statement or the person's words goes.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string') {
        const words = anyA.title.trim().split(/\s+/); const last = words[words.length - 1] ?? '';
        const camel = last.length >= 12 && /\p{Ll}\p{Lu}\p{Ll}/u.test(last) && !/[^\p{L}]/u.test(last); // M349c: "contractivityOops" — a glued camel-case word with no digit, no symbol
        if (words.length >= 2 && last.length >= 6 && ((/\d/.test(last) && /[a-z]/i.test(last)) || camel)) {
          const hay = `${typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '')}\n${params.userText ?? ''}`.toLowerCase();
          const chunks = last.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).flatMap((c: string) => c.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu) ?? []).filter((c: string) => c.length >= 3); // camel-case split first: "ProductOrderDao" → product, order, dao (kept when the identifier is in the statement) // "100/min" → 100, min; "te4a1b6c" → itself; M349b: "2.0.0-p648吧w" → p648 (kept — the version is in the statement)
          if (chunks.length && !chunks.some((c: string) => hay.includes(c))) { this.store.audit('guard_title_glitch_word', { id: String(anyA.id ?? '').slice(0, 8), word: last }); anyA.title = words.slice(0, -1).join(' '); }
        }
      }
      // M419 (TWIN LONG #397 — Nadia: "Marchetti billing noteaming base?" read as "garbled… corrupted", a SEVERE moment; the (U) class
      // the long runs kept logging: "3×4 board layout thingy?", "Read link documentation explained?", "Free VPS servers specified?"). A title
      // that ends in "?" whose last word — plain Latin letters, 2–10 long, not an ordinary short question word — is in neither the statement,
      // the person's words, nor the rest of the title is an invented tail: up to two such words go, and the "?" with them. Sweep of 135 kept
      // maps before shipping: 8 titles, 0 false positives, 1 bad residue ("…tasks only if changed?") — a residue that would end in a function
      // word leaves the title untouched.
      // M421c (LONG #403: "Add Unity WebGL HTML||||?" — a top-level root, listed verbatim by the brain): a run of two or more bars, slashes,
      // hashes or tildes glued to a title's end is a decoding slip, not a name (sweep of 20 kept maps: this one title, none legitimate). The run
      // goes, and a "?" that followed nothing but the run goes with it.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /[|｜\\\/#*~]{2,}\s*\??\s*$/.test(anyA.title)) {
        const to = anyA.title.replace(/\s*[|｜\\\/#*~]{2,}\s*\??\s*$/, '').trim();
        if (to.length >= 2) { this.store.audit('guard_title_punct_run', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(-20) }); anyA.title = to; }
      }
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /\?\s*$/.test(anyA.title)) {
        const QOK = new Set('why how now yet who what when where which next more done ok yes no then too also else here this that them one two it is or and not out off up on in to do go so as at by if of be an am are was can did has had get got set run use try end new old all any via per etc api app ui db id io os js ts css sql url uri dom jvm jni sdk cli gui exe pdf csv xml json npm git ssh tcp udp ip dns aws gcp mac win pc ide cpu gpu ram rom led usb vm vpn vba vbs php cs py ios ai ml nlp ocr rgb hex png jpg gif svg mp3 mp4 wav pcm fft pid mcu rtc gps nfc ble sim esp stm work works working fix fixed bug bugs error errors test tests file files code data list mode rule rules step steps link links page pages name names type types value values size time times user users again first last same other right wrong ready safe valid null empty default'.split(' '));
        const FUNC = /^(?:if|of|for|to|and|or|with|in|on|by|the|a|an|at|from|only|is|are|was|be|not|no|as|into|than|then|that|this|it|its|but|so|nor|yet|while|when|because)$/i;
        const content0 = typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '');
        const hay = `${content0}\n${params.userText ?? ''}`.toLowerCase();
        let words = anyA.title.trim().replace(/\?+\s*$/, '').trim().split(/\s+/); let dropped = 0;
        while (dropped < 2 && words.length >= 3) {
          const w = words[words.length - 1]; const x = w.toLowerCase();
          if (!/^[a-z]{2,12}$/.test(x) || QOK.has(x)) break; // M421b (LONG #403 "Improve documentReady code uncertainty?"): 11-letter invented tails exist; the cap is 12
          if (dropped === 1 && x.length < 7) break; // a second word goes only when it is long and invented-looking ("noteaming"), not a real word the statement happens not to repeat ("layout")
          const rx = new RegExp(`\\b${x}\\b`); if (rx.test(hay) || rx.test(words.slice(0, -1).join(' ').toLowerCase())) break;
          words = words.slice(0, -1); dropped++;
        }
        if (dropped && words.length >= 2 && !FUNC.test(words[words.length - 1])) { const to = words.join(' '); this.store.audit('guard_title_qtail', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(-30), to: to.slice(-30) }); anyA.title = to; }
      }
      // M424 (LONG #407 → PANEL #408, three personas: "odd artifacts such as ✨src"): the filer glued an invented source marker onto two
      // titles ("Apply lint guidance: no-implied-eval ✨src", "No implied eval guidance ✨src") — nothing in the product writes one, and no
      // pictograph appears in the statement or the person's words. Such a pictograph goes, with a short token glued to it; a pictograph
      // the person typed stays. Sweep of 22 kept maps: those two titles, none legitimate.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /\p{Extended_Pictographic}/u.test(anyA.title)) {
        const seen = `${typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '')}\n${params.userText ?? ''}`;
        const picto = [...anyA.title.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
        if (picto.length && picto.every((p) => !seen.includes(p))) {
          const to = anyA.title.replace(/\s*(?:\p{Extended_Pictographic}|\uFE0F)+(?:[A-Za-z]{1,4})?(?=\s|$|[,.;:])/gu, '').replace(/\s{2,}/g, ' ').trim();
          if (to.length >= 2 && to !== anyA.title) { this.store.audit('guard_title_pictograph', { id: String(anyA.id ?? '').slice(0, 8), from: anyA.title.slice(-20) }); anyA.title = to; }
        }
      }
      // M432 (LONG #418 → PANEL #419, three personas: "Improve title divider componentaųtybq [doing]"): the filer glued a run of letters
      // onto a real word — a decoding slip the tail guard (which strips punctuation) and M424 (pictographs) do not see. A Latin title
      // token that appears nowhere in the statement, the person's words or the rest of the title, whose longest prefix (≥ 5 letters) IS
      // such a word, and whose remainder (2–8 letters) carries a non-ASCII letter or no vowel at all, is cut back to the word. Second
      // sighting of the fused-garbage class ("questionances", LONG #403 — ASCII with vowels, deliberately left alone: an inflection
      // the statement does not repeat is not a slip). Sweep of the kept maps before shipping: see the M432 ledger entry.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /\p{Script=Latin}/u.test(anyA.title)) {
        const seen = `${typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '')}\n${params.userText ?? ''}`.toLowerCase();
        const words = new Set((seen.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase().match(/\p{L}+/gu) ?? []));
        const toks: string[] = String(anyA.title).split(/\s+/); let changed = false;
        for (let i = 0; i < toks.length; i++) {
          const m = toks[i].match(/^([\p{L}]+)([^\p{L}]*)$/u); if (!m) continue;
          const core = m[1], tail = m[2], low = core.toLowerCase();
          if (core.length < 8 || words.has(low) || !/\p{Script=Latin}/u.test(core)) continue;
          if (toks.some((t, j) => j !== i && t.toLowerCase().replace(/[^\p{L}]/gu, '') === low)) continue;
          let cut = '';
          for (let k = core.length - 2; k >= 5; k--) {
            const pre = low.slice(0, k), rest = low.slice(k);
            if (!words.has(pre) || rest.length > 8 || !/^\p{Script=Latin}+$/u.test(rest)) continue; // the remainder must be Latin letters only — a Latin word glued to Han ('randrange随机整数') is a bilingual title, not a slip
            if (/[^\x00-\x7F]/.test(rest) || !/[aeiouy]/.test(rest)) { cut = core.slice(0, k); break; }
          }
          if (cut) { this.store.audit('guard_title_glued_tail', { id: String(anyA.id ?? '').slice(0, 8), from: core, to: cut }); toks[i] = cut + tail; changed = true; }
        }
        if (changed) anyA.title = toks.join(' ').replace(/\s{2,}/g, ' ').trim();
      }
      // M327c (codex-native replays): the codex filer ends TITLES with a period; a title is a name.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && /[.。]+$/.test(anyA.title)) anyA.title = anyA.title.replace(/[.。]+$/, '');
      // M343 (codex-native pyomo replay): the codex filer wrote "exception type errorอบué?" over an English statement — stray
      // letters of a script (Thai here) that appear in neither the statement nor the person's words are a decoding slip, not a
      // name. Such a title is blanked for the healer. Latin is never judged here (the map's title language is a design question).
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.title === 'string' && anyA.title) {
        const seen = `${typeof anyA.content === 'string' ? anyA.content : (map.nodes.find((n) => n.id === anyA.id)?.content ?? '')}\n${params.userText ?? ''}`;
        const stray = SCRIPTS.filter(([, re]) => re.test(anyA.title) && !re.test(seen)).map(([name]) => name);
        if (stray.length) { this.store.audit('guard_title_script', { id: String(anyA.id ?? '').slice(0, 8), title: anyA.title.slice(0, 40), stray, kept: a.op === 'update_node' }); if (a.op === 'update_node') delete anyA.title; else anyA.title = ''; } // M359: on an update the node's existing title stays; only a new node is blanked for the healer
      }
      // M330 (perturbed imnodes replay): the filer wrote the status into the statement — "RETRACTED — The original evidence…".
      // The status is a field; a leading label in the text is meta. The label goes; if the op carries no status, the label becomes it.
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string') {
        const m = anyA.content.match(/^\s*\[?(retracted|superseded|rejected|corrected|withdrawn|decided|resolved|parked|dropped|obsolete|outdated)\]?\s*[—:\-–]\s+(?=\S)/i);
        if (m && anyA.content.length > m[0].length + 12) { const label = m[1].toLowerCase(); anyA.content = anyA.content.slice(m[0].length).replace(/^\p{Ll}/u, (ch: string) => ch.toUpperCase()); if (!anyA.status && ['retracted', 'superseded', 'rejected', 'withdrawn', 'decided', 'parked', 'dropped'].includes(label)) anyA.status = label; this.store.audit('guard_status_label', { id: String(anyA.id ?? '').slice(0, 8), label, status: anyA.status ?? '' }); }
      }
      if ((a.op === 'create_node' || a.op === 'update_node') && typeof anyA.content === 'string' && /\s+[.。]$/.test(anyA.content)) anyA.content = anyA.content.replace(/\s+([.。])$/, '$1'); // M452 (TWIN #430: "…reply and follow-up ." ×4): the filer's dangling space before the period
      if ((a.op === 'create_node' || a.op === 'update_node') && anyA.type && !CANON_TYPES.includes(anyA.type)) {
        this.store.audit('offlist_type', { type: anyA.type });
        anyA.type = 'claim'; // nearest-neutral; user retypes freely
      }
      // M338 (real categorization replay: the same exam question asked twice made a parent/child twin): a CREATE whose statement,
      // normalised, shares its first 60 characters with a live node anywhere on the map is a twin (no-twins rule) — dropped.
      if (a.op === 'create_node' && typeof anyA.content === 'string' && anyA.content.trim().length >= 40) {
        const normC = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        const mine = normC(anyA.content);
        const twin = map.nodes.find((n) => n.status !== 'removed' && n.author !== 'system' && n.content.length >= 40 && normC(n.content) === mine);
        if (twin) { this.store.audit('guard_create_twin', { id: String(anyA.id ?? '').slice(0, 8), twin: twin.id.slice(0, 8), content: anyA.content.slice(0, 60) }); if (anyA.id) dropSurvivor.set(String(anyA.id), twin.id); continue; }
      }
      // M363 (sqlsugar-rollback zh replay): the user re-pasted the original ask and the filer created "手动事务控制" beside the
      // existing "手动控制事务" — the same characters in another order. A CREATE whose title, as a sorted character multiset
      // (letters and digits only, ≥ 4 of them), equals a live SIBLING's title is a twin — dropped, like M338.
      if (a.op === 'create_node' && typeof anyA.title === 'string' && anyA.title.trim()) {
        const bag = (t: string) => [...t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')].sort().join('');
        const mine = bag(anyA.title);
        if (mine.length >= 4) {
          const parent = anyA.parentId ?? null;
          const twin = map.nodes.find((n) => n.status !== 'removed' && n.author !== 'system' && (n.parentId ?? null) === parent && typeof n.title === 'string' && n.title !== anyA.title && bag(n.title) === mine);
          if (twin) { this.store.audit('guard_create_twin', { id: String(anyA.id ?? '').slice(0, 8), twin: twin.id.slice(0, 8), title: anyA.title.slice(0, 40), of: String(twin.title).slice(0, 40), kind: 'title-anagram' }); if (anyA.id) dropSurvivor.set(String(anyA.id), twin.id); continue; }
        }
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
      if (a.op === 'update_node' && typeof anyA.content === 'string' && anyA.content.trim().length >= 8) { // M333b: a short statement copied exactly is a twin too ("Differential calculus" over its own seed)
        const normT = (t: string) => { const n = t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); return n.length >= 40 ? n.slice(0, 60) : n; };
        const me = map.nodes.find((n) => n.id === anyA.id);
        if (me) {
          const mine = normT(anyA.content);
          const kin = map.nodes.filter((n) => n.id !== me.id && n.status !== 'removed' && (n.id === me.parentId || n.parentId === me.id || (n.parentId === me.parentId && me.parentId)));
          const twin = kin.find((n) => { const k = normT(n.content); return k === mine && (mine.length >= 40 || k.length === mine.length); });
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
    {
      const surviving = new Set<string>(out.filter((x: any) => x?.op === 'create_node' && x.id).map((x: any) => String(x.id)));
      const dangling = (ref: unknown) => typeof ref === 'string' && createdInBatch.has(ref) && !surviving.has(ref) && !live.has(ref);
      const target = (ref: string): string | null => { const sv = dropSurvivor.get(ref); if (sv) return sv; const op = origParent.get(ref) ?? null; return op && (live.has(op) || surviving.has(op)) ? op : null; };
      const kept: any[] = [];
      for (const a of out) {
        const anyA = a as any; let drop = false;
        for (const k of ['parentId', 'fromItemId', 'toId', 'nodeId'] as const) {
          if (!dangling(anyA[k])) continue;
          const to = target(anyA[k]);
          if (to === null && (k === 'fromItemId' || k === 'toId' || k === 'nodeId' || anyA.op === 'move_node')) { drop = true; this.store.audit('guard_orphan_drop', { op: anyA.op, key: k, id: String(anyA.id ?? '').slice(0, 8), from: String(anyA[k]).slice(0, 8) }); break; }
          this.store.audit('guard_orphan_reparent', { op: anyA.op, key: k, id: String(anyA.id ?? '').slice(0, 8), from: String(anyA[k]).slice(0, 8), to: to ? to.slice(0, 8) : null });
          anyA[k] = to;
        }
        if (!drop && !((anyA.op === 'move_node' && anyA.id === anyA.parentId) || (anyA.op === 'create_link' && anyA.fromItemId === anyA.toId))) kept.push(a);
      }
      out.length = 0; out.push(...kept);
    }
    // M422 (PANEL #405 — twenty personas over the real 84-turn map; 19 of 20 named the first, 2 the second): two STATUS INVERSIONS the
    // display turns into the opposite of the conversation.
    // (a) "Same code again [accepted]": the person's objection ("you sent the same code as before") was filed as a claim with status
    //     accepted and an objection-to link. Whatever the filer meant by "accepted", beside an objection it reads as the person
    //     accepting what they rejected. The source of an objection-to link never carries accepted/chosen/done/decided — it is noted.
    {
      const BAD = new Set(['accepted', 'chosen', 'done', 'decided']);
      for (const l of out as any[]) {
        if (l?.op !== 'create_link' || l.type !== 'objection-to' || !l.fromItemId) continue;
        const own = (out as any[]).find((x) => (x?.op === 'create_node' || x?.op === 'update_node') && x.id === l.fromItemId && typeof x.status === 'string');
        if (own) { if (BAD.has(own.status)) { this.store.audit('guard_objection_status', { id: String(own.id).slice(0, 8), from: own.status }); own.status = 'noted'; } continue; }
        const cur = map.nodes.find((n) => n.id === l.fromItemId);
        if (cur && BAD.has(cur.status)) { this.store.audit('guard_objection_status', { id: String(cur.id).slice(0, 8), from: cur.status, existing: true }); out.push({ op: 'update_node', id: cur.id, status: 'noted' } as any); }
      }
    }
    // (b) "API Docs Unavailable [retracted]": a cited claim ("docs are at developers.quizizz.com") was UPDATED to its correction
    //     ("the URL no longer works") and retracted in the same alteration; the healer then titled the node after the correction, and
    //     the map said the unavailability was retracted. A retracting update that rewrites the content into a negation of the claim
    //     keeps the claim (retracted, as it was) and files the correction beside it, noted.
    {
      const NEG = /\b(?:no longer|not|n't|never|unavailable|broken|dead|invalid|wrong|incorrect|fails?|failed|does ?n[o']t|cannot|can't|isn't|aren't|wasn't|doesn't|didn't)\b|不再|无法|没有|不可用|失效|不存在|并非|不是|错误|无效/i;
      const extra: any[] = [];
      for (const a of out as any[]) {
        if (a?.op !== 'update_node' || a.status !== 'retracted' || typeof a.content !== 'string') continue;
        const cur = map.nodes.find((n) => n.id === a.id);
        if (!cur || cur.content.trim() === a.content.trim()) continue;
        if (!(NEG.test(a.content) && !NEG.test(cur.content))) continue; // a rewording keeps being an edit; only a NEGATION of the claim is a correction
        const correction = a.content; delete a.content; delete a.title;
        const sib: any = { op: 'create_node', id: randomUUID(), parentId: cur.parentId, content: correction, status: 'noted', author: a.author ?? cur.author ?? 'agent' };
        extra.push(sib, { op: 'create_link', id: randomUUID(), type: 'objection-to', fromItemId: sib.id, toId: cur.id });
        this.store.audit('guard_retract_keeps_claim', { id: String(cur.id).slice(0, 8), correction: sib.id.slice(0, 8) });
      }
      out.push(...extra);
    }
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
export function normalizeIds(alterations: Alteration[], map: MapView, audit?: (kind: string, detail: Record<string, unknown>) => void): Alteration[] {
  const known = new Map<string, string>();
  for (const n of map.nodes) known.set(n.id.slice(0, 8), n.id);
  const minted = new Map<string, string>();

  const createdOnce = new Set<string>();
  const resolve = (raw: string | null | undefined, creating: boolean): string | null => {
    if (raw === null || raw === undefined) return null;
    const id = String(raw).replace(/[\[\]]/g, '').trim();
    if (known.has(id)) return known.get(id)!;
    const full = [...known.values()].find((v) => v === id);
    if (full) return full;
    // M339 (real calculus replay): the model wrote a full-looking id whose first 8 characters were a real node's prefix and the rest
    // invented — the update was dropped as "unknown id". A longer id (or a differently-cased one) that starts with a known prefix
    // resolves to that node; the model sees prefixes, so the prefix is the reference.
    const lower = id.toLowerCase();
    if (lower.length >= 8 && !creating && known.has(lower.slice(0, 8))) { audit?.('id_prefix_resolved', { raw: id.slice(0, 40), to: known.get(lower.slice(0, 8))!.slice(0, 8) }); return known.get(lower.slice(0, 8))!; }
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

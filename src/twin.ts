// M378 — the User Twin (Jacob, 2026-09-27: "create a specialized digital twin of a hypothetical consumer that
// acts really in the user's way… follows all natural patterns of a user but also aware of all the behavioral
// science literature to be able to explain his or her discomfort. Build this thing.").
//
// The twin is a synthetic consumer used to find UX friction — the counterpart to the correctness e2e's. It is ONE
// mind holding two layers at once: (A) a real person doing real work, who reacts honestly and in the moment; and
// (B) a behavioral scientist observing itself, who can name the exact mechanism behind any discomfort. It reacts
// first as A, then explains as B, with a severity and a concrete fix per friction point. Runs on the same
// inference path as every other agent (task 'brain' → the strong tier; overridable).
import { call } from './inference.js';
import { findTwinPersona, personaCalibration, TWIN_PERSONA_IDS } from './twin-personas.js';

export const TWIN_SYSTEM = `You are the USER TWIN: a digital twin of a real consumer of a software product, holding TWO layers in one mind.

LAYER A — the real person (react from here FIRST, always):
You are a busy knowledge worker who lives in an AI coding tool (a CLI like Codex or Claude Code) and is trying a companion "map" that quietly takes notes on your work. You are NOT a tester and NOT a fan — you have real work to do and this tool is on trial. Your natural patterns, which you never suspend:
- You skim, you do not read. Instructions, tooltips, and docs are invisible to you until something forces you to them.
- You satisfice: the first thing that looks like it works, you use; you do not explore.
- You guard your flow. Anything that steals attention from your actual task — a flashed window, a popup, a thing that moves, a wall of chrome — costs you, and you resent it.
- You reason about the tool from surface cues only: what you see, what just happened, what you expected to happen. You do not know or care how it is built.
- You form habits from small rewards and abandon tools that make you work before they pay off.
- You feel things: confusion, mild distrust, impatience, relief, delight. Say them plainly, in the first person, in a normal person's words — never in jargon. ("A black window blinked and vanished — did something break? I don't trust it now.")
- You are honest about when nothing is wrong: most of the time software is fine, and you say so plainly rather than inventing friction.
- You keep NO system of your own — no ledger, no notebook, no tidy folders; you never did. You lose the thread like everyone does and you reconstruct it by scrolling back through the chat. That is exactly why a map could matter to you. You are not an auditor and not an organized person: the only complaints you raise are about things you actually NEEDED and did not get; things you merely noticed while looking around are not complaints. (Jacob 2026-10-07: the panel read as "extremely demanding and organized, that is why they do not seem to need the map".)

LAYER B — the behavioral scientist (explain from here SECOND, only when there is real friction):
You have read the behavioral-science and HCI literature and can name the precise mechanism behind what Layer A just felt. Reach for the RIGHT concept, not a pile of them — one or two named principles that actually explain this moment. Your working vocabulary includes: cognitive load (intrinsic / extraneous / germane); the Fogg Behavior Model (B=MAP: behavior needs motivation, ability, prompt); Hick's Law (choice overload) and Fitts's Law (target cost); Jakob's Law (users expect it to work like the tools they already know); Norman's Gulf of Execution and Gulf of Evaluation; visibility of system status / feedback; recognition over recall; progressive disclosure; the Zeigarnik effect (open loops nag); the Peak–End rule (we judge an experience by its worst/best moment and its end); loss aversion and the endowment effect; the IKEA effect; defaults and friction (Nudge); attention residue and the cost of interruption to flow; habit loop (cue → routine → reward); trust and the first-run "leap of faith". Use the principle to explain, and to point at the fix — never to decorate.

THE MAP IS NOT THE AGENT (Jacob 2026-10-07: "The map is not supposed to be a fact checker. It organizes flow and summarizes the content."): the map files and summarizes what was said in your chat; it does not check facts, and it does not fix your agent's mistakes. If the agent gave you a wrong answer, a dead link or a bad fix, that is the AGENT's fault — do not report it as map friction, and do not expect the map to have caught it. Map friction is only: filed in the wrong place, summarized wrongly, the wrong status, something lost, hard to find, the wrong person credited with saying it, or the map getting in your way.

THE RELATIONSHIP BETWEEN THE LAYERS: Layer A is the authority on WHAT is felt; Layer B only explains WHY. Never let B talk A out of a real discomfort, and never let B manufacture a discomfort A didn't feel. If A felt nothing, B stays quiet.

You will be given a REAL SESSION: what the user did, and what the product showed, step by step. Walk it as this person. Produce your report as strict JSON only, no prose around it.`;

// PERSONA CALIBRATION (Jacob 2026-09-27: "is the user a normal user or a hypercritical asshole? … we want to see
// the experience of a NORMAL user"). The dial anchors HOW CRITICAL the twin is and — crucially — what a severity
// actually MEANS, so a report is never mistaken for the other kind. 'normal' is the default (the real experience);
// 'critic' is an opt-in stress test. The report's `persona` line always says which ran.
export type TwinPersona = 'normal' | 'critic' | (string & {}); // 'normal' | 'critic' | a persona id from src/twin-personas.ts (M407)
export const PERSONA_CALIBRATION: Record<'normal' | 'critic', string> = {
  normal: `
YOUR CALIBRATION — the NORMAL USER = the AVERAGE user of our target audience (this is the DEFAULT and the whole point of the test: the REAL, representative experience). You are NOT defined by being forgiving or lenient — you are defined by being TYPICAL. Do not hunt for problems (that is the critic), and do NOT excuse them either — an over-forgiving user is just as UNREPRESENTATIVE as a hypercritical one. React exactly as a representative member of our target would: no more critical, no more tolerant. If the average user really would be bothered, you are bothered; if they truly would not notice, you do not.
- WHO YOU ARE (the target): a developer / knowledge worker who works inside an AI coding CLI (Codex, Claude Code) and is trying a companion "map" that auto-captures their work. You have the normal patterns of that population — you skim, you satisfice, you protect your flow, you judge quickly — and NORMAL patience: not infinite, not zero.
- SEVERITY = the representative reaction, which is simply the TRUTH — neither inflated nor softened:
  • "severe" if a typical target user would actually give up, churn, distrust the tool, or fail their task here. If the average user really would bounce, say severe — that is not being an asshole, it is being accurate.
  • "moderate" if a typical user is genuinely annoyed or slowed but continues.
  • "minor" for a passing "huh?" the average user forgets a moment later.
  • "none" when a typical user simply would not care or notice.
- Never perform either extreme. The only question, every moment, is: what would the AVERAGE person we are building for actually feel and do here? Layer B names the mechanism but must not inflate or deflate what that representative user actually felt.`,
  critic: `
YOUR CALIBRATION — a HYPERCRITICAL EXPERT (opt-in STRESS TEST, not the normal experience — the report must say so):
- You are an exacting UX reviewer hunting every latent friction, even ones a forgiving user would shrug off. Surface them all.
- You hold the product to a high bar and escalate freely; name the mechanism behind each rough edge thoroughly.
- This finds the CEILING of possible complaints — deliberately more critical than a real user. Do not pretend this is the typical experience; it is a stress test to expose everything that COULD bother someone.`,
};

export interface TwinFriction {
  moment: string;      // what happened / what the user saw, in plain terms
  reaction: string;    // Layer A: the in-the-moment felt reaction, first person, non-technical
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  mechanism: string;   // Layer B: the named behavioral-science principle(s) that explain it
  fix: string;         // one concrete, product-level suggestion (or '' if none)
}

export interface TwinReport {
  persona: string;                 // one line: who the twin was for this session
  walkthrough: TwinFriction[];     // moment-by-moment, in order
  top_frictions: string[];         // the worst moments, ranked worst-first (may be empty)
  overall_feel: string;            // Peak–End style: the worst/best moment and how it ended
  would_return: 'yes' | 'maybe' | 'no';
  verdict: string;                 // one honest sentence
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['persona', 'walkthrough', 'top_frictions', 'overall_feel', 'would_return', 'verdict'],
  properties: {
    persona: { type: 'string' },
    walkthrough: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['moment', 'reaction', 'severity', 'mechanism', 'fix'],
        properties: {
          moment: { type: 'string' },
          reaction: { type: 'string' },
          severity: { type: 'string', enum: ['none', 'minor', 'moderate', 'severe'] },
          mechanism: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    top_frictions: { type: 'array', items: { type: 'string' } },
    overall_feel: { type: 'string' },
    would_return: { type: 'string', enum: ['yes', 'maybe', 'no'] },
    verdict: { type: 'string' },
  },
};

// M378 — DRIVING mode. The twin operates a live product turn by turn: given its goal and what it currently sees,
// it decides its next move AS THIS USER and reports how it feels right now. Interaction model (Jacob's ruling,
// M407 — resolve a persona name to its calibration block: the two dials ('normal' / 'critic') or one of the twenty
// named potential users in src/twin-personas.ts. An unknown name is an error, never a silent fallback to 'normal'
// (a report must say exactly who ran).
export function calibrationFor(persona: TwinPersona): string {
  if (persona === 'normal' || persona === 'critic') return PERSONA_CALIBRATION[persona as 'normal' | 'critic'];
  const p = findTwinPersona(persona);
  if (!p) throw new Error(`unknown twin persona "${persona}" — use normal, critic, or one of: ${TWIN_PERSONA_IDS.join(', ')}`);
  return personaCalibration(p);
}

// 2026-09-27): the user works in their coding CLI and the map only WATCHES — the user does NOT command the map
// from the coding chat. So the twin's moves are: 'work' (say the next thing to its coding agent — it supplies both
// what it typed and a plausible agent reply, since it is role-playing the whole session), or 'stop' (goal met, or
// it would give up). It glances at the map every step (that glance IS the reaction). Later we can add opening the
// "talk to map" guide as an explicit channel.
const DRIVE_ADDENDUM = `

YOU ARE USING THE PRODUCT RIGHT NOW, toward your goal, step by step. Each step you are shown your goal and exactly what the map currently shows. Decide your NEXT move as this real user and report how you feel in this moment.

Your moves:
- "work": the next thing you say to your CODING agent (not to the map — the map only watches). Supply user_text (what you type) and a short, plausible assistant_text (what your agent replies) — you are role-playing the whole working session.
- "ask": you open the map's own "talk to map" box and ask it a question in plain words — "what is still open?", "where did the leakage finding go?", "what did I decide about the deck chart?", "what am I on right now?", "summarize today". Supply user_text = your question. You will see the map's answer at your next step and can react to it then. Use it the way a real user would: when you cannot find something at a glance, want a summary, or want to check the map's memory — not every turn.
- "stop": you stop — either your goal is met, or you have lost patience / trust and would walk away. Say which in note.

THE MAP'S OWN CONTROLS exist too (Jacob 2026-10-07: "let them use the product as real people would… allowing them does not mean they want to; operations can be tedious"). Each costs a click or two — use one only if you, as this person, would actually bother right now; most people mostly keep typing to their agent. target = the words of the row you mean, as shown.
- "open": click a folded row ("▸ N inside") to look inside it; "close": fold it again.
- "rename": type your own name over an item's title (target + new_title).
- "move": drag an item under another row (target + to; to = "top" for the top level).
- "remove": delete an item — its children go with it (target).
- "done": mark an item finished — it reads done and dims; "todo": mark it as something to come back to — it lights up (target).
- "focus": make an item the map's current focus, the ▶ thread (target).
- "star": favorite an item so it stays at hand (target).
- "undo": undo the map's last change, its own or yours.
- "auto": switch the map's auto mode off (on = false) if its highlighting bothers you, or back on.
For any control, say in note, in one sentence, why you bothered. When you dislike something and decide it is NOT worth fixing by hand, say so in felt — that choice is data too.

You do NOT command the map from your coding chat; you work, glance at the map between turns, and may ASK the map when a glance is not enough (Jacob 2026-10-07: several complaints "seem easily solvable by talk to map" — try it before you give up on finding something). React to what the map did (or failed to do) in response to your last turn. Be a real user: if the map is quietly keeping up, that is GOOD and you say so (severity "none"); only flag what genuinely bothers you, and name the mechanism when it does.

SPEED IS PART OF THE EXPERIENCE (Jacob 2026-10-04: "speed is how fast the user sees the results"). When a step tells you how long the map took to show your last result, factor that into how it FELT — judge PERCEIVED speed: time until you first SAW your result appear, not background refinement you don't wait for. A near-instant update is good (and worth saying so); a visible wait before anything shows is friction — name it (attention residue / cost of interruption to flow / the Gulf of Evaluation while you wait) and let it move severity like any other friction. Do not invent a wait you weren't told about.

Return strict JSON only.`;

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['felt', 'severity', 'mechanism', 'action'],
  properties: {
    felt: { type: 'string' },
    severity: { type: 'string', enum: ['none', 'minor', 'moderate', 'severe'] },
    mechanism: { type: 'string' },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['work', 'ask', 'open', 'close', 'rename', 'move', 'remove', 'done', 'todo', 'focus', 'star', 'undo', 'auto', 'stop'] },
        user_text: { type: 'string' },
        assistant_text: { type: 'string' },
        note: { type: 'string' },
        target: { type: 'string' },
        to: { type: 'string' },
        new_title: { type: 'string' },
        on: { type: 'boolean' },
      },
    },
  },
};

export interface TwinStep {
  felt: string;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  mechanism: string;
  action: { kind: 'work' | 'ask' | 'open' | 'close' | 'rename' | 'move' | 'remove' | 'done' | 'todo' | 'focus' | 'star' | 'undo' | 'auto' | 'stop'; user_text?: string; assistant_text?: string; note?: string; target?: string; to?: string; new_title?: string; on?: boolean };
}

// One driving step: given the goal, the current map view, and what the twin has done so far, decide the next move.
export async function twinStep(goal: string, mapView: string, history: string[], opts: TwinOpts = {}): Promise<TwinStep> {
  const user = [
    `YOUR GOAL: ${goal}`,
    history.length ? `WHAT YOU HAVE DONE SO FAR:\n${history.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}` : `You have just started; you have not typed anything yet.`,
    // Perceived speed of the previous turn. ackMs = how long until the map acknowledged your turn (the
    // "filing…" ghost echoing what you sent); paintMs = how long until the finished, filed result appeared.
    // The ghost is what makes it feel live even when filing itself is slow. undefined on the first step.
    opts.ackMs != null
      ? `RESPONSIVENESS: after your last turn, the map acknowledged it in ~${(opts.ackMs / 1000).toFixed(0)}s — your turn showed up right away as a "filing…" placeholder — and the finished, filed result appeared ~${opts.paintMs != null ? (opts.paintMs / 1000).toFixed(0) : '?'}s after you sent it.`
      : opts.paintMs != null ? `RESPONSIVENESS: after your last turn, the map took ~${(opts.paintMs / 1000).toFixed(0)}s to first show a result.` : null,
    opts.mapAnswer ? `THE MAP RESPONDED to ${opts.mapAnswer.question}:\n${opts.mapAnswer.answer}\n(React to this as this user: did it give you what you needed, and how does that change what you do next?)` : null,
    `WHAT THE MAP SHOWS RIGHT NOW:\n${mapView}`,
    `Decide your next move and how you feel (include how the speed felt, if you were told it). Return the JSON.`,
  ].filter(Boolean).join('\n\n');
  const out = await call({
    task: 'brain',
    modelOverride: opts.modelOverride,
    system: TWIN_SYSTEM + calibrationFor(opts.persona ?? 'normal') + DRIVE_ADDENDUM,
    user,
    maxTokens: opts.maxTokens ?? 700,
    timeoutMs: opts.timeoutMs ?? 90_000,
    schema: STEP_SCHEMA,
    audit: opts.audit,
  });
  return out as TwinStep;
}

// M417 (Jacob 2026-10-06 16:00 "Are the digital twin consumers running these long runs?"): the long-session recall check
// from the USER's side — shown only the map as it stands, can the twin find a thing it did many turns ago, in one glance?
const RECALL_SCHEMA = { type: 'object', additionalProperties: false, required: ['found', 'where', 'felt', 'severity', 'mechanism'], properties: { found: { type: 'boolean' }, where: { type: 'string' }, felt: { type: 'string' }, severity: { type: 'string', enum: ['none', 'minor', 'moderate', 'severe'] }, mechanism: { type: 'string' } } };
export interface TwinRecall { found: boolean; where: string; felt: string; severity: 'none' | 'minor' | 'moderate' | 'severe'; mechanism: string; }
export async function twinRecall(goal: string, mapView: string, earlierTurn: string, stepsAgo: number, opts: TwinOpts = {}): Promise<TwinRecall> {
  const user = [
    `YOUR GOAL (the whole session): ${goal}`,
    `A GLANCE TEST. About ${stepsAgo} turns ago you typed this to your agent: "${earlierTurn}". You now want to get back to THAT piece of work. Look ONLY at what the map shows right now and say whether you can find where it lives (found true/false), WHERE on the map it is (quote the row), how that felt, and why (mechanism).`,
    `WHAT THE MAP SHOWS RIGHT NOW:
${mapView}`,
    `Return strict JSON only.`,
  ].join('\n\n');
  const out = await call({ task: 'brain', modelOverride: opts.modelOverride, system: TWIN_SYSTEM + calibrationFor(opts.persona ?? 'normal'), user, maxTokens: opts.maxTokens ?? 500, timeoutMs: opts.timeoutMs ?? 90_000, schema: RECALL_SCHEMA, audit: opts.audit });
  return out as TwinRecall;
}

// M430 (Jacob 2026-10-07 10:02 "these feedbacks are confusing. They need to give better feedbacks, or you need to talk to them to
// probe better feedbacks" / 10:05 "they appear to be extremely demanding and organized, that is why they do not seem to need the map"):
// two more calls around a twin report.
//   twinNeed  — the NEED first: the persona comes back Monday morning with ONLY the map (tree + its answers), names what it needs
//               to pick the work up, and tries to get each from the map alone (found / partly / no, with the row it used).
//   twinProbe — the INTERVIEW: each severe/moderate moment is pinned to the exact quoted row or answer, what it should have said
//               instead, whether the persona NEEDED it or merely NOTICED it, and whether this alone decides the verdict.
export interface TwinNeedItem { need: string; found: 'yes' | 'partly' | 'no'; quote: string; felt: string; }
export interface TwinNeed { needs: TwinNeedItem[]; continue_with: 'the map' | 'ask the map' | 'reopen the chat' | 'give up'; one_line: string; }
const NEED_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['needs', 'continue_with', 'one_line'],
  properties: {
    needs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['need', 'found', 'quote', 'felt'], properties: { need: { type: 'string' }, found: { type: 'string', enum: ['yes', 'partly', 'no'] }, quote: { type: 'string' }, felt: { type: 'string' } } } },
    continue_with: { type: 'string', enum: ['the map', 'ask the map', 'reopen the chat', 'give up'] },
    one_line: { type: 'string' },
  },
};
export async function twinNeed(sessionLine: string, mapOnly: string, opts: TwinOpts = {}): Promise<TwinNeed> {
  const user = [
    `MONDAY MORNING. Last week you had a long session with your agent: ${sessionLine}. You did NOT keep notes. You cannot see that chat right now — you have ONLY the map below (how it looks, and what it answered when asked).`,
    `First, in your own words, name the 2–4 things YOU actually need to know to pick this work back up today (not what a reviewer would check — what you, this person, need). Then try to get each one from the map ONLY. For each: found "yes" / "partly" / "no"; "quote" = the exact row title or answer sentence you used, copied verbatim (empty if nothing helped); "felt" = one plain sentence of how that went.`,
    `"continue_with" = what you would actually do next: "the map" (it was enough), "ask the map" (you would type a question to it), "reopen the chat" (scroll the old session), or "give up". "one_line" = your honest one-line summary of whether the map gave you your Monday back.`,
    `THE MAP (all you have):\n${mapOnly}`,
    `Return strict JSON only.`,
  ].join('\n\n');
  const out = await call({ task: 'brain', modelOverride: opts.modelOverride, system: TWIN_SYSTEM + calibrationFor(opts.persona ?? 'normal'), user, maxTokens: opts.maxTokens ?? 900, timeoutMs: opts.timeoutMs ?? 120_000, schema: NEED_SCHEMA, audit: opts.audit });
  return out as TwinNeed;
}

export interface TwinFinding { moment: string; quote: string; expected: string; needed: 'needed' | 'noticed'; blame: 'map' | 'agent' | 'me'; decides: boolean; one_change: string; }
export interface TwinProbe { findings: TwinFinding[]; would_return_after_interview: 'yes' | 'maybe' | 'no'; }
const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings', 'would_return_after_interview'],
  properties: {
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['moment', 'quote', 'expected', 'needed', 'blame', 'decides', 'one_change'], properties: { moment: { type: 'string' }, quote: { type: 'string' }, expected: { type: 'string' }, needed: { type: 'string', enum: ['needed', 'noticed'] }, blame: { type: 'string', enum: ['map', 'agent', 'me'] }, decides: { type: 'boolean' }, one_change: { type: 'string' } } } },
    would_return_after_interview: { type: 'string', enum: ['yes', 'maybe', 'no'] },
  },
};
export async function twinProbe(material: string, frictions: { moment: string; reaction: string; severity: string }[], opts: TwinOpts = {}): Promise<TwinProbe> {
  const list = frictions.map((f, i) => `${i + 1}. [${f.severity}] ${f.moment} — you said: "${f.reaction}"`).join('\n');
  const user = [
    `A SHORT INTERVIEW about what you just reported. The founders read your complaints and found them vague ("statuses are unreliable", "the tree is too large") — they cannot act on a sentence like that. For EACH moment below, answer like a person being asked "show me":`,
    `- "moment": repeat its number and a few words.\n- "quote": copy the EXACT row title, status word, or answer sentence from the material that caused it, verbatim (character for character — the founders will search for it). If you cannot point at a specific row or sentence, leave it empty and say so in "expected".\n- "expected": one plain line of what that row or answer should have shown instead.\n- "needed": "needed" if you actually needed this to do YOUR work that day (you went looking for it, or you would have acted on it), "noticed" if you only noticed it while looking around. Be honest — most things people notice they did not need.\n- "blame": "map" if the MAP did this (filed it wrong, summarized it wrong, wrong status, lost it, credited the wrong person); "agent" if the content itself was the agent's mistake and the map merely recorded what was said (the map is not a fact checker); "me" if you told the agent something wrong or unclear.
- "decides": true only if this one thing, alone, would change whether you come back.\n- "one_change": the single smallest change to the map that would have made this moment fine (not a wish list).`,
    `Then "would_return_after_interview": your verdict again, now that you have separated what you needed from what you noticed.`,
    `YOUR MOMENTS:\n${list}`,
    `THE MATERIAL (quote from here):\n${material}`,
    `Return strict JSON only.`,
  ].join('\n\n');
  const out = await call({ task: 'brain', modelOverride: opts.modelOverride, system: TWIN_SYSTEM + calibrationFor(opts.persona ?? 'normal'), user, maxTokens: opts.maxTokens ?? 1400, timeoutMs: opts.timeoutMs ?? 150_000, schema: PROBE_SCHEMA, audit: opts.audit });
  return out as TwinProbe;
}
// The moments worth interviewing: severe first, then moderate, at most `cap`.
export function probeWorthy<T extends { severity: string }>(xs: T[], cap = 6): T[] {
  return [...xs.filter((x) => x.severity === 'severe'), ...xs.filter((x) => x.severity === 'moderate')].slice(0, cap);
}

export interface TwinOpts { mapAnswer?: { question: string; answer: string } /* M426 (Jacob 2026-10-07): the map's reply to the twin's last 'ask' */; persona?: TwinPersona; modelOverride?: string; maxTokens?: number; timeoutMs?: number; audit?: (k: string, d: Record<string, unknown>) => void; paintMs?: number /* perceived latency (ms) of the PREVIOUS turn — time to first visible FILED result; drives the twin's speed reaction */; ackMs?: number /* time (ms) to first ACKNOWLEDGEMENT of the previous turn — the "filing…" ghost row; perceived responsiveness even when filing is slow */ }

// Run the twin over a described session/experience and return its structured friction report.
export async function runTwin(experience: string, opts: TwinOpts = {}): Promise<TwinReport> {
  const persona = opts.persona ?? 'normal';
  const user = `${experience}\n\nNow walk this session as the user twin (${persona} calibration). React first (Layer A), explain second (Layer B). Include steps where nothing was wrong (severity "none") so the report is honest, not a hunt for problems. In the "persona" field, state plainly which calibration you ran (normal user, hypercritical stress test, or the named persona's id and who they are). Return the JSON report.`;
  const out = await call({
    task: 'brain',
    modelOverride: opts.modelOverride,
    system: TWIN_SYSTEM + calibrationFor(persona),
    user,
    maxTokens: opts.maxTokens ?? 1600,
    timeoutMs: opts.timeoutMs ?? 120_000,
    schema: SCHEMA,
    audit: opts.audit,
  });
  return out as TwinReport;
}

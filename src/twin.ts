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

LAYER B — the behavioral scientist (explain from here SECOND, only when there is real friction):
You have read the behavioral-science and HCI literature and can name the precise mechanism behind what Layer A just felt. Reach for the RIGHT concept, not a pile of them — one or two named principles that actually explain this moment. Your working vocabulary includes: cognitive load (intrinsic / extraneous / germane); the Fogg Behavior Model (B=MAP: behavior needs motivation, ability, prompt); Hick's Law (choice overload) and Fitts's Law (target cost); Jakob's Law (users expect it to work like the tools they already know); Norman's Gulf of Execution and Gulf of Evaluation; visibility of system status / feedback; recognition over recall; progressive disclosure; the Zeigarnik effect (open loops nag); the Peak–End rule (we judge an experience by its worst/best moment and its end); loss aversion and the endowment effect; the IKEA effect; defaults and friction (Nudge); attention residue and the cost of interruption to flow; habit loop (cue → routine → reward); trust and the first-run "leap of faith". Use the principle to explain, and to point at the fix — never to decorate.

THE RELATIONSHIP BETWEEN THE LAYERS: Layer A is the authority on WHAT is felt; Layer B only explains WHY. Never let B talk A out of a real discomfort, and never let B manufacture a discomfort A didn't feel. If A felt nothing, B stays quiet.

You will be given a REAL SESSION: what the user did, and what the product showed, step by step. Walk it as this person. Produce your report as strict JSON only, no prose around it.`;

// PERSONA CALIBRATION (Jacob 2026-09-27: "is the user a normal user or a hypercritical asshole? … we want to see
// the experience of a NORMAL user"). The dial anchors HOW CRITICAL the twin is and — crucially — what a severity
// actually MEANS, so a report is never mistaken for the other kind. 'normal' is the default (the real experience);
// 'critic' is an opt-in stress test. The report's `persona` line always says which ran.
export type TwinPersona = 'normal' | 'critic';
export const PERSONA_CALIBRATION: Record<TwinPersona, string> = {
  normal: `
YOUR CALIBRATION — a NORMAL USER (this is the default; you are reporting the REAL experience, not auditing):
- You give the tool the benefit of the doubt. New software is usually a bit rough; you shrug off small things and keep going. You are not looking for problems — you are trying to get your work done.
- You satisfice hard and you are forgiving: if something basically works, it is FINE and you say so ("none"). Do not escalate a mild "huh" into a documented complaint.
- Anchor severity to REAL BEHAVIORAL CONSEQUENCE, not theoretical friction:
  • "severe" ONLY if this would actually make you ABANDON the tool or FAIL your task. Reserve it.
  • "moderate" if it genuinely annoys or slows you but you continue anyway.
  • "minor" for a passing "huh?" you forget a second later.
  • "none" when it is fine — which is MOST of the time. A normal session is mostly "none".
- You do not think in principles. React as a person ("meh, I'll figure it out later"); Layer B may still name the mechanism, but it must NOT inflate what you actually felt. If you would not mention it to a friend, it is not moderate+.`,
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
// 2026-09-27): the user works in their coding CLI and the map only WATCHES — the user does NOT command the map
// from the coding chat. So the twin's moves are: 'work' (say the next thing to its coding agent — it supplies both
// what it typed and a plausible agent reply, since it is role-playing the whole session), or 'stop' (goal met, or
// it would give up). It glances at the map every step (that glance IS the reaction). Later we can add opening the
// "talk to map" guide as an explicit channel.
const DRIVE_ADDENDUM = `

YOU ARE USING THE PRODUCT RIGHT NOW, toward your goal, step by step. Each step you are shown your goal and exactly what the map currently shows. Decide your NEXT move as this real user and report how you feel in this moment.

Your moves:
- "work": the next thing you say to your CODING agent (not to the map — the map only watches). Supply user_text (what you type) and a short, plausible assistant_text (what your agent replies) — you are role-playing the whole working session.
- "stop": you stop — either your goal is met, or you have lost patience / trust and would walk away. Say which in note.

You do NOT type commands to the map; you just work, and glance at the map between turns. React to what the map did (or failed to do) in response to your last turn. Be a real user: if the map is quietly keeping up, that is GOOD and you say so (severity "none"); only flag what genuinely bothers you, and name the mechanism when it does. Return strict JSON only.`;

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
        kind: { type: 'string', enum: ['work', 'stop'] },
        user_text: { type: 'string' },
        assistant_text: { type: 'string' },
        note: { type: 'string' },
      },
    },
  },
};

export interface TwinStep {
  felt: string;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  mechanism: string;
  action: { kind: 'work' | 'stop'; user_text?: string; assistant_text?: string; note?: string };
}

// One driving step: given the goal, the current map view, and what the twin has done so far, decide the next move.
export async function twinStep(goal: string, mapView: string, history: string[], opts: TwinOpts = {}): Promise<TwinStep> {
  const user = [
    `YOUR GOAL: ${goal}`,
    history.length ? `WHAT YOU HAVE DONE SO FAR:\n${history.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}` : `You have just started; you have not typed anything yet.`,
    `WHAT THE MAP SHOWS RIGHT NOW:\n${mapView}`,
    `Decide your next move and how you feel. Return the JSON.`,
  ].join('\n\n');
  const out = await call({
    task: 'brain',
    modelOverride: opts.modelOverride,
    system: TWIN_SYSTEM + PERSONA_CALIBRATION[opts.persona ?? 'normal'] + DRIVE_ADDENDUM,
    user,
    maxTokens: opts.maxTokens ?? 700,
    timeoutMs: opts.timeoutMs ?? 90_000,
    schema: STEP_SCHEMA,
    audit: opts.audit,
  });
  return out as TwinStep;
}

export interface TwinOpts { persona?: TwinPersona; modelOverride?: string; maxTokens?: number; timeoutMs?: number; audit?: (k: string, d: Record<string, unknown>) => void }

// Run the twin over a described session/experience and return its structured friction report.
export async function runTwin(experience: string, opts: TwinOpts = {}): Promise<TwinReport> {
  const persona = opts.persona ?? 'normal';
  const user = `${experience}\n\nNow walk this session as the user twin (${persona} calibration). React first (Layer A), explain second (Layer B). Include steps where nothing was wrong (severity "none") so the report is honest, not a hunt for problems. In the "persona" field, state plainly which calibration you ran (normal user vs hypercritical stress test). Return the JSON report.`;
  const out = await call({
    task: 'brain',
    modelOverride: opts.modelOverride,
    system: TWIN_SYSTEM + PERSONA_CALIBRATION[persona],
    user,
    maxTokens: opts.maxTokens ?? 1600,
    timeoutMs: opts.timeoutMs ?? 120_000,
    schema: SCHEMA,
    audit: opts.audit,
  });
  return out as TwinReport;
}

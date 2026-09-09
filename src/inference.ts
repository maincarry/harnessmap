// M63: one door for every model call the map makes.
//
// Backends:
//  - 'subscription' (DEFAULT, Mark's D2 ruling): the Claude Agent SDK with
//    tools off and one turn — inherits whatever auth Claude Code has
//    (subscription OAuth or key). No enforced JSON schema → strict-JSON
//    prompting + parse + one retry with the error fed back.
//  - 'api': direct Anthropic SDK with output_config json_schema (strongest
//    enforcement). Opt-in via HARNESSMAP_INFERENCE=api; requires a key.
//
// Model tiering (Mark's D3): cheap fast model for per-round work, a better
// model for the heavy, user-invoked restructuring jobs.

import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

export type Task =
  | 'filer' | 'memory' | 'relations' | 'title' | 'summary' | 'autolit' | 'recommend' | 'place' | 'mapchat'
  | 'tidy' | 'mapcheck' | 'import' | 'brain' | 'chat';

// M185 (Mark got billed): the M103 promise — the subscription path NEVER
// bills an API key — was enforced only at the specialist spawn site, while
// the built-in chat SDK session and embedded terminals inherited the full
// env (and bun auto-loads .env, so a repo-local key rode along invisibly).
// Mechanical fix at the choke point: unless the user EXPLICITLY chose the
// api backend, the key is scrubbed from this process at import time — every
// child (SDK chat, terminals, specialists) inherits a keyless env. The api
// backend keeps working from the stashed copy.
const STASHED_API_KEY = process.env.ANTHROPIC_API_KEY;
if (process.env.HARNESSMAP_INFERENCE !== 'api') {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn('⚠  ANTHROPIC_API_KEY found in the environment, but harnessmap runs on your Claude subscription — the key has been scrubbed and will NOT be billed. If you INTEND to bill the API, set HARNESSMAP_INFERENCE=api explicitly.');
  }
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
} else {
  console.warn('⚠  HARNESSMAP_INFERENCE=api — model calls will bill ANTHROPIC_API_KEY, not your subscription.');
}

const CHEAP = process.env.HARNESSMAP_TRANSLATOR_MODEL ?? 'claude-haiku-4-5';
const SMART = process.env.HARNESSMAP_SMART_MODEL ?? 'claude-sonnet-4-6';
// M142 (Jacob): import is the first-impression reorganization — it gets the
// fancy model. Overridable (tests pin a cheap one).
const FANCY = process.env.HARNESSMAP_IMPORT_MODEL ?? 'claude-opus-4-8';
// M220: the same three tiers on the codex backend (OpenAI ids; overridable —
// verified per machine, the ⚙ models page shows what answers).
// gpt-5.4-mini retired from Codex with ChatGPT sign-in on 2026-08-31 (Mark's Windows run hit the 400); luna is the 5.6 budget tier
const CODEX_CHEAP = process.env.HARNESSMAP_CODEX_CHEAP ?? 'gpt-5.6-luna';
const CODEX_SMART = process.env.HARNESSMAP_CODEX_SMART ?? 'gpt-5.6-terra';
const CODEX_FANCY = process.env.HARNESSMAP_CODEX_FANCY ?? 'gpt-5.6-sol';
// M217 (Mark, 2026-09-08): one model per ROLE, chosen by the user in ⚙ models
// (settings `model:<task>`) over these defaults. The catalog below is what
// the settings page shows; the resolver is installed by the server.
export type Tier = 'cheap' | 'smart' | 'fancy';
export type RoleGroup = 'per-turn' | 'brain' | 'on-demand' | 'helper';
export interface RoleInfo { task: Task; label: string; what: string; tier: Tier; perTurn: boolean; group: RoleGroup }
export const ROLE_GROUPS: { id: RoleGroup; label: string; what: string }[] = [
  { id: 'per-turn', label: 'the per-turn agent', what: 'runs on every exchange without being asked — files the round, keeps memory and the summary current, re-aims focus and light (in product mode). Its model sets the running cost.' },
  { id: 'brain', label: 'the brain', what: 'oversees the map in the background — measures it, reviews its structure, assesses every area, writes the overall report; proposes reorganizations (tidy is its hands, you approve)' },
  { id: 'on-demand', label: 'on demand', what: 'runs when you act — talk to the map, import a source' },
  { id: 'helper', label: 'helpers', what: 'small utilities: names, fit, homes for to-sort items, focus nudges' },
];
export const ROLES: RoleInfo[] = [
  { task: 'filer', label: 'filer', what: 'files each exchange onto the map — every turn, the only writer that acts without approval (within the lit scope); import chunks file on this tier too', tier: 'cheap', perTurn: true, group: 'per-turn' },
  { task: 'memory', label: 'memory agent', what: "writes and updates node memory (the organs), the taste digest, merge memories", tier: 'cheap', perTurn: true, group: 'per-turn' },
  { task: 'summary', label: 'rolling summary', what: "the running conversation summary the chat agent's block carries", tier: 'cheap', perTurn: true, group: 'per-turn' },
  { task: 'autolit', label: 'lighting and focus agents', what: 'propose focus and light for approval; under re-aim they run before every question', tier: 'cheap', perTurn: true, group: 'per-turn' },
  { task: 'recommend', label: 'recommendation agent', what: 'the red-dot focus suggestions', tier: 'cheap', perTurn: false, group: 'helper' },
  { task: 'place', label: 'placement agent', what: 'suggests homes for "to sort" items', tier: 'cheap', perTurn: false, group: 'helper' },
  { task: 'relations', label: 'fit writer', what: 'how a node fits its surroundings (the fit organ)', tier: 'cheap', perTurn: false, group: 'helper' },
  { task: 'title', label: 'naming agent', what: 'short display names', tier: 'cheap', perTurn: false, group: 'helper' },
  { task: 'chat', label: 'chat pane', what: "the conversation partner in the map's own chat pane (not your Claude Code or Codex session)", tier: 'smart', perTurn: false, group: 'on-demand' },
  { task: 'mapchat', label: 'map guide (talk to map)', what: 'answers your questions about the map and drafts proposals; interactive, a few calls a day', tier: 'smart', perTurn: false, group: 'on-demand' },
  { task: 'tidy', label: 'tidy agent', what: 'restructures a subtree — a proposal you approve', tier: 'smart', perTurn: false, group: 'brain' },
  { task: 'mapcheck', label: "the brain's reporters", what: 'the structural review and the per-area assessments', tier: 'smart', perTurn: false, group: 'brain' },
  { task: 'brain', label: 'the brain (overall report)', what: 'the overall map status report, import verification, the history report', tier: 'fancy', perTurn: false, group: 'brain' },
  { task: 'import', label: 'import agent', what: 'the source summary and the finish pass of an import (chunks file on the filer tier)', tier: 'fancy', perTurn: false, group: 'on-demand' },
];
const CLAUDE_CATALOG: { id: string; note: string }[] = [
  { id: 'claude-haiku-4-5', note: 'fastest, cheapest' },
  { id: 'claude-sonnet-4-6', note: 'the balanced default of the 4.x line' },
  { id: 'claude-sonnet-5', note: 'balanced, newer' },
  { id: 'claude-opus-4-8', note: 'strongest of the 4.x line' },
  { id: 'claude-opus-5', note: 'strongest, newer' },
  { id: 'claude-fable-5-1', note: 'most capable available' },
];
const CODEX_CATALOG: { id: string; note: string }[] = [
  { id: 'gpt-5.6-luna', note: 'most cost-efficient of the 5.6 line' },
  { id: 'gpt-5.6-terra', note: 'balanced, everyday work' },
  { id: 'gpt-5.6-sol', note: 'flagship' },
];
export const MODEL_CATALOG: { id: string; note: string }[] = new Proxy([] as any, { get: (_t, k) => (backendName() === 'codex' ? CODEX_CATALOG : CLAUDE_CATALOG)[k as any] }) as any;
export function modelCatalog(): { id: string; note: string }[] { return backendName() === 'codex' ? CODEX_CATALOG : CLAUDE_CATALOG; }
// M225 (Jacob: "do we have a cost monitoring function?"): list prices per
// million tokens, input / output, for the rough dollar figure the cost page
// shows. approxTokens is chars/4 of the prompt (M184); output is assumed at
// 8% of input. On the subscription and codex backends the plan pays, not
// dollars — the figure is what the same calls would cost on the API.
export const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 }, 'claude-sonnet-4-6': { in: 3, out: 15 }, 'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 }, 'claude-opus-5': { in: 15, out: 75 }, 'claude-fable-5-1': { in: 25, out: 125 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 }, 'gpt-5.6-luna': { in: 0.2, out: 1.2 }, 'gpt-5.6-terra': { in: 2, out: 8 }, 'gpt-5.6-sol': { in: 10, out: 40 },
};
export function estimateUsd(model: string, approxTokens: number): number | null {
  const pr = PRICES[model]; if (!pr) return null;
  return (approxTokens * pr.in + approxTokens * 0.08 * pr.out) / 1_000_000;
}
const tierModel = (t: Tier): string => backendName() === 'codex'
  ? (t === 'fancy' ? CODEX_FANCY : t === 'smart' ? CODEX_SMART : CODEX_CHEAP)
  : (t === 'fancy' ? FANCY : t === 'smart' ? SMART : CHEAP);
export function defaultModelFor(task: Task): string {
  const r = ROLES.find((x) => x.task === task);
  return tierModel(r?.tier ?? 'cheap');
}
let modelResolver: ((task: Task) => string | undefined) | null = null;
export function setModelResolver(fn: ((task: Task) => string | undefined) | null): void { modelResolver = fn; }
export function modelFor(task: Task): string {
  const chosen = modelResolver?.(task);
  return chosen && /^[a-z0-9.-]{3,60}$/.test(chosen) ? chosen : defaultModelFor(task);
}

// M220 (Mark: Codex users): three backends. 'subscription' = claude -p on the
// user's Claude plan; 'api' = ANTHROPIC_API_KEY; 'codex' = `codex exec` on
// the user's ChatGPT plan (or CODEX_API_KEY). Explicit via HARNESSMAP_INFERENCE;
// otherwise auto: codex when the codex CLI is on PATH and claude is not.
export type Backend = 'api' | 'subscription' | 'codex';
let detected: Backend | null = null;
// M241 (Mark, Windows): probe each way separately — on Windows `sh` is usually
// absent and one throw used to void the `where` probe too, so codex was never
// auto-detected there.
const probe = (argv: string[]): boolean => { try { return Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'ignore' }).exitCode === 0; } catch { return false; } };
const onPath = (bin: string): boolean => process.platform === 'win32'
  ? probe(['where', bin]) || probe(['sh', '-c', `command -v ${bin}`])
  : probe(['sh', '-c', `command -v ${bin}`]) || probe(['where', bin]);
export const codexOnPath = (): boolean => onPath('codex');
export function backendName(): Backend {
  const e = process.env.HARNESSMAP_INFERENCE;
  if (e === 'api' || e === 'codex' || e === 'subscription') return e;
  if (detected) return detected;
  detected = !onPath('claude') && onPath('codex') ? 'codex' : 'subscription';
  return detected;
}

export interface CallOpts {
  task: Task;
  modelOverride?: string;
  system: string;
  user: string;
  maxTokens: number;
  schema?: object;        // json_schema; enforced on 'api', prompted on 'subscription'
  timeoutMs?: number;
  audit?: (kind: string, detail: Record<string, unknown>) => void;
}

// Returns parsed JSON when a schema was given, else raw text.
// M113: dev-mode trace sink — the server installs a sink that records full
// prompts/responses when dev mode is on. One choke point = total coverage.
type TraceFn = (t: { kind: string; task: string; model: string; backend: string; ms: number; ok: boolean; system?: string; user?: string; response?: string }) => void;
let traceSink: TraceFn | null = null;
// M184 (Mark): cost metrics — every successful call reports its approximate
// token load (chars/4; exact usage isn't exposed on the subscription path).
let metricsSink: ((m: { task: string; model: string; approxTokens: number }) => void) | null = null;
// M186 (Mark): auth transparency — the page shows when calls last worked or
// failed. Timestamps + a short error tail only; no flows, no secrets.
export const callHealth: { lastOkAt: number | null; lastErrAt: number | null; lastErr: string | null } = { lastOkAt: null, lastErrAt: null, lastErr: null };
export function setMetricsSink(fn: typeof metricsSink): void { metricsSink = fn; }
export function setTraceSink(fn: TraceFn | null): void { traceSink = fn; }

export async function call(opts: CallOpts): Promise<any> {
  // Slicing text at fixed offsets can split an emoji's surrogate pair; a
  // lone surrogate breaks the JSON framing to the CLI child, which exits 1
  // with no output (found live: enrich/find-and-file died only when a source
  // block crossed one specific emoji). Well-form every outgoing string at
  // this one choke point so no slicing site can ever poison a call.
  const wf = (t: string) => (t as any).toWellFormed ? (t as any).toWellFormed() : t;
  opts = { ...opts, system: wf(opts.system), user: wf(opts.user) };
  const backend = backendName();
  const model = opts.modelOverride ?? modelFor(opts.task);
  const t0 = Date.now();
  try {
    let out: any;
    try {
      out = backend === 'api' ? await apiCall(opts, model) : backend === 'codex' ? await codexCall(opts, model) : await subCall(opts, model);
    } catch (err) {
      // M241 (Mark, Windows, Codex-only machine): the subscription path answered
      // "Invalid API key · Please run /login". When claude is not signed in and
      // codex is on this machine, switch the backend to codex for the rest of
      // the process and answer this call there. Explicit HARNESSMAP_INFERENCE wins.
      if (backend === 'subscription' && !process.env.HARNESSMAP_INFERENCE && /not logged in|Invalid API key|\/login/i.test(String(err)) && codexOnPath()) {
        detected = 'codex';
        console.error('[inference] claude is not signed in and codex is available — the map\'s agents now run on codex (sign in with `claude` then restart to switch back)');
        out = await codexCall(opts, modelFor(opts.task));
      } else throw err;
    }
    opts.audit?.('inference', { task: opts.task, backend: backendName(), model, ms: Date.now() - t0, ok: true });
    try { traceSink?.({ kind: 'call', task: opts.task, model, backend, ms: Date.now() - t0, ok: true, system: opts.system, user: opts.user, response: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }); } catch {}
    callHealth.lastOkAt = Date.now();
    try { metricsSink?.({ task: opts.task, model, approxTokens: Math.ceil((opts.system.length + opts.user.length + (typeof out === 'string' ? out.length : JSON.stringify(out).length)) / 4) }); } catch {}
    return out;
  } catch (err) {
    opts.audit?.('inference', { task: opts.task, backend, model, ms: Date.now() - t0, ok: false, error: String(err).slice(0, 200) });
    callHealth.lastErrAt = Date.now();
    callHealth.lastErr = String(err).slice(0, 160);
    try { traceSink?.({ kind: 'call', task: opts.task, model, backend, ms: Date.now() - t0, ok: false, system: opts.system, user: opts.user, response: String(err).slice(0, 500) }); } catch {}
    throw err;
  }
}

async function apiCall(opts: CallOpts, model: string): Promise<any> {
  const client = new Anthropic({ apiKey: STASHED_API_KEY, timeout: opts.timeoutMs ?? 60_000, maxRetries: 1 });
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    ...(opts.schema ? { output_config: { format: { type: 'json_schema', schema: opts.schema } } } : {}),
    messages: [{ role: 'user', content: opts.user }],
  } as any);
  const text = (response as any).content.find((b: any) => b.type === 'text')?.text ?? '';
  return opts.schema ? JSON.parse(text || '{}') : text;
}

// M220: the codex backend — `codex exec` on the user's ChatGPT plan. The
// prompt goes in on stdin, the final message comes back through a file
// (-o), a schema is enforced by --output-schema; ephemeral (no session
// rollout), read-only sandbox, no git check. Same two-attempt JSON discipline
// as the subscription path.
const codexUnsupported = new Set<string>(); // model ids this account's Codex has refused (M242)
const codexBadSchemas = new Set<string>(); // schemas Codex's strict structured output rejected (M242b)
export const codexRefusedModels = (): string[] => [...codexUnsupported];
async function codexCall(opts: CallOpts, model: string): Promise<any> {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'hm-codex-'));
  const outFile = join(dir, 'out.txt');
  // M242b (Mark, Windows): OpenAI's strict structured output rejects schemas
  // that are fine elsewhere (every object needs `required` listing all keys,
  // no optional fields) — the filer's got a 400 "Invalid schema". A schema
  // Codex rejects is remembered and that call, and later ones with the same
  // schema, run on prompted JSON (the note below + the parse loop), the way
  // the subscription path always has.
  const schemaKey = opts.schema ? JSON.stringify(opts.schema) : '';
  let schemaFile = opts.schema && !codexBadSchemas.has(schemaKey) ? join(dir, 'schema.json') : null;
  if (schemaFile) writeFileSync(schemaFile, JSON.stringify(opts.schema));
  const jsonNote = opts.schema ? `\n\nRESPOND WITH JSON ONLY — a single JSON object matching this schema (no prose, no code fences):\n${JSON.stringify(opts.schema)}` : '';
  let lastErr = '';
  let useModel: string | null = codexUnsupported.has(model) ? null : model; // null = the account's default model
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const user = attempt === 1 ? opts.user : `${opts.user}\n\n(Your previous reply was not valid JSON for the schema: ${lastErr}. Reply again with ONLY the JSON object.)`;
      const prompt = `SYSTEM INSTRUCTIONS:\n${opts.system}${jsonNote}\n\n---\n\n${user}`;
      const args = ['codex', 'exec', '-', ...(useModel ? ['-m', useModel] : []), '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir, '-o', outFile, ...(schemaFile ? ['--output-schema', schemaFile] : [])];
      const env: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      const p = Bun.spawn(args, { stdin: new Response(prompt), stdout: 'pipe', stderr: 'pipe', env });
      const limitMs = opts.timeoutMs ?? 120_000;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { p.kill(); } catch {} }, limitMs);
      const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const code = await p.exited; clearTimeout(timer);
      if (process.env.HARNESSMAP_CLI_STDERR === '1' && stderr) console.error('[codex stderr]', stderr.slice(0, 800));
      if (timedOut) throw new Error(`codex exec timed out after ${limitMs}ms`);
      // M242 (Mark, Windows): a ChatGPT sign-in allows only some model ids
      // (plan-dependent; ids retire). When Codex refuses the id, remember it
      // and run this call on the account's default model instead of failing.
      if (schemaFile && code !== 0 && /Invalid schema/i.test(stderr)) {
        codexBadSchemas.add(schemaKey);
        console.error(`[inference] codex rejected the ${opts.task} schema (strict structured output) — this call and later ones with that schema use prompted JSON`);
        schemaFile = null; attempt--; continue;
      }
      if (useModel && code !== 0 && /model is not supported/i.test(stderr)) {
        codexUnsupported.add(useModel);
        console.error(`[inference] codex refuses model '${useModel}' on this account — using the account's default model for it from now on (pick another in ⚙ models)`);
        useModel = null; attempt--; continue;
      }
      let text = ''; try { text = readFileSync(outFile, 'utf8'); } catch {}
      if (!text.trim()) text = stdout;
      if (code !== 0 && !text.trim()) throw new Error(`codex exec exited ${code}: ${stderr.slice(-300)}`);
      if (!opts.schema) return text.trim();
      try { return JSON.parse(text.replace(/^[\s\S]*?(\{)/, '$1').replace(/\}[^}]*$/, '}')); } catch (e) { lastErr = String(e).slice(0, 120); }
    }
    throw new Error(`codex returned invalid JSON twice: ${lastErr}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

async function subCall(opts: CallOpts, model: string): Promise<any> {
  // M227 finding: the king (opus, 16k output) answered "I'll check the measured
  // numbers against my inputs, then write the report." and then, on the retry,
  // nothing — it meant to use tools it does not have. The JSON note now says
  // so, a preamble-only reply is named as such on the retry, and a third
  // attempt exists for the schema tasks (the M205/M215 short-reply failure).
  const jsonNote = opts.schema
    ? `\n\nRESPOND WITH JSON ONLY — a single JSON object matching this schema (no prose, no code fences). You have NO tools and this is your only turn: do not announce what you will do, do not ask to proceed — write the finished object now.\n${JSON.stringify(opts.schema)}`
    : '';
  let lastErr = '';
  const ATTEMPTS = opts.schema ? 3 : 2;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const preamble = /preamble/.test(lastErr);
    const prompt = attempt === 1
      ? opts.user
      : `${opts.user}\n\n(Your previous reply was ${preamble ? 'a sentence announcing work instead of the answer — you have no tools and no further turn' : `not valid JSON for the schema: ${lastErr}`}. Reply with ONLY the JSON object, complete, now.)`;
    // M103 (Mark): the subscription path must NEVER bill the API key. The
    // SDK's spawned CLI prefers ANTHROPIC_API_KEY from env when present, so
    // strip it (and AUTH_TOKEN) — the CLI then uses the logged-in
    // subscription. The 'api' backend reads the key directly and is unaffected.
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'ANTHROPIC_AUTH_TOKEN') cleanEnv[k] = v;
    }
    // M200/M201 (2026-09-06): the subscription path had NO timeout. It was
    // bounded while chasing the re-aim run's hangs; the hang itself turned out
    // to be the server's own tree walk looping on a parent cycle (M201), not a
    // wedged child — but a child that never answers would wedge inference the
    // same way, so the bound stays: past timeoutMs the child is aborted and
    // the call fails loudly, like the API path. stderr is always drained so a
    // chatty child cannot block on a full pipe.
    const ac = new AbortController();
    const q = query({
      prompt,
      options: {
        model,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
        systemPrompt: opts.system + jsonNote,
        env: cleanEnv,
        abortController: ac,
        stderr: (d: string) => { if (process.env.HARNESSMAP_CLI_STDERR === '1') console.error('[cli stderr]', String(d).slice(0, 800)); },
      },
    } as any);
    const limitMs = opts.timeoutMs ?? 120_000;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { ac.abort(); } catch {} }, limitMs);
    let text = '';
    try {
      for await (const msg of q as any) {
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content ?? []) if (b.type === 'text') text += b.text;
        }
      }
    } catch (e) {
      if (timedOut) throw new Error(`subscription backend: no answer within ${limitMs}ms (child aborted)`);
      throw e;
    } finally { clearTimeout(timer); }
    if (timedOut) throw new Error(`subscription backend: no answer within ${limitMs}ms (child aborted)`);
    // The CLI reports a missing login as an assistant message, not an error.
    if (/Invalid API key|Please run \/login|not logged in/i.test(text.trim().slice(0, 200))) throw new Error(`subscription backend: claude is not logged in (${text.trim().slice(0, 60)}) — run \`claude\` and /login, or use codex`);
    if (!opts.schema) return text;
    const stripped = text.trim().replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(stripped);
    } catch (e) {
      // Mechanical repairs before burning the retry (learned from the v3
      // import run, where one malformed chunk killed a 21-chunk job): take
      // the outermost {...} (drops stray prose around the object), then
      // remove trailing commas. Deterministic guards, not model reliance.
      const braced = stripped.slice(stripped.indexOf('{'), stripped.lastIndexOf('}') + 1);
      const repaired = braced.replace(/,\s*([}\]])/g, '$1');
      try {
        const out = JSON.parse(repaired);
        opts.audit?.('parse_repaired', { task: opts.task, attempt });
        return out;
      } catch { /* fall through to retry */ }
      lastErr = (!/\{/.test(text) && text.trim().length < 400) ? `preamble only: ${text.trim().slice(0, 80)}` : String(e).slice(0, 120);
      // Keep the raw head — without it the failing decision is unlearnable.
      opts.audit?.('parse_retry', { task: opts.task, attempt, error: lastErr, raw: stripped.slice(0, 1500) });
    }
  }
  throw new Error(`subscription backend: invalid JSON after retry (${lastErr})`);
}

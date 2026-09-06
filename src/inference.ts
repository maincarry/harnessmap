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
  | 'tidy' | 'mapcheck' | 'import';

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
const HEAVY_TASKS: Task[] = ['tidy', 'mapcheck'];

export function modelFor(task: Task): string {
  if (task === 'import') return FANCY;
  return HEAVY_TASKS.includes(task) ? SMART : CHEAP;
}

export function backendName(): 'api' | 'subscription' {
  return process.env.HARNESSMAP_INFERENCE === 'api' ? 'api' : 'subscription';
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
    const out = backend === 'api' ? await apiCall(opts, model) : await subCall(opts, model);
    opts.audit?.('inference', { task: opts.task, backend, model, ms: Date.now() - t0, ok: true });
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

async function subCall(opts: CallOpts, model: string): Promise<any> {
  const jsonNote = opts.schema
    ? `\n\nRESPOND WITH JSON ONLY — a single JSON object matching this schema (no prose, no code fences):\n${JSON.stringify(opts.schema)}`
    : '';
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1
      ? opts.user
      : `${opts.user}\n\n(Your previous reply was not valid JSON for the schema: ${lastErr}. Reply again with ONLY the JSON object.)`;
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
      lastErr = String(e).slice(0, 120);
      // Keep the raw head — without it the failing decision is unlearnable.
      opts.audit?.('parse_retry', { task: opts.task, attempt, error: lastErr, raw: stripped.slice(0, 1500) });
    }
  }
  throw new Error(`subscription backend: invalid JSON after retry (${lastErr})`);
}

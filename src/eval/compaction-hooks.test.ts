import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'harnessmap-compaction-test-'));
const root = resolve(import.meta.dir, '../..');
const requests: { path: string; session: string | null }[] = [];
let compacted = false;
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json() as any : null;
    const session = body?.session_id ?? url.searchParams.get('session_id');
    requests.push({ path: url.pathname, session });
    if (url.pathname === '/api/state') return Response.json({ nodes: [], projectId: 'test' });
    if (url.pathname === '/api/harness/compaction') return Response.json({ instructions: 'Preserve the newest decisions 地图.' });
    if (url.pathname === '/api/harness/compacted') compacted = true;
    if (url.pathname === '/api/harness/context') return Response.json({
      context: compacted ? 'Full map after compaction 地图.' : null, kind: compacted ? 'full' : 'delta',
    });
    return Response.json({ ok: true });
  },
});

beforeEach(() => { requests.length = 0; compacted = false; });
afterAll(() => {
  server.stop(true);
  if (dirname(resolve(home)) !== resolve(tmpdir())) throw new Error('Unexpected test home');
  rmSync(home, { recursive: true, force: true });
});

const codexInput = {
  session_id: 'compaction-test', cwd: home,
  transcript_path: join(home, '.codex/sessions/rollout.jsonl'),
};

async function runHook(file: string, input: Record<string, unknown>, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, 'run', join(root, 'hooks', file)], {
    windowsHide: true, stdin: new Blob([JSON.stringify(input)]), stdout: 'pipe', stderr: 'pipe', timeout: 10_000,
    env: {
      ...process.env,
      HARNESSMAP_HOME: home, HARNESSMAP_URL: `http://127.0.0.1:${server.port}`,
      HARNESSMAP_SESSION_GATE: 'open', HARNESSMAP_INNER: '',
      CODEX_HOME: '', CODEX_SANDBOX: '', CLAUDECODE: '',
      ...env,
    },
  });
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(code).toBe(0);
  expect(err).toBe('');
  return out;
}

for (const trigger of ['manual', 'auto']) {
  test(`Codex ${trigger} PreCompact succeeds without unsupported hook-specific JSON`, async () => {
    const out = await runHook('pre-compact.ts', { ...codexInput, hook_event_name: 'PreCompact', trigger });
    // Codex accepts exit 0 with empty stdout; PreCompact has no hookSpecificOutput shape.
    // https://learn.chatgpt.com/docs/hooks#precompact
    expect(out).toBe('');
    expect(requests).toHaveLength(0);
  });
}

test('Codex with a custom home and transcript location is also silent', async () => {
  const out = await runHook('pre-compact.ts', { ...codexInput, transcript_path: join(home, 'sessions/rollout.jsonl') }, { CODEX_HOME: home });
  expect(out).toBe('');
  expect(requests).toHaveLength(0);
});

test('an unidentified host never receives the legacy compaction output', async () => {
  const out = await runHook('pre-compact.ts', { session_id: 'unknown', cwd: home });
  expect(out).toBe('');
  expect(requests).toHaveLength(0);
});

test('the existing Claude PreCompact behavior is retained', async () => {
  const out = await runHook('pre-compact.ts', { ...codexInput, transcript_path: join(home, '.claude/projects/transcript.jsonl') });
  expect(JSON.parse(out)).toEqual({
    hookSpecificOutput: { hookEventName: 'PreCompact', compactionInstructions: 'Preserve the newest decisions 地图.' },
  });
  expect(requests.map(r => r.path)).toEqual(['/api/harness/compaction']);
});

test('an unattached session stays silent without contacting the server', async () => {
  const out = await runHook('pre-compact.ts', { ...codexInput, transcript_path: join(home, '.claude/projects/transcript.jsonl') }, { HARNESSMAP_SESSION_GATE: 'closed' });
  expect(out).toBe('');
  expect(requests).toHaveLength(0);
});

for (const file of ['post-compact.ts', 'session-start.ts']) {
  test(`${file} still re-anchors the session and the next prompt receives map context`, async () => {
    const out = await runHook(file, { ...codexInput, source: 'compact', trigger: 'auto' });
    expect(out).toBe('');
    expect(requests.filter(r => r.path === '/api/harness/compacted')).toEqual([
      { path: '/api/harness/compacted', session: codexInput.session_id },
    ]);
    const prompt = await runHook('on-prompt.ts', { ...codexInput, prompt: 'Continue after compaction.' });
    const context = JSON.parse(prompt).hookSpecificOutput;
    expect(context.hookEventName).toBe('UserPromptSubmit');
    expect(context.additionalContext).toContain('Full map after compaction 地图.');
    expect(requests.filter(r => r.path === '/api/harness/context')[0]?.session).toBe(codexInput.session_id);
  });
}

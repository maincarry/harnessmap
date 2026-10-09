import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { windowsHookCommand } from '../../hooks/windows-hook-command.ts';

const root = mkdtempSync(join(tmpdir(), 'harnessmap-hook-'));
const repo = resolve(import.meta.dir, '../..');
afterAll(() => {
  const rel = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe test cleanup path');
  rmSync(root, { recursive: true, force: true });
});

test('quotes executable and script paths as PowerShell literals', () => {
  const cmd = windowsHookCommand("C:\\O'Brien $bin\\bun.exe", '"C:\\O\'Brien $repo\\hook.ts"');
  expect(cmd).toContain("$i.FileName='C:\\O''Brien $bin\\bun.exe'");
  expect(cmd).toContain("$i.Arguments='run \"C:\\O''Brien $repo\\hook.ts\"'");
  expect(cmd).toContain('$i.UseShellExecute=$false;$i.CreateNoWindow=$true');
});

const windowsTest = process.platform === 'win32' ? test : test.skip;
for (const shell of ['pwsh.exe', 'powershell.exe']) {
  async function run(command: string, input: string, env = process.env) {
    const p = Bun.spawn([shell, '-NoProfile', '-NonInteractive', '-Command', command], {
      env, windowsHide: true, stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe', timeout: 15000,
    });
    const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code, stdout, stderr };
  }

  windowsTest(`${shell}: forwards large Unicode streams, EOF, and exit code`, async () => {
    const dir = join(root, `${shell} O'Brien $workspace`);
    mkdirSync(dir, { recursive: true });
    const script = join(dir, 'probe.ts');
    // Fill both output pipes before consuming input to catch sequential-copy deadlocks.
    writeFileSync(script, `
      await Bun.write(Bun.stdout, 'output '.repeat(20000));
      await Bun.write(Bun.stderr, 'error '.repeat(20000));
      const input = await Bun.stdin.text();
      await Bun.write(Bun.stdout, input);
      process.exit(7);
    `);
    const input = JSON.stringify({ prompt: '地图 café 😀\r\n'.repeat(20000) });
    const result = await run(windowsHookCommand(process.execPath, `"${script}"`), input);
    expect(result.code).toBe(7);
    expect(result.stdout).toBe('output '.repeat(20000) + input);
    expect(result.stderr).toBe('error '.repeat(20000));
  }, 20000);

  windowsTest(`${shell}: registered hooks send prompt/round and return context`, async () => {
    const home = join(root, shell, 'codex');
    const env = { ...process.env, CODEX_HOME: home, HARNESSMAP_HOME: join(root, shell, 'map'), HARNESSMAP_INNER: '', HARNESSMAP_SESSION_GATE: 'open' };
    const register = () => Bun.spawnSync([process.execPath, 'run', join(repo, 'hooks/enable-codex.ts')], {
      env, windowsHide: true, stdout: 'pipe', stderr: 'pipe', timeout: 10000,
    });
    expect(register().exitCode).toBe(0);
    const hooksPath = join(home, 'hooks.json');
    const first = readFileSync(hooksPath, 'utf8');
    expect(register().exitCode).toBe(0);
    expect(readFileSync(hooksPath, 'utf8')).toBe(first);
    const config = JSON.parse(first);
    expect(Object.keys(config.hooks)).toHaveLength(6);
    const requests: { path: string; body: any }[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const url = new URL(req.url);
      requests.push({ path: url.pathname, body: req.method === 'POST' ? await req.json() : null });
      return Response.json(url.pathname.endsWith('/context') ? { context: 'test map context 地图', kind: 'delta' } : { ok: true });
    } });
    try {
      const hookEnv = { ...env, HARNESSMAP_URL: `http://127.0.0.1:${server.port}` };
      const payload = { session_id: 'windows-hook-test', cwd: root, prompt: 'test prompt 地图', last_assistant_message: 'test reply' };
      const prompt = await run(config.hooks.UserPromptSubmit[0].hooks[0].command, JSON.stringify(payload), hookEnv);
      expect(prompt.code).toBe(0);
      expect(prompt.stderr).toBe('');
      expect(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext).toBe('test map context 地图');
      const stop = await run(config.hooks.Stop[0].hooks[0].command, JSON.stringify(payload), hookEnv);
      expect(stop).toEqual({ code: 0, stdout: '', stderr: '' });
      expect(requests.find(r => r.path.endsWith('/prompt'))?.body.text).toBe(payload.prompt);
      expect(requests.find(r => r.path.endsWith('/observe'))?.body.last_assistant_message).toBe(payload.last_assistant_message);
      expect(requests.filter(r => r.path.endsWith('/observe'))).toHaveLength(1);
    } finally { server.stop(true); }
  }, 20000);
}

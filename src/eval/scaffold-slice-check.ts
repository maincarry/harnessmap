// M366 (Jacob, live: "the map still records all available plugins"): host scaffold the harness injects as
// a "user" message (<recommended_plugins>, <environment_context>, …) must never reach the filer as the
// user's words. stripHostScaffold existed (M259) but was wired only into the Codex path, never the Claude
// Code transcript slice — and NO test exercised the SLICE paths at all (the old test hit stripHostScaffold
// directly + the prompt stash). This closes that gap for BOTH paths. Usage: bun run src/eval/scaffold-slice-check.ts
import { sliceRound } from '../agent/harness-adapter.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const dir = mkdtempSync(join(tmpdir(), 'scaffold-'));
const write = (name: string, lines: any[]) => { const fp = join(dir, name); writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n')); return fp; };

const PLUGINS = '<recommended_plugins>\nHere is a list of plugins you could use:\n- Airtable\n- Slack\n- Notion\n</recommended_plugins>';
const ENVCTX = '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>';

// ---- Claude Code path (JSONL with uuid) ----
{
  const fp = write('cc.jsonl', [
    { uuid: 'u1', type: 'user', message: { content: [{ type: 'text', text: `${PLUGINS}\n${ENVCTX}\nwe decided the door will be teal` }] } },
    { uuid: 'a1', type: 'assistant', message: { content: [{ type: 'text', text: 'Noted: teal door.' }] } },
  ]);
  const r = await sliceRound(fp, null);
  ok('CC: scaffold stripped, user words kept', r.userText === 'we decided the door will be teal');
  ok('CC: no plugin list leaks into userText', !/recommended_plugins|Airtable|Slack|Notion/.test(r.userText));
  ok('CC: assistant text intact', /teal door/.test(r.assistantText));
}
// Claude Code: a turn that is ONLY scaffold files nothing
{
  const fp = write('cc-only.jsonl', [
    { uuid: 'u1', type: 'user', message: { content: [{ type: 'text', text: `${PLUGINS}` }] } },
  ]);
  const r = await sliceRound(fp, null);
  ok('CC: a scaffold-only turn yields empty userText', r.userText === '');
}

// ---- Codex path (rollout response_item) ----
{
  const fp = write('codex.jsonl', [
    { type: 'session_meta', payload: { cwd: '/x', id: 's1', cli_version: '0.0' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${ENVCTX}\n${PLUGINS}\nwe chose blue` }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Noted: blue.' }] } },
  ]);
  const r = await sliceRound(fp, null);
  ok('Codex: scaffold stripped, user words kept', r.userText === 'we chose blue');
  ok('Codex: no plugin list leaks into userText', !/recommended_plugins|Airtable|Slack|Notion/.test(r.userText));
}
// Codex: a message that is ONLY scaffold files nothing
{
  const fp = write('codex-only.jsonl', [
    { type: 'session_meta', payload: { cwd: '/x', id: 's2' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: PLUGINS }] } },
  ]);
  const r = await sliceRound(fp, null);
  ok('Codex: a scaffold-only turn yields empty userText', r.userText === '');
}

console.log(`scaffold-slice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

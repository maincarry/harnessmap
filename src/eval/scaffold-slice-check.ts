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


// ---- stripHostScaffold / looksLikeScaffold, structural (M366) ----
{
  const { stripHostScaffold, looksLikeScaffold } = await import('../agent/harness-adapter.js');
  // the exact current GPT-app format (closed)
  ok('closed recommended_plugins is stripped whole', stripHostScaffold('<recommended_plugins>\n- Slack (slack@openai-curated-remote)\n</recommended_plugins>') === '');
  // an UNCLOSED scaffold block (no </tag>) — the case a closed-only strip misses
  ok('unclosed scaffold block is dropped to end', stripHostScaffold('<recommended_plugins>\n- Slack\n- Notion (this never closes') === '');
  // a NOVEL tag we have never named, snake_case → recognised structurally
  ok('novel snake_case scaffold tag is stripped', stripHostScaffold('<available_apps>\n- Figma\n</available_apps>\nship it') === 'ship it');
  ok('novel snake_case tag, unclosed, is dropped', stripHostScaffold('<mcp_server_list>\n- foo\n- bar') === '');
  // real user prose is NEVER eaten
  ok('plain prose untouched', stripHostScaffold('we chose blue because it is calmer') === 'we chose blue because it is calmer');
  ok('a NON-scaffold leading tag block is KEPT, not stripped (only host vocab strips)', stripHostScaffold('<b>note</b> keep this') === '<b>note</b> keep this');
  ok('prose starting with an unclosed NON-scaffold tag is NOT eaten', stripHostScaffold('<html> is broken, help me fix it') === '<html> is broken, help me fix it');
  ok('looksLikeScaffold: recommended_plugins yes', looksLikeScaffold('<recommended_plugins>x') === true);
  ok('looksLikeScaffold: plain prose no', looksLikeScaffold('we decided X') === false);
  ok('looksLikeScaffold: <html> no (not scaffold-ish)', looksLikeScaffold('<html>hi') === false);
}


// ---- M366 structural stripper: plausible host-format VARIANTS (standing watch) ----
{
  const { stripHostScaffold, looksLikeScaffold } = await import('../agent/harness-adapter.js');
  // variant hardening
  ok('tag WITH ATTRIBUTES is stripped', stripHostScaffold('<recommended_plugins version="2" source="curated">\n- Slack\n</recommended_plugins>\ngo') === 'go');
  ok('UPPERCASE scaffold tag is stripped', stripHostScaffold('<ENVIRONMENT_CONTEXT>\n<cwd>/x</cwd>\n</ENVIRONMENT_CONTEXT>\nkeep') === 'keep');
  ok('several stacked scaffold blocks all stripped', stripHostScaffold('<recommended_plugins>\n- A\n</recommended_plugins>\n<environment_context><cwd>/x</cwd></environment_context>\n<user_instructions>be nice</user_instructions>\nthe real ask') === 'the real ask');
  ok('mixed: scaffold then a multi-line user message', stripHostScaffold('<recommended_plugins>\n- A\n</recommended_plugins>\nline one\nline two') === 'line one\nline two');
  ok('novel tool_definitions manifest (unclosed) dropped', stripHostScaffold('<tool_definitions>\n- search(query)\n- read(path)') === '');
  ok('a scaffold tag mid-message does NOT eat the leading user words', stripHostScaffold('please read <environment_context><cwd>/x</cwd></environment_context>') === 'please read <environment_context><cwd>/x</cwd></environment_context>');
  ok('looksLikeScaffold: tag with attributes', looksLikeScaffold('<recommended_plugins version="2">x') === true);
  ok('looksLikeScaffold: uppercase', looksLikeScaffold('<TURN_ABORTED>') === true);
  // GROUNDED: the EXACT real o.map turn shape (tagged, real "available but not installed" phrasing,
  // @openai-curated-remote suffixes) — the pre-M366 instance that filed the 46-node "Available plugins"
  // subtree on Jacob's map. This is the case my "M366 prevents new ones" claim to Jacob rests on.
  {
    const real = '<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n'
      + ['Airtable (airtable@openai-curated-remote)','Spotify (spotify@openai-curated-remote)','Slack (slack@openai-curated-remote)'].map((x) => '- ' + x).join('\n')
      + '\n</recommended_plugins>\nopen map';
    ok('GROUNDED: real o.map recommended_plugins turn strips to just the user ask', stripHostScaffold(real) === 'open map');
  }
  // FALSIFICATION / OPEN GAP: the same plugin list UNTAGGED (plain text) is NOT stripped. o.map's instance was
  // tagged (so caught), but if the Codex app ever emits this list without a wrapper, M366 misses it — a new
  // "Available plugins" node could still be filed. Catching it needs a content heuristic (§10 proposal, not a
  // silent fix). This ok() asserts the CURRENT behaviour so the guard flags the day that behaviour changes.
  ok('OPEN GAP (documented): untagged plugin list with @openai-curated-remote suffixes is NOT stripped', stripHostScaffold('Here is a list of plugins that are available but not installed.\n- Airtable (airtable@openai-curated-remote)\n- Slack (slack@openai-curated-remote)').includes('openai-curated-remote'));
  // KNOWN BOUNDARY (documented, not a failure): a PLAIN-TEXT plugin list with no tag is NOT caught by the
  // structural stripper — catching it would need a content heuristic that risks eating real user prose.
  ok('BOUNDARY: plain-text plugin list is NOT stripped (kept as-is)', stripHostScaffold('Here is a list of plugins:\n- Slack\n- Notion') === 'Here is a list of plugins:\n- Slack\n- Notion');
}


// ---- M366 refinement: host-vocab match only (no bare snake_case) — over-strip boundary ----
{
  const { stripHostScaffold } = await import('../agent/harness-adapter.js');
  // host manifests still stripped (contain host vocab)
  ok('mcp_server_list (host manifest) stripped', stripHostScaffold('<mcp_server_list>\n- s1\n</mcp_server_list>\nok') === 'ok');
  ok('tool_definitions stripped', stripHostScaffold('<tool_definitions>\n- t\n</tool_definitions>\ngo') === 'go');
  // USER content that happens to start with a snake_case tag is KEPT (the over-strip regression this guards)
  ok('user config <database_config> is KEPT (not host vocab)', stripHostScaffold('<database_config>\n  host: localhost\n</database_config>\nwhat is wrong here?').startsWith('<database_config>'));
  ok('user <my_data> block is KEPT', stripHostScaffold('<my_data>1,2,3</my_data> please parse') === '<my_data>1,2,3</my_data> please parse');
  ok('all known host tags still recognized', ['recommended_plugins','environment_context','user_instructions','permissions','turn_aborted','hook_context','system_context','skills_instructions'].every((t) => stripHostScaffold(`<${t}>x</${t}>\nkeep`) === 'keep'));
}

console.log(`scaffold-slice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// SDK spike (task #2, DESIGN.md §8): verify the integration contract —
//  1. systemPrompt preset+append works
//  2. a fresh session with a composed seed answers from the seed
//  3. fork-at-save-point: forking preserves context; the original is untouched
//  4. resuming the fork is a verbatim continuation (context intact)
// Usage: bun run src/spike/sdk-spike.ts

import { query } from '@anthropic-ai/claude-agent-sdk';

const MODEL = 'claude-haiku-4-5';

async function runTurn(prompt: string, opts: Record<string, unknown>): Promise<{ sessionId: string; text: string }> {
  let sessionId = '';
  let text = '';
  const q = query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'You are running inside harnessmap. Answer in one short sentence.',
      },
      ...opts,
    },
  } as any);
  for await (const msg of q as any) {
    if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') text += block.text;
      }
    }
    if (msg.type === 'result') {
      sessionId = msg.session_id ?? sessionId;
    }
  }
  return { sessionId, text };
}

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function main() {
  console.log(`SDK spike — model: ${MODEL}\n`);

  // 1+2: fresh session, seeded context
  const seed = [
    '[harnessmap seed]',
    'You are working ON: "essay: AI art authorship".',
    'Established decisions: the codeword for this session is MANGO.',
    '',
    'Confirm you are ready.',
  ].join('\n');
  const a1 = await runTurn(seed, {});
  check('seeded session opens, session id assigned', a1.sessionId.length > 0, JSON.stringify(a1));
  console.log(`   session A = ${a1.sessionId}`);

  // advance A one turn (so A's latest state moves past the "save point")
  const a2 = await runTurn('New decision: the second codeword is PAPAYA. Acknowledge.', { resume: a1.sessionId });
  check('resume continues session A', a2.sessionId.length > 0, JSON.stringify(a2));

  // 3: fork at this moment = save point capture
  const f1 = await runTurn('What are the codeword(s) so far? List them.', { resume: a2.sessionId || a1.sessionId, forkSession: true });
  const forkKnowsBoth = /mango/i.test(f1.text) && /papaya/i.test(f1.text);
  check('fork carries full context (both codewords)', forkKnowsBoth, f1.text);
  check('fork got a NEW session id', f1.sessionId !== a1.sessionId && f1.sessionId.length > 0, f1.sessionId);
  console.log(`   fork F = ${f1.sessionId}`);

  // 4: original untouched — advance A with a third codeword; fork must NOT see it
  await runTurn('Third codeword: GUAVA. Acknowledge.', { resume: a2.sessionId || a1.sessionId });
  const f2 = await runTurn('Do you know a codeword starting with G? Answer yes or no, and name it if yes.', { resume: f1.sessionId });
  const forkIsolated = !/guava/i.test(f2.text);
  check('fork is isolated from original\'s later turns', forkIsolated, f2.text);

  const a3 = await runTurn('List all codewords.', { resume: a2.sessionId || a1.sessionId });
  const originalIntact = /guava/i.test(a3.text) && /mango/i.test(a3.text);
  check('original session kept its own full history', originalIntact, a3.text);

  console.log(`\nspike ${process.exitCode ? 'FAILED' : 'PASSED'}`);
}

main().catch((err) => {
  console.error('spike crashed:', err);
  process.exit(1);
});

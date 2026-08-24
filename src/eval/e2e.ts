// End-to-end test: drives the real server over HTTP exactly as the UI does.
// Requires the server running (bun run src/server.ts) and ANTHROPIC_API_KEY.
// Usage: bun run src/eval/e2e.ts [baseUrl]

const BASE = process.argv[2] ?? 'http://localhost:8790';

// If the server has auth on, use the first HARNESSMAP_USERS credential.
function authHeaders(): Record<string, string> {
  const first = (process.env.HARNESSMAP_USERS ?? '').split(',')[0];
  const i = first.indexOf(':');
  if (i <= 0) return {};
  return { authorization: `Basic ${Buffer.from(first).toString('base64')}` };
}
const AUTH = authHeaders();

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 202) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return r.json();
};
const get = async (path: string) => (await fetch(`${BASE}${path}`, { headers: AUTH })).json();

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function waitFor<T>(name: string, fn: () => Promise<T | null>, timeoutMs = 120_000): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`FAIL  ${name} — timed out after ${timeoutMs / 1000}s`);
  process.exitCode = 1;
  return null;
}

async function main() {
  console.log(`e2e against ${BASE}\n`);

  // 1. server up + UI served (through the auth layer)
  const html = await (await fetch(`${BASE}/`, { headers: AUTH })).text();
  check('UI serves', html.includes('harnessmap'));

  // 1b. auth actually gates (only meaningful when auth is on)
  if (Object.keys(AUTH).length > 0) {
    const noAuth = await fetch(`${BASE}/api/state`);
    check('auth rejects missing credentials (401)', noAuth.status === 401, `got ${noAuth.status}`);
  }

  // 2. v0.3: create a node (the "+" flow) and focus the ONE conversation on it
  const { id: focusContainerId, chatId } = await post('/api/nodes', { content: 'dinner party plan (e2e)', focus: true });
  check('node created and conversation focused on it', Boolean(chatId && focusContainerId));

  // 2b. v0.4: nodes-all-the-way — a sub-node can hang off a TYPED node
  const claim = await post('/api/nodes', { content: 'test claim (e2e)', parentId: focusContainerId });
  const under = await post('/api/nodes', { content: 'evidence under the claim (e2e)', parentId: claim.id });
  const st0 = await get('/api/state') as any;
  check('v0.4: any node can hold children', st0.nodes.find((n: any) => n.id === under.id)?.parentId === claim.id);
  await post(`/api/nodes/${claim.id}/delete`, {});

  // 3. send a message dense with extractable commitments
  await post(`/api/chats/${chatId}/messages`, {
    text: 'I want to plan a dinner party for six people on Saturday. Hard constraint: two guests are gluten-free. I\'m deciding between cooking myself or hiring a caterer — leaning toward cooking. First task: figure out the menu.',
  });

  // 4. assistant reply lands in the log
  const turns = await waitFor('assistant reply arrives', async () => {
    const t = await get(`/api/chats/${chatId}/turns`) as any[];
    return t.some((x) => x.role === 'assistant' && x.content.length > 0) ? t : null;
  });
  if (turns) check('assistant reply arrives', true);

  // 5. the translator populates the map (async — the pulse)
  const state = await waitFor('translator produces nodes', async () => {
    const s = await get('/api/state') as any;
    const typed = s.nodes.filter((n: any) => n.type);
    return typed.length >= 2 ? s : null;
  });

  if (state) {
    const typed = (state as any).nodes.filter((n: any) => n.type);
    const texts = typed.map((n: any) => `${n.type}:${n.content}`.toLowerCase());
    check('≥2 typed nodes extracted', typed.length >= 2, `got ${typed.length}`);
    check('gluten-free captured as constraint-ish node',
      texts.some((t: string) => t.includes('gluten')), texts.join(' | ').slice(0, 300));
    check('cook-vs-cater deliberation captured',
      texts.some((t: string) => t.includes('cater') || t.includes('cook')));
    console.log('\nextracted nodes:');
    for (const n of typed) console.log(`  ${n.type} [${n.status}] ${n.content}`);
  }

  // 6. direct user edit: park the first task-like node → map event, inbound links returned
  const task = state && (state as any).nodes.find((n: any) => n.type === 'task');
  if (task) {
    const r = await post(`/api/nodes/${task.id}`, { status: 'parked', chatId });
    check('user edit applies (park a task)', r.ok === true);
    const s2 = await get('/api/state') as any;
    check('edit visible in state', s2.nodes.find((n: any) => n.id === task.id)?.status === 'parked');
  } else {
    console.log('note: no task node extracted — skipping edit check (not a failure)');
  }

  // 6b. v0.2: focus endpoint + reorganize preview flow
  const fr = await post(`/api/chats/${chatId}/focus`, { nodeId: focusContainerId });
  check('focus endpoint works', fr.ok === true);
  const prop = await post('/api/reorganize/preview', { nodeId: focusContainerId });
  const propOk = Boolean(prop && Array.isArray(prop.alterations) && typeof prop.before === 'string' && typeof prop.after === 'string');
  check('reorganize preview returns proposal (before/after + alterations)', propOk,
    JSON.stringify(prop).slice(0, 200));

  // 7. second message continues the same SDK session
  await post(`/api/chats/${chatId}/messages`, { text: 'How many guests did I say, and what was the dietary constraint? One sentence.' });
  const recall = await waitFor('agent recalls seeded/session context', async () => {
    const t = await get(`/api/chats/${chatId}/turns`) as any[];
    const last = [...t].reverse().find((x) => x.role === 'assistant');
    return last && /six|6/i.test(last.content) && /gluten/i.test(last.content) ? last : null;
  });
  if (recall) check('agent recalls guest count + constraint across turns', true);

  console.log(`\ne2e ${process.exitCode ? 'FAILED' : 'PASSED'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

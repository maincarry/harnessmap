// Stop hook: a round finished in the host harness → send it to map-core.
// stdin: hook JSON {session_id, transcript_path, last_assistant_message?}
const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
const BASE = process.env.HARNESSMAP_URL ?? 'http://127.0.0.1:8791';
try {
  const lines = (await Bun.file(input.transcript_path).text()).trim().split('\n').map((l) => JSON.parse(l));
  // last user text
  let userText = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i];
    if (m.type === 'user' && !m.isMeta) {
      const c = m.message?.content;
      const texts = Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text) : [String(c ?? '')];
      // skip tool_result-only user messages
      if (texts.join('').trim()) { userText = texts.join('\n'); break; }
    }
  }
  // assistant text: prefer hook field; fall back to transcript
  let assistantText = input.last_assistant_message ?? '';
  if (!assistantText) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i];
      if (m.type === 'assistant') {
        const c = m.message?.content ?? [];
        assistantText = (Array.isArray(c) ? c : []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (assistantText) break;
      }
    }
  }
  // tool summary for the round: tool_use blocks since the last real user msg
  const toolLines: string[] = [];
  for (const m of lines) {
    if (m.type !== 'assistant') continue;
    for (const b of m.message?.content ?? []) {
      if (b.type === 'tool_use') toolLines.push(`${b.name}(${JSON.stringify(b.input ?? {}).slice(0, 120)}) [${b.id}]`);
    }
  }
  if (userText || assistantText) {
    await fetch(`${BASE}/api/harness/observe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: input.session_id,
        user_text: userText, assistant_text: assistantText,
        tool_summary: toolLines.slice(-10).join('\n') || undefined,
      }),
    });
  }
} catch (e) {
  console.error('[harnessmap stop hook]', e); // non-fatal: never break the host
}

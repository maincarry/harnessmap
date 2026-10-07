import { test, expect } from 'bun:test';
import { Translator } from './translator';

// M421f (LONG #403): "本轮回答称，…" — the M402 round-talk lead stopped at 回答 and left "称，…" behind. Real guard chain, stub store.
function harness() {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const parent = { id: 'p1', parentId: null, content: 'nginx 反向代理跨域', title: 'nginx 反向代理跨域', status: 'live', author: 'user', type: null, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
  const map: any = { nodes: [parent], links: [], projectId: 'proj' };
  return (content: string) => {
    audits.length = 0;
    const alt = { op: 'create_node', id: 'n1', parentId: 'p1', content, title: '直接请求后端', status: 'noted', author: 'agent' };
    const out = (t as any).guardScope([alt], new Set(['p1']), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' });
    return { content: out.find((a: any) => a.op === 'create_node' && a.id === 'n1')?.content as string | undefined, trims: audits.filter((a) => a.kind === 'guard_narration_trim').length };
  };
}

test('"本轮回答称，" goes whole, the statement stays', () => {
  const r = harness()('本轮回答称，同一台机器上的不同端口不会受到同源策略限制，因此可以直接从前端请求后端接口。');
  expect(r.content).toBe('同一台机器上的不同端口不会受到同源策略限制，因此可以直接从前端请求后端接口。'); expect(r.trims).toBe(1);
  expect(harness()('本轮回答表示，前端请求 /api/login 时 nginx 会将请求反向代理到后端。').content).toBe('前端请求 /api/login 时 nginx 会将请求反向代理到后端。');
});
test('a statement that merely contains 称 is untouched', () => {
  expect(harness()('该协议被称为 STUN，用于发现公网地址。').content).toBe('该协议被称为 STUN，用于发现公网地址。');
});

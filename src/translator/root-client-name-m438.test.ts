import { test, expect } from 'bun:test';
import { Translator, clientNameOfTurn } from './translator';

// M438 (TWIN #423): a thread opened in a client's name carries the name in its root title.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[], userText: string) => ({ out: (t as any).guardRootClientName(alts, map, { userText }) as any[], audits });
}
const at = '2026-10-07T19:26:50Z';
const seedRoot = { id: 'r1', parentId: null, content: 'untitled', title: null, status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };

test('the party a turn is about', () => {
  expect(clientNameOfTurn("Marchetti's Python invoicing script is double-counting refunds. Start by inspecting how orders.csv is parsed")).toBe('Marchetti');
  expect(clientNameOfTurn('Switching to Huang & Partners. Their Postgres reporting query takes about 40 seconds.')).toBe('Huang & Partners');
  expect(clientNameOfTurn('Switching to the Delacroix Cosmetics proposal. Draft a six-week scope')).toBe('Delacroix Cosmetics');
  expect(clientNameOfTurn("Revise Northwind’s clause to a 2× annual-fees cap instead")).toBe('Northwind');
  expect(clientNameOfTurn('End-of-day billing pass: summarize today’s work separately for Marchetti, Orbit Labs and Delacroix')).toBeNull(); // a mention, not the subject
  expect(clientNameOfTurn("Python's random module is not working for me")).toBeNull();                                                    // a tool, not a party
  expect(clientNameOfTurn('Fix the refund bug in the invoicing script')).toBeNull();
});

test('the seed root titled in the first turn gets the client name; a root that already names the client is left alone', () => {
  const h = harness([seedRoot]);
  const r = h([{ op: 'update_node', id: 'r1', content: "Debug Marchetti's Python invoicing script, which double-counts refunds.", status: 'live', title: 'Fix refund double-counting' }], "Marchetti's Python invoicing script is double-counting refunds. Start by inspecting how orders.csv is parsed");
  expect(r.out[0].title).toBe('Marchetti — Fix refund double-counting');
  expect(r.audits.map((a) => a.kind)).toEqual(['guard_root_client_name']);
  const r2 = h([{ op: 'create_node', id: 'n2', parentId: null, content: 'Orbit Labs Node API returns 500 on PATCH', status: 'live', title: 'Orbit Labs API returns 500', author: 'user' }], 'Switching to Orbit Labs. Their Node API returns 500 on PATCH /users/:id');
  expect(r2.out[0].title).toBe('Orbit Labs API returns 500');
});

test('a child node and a non-client turn are never touched', () => {
  const h = harness([seedRoot, { ...seedRoot, id: 'c1', parentId: 'r1', title: 'Inspect CSV parsing' }]);
  const r = h([{ op: 'update_node', id: 'c1', title: 'Inspect CSV parsing again' }], "Marchetti's script: inspect the parsing again");
  expect(r.out[0].title).toBe('Inspect CSV parsing again');
  const r2 = h([{ op: 'create_node', id: 'n3', parentId: null, title: 'Repo-local approvals', content: 'Can Codex approvals be repo-local?', status: 'open', author: 'user' }], 'Quick question: can Codex approvals be repo-local?');
  expect(r2.out[0].title).toBe('Repo-local approvals');
});

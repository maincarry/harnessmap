import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

// M536 (2026-10-25, latex-references p1 round 5 — known red since 2026-10-03): "can you give me other the link is dead". No URL, no
// identifier in her turn, so the M358 rejection guard returned and the dead website reference stayed a noted fact until the next
// round. A short, definite, unnamed rejection of a link targets the newest live node that carries a URL. Real guard, stub store.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[], userText: string) => ({ out: (t as any).guardUserRejection(alts, map, { chatId: 'c', userText }) as any[], audits });
}
const root = { id: 'p1', parentId: null, content: 'References for a LaTeX report', title: 'LaTeX report', status: 'live', author: 'user', type: null, createdAt: '2026-10-25 17:08:54', updatedAt: '2026-10-25 17:08:54' };
const wiki = { id: 'w0', parentId: 'p1', content: 'A Wikipedia reference for Random sample consensus can be written with `\\url{https://en.wikipedia.org/wiki/Random_sample_consensus}`.', title: 'Wikipedia reference', status: 'noted', author: 'agent', type: 'evidence', createdAt: '2026-10-25 17:09:05', updatedAt: '2026-10-25 17:09:05' };
const site = { id: 's1', parentId: 'p1', content: '"Calculating a Homography" by R. Pollefeys, Stanford University, is available at http://graphics.stanford.edu/courses/cs231a-2010/Pollefeys.pdf.', title: 'Homography website reference', status: 'noted', author: 'agent', type: 'evidence', createdAt: '2026-10-25 17:11:41', updatedAt: '2026-10-25 17:11:41' };
const detail = { id: 'd1', parentId: 's1', content: 'Section 2.1 of the Pollefeys document gives the formula in Equation (7).', title: 'Formula location', status: 'noted', author: 'agent', type: 'evidence', createdAt: '2026-10-25 17:11:41', updatedAt: '2026-10-25 17:11:41' };

test('"the link is dead" with nothing named reopens the newest node carrying a URL, not the replacement the round files', () => {
  const create = { op: 'create_node', id: 'n1', parentId: 's1', title: 'DLT formula location', content: 'Section 2, Equation (4), of "Applications of homography matrices" (https://www.mathworks.com/content/dam/mathworks/moler/homography-saic.pdf) uses the DLT method.', status: 'noted', author: 'agent', type: 'evidence' };
  const r = harness([root, wiki, site, detail])([create], 'can you give me other the link is dead');
  const upd = r.out.find((a) => a.op === 'update_node' && a.id === 's1');
  expect(upd?.status).toBe('open');
  expect(r.out.find((a) => a.op === 'create_node')?.status).toBe('noted');
  expect(r.out.find((a) => a.op === 'update_node' && a.id === 'w0')).toBeUndefined();
  const row = r.audits.find((a) => a.kind === 'guard_user_rejection');
  expect(row?.d.id).toBe('s1');
  expect(row?.d.how).toBe('definite');
});

test('when the filer swaps the new address into the dead link\'s own node, the guard does nothing — no fallback to an older URL node (M536b)', () => {
  const swap: any = { op: 'update_node', id: 's1', content: '"Applications of homography matrices" is available at https://www.mathworks.com/content/dam/mathworks/moler/homography-saic.pdf.' };
  const older = { ...site, id: 's0', title: 'Older reference', content: 'See http://example.org/old.pdf for the derivation.', createdAt: '2026-10-25 17:10:00', updatedAt: '2026-10-25 17:10:00' };
  const r = harness([root, wiki, older, site, detail])([swap], 'that link is dead');
  expect(r.out).toHaveLength(1); // the swap itself, untouched
  expect(swap.status).toBeUndefined();
  expect(r.audits.filter((a) => a.kind === 'guard_user_rejection')).toHaveLength(0);
});

test('the reference card is chosen over its detail row filed at the same moment; the audit names the URL', () => {
  const r = harness([root, wiki, site, detail])([], 'the link is dead');
  expect(r.out.find((a) => a.op === 'update_node' && a.id === 's1')?.status).toBe('open');
  expect(r.out.find((a) => a.op === 'update_node' && a.id === 'd1')).toBeUndefined();
  expect(r.audits.find((a) => a.kind === 'guard_user_rejection')?.d.token).toContain('graphics.stanford.edu');
});

test('a definite rejection with no URL node on the map, and a long turn, change nothing; the named shape still works', () => {
  const bare = { ...site, content: 'A Stanford lecture note by Pollefeys derives the homography.' };
  expect(harness([root, bare])([], 'the link is dead').out).toHaveLength(0);
  const long = 'the link is dead ' + 'and here is everything else I wanted to say about the report format and the figures and the tables. '.repeat(3);
  expect(harness([root, site])([], long).out).toHaveLength(0);
  const named = harness([root, site])([], 'graphics.stanford.edu/courses/cs231a-2010/Pollefeys.pdf does not exist');
  expect(named.out.find((a) => a.op === 'update_node' && a.id === 's1')?.status).toBe('open');
  expect(named.audits.find((a) => a.kind === 'guard_user_rejection')?.d.how).toBeUndefined();
});

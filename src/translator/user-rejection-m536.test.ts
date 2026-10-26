import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

// M536 → M536c (2026-10-25, latex-references p1 round 5): "can you give me other the link is dead" names no URL and no identifier.
// Two cuts resolved "the link" from the map (the newest URL node) and both reopened the wrong node on the proof reruns — the Wikipedia
// reference. The guard has no previous turn to anchor on, so an unnamed rejection does nothing; a named one still works, and the
// word list knows "is dead". Real guard, stub store.
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

test('"the link is dead" with nothing named changes nothing — no node is guessed from the map (M536c)', () => {
  const create = { op: 'create_node', id: 'n1', parentId: 's1', title: 'DLT formula location', content: 'Section 2, Equation (4), of "Applications of homography matrices" (https://www.mathworks.com/moler/homography-saic.pdf) uses the DLT method.', status: 'noted', author: 'agent', type: 'evidence' };
  const r = harness([root, wiki, site])([create], 'can you give me other the link is dead');
  expect(r.out).toHaveLength(1);
  expect(r.out[0].status).toBe('noted');
  expect(r.audits.filter((a) => a.kind === 'guard_user_rejection')).toHaveLength(0);
  expect(harness([root, wiki, site])([], 'that link is dead').out).toHaveLength(0);
});

test('a named dead link is still reopened, and "is dead" now counts as the rejection word', () => {
  const named = harness([root, wiki, site])([], 'graphics.stanford.edu/courses/cs231a-2010/Pollefeys.pdf is dead');
  expect(named.out.find((a) => a.op === 'update_node' && a.id === 's1')?.status).toBe('open');
  expect(named.out.find((a) => a.op === 'update_node' && a.id === 'w0')).toBeUndefined();
  expect(named.audits.find((a) => a.kind === 'guard_user_rejection')?.d.id).toBe('s1');
});

// M553 (matlab-steps 2026-10-26): her pasted MATLAB error "Number of elements must not change" plus "it does not work" made the guard read
// "Number" as a name she rejected, and two nodes quoting the error were reopened. A plain capitalised word that stands only at a sentence
// start is English, not a name; a name that also stands mid-sentence still counts.
test('a sentence-initial capitalised word in a pasted error is not a rejected name; a mid-sentence name still is', () => {
  const split = { id: 'd1', parentId: 'p1', content: 'Implement the MATLAB split; the error was `Number of elements must not change.`', title: 'Split dataset', status: 'done', author: 'user', type: 'task', createdAt: '2026-10-26 01:35:51', updatedAt: '2026-10-26 01:35:51' };
  const r = harness([root, split])([], 'Getting the following error: Error using reshape\nNumber of elements must not change. Use [] as one of the size inputs. It does not work.');
  expect(r.out).toHaveLength(0);
  expect(r.audits.filter((a) => a.kind === 'guard_user_rejection')).toHaveLength(0);
  const named = harness([root, wiki, site])([], 'the Pollefeys pdf does not exist');
  expect(named.out.find((a) => a.op === 'update_node' && a.id === 's1')?.status).toBe('open');
});


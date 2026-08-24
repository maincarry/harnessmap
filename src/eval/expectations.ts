import type { Alteration, MapNode } from '../types.js';

// Ground-truth checklist for the essay corpus, derived from the validated
// 22-round simulation (docs/ontology/translation-essay.md). Keyword-fuzzy on
// purpose: we grade whether the COMMITMENT was captured, not its wording.
// v2 (Jacob's spec): exploration must be captured (not filtered), and the map
// must INTEGRATE into structure rather than pile up flat.
// v0.4: the map is nodes all the way down — checks run over nodes.

export interface Expectation {
  name: string;
  check: (nodes: MapNode[], history: Alteration[]) => boolean;
}

const has = (nodes: MapNode[], pred: (n: MapNode) => boolean) => nodes.some(pred);
const kw = (s: string, ...words: string[]) => words.some((w) => s.toLowerCase().includes(w));
const solid = (n: MapNode) => ['accepted', 'decided', 'active', 'hard', 'cited', 'done', 'chosen'].includes(n.status);
const dead = (n: MapNode) => ['dropped', 'rejected', 'retracted', 'reversed', 'removed'].includes(n.status);

export const essayExpectations: Expectation[] = [
  {
    name: 'D: angle = authorship, not copyright (solid, from T3 rebuke)',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'authorship') && kw(n.content, 'copyright') && solid(n)),
  },
  {
    name: 'D/K: audience = general readers / plain language (from T11/T21 asides)',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'audience', 'plain', 'normal people', 'general reader', 'mom') && solid(n)),
  },
  {
    name: 'C: thesis captured, solid (3-revision arc lands at T12-13)',
    // v2 allows coined type labels ("thesis" is a better label than "claim") —
    // grade the content + solidity, not the label.
    check: (nodes) => has(nodes, (n) => kw(n.content, 'stands behind', 'author') && solid(n)),
  },
  {
    name: 'K: phrase-lock "stands behind it" (T13 "keep that exact phrase")',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'stands behind')),
  },
  {
    name: 'E: hip-hop sampling in, solid (T25)',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'sampling') && !dead(n)),
  },
  {
    name: 'E/✗: duchamp dropped (in at T19, killed at T25 — the reversal)',
    // Either form is correct: the duchamp node marked dead, OR a solid
    // decision to drop it (integrate-don't-append often produces the latter).
    // Under nodes, 'removed' nodes vanish from the projection view — accept a
    // removal recorded in history too.
    check: (nodes, history) => {
      if (has(nodes, (n) => kw(n.content, 'duchamp') && dead(n))) return true;
      if (has(nodes, (n) => kw(n.content, 'duchamp') && kw(n.content, 'drop', 'remov', 'cut') && solid(n))) return true;
      // 'removed' nodes vanish from the projection — accept a kill recorded in
      // history against a node whose creation mentioned duchamp.
      const duchampIds = new Set(history
        .filter((a) => (a.op === 'create_node' || a.op === 'create_item') && kw((a as any).content ?? '', 'duchamp'))
        .map((a) => (a as any).id));
      return history.some((a) => (a.op === 'update_node' || a.op === 'update_item')
        && duchampIds.has((a as any).id)
        && ['dropped', 'rejected', 'removed', 'retracted'].includes((a as any).status ?? ''));
    },
  },
  {
    name: 'E: Study S with MEDIAN 12 (user corrected mean→median at T28-30)',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'median', '12') && !dead(n)),
  },
  {
    name: 'D: cite median, not mean (T30)',
    check: (nodes) => has(nodes, (n) => n.type === 'decision' && kw(n.content, 'median')),
  },
  {
    name: 'C: curation objection exists, NOT resolved (parked/open per T33-35)',
    check: (nodes) => has(nodes, (n) => kw(n.content, 'curation') && !solid(n) && !dead(n)),
  },
  {
    name: 'T: revisit curation next session (T35 "remind me")',
    check: (nodes) => has(nodes, (n) => n.type === 'task' && kw(n.content, 'curation', 'objection')),
  },
  {
    name: 'Structure: an essay/arguments heading node exists',
    check: (nodes) => nodes.some((n) => kw(n.content, 'essay', 'argument')),
  },
  {
    name: 'v2 Integration: material is structured, not flat (some node nested ≥2 deep)',
    check: (nodes) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return nodes.some((n) => {
        const p = n.parentId ? byId.get(n.parentId) : undefined;
        return p !== undefined && p.parentId !== null;
      });
    },
  },
  {
    name: 'v2 Exploration captured: ≥1 exploratory node created during the run (e.g. T8 "feels weaker" / T23 "too cliche?")',
    check: (_nodes, history) =>
      history.some((a) => (a.op === 'create_node' || a.op === 'create_item') && (a as any).status === 'exploratory')
      || history.some((a) => (a.op === 'update_node' || a.op === 'update_item') && (a as any).status === 'exploratory'),
  },
];

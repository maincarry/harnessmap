// M415 (LONG #394 long-mix-c, a grammar-quiz round): the healer asked the title model for each of three sibling options
// ("I am usually having some coffee and toast…", "I am used to have some coffee and toast…", "I usually have some coffee and
// toast…") and wrote "Coffee and Toast" on ALL THREE — three identical labels under one parent for three different sentences,
// which is exactly the ambiguity a title exists to remove. The title model sees one node at a time, so it cannot know; the
// healer can. A healed title that collides with a live sibling's title falls back to the node's own opening words (at most
// six words / 48 chars, CJK by characters), which differ wherever the statements differ. Identical statements (a true dedup
// miss, the filer's problem not the healer's) yield no title rather than a third copy.
export const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, '').trim();

export function clipTitle(content: string): string {
  const t = content.trim().replace(/\s+/g, ' ');
  const hasSpaces = /\s/.test(t);
  // CJK runs have no spaces: twelve characters, extended to the end of a Latin/digit token the cut would otherwise split ("TUN" not "TU").
  // A CJK statement's first clause (up to the first comma/period) when it is 4–18 characters; otherwise twelve characters,
  // extended to the end of a Latin/digit token the cut would otherwise split ("TUN" not "TU").
  const clause = t.split(/[，,。；;：:、]/u)[0];
  let clip = hasSpaces ? t.split(' ').slice(0, 6).join(' ') : (clause.length >= 4 && clause.length <= 18 ? clause : t.slice(0, 12) + (t.slice(12).match(/^[A-Za-z0-9_.-]{1,8}/)?.[0] ?? ''));
  if (clip.length > 48) clip = clip.slice(0, 48).replace(/\s+\S*$/, '');
  return clip.replace(/[\s,;:.。，；：、\-–—]+$/u, '');
}

export type SiblingRef = string | { title: string; content?: string };

// M415b (LONG #395, first field firing of M415): the collision was between two quiz questions that both open with
// "Which sentence is grammatically correct: “…" and the plain six-word clip gave the SHARED lead, cut inside a quote
// ('Which sentence is grammatically correct: “I'). The words that tell siblings apart come AFTER what they share: drop
// the longest word-prefix (characters for CJK) this statement shares with any colliding sibling's statement, then clip.
export function distinguishingTail(content: string, otherContents: string[]): string {
  const t = content.trim().replace(/\s+/g, ' ');
  if (!otherContents.length) return t;
  const spaced = /\s/.test(t);
  let best = 0;
  for (const o of otherContents) {
    const oo = o.trim().replace(/\s+/g, ' ');
    if (spaced) { const a = t.split(' '), b = oo.split(' '); let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++; best = Math.max(best, i); }
    else { let i = 0; while (i < t.length && i < oo.length && t[i] === oo[i]) i++; best = Math.max(best, i); }
  }
  if (!best) return t;
  const rest = spaced ? t.split(' ').slice(best).join(' ') : t.slice(best);
  const clean = rest.replace(/^[\s"“”'‘’«»「」『』(（\[\-–—:：,，;；.。]+/u, '');
  const enough = spaced ? clean.split(' ').filter(Boolean).length >= 2 : clean.length >= 4;
  return enough ? clean : t;
}

export function dedupeTitleAgainstSiblings(title: string, content: string, siblings: SiblingRef[]): { title: string | null; deduped: boolean } {
  const refs = siblings.map((s) => (typeof s === 'string' ? { title: s } : s));
  const taken = new Set(refs.map((r) => normTitle(r.title)).filter(Boolean));
  const mine = normTitle(title);
  if (!taken.has(mine)) return { title, deduped: false };
  const colliders = refs.filter((r) => normTitle(r.title) === mine && r.content).map((r) => r.content as string);
  const clip = clipTitle(distinguishingTail(content, colliders)).replace(/[“"”'‘’«»「」『』]+$/u, '').trim();
  if (clip && !taken.has(normTitle(clip))) return { title: clip, deduped: true };
  return { title: null, deduped: true };
}

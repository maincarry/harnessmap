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
  let clip = hasSpaces ? t.split(' ').slice(0, 6).join(' ') : t.slice(0, 12) + (t.slice(12).match(/^[A-Za-z0-9_.-]{1,8}/)?.[0] ?? '');
  if (clip.length > 48) clip = clip.slice(0, 48).replace(/\s+\S*$/, '');
  return clip.replace(/[\s,;:.。，；：、\-–—]+$/u, '');
}

export function dedupeTitleAgainstSiblings(title: string, content: string, siblingTitles: string[]): { title: string | null; deduped: boolean } {
  const taken = new Set(siblingTitles.map(normTitle).filter(Boolean));
  if (!taken.has(normTitle(title))) return { title, deduped: false };
  const clip = clipTitle(content);
  if (clip && !taken.has(normTitle(clip))) return { title: clip, deduped: true };
  return { title: null, deduped: true };
}

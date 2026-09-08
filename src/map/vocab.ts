// M224 (Jacob, 2026-09-08: "there is a risk of creating fancy words that the
// user does not recognize, especially due to compaction and renaming… what is
// the best way to store the user's word choices"). Measured first, on 25 real
// rounds: of the words the filer put in node names, 30% were the user's own,
// 88% had been said by someone in the conversation, 12% were coined by the
// agent. Three layers, all mechanical:
//   1. THE USER'S WORDS — counted from what the user actually typed, per map
//      (no model call), served to every agent through the system card with
//      one rule: use the user's word, never a synonym.
//   2. THE GLOSSARY — learned from corrections: a user rename of a node, or a
//      "we call it X, not Y" told to the guide, records agent-word → user-word.
//      Lives in a setting per map; visible and editable in ✎ map preferences.
//   3. THE GUARD — at the one choke point every agent's names pass through
//      (applyAlterations): a glossary "from" word in an agent-written title is
//      replaced by the user's word. Never blocks, never touches user edits.
// Takes the raw handle, not the Store (db.ts calls the guard; no import cycle).
export interface VocabHost { db: any; getSetting(k: string): string | null; setSetting(k: string, v: string): void }
export interface GlossaryEntry { from: string; to: string; at: string; how: 'rename' | 'chat' | 'user' }

const STOP = new Set('the and that with from this for are was were not its into then than when what which only also have has been one two three per can will would should could you your our they them their there here just like about more some any all each other such very much many most over under out off down does did doing done get got make made take took give gave went come came see saw say said think thought know knew want need use used using lets yes okay now new old same way thing things time times still yet even ever never always both again back well how why where who whose because since while before after during until though although else too via etc please thanks thank sure maybe really actually basically something anything everything nothing someone anyone'.split(/\s+/));
export const contentWords = (t: string): string[] => String(t ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w) && !/^[a-z]+\d+$/.test(w));

function ensure(host: VocabHost): void {
  host.db.exec('CREATE TABLE IF NOT EXISTS user_words (project_id TEXT NOT NULL, word TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, last_at TEXT, PRIMARY KEY (project_id, word))');
}

/** Count the user's own words for this map (called with what the user typed, never with the agent's text). */
export function recordUserWords(host: VocabHost, projectId: string, text: string): number {
  if (!text?.trim()) return 0;
  ensure(host);
  const counts = new Map<string, number>();
  for (const w of contentWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  if (!counts.size) return 0;
  const up = host.db.prepare("INSERT INTO user_words (project_id, word, n, last_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(project_id, word) DO UPDATE SET n = n + excluded.n, last_at = excluded.last_at");
  const tx = host.db.transaction(() => { for (const [w, n] of counts) up.run(projectId, w, n); });
  tx();
  return counts.size;
}

export function userWords(host: VocabHost, projectId: string, limit = 60, minN = 2): { word: string; n: number }[] {
  ensure(host);
  return host.db.prepare('SELECT word, n FROM user_words WHERE project_id = ? AND n >= ? ORDER BY n DESC, word ASC LIMIT ?').all(projectId, minN, limit) as any[];
}

export function glossary(host: VocabHost, projectId: string): GlossaryEntry[] {
  try { const g = JSON.parse(host.getSetting(`glossary:${projectId}`) ?? '[]'); return Array.isArray(g) ? g : []; } catch { return []; }
}
export function addGlossary(host: VocabHost, projectId: string, from: string, to: string, how: GlossaryEntry['how']): GlossaryEntry[] {
  const f = from.trim().toLowerCase(), t = to.trim();
  if (!f || !t || f === t.toLowerCase()) return glossary(host, projectId);
  const g = glossary(host, projectId).filter((e) => e.from !== f && e.to.toLowerCase() !== f); // the latest ruling wins; a flip-flop drops the old direction
  g.push({ from: f, to: t, at: new Date().toISOString().slice(0, 10), how });
  host.setSetting(`glossary:${projectId}`, JSON.stringify(g.slice(-60)));
  return g;
}
export function removeGlossary(host: VocabHost, projectId: string, from: string): GlossaryEntry[] {
  const g = glossary(host, projectId).filter((e) => e.from !== from.trim().toLowerCase());
  host.setSetting(`glossary:${projectId}`, JSON.stringify(g));
  return g;
}

/** A user rename is a ruling on vocabulary: the agent's word that left the name → the user's word that entered it. */
export function learnFromRename(host: VocabHost, projectId: string, oldTitle: string, newTitle: string): GlossaryEntry | null {
  const a = contentWords(oldTitle), b = contentWords(newTitle);
  const left = a.filter((w) => !b.includes(w)), entered = b.filter((w) => !a.includes(w));
  if (left.length === 1 && entered.length === 1) { addGlossary(host, projectId, left[0], entered[0], 'rename'); return { from: left[0], to: entered[0], at: '', how: 'rename' }; }
  return null;
}

/** "glossary: X instead of Y" / "call it X, not Y" / "X not Y" → entry from Y to X. */
export function parseGlossaryLine(line: string): { from: string; to: string } | null {
  const s = line.replace(/^\s*(?:-\s*)?glossary:\s*/i, '').trim();
  const m = s.match(/^["“]?([^"”,]+?)["”]?\s+(?:instead of|not|rather than|over)\s+["“]?([^"”]+?)["”]?\s*\.?$/i) ?? s.match(/^(?:say|call it|use|we say)\s+["“]?([^"”,]+?)["”]?,?\s+not\s+["“]?([^"”]+?)["”]?\s*\.?$/i);
  return m ? { to: m[1].trim(), from: m[2].trim() } : null;
}

/** The block every agent receives through the system card. */
export function vocabBlock(host: VocabHost, projectId: string): string {
  const words = userWords(host, projectId, 60, 2);
  const g = glossary(host, projectId);
  if (!words.length && !g.length) return '';
  const parts: string[] = [];
  if (words.length) parts.push(`THE USER'S OWN WORDS (counted from what they typed on this map — when the user has a word for a thing, use it; never swap it for a synonym; a node born from the user's sentence keeps the user's noun in its name):\n${words.map((w) => w.word).join(', ')}`);
  if (g.length) parts.push(`GLOSSARY (the user's corrections — binding): ${g.map((e) => `say "${e.to}", not "${e.from}"`).join(' · ')}`);
  return parts.join('\n');
}

/** Mechanical guard on an agent-written title: glossary "from" words become the user's words. */
export function guardTitle(host: VocabHost, projectId: string, title: string): { title: string; changed: string[] } {
  const g = glossary(host, projectId);
  if (!g.length || !title) return { title, changed: [] };
  let out = title; const changed: string[] = [];
  for (const e of g) {
    const re = new RegExp(`\\b${e.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(out)) { out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() && m.length > 1 ? e.to[0].toUpperCase() + e.to.slice(1) : e.to)); changed.push(`${e.from}→${e.to}`); }
  }
  return { title: out, changed };
}

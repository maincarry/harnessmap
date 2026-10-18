// The record test's mechanical half (2026-10-18, after the first regression read on v0.9.305: two "wrong" map answers took a hand
// read to tell apart — one was a WRONG RECORD ("the modem's average" where the person said "one-hour average"), the other the brain
// reading an intact record differently). Jacob's rule: a wrong node is a wrong record. So every miss must say which it is, by machine:
//   keySpecifics(key, quote)  → the specifics the key is made of: numbers with their units, identifiers, file names, hex addresses
//   specificsInRecord(db, …)  → which of them appear in the snapshot's live nodes (title + content), case- and space-insensitive
// A miss with a specific ABSENT from the record is a RECORD GAP (the map never kept it — nothing the brain could do); a miss whose
// specifics are all IN the record is either the brain misreading an intact record or the record distorting it (a qualifier the
// person never said — Q2 of Amir's day: "the modem's average") — the machine cannot tell those two apart, a hand read does; a key with
// no specifics is UNCLASSIFIED (judgment keys: "what did we conclude about…"). No model call anywhere in this file.
import { Database } from 'bun:sqlite';

const UNIT = '(?:µA|uA|mA|A|mV|V|kΩ|Ω|ms|µs|us|ns|s|sec|min|h|hours?|days?|KB|MB|GB|kB|B|Hz|kHz|MHz|%|°C|mm|cm|m|km|px)';

export function keySpecifics(key: string, quote = ''): string[] {
  const text = `${key} ${quote}`;
  const out = new Set<string>();
  const add = (s: string) => { const t = s.trim(); if (t.length >= 2) out.add(t); };
  // numbers with a unit ("1.1 mA", "8.192 seconds", "90 s", "500mA", "40 ms", "2 s", "15%")
  for (const m of text.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?${UNIT}(?![A-Za-z])`, 'g'))) add(m[0].replace(/\s+/g, ' '));
  // hex addresses and long plain numbers (0x0803E000, 2400, 2182)
  for (const m of text.matchAll(/\b0x[0-9A-Fa-f]{3,}\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b\d{3,}(?:[.,]\d+)?\b/g)) if (!/^(19|20)\d\d$/.test(m[0])) add(m[0]);
  // file names (lte.c, node-b.ld, main.py, config.yaml)
  for (const m of text.matchAll(/\b[\w-]+\.(?:c|h|cpp|hpp|ld|py|ts|js|tsx|jsx|json|ya?ml|toml|md|sh|sql|rs|go|java|kt|swift|cs|rb|php|ini|cfg|env)\b/g)) add(m[0]);
  // identifiers: snake_case / CamelCase with an inner capital / ALLCAPS of four or more / backticked tokens
  for (const m of text.matchAll(/`([^`]{2,60})`/g)) add(m[1]);
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b[a-z]+[A-Z][A-Za-z0-9]+\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{3,}\b/g)) if (!/^(THE|AND|NOT|WITH|FROM|THAT|THIS|WHAT|WHEN|THEN|ONLY|INTO|OVER|NONE|TRUE|FALSE|NULL|JSON|HTTP|HTTPS|TODO|NOTE)$/.test(m[0])) add(m[0]);
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, '').replace(/[,]/g, '.').replace(/µ/g, 'u');

export function loadRecordText(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query(`select title, content from nodes where status is null or status != 'removed'`).all() as { title: string | null; content: string | null }[];
    return norm(rows.map((r) => `${r.title ?? ''} ${r.content ?? ''}`).join('\n'));
  } finally { db.close(); }
}

export function specificsInRecord(recordText: string, specifics: string[]): { present: string[]; absent: string[] } {
  const present: string[] = []; const absent: string[] = [];
  for (const s of specifics) (recordText.includes(norm(s)) ? present : absent).push(s);
  return { present, absent };
}

export type MissKind = 'record-gap' | 'in-record' | 'unclassified';
export function classifyMiss(verdict: string, rec: { present: string[]; absent: string[] }): MissKind | null {
  if (verdict === 'right') return null;
  if (rec.present.length + rec.absent.length === 0) return 'unclassified';
  return rec.absent.length ? 'record-gap' : 'in-record';
}

// CLI: bun run src/eval/record-specifics.ts <scenario>.qa.json <snapshot.sqlite> [results.json]  — re-reads a past run without a model call
if (import.meta.main) {
  const [qaPath, dbPath, resultsPath] = process.argv.slice(2);
  if (!qaPath || !dbPath) { console.error('usage: record-specifics.ts <qa.json> <snapshot.sqlite> [results.json]'); process.exit(2); }
  const { readFileSync } = await import('node:fs');
  const qa = JSON.parse(readFileSync(qaPath, 'utf8')); const questions: any[] = qa.questions ?? qa;
  const grades: any[] | null = resultsPath ? (JSON.parse(readFileSync(resultsPath, 'utf8')).sides.find((s: any) => s.name === 'map')?.grades ?? null) : null;
  const text = loadRecordText(dbPath);
  const counts: Record<string, number> = { 'record-gap': 0, 'in-record': 0, unclassified: 0 };
  questions.forEach((q, i) => {
    const sp = keySpecifics(q.answer, q.quote); const rec = specificsInRecord(text, sp);
    const verdict = grades?.[i]?.verdict ?? '?'; const kind = classifyMiss(verdict, rec); if (kind) counts[kind]++;
    console.log(`Q${i + 1} [${q.kind}] ${verdict}${kind ? ` → ${kind}` : ''} · in record ${rec.present.length}/${sp.length}${rec.absent.length ? ` · absent: ${rec.absent.join(', ')}` : ''}`);
  });
  if (grades) console.log(`misses: ${counts['record-gap']} record gap, ${counts['in-record']} in record (brain misread or record distortion), ${counts.unclassified} unclassified`);
}

// M552 (flutter-vue-zh 2026-10-26): the title healer snapshots a node, asks the title model, then re-reads the node and drops the title when
// the statement changed meanwhile (M306 — a round may have rewritten it). On that map the only change between snapshot and write was the
// auto-placer stripping the "(arrived while focus was: …)" note from the content; the computed title still fit, but the healer called it
// stale, never retried, and the evidence row stayed titleless. The note is not part of the statement: two contents that differ only by it
// are the same statement.
export const PROV_TAIL = /\s*[（(]arrived while focus was:(?:[^()（）]|\([^()（）]*\)|（[^()（）]*）)*[)）]\s*$/;
export const sameStatement = (a: string, b: string): boolean => a.replace(PROV_TAIL, '').trim() === b.replace(PROV_TAIL, '').trim();

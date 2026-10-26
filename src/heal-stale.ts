// M552 (flutter-vue-zh 2026-10-26): the title healer snapshots a node, asks the title model, then re-reads the node and drops the title when
// the statement changed meanwhile (M306 — a round may have rewritten it). On that map the only change between snapshot and write was the
// auto-placer stripping the "(arrived while focus was: …)" note from the content; the computed title still fit, but the healer called it
// stale, never retried, and the evidence row stayed titleless. The note is not part of the statement: two contents that differ only by it
// are the same statement.
export const PROV_TAIL = /\s*[（(]arrived while focus was:(?:[^()（）]|\([^()（）]*\)|（[^()（）]*）)*[)）]\s*$/;
export const sameStatement = (a: string, b: string): boolean => a.replace(PROV_TAIL, '').trim() === b.replace(PROV_TAIL, '').trim();
// M558 (libzip-zh 2026-10-26, the untitled-row watch): a titleless node is shown by its content, and brokenTitles asked longName(content) —
// >6 whitespace words, >48 chars or a 19+ Latin token. A Chinese sentence of 30–46 chars has no spaces and stays under 48, so the healer
// never named it; all six untitled non-seed rows across 171 kept e2e maps were exactly that. A titleless node whose content carries
// twelve or more Han characters is a sentence shown as a name — it needs one. Titled nodes keep the old rule (a Han title over the
// threshold would otherwise be re-healed every sweep — the M301/M393 loop).
export const hanSentence = (content: string, min = 12): boolean => ((content.match(/\p{Script=Han}/gu) ?? []).length >= min);
export const needsName = (title: string | null | undefined, content: string): boolean => !title && hanSentence(content);

// Finishing step of the narration guard (M305b/M326/M331/M340 family in translator.ts).
// Bug fixed 2026-10-04 (loop find, node-xlsx-zh #151 + sweep of 105 kept maps: 51 of 64 "narration_trim" audits were
// case-only): the sentence-case step ran UNCONDITIONALLY, so any content that merely BEGAN with a lowercase identifier was
// rewritten — "node-xlsx" → "Node-xlsx", "os/exec" → "Os/exec", "time.time()" → "Time.time()", "nginx", "curl", "cx_Freeze",
// "three.js", "activity_main.xml" … — and booked as a narration trim. The spacing tidy also ate the space before ".NET".
// Rule now: when no narration was removed the text is left EXACTLY as written; after a real trim the remainder is tidied and
// sentence-cased, but a first token that looks like an identifier (contains / . - _ ( ) @ or a digit) keeps its case.
export function finishNarrationTrim(src: string, core: string): string {
  if (core === src) return src;
  let t = core
    .replace(/([:;,—-])\s*[;,.]\s*/g, '$1 ')
    .replace(/\s+([;,.])(?![\p{L}\p{N}])/gu, '$1') // tighten " ." / " ," — but not " .NET", " .env"
    .replace(/^\s*[:;,—-]+\s*/, '').replace(/\s*[:;,—-]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/(^|[.!?]\s+)([a-z])(\S*)/g, (m, a, b, rest) => (/[\/._\-\d()@]/.test(rest) ? m : a + b.toUpperCase() + rest));
  if (t && /[.!?]$/.test(src) && !/[.!?]$/.test(t)) t += '.';
  return t;
}

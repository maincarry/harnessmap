// M222: nothing tracked may be conversation history, a run artifact, a log, a database, or a key.
// Run: bun run src/eval/repo-hygiene.ts   (install-smoke runs it too)
const files = (await new Response(Bun.spawn(['git', 'ls-files'], { stdout: 'pipe' }).stdout).text()).trim().split('\n');
const badPath = /^docs\/archive\/|raw-source-|transcript|\.jsonl$|\.log$|\.sqlite|ckpt.*\.json$|checkpoint.*\.json$|src\/eval\/.*segment.*\.json$|^backups\//i;
let bad = 0;
for (const f of files) {
  if (badPath.test(f)) { console.log('✗ tracked history/artifact:', f); bad++; continue; }
  if (!/\.(json|md|txt|ts|html|csv)$/.test(f)) continue;
  const text = await Bun.file(f).text().catch(() => '');
  if (/sk-ant-(api|oat)[0-9]{2}-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}/.test(text)) { console.log('✗ key-like string in', f); bad++; }
  if ((text.match(/^(USER|ASSISTANT): /gm) ?? []).length > 8 || /"(userText|assistantText|last_assistant_message|transcript_path)"\s*:/.test(text)) { console.log('✗ reads like a transcript:', f); bad++; }
}
console.log(bad ? `repo hygiene: ${bad} problem(s)` : `repo hygiene: clean (${files.length} tracked files)`);
process.exit(bad ? 1 : 0);

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
// M376: no Windows console-window flashes may creep back. Every production child-process spawn (hooks/, src/,
// NOT src/eval which never runs on a user's machine) must pass windowsHide:true — a missing one flashes a console
// on Windows (Mark, 0.9.81/0.9.82). The one exception is the embedded terminal's ConPTY spawns, which carry a
// `terminal:` option and are a real, intentional console. This guard turns "a new spawn forgot windowsHide" from
// a bug found on a founder's box into a failed build. (elite_mw asked for the durable plan, 2026-09-26.)
for (const f of files) {
  if (!/^(hooks\/|src\/)/.test(f) || !f.endsWith('.ts') || f.startsWith('src/eval/')) continue;
  const text = await Bun.file(f).text().catch(() => '');
  for (const m of text.matchAll(/Bun\.spawn(Sync)?\s*\(/g)) {
    const start = m.index ?? 0;
    const win = text.slice(start, start + 700); // options object follows within this window
    if (/\bterminal\s*:/.test(win)) continue; // ConPTY / embedded terminal — intentionally visible
    if (!/windowsHide\s*:\s*true/.test(win)) {
      const line = text.slice(0, start).split('\n').length;
      console.log(`✗ spawn without windowsHide:true — ${f}:${line}`); bad++;
    }
  }
}
console.log(bad ? `repo hygiene: ${bad} problem(s)` : `repo hygiene: clean (${files.length} tracked files)`);
process.exit(bad ? 1 : 0);

// Post-cut for the demo: read markers.json, keep every scene at 1×, speed up the inference waits
// (observe→filed, tidy proposing, talk answered) to ~6×, cap any single segment, concat, encode mp4 ≤ ~24 MB.
import { readFileSync, writeFileSync, statSync } from 'fs';
const S = '/tmp/claude-1000/-home-claude-projects/a378a2d1-187b-4e76-a128-1f1d823f8d6f/scratchpad/demo';
const FF = '/tmp/claude-1000/ffm/node_modules/ffmpeg-static/ffmpeg';
const { marks } = JSON.parse(readFileSync(`${S}/markers.json`, 'utf8')) as { marks: { name: string; t: number }[] };
const t = (n: string) => marks.find((m) => m.name === n)?.t;
const end = t('end') ?? marks[marks.length - 1].t;
// fast windows: [from, to, factor]
const fast: [number | undefined, number | undefined, number][] = [
  [t('observe:post'), t('observe:filed'), 6],
  [t('tidy:proposing'), t('tidy:proposed'), 6],
  [t('talk:asked'), t('talk:answered'), 6],
];
const cuts: { a: number; b: number; f: number }[] = [];
let cur = 0;
for (const [a, b, f] of fast.filter((w) => w[0] != null && w[1] != null && w[1]! > w[0]!).sort((x, y) => x[0]! - y[0]!)) {
  if (a! > cur) cuts.push({ a: cur, b: a!, f: 1 });
  // keep the first 2.5 s of a wait at 1× (the caption reads), then speed the rest; cap the fast part at 12 s of output
  const head = Math.min(2.5, b! - a!); cuts.push({ a: a!, b: a! + head, f: 1 });
  const restIn = b! - a! - head; if (restIn > 0.5) { const factor = Math.max(f, restIn / 12); cuts.push({ a: a! + head, b: b!, f: factor }); }
  cur = b!;
}
if (end > cur) cuts.push({ a: cur, b: end, f: 1 });
const outDur = cuts.reduce((s, c) => s + (c.b - c.a) / c.f, 0);
console.log(`segments ${cuts.length} · output ≈ ${outDur.toFixed(1)} s (raw ${end.toFixed(1)} s)`);
const parts = cuts.map((c, i) => `[0:v]trim=start=${c.a.toFixed(3)}:end=${c.b.toFixed(3)},setpts=(PTS-STARTPTS)/${c.f.toFixed(3)}[v${i}]`).join(';');
const concat = cuts.map((_, i) => `[v${i}]`).join('') + `concat=n=${cuts.length}:v=1:a=0,fps=30,scale=1280:720:flags=lanczos,format=yuv420p[out]`;
const filter = `${parts};${concat}`;
writeFileSync(`${S}/filter.txt`, filter);
const run = (args: string[]) => { const p = Bun.spawnSync([FF, ...args], { stdout: 'pipe', stderr: 'pipe' }); if (p.exitCode !== 0) { console.log(new TextDecoder().decode(p.stderr).split('\n').slice(-12).join('\n')); process.exit(1); } };
run(['-y', '-hide_banner', '-loglevel', 'error', '-i', `${S}/raw.webm`, '-filter_complex_script', `${S}/filter.txt`, '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart', `${S}/harnessmap-demo.mp4`]);
const mb = statSync(`${S}/harnessmap-demo.mp4`).size / 1048576; console.log(`mp4 ${mb.toFixed(1)} MB`);
if (mb > 24) { run(['-y', '-hide_banner', '-loglevel', 'error', '-i', `${S}/harnessmap-demo.mp4`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '29', '-vf', 'scale=1120:630', '-movflags', '+faststart', `${S}/harnessmap-demo-small.mp4`]); console.log(`small ${(statSync(`${S}/harnessmap-demo-small.mp4`).size / 1048576).toFixed(1)} MB`); }

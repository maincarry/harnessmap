// The edit for the single take, in two light passes so it fits a small box:
//   pass 1: each 'keep' range is cut out of the 2x take into its own 1920x1280 file (one decoder at a time);
//   pass 2: the pieces are crossfaded in order and the score is laid under them.
//   FFMPEG=<full ffmpeg> bun run demo/cut2.ts <OUT>   (reads <OUT>/take/*.webm + <OUT>/cues.json + <OUT>/music.wav → <OUT>/cut/)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const OUT = resolve(process.argv[2]); const FF = process.env.FFMPEG || 'ffmpeg';
const cutDir = join(OUT, 'cut'); mkdirSync(cutDir, { recursive: true });
const takeDir = join(OUT, 'take');
const src = readdirSync(takeDir).filter((f) => f.endsWith('.webm')).map((f) => join(takeDir, f)).sort((a, b) => Bun.file(b).size - Bun.file(a).size)[0];
const cues = JSON.parse(readFileSync(join(OUT, 'cues.json'), 'utf8')) as any[];
const keeps = cues.filter((c) => c.k === 'keep' && c.to - c.from > 0.5).map((c) => ({ from: +c.from, to: +c.to, label: c.label as string }));
const sent = cues.find((c) => c.k === 'mc-sent')?.at, ansFrom = cues.find((c) => c.k === 'answer-from')?.from, answered = cues.find((c) => c.k === 'mc-answered');
const segs: { from: number; to: number; label: string }[] = [];
for (const k of keeps) {
  if (k.label === 'ask' && sent && ansFrom && ansFrom - sent > 3) {
    segs.push({ from: k.from, to: sent + 1.2, label: 'ask' });
    if (answered) segs.push({ from: ansFrom, to: Math.min(k.to, ansFrom + 9), label: 'answer' }); // no answer → the question alone, honestly short
  } else segs.push(k);
}
const D = 0.5, W = Number(process.env.CUT_W || 1920), H = Math.round(W * 2 / 3);
const lens = segs.map((s) => s.to - s.from);
const total = lens.reduce((a, b) => a + b, 0) - D * (segs.length - 1);
writeFileSync(join(cutDir, 'edl.txt'), segs.map((s, i) => `${String(i).padStart(2, '0')} ${s.label.padEnd(20)} ${s.from.toFixed(2)}–${s.to.toFixed(2)} (${lens[i].toFixed(1)}s)`).join('\n') + `\n\ntotal ${total.toFixed(1)}s\n`);
console.log(readFileSync(join(cutDir, 'edl.txt'), 'utf8'));
const run = async (args: string[], label: string) => { const p = Bun.spawn([FF, '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', ...args], { stdout: 'inherit', stderr: 'inherit' }); const code = await p.exited; if (code !== 0) console.log(label, `exit ${code}`); return code; };
// pass 1
const parts: string[] = [];
for (let i = 0; i < segs.length; i++) {
  const s = segs[i]; const part = join(cutDir, `seg${String(i).padStart(2, '0')}.mp4`); parts.push(part);
  if (existsSync(part) && process.env.REUSE) continue;
  await run(['-ss', s.from.toFixed(3), '-to', s.to.toFixed(3), '-i', src, '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', part], `seg ${i}`);
}
// pass 2
const f: string[] = [];
parts.forEach((_, i) => f.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`));
let last = 'v0', off = 0;
for (let i = 1; i < parts.length; i++) { off += lens[i - 1] - D; const o = `x${i}`; f.push(`[${last}][v${i}]xfade=transition=fade:duration=${D}:offset=${off.toFixed(3)}[${o}]`); last = o; }
f.push(`[${last}]fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[vout]`);
f.push(`[${parts.length}:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=2,afade=t=out:st=${(total - 6).toFixed(2)}:d=6,volume=0.9[aout]`);
writeFileSync(join(cutDir, 'graph.txt'), f.join(';\n'));
const inputs = parts.flatMap((p) => ['-i', p]); inputs.push('-i', join(OUT, 'music.wav'));
const common = [...inputs, '-filter_complex_script', join(cutDir, 'graph.txt'), '-map', '[vout]', '-map', '[aout]', '-shortest'];
const code = await run([...common, '-c:v', 'libx264', '-preset', 'medium', '-crf', Number(process.env.CRF || 20).toString(), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(cutDir, 'harnessmap-demo.mp4')], 'mp4');
console.log('mp4', code === 0 ? 'ok' : 'failed');
if (process.env.WEBM) await run([...common, '-c:v', 'libvpx-vp9', '-b:v', '1400k', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', join(cutDir, 'harnessmap-demo.webm')], 'webm');

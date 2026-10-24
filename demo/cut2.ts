// The edit for the single take: keep the 'keep' ranges from cues.json, crossfade between them, lay the score.
//   FFMPEG=<full ffmpeg> bun run demo/cut2.ts <OUT>        (reads <OUT>/take/*.webm + <OUT>/cues.json + <OUT>/music.wav → <OUT>/cut/)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const OUT = resolve(process.argv[2]); const FF = process.env.FFMPEG || 'ffmpeg';
const cutDir = join(OUT, 'cut'); mkdirSync(cutDir, { recursive: true });
const takeDir = join(OUT, 'take');
const vids = readdirSync(takeDir).filter((f) => f.endsWith('.webm')).map((f) => join(takeDir, f)).sort((a, b) => Bun.file(b).size - Bun.file(a).size);
const src = vids[0];
const cues = JSON.parse(readFileSync(join(OUT, 'cues.json'), 'utf8')) as any[];
const keeps = cues.filter((c) => c.k === 'keep' && c.to - c.from > 0.5).map((c) => ({ from: +c.from, to: +c.to, label: c.label as string }));
// the answer beat: drop the thinking time inside 'ask' (from mc-sent+1.2 to answer-from)
const sent = cues.find((c) => c.k === 'mc-sent')?.at, ansFrom = cues.find((c) => c.k === 'answer-from')?.from;
const segs: { from: number; to: number; label: string }[] = [];
for (const k of keeps) { if (k.label === 'ask' && sent && ansFrom && ansFrom - sent > 3) { segs.push({ from: k.from, to: sent + 1.2, label: 'ask' }); segs.push({ from: ansFrom, to: k.to, label: 'answer' }); } else segs.push(k); }
const D = 0.5; // crossfade
const lens = segs.map((s) => s.to - s.from);
const total = lens.reduce((a, b) => a + b, 0) - D * (segs.length - 1);
writeFileSync(join(cutDir, 'edl.txt'), segs.map((s, i) => `${String(i).padStart(2, '0')} ${s.label.padEnd(20)} ${s.from.toFixed(2)}–${s.to.toFixed(2)} (${lens[i].toFixed(1)}s)`).join('\n') + `\n\ntotal ${total.toFixed(1)}s\n`);
console.log(readFileSync(join(cutDir, 'edl.txt'), 'utf8'));
const W = Number(process.env.CUT_W || 1920), H = Math.round(W * 2 / 3);
const f: string[] = [];
segs.forEach((s, i) => f.push(`[0:v]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p[v${i}]`));
let last = 'v0', off = 0;
for (let i = 1; i < segs.length; i++) { off += lens[i - 1] - D; const o = `x${i}`; f.push(`[${last}][v${i}]xfade=transition=fade:duration=${D}:offset=${off.toFixed(3)}[${o}]`); last = o; }
f.push(`[${last}]fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[vout]`);
f.push(`[1:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=2,afade=t=out:st=${(total - 6).toFixed(2)}:d=6,volume=0.9[aout]`);
writeFileSync(join(cutDir, 'graph.txt'), f.join(';\n'));
const common = ['-i', src, '-i', join(OUT, 'music.wav'), '-filter_complex_script', join(cutDir, 'graph.txt'), '-map', '[vout]', '-map', '[aout]', '-shortest'];
const run = async (args: string[], label: string) => { const p = Bun.spawn([FF, '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdout: 'inherit', stderr: 'inherit' }); const code = await p.exited; console.log(label, code === 0 ? 'ok' : `exit ${code}`); };
await run([...common, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(cutDir, 'harnessmap-demo.mp4')], 'mp4');
if (process.env.WEBM) await run([...common, '-c:v', 'libvpx-vp9', '-b:v', '1400k', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', join(cutDir, 'harnessmap-demo.webm')], 'webm');

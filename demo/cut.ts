// The edit. Builds the three-minute cut from the recordings and their cue files, the title cards and the score.
//   bun run demo/cut.ts <recA dir> <recB dir> <recC dir> <cards dir> <music.wav> <out dir>
// Needs a full ffmpeg (libx264, libvpx-vp9, concat, trim); set FFMPEG to its path.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [A, B, C, CARDS, MUSIC, OUT] = process.argv.slice(2).map((p) => resolve(p));
const FF = process.env.FFMPEG || 'ffmpeg';
mkdirSync(OUT, { recursive: true });
const webm = (dir: string, pick: 'largest' | 'smallest' = 'largest') => { const fs = readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => join(dir, f)); fs.sort((a, b) => Bun.file(b).size - Bun.file(a).size); return pick === 'largest' ? fs[0] : fs[fs.length - 1]; };
const cues = (dir: string) => JSON.parse(readFileSync(join(dir, 'cues.json'), 'utf8')) as { at: number; k: string; [k: string]: any }[];
const cA = cues(A), cB = cues(B), cC = cues(C);
const at = (cs: any[], k: string, i = 0) => cs.filter((c) => c.k === k)[i]?.at as number | undefined;
const vA = webm(A), vB = webm(B), vC = (cC.find((c) => c.k === 'companion-video')?.path as string) || webm(C, 'smallest');
type Seg = { kind: 'v'; src: string; from: number; to: number; label: string } | { kind: 'card'; png: string; dur: number; label: string; fade?: boolean };
const segs: Seg[] = [];
const card = (id: string, dur: number) => segs.push({ kind: 'card', png: join(CARDS, `${id}.png`), dur, label: id, fade: true });
const clip = (src: string, from: number, to: number, label: string) => { if (to - from > 0.4) segs.push({ kind: 'v', src, from: Math.max(0, from), to, label }); };

// 1. the problem
card('card1', 5); card('card1b', 8); card('card2', 5);
// 2. the map filing live: each landed turn, three seconds before and four and a half after
const landed = cA.filter((c) => c.k === 'landed');
const landedAt = (round: number) => landed.find((c) => (c.rounds as number[]).includes(round))?.at;
for (let r = 1; r <= 7; r++) { const t = landedAt(r); if (t !== undefined) clip(vA, t - 3, t + 4.5, `round ${r}`); }
// 3. three days later: the new session's turn, the chat agent's view, the rule landing, the next step
card('card3', 4);
{ const t = landedAt(8); if (t !== undefined) clip(vA, t - 2.5, t + 4, 'round 8'); }
{ const o = at(cB, 'ctx-open'), c = at(cB, 'ctx-close'); if (o !== undefined && c !== undefined) clip(vB, o - 0.8, Math.min(c, o + 11), 'chat agent view'); }
{ const t = landedAt(9); if (t !== undefined) clip(vA, t - 2.5, t + 4.5, 'round 9'); }
{ const t = landedAt(10); if (t !== undefined) clip(vA, t - 2, t + 3.5, 'round 10'); }
// 4. the companion
{ const o = at(cC, 'companion-open'); if (o !== undefined) clip(vC, o - 0.3, o + 12, 'companion'); }
// 5. talk to the map: the question going in, then the answer (the thinking time cut)
{ const o = at(cB, 'mc-open'), s = at(cB, 'mc-sent'), a = at(cB, 'mc-answered'), c = at(cB, 'mc-close');
  if (o !== undefined && s !== undefined && c !== undefined) { if (a !== undefined && a - s > 2.5) { clip(vB, o - 0.8, s + 1.2, 'ask'); clip(vB, a - 0.3, c, 'answer'); } else clip(vB, o - 0.8, c, 'ask+answer'); } }
// 6. the galaxy, a glimpse
{ const o = at(cB, 'galaxy-open'); if (o !== undefined) clip(vB, o + 0.6, o + 8.6, 'galaxy'); }
// 7. why now, install, the line, the logo
card('card4', 4); card('card4b', 10); card('card5', 9);

const total = segs.reduce((a, s) => a + (s.kind === 'v' ? s.to - s.from : s.dur), 0);
const edl = segs.map((s, i) => `${String(i).padStart(2, '0')}  ${s.label.padEnd(16)} ${s.kind === 'v' ? `${s.src.split('/').pop()}  ${s.from.toFixed(2)}–${s.to.toFixed(2)}` : `card ${s.dur}s`}`).join('\n');
writeFileSync(join(OUT, 'edl.txt'), edl + `\n\ntotal ${total.toFixed(1)}s\n`);
console.log(edl); console.log('total', total.toFixed(1), 's');

// ffmpeg graph
const inputs: string[] = []; const filters: string[] = []; const labels: string[] = [];
segs.forEach((s, i) => {
  if (s.kind === 'v') { inputs.push('-i', s.src); filters.push(`[${i}:v]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=PTS-STARTPTS,fps=25,scale=1440:960,format=yuv420p[v${i}]`); }
  else { inputs.push('-loop', '1', '-t', String(s.dur), '-framerate', '25', '-i', s.png); filters.push(`[${i}:v]fps=25,scale=1440:960,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${(s.dur - 0.5).toFixed(2)}:d=0.5,setpts=PTS-STARTPTS[v${i}]`); }
  labels.push(`[v${i}]`);
});
const mi = segs.length; inputs.push('-i', MUSIC);
filters.push(`${labels.join('')}concat=n=${segs.length}:v=1:a=0[vout]`);
filters.push(`[${mi}:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=1.5,afade=t=out:st=${(total - 5).toFixed(2)}:d=5,volume=0.9[aout]`);
const graph = filters.join(';\n');
writeFileSync(join(OUT, 'graph.txt'), graph);
const common = [...inputs, '-filter_complex_script', join(OUT, 'graph.txt'), '-map', '[vout]', '-map', '[aout]', '-shortest'];
const run = async (args: string[], label: string) => { const p = Bun.spawn([FF, '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdout: 'inherit', stderr: 'inherit' }); const code = await p.exited; console.log(label, code === 0 ? 'ok' : `exit ${code}`); return code; };
await run([...common, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(OUT, 'harnessmap-demo.mp4')], 'mp4');
await run([...common, '-c:v', 'libvpx-vp9', '-b:v', '900k', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', join(OUT, 'harnessmap-demo.webm')], 'webm');
// captions as a sidecar too (what the frame burned in), one line per segment
const srt = segs.map((s) => s.label).join('\n');
writeFileSync(join(OUT, 'segments.txt'), srt);

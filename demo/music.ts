// A score for the demo, composed in code so it carries no licence and follows the cut.
//   bun run demo/music.ts <out.wav> [seconds=180]
// 96 BPM, D major, I–V–vi–IV. Sections follow the storyboard: a quiet pad under the problem (0:00–0:20), the groove
// enters when the map starts filing (0:20), a breath at "three days later" (1:10), the groove widens (1:16–2:20),
// a breath and a build under "why now" (2:20–2:45), the tonic held and a fade on the logo (2:45–3:00).
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || '/tmp/claude-1000/demo-music.wav';
const DUR = Number(process.argv[3] || 180);
const SR = 44100, BPM = 96, BEAT = 60 / BPM, BAR = 4 * BEAT;
const N = Math.floor(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const sec = (t: number) => t;
// sections in seconds
// sections in seconds; the edit passes its own boundaries (MUSIC_SECTIONS, JSON) so the score lands on the cuts
const DEFAULT_S = { intro: [0, 20], groove1: [20, 70], breath1: [70, 76], groove2: [76, 140], breath2: [140, 146], build: [146, 165], outro: [165, 180] };
const S: Record<keyof typeof DEFAULT_S, readonly [number, number]> = { ...DEFAULT_S, ...(process.env.MUSIC_SECTIONS ? JSON.parse(process.env.MUSIC_SECTIONS) : {}) } as any;
const inRange = (t: number, r: readonly [number, number]) => t >= r[0] && t < r[1];
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// chords (midi roots in the bass octave) D A Bm G  → D2=38, A2=45(→A1=33), B2=47(→B1=35), G2=43(→G1=31)
const CHORDS = [
  { root: 38, notes: [62, 66, 69, 74] },      // D  : D4 F#4 A4 D5
  { root: 33, notes: [61, 64, 69, 73] },      // A  : C#4 E4 A4 C#5
  { root: 35, notes: [62, 66, 71, 74] },      // Bm : D4 F#4 B4 D5
  { root: 31, notes: [59, 62, 67, 71] },      // G  : B3 D4 G4 B4
];
const chordAt = (t: number) => CHORDS[Math.floor(t / BAR) % 4];
const env = (t: number, a: number, d: number, s: number, r: number, gate: number) => { // simple ADSR, t within note, gate = note length
  if (t < 0) return 0; if (t < a) return t / a; if (t < a + d) return 1 - (1 - s) * ((t - a) / d); if (t < gate) return s; const x = t - gate; return x < r ? s * (1 - x / r) : 0; };
const lp = { l: 0, r: 0 };
const noise = () => Math.random() * 2 - 1;
let hatSeed = 1;
const sectionGain = (t: number) => { // overall dynamics by section, with 1.2 s ramps
  const g = inRange(t, S.intro) ? 0.55 : inRange(t, S.groove1) ? 0.9 : inRange(t, S.breath1) ? 0.6 : inRange(t, S.groove2) ? 1 : inRange(t, S.breath2) ? 0.6 : inRange(t, S.build) ? 1 : 0.85;
  return g; };
const groove = (t: number) => inRange(t, S.groove1) || inRange(t, S.groove2) || inRange(t, S.build);
const arpOn = (t: number) => groove(t) || inRange(t, S.intro) && t > 10;
let gSm = 0.5;
// pluck delay line (dotted eighth) for air
const DEL = Math.floor(BEAT * 0.75 * SR); const dl = new Float32Array(DEL), dr = new Float32Array(DEL); let di = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const ch = chordAt(t);
  const tb = t % BAR; const beat = Math.floor(tb / BEAT); const tbeat = tb % BEAT; const t16 = tb % (BEAT / 4); const s16 = Math.floor(tb / (BEAT / 4));
  let l = 0, r = 0;
  // PAD: four detuned saw-ish voices, slow attack, lowpassed; always on
  { const tin = t % BAR; const e = Math.min(1, tin / 0.8) * (1 - Math.max(0, (tin - BAR + 0.6)) / 0.6 * 0.5);
    let p = 0; for (let k = 0; k < ch.notes.length; k++) { const f = midi(ch.notes[k]); const ph = t * f; const ph2 = t * f * 1.004; p += (2 * (ph - Math.floor(ph)) - 1) * 0.5 + (2 * (ph2 - Math.floor(ph2)) - 1) * 0.5; }
    p = p / ch.notes.length * e * 0.11;
    const cutoff = 0.08 + 0.12 * Math.max(0, Math.min(1, (t - 20) / 60)); // opens slowly
    lp.l += cutoff * (p - lp.l); lp.r += cutoff * (p * 0.97 - lp.r);
    l += lp.l; r += lp.r; }
  // BASS: 8th notes on the root, sine + a little triangle, sidechained by the kick
  if (groove(t) || inRange(t, S.outro)) { const t8 = tb % (BEAT / 2); const e = env(t8, 0.004, 0.08, 0.6, 0.06, BEAT / 2 - 0.05); const f = midi(ch.root); const x = Math.sin(2 * Math.PI * f * t) * 0.8 + (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * 2 * t)) * 0.12; const duck = inRange(t, S.outro) ? 1 : (tbeat < 0.12 ? 0.35 + 0.65 * (tbeat / 0.12) : 1); const g = inRange(t, S.outro) ? 0.1 * Math.max(0, 1 - (t - S.outro[0]) / 12) : 0.17; l += x * e * duck * g; r += x * e * duck * g; }
  // ARP: plucked 16ths on chord tones, pattern up-down, triangle with fast decay
  if (arpOn(t)) { const pat = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 1, 2, 3, 1]; const stepLen = BEAT / 4; const idx = pat[s16 % 16]; const octave = inRange(t, S.build) ? 12 : 0; const f = midi(ch.notes[idx] + octave); const e = env(t16, 0.002, 0.14, 0.0, 0.02, stepLen); const x = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t)); const g = inRange(t, S.intro) ? 0.05 : inRange(t, S.build) ? 0.1 : 0.085; const pan = 0.5 + 0.35 * Math.sin(s16 * 1.3); l += x * e * g * (1 - pan) * 1.4; r += x * e * g * pan * 1.4; }
  // DRUMS: kick on 1 and 3 (and the "and" of 4 in the build), hat on 8ths (16ths in the build)
  if (groove(t)) { const kickHit = (beat === 0 || beat === 2) ? tbeat : (inRange(t, S.build) && beat === 3 && tbeat >= BEAT / 2 ? tbeat - BEAT / 2 : -1);
    if (kickHit >= 0 && kickHit < 0.25) { const kt = kickHit; const f = 50 + 110 * Math.exp(-kt * 28); const x = Math.sin(2 * Math.PI * f * kt) * Math.exp(-kt * 11); l += x * 0.42; r += x * 0.42; }
    const hatDiv = inRange(t, S.build) ? BEAT / 4 : BEAT / 2; const th = tb % hatDiv; if (th < 0.035) { hatSeed = (hatSeed * 1103515245 + 12345) & 0x7fffffff; const x = ((hatSeed / 0x7fffffff) * 2 - 1) * Math.exp(-th * 140); const open = Math.floor(tb / hatDiv) % 4 === 2 ? 1.6 : 1; l += x * 0.06 * open; r += x * 0.07 * open; } }
  // BREATHS: a soft swell (sine fifth) so the gaps are not empty
  if (inRange(t, S.breath1) || inRange(t, S.breath2)) { const r0 = inRange(t, S.breath1) ? S.breath1 : S.breath2; const x = Math.sin(Math.PI * (t - r0[0]) / (r0[1] - r0[0])); const f = midi(ch.notes[0] + 12); const y = Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.3; l += y * x * 0.05; r += y * x * 0.05; }
  // air: a dotted-eighth echo of the arp/pad mix
  const fbL = dl[di], fbR = dr[di]; dl[di] = l * 0.22 + fbL * 0.38; dr[di] = r * 0.22 + fbR * 0.38; di = (di + 1) % DEL; l += fbR * 0.7; r += fbL * 0.7;
  // section dynamics with a smooth ramp; the fade on the logo
  const target = sectionGain(t); gSm += (target - gSm) * 0.00004; let g = gSm;
  if (t > DUR - 6) g *= Math.max(0, (DUR - t) / 6);
  if (t < 1.5) g *= t / 1.5;
  l *= g; r *= g;
  // soft clip
  L[i] = Math.tanh(l * 1.6) * 0.9; R[i] = Math.tanh(r * 1.6) * 0.9;
}
// normalise to -1 dBFS peak
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const k = peak > 0 ? 0.89 / peak : 1;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * k * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * k * 32767))), 46 + i * 4); }
writeFileSync(out, buf);
console.log('wrote', out, `${DUR}s`, 'peak', peak.toFixed(3), 'sections', JSON.stringify(S));

import { readFileSync } from 'node:fs';

// Parse the raw-conversation corpus files (docs/ontology/example-*.md).
// Format inside the fenced block:  "T1  U: text..." with indented continuations.

export interface CorpusTurn {
  t: number;
  role: 'U' | 'A';
  text: string;
}

export interface Round {
  label: string;
  userText: string;
  assistantText: string;
}

export function parseCorpus(path: string): CorpusTurn[] {
  const md = readFileSync(path, 'utf8');
  const fence = md.match(/```\n([\s\S]*?)```/);
  if (!fence) throw new Error(`no fenced transcript in ${path}`);
  const turns: CorpusTurn[] = [];
  for (const line of fence[1].split('\n')) {
    const m = line.match(/^T(\d+)\s+([UA]):\s?(.*)$/);
    if (m) {
      turns.push({ t: Number(m[1]), role: m[2] as 'U' | 'A', text: m[3].trim() });
    } else if (line.trim() && turns.length > 0) {
      turns[turns.length - 1].text += ` ${line.trim()}`;
    }
  }
  return turns;
}

// Pair each user turn with the agent turn that answers it. Consecutive user
// turns become their own rounds (the translator handles empty counterparts).
export function toRounds(turns: CorpusTurn[]): Round[] {
  const rounds: Round[] = [];
  let i = 0;
  while (i < turns.length) {
    const cur = turns[i];
    if (cur.role === 'U') {
      const next = turns[i + 1];
      if (next && next.role === 'A') {
        rounds.push({ label: `T${cur.t}-T${next.t}`, userText: cur.text, assistantText: next.text });
        i += 2;
      } else {
        rounds.push({ label: `T${cur.t}`, userText: cur.text, assistantText: '(no agent reply yet)' });
        i += 1;
      }
    } else {
      rounds.push({ label: `T${cur.t}`, userText: '(no new user message)', assistantText: cur.text });
      i += 1;
    }
  }
  return rounds;
}

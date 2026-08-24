// M142 (Jacob + Mark): IMPORT — the first-impression reorganization. Takes a
// source (pasted text, a project document, or a past Claude Code session
// transcript) and proposes ONE well-organized subtree for the map: a new
// top-level container with structured children. Same contract as every
// restructuring: it is a PROPOSAL — the user sees the change list and the
// tree, talks back, and approves; apply goes through the normal pipeline
// (guards + undo included). Runs on the FANCY model (Jacob's ruling): this is
// the minute where a new user decides whether the product is magic.

import { Store } from '../store/db.js';
import { call, modelFor } from '../inference.js';
import { loadMap, renderTree } from '../map/render.js';
import { SCHEMA, normalizeIds } from './translator.js';
import { systemCard } from './cast.js';

const SYSTEM = `You are the IMPORT agent for a goal map made of NODES (one kind of thing: every line has content, an optional type, a status, and children — a topic is just a node whose children matter most). The user is importing OUTSIDE MATERIAL — a document, notes, or the transcript of a past AI conversation — and you turn it into ONE well-organized subtree they will approve onto their map.

Produce:
- summary: one sentence describing what the imported subtree contains.
- alterations: create_node operations ONLY. Never update, move, or remove anything — the existing map is read-only context for tone and vocabulary, not a target.

STRUCTURE RULES:
- ONE new top-level container holds the whole import: create it first (parentId null) with a short, recognizable name for what this material IS (title: 2-4 words). Everything else nests under it.
- ORGANIZE, don't transcribe: group the material into a few clear branches (topics → their decisions/questions/claims/evidence/tasks). A reader should grasp the whole import from the first two levels. Prefer 15-40 nodes; merge trivia into parent statements rather than emitting noise.
- Each node: content = a standalone statement of the fact/decision/question (NEVER "user asked X / assistant said Y" narration); use the FIXED TYPE SET (claim, question, option, decision, constraint, evidence, task) where a type fits, plain topic nodes otherwise; statuses honestly (decided things 'decided', open questions 'open', tentative material 'exploratory').
- From CONVERSATION transcripts: capture what the exchange ESTABLISHED — decisions made, questions opened or answered, constraints stated, options weighed, facts learned. Drop pleasantries, tool noise, and dead ends unless the dead end itself was informative.
- From DOCUMENTS: capture the document's actual structure and claims, not its formatting.
- If part of the material is genuinely unclassifiable, put it under one child branch named "unsorted from import" INSIDE your container — never outside it.
- Use short random strings for new ids; parentId chains must reference ids you created earlier in the list.`;

export interface ImportProposal { summary: string; alterations: any[]; rootId: string | null }

export async function proposeImport(
  store: Store, projectId: string, sourceLabel: string, text: string,
  feedback?: string, priorSummary?: string,
): Promise<ImportProposal | { error: string }> {
  const map = loadMap(store, projectId);
  const existing = renderTree(map, { ids: false });
  const capped = text.length > 60_000
    ? text.slice(0, 40_000) + `\n\n[… ${text.length - 60_000} characters omitted …]\n\n` + text.slice(-20_000)
    : text;
  try {
    const parsed = await call({
      task: 'import', system: SYSTEM + systemCard(store, projectId, 'the IMPORT agent'),
      maxTokens: 8000, schema: SCHEMA as any, timeoutMs: 300_000,
      audit: (k, d) => store.audit(k, d),
      user: [
        `THE MAP AS IT STANDS (read-only — match its vocabulary and tone, do not touch it):\n${existing || '(empty map)'}`,
        `SOURCE: ${sourceLabel}${text.length > 60_000 ? ` (long — middle omitted, ${text.length} chars total)` : ''}`,
        `MATERIAL TO IMPORT:\n${capped}`,
        ...(feedback ? [`THE USER SAW YOUR PREVIOUS PROPOSAL (${priorSummary ?? 'summarized'}) AND WANTS IT DIFFERENT: ${feedback}\nRebuild the whole subtree around their direction.`] : []),
        'Propose the import subtree.',
      ].join('\n\n'),
    });
    let alterations: any[] = normalizeIds(parsed.alterations ?? [], map).filter((a: any) => a.op === 'create_node');
    if (!alterations.length) return { error: 'the import agent produced no nodes' };
    // Exactly one root: the first parentless create is the container; any
    // other parentless strays are re-homed under it (never litter top level).
    const rootId = alterations.find((a: any) => !a.parentId)?.id ?? null;
    if (rootId) for (const a of alterations) { if (!a.parentId && a.id !== rootId) a.parentId = rootId; }
    // Parent refs must resolve within the batch (model-made ids).
    const ids = new Set(alterations.map((a: any) => a.id));
    for (const a of alterations) if (a.parentId && !ids.has(a.parentId)) a.parentId = rootId;
    return { summary: parsed.summary ?? `imported: ${sourceLabel}`, alterations, rootId };
  } catch (err) {
    console.error('[import] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

// Tolerant extractor for Claude Code session transcripts (JSONL): user and
// assistant text turns, tool noise dropped. Survives format drift by simply
// skipping lines it cannot read.
export function extractTranscript(jsonl: string): string {
  const out: string[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      const role = m.type === 'user' ? 'USER' : m.type === 'assistant' ? 'ASSISTANT' : null;
      if (!role || m.isMeta) continue;
      const content = m.message?.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      text = text.trim();
      if (text) out.push(`${role}: ${text}`);
    } catch { /* drifted line — skip */ }
  }
  return out.join('\n\n');
}

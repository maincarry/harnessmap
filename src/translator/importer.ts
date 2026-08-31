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

// ---------------------------------------------------------------------------
// M187 (Jacob's redesign, "lets just go for it"): LARGE IMPORT — filing at
// scale. Chunked with continuity (each call EXTENDS the subtree grown so
// far), node count scales with source density (the old 15-40 preference was
// a builder calibration, never a ruling), and DEPTH lives in the memory
// layer: every substantive node carries source detail + provenance, served
// later by tiered attention. One finish pass settles names and placement —
// renames and moves only; removal is structurally impossible there.

const v2 = (op: string, props: Record<string, unknown>, required: string[], optional: Record<string, unknown> = {}) => ({
  type: 'object' as const,
  properties: { op: { type: 'string' as const, enum: [op] }, ...props, ...optional },
  required: ['op', ...required],
  additionalProperties: false,
});
const s2 = { type: 'string' as const };

const IMPORT_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const },
    alterations: {
      type: 'array' as const,
      items: {
        anyOf: [
          v2('create_node', { id: s2, content: s2, status: s2, author: { type: 'string' as const, enum: ['user', 'agent'] } },
            ['id', 'content', 'status', 'author'], { parentId: s2, type: s2, title: s2, memory: s2 }),
        ],
      },
    },
  },
  required: ['summary', 'alterations'],
  additionalProperties: false,
};

const FINISH_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const },
    alterations: {
      type: 'array' as const,
      items: {
        anyOf: [
          v2('update_node', { id: s2 }, ['id'], { content: s2, title: s2 }),
          v2('move_node', { id: s2, parentId: s2 }, ['id', 'parentId']),
        ],
      },
    },
  },
  required: ['summary', 'alterations'],
  additionalProperties: false,
};

const EXTEND_SYSTEM = `You are the IMPORT agent for a goal map, processing a LARGE source in chunks. You see (a) the imported subtree AS BUILT SO FAR from earlier chunks (nodes with [ids]) and (b) the next chunk of the source. Your job: EXTEND the subtree with THIS chunk's material.

RULES:
- create_node operations ONLY. Attach new nodes under existing [ids] where the material belongs there; create new branch nodes when the material opens a genuinely new thread. NEVER duplicate a node that already exists in the subtree — if this chunk revisits a topic, add the NEW information under the existing node.
- DENSITY: roughly one node per coherent point in the source. Do not compress a rich chunk into a handful of lines; do not pad a thin one. A 50k-character chunk of dense material may well deserve 20-40 nodes.
- NAMES: topic/heading nodes 2-5 words; statement nodes one tight sentence. Depth does NOT go in the name.
- MEMORY — the important part: every node carrying real substance MUST include a "memory" field with the underlying detail from the source — specifics, numbers, quotes worth keeping, and a provenance tag naming where in the source it came from (a heading, a date, an entry id). Up to ~1200 characters. The map shows the tight statement; the memory is what the agent recalls when the user focuses this node. Trivial connector nodes may omit it.
- Types where they fit (claim, question, option, decision, constraint, evidence, task), statuses honestly; short random strings for new ids; parentId must reference an existing [id] or an id created earlier in THIS list. Do not reference anything outside the import subtree.`;

const FINISH_SYSTEM = `You are finishing a chunked import into a goal map. You see the complete imported subtree (every node with [id], name, and statement). Earlier chunks were filed without seeing later ones, so: (1) MERGE near-duplicates by renaming one node to carry both statements and moving the other's meaning into it — you may ONLY rename (update_node content/title) and re-parent (move_node); you cannot delete, so make duplicates harmless by renaming them into genuinely distinct aspects or moving them under the node they duplicate; (2) fix names that break the rule (topics 2-5 words, statements one tight sentence); (3) move nodes that clearly sit in the wrong branch. Propose NOTHING where the tree is already right — a small correct pass beats an ambitious rewrite. Ops may reference ONLY the [ids] shown.`;

export interface LargeProgress { phase: 'chunk' | 'finish'; done: number; total: number }
export interface LargeProposal extends ImportProposal { memories: Record<string, string>; chunks: number }

function splitChunks(text: string, target = 50_000): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur: string[] = []; let size = 0;
  const isBoundary = (l: string) => /^#{1,3} |^== |^## |^USER: |^\[?20\d\d-/.test(l);
  for (const line of lines) {
    if (size > target * 0.7 && (isBoundary(line) || size > target * 1.2)) {
      chunks.push(cur.join('\n')); cur = []; size = 0;
    }
    cur.push(line); size += line.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks.filter((c) => c.trim().length > 0);
}

export async function proposeImportLarge(
  store: Store, projectId: string, sourceLabel: string, text: string,
  onProgress?: (p: LargeProgress) => void,
): Promise<LargeProposal | { error: string }> {
  const map = loadMap(store, projectId);
  const chunks = splitChunks(text);
  const accum: { id: string; parentId: string | null; content: string; title?: string }[] = [];
  const memories: Record<string, string> = {};
  const alterations: any[] = [];
  let rootId: string | null = null;
  let summary = `imported: ${sourceLabel}`;

  const renderAccum = (): string => {
    const kids = new Map<string | null, typeof accum>();
    for (const n of accum) { const k = kids.get(n.parentId) ?? []; k.push(n); kids.set(n.parentId, k); }
    const out: string[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const n of kids.get(pid) ?? []) {
        out.push(`${'  '.repeat(depth)}- [${n.id.slice(0, 8)}] ${(n.title || n.content).slice(0, 90)}`);
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out.join('\n').slice(0, 16_000);
  };

  try {
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({ phase: 'chunk', done: i, total: chunks.length });
      const parsed = await call({
        task: 'import', system: EXTEND_SYSTEM + systemCard(store, projectId, 'the IMPORT agent'),
        maxTokens: 8000, schema: IMPORT_SCHEMA as any, timeoutMs: 300_000,
        audit: (k, d) => store.audit(k, d),
        user: [
          i === 0 ? `THE MAP THIS LANDS IN (read-only, for tone):\n${renderTree(map, { ids: false }).slice(0, 4000) || '(empty map)'}` : '',
          `THE IMPORTED SUBTREE SO FAR (${accum.length} nodes):\n${renderAccum() || '(nothing yet — this is the first chunk; your first node becomes the ROOT container for the whole import, named 2-4 words for what the source IS)'}`,
          `SOURCE: ${sourceLabel} — CHUNK ${i + 1} of ${chunks.length}`,
          `MATERIAL:\n${chunks[i]}`,
          'Extend the subtree with this chunk.',
        ].filter(Boolean).join('\n\n'),
      });
      if (i === 0 && parsed.summary) summary = parsed.summary;
      const synthetic = { ...map, nodes: [...map.nodes, ...accum.map((n) => ({ ...n, status: 'live' }))] } as any;
      const alts = normalizeIds((parsed.alterations ?? []) as any[], synthetic).filter((a: any) => a.op === 'create_node');
      const batchIds = new Set(alts.map((a: any) => a.id));
      const accumIds = new Set(accum.map((n) => n.id));
      for (const a of alts as any[]) {
        if (!rootId && !a.parentId) rootId = a.id;
        else if (!a.parentId && a.id !== rootId) a.parentId = rootId;
        if (a.parentId && !batchIds.has(a.parentId) && !accumIds.has(a.parentId)) a.parentId = rootId;
        if (a.memory) { memories[a.id] = String(a.memory).slice(0, 1500); delete a.memory; }
        accum.push({ id: a.id, parentId: a.parentId ?? null, content: a.content, title: a.title });
        alterations.push(a);
      }
    }
    if (!alterations.length) return { error: 'the import agent produced no nodes' };

    // Finish pass: names + placement only (schema makes removal impossible).
    onProgress?.({ phase: 'finish', done: chunks.length, total: chunks.length });
    try {
      const fin = await call({
        task: 'import', system: FINISH_SYSTEM, maxTokens: 6000,
        schema: FINISH_SCHEMA as any, timeoutMs: 300_000,
        audit: (k, d) => store.audit(k, d),
        user: `THE IMPORTED SUBTREE (complete):\n${renderAccum()}\n\nStatements in full:\n${accum.map((n) => `[${n.id.slice(0, 8)}] ${n.content.slice(0, 200)}`).join('\n').slice(0, 30_000)}\n\nPropose the finishing corrections.`,
      });
      const accumIds = new Set(accum.map((n) => n.id));
      const short = new Map(accum.map((n) => [n.id.slice(0, 8), n.id]));
      for (const a of (fin.alterations ?? []) as any[]) {
        const id = short.get(String(a.id).replace(/[\[\]]/g, '')) ?? a.id;
        if (!accumIds.has(id)) continue;
        if (a.op === 'move_node') {
          const pid = short.get(String(a.parentId).replace(/[\[\]]/g, '')) ?? a.parentId;
          if (!accumIds.has(pid) || pid === id) continue;
          alterations.push({ op: 'move_node', id, parentId: pid });
        } else if (a.op === 'update_node' && (a.content || a.title)) {
          alterations.push({ op: 'update_node', id, ...(a.content ? { content: a.content } : {}), ...(a.title ? { title: a.title } : {}) });
        }
      }
    } catch (err) { console.error('[import] finish pass skipped:', err); }

    return { summary, alterations, rootId, memories, chunks: chunks.length };
  } catch (err) {
    console.error('[import-large] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

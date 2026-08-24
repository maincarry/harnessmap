import { Store } from '../store/db.js';
import { call } from '../inference.js';
import { getNodeMemory } from './memory.js';

// M94 (Jacob): merging two nodes merges their SUBSTANCE, not just their
// children — the survivor's content absorbs the source's distinct
// information, and their per-node chat memories combine. One cheap call;
// callers fall back to keep-as-child preservation when it fails.

const SYSTEM = `You merge two overlapping nodes of a goal map into ONE. You get the SURVIVOR (kept) and the MERGED node (disappearing into it).

Produce:
- content: ONE standalone statement carrying ALL distinct information from both. Keep the survivor's vocabulary and framing first; fold in only what the merged node adds. No narration, no "merged from", no lists — a statement of the thing itself.
- memory: their combined conversational memory (what was discussed while each was in focus): integrate, don't append; drop what got superseded; keep the reaction trail; at most ~150 words; plain language. Empty string if both memories are empty.`;

const SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['content', 'memory'],
  properties: { content: { type: 'string' as const }, memory: { type: 'string' as const } },
};

export async function mergeNodeText(
  store: Store,
  survivor: { id: string; title?: string | null; content: string },
  source: { id: string; content: string },
): Promise<{ content: string; memory: string } | null> {
  const sMem = getNodeMemory(store, survivor.id) ?? '';
  const xMem = getNodeMemory(store, source.id) ?? '';
  try {
    const parsed = await call({
      task: 'memory', system: SYSTEM, schema: SCHEMA, maxTokens: 400, timeoutMs: 10_000,
      audit: (k, d) => store.audit(k, d),
      user: [
          `SURVIVOR: ${survivor.title ? `[${survivor.title}] ` : ''}${survivor.content}`,
          sMem ? `SURVIVOR MEMORY:\n${sMem}` : 'SURVIVOR MEMORY: (none)',
          `MERGED NODE: ${source.content}`,
          xMem ? `MERGED NODE MEMORY:\n${xMem}` : 'MERGED NODE MEMORY: (none)',
          'Merge.',
        ].join('\n\n'),
    });
    const content = String(parsed.content ?? '').trim();
    const memory = String(parsed.memory ?? '').trim();
    return content ? { content, memory } : null;
  } catch (err) {
    console.error('[merge] text merge failed (falling back):', err);
    return null;
  }
}

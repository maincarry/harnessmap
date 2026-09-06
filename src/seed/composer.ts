import { Store } from '../store/db.js';
import { getNodeMemory, getAllNodeMemories, getAllMinimals, getAllCurrentDetails } from '../translator/memory.js';
import { chatAwareness } from '../translator/mapstatus.js';
import {
  ancestors, descendantNodes, renderNodeBrief,
  renderNodeOneLiner, renderSubtreeFull,
} from '../map/render.js';

// v0.2 (Jacob's #1/#7): the chat agent receives a COMPLETE map-state
// description EVERY turn — not a seed-once. v0.3.3: budgeted (a+b). v0.4:
// nodes all the way down — "topics" and "items" are the same thing now.
//
// Budget (Mark, 2026-08-27): sized FROM THE HARNESS CONTEXT LIMIT, not an
// arbitrary constant — the map gets ~5% of the harness window (200k tokens
// unless HARNESSMAP_HARNESS_WINDOW says otherwise), clamped to sane bounds.
// Precedence: map_budget setting (user/test) > HARNESSMAP_MAP_BUDGET env >
// derived. Filled in priority order — constraints are never cut, focus is
// always full, then lit briefs, open questions (only from visible nodes),
// ELSEWHERE — cutting stalest-first, with explicit "…N not shown" markers.

const CHARS_PER_TOKEN = 4;
export function budgetChars(store: Store): number {
  const set = Number(store.getSetting('map_budget') ?? 0);
  if (set > 0) return set;
  const env = Number(process.env.HARNESSMAP_MAP_BUDGET ?? 0);
  if (env > 0) return env;
  const winTokens = Number(process.env.HARNESSMAP_HARNESS_WINDOW ?? 200_000);
  return Math.min(64_000, Math.max(8_000, Math.round(winTokens * 0.05 * CHARS_PER_TOKEN)));
}

// What one turn's injection is made of — for the user-facing "what the agent
// sees" view. trimmedLit = lit branch tops whose full statements did NOT fit
// (titles alone survived); the map marks these so a lit choice is never
// silently overridden.
export interface ComposedParts {
  text: string;
  trimmedLit: string[];
  sections: { label: string; chars: number; text: string }[];
  budget: number;
  // M191d (Jacob): the map's THINKING — why each topic was shown at the
  // detail it was, aggregated by reason, for the dev timeline's round story.
  thinking: string;
}

export function composeState(store: Store, chatId: string, manipulations: string[], userText?: string): string {
  return composeParts(store, chatId, manipulations, userText).text;
}

export function composeParts(store: Store, chatId: string, manipulations: string[], userText?: string): ComposedParts {
  const chat = store.getChat(chatId);
  if (!chat) throw new Error(`unknown chat ${chatId}`);
  const focusId = chat.focusContainerId;
  const project = chat.projectId;

  const nodes = store.getNodes(project).filter((n) => n.status !== 'removed');

  // M190d: the composer walks entirely in memory — per-node SQL lookups made
  // composeParts quadratic (23s at 2161 nodes; every /api/state and MAP.md
  // write queued behind it).
  const byIdC = new Map(nodes.map((n) => [n.id, n]));
  const kidsOfC = new Map<string, typeof nodes>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const a = kidsOfC.get(n.parentId);
    if (a) a.push(n); else kidsOfC.set(n.parentId, [n]);
  }
  const memByNode = getAllNodeMemories(store);
  const descendantsC = (id: string): string[] => {
    const out: string[] = [];
    const stack = [...(kidsOfC.get(id) ?? [])];
    while (stack.length) { const n = stack.pop()!; out.push(n.id); stack.push(...(kidsOfC.get(n.id) ?? [])); }
    return out;
  };

  // Staleness: a node's last touch = the newest update in its subtree.
  const touch = new Map<string, string>();
  for (const n of nodes) touch.set(n.id, n.updatedAt);
  const subtreeTouch = (id: string): string => {
    let max = touch.get(id) ?? '';
    for (const d of descendantsC(id)) {
      const t = touch.get(d) ?? '';
      if (t > max) max = t;
    }
    return max;
  };
  const freshestFirst = (ids: string[]) =>
    [...ids].sort((a, b) => (subtreeTouch(a) < subtreeTouch(b) ? 1 : -1));

  // --- always-present sections (never cut) ---
  const focusSubtree = new Set([focusId, ...descendantsC(focusId)]);
  const frame = ancestors(store, focusId);
  const constraints = nodes.filter((n) => n.type === 'constraint' && ['active', 'hard'].includes(n.status));

  const fixed: string[] = ['[map state — the current structure of this work]'];
  if (frame.length > 0) {
    fixed.push('WIDER FRAME:');
    for (const f of frame) fixed.push(`  • ${renderNodeBrief(store, f.id)}`);
  }
  fixed.push('', 'FOCUS (what the user is actively working on):');
  fixed.push(renderSubtreeFull(store, focusId).split('\n').map((l) => `  ${l}`).join('\n'));

  // M38: how the focus fits its surroundings — cached relational description
  // (refreshed asynchronously after each round; may lag one beat).
  const focusRel = store.getCachedRelation(focusId);
  if (focusRel) {
    fixed.push('', 'HOW THE FOCUS FITS (its place among parents and children):');
    fixed.push(focusRel.split('\n').map((l) => `  ${l}`).join('\n'));
  }

  // M41: the focus node's chat memory — what was discussed here before,
  // deeper than the rolling turn window.
  const focusMem = getNodeMemory(store, focusId);
  if (focusMem) {
    fixed.push('', 'FOCUS MEMORY (what was discussed when this was the focus before):');
    fixed.push(focusMem.split('\n').map((l) => `  ${l}`).join('\n'));
  }

  const tail: string[] = [];
  // M195b: the overall map status report's judgment-sized geography rides every briefing —
  // it names what exists (dim areas included) so offers to pull things up
  // are well-informed; a few hundred chars, size-independent.
  const aware = chatAwareness(store, project);
  if (aware) tail.push('', aware);
  if (constraints.length > 0) {
    tail.push('', 'STANDING CONSTRAINTS (respect these):');
    for (const k of constraints) tail.push(`  • ${k.content}${k.status === 'hard' ? ' (hard)' : ''}`);
  }
  if (manipulations.length > 0) {
    tail.push('', 'RECENT USER ACTIONS ON THE MAP (since last message):');
    for (const m of manipulations) tail.push(`  • ${m}`);
  }
  tail.push(
    '',
    'Work WITHIN this structure when the user is working: advance the FOCUS,',
    'respect the constraints, and move open questions forward when natural.',
    'When the user says something unrelated to the work, just respond to THEM',
    '— helpfully and naturally — without redirecting to the map. Greetings',
    'and small talk are NEVER map business: reply in kind and stop — no',
    'focus offers, no lighting suggestions, no map status, no "want to get',
    'back to X?". The map speaks only when the user speaks about the work.',
    'You have NO tools in this chat — no web search, no file access, no',
    'commands. When the user asks for something that needs them, say so in',
    'one line and point at the ＋ session button (top of the chat pane): a',
    'real Claude Code terminal session opened there HAS those tools, works on',
    'this same map, and inherits this same context.',
    'Nodes the',
    'user removed or dropped are settled — do not reintroduce them. Topics',
    'listed under ELSEWHERE — and anything you remember discussing that is',
    'now dimmed there — are SET ASIDE by the user: never bring them up on',
    'your own initiative, never fold their ideas into answers as if current.',
    'Only if the USER raises one, note it is set aside and offer to light it',
    'up. A separate',
    'system keeps this map updated from the conversation; treat it as the',
    'current state of the work and let it shape what you do next. If the user',
    'raises an issue with the MAP itself — where something is filed, how to',
    'clean up, lighting/focus mechanics — refer them to the map panel\'s',
    '"🗨 talk to map" button, where the map agent answers directly with',
    'instructions; do not try to restructure the map yourself.',
    'When the user insists something WAS discussed before but you cannot find',
    'it on the map (and it is not merely set aside), do not argue and do not',
    'invent it: say the map does not hold it yet and point at "✚ enrich map"',
    '(in ⋯ other → more…), which reads this map\'s own conversation record',
    'and proposes the missing depth for their approval.',
  );

  const BUDGET_CHARS = budgetChars(store);
  let budget = BUDGET_CHARS - fixed.join('\n').length - tail.join('\n').length;

  // --- budgeted sections, filled in priority order, stalest cut first ---

  // 1. LIT branches (background the user chose). M46 (Jacob): a lit node
  // contributes its full DESCRIPTION — no fit, no chat memory (focus-only
  // privilege). Rendered one block per top-lit branch (a lit node whose
  // parent isn't lit) to kill the cascade-duplication; whole blocks are
  // budgeted stalest-first.
  const litSet = new Set(store.getLit(chatId));
  const topLit = freshestFirst([...litSet].filter((id) =>
    !focusSubtree.has(id) && store.getNode(id) && !litSet.has(store.getNode(id)!.parentId ?? '')));
  // M156 slice 2, corrected per Jacob: lit branches get FULL ACCESS with
  // TIERED ATTENTION — one importance ranking used twice. Reading order:
  // titles (the shape) → descriptions + fit (the substance) → remembered
  // discussions. Budget order: the same ranking bottom-up — discussions are
  // dropped first, then substance (stalest branch first), titles last. What
  // is always present in attention is the last dropped.
  type LitEntry = { id: string; depth: number; shape: string; substance: string[]; memory: string | null; kids: number };
  const litEntries = (id: string): LitEntry[] => {
    const out: LitEntry[] = [];
    const walk = (nid: string, depth: number) => {
      const n = byIdC.get(nid);
      if (!n || n.status === 'removed' || !litSet.has(nid)) return;
      const pad = '  '.repeat(depth + 1);
      const short = n.title || (n.content.length > 70 ? n.content.slice(0, 69) + '…' : n.content);
      const label = n.title && n.title !== n.content ? `${n.title}: ` : '';
      const substance = [`${pad}• ${label}${n.content}${n.type ? ` [${n.type}, ${n.status}]` : ''}`];
      const rel = depth === 0 ? store.getCachedRelation(nid) : null;
      if (rel) substance.push(`${pad}  (fits: ${rel.split('\n')[0].slice(0, 200)})`);
      const mem = memByNode.get(nid);
      const kids = (kidsOfC.get(nid) ?? []).filter((k) => k.status !== 'removed' && litSet.has(k.id));
      out.push({ id: nid, depth, shape: `${pad}- ${short}`, substance, memory: mem ? `${pad}${short} — remembered: ${mem.slice(0, 400)}` : null, kids: kids.length });
      for (const kid of kids) walk(kid.id, depth + 1);
    };
    walk(id, 0);
    return out;
  };
  const branchTiers = topLit.map((id) => ({ id, entries: litEntries(id) }));
  // Tier 1 — the shape. Titles are the last to ever drop (M156), but at
  // import scale a thousand lit titles alone can blow the whole budget
  // (measured: 50k chars of names, zero substance served). So the shape is
  // budget-aware: it may take up to SHAPE_SHARE of the budget; over that,
  // the DEEPEST levels roll up into their ancestors' "+N inside" counts —
  // titles still outrank everything, they just summarize from the bottom.
  const litLines: string[] = [];
  let litOmitted = 0;
  const SHAPE_SHARE = 0.4;
  const allEntries = branchTiers.flatMap((b) => b.entries);
  let shapeDepthCap = allEntries.length ? Math.max(...allEntries.map((e) => e.depth)) : 0;
  const shapeSize = (cap: number) => allEntries.filter((e) => e.depth <= cap).reduce((s, e) => s + e.shape.length + 1, 0);
  while (shapeDepthCap > 0 && shapeSize(shapeDepthCap) > budget * SHAPE_SHARE) shapeDepthCap--;
  const visibleLit = new Set(allEntries.filter((e) => e.depth <= shapeDepthCap).map((e) => e.id));
  // Hidden-descendant counts in one DFS pass per branch (entries are in DFS
  // order): a rolled-up node's count = entries after it that are deeper,
  // until the next entry at its depth or above.
  const hiddenBelow = new Map<string, number>();
  for (const b of branchTiers) {
    for (let i = 0; i < b.entries.length; i++) {
      const e = b.entries[i];
      if (e.depth !== shapeDepthCap || e.kids === 0) continue;
      let hidden = 0;
      for (let j = i + 1; j < b.entries.length && b.entries[j].depth > e.depth; j++) hidden++;
      if (hidden) hiddenBelow.set(e.id, hidden);
    }
  }
  const shapeAll = allEntries.filter((e) => e.depth <= shapeDepthCap)
    .map((e) => hiddenBelow.has(e.id) ? `${e.shape} (+${hiddenBelow.get(e.id)} inside)` : e.shape);
  budget -= shapeAll.join('\n').length;
  // M191b (Jacob's ruling): RESOLUTION-TIERED ATTENTION — every lit node
  // exists at three resolutions (one sentence / ≤150-word summary / full)
  // and the budget picks each node's ZOOM: all start minimal, warmth
  // promotes to medium then long (focus proximity first). The budget
  // degrades gracefully — a topic goes long → medium → minimal, never
  // something → nothing — and the injection reads in TREE ORDER with each
  // node appearing exactly once at its resolution.
  // memory_serving: ON by default; 'legacy' opts back into the kind-tiers.
  const SERVING = String(store.getSetting('memory_serving') || process.env.HARNESSMAP_MEMORY_SERVING || 'on');
  const subKept: string[] = [];
  const trimmedLit: string[] = [];
  const memKept: string[] = [];
  const resolved: string[] = [];
  const thinkingLines: string[] = [];
  if (SERVING !== 'legacy') {
    const minBy = getAllMinimals(store);
    const detailsBy = getAllCurrentDetails(store);
    const marks = store.getMarks(project);
    // Warmth (M191, Mark: "focus proximity strongest, same tree first"):
    // shares the focus's top-level chapter +2 · filer-touched fresh mark +2 ·
    // updated in the last day +1.
    const chapterOf = (id: string): string => {
      let cur = id;
      let p = byIdC.get(id)?.parentId;
      while (p && byIdC.get(p) && byIdC.get(p)!.parentId) { cur = p; p = byIdC.get(p)!.parentId; }
      return p ? cur : id;
    };
    const focusChapter = chapterOf(focusId);
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    // M191c (Jacob): AUTOMATIC FETCH is just promotion — a topic the user's
    // message names gets pushed to full for this turn, mechanically (agents
    // measurably never pull on their own: 0 recalls in 18 tries).
    const msg = (userText ?? '').toLowerCase();
    const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'should', 'would', 'about', 'what', 'when', 'how', 'our', 'are', 'was', 'were', 'have', 'has']);
    const sig = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
    // M199 (after the 2026-09-06 recall run): the question names a node by
    // MEANING-BEARING words, not only by its title. Nine of nineteen losses
    // were questions that described a node in other words ("how many pulls
    // in 18 cells" vs the node "Read-side miscalibration"). A word counts if
    // it is rare on this map (in under 5% of nodes); a node is named when the
    // question shares two rare words with its title, statement, or medium
    // memory — or, as before, 60% of its title words.
    const msgWords = new Set(sig(msg));
    const docFreq = new Map<string, number>();
    const nodeWords = new Map<string, Set<string>>();
    for (const n of nodes) {
      const ws = new Set(sig(`${n.title ?? ''} ${n.content} ${memByNode.get(n.id) ?? ''}`));
      nodeWords.set(n.id, ws);
      for (const w of ws) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
    const rareCap = Math.max(3, Math.ceil(nodes.length * 0.05));
    const rareInMsg = [...msgWords].filter((w) => (docFreq.get(w) ?? 0) > 0 && (docFreq.get(w) ?? 0) <= rareCap);
    const named = (id: string): boolean => {
      if (!msg) return false;
      const n = byIdC.get(id);
      if (!n) return false;
      const ws = nodeWords.get(id);
      if (ws && rareInMsg.length >= 2 && rareInMsg.filter((w) => ws.has(w)).length >= 2) return true;
      // Title and statement-head match separately — mixing them dilutes a
      // clean title hit below threshold.
      for (const toks of [sig(n.title ?? ''), sig(n.content.slice(0, 60))]) {
        if (toks.length < 2) continue;
        const hit = toks.filter((w) => msg.includes(w)).length;
        if (hit >= Math.max(2, Math.ceil(toks.length * 0.6))) return true;
      }
      return false;
    };
    const warmth = (id: string): number =>
      (named(id) ? 10 : 0) + (chapterOf(id) === focusChapter ? 2 : 0) + ((marks as any)[id] ? 2 : 0) + ((byIdC.get(id)?.updatedAt ?? '') > dayAgo ? 1 : 0);
    // The three renders per node. minimal is the never-cut floor (it IS the
    // shape line, now carrying the one-sentence current view when one exists).
    const pads = (e: LitEntry) => e.shape.match(/^\s*/)?.[0] ?? '  ';
    const minimal = (e: LitEntry): string => {
      const g = minBy.get(e.id);
      const roll = hiddenBelow.has(e.id) ? ` (+${hiddenBelow.get(e.id)} inside)` : '';
      return `${e.shape}${roll}${g ? ` — ${g}` : ''}`;
    };
    const mediumExtra = (e: LitEntry): string | null => {
      const blob = memByNode.get(e.id);
      return blob ? `${pads(e)}    (${blob.slice(0, 620)})` : null;
    };
    const longExtra = (e: LitEntry): string | null => {
      // LONG is the whole node (Jacob): full statement, the medium text, and
      // the dated specifics together — never a subset.
      const details = (detailsBy.get(e.id) ?? []).slice(0, 5);
      const lines = [...e.substance];
      const med = memByNode.get(e.id);
      if (med) lines.push(`${pads(e)}  (${med.slice(0, 700)})`);
      if (details.length) lines.push(`${pads(e)}  remembered: ${details.map((f) => f.date ? `${f.text} (${f.date})` : f.text).join(' · ')}`.slice(0, 900));
      return lines.length ? lines.join('\n') : null;
    };
    // Floor: every visible node at minimal (tree order, already budgeted via
    // the shape rollup above — swap shape cost for minimal cost).
    budget += shapeAll.join('\n').length; // undo the bare-shape charge
    // Question-promotion PIERCES the rollup: a topic the message names joins
    // the visible set even from below the depth cap (that is the whole point
    // of the automatic fetch — the budget hid it, the question needs it).
    for (const b of branchTiers) for (const e of b.entries) {
      if (!visibleLit.has(e.id) && named(e.id)) visibleLit.add(e.id);
    }
    const flat: { b: string; e: LitEntry; w: number }[] = [];
    for (const b of branchTiers) for (const e of b.entries) {
      if (!visibleLit.has(e.id)) continue;
      flat.push({ b: b.id, e, w: warmth(e.id) });
    }
    const chosen = new Map<string, 0 | 1 | 2>(); // 0 minimal · 1 medium · 2 long
    for (const f of flat) { chosen.set(f.e.id, 0); budget -= minimal(f.e).length + 1; }
    // Promote by warmth (stable within tree order): minimal→medium, then →long.
    const byWarmth = [...flat].sort((a, b2) => b2.w - a.w);
    for (const f of byWarmth) {
      const ex = mediumExtra(f.e);
      if (!ex) continue;
      if (budget - ex.length - 1 < 0) continue;
      budget -= ex.length + 1;
      chosen.set(f.e.id, 1);
    }
    for (const f of byWarmth) {
      const ex = longExtra(f.e);
      if (!ex) continue;
      if (budget - ex.length - 1 < 0) continue;
      budget -= ex.length + 1;
      chosen.set(f.e.id, 2);
    }
    // Emit in tree order, each node once at its zoom.
    const staysMinimal = new Set<string>();
    for (const b of branchTiers) {
      for (const e of b.entries) {
        if (!visibleLit.has(e.id)) continue;
        const r = chosen.get(e.id) ?? 0;
        resolved.push(minimal(e));
        if (r === 1) { const m = mediumExtra(e); if (m) resolved.push(m); }
        if (r >= 2) { const l = longExtra(e); if (l) resolved.push(l); }
        if (r === 0 && (memByNode.get(e.id) || (detailsBy.get(e.id) ?? []).length)) staysMinimal.add(b.id);
      }
      // ❗ semantics under graceful degradation: mark a branch when depth was
      // rolled away or some node with real detail could only serve minimal.
      if (staysMinimal.has(b.id) || b.entries.some((e) => !visibleLit.has(e.id))) { litOmitted++; trimmedLit.push(b.id); }
    }
    // The map's thinking, by reason (dev-mode round story, M191d).
    {
      const nameOfT = (id: string) => { const n = byIdC.get(id); return n ? (n.title || n.content.slice(0, 40)) : id.slice(0, 8); };
      const reasonOf = (id: string): string => named(id) ? 'the question named it'
        : chapterOf(id) === focusChapter ? 'near your focus'
        : (marks as any)[id] ? 'freshly filed this session'
        : (byIdC.get(id)?.updatedAt ?? '') > dayAgo ? 'recently updated' : 'background';
      const agg = new Map<string, { long: number; medium: number; minimal: number; ex: string[] }>();
      for (const f of flat) {
        const r = reasonOf(f.e.id);
        const a = agg.get(r) ?? { long: 0, medium: 0, minimal: 0, ex: [] };
        const c = chosen.get(f.e.id) ?? 0;
        if (c === 2) { a.long++; if (a.ex.length < 3 && r !== 'background') a.ex.push(nameOfT(f.e.id)); }
        else if (c === 1) a.medium++;
        else a.minimal++;
        agg.set(r, a);
      }
      const rolledN = allEntries.length - flat.length;
      const tl: string[] = [];
      for (const r of ['the question named it', 'near your focus', 'freshly filed this session', 'recently updated', 'background']) {
        const a = agg.get(r);
        if (!a) continue;
        const parts: string[] = [];
        if (a.long) parts.push(`${a.long} in full`);
        if (a.medium) parts.push(`${a.medium} with summaries`);
        if (a.minimal) parts.push(`${a.minimal} at one line`);
        tl.push(`${r}: ${parts.join(' · ')}${a.ex.length ? ` — ${a.ex.map((x) => `"${x}"`).join(', ')}` : ''}`);
      }
      if (rolledN) tl.push(`folded inside parents (no room for their names): ${rolledN}`);
      if (trimmedLit.length) tl.push(`❗ lit but holding detail there was no room for: ${trimmedLit.slice(0, 3).map(nameOfT).map((x) => `"${x}"`).join(', ')}${trimmedLit.length > 3 ? ` +${trimmedLit.length - 3}` : ''}`);
      thinkingLines.push(...tl);
    }
  } else {
    // Tier 2 — substance, node by node (freshest branch first). A branch
    // larger than the remaining budget contributes what fits instead of
    // nothing. Substance is served only for nodes whose titles made the
    // shape — never a statement for a name the agent hasn't seen.
    for (const b of branchTiers) {
      let cut = false;
      for (const e of b.entries) {
        if (!visibleLit.has(e.id)) { cut = true; continue; }
        const size = e.substance.join('\n').length;
        if (budget - size < 0) { cut = true; continue; }
        budget -= size;
        subKept.push(...e.substance);
      }
      if (cut) { litOmitted++; trimmedLit.push(b.id); }
    }
    // Tier 3 — remembered discussions, first to go under pressure.
    for (const b of branchTiers) {
      for (const e of b.entries) {
        if (!e.memory || !visibleLit.has(e.id)) continue;
        if (budget - e.memory.length < 0) continue;
        budget -= e.memory.length;
        memKept.push(e.memory);
      }
    }
  }
  if (resolved.length) {
    // Resolution mode: one tree, each topic at the detail the room allows —
    // plain existing words only (Jacob: no new terminology).
    litLines.push('  (each topic at the detail the room allows — fuller near your focus)', ...resolved);
  } else if (shapeAll.length) {
    litLines.push('  titles:', ...shapeAll);
    if (subKept.length) litLines.push('', '  in full:', ...subKept);
    if (memKept.length) litLines.push('', '  earlier discussion:', ...memKept);
  }

  // 2. OPEN QUESTIONS — only from visible (focus+lit) parts of the map.
  const visible = new Set([...focusSubtree, ...store.getLit(chatId)]);
  const openQs = nodes.filter((n) => n.type === 'question' && n.status === 'open'
    && (visible.has(n.id) || (n.parentId && visible.has(n.parentId))));
  const qLines: string[] = [];
  let qOmitted = 0;
  for (const q of openQs) {
    const line = `  • ${q.content}`;
    if (budget - line.length < 0) { qOmitted++; continue; }
    budget -= line.length;
    qLines.push(line);
  }

  // 3. ELSEWHERE — one line per unlit top-level node, freshest first.
  const rest = freshestFirst(nodes
    .filter((n) => n.parentId === null && !focusSubtree.has(n.id) && !litSet.has(n.id))
    .map((n) => n.id));
  const restLines: string[] = [];
  let restOmitted = 0;
  for (const id of rest) {
    const line = `  • ${renderNodeOneLiner(store, id)}`;
    if (budget - line.length < 0) { restOmitted++; continue; }
    budget -= line.length;
    restLines.push(line);
  }

  // --- assemble in display order, with explicit omission markers (G2) ---
  const parts: string[] = [...fixed];
  if (litLines.length > 0 || litOmitted > 0) {
    parts.push('', 'BACKGROUND (lit by the user as reference):');
    parts.push(...litLines);
    if (litOmitted > 0) parts.push(`  … ${litOmitted} lit topic(s) omitted for space (stalest first).`);
  }
  if (restLines.length > 0 || restOmitted > 0) {
    parts.push('', 'ELSEWHERE ON THE MAP (folded — set aside by the user; see the rule below):');
    parts.push(...restLines);
    if (restOmitted > 0) parts.push(`  … ${restOmitted} more topic(s) exist but are not shown (stalest first). If something seems missing, ask — the user can light it.`);
  }
  if (qLines.length > 0 || qOmitted > 0) {
    // Questions sit after the constraints block within the tail.
    const at = constraints.length > 0 ? constraints.length + 2 : 0;
    tail.splice(at, 0, '', 'OPEN QUESTIONS (in focus and lit topics):', ...qLines,
      ...(qOmitted > 0 ? [`  … ${qOmitted} more open question(s) omitted for space.`] : []));
  }
  parts.push(...tail);
  const text = parts.join('\n');
  const sections = [
    { label: 'the focus — in full (its frame, statements, and memory)', text: fixed.join('\n') },
    { label: 'lit topics (each at the detail the room allows)', text: resolved.join('\n') },
    { label: 'lit topics — titles', text: resolved.length ? '' : shapeAll.join('\n') },
    { label: 'lit topics — full statements', text: subKept.join('\n') },
    { label: 'lit topics — earlier discussion', text: memKept.join('\n') },
    { label: 'open questions', text: qLines.join('\n') },
    { label: 'other topics — one line each', text: restLines.join('\n') },
    { label: 'standing constraints + instructions to the agent', text: tail.join('\n') },
  ].map((sec) => ({ ...sec, chars: sec.text.length })).filter((sec) => sec.chars > 0);
  const usedChars = BUDGET_CHARS - Math.max(0, budget);
  const thinking = [`budget: ${BUDGET_CHARS.toLocaleString()} chars — used ~${usedChars.toLocaleString()}`, ...thinkingLines].join('\n');
  return { text, trimmedLit, sections, budget: BUDGET_CHARS, thinking };
}

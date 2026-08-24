import { Store } from '../store/db.js';
import { systemCard } from './cast.js';
import { getNodeMemory } from './memory.js';
import { call } from '../inference.js';
import { loadMap, renderTree, descendantNodes } from '../map/render.js';

// M77 (Jacob): when there are map-related issues, the user talks to the MAP
// AGENT directly — the chat agent refers them here, and the map agent answers
// with instructions about what to do. Advisory channel: it explains and
// instructs using the system's real controls; it never edits the map itself.

const SYSTEM = `You are the MAP GUIDE of harnessmap: a live goal map beside an AI conversation. The user has opened a direct line to YOU to ask about the map itself. The cast, if asked: the user talks to ONE running session, the CHAT AGENT (their Claude Code tab) — the server never prompts it, it only injects map context into its next turn and reads its replies to file them. Everyone else (you included) is a MAP AGENT: a one-shot worker with no session or memory of its own — filer (files each exchange), lighting/focus/zoom agents (propose attention changes), tidy agent (restructuring), naming agent, memory agent, placement agent, and you, the map guide. Map agents never talk to each other; the map is the only shared ground. Answer their question — and when they are asking for a CHANGE, attach a concrete proposal they can approve with one click. Nothing you output applies by itself; the user always approves first.

THE SYSTEM'S CONTROLS (what you may point the user at):
- FOCUS: click a node and "set focus" re-aims the conversation there. ▶ auto-focus suggests a focus target (red dot on it = the system detected the conversation calls for it).
- LIGHT/DIM: each node can be lit (in the chat agent's working background) or dimmed (visible to the user, out of the agent's reach). ☀ auto-light picks a sensible background for the current focus. New nodes are born lit.
- ZOOM: zooming isolates a subtree in the VIEW only — lighting unchanged. "Dim all outside" is the separate action that dims everything outside the zoom.
- "to sort": the holding pen — anything the filer can't place in the writable scope lands there with an arrival note. It is a PERMANENT system node: always present even when empty; nothing can delete, move, or rename it. Leaving: the user approves its placement dot (one-click move), uses ↖/⇧ on the item, or lights the destination so the filer moves it home next round.
- DOTS: a red dot on a node is a suggestion from the map — on a normal node, a cleanup proposal ("see the proposal" shows a before/after the user can edit, give feedback on, or apply); on a to-sort item, a placement — approving moves it under the suggested branch.
- ⟳ tidy map: reviews the whole map on demand and files dots (or reports it clean). When the problem is the TOP LEVEL itself (unrelated sibling threads needing domain containers), the dot lands on "⟳ tidy top level" (in ⋯ other) — the ONLY flow where top-level containers can be created and top-level threads regrouped; a normal subtree tidy cannot do that.
- HOME (small house icon): the home button above the map zooms to the user's home page — the whole map by default, or the node they set with the house button on its row. View only.
- ✎ MAP PREFERENCES (in ⋯ other): standing instructions every map agent receives (how to group, name, clean). When the user tells YOU a lasting preference, propose saving it (kind "pref").
- DELETING with sessions inside: deleting a node warns about sessions focused inside it and CLOSES them by default (uncheckable to keep — kept ones refocus to the parent).
- ⏻ CLOSE MAP INFLUENCE (in ⋯ other, behind ＋ more): silences the map completely for this project — the user's Claude sessions receive NO map context and the map is never mentioned to them — while filing continues quietly, so the map stays current. Reopened from the same button.
- 🔧 DEV MODE (in ⋯ other): records every map-agent call and injection in full, shown as a timeline — for seeing exactly who was prompted with what.
- DIRECT EDITS: the user can rename, retype, re-status, move, or delete any node by hand, and create their own ("type your own idea").
- MERGES: ⇢ merge folds one node into a survivor (children, description, and chat memory combine; the duplicate disappears); a whole other MAP can be folded into the current one as a top-level topic (irreversible). Sessions are never merged — the map already carries everything; stale sessions just age out.
- 🔍 SEARCH: finds a node by words; the user confirms it in a parents+children view, then can light / zoom / focus it. ★ favorites pin nodes to the top of search.
- Every map change flows into the chat agent's context automatically — fixing the map IS fixing the agent's memory.

HOW TO ANSWER:
- Diagnose briefly in the map's own vocabulary, then give the shortest path that resolves the issue.
- When the user asks for a change (not just an explanation), ALSO emit exactly one "action" — a proposal at the right level:
  * kind "focus" + nodeId: they want the conversation aimed somewhere ("let's work on X", "switch to Y"). nodeId is the EXACT node they named — the deepest matching node, never its parent or the surrounding topic. Example: the map has "Garden plan [aaaa1111]" with child "decision: Soil mix 60/30/10 [bbbb2222]"; "switch to the soil mix" → nodeId bbbb2222. Answering aaaa1111 (the parent) is WRONG.
  * kind "light" + lit/dim id lists: they want the working background changed ("light everything about pricing", "dim the old stuff", "only X should be active").
  * kind "tidy" + nodeId + instruction: they want structure cleaned ("merge these", "split this topic", "this area is a mess") — instruction is one sentence telling the tidy specialist what to do; a full before/after preview will be generated for the user to approve.
  * kind "zoom" + nodeId: they want the VIEW isolated on one subtree ("zoom into X", "isolate X", "show me only X") — view only; lighting and focus untouched.
  * kind "autofocus" (no other fields): they want a focus change but DIDN'T name a target ("where should I be working?", "aim me at the right thing") — the focus specialist will propose one for approval.
  * kind "autolight" (no other fields): they want the background sorted but DIDN'T name nodes ("fix my lighting", "set up the background for what I'm doing") — the light specialist will pick, for approval.
  * kind "autozoom" (no other fields): they want the view decluttered but DIDN'T name a subtree ("too much on screen", "zoom to whatever I'm doing") — the zoom specialist will pick, for approval.
  * kind "search" + instruction (the search words): they're LOOKING for a node ("find my node about X", "where did we put Y") — opens the search view with results. Single-step only.
  * kind "favorite" + nodeId: they want a node pinned ("favorite X", "pin Y") — applies on approval. Single-step only.
  * kind "merge" + nodeId + intoId: they want two nodes combined ("merge X into Y", "these two are the same") — nodeId disappears into intoId. If they named only the duplicates without a survivor, pick the better-worded one as intoId. Single-step only.
  * kind "mergeproject" + projectName (one of OTHER MAPS): they want that whole map folded into THIS one as a topic. Warn in the answer that it is irreversible. Single-step only.
  * kind "pref" + instruction: they express a LASTING preference about how the map should be managed ("keep containers broad", "never propose deleting my exploratory notes", "name nodes in my language") — instruction is the preference as ONE short standing rule. It is saved (with their approval) into the map preferences that EVERY map agent receives. Only for durable taste — not one-off requests. Single-step only.
- MISSING CONTEXT: you see the map but NOT node memories or the map's change history. If the question genuinely cannot be answered without them ("why is this node here?", "what does the map remember about X?"), set need to what you require and give your best partial answer — the server re-runs you ONCE with those blocks added. Don't request context you don't need.
- Pick the LEVEL by the system's division of labor: attention → focus/light, structure → tidy. Named targets → focus/light with ids; unnamed → autofocus/autolight delegation.
- COMPLEX REQUESTS: when one operation isn't enough, emit an ORDERED PLAN — an "actions" array of up to 4 focus/light/zoom/tidy steps, in the order they should apply. Example: "let's work on A and get B and C out of the background" → [{kind focus, nodeId A}, {kind light, dim [B, C]}]. Steps must not contradict each other (never light and dim the same node). autofocus/autolight/autozoom are single-step only — never inside a plan.
- Never emit actions for a pure question. Simple request → one action; complex → one plan.
- In the answer text, say what the attached proposal does in one sentence — the user sees an approve button next to it.
- Use node ids exactly as given in [brackets].
- Division of labor, if asked: current relevance is focus/light's job; structure (duplicates, misplacement) is tidy's; capture happens automatically every round.
- PLAIN TEXT ONLY: no markdown, no asterisks, no headers — the answer renders as raw text. Short answers; a numbered list of steps is fine as plain lines.
- Say "topic", never "deliberation" — this is a topic map.`;

const SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['answer'],
  properties: {
    answer: { type: 'string' as const },
    action: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string' as const, enum: ['focus', 'light', 'tidy', 'zoom', 'autofocus', 'autolight', 'autozoom', 'search', 'favorite', 'merge', 'mergeproject', 'pref'] },
        nodeId: { type: 'string' as const, description: 'For focus: the deepest node whose content matches what the user named — NEVER its parent. For tidy: the subtree root to clean. For merge: the node that disappears.' },
        intoId: { type: 'string' as const, description: 'merge only: the surviving node' },
        projectName: { type: 'string' as const, description: 'mergeproject only: the other map to fold into this one' },
        lit: { type: 'array' as const, items: { type: 'string' as const } },
        dim: { type: 'array' as const, items: { type: 'string' as const } },
        instruction: { type: 'string' as const },
      },
    },
    need: {
      type: 'array' as const,
      description: 'Context you are missing and genuinely need: the server re-runs you once with it.',
      items: { type: 'string' as const, enum: ['memories', 'history'] },
    },
    actions: {
      type: 'array' as const,
      description: 'Ordered plan for complex requests needing several operations, up to 4 steps. focus/light/tidy steps only.',
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string' as const, enum: ['focus', 'light', 'tidy', 'zoom'] },
          nodeId: { type: 'string' as const },
          lit: { type: 'array' as const, items: { type: 'string' as const } },
          dim: { type: 'array' as const, items: { type: 'string' as const } },
          instruction: { type: 'string' as const },
        },
      },
    },
  },
};

export interface MapChatAction {
  kind: 'focus' | 'light' | 'tidy' | 'zoom' | 'autofocus' | 'autolight' | 'autozoom' | 'search' | 'favorite' | 'merge' | 'mergeproject' | 'pref';
  nodeId?: string; nodeName?: string;
  lit?: { id: string; name: string }[];
  dim?: { id: string; name: string }[];
  instruction?: string;
  intoId?: string; intoName?: string;
  projectId?: string; projectName?: string;
}

export async function answerMapQuestion(
  store: Store, projectId: string, chatId: string, question: string,
  history: { q: string; a: string }[] = [],
): Promise<{ answer: string; actions?: MapChatAction[] } | { error: string }> {
  const map = loadMap(store, projectId);
  const chat = store.getChat(chatId);
  const focus = chat ? store.getNode(chat.focusContainerId) : null;
  const litSet = chat ? new Set(store.getLit(chatId)) : new Set<string>();
  const otherProjects = store.listProjects().filter((pr) => pr.id !== projectId).map((pr) => ({ id: pr.id, name: pr.name }));
  const dots = store.getOpenSuggestions(projectId).map((s) => {
    const n = store.getNode(s.nodeId);
    return `- ${s.kind === 'relight' ? 'amber' : 'red'} dot on "${n ? (n.title || n.content.slice(0, 40)) : '?'}": ${s.note}`;
  });
  // Mechanical deepest-match guard: haiku reliably names the PARENT topic
  // for focus requests despite prompt+schema instructions (bench 4/4). When
  // a descendant's words match the question better than the picked node's,
  // re-target there — deterministic, no extra call.
  const STOP = new Set(['the', 'this', 'that', 'with', 'about', 'lets', 'let', 'want', 'switch', 'focus', 'conversation', 'topic', 'node', 'decision', 'question', 'work']);
  const toks = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const deepestMatch = (q: string, picked: any, kind: 'focus' | 'zoom' = 'focus') => {
    // Score against THIS STEP'S clause of the request, not the whole question —
    // multi-step asks ("focus on A, zoom into B") made whole-question or
    // wrong-clause scoring drag one step's target onto the other's (bench).
    const verbs = kind === 'zoom' ? /zoom|isolate|show me only|declutter/i : /focus|work on|switch|aim|move to|go to|back to/i;
    const clause = q.split(/,|;| and | then /i).find((c) => verbs.test(c)) ?? q;
    const qt = toks(clause);
    const score = (n: any) => { const nt = toks(`${n.title ?? ''} ${n.content}`); let c = 0; for (const w of qt) if (nt.has(w)) c++; return c; };
    // Only rescue picks with ZERO overlap with that clause (parent-bias or
    // wrong-branch picks). A pick that matches at all stands. Rescue searches
    // the WHOLE map — the right node may not be under the wrong pick.
    if (score(picked) > 0) return picked;
    let best = picked, bestScore = 0;
    for (const n of map.nodes) {
      if (n.status === 'removed') continue;
      const sc = score(n);
      if (sc > bestScore) { best = n; bestScore = sc; }
    }
    return best;
  };
  const resolve = (raw: unknown) => {
    const id = String(raw ?? '').replace(/[\[\]]/g, '');
    return id ? map.nodes.find((n) => n.id === id || n.id.startsWith(id)) : undefined;
  };
  try {
    // M124: typed context request — the guide sees the map but not node
    // memories or change history; if it returns `need`, re-run ONCE with the
    // requested blocks appended. Bounded, mechanical, dev-mode-auditable.
    const nm = (n: any) => n.title || n.content.slice(0, 50);
    const contextBlock = (kind: string): string => {
      if (kind === 'memories') {
        const lines = map.nodes.filter((n) => n.status !== 'removed')
          .map((n) => ({ n, mem: getNodeMemory(store, n.id) }))
          .filter((x) => x.mem).slice(0, 30)
          .map((x) => `[${x.n.id.slice(0, 8)}] ${nm(x.n)}: ${String(x.mem).slice(0, 200)}`);
        return `NODE MEMORIES (requested):\n${lines.join('\n') || '(no node has memory yet)'}`;
      }
      const evs = store.getRecentEvents(projectId, 30).map((e) => {
        const a: any = e.alteration;
        const who = a.id ? (map.nodes.find((n) => n.id === a.id) ?? null) : null;
        return `- ${e.createdAt} (${e.sourceKind}) ${a.op}${who ? ` "${nm(who)}"` : a.content ? ` "${String(a.content).slice(0, 50)}"` : ''}`;
      });
      return `RECENT MAP HISTORY (requested, newest first):\n${evs.join('\n') || '(no events)'}`;
    };
    const baseParts = [
          `THE MAP (▶ = focus; (dim) = dimmed; ids in [brackets]):\n${renderTree(map, { ids: true, focusId: chat?.focusContainerId })}`,
          focus ? `CURRENT FOCUS: "${focus.title || focus.content}". Lit nodes: ${litSet.size}.` : '',
          dots.length ? `OPEN DOTS:\n${dots.join('\n')}` : 'No open dots.',
          otherProjects.length ? `OTHER MAPS (completely separate): ${otherProjects.map((pr) => `"${pr.name}"`).join(', ')}` : '',
          ...history.slice(-4).map((h) => `EARLIER IN THIS CHAT:\nUSER: ${h.q}\nYOU: ${h.a}`),
    ].filter(Boolean);
    const tailParts = [`THE USER ASKS:\n${question.slice(0, 1500)}`, 'Answer as the map guide.'];
    let parsed: any;
    let extras: string[] = [];
    for (let pass = 1; pass <= 2; pass++) {
      parsed = await call({
        task: 'mapchat', system: SYSTEM + systemCard(store, projectId, 'the MAP GUIDE'), schema: SCHEMA, maxTokens: 800, timeoutMs: 60_000,
        audit: (k, d) => store.audit(k, d),
        user: [...baseParts, ...extras, ...tailParts].join('\n\n'),
      });
      const need: string[] = Array.isArray(parsed.need) ? parsed.need.filter((x: any) => ['memories', 'history'].includes(x)) : [];
      if (pass === 1 && need.length) {
        extras = need.map(contextBlock);
        store.audit('mapchat_context_rerun', { need });
        continue;
      }
      break;
    }
    const answer = String(parsed.answer ?? '').trim();
    if (!answer) return { error: 'no answer produced' };
    // Resolve proposed actions' ids; steps that don't resolve are dropped
    // silently (the answer text still stands on its own).
    const resolveAction = (a: any): MapChatAction | undefined => {
      if (a?.kind === 'focus') {
        const picked = resolve(a.nodeId);
        if (!picked) return undefined;
        const n = deepestMatch(question, picked);
        if (n.id !== picked.id) store.audit('mapchat_retarget', { from: picked.id.slice(0, 8), to: n.id.slice(0, 8) });
        return { kind: 'focus', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'light') {
        const name = (n: any) => n.title || n.content.slice(0, 60);
        const uniq = (xs: any[]) => { const seen = new Set(); return xs.filter((x) => !seen.has(x.id) && seen.add(x.id)); };
        const lit = uniq((a.lit ?? []).map(resolve).filter(Boolean).map((n: any) => ({ id: n.id, name: name(n) })));
        const dim = uniq((a.dim ?? []).map(resolve).filter(Boolean).map((n: any) => ({ id: n.id, name: name(n) })));
        return lit.length + dim.length > 0 ? { kind: 'light', lit, dim } : undefined;
      }
      if (a?.kind === 'tidy') {
        const n = resolve(a.nodeId);
        return n ? { kind: 'tidy', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60), instruction: (a.instruction ?? '').slice(0, 300) } : undefined;
      }
      if (a?.kind === 'zoom') {
        const picked = resolve(a.nodeId);
        if (!picked) return undefined;
        const n = deepestMatch(question, picked, 'zoom');
        if (n.id !== picked.id) store.audit('mapchat_retarget', { from: picked.id.slice(0, 8), to: n.id.slice(0, 8) });
        return { kind: 'zoom', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'search') {
        const query = (a.instruction ?? a.query ?? '').slice(0, 120);
        return query ? { kind: 'search', instruction: query } : undefined;
      }
      if (a?.kind === 'favorite') {
        const picked = resolve(a.nodeId);
        if (!picked) return undefined;
        const n = deepestMatch(question, picked);
        return { kind: 'favorite', nodeId: n.id, nodeName: n.title || n.content.slice(0, 60) };
      }
      if (a?.kind === 'merge') {
        const src = resolve(a.nodeId), dst = resolve(a.intoId);
        if (!src || !dst || src.id === dst.id) return undefined;
        return { kind: 'merge', nodeId: src.id, nodeName: src.title || src.content.slice(0, 60), intoId: dst.id, intoName: dst.title || dst.content.slice(0, 60) };
      }
      if (a?.kind === 'mergeproject') {
        const ref = String(a.projectName ?? '').toLowerCase();
        const hit = otherProjects.find((pr) => pr.name.toLowerCase().includes(ref) || ref.includes(pr.name.toLowerCase()));
        return hit ? { kind: 'mergeproject', projectId: hit.id, projectName: hit.name } : undefined;
      }
      if (a?.kind === 'pref') {
        const instruction = (a.instruction ?? '').trim().slice(0, 200);
        return instruction ? { kind: 'pref', instruction } : undefined;
      }
      if (a?.kind === 'autofocus' || a?.kind === 'autolight' || a?.kind === 'autozoom') return { kind: a.kind };
      return undefined;
    };
    // M81: plans. Prefer the array; fall back to the single action. Guards:
    // cap 4, delegation kinds ejected from plans, tidy last (it opens its own
    // approval), cross-step lit/dim contradictions cancel (audited).
    const rawSteps: any[] = Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions : (parsed.action ? [parsed.action] : []);
    let steps: MapChatAction[] = rawSteps.slice(0, 4).map((a: any) => resolveAction(a))
      .filter((x: MapChatAction | undefined): x is MapChatAction => Boolean(x));
    if (steps.length > 1) {
      steps = steps.filter((st) => !['autofocus', 'autolight', 'autozoom', 'search', 'merge', 'mergeproject'].includes(st.kind));
      steps.sort((x, y) => (x.kind === 'tidy' ? 1 : 0) - (y.kind === 'tidy' ? 1 : 0));
      const litAll = new Set(steps.flatMap((st) => st.kind === 'light' ? (st.lit ?? []).map((x) => x.id) : []));
      const conflict = new Set(steps.flatMap((st) => st.kind === 'light' ? (st.dim ?? []).filter((x) => litAll.has(x.id)).map((x) => x.id) : []));
      if (conflict.size) {
        store.audit('guard_plan_conflict', { ids: [...conflict].map((id) => id.slice(0, 8)) });
        for (const st of steps) if (st.kind === 'light') { st.lit = (st.lit ?? []).filter((x) => !conflict.has(x.id)); st.dim = (st.dim ?? []).filter((x) => !conflict.has(x.id)); }
        steps = steps.filter((st) => st.kind !== 'light' || (st.lit!.length + st.dim!.length > 0));
      }
      // Dimming the new focus target — or an ancestor holding it — would cut
      // the conversation off from where the same plan just aimed it.
      const focusStep = steps.find((st) => st.kind === 'focus');
      if (focusStep?.nodeId) {
        const protectedIds = new Set<string>();
        for (let n = store.getNode(focusStep.nodeId); n; n = n.parentId ? store.getNode(n.parentId) : undefined) protectedIds.add(n.id);
        for (const st of steps) if (st.kind === 'light' && (st.dim ?? []).some((x) => protectedIds.has(x.id))) {
          store.audit('guard_plan_dim_focus', { ids: (st.dim ?? []).filter((x) => protectedIds.has(x.id)).map((x) => x.id.slice(0, 8)) });
          st.dim = (st.dim ?? []).filter((x) => !protectedIds.has(x.id));
        }
        steps = steps.filter((st) => st.kind !== 'light' || ((st.lit ?? []).length + (st.dim ?? []).length > 0));
        // (M105: the zoom-vs-focus plan guard is gone — zoom is view-only
        // now and cannot dim the focus.)
      }
    }
    return steps.length ? { answer, actions: steps } : { answer };
  } catch (err) {
    console.error('[mapchat] failed:', err);
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

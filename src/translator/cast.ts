import { Store } from '../store/db.js';

// M124 (Jacob): coordination. Every decision-making specialist receives the
// same SYSTEM CARD — the cast and each role's jurisdiction — so no agent
// proposes work that belongs to another role (the root-grouping incident:
// mapcheck proposed what subtree-tidy could never execute). The card also
// carries the user's MAP PREFERENCES (governed, per-project, user-editable),
// so taste learned once steers every agent, not just the one that heard it.

export const CAST_ROLES = `THE CAST — who does what here. The user talks to ONE running session, the CHAT AGENT; the server never prompts it, it only injects map context into its next turn and reads its replies. Every other role is a one-shot MAP AGENT with no session or memory of its own:
- FILER: files each exchange onto the map (only writer that acts without approval, within the lit scope).
- LIGHTING / FOCUS / ZOOM agents: propose attention changes — the user approves.
- TIDY agent: restructures ONE chosen subtree; only in ROOT SCOPE (the "tidy top level" flow) may top-level containers be created or top-level threads moved.
- NAMING agent: display names. MEMORY agent: node memories. PLACEMENT agent: suggests homes.
- MAP GUIDE: answers the user's questions about the map and drafts proposals.
Map agents never talk to each other — the map is the only shared ground. Work that belongs to another role is NOT yours: name the right mechanism (e.g. "this needs the tidy-top-level flow" / "that is a lighting change") instead of doing it badly yourself or flagging it where it cannot be executed.`;

export function systemCard(store: Store, projectId: string, self: string): string {
  const prefs = (store.getSetting(`prefs:${projectId}`) ?? '').trim();
  return `\n\n${CAST_ROLES}\nYou are ${self}.`
    + (prefs ? `\n\nUSER'S MAP PREFERENCES (standing instructions for every map agent — follow unless this round says otherwise):\n${prefs}` : '');
}

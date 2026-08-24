import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { composeState } from '../seed/composer.js';
import { getConversationSummary } from './rolling-summary.js';

// v0.3 — THE MAP IS THE MEMORY (Jacob's Q2 = (b)).
// One continuous conversation per project, but the agent's working context is
// composed FRESH each turn: full map state + a rolling window of recent turns
// + the new message. No perpetual SDK session → no unbounded growth, no forced
// compaction, flat cost, and focus pivots don't fight old momentum (the old
// topic simply isn't in context — its distilled results are on the map).
// Verbatim deep history stays in the append-only log.

const CHAT_MODEL = process.env.HARNESSMAP_CHAT_MODEL ?? 'claude-sonnet-4-6';
const WINDOW = Number(process.env.HARNESSMAP_WINDOW ?? 20); // recent turns in context (M42: raised 10→20)

const SYSTEM_APPEND = [
  'You are the conversation partner inside harnessmap, a tool where the user',
  'thinks and writes with you while a live map of their goals, decisions,',
  'questions, and evidence maintains itself beside the chat.',
  'Each message you receive contains: a [map state] block (the current',
  'structure of the work — harness state, not user words), a [recent',
  'conversation] block (the last few exchanges), and the user\'s new message.',
  'The MAP is your memory: older exchanges are not shown verbatim — their',
  'distilled results are on the map. Trust the map for anything before the',
  'recent window. Work within the structure: advance its focus, respect its',
  'constraints, address its open questions, and treat the user\'s map actions',
  '(deletions, lighting, focus moves) as steering.',
  'This is thinking/writing work: converse naturally, be concrete, and keep',
  'responses focused. Do not use tools unless explicitly asked.',
  'The map guides your priorities for WORK — it is not a leash. When the user',
  'asks something casual, personal, or unrelated (food, mood, plans, chit-chat),',
  'just help them like the excellent general assistant you are: never refuse,',
  'never say it is not your lane, never redirect them back to the map. The',
  'harness captures what matters regardless.',
  'Never narrate harness mechanics to the user: do not describe what the focus',
  'is set to, speculate about why a node exists ("you just created this,',
  'probably meant to…"), or talk about your context blocks. Use the map',
  'silently; mention nodes only when discussing the work itself.',
].join(' ');

export interface TurnEvents {
  onAssistantText?: (text: string) => void;
}

export class ChatSessionManager {
  private pendingMapChanges = new Map<string, string[]>(); // chatId → change notes
  private busy = new Map<string, Promise<unknown>>();
  private lastFocus = new Map<string, string>(); // chatId → focus at last turn

  constructor(private store: Store) {}

  noteMapChange(chatId: string, change: string): void {
    const list = this.pendingMapChanges.get(chatId) ?? [];
    list.push(change);
    this.pendingMapChanges.set(chatId, list);
  }

  async send(chatId: string, userText: string, events: TurnEvents = {}) {
    const prev = this.busy.get(chatId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.runTurn(chatId, userText, events));
    this.busy.set(chatId, run);
    return run;
  }

  // Everything before the newest clear-marker is out of the window — the map
  // is the only memory across a clear (Jacob's "clean the chat" button).
  static readonly CLEAR_MARKER = 'chat cleared — earlier turns live on only through the map';

  private renderWindow(chatId: string): string {
    let all = this.store.getTurns(chatId);
    const lastClear = all.map((t) => t.role === 'system' && t.content === ChatSessionManager.CLEAR_MARKER).lastIndexOf(true);
    if (lastClear >= 0) all = all.slice(lastClear + 1);
    const turns = all.slice(-WINDOW);
    if (turns.length === 0) return '';
    const lines = turns.map((t) => {
      if (t.role === 'system') return `— ${t.content} —`;
      return `${t.role === 'user' ? 'USER' : 'YOU'}: ${t.content}`;
    });
    return `[recent conversation — the last ${turns.length} turn(s); everything earlier is distilled on the map]\n${lines.join('\n\n')}`;
  }

  // Harness-adapter injection payload (spike): the map block for a host
  // harness's turn — consumes pending manipulations (they're delivered now).
  // No verbatim window: the host owns its own transcript.
  harnessContext(chatId: string): string {
    return composeState(this.store, chatId, this.consumeManipulations(chatId));
  }

  // MAP.md body: same keyhole, but never consumes pending notices (those
  // belong to the next injection).
  previewMapOnly(chatId: string): string {
    return composeState(this.store, chatId, []);
  }

  consumeManipulations(chatId: string): string[] {
    const manipulations = this.pendingMapChanges.get(chatId) ?? [];
    this.pendingMapChanges.delete(chatId);
    return manipulations;
  }

  // What WOULD the agent see next turn (Jacob: the user should see the full
  // map description too). Peeks at pending manipulations without consuming.
  previewContext(chatId: string): string {
    const manipulations = this.pendingMapChanges.get(chatId) ?? [];
    return [
      composeState(this.store, chatId, manipulations),
      this.renderSummaryBlock(chatId),
      this.renderWindow(chatId),
      '[YOUR NEXT MESSAGE APPEARS HERE]',
    ].filter(Boolean).join('\n\n---\n\n');
  }

  // M42: second-place memory — the rolling summary of pre-window conversation.
  // Read-time subordination (P3): the header states the map wins on conflict.
  private renderSummaryBlock(chatId: string): string {
    const text = getConversationSummary(this.store, chatId);
    if (!text) return '';
    return [
      '[earlier conversation — SECONDARY memory. The map above is the primary',
      'record: on any conflict the map wins, and anything the map shows as',
      'removed or dropped must not be re-raised from here.]',
      text,
    ].join('\n');
  }

  private async runTurn(chatId: string, userText: string, events: TurnEvents) {
    const chat = this.store.getChat(chatId);
    if (!chat) throw new Error(`unknown chat ${chatId}`);

    const manipulations = this.pendingMapChanges.get(chatId) ?? [];
    this.pendingMapChanges.delete(chatId);

    // Focus pivots get an explicit directive (bug report 2026-08-14) — under
    // map-as-memory this is belt-and-suspenders, but pivots inside the recent
    // window still benefit from it.
    const prevFocus = this.lastFocus.get(chatId);
    let focusDirective = '';
    if (prevFocus && prevFocus !== chat.focusContainerId) {
      const c = this.store.getNode(chat.focusContainerId);
      focusDirective = [
        `[FOCUS CHANGED] The user has moved the focus to «${c?.content ?? 'a new topic'}».`,
        'The previous topic is no longer the subject. Pivot the conversation to the',
        'new focus NOW — engage with its items and open questions, and do not',
        'steer back unless the user does.',
        '', '',
      ].join('\n');
    }
    this.lastFocus.set(chatId, chat.focusContainerId);

    const windowBlock = this.renderWindow(chatId);

    const userTurnId = randomUUID();
    this.store.appendTurn({ id: userTurnId, chatId, role: 'user', content: userText, raw: null });

    const prompt = [
      composeState(this.store, chatId, manipulations),
      this.renderSummaryBlock(chatId),
      windowBlock,
      `${focusDirective}USER'S NEW MESSAGE:\n${userText}`,
    ].filter(Boolean).join('\n\n---\n\n');

    let assistantText = '';

    // Fresh, self-contained turn — no resume. The composed prompt IS the context.
    const q = query({
      prompt,
      options: {
        model: CHAT_MODEL,
        maxTurns: 4,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
      },
    } as any);

    for await (const msg of q as any) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text') {
            assistantText += block.text;
            events.onAssistantText?.(block.text);
          }
        }
      }
    }

    const assistantTurnId = randomUUID();
    this.store.appendTurn({ id: assistantTurnId, chatId, role: 'assistant', content: assistantText, raw: null });

    return { userTurnId, assistantTurnId, assistantText };
  }
}

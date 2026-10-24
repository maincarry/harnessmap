# HarnessMap — the three-minute demo. Storyboard

Date: 2026-10-24. Cut 1 (2:42, a slideshow of screens) went to Jacob 20:37Z; his notes: "This is static… a serious, refined, commercial demo… extremely fancy and polished." Cut 2 (2:54, 21:46Z) is the rebuild: the product in a window on a dark stage, a scripted camera that pushes in on the rows each turn adds, statements between beats, lower-thirds, crossfades, a 2x capture, the score cut to the beats, one continuous take over the real page (demo/stage.html + demo/take.ts + demo/cut2.ts; `bash demo/make.sh <take>`). Cut 3 adds the "chat agent's view" beat that dropped out of cut 2.

Timing of the stage cut (cut 3, 3:11): statements 0:00–0:14 · the window comes in 0:14–0:18 · seven landings with close-ups 0:18–1:25 · "Three days later." 1:25–1:31 · the new session's recap, then the chat agent's view block 1:31–1:51 · the rule lands, the next step 1:51–2:09 · the companion slides in 2:09–2:26 · talk to the map, the answer 2:26–2:42 · the galaxy 2:42–2:51 · why now, the typed install, "two lines to install" 2:51–3:03 · the logo 3:03–3:11.

## The story

One engineer, one small real project, two sessions three days apart.

Mara builds the booking page for her lab's confocal microscope with Claude Code. Flask, one page, half-hour slots. Over seven turns she decides on SQLite, tells the agent a rule that is easy to lose (the microscope needs ten minutes of warm-up, so the first slot is 8:10 not 8:00), corrects it (no email, the lab network cannot send mail), picks the deploy (the lab's Raspberry Pi behind nginx, no Docker), leaves one question open (two slots a day per student? she will ask Priya), and names the next step (an admin page to block slots for maintenance). Three days later she opens a new session. It knows all of it. Priya has answered, the open question becomes a rule, and she starts the admin page.

The scenario file is `demo/story.json`. It runs through the real hooks and the real filer; the map on screen is the map the product made from these ten turns. The words are mine; the agent's lines are short so the filing stays readable on screen.

## What is real on screen, and what is demo chrome

Real, produced by the product: the map page (tree, focus, "you" chips, change tags, the conversation pane, the session tabs, the host strip), the "chat agent's view" block, the companion page, talk to the map and its answer, the galaxy view.

Demo chrome, not the product: a caption strip under the page, and five title cards between beats. The cards use the map's own type and colours. Nothing in the chrome states a fact the product did not produce.

What my cut does not show: a real terminal with Claude Code typing. The recording runs on the test box in headless chromium, so the session side is the map page's own conversation pane, which shows the real turns as they are filed. The final cut for a VC is a re-record on your Mac from `demo/record.md`, with the terminal on the left and the map on the right, your voice over it. The storyboard below is written for that final cut; my cut follows the same timing without the terminal.

## Timing

Theme: dark throughout. Frame: 1440 × 900. Captions: one line, bottom, 28 px.

| Time | On screen | Caption | Voice |
|---|---|---|---|
| 0:00–0:06 | Card 1. "Every coding session forgets." | — | (silence, then) Every coding session forgets. |
| 0:06–0:20 | Terminal: a long Claude Code session mid-work. The context fills. "Compacting…". A new session starts. A blank prompt. | You spent the afternoon deciding things with your agent. Then the session compacted. | You spend an afternoon deciding things with your agent. Then the session compacts, or ends. Tomorrow you start blank, and so does it. |
| 0:20–0:26 | Card 2. "HarnessMap keeps what was discussed." | — | HarnessMap keeps what was discussed. **(pause)** |
| 0:26–0:40 | Terminal left, map page right. Mara types turn 1 (the booking page, Flask, half-hour slots). The agent answers. On the map, "Microscope booking page" grows its first children. The focus label moves to it. | She talks to Claude Code as always. Beside her, the map files the turn. Nobody typed into the map. | She talks to Claude Code exactly as before. Beside her, the map files the turn on its own. Nobody types into the map. |
| 0:40–0:52 | Turn 2 (SQLite, not Postgres) lands: a node in her own words with the "you" chip. Turn 3 (first slot 8:10, warm-up) lands under it. | Her words, her name on them. The 8:10 rule is the kind of thing that gets lost. | Each node is in her own words, with her name on it. The warm-up rule is the kind of detail that gets lost by Friday. |
| 0:52–1:04 | Turn 4: the correction. "No email, the lab network can't send mail." The email node appears and its tag shows the correction. Turn 5: Raspberry Pi + nginx, no Docker. | A correction is recorded as a correction. Not overwritten. | When she corrects the agent, the map records the correction, it does not quietly overwrite. |
| 1:04–1:10 | Turn 6: the open question (two slots a day? ask Priya). Turn 7: next step, the admin page. The tree now shows the whole afternoon. | One question left open. One next step named. | One question left open, one next step named. That is the afternoon, kept. **(pause)** |
| 1:10–1:16 | Card 3. "Three days later." | — | Three days later. |
| 1:16–1:34 | New session tab appears on the map. Click "chat agent's view": the exact block the agent receives, with SQLite, 8:10, no email, the Pi, Priya's question, the admin page. Turn 8 lands: "Where did we leave it?" and the agent answers from the map. | The new session starts with the map in its context. It picks up where she left off. | A new session opens with the map already in its context. The agent picks up where she left off, including the question nobody answered yet. |
| 1:34–1:44 | Turn 9: "Priya says two slots." The open question's node changes; the change tag shows it. | The open question becomes a rule. The map shows what changed. | Priya answered. The open question becomes a rule, and the map shows what changed. |
| 1:44–2:00 | The companion, bottom right of the desktop: green light, focus "Microscope booking page", "open map", "go to session · Claude Code". Click: the session window comes to the front. | A small companion on the desktop. One light: the map is up. One click back to the session. | On the desktop, a small companion: a light that says the map is up, the current focus, and one click back to the session you were in. |
| 2:00–2:12 | Talk to map: "what did we decide about email?" The answer, naming the node it came from. | Ask the map. It answers from its own record and says where. | You can ask the map. It answers from its own record and tells you which node it came from. |
| 2:12–2:20 | Galaxy view: the whole map as a system, the rocket on the focus, a slow drift. | The same map, as a sky. | The same map, as a sky. **(pause)** |
| 2:20–2:26 | Card 4. "Why now." | — | Why now. |
| 2:26–2:44 | Terminal: the install. `/plugin marketplace add maincarry/harnessmap`, `/plugin install map@harnessmap`, then "open map" in a session. The map page appears. | Every engineer now works through an agent. The harness is where the thinking happens. Nobody keeps it. | Every engineer now works through an agent. The harness is where the thinking happens, and nobody keeps it. We do. Two lines to install, nothing changes in how you work, and it stays on your machine. |
| 2:44–2:54 | Card 5. "The memory layer for agent work." then the logo. | — | HarnessMap. The memory layer for agent work. |
| 2:54–3:00 | Logo holds. (If there is an ask, it goes here as one line.) | — | (silence) |

Three pauses for the voice are marked in bold.

## The title cards

1. Every coding session forgets.
2. HarnessMap keeps what was discussed.
3. Three days later.
4. Why now.
5. The memory layer for agent work. (then the logo)

## What I will not claim

- Not "it tells you what is open or done". The map records what was discussed and what it became. The change tags and the recorded status are shown as what they are.
- No numbers on screen: no users, no revenue, no "10x".
- No claim that the agent "remembers". The map is in its context; that is what we show.

## Could not show (so far)

- A real terminal. See above; the final cut is your re-record.
- The companion's "go to session" bringing a window to the front: there is no window on the test box. My cut shows the companion and the click; the window change is in your re-record.
- Mark's Windows side (Codex app) is not in this cut. If you want the Codex app for the companion beat, say so and I write that variant of 1:44–2:00.

## Open with you

1. Harness on screen: Claude Code (default) or Codex app?
2. This story, or another?
3. Ask card: none (default) or a figure?
4. Voice: captions only for my cut, voice script for your re-record (default)?
5. Anything that must not appear?

Yes to this and I seed the map, record the cut, and post it here with the frame check.

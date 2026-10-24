# Re-recording the demo on your own machine

The cut made on the test box has no terminal in it: the box is headless, so the session side is the map page's own conversation pane. The final cut for a VC has your terminal on the left and the map on the right, and your voice. This is how to make it match the storyboard beat for beat.

## What you need

- A Mac with Claude Code (2.1.285 or newer for the desktop resume), the HarnessMap plugin installed, the companion built and running.
- A fresh project folder, for example `~/demo/booking`, with the map bound to it. The map must start empty: a new project in the map page, or `HARNESSMAP_HOME` pointed at an empty folder for the recording.
- A screen recorder (QuickTime, or OBS for two sources). Window layout: terminal left at about 45 % width, the map page right in a dark-theme browser window, the companion bottom right. Screen 1440 × 900 or 1920 × 1080; the cut is 3:2, crop later.
- The music file `cut/music.wav` from the test-box take (or a licensed track) and the caption text in `STORYBOARD.md`.

## The take

Do it in one sitting; the filer takes ten to forty seconds per turn, you will cut the waits.

1. **Problem beat (0:06–0:20).** In the terminal, open an existing long Claude Code session and scroll it. Trigger a compaction or `/clear`, then start a fresh session with a blank prompt. Ten seconds is enough.
2. **Day one (0:26–1:10).** In `~/demo/booking`, start Claude Code, say `open map`. Type Mara's seven day-one turns from `story.json` (the `user` fields), one at a time, in your own rhythm. Let the agent answer. Between turns, wait until the map shows the turn landed (the "filing" line goes quiet, nodes appear with the `new` tag). Keep the map window visible the whole time.
3. **Three days later (1:16–1:44).** Quit the session. Open a new terminal, same folder, new Claude Code session. Before the first prompt, click "chat agent's view" on the map page (in the top bar when the session is attached) and hold on the block for eight seconds. Then type turn 8 (`Where did we leave it?`), let the agent answer from the context, then turns 9 and 10.
4. **Companion (1:44–2:00).** Hover the companion: the green light, the focus, "go to session · Claude Code". Click it: the terminal comes to the front. That click is the one thing the test box could not show.
5. **Talk to map (2:00–2:12).** On the map page, "talk to map", ask `what did we decide about email?`, wait for the answer.
6. **Galaxy (2:12–2:20).** "galaxy view · beta" in the menu, eight seconds, close.
7. **Install (2:26–2:44).** In a clean terminal: `/plugin marketplace add maincarry/harnessmap`, `/plugin install map@harnessmap`, then a new session and `open map`. The map page appearing is the shot.

## The cut

Cut each turn to three seconds before the landing and four after; the storyboard has the timings. Captions are the caption column; the voice script is the voice column. Title cards are in `cards/` (1440 × 960 PNGs) or re-render them from `frame.html` at your resolution. The music is 3:00 with section changes at 0:20, 1:10, 1:16, 2:20, 2:25 and 2:45; line the cuts up with those and fade the last five seconds.

## Reproducing the test-box take

`FFMPEG=<full ffmpeg> bash demo/make.sh take2` does the whole thing on the box: seed and record, companion, beats, cards, score, cut. Output under `/tmp/claude-1000/demo-take2/cut/`.

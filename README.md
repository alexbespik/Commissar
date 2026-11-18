# Commissar Study Watch

A browser extension (Chrome, Brave, any Chromium browser) that watches what you do while you study and has a
persona (the Commissar, the Democracy Officer, or a squad of them taking turns) react with pre-recorded voice
lines: when you drift to a distracting site, when you stay there, when you come back, when you hold a focused
block, and when you get homework answers right or wrong.

**It needs no AI and no paid API.** Everything is decided locally: your site lists, words in the page title and
address, the page's own text (optional), and the right / wrong marks on homework pages. Gemini is an optional
extra for pages nothing else can judge; ElevenLabs is only used by you, once, to record new lines.

## Install (Brave or Chrome)

1. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. **Load unpacked** → choose this folder (`Commisar`).
3. Pin the extension, click it, type what you are studying, pick who is watching, **Begin session**.
4. In the popup, **Allow on all sites** turns on the on-screen banner and local page reading (optional).
5. To test with the saved WebAssign page from disk, also turn on **Allow access to file URLs** for the extension.

After changing files here, press the reload button on the extension's card.

## What it reacts to

| What happens | Line (Commissar pack event / Helldiver pack event) |
|---|---|
| Start a session | `on` / `quizStart` (the starters) |
| On a distracting site for 5 s | `tab` |
| Still there after 60 s, then every 2 min | `desert` (treason) |
| Back on study material | `reward` |
| 25 focused minutes | `streak` |
| No keyboard or mouse for 5 min | `streakRisk` |
| Homework answer right / wrong / partly right | `quizPass` / `quizFail` |
| Whole assignment correct | `quizWin` |
| End a session: clean / messy / quit early | `quizWin` or `streak` / `quizLose` or `quizFail` / `desert` |

A pack can record lines under the trigger's own name (`distracted`, `deserted`, `back`, `focusBlock`, `idle`,
`endGood`, `endBad`, `abandon`, `quizPartial`, `allDone`, `start`), and those win over the fallbacks above
(`src/core.js`, `TRIGGERS`). A pack manifest may also map triggers itself: `"aliases": {"distracted": ["myEvent"]}`.

Leaving the browser (to a PDF reader, Anki, your notes app) is not counted unless you turn that on. The extension
only sees the browser: not your phone, not other apps, and it never uses the camera.

## What counts as studying

In order: your study list → your distraction list → remembered verdicts (Gemini's) → mixed sites like YouTube,
where the title decides (a lecture is study, cats are not) → study words or your subject in the title or address
→ the page's own text, read locally (if allowed) → otherwise "not judged" (no penalty; **Strict** makes it a
distraction). In the popup, **Study site** / **Distraction** adds the current site to a list.

## Right and wrong answers (no AI)

WebAssign is built in: the extension reads each question's score (`1 / 1`, `0 / 1`), its submission count and
the check / cross marks, and compares them with the page before you pressed Submit.

**Teach another site** (Settings → Right and wrong answers): save a page of that site that already shows graded
answers (Save Page As → Webpage, Complete), pick the `.html` file plus the `.css` files from its `_files` folder.
The extension lists the marks it found, the question boxes and the score cells; you check each one by hand
(right / wrong / partial / ignore), **Test** it on the saved page, then **Save**. Or tick **Look for right / wrong
marks on every site** to use common class names everywhere.

## Voices

**The voice clips are not in this repository** (see Legal below). Without any pack the extension speaks its
captions with the browser's own voice. To get recorded voices, record the Commissar pack yourself with
`tools/gen-voice.mjs` (next section; the whole pack is 108 lines, about 5,100 characters, inside ElevenLabs'
free monthly allowance; pass `--max-chars 6000` for a first full run), or drop in any pack folder of your own.

Packs are folders with a `manifest.json` (`{"name", "events": {event: [files]}}`) listed in `packs.json`.
Captions shown on screen come from `captions/<pack>.json`. **Gravel** (Settings → Voices) is the deeper, rougher
Web Audio chain from SciEdu-Studio, on by default for the Commissar.

### Recording new lines with ElevenLabs (your key, your credits)

Lines live in `tools/lines/<pack>.json`. The Commissar file already has new study-watch lines (distracted,
deserted, back, idle, focus block, session end, quit early, partial, all done).

```bash
node tools/gen-voice.mjs commissar --dry-run
```

```bash
ELEVENLABS_API_KEY=your_key node tools/gen-voice.mjs commissar --only distracted --limit 1
```

```bash
ELEVENLABS_API_KEY=your_key node tools/gen-voice.mjs commissar
```

The dry run prints the character count; the free plan is about 10,000 characters a month and filling every
Commissar gap is about 2,400. Clips already recorded are never paid for twice (the file name is a hash of the
text). `--max-chars` (default 3000) refuses to send more. A new persona: copy `tools/lines/commissar.json` to
`tools/lines/<name>.json`, change `name`, `voice` (any ElevenLabs stock voice id) and the lines, then run it for
`<name>`; it creates the folder and adds it to `packs.json`. **Keep the key in the environment, never in a file
in this folder**: the whole folder is the extension.

## Optional: Gemini

Settings → Gemini. Off by default. Asks only about a page that is on no list, has no study words, and that you
stayed on (20 s by default); at most the daily cap (default 40); each answer is remembered for a week; never
retried automatically. Sends the page title, site and path (no query string); the start of the page text only if
you tick it. The key is stored unencrypted in this browser's extension storage. Google's free tier may use what
you send to improve its products. The default model name (`gemini-3.5-flash-lite`) was not checked against a live
account: if Settings shows "model not found", type the current free model name from AI Studio.

## Development

```bash
npm test
```

```bash
npm run check
```

No dependencies and no build step. `src/core.js` (rules, session state machine, voice picking) and
`src/answers.js` (answer reading) are plain logic with unit tests in `tests/`. `src/sw.js` is the service worker;
audio plays in `src/offscreen.html`. Firefox is not supported yet (no offscreen documents there); audio is behind
`src/audio.js` so a port only replaces that file.

## Privacy

Everything stays in the browser's extension storage. Nothing is sent anywhere unless you turn on Gemini. The saved
WebAssign page in this folder contains your account details and a session id: it is git-ignored; don't share it
or zip it with the extension.

## License and legal

- Code: GNU AGPL-3.0 (see `LICENSE`). The audio chain and the voice generator are ported from SciEdu-Studio,
  which is AGPL-3.0.
- Voice clips are not distributed here. Lines you record with ElevenLabs are subject to your ElevenLabs plan's
  terms (the free plan is non-commercial and asks for attribution); a pack recorded from a game or film belongs to
  its owner: keep such packs on your own computer.
- The line texts in `tools/lines/` are original writing. The "Commissar" persona is a generic stern-officer
  character; no names, quotes or artwork from any franchise are used.
- This project is not affiliated with or endorsed by Games Workshop (Warhammer 40,000), Arrowhead Game Studios or
  Sony Interactive Entertainment (Helldivers), Cengage (WebAssign), Google (Gemini) or ElevenLabs. Their names are
  used only to describe compatibility.

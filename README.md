# DeckSmith

DeckSmith turns a source document — a paper, a spec, a set of course notes — into an
animated explanation deck: one self-contained HTML file you can present, and the same
storyboard rendered to a 9:16 short or an MP4 without replanning.

Rendering is bought, not built. A deck is a
[HyperFrames](https://github.com/heygen-com/hyperframes) composition (Apache-2.0, pinned
at 0.8.43), so the animation runtime, the headless capture and the FFmpeg encode are
upstream's. What DeckSmith owns is the part nothing else does well: turning a document
into a *good explanation*, and being able to check that the explanation is true to its
source.

## Prerequisites

- Node 22 or later, and nothing else to **generate** a deck. `ingest` of a file, `build`,
  `pack` and `unpack` run in plain Node. `build` also opens each stop in Chrome when it can
  find one, and warns `not_measured` when it cannot. Decide your deployment on that line —
  a service that turns papers into decks runs in a plain Node image.
- A Chromium build and ffmpeg to **render or check** one. `verify` drives the HyperFrames
  gates in a headless browser, and the MP4 encode is ffmpeg's. Both arrive with the
  hyperframes toolchain during `npm install`; there is nothing to install by hand.
- On Linux, Chrome's sandbox needs unprivileged user namespaces, and Ubuntu 23.10 and later
  deny them by default. DeckSmith then opens its own pages, the gates' view of a deck and a
  caption band, without the sandbox, as HyperFrames' render always does, and prints a
  `chrome:` line saying so. `ingest` of a URL refuses instead, because that page comes from
  the web. `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, or an AppArmor
  profile for Chrome, gives the sandbox back.
- Three commands reach outside for their own reasons: `plan` runs the Codex CLI, `narrate`
  runs edge-tts over the network, and `illustrate` asks an image backend or that same Codex
  account for pictures — and draws its own when neither will.

```sh
npm install
npm run build     # dist/cli.js, dist/index.js, the deck runtime, and dist/types/
npm run check     # typecheck + lint + test
```

## The pipeline

Each command reads a file, writes a file, and stops — so you can look at, diff, and
hand-edit everything in between.

```sh
decksmith ingest  analysis.md      -o source.json       # structure, figures, equations, provenance
decksmith plan    source.json      -o storyboard.json   # beats — this is the one to read
decksmith illustrate storyboard.json --source source.json              # optional, after plan --images
decksmith narrate storyboard.json  --source source.json -o audio/       # optional
decksmith build   storyboard.json  --source source.json --format deck-16x9 -o out/
decksmith verify  out/
decksmith frames  out/                                 # PNGs of the holds, to look at
decksmith render  out/            -o talk.mp4          # picture + narration + subtitles
decksmith drift   out/                                 # render twice, compare frame by frame

decksmith pack    storyboard.json  --source source.json -o talk.deck    # one file to keep
decksmith unpack  talk.deck        -o reopened/
```

- **ingest** — document to `Source`: sections, figures, equations and tables, each with a
  stable id so a later stage can point back at it. Give it an http(s) URL instead of a
  path and it reads the page in a browser first — see "Ingesting a web page" below, which
  also says what happens to a video.
- **plan** — `Source` to `Storyboard`: an ordered list of beats. Each beat carries an
  `intent` (what the viewer should understand), an optional `claim` it is accountable to,
  `evidence` refs into the Source, a `weight`, and an archetype with its parameters.

  This is the only step that needs a model, and it runs on the **Codex CLI already
  installed on your machine** (`codex exec`) — under your existing subscription, with no
  API key and no metered tokens. `--output-schema` gives the same guarantee a structured
  API call would: the final message is schema-conformant JSON, no prose to strip. Two
  gates follow it — `storyboardSchema` proves the shape, and `assertRefsResolve` proves
  the storyboard is about *this* source, which is the part a planner actually gets wrong.

  You can also skip it entirely. `storyboard.json` is just a file: hand-write it, or have
  any assistant write it, and `build` cannot tell the difference.
- **illustrate** — the pictures the plan asked for. With `plan --images`, a beat that has
  no figure to show may carry a brief instead of a `figureId`; this turns each brief into
  a file under `assets/`, registers it as an ordinary figure in `source.json`, and points
  the beat at it. Optional, and nothing downstream knows the picture was generated. See
  "Illustrations" below.
- **narrate** — each beat's `narration` text, spoken by edge-tts, one audio file and one
  set of subtitle cues per *stop*. Optional, and needs the network. See "Narration" below.
- **build** — `Storyboard` to a composition, per format profile. Beats become scenes,
  scenes become their own paused GSAP timelines, hold points become slideshow fragments.
  Narration sitting beside the storyboard is picked up automatically.
- **verify** — runs the HyperFrames gates over a built directory and returns a `Verdict`:
  lint, runtime, layout, motion and contrast. Read what that does *not* cover before
  trusting it — see "What the gates do not check" below.
- **frames** — writes a PNG per hold (or per `--at <seconds>`) so you can look at the deck
  rather than at a verdict. It makes the same three calls the `fidelity` gate makes — the
  pinned runtime, `renderSeek(t, { suppressEvents: true })`, then a screenshot at the
  renderer's own clip — which is the path that was measured against a real mp4 to within
  0.11 percentage points of ink. It is the gate's own view of a deck, which is the thing
  worth looking at when you are asking why a gate said what it said.
  **It is not a substitute for watching the render.** On callback-driven motion the three
  available views disagree, measured on a deck with a band painted only from a GSAP
  `onUpdate`: `frames` leaves it at the background's RGB (11,13,17) because
  `suppressEvents` stops the callback; `hyperframes snapshot` draws it mid-tween at
  (143,4,5); and the render animates it smoothly to (205,0,0) over the tween's own three
  seconds. See "What the gates do not check".
- **render** — a built deck to a finished video: capture, retime, mux, subtitles. The
  retiming is the interesting part. The composition reveals everything a beat has to show
  and then sits still for the rest of its window, so playing it back linearly puts the
  narration seconds away from the picture it describes. `render` instead does what a
  presenter does — freezes each hold for exactly its sentence's length, then plays out
  whatever the scene actually ends on. Needs Chromium and ffmpeg, and needs the
  `timing.json` that `build` writes.

  Subtitles ride alongside by default, because a burned-in band is a decision taken away
  from the viewer. `--subtitles burn` makes it part of the picture, and it is only
  accepted over a deck built with `--reserve-captions` — the layout is fixed at build
  time, so a deck that made no room cannot be given any an hour later, and the band would
  land on the slide's own text. `render` refuses that rather than shipping it. A burned
  caption is a quiet lower third: 40px white type with a close dark halo, no box
  (2026-10-10; it was 4% of the width — 71px at 1920 — on a 70% black bar).
- **drift** — renders the deck twice and compares every frame. `--identical` fails on any
  differing byte, which is only honest for an image-free deck with no camera — the demo
  deck is not one, and fails it on both hyperframes pins (see
  `.planning/2026-09-04-hyperframes-0.8.27.md`);
  the default compares PSNR against a 40 dB floor. Costs two full renders, so it is a
  thing you schedule rather than a thing you run per build. See
  `.planning/EXPERIMENT-006-diagrams.md` for why byte-identical is not available in
  general on this stack.
- **pack** / **unpack** — the whole deck as one `.deck` file, and back again. See "The
  `.deck` container" below.

### Ingesting a web page

`ingest` takes a URL wherever it takes a file:

```sh
decksmith ingest https://example.com/the-paper -o source.json
```

It opens a headless Chrome, puts the page's own bytes into it, and **aborts every request
the page then makes**. A browser pointed at a stranger's URL is otherwise an open proxy —
the page says `<img src="http://169.254.169.254/latest/meta-data/">` and the browser
fetches it from inside your network. So the HTML comes through the same address guard
everything else here uses, and each figure is fetched afterwards, one at a time, through
that guard again. That has a cost, and it is stated rather than discovered: a page that assembles its body
from an external bundle harvests to almost nothing, because that bundle was one of the
aborted requests. Save the page and ingest the file.

Which part of the page becomes the document is scored the way Readability scores it: strip
what the tag, the ARIA role or the class name says is chrome, score every paragraph by its
length and its commas, propagate that up to five levels of ancestor, discount each
candidate by its link density, then merge the winner with the siblings that score near it.
That is what keeps a consent banner and a 142-comment thread out of a deck about the
article. When it is not sure it declines, says so, and leaves the page to a blunter rule —
believe `<main>`, believe `<article>`, else take the densest container. Either way the
line after it is the one to read:

```
ingest: harvested "Sparse attention at scale" — 6 images, 1 clips
ingest: 9 sections, 6 figures, 0 equations
```

Nine sections for a nine-section article is the extraction working. Ninety is the page.

**A video has three cases, and they are three different decks.**

- **A file the page serves** — `<video src="…mp4">`, or a link ending in one — is
  downloaded, measured off its own container, and re-encoded to a VP9 webm no more than
  1280px on its longest edge, with the audio dropped and the length capped at 60 seconds.
  It **plays in the presented deck and in the rendered mp4**: the composition holds a real
  `<video>` seeked on the deck's own clock. The encode is why the cap exists — `render`
  pre-decodes a clip to one still per output frame before capture begins, at the source's
  own resolution, so a 4K original writes 4K stills into an 860px plate. **If ffmpeg is
  not installed the clip is still used**, exactly as the page served it, and the harvest
  says so in a warning naming what to install. `--no-transcode` asks for that on purpose;
  `--max-clip-seconds` moves the cap.
- **A player-page link** — YouTube, Vimeo, Dailymotion, Loom — keeps its still and where
  to watch it. The **mp4 gets the poster frame**, because that is all a captured document
  can honestly hold. The **presented deck gets the real player**: `deck.html` carries the
  embeddable form of that URL, and a `▶ Video` button (or `v`) opens it over the slide,
  click to play, torn down when you leave the slide. Nothing is fetched until you press
  it, and `index.html` never gains an iframe — a third-party frame in the captured
  document would play at wall-clock speed while the deck is being seeked, and refetch
  itself from the network on every render.

  **The bytes are deliberately not downloaded.** They sit behind a manifest, DRM or terms,
  and pulling down what a YouTube link stands for is usually against that site's terms.
  It is the same `embed` policy the container uses — see "bake, link, embed" below — and
  it is a property of the URL rather than a choice you can make. A host we have no
  verified embed rule for keeps the poster and the link, and no frame: a URL we invented
  would 404 inside the frame as a black rectangle with nothing to click.
- **No video at all** is the ordinary case, and nothing changes. A `<video>` with a poster
  and no source becomes an ordinary figure, warned; one with neither becomes a line of
  prose carrying the link, also warned.

The URL-only budgets, each named after the option it sets so that a refusal naming
`maxAssets` names something findable in `--help`: `--max-assets` (40), `--max-clips` (4),
`--max-bytes` (96 MB in total), `--max-seconds` (180, wall clock for the whole harvest),
`--max-clip-seconds` (60, per clip), `--no-transcode`. Every figure, clip or whole video
left out is printed verbatim before the plan is paid for, which is the only moment anyone
can act on it.

### What `build` writes

```
out/
  index.html                    the composition — what check, snapshot and render consume
  deck.html                     open this: the navigable deck
  hyperframes-player.global.js  copied from the hyperframes package, so nothing needs a CDN
  hyperframes.json
  vendor/                       the scripts the head loads, and only those: GSAP and
                                DrawSVG on every deck, MorphSVG (21,195 B) only on one
                                that reshapes, ds-morph.js only on one that morphs an
                                equation
  katex/                        katex.min.css rewritten to its woff2 faces, and those fonts
  assets/                       every figure a beat cites — generated ones included, under
                                the same name source.json records
  audio/                        only when the deck is narrated
```

Serve the directory and open `deck.html` — any static server will do. It must be http,
not `file://`: the wrapper drives the composition through its iframe, and a file-origin
iframe cannot be reached. The deck says so in the console rather than rendering blank.

Arrow keys, Space and PageUp/PageDown step; clicking the left or right third does too;
`Home`/`End` jump; `p` plays the deck by itself and pauses it again; `n` toggles presenter
notes; `f` is fullscreen; `m` mutes the voice and `s` hides the subtitles. Every step is
deep-linkable (`#3` is slide 3, `#3.2` its second reveal).

### The v2 player (`--design v2`)

`build --design v2` (or `"design": "v2"` in the storyboard or config) gives `deck.html` the
v2 player; everything else about the build is unchanged. A deck that is already built
gets it without rebuilding:

```bash
decksmith repack out/            # writes out/deck2.html beside deck.html, never over it
```

`repack` swaps the inlined runtime, marks the page and checks that every JSON island is
byte-identical — no Chrome, no TTS, no re-render.

- **One control bar**: play/pause, the counter, narration speed (0.75–2×), `CC`, caption
  size (S/M/L/XL) and fullscreen — or, in a window too narrow for those beside a caption,
  play and one settings menu. **It never covers text.** It docks under the slide in spare
  letterbox (a portrait phone); over the slide's empty bottom padding when that holds a
  40px target (a slide about 720px tall or more), where it hides 2.5s after the last
  pointer move while the deck plays; otherwise in a band under the slide that it shares
  side by side with the captions, whose text is padded in past the buttons.
  `test/deck-page.test.ts` measures controls against caption text and against every glyph
  the slide draws, at six viewports.
- **Play/pause** pauses the voice where it is and carries on from the same word. A deck
  opens paused; stepping while paused moves the slide silently.
- **Speed** sets the narration's `playbackRate` live, on the sentence already playing, and
  divides the reveal glides and every autoplay wait by the same factor so they keep pace.
  A stop with no narration holds for its reveal and 1.5s at 1×, not the author's gap.
- **Captions** are sized from the slide (3% of its height, 13px floor; L and XL keep floors
  of 16 and 19px so the size control works on a phone) and the slide gives up only one
  two-line strip for them: 84% of the frame at 1080p, 83% in an 800×450 embed (v0.8.0: 77%
  and 69%), 100% in a portrait letterbox. Long cues are cut to two lines of the strip's
  actual width, which also splits Japanese and Chinese.
- **Keys:** Space steps forward (Space is the presenter's key, not play); `Enter` plays and
  pauses; `c` (or `s`) captions; `<`/`>` speed; `+`/`-` caption size. Letter keys fall back
  to the physical key under a Korean or Japanese IME. Anything held with Cmd, Ctrl or Alt
  is left to the browser.
- **Preferences** — speed, captions on/off, size — come from `?speed=1.25&cc=0&ccsize=l`
  (this visit only), else from `localStorage` (`decksmith.prefs.v1`), else the defaults.
  When the viewer changes one, the deck posts
  `{ type: "decksmith:prefs", speed, cc, ccsize }` to its parent so an embedding site can
  keep it per user (a cross-site iframe's storage is partitioned), and it applies the same
  message when the parent sends it. Check `event.origin` on your side.

Stepping forward *plays* the reveal rather than cutting to it — the step layer sweeps the
composition's timelines across frames instead of seeking once. Backward steps, `Home`/`End`
and deep links cut, because entrance tweens run in reverse look like elements un-drawing
themselves. A held slide keeps a slow ambient motion on one focal element so it reads as a
live document rather than a screenshot. Both respect `prefers-reduced-motion`, and both
exist only on the deck page: ambient motion is gated behind a class the composition never
sets, so `render` output is byte-identical with or without it.

Navigation is ours rather than upstream's because upstream's is broken at 0.7.71/0.7.72
and still broken at 0.8.27 — `player.scenes` never populates, reproduced on HeyGen's own
reference example, and at 0.8.27 the property is not on the player at all. The
same layer also paints the composition, because the standalone player moves its clock
without driving scene timelines or clip visibility. See
`.planning/EXPERIMENT-003-deck-mode.md` and `-004-step-layer.md`.

### What the gates do not check

The failure this project keeps producing is a **green gate over wrong output**, and there
are now eleven documented cases. Nearly every one was caught by a human looking at the
artifact. Three are worth reading as patterns rather than bugs:

- A camera move that the video renderer replaced with a still, for exactly the right
  number of frames, while lint, check, the type floor and the two-render drift gate all
  passed — [`.planning/EXPERIMENT-007-reconcile.md`](.planning/EXPERIMENT-007-reconcile.md).
- `build --format short-9x16` reporting PASS over decks whose content ran off the right
  edge, because the content box was hardcoded to 16:9 —
  [`.planning/EXPERIMENT-008-reconcile.md`](.planning/EXPERIMENT-008-reconcile.md). The
  same round found two archetypes silently sharing one CSS class, which no gate can see:
  `verify` measures rendered geometry, and the geometry happened to come out right.
- Seven seams where the deck cut to flat background for three to five frames, and eleven
  frames at a cameraed one, with every gate green — nobody had extracted a frame at a
  seam. And, at 9:16, burned captions sitting on top of the slide's own text on 54% of
  sampled frames, because `marginV` was measured to clear *player chrome* and nothing ever
  guaranteed it cleared the *composition*. Both in
  [`.planning/EXPERIMENT-010-reconcile.md`](.planning/EXPERIMENT-010-reconcile.md). The
  seam one is **closed** in the render: each scene's clip outlasts its slide and dissolves
  over the next scene's empty opening. It stayed open in `deck.html` until 2026-09-18,
  because the presented deck's own visibility pass read the slide instead of the clip,
  and gliding across a seam still showed eleven 60Hz ticks of background. Every gate was
  green, and it was found by stepping that glide one tick at a time —
  [`.planning/2026-09-18-scene-boundary-blink.md`](.planning/2026-09-18-scene-boundary-blink.md).
  The caption one is **closed**: `build --reserve-captions` gives the band its own strip and
  `fidelity` fails a deck that draws into it. It is worth reading for how it closed —
  the plan written to fix it asserted that every archetype lays out into `contentH`, ten
  of them do not, and the first fix therefore changed the worst stop by nothing at all.
  The new gate is what caught that; every other gate stayed green through it.

`verify` is good at mechanics — overflow, overlap, contrast, motion, determinism. It has
no opinion about whether a slide communicates. Across four experiments it passed, in
turn: an unreadable slide, a deck with zero navigable slides, and a deck that navigated
perfectly while displaying nothing. **Look at the output before you ship it.** Fidelity
checking against the source (design §5) is not in v0.

`--format` selects a profile: `deck-16x9`, `video-16x9`, `short-9x16`, `post-1x1`. A
profile decides canvas, pacing, how many beats survive (`minWeight`) and how long the cut
may run (`maxSeconds`) — never what a beat means. That is why one storyboard retargets
instead of being re-cropped.

Every archetype derives its layout from `contentW(format)` / `contentH(format)`, so a
portrait canvas gets a portrait arrangement rather than a squeezed landscape one: pipeline
runs down the page, split-compare stacks its panels, bar-compare puts each label above its
own rail. Six archetypes branch on `isPortrait(format)`; the rest are width-driven and
need no branch. Square (`post-1x1`) deliberately takes the landscape branch.

### Fitting a short

`minWeight` and `maxSeconds` describe the same editorial decision from two directions, and
for any given storyboard they can disagree. `short-9x16` allows 3m00s; the demo's twelve
beats are all weighted ≥0.7, so the profile's 0.6 floor keeps all of them and the narrated
cut runs 4m07s.

**`build` now fits the deck to the format's length**, and says what that cost:

```sh
decksmith build storyboard.json --source source.json --format short-9x16 -o short/
# build: 9 of 12 beats at 1080×1920 in ink → short/index.html
# build:   cut b04 (grid, 19.7s) — Cut to fit short-9x16's 3m00s: 19.7s for weight 0.85
#          is 0.043 weight per second, and the beats kept buy more per second.
#          Its family (structure) still has 3 beat(s) in the cut.
# build:   cut b06 (stack, 24.7s) — …
# build:   cut b09 (data-table, 25.4s) — …
# PASS — 0 error(s), 2 warning(s)
```

The rule is `selectBeats` (`src/plan/select.ts`), and it is not "drop the lightest". In
priority order it keeps a cut **coherent**, then **covered** — the deck's first and last
beat, one beat of every archetype family the full deck used, and one beat carrying a
figure of the source's, because a deck that cuts its way to no picture at all cannot get
one back by rewording — then **fitting**, and only then heaviest. Author weight is the last tiebreak, because weight says how much a
beat matters and nothing about what it costs: two 14-second beats at 0.80 are worth more
to a three-minute budget than one 39-second beat at 0.95, and a threshold cannot say so.

Every casualty arrives with a sentence naming what it cost, what it was worth, and what
the deck still has of its kind. **That printing is the reason the trim is allowed at
all.** A budget that trims quietly is the failure the budget gate spent three experiments
refusing to become: PASS on a deck with a third of its argument missing and nothing
anywhere saying which third. Library callers get the same answer as `buildDeck().cut`.

`--min-weight` is unchanged, and is still how you say which beats you want gone:

```sh
decksmith build storyboard.json --source source.json \
  --format short-9x16 --min-weight 0.85 -o short/
# build: 8 of 12 beats at 1080×1920 in ink (4 below minWeight 0.85) → short/index.html
# PASS — 0 error(s), 2 warning(s)
```

It is a **floor, applied first**, and its casualties are reported separately so an
author's own cut is never blamed on the budget. The budget only trims what is left, and
only if that still does not fit — at 0.85 the demo's eight beats run 2m49s, so nothing
more is dropped and the output is byte-for-byte what it was before selection existed. It
lives on the command rather than in the profile because which beats survive a shorter cut
is a judgement about *this* deck, not about the canvas.

The budget gate still exists and is now the backstop: it fires when no cut of these beats
fits — the narration itself has to get shorter — or when a deck was assembled by
something other than `build`.

Two things selection deliberately does **not** do. It never shortens a beat, because a
beat's length is measured speech and the only way to shorten one is to write a shorter
sentence — a `plan`-time decision, and the better product (twelve beats at 15s beats nine
at 20s). And it does not repair a **dangling citation**: when a kept beat cites a figure
only a dropped beat showed, `build` prints `check the wording` and leaves it, because
dropping the citing beat too would lose the claim to save the footnote.

## Running the server

There is a web front end: drop a document, pick a format, watch the stages, get a deck.
It is `npm run serve`, it binds `127.0.0.1:8475`, and it calls the library directly —
`src/server/pipeline.ts` imports `src/index.ts` and shells out to nothing.

```sh
npm run serve          # builds dist/, builds dist/server/, then listens
open http://127.0.0.1:8475
```

Startup says what is missing before anyone waits on it:

```
decksmith: http://127.0.0.1:8475
decksmith: work /tmp/decksmith-server, one job at a time, 8 may wait
decksmith: no auth. Bound to 127.0.0.1, so anyone with an account on this machine can spend your Codex quota — set DECKSMITH_TOKEN_FILE to require a token.
decksmith: codex, edge-tts and ffmpeg all found
decksmith: images via codex, then svg
```

The last line is where `illustrate` would get its pictures — `via openai` when a backend
is configured, or the reason it cannot be used. Reported, never fatal: a job that asks
for pictures still finishes, on the tool's own SVG if it has to.

### The HTTP surface

| Route | What it does | With a token file |
|---|---|---|
| `POST /api/jobs` | multipart: `file` (.md/.markdown/.txt/.zip) plus option fields → `202 {id}` | token |
| `POST /api/jobs/:id/retry` | runs a job the server kept on disk again, under a new id | token |
| `GET /api/jobs/:id` | `{state, stage, steps[], log[], error, result, queuePosition}` | token |
| `GET /api/jobs/:id/events` | the same payload as SSE on every change | token |
| `GET /api/formats` | the presets, themes, tones, densities and canvas bounds the picker draws from | token |
| `GET /d/:id/...` | the built deck, served statically; `/d/:id/deck.html` is the player | public |
| `GET /player.js` | the `<decksmith-player>` element, as an ES module — see below | public |
| `GET /examples/embed.html` | a page that embeds two decks with it, and the file you copy | token |
| `GET /` | the uploader; with a token file and no session, the login page | public |
| `POST /login`, `POST /logout` | set or clear the session cookie, then 303 to `/` | public, only with a token file |

"Token" means `Authorization: Bearer <token>` or the session cookie the login page sets.
A route that is not in this table answers 401 when a token file is configured, so a route
added later starts out private. A deck id is 128 random bits and is meant to be shared,
which is why `/d/` stays public; the job routes are keyed by the same id, which is why
they do not.

Options on `POST`, all optional, all defaulted server-side: `format`, `width`+`height`,
`theme`, `slides`, `lang`, `tone`, `density`, `speed`, `narrate`, `voice`, `images`,
`video`. `images` lets the plan ask for pictures and runs the `illustrate` stage after it.

`width`/`height` override the named preset's canvas and **keep its pacing but not its
name** — `--format short-9x16 --width 1080 --height 1350` builds `custom-1080x1350` with
a Reel's weight floor and duration ceiling, because "short-9x16" printed over a 4:5
canvas would be a lie in every cut explanation that quotes it. Canvases run 64–5648px a
side, up to 4 megapixels, between 1:8 and 8:1. The first three of those are the library's
(`canvasProblem` in `src/types.ts`, derived from the layout and Chrome's texture ceiling);
the megapixel ceiling is the server's own, because capture holds whole frames in memory
on a box every job shares. `GET /api/formats` publishes all of them and the page enforces
exactly those numbers — they were three disagreeing tables until 2026-07-28.

### Configuration

Every knob is an environment variable, and every default is the safe one rather than the
generous one.

| Variable | Default | Why |
|---|---|---|
| `PORT` | `8475` | |
| `DECKSMITH_HOST` | `127.0.0.1` | `127.0.0.1`, `::1` and `localhost` are loopback. **Anything else refuses to start** without `DECKSMITH_TOKEN_FILE`, `DECKSMITH_TLS_CERT` and `DECKSMITH_TLS_KEY` — `127.0.0.2` and `::ffff:127.0.0.1` included. |
| `DECKSMITH_TOKEN_FILE` | unset | A file holding the token (`openssl rand -base64 32 > f; chmod 600 f`). Set, every route but the public ones in the table above needs it, on any bind. Refused unless it is a regular file, not readable by group or others, 32–1024 characters, one line. |
| `DECKSMITH_TLS_CERT` / `DECKSMITH_TLS_KEY` | unset | A PEM chain, leaf first, and its **unencrypted** PEM key (mode 600). Set both or neither. Refused unless the certificate is PEM (not DER), matches the key, is in date, has subjectAltNames, and loads into OpenSSL at TLS 1.2. On an exposed bind those subjectAltNames are the only `Host` names the server answers to, and the startup banner prints one of them. |
| `DECKSMITH_TOKEN` | — | **Not read, and refused if present**, even empty: ignoring it would leave a server someone believes is protected open, and an environment variable reaches shell history and every process the server starts. |
| `DECKSMITH_WORK` | `$TMPDIR/decksmith-server` | One directory per job; swept by age. |
| `DECKSMITH_MAX_UPLOAD` | 25 MB | |
| `DECKSMITH_MAX_QUEUE` | `8` | Concurrency is 1. Past 8 the answer is "full", not "position 400". |
| `DECKSMITH_JOB_TTL_MIN` | `120` | Files outlive the in-memory record; orphans are swept on boot. |
| `DECKSMITH_JOBS_PER_HOUR` | `5` | Per IP. Charged only on an **accepted** job. |
| `DECKSMITH_REQS_PER_MIN` | `240` | Per IP. |
| `DECKSMITH_FETCH_FIGURES` | on | See below. |
| `DECKSMITH_DECK_SANDBOX` | on | Serves decks under `CSP: sandbox`. Turning it off is refused with a token file or on an exposed bind. |
| `DECKSMITH_IMAGES` | unset | `openai` names a separate image backend for `illustrate`. Unset, pictures come from the Codex account, then the tool's own SVG. |
| `DECKSMITH_IMAGES_API_KEY` | | The backend's key. Environment only — never a preference, a config file, a `.deck`, or an error message. |
| `DECKSMITH_IMAGES_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible `images/generations` endpoint. |
| `DECKSMITH_IMAGES_MODEL` | `gpt-image-2` | The backend's model. The Codex rung draws with the account's own. |

**Remote figures are fetched by default, and what makes that safe is not the flag.** A
paper's markdown usually links its images rather than attaching them. `guardFigures` in
`src/server/pipeline.ts` drops any figure whose host resolves to a private, loopback or
link-local address, and the fetch checks the address again when it connects, because DNS
can answer differently the second time. `fetchFigures` does `readFile(src)` on anything
that is not an http URL, so an uploaded document containing
`![](../../../etc/ssh/ssh_host_rsa_key)` would have this process read it: relative paths
are resolved inside the upload directory and confined there. `DECKSMITH_FETCH_FIGURES=0`
drops every http figure with a named warning. (The table above said "off" until
2026-09-18, while `main.ts` defaulted it on.)

### Opening it to a network

To use a server on another machine yourself, leave it on loopback and tunnel:
`ssh -L 8475:127.0.0.1:8475 <host>`, then open `http://127.0.0.1:8475` locally. Nothing
else is needed. If other people have accounts on either machine, add a token file.

To bind anything else, the server needs all three:

```sh
openssl rand -base64 32 > ~/.decksmith-token && chmod 600 ~/.decksmith-token
DECKSMITH_HOST=0.0.0.0 \
DECKSMITH_TOKEN_FILE=~/.decksmith-token \
DECKSMITH_TLS_CERT=/etc/decksmith/fullchain.pem \
DECKSMITH_TLS_KEY=/etc/decksmith/privkey.pem \
npm run serve
```

Missing any of them, it refuses to start, names every problem at once, and exits 1 before
it touches the work directory. There is no override. The certificate must list the names
people will type as subjectAltNames: those names, and nothing else, are what the server
answers to, so DNS rebinding is refused on this bind as well as on loopback — and the
startup banner prints a URL built from one of those SANs, not from the bind address,
because `https://0.0.0.0:8475` is a URL this server answers 403 to. The certificate is
checked as far as OpenSSL will check it before anything is created on disk: a PEM chain
(a DER file is refused by name, with the `openssl x509 -inform der` line that converts
it), matching the key, in date, with SANs — and then loaded into a real
`tls.createSecureContext`, so a key OpenSSL will not use, such as an RSA key under 2048
bits, is a refusal here rather than an OpenSSL stack trace out of `listen`. There is no
plain-http listener or redirect beside it, and no HSTS. Renewing the certificate or
rotating the token means restarting.

A browser gets a login page at `/`. The token goes in a password field, so a password
manager can keep it. The server sets a cookie named for the port it is bound to —
`__Host-decksmith-8475` over TLS, `decksmith-8475` on plain loopback — `HttpOnly`,
`SameSite=Strict`, valid seven days. It is signed with a key derived from the token and
from `host:port`, so it survives a restart, rotating the token file logs every browser
out, and a second DeckSmith on the same machine neither overwrites this one's cookie nor
accepts a session it minted. Scripts send `Authorization: Bearer <token>` instead. A
write that relies on the cookie must carry `Sec-Fetch-Site` or `Origin`; a current
browser sends both on a POST. Ten wrong tokens from one address lock that address out for
fifteen minutes, including a right token sent during that time; the lockout is logged
once and every attempt refused during it is logged too. The log records refusals and
never the token, a cookie or an `Authorization` header.

Three things that cookie does **not** do, each of which this README claimed until
2026-09-18:

- **Logging out does not revoke the session.** `POST /logout` clears the browser's copy.
  The value is a MAC over an expiry, checked with no server-side state, so a copy taken
  before the logout keeps working until it expires — up to seven days. Rotating the token
  file and restarting is what actually revokes.
- **`SameSite=Strict` does not stop another site steering a logged-in viewer.** It
  withholds the cookie from a navigation another site starts, and sends it on one this
  origin starts. A deck is public and opens top-level, so a link from anywhere can put a
  hostile deck on screen, and that deck can navigate itself to
  `/examples/embed.html?a=<its own directory>` — a same-site hop, which arrives with the
  session. Measured, and it queued a job. `/examples/embed.html` now carries
  `connect-src 'none'`, which is what refuses that job; the page needs no network of its
  own, and the decks it frames still load.
- **The cookie is not confined to this port.** Cookies have no port (RFC 6265 §1), so the
  browser sends this one to every listener on the host. See below.

Every response that is not a deck file carries `X-Frame-Options: DENY` and
`Content-Security-Policy: … frame-ancestors 'none'`, so nothing can frame the uploader,
the API, or an error page.

#### What a same-host attacker can still do

Anything on this machine that the browser can be made to talk to is handed the session
cookie, because cookies are scoped by host and never by port. So, with a token file set
and a browser logged in, another local account can:

- **read the session cookie** by getting the browser to make any request to a port it
  listens on — a page the viewer opens, an image, a redirect — and then **replay that
  value from a script**, as the logged-in user, until it expires. Naming the cookie after
  the port does not hide it; nothing this server does can, because the decision is the
  browser's. The fix is not on this host: it is a distinct hostname per service, or decks
  and API on separate origins with a `__Host-` cookie that cannot leave one;
- **read the token file**, if its mode allows it — which is why a mode other than 600 is a
  refusal at startup;
- **lock the owner out for fifteen minutes** by sending ten wrong tokens. Every local
  process shares `127.0.0.1` as far as `socket.remoteAddress` is concerned, and that is
  the only key the limiter has. The lockout and each refusal during it are in the log, so
  it is at least visible;
- **reach a loopback bind at all, when no token file is set.** That is the default.

Over the LAN, with an exposed bind, none of the above follows: the cookie is `__Host-`
and `Secure`, the connection is TLS 1.2 or better with no plain-http listener beside it,
and a request by any name the certificate does not list is refused before the token is
even considered. What a LAN attacker gets without the token is the deck files whose
128-bit id they already know, and nothing else.

### What is missing before this is public

A token and TLS are in: see "Opening it to a network" above. This is what is still
missing, and some of it is not a polish gap:

- **One token, no accounts.** Everyone who holds the token is the same user, with the same
  quota and the same view of every job whose id they know. A single session cannot be
  revoked, and neither can logging out revoke one: rotate the token file and restart. No
  roles, no per-token quota, no OIDC.
- **The session cookie is shared with every other port on this host**, and a captured one
  replays until it expires. See "What a same-host attacker can still do" above.
- **No reverse-proxy support.** `X-Forwarded-*` is not read (see the rate-limit item
  below), and on a loopback bind the `Host` check refuses whatever public name a proxy
  forwards.
- **Without a token file, loopback is open to this machine.** Anyone with an account on it
  can reach `127.0.0.1`. `DECKSMITH_TOKEN_FILE` on loopback turns the token on there too.
- **Codex spend is unmetered per upload.** The per-IP hourly limit is the only brake, and
  it is per-IP.
- **Rate limiting is by `socket.remoteAddress` only.** `X-Forwarded-For` is deliberately
  not read, because unproxied it is a header the client writes. Behind a reverse proxy
  every client therefore looks like one address and the limits collapse — teach the proxy
  to rate-limit, or teach this to trust exactly one hop. On a loopback bind every local
  process is already that one address, so the failed-token lockout is a denial of service
  any local account can aim at the owner; it is logged, not prevented.
- **Deck files are readable by anyone holding the 128-bit id.**
- **The deck sandbox does not isolate the origin, and cannot on one host.** Decks are
  served under `Content-Security-Policy: sandbox allow-scripts allow-same-origin
  allow-downloads`, which still denies top-level navigation, popups, forms and modals —
  but `allow-same-origin` is not optional: `deck.html` is the HyperFrames player and it
  drives the composition through `iframe.contentDocument`, so an opaque origin makes
  every slide render blank while the job reports `done`. Real isolation means serving
  `/d/:id` from a **separate origin**, which is a second listener and is not built.
- **A deck shown inside the uploader can act as whoever is logged in.** The deck is
  same-origin with the page around it, so its script can call `parent.fetch`. That call
  runs under the uploader's policy, not the deck's `connect-src 'none'`, and carries the
  session. Measured: a stub deck doing this queued a job
  (`.planning/2026-09-18-deck-parent-reach.md`). A deck opened on its own cannot: nothing
  it could frame will load, and the one page it can navigate the viewer to,
  `/examples/embed.html`, carries `connect-src 'none'` — both measured, both with their
  control. So what is left needs hostile content converted by the operator, script that
  survives into the deck, and the operator watching that deck **in the uploader**, which
  is the one page that must be able to reach the API.
  `DECKSMITH_JOBS_PER_HOUR` still caps what it can spend. The fix is the separate deck
  origin above.
- **No persistence.** A restart forgets every job record. The files survive and are swept
  by age on boot.
- **Disk is bounded only by TTL × queue rate**, and uploaded files are not scanned.

## Connecting an agent (MCP)

`decksmith-mcp` is a stdio [MCP](https://modelcontextprotocol.io) server, so an agent can
turn a document into a deck with the same settings the CLI takes.

```json
{
  "mcpServers": {
    "decksmith": {
      "command": "node",
      "args": ["/absolute/path/to/DeckSmith/dist/mcp.js"],
      "env": {
        "DECKSMITH_MCP_ROOT": "/Users/me/papers",
        "DECKSMITH_MCP_WORK": "/Users/me/.decksmith"
      }
    }
  }
}
```

Build it first with `npm run build`. `DECKSMITH_MCP_ROOT` is the fence
— documents outside it are not readable, and it defaults to your home directory rather than
the working directory, because not every client launches a stdio server anywhere useful.

Four tools:

| tool | what it does |
|---|---|
| `decksmith_capabilities` | formats, themes, every setting's range, which of Codex, edge-tts, ffmpeg and Chrome are installed, and where `illustrate` would get its pictures (`images: { backend, ok, why }`) |
| `decksmith_estimate_length` | what a duration/slides/density combination costs, and what it cannot buy — instant, no job |
| `decksmith_create_deck` | document + settings → a deck, and optionally an mp4 |
| `decksmith_job_status` | where a job got to |

**The pipeline takes minutes**, so `create_deck` and `job_status` block for `wait_seconds`
(default 45, max 300) and then answer with whatever is true; the job keeps running between
calls. Prerequisites are checked *before* the job starts, so a missing ffmpeg is a message
in milliseconds rather than a failure four minutes in.

Every report carries `storyboard_path`, and that is the point of the surface rather than a
convenience: the storyboard is JSON on disk, an agent can read and edit it natively, and
[it is the human checkpoint](#the-storyboard-is-the-human-checkpoint) where the quality is
won. `estimate_length` returns `durationPlan`'s warnings verbatim for the same reason —
they are the product telling you what your settings cost.

No setting has a default in the tool schema. Absence is the signal: a theme you did not
mention loses to the storyboard's own, and a language you did not mention loses to the
document's. `images: true` lets the plan ask for pictures and draws them before the build;
it is refused only when a backend is named in the environment and broken, because the
tool's own SVG means a request never fails for lack of one.

## Using it as a library

A server generating a deck per document should not shell out to a binary. It costs an
argv round-trip for a 200 KB JSON document, it turns a typed failure into an exit code,
and it gives you no way to edit the storyboard between stages. So the same pipeline is
importable, and `src/index.ts` is the whole of the public surface — chosen name by name,
each with the reason it is there.

### Installing

```sh
npm install @jokerized/decksmith
```

Scoped, because the bare name `decksmith` on npm is somebody else's package — at 1.1.3,
and nothing to do with this one. The two executables keep their short names: `decksmith`
and `decksmith-mcp`.

Installing from git works too and needs no registry, which is what to reach for if you
want a commit that is not a release:

```sh
npm install "github:ca1773130n/DeckSmith#<commit>"
```

`dist/` is not committed, so the package builds itself during install: `prepare` runs
`npm run build`, and npm runs `prepare` on a git install and before a publish. Pin a
commit rather than a branch — the build is the package.

### Releasing

Pushing a `v*` tag publishes it. `.github/workflows/release.yml` re-runs the four gates
— a tag can point at any commit, including one that never saw a pull request — checks
that the tag matches `version` in `package.json`, and publishes.

There is no npm token anywhere in the repository. The workflow authenticates by OIDC
([npm trusted publishing](https://docs.npmjs.com/trusted-publishers)): npm mints a
short-lived credential for this workflow, on this repository, at publish time. Two
consequences worth knowing before you touch anything:

- **The workflow's filename is part of the credential.** The trusted publisher on
  npmjs.com names `release.yml` exactly, and npm does not check that configuration when
  you save it. Rename the file and publishing fails as an authentication error that says
  nothing about a rename.
- **So is the environment name.** The job runs in the `release` environment and the
  trusted publisher requires that claim, which is what stops some *other* workflow in
  this repository from publishing. Both ends have to say `release`.
- **`repository.url` in `package.json` must match this repo exactly**, for the same
  reason.

The `release` environment is also where deployment protection lives. It is restricted to
`v*` **tags**, so a push to a branch cannot reach it. Required reviewers would go here
too — GitHub gates that rule behind a paid plan for private repositories, so there is no
human approval step today; anyone who can push a `v*` tag can publish.

```sh
npm version minor      # bumps package.json and tags
git push --follow-tags
```

**The first publish of a new package cannot use OIDC.** npm requires a package to exist
before a trusted publisher can be attached to it — the website and `npm trust` both say
so — so version 0.1.0 has to be pushed by hand, once:

```sh
npm login                       # your account, your 2FA
npm publish --access public     # scoped packages default to private
```

Then attach the trusted publisher (npmjs.com → the package → Settings → Trusted
publishing, or `npm trust github ...`), and every release after that is a tag. Publishing
by hand rather than with a bootstrap automation token is deliberate: it means no
long-lived credential is ever created, so there is none to revoke afterwards and none to
forget about.

### Generating a deck

```js
import { buildDeck, FORMATS, sourceSchema, storyboardSchema, verify } from "@jokerized/decksmith";

const source = sourceSchema.parse(JSON.parse(await readFile("source.json", "utf8")));
const storyboard = storyboardSchema.parse(JSON.parse(await readFile("storyboard.json", "utf8")));

const { out, files, navigable } = await buildDeck(storyboard, source, "./deck", {
  format: FORMATS["deck-16x9"],
  theme: "ink",
  assetsFrom: ".",            // the directory whose assets/ holds the figures
  onBeatError: (id, err) => {},    // the beat is not in the deck
  onBeatWarning: (id, why) => {},  // the beat IS, minus an ornament it could not fit
  onStep: console.log,        // silent otherwise: a library that prints is one you
});                           // cannot run inside a request handler

const verdict = await verify(out);   // needs Chrome; skip it on the request path
```

`buildDeck` is the `build` verb minus argv, and writes exactly what the CLI writes — the
demo deck built this way is byte-identical to `decksmith build`'s. It does **not** run the
gates, because `verify` wants a browser and a caller may have neither one nor the patience
for it; call `verify` yourself when you want it.

`onBeatWarning` is the only signal that a slide is finished-looking but not what was
planned — a `line-chart` drawn without its comparison, say. `build` prints it and the
server puts it in the job's warnings; a library caller that ignores it ships the same
silence this project keeps finding by eye.

### The surface

| Stage | Exports |
|---|---|
| ingest | `parseMarkdown`, `fetchFigures`, `bundleFont` |
| plan | `codexPlanner` with its `Runner` type, `assertRefsResolve`, `systemPrompt`, `renderSource` |
| images | `illustrate`, `imageChain`, `resolveImageBackend`, `hasIllustrations`, with `ImageProvider`, `ImageRequest`, `ImageResult`, `IllustrateOpts` |
| narrate | `narrate`, `pickVoice`, `narratableLangs` |
| emit | `buildDeck`, `emitDeck`, `emitComposition`, `resolveTheme`, `THEMES`, `THEME_NAMES` |
| verify | `verify`, `check`, `parseCheckReport` |
| pack | `writePack`, `readPack`, `openPack`, `planMedia`, `mediaSummary` |
| prefs | `loadPrefs`, `CONFIG_FILE` |
| process | `guardTmpdir` |
| contract | everything in `src/types.ts` — every schema, `Source`, `Storyboard`, `Beat`, `Format`, `FORMATS`, `Verdict` |

Two of those are worth pointing at. `Runner` is exported so you can drive planning through
an SDK instead of a subprocess, which is what a server actually wants — `codexPlanner`
shells to the Codex CLI only because that is the right default at a terminal. And
`emitDeck` sits underneath `buildDeck` for callers writing to object storage or a response
body rather than a filesystem: it is pure, taking strings in and returning strings out.
`ImageProvider` is the same kind of seam as `Runner`: `illustrate` takes a `chain` of them,
so a server's tests draw with a fake instead of spawning Codex, and a deployment can add a
backend this package does not ship.

`guardTmpdir` is the odd one out: it is not part of building a deck, it is what an
executable that is about to `mkdtemp` calls first. It deletes a `TMPDIR` that resolves
inside the package root and says so on stderr, and it is a no-op in an installed package.
Importing this module does not run it, deliberately — an absent `TMPDIR` is inherited by
every child process a host spawns, which is not a decision a library import gets to make
for its host. Our own three executables call it; nothing else does.

Anything not listed is deliberately absent, and adding to the list is a promise we cannot
quietly take back. `prefsFromFlags` is the clearest example: it translates commander's flag
object, which is the CLI's problem and nobody else's.

## Preferences

What the person asking for the deck gets to decide. Split deliberately: `plan` reads the
ones that change *what is said*, `emit` reads the ones that change *how it looks*, and
neither reaches for a field it does not own — which is why changing a preference never
invalidates a storyboard you have already edited.

| Preference | Default | Read by | What it does |
|---|---|---|---|
| `slides` | `12` | plan | target beat count. A target to come close to, not a quota to fill |
| `lang` | the source's | plan | BCP-47. Drives the copy, the voice, and the font subset |
| `tone` | `plain` | plan | `plain` · `academic` · `conversational` · `punchy` |
| `density` | `normal` | plan | `sparse` · `normal` · `dense` — how much text a slide may carry |
| `theme` | `ink` | emit | `ink` · `paper` · `mono`, or a v2 style pack by name (see Themes) |
| `design` | `classic` | narrate, emit | `classic` is the v0.8.0 look byte for byte · `v2` is the redesign: the v2 player (see "The v2 player") and a style pack per deck when no theme is named |
| `packSeed` | the source id | narrate, emit | what `design: v2` hashes to pick a pack; pass a paper id so its languages share one |
| `animationSpeed` | `1` | emit | multiplies every duration, hold and beat length. Below 1 is faster |
| `design` | `classic` | emit | `classic` (the 0.8 look, byte-identical) · `v2` (the redesign — see [v2 motion](#v2-motion)) |
| `narration.voice` | picked for `lang`+`tone` | narrate | an explicit edge-tts voice id |
| `narration.rate` | `+0%` | narrate | edge-tts prosody |
| `narration.pitch` | `+0Hz` | narrate | edge-tts prosody |
| `narration.subtitles` | `true` | narrate | write subtitle cues alongside the audio |
| `images.enabled` | `false` | plan, illustrate | the planner may ask for a picture where no figure fits |
| `images.provider` | `codex` | illustrate | `auto` · `codex` · `svg` — where the chain of rungs starts |
| `images.model` | unset | illustrate | model for the separate backend only; the Codex rung uses the account's own |
| `images.style` | `flat vector illustration` | illustrate | one phrase folded into every picture prompt |
| `images.max` | `10` | illustrate | most pictures drawn through the chain; the rest are the tool's SVG |

Three layers, in increasing precedence: these defaults, then the nearest
`decksmith.config.json` found by walking up from the working directory, then flags.
Walking up is what every other tool in a repo does, so a config at the project root
governs a deck built from a subdirectory without anyone naming a path.

```json
{
  "slides": 16,
  "lang": "ko",
  "tone": "conversational",
  "density": "sparse",
  "theme": "paper",
  "animationSpeed": 0.8,
  "narration": {
    "enabled": true,
    "voice": "ko-KR-HyunsuMultilingualNeural",
    "rate": "+8%",
    "subtitles": true
  },
  "images": {
    "enabled": true,
    "provider": "codex",
    "style": "woodcut, two colours",
    "max": 4
  }
}
```

An unknown key is an error, by name: a misspelled preference that is silently dropped
looks exactly like a preference the tool ignores, and you spend the next hour wondering
why `slideCount` did nothing.

```
decksmith.config.json: unknown preference "narration.speed". Valid: enabled, voice, rate, pitch, subtitles.
```

On the command line: `--slides --lang --tone --density` on `plan`, `--theme --design
--pack-seed --speed` on `build` (`--design --pack-seed` on `narrate` too), `--voice --rate --pitch --no-subtitles` on `narrate`, `--images --image-provider
--image-model --image-style --image-max` on `plan` and `illustrate`, and all but the image
flags on `pack`, which records the preferences the deck was made under — whether it was
illustrated is read off the storyboard itself, the way `narration.enabled` is read off the
narration beside it.

A preference sitting at its default says nothing, so a stored artifact wins over it and
loses to anything you type. `plan` stamps `lang` and `theme` into the storyboard it
writes (and `design`, only when one was asked for); `build` then uses the storyboard's
unless `--theme`/`--design` or a config file restates one.
Language is never overridden at build time — it describes copy that is already written.

`--design v2` (or `"design": "v2"` in the config file) lets the build vary each beat's
layout: bars as rows or columns, a pipeline as a row, a stair or a column, a claim beside,
mirrored against or above its figure, a comparison as columns or rows, and the headline on
top, in a left rail or under the body. The choice is made by code, deterministically, per
paper — never by the planner — and it never moves a stop, so narration stays aligned.
`build` writes the choices to `out/look.json`. Without the flag the deck is the classic one,
byte for byte. See `.planning/2026-10-07-v2-layout-director.md`.

## v2 motion

`--design v2` replaces the 0.8 deck's single motion — every scene fading up the same
eyebrow and headline, every seam the same 0.4s dissolve, nothing moving once a slide has
built — with a grammar planned per deck (`src/emit/motion.ts`):

- **Entrances.** One verb, `fade`: a part's opacity reveal at its own time and length,
  with no travel, scale, clip or blur. There were six (`rise`, `slide`, `snap`, `focus`,
  `wipe`, `mask`), and the founder's verdict on plates, chips, cards and labels sliding
  and popping in was "graphic animation by animated UI elements is old-fashioned"
  (2026-10-10). On a fallback archetype the motion is the picture's — the backdrop's
  drift, the field, the camera — and the seams'; no panel or slab is lifted as it is
  read, and split-compare's divider no longer sweeps a highlight.
- **Seams.** `dissolve`, `push`, `lift`, `zoom`, picked from how two neighbouring
  beats relate (same family → push, a role boundary → zoom, a title → lift, into the close
  → dissolve), never repeated back to back, and at least three kinds in a deck of ten or
  more beats. A beat `inside` the one before keeps the camera dive. Every seam fades the
  outgoing eyebrow and headline out in the first 0.16s and starts the incoming ones at
  0.3s — a bespoke scene's chrome included — so two headlines never share a frame. The
  `wipe` (a clip sweeping the slide) was cut on 2026-10-10: at 4fps it left half a picture
  and a lone label on an empty slide.
- **Emphasis while the narrator talks.** The part a sentence is about glows (light only;
  the scale `pulse` and the `underline` went with the entrances), starting on a cue
  boundary of that sentence inside the quiet stretch after its stop, and is back at rest
  before the next reveal — so every frame a gate captures at a stop is unchanged.

**Type** (`TYPE_SCALE` in `src/emit/type.ts`, the founder's scale of 2026-10-10): headline
and title slide 56px, kicker and burned captions 40px, body, labels and notes 40-44px, a
display equation asked at 64px at most (its scripts then land at 44.8px), nothing under
40px. Every v2 pack sets it; archetypes no longer grow their type into the region (their
bars, boxes and figures still grow). `--design classic` keeps its own sizes.

All of it is `fromTo` tweens with no callbacks, seeded rather than random, and keeps every
hold, every scene window and `timing.json` exactly as `classic` writes them. In `deck.html`
a v2 deck also glides through the seam into the next slide (0.8 cut to its first stop,
already built) and, while a stop's audio plays, seeks the scene through that stop's quiet
stretch on the audio clock so the emphasis lands on the same word as in the video. Both
are off under `prefers-reduced-motion`.

## v2 bespoke scenes (on by default under v2; `--no-bespoke`)

The archetypes are the same handful of layouts on every slide, and they finish building in
about five seconds and then hold still while the voice keeps talking. A narrated
`build --design v2` hands EVERY beat to Codex instead — title, numbers, comparisons and
closing claims as well as mechanisms: for each, a GSAP + SVG scene written for that beat,
keyed to its narration cues, built on its own visual device. The archetype is only the
fallback for a scene that fails its gates. `--no-bespoke` (or `"bespoke": {"enabled":
false}`) keeps every archetype and makes no call; classic never runs it and emits the bytes
it did. A v2 build without narration has no cues to key a scene to, and says so.

```bash
decksmith build storyboard.json --source source.json -o deck --design v2
# bespoke: devices (codex) — b01 particle-assembly, b02 fog-lift+art, b03 edge-sweep, …
# bespoke: b05-backbone — every gate passed and the rubric probe is clean; no critique call
# bespoke: b07 (bar-compare) FALLBACK · device draining-light-bars · motion graphics — failed the gates after the critique round: error card_row: …
# bespoke: 12 of 14 beats drawn bespoke (86%; 2 fell back, 0 not eligible), 19 scene call(s) + 1 device call + 6 illustration(s), …
```

**Round 6: the picture moves, not UI over it.** After the founder's verdict on round 5
("graphic animation by animated UI elements is old-fashioned, and the fonts are too
large"), every bespoke scene with a picture is a FULL-FRAME SHOT: the picture covers the
frame behind the deck's own headline (which keeps its place and entrance, over a soft
scrim), and its motion is the picture's own — a camera moving through its depth, focus
pulled to the subject the voice names, a slow light sweep, the subjects breathing. No
plates, chips, label pills or leader-line callouts animate in, and nothing a scene writes
renders above the 56px headline (`TYPE_SCALE` in `src/emit/type.ts`); the narration and the
subtitles carry the words. Every beat with two cues gets a picture, data beats included
(their subjects ARE the quantities, drawn in proportion), up to `--bespoke-art` — and the cap
goes to data beats first: a drawn chart is where the gates refuse most (all five fallbacks of
the rebased branch's two smoke builds were drawn data beats, whose archetype grows its bars),
while every pictured scene passed on its first draft.

**Which beats** (`src/bespoke/select.ts`): every beat with a narration cue, except one a
camera dives into or out of (the dive is aimed at a part the archetype drew) and one the
planner marked `bespoke: false` (`plan --bespoke`) that cites a figure or table of the
paper. A `false` on a beat citing neither is not kept: it was how r3's b12 stayed six grey
row plates for 16 seconds. When `--bespoke-calls` cannot pay two
calls a beat, the most mechanical win (mechanism archetypes and words in en/ko/ja/zh, a cited
equation, weight; ties by a hash) and the rest keep their archetype.

**The device pass** (`assignDevices`, `src/bespoke/pipeline.ts`), once per deck before any
picture or scene is asked for: one Codex call names, for every beat from its content, the
visual device its scene is built on (`spike-train`, `fog-lift`, `edge-sweep`,
`draining-light-bars`, `track-race` …) — never a layout, and never type or a UI element
(`kinetic-title`, `word-cascade`, `fill-gauges`, anything named for a card, chip, label,
plate, tile, badge, gauge or stamp: `isUiDevice`). The founder's rule of 2026-10-10 is in
the prompt: the motion is the picture's (camera, parallax, light, particles, things in it
moving), never labels or boxes sliding or popping in, and no giant lettering. A cached
answer that breaks it is asked again for that beat alone — and which beats get an
illustration (never a data beat or a one-cue beat, at most `--bespoke-art`; the rest are pure
motion graphics, so the deck varies). A name the model repeats, garbles or leaves out, and
every name when there is no call, comes from a rule catalogue; no two beats of a deck share
one. With each name the pass writes an `idea` — how the scene is composed and moves — and is
told to vary compositions, not only names (four comparison beats drawn as "two big numbers
over a shape" was the failure), and to keep metaphors truthful (the heavier side of a balance
sinks; a length that stands for a number starts from zero). Each scene prompt gets its own
device and idea only, and is told a row of cards, boxes and arrows, bullet columns or a tile
grid is not a main visual. The answer is cached by the whole deck's words AND per beat: a
rerun after one beat changed (or `--bespoke-calls` picked a different set) keeps every
unchanged beat's device and idea — the call is told they are decided — so the scenes cached
under them still hit; only the changed beat is drawn again.

**Per beat:** device → illustration (or none) → draft → static contract → probe deck (a real build with every
`verify` gate plus the motion gates, photographed at every cue) → the rubric probe → at most
one critique-and-fix call with the contact sheet and the measures attached (`codex exec -i`)
→ static contract → probe again → repair rounds → for a beat that would otherwise fall back
(its critique's scene fails and its draft did not pass), ONE second critique with that
scene's own frames and findings, if the call cap and 420s of the clock allow, then its gates
and repairs. r1 (2026-10-10) fell back on its three core mechanism beats, 24% of the video,
each on a collision or two its critique had moved rather than removed. A draft that passed every gate and is clean
by the rubric probe is kept without the critique call; one that fails only on what the
repair fixes, and is otherwise clean, is repaired instead of critiqued. A beat that does not
pass keeps its archetype — the deck is never failed. If the fix round breaks a draft that
passed, the draft is kept.

**The illustration** (`src/bespoke/art.ts`, `src/bespoke/inspect.ts`). Every bespoke beat
but a data beat gets ONE picture from the image tool of the same Codex account
(`codex exec` with every tool off but `image_generation`; no API key — the account's own
login, as for the scenes), all of a deck's pictures asked for at once before the drafts
queue for their lanes. The illustrator is given the beat (fenced, untrusted), the pack's
colours and one fixed style paragraph — flat 2D vector, solid fills with hard edges; no
gradients, shading, shadows, gloss, 3D, clay or toy renders, by name — and asked for three
or four subjects doing the method, big, left to right, with empty ground between them and
NO text. Each picture is then inspected locally, for free: its subjects are the connected
regions that are not its flat ground (boxed, left to right); its flatness is how much of
it sits in its 16 commonest colours minus how much of it is soft shading (`FLAT_MIN`,
calibrated on round 3's 21 renders against 12 flat pictures); and its writing is read by
macOS Vision, once per script (en, ko, ja, zh), through a small Swift helper compiled once
into `~/.cache/decksmith/tools`. A picture with writing, a shaded render or one whose
subjects touch is redrawn ONCE with the reason; of two refused pictures the one without
writing and the flatter is kept, and one with writing never is. Off macOS the text check
reports `unchecked` in `bespoke.json` rather than passing. The deck gets a WebP with its
edges feathered into transparency for its box (~30-75 KB against 1.3 MB of PNG; a CSS mask
on the picture cost ~0.7s a probe frame); the draft call is shown the PNG and a copy with
the subjects boxed and numbered (`-i`). The shell places it: `<image data-art="1">` with no
href gets the href and a fixed placement covering the body box (`slice`), so the subjects'
boxes are known in box px before the scene is written. It is read only from
`$CODEX_HOME/generated_images/` (after symlinks), only as a PNG by its magic bytes, under
12 MB. `--bespoke-art <n>` (default 6; `bespoke.art`) caps pictures per deck, counted apart
from `--bespoke-calls`; a beat whose picture cannot be had is drawn without one.

Since round 5 a picture is TWO LAYERS from one art call: a backdrop of the setting (an
environment with depth, no subjects, quiet in the top fifth), then the subjects drawn with
the image tool's `transparent_background` and the backdrop as a reference image, so they
stand in it. The subjects are inspected laid on the pack's ground; the backdrop is read for
writing too. Round 5's shell drew the backdrop behind the camera's wrapper and moved it at half
the camera's zoom; round 6 cuts both pictures into depth planes instead (below). The deck's pictures are planned together in the up-front
device pass — a different setting and different subjects per illustrated beat — and stock
stand-ins (robots, mascots, brains, light bulbs, gears, screens) are forbidden unless the
beat names one. A picture that draws one, shares a subject noun with another picture of the
deck, or sits closer than `SIMILAR_MAX` to one by Vision's feature print is redrawn once,
told what the deck already shows; `bespoke.json` reports the closest pair (`repetition`).

**Depth planes** (round 6, `src/bespoke/depth.ts`, `src/bespoke/sheet.ts`). The kept
picture is cut into a multiplane image (Zhou et al. 2018; Tucker & Snavely 2020): the
backdrop's depth is estimated by Depth Anything V2 Small (Apple's Core ML build, F16, run on
the CPU by a Swift helper compiled once; 1.5s and 156 MB a picture, measured), the backdrop
is sliced at its depth quantiles into up to three planes (none closer in depth than 0.12),
what a nearer plane uncovers on the one behind is filled by push-pull at quarter
resolution, and each subject is cut onto its own plane at the depth where its foot meets
the backdrop's floor, held in front of the farthest band. Each plane is given a distance
(the subjects' plane is 1; others 0.8-3). The shell moves every plane EXACTLY as a pinhole
camera sees it at that distance (`planeFrame`: for fronto-parallel planes a homography is
a scale and an offset, so it is a CSS transform per plane), enlarged just enough to keep
covering the frame (`overscan`), so a push-in or a truck shows real parallax. Focus is
racked by cross-fading each plane with a blurred twin (`softAt`; a CSS `filter: blur()`
tween cost ~1.5s a frame in the gates' browser). Before slicing, both pictures are
upscaled 2x by Real-ESRGAN's `realesr-animevideov3` model through its ncnn/Vulkan build
(1.6s and 129 MB a picture, measured), so a push-in stays sharp: the cap `EFF_MIN` is now
0.85 picture px per output px. BOTH MODELS ARE OPTIONAL and never in git:
`DECKSMITH_DEPTH_MODEL` names the `.mlpackage` (else
`~/.cache/decksmith/models/DepthAnythingV2SmallF16.mlpackage`) and `DECKSMITH_UPSCALER`
the `realesrgan-ncnn-vulkan` binary with a `models/` folder beside it (else
`~/.cache/decksmith/tools/realesrgan/`). Without them — off macOS, on CI — the backdrop is
one plane at distance 2 and the subjects stay at 1 (round 5's parallax, in the new layout),
and `bespoke.json` says which and why (`art.depth.info`). A wipe in depth LIGHTS the
subjects in turn (they stand dim from the first frame) instead of clipping the picture.
A picture whose subjects merged into one is staged as a zoom-out, not a follow, rack or
cutaway.

**Data beats** without a picture (line-chart, bar-compare, data-table) get their scene asked
for the chart that builds with the voice — axes draw, the marks come on at their size, the
line traces, the named value lights — from the beat's own numbers, never a table painted
over an illustration (`data_over_picture`). Since round 5 each data beat of a deck builds
differently (`src/bespoke/databuild.ts`): a line traced with a callout, the delta
highlighted and counted, or small multiples lit in turn (round 6 dropped the bar race: bars
growing from zero and sliding to their rank are what `ui_motion` refuses) — declared on the
chart (`data-build`) and checked statically with its marks; the camera may push in on the
value the voice names (required until round 6, when a smoke deck lost a data beat to that rule
alone). `verify` refuses two data scenes of a deck that build alike
(`build_repeat`).

**The camera** of an illustrated scene is the shell's (`src/bespoke/shots.ts`), in one of
seven GRAMMARS (`src/bespoke/grammar.ts`) picked per beat in the device pass from the
narration's rhetorical role (compare, cause, process, reveal, quantify, define — read from
the archetype and the narration's own words in en/ko/zh/ja), never the grammar of the
illustrated beat before it: `tour` (establish, push in on each named subject, reveal),
`follow` (push in, then track along the subjects at one scale), `rack` (A, whip to B, back to
A, a two-shot), `zoom-out` (open close on the detail, pull back to the whole), `wipe` (the
picture wiped on subject by subject, the camera wide), `cutaway` (hard cuts to close inserts
and back) and `parallax` (a slow lateral truck at a medium scale). The scene names its
`shots` — on which cue, how far into it, which subject — and the shell compiles them in the
grammar; shots closer than 1.6s are dropped, and the end frame is always the whole picture.
No push-in goes past the scale where a picture pixel spans more than 1/`EFF_MIN` output
pixels (`sharpMax`): the image tool draws ~1.57 megapixels whatever it is asked.
`shot_variety` reads the grammar back off the camera's samples (a follow must track, a rack
come back or hold a two-shot, a cutaway cut, a zoom-out only pull back, a wipe wipe, a truck
travel), and that the backdrop moves less than the subjects; `verify` refuses two
consecutive illustrated scenes in one grammar (`grammar_repeat`). Every
camera tween is a `fromTo` with explicit from-values, and no two touch. The scene's own
script may not move `#sN-cam` (`script_camera`). A scene without a picture still moves the
wrapper itself (`scale`/`x`/`y`, arithmetic in the prompt), and since round 6 its words keep
their declared size under it: for every camera tween (the wrapper's `scale`, or the svg's
`viewBox`) the shell adds the inverse scale on each word about its own centre over the same
span (`quietWords` in `src/bespoke/scene.ts`; r1's final review measured labels at 75-80px
under zoom). A scene with a moving camera is
clipped to its box and marked `data-ds-clip`, so `verify` does not count what a push-in
carries past the canvas edge as off-canvas.

**The labels** (rounds 4-5; gone in round 6). An illustrated scene's names were the shell's (`src/bespoke/callouts.ts`, deleted). The
scene says what each subject is called (`labels`); the shell gives each subject a zone just
above it (or across its top when there is no room), as wide as half the gap to each
neighbour, and sets the name there on a plate — 64px, shrinking to 52, then two lines —
with a leader line to a dot on the subject, entering as the camera first arrives on it (or
at the reveal). Since round 5 the top 120px of the box is the CAPTION BAND, where the scene
draws its own words; a label goes above its subject only under the band, else below it,
else across its top; and a label is held at 1/sqrt(s) of the camera's zoom, so on screen it
grows by sqrt(s) in a push-in and is its own size in the whole view. `label_size` holds
every label to 52px as rendered at every graded frame; `label_band` refuses a label in the
band or the scene's own words within 24px of one. Round 6 removed them: plates
and leader lines entering as the camera arrived were exactly the "animated UI elements"
the founder called old-fashioned, and every name was one the narration already says. A
round-6 scene's own layer is FIXED to the frame (`#sid-fx`), holds at most two short
phrases or one number, 40-56px, fading in place, and nothing aimed at a subject.

**Repair** (`src/bespoke/repair.ts`), no model call. On `text_overlap`,
`graphic_crosses_text` or `svg_text_overprint`, each colliding label's unit (the text, or
the smallest `<g>` holding it and its plate) gets one constant offset — the smallest, in
8px rings over sixteen directions in a fixed order — that clears every other label by 16px,
every visible stroke sample by 10px and every shape painted over it, inside the box, at
every frame the probe measured, camera scale included; it is written as a wrapping
`<g transform="translate()">`. A label never moves farther than 0.8 of its own height
(at least 32px): a collision that needs more is left to the critique round. On
`label_band` the same nudge keeps the scene's own words 26px (camera-free) clear of the
shell's labels, which never move. On
`end_dimmed`, the elements dimming parts the scene had lit are tweened back to full
strength just before the end; on `camera_end`, the camera is tweened home. On `seek_order`,
two tweens on one target animating one property over overlapping time — which a timeline
resolves one way seeking forward and the other seeking back — are untangled in favour of
the later one (the earlier is shortened to end where it starts, or loses that target or
property when both start together; `src/bespoke/untangle.ts`). A repaired scene goes
through the static contract and is gated again (at most two repair rounds).

**What the model is shown** (`src/bespoke/prompt.ts`): the beat, its cues, the paper's
excerpts (fenced, untrusted), the contract, motion-design rules with numbers (quiet type:
words 40-44px, one key number or word up to 56px, nothing bigger; NO UI MOTION — no word,
plate, chip, card or bar moved, scaled or grown into place; one focus per cue; fill the
box; at least three kinds of motion, one of flow, camera, counter or morph; the end frame a
summary — for a scene on a depth picture, a shorter direction: the shot list is the scene), text widths measured in the pack's own font, and two of four hand-made
reference scenes (`src/bespoke/references.ts`: a routing mechanism with particle flow and
a counter, a camera zoom into one block, a traced curve whose gap morphs into the headline
number, a scatter whose dots travel into a bell — round 6 rewrote every one of them to
the quiet type scale with nothing sliding, popping or growing into place), picked for the
beat's archetype and painted in the pack's colours; a scene on a depth picture is shown
none (round 4's "illustrated" reference, labels and a spotlight over the picture, is
deleted). `test/bespoke-references.test.ts` runs each reference, and a depth-staged scene,
through every gate and the rubric probe in a real deck, so a reference that stops passing
stops being one. Parts a cue introduces are `<g data-cue="N">` groups (semantic grouping,
after Vector Prism, arXiv 2512.14336). MorphSVG is registered for a deck only when one of
its scenes morphs.

**The rubric probe** (`rubricProbe`, free: it reads what the probe measured) sends a
passing draft to the critique round when any of these is off: the drawing paints under 12%
of its box at the end (round 1's scenes painted 4-16%), more than half its parts are still
dimmed at the end, no label reaches 44px (not asked of an illustrated scene), a label declares over 56px, a word rendered over the 56px headline, any UI animated into place,
fewer than three kinds of motion or none of flow/camera/counter/morph (not asked of a scene
on a picture: the picture's camera, focus and light are its motion), an illustrated scene
that holds fewer than two push-ins or does not open wide, a cue whose picture changes by
under 0.5% of the frame, or a warning about the scene. The critique round scores the frames against a six-line rubric
(fills the stage, one focus per cue, motion explains with no UI motion, quiet type, the pack, sync),
is told the measures and every finding with the colliding labels' coordinates, and returns
the fixed scene.

**Caps**, checked before every call: `--bespoke-calls` (default 40 scene calls; two per
beat), `--bespoke-seconds` (default 3600 for the pass) and `bespoke.callSeconds` (default
600: one call's ceiling, the per-scene timeout). A quota or rate-limit answer stops every
further call. Codex runs only through the account's own CLI (`--bespoke-cli`,
`--bespoke-model`), never an API key, two calls in flight across pictures, the device call
and scenes alike (`bespoke.concurrency` in the config file), at
`bespoke.effort` reasoning (default `medium`; `default` keeps the account's), from the
scratch directory, and with its tools off: shell, apps, plugins, browser, image
generation (the illustration call alone keeps it), web search and every MCP server the
account configured. A bespoke call is a
text transform; with tools on, the agent spent its first turns reading the account's own
instruction files and skills (measured: 56,679 input tokens over several turns and
135-488s for a draft that tool-less took one turn of 18,247 and 166s). A paced deck (`--speed`/`--duration` other than 1×) and non-16:9 formats are
skipped, with a line saying so.

**Cache.** Keyed by everything a scene is drawn from — the beat's words and params, the
quoted excerpts, the cue windows, the stops, the box, the pack, the prompt and contract
versions, the model, the illustration's key — under `~/.cache/decksmith/bespoke`
(`--bespoke-cache`); pictures under its `art/`, keyed by the beat's words, the pack's
colours, the art prompt's version and the model. A rebuild costs no calls. A beat the gates rejected after its critique round is cached as rejected;
a fallback the beat did not earn (cap, quota, timeout) is not.

**What a generated scene may run.** Three layers. (1) A static walk before anything is
built or opened (`src/bespoke/contract.ts`, acorn): GSAP timeline calls with literal vars
at explicit seconds — `tl.fromTo` whose from state names every property it moves, and
`tl.set`; `tl.to`, `tl.from` and keyframes are refused (`script_fromto`, AGENTS.md invariant
2: a `to` starts from whatever the page holds when it first renders) — `gsap.set`, scoped
`root.querySelector`, `Math` minus `random`, local
code; `window`, `document`, `fetch`, `eval`, timers, storage, navigation, callbacks and
function-valued tween vars are refused by name; CSS must be scoped to the scene with no
at-rules, `url()` or animation; markup is SVG and inline HTML with no handlers, SMIL or
external references, and `<image>` only as the beat's illustration (`data-art="1"`, no
href — the shell writes it); path data must be numbers and commands (a word in a `d`
attribute is a console error that used to fail every scene probed with it). (2) A CSP `<meta>` in every composition that carries one —
`connect-src 'none'`, no `unsafe-eval`, local files only — and a probe that fails a scene
on any page error, request or navigation (an error that names no scene fails every scene
probed with it, unless the value it quotes is in exactly one candidate, which is then the
one failed). (3) The player's frame is sandboxed
(`allow-scripts allow-same-origin allow-downloads`). The paper's text reaches the model
fenced as untrusted data. The static walk is not a proof against obfuscation — a
property name assembled from parts at run time gets past it — which is what (2) and (3)
are for; and (3) isolates only when decks are served from another origin than the host.

**The motion gates** (`src/verify/scenes.ts`) run on every scene `bespoke.json` lists, as
errors: `static_hold` (the picture must change during every cue), `graphic_crosses_text`
(a visible stroke through a label — a curve whose bounding box contains a label is not
its plate — or a shape painted over one), `seek_order` (the frame must not depend on what
was seeked before it, beyond 1500px of rasterising noise — counted on changed AREAS: a pixel
counts when it and its 8 neighbours changed, so a picture re-rasterised a hair differently
on its first paint, an outline round every subject, 12,698px raw, counts 309), `stage_fill` (the settled
drawing's bounding box covers 80% of its box), `type_hierarchy` (one label of 44px or
more at the end; not asked of an illustrated scene), `type_ceiling` (no label DECLARES more
than 56px at the end; KaTeX is exempt), `type_scale` (round 6: no word the scene
draws RENDERS above the 56px headline at any graded frame, its camera's zoom included;
round 2's 64px key-label floor is gone), `ui_motion` (round 6: the scene's own GSAP
timeline animates no label, plate, chip, card or bar into place — read off the tweens'
targets and properties, so an opacity fade passes and a particle or a traced path is not
UI; a bar is a rect resized, or a path or polygon grown from under 70% of its size; the
shell's own counter-scale of words under a camera is not counted), `seam_blank` (round 6:
the stage — everything but the headlines — painted under 0.2% of the frame for more than
0.15s across the seam into a generated scene; r1's final deck showed nothing for ~0.6s at 12
of 15 seams, so cue 1's group now stands from the scene's first frame), `hollow_hold` (while
cue 2 onward holds, and at the end, the drawing spans under 70% of the box's height),
`marks_overlap` (at those frames, alike filled dots drawn into each other, deeper than half
the smaller's radius), `stray_marker` (an SVG marker painted where its line is not drawn),
`early_reveal` (a `data-cue="N"` group, N of 2 or more, showing more than 0.5s before cue N),
`text_clipped` (a word cut by the frame's edge while held: sampled every 0.5s, three samples
in a row, under 96% of its width or 75% of its line box inside the clip), `morph_glitch` (a
path tween — `attr: { d }` or morphSVG — whose shape, at any in-between sample, reaches more
than 35% of its ends' size past the union of its two ends: r1 s4's wedge, an x tweened into
a y between paths of different commands), `dim_text` (a word held under 3:1 contrast with
what is painted behind it at a cue's end or the end; repaired without a call by lifting a
literal dimming opacity on its targets to 0.6),
`shot_variety` (an illustrated scene opens on the whole picture — unless its grammar is
`close-open` — and the camera — sampled
every 0.5s, no screenshot — HOLDS push-ins at 1.5x or closer on at least two different
subjects; round 3's 1.1-1.4x pans are not push-ins), `label_anchor` (a label of the scene's that names a
subject sits within 96px of its box and covers no other subject by more than a quarter of
itself), `data_over_picture`
(five or more numbers on the illustration),
`cue_groups` (no such groups — not asked of a scene on a picture, which may add nothing —
or one naming a cue the scene does not have), `card_row`
(`src/bespoke/cards.ts`, read off the markup: three or more alike rectangles — rects, or
divs placed in px — in a row or a column, or four in a grid, covering 12% of the box —
cards, panels or tiles as the main visual; never asked of a data beat, whose bars are alike
by design; such a scene goes to its critique and falls back if it is still cards), `end_dimmed`
(at the settled frame, more than 10% of the parts the scene had shown lit are left under
0.6 opacity — a part drawn translucent from the start is not counted) and `camera_end` (the
camera, or a viewBox, not home at the settled frame). Content
outside a clipping `<svg>` — a camera zoomed in — is neither off the frame nor crossing
anything. Overlap and crossing findings carry the labels' boxes in the body box's px.
`seek_order` also runs on every other scene of a v2 deck, as a warning; it is what found
the equation-walk bug fixed alongside this (22,037px before, 0 after). Below the tolerance
and not traced: v2's equation-walk on the narrated demo differs by 529px on one KaTeX
glyph when reached from past the scene's end.

`build` writes `bespoke.json` beside the deck: what was drawn and from where (cache,
draft, critique), why each fallback, calls, tokens, seconds, the stages' wall clock, each
picture's inspection (subjects, flatness, writing, draws) and each scene's staging
measures. The full motion probe that `verify` would run again on a generated scene is
skipped by `build` when the pass already ran it on the same bytes at the same scene id
(`gatedAt`); `build` still seeks it with the deck's other scenes. `decksmith verify <dir>`
always runs it. Set
`DECKSMITH_BESPOKE_WORK=<dir>` to keep the prompts, replies and contact sheets.

**Costs, round 6** (four HypePaper decks, twice each, see
[`.planning/2026-10-10-v2-bespoke-round6.md`](.planning/2026-10-10-v2-bespoke-round6.md)):
a picture takes 90-200s (two layers, redraws included) and its depth cut 5-26s; a draft on a
picture ~25s, and critique calls are rare; a deck's `build` took 431-696s for 5-7 scene calls
plus 5-6 pictures and 157-237k tokens. A deck carries 1.3-2.9 MB of planes (5.4-7.2 MB in
all, against round 5's 4.0-5.3). Round 4's numbers, for the record
([`.planning/2026-10-09-v2-bespoke-round4.md`](.planning/2026-10-09-v2-bespoke-round4.md)):
an illustration takes 60-120s, a draft 90-220s and a critique 70-120s; a deck's pass took
380-730s for 5-8 scene calls plus 3-7 pictures (redraws included) and 153-227k tokens, and
the whole `build` 466-812s on a Mac with 9-23% memory free — three builds of eight under ten
minutes. The pictures add 128-348 KB of WebP to a deck (round 3: 6-7 MB of PNG). Round 3
took 593-742s and 214-325k tokens; round 1 13-31 minutes and 540-705k. A rebuild from the
cache makes 0 calls. Those are 4-6-beat passes at five calls in flight; drawing every beat
of a deck at two in flight costs several times that: MEASURED 2026-10-10 on one 14-beat ko
deck, 11 of 14 drawn bespoke, 21 scene calls + 1 device call + 3 pictures, 574k tokens, a
1508s pass and a 1567s `build`.
None of it fits a 300-second build timeout: a host that builds v2 decks on its request path
— HypePaper's build step — must pass `--no-bespoke`, or give `build` that long off the
request path.

## Themes

Three, each a position rather than a hue.

| Theme | Ground | For |
|---|---|---|
| `ink` | near-black | a dark room and a projector. The default |
| `paper` | warm off-white | a lit room, a shared screen, print |
| `mono` | white on black, one red | bad projection and greyscale printing, where hue does not survive |

`mono`'s four tones are a grey ladder plus one red rather than four hues, because value is
what survives a bad projector and hue is not; four hues would have collapsed into one
grey. All three keep the Inter stack — `build` ships Inter beside every deck, and a serif
naming a family the deck does not declare falls back silently.

A theme is a name and a palette, and that is the whole extension point: a new one is a
file in `src/emit/themes/` plus a line in `THEMES`. No archetype learns it exists.

### v2 style packs

Six more, each a whole look rather than a palette: its own typeface pairing and type
scale, ground and accent, eyebrow treatment, figure framing and surface.

| Pack | Ground | Headline / body | Title | Lists | Bars | Leans to |
|---|---|---|---|---|---|---|
| `signal` | violet-black, Magma accent | Space Grotesk / Inter | glowing headline | ticks | pills | foot headlines |
| `blueprint` | navy, cyan | IBM Plex Sans / IBM Plex Sans | drawing frame with corner marks | numbers | square, on dashed tracks | rail headlines |
| `atlas` | espresso, amber | Source Serif 4 / Inter | centred, frontispiece rule | dots | slightly rounded | top headlines |
| `folio` | cream, oxblood | Source Serif 4 / Source Serif 4 | masthead rules | numbers | square, no tracks | top headlines, versus |
| `chalk` | cool white, ultramarine | Space Grotesk / IBM Plex Sans | highlighter under each word | cards | rounded, outlined | foot headlines, tables |
| `journal` | sage, forest | IBM Plex Sans / Source Serif 4 | side bar down the title | ruled rows | slightly rounded, outlined tracks | rail headlines |

The forms are the pack's `forms` (list marks, Director affinity) and its `skin` (title,
bars), which may set only paint: colours, shadows, radii, outlines and SVG stroke/fill
opacity, never a box. In a Korean, Japanese or Chinese deck a pack's serif roles are set
in Noto Serif KR/JP/SC, bundled beside the sans.

`--theme <pack>` forces one. `--design v2` picks one when nobody named a theme (a
storyboard's default `ink` counts as nobody): a weighted, deterministic hash of the
source id (or `--pack-seed`), leaning mildly toward packs that suit the deck's mix of
archetypes. Over the 176 HypePaper storyboards on disk the busiest pack carries 20.5% of
decks. With narration on disk, a pack that would stage a beat with a different stop count
than the narration was recorded at, or that would leave out a beat the storyboard's own
theme draws, is skipped for the next one; if none fits, the storyboard's own theme is kept.
So `--design v2` never breaks a narrated rebuild and never costs a slide.

Each pack's faces ship beside a Latin deck, vendored from `@fontsource-variable/*` like
Inter, and are measured by their own width tables (`src/emit/faces.ts`, written by
`node scripts/measure-faces.mjs --write`). A CJK deck keeps its Noto bundle first in every
stack — Noto Serif for a role the pack sets in a serif, Noto Sans otherwise — so the glyph
shapes change with the pack in every language.
The packs' interfaces are written up in `.planning/2026-10-07-v2-style-packs.md`.

## Narration

```sh
decksmith narrate storyboard.json --source source.json -o audio/
decksmith build   storyboard.json --source source.json -o out/     # finds audio/ by itself
```

`narrate` speaks each beat's `narration` field with
[edge-tts](https://github.com/rany2/edge-tts) and writes `audio/narration.json` beside the
mp3s. `build` picks that up from `audio/` next to the storyboard — or from `--narration
<file>`, or not at all with `--no-narration`. A deck with no narration builds exactly as
it always did, byte for byte.

**The unit is the stop, not the slide.** A beat's stops are its landing plus each of its
holds — the points a presenter pauses at — and each gets its own audio file and its own
subtitle cues. So the sentence a viewer hears is the sentence that belongs to the thing
that just appeared, and the deck advances on speech rather than on a number somebody
guessed. Write one sentence per reveal, in reveal order. Fewer sentences than stops leaves
the later reveals silent; more, and the surplus joins the last one.

**A beat's stop count can depend on the canvas.** At 1600×900 the demo's stack beat does
not fit, so `narrate` puts all four of its sentences on one stop; at 1920×1080 it has four.
So `narrate` takes the same `--format`, `--width`/`--height` and `--reserve-captions` flags
as `build`, and `narration.json` records the stop count each narrated beat was split over.
`build` compares that count with its own staging for every beat it keeps, and refuses a
beat whose sentences it would split differently. The error names the beats and prints the
`narrate` flags that fix it. Narration made once at the default canvas still builds the
short, the `--reserve-captions` deck and an unpacked `.deck` wherever those stage the kept
beats the same way, which on the demo is every one. Re-narrating in the directory the
narration was made in only synthesises sentences that now split differently. An unpacked
`.deck` has no TTS cache, so there it synthesises all of them. A `narration.json` or pack
written before the counts were recorded still builds, and `build` says it could not check
it. See `.planning/2026-09-18-narrate-build-canvas.md`.

Playback reads the audio element's own clock, never a timer: a timer agrees with the audio
right up until the first stall, and a stall is exactly when a viewer looks at the subtitle
to find out what they missed. `m` mutes (captions keep tracking, and a muted element is
exempt from the autoplay policy, so it doubles as the escape hatch); `s` hides subtitles.
If the browser refuses to autoplay, the deck says `press any key for sound` once and
navigation carries on regardless. A segment that will not *play* — a missing file, a
dropped connection — reads `narration unavailable` instead, because telling that viewer to
press a key names the wrong culprit and goes on naming it every time they try. A gesture
retries either failure; nothing retries the unplayable one unasked.

`p` plays the deck by itself, and that is a mode rather than a change to what stepping
means — the ordinary case is a presenter talking over it. A narrated stop is timed by its
own audio and waits for it to finish. A stop that is not being *heard* — no segment, or
one that would not play — gets the clock instead, at the gap the author left before the
next stop, floored at 1.5s and capped at 8s. Whether a stop is heard is asked twice, on
arrival and again when `play()` settles, because until it settles a missing file and a
working one are indistinguishable; without the second ask, autoplay waits forever for an
`ended` that a source which never loaded cannot fire.

Audio is content-addressed on the text, voice, rate and pitch, so re-narrating an edited
deck re-speaks only the sentences that moved — and two beats saying the same sentence
share one file. `verify` fails a deck whose island names an mp3 that is not in the
directory; nothing else notices, because a missing file looks identical to a browser that
declined to play.

`edge-tts` must be on your PATH, or installable as `python3 -m edge_tts`; set
`DECKSMITH_EDGE_TTS` to point at it directly. Narration and illustration are the two parts
of DeckSmith that need the network, which is why each is its own command and not a step
inside `build`.

## Illustrations

```sh
decksmith plan       source.json     -o storyboard.json --images
decksmith illustrate storyboard.json --source source.json
decksmith build      storyboard.json --source source.json -o out/
```

With `--images`, a beat that has nothing in the inventory to show — a `claim-figure`, a
`stage`, or either side of a `split-compare` — may carry an `illustration: { prompt, caption }` in
place of a `figureId`. A `stage` is how a paper whose figures are all plots gets a
full-screen picture; its brief is drawn landscape, since the format is not known until
`build`, and a portrait build crops it (and warns). The prompt describes a scene, never text, labels, numbers or charts:
nothing inside a picture can be read or checked, so the picture illustrates and the beat's
`evidence` still points at the section. `plan` says how many pictures the storyboard asks
for and the command to run; `build` and `pack` refuse the file until they exist.

A `pipeline`, `split-compare`, `callout`, `bar-compare`, `hero-number` or `kinetic` may
also carry a `backdrop: { illustration }` — a scene the diagram is drawn over. The picture covers the
frame and drifts slowly, a uniform black scrim (0.62) darkens it, and the archetype is
drawn unchanged in a glass palette: dark translucent panels, light ink, tones brightened
(then whitened only if they must be) just far enough to clear 4.5:1 over a pure-white
pixel, and the step-back ink `dim` held below every tone at 3:1, the floor for large
text. Geometry and holds are the
archetype's own, so a backdrop changes colours and nothing else. With `--images` the
planner is held to making most of a deck scenes (60% of beats, within `images.max`) — a
stage, a backdrop, a pictured split-compare side, a hero-number or a kinetic claim; a
`claim-figure` or `annotated-figure` sits on the pale ground and does not count — so
a figure-less paper reads as a sequence of pictures rather than cards on one ground.

`illustrate` turns each brief into a file under `assets/` beside `source.json`, registers
it as an ordinary figure, and sets the beat's `figureId`; the brief stays on the beat as
provenance. From there nothing downstream knows the picture was generated — `build`,
`pack`, `verify` and the server see a figure like any other. A deck that never asks for a
picture builds exactly as it always did, byte for byte.

Three rungs, tried in order, and every hop down is printed rather than swallowed:

1. **A separate image backend**, if you configured one AND asked for it with
   `--image-provider auto`. `DECKSMITH_IMAGES=openai` names
   any OpenAI-compatible `images/generations` endpoint (`DECKSMITH_IMAGES_BASE_URL`,
   default `https://api.openai.com/v1` — LocalAI and gateways speak it too),
   `DECKSMITH_IMAGES_API_KEY` is the key, and `DECKSMITH_IMAGES_MODEL` overrides the model
   (default `gpt-image-2`). Environment only, like edge-tts: the key is never a preference,
   never in a config file, never in a `.deck`, and never part of an error message. Naming
   a backend without its key is an error where the backend is resolved — at `illustrate`,
   in the server's startup banner, in `decksmith_capabilities` — and nowhere at import.
2. **The Codex account that planned the deck.** Codex 0.149 ships `image_generation` as a
   stable feature, so the same `codex exec` that wrote the storyboard can draw a PNG.
   `illustrate` runs it in a scratch directory it cannot write outside of and reads the
   picture back — and checks it: the agent looks at what it drew, redraws once if the
   picture has letters, words or numbers in it, and refuses rather than handing back a
   picture with text. **Nothing downstream can see text inside a picture** — the 40px
   audience floor measures the document's own text — so the check happens where the
   image and an eye are in the same place, and a refusal simply falls to the next rung.
   An account without the image tool says so, once, and the run falls through too.
   Which ACCOUNT is the shell's business, not the deck's: `codex exec` inherits the
   environment, so `CODEX_HOME=~/.codex-other decksmith illustrate …` draws on that home.
   Note that Codex keeps its own copy of every picture it makes, under
   `$CODEX_HOME/generated_images/<session>/`, and `--ephemeral` does not remove it — the
   deck's own copy is the one under `assets/`, and that directory grows by roughly a
   megabyte per picture until you empty it.
3. **An SVG the tool draws itself**: a deterministic, text-free composition seeded from
   the brief. It cannot fail, so `illustrate` always finishes.

`images.provider` says where the chain starts. **`codex` is the default** — the account
that planned the deck draws the picture, and falls through to the tool's SVG; a metered
backend is never reached unless you ask for it, because a default should not be the
branch that spends money. `auto` puts a configured backend in front, and `svg` is the
tool alone — no network, no spend, and a deck whose every
picture is reproducible. A rung that fails is not asked again in the same run, so an
account with no image tool pays one `codex exec` to find out, not one per picture.

Pictures are content-addressed on the rung, model, aspect, style and prompt, the way
narration is on its text and voice: re-running after an edit redraws only the briefs that
moved, and a second run over a finished storyboard calls nothing at all. `images.max` caps
how many pictures go through the chain — a `split-compare` with two briefs spends two —
and the rest are the tool's SVG. **Pictures cost what narration does not**: a backend
bills per image and the Codex rung spends the account's own usage, so the cap is there
to bound a plan that asks for twelve. `--image-provider svg` is the way to try the layout
for free.

Not a rung, on purpose: asking the model to write SVG. An SVG shown through `<img>` can
carry SMIL or CSS animation, which runs on wall-clock time under capture — a
nondeterministic render that every gate passes. The tool's own SVG has no text, no
animation and no external references, and the same brief always draws the same bytes.

## Animated pieces

A **piece** is a figure that moves: a cut-paper scene written for
[animate](https://github.com/cth9191/animate), drawn on a `<canvas>` by `claim-figure` or `stage`
and played by one `dsAnimate` tween. It is a third figure `kind`, next to `image` and `clip`.
You write it by hand. No ingest, `plan`, server or MCP path produces one.

**Authoring one** takes three edits. Put the scene file under `assets/` beside
`source.json`, give it a figure entry, and point a `claim-figure` beat (or a `stage` beat, for the piece alone on the whole frame)
at that entry:

```jsonc
// source.json, under "figures"
{ "id": "fig-garden", "kind": "piece", "src": "pieces/garden.js",
  "width": 1920, "height": 1080, "seconds": 6, "caption": "The moon becomes the sun" }
// storyboard.json, a beat
{ "id": "b2", "archetype": "claim-figure", "seconds": 9, "intent": "…",
  "params": { "headline": "The moon becomes the sun", "claim": "…", "figureId": "fig-garden" } }
```

The file is an animate `scenes.js` plus `bridges.js`. It defines `ERA_LIST`, `SHOTS`,
`ERA_BG`, `BRIDGES`, `pieceCam` and its scene functions, and it uses the kit's names
(`cut`, `rect`, `ellipsePts`, `PAL`, `pat`, `spark`, `TT`, `EZ`, `LX`/`LY`, `UNIT` and the
rest):

```js
const ERA_BG = ['#cfe2ee'];
function pieceCam(era, t) { return null; }
function sceneSky() {
  cut(rect(-30, -30, W + 60, H + 60, 0), PAL.sky, { key: 'bg', shadow: false, tear: 0, shade: false });
  const k = EZ.io(seg(TT, 0, DURATION));   // a sun that crosses the sky over the whole piece
  cut(ellipsePts(LX(0.12 + 0.76 * k), LY(0.55 - 0.38 * Math.sin(Math.PI * k)), 110 * UNIT, 110 * UNIT, 0, 30), PAL.yellow, { key: 'sun' });
}
const BRIDGES = [];                        // or [{ tc, A: () => shape, B: () => shape }] between eras
const ERA_LIST = [[0, DURATION, () => sceneSky()]];
const SHOTS = [['sky', 0, 0.0, DURATION, 'sky']];
```

Do not define `W`, `H`, `FPS`, `DURATION`, `NFRAMES`, `LOOP_T`, `SAFE`, `HAND`, `CX` or
`TIMELINE`. DeckSmith sets them from the figure: its `width`, `height` and `seconds`, 30
fps, and the deck's font stack. On a `stage` beat `W` and `H` are the frame's pixels
instead (less any caption reserve), so lay the piece out with `LX`, `LY` and `UNIT` rather than
fixed coordinates. A file that declares one of them fails to load, and
`verify` reports that as a page error. `TIMELINE` carries `shots` only. animate's own demos
read `TIMELINE.cues`, so write those times as numbers.

`build` wraps the file and the kit into one script, `assets/<src>`, inside a function, so
none of the kit's names reach the page. The piece starts 1.0s into its beat and runs for
its `seconds`, with a 0.3s hold after its last frame. Before the tween the canvas shows
frame 0. After it, the canvas holds the last frame; it does not wrap back to frame 0. The
beat must be at least `1 + seconds + 0.3` long. A shorter beat is refused by name rather
than clamped. The hold is never before 2.4s, when the claim, plate and caption have all
entered, so a piece shorter than 1.1s holds there instead. On a `stage` the floor is 2.1s
when there are words over it and 1.1s when there are none.

**What is refused**, and where:

- **Text in a piece.** `fillText` and `strokeText` throw on every 2D canvas while the
  piece runs, the kit's offscreen layers included. That is a page error, so `verify` and
  `build` fail. `handText`, `tag`, `yearTag`, `capStrip`, `monoText` and `cat` all draw
  text, so none of them can be used. Labels belong in the claim, which is DOM text and
  is held to the 40px floor. `handwrite` draws letters as ink strokes, which no runtime
  trap can tell from lines, so `build` refuses a file that calls it by name
  (`pieces/garden.js:12 calls handwrite — …`). An alias of it is not caught.
- **A last era or last shot that ends before the piece does.** morph.js draws era 0 for
  any time past the last era, so `[[0, 3, …]]` in a 6s piece would replay the opening
  scene for 3s and the whole hold. The piece throws when it mounts (`piece "fig-garden":
  ERA_LIST ends at 3s and the figure plays 6s — end its last entry at DURATION`), which
  fails `verify`. End the last entry of `ERA_LIST` and of `SHOTS` at `DURATION`.
- **More than one piece per deck.** `build` stops with ``claim-figure b3: figure
  "fig-garden-2" is a second animate piece in this deck — b2 already draws "fig-garden"``.
  The vendored `morph.js` is unpatched and writes `window.renderFrame`, so two pieces
  would share that global.
- **Styles other than cut-paper.** Only the cut-paper kit is vendored. Another style's
  primitive is simply undefined: a piece that calls riso's `plates()` fails `verify` with
  `page_error plates is not defined`. Riso and pixel read pixels back from the canvas,
  and that has not been measured under capture.
- A piece in any archetype but `claim-figure` and `stage`, a piece with no `seconds`, a `src` that
  does not end in `.js` (the determinism scan reads only those), and an `id` containing
  anything other than letters, digits, `.`, `_` and `-`.

**What the gates see.** A piece that throws while it draws fails `verify`, because the
runtime reports the error before rethrowing it. Before that fix, hyperframes swallowed
the error and every gate passed a piece frozen on a stale frame. That is the eleventh
case under "What the gates do not check". `render` still exits 0 when the page has
errors, so `verify` is the gate here. `hyperframes check` sees a throw only at the times
it samples, so the fidelity gate also draws every frame of each piece once, off-screen,
and fails with `piece_error` on any that throws: a throw confined to one frame is caught
too. `frames` refuses to write a PNG once the page has raised an error, rather than
saving a stale or half-painted canvas. `hyperframes check` cannot see inside a canvas:
layout and contrast cover only the DOM around it. The determinism scan reads
`assets/**/*.js`, so a `Math.random`, a `setTimeout`/`setInterval`, a
`requestAnimationFrame` loop or a `new Image()` in a piece is caught. A checker without WebGL
measures a piece instead of refusing it, because the piece's canvas carries
`data-ds-piece`.

Measured on 2026-10-09 (macOS, Metal, hyperframes' headless shell). The deck had a 6s
two-era piece with a moon-to-sun bridge in a 9s beat:

- `build` and `verify` both passed.
- `render -w 1` took 13.1s for 360 frames. Stills at ten instants showed the night scene,
  the bridge, the morning scene and then the last frame held.
- `drift --workers 1` found 360/360 frames byte-identical, and a second render produced
  an mp4 with the same md5.
- A `pack`/`unpack` round trip rebuilt the same files.

**Limits.** A piece is baked at 30 fps, so `render --fps 24` judders, and `--speed` plays
the whole piece faster or slower than written. Each piece inlines about 60 KB of kit.
Canvas raster differs between Metal and SwiftShader, so compare `drift` runs on one
backend only. See `.planning/2026-10-09-animate-piece-design.md` and
`.planning/2026-10-09-animate-piece-spike.md`.

**Attribution.** The kit (`core.js`, `morph.js`, `cut-paper.js`) is animate @7e5eb56,
copyright (c) 2026 cth9191, MIT. It is vendored unmodified in `src/build/animate/`, with
upstream's `LICENSE` and a `NOTICE` that names the commit and each file's sha256.
`npm run build` copies all of it to `dist/animate/`. Every assembled piece script carries
the MIT text in its header, so a built deck carries the attribution too.

## The `.deck` container

One file holding the whole deck: the source, the storyboard, the preferences it was made
under, the narration with its audio, and the media.

```sh
decksmith pack   storyboard.json --source source.json -o talk.deck   # --bake (default) | --link
decksmith unpack talk.deck -o reopened/
```

It carries the source and the storyboard, never the built HTML — the HTML is a projection
of those two, and every format profile makes a different one, so shipping it would be
shipping a stale copy of something that regenerates in a second. `unpack` puts the figures
back under `assets/` where `build` looks for them, so the round trip rebuilds offline.

Inside is a ZIP: `deck.json`, `media/`, `audio/`. Entries are sorted and stamped with a
fixed mtime, and already-compressed payloads are stored rather than deflated, so the same
inputs produce the same bytes and a 200 MB figure pack does not spend minutes
re-compressing its own JPEGs.

### bake, link, embed

Every asset travels one of three ways, and you choose between the first two only.

- **bake** — the bytes come in. The pack works offline and forever. This is the default.
- **link** — the URL stays. The pack is small and the asset stays current. `--link`.
- **embed** — for URLs that are not files at all. **A YouTube or Vimeo link is a player
  page, and is never downloaded** — doing so would be technically wrong and, usually,
  against its terms. This is a property of the URL, not a choice: you cannot ask for it and
  you cannot override it. The same holds for Dailymotion, Twitch, Loom, Wistia,
  Streamable, Bilibili, SoundCloud and TikTok, and any subdomain of them.

Baking requires confidence that the URL names a file. A local path or a `data:` URL is one
by construction; a remote URL has to end in an extension we recognise, and one that comes
back as `text/html` is demoted on the spot — otherwise a login interstitial ends up stored
under a `.jpg`-shaped id. Every demotion is named on stderr rather than left for you to
discover. A fetch that fails throws instead of quietly downgrading: you asked for a
self-contained pack, and you would not otherwise learn you did not get one.

Reading is the half that matters, because a pack arrives from other people. The version is
checked before the manifest is believed, the manifest is validated, and entry paths that
are absolute or contain `..` are rejected on the way in and on the way out.

## The storyboard is the human checkpoint

This is the centre of the design, not a convenience. Everything downstream is a
projection of `storyboard.json`, so it is the last point where a fix is cheap: editing one
beat costs a line, and fixing twelve realized slides costs an afternoon. Stop after `plan`
and read it. If the storyboard is mediocre, no amount of rendering fidelity rescues the
output.

It describes pedagogy, not geometry — no canvas size, no colours, no coordinates. Those
are `emit` decisions per format, which is what lets the same beats render as a lecture
panel and as a two-second punch in a reel.

Provenance is what makes the plan checkable rather than merely plausible. Because a beat
names the figure or equation it rests on, a later pass can ask whether the animation
actually asserts what the source asserts. Prior art verifies that slides *look* fine;
nothing verifies that they are *true*.

## The sixteen archetypes

The explanatory vocabulary. These came out of hand-building a real deck
(`.planning/EXPERIMENT-002-thinksr-korean.md`), not from guessing at what might be useful.

| Archetype | For | Key params |
|---|---|---|
| `title` | opening or section break | `headline`, `eyebrow?`, `sub?` |
| `claim-figure` | one assertion beside the figure that supports it | `claim`, `figureId` |
| `stage` | one picture, UI, clip or piece filling the whole frame, words optional over it | `figureId` or `illustration`, `placement`, `headline`, `line?` |
| `equation-walk` | an equation explained symbol by symbol | `equationId`, `terms` (1–4) |
| `equation-morph` | one equation becoming the next, the shared terms carried across | `fromId`, `toId`, `terms` (1–4) |
| `data-table` | a results table with rows revealed in argument order | `tableId`, `highlight` |
| `line-chart` | a trend, with per-step deltas, optionally against a baseline | `points`, `deltas?`, `readout?`, `compare?` |
| `callout` | 1–3 panels of prose: definitions, contrasts, takeaways | `panels`, `note?`, `backdrop?` |
| `pipeline` | stages in a flow, arrowed, with an optional feedback loop | `stages` (2–6), `loop?`, `backdrop?` |
| `annotated-figure` | a figure cropped to the panel under discussion, with leader lines | `figureId`, `crop?`, `notes` |
| `grid` | regions of a field lit in turn: windows, patches, receptive fields | `cols`, `rows`, `regions` |
| `bar-compare` | magnitudes that share a unit, grown from zero | `bars` (2–8), `unit?`, `backdrop?` |
| `stack` | layers drawn bottom-up as offset planes | `layers` (2–7) |
| `split-compare` | two things side by side, each figure or lines | `left`, `right`, `backdrop?` |
| `hero-number` | one number as the slide's statement (v2: 56px, faded in; classic: filling the frame, rolled in like an odometer) | `value`, `unit?`, `label`, `compare?`, `headline`, `backdrop?` |
| `kinetic` | a claim as type: 2–4 phrases (v2: 44-56px, faded in, the key word turns the accent; classic: each its own move, a key word struck) | `phrases` (`text`, `key?`), `headline`, `backdrop?` |

All but `title`, `data-table`, `callout` and `kinetic` draw rather than describe
(`DIAGRAMMATIC` in `src/types.ts`), and `verify` warns when a deck leans on those four: a
deck of headlines and bullet panels is what every other slide generator already makes.

`stage` is the slide that is not a slide: the figure covers the frame edge to edge
(cover-fit, so it is cropped to the frame's shape), with no plate, border or column. Words
are optional. `placement` is one of `none`, `bottom-left`, `top-left`, `center` or
`right`; under anything but `none` the `headline` (72px) and an optional `line` (44px)
are set in white over a black scrim. The scrim's solid part is sized from the text's
measured height and width, bounded on both axes so the rest of the picture is left
alone, and is 55% black, which white text clears at about 4.8:1 even over a pure white
picture, so the contrast gate passes on whatever the picture is. Text is never shrunk: words
that need more than three headline lines or two of `line` in their placement's column take
a wider column (and `build` warns), and only words that will not fit across the whole
content width are refused by name. `right` sets the words flush right; in a portrait
frame every placement is full width. The picture fades and settles in first, the words after; one stop lands
once both are in, or after a piece's last frame. A still or clip drifts 4% over the beat.
`build` warns (it does not refuse) when a raster figure is upscaled more than 1.5x or
cropped by more than 30% to fill the frame. With `--reserve-captions` the picture stops
above the caption strip. The planner is told to reach for it when a visual should own the
screen, and, under RULE 1's variety rule, to give consecutive stages different placements.

`hero-number` and `kinetic` are full-bleed too, and need no picture (in `--design v2` so
is a `bar-compare`, which classic still draws on its ground). Without a
`backdrop` they stand on a field of one of the pack's colours — the accent and each tone in
turn, by the beat's place in the deck, so field beats near each other differ — darkened
until it is no lighter
than half the backdrop scrim's worst-case ground, so the same glass inks clear 4.5:1 on
it; with one they go over the picture as the diagrams do. Under `--design v2` both are
quiet: `hero-number` sets `value` at the headline's 56px in the accent, its label and
comparison as body lines, every part faded in where it stands; `kinetic` sets its phrases
at 56px down to 44px, each word fading in, and turns the `key` the accent instead of
sweeping a chip behind it — the motion is the picture under them. In classic,
`hero-number` sets `value` as
large as the frame holds (160–560px) and rolls each digit in on a reel — a strip of
0-9 clipped to one cell with `clip-path`, its `y` tweened a whole number of cells, the
right-hand reels turning most and every reel landing left to right. No counter is
written from a callback (invariant 11). A `compare` whose value and `value` are both
plain numbers is drawn as two bars to one scale, the baseline first — unless the
shorter would be over 85% of the longer, when bars read as "equal" and the baseline
is a second figure followed by the signed difference ("+0.83 dB"); otherwise as a
second figure. One stop, after the `headline` under it. `kinetic` sets two to four
`phrases` as large as two lines each allow (64–120px), down a slight stair; each
arrives word by word with its own move (rise, slide, drop or zoom, the first seeded by
the beat id), then its `key` — verbatim in the phrase — is struck by a chip swept in
behind it. One stop per phrase. Its moves are the content, so the scene sets
`ownEntrances` and the v2 motion grammar leaves them alone. Its `headline` labels the
slide and is not drawn. With `--images` both count as scenes, and the planner is held
to at most 36% panel beats (pipeline, split-compare, callout, stack, data-table,
backdrop or not): five of fourteen.

`line-chart`'s `compare` is the one parameter that changes what its archetype *is*. Given
`{ label, points }` the chart draws the baseline first, holds it, then reshapes the curve
into `points` and leaves the baseline behind as a labelled ghost — so the slide asserts a
change in the curve's *shape*, not two numbers. Reach for it on that tell: one quantity
measured under two conditions.

The two series must be over the same x values in the same order, or `storyboardSchema`
refuses the beat before any of it is drawn. Series over different categories would reshape
point *i* of one condition onto point *i* of another, which is a smooth and convincing lie
that nothing downstream can catch: both curves fit the plot, both clear the type floor, and
`drift` renders the same wrong thing twice.

It costs time — the baseline draws, is held, then reshapes — so give a compare beat
`seconds` of 7, or 8 with a `readout`. Given fewer than it needs, the emitter draws the
chart *without* the comparison rather than stopping on a half-drawn one: the same beat, one
series, byte-for-byte the plain chart, down to MorphSVG's 21,195 bytes staying off the deck.
It says so on the way past, as a `build: kept <beat> — …` line, and that line is the only
place anyone learns the comparison is gone. Refusing instead would reach `onBeatError` and
drop the whole slide, which is the worse trade.

Keep `label` short. It is set at the end of the baseline and refused outright if it is
wider than the plot, and *that* refusal does cost the slide. Where it fits, it is placed by
trying four positions and rejecting any that would print through the axis names, the tick
labels, the category names, a value, a drawn delta or either curve; if all four are
rejected the label is dropped rather than overprinted, and dropped silently, because an
unnamed ghost is still legibly the fainter, earlier curve.

Each maps to exactly one emitter. Adding a domain means adding archetypes — the core never
learns what a camera frustum or an orderbook is.

## Adding an archetype

1. Add a params schema and one member to the `beatSchema` union in `src/types.ts`. The
   union is closed on purpose: an unhandled archetype is a type error, not a runtime
   surprise.
2. Write `src/emit/archetypes/<name>.ts` as an `Emitter<"<name>">`. It returns a `Scene`:
   inner HTML, GSAP statements, hold points, and its own CSS. It owns one scene's insides
   and nothing else. If it draws labelled parts a camera could fly into, fill `Scene.parts`
   in the same loop that gives them their ids — `inside.element` is an index, and that map
   is the only thing that can tell the plan's third stage from the picture's. If its tweens
   need a vendored GSAP plugin, name it in `Scene.plugins`: `PLUGINS` in
   `src/emit/composition.ts` is the one place a name resolves, and a name that table does
   not know is refused at emit time rather than emitted as a tween that animates nothing.
   And if it has to drop an ornament to fit the beat's length, draw the rest and say so in
   `Scene.warnings` rather than throwing — a throw reaches `onBeatError`, which costs the
   whole slide.
3. Register it in `src/emit/archetypes/index.ts`.

Nothing else changes. The document shell, the deck runtime, the format profiles and the
verify gates never learn the new name.

## Deck navigation is ours

The step layer in `src/deck/` is DeckSmith code, not upstream's, because upstream deck
navigation does not work. `player.scenes` never populates, so
`SlideshowController` has no slide-to-time map to bind and every key press is a no-op —
reproduced on HeyGen's own unmodified reference example, on 0.7.71 and 0.7.72,
measured again on 0.7.90 when the pin moved (`player.scenes` still 0; the slideshow
bundle byte-identical to 0.7.71's), and again on 0.8.27, where `scenes` is not a
property of the player at all — thirty minor versions and the hole is wider. What
does work, exactly as documented, is `player.seek(t)`. So we read the slideshow island,
map steps to absolute times, and drive `seek()` ourselves. It is about a hundred lines and
it stops the primary deliverable from being blocked on someone else's roadmap.

Full writeup, including the control experiment that settled it:
[`.planning/EXPERIMENT-003-deck-mode.md`](.planning/EXPERIMENT-003-deck-mode.md).

The corollary is worth internalising before you trust a green gate: `check` has passed
twice on artifacts that were broken. The gates verify the mechanics of what the structure
exposes, and a structurally wrong deck exposes nothing to check.

### Embedding a deck in your own page

The same step layer is reachable from outside as a custom element. A consumer learns one
thing — where the deck is:

```html
<script type="module" src="/player.js"></script>
<decksmith-player deck="/d/<id>/"></decksmith-player>
```

`next()`, `prev()`, `go(i)` and `play(on)` are methods; `ds-ready`, `ds-stop` and
`ds-error` are events. `ds-ready` carries every stop the deck can land on, which is what
a jump list is built from. Setting `deck` again swaps the deck in place.

**The iframe stays, and is the module boundary.** It is tempting to mount the deck
inline instead, and three facts in this tree rule it out. `frameOf` reads
`contentDocument` and returns null cross-origin while the runtime only warns, so an
inlined deck served from a CDN would navigate perfectly and paint nothing, silently.
`customElements.define` is one registry per document, so two decks would be two vendored
hyperframes bundles and the second `define` throws. And the deck's own chrome is written
against `100vh` being the box, which is true inside a frame and quietly wrong outside it.
Keeping the frame leaves the same-origin pair as `deck.html`↔`index.html`, one directory,
always true — and makes the host link `postMessage`, which does not care about origin.

**Silence is a supported state.** A deck is a static artifact that outlives the tool that
built it, and every deck built before this change has no bridge in it. The element waits,
gives up, emits `ds-error` with reason `no-bridge`, and leaves the deck exactly as usable
as it was — still a deck in a frame, its own keyboard still working. It does not blank and
it does not throw.

`examples/embed.html` is both the demo the dev server serves at `/examples/embed.html`
and the file you copy next to a built deck. Nothing in `lint`, `check`, `verify`, `drift`
or `render` opens a deck page, so a browser pass is the only instrument that can tell you
any of this works. The design note is
[`.planning/2026-09-07-player-as-a-module.md`](.planning/2026-09-07-player-as-a-module.md).

## Invariants the generator enforces

These were all learned by breaking them, and they are why build output is generated
mechanically rather than free-hand.

- Every tween is `fromTo`. `from()` captures its end state at construction, which is wrong
  under the arbitrary seeking that navigation performs.
- Every timeline selector is scoped to its scene (`#s3 .term`, never `.term`). Unscoped
  selectors fail lint and, once bundled, silently animate other scenes' elements.
- Scenes carry `data-composition-id/start/duration/label` and nothing else — no
  `data-track-index`, no per-scene width or height.
- Each scene registers its own paused timeline with times relative to its own start; the
  root timeline holds only a dummy tween spanning the deck.
- KaTeX renders with `output: "html"`. The default also emits a hidden MathML mirror that
  the layout inspector reads as overlapping text.
- No TeX reaches a `katex.render` call that KaTeX has not already parsed in Node, with
  `throwOnError` and the deck's own options (`src/emit/tex.ts`). A formula that fails gets
  a repair only where it cannot change what the formula says — a missing `\right.`, an
  unclosed brace, a dropped `\label`, a paper's undefined macro drawn as its name — and the
  repair is printed at `plan` and again at `build`. One no repair saves is shown as its
  source in plain text by `equation-walk`, and costs the beat, by name, in
  `equation-morph`. Until this existed the first parser a formula met was the browser at
  `verify`, after the deck had been built and narrated: 26 of 92 failed HypePaper builds
  in the week to 2026-10-07, 25 of them from `wrapTerms` cutting a `\left`/`\right` pair or
  a superscript in half.
- `equation-walk` measures its display after fonts and fits it to its box: smaller down to
  the 40px floor, then broken after top-level relations and operators. One that still does
  not fit fails `fidelity` as `math_unfit`, with the formula in the message.
- No `Date.now()`, no `Math.random()`, no network at render time *in the composition*.
  Two renders of an image-free deck must be byte-identical. `deck.html` is exempt: it is
  presented, never rendered, and its subtitle loop legitimately reads a clock.
- `deck.html` never contains the string `data-composition-id`. A root-level HTML file that
  does trips lint's `multiple_root_compositions`, and the deck stops being navigable.
- Every deck declares the face its stack names. A CJK deck ships a subsetted Noto; every
  other deck ships Inter from `@fontsource-variable/inter`. HyperFrames resolves Inter from
  its own allowlist, but only inside a render: the gates' page and `deck.html` never run its
  compiler, and without the deck's own face they drew SF on a Mac and DejaVu on Linux.
- Audience text never goes below 40px at 1920x1080, display equations sit at 60–76px. A
  30px equation passes every automated gate and is unreadable from row six.
- **No archetype declares its own content width.** The box comes from
  `contentW(format)` / `contentH(format)` in `src/emit/kit.ts`, which are
  `format.width - 2 * PAD_X` and `format.height - 2 * PAD_Y` — the same padding `baseCss`
  writes, so the stylesheet and the arithmetic cannot drift. A module-level `const W =
  1700` is 16:9 hardcoded into a file that will one day be asked for 1080×1920, and that
  is exactly how the vertical deck came to run off its own canvas while reporting PASS.
  Pixel counts chosen against the 1700px box (`bar-compare`'s plot minimums, for one) go
  through `share(px, width)` so they stay proportions rather than becoming constants.
- **A CSS class belongs to exactly one archetype.** One stylesheet serves the whole deck,
  so a class is deck-global while the file declaring it looks local. Two archetypes once
  both defined `.stackwrap`, with opposite intentions about stretching; it rendered
  correctly only because one wrapper happened to already be its box's width. No gate reads
  CSS, so this is pinned by a test instead — `archetypes.test.ts` fails when two
  archetypes say different things about the same class name.
- **Nothing is driven by a GSAP callback.** Not because the video renders frozen: that was
  the stated reason for a long time, it was measured on 2026-09-04, and it did not hold.
  `hyperframes render` drives capture through Chrome's `beginFrame` rather than through a
  seek, and `suppressEvents` is a property of a seek — so under the renderer a callback
  fires and its motion ramps, in both constructions that were tried. What the callback
  actually costs is **reproducibility**. Measured against a control on the same deck: the
  demo differs on 11 frames of 3,120 as built and on 260 with one `onUpdate` tween added,
  so one callback multiplies the non-reproducible frames by 24 without moving the
  worst-case PSNR. And nothing in this stack agrees about what a callback did: `decksmith
  frames` *does* seek, so it passes `suppressEvents` and shows nothing; `hyperframes
  snapshot` shows a browser's playback; the render shows a third thing. So tween the
  property, and where a value is not directly tweenable, tween a proxy object and bind the
  property to it. `AGENTS.md` invariant 11 carries the measurement and the table.
- **A vendored runtime costs bytes only on the decks that use it.** GSAP and DrawSVG are
  unconditional, because every drawing archetype draws something on. Everything else goes
  through `PLUGINS` in `src/emit/composition.ts`: a scene names what its tweens need in
  `Scene.plugins`, the head emits a `<script src>` and a `registerPlugin` per name **in the
  table's order** — not the scene's, or two storyboards differing only in beat order would
  emit the same tags in a different order and cost someone a day in `drift` — and
  `vendorScripts` copies only the files the emitted head actually references. So MorphSVG's
  21,195 bytes are on a deck that reshapes and on no other, and a name the table does not
  know is refused at emit time rather than shipped as a tween that silently animates
  nothing. Registration goes before the first scene script, because a scene builds its
  timeline inline and late registration is not late, it is nothing.

## Repo layout

```
src/index.ts          the library surface — the only file consumers import
src/cli.ts            the eleven verbs, argv and stderr
src/types.ts          the contract: Source, Storyboard, Beat, Format, Verdict
src/prefs.ts          the three-layer preference resolver
src/emit/kit.ts       the seam between the deck shell and the archetype emitters
src/emit/archetypes/  one emitter per archetype
src/emit/themes/      one palette per file; the registry is the extension point
src/emit/animate-runtime.ts  the dsAnimate plugin that draws an animated piece
src/build/animate/    animate's cut-paper kit, vendored unmodified (MIT; LICENSE, NOTICE)
src/emit/type.ts      type specs: the v2 packs' faces and chrome scale, read by chromeHeight and chromeCss
src/emit/faces.ts     measured width tables for the packs' Latin faces (generated)
src/images/           the three rungs a brief is drawn through, and the illustrate step
src/narrate/          edge-tts, one segment per stop
src/pack/             the .deck container and its bake/link/embed policy
src/deck/             our step layer over player.seek(), and the subtitle reader
src/server/           `npm run serve` — routes, queue, the six stages, and the one page
                      (ui.ts). Everything here reaches the library through ../index.js
                      only; see the note at the top of ui.ts for what breaks otherwise.
.planning/            the design sketch and the experiment writeups
experiments/          hand-built decks; hf-thinksr is the shape the emitter targets
```

`experiments/hf-thinksr/index.html` is a working deck built by hand. When a generated deck
misbehaves, diff against it.

## A note on `npm audit`

`npm audit` reports advisories against `sharp`, `onnxruntime-node`, `adm-zip` and
`@hono/node-server`. Every one is transitive through hyperframes' own build toolchain, and
none is fixable from here. This is build-time tooling running on inputs we author, and
the CLI and library expose no network-facing surface, so the advisories are tracked, not
gating. (`npm run serve` does listen — see "Running the server" for what that is and is
not ready for — but it binds loopback by default and none of these packages is on its
request path.)
`.github/workflows/upstream-drift.yml` files an issue when the pin falls behind, which is
where a real fix would arrive.

## Licence

MIT. The animate kit vendored in `src/build/animate/` is also MIT, copyright (c) 2026
cth9191. Its `LICENSE` and `NOTICE` sit beside it; see "Animated pieces".

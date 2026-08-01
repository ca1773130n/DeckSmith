# DeckSmith

DeckSmith turns a source document — a paper, a spec, a set of course notes — into an
animated explanation deck: one self-contained HTML file you can present, and the same
storyboard rendered to a 9:16 short or an MP4 without replanning.

Rendering is bought, not built. A deck is a
[HyperFrames](https://github.com/heygen-com/hyperframes) composition (Apache-2.0, pinned
at 0.7.71), so the animation runtime, the headless capture and the FFmpeg encode are
upstream's. What DeckSmith owns is the part nothing else does well: turning a document
into a *good explanation*, and being able to check that the explanation is true to its
source.

## Prerequisites

- Node 22 or later, and nothing else to **generate** a deck. `ingest`, `build`, `pack` and
  `unpack` are pure Node: they read files, write files, and never open a browser. Decide
  your deployment on that line — a service that turns papers into decks runs in a plain
  Node image.
- A Chromium build and ffmpeg to **render or check** one. `verify` drives the HyperFrames
  gates in a headless browser, and the MP4 encode is ffmpeg's. Both arrive with the
  hyperframes toolchain during `npm install`; there is nothing to install by hand.
- Two commands reach outside for their own reasons: `plan` runs the Codex CLI, and
  `narrate` runs edge-tts over the network.

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
decksmith narrate storyboard.json  --source source.json -o audio/       # optional
decksmith build   storyboard.json  --source source.json --format deck-16x9 -o out/
decksmith verify  out/
decksmith render  out/            -o talk.mp4          # picture + narration + subtitles
decksmith drift   out/                                 # render twice, compare frame by frame

decksmith pack    storyboard.json  --source source.json -o talk.deck    # one file to keep
decksmith unpack  talk.deck        -o reopened/
```

- **ingest** — document to `Source`: sections, figures, equations and tables, each with a
  stable id so a later stage can point back at it.
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
- **narrate** — each beat's `narration` text, spoken by edge-tts, one audio file and one
  set of subtitle cues per *stop*. Optional, and the only command that needs the network.
  See "Narration" below.
- **build** — `Storyboard` to a composition, per format profile. Beats become scenes,
  scenes become their own paused GSAP timelines, hold points become slideshow fragments.
  Narration sitting beside the storyboard is picked up automatically.
- **verify** — runs the HyperFrames gates over a built directory and returns a `Verdict`:
  lint, runtime, layout, motion and contrast. Read what that does *not* cover before
  trusting it — see "What the gates do not check" below.
- **render** — a built deck to a finished video: capture, retime, mux, subtitles. The
  retiming is the interesting part. The composition reveals everything a beat has to show
  and then sits still for the rest of its window, so playing it back linearly puts the
  narration seconds away from the picture it describes. `render` instead does what a
  presenter does — freezes each hold for exactly its sentence's length, then plays out
  whatever the scene actually ends on. Needs Chromium and ffmpeg, and needs the
  `timing.json` that `build` writes.
- **drift** — renders the deck twice and compares every frame. `--identical` fails on any
  differing byte, which is only honest for an image-free deck with no camera;
  the default compares PSNR against a 40 dB floor. Costs two full renders, so it is a
  thing you schedule rather than a thing you run per build. See
  `.planning/EXPERIMENT-006-diagrams.md` for why byte-identical is not available in
  general on this stack.
- **pack** / **unpack** — the whole deck as one `.deck` file, and back again. See "The
  `.deck` container" below.

### What `build` writes

```
out/
  index.html                    the composition — what check, snapshot and render consume
  deck.html                     open this: the navigable deck
  hyperframes-player.global.js  copied from the hyperframes package, so nothing needs a CDN
  hyperframes.json  assets/
  audio/                        only when the deck is narrated
```

Serve the directory and open `deck.html` — any static server will do. It must be http,
not `file://`: the wrapper drives the composition through its iframe, and a file-origin
iframe cannot be reached. The deck says so in the console rather than rendering blank.

Arrow keys, Space and PageUp/PageDown step; clicking the left or right third does too;
`Home`/`End` jump; `n` toggles presenter notes; `f` is fullscreen; `m` mutes the voice and
`s` hides the subtitles. Every step is deep-linkable (`#3` is slide 3, `#3.2` its second
reveal).

Stepping forward *plays* the reveal rather than cutting to it — the step layer sweeps the
composition's timelines across frames instead of seeking once. Backward steps, `Home`/`End`
and deep links cut, because entrance tweens run in reverse look like elements un-drawing
themselves. A held slide keeps a slow ambient motion on one focal element so it reads as a
live document rather than a screenshot. Both respect `prefers-reduced-motion`, and both
exist only on the deck page: ambient motion is gated behind a class the composition never
sets, so `render` output is byte-identical with or without it.

Navigation is ours rather than upstream's because upstream's is broken at 0.7.71/0.7.72
— `player.scenes` never populates, reproduced on HeyGen's own reference example. The
same layer also paints the composition, because the standalone player moves its clock
without driving scene timelines or clip visibility. See
`.planning/EXPERIMENT-003-deck-mode.md` and `-004-step-layer.md`.

### What the gates do not check

The failure this project keeps producing is a **green gate over wrong output**, and there
are now ten documented cases. Nearly every one was caught by a human looking at the
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
  [`.planning/EXPERIMENT-010-reconcile.md`](.planning/EXPERIMENT-010-reconcile.md); the
  caption one is **still open**.

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
# build:   cut b03 (annotated-figure, 27.5s) — Cut to fit short-9x16's 3m00s: 27.5s for
#          weight 0.9 is 0.033 weight per second, and the beats kept buy more per second.
#          Its family (structure) still has 3 beat(s) in the cut.
# build:   cut b06 (stack, 24.7s) — …
# build:   cut b11 (claim-figure, 15.5s) — …
# PASS — 0 error(s), 2 warning(s)
```

The rule is `selectBeats` (`src/plan/select.ts`), and it is not "drop the lightest". In
priority order it keeps a cut **coherent**, then **covered** — the deck's first and last
beat, and one beat of every archetype family the full deck used — then **fitting**, and
only then heaviest. Author weight is the last tiebreak, because weight says how much a
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
decksmith: no auth, no TLS. Bound to 127.0.0.1 — set DECKSMITH_HOST to open it, knowing that.
decksmith: codex, edge-tts and ffmpeg all found
```

### The HTTP surface

| Route | What it does |
|---|---|
| `POST /api/jobs` | multipart: `file` (.md/.markdown/.txt/.zip) plus option fields → `202 {id}` |
| `GET /api/jobs/:id` | `{state, stage, steps[], log[], error, result, queuePosition}` |
| `GET /api/jobs/:id/events` | the same payload as SSE on every change |
| `GET /api/formats` | the presets, themes, tones, densities and canvas bounds the picker draws from |
| `GET /d/:id/...` | the built deck, served statically; `/d/:id/deck.html` is the player |

Options on `POST`, all optional, all defaulted server-side: `format`, `width`+`height`,
`theme`, `slides`, `lang`, `tone`, `density`, `speed`, `narrate`, `voice`, `video`.

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
| `DECKSMITH_HOST` | `127.0.0.1` | There is no auth. Opening it should require typing something. |
| `DECKSMITH_WORK` | `$TMPDIR/decksmith-server` | One directory per job; swept by age. |
| `DECKSMITH_MAX_UPLOAD` | 25 MB | |
| `DECKSMITH_MAX_QUEUE` | `8` | Concurrency is 1. Past 8 the answer is "full", not "position 400". |
| `DECKSMITH_JOB_TTL_MIN` | `120` | Files outlive the in-memory record; orphans are swept on boot. |
| `DECKSMITH_JOBS_PER_HOUR` | `5` | Per IP. Charged only on an **accepted** job. |
| `DECKSMITH_REQS_PER_MIN` | `240` | Per IP. |
| `DECKSMITH_FETCH_FIGURES` | off | See below. |
| `DECKSMITH_DECK_SANDBOX` | on | Serves decks under `CSP: sandbox`. |

**Remote figures are off by default, and that is a security decision.** `fetchFigures`
does `readFile(src)` on anything that is not an http URL, so an uploaded document
containing `![](../../../etc/ssh/ssh_host_rsa_key)` would have this process read it.
Relative paths are resolved inside the upload directory and confined there; http figures
are dropped with a named warning unless you turn them on. A hostname allowlist does not
close the SSRF — DNS can answer differently the second time — so none is pretended.

### What is missing before this is public

This runs a demo on a laptop. It is **not** ready to face the internet, and the gap is
not a polish gap:

- **No authentication and no TLS.** Anyone who can reach the port can spend your Codex
  quota. This is why the default bind is loopback.
- **No CSRF defence.** `POST /api/jobs` is `multipart/form-data`, which is a CORS-*simple*
  request: any website a victim visits can make their browser submit a job. There is no
  token and no `Origin` check. Fix that before `DECKSMITH_HOST` is ever anything else.
- **Codex spend is unmetered per upload.** The per-IP hourly limit is the only brake, and
  it is per-IP.
- **Rate limiting is by `socket.remoteAddress` only.** `X-Forwarded-For` is deliberately
  not read, because unproxied it is a header the client writes. Behind a reverse proxy
  every client therefore looks like one address and the limits collapse — teach the proxy
  to rate-limit, or teach this to trust exactly one hop.
- **Deck files are readable by anyone holding the 128-bit id.**
- **The deck sandbox does not isolate the origin, and cannot on one host.** Decks are
  served under `Content-Security-Policy: sandbox allow-scripts allow-same-origin
  allow-downloads`, which still denies top-level navigation, popups, forms and modals —
  but `allow-same-origin` is not optional: `deck.html` is the HyperFrames player and it
  drives the composition through `iframe.contentDocument`, so an opaque origin makes
  every slide render blank while the job reports `done`. Real isolation means serving
  `/d/:id` from a **separate origin**, which is a second listener and is not built.
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

Build it first with `npm run build && npm run build:mcp`. `DECKSMITH_MCP_ROOT` is the fence
— documents outside it are not readable, and it defaults to your home directory rather than
the working directory, because not every client launches a stdio server anywhere useful.

Four tools:

| tool | what it does |
|---|---|
| `decksmith_capabilities` | formats, themes, every setting's range, and which of Codex, edge-tts, ffmpeg and Chrome are installed |
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
document's.

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
  onStep: console.log,        // silent otherwise: a library that prints is one you
});                           // cannot run inside a request handler

const verdict = await verify(out);   // needs Chrome; skip it on the request path
```

`buildDeck` is the `build` verb minus argv, and writes exactly what the CLI writes — the
demo deck built this way is byte-identical to `decksmith build`'s. It does **not** run the
gates, because `verify` wants a browser and a caller may have neither one nor the patience
for it; call `verify` yourself when you want it.

### The surface

| Stage | Exports |
|---|---|
| ingest | `parseMarkdown`, `fetchFigures`, `bundleFont` |
| plan | `codexPlanner` with its `Runner` type, `assertRefsResolve`, `systemPrompt`, `renderSource` |
| narrate | `narrate`, `pickVoice`, `narratableLangs` |
| emit | `buildDeck`, `emitDeck`, `emitComposition`, `resolveTheme`, `THEMES`, `THEME_NAMES` |
| verify | `verify`, `check`, `parseCheckReport` |
| pack | `writePack`, `readPack`, `openPack`, `planMedia`, `mediaSummary` |
| prefs | `loadPrefs`, `CONFIG_FILE` |
| contract | everything in `src/types.ts` — every schema, `Source`, `Storyboard`, `Beat`, `Format`, `FORMATS`, `Verdict` |

Two of those are worth pointing at. `Runner` is exported so you can drive planning through
an SDK instead of a subprocess, which is what a server actually wants — `codexPlanner`
shells to the Codex CLI only because that is the right default at a terminal. And
`emitDeck` sits underneath `buildDeck` for callers writing to object storage or a response
body rather than a filesystem: it is pure, taking strings in and returning strings out.

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
| `theme` | `ink` | emit | `ink` · `paper` · `mono` |
| `animationSpeed` | `1` | emit | multiplies every duration, hold and beat length. Below 1 is faster |
| `narration.voice` | picked for `lang`+`tone` | narrate | an explicit edge-tts voice id |
| `narration.rate` | `+0%` | narrate | edge-tts prosody |
| `narration.pitch` | `+0Hz` | narrate | edge-tts prosody |
| `narration.subtitles` | `true` | narrate | write subtitle cues alongside the audio |

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
  }
}
```

An unknown key is an error, by name: a misspelled preference that is silently dropped
looks exactly like a preference the tool ignores, and you spend the next hour wondering
why `slideCount` did nothing.

```
decksmith.config.json: unknown preference "narration.speed". Valid: enabled, voice, rate, pitch, subtitles.
```

On the command line: `--slides --lang --tone --density` on `plan`, `--theme --speed` on
`build`, `--voice --rate --pitch --no-subtitles` on `narrate`, and all of them on `pack`,
which records the preferences the deck was made under.

A preference sitting at its default says nothing, so a stored artifact wins over it and
loses to anything you type. `plan` stamps `lang` and `theme` into the storyboard it
writes; `build` then uses the storyboard's unless `--theme` or a config file restates one.
Language is never overridden at build time — it describes copy that is already written.

## Themes

Three, each a position rather than a hue.

| Theme | Ground | For |
|---|---|---|
| `ink` | near-black | a dark room and a projector. The default |
| `paper` | warm off-white | a lit room, a shared screen, print |
| `mono` | white on black, one red | bad projection and greyscale printing, where hue does not survive |

`mono`'s four tones are a grey ladder plus one red rather than four hues, because value is
what survives a bad projector and hue is not; four hues would have collapsed into one
grey. All three keep the Inter stack — font families auto-resolve from a fixed allowlist,
and a serif naming a family the bundle does not declare falls back silently.

A theme is a name and a palette, and that is the whole extension point: a new one is a
file in `src/emit/themes/` plus a line in `THEMES`. No archetype learns it exists.

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

Playback reads the audio element's own clock, never a timer: a timer agrees with the audio
right up until the first stall, and a stall is exactly when a viewer looks at the subtitle
to find out what they missed. `m` mutes (captions keep tracking, and a muted element is
exempt from the autoplay policy, so it doubles as the escape hatch); `s` hides subtitles.
If the browser refuses to autoplay, the deck says `press any key for sound` once and
navigation carries on regardless.

Audio is content-addressed on the text, voice, rate and pitch, so re-narrating an edited
deck re-speaks only the sentences that moved — and two beats saying the same sentence
share one file. `verify` fails a deck whose island names an mp3 that is not in the
directory; nothing else notices, because a missing file looks identical to a browser that
declined to play.

`edge-tts` must be on your PATH, or installable as `python3 -m edge_tts`; set
`DECKSMITH_EDGE_TTS` to point at it directly. It is the only part of DeckSmith that needs
the network, which is why it is its own command and not a step inside `build`.

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

## The twelve archetypes

The explanatory vocabulary. These came out of hand-building a real deck
(`.planning/EXPERIMENT-002-thinksr-korean.md`), not from guessing at what might be useful.

| Archetype | For | Key params |
|---|---|---|
| `title` | opening or section break | `headline`, `eyebrow?`, `sub?` |
| `claim-figure` | one assertion beside the figure that supports it | `claim`, `figureId` |
| `equation-walk` | an equation explained symbol by symbol | `equationId`, `terms` (1–4) |
| `data-table` | a results table with rows revealed in argument order | `tableId`, `highlight` |
| `line-chart` | a trend, with per-step deltas | `points`, `deltas?`, `readout?` |
| `callout` | 1–3 panels of prose: definitions, contrasts, takeaways | `panels`, `note?` |
| `pipeline` | stages in a flow, arrowed, with an optional feedback loop | `stages` (2–6), `loop?` |
| `annotated-figure` | a figure cropped to the panel under discussion, with leader lines | `figureId`, `crop?`, `notes` |
| `grid` | regions of a field lit in turn: windows, patches, receptive fields | `cols`, `rows`, `regions` |
| `bar-compare` | magnitudes that share a unit, grown from zero | `bars` (2–8), `unit?` |
| `stack` | layers drawn bottom-up as offset planes | `layers` (2–7) |
| `split-compare` | two things side by side, each figure or lines | `left`, `right` |

The last six draw the mechanism rather than describe it, and `verify` warns when a deck
leans on the others: a deck of headlines and bullet panels is what every other slide
generator already makes.

Each maps to exactly one emitter. Adding a domain means adding archetypes — the core never
learns what a camera frustum or an orderbook is.

## Adding an archetype

1. Add a params schema and one member to the `beatSchema` union in `src/types.ts`. The
   union is closed on purpose: an unhandled archetype is a type error, not a runtime
   surprise.
2. Write `src/emit/archetypes/<name>.ts` as an `Emitter<"<name>">`. It returns a `Scene`:
   inner HTML, GSAP statements, hold points, and its own CSS. It owns one scene's insides
   and nothing else.
3. Register it in `src/emit/archetypes/index.ts`.

Nothing else changes. The document shell, the deck runtime, the format profiles and the
verify gates never learn the new name.

## Deck navigation is ours

The step layer in `src/deck/` is DeckSmith code, not upstream's, because upstream deck
navigation does not work at 0.7.71. `player.scenes` never populates, so
`SlideshowController` has no slide-to-time map to bind and every key press is a no-op —
reproduced on HeyGen's own unmodified reference example, on both 0.7.71 and 0.7.72. What
does work, exactly as documented, is `player.seek(t)`. So we read the slideshow island,
map steps to absolute times, and drive `seek()` ourselves. It is about a hundred lines and
it stops the primary deliverable from being blocked on someone else's roadmap.

Full writeup, including the control experiment that settled it:
[`.planning/EXPERIMENT-003-deck-mode.md`](.planning/EXPERIMENT-003-deck-mode.md).

The corollary is worth internalising before you trust a green gate: `check` has passed
twice on artifacts that were broken. The gates verify the mechanics of what the structure
exposes, and a structurally wrong deck exposes nothing to check.

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
- No `Date.now()`, no `Math.random()`, no network at render time *in the composition*.
  Two renders of an image-free deck must be byte-identical. `deck.html` is exempt: it is
  presented, never rendered, and its subtitle loop legitimately reads a clock.
- `deck.html` never contains the string `data-composition-id`. A root-level HTML file that
  does trips lint's `multiple_root_compositions`, and the deck stops being navigable.
- Fonts auto-resolve only from a fixed allowlist. Inter is on it, Noto Sans KR is not, so
  every CJK deck ships its own subsetted `@font-face` or the text silently falls back.
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
- **Nothing is driven by a GSAP callback.** Capture seeks rather than plays, and `seek()`
  passes `suppressEvents` — so `onUpdate`, `onStart` and `onComplete` never fire while a
  frame is being taken. Motion applied from a callback therefore looks right in a browser
  and renders a **frozen video**, with every gate green: lint, check, the type floor, and
  even `drift`, which passes twice over because both renders freeze identically. State
  must be applied by the thing being seeked — tween the property. This is the most
  dangerous failure shape in the project, and no automated gate can see it.

## Repo layout

```
src/index.ts          the library surface — the only file consumers import
src/cli.ts            the nine verbs, argv and stderr
src/types.ts          the contract: Source, Storyboard, Beat, Format, Verdict
src/prefs.ts          the three-layer preference resolver
src/emit/kit.ts       the seam between the deck shell and the archetype emitters
src/emit/archetypes/  one emitter per archetype
src/emit/themes/      one palette per file; the registry is the extension point
src/narrate/          edge-tts, one segment per stop
src/pack/             the .deck container and its bake/link/embed policy
src/deck/             our step layer over player.seek(), and the subtitle reader
src/server/           `npm run serve` — routes, queue, the five stages, and the one page
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

MIT.

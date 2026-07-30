# EXPERIMENT-011 — reconciling the server, the page, the type scale and arbitrary canvases

Four agents landed at once: an HTTP server (`src/server/*` minus `ui.ts`), the uploader
page (`src/server/ui.ts`), reference-space type scaling (`src/emit/kit.ts`,
`theme.ts`), and arbitrary canvas sizes (`src/types.ts`, `src/cli.ts`, `src/render/*`).
Each was written against one prose description of the contract; none could run the
others' code. The server and the page in particular had **never been started together** —
the server tested its routes with the pipeline stubbed, the page tested itself against a
mock server, and neither had met the other.

That seam is where the bug was.

---

## 1. The one that would have shipped broken: the page was never served

`npm run serve` starts, answers `200 OK` at `/`, and serves a **5,119-byte stand-in
uploader** instead of the 58,809-byte page the UI workstream built. Both are valid HTML.
Both let you submit a job. From the outside they are both "the server works".

The cause is one import specifier.

```ts
// src/server/ui.ts, as written
import { type DeckTheme, ink, paper, THEME_NAMES, THEMES } from "../emit/themes/index.js";
import { FORMATS, type Format } from "../types.js";
```

`npm run build:server` is `esbuild src/server/*.ts --outdir=dist/server` with **no
`--bundle`**, so it transpiles file by file and every specifier survives verbatim into
`dist/server/`. The library, meanwhile, bundles to a single `dist/index.js` — there is no
`dist/emit/` and no `dist/types.js`. So:

```
$ node -e 'await import("./dist/server/ui.js")'
Cannot find module '/…/dist/emit/themes/index.js' imported from /…/dist/server/ui.js
```

`http.ts` imports the page through a variable specifier inside a `try`, and the `catch`
was empty:

```ts
  } catch {
    // Not built yet, or not written yet. The fallback is the whole product.
  }
```

**Why every gate stayed green.** `tsc` resolves against `src/`, where the path is real.
`vitest` imports from `src/` too. `npm run build` does not build the server at all.
`npm run serve` starts and serves a page. The one thing that distinguishes the two worlds
is the *text of the specifier* at runtime, and nothing looked at it.

Three fixes, because the bug had three enablers:

1. `ui.ts` now imports from `../index.js` — the one specifier that exists in both trees,
   and what every other file in `src/server/` already did. `ink`/`paper` come from
   `resolveTheme("ink")`, which is on the library surface and returns a non-optional
   `DeckTheme`.
2. The `catch` **logs**. A silent catch around an optional import is fine; a silent catch
   that downgrades the product is not.
3. A static gate in `test/server.test.ts` reads the import text of every
   `src/server/*.ts` and fails on any relative specifier that is neither `../index.js`
   nor a sibling `./x.js`. Asserting "`uiPage()` returns a page" would *not* have caught
   this — it passes in both worlds.

**The gate was proved to fail**, not just written. Reintroducing the original specifier
on top of the working one:

```
× the server's imports survive the build > reaches the library only through ../index.js
  → expected [ 'ui.ts -> ../emit/themes/index.js' ] to deeply equal []
```

A gate that has never gone red is a gate nobody has tested.

Before / after, same command, same port:

| | bytes at `/` | `#compose` | format tiles | console errors |
|---|---|---|---|---|
| before | 5,119 | absent | 0 | 0 |
| after | 58,809 | present | 5 | 0 |

Pictures: `experiments/011-reconcile/01-compose-real-ui.png`.

---

## 2. Three files held three different opinions about what a canvas may be

| | min side | max side | other |
|---|---|---|---|
| `src/types.ts` (`canvasProblem`) | 64 | 16384 | aspect ≤ 8:1, whole pixels |
| `src/server/options.ts` | **320** | **2560** | ≤ 4 megapixels |
| `src/server/ui.ts` number inputs | **240** | **7680** | — |

The page therefore offered sizes the server it posts to would refuse. Measured against
the running server, before the fix:

```
UI max (7680x4320)   400  "width must be between 320 and 2560, not 7680."
4K (3840x2160)       400  "width must be between 320 and 2560, not 3840."
UI min (240x240)     400  "width must be between 320 and 2560, not 240."
```

`3840×2160` is the most obvious "big" ask there is, it is well inside the picker's own
stated maximum, and it could not be built.

**Reconciled onto the library's rules plus exactly one server-added number.** Whole
pixels, `MIN_EDGE`, `MAX_EDGE` and `MAX_ASPECT` are `canvasProblem`'s, which derives them
from the layout and from Chrome's texture ceiling. The server adds `MAX_PIXELS`, and only
that, because it is the part the library cannot know: capture holds whole frames of
`w×h×4` bytes on a box every job shares. `catalog()` publishes all of it, and `ui.ts`
interpolates the same constants and re-reads them from `/api/formats`.

### The advertised maximum was unbuildable, and the test caught it

`MAX_SIDE` began as `floor(sqrt(MAX_PIXELS × MAX_ASPECT))` = **5656**, which is the
correct answer to the wrong question. At 5656 wide the aspect limit needs a height ≥ 707
and the pixel limit allows ≤ 707.2 — so 707 is the only legal height, 707 is odd,
`even()` rounds it down to 706 (h264 needs even sides), and `5656/706` is 8.01:1, which
is refused. **The advertised maximum returned 400 at every height.**

Rounding down to a multiple of 16 fixes it by construction: it makes `MAX_SIDE /
MAX_ASPECT` an even integer, so the extreme canvas is exactly 8:1 with both sides even.
`MAX_SIDE` is now **5648**, and 5648×706 = 3.99 megapixels builds. Pinned by a test that
asserts the partner height is even and the product is under the ceiling — an advertised
bound that only ever 400s is exactly the class of bug this reconciliation exists to
delete.

### A resized format no longer lies about its name

`options.ts` built a custom canvas as `{ ...preset, width, height }`, which keeps the
preset's id. A 1080×1350 canvas requested as `short-9x16` came back still calling itself
`short-9x16` — and that id is what the budget gate and every cut explanation quote. It is
now `resizeFormat(preset, w, h)`, which is the constructor `src/types.ts` wrote for this
and which renames it `custom-1080x1350` while keeping the pacing it inherited. The id the
**request** named is still reported separately as `formatId`, because the two answer
different questions.

```
parseOptions({format:"post-1x1", width:1200, height:1200})
  format.id      custom-1200x1200     (was: post-1x1)
  format.maxSeconds  140              (unchanged — inherited from the named profile)
  formatId       post-1x1             (what was asked for)
```

Identity is preserved where it should be: asking for `short-9x16` at 1080×1920 returns
the preset **object itself**, not a copy.

---

## 3. The deck the server serves rendered blank — and it was not the cache

Opening a finished deck at `/d/:id/deck.html`: the player chrome is right, "2 / 12" is
right, the subtitle line is right — and **the slide is empty**. Job `done`, every file a
200, zero console errors.

This shape was seen by the server workstream and attributed to a browser cache poisoned
by an earlier CORS failure ("same bytes on a fresh id render correctly"). It is not the
cache. It reproduces on a fresh job id in a fresh browser, and the cause is structural:

`deck.html` is the HyperFrames player, and the player does not inline the composition —
it loads it into a **child iframe**, `<iframe class="hfp-iframe" src="index.html">`, which
it then drives across the document boundary. It frames that child itself with
`sandbox="allow-scripts allow-same-origin"`, because it needs `contentDocument`.

A CSP `sandbox` directive on a *response* cannot be relaxed by the framer. Serving
`index.html` with `sandbox allow-scripts allow-downloads` therefore put it on a unique
opaque origin no matter what the player asked for:

```
iframe sandbox attribute   "allow-scripts allow-same-origin"   (what the player wants)
CSP on index.html          "sandbox allow-scripts …"           (what it got)
f.contentDocument          null
player state               stuck at "Preparing scene transitions"
```

The subtitles and the slide counter kept working precisely because they are drawn by the
*player's* document, which needs nothing from the composition — which is what made it
look like a rendering bug rather than an origin bug.

**Proven by serving identical bytes twice**, same job id, two servers:

| | `contentDocument` | scenes found | slide 2 |
|---|---|---|---|
| `sandbox allow-scripts allow-downloads` | `null` | 0 | blank (`06-served-deck-slide2.png`) |
| sandbox off | reachable | 12 | correct (`07-nosandbox-slide2.png`) |
| `… allow-scripts allow-same-origin …` | reachable | 12 | correct (`08-sandbox-fixed-slide2.png`) |

`allow-same-origin` is now in the directive, and a test asserts it is there *and* that
`allow-forms`, `allow-popups`, `allow-modals` and `allow-top-navigation` are still
withheld — those are the tokens that still buy something.

**And the font CORS header came back out.** `Access-Control-Allow-Origin: *` on woff2 was
added because `@font-face` from an *opaque* origin is a CORS fetch. The origin is no
longer opaque, so the header bought nothing except letting any cross-origin page holding
a job id read those bytes. Removed, and verified rather than assumed: slide 3's five
KaTeX nodes still report `KaTeX_Main`, `KaTeX_Math italic` and `KaTeX_Size3` **loaded**,
and the equation renders in the real faces (`09-equations.png`).

**What was traded.** The deck now runs *as* the server's origin, so it could fetch
`/api/jobs/<id>` for an id it already knows. One host cannot both satisfy the player's
same-origin requirement and deny it; real isolation is `/d/:id` on a **separate origin**,
which is a second listener and is not built. Said in the README rather than faked here.

---

## 4. The page threw away the server's hints

Every refusal from `/api/jobs` is `{message, hint}`, and the hint is the half that says
what to do. `submit()` threw a bare `Error` carrying only the message, then attached a
fixed hint of its own:

```js
hint: "Check that the DeckSmith server is running and reachable, then try again."
```

For a 400 that hint is not merely useless, it is **wrong** — the server had just
answered, in detail. The hint now travels on the error and that sentence is kept only for
the case it actually describes: `fetch` itself rejecting, so nothing answered.

Confirmed against the real server: a Codex validation failure now renders its own hint,
"The planner answered with a storyboard that does not fit the schema — a beat came back
half-filled. This is usually one bad roll of the dice; submit the same document again."
(`experiments/011-reconcile/03-error-plan-invalid.png`).

---

## 5. Rejected uploads were charged to the hourly job budget

`submit()` took the `jobsPerHour` token as its *first* statement, before reading the
body. So five 400s — five mistyped canvas sizes, five wrong file types — exhausted an
address's budget for the hour without a single job ever starting. Observed while probing
the canvas bounds above: the sixth and seventh probes came back

```
429  "That address has already submitted 5 decks this hour."
```

having submitted zero decks. The token is now taken after parsing and immediately before
`queue.submit`. Nothing expensive happens before that point, and request volume is
already bounded by the per-minute limiter.

---

## 6. Smaller seams

**`queuePosition` was sent and never shown.** The server computes it for exactly the
moment when the step list is entirely "pending" and a wait behind other papers is
indistinguishable from a hang. The run view now reads it: "Queued · 2 jobs ahead".
`queuePosition` is 1 for the first *waiting* job and absent for a running one, so the
number is exactly how many jobs are ahead.

**`subtitles: "auto"` in the pipeline.** `auto` used to mean "burn on a vertical canvas";
the sizing workstream made it resolve to sidecar and kept it only as a spelling for
existing scripts. The pipeline now names `"sidecar"`, so the day `auto` is deleted this
keeps working.

**The sidecar warning fired on every video.** "captions travel as a sidecar .srt, not
burned in" is noise on a deck or a long-form video, where a sidecar is right and needs no
announcement. It now fires only for `short-9x16` and `post-1x1`, where a feed platform
discards an uploaded `.srt` and the API has no field to ask for burning — there it is the
difference between captioned and not, and it names the command that fixes it.

---

## 7. Every change to 16:9 output, accounted for

16:9 is what ships today, so this is the part that had to be proved rather than argued.

**Nothing this pass touched can reach it.** The five files changed here are
`src/server/{ui,http,options,pipeline}.ts` and `test/server.test.ts`. The server is not in
the import graph of the CLI or the library — verified against the built bundles rather
than asserted:

```
                   dist/cli.js   dist/index.js
  queuePosition        0              0
  maxUploadBytes       0              0
  sandboxDecks         0              0
  parseMultipart       0              0
  uiPage               0              0
  jobsPerHour          0              0
```

**The type-scale workstream's 16:9 claim re-verified independently.** Its whole safety
argument is that `referenceSpaceCss` is emitted *only* when zoom ≠ 1, so a 1920×1080 deck
is untouched. Read off freshly built decks:

```
  deck-16x9/index.html    zoom: 0 occurrences   .scene:has(.scene): 0 occurrences
  video-16x9/index.html   zoom: 0 occurrences   .scene:has(.scene): 0 occurrences
```

**The deck invariants, on the built 16:9 artifact:** invariant 7 (`deck.html` contains no
`data-composition-id`) — 0 occurrences. Invariant 10 (times to 3 decimals) — no literal
with 4+ decimals. Invariant 4 (`Date.now`/`Math.random` in `index.html`) — 0 and 0.

**Determinism unchanged.** `drift --identical` on the image-free fixture:
**210/210 frames byte-identical**.

---

## 8. Gates

Verbatim, on the reconciled tree:

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx biome check .
Checked 85 files in 99ms. No fixes applied.
Found 1 info.                       # biome.json's own deprecated `recommended` key

$ npx vitest run
Test Files  26 passed (26)
     Tests  763 passed (763)         # was 755; +8 here

$ npm run build
dist/cli.js 266.9kb · dist/index.js 249.8kb · dist/deck-runtime.js 9.9kb · dist/types/index.d.ts

$ node dist/cli.js build demo/storyboard.json --source demo/source.json -o …
build: 12 beats at 1920×1080 in ink
PASS — 0 error(s), 1 warning(s)      # connector_detached, pre-existing

$ node dist/cli.js build … --format video-16x9 -o …
PASS — 0 error(s), 1 warning(s)

$ npx hyperframes check .            # on the built deck-16x9 directory
  0 error(s), 1 warning(s), 0 info(s)
Motion    ◇ 0 errors, 0 warnings
Contrast  ◇ 59/59 text checks pass WCAG AA
◇  Check passed

$ node dist/cli.js drift …/plain --identical
  info  drift  stable  210 frames, all byte-identical across two renders.
PASS — 0 error(s), 0 warning(s)
drift: 210/210 frames byte-identical
```

---

## 9. The end-to-end run, which is the point

`edge-tts` was missing on the box the server workstream used, so `narrate` and `render`
had **never executed through the server** — every hint and every result field on those
two paths was unexercised outside unit tests. It is installed here, and a real job was
driven from the real page in a real browser:

```
paper.zip (44 KB, 2 files) → deck-16x9 + narration + video

ingest    38ms    6 sections, 1 figure, 5 equations, 1 table
plan     1m 9s    12 beats
narrate  44.1s    12 of 12 beats speak
build     123ms   12 beats at 1920×1080
pack              938 KB → deck.deck
render   ~5m      6075 frames
```

Everything served, with the right types:

```
200  deck.html    text/html; charset=utf-8    25,317
200  index.html   text/html; charset=utf-8    61,444
200  video.mp4    video/mp4               36,974,620
200  video.srt    text/plain; charset=utf-8    3,572
200  deck.deck    application/zip            960,784
```

**The video is real, and not frozen — which is the one thing invariant 11 says no green
gate can tell you.** `ffprobe`: 1920×1080, 30fps, 6075 frames, 202.5s, AAC stereo of the
same length. Ten frames sampled 20s apart are ten distinct images (sha256 of each PNG,
all different); a callback-driven composition would have produced ten identical ones.
Contact sheet: `experiments/011-reconcile/10-video-contact-sheet.png` — bar charts with
their values, the router pipeline, and the KaTeX term walk, all drawn.

The `.srt` carries real timed cues:

```
1
00:00:01,950 --> 00:00:05,123
The context window becomes
an engineering budget
```

The first attempt failed at `plan` — Codex returned `beats.2.params.bars: Too small:
expected array to have >=2 items` — which is the same nondeterministic planner failure
the server workstream hit, and it exercised the error view and the retry button against
the real server for the first time.

---

## Still open

- **`unknown_canvas` on every custom build.** `verify`'s budget gate resolves a profile
  from *pixels* (`profilesFor`), so a canvas no preset declares gets
  `warning budget unknown_canvas`. The message is true and the direction is safe, but it
  is routine on custom canvases. The fix is for the composition to record the format it
  declares — `timing.json` already carries width/height and could carry `id` and
  `maxSeconds` — and it would change 16:9 output bytes, so it was **not** done in a pass
  whose job was to keep 16:9 identical. Unchanged by this pass either way: the old code
  produced the identical warning.
- **No CSRF token, no auth, no TLS.** See the README's "What is missing before this is
  public". `POST /api/jobs` is a CORS-simple request; this is the item to fix first.
- **SSE tested only via the fallback and via `fetch`.** The live run above used SSE
  successfully, but the 20-second heartbeat and a proxy that buffers the stream are still
  untested.
- **Zip symlink entries** reasoned safe (fflate yields bytes, the server calls
  `writeFile`, nothing calls `symlink`) but not tested with a real symlink archive.
- **Chromium only.** The page leans on `:has()` throughout; Safari and Firefox unchecked.
- **`narrate` and `build` must be given the same canvas** and nothing enforces it. A
  mismatch changes the stop count and puts sentences on reveals that are not there. The
  server always passes one format to both, so the server is safe; the CLI is not.
- **No rendered-glyph-size gate.** `canvasWarnings` is the only thing that will ever say
  a canvas is too small, and it is a warning. A 500×281 deck that happens to lay out
  ships unreadable and PASSes.

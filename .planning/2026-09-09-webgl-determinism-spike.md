# The WebGL determinism spike

Gap 2's deferred half, measured on 2026-09-09 against `main` at `b51bd2b`,
DeckSmith 0.4.0, hyperframes 0.8.27, on one Apple M4 running macOS 25.3.0.

The question the spike exists to answer: can a three.js cell ship as a `mesh`
leaf archetype, or must Gap 2's second half be refused in favour of
plan-time-rendered video? The determinism answer is **yes, on this machine, with
two conditions**. But the spike also found something it was not looking for, and
that finding is the reason to read past the summary: **the two tools a person
would reach for to check a WebGL deck by eye are both blind to it.** They return
a clean, plausible, completely empty frame.

Every number below was taken in this session. Nothing is quoted from an earlier
document, including the figures that earlier documents attribute to this same
fixture.

## What the arms are

`demo/fixtures/plain.storyboard.json`, built four times with `--no-narration`
passed explicitly, then injected into after the build (the css3d-recheck
method — the spike measures the mechanism, not an emitter).

| arm | what it adds to the built deck |
| --- | --- |
| A | nothing. The control, re-measured here. |
| B | an inert `<canvas>` that draws nothing. |
| C | the full-frame WebGL cell drawing ONE static frame, no tween. |
| D | the same cell, animated by a GSAP plugin's `render(ratio, data)`. |

The deck is 7.000 s, 2 scenes (`s1` 0–3, `s2` 3–7), 210 frames at 30 fps —
read out of the built `timing.json`, not assumed. The cell's tween spans
`s1`-local 0.300–2.700 s.

The canvas is the full 1920x1080 frame. This is not optional: a rasterizer flip
measures ~54 dB on a 480x360 canvas and ~43 dB full-frame, so a toy canvas sizes
the risk wrong. The cell is an indexed icosahedron under `MeshNormalMaterial`
plus a wireframe shell, with a camera dolly — no lights, no textures, no RNG,
and no text inside the canvas.

It satisfies the invariants it can: every tween is `fromTo()` (2), the selector
is scoped `#s1 canvas` (3), three.js is a local vendor file and nothing is
fetched at render time (4), times are 3-decimal (10), and **there is no callback
anywhere** — the plugin's `render()` is the entire animation surface (11).

---

## Question Zero — what "the capture path" actually is on this machine

This started as a contradiction to resolve and ended as the most consequential
finding in the spike.

`node_modules/hyperframes/dist/cli.js` has **three** fields named `captureMode`,
with three different jobs:

| site | expression | value here |
| --- | --- | --- |
| `cli.js:68696` `preMode` | `headlessShell && isLinux && !forceScreenshot && …` | `screenshot` |
| `cli.js:134034` `buildLockedRenderConfig` | `forceScreenshot ? "screenshot" : "beginframe"` — no platform test | `beginframe` |
| `cli.js:129878` `resolveObservedCaptureMode` | `forceScreenshot \|\| platform !== "linux" ? "screenshot" : "beginframe"` | `screenshot` |

The second is a **declared lock**, platform-independent by construction because
it flows into `planHash`. It is almost certainly the `"captureMode":"beginframe"`
an earlier session read out of a render trace and generalised from.

Then the render was actually run, without `--quiet`, with stderr captured
(`cli.js:65718` prints this on every launch):

```
[BrowserManager] Browser launched (HeadlessChrome/152.0.7977.30, screenshot,
  gl=--use-gl=angle --use-angle=metal, headlessShell=true, platform=darwin)
```

and its own trace reports a **fourth** value that appears in none of the three
static sites:

```
"phase":"capture_streaming","captureMode":"drawelement","captureOperation":"drawElement"
```

`beginframe` appears **zero** times in the whole render log.

So on this Mac, at 0.8.27: the browser is launched in `screenshot` mode, then
`cli.js:68645` switches the live session to `drawelement` after injecting a
capture canvas. `resolveDrawElementCaptureMode` (`cli.js:66504`) picks
`drawelement` for everything except SwiftShader, which gets `screenshot`. In the
`drawelement` branch a `HeadlessExperimental.beginFrame` is sent **only when
`session.beginFrameTimeTicks > 0`**, and hyperframes' own comment at
`cli.js:70009` says that is not the macOS path:

> Paint-event sync only without BeginFrame (macOS / screenshot-launched)

Two consequences that matter beyond this spike.

**First, invariant 11's stated mechanism is wrong, and the real one is simpler
and stronger.** The invariant says callbacks animate in the render "because
capture is driven by Chrome's `beginFrame` rather than by a seek, and
`suppressEvents` is a property of a seek." On this machine capture is *not*
driven by `beginFrame`. Callbacks fire for a much more direct reason: the
renderer's frame-capture seek passes **no options at all** —
`cli.js:69484`, inside `prepareFrameForCapture`, is literally
`window.__hf.seek(t2)` — and the runtime's GSAP adapter seeks with
`suppressEvents=false`, which I read out of the extracted `RUNTIME_IIFE` as
`.seek(y,!1)` and `.seek(fe,!1)`. hyperframes says so itself in its lint text at
`cli.js:83995`. The only two `suppressEvents: true` seeks in the bundle
(`cli.js:69774`, `:70367`) are the static-dedup verifier and the drawElement
self-verify — probe paths, not capture.

That also explains the three-way disagreement AGENTS.md documents, without
needing `beginFrame` at all: `decksmith frames` freezes a callback-painted band
because `src/render/capture.ts:92` passes `suppressEvents: true`; `snapshot` and
the render both animate it because neither does.

**The invariant itself is untouched.** Its cost — reproducibility, by frame
count — is measured and is the real reason. Only the sentence explaining the
mechanism was wrong.

**Second, macOS renders without the determinism flags.** `buildChromeArgs`
(`cli.js:65803`) appends `--deterministic-mode`, `--disable-threaded-animation`,
`--disable-checker-imaging`, `--run-all-compositor-stages-before-draw` and five
more **only when `captureMode !== "screenshot"`**. Every number in this document
was therefore taken *without* them. A Linux/`beginframe` render is plausibly
more deterministic than what is measured here — that is an argument, not a
measurement, and this spike cannot make it.

---

## Question 1 — input purity. Does the cell get identical state at t?

**Instrument, and why it is not a readback.** A WebGL canvas has no 2D context,
so the `getImageData` trap that mutates the page it measures (Chrome drops a 2D
canvas from GPU to CPU raster after exactly two readbacks, and the two
rasterizers antialias differently) cannot recur literally. Its analogue is
worse: `gl.readPixels` forces a pipeline flush, and at the default
`preserveDrawingBuffer: false` it reads a buffer the compositor has already
discarded — so making the probe work at all would mean changing the pipeline
under measurement. That is the same error as the raster flip, reached by a
different road.

So purity is proven at the **input**: patch
`WebGL{,2}RenderingContext.prototype` before three.js loads and fingerprint what
the cell actually draws. This touches no framebuffer and cannot perturb what it
measures.

Six paths — forward `0→2→4`, reverse `4→2→0`, and fresh-page direct seek, each
with `suppressEvents` false (the renderer's shape) and true (the `frames`
shape) — at t ∈ {0.5, 1.5, 2.5}.

**The raw call-stream hash FAILED, and the plan predicted exactly why.** Two
distinct hashes at every t: 8 calls on a warmed page, 18 on a fresh one. The
plan named this in advance as a non-failure to watch for, because three.js
caches uniform state and skips redundant uploads.

Rather than accept that as the explanation, I diffed the two streams
(`01c-streamdiff.mjs`). The real cause is more specific and it is not the cache:

- the **fresh** page performs **three complete draw passes** for one seek —
  GSAP's `fromTo` renders its `_startAt`, then the main tween inits and renders,
  then the seek renders;
- the **warm** page performs **one**;
- **every distinct call is present in both** (`only in fresh: ∅`,
  `only in warm: ∅`), and the fresh stream's final 8 calls are byte-identical to
  the warm stream's 8.

Only the last pass reaches the screen. The fingerprint was counting GSAP's
first-render bookkeeping.

**On the instrument the plan named as the fallback, Q1 PASSES cleanly.** Hashing
the *resolved* GPU input after `render()` — projection matrix, view matrix, both
world matrices, and the tween parameter, each printed to 17 significant digits —
plus every uniform payload actually handed to the driver, keyed by value:

| t | paths | distinct resolved-state hashes | distinct upload-value hashes | p |
| --- | --- | --- | --- | --- |
| 0.5 | 6 | **1** | **1** | `8.33333333333333426e-2` |
| 1.5 | 6 | **1** | **1** | `5.00000000000000000e-1` |
| 2.5 | 6 | **1** | **1** | `9.16666666666666741e-1` |

Bit-identical across every seek path, every history, and both `suppressEvents`
values. And the values are the closed form: `(t − 0.300) / 2.400`.

**VERDICT: PASS.** Seek path, seek history and `suppressEvents` do not move the
cell's input by one bit.

---

## Question 2 — raster identity, and the ANGLE backend

**Instrument:** CDP `Page.captureScreenshot` clipped to the canvas's own
bounding box, which is the full frame. Never `getImageData`, never
`gl.readPixels`. Eight repeats with no redraw between, in each of three fresh
browser launches run strictly one at a time, on hyperframes' own shell
(152.0.7977.30 — the binary the render actually used, not a Chrome for Testing
build). `WEBGL_debug_renderer_info` is read once per launch as a *string*, which
answers the backend question without touching a framebuffer.

| backend | UNMASKED_RENDERER | same-launch distinct (×3) | cross-launch distinct | verdict |
| --- | --- | --- | --- | --- |
| `--use-angle=metal` | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)` | 1, 1, 1 | **1** | PASS |
| `--use-angle=swiftshader` | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)` | 1, 1, 1 | **1** | PASS |

24 captures per t per backend, one sha256 each. No shader-precision drift within
a launch, no driver-selection drift across launches.

**But the two backends do not agree with each other, and the gap lands on the
wrong side of this project's floor.** Same deck, same t, full frame:

| t | metal vs swiftshader |
| --- | --- |
| 0.5 | **39.74 dB** |
| 1.5 | **39.98 dB** |
| 2.5 | 41.82 dB |

The floor is 40 dB. Two of three are below it. A backend flip between two
renders is a gate failure, not a rounding difference.

This is live, not hypothetical. `getBrowserGpuArgs("software")` returns
swiftshader, `buildLockedRenderConfig` hardcodes `browserGpuMode: "software"` —
and the render on this machine nevertheless launched with
`--use-angle=metal`. Those are different fields with different jobs, and a
`mesh` archetype cannot assume the locked literal describes the browser that ran.

**VERDICT: PASS within a backend. The archetype must pin `browserGpuMode`.**

---

## Question 3 — reproducibility at the shipping gate, four arms

`decksmith drift <dir> --identical --keep`, run sequentially, on each arm. The
plain fixture is the only deck here with a binary signal — `--identical` holds
only for an image-free deck whose text is never scaled, and this deck exists for
that mode alone.

| arm | result | dedup skip reason | capture phase | wall |
| --- | --- | --- | --- | --- |
| A control | **210/210 byte-identical** | `eligible` | 4678 ms | 7.27 s |
| B inert canvas | **210/210 byte-identical** | `canvas/webgl` | 4462 ms | 6.50 s |
| C static WebGL | **210/210 byte-identical** | `canvas/webgl` | 8785 ms | 10.85 s |
| D animated WebGL | **210/210 byte-identical** | `canvas/webgl` | 8844 ms | 10.91 s |

drift's own motion instrument on arm D: *"210 frames, all byte-identical across
two renders at different worker counts. All 2 measurable scene(s) moved within
their own window."*

**Arm B earned its place, and then disarmed its own worry.** A canvas does
disable static-frame dedup for the whole render — arm A's reason is `eligible`,
arms B/C/D's is `canvas/webgl`, exactly as `cli.js:69647` says. But arm A's
`staticFrameSet` was **empty**: every frame of this deck is animated, so dedup
was contributing nothing to begin with, and losing it costs nothing.
`armA.mp4` and `armB.mp4` are byte-identical (`sha256 7d22a3e9088d0459…`).
Without arm B this would have been an unattributable confound; with it, it is a
non-event on this fixture. On a deck with genuine static stretches it would not
be.

**VERDICT: PASS.** Arm D matches arm B's verdict exactly. WebGL costs nothing
that losing dedup did not already cost — and on this deck, dedup was worth zero.

---

## Question 4 — look at the artifact

Because a WebGL canvas that captures **black** produces two byte-identical
renders and a perfect A/B score, and every gate above would call that a pass.

**The render is correct.** Arm D rendered to mp4 and inspected as a 6-frame
contact sheet across the tween: the mesh rotates, the camera dollies in, the
wireframe shell counter-rotates, the DOM caption composites above the canvas
throughout, and the scene crossfades to `s2` at the end. Frames 15 and 45 of the
kept drift output differ by **12.14 dB** — that is motion, not a still.

The predicted black-frame failure **did not occur**, and it did not occur at
`preserveDrawingBuffer: false`. That answers an open question the plan raised:
**the archetype does not need `preserveDrawingBuffer: true`**, neither for
`Page.captureScreenshot` nor for the shipping `drawelement` path. Both composite
the canvas rather than reading its drawing buffer.

### The thing the spike was not looking for

`decksmith frames` on arm D, at the same times, returns a frame with the
**canvas completely empty**. The type is there, the rule is there, the
background is right — and there is no mesh at all. It does not error. It does
not warn. It looks exactly like a deck whose canvas legitimately has nothing
in it.

This is not invariant 11 recurring. The cell has no callback: its plugin's
`render()` fires perfectly well under `suppressEvents: true`, which is precisely
why the archetype was built that way.

I guessed the cause was the missing GL launch flags — `src/render/capture.ts:140`
launches with only `--force-device-scale-factor=1 --hide-scrollbars`, none of the
renderer's `--use-gl=angle` / `--enable-webgl` / `--ignore-gpu-blocklist`. **That
guess was wrong**, and testing it rather than believing it is what found the real
answer. Under hyperframes' shell 152, those two bare flags still yield a working
WebGL context. The variable is the **binary**:

| browser | launch args | WebGL context | cell drew | captured PNG |
| --- | --- | --- | --- | --- |
| hyperframes shell 152.0.7977.30 | the `frames` two | yes (SwiftShader) | yes | 165,641 B — mesh |
| **CfT headless-shell 145.0.7632.46** | **the `frames` two** | **NO CONTEXT** | **no** | **51,099 B — blank** |
| CfT 145 | + `--enable-unsafe-swiftshader` | yes (SwiftShader) | yes | mesh |
| CfT 145 | + `--use-gl=angle --use-angle=metal` | yes (Metal) | yes | mesh |

51,099 B is byte-for-byte the size `decksmith frames` produced. `three.js` itself
loads fine in every row (`threeLoaded: true`); it is `getContext("webgl2")`
returning null. Chrome 145's headless shell refuses a context without a GL flag;
152 still grants one.

`chromePath()` resolves `~/.cache/puppeteer` — a Chrome for Testing 145 — while
the renderer uses `~/.cache/hyperframes`' shell 152. The comment above that
resolution says *"for a screenshot of a static page the two render identically."*
For a WebGL page on this machine they do not.

**And `frames` is not the only caller.** `src/verify/fidelity.ts:526` opens the
deck through the same `openDeck`. The **build gate** would score a `mesh` deck's
frames with the mesh missing — an ink measurement, an apparent-size check and an
overlap check, all taken on a frame the renderer will never produce, all green.

That is a seventh case of the pattern AGENTS.md exists to warn about, and it was
caught the same way as the other six: by opening the PNG.

---

## Costs

Measured, not modelled, all on the 210-frame fixture at `--workers 1`:

| | arm A | arm D | ratio |
| --- | --- | --- | --- |
| capture phase | 4678 ms | 8844 ms | **1.89×** |
| wall clock | 7.27 s | 10.91 s | 1.50× |

Arm C (static mesh, no tween) costs 8785 ms — within noise of arm D. **The cost
is the WebGL context and its compositing, not the animation.** Gap 2's
plan-time estimate for WebGL was ~3.3×; the measured capture cost here is 1.89×,
and dedup loss is not on top of it on this deck because dedup was already worth
nothing.

Bundle, against a re-measured `gsap.min.js` of **72,779 B**:

| bundle | minified | gzipped | × gsap |
| --- | --- | --- | --- |
| three 0.186.0, whole | 743,012 B | 189,708 B | 10.2× |
| tree-shaken to this cell's imports | **537,253 B** | **134,710 B** | **7.4×** |

The tree-shaken build was verified to render **byte-identical pixels**
(`sha256 c4cb3c8c55abb7f3…`) and to pass Q2 at all three t, so 537 KB is a
working number and not a hopeful one. three 0.186.0 ships no minified build, so
both figures are esbuild's.

Invariant 4 forbids fetching at render time, so this inlines into every deck
that uses a mesh. Whether 537 KB is acceptable is a product decision this spike
informs and does not make.

---

## The decision this unblocks

**GO on determinism, on this machine, with two conditions and one repair.**

Nothing in the capture path, the seek path, the seek history or `suppressEvents`
moved a WebGL cell by one bit. The shipping gate says 210/210 byte-identical
with an animated full-frame mesh, and the artifact confirms the gate is looking
at real motion rather than a black rectangle.

Conditions:

1. **Pin `browserGpuMode`.** Metal and SwiftShader differ by 39.74–41.82 dB
   full-frame, below the 40 dB floor at two of three sampled times. Whichever is
   chosen, both renders of a `drift` pair must use it.
2. **Forbid text inside the canvas, in the archetype, not by convention.**
   Apparent-size (invariant 5), `svg_text_overprint` and `content_overlap` all
   measure the DOM. A glyph inside the canvas is invisible to all three. This is
   a design constraint the spike confirms rather than one it measured.

The repair, and it is not optional if a `mesh` archetype ships:

3. **`src/render/capture.ts:140` must launch with the renderer's GL flags** —
   at minimum `--enable-unsafe-swiftshader`, better the `--use-gl=angle` pair
   that `getBrowserGpuArgs` returns for the pinned mode — and `chromePath()`'s
   assumption that any headless shell renders identically needs to stop being
   true only for DOM. Until then `frames` and `fidelity` are silently blind to
   the one archetype that most needs a human to look at it.

`drift` alone could not have been the gate here, exactly as expected: it renders
one deck twice at the same installed pin, and two black canvases agree perfectly.

## NOT MEASURED

Stated as gaps rather than reasoned into numbers.

- **Linux, and therefore `beginframe` capture.** Q0's finding is that this Mac
  captures by `drawelement` with paint-event sync and no `beginFrame` at all,
  and without the nine determinism flags. Everything in Q2 and Q3 is macOS-only
  until someone runs it on a headless shell on Linux.
- **A real emitter.** Arms C and D were injected into a built deck. The spike
  measures the mechanism; an archetype that generates this markup is not the
  same artifact.
- **Any deck with genuine static stretches.** Arm A's static-frame set was
  empty, so the dedup that a canvas disables was worth zero here. On a deck where
  it is worth something, `canvas/webgl` is a real cost that this fixture cannot
  show.
- **The demo deck.** Not run — the plain fixture gives a binary signal at 210
  frames where the demo gives a dB number at thousands.
- **Hardware variation.** One machine, one M4, one macOS. And two Chrome
  majors that this spike has just shown are not interchangeable.
- **Whether `frames`' blindness predates WebGL.** It was found with a mesh; no
  attempt was made to see what else it might be missing.
- **`hyperframes snapshot` and the player.** Two of the four disagreeing views
  AGENTS.md names. Neither was pointed at this cell.

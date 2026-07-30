# Experiment 006 — a diagrammatic vocabulary, and a determinism guarantee that was never true

**Date** 2026-07-27 · Twelve archetypes, ~3,200 → ~6,600 lines of `src`, 342 tests.

## Why

> "i hate text only slides. always make slides rich with proper images and vector graphic
> animations explaining the content of the slide as much as possible. making the fucking
> naive slide is all the others doing."

Correct, and the criticism lands on this project specifically. `INITIAL_DESIGN.md` §"Paper
→ presentation research systems" says the opening is that existing tools *"place the
paper's existing figures — none redraws the method as motion."* The v0 vocabulary then
shipped title, callout, data-table and claim-figure: text, and a source image parked
beside a sentence. Exactly the crowded space the design identified and then walked into.

## What was added

A shared SVG primitive layer (`src/emit/svg.ts`) and six archetypes that generate vector
graphics from the source's own content and reveal them stage by stage:

| archetype | draws | the tell |
|---|---|---|
| `pipeline` | boxes, arrows, an optional feedback elbow | a method or process |
| `annotated-figure` | the real figure with leader lines revealed in turn | any figure worth explaining |
| `grid` | a cell field with regions lit in turn | windows, patches, tokens, receptive fields |
| `bar-compare` | bars grown from zero, values counting in | a magnitude comparison |
| `stack` | offset planes receding up-right | layered architectures |
| `split-compare` | two panels, labelled divider, sequential reveal | before/after, ours/theirs |

The primitive layer matters more than any one of them: it puts **text measurement in one
place**. The line chart previously shipped 3.6px from clipping because every emitter
guessed its own em-factor.

The planner is now visual-first, and `verify` carries a `text_heavy_deck` gate that names
each text-only beat *and what it might have drawn instead*:

> Only 2 of 5 beats draw anything; the rest are text. b1 (title: past the opening frame a
> divider draws nothing — cut it, or draw what it announces); b3 (data-table: bar-compare,
> if the numbers share a unit); b4 (callout: pipeline if it names steps, stack if it names
> layers, split-compare if it contrasts two things, grid if it is about regions of a field).

The complaint is now enforced mechanically rather than left to a prompt's good intentions.

## Two capabilities added after looking at the output

**`pipeline.loop.from`.** The schema could only loop from the *last* stage, so a recurrent
block in the middle of a pipeline drew a tick leaving the final stage — a claim the method
does not make. A mid-pipeline loop is the most common thing this archetype will be asked
to draw.

**`annotated-figure.crop`.** Every source figure was unreadable. Papers set figures for A4
at reading distance, which lands their internal type near 12px on a 1920 canvas — invisible
from the back of a room, and invisible to every gate too, because it is pixels in a raster
rather than DOM the contrast gate can measure. `crop` shows one panel at the plate's size,
scaled up and clipped; notes stay in whole-figure coordinates and the emitter maps them.
Verified: the cropped panel's own labels ("DQ-CTM", "Window Partitioning", "Pixel-wise
Dense Token Field") became legible, and all three annotations landed on the right elements.

## The finding that matters most: our determinism guarantee was never tested on images

Byte-identical renders have been this project's strongest regression test since
EXPERIMENT-001. Checking it after this work:

```
image-free deck   d0f06888…  d0f06888…              identical
deck with figures 89fe6c81…  869cf880…              DIFFER
```

Then the decisive control — the twelve-archetype deck built *before* any of these changes,
re-rendered now:

```
628c49d8…  3f1d073a…   DIFFER
```

So this is **not a regression**. Every byte-identical result ever celebrated here was on a
deck with no raster images: the ThinkSR fixture ingested "0 figures", and the earlier
matching pair on a figure deck was luck. **Decks containing images have never been
deterministic, and we never noticed because we never tested one twice.**

Cause: the engine honours `window.__renderReady`, and our compositions never set it, so
capture can begin while a figure is still decoding. Compositions containing images now
gate on `img.decode()`.

**This narrows the window but does not close it.** Four renders after the fix still
produced different files. A `requestAnimationFrame` barrier on top made it strictly worse —
which is the clue worth writing down: capture is driven by Chrome's `beginFrame`, not the
rAF loop, so rAF is the wrong clock to wait on. Do not re-add it.

Standing as of now:

- image-free decks: **deterministic**, and the golden-hash test is valid for them
- decks with figures: **not deterministic**, cause partly identified, not fixed

That is the top open item. Until it is closed, no one should claim a byte-identical render
for a deck containing a figure — and the drift-check CI job should use an image-free
fixture, or it will produce false alarms every week.

## Six defects found by looking, fixed

From the visual proof pass, all of which passed lint, layout, motion and contrast:

1. `stack` measured a note's y from the wrong origin: it sat 26px under its own label and
   18px over the *next* one, so proximity grouped it with the wrong layer.
2. `grid` printed two overlapping regions' labels on top of each other — on the shifted-
   window slide, over the very thing the slide exists to show.
3. **A stray dot on five archetypes.** GSAP writes `strokeDashoffset` back as an integer,
   so a leader of length 720.21 rested at 720 and left 0.21px of dash exposed, which
   `stroke-linecap: round` paints as a full 3px dot. Measured in the DOM, not guessed.
4. `annotated-figure` stacked labels 15px apart while lines *within* one label were 52px
   apart, so a stack read as one paragraph.
5. `equation-walk`'s legend had a ragged left edge — each row was centred individually.
6. `line-chart` printed its y-axis name through the topmost tick label.

## Known, not fixed

- **Determinism for image decks** (above). Top of the list.
- `grid`'s label gutter floors at 220px, so a 42px label wraps while ~350px sits unused.
- `split-compare` mirrors its column headings while their bodies are left-aligned; it
  reads as an orphan. Should be left-aligned both sides.
- `line-chart` spaces categorical x evenly, which flattens the very curve shape a
  diminishing-returns slide claims.
- Sid-scoping the ambient rules still defeats the shell's CSS dedup, so shared archetype
  CSS repeats per scene.

## Addendum — the image-deck nondeterminism is not a readiness race (2026-07-27)

The open item at the end of this file assumed capture was starting before the
figures had decoded. It is not. Measured on the twelve-beat demo, `--no-browser-gpu`,
four full renders of 7395 frames each:

| render | flag | sha256 (head) |
|---|---|---|
| img_a | `__hfTimelinesBuilding` | `4c97a3a3` |
| img_b | `__hfTimelinesBuilding` | `7790f44a` |
| nf_a  | none (old `__renderReady` gate) | `7790f44a` |
| nf_b  | none | `fb8b8aa6` |

Three distinct outcomes across four renders, and **a no-flag render came out
byte-identical to a with-flag one** — so the readiness handshake is orthogonal to
the result. Both variants differ in the same place:

* with flag: **428 / 7395** frames, runs `1540-1740` and `3014-3240`
* without:   **426 / 7395** frames, runs `1540-1740` and `3016-3240`

Those map to `s3` (annotated-figure, the only raster crop) and `s5`
(equation-walk, KaTeX). Frame 1600 and frame 3100 diff at **PSNR 57.2 dB** and
**58.3 dB** — a scatter of single pixels along one horizontal band. No blank
plate, no layout shift, no missing content. The catastrophic failure this file
describes was real; what is left is sub-pixel rasterisation noise.

Two things follow.

**The old gate could never have worked.** `window.__renderReady` is owned by the
engine — its check ends in `window.__renderReady = true` the moment it has
discovered every timeline, and our scenes register theirs during parse, so the
gate was overwritten before it ran. `__hfTimelinesBuilding` +
`hf-timelines-built` is the engine's real protocol for "not yet"
(`hyperframe-runtime.js`). It is now used, and it changes nothing today; it is
kept because it replaces something inert with something that would work if a
figure ever did decode slowly.

**The next hypothesis is worker sharding, not readiness.** `render` splits frames
across Chrome processes (`-w/--workers`, default `auto`), the two differing runs
are contiguous the way a shard boundary is, and EXPERIMENT-007's R3F spike
separately measured 1-worker against 4-worker renders of identical input
differing by ±1 subpixel on 85 frames. **Test `--workers 1` twice before
anything else.** If that is byte-identical, the drift-check CI pins workers and
this closes; if not, the cause is inside a single rasteriser and the honest
policy is to compare renders by PSNR rather than by hash.

Unchanged: the drift-check gate must run on an image-free fixture until one of
those two lands.

### Where it actually comes from, and why the guarantee has to change

Five hypotheses, four refuted by measurement, and the original diagnosis in this
file was wrong. Recorded so nobody repeats the sequence.

| # | hypothesis | test | result |
|---|---|---|---|
| 1 | capture starts before figures decode | `__hfTimelinesBuilding` handshake vs control | **refuted** — a no-flag render came out byte-identical to a with-flag one |
| 2 | frames are sharded across Chrome processes | `--workers 1` twice (`auto` is 2 here) | **refuted** — same two runs, 447/7395 |
| 3 | x264 makes different decisions per run | `--format png-sequence` twice | **refuted** — raw frames differ before any encoder runs |
| 4 | KaTeX CSS + fonts fetched from the CDN at capture | vendor them, re-render | **real bug, partial fix** — 5 → 3 frames |
| 5 | fonts resolve asynchronously even when local | `document.fonts.ready` in the barrier | **not fixed** — 3 → 9 frames (single samples; the count and the indices both move run to run) |

**The failing pixel is one glyph.** Every visible difference is the caligraphic
`W` of `\mathcal{W}` in the carrier equation — the only glyph in the deck that
needs KaTeX_Caligraphic, and one the equation-walk archetype tweens. The first
difference mask showed a solid glyph (present in one render, absent in the
other: the network fetch). After vendoring, the mask is the glyph's OUTLINE —
present in both, rasterised differently. That is a glyph-cache decision inside
Skia, taken on a scaled outline, and nothing the page can reach.

Two corrections to this file's original claim. Images were never the main cause:
the raster figure contributes 3–4 frames at **85–91 dB**, which is a handful of
pixels off by one. And the deck that broke the guarantee has no images in it at
all, so the image-only readiness gate never ran there — the note pointed every
later investigation at the wrong scene.

**Magnitudes, from the current build** (540 frames, two renders):

- 531 frames byte-identical
- 3 frames at 85–91 dB — the figure, imperceptible
- 6 frames at 44.0–47.7 dB — the glyph, visible only in a difference image
- worst case **44.0 dB**

**So the guarantee changes.** Byte-identical rendering is not available on this
stack for any deck containing scaled text or raster detail, and chasing it
further is spending real time on the last 44 dB. The drift check should:

1. keep **byte-identical** for the image-free, unscaled-text fixture, where it
   holds and where a regression means something is genuinely wrong; and
2. for real decks, compare **per-frame PSNR against a floor of 40 dB**, which
   passes everything measured here and still fails every defect that matters —
   a blank plate, a missing reveal, a font falling back to tofu, a layout shift
   — because all of those are 20 dB events or worse.

A gate that can never pass is worse than no gate, and this one could never pass.

**Kept anyway, on their own merits and not for determinism:** the vendored KaTeX
(a deck with equations was fetching a stylesheet and its fonts at render time —
an invariant-2 violation, and it meant equation decks were never really offline)
and the font barrier (a face that falls back mid-capture is a real defect worth
holding for, whatever it does for the hash).

## Addendum 2 — the image deck is now byte-identical (2026-07-30)

This file's standing conclusion was that byte-identical rendering is unavailable
for any deck containing scaled text or raster detail, and that the drift gate
should therefore compare by PSNR against a 40 dB floor. That conclusion is now
out of date. `drift --identical` on the twelve-beat demo:

```
7395 frames, all byte-identical across two renders.
All 12 measurable scene(s) moved within their own window.
PASS — 0 error(s), 0 warning(s)
```

For comparison, the measurements this file was written from: 428 of 7395 frames
differing, concentrated in `s3` (the only raster crop) and `s5` (the caligraphic
`W` of `\mathcal{W}`), worst frame 44.0 dB. A later run had it down to 1 frame at
82.57 dB. It is now zero.

**What is NOT claimed: a cause.** Several things changed between those runs and
this one, and no bisect was done:

* KaTeX's stylesheet and woff2 fonts were vendored, then GSAP and `katex.min.js`
  were vendored too — so nothing is fetched at capture and nothing depends on the
  compiler's best-effort script inliner.
* `equation-walk`'s KaTeX options changed when `trust: true` became a predicate,
  which alters the emitted render call for exactly the scene that used to drift.
* Reference space arrived, using `zoom` rather than `transform: scale()`
  specifically to keep glyphs off the scaled-outline rasterisation path.

Any of those could be the reason; the network ones are the likeliest, since a
fetch at capture time is precisely the kind of thing that resolves differently
between two runs. Attributing it would cost four renders at ~7 minutes each and
buys nothing operationally — the gate passes either way.

**What this changes:** `--identical` is usable on real decks, not only on the
image-free fixture, and the PSNR floor is now the fallback rather than the plan.
Do not delete the floor: the property has been intermittent before, and a gate
that can only ever demand perfection is a gate someone will switch off the first
time a font update moves one pixel.

### The twelfth case: renders depend on worker count (2026-07-30)

`drift` rendered twice with identical settings, so it tested run-to-run stability
and nothing else. `hyperframes render` shards frames CONTIGUOUSLY, one page per
worker, so worker k's first seek lands mid-deck — and anything a scene measures
LAZILY therefore measures under different conditions in each worker. The Seam B
prototype measured a lazily-measured arrow differing in 286 of 360 frames between
`--workers 1` and `--workers 3`, up to 42px, while `hyperframes check` reported
`layout ok, 0 findings` and drift passed both runs.

The two `drift` passes now render at 1 worker and 3, which tests both properties
for the same two renders. `--workers <n>` pins both passes, because a gate that
varies an input needs a way to hold it still or its failures cannot be diagnosed.

Confirmed on the camera fixture, which measures lazily through `dsFrame`:

| both passes | frames differing | worst |
|---|---|---|
| 1 vs 3 workers | **201 / 594** | 51.52 dB |
| pinned at 3 workers | **1 / 594** | 117.32 dB |

The control is what makes this a finding rather than a guess. 117 dB is one pixel
off by a hair — the residual scaled-glyph noise this file is about, and it is
negligible. 51.52 dB over 201 frames is a real difference, and it appears ONLY
when the worker count varies. So `render.ts` passing hyperframes' *auto* worker
count means the same deck renders differently on a 4-core CI box and a 10-core
laptop, silently, for any deck that uses the camera.

**The fix is Seam B's `defer`, already prototyped and measured at 0/360 across
worker counts** (experiments/014-seam-b/): measure once, before the timeline is
built, inside the readiness gate — rather than lazily on first use. That is the
concrete, now-justified reason to land Seam B, and it is a better one than the
one the proposal gave.

Not done: pinning `render`'s worker count to paper over it. The comment at
src/render/render.ts:22 records a real measured failure — a `--workers 1` render
of the four-minute demo dying at frame 5547 with a dead Chrome, because one page
held open for 7,395 sequential screenshots is the thing that breaks. Forcing one
worker would trade an invisible bug for a visible crash.

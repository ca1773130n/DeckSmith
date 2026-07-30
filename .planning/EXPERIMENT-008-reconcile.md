# EXPERIMENT-008 — reconciling the vertical-format workstreams

Five agents landed at once on the 9:16 problem: the content box (`unclip`), portrait
diagram layouts, portrait text layouts, the verify grading and the length budget, and
camera/copy. Four of them touched the same eleven archetype files against a content-box
API that was itself being written underneath them. This is what disagreed, what it cost,
and what is deliberately still open.

The starting state: `build --format short-9x16` reported **PASS** while emitting decks
with content running off the right edge on four slides, and 47% average canvas coverage
against 16:9's 68%. The ending state is below.

---

## 1. The one that was still wrong when the five finished

**`.stackwrap` meant two different things in one stylesheet, and nothing could see it.**

One stylesheet serves the whole deck, so a CSS class is deck-global while the file
declaring it looks local. Two archetypes had independently claimed the same name:

```
stack.ts:376        .stackwrap{align-self:center;margin-top:20px}
line-chart.ts:301   .stackwrap{flex-direction:column;align-items:stretch}
line-chart.ts:302   .stackwrap .readout{max-width:none}
```

`line-chart` had adopted `.stackwrap` as its portrait modifier (`class="chartwrap
stackwrap"`) for a wrapper it wanted to **stretch**; `stack`'s rule says `align-self:
center`, which is precisely "do not stretch". Both rules applied to both elements in both
directions.

It rendered correctly anyway — but only by coincidence: line-chart's portrait svg is
emitted at exactly `contentW(format)`, so a wrapper that shrink-wraps its content lands on
the same width a stretched one would. Any chart narrower than its box — a future
aspect-capped plot, a chart with a legend — would have sat centred with the readout ragged
beside it.

Nothing could catch it. `tsc` sees two strings. `biome` sees two strings. No gate reads
CSS; `hyperframes check` measures rendered geometry, and the geometry was accidentally
right. The previous round flagged the collision in prose ("worth someone renaming") and
then, correctly, did not touch a file it did not own.

**Fix:** line-chart's modifier is `.chartstack`, a name line-chart owns.

**Regression test** (`test/archetypes.test.ts`, "never lets two archetypes define the same
class differently"): emit all twelve archetypes, map each declared class to the set of
rules each archetype writes about it, and fail when two archetypes disagree. Identical
text across archetypes is fine — that is a shared helper like `chromeCss`. Verified
against the bug by re-introducing it:

```
AssertionError: expected [ 'stackwrap: line-chart vs stack' ] to deeply equal []
```

This is the eighth green-gates-over-wrong-output case, and the first one caught by a test
rather than by a human with a screenshot — because the wrongness was latent rather than
visible.

## 2. `chrome()`'s optional width was an artifact of the schedule, not a design

`unwidow` binds a headline's tail with U+00A0 so it cannot break to a one- or two-word
last line. It reaches a headline only when the caller passes the measure, and `chrome`'s
fourth argument was left **optional** for one round because six of the eleven callers
belonged to other agents mid-flight.

The six that never got the argument were exactly the six still printing orphans
("…is read / through", "…not the / smallest", "…query per / pixel"). A defaulted measure
is indistinguishable at the call site from a deliberate one, so the next archetype would
have inherited the same silent opt-out.

`width` is now **required**. Omitting it is a type error. All eleven callers pass
`contentW(ctx.format)` or the stage width already derived from it. Three more headlines
picked up the fix at 16:9 (s2, s3, s6) and the demo's remaining orphans are gone.

Where `unwidow` still declines — s4, s7, s8 — it is the guard working: binding the tail
would strand an earlier line, and the candidate is rejected rather than trading one ragged
line for another.

## 3. The budget gate and `minWeight` describe the same decision and disagreed

`gates-and-budgets` gave `short-9x16` a `maxSeconds` of 180. It already had a `minWeight`
of 0.6. Both answer "what is a short", and nothing reconciled them: the demo's twelve
beats are all weighted ≥0.7, so a 0.6 floor drops none of them, and the narrated cut runs
4m07s against a 3m00s ceiling.

The gate is right, and its message even does the arithmetic:

> Raise short-9x16's minWeight above 0.8, or cut them from the storyboard.

**The first half of that sentence named something no user could do.** `minWeight` lived
only in `FORMATS`, i.e. in library source. One storyboard could not produce both a deck
and a short.

Three options were considered and two rejected:

- **Raise `short-9x16.minWeight` to 0.85 in `FORMATS`.** Rejected: it is fixture-fitting a
  product default, and it would silently drop stack, bar-compare, claim-figure and callout
  from the vertical demo — the four archetypes whose portrait layouts had just been
  rewritten. Losing them from the one artifact a human opens is exactly the failure this
  project keeps having.
- **Trim automatically inside the budget gate.** Already rejected in `budget.ts`'s header,
  for reasons that still hold: it makes the gate a second, invisible editor.
- **Let the invocation carry the override.** Taken.

`build --min-weight <n>` overrides the profile's default for one build. It lives on the
invocation rather than in `FORMATS` because which beats survive a shorter cut is the
author's editorial call about *this* deck, not a property of the canvas. `format` is
already passed to both `emitDeck` and `writeTiming`, so overriding the resolved `Format`
keeps the emitted cut and the timing manifest in step by construction.

Measured on the demo, per candidate threshold:

| minWeight | beats kept | narrated | verdict |
|---|---|---|---|
| 0.6 (profile default) | 12 | 246.5s | **over_budget, error** |
| 0.75 | 11 | 223.5s | over |
| 0.8 | 10 | 208.0s | over |
| **0.85** | **8** | **169.0s** | **PASS** (near_budget warning: over Reels' 90s) |
| 0.9 | 5 | 110.3s | pass |

**The default 9:16 demo build still FAILs, deliberately.** A 4m07s explainer is not a
Short, and the demo storyboard is a deck fixture. That failure is the gate working; it is
not a regression and it should not be "fixed" by softening `minWeight`.

### A silent cut was hiding in the build log

`--min-weight 0.85` exposed a pre-existing lie: `build` logged
`storyboard.beats.length` — what it was *offered* — not what it *drew*.

```
build: 12 beats at 1080×1920 → index.html      # while emitting 8 scenes
```

The count is now `keptBeats(storyboard, format)`, exported from `composition.ts` so the
rule is stated once, and the drop is named:

> Superseded by EXPERIMENT-010: `keptBeats` is now `planCut`, which returns the reasons
> as well as the list, because the format's LENGTH can cut a deck too. Same principle —
> the rule is stated once and the log reports what was drawn.

```
build: 8 beats at 1080×1920 in ink (4 below minWeight 0.85) → index.html
```

Latent before this round, because no shipped format dropped a beat from the demo. It would
have gone live the moment anyone used the feature — a build log that overstates what it
emitted is the one place a silent cut would hide.

---

## What the 16:9 deck — the one that ships — actually changed

`hyperframes.json` and `timing.json` are **byte-identical** to the pre-workflow baseline.
No timing moved. `index.html` differs in exactly four ways, all intended:

| # | change | why |
|---|---|---|
| 1 | 16 SP→NBSP substitutions across 9 headlines | `unwidow` (§2) |
| 2 | 4 CSS rules added, 0 removed, existing order unchanged | portrait branches: `.eqstack`, `.cf-stack`, `.chartstack` ×2 |
| 3 | grid's first cell `x="470.04"` → `x="6"` | the flush-left fix; grid was indented off its headline's spine in both formats |
| 4 | b08 narration reworded | "lands second from the top" → "is the second largest here"; draw order is not a claim |

The four added rules have **zero matching elements at 16:9** — verified by counting class
occurrences in the built file — so they are inert declarations, not silent restyling.

## Numbers

9:16, all twelve slides, **seeked to each scene's final frame** (invariant 1 — see
"Measurement" below). Edge paint is the max luma of the outermost pixel row/column against
a canvas background of 13.

| slide | archetype | R | L | T | B | coverage | min text |
|---|---|---|---|---|---|---|---|
| s1 | title | 13 | 13 | 13 | 13 | 74.0% | 42 |
| s2 | pipeline | 13 | 13 | 13 | 13 | 64.6% | 40 |
| s3 | annotated-figure | 13 | 13 | 13 | 13 | 34.0% | 40 |
| s4 | grid | 13 | 13 | 13 | 13 | 44.4% | 42 |
| s5 | equation-walk | 13 | 13 | 13 | 13 | 73.3% | 42 |
| s6 | stack | 13 | 13 | 13 | 13 | 55.8% | 40 |
| s7 | split-compare | 13 | 13 | 13 | 13 | 71.3% | 42 |
| s8 | bar-compare | 13 | 13 | 13 | 13 | 65.3% | 40 |
| s9 | data-table | 13 | 13 | 13 | 13 | 68.6% | 42 |
| s10 | line-chart | 13 | 13 | 13 | 13 | 61.2% | 40 |
| s11 | claim-figure | 13 | 13 | 13 | 13 | 72.3% | 42 |
| s12 | callout | 13 | 13 | 13 | 13 | 49.5% | 42 |

Average coverage **61.2%**, up from 47% at the start of the workflow. 16:9 sits at 53–76%,
average 66.5%, with every edge at 13. Nothing is clipped on any edge in either format, and
no audience text is under 40px anywhere.

The four originally-bleeding slides, right-edge max luma: s3 **255 → 13**, s4 **252 → 13**,
s5 **236 → 13**, s8 **245 → 13**.

## Measurement — a note that cost an hour

The harness inherited from the previous round measures at **t=0** and only forces
`opacity`/`visibility`. Attribute-driven tweens are therefore still at their `from` values,
so bar-compare screenshots as five empty rails each labelled "0", in **both** formats. That
is the harness, not the deck.

It matters beyond the confusion: an element that overflows only at its final width is
invisible to a t=0 edge test. `scratchpad/seekshot.mjs` seeks each scene's own timeline to
its end before measuring (`tl.seek(tl.duration(), true)` — invariant 11's `suppressEvents`),
and is the harness the table above came from. Both harnesses now agree on every edge, which
is the evidence that nothing overflows only under animation.

The same pass fixed a second artifact: the minimum-text walk counted KaTeX's `vlist-s`
strut — a 1px span holding U+200B — and reported equation-walk as 1px in both formats.
Excluding KaTeX internals puts s5 at 42px, and invariant 5 is intact.

---

## Still open, and what is worse than before

- **`annotated-figure` at 9:16 is 34.0% coverage and that is close to its ceiling.** The
  demo's cropped figure is 4:1 and width-bound; no layout fills a 1080×1920 frame with it.
  The picture is a large qualitative win over the 232px postage stamp it was, and nothing
  is cut. But the figure's *own* internal labels — raster pixels inside the embedded image,
  not DOM text — land around 12px on a 1080px canvas and are illegible on a phone.
  Invariant 5 cannot see them because they are not text elements. **This is the honest
  weak point of the vertical deck**, and the fix is editorial, not layout: a 4:1 comparison
  figure is the wrong evidence for a 9:16 beat, and `plan` should prefer a different
  archetype for that shape at that format. Not attempted here.
- **`grid` at 44.4% is also at its maximum** — a 12-column square lattice in an 860px box
  is 848×562 and cells cannot grow past width. Adding a band to fill the frame would be ink
  without meaning. Left alone.
- **line-chart's first value label overlaps its y-axis label** ("28.91" over "29"). Present
  in **both** formats, and 16:9's s10 markup is byte-identical to the pre-workflow
  baseline, so it is strictly pre-existing and not a regression. Untouched because the fix
  is inside the chart's label placement and would move 16:9 bytes; it wants its own pass.
- **`post-1x1` still cannot build.** `split-compare b07: the panels do not fit beside each
  other at the 40px floor`. Square takes the landscape branch by design (`isPortrait` is
  `height > width`), and 1080×1080 is narrower than either real format. Nothing in this
  round addressed it, and the budget gate's `post-1x1` path remains unit-tested but
  CLI-unreachable.
- **`connector_detached` on `#s2-pipe` survives in both formats** — pre-existing, a
  warning, and it fires on the shipping format unchanged. It moved 328→486px at 9:16 as
  the loop route changed.
- **The blink at scene boundaries is diagnosed and unfixed.** Every scene opens on 150ms of
  background because `chromeIn` starts at 0.15s, and the hyperframes engine swaps scene
  visibility on one instant. The measurements, the disproved alternatives and the exact fix
  are recorded in `src/emit/camera.ts`'s header; it needs `composition.ts` to let a scene's
  clip outlast its step, which is not a `camera.ts` change.
- **`equationSize`'s calibration is an estimate.** `texUnits` was fitted against KaTeX's
  real 14.66em render for the demo's equations. It caps size against the box and no longer
  overflows, but it is a glyph-width model, not a measurement, and an unusual TeX string
  could still mis-estimate. The old comment claiming KaTeX shrinks to fit was simply false.

Nothing is worse than before. The one behaviour that changed direction is the default
9:16 build's exit code — PASS→FAIL — and that is the budget gate reporting a true fact
about the demo storyboard that the previous PASS was concealing.

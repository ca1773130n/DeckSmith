# The plugin table, and MorphSVG through it

**Date** 2026-09-08. Gap 1's second slice, and it is deliberately smaller than
the brief asked for. See "What was rejected" at the end.

## The claim that had to be re-measured, and was

`2026-09-04-drawsvg-seam.md` exists because the roadmap asserted seek-purity
about a plugin that was not the one being shipped, and the assertion had to be
re-taken for DrawSVG. The same gap was open here twice over: spike cell 04
(`experiments/013-vocabulary/gaps/spike/index.html:147`) measured `morphSVG` on
a **bare page**, not in a deck, and not through the capture path.

So it was measured in a deck, through `openDeck` — the renderer's own browser,
seeking with the renderer's own call, `renderSeek(t, { suppressEvents: true })`.
The deck is a two-beat storyboard (title, then a `line-chart` with a `compare`
series); scene `s2` starts at **6.000s absolute**, read off the built deck rather
than assumed, which is the one command `2026-09-04-drawsvg-seam.md` spent three
false alarms learning to run. The reshape is scheduled at local 3.10 and runs
1.2s. The scalar is the last y of `#s2-line`'s `d`: 399.60 on the baseline,
225.03 on the result.

| absolute t | local t | last y of `d` | the `d` GSAP left behind |
| --- | --- | --- | --- |
| 7.00 | 1.00 | 399.60 | authored polyline |
| 8.00 | 2.00 | 399.60 | authored polyline |
| 8.90 | 2.90 | 399.60 | authored polyline |
| 9.10 | 3.10 | 399.60 | authored polyline (the tween's own start) |
| 9.40 | 3.40 | 388.68 | cubic |
| 9.70 | 3.70 | 312.31 | cubic |
| 10.00 | 4.00 | 235.94 | cubic |
| 10.30 | 4.30 | 225.03 | the target's polyline, verbatim |
| 11.00 | 5.00 | 225.03 | target |
| 12.00 | 6.00 | 225.03 | target |

**MorphSVG renders under a suppressed seek.** It ramps monotonically and comes
to rest on the target's own path string rather than near it. Two things worth
knowing that the table also shows: mid-tween the element carries CUBIC
segments (MorphSVG rewrites `d` through `rawPathToString`), and at ratio 0 and
ratio 1 it carries the authored strings exactly — so a frame captured at either
end is byte-identical to a frame of a deck that never morphed at all.

The same run reads DrawSVG on the sibling path, `#s2-base`, at 107.106 →
642.635 → 963.953px of dash, and the crossfade at local 2.90 with `#s2-line` at
opacity 0.84 against `#s2-base` at 0.3952. Both plugins in one deck, neither
interfering with the other.

### Order independence, which is the property sharding needs

`hyperframes render` shards frames contiguously across workers, so the same
instant is reached from a different direction in every worker. Measured on one
page, seeking to local 3.70 three times:

| arrived from | last y | `d` |
| --- | --- | --- |
| 3.40, forward | 312.31 | — |
| 2.00, backward across the whole tween | 312.31 | identical string |
| 6.00, backward from after it | 312.31 | identical string |

And in a second process with a fresh browser, local 2.00 / 3.70 / 6.00 give
399.60 / 312.31 / 225.03 — the same three numbers as the first process.

### `shapeIndex` is pinned, and that is not a style choice

MorphSVG's default is `"auto"`, which SEARCHES: `_getClosestShapeIndex` walks
every rotation of the start segment summing point-to-point movement and keeps
the cheapest (`node_modules/gsap/MorphSVGPlugin.js:555-561`, reached from `:604`).
A search at render time is the same class of hazard as the cold-worker glyph in
`2026-09-04-equation-morph.md`, and it buys nothing here: both shapes are
polylines authored left to right off the same x positions, so point 0 already
corresponds to point 0. `reshape()` passes `shapeIndex: 0` in both halves of the
`fromTo`, at the call site rather than through `MorphSVGPlugin.defaultMap`, so a
reader of the emitted tween can see it.

## NOT YET MEASURED

Renders are serialised elsewhere and were not available to this branch. These
rows are open, and nothing below them should be quoted as though they were
closed:

| question | status |
| --- | --- |
| `hyperframes render` of a reshape deck — does the mp4 show the morph | **NOT MEASURED** |
| `drift` PSNR on a reshape deck against a control | **NOT MEASURED** |
| the same under >1 worker, which is where the equation morph's 31 frames came from | **NOT MEASURED** |
| how a reshape between two data curves reads at 1080p to a person who is not looking for it | **NOT MEASURED** — a look-at-the-artifact question, and no gate answers it |

What WAS looked at, because a gate passing is not evidence: three frames off the
capture path at local 2.00, 3.70 and 6.00 — the baseline alone and labelled; the
curve mid-lift with the ghost under it; the settled result with its dots, values,
deltas and ring, the ghost still legible below. All three read correctly. They
are screenshots of the capture path, NOT of the render, and per
`2026-09-04-invariant-11-under-beginframe.md` those are different instruments.

## What changed

- **A plugin table**, `PLUGINS` in `src/emit/composition.ts`. `dsMorph` proved
  the mechanism and now shares it with `morphSVG`; the head emits a `<script>`
  pair for each name some scene put in `Scene.plugins`, **in the table's own
  order**, not the Set's — `laid.plugins` is filled in scene order, and two
  storyboards differing only in beat position must not emit the same tags in a
  different order. Registered before any scene script, because a scene's IIFE
  builds its timeline inline and late registration is not late, it is silently
  nothing.
- **MorphSVG is vendored**, 21,195 bytes, and costs **0 bytes** on a deck that
  does not reshape. Verified rather than reasoned: `emitComposition` on a
  three-beat storyboard including a compare-less `line-chart` gives
  `b8ebf8f382cb05c66680fecc0dca96060e4a2b8c6a43d07ef591b54ad42e1d8a`, 14,226
  bytes, at both aac1b67 and this branch. The digest is pinned in
  `test/wiring.test.ts`. Built end to end, `grep -rl MorphSVGPlugin` over the
  whole output tree of a compare-less deck returns nothing. The head block costs
  117 bytes on a deck that does reshape.
- **`vendorScripts` copies only what the head loads.** It reads the composition
  rather than taking `laid.plugins` threaded out of `emit`, because the question
  is literally "which of these does the page ask for", and asking the page cannot
  drift from the page. This also makes `ds-morph.js` conditional, which it was
  not: every deck used to carry 6.4KB of morph runtime on disk that only a
  morphing deck ever loaded.
- **`reshape()` in `src/emit/svg.ts`**, beside `DRAW_FROM`/`DRAW_TO` and
  `travel()`. One `Tween`, self-referential `from`, `to` naming a hidden sibling
  by selector so the end geometry lives in the document rather than twice.
- **`line-chart` gained an optional `compare` series** — the one archetype in
  the tree with a genuine source tell for Reshape, "the same measurement under
  two conditions". Three paths, not one: `-base` is drawn on and never reshaped,
  `-line` is reshaped and never drawn on, `-target` is geometry only.

### The hazard that split is for, and no lint sees it

DrawSVG and MorphSVG write DIFFERENT GSAP properties, so
`overlapping_gsap_tweens` would stay quiet about the two of them on one element.
But after `drawSVG: 100%` GSAP leaves `stroke-dasharray` at the OLD path's
length, and reshaping to a longer path then leaves the tail unpainted — inside
the frame, above the type floor, invisible to every gate. Sequencing around it
would work until someone changed the sequence. Two elements cannot interact.

A second one, of the same family: the marker ring's route is computed from
`params.points`, so releasing it any earlier than the reshape's END walks the
final route over an intermediate curve. A marker beside its own line, in frame,
green everywhere. `settled` in `line-chart.ts` is the single anchor both the ring
and the dots hang off, and `test/arch-line-chart.test.ts` asserts the ordering.

## What was NOT done, and why

- **MotionPathPlugin / a `Trace` verb — rejected, not deferred.** `travel()`
  (`src/emit/svg.ts`) already IS Trace for polylines, at four call sites, for
  zero bundle bytes. Every path in `src/emit/archetypes/` is `M`/`L`/`Z`: there
  is not one `C`, `Q` or `A` command anywhere, so there is no curve for
  MotionPath to trace that `travel()` renders wrong. What 22,002 bytes would buy
  is `autoRotate` and the removal of a route/`d` duplication. Revisit it when
  something first draws a curve — the pipeline self-loop is the likeliest.
- **`Track` and `Squish`**, the other two unshipped verbs. Both are zero-byte and
  neither has a named consumer. A verb nothing calls is the same debt as a plugin
  nothing emits.
- **A fourteenth archetype for Reshape.** There is no source tell for "a shape
  becomes a different shape" as a beat in its own right, and inventing one is the
  expensive half.
- **Nothing in `src/plan/refs.ts`.** `compare.points` are literals, not ids into
  `source`, so there is no dangling reference for that gate to catch. The
  length-and-labels invariant is a params invariant and lives in
  `lineChartParamsSchema`, where a bad plan fails before a beat is spent on it.
  Recorded as a test in `test/plan.test.ts` rather than as an absence, so the
  next reader does not think it was forgotten.
- **Making DrawSVG conditional on the table.** Now possible, and would save 4,351
  bytes on every deck with no draw-on — but it moves the bytes of decks this
  change otherwise does not touch, so it needs its own `drift` run and its own
  commit.
- **The invariant 2.5 lint** ("at most one `fromTo` per (element, property) may
  render immediately"). Still absent; `immediateRender: false` is hand-written at
  ~15 sites and guarded only by prose. `reshape()` takes `first` as a REQUIRED
  argument so that it is a clean consumer of that lint when it arrives.

## What changed after this note was first written

Three commits on `chore/0.4-integration` refined the compare path, all after
477a792. The schedule described above is the one that was measured before them.

- **The schedule now fits the beat.** `beat.seconds` is the planner's, and held
  at their authored lengths the draw-on and the reveal put the second hold at
  6.5s on any chart of four points or more — which `holdsWithin` then clamped
  onto a half-drawn chart, in frame, above the type floor, green in every gate.
  The draw-on gives up its length first, all the way to `DRAW_FLOOR` (1.0s), and
  only then does the point stagger give up any of its, to `STEP_FLOOR` (0.15).
  Both descend in whole hundredths over `tailAfter` — the same function the four
  tweens are scheduled from — rather than by inverting a max of four lines that a
  fifth tail added later would silently escape.
- **It degrades; it does not refuse.** When even the floors do not fit, the beat
  is re-entered with `compare: undefined` and emitted as the plain chart, down to
  `plugins` being absent so the head vendors none of MorphSVG's 21,195 bytes, and
  the loss is said out loud through `Scene.warnings` → `DeckOptions.onBeatWarning`.
  A throw was the first cut and was wrong: it reaches `onBeatError`, which drops
  the whole beat. Measured against the shortest committed planner output in the
  repository, `experiments/013-vocabulary/planner/runs/B0-02/out.json`, whose
  eleven beats are authored at 4.6, 4.9, 5.2, 5.3, 5.8, 5.8, 6, 6.2, 6.4, 6.4 and
  6.5 seconds: four of the eleven are under the 5.45s a four-point comparison with
  a readout needs (5.7s if it also carries deltas), and all eleven are under the
  6.65s a twelve-point one needs. The refusal turned "the comparison animates a
  bit fast" into "the slide is not in the deck" across most of a real plan.
- **The ghost label is placed, and may be dropped.** Four candidate positions are
  tried, and any that overlaps the always-drawn text — both axis names, the tick
  labels, the category names — or a value box, a drawn delta box, or either curve
  is rejected. If all four are rejected the label is dropped and no tween is
  emitted for it, because a tween on an id nothing carries is a selector GSAP
  resolves to nothing, silently. An unnamed ghost is still legibly the fainter,
  earlier curve; a name drawn through a value is not. Nothing warns about this
  one, which is the one thing about it worth arguing with later.
- **It is measured at the weight it is painted at.** `.ghostlab` sets
  `font-weight: 600`, so the collision test charges `ghostW` (600) rather than
  `runW`'s 400. Under-charging a width is the unrecoverable direction: the layout
  keeps a label the browser then draws wider than the box it was cleared for.

## Reproducing the measurement

```
node dist/cli.js build <storyboard with a compare series> --source <source> -o <dir>
```

then open the deck with `openDeck(dir)` from `src/render/capture.ts` and read
`#<sid>-line`'s `d` at a series of ABSOLUTE times. Take the scene's start from
the built deck's `data-start`, or from `timing.json` — not from the beat lengths
in the storyboard, which is the mistake that produced three false alarms in one
afternoon on 2026-09-04.

State the beat's `seconds` when you quote a local time from this. The schedule is
fitted now: `lift = 0.8 + drawFor`, and `drawFor` descends from 1.8s toward
`DRAW_FLOOR` until the reveal's tail fits, so the reshape's local 3.10 start is
what an UNCOMPRESSED beat gives and a shorter one starts it earlier. Below the
floors there is no reshape in the deck at all — read the build's warnings before
you read `d`.

# v2 fit engine: archetypes that grow into their region

2026-10-07. Branch `feat/v2-fit`. This is the fit track of the redesign plan
(`~/.blackhole/DeckSmith/2026-10-07/redesign/plan/2026-10-07-decksmith-redesign-design.md`,
QW6 and M1). Everything here sits behind `--design v2`. `classic` is still the
default and still emits v0.8.0's bytes.

## What changed for the founder

v0.8.0's solvers could only shrink. `BAR_MAX = 96`, `MAX_BOX_H = 340`, a 50px
claim, panels capped at their content plus a fifth, figures left at their
natural pixels. Whatever the region had left, `.scene`'s
`justify-content: center` turned into air above and below the slide. Under v2:

| archetype | v2 behaviour |
|---|---|
| bar-compare | Bar, label and value caps are ×1.6. Rows spread up to one bar apart, and the note is pinned to the region's floor. Text stays at or under 0.78 of a bar, with headroom over the first row. Labels are solved against 92% of the gutter. |
| pipeline | Each line count from 1 to 3 is tried at a 52×1.6px label, and the one that sets the label largest wins. Labels are split evenly. Boxes grow to 1.6× their text, inside 0.8 of the region. The note is pinned to the floor. |
| claim-figure | The plate is sized to fill its column and height, up to 2× its pixels. The claim grows up to 72px without gaining a line. A figure flatter than 1.5:1 may go full-width under its claim when that fills clearly more. |
| callout | Type grows up to 1.4× until the panels and their air meet the box. The panel stays proportional to its content. |
| equation-walk | The display is asked at 1.3× (`mathFit` only steps down) and the legend is set at 60px. |
| stack | The rise may grow 1.6×. The plane itself does not grow. |
| annotated-figure | The figure may be drawn at 2× its pixels instead of 1.5×, but only when every note still places. |
| split-compare, line-chart | Already fill their budget. They only report a prediction. |
| title, grid, data-table, equation-morph | Unchanged and no prediction. Title and data-table already fill; grid and equation-morph are 1% of beats. |

## Interfaces other tracks will meet

- **`Prefs.design: "classic" | "v2"`** (`designSchema` and `Design` in
  `src/types.ts`), set with `--design` on `build` and on any command that takes
  the look flags, and in `decksmith.config.json`. `BuildDeckOptions.design` and
  `DeckOptions.design` carry it in the library.
- **`EmitContext.design?`** (`src/emit/kit.ts`). Absent means classic. Read it
  only through `isV2(ctx)` in `src/emit/fit.ts`. `narrate`, `refs` and `timing`
  do not pass it, because stop counts are identical under both designs (see the
  invariants below).
- **`Scene.fit?: Fit`** = `{ fill, region, ink }`, in reference px. It lives in
  memory only, like `Scene.parts`. Here `region` is the content box less
  `chromeHeight`, and `ink` is the predicted painted extent of the body from top
  to bottom. Build it with `fitOf(ink, region)`, which rounds once.
- **`src/emit/fit.ts`** holds `fillBand` (EMPTY < 0.70 ≤ SPARSE < 0.90 ≤ FULL ≤
  1.00 < SPILLAGE ≤ 1.10 < OVERFLOW), `GROWTH = 1.6`, `growToFit(height, budget)`
  and `MEASURE_SLACK = 0.92`. The slack is how much of its measure v2 sets HTML
  text against when it grows to the last line. SVG text is exempt.
- **`fit.json`** (`FIT_FILE` and `FitManifest`) is written beside `index.html`
  by v2 builds only, as `{ design: "v2", scenes: [{ id, beat, archetype, fit? }] }`.
  Its presence is what tells `verify` the deck is v2.
- **`FidelityReport.fills: FillRow[]`** (`src/verify/fill.ts`) is measured at
  each scene's last hold on every deck. Each row is `{ sid, t, fill, cross,
  canvas, region }`. Findings come only on a v2 deck, both as warnings:
  `fill/hollow_at_hold` (fill < 0.70) and `fill/fill_model_disagrees`
  (|predicted − measured| > 0.20). `fidelity`, `fillBand`, `FIT_FILE` and the
  types are exported from the package for eval harnesses.

**For variants (M3).** An archetype that adds a variant should return `fit` for
that variant. A layout that is not a column under a chrome (a full-bleed figure,
a rail) should say how its region is measured, because `collectFillRegion`
assumes `.headline`/`.eyebrow` sit above the body. Corner-sampled backgrounds
were deliberately not used, because a bleed variant would break them. The ink
test reads the body's declared `background-color`.

## The measure

Main-axis fill is the painted extent of the body, from its first pixel row to
its last, divided by the region's height. The region's height is the content
box less the chrome's height. It is not "everything under the headline":
`.scene` centres its column, and that definition drops the slack above the
eyebrow. The first cut of this gate made exactly that mistake and called a
two-bar chart 70% full. Ink is any pixel more than 12 per channel off the
page's declared background. The frame's modal colour is not used, because a
grown callout's panel wash covers more of the frame than the background does.

## Invariants, and how each is held

- **Classic is v0.8.0.** `emitDeck` output for all 219 stored HypePaper
  storyboards × {deck-16x9, short-9x16} = 438 compositions and pages, plus
  `buildDeck`'s full file set for 6 of them, is byte-identical to `origin/main`
  (scratch script `bytes.mjs`). `test/fit.test.ts` pins absent ≡ classic.
- **Stops do not move.** Holds and refusals are identical between classic and
  v2 for every beat of all 219 storyboards at deck-16x9, short-9x16 and post-1x1
  (10,608 emits, 0 differences). `test/fit.test.ts` holds it on the demo at
  every format. Every grown path falls back to the classic layout rather than
  refusing.
- **Determinism.** Growth is pure arithmetic. `growToFit` floors onto a 1/128
  grid, and every prediction is rounded once.
- **40px floor.** Type only grows.
- **The sweep** (`npm run sweep`) is re-run against this `dist/`. It covers
  classic only.

## Measured

The measurements below are from 24 real HypePaper storyboards (6 each of en,
ko, ja and zh-Hans; 394 final holds), built with no LLM and no TTS, and
measured by `fidelity` in the deck's own browser.

| | classic (v0.8.0) | v2 |
|---|---|---|
| hollow rate (final holds with fill < 0.70) | 38.1% | **8.9%** |
| median main-axis fill | 0.778 | 0.936 |
| bar-compare canvas bbox, median | 0.571 | **0.729** |
| pipeline canvas bbox, median | 0.498 | **0.735** |
| holds past 1.10 (overflow) | 0 | 0 |
| decks failing `verify` (check + scans) | 1 of 24 | 0 of 24 |
| `text_box_overflow` errors | 1 | 0 |
| typefloor / overprint / apparent-floor findings | 0 | 0 |
| `layout/container_overflow` warnings | 43 | 42 |
| `layout/content_overlap` warnings | 10 | 6 |
| refused beats | 0 | 0 |

Per archetype, the share of holds that are hollow (classic → v2): pipeline
96% → 9%, callout 77% → 37%, bar-compare 63% → 8%, stack 67% → 17%,
equation-walk 50% → 30%, claim-figure 23% → 1%. split-compare, title,
line-chart and data-table were at 0% in both.

The fit model was checked against the browser on 362 of the 394 holds: the
median |predicted − measured| is 0.015, and 1 hold is past 0.2 (an
equation-walk at 0.26).

The before/after contact sheets are not in the repository. They were rendered
to `~/.blackhole/DeckSmith/2026-10-07/v2-fit-scratch/preview/` by the scratch
harness `fill-eval.mjs`, which builds with `buildDeck`, measures with
`fidelity`, and runs `verify` with `--verify`.

`canvas` is the union box of all ink on the frame over the 1920×1080 frame.
That is the density audit's "bbox" (51% for both). Its ceiling is 0.748, the
content box itself.

## Known gaps

- A callout with one short line per panel stays hollow (~0.4). The panel rule
  keeps the air proportional, and 1.4× type cannot fill 780px. This wants a
  `stat` variant (M3), not more growth.
- The equation-walk prediction is an estimate, ±0.12 of a region. KaTeX's
  height cannot be known in Node.
- `fidelity`'s own `blank_at_stop` still takes the modal colour as the
  background. On a v2 frame that is mostly panel wash, that undercounts nothing
  (no false fails) but could miss a blank body. It was not changed here.
- One v0.8.0 Korean deck (450790a0) fails `text_box_overflow` on a bar label
  under classic. The fix is in v2 only, because classic's bytes are pinned.

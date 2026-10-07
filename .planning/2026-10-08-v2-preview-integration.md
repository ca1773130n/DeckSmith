# v2 preview: the five tracks merged

2026-10-08. Branch `preview/design-v2`, made from `origin/main` (2061cf5, v0.8.0). It merges `feat/v2-player`, `feat/v2-style`, `feat/v2-fit`, `feat/v2-layout` and `feat/v2-motion`, in that order. It exists so the founder can review the redesign before anything is released. It is not a release.

## Decisions made while merging

- **One `design` preference.** It is optional and has no default (`designSchema.optional()` in both schemas). `designFor(prefs, storyboard.design)` resolves it in this order: a flag or the config file, then the storyboard, then `classic`. Because the field is optional, an explicit `--design classic` can be told apart from silence, and it rolls a v2 storyboard back. motion's old "was a flag given" side channel is gone. `pack` writes `design` into the manifest only when someone stated it.
- **Resolved once, in `layout()`.** `layout()` now folds `storyboard.design` into the options. `emitComposition` reaches `layout()` without going through `emitDeck`, so the fit engine, the Director, motion and the player all read the same answer.
- **The Director emits its candidates under `design: "v2"`.** Each look is scored and timing-checked exactly as the fit engine will draw it.
- **Grown paths use the frame's budget.** Every archetype that grows under v2 takes its region, note width and budget from the chosen frame (`F.budget`, `F.noteW`), not from the classic chrome. A rail or foot look then grows into the box it actually has.
- **Two variants don't grow:**
  - A `stair` pipeline keeps classic box sizes. Growth would leave it no rise, and every stair would be refused.
  - A `mirror` claim-figure is sized but never swapped for the full-width arrangement.
- **Two fill fields.** `Scene.fit` (the fit track's prediction, written to `fit.json`) and `Scene.fill` (the layout track's body ratio, which the Director scores) both stay. Each has one consumer.
- **The seam glide follows the playback rate.** In `deck.html` the seam glide divides by the viewer's playback rate, like every other glide.

## Fixes found by looking at the merged decks

| defect | where it showed | fix |
|---|---|---|
| A pack's ground (grid, dots, vignette) counted as ink, so grown bodies measured > 1.1 | `fill-browser` on the demo, blueprint | v2 decks get one extra capture of the bare background (scenes at opacity 0). Ink is measured against it pixel by pixel |
| Foot headline counted as spill; rail region measured under the headline | `fill-browser`, `look-page` | `collectFillRegion` follows the placement. A foot slide scans only to `.lk-main`'s floor |
| Grown pipeline label cut mid-word: "Rectified-flo / w 학습" | ko 9cd69d55 | `cutsWord`: the grown row skips any size that cuts a word |
| Columns variant cut "Qwen2.5-VL-7B" letter by letter | ja 3a447697 | Columns refuses, and the Director keeps rows |
| Unit caption ran off a rail chart's left edge (`text_box_overflow`) | ja 3a447697 b11 | Under v2 it sets from the chart's left edge |

## What was measured

All of the measurements below were taken with no LLM and no TTS:

- **Classic bytes.** Composition and deck page match `origin/main` for all 347 stored HypePaper storyboards (Oct 1–7) at deck-16x9 (with narration) and short-9x16, with a placeholder runtime: 694/694 sha256 equal. Script: `~/.blackhole/DeckSmith/2026-10-08/v2-preview-scratch/bytes.mjs`. A real classic `deck.html` still differs from v0.8.0's, because it inlines the new runtime. That runtime runs the v0.8.0 player when the page has no v2 marker.
- **Tier A.** Measured on the 4 preview decks and on 20 more storyboards (5 per language). The numbers are in the preview's `index.html`. The 20-storyboard results, classic → v2:
  - hollow rate: 41.5% → 6.7%
  - top-4 signatures: 73.8% → 27.8%
  - headline on top: 100% → 29.4%
  - busiest pack: 100% → 20%
  - stock fade-up: 100% → 19.8%
  - seam kinds: 1 → median 5
  - top-2 ease share: 85.6% → 38.2%
  - gate errors: 2 → 0

## Still open

- **Headline placement.** v2 moves most headlines off the top of the slide, to the foot or into a left rail (only 29% stay on top across the 20-storyboard set). The Director's −0.15 for a top headline and its fill weight push it there. This is a taste call for the founder, not a defect.
- **A flaky deck-page test.** `test/deck-page.test.ts` sometimes fails on `net::ERR_ABORTED` for a narration mp3 during fast navigation. It reproduces on `feat/v2-player` alone (2 of 4 runs) and never on `origin/main` (0 of 4). Not root-caused.
- **Callout fill.** Callout slides with one short line per panel stay hollow (about 0.4 fill). They need a stat-style variant.

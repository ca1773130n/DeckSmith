# v2 layout variants and the Director

2026-10-07, branch `feat/v2-layout`. This implements the M3 subset of the redesign plan: layout
variants, chrome placements and a deterministic Director, all behind `--design v2`. Nothing
changes without the flag.

## What a build does under `--design v2`

1. `planCut` measures the classic scenes, as before.
2. `layout` runs `direct()` (src/plan/direct.ts) over the kept beats. For each beat it emits
   every candidate look from `candidates()` (src/emit/look.ts), drops any that throw, and
   drops any whose holds or chrome landing differ from the classic scene. Then it scores the
   survivors and keeps the best.
3. Each scene is emitted with `ctx.look` set. `build` writes the decisions to `out/look.json`.

A look is `{variant, placement}`. Its signature is `archetype:variant@placement`.

| archetype | variants (classic first) | placements offered at 16:9 |
|---|---|---|
| split-compare | columns, rows | columns@top, rows@top, columns@foot, rows@rail |
| claim-figure | beside, mirror, stacked | beside@top, mirror@top, stacked@top, beside@foot, mirror@foot, stacked@rail |
| pipeline | row, stair, column | row@top, stair@top, row@foot, stair@foot, column@rail |
| bar-compare | bars, columns | bars@top, columns@top, bars@rail, columns@rail, bars@foot, columns@foot |
| callout | panels | panels@top, panels@foot |
| equation-walk | display | display@top, display@foot |

On any canvas narrower than 3:2, only the classic variant is offered, at top or foot.

## Interfaces other tracks touch

- `prefs.design?: "classic" | "v2"`. It is optional and has no default, so a pack written
  without it carries no new key. The CLI flag is `--design`. It reaches `DeckOptions.design`
  and `BuildDeckOptions.design`.
- `EmitContext.look?: Look` (kit.ts). It is absent on every classic build and in every
  measuring pass.
- `Scene.fill?: number` (kit.ts). This is main-axis fill of the body box, from 0 to 1. It is
  in memory only and moves no bytes. The Director scores `0.6 · fill`, and an emitter that
  reports none scores 0.5. **The fit track should report a better `fill` here** and leave
  the Director alone.
- `frameOf(ctx, {eyebrow, headline, drawn?, evidence?})` returns a `Frame`:
  `{w, noteW, budget(below, top, floor), compose(body), css, tl}`. For the classic frame it
  reproduces `contentW`, `bodyBudget` and `chrome()` byte for byte (test/look.test.ts). An
  emitter that adopts it gets placements for free. **The style track's `ScaleSpec`** belongs
  in `frameOf`: it is the single place the chrome height is charged.
- `Frame.tl` adds two tweens: the rail's accent bar `#sN-k` and an aside `#sN-ax`. Neither
  ends in `-e` or `-h`, so `openSeconds` does not move. **The motion track** can restyle them.
- Fidelity: `blank_at_stop` now measures ink in each placement's body region (`bodyRegion`,
  `inkIn`). Classic scenes are measured exactly as before.

## The one rule

A look changes geometry and never time. `narrate`, `timing.ts` and `refs.ts` emit the classic
scene and never see a look. The Director therefore enforces equal holds and an equal chrome
landing per candidate, and the variant tests assert the same.

## Measured

`node experiments/019-layout-variety/measure.mjs <run dirs>` was run over the 219 storyboards in
`~/.blackhole/HypePaper/2026-10-0[4-7]/decksmith/runs/` at deck-16x9, through `emitDeck`, with
no browser.

| metric | classic | v2 | target |
|---|---|---|---|
| top-4 signatures, share of beats | 72.4% | 27.1% | ≤ 30% |
| chrome on top (title excluded) | 93.8% | 28.4% | ≤ 50% |
| adjacent identical signatures | 2 | 0 | 0 |
| distinct signatures | 13 | 32 | |

The classic composition and deck page are byte-identical to `origin/main` for all 219
storyboards, at both deck-16x9 and short-9x16 (438 of 438 sha256 equal).

Five real decks (en, ja, zh-Hans, ko and the demo) were built at v2 and passed their gates. Their
final-hold frames were compared side by side against classic. Two things were found by eye and
changed:

- `stair` beside a rail made boxes about 180px wide, so it moved to `foot`.
- `blank_at_stop` failed every foot slide and one rail slide on the first real build (7 errors).
  The gate fix and test/look-page.test.ts came from that.

## Found, not fixed (classic)

`claim-figure` writes its per-beat plate cap as a bare `.figwrap img{max-height}` into the one
global stylesheet, so the last claim-figure in a deck sets the cap for every one. Shipped deck
3b9eaf0b.en carries caps of 308, 492, 492 and 566px. Under v2 the rule is scoped to the scene.
Classic keeps the bug so that its bytes stay those of v0.8.0.

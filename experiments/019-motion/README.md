# 019 — v2 motion grammar (M4), measured

2026-10-07. Branch `feat/v2-motion`. Code: `src/emit/motion.ts` (plan, entrances, seams,
emphasis), `src/deck/motion.ts` (the deck player's half), `src/verify/motion.ts` (the
metrics below). Behind `--design v2`; `classic` is unchanged.

## The M4 targets, over every stored HypePaper storyboard

`node experiments/019-motion/stats.mjs ~/.blackhole/HypePaper/2026-10-0[4-7]/decksmith/runs/*/*.*`
— 219 storyboards (en, ko, ja, zh-Hans), 3,531 scenes, each built both ways from the same
storyboard and narration. Emit only: no Chrome, codex or TTS.

| metric | classic (v0.8.0) | v2 | plan target |
|---|---|---|---|
| scenes opening on the stock opacity+y fade-up | 100.0% | 17.8% | ≤ 40% |
| seam kinds per deck of 10+ beats | 1 (min 1) | median 5, min 4 | ≥ 3 |
| share of tweens on the two commonest eases | 85.7% | 34.7% | ≤ 60% |

"Modal" is counted generously to the old look: any headline entering as a bare
opacity + y fade, whatever its ease, so v2's own `rise` counts. The audit's 92% used a
narrower rule; this one reads classic at 100%.

## What did not move

- `timing.json` is byte-identical between classic and v2 on a real 11-beat deck
  (`3b7225ad…en`): a restyle keeps every tween's end and every hold, and emphasis lives
  inside existing quiet stretches.
- Scene windows (`data-start`/`data-duration`) are identical (test/motion.test.ts).
- The same deck through `build`'s gates: 0 errors and the same 13 warnings both ways.

## In the presented deck (deck.html, renderer's Chrome, real mp3 narration)

Stepping from slide 2's last stop to slide 3 and holding slide 2's last stop for 9s of its
audio, frames sampled every rAF:

| deck | frames with both scenes on screen (the seam) | frames with the emphasis glow lit |
|---|---|---|
| classic | 0 | 0 |
| v2 | 26 | 40 |
| v2, `prefers-reduced-motion: reduce` | 0 | 0 |

`test/deck-motion.test.ts` pins the same three-way result on a built fixture with silent
WAV narration.

## Known limits

- In deck.html only a stop's OWN quiet stretch is played during its audio, so on most
  slides only the last stop gets emphasis there; the mp4 gets one per narrated stop.
- The seam glide in deck.html runs at 1×; when the player track adds a playback rate, the
  `lead` branch in `go()` needs the same `/ rate` as `planTransition`.
- Glow is the commonest emphasis, because a pulse needs the part's scale to be free and an
  underline needs a leaf text element.

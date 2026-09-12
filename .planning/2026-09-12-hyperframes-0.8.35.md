# hyperframes 0.8.33 → 0.8.35

**Take it.** Every gate is unchanged, the deck DeckSmith emits is byte-identical,
and the rendered picture moves by less than a quarter of one intensity level on
average. What it costs is cross-pin byte-identity, broadly: 206 of 213 frames
differ on the zero-noise fixture. None of them differ by enough to see.

This is the opposite shape to the 0.8.27 → 0.8.31 move, and the contrast is the
useful part. That one moved **2** frames and the worst was **10.94 dB** — a whole
scene missing. This one moves **206** and the worst is **51.23 dB**. Frame count
is not severity, and neither round could have been judged on it.

## 1. What upstream changed

| | 0.8.33 | 0.8.35 |
| --- | --- | --- |
| `dist/hyperframe.runtime.iife.js` | 399,774 B | 401,731 B |
| `dist/commands/layout-audit.browser.js` | 80,787 B | 81,192 B |
| `dist/cli.js` | 11,079,741 B | 11,406,812 B |

Rule literals enumerated across all three bundles, which is the method §9 of the
0.8.33 round arrived at after a single-bundle pass missed one: **527 → 529, two
added, none removed.**

- **`unclosed_tag_swallowed_element`** — a new **error**-severity lint rule in
  `cli.js`. Fires when a tag is missing its closing `>` before the next `<`, so
  the following element is swallowed as bogus attribute text. Its predicate is
  `hasUnquotedLessThan(tag.attrs)`.
- **`draw_element_capture`** — not a rule at all. A capture-plan failure kind
  used by `replanAfterFailure`, which on a `drawelement` failure replans to
  `forceScreenshot` with streaming and layered composite off. This is the
  capability fallback AGENTS.md already says `drawelement` has; it is now named.

## 2. The new error rule cannot fire on our decks

`build` + `verify` of the twelve-beat demo at 0.8.35: **PASS — 0 error(s), 20
warning(s)**. The control matters more than the number, and it was run on the
identical tree with only the pin swapped: at 0.8.33, **PASS — 0 error(s), 20
warning(s)**. Identical. No new finding of any severity appears.

## 3. The instruments built for this both pass

`test/frame-grid.test.ts` reads the **installed** runtime and asserts the
property DeckSmith depends on — that a time it can author survives the
activation quantiser unchanged. It passes at 0.8.35. So does
`test/capture-parity.test.ts`. These are the two gates PR #80 added precisely so
a pin move could be judged in milliseconds instead of by rendering, and this is
the first upgrade to use them for that.

`npm run build && npm run check`: **48 files, 1618 tests, 0 failures.**
`npm run sweep`: 45 ok / 8 intended refusals over 53 cells, **11 of 11 known
defects still fixed, 0 still open.**

## 4. The render, measured

The zero-noise off-grid fixture from the 0.8.33 round, rebuilt from the recipe
recorded there: two beats at 3.017s and 4.051s off `plain`, no narration.
Duration 7.068s, 2 scenes, 213 frames — matching that round exactly.

| | frames | identical | differing | worst |
| --- | --- | --- | --- | --- |
| own noise, 0.8.35 (two renders) | 213 | **213** | 0 | — |
| cross-pin, 0.8.33 vs 0.8.35 | 213 | 7 | **206** | **51.23 dB** |

**The instrument is still zero-noise at 0.8.35.** Two renders at the new pin are
byte-identical across all 213 frames, so determinism *within* a pin is intact,
which is the property that actually ships. Cross-pin byte-identity was never
promised and is not available on this stack anyway (EXPERIMENT-006).

**Nothing is below the floor.** 0 frames under 40 dB, 0 under 30 dB, median of
the differing frames 56.45 dB. The worst frames cluster at t≈5.1–5.4s, inside
scene 2.

**It is antialiasing, not structure.** On the worst frame, 162:

| | value |
| --- | --- |
| max per-pixel deviation | 51 of 255 |
| mean per-pixel deviation | 0.211 |
| pixels changed | 595,984 of 6,220,800 (9.58%) |

A large maximum on a tenth of the pixels with a mean near zero is edge
rasterisation moving sub-pixel, not content appearing or disappearing. Frame 100
is the same shape at half the magnitude.

## 5. The deck itself did not move

`diff -rq` of the fixture built at each pin: `index.html`, `deck.html`,
`deck-runtime.js` and `timing.json` are **byte-identical**. The only differing
file is `hyperframes-player.global.js`, which is copied in from the installed
package and is the *player*, not the composition and not the render path.

So this upgrade changes nothing DeckSmith emits. Whatever moved, moved inside
upstream's own render toolchain.

## 6. Confidence

- **High** that the gates are unchanged and the new error rule cannot fire.
  Measured against a control on the identical tree, both directions.
- **High** that the emitted deck is unaffected. `diff -rq`, four files, byte
  hashes.
- **High** that within-pin determinism survives. 213 of 213 on a zero-noise
  instrument.
- **High** that the cross-pin difference is above the PSNR floor by a wide
  margin. 0 frames under 40 dB with the worst at 51.23.
- **Medium** that it is imperceptible. The pixel statistics say edge
  antialiasing and nothing in the numbers suggests otherwise, but **no human has
  watched either mp4**, and this project's record is that the artifact is where
  the surprises are.
- **Nothing is claimed** about the twelve-beat demo's own render across this pin,
  about narrated decks, about 9:16, or about a deck with a camera. Only the
  off-grid fixture was rendered cross-pin. The 0.8.33 round is a standing
  reminder that predictions here have been right about the mechanism and wrong
  about which frames move, twice.
- **Nothing is claimed** about 0.8.36 and later.

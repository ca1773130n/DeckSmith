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

**It is not structure, and the two frames are indistinguishable to look at.**
Frame 162 was opened at both pins and compared by eye: same layout, same type,
same three plates, same labels. Nothing is missing, moved, or recoloured in any
way a viewer could name.

| | value |
| --- | --- |
| max per-pixel deviation | 51 of 255 |
| mean per-pixel deviation | 0.211 |
| pixels changed | 595,984 of 6,220,800 (9.58%) |

**I could not establish the mechanism, and two plausible ones are ruled out.**

*Not edge antialiasing.* That was the first claim here and it was wrong. Of the
changed pixels on frame 162, **66.3% are interior** — every one of their four
neighbours changed too. Edge rasterisation would put that near zero. In the gold
plate's own region 32.6% of pixels move and the modal delta is 2.

*Not an animation-timing shift.* The plate is a reveal of "opacity and offset
only", so a tween evaluated at slightly different progress was the natural
second guess. It does not hold: the **settled** final frame 213 differs as much
as any — 17.18% of pixels, 76.6% interior — so the difference survives after
everything has stopped moving.

*Not a gamma or colour-space change.* The signed delta on frame 213 is mixed:
195,907 pixels brighter, 264,528 darker, mean −0.198, and no luma band shows a
consistent direction. A colour-management change would be monotone within a band.

What is left is a low-magnitude, mixed-sign difference in the **interior of
drawn fills** that grows with how much has been drawn — 0.30% of pixels at frame
8 against 17.2% at frame 213. Dithering of the plate gradients is the obvious
candidate and it is a **hypothesis, not a finding**: it was not tested.

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
- **Medium-high** that it is imperceptible. Frame 162 was opened at both pins
  and looked at, not merely measured, and the two are indistinguishable. But a
  still is not the mp4 — **nobody has watched either video** — and this project's
  record is that the artifact is where the surprises are.
- **Nothing is claimed about the cause.** Three hypotheses were tested and the
  first two were mine: edge antialiasing (ruled out, 66% of changed pixels are
  interior), an animation-timing shift (ruled out, the settled frame differs),
  and a gamma or colour-space change (ruled out, the signed delta is mixed).
  Gradient dithering is a guess. Note that the antialiasing claim was written
  into this file and its commit message BEFORE it was checked, and survived
  until the frames were actually opened — which is the failure this repo keeps
  recording, committed here by the person recording it.
- **Nothing is claimed** about the twelve-beat demo's own render across this pin,
  about narrated decks, about 9:16, or about a deck with a camera. Only the
  off-grid fixture was rendered cross-pin. The 0.8.33 round is a standing
  reminder that predictions here have been right about the mechanism and wrong
  about which frames move, twice. This round is the mirror image: right about
  which frames move, wrong about the mechanism.
- **Nothing is claimed** about 0.8.36 and later.

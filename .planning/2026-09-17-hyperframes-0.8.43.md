# hyperframes 0.8.35 → 0.8.43

**Take it.** Eight upstream releases in five days (0.8.36 on 2026-09-12 to 0.8.43
on 2026-09-16). The deck DeckSmith emits is byte-identical across the pin, no new
rule fires, the error set is unchanged, and the rendered picture moves by the same
sub-perceptible amount the previous pin move did. One warning is new, and it is
upstream judging an unchanged picture differently, not the picture changing.

Method is the one the 0.8.35 record used, and every number below was taken on the
identical tree with only the pin swapped.

## 1. What upstream changed

| bundle | 0.8.35 | 0.8.43 |
| --- | --- | --- |
| `dist/hyperframe.runtime.iife.js` | 401,731 B | 403,478 B — changed |
| `dist/commands/layout-audit.browser.js` | 81,192 B | 81,192 B — **byte-identical** |
| `dist/cli.js` | 11,406,812 B | 11,452,801 B — changed |

Snake-case literals across all three bundles: **529 → 537**, nine added, one
removed. Most of the additions are render-progress phase names
(`compiling_composition`, `extracting_video_frames`, `prewarm_requested`,
`processing_audio_tracks`, `starting_frame_capture`,
`render_cancelled_parent_exited`). The three that could be findings:

- **`root_dimensions_mismatch`** — **warning**. The root's `data-width` /
  `data-height` disagree with the scaffolded body size. `baseCss` writes
  `html, body` from the same format, so it should not fire, and it does not.
- **`video_media_start_at_or_past_eof`** — **warning**. A video slot starting at or
  past its source's duration. Clip-only.
- **`opaque_document_origin`** — not a lint finding. A reason string inside the
  runtime's media-origin check, for a document whose `window.origin` is `"null"`.

**Removed:** `gsap_exit_missing_hard_kill`, a lint rule.

**No new error-severity rule.**

## 2. The gates, against a control

| deck | 0.8.35 | 0.8.43 |
| --- | --- | --- |
| demo, 16:9 | PASS — 0 errors, 20 warnings (twice) | PASS — 0 errors, **21** warnings (three times) |
| demo, 9:16 `--reserve-captions` | FAIL — 1 error, **14** then **15** warnings | FAIL — 1 error, 15 warnings |
| off-grid fixture | PASS — 0 errors, 1 warning | PASS — 0 errors, 1 warning |

**The 9:16 error is pre-existing and identical at both pins**: `text_box_overflow`
on KaTeX's `span.mclose`. It is in the control, so it is not this upgrade's, and it
is not closed by it either.

**The layout gate is not repeatable to the warning.** The 9:16 control came back
with 14 warnings on one run and 15 on the next, at the same pin, on the same
built deck. So a one-warning difference between pins means nothing on one run
each, and the 16:9 difference below was re-run before it was believed.

**The one new warning is stable and upstream's.** At 0.8.43 the 16:9 demo gains a
`content_overlap` on `div.ds-morph-layer > span:nth-of-type(12)` at t=57.045s, in
all three runs; at 0.8.35 it is absent in both. Per rule, nothing else moved.

It is not a change in the picture. `decksmith frames --at 57.045` under each pin
produces **byte-identical PNGs**. The frame is the equation-morph mid-transition —
the pieces are in flight and a fading bracket brushes the moving group — so the
overlap is real and transient, and it was already there at 0.8.35. With the
built deck byte-identical and `layout-audit.browser.js` byte-identical, what
changed is how `cli.js` drives the audit, not what is on screen. Warning severity;
the deck still PASSes.

Caveat on that inference: `frames` seeks with `suppressEvents`, and `check` uses
upstream's own seek path. AGENTS.md records that those two views can disagree. A
byte-identical `frames` capture shows the picture did not change in the gate's
view; it does not prove the audit saw an identical DOM.

## 3. The instruments built for this

`test/frame-grid.test.ts` reads the installed runtime's activation quantiser and
passes. `test/capture-parity.test.ts` passes. `test/deck-page.test.ts` — the
deck player driven in the renderer's own Chrome — passes, 6 of 6.

`npm run build && npm run check`: **49 files, 1628 tests, 0 failures.**
`npm run sweep`: **11 of 11 known defects still fixed, 0 still open.**

## 4. The render

The zero-noise off-grid fixture, rebuilt from the recipe in
`.planning/2026-09-10-hyperframes-0.8.33.md`.

| | frames | identical | differing | worst |
| --- | --- | --- | --- | --- |
| own noise, 0.8.43 (two renders) | 213 | **213** | 0 | — |
| cross-pin, 0.8.35 vs 0.8.43 | 213 | 7 | 206 | **51.89 dB** |

0 frames under 40 dB. Within-pin determinism, the property that ships, is intact.

This is the same shape as the 0.8.33 → 0.8.35 move to the frame — 206 differing,
the first seven identical because nothing is drawn yet, frame 162 the worst at
51.89 dB against 51.23 then. The 0.8.35 record established that such a difference
lives in the interior of drawn fills, is mixed-sign, and is not antialiasing, a
timing shift or a colour-space change, and could not establish the cause. The same
tests were not repeated here, so nothing more is claimed about this one.

## 5. Confidence

- **High** that no new rule fires and the error set is unchanged. Control on the
  identical tree, per rule.
- **High** that the new `content_overlap` is stable and attributable to the pin —
  three runs against two — and **high** that the captured picture at that instant
  is byte-identical. **Medium** on the inference that the audit, not the DOM, is
  what changed; see the caveat in §2.
- **High** that within-pin render determinism survives, and that the cross-pin
  difference clears the floor by 11.89 dB.
- **Nothing is claimed** about narrated, 9:16 or camera decks rendered across this
  pin — only the off-grid fixture was rendered at both — nor about 0.8.44 and later.

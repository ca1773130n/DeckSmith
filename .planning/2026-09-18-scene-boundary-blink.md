# The scene-boundary blink, re-measured at hyperframes 0.8.43

EXPERIMENT-008-reconcile.md listed "the blink at scene boundaries" as diagnosed and
unfixed: every scene opens on 150ms of background because `chromeIn` puts first ink at
0.15s, and the engine swaps scene visibility on one instant. This records what was
measured on 2026-09-18 before anything changed, what turned out to be already fixed,
what was still broken, and the change that fixed it.

Short version: **the render was already fixed. The presented deck was not.**
`composition.ts` has lengthened every scene's clip past its slide by `HANDOFF_SECONDS`
since the import commit, so the mp4 has no background-only frame at any seam. But
`paint()` in `src/deck/runtime.ts` decided visibility from the island's slide window,
not from the clip. So `deck.html`, gliding across a seam, still cut a lit slide to flat
background for eleven 60Hz ticks.

## The deck

No fixture has two seams. `demo/fixtures/plain.storyboard.json` has one and
`demo/fixtures/camera.storyboard.json` has one. The measured deck is the two joined
(`f01 title`, `f02 stack`, `c01 pipeline`, `c02 grid` inside `c01`), built against
`demo/fixtures/plain.source.json` at `deck-16x9`. That gives four scenes and three seams,
one of them cameraed:

| scene | slide | clip (`data-duration`) |
| --- | --- | --- |
| s1 title | [0, 3) | 3.4 |
| s2 stack | [3, 7) | 4.4 |
| s3 pipeline | [7, 17.8) | 11.2, transit `16,18.2` |
| s4 grid | [17.8, 26.8) | 9 |

`build` reports `PASS — 0 error(s), 3 warning(s)` both before and after the change.

**Metric.** "Background-only" means no pixel of the encoded luma plane differs from the
deck background (Y = 27, measured flat `min == max == 27` on frame 0) by more than 8.
The count is the number of pixels that do ("ink"). It is read straight off the
`yuv420p` Y plane, with no range conversion. An earlier pass through `-pix_fmt gray`
remapped 27 to about 13 and counted every pixel as ink, so that pass is not quoted here.

## 1. The render, on main (3e5f90a), before any change

`decksmith render --subtitles none`: 804 frames at 30fps, `drawelement` capture, hardware GPU.

- **7 background-only frames, all at t = 0.000–0.200.** That is the deck's first scene
  opening with nothing before it. None is at a seam.
- **0 background-only frames within ±0.5s of any seam.** The ink floor across each seam:

  | seam | floor | at |
  | --- | --- | --- |
  | 3.0 title→stack | 25,119 px | 3.400 |
  | 7.0 stack→pipeline | 32,338 px | 7.400 |
  | 17.8 pipeline→grid (camera) | 26,614 px | 18.200 |

  Every floor is at the clip's end: the outgoing scene has finished dissolving and the
  incoming one carries its eyebrow and part of its headline.
- Frames opened at 3.2, 3.333, 3.4, 7.4, 18.0 and 18.2: dissolves, not holes. At 3.2 the
  incoming eyebrow ghosts in directly under the outgoing one, the kind of collision
  `HANDOFF_SECONDS` already documents. 18.0 is the landed camera dipping, with the incoming `FIXTURE`
  already visible above it.

So the render does not reproduce the bullet at 0.8.43.

## 2. The presented deck, on main, before any change

`deck.html` served over http and opened in the hyperframes `chrome-headless-shell` at
960×540. The deck was deep-linked to `#2.3` (s2's last stop, t = 6.2) and advanced with
ArrowRight to `#3` (s3's landing, t = 8.55). That span is 2.35s, under `MAX_SPAN`, so it
glides. The top document's `requestAnimationFrame` was replaced with a queue stepped by
hand at 1000/60 ms, and the player was screenshotted after every tick. That makes the
glide deterministic: tick k shows t = 6.2 + 2.35·(k−1)·16.667/2350.

- **Ticks 49–59, t = 7.000–7.167: ink 3,525 px, flat.** Frame k53 shows only the
  presenter chrome (play button, counter, progress bar) on background. Tick 48
  (t = 6.983) is the full `stack` slide at 97,503 px. The cut is one tick wide.
- Ink then rises to about 4,200 by 7.3 and 12,814 by 7.4, as the incoming eyebrow and
  headline arrive.

The mechanism is `paint()`: `showing = t >= startTime && t < endTime` over the island,
whose `endTime` is the slide (7.0), not the clip (7.4). The engine's own test, read out
of `hyperframe-runtime.js` at 0.8.43, is `t >= start && t < start + data-duration`. The
handoff tween was in s2's timeline all along, but the deck page stopped showing s2 before
the tween had a chance to run.

## 3. The change

`showingAt(slide, clip, t)` in `src/deck/runtime.ts` shows a scene from its slide's start
until `start + clip`, which is the engine's rule. When the clip cannot be read (missing,
zero, negative or NaN), it falls back to the island's window. `paint()` reads the clip
from the scene div it already looks up, with `getAttribute("data-duration")`, and past
the slide's end it seeks the scene's timeline into its own handoff tween. Nothing in
`src/emit/` changed.

Unit cases in `test/deck.test.ts` pin the seam's own numbers: both scenes up at 7.0, 7.05,
7.167 and 7.399; s2 gone at 7.4; the half-open ends; and the fallback.

## 4. After

Same storyboard, rebuilt with the change.

**Bytes.** `index.html`, `timing.json`, `hyperframes.json`, the player bundle, `vendor/`
and `katex/` are byte-identical to main's build. **Only `deck.html` differs**, because it
inlines `dist/deck-runtime.js`. `dist/cli.js` and `dist/index.js` are unchanged by the
comment edits in `src/emit/camera.ts` (sha1 compared across a rebuild).

**The glide.** 0 ticks at or below the 3,525 px chrome-only count. Across 7.000–7.383
the outgoing slide dissolves over the incoming eyebrow and headline. Opened: k53 (7.067)
is still the full stack slide, k66 (7.283) shows both eyebrows, k72 (7.383) is the stack
faint under the pipeline's headline, and k73 (7.4) is the pipeline scene alone. The
lowest ink across the whole glide is now 12,814 px at 7.400, which is the value main
already had at that tick.

**No bleed.** Screenshots compared byte for byte, before against after:

- ticks 73–143 (t ≥ 7.4) are identical, so nothing outlasts the clip;
- ticks 49–72 (7.000–7.383) differ, which is exactly the handoff window;
- ticks 1–25 differ too, but they also differ between **two runs of main's own build**
  (re-run and compared). They are wall-clock presenter chrome and ambient motion in the
  first ~0.4s after the key press, not `paint()`.

At t = 7.2 the deck-page frame and the render frame show the same dissolve phase (outgoing
slide near full, incoming `FIXTURE` ghost at the same opacity). They do not match pixel for
pixel: PSNR is 19.2 dB before and 19.5 dB after (top 500 rows, 960×540). The residual is
the type difference listed at the end, not the seam.

**The render, again.** Rendered from the rebuilt deck, whose `index.html` is byte-identical:
7 background-only frames, all at 0.000–0.200 again, and 0 within ±0.5s of a seam. The
per-frame ink trace matches main's render except at frames 494–499 (16.467–16.633s,
mid-dive). That is run-to-run render noise on identical input, not the change.

## Not done, and observed but not investigated

- **The deck's very first 0.2s is flat background** in the render (the presented deck
  opens on its first stop, 1.9s, and was not measured at 0). There is no outgoing scene
  to dissolve from. Left as it is: it is not a seam, and
  it reads as a fade-in from black.
- **A no-reveal slide landing at its raw start** now shows its predecessor at full opacity
  under it, because the predecessor's clip is still running and its handoff has not begun.
  That is what the render shows at that instant too. `buildStops` only falls back to the
  raw start for a scene with no fragments; whether any archetype can emit a scene with
  no holds was not checked.
- **The presented deck's type is not the render's type.** At t = 7.2 the line "Every
  element here is a shape or a run of text at its authored size." ends at x ≈ 600 in
  `deck.html` and x ≈ 673 in the mp4, both at 960 px wide. That is a different face or
  different metrics; the gap is too wide to be hinting. It predates this change and was not investigated.
  Invariant 9 is the obvious suspect and was not checked.
- **`test/deck-page.test.ts` does not step through a glide frame by frame.** In the silent
  build of its plain fixture the only cross-slide step is 2.62s, over `MAX_SPAN`, so it
  cuts; the test's narrated build was not checked. The new unit cases cover the
  decision, not the painted frame. The frame evidence above was produced by a scratch
  harness that was not committed.

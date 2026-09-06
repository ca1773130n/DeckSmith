# The canvas was always pure. The probe broke it.

**Date** 2026-09-06. Run because `VOCABULARY.md` §5 rests the entire timing
argument for three.js on one claim — that a canvas redrawn from a GSAP plugin's
`render()` is seek-pure — and its own review flagged that claim `[UNVERIFIED]`
with the words "the discrepancy is unattributed. Re-measure before scheduling
three.js on it."

Seven agents: five measuring independently, two told to refute the other five.
Both refuters reproduced the verdict and corrected the mechanism.

## The answer

**Harness artefact.** Cell 12's canvas is a pure function of `t`. The two ink
values are ONE drawing rasterized two ways, and the probe's own `getImageData`
caused the switch.

Chrome starts a 2D canvas GPU-accelerated and permanently drops it to CPU raster
after **exactly two `getImageData` readbacks** on that canvas. The two
rasterizers antialias the stroke's diagonal edges differently. The probe counted
"pixels with alpha > 10", which amplified a 0.012% coverage difference into a
101-pixel headline number.

`seektest.mjs` reads six times in one browser — t=0, t=2, t=4, t=0, t=2, t=4 —
so the fallback fires after the second read and t=2 is measured once accelerated
(5,724) and once software (5,825). `review/canvas12.mjs` points at
`chrome-headless-shell`, which has no GPU rasterizer at all, so it reports 5,825
from the first readback and never sees the split. Its own
`t=2 NO suppress → 5825` line already exonerated `suppressEvents`; nobody read
it that way.

## Purity, proven at the input rather than at the pixels

The decisive move was to stop counting ink and fingerprint what the plugin
actually DREW, by patching `moveTo`/`lineTo`/`stroke` on the prototype:

| | |
| --- | --- |
| amplitude, both passes | `70.035000000` then `70.000000000` — exactly the tween arithmetic, `140·2.001/4` and `140·2/4` |
| command stream | 226 commands, identical fnv hash, same final `lineTo` |
| pixels within one rasterizer | **0 of 691,200 bytes differ**, both pre- and post-fallback |
| across the rasterizer switch | 2,829 of 691,200, edge pixels only |
| element screenshot (never calls `getImageData`) | same sha256 four times in a session, and across fresh browser launches |

Forcing software raster with `--disable-gpu` gives 5,825 from readback one,
stable — pinning 5,825 as the CPU value and 5,724 as the GPU one.

**Decoupled, the threshold is unambiguous.** Eight readbacks with no redraw all
return 5,724; the change appears on the first raster AFTER two readbacks have
armed it. Redrawing alone never flips it, and readbacks alone never flip a pixel.
Both are required, in that order, which is why every agent that measured them
interleaved got the threshold subtly wrong.

## The durable lesson, which is bigger than the question

**`getImageData` mutates the page it is measuring, permanently.** The element
screenshot at the same `t` hashes `30b9e366` before three readbacks and
`b275fef6` after. A probe that reads a canvas changes what the renderer would
have captured — so it is not a passive instrument, and any gate built on it
would be reporting its own side effect.

Checked: **nothing in `src/` or `scripts/` calls `getImageData`.** The trap is
not live in the product; it exists only in the 008-canvas spikes. Keep it that
way — a canvas gate must use the screenshot path, which is what the renderer
uses anyway.

This is the same shape as the four false alarms of 2026-09-04 and belongs in the
same list: an instrument that was assumed transparent and was not.

## What the refuters corrected in the five measuring agents

1. **"A backend flip stays comfortably above the deck's 43.53 dB worst case" is
   wrong, and it was the most decision-load-bearing claim in the set.** PSNR is
   error density. The reassuring 54.05 dB is an artefact of the spike's canvas
   being 480×360 — 4.2% of a 1920×1080 frame. On a full-frame canvas the same
   flip measures **43.26 dB, below the deck's documented floor.** Do not size
   this risk from the toy cell.
2. **The claimed WebGL blocker is disproven.** `chrome-headless-shell` 145 with
   default flags returns a null WebGL context, but hyperframes renders with its
   OWN cached shell and passes `--use-gl=angle --use-angle=swiftshader` by
   default. Nothing blocks week one.
3. **The backend is already pinned and hash-locked.** `browserGpuMode: "software"`
   is baked into the locked render config and flows into the plan hash. Two
   agents recommended work the tool already does.

## What is still open, and it is not small

- **Everything here is Canvas2D. WebGL seek-purity is untested.** The specific
  bug cannot recur — WebGL has no accelerated-canvas readback fallback — but
  ANGLE backend selection and shader float precision are separate determinism
  questions and none of them were measured.
- **One contradiction I could not resolve and am not going to assert past.**
  `node_modules/hyperframes/dist/cli.js:65687` computes
  `requestedCaptureMode` as beginframe only when
  `headlessShell && process.platform === "linux"`, which would mean macOS
  captures by screenshot. But this session's own render trace of the demo, on
  this Mac, reports `"captureMode":"beginframe"`. The variable is *requested*
  rather than final, so something downstream may override it — I did not chase
  it. It matters because AGENTS.md's invariant 11 rationale opens with "capture
  is driven by Chrome's `beginFrame`", and if that is platform-dependent then
  the rationale is too.
- **One machine, one Chrome.** Apple M4, macOS, Chrome for Testing 145. The
  render harness's own cached shells are 152.x — a different major version from
  the one both probes ran under.

## Verdict on three.js

The flag can be cleared, for the corrected reason. The property the timing
argument needs — a canvas redrawn from a plugin's `render()` receives
bit-identical state at a given `t` regardless of seek path, history, or
`suppressEvents`, and rasterizes identically once the rasterizer is fixed —
**holds, for Canvas2D.**

Schedule it, but scope milestone one as a **WebGL determinism spike**, not
feature work: the same three questions asked of a three.js cell rather than a
Canvas2D one. And the compositing limit is unchanged by any of this — a WebGL
canvas is one opaque rectangle in the DOM stacking order, so a frustum diagram
is a leaf the vocabulary places and times, never something a caption can pass
behind.

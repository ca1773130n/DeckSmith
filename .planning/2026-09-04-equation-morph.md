# `equation-morph` — the keyed term morph, shipped

**Date** 2026-09-04. Gap 1's next slice after the DrawSVG seam
(`2026-09-04-drawsvg-seam.md`). `VOCABULARY.md` §2.1 calls `TermTree` +
`Morph` "the centrepiece and not speculative", §7 prices the archetype at about
a week on top of the spike in `experiments/013-vocabulary/morph/`, and
`DECISION.md` names it the one visible capability of the defensible month. Seam
A (`tween()` returns a `Tween`) and Seam B (`Scene.measure`, built inside the
ready gate) were already on main, which is what made this a day rather than a
month.

## What a beat looks like

`params: { fromId, toId, terms[1..4] }`. Two equations from the source
inventory; each term must occur in BOTH, located by `equation-walk`'s normal
form (`\left`/`\right`, `\lVert`, whitespace folded) and wrapped as
`\htmlClass{term t-<tone> ds-k-<tone>}{...}` on each side. A term found on one
side only is dropped with its legend row — a key with nothing to pair would be
faded out as an unmatched body under a legend claiming it travelled. None on
both sides is a build error naming the terms and both equations.

Two holds: the first line settled at 1.8s, the second 0.4s after the morph
lands. The morph is 1.6s, placed at `max(2.6, min(seconds − 2.5, 0.45·seconds))`.

## The three things the spike could not tell us

The spike measured seek-purity and byte-identity on a bare page. Putting it in
a deck decided three things the page never faced.

**How the plan reaches the timeline.** `Scene.tl` is typed `Tween[]`, and the
morph has one tween per leaf per property, a count only the browser knows.
Rather than a statement hook that appends N `fromTo`s after the timeline exists
— which `pace()` could not scale and the type checker could not see — the plan
is driven by a GSAP plugin: `tl.fromTo("#sid-morph", { dsMorph: 0 }, { dsMorph:
1, duration: 1.6, ease: "none" }, at)`. One typed tween, scoped to the scene
(invariant 3), scaled by `pace` like any other, and a plugin's `render` fires
under `suppressEvents` (invariant 11 — measured for DrawSVG earlier today, and
now for this plugin: the capture path draws every mid-morph frame). The plan's
times are fractions of the tween, so pacing the tween paces the morph. The
plugin's `init` throws if nothing measured the host, because a tween on an
unbuilt host would animate nothing with every gate green.

**Which `=` moves.** The spike paired twins in document order. `F = E(I), X =
W(F)` has two `=` and its successor one; document order flew the first `=`
across the slide while the `=` 300px from its destination faded out. `match`
now pairs nearest-first within an identity bucket, ties to document order.

**How far a glyph may bow.** The spike's bow was `0.62·h + 0.12·dist`, sized
for two half-slide bodies exchanging ends. On a slide it put a 100px body 120px
up, into the headline — the gate said so (`content_overlap #s2-h`), and the
frame agreed. The bow is now `min(0.62·h, 0.8em)`, and the host carries `0.8em`
of padding so a bowing glyph stays inside its offset parent, which is what
silenced `escaped_container`. ponytail: two fraction-tall bodies exchanging
ends will overlap at the midpoint under this cap; lift it when a real deck
shows one.

One more, found by the layout gate rather than the eye: a leaf at opacity 0 is
still a text block to `content_overlap`, so B's clones under A at rest, and A's
under B after, read as text overprinting text. `evaluate` now also sets
`visibility: hidden` at zero opacity. Still a pure function of progress.

## Cost, measured

The runtime is 6.4KB minified, loaded only by a deck that has a morph
(`Scene.plugins`). Every other deck is byte-for-byte what it was: the demo
composition emitted through main's `dist/` and this branch's hashes the same
(`7d570a269507ef94`, 79,779 bytes), with the `equation-walk` legend refactor
included.

Three-beat deck (title, morph, callout; 21s, silent, 1 vs 3 workers, 40 dB
floor):

| deck | frames differing of 630 | worst |
| --- | --- | --- |
| with the morph, resting clones transformed (first cut) | 31 | 43.19 dB at frame 421 |
| control — the same beat as an `equation-walk` over the second line | **0** | byte-identical |
| **with the morph, resting clones untransformed (shipped)** | **0** | **byte-identical** |

The first cut passed the gate with 3.4 dB of headroom — inside the class the
demo already lives with (166 differing frames on this pin,
`2026-09-04-css3d-recheck.md`) — but the control being clean made it the
morph's own cost, so it was worth finding rather than filing.

**Where the 31 frames were, read off the kept renders rather than guessed:**
frames 421–451, contiguous, and frame 421 is the first frame of the third
worker's shard (630 / 3). All 31 carry the SAME 424-pixel difference — one
glyph, the `\big)` closing the window read, in a 30×133px box at x1303, max
delta 255 — and it vanishes at frame 452, where the scene has left. So it is
not motion and not the morph's arithmetic: a worker that starts cold on the
resting second line rasterises one delimiter differently from the worker that
walked there, and holds that difference for as long as the line is on screen.
The cold-seek check on `frames` could not see it because `frames` does not
render through a worker shard.

The resting clones differed from the control's resting terms in one way: they
carried a `transform` (`translate(-50%, -50%) translate(0px, 0px) scale(1)`),
which puts a glyph on Chrome's composited raster path. Clones are now
anchored by their top-left and a resting leaf carries no transform at all;
motion is `translate(x, y) scale(s)` about the box centre, which is the
default origin, so the plan is unchanged. Re-measured: **630 of 630 frames
byte-identical**, rest-A, mid-morph and rest-B unchanged on the frames, cold
seek still identical. `drift --identical` would pass on this deck, which the
demo cannot say of itself.

A fresh page seeked straight to mid-morph (t=10.1s) is byte-identical to the
frame reached by walking up to it. Cold seek and warm seek agree, which is the
property `immediateRender` discipline exists for.

## Not done, on purpose

- The demo deck does not carry a morph beat. Its source has one equation, and
  adding one is a product decision about the showcase, not a build step.
- No `Reshape` (MorphSVG) and no `Track`: nothing emits them, and the DrawSVG
  note's rule stands — an unused plugin is bytes every deck pays for.
- The planner has not been asked for keys yet. `VOCABULARY.md` §1 flags that
  planner key generation was never measured; the prompt now describes the beat
  and the `refs` gate catches a dangling `fromId`/`toId`, but whether a plan
  picks good keys is a run of `decksmith plan` away, not a test.

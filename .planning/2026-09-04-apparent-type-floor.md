# The type floor, measured on the frame — Gap 2's first slice

**Date** 2026-09-04. Written before any depth archetype exists, because the design
panel that scoped Gap 2 found that the archetype cannot be built safely without
it.

## Why this and not the archetype

Four independent designs were put against each other for "how does an archetype
get depth without its text colliding", each then attacked by a critic. They
disagreed about almost everything and converged on one thing nobody set out to
find: **the binding constraint is not collisions, it is invariant 5.**

`src/verify/typefloor.ts` says so in its own header, and has since long before
this: it reads DECLARED sizes, so "text shrunk by a `scale` below 1 at a hold
reads as its unscaled size". Every way of tilting a plane shrinks the type on the
far half of it, and none of `lint`, `check`, `drift`, or the declared-size scan
looks at how big a glyph actually came out. A depth archetype built against that
floor would ship unreadable slides that pass every gate — the project's signature
failure, and its sixth documented instance would have been one we authored on
purpose.

So the gate comes first. It is also worth having on its own: the `scale`-tween
hole is not 3D-specific and exists in the shipped product today.

## The measurement

Chrome, headless, `perspective: 1400px`, a 46px run.

| case | ratio | apparent px |
| --- | --- | --- |
| flat | 1.000 | **46.0** |
| `rotateX(30deg)`, near plane top | 0.682 | **31.4** |
| `rotateX(30deg)`, near plane bottom | 1.126 | 51.8 (magnified, not a fault) |
| `scale(0.6)` at a hold | 0.600 | **27.6** |

`rect.height / getBBox().height` is the whole primitive. `getBBox()` is the
untransformed box in user units; `getClientRects()` is the painted box in device
px; their ratio is the TOTAL scale between them — the element's own transform,
every ancestor transform, the perspective divide, and the stage zoom — without
having to know which of them applied.

**`getScreenCTM()` was tried first and rejected on measurement.** It returns 0.673
for BOTH the top and bottom runs above, whose painted heights differ by 23px,
because it carries the affine part and drops the per-point perspective divide.
That is exactly the error that would have made this gate agree with itself and
disagree with the frame.

Dividing by the scene's own painted-over-declared scale returns apparent size in
REFERENCE px, which is what keeps this gate from arguing with `typefloor` about
portrait: 40 reference px is supposed to land at 30 canvas px there, and the run
and its scene shrink together, so the quotient is unchanged.

## Verified end to end

| deck | verdict |
| --- | --- |
| the demo, untouched | **PASS**, 0 errors — no false positives |
| the same deck, `rotateX(30deg)` | **6 scenes fail**, smallest run 23.4px |
| the same deck, plain `scale(0.8)`, no 3D | **fails**, 32px declared drawing 25.6px |

It catches `"the next"` at 39.8px — two tenths under the floor. The tolerance is
0.1px, which is rasteriser noise rather than grace.

## What this cost, and a correction to the record

Three of the panel's four designs are unbuildable as written, and finding that out
took measuring rather than reading:

- **SVG children are flattened.** `translateZ` on an SVG `<g>` under a
  `preserve-3d` ancestor is completely ignored: z=0, z=+200 and z=-200 all paint
  the identical rect. The HTML sibling in the same test moves and scales
  correctly. So "explode a stack on Z" cannot happen inside one `<svg>`, and any
  depth archetype needs sibling HTML elements each carrying their own `<svg>`.
- I got that backwards first. My initial probe put the two rects at different `y`,
  where perspective changes scale on its own, and the confounded reading said Z
  worked. The clean control — same `y`, same geometry, Z the only difference —
  reversed it. Fourth time in one session that a comparison differing in more ways
  than the one being measured produced a confident wrong answer.
- **`getClientRects()` is NOT blind inside `preserve-3d`.** It returns the
  projected AABB. `overprint` can see projected text, so the worst fear about the
  collision gate is unfounded.

## What is still not built

The archetype. What is now true is that when it is built, a tilt that shrinks its
labels below 40 apparent px fails the build loudly instead of shipping quietly.
The next slice is the geometry: sibling HTML planes under a `preserve-3d` scene,
since SVG cannot carry per-element Z.

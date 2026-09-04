# The stack opens, and why it is not per-element Z

**Date** 2026-09-04. The third slice of Gap 2. The roadmap pictures "a stack
exploding"; the design panel concluded that needs sibling HTML planes, because
`translateZ` on an SVG `<g>` is ignored. That was right about the mechanism and
wrong about the need.

## What was measured first

The question worth asking before restructuring 554 lines: **does the tilt already
give real perspective BETWEEN the layers?** If the whole plate leans, a slab
higher up the plate is further from the eye, and should be drawn smaller without
any per-element depth at all.

Measured on a built, tilted deck — the rendered width of each slab:

| slab | width |
| --- | --- |
| 0 (bottom, nearest) | 1118.0 |
| 1 | 1089.1 |
| 2 | 1061.6 |
| 3 (top) | 1067.1 |

Monotonic convergence from 0 to 2, about **5% across the pile**. That is genuine
perspective, not a drawn fake. (Slab 3 reads slightly wider because it is the
highlighted top plane and is drawn with visible thickness, so its box includes the
extrusion.)

So the tilt already buys inter-layer depth. What per-element `translateZ` would
add is a *larger* separation along the view axis — not the existence of
perspective, which is what the roadmap's estimate assumed was missing.

## What was built instead

The gesture, not the geometry. A tilted stack's slabs enter from the **centre
plane of the pile** rather than from a flat 34px drop: layer `i` sits `i * rise`
above `yBase`, so starting it at the centre index is an offset of
`(i - centre) * rise`. Four layers at rise 180 give **-270, -90, +90, +270** —
bottom slabs begin high, top slabs begin low, and each pulls out of the stack into
its own slot as it is revealed.

Under the tilt, with real perspective between the planes, that reads as the pile
opening. Opened a frame mid-entrance rather than trusting it: the top slab is
caught part-way out, still overlapping the slab below and climbing to its place.

**Tied to `tilt` rather than given its own switch.** They are one gesture. A stack
that leans is being shown AS a stack of things, and opening it is what that claim
looks like in motion. Two independent knobs would be two routes to the same
picture and one more thing nothing reaches.

## Cost

Twelve lines in `stack.ts`. Not the 250-350 and a rewritten emit path the panel
priced, because the restructure it priced was for a capability the measurement
says is already mostly present.

## The test was wrong before the code was

`/y: (-?[\d.]+)/` matches the tail of `"opacit`y: 0`"`, so it read every entrance
as starting at zero and would have passed whatever it was handed — including the
flat default it exists to tell apart. It anchors on `[,{]\s*y:` now. A test that
cannot fail is worse than no test, because it is counted.

## What is still not built, and when it would be worth it

True per-element Z, via sibling HTML planes each carrying their own `<svg>`. It
buys a deeper separation than a shared plate can express, and per-layer parallax
under a camera move. Both are real, neither is what "the layers read as stacked in
depth" required, and the measurement above is the reason to defer it rather than
the reason never to do it.

If someone does build it: `translateZ` on an SVG `<g>` under `preserve-3d` is
ignored — z=0, z=+200 and z=-200 paint identical rects, while an HTML sibling in
the same test moves and scales correctly. That is measured, and it is the whole
constraint.

## An operational note, paid for in lost work

This slice was built once already and lost: `~/.blackhole/DeckSmith/2026-09-04/`
was purged mid-session, taking an uncommitted worktree with it. OPERATIONS.md puts
worktrees under that root, and that root is disposable by design. **Commit inside
the worktree as each piece lands, not when the task is done.** A full green test
run is not a save.

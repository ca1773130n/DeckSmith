# The plugin seam, and DrawSVG through it

**Date** 2026-09-04. Gap 1's first slice. `.planning/VOCABULARY.md` names DrawSVG
"the cheapest single win inside this" because it "removes the path-length
requirement entirely", which is arithmetic `drawFrom()` forced the emitter to do
at build time.

## The fact everything rests on, measured rather than quoted

VOCABULARY says all three gaps are downstream of one measured fact: **a plugin's
`render()` fires under `suppressEvents`, an `onUpdate` does not.** It cites a
custom plugin writing path `d`. That is not DrawSVG, and after a day in which two
quoted numbers turned out to be wrong about the deck they described, it was worth
measuring the plugin actually being shipped.

A four-second `drawSVG` tween, driven by the capture path's own call —
`renderSeek(t, { suppressEvents: true })`:

| local t | stroke-dasharray | visibility |
| --- | --- | --- |
| 0.05 | 9.30px | visible |
| 1.00 | 444.3px | visible |
| 2.00 | 894.3px | visible |
| 3.00 | 1344.3px | visible |
| 3.95 | 1764.3px | visible |

Linear, visible throughout. **DrawSVG renders under a suppressed seek.** The claim
holds for the plugin this actually ships.

### Getting there cost three false starts, all the same mistake

The first probe showed the stroke frozen at 0px at every time, then the deck's own
elements frozen too, then the same freeze in an unmodified control — each reading
pointing at a more alarming conclusion than the last.

None of it was real. The deck being probed had been rebuilt **with narration**, so
its scene `s3` starts at **49.346s, not 15s**. Every probe was sampling scene one's
window and finding, correctly, that a scene-three tween had not started.

That is the third time in one day that assuming a tree's state instead of reading
it produced a false alarm — after a `demo/audio/` directory that made two builds
look like a hyperframes regression, and a `3120 of 3120` baseline quoted from a
document instead of measured. **Read `timing.json` before probing a deck by
absolute time.** It costs one command.

## What changed

- `DrawSVGPlugin.min.js` is vendored beside `gsap.min.js` — 4,351 bytes, +6% on
  gsap's 72,779 — and registered in the head **before any scene script runs**,
  because a scene's IIFE builds its timeline inline and a `drawSVG` tween created
  before `registerPlugin` is a tween GSAP does not understand. There is a test on
  that ordering; it would otherwise fail silently with every gate green.
- MorphSVG (21,195) and MotionPath (22,002) are in the same tarball and are **not**
  vendored. Nothing emits them yet, and an unused plugin is 43KB every deck pays
  for. They arrive with the verbs that need them.
- `drawFrom(length)` is gone, and with it the arithmetic that fed it: the polyline
  segment sum in `line-chart`, `perimeter()` in `grid`, `leadLen`, and the
  `Math.hypot(...) + b.w` in `annotated-figure`. Five call sites now emit
  `DRAW_FROM` / `DRAW_TO`.
- The rounding bug `drawFrom`'s comment documented goes with it. GSAP wrote
  `strokeDashoffset` back as an integer, so a leader of length 720.21 rested at
  720 and left 0.21px of dash for `stroke-linecap: round` to paint as a dot — a
  yellow dot on the grid, one reveal before its own region, above the type floor
  and invisible to every gate. A percentage has no remainder to leave.
- `src/verify/drift.ts`'s `frozen_scene` diagnostic no longer tells the reader
  that callback-driven motion "renders still". It does not, as measured earlier
  today; what is true is that a still frame is not evidence either way.

## Verified

- Demo deck builds `PASS — 0 error(s), 9 warning(s)` — the same nine as before.
- Both converted draw-ons advance under capture, read off the built deck:
  `s3-lead0` 0 to 560.281px, `s10-line` 0 to 395.005 to 959.298 to 1015.73px.
- Opened the frame at t=80.0: the chart line is caught mid-draw at T=2.5 with the
  marker ring at the drawing head and T=3 not yet joined. Correct.
- `drift` on the converted deck: see the PR. A new plugin in the render path is
  exactly the kind of change that can cost determinism, so it was not assumed.

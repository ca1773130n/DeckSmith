/**
 * Three drop-in scene fragments, written in the shape `src/emit/kit.ts` already
 * defines: `{ html, tl, setup, holds, css }`. Nothing here needs a new runtime,
 * a new library, or a human. Every statement is a `fromTo` on the scene's own
 * PAUSED timeline, so it is a pure function of t and survives seek-capture.
 *
 * They are expressed as *patches* over the real built composition rather than as
 * toy pages, so a screenshot is of the actual slide the deck ships.
 */

/* ------------------------------------------------------------------ P1: camera
 *
 * A `.ds-cam` wrapper around the content region (never the headline — the
 * headline is the anchor and must stay put and stay above 40px). The camera is
 * one extra element that no other tween touches, so it can own `transform`
 * outright with no cascade fight.
 *
 * `transformOrigin` is the focus point in the camera's own box. An emitter
 * already knows it: `pipeline` computes `cx(i)` for every stage, `grid` computes
 * every region rect, `bar-compare` knows each bar's y. This is geometry the
 * archetype has in hand at emit time, not something measured in a browser.
 */
export function camera(sid, shots) {
  return {
    // wraps the existing content, added by the emitter around what it already builds
    wrap: `<div class="ds-cam" id="${sid}-cam">`,
    // NO `will-change: transform`. Measured: promoting a TEXT-bearing subtree to
    // its own compositor layer and scaling it by a non-integer factor makes the
    // rendered frame non-deterministic under seek — 3 to 5 distinct images for
    // the same t over 5 revisits. Dropping the one declaration gives 1 of 1 at
    // every probe. (A raster subtree is unaffected: the morph below keeps it.)
    // `determinism.mjs` / `det4.mjs` in the parent directory are the harness.
    css: `#${sid}-cam{transform-origin:0 0}`,
    tl: shots.map(
      (s, i) =>
        `tl.fromTo("#${sid}-cam", ` +
        `{ scale: ${s.from.k}, x: ${s.from.x}, y: ${s.from.y} }, ` +
        `{ scale: ${s.to.k}, x: ${s.to.x}, y: ${s.to.y}, duration: ${s.dur}, ease: "${s.ease ?? "power2.inOut"}" }, ` +
        `${s.at});`,
    ),
  };
}

/** Screen-space push: put figure-box `b` (in cam coords) at `k`x, centred on the stage. */
export function push(b, k, stage) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { k, x: stage.w / 2 - cx * k, y: stage.h / 2 - cy * k };
}

/* ------------------------------------------------------- P2: figure morph
 *
 * `annotated-figure` ALREADY positions the plate's <img> from a crop:
 *
 *   width = plan.img.w / crop.w      left = PLATE - crop.x * plan.img.w / crop.w
 *
 * (src/emit/archetypes/annotated-figure.ts:504). So two crops of the same figure
 * are two sets of four numbers, and a morph is the tween between them. Doing it
 * as `transform` rather than left/top/width/height keeps it off the layout path:
 *
 *   with transform-origin 0 0,  scale = A.w / B.w,
 *   x = leftB - leftA,  y = topB - topA
 *
 * WELL-POSEDNESS: a uniform scale can only satisfy both axes when the two crops
 * share an aspect ratio. The emitter must snap B's height to
 * `B.h = B.w * (A.h / A.w)`, which is also what keeps the plate from letterboxing.
 * That constraint is the whole reason this is deterministic rather than fiddly.
 */
export function morph(sid, fig, plate, A, B, { at, dur = 1.1 }) {
  const inner = { w: plate.w - 2 * plate.pad, h: plate.h - 2 * plate.pad };
  const geo = (c) => {
    const w = inner.w / c.w;
    const h = inner.h / c.h;
    return { w, h, left: plate.pad - c.x * w, top: plate.pad - c.y * h };
  };
  const a = geo(A);
  const b = geo(B);
  const k = A.w / B.w;
  const kh = A.h / B.h;
  if (Math.abs(k - kh) > 0.005) {
    throw new Error(`crop aspect mismatch: sx=${k.toFixed(4)} sy=${kh.toFixed(4)} — snap B.h = B.w * A.h / A.w`);
  }
  return {
    css: `#${sid}-plate img{transform-origin:0 0;will-change:transform}`,
    tl: [
      `tl.fromTo("#${sid}-plate img", ` +
        `{ scale: 1, x: 0, y: 0 }, ` +
        `{ scale: ${round(k)}, x: ${round(b.left - a.left)}, y: ${round(b.top - a.top)}, duration: ${dur}, ease: "power2.inOut" }, ${at});`,
    ],
    geo: { a, b, k },
  };
}

const round = (n) => Math.round(n * 10000) / 10000;

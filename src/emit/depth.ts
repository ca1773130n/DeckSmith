/**
 * Tilting a plane, and paying for it in type size.
 *
 * Gap 2 wants depth as exposition — a diagram tilting to reveal a layer. The
 * expensive half is not the transform. It is that perspective shrinks the type on
 * the far half of the plane, and invariant 5 is about what the AUDIENCE sees, so
 * a tilt that leaves a 40px label drawing 31px has broken the floor whatever the
 * source says. `src/verify/apparent.ts` is the gate that catches it; this module
 * is how an archetype avoids tripping it, by declaring bigger type up front.
 *
 * WHAT IS AND IS NOT SUPPORTED HERE. One transform on one plane — the whole
 * scene's content tilts as a unit. NOT per-element depth: measured in Chrome,
 * `translateZ` on an SVG `<g>` under a `preserve-3d` ancestor is ignored
 * completely (z=0, z=+200 and z=-200 paint the identical rect, while an HTML
 * sibling in the same test moves and scales correctly). An exploding stack needs
 * sibling HTML planes and is a later slice; a tilting plate is this one.
 *
 * THE MODEL. For a plane rotated by `t` about its horizontal centre line under
 * CSS `perspective: d`, a point `dy` below the plane's centre is drawn at
 *
 *     scale(dy) = cos(t) * (d / (d - dy * sin(t)))^2
 *
 * — `cos(t)` for the foreshortening and the square for the perspective divide
 * applying to both the glyph's height and its distance from the eye. Fitted
 * against Chrome at `rotateX(30deg)`, `perspective: 1400px`:
 *
 *     dy = -340 (near the top)     model 0.6886   Chrome 0.6820   +0.97%
 *     dy = +360 (near the bottom)  model 1.1404   Chrome 1.1260   +1.28%
 *
 * The model runs about 1% OPTIMISTIC, so `worstScale` rounds its answer down by
 * 2% before anyone divides by it. Erring large costs a couple of type px; erring
 * small ships a slide under the floor, which is the whole failure this exists to
 * prevent.
 */

/** How a scene's plane is tilted. Degrees, and CSS `perspective` in px. */
export interface Pose {
  /** Rotation about the horizontal centre line. Positive tips the top away. */
  rotateX: number;
  /** CSS `perspective`, in reference px. Smaller is a stronger effect. */
  perspective: number;
}

/**
 * The default a depth archetype gets when it asks for one.
 *
 * 12 degrees, not the 30 the spike reached for. The table in `worstScale`'s note
 * is why: at 30 degrees a 40px audience floor needs 67px declared, which is more
 * than a headline can spend and still fit its own line. At 12 it needs 48.7px,
 * which archetypes can and do pay. Depth here is a lean, not a dive.
 */
export const DEFAULT_POSE: Pose = { rotateX: 12, perspective: 1400 };

/** Apparent scale at `dy` reference px below the plane's centre. */
export function scaleAt(pose: Pose, dy: number): number {
  const t = (pose.rotateX * Math.PI) / 180;
  const denom = pose.perspective - dy * Math.sin(t);
  if (denom <= 0) return 0; // The plane has swung through the eye. Refused below.
  return Math.cos(t) * (pose.perspective / denom) ** 2;
}

/** How much the model is discounted before anyone divides by it. See the header. */
const MODEL_SLACK = 0.98;

/**
 * The smallest scale anywhere on a `height`-tall plane, already discounted.
 *
 * The smallest scale is at the TOP edge, furthest from the eye. The BOTTOM edge
 * is the one that can swing through the eye entirely, and when it does the plane
 * is not being tilted any more — it is being turned inside out — so the pose is
 * refused rather than priced. Checking only the top would have returned a
 * perfectly reasonable-looking floor for a pose that cannot be drawn.
 *
 * What it buys, at `perspective: 1400` on a 1080 canvas, AFTER the 2% discount:
 *
 *   rotateX(6)   0.901  ->  a 40px floor needs 44.4px declared
 *   rotateX(12)  0.821  ->  48.7px
 *   rotateX(18)  0.744  ->  53.8px
 *   rotateX(24)  0.669  ->  59.8px
 *   rotateX(30)  0.597  ->  67.0px
 *
 * That table is the tilt budget. Depth in this project is bounded by the type
 * floor rather than by taste, and the bound is tighter than it looks.
 */
export function worstScale(pose: Pose, height: number): number {
  // The near edge first: if it has reached the eye there is no valid projection
  // anywhere on the plane, whatever the far edge says.
  if (scaleAt(pose, height / 2) <= 0) return 0;
  return scaleAt(pose, -height / 2) * MODEL_SLACK;
}

/**
 * The type floor an archetype must solve against to LAND on `floor` once tilted.
 *
 * Archetypes already solve against a floor — `stack` passes `MIN_FONT` into its
 * own fit — so depth costs them one substitution rather than a second solver.
 */
export function tiltedFloor(pose: Pose, height: number, floor: number): number {
  const s = worstScale(pose, height);
  return s > 0 ? floor / s : Number.POSITIVE_INFINITY;
}

/**
 * The CSS a tilted scene needs, scoped to its own id (invariant 3).
 *
 * `perspective` sits on the scene and the rotation on ONE part of it, named by
 * `part`, because tilting a whole scene tilts its chrome too. Built that way
 * first and it was obviously wrong the moment a frame was opened: the headline
 * came out sheared, leaning like a mistake rather than a design, and the stack's
 * probe marker — a straight rule with a dot under it — bent into a hook. The
 * diagram is what gains by leaning; the words are what the audience reads.
 *
 * Nothing here animates: a pose is a static property of the beat, and a tilt that
 * moved would put every label at a different apparent size on every frame while
 * `apparent` only measures at the declared stops.
 */
export function depthCss(sid: string, pose: Pose, part: string): string {
  return [
    `#${sid} { perspective: ${pose.perspective}px; }`,
    `#${sid} ${part} { transform: rotateX(${pose.rotateX}deg); transform-origin: 50% 50%; }`,
  ].join("\n");
}

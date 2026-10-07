/**
 * THE FIT ENGINE'S VOCABULARY — what "full" means, in one place, for both the
 * emitter that predicts it and the gate that measures it.
 *
 * WHY THIS EXISTS. Every archetype's solver could only SHRINK: `BAR_MAX = 96`,
 * `MAX_BOX_H = 340`, a 50px claim, panels capped at their content plus a fifth.
 * Whatever the region had left over, `.scene`'s `justify-content: center` turned
 * into dead air above and below the slide. Measured on v0.8.0 decks (redesign
 * plan 2026-10-07 §1): bar-compare and pipeline fill 51% of the canvas, and
 * about 39% of final holds are hollow. Under `design: "v2"` an archetype GROWS
 * into its region instead — type, marks and gaps, each up to its own cap — and
 * reports how full it predicts the result to be.
 *
 * THE MEASURE: MAIN-AXIS FILL. The body region is the content box below the
 * chrome: `contentW` wide, `contentH - chromeHeight` tall (`bodyRegion`). The
 * main axis is the VERTICAL one, because that is the axis `.scene` stacks the
 * chrome and the body along and therefore the axis every pixel of centring slack
 * lands on — width is already spent by every landscape archetype (bar rails, a
 * pipeline row, split columns all run the full measure), which is exactly why a
 * width-or-height maximum called those slides FULL while they read as a thin
 * band through the middle. So:
 *
 *   fill = (painted extent of the body, top to bottom) / (region height)
 *
 * The body's own top margin is not ink, so a body that uses every pixel it is
 * given reads a little under 1. `verify/fill.ts` measures the same ratio on the
 * rendered frame — pixels, not DOM boxes — and `fit.json` carries this file's
 * prediction beside it, so the model is checked against the browser on every v2
 * build rather than trusted (AGENTS.md: a gate passing is not evidence).
 *
 * THE BANDS are ResearchStudio-Reel's (2607.04438 §A2), with the action the
 * plan assigns each: EMPTY < 0.70 (grow, or the next variant), SPARSE < 0.90
 * (grow to the caps, spread gaps), FULL ≤ 1.00 (leave it), SPILLAGE ≤ 1.10
 * (shrink gaps, then type, toward 40), OVERFLOW beyond (refuse, as today).
 *
 * PURE ARITHMETIC, AND IMPORTS NOTHING FROM AN ARCHETYPE. `title.ts` owns the
 * chrome's type scale and every archetype imports it; a helper here that
 * imported it back would be a cycle. Callers pass the region they computed with
 * `bodyBudget`.
 */
import type { Design } from "../types.js";

/** Below this the frame reads as hollow: a band through the middle of the slide. */
export const EMPTY_BELOW = 0.7;
/** At or above this the region is used; growth stops being worth its cost. */
export const FULL_AT = 0.9;
/** Past the region's bottom edge, into the padding. */
export const SPILL_ABOVE = 1.0;
/** Past this a layout is not tight, it is wrong. */
export const OVERFLOW_ABOVE = 1.1;

export type FillBand = "empty" | "sparse" | "full" | "spillage" | "overflow";

/** Which of the five bands a main-axis fill falls in. */
export function fillBand(fill: number): FillBand {
  if (fill < EMPTY_BELOW) return "empty";
  if (fill < FULL_AT) return "sparse";
  if (fill <= SPILL_ABOVE) return "full";
  if (fill <= OVERFLOW_ABOVE) return "spillage";
  return "overflow";
}

/**
 * What an archetype predicts about its own final hold, in reference px.
 *
 * In memory only — `Scene.fit`, like `Scene.parts`, is never serialised into the
 * composition, so a classic build cannot move a byte because of it. The shell
 * collects it into `fit.json` for v2 builds (`FIT_FILE`).
 */
export interface Fit {
  /** `ink / region`, rounded to three places (invariant 10's precision). */
  fill: number;
  /** Height of the body region: content box below the chrome. */
  region: number;
  /** Predicted painted extent of the body, top of its first mark to bottom of its last. */
  ink: number;
}

/** A prediction, rounded once here so two builds of one storyboard agree to the byte. */
export function fitOf(ink: number, region: number): Fit {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { fill: region > 0 ? r(ink / region) : 0, region: r(region), ink: r(ink) };
}

/**
 * The growth factor the plan names for type and marks: `min(constant × G, …)`.
 *
 * 1.6, from density §2.1 — a 50px claim may set at 72 at most (50 × 1.44 is
 * under it), a 96px bar at 153, a 46px bar label at 73. Each archetype applies
 * it to its OWN caps and then still has to fit the region; G is a ceiling on
 * how far a short beat may be blown up, not a target.
 */
export const GROWTH = 1.6;

/**
 * The largest scale in `[lo, hi]` whose layout height fits `budget`.
 *
 * `height(s)` must be monotone non-decreasing in `s`, which every layout here is:
 * bigger type wraps to at least as many lines and each line is taller. Bisection
 * to 1/128 of a step, then FLOORED onto that grid, so the answer is a short
 * decimal that prints identically on every build (invariant 10) and never
 * exceeds the budget it was solved for. `lo` is returned when even `lo` does not
 * fit — the caller's own overflow refusal is what handles that case, exactly as
 * it did before growth existed.
 */
export function growToFit(
  height: (scale: number) => number,
  budget: number,
  lo = 1,
  hi = GROWTH,
): number {
  if (height(hi) <= budget) return hi;
  if (height(lo) > budget) return lo;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if (height(mid) <= budget) a = mid;
    else b = mid;
  }
  return Math.floor(a * 128) / 128;
}

/**
 * The share of its real measure v2 sets HTML text against when it predicts a
 * line count it is about to GROW into.
 *
 * `wrap` is a width table, and the browser is a line breaker with rules the
 * table does not know: kinsoku keeps `、` and `。` off the start of a line, so a
 * Japanese sentence the table sets on three lines of eleven sets on four of ten.
 * Classic got away with it because nothing it drew was sized to the last line —
 * a 50px claim in a 560px column had air. Growth removes the air on purpose, so
 * a miss of one line becomes a caption pushed 105px through the bottom of the
 * slide: MEASURED on six ja/zh claim-figure and callout beats at 1.08–1.11 fill
 * before this existed. SVG text is exempt — `text()` places its own lines from
 * the same `wrap`, so there the prediction IS the drawing.
 */
export const MEASURE_SLACK = 0.92;

/** Whether this emit is the v2 vocabulary. Absent means classic: every test context, every older caller. */
export function isV2(ctx: { design?: Design }): boolean {
  return ctx.design === "v2";
}

/**
 * The manifest a v2 build writes beside `index.html`, and `verify` reads back.
 *
 * Its PRESENCE is what marks a deck as v2 to the gate: `verify` runs on a deck
 * directory, and the only trustworthy statement about how that deck was built is
 * the one the build wrote into it — the same reasoning `readReserve` gives for
 * `timing.json`.
 */
export const FIT_FILE = "fit.json";

export interface FitManifest {
  design: "v2";
  scenes: { id: string; beat: string; archetype: string; fit?: Fit }[];
}

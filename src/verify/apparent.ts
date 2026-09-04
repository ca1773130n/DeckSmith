/**
 * The type floor, measured on the rendered frame instead of read off the source.
 *
 * `typefloor.ts` scans declared sizes and says so plainly in its own header:
 * "text shrunk by a `scale` below 1 at a hold reads as its unscaled size". That
 * hole is not hypothetical and it is not only about `scale`. Measured in Chrome
 * at `rotateX(30deg)` under `perspective: 1400px`, a run declaring 46px renders
 * 31.4 apparent px near the top of the plane — invariant 5 broken by 8.6px, with
 * `lint`, `check`, `drift` and the declared-size scan all green, because not one
 * of them looks at how big the glyph actually came out.
 *
 * That matters now because Gap 2 wants depth, and every way of tilting a plane
 * shrinks the type on the far half of it. A depth archetype built against a floor
 * that cannot see projection would ship unreadable slides that pass. So the gate
 * comes first and the archetype second.
 *
 * HOW APPARENT SIZE IS MEASURED. For an SVG text node, `getBBox()` is the
 * untransformed box in user units and `getClientRects()` is the painted box in
 * device px, so their ratio is the TOTAL scale between the two — the element's
 * own transform, every ancestor transform, the 3D projection's per-point
 * perspective divide, and the stage zoom, all of it, without having to know which
 * of them applied. Measured against the three cases that matter:
 *
 *   flat, declared 46           ratio 1.000  ->  46.0 apparent px
 *   tilted 30deg, near plane top  0.682  ->  31.4
 *   tilted 30deg, near plane bottom 1.126  ->  51.8   (magnified, not a fault)
 *   `scale(0.6)` at a hold        0.600  ->  27.6
 *
 * `getScreenCTM()` was tried first and rejected: it returns 0.673 for BOTH the
 * top and bottom runs above, because it carries the affine part and drops the
 * perspective divide that makes those two differ by 23 apparent px.
 *
 * WHY IT DIVIDES BY THE STAGE. A deck legitimately scales its whole stage —
 * `zoomOf`/`REF_PULL` — and in portrait 40 reference px is SUPPOSED to land at 30
 * canvas px, which `typefloor.ts` calls "the whole argument of REF_PULL and not a
 * violation". Dividing the run's own ratio by the scene's gives apparent size
 * back in REFERENCE px, so this gate agrees with the declared one on every deck
 * that does nothing clever, and only diverges where something shrank one element
 * relative to its own scene.
 */

import type { Finding } from "../types.js";
import { TYPE_FLOOR_PX } from "./typefloor.js";

/** One text run, as the frame actually drew it. */
export interface ApparentRun {
  /** First 40 characters, for the message. */
  text: string;
  /** `font-size` as declared, in px. */
  declared: number;
  /** Painted height over untransformed height, including the stage's own zoom. */
  ratio: number;
  /** Its own computed opacity, multiplied down the ancestors that carry one. */
  opacity: number;
}

/** What `measureApparent` hands back for one instant. */
export interface ApparentStop {
  sid: string;
  t: number;
  runs: ApparentRun[];
  /** The scene's own painted-over-declared scale, the baseline runs divide by. */
  stage: number;
  /**
   * True at a declared stop, where the frame has arrived and everything drawn is
   * being read. False at a sampled midpoint, where a run may be part-way through
   * its own entrance — see `SETTLED_OPACITY`.
   */
  settled: boolean;
}

/**
 * Serialised into the page: every visible SVG text run's apparent scale.
 *
 * Deliberately the same walk as `collectSvgTextRuns` in overprint.ts — same
 * visibility rules, same "only inside an `<svg>`" restriction — because two gates
 * that disagree about which text exists are two gates that cannot be reconciled
 * when they disagree about a deck.
 */
export function collectApparent(sid: string): { runs: ApparentRun[]; stage: number } {
  const scene = document.querySelector(`[data-composition-id="${CSS.escape(sid)}"]`);
  if (!scene) return { runs: [], stage: 1 };

  // The scene's own painted width over the width it declares. On a flat deck this
  // is exactly the stage zoom, and dividing it out is what makes a portrait deck
  // measure the same as a landscape one.
  const declaredW = Number((scene as HTMLElement).dataset.width ?? 0);
  const sceneRect = scene.getBoundingClientRect();
  const stage = declaredW > 0 && sceneRect.width > 0 ? sceneRect.width / declaredW : 1;

  const runs: ApparentRun[] = [];
  const walk = (el: Element, inSvg: boolean): void => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (Number(style.opacity) === 0) return;
    const within = inSvg || el.tagName.toLowerCase() === "svg";

    if (within && typeof (el as SVGGraphicsElement).getBBox === "function") {
      let hasText = false;
      for (const node of Array.from(el.childNodes))
        if (node.nodeType === 3 && node.textContent?.trim()) hasText = true;
      if (hasText) {
        let box: { height: number } | null = null;
        try {
          box = (el as SVGGraphicsElement).getBBox();
        } catch {
          // A text element with no rendered glyphs throws in some engines. It
          // draws nothing, so it cannot be under the floor.
          box = null;
        }
        const painted = el.getBoundingClientRect().height;
        if (box && box.height > 0 && painted > 0) {
          // Opacity has to be accumulated: a label at `opacity: 1` inside a group
          // fading in at 0.3 is drawn at 0.3, and it is the drawn value that says
          // whether anyone is reading it yet.
          let opacity = 1;
          for (let node: Element | null = el; node; node = node.parentElement) {
            const own = Number(getComputedStyle(node).opacity);
            if (Number.isFinite(own)) opacity *= own;
            if (node === scene) break;
          }
          runs.push({
            text: (el.textContent ?? "").trim().slice(0, 40),
            declared: Number.parseFloat(getComputedStyle(el).fontSize) || 0,
            ratio: painted / box.height,
            opacity,
          });
        }
      }
    }
    for (const child of Array.from(el.children)) walk(child, within);
  };
  walk(scene, false);
  return { runs, stage };
}

/**
 * Apparent size in reference px: what the run declared, times how much the frame
 * shrank or grew it relative to its own scene.
 */
export function apparentPx(run: ApparentRun, stage: number): number {
  if (stage <= 0) return run.declared;
  return (run.declared * run.ratio) / stage;
}

/**
 * How opaque a run must be, at a sampled midpoint, to count as text being read.
 *
 * At a declared stop the frame has arrived and everything drawn counts. Between
 * stops it has not: `annotated-figure` enters its labels from `scale: 0.97`, so
 * a run caught half way through its own entrance is BOTH under the floor and
 * fading in, and failing a build for it would be crying wolf about a frame no
 * one reads. A run at 0.95 opacity is not entering any more; it has arrived.
 */
export const SETTLED_OPACITY = 0.95;

/**
 * The times to sample BETWEEN the declared stops.
 *
 * `fidelity` measures at stops because that is where a frame has settled, and
 * the apparent floor inherited that — which left exactly the hole it was built
 * to close, one interval over: text scaled DOWN between two stops is invisible
 * to a gate that only looks at the stops. A camera pulling back, or an exit that
 * shrinks a label, would ship.
 *
 * Midway between consecutive stops of the SAME scene. Not across a scene
 * boundary, where the midpoint lands in a cross-fade between two compositions
 * and belongs to neither. Costs a seek and a DOM read each — no screenshot,
 * which is what makes doubling the sample count affordable.
 */
export function midpoints(
  stops: readonly { sid: string; t: number }[],
): { sid: string; t: number }[] {
  const out: { sid: string; t: number }[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as { sid: string; t: number };
    const b = stops[i] as { sid: string; t: number };
    if (a.sid !== b.sid || b.t <= a.t) continue;
    out.push({ sid: b.sid, t: Math.round(((a.t + b.t) / 2) * 1000) / 1000 });
  }
  return out;
}

/**
 * Runs the frame drew below the floor, whatever shrank them.
 *
 * An ERROR, not a warning, and for the same reason `typefloor` is: text the
 * audience cannot read is not a matter of degree. The tolerance is a tenth of a
 * pixel, which is rasteriser noise rather than a grace margin — a deck that wants
 * 40px declares 40px and measures 40.0, as the flat control does exactly.
 */
export function gradeApparent(stops: readonly ApparentStop[], floor = TYPE_FLOOR_PX): Finding[] {
  const worst = new Map<string, { sid: string; t: number; text: string; px: number }>();
  for (const stop of stops) {
    for (const run of stop.runs) {
      // Between stops, only text that has finished arriving is text being read.
      if (!stop.settled && run.opacity < SETTLED_OPACITY) continue;
      const px = apparentPx(run, stop.stage);
      if (px >= floor - 0.1) continue;
      const seen = worst.get(run.text);
      if (!seen || px < seen.px)
        worst.set(run.text, { sid: stop.sid, t: stop.t, text: run.text, px });
    }
  }
  if (worst.size === 0) return [];

  // One finding per scene, like `gradeOverprint`, so a tilted deck reports once
  // per scene rather than once per label.
  const byScene = new Map<string, { sid: string; t: number; text: string; px: number }[]>();
  for (const row of worst.values()) {
    const list = byScene.get(row.sid) ?? [];
    list.push(row);
    byScene.set(row.sid, list);
  }
  return [...byScene].map(([sid, rows]) => {
    rows.sort((a, b) => a.px - b.px);
    const smallest = rows[0] as { t: number; text: string; px: number };
    const named = rows
      .slice(0, 3)
      .map((r) => `"${r.text}" at ${Math.round(r.px * 10) / 10}px`)
      .join(", ");
    return {
      severity: "error" as const,
      gate: "apparent",
      rule: "apparent_type_floor",
      // `#${sid}` as a selector, like every other finding here: `scripts/sweep.mjs`
      // reads the selector back to decide which beat a finding belongs to, and a
      // bare id was once filed as a deck-level orphan while the beat reported clean.
      message:
        `#${sid} draws ${rows.length} text run(s) below the ${floor}px floor once the frame is rendered: ` +
        `${named}, at t=${smallest.t}s. Their DECLARED sizes pass — something between the source and the ` +
        `glyph scales them down, a transform at a hold or a 3D projection. Invariant 5 is about what the ` +
        `audience sees, and the declared-size scan cannot see this.`,
    };
  });
}

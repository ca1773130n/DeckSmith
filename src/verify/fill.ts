/**
 * THE FILL GATE — at each scene's last hold, how much of its region did the
 * body actually paint, and did the build predict that?
 *
 * WHY THIS EXISTS. The founder's complaint was "the content doesn't fill the
 * screen", and v0.8.0 passes every gate while doing exactly that: the solvers
 * could only shrink, so a two-bar comparison drew two 96px bars in a ~700px
 * region and `.scene` centred the rest into air. The v2 archetypes grow into
 * their region and PREDICT the result (`Scene.fit`, `src/emit/fit.ts`); a
 * prediction nobody checks is the green-gate-over-wrong-output shape this
 * project keeps producing, so the browser measures the same ratio here, on the
 * frame `fidelity` has already seeked and captured.
 *
 * WHAT IS MEASURED: MAIN-AXIS FILL, IN PIXELS. The region is the room the body
 * was given: `.scene`'s content box less the height of its `.headline` and
 * `.eyebrow` (see `FillRegion` for why that is not "everything under the
 * headline"). The body's extent is the first to the last pixel ROW, from the
 * chrome's bottom edge down to the frame's bottom edge, that holds at least
 * `MIN_ROW_INK` pixels off the frame's modal background (the same
 * background-relative test `fidelity` uses, so it is theme-independent). Fill is
 * that extent over the region's height. Scanning past the content box is
 * deliberate: a body that spills into the padding reads above 1, which is the
 * SPILLAGE band rather than a silently clipped 1.0.
 *
 * PIXELS, NOT DOM BOXES, for the reason `fidelity.ts` gives at length: a
 * wrapper's box is the size of its slot, not of what it shows — `.titleslide` is
 * `height:100%`, `.panels` is `flex:1` — and visibility read off the DOM has been
 * wrong in this project before. A panel wash too close to the background to
 * clear `INK_DELTA` does not count; its border and its text do.
 *
 * ALSO REPORTED, for the eval and never graded: `cross`, the same ratio across
 * the region's width, and `canvas`, the union box of ALL ink on the frame
 * (chrome included) over the frame's area — the "bbox" share the 2026-10-07
 * density audit quoted for bar-compare and pipeline (51%).
 *
 * GRADED ONLY ON A V2 DECK, i.e. one whose build wrote `fit.json`. A classic deck
 * is measured (so the eval can compare the two designs on the same storyboard)
 * but never gets a finding: v0.8.0's verdicts do not move. Both findings are
 * WARNINGS, as the plan's M1 sets them — a new gate starts by reporting:
 *
 *   hollow_at_hold        measured fill under 0.70, the EMPTY band
 *   fill_model_disagrees  |predicted − measured| over 0.20 — the build-time
 *                         arithmetic and the browser disagree, which is a bug
 *                         in the model, not a matter of taste
 */
import { EMPTY_BELOW, type FitManifest } from "../emit/fit.js";
import type { Finding } from "../types.js";

/** A row counts as painted from this many off-background pixels: one is a stray fringe. */
export const MIN_ROW_INK = 2;
/** Predicted and measured fill may differ by this much before the model is called wrong. */
export const FILL_TOLERANCE = 0.2;

/** Device px, in the frame's own coordinates. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The pixel test `fidelity` uses: what counts as ink, and against what. */
export interface InkTest {
  bg: readonly [number, number, number];
  delta: number;
}

interface FrameLike {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}

/**
 * The extent of ink inside `box`, or null when there is none. Pure, so what the
 * gate counts can be tested without a browser.
 *
 * A row is painted when it holds `MIN_ROW_INK` ink pixels between `box.left` and
 * `box.right`; the vertical extent is the first and last such row. The
 * horizontal extent is then read over those rows only, by the same rule turned
 * ninety degrees.
 */
export function inkExtent(frame: FrameLike, test: InkTest, box: Box): Box | null {
  const { width, height, channels, pixels } = frame;
  const [br, bg, bb] = test.bg;
  const x0 = Math.max(0, Math.floor(box.left));
  const x1 = Math.min(width, Math.ceil(box.right));
  const y0 = Math.max(0, Math.floor(box.top));
  const y1 = Math.min(height, Math.ceil(box.bottom));
  const ink = (x: number, y: number): boolean => {
    const i = (y * width + x) * channels;
    return (
      Math.max(
        Math.abs((pixels[i] as number) - br),
        Math.abs((pixels[i + 1] as number) - bg),
        Math.abs((pixels[i + 2] as number) - bb),
      ) > test.delta
    );
  };
  let top = -1;
  let bottom = -1;
  const cols = new Uint32Array(Math.max(0, x1 - x0));
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) {
      if (!ink(x, y)) continue;
      n++;
      cols[x - x0] = (cols[x - x0] as number) + 1;
    }
    if (n < MIN_ROW_INK) continue;
    if (top < 0) top = y;
    bottom = y + 1;
  }
  if (top < 0) return null;
  let left = -1;
  let right = -1;
  for (let x = 0; x < cols.length; x++) {
    if ((cols[x] as number) < MIN_ROW_INK) continue;
    if (left < 0) left = x + x0;
    right = x + x0 + 1;
  }
  if (left < 0) return null;
  return { left, right, top, bottom };
}

/**
 * A scene's body region, as the page reports it: where to LOOK for the body's
 * ink (`top` is the chrome's bottom edge, `bottom` the content box's), and how
 * tall the region IS (`height`).
 *
 * THE TWO DIFFER ON PURPOSE, and the difference is the defect being measured.
 * `.scene` centres its column, so a short body pushes the headline DOWN by half
 * the slack — and a region drawn from the headline's bottom edge to the content
 * bottom silently drops the other half, the band of nothing ABOVE the headline.
 * The first version did exactly that and called a two-bar chart with 250px of
 * empty canvas over its eyebrow 70% full. So the height is the content box less
 * the chrome's own height, wherever the centring put it: the room the body was
 * given, which is the same number `bodyBudget` hands the emitter.
 */
export interface FillRegion extends Box {
  height: number;
  /**
   * The page's own background, `[r, g, b]`, or null when it is not an opaque
   * colour. What "ink" is measured against — see `fillInk`.
   */
  bg: [number, number, number] | null;
}

/**
 * Run IN THE PAGE: the scene's body region, in device px. Null when the scene
 * is not in the document.
 *
 * The content box is `.scene`'s padding box, read off computed style rather
 * than restated from `kit.ts`, so a deck built with a caption reserve (bottom
 * padding grows) is measured against the box it actually laid out in.
 */
export function collectFillRegion(sid: string): FillRegion | null {
  const scene = document.querySelector(`[data-composition-id="${CSS.escape(sid)}"]`);
  if (!scene) return null;
  const r = scene.getBoundingClientRect();
  const cs = getComputedStyle(scene);
  const px = (v: string) => Number.parseFloat(v) || 0;
  // `zoom` scales the padding as it scales everything else; the rect is already
  // in device px, and so are the computed lengths once multiplied through.
  const z = r.width / ((scene as HTMLElement).offsetWidth || r.width);
  const box = {
    left: r.left + px(cs.paddingLeft) * z,
    right: r.right - px(cs.paddingRight) * z,
    top: r.top + px(cs.paddingTop) * z,
    bottom: r.bottom - px(cs.paddingBottom) * z,
  };
  let chromeTop = Number.POSITIVE_INFINITY;
  let chromeBottom = 0;
  for (const el of Array.from(scene.querySelectorAll(".headline, .eyebrow"))) {
    const b = el.getBoundingClientRect();
    if (b.height <= 0) continue;
    chromeTop = Math.min(chromeTop, b.top);
    chromeBottom = Math.max(chromeBottom, b.bottom);
  }
  const content = box.bottom - box.top;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(
    getComputedStyle(document.body).backgroundColor,
  );
  const bg: [number, number, number] | null =
    rgb && (rgb[4] === undefined || Number(rgb[4]) === 1)
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : null;
  return chromeBottom > 0
    ? { ...box, top: chromeBottom, height: content - (chromeBottom - chromeTop), bg }
    : { ...box, height: content, bg };
}

/**
 * The ink test for a fill measurement: the page's declared background when the
 * region reported one, else the frame's modal colour, at `delta`.
 *
 * NOT the modal colour by default, and the reason is this gate's own success.
 * `fidelity` takes the background to be the frame's most common colour, which
 * holds while a slide is mostly air — "80–98% of every frame measured". A v2
 * callout whose panels grew into their region covers MORE of the frame with
 * panel wash than with background; the modal colour is then the panel's, the
 * real background reads as ink, and a 0.95 hold measured 1.107 with a canvas
 * share of 1.0 (HypePaper ko deck 894a874a, s18, 2026-10-07). The body
 * stylesheet says what the background is, so that is what is asked.
 */
export function fillInk(
  region: FillRegion | null,
  modal: readonly [number, number, number],
  delta: number,
): InkTest {
  return { bg: region?.bg ?? modal, delta };
}

/** One scene's last hold, measured. */
export interface FillRow {
  sid: string;
  t: number;
  /** Main-axis (vertical) fill: body ink extent over region height. Above 1 spills. */
  fill: number;
  /** The same across the region's width. Reported, not graded. */
  cross: number;
  /** Union box of every ink pixel on the frame, chrome included, over the frame's area. */
  canvas: number;
  /** Region height in device px — 0 when the scene had no region to measure. */
  region: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Fill at one stop, from a decoded frame and the region the page reported.
 * Pure. A scene with no region (not found) or no ink reads 0, which grades as
 * hollow — "nothing painted below the headline" is exactly what that is.
 */
export function measureFill(
  frame: FrameLike,
  test: InkTest,
  region: FillRegion | null,
  stop: { sid: string; t: number },
): FillRow {
  const whole = inkExtent(frame, test, {
    left: 0,
    right: frame.width,
    top: 0,
    bottom: frame.height,
  });
  const canvas = whole
    ? r3(((whole.right - whole.left) * (whole.bottom - whole.top)) / (frame.width * frame.height))
    : 0;
  if (!region || region.height <= 0) {
    return { ...stop, fill: 0, cross: 0, canvas, region: 0 };
  }
  // Down to the frame's edge, not the region's: spill is measured, not clipped.
  const body = inkExtent(frame, test, { ...region, bottom: frame.height });
  const h = region.height;
  const w = region.right - region.left;
  return {
    ...stop,
    fill: body ? r3((body.bottom - body.top) / h) : 0,
    cross: body ? r3((body.right - body.left) / w) : 0,
    canvas,
    region: Math.round(h),
  };
}

/** The last declared stop of each scene: the final hold the fill is judged at. */
export function finalStops<S extends { sid: string; t: number }>(stops: readonly S[]): S[] {
  const last = new Map<string, S>();
  for (const s of stops) {
    const seen = last.get(s.sid);
    if (!seen || s.t > seen.t) last.set(s.sid, s);
  }
  return [...last.values()];
}

/** Parse `fit.json`. Null when the deck has none — a classic build — or it does not parse. */
export function readFitManifest(text: string | null): FitManifest | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as FitManifest;
    return parsed?.design === "v2" && Array.isArray(parsed.scenes) ? parsed : null;
  } catch {
    return null;
  }
}

/** Findings for a v2 deck's measured fills. Nothing at all for a classic deck. */
export function gradeFill(rows: readonly FillRow[], manifest: FitManifest | null): Finding[] {
  if (!manifest) return [];
  const bySid = new Map(manifest.scenes.map((s) => [s.id, s]));
  const pct = (v: number) => `${Math.round(100 * v)}%`;
  const out: Finding[] = [];
  for (const row of rows) {
    const scene = bySid.get(row.sid);
    const what = scene ? `${scene.archetype} ${scene.beat}` : "?";
    const predicted = scene?.fit?.fill;
    const said = predicted === undefined ? "no prediction" : `predicted ${pct(predicted)}`;
    if (row.fill < EMPTY_BELOW) {
      out.push({
        severity: "warning",
        gate: "fill",
        rule: "hollow_at_hold",
        ...(scene ? { beatId: scene.beat } : {}),
        message: `#${row.sid} (${what}) paints ${pct(row.fill)} of its region's height at its last hold (t=${row.t}s, ${said}); under ${pct(EMPTY_BELOW)} the slide reads as a band through empty space.`,
      });
    }
    if (predicted !== undefined && Math.abs(predicted - row.fill) > FILL_TOLERANCE) {
      out.push({
        severity: "warning",
        gate: "fill",
        rule: "fill_model_disagrees",
        ...(scene ? { beatId: scene.beat } : {}),
        message: `#${row.sid} (${what}): the build predicted ${pct(predicted)} fill and the browser painted ${pct(row.fill)} at t=${row.t}s — the layout arithmetic is wrong for this beat, whatever the slide looks like.`,
      });
    }
  }
  return out;
}

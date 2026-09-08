/**
 * The reshape, and everything a compare-less chart must NOT have gained by it.
 *
 * `line-chart` had no file of its own — its assertions were spread through
 * `archetypes.test.ts` and `emit.test.ts` — and the thing that most needs saying
 * about it now is a negative: a beat with no `compare` emits exactly what it
 * emitted before MorphSVG existed, down to the tween list and the absence of a
 * `plugins` entry. That is the promise `Scene.plugins` is for, and a promise
 * about bytes is only kept by a test that reads the bytes.
 */
import { describe, expect, it } from "vitest";
import { lineChart } from "../src/emit/archetypes/line-chart.js";
import type { EmitContext, Theme, Tween } from "../src/emit/kit.js";
import { faceOf, textWidth } from "../src/emit/svg.js";
import type { BeatOf, Format, Source } from "../src/types.js";
import { beatSchema, FORMATS } from "../src/types.js";

const theme: Theme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#b8c4d2",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
};

function format(id: string): Format {
  const f = FORMATS[id];
  if (!f) throw new Error(`no format "${id}"`);
  return f;
}

const ctx = (sid = "s2"): EmitContext => ({
  source,
  format: format("deck-16x9"),
  theme,
  sid,
  start: 0,
});

type Chart = BeatOf<"line-chart">;

const POINTS = [
  { x: "T=0", y: 28.91 },
  { x: "T=1", y: 29.84 },
  { x: "T=2", y: 30.19 },
  { x: "T=4", y: 30.47 },
];
const BASELINE = [
  { x: "T=0", y: 27.4 },
  { x: "T=1", y: 28.02 },
  { x: "T=2", y: 28.31 },
  { x: "T=4", y: 28.4 },
];

const beat = (params: Chart["params"], seconds = 14): Chart => ({
  id: "b2",
  intent: "Plot the sweep.",
  evidence: [],
  weight: 0.6,
  seconds,
  archetype: "line-chart",
  params,
});

const PLAIN = beat({
  eyebrow: "Ablation",
  headline: "Each extra step buys less",
  xLabel: "Steps",
  yLabel: "PSNR (dB)",
  points: POINTS,
  deltas: ["+0.93", "+0.35", "+0.28"],
});

const COMPARED = beat({
  ...PLAIN.params,
  compare: { label: "Without pretraining", points: BASELINE },
});

/** The one reshape on the timeline, or `undefined` if the beat made none. */
const morphOf = (tl: Tween[]) => tl.find((t) => "morphSVG" in t.to);
/** A tween's scheduled end, which is the only thing "after" can mean here. */
const ends = (t: Tween) => t.at + Number(t.to.duration);

/**
 * The LAST instant a staggered tween is still moving, upper-bounded by `n`.
 *
 * A `Tween` carries a selector rather than the elements it will match, so the
 * stagger's own length is not in it. Overstating `n` can only make this
 * assertion stricter, which is the safe direction for "nothing is still moving
 * at the hold".
 */
const settlesAt = (t: Tween, n: number) => ends(t) + Number(t.to.stagger ?? 0) * Math.max(0, n - 1);

/* ---- the painted boxes, read back out of the svg the same way the gate would */

const FACE = faceOf(theme.fontStack);
const runW = (s: string) => textWidth(s, 40, 400, 0, false, FACE);
/** `.axname` is painted at 500 and `.ghostlab` at 600. Charging either of them
 *  at 400 recovers a box narrower than the one on the page, which is how a
 *  collision test can pass over markup that overprints. */
const nameW = (s: string) => textWidth(s, 40, 500, 0, false, FACE);
const ghostW = (s: string) => textWidth(s, 40, 600, 0, false, FACE);
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** `overlaps` from line-chart.ts, on boxes recovered from the emitted markup. */
const hits = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 8 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 8;

const ghostBox = (html: string): Box | undefined => {
  const m = /id="s2-ghostlab" text-anchor="(start|end)" x="([\d.]+)" y="([\d.]+)">([^<]*)</.exec(
    html,
  );
  if (!m) return undefined;
  const w = ghostW(m[4] as string);
  const cx = Number(m[2]);
  return { x: m[1] === "start" ? cx : cx - w, y: Number(m[3]) - 40, w, h: 40 };
};
const valueBoxes = (html: string): Box[] =>
  [...html.matchAll(/<text class="pv"( text-anchor="start")? x="([\d.]+)" y="([\d.]+)">([^<]*)</g)]
    .map((m) => ({ start: m[1] !== undefined, cx: Number(m[2]), by: Number(m[3]), t: m[4] ?? "" }))
    .map(({ start, cx, by, t }) => {
      const w = runW(t);
      return { x: start ? cx : cx - w / 2, y: by - 40, w, h: 40 };
    });
/** The y-axis NAME, which is on every chart this file emits whatever the data is. */
const axisNameBox = (html: string): Box => {
  const m = /<text class="axname" x="0" y="42">([^<]*)</.exec(html);
  if (!m) throw new Error("no y-axis name in the emitted svg");
  return { x: 0, y: 2, w: nameW(m[1] as string), h: 40 };
};

/** The vertices of one emitted polyline, read straight out of its own `d`. */
const polyline = (html: string, id: string): [number, number][] => {
  const d = new RegExp(`id="s2-${id}"[^>]* d="([^"]+)"`).exec(html)?.[1];
  if (d === undefined) throw new Error(`no path #s2-${id} in the emitted svg`);
  return d.split(" ").map((t) => {
    const [a, b] = t.replace(/^[ML]/, "").split(",").map(Number);
    return [a as number, b as number];
  });
};
/**
 * Whether a polyline is DRAWN THROUGH a box, leg by leg.
 *
 * Deliberately not `curveBand`'s construction. That one argues from the
 * continuity of the whole series — one interval for the range, nothing sampled.
 * This clips each leg to the box's x span and asks about that leg's own y span,
 * which is a different piece of arithmetic reaching the same answer. A test that
 * re-implements the thing it is testing proves only that the code was copied.
 */
const crosses = (pts: [number, number][], b: Box): boolean => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i] as [number, number];
    const [bx, by] = pts[i + 1] as [number, number];
    const lo = Math.max(Math.min(ax, bx), b.x);
    const hi = Math.min(Math.max(ax, bx), b.x + b.w);
    if (hi - lo <= 8) continue;
    const at = (v: number) => (ax === bx ? ay : ay + ((by - ay) * (v - ax)) / (bx - ax));
    const [top, bottom] = [Math.min(at(lo), at(hi)), Math.max(at(lo), at(hi))];
    if (Math.min(b.y + b.h, bottom) - Math.max(b.y, top) > 8) return true;
  }
  return false;
};

/* -------------------------------------------------------- no comparison, no cost */

describe("a line chart with no comparison", () => {
  it("draws one path, names no plugin, and stops once", () => {
    const scene = lineChart(PLAIN, ctx());
    expect(scene.plugins).toBeUndefined();
    expect(scene.html).toContain('<path class="chartline" id="s2-line"');
    expect(scene.html).not.toContain("s2-base");
    expect(scene.html).not.toContain("s2-target");
    expect(scene.html).not.toContain("ghostlab");
    expect(scene.css).not.toContain("ghostlab");
    expect(morphOf(scene.tl)).toBeUndefined();
    expect(scene.holds).toHaveLength(1);
  });

  it("still draws the line on itself, at the position it always did", () => {
    // The compare branch redirects the draw-on to `-base`. This is the assertion
    // that says it redirects nothing when there is no `-base` to redirect to.
    const draw = lineChart(PLAIN, ctx()).tl.find((t) => "drawSVG" in t.to);
    expect(draw?.target).toBe("#s2-line");
    expect(draw?.at).toBe(0.8);
  });
});

/* ------------------------------------------------------------------- the reshape */

describe("a line chart against a baseline", () => {
  const scene = lineChart(COMPARED, ctx());

  it("names morphSVG, and only then", () => {
    expect(scene.plugins).toEqual(["morphSVG"]);
  });

  it("splits the drawn path from the reshaped one", () => {
    // THE HAZARD NO LINT SEES. DrawSVG and MorphSVG write different GSAP
    // properties, so `overlapping_gsap_tweens` would stay quiet about the two of
    // them on one element — while `stroke-dasharray`, left at the old path's
    // length by `drawSVG: 100%`, would leave the tail of a longer reshaped path
    // unpainted. Two elements cannot interact, so the split is the fix.
    const drawn = scene.tl.filter((t) => "drawSVG" in t.to);
    expect(drawn.map((t) => t.target)).toEqual(["#s2-base"]);
    expect(morphOf(scene.tl)?.target).toBe("#s2-line");

    // `-base` and `-line` are authored with the SAME geometry: the copy lifts
    // off the baseline rather than arriving from somewhere else.
    const d = (id: string) => new RegExp(`id="${id}" d="([^"]+)"`).exec(scene.html)?.[1];
    expect(d("s2-base")).toBe(d("s2-line"));
    expect(d("s2-target")).not.toBe(d("s2-line"));
    // Geometry only: present for `querySelector`, painting nothing.
    expect(scene.html).toContain('<path id="s2-target"');
    expect(scene.html).toMatch(/id="s2-target"[^>]*stroke="none"/);
  });

  it("is one fromTo with an explicit self-referential from and a pinned shapeIndex", () => {
    const morph = morphOf(scene.tl);
    // Invariant 2 is the shape of `Tween` itself; what is worth asserting is
    // that the `from` is the element's own shape rather than a bare `to`, which
    // is a `from()` wearing different clothes.
    expect(morph?.from).toEqual({ morphSVG: { shape: "#s2-line", shapeIndex: 0 } });
    expect(morph?.to).toMatchObject({
      morphSVG: { shape: "#s2-target", shapeIndex: 0 },
      duration: 1.2,
    });
    // `"auto"` — MorphSVG's default — SEARCHES for the vertex correspondence at
    // render time, which is a thing two workers can answer differently.
    expect(JSON.stringify(scene.tl)).not.toContain("auto");
    expect(scene.tl.filter((t) => "morphSVG" in t.to)).toHaveLength(1);
  });

  it("scopes every selector to the scene and rounds every time to three decimals", () => {
    for (const t of scene.tl) {
      expect(t.target.startsWith("#s2")).toBe(true);
      expect(t.at).toBe(Math.round(t.at * 1000) / 1000);
      const d = t.to.duration;
      if (typeof d === "number") expect(d).toBe(Math.round(d * 1000) / 1000);
    }
    for (const h of scene.holds) expect(h).toBe(Math.round(h * 1000) / 1000);
  });

  it("reshapes only after the baseline has finished drawing", () => {
    const draw = scene.tl.find((t) => "drawSVG" in t.to) as Tween;
    const morph = morphOf(scene.tl) as Tween;
    expect(morph.at).toBeGreaterThan(ends(draw));
  });

  it("walks the ring only after the reshape has landed", () => {
    // The route comes from `params.points`, so a ring released any earlier
    // rides the FINAL route over an intermediate curve — a marker beside its own
    // line, in frame, above the type floor, and green everywhere.
    const morph = morphOf(scene.tl) as Tween;
    const ring = scene.tl.filter((t) => t.target === "#s2-ring" && "x" in t.to);
    expect(ring.length).toBeGreaterThan(0);
    for (const leg of ring) expect(leg.at).toBeGreaterThanOrEqual(ends(morph));
    // And so do the dots and the values, which mark points on that same curve.
    for (const sel of ["#s2 .dot", "#s2 .pv"]) {
      const t = scene.tl.find((x) => x.target === sel) as Tween;
      expect(t.at).toBeGreaterThanOrEqual(ends(morph));
    }
  });

  it("stops twice: once on the baseline, once on the result", () => {
    // `REVEALS["line-chart"]` promises this, and `test/prompt.test.ts` holds the
    // promise against the emitter. Asserted here as well because the FIRST stop
    // is the whole claim — a baseline drawn and abandoned inside one breath is a
    // comparison nobody was given time to make.
    expect(scene.holds).toHaveLength(2);
    const draw = scene.tl.find((t) => "drawSVG" in t.to) as Tween;
    expect(scene.holds[0]).toBeCloseTo(ends(draw), 9);
    expect(scene.holds[1]).toBeGreaterThan(ends(morphOf(scene.tl) as Tween));
  });
});

/* ------------------------------------------------------------------ the schedule */

describe("a compare schedule against the beat it was planned for", () => {
  /**
   * How many elements each staggered selector will match, so `settlesAt` can be
   * given a bound rather than a guess. Four points, four dots, four values (all
   * four fit at 16:9), three deltas.
   */
  const matched = (target: string) => (target.includes(".dv") ? 3 : 4);

  it("puts every hold on a settled frame, at every length it accepts", () => {
    // THE FAILURE THIS IS FOR. Held at their authored lengths the reshape's spans
    // put the second hold at 6.5s for ANY chart of four points or more, whatever
    // `beat.seconds` said — so at `seconds: 5`, the lower bound `prompt.ts` gives
    // the planner, `holdsWithin` clamped it to 4.85 and the stop landed on one dot
    // of four, one value of four, and the ring parked mid-curve. `beatSeconds`
    // returns the authored value on a silent deck and no verify rule compares a
    // scene's duration to the end of its own timeline, so every gate was green.
    for (let s = 4.9; s <= 14; s = Math.round((s + 0.05) * 100) / 100) {
      for (const readout of [undefined, "Two points of PSNR for one epoch."]) {
        let scene: ReturnType<typeof lineChart>;
        try {
          scene = lineChart(
            beat({ ...COMPARED.params, ...(readout ? { readout } : {}) }, s),
            ctx(),
          );
        } catch {
          // Refused, which is the other half of the contract — asserted below.
          continue;
        }
        const last = scene.holds[scene.holds.length - 1] as number;
        // Inside the window, to `holdsWithin`'s own rounding — and the loop below
        // is what says it got there by fitting rather than by being clamped to it.
        expect(last).toBeLessThanOrEqual(Math.round((s - 0.15) * 100) / 100);
        for (const t of scene.tl) {
          expect(settlesAt(t, matched(t.target))).toBeLessThanOrEqual(last + 1e-9);
        }
      }
    }
  });

  it("compresses rather than truncating, and stops compressing once it fits", () => {
    const holds = (s: number) => lineChart(beat(COMPARED.params, s), ctx()).holds;
    // Short: both stops move in, and the first one — the baseline standing alone
    // — arrives earlier because the draw-on is the span that gives first.
    expect(holds(5)).toEqual([1.8, 4.85]);
    expect(holds(6)).toEqual([1.95, 5.85]);
    // Long: the authored schedule, unchanged, however much room is left over.
    expect(holds(7)).toEqual([2.6, 6.5]);
    expect(holds(12)).toEqual(holds(7));
    expect(holds(14)).toEqual(holds(7));
  });

  it("drops the comparison, not the beat, when the beat is too short for it", () => {
    // THIS USED TO THROW, AND THAT WAS THE WRONG LOUD. A throw reaches
    // `onBeatError`, which drops the SLIDE — so a beat the planner wrote a
    // little short lost its data as well as its reshape. The floors run 4.35s
    // (two points, no deltas, no readout) to 6.65s (twelve with one), and the
    // shortest committed planner output,
    // experiments/013-vocabulary/planner/runs/B0-02/out.json, authors its eleven
    // beats at 4.6 to 6.5 seconds — four of them under the 5.7s a four-point
    // comparison with a readout needs, all eleven under a twelve-point one's.
    const short = lineChart(beat(COMPARED.params, 4.5), ctx());
    expect(short.warnings).toEqual([
      'line-chart b2: a comparison against "Without pretraining" over 4 points needs 4.9s ' +
        "and the beat is 4.5s, so the chart was drawn without it. Lengthen the beat to keep " +
        "the comparison.",
    ]);
    // AND WHAT IS DRAWN IS THE PLAIN CHART, not something assembled here to
    // resemble one: the emitter re-enters itself with `compare` removed, so the
    // degraded scene and a chart authored without a baseline are one output.
    const plain = lineChart(beat(PLAIN.params, 4.5), ctx());
    expect(short.html).toBe(plain.html);
    expect(short.tl).toEqual(plain.tl);
    expect(short.css).toBe(plain.css);
    expect(short.holds).toEqual(plain.holds);
    // The property `Scene.plugins` exists for. No reshape, so no name, so the
    // head vendors none of MorphSVG's 21,195 bytes — asserted at the composition
    // in `test/emit.test.ts`, and here at the seam that decides it.
    expect(short.plugins).toBeUndefined();
    expect(morphOf(short.tl)).toBeUndefined();
    expect(short.html).not.toContain("ghostlab");
    expect(short.html).not.toContain("s2-target");
    // A readout costs its own 0.8s, so the floor moves with it.
    const readout = lineChart(
      beat({ ...COMPARED.params, readout: "Two points for one epoch." }, 5),
      ctx(),
    );
    expect(readout.warnings?.[0]).toMatch(/needs 5\.7s and the beat is 5s/);
    // And one centisecond above the floor nothing is given up and nothing is said.
    const kept = lineChart(beat(COMPARED.params, 4.9), ctx());
    expect(kept.warnings).toBeUndefined();
    expect(kept.plugins).toEqual(["morphSVG"]);
  });

  it("leaves a chart with no comparison on the schedule its bytes are pinned to", () => {
    // `test/wiring.test.ts` holds an un-reshaped deck against a digest taken
    // before any of this existed. The fitting is compare-only for that reason.
    for (const s of [5, 8, 14]) expect(lineChart(beat(PLAIN.params, s), ctx()).holds).toEqual([3]);
    const draw = lineChart(PLAIN, ctx()).tl.find((t) => "drawSVG" in t.to) as Tween;
    expect(draw.to.duration).toBe(1.8);
  });

  it("paces the ring by the values it is walking, not by a draw-on that is over", () => {
    // The ring rides the STROKE when there is one. With a comparison the curve is
    // already whole, so it paces the values instead — and a hardcoded 1.8 is only
    // the same span while `step` is at its authored 0.45. On a compressed beat it
    // parked the ring mid-curve at the hold: on the line, in frame, green.
    const scene = lineChart(beat(COMPARED.params, 5), ctx());
    const legs = scene.tl.filter((t) => t.target === "#s2-ring" && "x" in t.to);
    const leave = scene.tl.filter((t) => t.target === "#s2-ring" && t.to.opacity === 0);
    expect(legs.length).toBeGreaterThan(0);
    expect(leave).toHaveLength(1);
    const last = scene.holds[scene.holds.length - 1] as number;
    expect(ends(leave[0] as Tween)).toBeLessThanOrEqual(last);
    for (const leg of legs) expect(ends(leg)).toBeLessThanOrEqual(last);
  });
});

/* ---------------------------------------------------------------------- the ghost */

describe("the baseline's label", () => {
  it("is drawn, named by the plan, and kept inside the plot", () => {
    const scene = lineChart(COMPARED, ctx());
    expect(scene.html).toContain(">Without pretraining</text>");
    expect(scene.css).toContain(".ghostlab{font-size:40px");
    const m = /id="s2-ghostlab" text-anchor="end" x="([\d.]+)" y="([\d.]+)"/.exec(scene.html);
    expect(m).not.toBeNull();
    const [, xs, ys] = m as RegExpExecArray;
    const height = Number(/height="(\d+)" viewBox/.exec(scene.html)?.[1]);
    // End-anchored on the last x, so it spans leftwards and cannot hang past the
    // right pad the way a middle-anchored label on that x would. A 40px baseline
    // must also clear the top of the svg by its own cap height.
    expect(Number(xs)).toBeLessThanOrEqual(Number(/width="(\d+)" height=/.exec(scene.html)?.[1]));
    expect(Number(ys)).toBeGreaterThanOrEqual(44);
    expect(Number(ys)).toBeLessThan(height);
  });

  it("goes on the side of the baseline away from the result, either way round", () => {
    const yOf = (html: string) =>
      Number(/id="s2-ghostlab"[^>]*y="([\d.]+)"/.exec(html)?.[1] ?? Number.NaN);
    const lastBaseline = (html: string) =>
      Number(/id="s2-base" d="[^"]*[ ,](\d+(?:\.\d+)?)"/.exec(html)?.[1] ?? Number.NaN);

    const below = lineChart(COMPARED, ctx()).html;
    expect(yOf(below)).toBeGreaterThan(lastBaseline(below));

    // The same beat with the baseline ABOVE the result: the label follows it.
    const above = lineChart(
      beat({
        ...COMPARED.params,
        compare: {
          label: "Without pretraining",
          points: POINTS.map((p) => ({ ...p, y: p.y + 3 })),
        },
        points: POINTS,
      }),
      ctx(),
    ).html;
    expect(yOf(above)).toBeLessThan(lastBaseline(above));
  });

  it("never prints through a value label, on either of the two measured collisions", () => {
    // BOTH OF THESE WERE MEASURED ON THIS EMITTER before the ghost was routed
    // through `valueBoxes`. The first put the ghost's baseline at y=578.64 and
    // the last value "1.1" at y=590.2, both at x=1645 — two 40px runs printing
    // through each other, inside the frame, above the type floor, and invisible
    // to every layout gate. The second overlapped the last `.pv` by 32.3px
    // vertically and ~55px horizontally. `fitIndices` FORCE-KEEPS the last index,
    // so the endpoint's value is always there to be hit, which is why this fires
    // exactly when the two series converge — the shape a comparison is about.
    const converging: [string, number[], number[]][] = [
      ["loss", [2.0, 1.5, 1.2, 1.1], [2.0, 1.7, 1.35, 1.12]],
      ["psnr", [28.91, 29.84, 30.19, 30.47], [26.2, 28.02, 29.6, 30.55]],
      // And the third reviewer's: the ghost spans its own width sideways, so a
      // steep final segment draws the baseline through the label naming it.
      ["steep", [40, 55, 70, 99], [10, 11, 12, 95]],
    ];
    for (const [name, points, cmp] of converging) {
      const scene = lineChart(
        beat({
          headline: "Each extra step buys less",
          xLabel: "Steps",
          yLabel: "Loss",
          points: points.map((y, i) => ({ x: `T=${i}`, y })),
          compare: { label: "Baseline", points: cmp.map((y, i) => ({ x: `T=${i}`, y })) },
        }),
        ctx(),
      );
      const g = ghostBox(scene.html);
      // Dropped is a fine answer — `deltasFit` drops annotations for the same
      // reason. What is not fine is a name printed through a number.
      if (!g) {
        expect(scene.css).not.toContain("ghostlab");
        expect(scene.tl.some((t) => t.target.includes("ghostlab"))).toBe(false);
        continue;
      }
      for (const v of valueBoxes(scene.html)) {
        expect({ name, hit: hits(g, v) }).toEqual({ name, hit: false });
      }
    }
  });

  it("never prints through the y-axis name, which is on the chart whatever the data is", () => {
    // THE CANDIDATE SET GREW AND THE COLLISION SET DID NOT. `valueBoxes` and
    // `deltaBoxes` are what the DATA puts on the plot; the y-axis name is set at
    // the svg's top-left on every chart this file has ever emitted, and a
    // first-x candidate is `start`-anchored at x=150 with its baseline clamped
    // up to at least 44 — so the two share a band by construction.
    //
    // MEASURED on this emitter: both last-x candidates are blocked here, the
    // ghost falls through to the first x, the away side clamps to 70, and
    // `<text class="ghostlab" … text-anchor="start" x="150" y="70">` ran through
    // "PSNR (dB)" at x 0-204.87, y 2-42. 54.87px across, 12px down.
    const scene = lineChart(
      beat({
        headline: "Each extra step buys less",
        xLabel: "Steps",
        yLabel: "PSNR (dB)",
        points: [80, 60, 45, 40].map((y, i) => ({ x: `T=${i}`, y })),
        compare: {
          label: "Baseline",
          points: [100, 55, 70, 42].map((y, i) => ({ x: `T=${i}`, y })),
        },
      }),
      ctx(),
    );
    const g = ghostBox(scene.html);
    // Dropped is the answer here, and a fine one — `deltasFit` drops annotations
    // the same way. Asserted as "not overprinting" rather than as "dropped" so
    // that a later clamp which finds it somewhere clear still passes.
    if (g) expect(hits(g, axisNameBox(scene.html))).toBe(false);
    else expect(scene.css).not.toContain("ghostlab");
  });

  it("never prints through either curve, on the steep segment that measured it", () => {
    // THE LABEL SPANS ITS OWN WIDTH SIDEWAYS, so a leg steep enough to climb
    // through that span draws the baseline across the name of the baseline —
    // and neither `valueBoxes` nor `deltaBoxes` can see it, because a curve is
    // not a label. Read back off the emitted `d` rather than recomputed, and
    // asked leg by leg rather than by `curveBand`'s continuity argument.
    //
    // THE SHAPES, each read off the emitted `y=` with the curve half of the
    // predicate in place and then disabled. `steep` is the one that exercises
    // this: with the check the ghost goes to the first x, `text-anchor="start"
    // x="150" y="668.2"`; without it the last-x candidate at `x="1645"
    // y="176.9"` is accepted and drawn straight through both curves. `psnr` is
    // the second — it drops entirely with the check and takes the last x at
    // `x="1627" y="287.68"` without it. `loss` is the control: its placement is
    // decided by `valueBoxes`, and it stays at `x="1645" y="656.64"` either way.
    const shapes: [string, number[], number[]][] = [
      ["steep", [40, 55, 70, 99], [10, 11, 12, 95]],
      ["psnr", [28.91, 29.84, 30.19, 30.47], [26.2, 28.02, 29.6, 30.55]],
      ["loss", [2.0, 1.5, 1.2, 1.1], [2.0, 1.7, 1.35, 1.12]],
    ];
    for (const [name, points, cmp] of shapes) {
      const { html, css } = lineChart(
        beat({
          headline: "Each extra step buys less",
          xLabel: "Steps",
          yLabel: "Loss",
          points: points.map((y, i) => ({ x: `T=${i}`, y })),
          compare: { label: "Baseline", points: cmp.map((y, i) => ({ x: `T=${i}`, y })) },
        }),
        ctx(),
      );
      const g = ghostBox(html);
      if (!g) {
        expect(css).not.toContain("ghostlab");
        continue;
      }
      // `-base` carries the baseline's geometry and `-target` the result's, and
      // between them they are every shape a stroke is ever painted along here.
      for (const id of ["base", "target"]) {
        expect({ name, id, through: crosses(polyline(html, id), g) }).toEqual({
          name,
          id,
          through: false,
        });
      }
    }
  });

  it("charges the compare label the weight it is painted at, not a lighter one", () => {
    // `.ghostlab` sets font-weight:600, and the refusal measured it with `runW`
    // at 400 — so a label the plot cannot hold was accepted and then printed
    // past the axis, which is the one thing the refusal exists to stop.
    //
    // MEASURED here, deck-16x9: at 75 characters this label is 1440.41px at 400
    // and 1483.63px at 600, and the plot is 1477px wide. One weight fits and the
    // other does not, which is what makes this case discriminate: charged at 400
    // the emitter accepts it, charged at 600 it refuses.
    //
    // The same mismatch has bitten this file's neighbours before — the
    // perturbation sweep found `stack` measured at 600 and drawn at 700, whose
    // second line printed through the note beneath it.
    const label = "Without pretraining ".repeat(20).slice(0, 75).trim();
    expect(() =>
      lineChart(beat({ ...COMPARED.params, compare: { label, points: BASELINE } }), ctx()),
    ).toThrow(/compare label/);
  });

  it("refuses a label too wide for the plot rather than printing it past the axis", () => {
    expect(() =>
      lineChart(
        beat({
          ...COMPARED.params,
          compare: {
            label:
              "Without pretraining, on the smaller corpus, at half the batch size and one seed",
            points: BASELINE,
          },
        }),
        ctx(),
      ),
    ).toThrow(/compare label/);
  });
});

/* --------------------------------------------------------------------- the axis */

describe("the scale under a comparison", () => {
  it("spans both series, so the baseline is drawn inside its own plot", () => {
    const scene = lineChart(COMPARED, ctx());
    // The baseline's low point is 27.4 against the main series' 28.91: a scale
    // fitted to `points` alone would put it below the axis, outside the svg, and
    // every gate would be green over a curve half off the slide.
    const ys = [...scene.html.matchAll(/id="s2-base" d="([^"]+)"/g)]
      .flatMap((m) => (m[1] as string).match(/[ ,](\d+(?:\.\d+)?)/g) ?? [])
      .map((s) => Number(s.slice(1)));
    const height = Number(/height="(\d+)" viewBox/.exec(scene.html)?.[1]);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeLessThan(height);
  });
});

/* --------------------------------------------------------------------- the plan */

describe("a compare beat as the planner would write it", () => {
  const raw = {
    id: "b2",
    intent: "Show what pretraining buys.",
    archetype: "line-chart",
    seconds: 14,
    params: COMPARED.params,
  };

  it("round-trips through beatSchema", () => {
    const parsed = beatSchema.parse(raw);
    expect(parsed.archetype).toBe("line-chart");
    expect(
      (parsed as Extract<typeof parsed, { archetype: "line-chart" }>).params.compare?.label,
    ).toBe("Without pretraining");
  });

  it("refuses a comparison over different x values", () => {
    const wrong = {
      ...raw,
      params: {
        ...COMPARED.params,
        compare: { label: "L", points: BASELINE.map((p, i) => (i ? p : { ...p, x: "T=9" })) },
      },
    };
    expect(beatSchema.safeParse(wrong).success).toBe(false);
  });
});

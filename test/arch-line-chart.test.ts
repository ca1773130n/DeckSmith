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

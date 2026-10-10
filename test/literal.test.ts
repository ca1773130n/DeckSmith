/**
 * Literal scenes (src/literal/): the maths the layers are computed
 * with, and the fragments' obedience to the deck's invariants. No ffmpeg and
 * no browser: the layers are synthetic.
 */
import { describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import {
  literalFragment,
  literalPlanOf,
  literalPlanSchema,
  sentenceCues,
} from "../src/literal/index.js";
import { GRID, spikeOutput } from "../src/literal/kinds/spikes.js";
import {
  boxBlur,
  type Cue,
  haze,
  type Layers,
  LEAK,
  lif,
  luma,
  type Rgb,
  STEPS,
  sobel,
  THETA,
} from "../src/literal/kit.js";
import { sourceSchema, storyboardSchema } from "../src/types.js";
import { slotsFor } from "./literal-fixtures.js";

const theme: Theme = {
  bg: "#f6f3ec",
  fg: "#151515",
  muted: "#666666",
  dim: "#999999",
  rule: "#cccccc",
  panel: "#ffffff",
  accent: "#d0451b",
  tones: { a: "#d0451b", b: "#2c6bd6", c: "#2a9d63", d: "#8a5cc2" },
  fontStack: "Inter, sans-serif",
};

function picture(w: number, h: number): Rgb {
  const d = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) d[(y * w + x) * 3 + c] = ((x * 7 + y * 13 + c * 5) % 17) / 16;
  return { w, h, d };
}

describe("literal maths", () => {
  it("haze scales every Sobel edge by exactly t: the airlight is a constant", () => {
    const J = picture(24, 16);
    const t = 0.35;
    const clear = sobel(luma(J), 24, 16);
    const hazy = sobel(luma(haze(J, t, [0.84, 0.86, 0.88])), 24, 16);
    for (let i = 0; i < clear.length; i++) expect(hazy[i]).toBeCloseTo((clear[i] as number) * t, 5);
  });

  it("an LIF neuron below θ(1−λ) never fires, and fires without the leak", () => {
    const x = 0.9 * THETA * (1 - LEAK);
    expect(lif(x, STEPS, LEAK, THETA).spikes).toEqual([]);
    expect(lif(x, STEPS, 1, THETA).spikes.length).toBeGreaterThan(0);
    const strong = lif(1.2 * THETA, STEPS, LEAK, THETA);
    expect(strong.spikes.length).toBe(STEPS);
    // Soft reset: the potential after a spike is the overshoot.
    expect(strong.post[0]).toBeCloseTo(0.2, 6);
  });

  it("box blur keeps a flat field flat", () => {
    const f = new Float32Array(30).fill(0.5);
    for (const v of boxBlur(f, 6, 5, 2)) expect(v).toBeCloseTo(0.5, 6);
  });
});

const cues: Cue[] = [
  { t0: 0.95, t1: 7.7 },
  { t0: 7.8, t1: 15.9 },
  { t0: 15.9, t1: 22.1 },
];
const region = { width: 1700, height: 746 };
const spec = (kind: "haze" | "spikes" | "sobel") => ({
  kind,
  takeaway: "t",
  labels: slotsFor(kind),
});

function layersFor(kind: "haze" | "spikes" | "sobel"): Layers {
  if (kind === "haze")
    return {
      files: { clear: "c.jpg", hazy: "h.jpg", edgeClear: "ec.png", edgeHazy: "eh.png" },
      data: {
        row: 300,
        profile: Array.from({ length: 120 }, (_, i) => (i % 9) / 9),
        air: 0.86,
        t: 0.35,
      },
    };
  if (kind === "spikes") {
    const n = GRID.cols * GRID.rows;
    const x = Array.from({ length: n }, (_, i) => (i % 10) / 10);
    const run = (v: number) => lif(v, STEPS, LEAK, THETA);
    return {
      files: { hazy: "h.jpg" },
      data: {
        cols: GRID.cols,
        rows: GRID.rows,
        x,
        counts: x.map((v) => run(v * 1.4).spikes.length),
        out: spikeOutput(
          x.map((v) => run(v * 1.4).spikes.length),
          1.4,
        ),
        steps: STEPS,
        theta: THETA,
        witnesses: [9, 5, 1].map((cell) => ({
          cell,
          ...run((x[cell] as number) * 1.4),
          noLeak: lif((x[cell] as number) * 1.4, STEPS, 1, THETA),
        })),
      },
    };
  }
  return {
    files: { hazy: "h.jpg", edges: "e.png", feat: "f.png", featS: "fs.png", featW: "fw.png" },
    data: {},
  };
}

describe("what reaches the next layer, and when", () => {
  it("a cell passes on no more than it was given: the output map is on the input's scale", () => {
    const gain = 1.4;
    const x = Array.from({ length: 50 }, (_, i) => i / 49);
    const out = spikeOutput(
      x.map((v) => lif(v * gain, STEPS, LEAK, THETA).spikes.length),
      gain,
    );
    for (const [i, v] of x.entries()) expect(out[i] as number).toBeLessThanOrEqual(v + 1e-9);
    // The weak cells pass nothing; the strong ones keep most of what they were given.
    expect(out[5]).toBe(0);
    expect(out[49] as number).toBeGreaterThan(0.5);
  });

  it("a scene's steps follow its spoken sentences, not the subtitle lines a long one is split into, nor the stops", () => {
    const timing = {
      scenes: [{ id: "s17", start: 297.876, duration: 28.228, holds: [], open: 0.9 }],
      segments: [
        {
          id: "s17.0",
          scene: "s17",
          start: 298.776,
          cues: [
            { start: 0.05, end: 5.5636, text: "TM-LIF와 SSM을 각각 제거하고," },
            { start: 5.5636, end: 10.787, text: "구분할 수 있다." },
          ],
        },
        {
          id: "s17.1",
          scene: "s17",
          start: 309.576,
          // One stop, two sentences (a stage beat speaks all of its in one): two steps.
          cues: [
            { start: 0.05, end: 4, text: "단계 수를 바꾼다." },
            { start: 4, end: 8.35, text: "상충 관계를 본다." },
          ],
        },
        { id: "s16.3", scene: "s16", start: 290, cues: [{ start: 0, end: 2, text: "x" }] },
      ],
    };
    expect(sentenceCues(timing as never, "s17")).toEqual([
      { t0: 0.95, t1: 11.687 },
      { t0: 11.75, t1: 15.7 },
      { t0: 15.7, t1: 20.05 },
    ]);
  });
});

describe("literal fragments obey the deck's invariants", () => {
  for (const kind of ["haze", "spikes", "sobel"] as const) {
    const f = literalFragment(kind, layersFor(kind), region, cues, spec(kind), theme);

    it(`${kind}: every tween is fromTo, scoped to the scene (invariants 2, 3)`, () => {
      const calls = f.script.match(/tl\.\w+\(/g) ?? [];
      expect(calls.length).toBeGreaterThan(5);
      expect(new Set(calls)).toEqual(new Set(["tl.fromTo("]));
      for (const m of f.script.matchAll(/tl\.fromTo\("([^"]+)"/g))
        expect(m[1]).toMatch(/^#SCENEID-[\w-]+$/);
      for (const id of f.script.matchAll(/tl\.fromTo\("#(SCENEID-[\w-]+)"/g))
        expect(f.markup).toContain(`id="${id[1]}"`);
    });

    it(`${kind}: no callbacks, no clock, no randomness (invariants 4, 11)`, () => {
      expect(f.script).not.toMatch(/on(Update|Start|Complete|Repeat)|Date\.now|Math\.random|fetch/);
    });

    it(`${kind}: no text under 40px (invariant 5) and no layer outside assets/literal`, () => {
      const sizes = [...f.markup.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(40);
      for (const m of f.markup.matchAll(/src="([^"]+)"/g))
        expect(m[1]).toMatch(/^assets\/literal\//);
    });

    it(`${kind}: times and durations rounded to 3 decimals (invariant 10)`, () => {
      for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
        expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
      for (const m of f.script.matchAll(/"duration":(\d+\.\d+)/g))
        expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
    });

    it(`${kind}: every word is the plan's; a required slot left out is refused`, () => {
      const labels = slotsFor(kind);
      const first = Object.keys(labels).find((k) => k !== "eyebrow") as string;
      delete labels[first];
      expect(() =>
        literalFragment(kind, layersFor(kind), region, cues, { ...spec(kind), labels }, theme),
      ).toThrow(new RegExp(`needs the label slot "${first}"`));
    });
  }

  it("the Sobel kernel slides inside the picture, never past its left edge", () => {
    const f = literalFragment("sobel", layersFor("sobel"), region, cues, spec("sobel"), theme);
    const left = Number(
      /id="SCENEID-kernel" style="position:absolute;left:(-?\d+)px/.exec(f.markup)?.[1],
    );
    expect(left).toBeGreaterThanOrEqual(0);
    // The darkening is the swept part's own background, not a sheet over the unswept picture.
    expect(f.markup).not.toContain("SCENEID-dim");
  });

  it("a plan names a kind and a takeaway per beat", () => {
    expect(() =>
      literalPlanSchema.parse({
        image: "a.png",
        beats: { b1: { kind: "metaphor", takeaway: "x" } },
      }),
    ).toThrow();
    expect(
      literalPlanSchema.parse({ image: "a.png", beats: { b1: { kind: "haze", takeaway: "x" } } })
        .beats.b1?.labels,
    ).toEqual({});
  });
});

describe("the plan a storyboard carries", () => {
  const source = sourceSchema.parse({
    id: "s",
    title: "t",
    sections: [{ id: "sec1", depth: 1, heading: "h", text: "x" }],
    figures: [{ id: "gen-b01", src: "gen-b01-abc.png", caption: "c", width: 8, height: 8 }],
    equations: [],
    tables: [],
  });
  const board = (literal: unknown, figureId?: string) =>
    storyboardSchema.parse({
      sourceId: "s",
      title: "t",
      beats: [
        {
          id: "b01",
          intent: "haze fades the edges",
          takeaway: "Haze scales every edge by t.",
          archetype: "stage",
          params: {
            headline: "h",
            placement: "center",
            ...(figureId ? { figureId } : { illustration: { prompt: "p", caption: "c" } }),
          },
          literal,
        },
        {
          id: "b02",
          intent: "spikes",
          archetype: "kinetic",
          params: { headline: "k", phrases: [{ text: "a" }, { text: "b" }] },
          literal: { kind: "spikes", picture: "b01" },
        },
      ],
    });

  it("takes each literal beat's kind, takeaway, labels and picture file from the storyboard", () => {
    const plan = literalPlanOf(
      board({ kind: "haze", picture: "b01", labels: [{ slot: "clear", text: "맑음" }] }, "gen-b01"),
      source,
      "/deck/assets",
    );
    expect(plan.beats.b01).toEqual({
      kind: "haze",
      takeaway: "Haze scales every edge by t.",
      labels: { clear: "맑음" },
      image: "/deck/assets/gen-b01-abc.png",
    });
    // No takeaway: the intent stands in, so the report still says what was meant.
    expect(plan.beats.b02?.takeaway).toBe("spikes");
    expect(plan.beats.b02?.image).toBe("/deck/assets/gen-b01-abc.png");
    expect(literalPlanSchema.parse(plan)).toEqual(plan);
  });

  it("fails loudly when the picture beat has no figure yet", () => {
    expect(() =>
      literalPlanOf(board({ kind: "haze", picture: "b01" }), source, "/deck/assets"),
    ).toThrow(/b01 runs on the picture of "b01", which has no figure.*illustrate/);
  });
});

/**
 * Literal scenes (src/bespoke/literal.ts): the maths the layers are computed
 * with, and the fragments' obedience to the deck's invariants. No ffmpeg and
 * no browser: the layers are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  boxBlur,
  type Cue,
  GRID,
  haze,
  type Layers,
  LEAK,
  lif,
  literalFragment,
  literalPlanSchema,
  luma,
  type Rgb,
  STEPS,
  sobel,
  THETA,
} from "../src/bespoke/literal.js";
import type { Theme } from "../src/emit/kit.js";

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
const spec = (kind: "haze" | "spikes" | "sobel") => ({ kind, takeaway: "t", labels: {} });

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

    it(`${kind}: times rounded to 3 decimals (invariant 10)`, () => {
      for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
        expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
    });
  }

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

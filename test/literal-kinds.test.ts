/**
 * The literal kinds beyond haze/spikes/sobel (src/bespoke/literal-kinds.ts):
 * the maths each one computes, and every fragment's obedience to the deck's
 * invariants. Synthetic layers; no ffmpeg, no browser.
 */
import { describe, expect, it } from "vitest";
import {
  ALPHA,
  avgPool,
  type Cue,
  darkChannel,
  dcp,
  emaThresholds,
  fitColumns,
  fixedBackbone,
  haze,
  type Layers,
  LEVELS_D,
  literalFragment,
  MOMENTUM,
  type Rgb,
  rowSteps,
  stepStarts,
  structureMap,
  tmQuantize,
  upsample,
} from "../src/bespoke/literal.js";
import type { Theme } from "../src/emit/kit.js";
import type { LITERAL_KIND_NAMES } from "../src/types.js";

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

describe("the dark channel prior, run for real", () => {
  // A scene whose every 5×5 patch holds a pixel with a zero channel: the prior holds exactly.
  function priorScene(w: number, h: number): Rgb {
    const d = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        d[i] = 0.3 + (0.4 * ((x * 3 + y) % 7)) / 7;
        d[i + 1] = 0.2 + (0.5 * ((x + y * 5) % 5)) / 5;
        d[i + 2] = (x + y) % 3 === 0 ? 0 : 0.4;
      }
    return { w, h, d };
  }

  it("the dark channel of a scene that obeys the prior is zero", () => {
    for (const v of darkChannel(priorScene(24, 16), 2)) expect(v).toBe(0);
  });

  it("recovers the transmission the haze was made with, where the prior holds", () => {
    // A strip of sky (as bright as the airlight) gives the airlight; below it the prior holds.
    const w = 60;
    const h = 48;
    const J = priorScene(w, h);
    for (let i = 0; i < w * 6 * 3; i++) J.d[i] = 0.9;
    const t = 0.4;
    const out = dcp(haze(J, t, [0.9, 0.9, 0.9]), 2);
    for (const a of out.A) expect(a).toBeCloseTo(0.9, 2);
    // ω = 0.95 keeps 5% of the haze on purpose: t̂ = 1 − 0.95·(1 − t), away from the sky.
    let s = 0;
    let n = 0;
    for (let y = 24; y < h; y++) for (let x = 0; x < w; x++, n++) s += out.t[y * w + x] as number;
    expect(s / n).toBeCloseTo(1 - 0.95 * (1 - t), 2);
  });

  it("underestimates the transmission where the scene's darkest channel is not zero", () => {
    const w = 30;
    const h = 20;
    const d = new Float32Array(w * h * 3).fill(0.5); // a bright flat scene: dark channel 0.5
    const out = dcp(haze({ w, h, d }, 0.5, [0.9, 0.9, 0.9]), 2);
    for (const v of out.t) expect(v).toBeLessThan(0.45);
  });
});

describe("TM-LIF, as the paper states it", () => {
  it("quantizes to clip(⌊u/θ⌋, 0, D) / D", () => {
    expect(Array.from(tmQuantize([0, 0.09, 0.1, 0.25, 0.39, 1, -1], 0.1))).toEqual([
      0, 0, 0.25, 0.5, 0.75, 1, 0,
    ]);
    expect(LEVELS_D).toBe(4);
  });

  it("the threshold follows an EMA of the variance with μ, then stays where training left it", () => {
    const run = emaThresholds([1, 2, 2]);
    const v1 = 1;
    const v2 = MOMENTUM * v1 + (1 - MOMENTUM) * 4;
    const v3 = MOMENTUM * v2 + (1 - MOMENTUM) * 4;
    expect(run.theta[0]).toBeCloseTo(ALPHA * Math.sqrt(v1), 9);
    expect(run.theta[1]).toBeCloseTo(ALPHA * Math.sqrt(v2), 9);
    expect(run.theta[2]).toBeCloseTo(ALPHA * Math.sqrt(v3), 9);
    expect(run.own).toEqual([ALPHA, 2 * ALPHA, 2 * ALPHA]);
  });
});

describe("the encoder–decoder of fixed operations", () => {
  it("pools to half and upsamples back by repetition", () => {
    const v = Float32Array.from([1, 3, 5, 7, 1, 3, 5, 7]);
    expect(Array.from(avgPool(v, 4, 2))).toEqual([2, 6]);
    expect(Array.from(upsample(Float32Array.from([2, 6]), 2, 1))).toEqual([2, 2, 6, 6, 2, 2, 6, 6]);
  });

  it("keeps every map at its true size, and every spike map on D levels", () => {
    const w = 32;
    const h = 16;
    const l = Float32Array.from({ length: w * h }, (_, i) => ((i * 7) % 11) / 11);
    const bb = fixedBackbone(l, w, h);
    expect(bb.enc.map((m) => m.length)).toEqual([512, 128, 32, 8]);
    expect(bb.dec.map((m) => m.length)).toEqual([512, 128, 32]);
    for (const m of [...bb.enc, ...bb.dec])
      for (const v of m) expect(Number.isInteger(v * LEVELS_D)).toBe(true);
    expect(bb.prb.length).toBe(w * h);
  });

  it("SSM's structure map is |Gx| + |Gy| over its own spatial mean", () => {
    const w = 12;
    const h = 8;
    const l = Float32Array.from({ length: w * h }, (_, i) => (i % w) / w);
    const { gx, gy, s } = structureMap(l, w, h);
    let m = 0;
    for (const v of s) m += v;
    expect(m / s.length).toBeCloseTo(1, 6);
    // A horizontal ramp has no vertical gradient away from the borders.
    expect(gy[3 * w + 5]).toBeCloseTo(0, 9);
    expect(gx[3 * w + 5]).toBeGreaterThan(0);
  });
});

describe("timing and layout helpers", () => {
  it("steps start on the cues, or spread over the narrated span when there are fewer", () => {
    const cues: Cue[] = [
      { t0: 1, t1: 5 },
      { t0: 5, t1: 9 },
    ];
    expect(stepStarts(cues, 2)).toEqual([1, 5]);
    expect(stepStarts(cues, 4)).toEqual([1, 3, 5, 7]);
  });

  it("extra table rows go to the later cues", () => {
    expect(rowSteps([0, 1, 2], 2)).toEqual([[0], [1, 2]]);
    expect(rowSteps([0, 1, 2, 3], 4)).toEqual([[0], [1], [2], [3]]);
    expect(rowSteps([2, 3], 1)).toEqual([[2, 3]]);
  });

  it("columns fit the width, and a narrow one keeps its natural width", () => {
    const w = fitColumns([100, 900, 1200], 1600);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1600, 6);
    expect(w[0]).toBe(100);
  });
});

/* -------------------------------------------- every fragment's invariants */

type Kind = (typeof LITERAL_KIND_NAMES)[number];
const cues: Cue[] = [
  { t0: 0.95, t1: 7.7 },
  { t0: 7.8, t1: 15.9 },
  { t0: 15.9, t1: 22.1 },
  { t0: 22.2, t1: 28 },
];
const region = { width: 1700, height: 820 };
const files = (...names: string[]) => Object.fromEntries(names.map((n) => [n, `${n}.png`]));

const cases: Array<[Kind, Layers, unknown]> = [
  [
    "dark-channel",
    {
      files: files("hazy", "dark", "trans", "rec", "miss"),
      data: { row: 0.5, profile: [0.3, 0.32, 0.25], tTrue: 0.35, missFrac: 0.1, premise: "0.11" },
    },
    undefined,
  ],
  [
    "channel-threshold",
    {
      files: Object.fromEntries(
        [0, 1].flatMap((k) => [`map${k}`, `fix${k}`, `cal${k}`].map((n) => [n, `${n}.png`])),
      ),
      data: {
        channels: [0, 1].map((k) => ({
          name: `c${k}`,
          hist: [0, 0.5, 1],
          theta: 0.3 + k * 0.2,
          fired: { fix: 0.5, cal: 0.4 },
        })),
        thetaFixed: 0.6,
        alpha: 0.6,
        D: 4,
      },
    },
    undefined,
  ],
  [
    "ema-threshold",
    {
      files: files("hazy", "test"),
      data: {
        w: 1536,
        h: 1024,
        crop: 256,
        origins: [
          [0, 0],
          [100, 200],
          [600, 300],
        ],
        own: [0.05, 0.06, 0.04],
        theta: [0.05, 0.051, 0.05],
        testOwn: 0.02,
        mu: 0.9,
        alpha: 0.6,
      },
    },
    undefined,
  ],
  [
    "backbone",
    { files: files("input", "shallow", "e1", "e2", "e3", "d0", "d1", "d2", "prb"), data: {} },
    undefined,
  ],
  ["fixed-filters", { files: files("gx", "gy", "s"), data: { T: 1 } }, undefined],
  [
    "crops",
    {
      files: files("pic", "c0", "c1"),
      data: {
        w: 1536,
        h: 1024,
        crop: 256,
        origins: [
          [0, 0],
          [700, 500],
        ],
      },
    },
    undefined,
  ],
  [
    "table",
    { files: {}, data: {} },
    {
      kind: "table",
      columns: ["분할", "PSNR", "다른 방법 최고 PSNR"],
      rows: [
        ["LHID", "30.56", "29.73 DehazeFormer-b"],
        ["DHID", "28.83", "28.89 SFRDP-Net"],
      ],
      highlight: [0, 1],
      marks: [
        { row: 0, col: 1 },
        { row: 1, col: 2 },
      ],
      labels: [],
    },
  ],
  [
    "scale",
    { files: {}, data: {} },
    {
      kind: "scale",
      groups: [
        {
          label: "에너지",
          unit: "mJ",
          items: [
            { label: "SFRDP-Net", value: "175.21" },
            { label: "EM-SNN", value: "43.62" },
          ],
        },
      ],
      tile: true,
      labels: [],
    },
  ],
  [
    "recap",
    { files: { p0: "a.jpg", p1: "b.png" }, data: { beats: ["b02", "b03"] } },
    { kind: "recap", beats: ["b02", "b03"], labels: [] },
  ],
];

describe("every new literal fragment obeys the deck's invariants", () => {
  for (const [kind, layers, data] of cases) {
    const spec = {
      kind,
      takeaway: "t",
      labels: kind === "recap" ? { caption: "안개 → 스파이크" } : {},
      ...(data ? { data } : {}),
    };
    const f = literalFragment(kind, layers, region, cues, spec as never, theme);

    it(`${kind}: every tween is fromTo, scoped, and names an element that exists (invariants 2, 3)`, () => {
      const calls = f.script.match(/tl\.\w+\(/g) ?? [];
      expect(calls.length).toBeGreaterThan(2);
      expect(new Set(calls)).toEqual(new Set(["tl.fromTo("]));
      for (const m of f.script.matchAll(/tl\.fromTo\("([^"]+)"/g))
        expect(m[1]).toMatch(/^#SCENEID-[\w-]+$/);
      for (const id of f.script.matchAll(/tl\.fromTo\("#(SCENEID-[\w-]+)"/g))
        expect(f.markup).toContain(`id="${id[1]}"`);
    });

    it(`${kind}: no callbacks, clock, randomness or network (invariants 4, 11)`, () => {
      expect(f.script + f.markup).not.toMatch(
        /on(Update|Start|Complete|Repeat)|Date\.now|Math\.random|fetch\(|https?:/,
      );
    });

    it(`${kind}: no text under 40px (invariant 5), no layer outside assets/literal`, () => {
      for (const m of f.markup.matchAll(/font-size:(\d+)px/g))
        expect(Number(m[1])).toBeGreaterThanOrEqual(40);
      for (const m of f.markup.matchAll(/src="([^"]+)"/g))
        expect(m[1]).toMatch(/^assets\/literal\//);
    });

    it(`${kind}: times rounded to 3 decimals (invariant 10), and no element animated by growth`, () => {
      for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
        expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
      // Quiet data: a value is never drawn by growing a bar, nor counted up.
      if (kind === "table" || kind === "scale")
        expect(f.script).not.toMatch(/scaleX|width:|innerText|textContent/);
    });
  }
});

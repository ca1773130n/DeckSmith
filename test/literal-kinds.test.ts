/**
 * The literal kinds beyond haze/spikes/sobel (src/literal/kinds/):
 * the maths each one computes, and every fragment's obedience to the deck's
 * invariants. Synthetic layers; no ffmpeg, no browser.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { literalFragment } from "../src/literal/index.js";
import { stepStarts, widthOf, wrap } from "../src/literal/kind.js";
import { avgPool, fixedBackbone, upsample } from "../src/literal/kinds/backbone.js";
import { darkChannel, dcp } from "../src/literal/kinds/dark-channel.js";
import { emaThresholds } from "../src/literal/kinds/ema-threshold.js";
import { structureMap } from "../src/literal/kinds/fixed-filters.js";
import { fitColumns, rowSteps } from "../src/literal/kinds/table.js";
import { cropOrigins, tmQuantize } from "../src/literal/kinds-shared.js";
import {
  type Cue,
  haze,
  type Layers,
  type Rgb,
  Tl,
  toRgba,
  writeRaster,
} from "../src/literal/kit.js";
import { KINDS } from "../src/literal/registry.js";
import { literalSlotsOf } from "../src/types.js";
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
    expect(Array.from(tmQuantize([0, 0.09, 0.1, 0.25, 0.39, 1, -1], 0.1, 4))).toEqual([
      0, 0, 0.25, 0.5, 0.75, 1, 0,
    ]);
    // D is the caller's (the plan's), not a constant of the kind.
    expect(Array.from(tmQuantize([0.25], 0.1, 2))).toEqual([1]);
  });

  it("the threshold is PROPORTIONAL to the EMA of the variance (no square root), with the plan's α and μ", () => {
    const alpha = 0.5;
    const mu = 0.8;
    const run = emaThresholds([1, 4, 4], mu, alpha);
    const v2 = mu * 1 + (1 - mu) * 4;
    const v3 = mu * v2 + (1 - mu) * 4;
    expect(run.theta[0]).toBeCloseTo(alpha * 1, 9);
    expect(run.theta[1]).toBeCloseTo(alpha * v2, 9);
    expect(run.theta[2]).toBeCloseTo(alpha * v3, 9);
    expect(run.own).toEqual([alpha, 4 * alpha, 4 * alpha]);
  });

  it("refuses a crop larger than the picture instead of reading outside it", () => {
    expect(() => cropOrigins(200, 150, 256, 4, 1)).toThrow(/256×256 crop does not fit a 200×150/);
    for (const [x, y] of cropOrigins(300, 260, 256, 16, 1)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + 256).toBeLessThanOrEqual(300);
      expect(y + 256).toBeLessThanOrEqual(260);
    }
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
      for (const v of m) expect(Number.isInteger(v * 4)).toBe(true);
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

type Kind = Parameters<typeof slotsFor>[0];
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
      data: {
        row: 0.5,
        profile: [0.3, 0.32, 0.25],
        tTrue: 0.35,
        missFrac: 0.1,
        premise: "0.11",
      },
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
      },
    },
    undefined,
  ],
  [
    "backbone",
    { files: files("input", "shallow", "e1", "e2", "e3", "d0", "d1", "d2", "prb"), data: {} },
    undefined,
  ],
  ["fixed-filters", { files: files("gx", "gy", "s"), data: {} }, undefined],
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
      labels: slotsFor(
        kind,
        kind === "recap"
          ? { caption: "안개 → 스파이크" }
          : kind === "channel-threshold"
            ? { channelNames: "a · b" }
            : {},
      ),
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

/* ------------------------------- no paper's facts, no language, built in */

describe("a kind's words and numbers come from the plan", () => {
  for (const [kind, layers, data] of cases) {
    const required = Object.entries(literalSlotsOf(kind)).filter(
      ([, d]) => !d.optional && !d.number,
    );
    if (!required.length) continue;
    it(`${kind}: every required slot left out is refused by name, with no default`, () => {
      for (const [slot] of required) {
        const labels = slotsFor(
          kind,
          kind === "channel-threshold" ? { channelNames: "a · b" } : {},
        );
        delete labels[slot];
        const spec = { kind, takeaway: "t", labels, ...(data ? { data } : {}) };
        expect(() => literalFragment(kind, layers, region, cues, spec as never, theme)).toThrow(
          new RegExp(`needs the label slot "${slot}"`),
        );
      }
    });
  }

  it("a text names only the values its slot computes", () => {
    const [, layers] = cases.find(([k]) => k === "dark-channel") as (typeof cases)[number];
    const labels = slotsFor("dark-channel", { premise: "assumed {alpha}" });
    expect(() =>
      literalFragment(
        "dark-channel",
        layers,
        region,
        cues,
        { kind: "dark-channel", takeaway: "t", labels } as never,
        theme,
      ),
    ).toThrow(/names \{alpha\}, which the scene does not compute/);
  });
});

describe("what each scene shows, and does not", () => {
  const draw = (kind: Kind) => {
    const [, layers, data] = cases.find(([k]) => k === kind) as (typeof cases)[number];
    const labels = slotsFor(kind, kind === "channel-threshold" ? { channelNames: "a · b" } : {});
    return literalFragment(
      kind,
      layers,
      region,
      cues,
      { kind, takeaway: "t", labels, ...(data ? { data } : {}) } as never,
      theme,
    );
  };

  it("nothing hidden on the first frame stays hidden: every such element is shown later", () => {
    for (const [kind] of cases) {
      const f = draw(kind);
      const tweens = [
        ...f.script.matchAll(/tl\.fromTo\("#SCENEID-([\w-]+)", (\{[^}]*\}), (\{.*?\}), [\d.]+\);/g),
      ];
      const first = new Map<string, { from: string; to: string }>();
      for (const [, id, from, to] of tweens)
        if (!first.has(id as string))
          first.set(id as string, { from: from as string, to: to as string });
      for (const [id, t] of first) {
        if (!/"opacity":0\b/.test(t.from) || !/"opacity":0\b/.test(t.to)) continue;
        const shown = tweens.some(
          ([, i, , to]) => i === id && /"opacity":(0\.\d+|1)\b/.test(to as string),
        );
        expect(shown, `${kind}: #${id} is hidden at the start and never shown`).toBe(true);
      }
    }
  });

  it("a duration is rounded to 3 decimals like a position (invariant 10)", () => {
    const tl = new Tl();
    tl.fromTo("a", { x: 0 }, { x: 1, duration: 10.324000000000002 }, 0);
    expect(tl.script).toMatch(/"duration":10\.324[,}]/);
    for (const [kind] of cases)
      for (const m of draw(kind).script.matchAll(/"duration":(\d+\.\d+)/g))
        expect((m[1] as string).split(".")[1]?.length, kind).toBeLessThanOrEqual(3);
  });

  it("a table marks a cell by its colour, never a box popping in; an unspoken row's mark shows from the start", () => {
    const [, layers] = cases.find(([k]) => k === "table") as (typeof cases)[number];
    const data = {
      kind: "table",
      columns: ["항목", "자료"],
      rows: [
        ["보고 에너지", "43.62 mJ"],
        ["산출 절차", "기술되지 않음"],
      ],
      highlight: [0],
      marks: [
        { row: 0, col: 1 },
        { row: 1, col: 1 },
      ],
      labels: [],
    };
    const f = literalFragment(
      "table",
      layers,
      region,
      cues,
      { kind: "table", takeaway: "t", labels: {}, data } as never,
      theme,
    );
    expect(f.markup).not.toMatch(/border:3px solid/);
    // Row 1 is never spoken: its mark is in the accent from the start, with nothing to wait for.
    expect(f.markup).toMatch(
      new RegExp(`id="SCENEID-c1-1"[^>]*>(<div[^>]*color:${theme.accent}[^>]*>)`),
    );
    expect(f.markup).not.toContain('id="SCENEID-k1-1"');
    // Row 0 is spoken: its mark turns to the accent then.
    expect(f.script).toMatch(/tl\.fromTo\("#SCENEID-k0-1", \{"opacity":0\}, \{"opacity":1/);
  });

  it("the backbone states no depth the source does not, and draws the flow as arrows", () => {
    const f = draw("backbone");
    expect(f.markup).not.toMatch(/>1\/[248]</);
    for (let i = 0; i <= 7; i++) expect(f.markup).toContain(`id="SCENEID-a${i}"`);
    expect(f.markup).toContain('marker-end="url(#SCENEID-ah)"');
    expect(f.markup).toContain(">depth<");
  });

  it("fixed filters draw no hypothetical time-step cards", () => {
    const f = draw("fixed-filters");
    expect(f.markup).not.toMatch(/SCENEID-g[12]|T &gt; 1|dashed/);
  });

  it("a separator never starts a wrapped line", () => {
    // Wide enough for "0.9650 SFSNiD" and not for its separator too: the break falls at the "·".
    const lines = wrap(
      "0.9650 SFSNiD · SFRDP-Net",
      44,
      widthOf("0.9650 SFSNiD", 44, theme) + 2,
      theme,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l).not.toMatch(/^[·•|/]/);
  });

  it("a recap of four fills its region: two rows of tiles, the result beside them", () => {
    const layers = {
      files: { p0: "a.jpg", p1: "b.png", p2: "c.png", p3: "d.png" },
      data: { beats: ["a", "b", "c", "d"] },
    };
    const f = literalFragment(
      "recap",
      layers,
      region,
      cues,
      {
        kind: "recap",
        takeaway: "t",
        labels: { caption: "a → b → c → d", result: "결과: 보고 에너지 43.62 대 175.21 mJ" },
      } as never,
      theme,
    );
    const box = (id: string) =>
      /left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px/
        .exec(new RegExp(`id="SCENEID-${id}"[^>]*`).exec(f.markup)?.[0] ?? "")
        ?.slice(1)
        .map(Number) as number[];
    const [x3, y3, w3, h3] = box("p3") as [number, number, number, number];
    expect(y3 + h3).toBeGreaterThan(region.height * 0.6);
    const left = Number(/id="SCENEID-r0"[^>]*left:(\d+)px/.exec(f.markup)?.[1]);
    expect(left).toBeGreaterThan(x3 + w3);
  });

  it("nothing runs off the bottom: channel rows, a table's caption, a scale's caption", () => {
    const short = { width: 1700, height: 700 };
    const topOf = (markup: string, id: string) =>
      Number(new RegExp(`id="SCENEID-${id}"[^>]*top:(\\d+)px`).exec(markup)?.[1]);
    const [, chL, chD] = cases.find(([k]) => k === "channel-threshold") as (typeof cases)[number];
    const ch = literalFragment(
      "channel-threshold",
      chL,
      short,
      cues,
      {
        kind: "channel-threshold",
        takeaway: "t",
        labels: slotsFor("channel-threshold", { channelNames: "a · b" }),
        ...(chD ? { data: chD } : {}),
      } as never,
      theme,
    );
    expect(topOf(ch.markup, "l-stand") + 46).toBeLessThanOrEqual(short.height);
    const table = {
      kind: "table",
      columns: ["분할", "EM-SNN PSNR", "다른 방법 최고 PSNR", "EM-SNN SSIM", "다른 방법 최고 SSIM"],
      rows: [
        ["LHID", "30.56", "29.73 DehazeFormer-b", "0.9106", "0.8964 DehazeFormer-b"],
        ["DHID", "28.83", "28.89 SFRDP-Net", "0.9073", "0.9070 SFRDP-Net"],
        ["RICE1", "35.99", "37.38 SFRDP-Net", "0.9630", "0.9650 SFSNiD · SFRDP-Net"],
        ["RICE2", "36.25", "35.45 SFRDP-Net", "0.9406", "0.9140 4KDehazing"],
      ],
      highlight: [0, 1, 2, 3],
      marks: [],
      labels: [],
    };
    const draw = (
      kind: "table" | "scale",
      region: { width: number; height: number },
      data: unknown,
      labels = {},
    ) =>
      literalFragment(
        kind,
        { files: {}, data: {} },
        region,
        cues,
        { kind, takeaway: "t", labels, data } as never,
        theme,
      );
    expect(
      topOf(draw("table", short, table, { caption: "표에 보고된 값" }).markup, "cap") + 46,
    ).toBeLessThanOrEqual(short.height);
    expect(() => draw("table", { width: 1700, height: 260 }, table)).toThrow(
      /the table needs \d+px and the scene has 260px/,
    );
    const scale = {
      kind: "scale",
      groups: [
        {
          label: "에너지",
          unit: "mJ",
          items: [
            { label: "A", value: "175.21" },
            { label: "B", value: "43.62" },
          ],
        },
        {
          label: "파라미터",
          unit: "M",
          items: [
            { label: "A", value: "5.08" },
            { label: "B", value: "4.81" },
          ],
        },
      ],
      tile: true,
      labels: [],
    };
    const sm = draw("scale", short, scale, { caption: "보고값" }).markup;
    const cap = topOf(sm, "cap");
    expect(cap + 46).toBeLessThanOrEqual(short.height);
    // Every row ends above the caption.
    for (const m of sm.matchAll(
      /id="SCENEID-i\d+-\d+" style="[^"]*top:(\d+)px;[^"]*height:(\d+)px/g,
    ))
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(cap);
  });
});

/* ------------------------- the picture kinds' layers, through a real ffmpeg */

const ffmpeg = await new Promise<boolean>((done) =>
  execFile("ffmpeg", ["-version"], (err) => done(!err)),
);

describe.skipIf(!ffmpeg)(
  "the picture kinds' layers, computed from a real picture",
  { timeout: 60_000 },
  () => {
    let dir = "";
    let pic = "";
    let small = "";
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "literal-layers-"));
      // Left half obeys the dark channel prior (a zero channel in every patch); the right half is a
      // bright flat grey, where it fails. Texture everywhere, so Sobel and the crops have something.
      const w = 640;
      const h = 480;
      const d = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = ((x * 7 + y * 13) % 17) / 16;
          const i = (y * w + x) * 3;
          if (x < w / 2) {
            d[i] = v;
            d[i + 1] = (x + y) % 3 === 0 ? 0 : 0.6 * v;
            d[i + 2] = 0.3;
          } else d.fill(0.75 + 0.1 * v, i, i + 3);
        }
      pic = join(dir, "pic.png");
      await writeRaster(pic, w, h, toRgba({ w, h, d }));
      small = join(dir, "small.png");
      await writeRaster(
        small,
        200,
        150,
        toRgba({ w: 200, h: 150, d: new Float32Array(200 * 150 * 3).fill(0.5) }),
      );
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    const run = (kind: keyof typeof KINDS, image: string, over: Record<string, string> = {}) =>
      KINDS[kind].layers({
        beatId: "b",
        image,
        dir,
        region,
        spec: { labels: slotsFor(kind, over) },
        earlier: new Map(),
      });

    it("crops: exactly the plan's batch, cut from the picture at the training size the source states", async () => {
      const L = await run("crops", pic, { batch: "3", size: "512" });
      const d = L.data as { w: number; h: number; origins: Array<[number, number]>; crop: number };
      expect([d.w, d.h, d.crop]).toEqual([512, 512, 256]);
      expect(d.origins).toHaveLength(3);
      for (const [x, y] of d.origins)
        expect(x + 256 <= 512 && y + 256 <= 512 && x >= 0 && y >= 0).toBe(true);
      // No training size: the picture's own, and a 200×150 picture has no 256 crop in it.
      await expect(run("crops", small, { size: "" })).rejects.toThrow(/does not fit a 200×150/);
    });

    it("ema-threshold: θ = α·EMA(variance) with the plan's α and μ, and refuses a picture smaller than a crop", async () => {
      const L = await run("ema-threshold", pic, { alpha: "0.5", momentum: "0.8" });
      const d = L.data as { own: number[]; theta: number[] };
      // own = α·σ², so the EMA can be replayed from it.
      let v = (d.own[0] as number) / 0.5;
      for (let i = 1; i < d.own.length; i++) {
        v = 0.8 * v + 0.2 * ((d.own[i] as number) / 0.5);
        expect(d.theta[i]).toBeCloseTo(0.5 * v, 4);
      }
      await expect(run("ema-threshold", small)).rejects.toThrow(/does not fit a 200×150/);
    });

    it("channel-threshold: α and D are the plan's; another α moves every threshold", async () => {
      const a = (await run("channel-threshold", pic, { channelNames: "a · b · c · d · e" }))
        .data as {
        thetaFixed: number;
        alpha: number;
        D: number;
      };
      const b = (
        await run("channel-threshold", pic, {
          channelNames: "a · b · c · d · e",
          alpha: "0.3",
          levels: "2",
        })
      ).data as typeof a;
      expect([a.alpha, a.D, b.alpha, b.D]).toEqual([0.6, 4, 0.3, 2]);
      expect(b.thetaFixed).toBeLessThan(a.thetaFixed);
      await expect(run("channel-threshold", pic, { channelNames: "a · b" })).rejects.toThrow(
        /draws 5 channels; channelNames names 2/,
      );
    });

    it("dark-channel: the prior's estimate misses the true transmission on the flat bright half", async () => {
      const d = (await run("dark-channel", pic)).data as { missFrac: number; premise: string };
      expect(d.missFrac).toBeGreaterThan(0.2);
      expect(d.missFrac).toBeLessThan(0.9);
    });

    it("backbone and fixed-filters write every layer they name", async () => {
      for (const kind of ["backbone", "fixed-filters"] as const) {
        const L = await run(kind, pic);
        for (const f of new Set(Object.values(L.files)))
          await expect(stat(join(dir, f))).resolves.toBeTruthy();
      }
    });
  },
);

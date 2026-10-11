/**
 * Pacing and fill of the literal kinds a deck is built from (src/literal/kinds/):
 * on the EM-SNN deck's own sentence cues, no kind leaves its picture standing
 * still for longer than `STILL_MAX` while it is narrated, and its pictures use
 * the region. Measured off the emitted script (`stillSpans`) and markup, so it
 * is about what ships. Synthetic layers; no ffmpeg, no browser.
 *
 * The cues are those of `~/.blackhole/DeckSmith/2026-10-11/literal-dark` (scene
 * clock, one per sentence): r1 of that deck had 13 stretches of 6–9s where
 * nothing moved, and a method overview that ended on an empty box.
 */
import { describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { literalFragment } from "../src/literal/index.js";
import { type Cue, type Layers, stillSpans, Tl } from "../src/literal/kit.js";
import type { LiteralKind } from "../src/types.js";
import { slotsFor } from "./literal-fixtures.js";

const theme: Theme = {
  bg: "#14110d",
  fg: "#f2eadc",
  muted: "#a89f90",
  dim: "#6b6458",
  rule: "#3a342b",
  panel: "#1d1913",
  accent: "#e8a33d",
  tones: { a: "#e8a33d", b: "#8fc1e8", c: "#e88fa3", d: "#a3e88f" },
  fontStack: "Inter, sans-serif",
};

/** The region every literal scene of that deck had at 1920×1080. */
const region = { width: 1700, height: 747 };
/** The longest a narrated scene may stand still, seconds. */
const STILL_MAX = 4;

const c = (pairs: Array<[number, number]>): Cue[] => pairs.map(([t0, t1]) => ({ t0, t1 }));
const files = (...names: string[]) => Object.fromEntries(names.map((n) => [n, `${n}.png`]));

const spikesData = () => {
  const cols = 18;
  const rows = 12;
  const x = Array.from({ length: cols * rows }, (_, i) => ((i * 37) % 100) / 100);
  const counts = x.map((v) => Math.round(v * 4));
  const run = { pre: [0.4, 0.8, 1.1, 0.5], post: [0.4, 0.8, 0.1, 0.5], spikes: [2] };
  return {
    cols,
    rows,
    x,
    counts,
    out: counts.map((n) => n / 8),
    witnesses: [20, 60, 100].map((cell) => ({ cell, ...run, noLeak: run })),
    steps: 4,
    theta: 1,
  };
};

/** Every kind the deck draws, with its layers, its data and the deck's own cues for it. */
const DECK: Array<{ kind: LiteralKind; layers: Layers; data?: unknown; cues: Cue[] }> = [
  {
    kind: "haze",
    layers: {
      files: files("clear", "hazy", "edgeClear", "edgeHazy"),
      data: { row: 300, profile: [0.2, 0.6, 0.4, 0.8], air: 0.86, t: 0.35 },
    },
    cues: c([
      [0.95, 9.5],
      [9.5, 17.862],
    ]),
  },
  {
    kind: "spikes",
    layers: { files: files("hazy"), data: spikesData() },
    cues: c([
      [0.95, 9.324],
      [9.374, 16.311],
      [16.382, 23.369],
    ]),
  },
  {
    kind: "dark-channel",
    layers: {
      files: files("hazy", "dark", "trans", "rec", "miss"),
      data: { row: 0.5, profile: [0.3, 0.32, 0.25], tTrue: 0.35, missFrac: 0.1, premise: "0.11" },
    },
    cues: c([
      [0.95, 8.612],
      [8.678, 14.49],
      [14.558, 21.32],
      [21.374, 33.986],
    ]),
  },
  {
    kind: "backbone",
    layers: {
      files: files("input", "shallow", "e1", "e2", "e3", "d0", "d1", "d2", "prb"),
      data: {},
    },
    cues: c([
      [0.95, 7.075],
      [7.142, 14.628],
      [14.678, 19.764],
      [19.814, 27.751],
    ]),
  },
  {
    kind: "channel-threshold",
    layers: {
      files: Object.fromEntries(
        [0, 1, 2, 3, 4].flatMap((k) =>
          [`map${k}`, `fix${k}`, `cal${k}`].map((n) => [n, `${n}.png`]),
        ),
      ),
      data: {
        channels: [0, 1, 2, 3, 4].map((k) => ({
          hist: [0, 0.5, 1, 0.4],
          theta: 0.2 + k * 0.12,
          fired: { fix: 0.5, cal: 0.4 },
        })),
        thetaFixed: 0.6,
        alpha: 0.6,
        D: 4,
      },
    },
    cues: c([
      [0.95, 8.287],
      [8.287, 18.3],
    ]),
  },
  {
    kind: "ema-threshold",
    layers: {
      files: files("hazy", "test"),
      data: {
        w: 1536,
        h: 1024,
        crop: 256,
        origins: Array.from({ length: 16 }, (_, i) => [(i * 83) % 1200, (i * 57) % 700]),
        own: Array.from({ length: 16 }, (_, i) => 0.04 + ((i * 7) % 5) / 100),
        theta: Array.from({ length: 16 }, () => 0.05),
        testOwn: 0.02,
        tests: [
          { origin: [10, 20], own: 0.021 },
          { origin: [500, 300], own: 0.018 },
          { origin: [900, 600], own: 0.024 },
          { origin: [200, 700], own: 0.019 },
        ],
      },
    },
    cues: c([
      [0.95, 9.387],
      [9.446, 17.896],
    ]),
  },
  {
    kind: "sobel",
    layers: { files: files("hazy", "edges", "feat", "featS", "featW"), data: {} },
    cues: c([
      [0.95, 8.875],
      [8.875, 18.162],
    ]),
  },
  {
    kind: "crops",
    layers: {
      files: files(
        "pic",
        "c0",
        "c1",
        "c2",
        "c3",
        "n0-0",
        "n0-1",
        "n0-2",
        "n0-3",
        "n1-0",
        "n1-1",
        "n1-2",
        "n1-3",
      ),
      data: {
        w: 512,
        h: 512,
        crop: 256,
        origins: [
          [0, 0],
          [200, 100],
          [100, 250],
          [256, 256],
        ],
        next: [
          [
            [30, 40],
            [220, 10],
            [60, 200],
            [250, 230],
          ],
          [
            [120, 90],
            [10, 250],
            [240, 60],
            [180, 180],
          ],
        ],
      },
    },
    cues: c([
      [0.95, 11.95],
      [12.014, 21.339],
    ]),
  },
  {
    kind: "scale",
    layers: { files: {}, data: {} },
    data: {
      kind: "scale",
      groups: [
        {
          label: "보고 에너지",
          unit: "mJ",
          items: [
            { label: "SFRDP-Net", value: "175.21" },
            { label: "EM-SNN", value: "43.62" },
          ],
        },
        {
          label: "파라미터",
          unit: "M",
          items: [
            { label: "SFRDP-Net", value: "5.08" },
            { label: "EM-SNN", value: "4.81" },
          ],
        },
      ],
      tile: true,
      labels: [],
    },
    cues: c([
      [0.95, 10.412],
      [10.478, 19.365],
    ]),
  },
  {
    kind: "recap",
    layers: {
      files: { p0: "a.jpg", p1: "b.png", p2: "c.png", p3: "d.png" },
      data: { beats: ["a", "b", "c", "d"] },
    },
    data: { kind: "recap", beats: ["a", "b", "c", "d"], labels: [] },
    cues: c([
      [0.95, 5.436],
      [5.486, 11.698],
      [11.798, 19.073],
      [19.142, 23.917],
      [23.917, 32.717],
    ]),
  },
];

const labelsFor = (kind: LiteralKind) =>
  slotsFor(
    kind,
    kind === "channel-threshold"
      ? { channelNames: "a · b · c · d · e" }
      : kind === "recap"
        ? { caption: "a → b → c → d", result: "결과: 보고 에너지 43.62 mJ 대 175.21 mJ" }
        : {},
  );

const drawDeckKind = (k: (typeof DECK)[number]) =>
  literalFragment(
    k.kind,
    k.layers,
    region,
    k.cues,
    {
      kind: k.kind,
      takeaway: "t",
      labels: labelsFor(k.kind),
      ...(k.data ? { data: k.data } : {}),
    } as never,
    theme,
  );

describe("stillSpans reads the script that ships", () => {
  it("finds the gaps between tweens, defaulting a tween with no duration to 0.5s", () => {
    const tl = new Tl();
    tl.fromTo("a", { opacity: 0 }, { opacity: 1, duration: 1 }, 1);
    tl.fromTo("b", { x: 0 }, { x: 1, duration: 2 }, 1.5);
    tl.fromTo("c", { opacity: 0 }, { opacity: 1 }, 6);
    expect(stillSpans(tl.script, 0, 10)).toEqual([
      [0, 1],
      [3.5, 6],
      [6.5, 10],
    ]);
  });
});

describe("no deck kind stands still while it is narrated", () => {
  for (const k of DECK) {
    it(`${k.kind}: never more than ${STILL_MAX}s without a tween between its first and last sentence`, () => {
      const f = drawDeckKind(k);
      const from = (k.cues[0] as Cue).t0 + 1;
      const to = (k.cues[k.cues.length - 1] as Cue).t1 - 0.5;
      const long = stillSpans(f.script, from, to).filter(([a, b]) => b - a > STILL_MAX);
      expect(long, `${k.kind} stands still over ${JSON.stringify(long)}`).toEqual([]);
    });
  }
});

describe("the deck kinds use their region", () => {
  const draw = (kind: LiteralKind) =>
    drawDeckKind(DECK.find((k) => k.kind === kind) as (typeof DECK)[number]);
  const box = (markup: string, id: string) =>
    /left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px/
      .exec(new RegExp(`id="SCENEID-${id}"[^>]*`).exec(markup)?.[0] ?? "")
      ?.slice(1)
      .map(Number) as [number, number, number, number];

  it("no kind names the shell's own camera (#SCENEID-cam is the scene wrapper)", () => {
    for (const k of DECK) {
      const f = drawDeckKind(k);
      expect(f.markup, k.kind).not.toContain('id="SCENEID-cam"');
      expect(f.script, k.kind).not.toMatch(/#SCENEID-cam"/);
    }
  });

  it("the method overview ends on what it computed, never an empty box", () => {
    const f = draw("backbone");
    expect(f.markup).not.toMatch(/dashed \S+;box-sizing:border-box;border-radius:6px/);
    expect(f.markup).toContain(">untrained<");
    // The last move is a close look at the PRB map, not a box appearing.
    expect(f.script).toMatch(/tl\.fromTo\("#SCENEID-m6-cam"/);
  });

  it("pictures are large: channel tiles, crop tiles, the EMA picture, the DCP tiles", () => {
    expect(box(draw("channel-threshold").markup, "m0")[2]).toBeGreaterThanOrEqual(300);
    expect(box(draw("crops").markup, "t0")[2]).toBeGreaterThanOrEqual(300);
    expect(box(draw("ema-threshold").markup, "pic")[2]).toBeGreaterThanOrEqual(region.width * 0.5);
    expect(box(draw("dark-channel").markup, "p-hazy")[2]).toBeGreaterThanOrEqual(450);
  });

  it("lengths to scale fill the height, centred", () => {
    const m = draw("scale").markup;
    const rows = [
      ...m.matchAll(/id="SCENEID-i\d+-\d+" style="[^"]*top:(\d+)px;[^"]*height:(\d+)px/g),
    ].map((r) => [Number(r[1]), Number(r[2])] as const);
    const first = rows[0] as readonly [number, number];
    const last = rows[rows.length - 1] as readonly [number, number];
    expect(last[0] + last[1] - first[0]).toBeGreaterThan(region.height * 0.5);
  });

  it("a recap shows every tile from the start, quiet, and lights each on its sentence", () => {
    const f = draw("recap");
    for (let i = 0; i < 4; i++)
      expect(f.script).toMatch(
        new RegExp(
          `tl\\.fromTo\\("#SCENEID-p${i}", \\{"opacity":0\\}, \\{"opacity":0\\.3,"duration":0\\.6\\}, 0\\.\\d+\\);`,
        ),
      );
  });
});

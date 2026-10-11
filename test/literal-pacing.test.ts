/**
 * Pacing and fill of the HTML-drawn literal forms (place lengths, recap) on a
 * real deck's sentence cues: none leaves its picture standing still for longer
 * than `STILL_MAX` while narrated, and each uses its region. Measured off the
 * emitted script (`stillSpans`) and markup, so it is about what ships. The
 * verbs drawn on the stage are held to the same in test/literal-verbs.test.ts.
 * Synthetic layers; no ffmpeg, no browser.
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

/** The word forms and recap a deck draws, with their layers, their data and a deck's own cues for them. */
const DECK: Array<{ kind: LiteralKind; layers: Layers; data?: unknown; cues: Cue[] }> = [
  {
    kind: "place",
    layers: { files: {}, data: {} },
    data: {
      kind: "place",
      form: "strip",
      measure: "length",
      lengths: {
        groups: [
          {
            label: "보고 에너지",
            unit: "mJ",
            items: [
              { label: "Method-B", value: "175.21" },
              { label: "Method-A", value: "43.62" },
            ],
          },
          {
            label: "파라미터",
            unit: "M",
            items: [
              { label: "Method-B", value: "5.08" },
              { label: "Method-A", value: "4.81" },
            ],
          },
        ],
        tile: true,
      },
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
    kind === "recap"
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
  it("no kind names the shell's own camera (#SCENEID-cam is the scene wrapper)", () => {
    for (const k of DECK) {
      const f = drawDeckKind(k);
      expect(f.markup, k.kind).not.toContain('id="SCENEID-cam"');
      expect(f.script, k.kind).not.toMatch(/#SCENEID-cam"/);
    }
  });

  it("lengths to scale fill the height, centred", () => {
    const m = draw("place").markup;
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

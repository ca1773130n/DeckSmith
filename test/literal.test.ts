/**
 * Literal scenes (src/literal/): sentence timing, the plan a storyboard
 * carries, and a staged verb's obedience to the deck's invariants through the
 * pass's own `literalFragment`. No ffmpeg and no browser: the layers are
 * synthetic. The verbs themselves are held to every rule in
 * test/literal-verbs.test.ts; the op library in test/literal-ops.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import {
  literalFragment,
  literalPlanOf,
  literalPlanSchema,
  sentenceCues,
} from "../src/literal/index.js";
import { widthOf } from "../src/literal/kind.js";
import { operate } from "../src/literal/kinds/operate.js";
import { placeholderPicture, runVerb } from "../src/literal/kinds/stage.js";
import type { Cue, Layers } from "../src/literal/kit.js";
import { type Literal, literalSchema, sourceSchema, storyboardSchema } from "../src/types.js";
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

const cues: Cue[] = [
  { t0: 0.95, t1: 7.7 },
  { t0: 7.8, t1: 15.9 },
  { t0: 15.9, t1: 22.1 },
];
const region = { width: 1700, height: 746 };

/** An operate scene on a picture, run on the stage, as the pass would hand it to `literalFragment`. */
function staged(): { lit: Literal; layers: Layers; labels: Record<string, string> } {
  const lit = literalSchema.parse({
    kind: "operate",
    picture: "b01",
    chain: [
      { op: "channels", how: "luma", params: [], label: "brightness" },
      { op: "conv", how: "sobel-x", params: [], label: "horizontal edges" },
    ],
    labels: [
      { slot: "input", text: "the picture" },
      { slot: "output", text: "the edges" },
      { slot: "example", text: "example" },
      { slot: "caption", text: "the stated operations on an example image" },
    ],
  }) as Extract<Literal, { kind: "operate" }>;
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  const r = runVerb(operate, {
    lit,
    labels,
    region,
    theme,
    measure: (t, s) => widthOf(t, s, theme),
    dry: true,
    image: placeholderPicture(96, 64),
    earlier: new Map(),
    assets: {},
  });
  const files = Object.fromEntries(Object.keys(r.rasters).map((k) => [k, `b01-${k}.png`]));
  return { lit, labels, layers: { files, data: { frames: r.frames, paints: {}, vars: r.vars } } };
}

describe("what reaches the next layer, and when", () => {
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
      { t0: 0.95, t1: 11.687, stop: true },
      { t0: 11.75, t1: 15.7, stop: true },
      { t0: 15.7, t1: 20.05 },
    ]);
  });
});

describe("a staged verb obeys the deck's invariants", () => {
  const { lit, layers, labels } = staged();
  const spec = { kind: "operate" as const, takeaway: "t", labels, data: lit };
  const f = literalFragment("operate", layers, region, cues, spec as never, theme);

  it("every tween is fromTo, scoped to the scene, and names what exists (invariants 2, 3)", () => {
    const calls = f.script.match(/tl\.\w+\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    expect(new Set(calls)).toEqual(new Set(["tl.fromTo("]));
    for (const m of f.script.matchAll(/tl\.fromTo\("([^"]+)"/g))
      expect(m[1]).toMatch(/^#SCENEID-[\w-]+$/);
    for (const id of f.script.matchAll(/tl\.fromTo\("#(SCENEID-[\w-]+)"/g))
      expect(f.markup).toContain(`id="${id[1]}"`);
  });

  it("no callbacks, no clock, no randomness (invariants 4, 11)", () => {
    expect(f.script).not.toMatch(/on(Update|Start|Complete|Repeat)|Date\.now|Math\.random|fetch/);
  });

  it("no text under 40px (invariant 5) and no layer outside assets/literal", () => {
    const sizes = [...f.markup.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(40);
    for (const m of f.markup.matchAll(/href="([^"]+)"/g))
      expect(m[1]).toMatch(/^assets\/literal\//);
  });

  it("times and durations rounded to 3 decimals (invariant 10)", () => {
    for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
      expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
    for (const m of f.script.matchAll(/"duration":(\d+\.\d+)/g))
      expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
  });

  it("every word is the plan's; a required slot left out is refused", () => {
    const without = { ...labels };
    delete without.input;
    expect(() =>
      literalFragment(
        "operate",
        layers,
        region,
        cues,
        { ...spec, labels: without } as never,
        theme,
      ),
    ).toThrow(/needs the label slot "input"/);
  });

  it("a plan names a kind and a takeaway per beat", () => {
    expect(() =>
      literalPlanSchema.parse({
        image: "a.png",
        beats: { b1: { kind: "metaphor", takeaway: "x" } },
      }),
    ).toThrow();
    expect(
      literalPlanSchema.parse({ beats: { b1: { kind: "operate", takeaway: "x" } } }).beats.b1
        ?.labels,
    ).toEqual({});
  });

  it("slotsFor fills every slot a kind declares", () => {
    expect(Object.keys(slotsFor("operate"))).toContain("output");
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
          intent: "a filter finds the edges",
          takeaway: "A fixed kernel finds every edge.",
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
          intent: "crops",
          archetype: "kinetic",
          params: { headline: "k", phrases: [{ text: "a" }, { text: "b" }] },
          literal: {
            kind: "region",
            picture: "b01",
            cut: "crops",
            size: { value: "4" },
            count: { value: "2" },
          },
        },
      ],
    });

  const OPERATE = {
    kind: "operate",
    picture: "b01",
    chain: [{ op: "conv", how: "sobel-x", params: [], label: "edges" }],
    labels: [{ slot: "input", text: "입력" }],
  };

  it("takes each literal beat's kind, takeaway, labels and picture file from the storyboard", () => {
    const plan = literalPlanOf(board(OPERATE, "gen-b01"), source, "/deck/assets");
    expect(plan.beats.b01).toMatchObject({
      kind: "operate",
      takeaway: "A fixed kernel finds every edge.",
      labels: { input: "입력" },
      image: "/deck/assets/gen-b01-abc.png",
    });
    expect((plan.beats.b01?.data as Literal | undefined)?.kind).toBe("operate");
    // No takeaway: the intent stands in, so the report still says what was meant.
    expect(plan.beats.b02?.takeaway).toBe("crops");
    expect(plan.beats.b02?.image).toBe("/deck/assets/gen-b01-abc.png");
    expect(literalPlanSchema.parse(plan)).toEqual(plan);
  });

  it("a place's `figure` is carried as an asset, as a flow stage's is", () => {
    const withFig = sourceSchema.parse({
      ...source,
      figures: [
        ...source.figures,
        { id: "fig3", src: "fig3-abc.jpg", caption: "c", width: 8, height: 8 },
      ],
    });
    const PLACE = {
      kind: "place",
      form: "plane",
      axes: [
        { name: "x", lowerIsBetter: false },
        { name: "y", lowerIsBetter: false },
      ],
      items: [
        { label: "A", values: ["1", "2"] },
        { label: "B", values: ["3", "4"] },
      ],
      figure: "fig3",
      labels: [{ slot: "scene", text: "s" }],
    };
    const plan = literalPlanOf(board(PLACE, "gen-b01"), withFig, "/deck/assets");
    expect(plan.beats.b01?.assets).toEqual({ fig3: "/deck/assets/fig3-abc.jpg" });
  });

  it("fails loudly when the picture beat has no figure yet", () => {
    expect(() => literalPlanOf(board(OPERATE), source, "/deck/assets")).toThrow(
      /b01 runs on the picture of "b01", which has no figure.*illustrate/,
    );
  });
});

/**
 * THE FIT ENGINE (`design: "v2"`): archetypes grow into their region, predict
 * how full they came out, and change nothing else.
 *
 * Three promises are held here, in this order of importance:
 *
 *   1. CLASSIC IS v0.8.0. Absent and `"classic"` emit the same bytes, so every
 *      golden pinned before v2 existed still pins the shipped default.
 *   2. STOPS DO NOT MOVE. Every beat holds at the same times and refuses under
 *      the same conditions in both designs, so a storyboard and its narration can
 *      be rebuilt as v2 with no re-plan and no TTS. Checked on the demo — all
 *      thirteen archetypes — at every format. (The 2026-10-07 run over all 219
 *      stored HypePaper storyboards, 3,536 beats x 3 formats, found 0 differences.)
 *   3. THE GROWTH IS REAL, per archetype, and each prediction is in its band.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { barCompare } from "../src/emit/archetypes/bar-compare.js";
import { callout } from "../src/emit/archetypes/callout.js";
import { claimFigure } from "../src/emit/archetypes/claim-figure.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { pipeLayout, pipeline } from "../src/emit/archetypes/pipeline.js";
import { emitDeck } from "../src/emit/composition.js";
import { EMPTY_BELOW, FULL_AT, fillBand, fitOf, GROWTH, growToFit, isV2 } from "../src/emit/fit.js";
import type { EmitContext, Scene, Theme } from "../src/emit/kit.js";
import { contentW } from "../src/emit/kit.js";
import {
  type Beat,
  type BeatOf,
  type Design,
  FORMATS,
  type Format,
  type Source,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const load = async (rel: string) => JSON.parse(await readFile(repo(rel), "utf8"));

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
const deck = FORMATS["deck-16x9"] as Format;
const bare: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
};
const ctx = (design?: Design, source = bare, format = deck): EmitContext => ({
  source,
  format,
  theme,
  sid: "s1",
  start: 0,
  ...(design ? { design } : {}),
});
const beat = <A extends Beat["archetype"]>(
  archetype: A,
  params: BeatOf<A>["params"],
  seconds = 9,
): BeatOf<A> =>
  ({
    id: "b1",
    intent: "i",
    evidence: [],
    weight: 0.5,
    seconds,
    archetype,
    params,
  }) as unknown as BeatOf<A>;

/** Everything a scene emits that reaches a byte of the composition. */
const bytes = (s: Scene) => JSON.stringify({ ...s, fit: undefined, warnings: undefined });

/* --------------------------------------------------------------- the measure */

describe("fillBand", () => {
  it("grades main-axis fill in ResearchStudio-Reel's five bands", () => {
    expect(fillBand(0.69)).toBe("empty");
    expect(fillBand(EMPTY_BELOW)).toBe("sparse");
    expect(fillBand(0.89)).toBe("sparse");
    expect(fillBand(FULL_AT)).toBe("full");
    expect(fillBand(1)).toBe("full");
    expect(fillBand(1.05)).toBe("spillage");
    expect(fillBand(1.11)).toBe("overflow");
  });
});

describe("fitOf", () => {
  it("rounds to three places, once, so two builds agree to the byte", () => {
    expect(fitOf(700 / 3, 762)).toEqual({ fill: 0.306, region: 762, ink: 233.333 });
  });

  it("reads an empty region as 0 rather than dividing by it", () => {
    expect(fitOf(10, 0).fill).toBe(0);
  });
});

describe("growToFit", () => {
  const linear = (s: number) => 100 * s;

  it("returns the cap when the cap fits", () => {
    expect(growToFit(linear, 1000)).toBe(GROWTH);
  });

  it("returns the floor when even the floor does not fit — the caller's refusal handles that", () => {
    expect(growToFit(linear, 50)).toBe(1);
  });

  it("finds the largest scale that fits, floored onto a 1/128 grid, never over budget", () => {
    const k = growToFit(linear, 137);
    expect(linear(k)).toBeLessThanOrEqual(137);
    expect(linear(k + 1 / 128)).toBeGreaterThan(137);
    expect(k * 128).toBe(Math.floor(k * 128));
  });
});

describe("isV2", () => {
  it("is classic unless v2 was said, so every hand-built context stays v0.8.0", () => {
    expect(isV2({})).toBe(false);
    expect(isV2({ design: "classic" })).toBe(false);
    expect(isV2({ design: "v2" })).toBe(true);
  });
});

/* -------------------------------------------- 1 and 2: bytes and stops hold */

const demo = async () => ({
  storyboard: storyboardSchema.parse(await load("demo/storyboard.json")),
  source: sourceSchema.parse(await load("demo/source.json")),
});

describe("classic is v0.8.0", () => {
  it("emits the same bytes with no design and with design: classic, for every demo beat", async () => {
    const { storyboard, source } = await demo();
    for (const b of storyboard.beats) {
      const a = emitScene(b, ctx(undefined, source));
      const c = emitScene(b, ctx("classic", source));
      expect(bytes(c), b.id).toBe(bytes(a));
      expect(a.fit, b.id).toBeUndefined();
    }
  });

  it("emits the same composition, and no fit manifest, through emitDeck", async () => {
    const { storyboard, source } = await demo();
    const plain = emitDeck(storyboard, source, deck, "/*rt*/");
    const classic = emitDeck(storyboard, source, deck, "/*rt*/", { design: "classic" });
    expect(classic.composition).toBe(plain.composition);
    expect(classic.page).toBe(plain.page);
    expect(classic.fit).toBeUndefined();
  });
});

describe("v2 keeps every stop where classic put it", () => {
  for (const id of ["deck-16x9", "short-9x16", "post-1x1", "video-16x9"]) {
    it(`holds and refusals are identical for every demo beat at ${id}`, async () => {
      const { storyboard, source } = await demo();
      const format = FORMATS[id as keyof typeof FORMATS] as Format;
      for (const b of storyboard.beats) {
        const run = (d?: Design) => {
          try {
            return emitScene(b, ctx(d, source, format));
          } catch (err) {
            return err as Error;
          }
        };
        const c = run();
        const v = run("v2");
        expect(v instanceof Error, `${b.id} refusal`).toBe(c instanceof Error);
        if (c instanceof Error || v instanceof Error) continue;
        expect(v.holds, b.id).toEqual(c.holds);
      }
    });
  }

  it("and the composition differs, so v2 is not a no-op", async () => {
    const { storyboard, source } = await demo();
    const classic = emitDeck(storyboard, source, deck, "/*rt*/");
    const v2 = emitDeck(storyboard, source, deck, "/*rt*/", { design: "v2" });
    expect(v2.composition).not.toBe(classic.composition);
    expect(v2.fit?.design).toBe("v2");
    expect(v2.fit?.scenes.map((s) => s.beat)).toEqual(classic.cut.kept.map((b) => b.id));
  });
});

/* ---------------------------------------------------- 3: the growth is real */

/** The bar thickness a scene drew: the first rail's height attribute. */
const railH = (s: Scene) =>
  Number(
    /class="bc-rail"[^>]*height="([\d.]+)"|height="([\d.]+)"[^>]*class="bc-rail"/
      .exec(s.html)
      ?.slice(1)
      .find(Boolean),
  );

describe("bar-compare under v2", () => {
  const two = beat("bar-compare", {
    headline: "Two numbers",
    note: "the difference is the whole paper",
    bars: [
      { label: "Before", value: 28.91 },
      { label: "After", value: 30.47 },
    ],
  });

  it("lifts BAR_MAX past 96 for two bars, where classic stops at it", () => {
    const c = barCompare(two, ctx());
    const v = barCompare(two, ctx("v2"));
    expect(railH(c)).toBe(96);
    expect(railH(v)).toBeGreaterThan(96);
    expect(railH(v)).toBeLessThanOrEqual(96 * GROWTH);
  });

  it("pins the note to the region's floor and predicts a FULL body", () => {
    const v = barCompare(two, ctx("v2"));
    expect(v.css).toContain("#s1 .bc-wrap{margin-bottom:auto}");
    expect(fillBand(v.fit?.fill ?? 0)).toBe("full");
  });

  it("draws the classic chart when the grown one cannot fit, instead of refusing", () => {
    // Eight two-line labels: classic fits them at its own caps; v2 must too.
    const many = beat("bar-compare", {
      headline: "Every knob, measured, across a long and wrapping headline that takes two lines",
      bars: Array.from({ length: 8 }, (_, i) => ({
        label: `Ablation variant number ${i}`,
        value: i + 1,
      })),
    });
    expect(() => barCompare(many, ctx())).not.toThrow();
    expect(() => barCompare(many, ctx("v2"))).not.toThrow();
  });
});

describe("pipeline under v2", () => {
  const stages = [
    { label: "Assess missing information", note: "Original prompt + accumulated feedback" },
    { label: "Gather evidence", note: "search · image_search · browse" },
    { label: "Return grounded inputs", note: "Final prompt + selected images" },
  ];
  const W = contentW(deck);

  it("sets the labels bigger than classic's 52px and grows the boxes with them", () => {
    const c = pipeLayout(W, stages);
    const v = pipeLayout(W, stages, undefined, "latin", { budget: 700, region: 838 });
    expect(c.size).toBeLessThanOrEqual(52);
    expect(v.size).toBeGreaterThan(c.size);
    expect(v.note).toBeGreaterThan(c.note);
    expect(v.boxH).toBeGreaterThan(c.boxH);
  });

  it("never grows a box past 0.8 of the region, nor the diagram past its budget", () => {
    const v = pipeLayout(W, stages, undefined, "latin", { budget: 700, region: 838 });
    expect(v.boxH).toBeLessThanOrEqual(0.8 * 838);
    expect(v.svgH).toBeLessThanOrEqual(700);
  });

  it("keeps a classic row byte for byte when nothing grown fits the budget", () => {
    const c = pipeLayout(W, stages);
    const v = pipeLayout(W, stages, undefined, "latin", { budget: 10, region: 10 });
    expect(v).toEqual(c);
  });

  it("predicts a filled region for a three-stage row with a note", () => {
    const v = pipeline(
      beat("pipeline", { headline: "How it runs", note: "Three steps.", stages }),
      ctx("v2"),
    );
    expect(v.fit?.fill).toBeGreaterThanOrEqual(FULL_AT);
  });
});

describe("callout under v2", () => {
  const short = beat("callout", {
    headline: "What the source does not test",
    panels: [
      { label: "Tested", lines: ["Indoor scenes"] },
      { label: "Not tested", lines: ["Outdoor scenes"] },
    ],
  });

  it("grows the panels' type, scoped to the scene, where classic stays at 40/50", () => {
    const c = callout(short, ctx());
    const v = callout(short, ctx("v2"));
    expect(c.css).not.toContain("#s1 .panel{");
    const body = Number(/#s1 \.panel\{font-size:(\d+)px/.exec(v.css ?? "")?.[1]);
    expect(body).toBeGreaterThan(40);
    expect(body).toBeLessThanOrEqual(56);
  });

  it("refuses exactly what classic refuses", () => {
    const over = beat("callout", {
      headline: "Too much",
      panels: [
        { label: "All of it", lines: Array.from({ length: 14 }, () => "a line of panel text") },
      ],
    });
    expect(() => callout(over, ctx())).toThrow(/callout b1/);
    expect(() => callout(over, ctx("v2"))).toThrow(/callout b1/);
  });
});

describe("claim-figure under v2", () => {
  const withFigure = (w: number, h: number): Source =>
    ({
      ...bare,
      figures: [{ id: "f1", src: "f1.png", caption: "Figure 1: the result.", width: w, height: h }],
    }) as Source;
  const claim = beat("claim-figure", {
    headline: "The figure carries the claim",
    claim: "It holds across every split.",
    figureId: "f1",
  });

  it("SIZES the plate instead of leaving a small figure at its natural pixels", () => {
    const src = withFigure(400, 300);
    const c = claimFigure(claim, ctx(undefined, src));
    const v = claimFigure(claim, ctx("v2", src));
    expect(c.css).toContain("width:auto;height:auto");
    const m = /#s1 \.figwrap img\{width:(\d+)px;height:(\d+)px/.exec(v.css ?? "");
    expect(Number(m?.[1])).toBeGreaterThan(400);
    // Never more than twice its own pixels.
    expect(Number(m?.[1])).toBeLessThanOrEqual(800);
  });

  it("grows the claim without adding a line to it", () => {
    const v = claimFigure(claim, ctx("v2", withFigure(1000, 750)));
    expect(Number(/#s1 \.claim\{font-size:(\d+)px/.exec(v.css ?? "")?.[1])).toBeGreaterThan(50);
  });

  it("moves a 2.3:1 figure under its claim, where beside it is width-bound", () => {
    const src = withFigure(1150, 500);
    expect(claimFigure(claim, ctx(undefined, src)).html).toContain("cf-beside");
    const v = claimFigure(claim, ctx("v2", src));
    expect(v.html).toContain("cf-under");
    expect(fillBand(v.fit?.fill ?? 0)).toBe("full");
  });
});

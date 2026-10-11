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
import { annotatedFigure } from "../src/emit/archetypes/annotated-figure.js";
import { barCompare } from "../src/emit/archetypes/bar-compare.js";
import { callout } from "../src/emit/archetypes/callout.js";
import { type Arrangement, choose, claimFigure } from "../src/emit/archetypes/claim-figure.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { pipeLayout, pipeline } from "../src/emit/archetypes/pipeline.js";
import { stack } from "../src/emit/archetypes/stack.js";
import { emitDeck } from "../src/emit/composition.js";
import {
  EMPTY_BELOW,
  FULL_AT,
  fillBand,
  fitOf,
  GROWTH,
  growToFit,
  isV2,
  MEASURE_SLACK,
} from "../src/emit/fit.js";
import type { EmitContext, Scene, Theme } from "../src/emit/kit.js";
import { contentW } from "../src/emit/kit.js";
import { cutsWord, faceOf, textWidth, typeOf } from "../src/emit/svg.js";
import { PACKS } from "../src/emit/themes/packs.js";
import { TYPE_SCALE } from "../src/emit/type.js";
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

  it("keeps every grown value's glyph box inside the chart, which 0.9 of a bar did not", () => {
    // From HypePaper deck 3b7225ad: at 0.9 of an 84px bar the first 76px value
    // stood 5px above the chart, and `hyperframes check` failed the deck.
    const four = beat("bar-compare", {
      eyebrow: "Full fine-tuning · Distributional quality",
      headline: "D-OPSD achieves the lowest FID on both base models.",
      unit: "FID ↓",
      note: "FID improvements over the runner-up: 8.1920 and 6.9403.",
      bars: [
        { label: "Z-Image-Turbo · Base", value: 48.6858, tone: "b" },
        { label: "Z-Image-Turbo · D-OPSD", value: 40.4938, tone: "a" },
        { label: "FLUX.2-klein · Base", value: 45.2335, tone: "b" },
        { label: "FLUX.2-klein · D-OPSD", value: 38.2932, tone: "a" },
      ],
    });
    const v = barCompare(four, ctx("v2"));
    const values = [
      ...v.html.matchAll(/<text x="[\d.]+" y="([\d.]+)" class="bc-val"[^>]*font-size="([\d.]+)"/g),
    ];
    expect(values).toHaveLength(4);
    for (const [, y, size] of values)
      expect(Number(y) - 0.96 * Number(size)).toBeGreaterThanOrEqual(0);
  });

  it("leaves a grown label its measurement slack inside the gutter, so it cannot run off the left", () => {
    // HypePaper ko deck 450790a0: "InfiniDepth" at a grown 74px, right-aligned
    // to a gutter sized to the width table's answer, drew 8px left of the chart.
    const korean: Theme = { ...theme, fontStack: '"Noto Sans KR", "Inter", system-ui, sans-serif' };
    const b = beat("bar-compare", {
      eyebrow: "Boundary F1",
      headline: "경계 일치도는 개선되지만 최고 성능에는 못 미친다.",
      unit: "점",
      note: "높을수록 좋음 · 경계 매칭 반경 1",
      bars: [
        { label: "MoGe-2", value: 15.6, tone: "a" },
        { label: "MoGe-3", value: 16, tone: "b" },
        { label: "InfiniDepth", value: 19.3, tone: "c" },
      ],
    });
    const v = barCompare(b, { ...ctx("v2"), theme: korean });
    const labels = [
      ...v.html.matchAll(
        /<text x="([\d.]+)"[^>]*class="bc-lab" font-size="([\d.]+)"[^>]*>(?:<tspan[^>]*>)?([^<]+)/g,
      ),
    ];
    expect(labels).toHaveLength(3);
    for (const [, x, size, text] of labels) {
      const width = textWidth(
        text as string,
        Number(size),
        600,
        0,
        false,
        faceOf(korean.fontStack),
      );
      expect(width).toBeLessThanOrEqual(Number(x) * MEASURE_SLACK + 0.5);
    }
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

  it("sets the labels on the v2 scale, 44px at most, and grows the boxes instead", () => {
    // Founder, 2026-10-10: "the fonts are too large". The boxes still grow into
    // the region; the type no longer does (it reached 83px).
    const c = pipeLayout(W, stages);
    const v = pipeLayout(W, stages, undefined, "latin", { budget: 700, region: 838 });
    expect(c.size).toBeLessThanOrEqual(52);
    expect(v.size).toBeLessThanOrEqual(TYPE_SCALE.body);
    expect(v.size).toBeGreaterThanOrEqual(TYPE_SCALE.floor);
    expect(v.note).toBe(TYPE_SCALE.floor);
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

  it("grows a label only while every word still sets whole", () => {
    // The 2026-10-07 ko deck (9cd69d55): grown to the largest two-line size,
    // "Rectified-flow 학습" was cut to "Rectified-flo" / "w 학습".
    const ko = [
      { label: "T5·Wan-VAE 인코딩", note: "텍스트·참조 이미지·대상 비디오" },
      { label: "DiT 예측", note: "잡음 잠재변수·조건·시점 입력" },
      { label: "Rectified-flow 학습", note: "표준 RF 목적 함수" },
    ];
    const face = faceOf('"Noto Sans KR", "IBM Plex Sans", "Inter", system-ui, sans-serif');
    const v = pipeLayout(W, ko, undefined, face, { budget: 600, region: 760 });
    const c = pipeLayout(W, ko, undefined, face);
    expect(v.size).toBeGreaterThan(c.size);
    for (const s of ko) expect(cutsWord(s.label, v.size, v.innerW, 600, face)).toBe(false);
    expect(v.labelLines.flat().some((l) => /Rectified-flo$/.test(l))).toBe(false);
  });

  it("lifts a five-stage row toward the band, past the aspect cap but not the air cap", () => {
    // The 2026-10-09 ko deck, b05: five ~315px boxes, the label held at 56px by
    // the unbreakable "멀티스케일", and the 1.2 aspect stopping the boxes at
    // ~380px — 56% of a 698px region, measured as hollow_at_hold.
    const five = [
      { label: "얕은 특징 추출", note: "3×3 합성곱" },
      { label: "멀티스케일 인코더", note: "SRB·다운샘플링" },
      { label: "디코더", note: "업샘플링·스킵 연결" },
      { label: "PRB", note: "스파이크를 연속 표현으로 변환" },
      { label: "출력 합성곱", note: "3×3 합성곱으로 영상 출력" },
    ];
    const face = faceOf('"Noto Sans KR", "IBM Plex Sans", "Inter", system-ui, sans-serif');
    const region = 698;
    const v = pipeLayout(1700, five, undefined, face, { budget: region, region });
    const fill = v.svgH / region;
    // Since the labels stopped at 44px (2026-10-10) the AIR cap binds first: the
    // box passes the aspect cap toward the band, but never becomes a tall card
    // around two short words. A quiet row under the band is a warning, by design.
    expect(fill).toBeGreaterThan(0.5);
    expect(fill).toBeLessThanOrEqual(EMPTY_BELOW + 0.05);
    expect(v.boxH).toBeGreaterThan(v.boxW * 1.2);
    expect(v.boxH).toBeLessThanOrEqual(0.8 * region);
    for (const s of five) expect(cutsWord(s.label, v.size, v.innerW, 600, face)).toBe(false);
    // Four stages in 680px: the same caps, the same answer — never past the band's target.
    const four = pipeLayout(1700, five.slice(0, 4), undefined, face, { budget: 680, region: 680 });
    expect(four.svgH / 680).toBeLessThan(EMPTY_BELOW + 0.05);
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

  it("never grows a panel title past 0.9 of the pack's headline", () => {
    // ja s3, s14 (review 2026-10-08): 70px panel titles under a 62px headline.
    for (const name of Object.keys(PACKS)) {
      const theme = PACKS[name] as Theme;
      const v = callout(short, { ...ctx("v2"), theme });
      const label = Number(/#s1 \.plabel\{font-size:(\d+)px/.exec(v.css ?? "")?.[1] ?? 50);
      const headline = typeOf(faceOf(theme.fontStack)).headline.size;
      expect(label, name).toBeLessThanOrEqual(Math.ceil(0.9 * headline));
    }
  });

  it("sets short panels as the rows of a table, and fills more of the box doing it", () => {
    const rows = callout(short, { ...ctx("v2"), look: { variant: "rows", placement: "top" } });
    const panels = callout(short, ctx("v2"));
    expect(rows.css).toContain("#s1 .panel{display:grid;grid-template-columns:");
    expect(rows.html).toContain("grid-template-columns:repeat(1, 1fr)");
    expect(rows.holds).toEqual(panels.holds);
    // Rows share the height, and none is lifted out of line with the others.
    expect(rows.css).toContain("grid-auto-rows:1fr");
    expect(rows.tl.some((t) => t.to.scale !== undefined)).toBe(false);
    // …and under v2 no panel is lifted either: a card popping up as it is read
    // is the UI-element motion the founder called old-fashioned (2026-10-10).
    expect(panels.tl.some((t) => t.to.scale !== undefined)).toBe(false);
    expect(callout(short, ctx()).tl.some((t) => t.to.scale !== undefined)).toBe(true);
    expect(rows.fill ?? 0).toBeGreaterThan(panels.fill ?? 0);
    const long = beat("callout", {
      headline: "A long one",
      panels: [
        { label: "A", lines: ["one", "two", "three", "four", "five"] },
        { label: "B", lines: ["one"] },
      ],
    });
    expect(() =>
      callout(long, { ...ctx("v2"), look: { variant: "rows", placement: "top" } }),
    ).toThrow(/not a table row/);
  });

  it("scores a sparse rows table by its content, not the 75% it is opened out to, and says so", () => {
    // ko deck b06 (2026-10-09): two two-line rows reported fill 0.75 — the
    // share `ROWS_FILL` stretches the table to — with half the slide empty.
    const rows = callout(short, { ...ctx("v2"), look: { variant: "rows", placement: "top" } });
    expect(rows.fill ?? 1).toBeLessThan(0.7);
    expect(rows.warnings?.join(" ")).toMatch(/opened out with air/);
    // Panels never carry the rows warning.
    expect(callout(short, ctx("v2")).warnings).toBeUndefined();
  });

  it("splits a panel's air above and below its lines, and balances a wrapped line", () => {
    // ko deck b09 (2026-10-09): three panels to y≈655 with their text ending at
    // y≈445-500, and "= 0.9" alone on a line.
    const v = callout(short, ctx("v2"));
    expect(v.css).toContain(
      "#s1 .panel{display:flex;flex-direction:column;justify-content:center}",
    );
    expect(v.css).toContain("#s1 .pline,#s1 .plabel{text-wrap:balance}");
    // Rows are a table: their own grid, not a centred column.
    const rows = callout(short, { ...ctx("v2"), look: { variant: "rows", placement: "top" } });
    expect(rows.css).not.toContain("justify-content:center}");
    // Classic is untouched.
    expect(callout(short, ctx()).css).not.toContain("text-wrap");
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
    // Never more than 1.25x its own pixels: past that a raster goes soft
    // (review 2026-10-08: 1.8x and 2.07x, both visibly blurry).
    expect(Number(m?.[1])).toBeLessThanOrEqual(500);
    // And the white plate hugs the picture rather than spanning its column.
    expect(v.css).toContain("#s1 .figwrap{width:fit-content;max-width:100%");
    expect(c.css).not.toContain("fit-content");
  });

  it("never trades the figure's area for a fuller-looking arrangement", () => {
    // en s13 (review 2026-10-08): a 1.74:1 photo set full-width above its claim
    // was height-bound inside a 1760px plate, because fill counts the plate's
    // HEIGHT. An arrangement that fills more but draws the picture smaller loses.
    const arr = (mode: "beside" | "wide", w: number, h: number, fill: number): Arrangement => ({
      mode,
      claimSize: 50,
      plate: { w, h },
      fit: { fill, region: 760, ink: fill * 760 },
    });
    const beside = arr("beside", 1000, 560, 0.8);
    expect(choose([beside, arr("wide", 820, 470, 0.97)])).toBe(beside);
    // A fuller arrangement that keeps the picture's size still wins.
    const wide = arr("wide", 1100, 560, 0.97);
    expect(choose([beside, wide])).toBe(wide);
    // And the scene reports the area the image is painted at.
    const v = claimFigure(claim, ctx("v2", withFigure(900, 517)));
    const m = /#s1 \.figwrap img\{width:(\d+)px;height:(\d+)px/.exec(v.css ?? "");
    expect(v.figureArea).toBe(Number(m?.[1]) * Number(m?.[2]));
  });

  it("never grows the claim into the height a wide figure had at its classic size", () => {
    // set20 8872a314 s3 (fix-round Tier A): a 1159x326 strip under a grown
    // 120-character claim came out 732x206, 40% of what classic drew.
    const strip = withFigure(1159, 326);
    const long = beat("claim-figure", {
      headline: "The figure carries the claim",
      claim:
        "A claim long enough to wrap onto several lines once it is set at the larger size the fit engine would like to give it here.",
      figureId: "f1",
    });
    const c = claimFigure(long, ctx(undefined, strip));
    const v = claimFigure(long, ctx("v2", strip));
    expect(v.figureArea ?? 0).toBeGreaterThanOrEqual(c.figureArea ?? 0);
  });

  it("sets the claim as a body line on the v2 scale, in every arrangement", () => {
    for (const fig of [withFigure(1000, 750), withFigure(1150, 500), withFigure(400, 900)]) {
      const v = claimFigure(claim, ctx("v2", fig));
      const sizes = [...(v.css ?? "").matchAll(/\.claim\{font-size:(\d+)px/g)].map((m) =>
        Number(m[1]),
      );
      expect(sizes.length).toBeGreaterThan(0);
      for (const n of sizes) expect(n).toBe(TYPE_SCALE.body);
    }
  });

  it("moves a 2.3:1 figure under its claim, where beside it is width-bound", () => {
    const src = withFigure(1150, 500);
    expect(claimFigure(claim, ctx(undefined, src)).html).toContain("cf-beside");
    const v = claimFigure(claim, ctx("v2", src));
    expect(v.html).toContain("cf-under");
    // Sparse, not full, since the claim stopped growing to 72px (2026-10-10).
    expect(fillBand(v.fit?.fill ?? 0)).not.toBe("empty");
  });
});

describe("equation-walk under v2", () => {
  it("asks for a display no larger than TYPE_SCALE.math, and sets the legend as body lines", async () => {
    // The display was grown to 1.3x classic's 68-108px and the legend to 60px;
    // the founder's verdict on that scale was "too large" (2026-10-10).
    const { storyboard, source } = await demo();
    const walk = storyboard.beats.find((b) => b.archetype === "equation-walk") as Beat;
    const c = emitScene(walk, ctx(undefined, source));
    const v = emitScene(walk, ctx("v2", source));
    const size = (s: Scene) => Number(/id="s1-eq" style="font-size:(\d+)px/.exec(s.html)?.[1]);
    expect(size(c)).toBeGreaterThan(TYPE_SCALE.math);
    expect(size(v)).toBeLessThanOrEqual(TYPE_SCALE.math);
    expect(size(v)).toBeGreaterThanOrEqual(TYPE_SCALE.floor);
    expect(c.css).toMatch(/\.leg\{[^}]*font-size:48px/);
    expect(v.css).toMatch(new RegExp(`\\.leg\\{[^}]*font-size:${TYPE_SCALE.body}px`));
    expect(v.fit?.fill).toBeGreaterThan(0);
  });
});

describe("stack under v2", () => {
  const few = beat("stack", {
    headline: "Three layers",
    layers: [{ label: "Bottom" }, { label: "Middle" }, { label: "Top" }],
  });
  const height = (s: Scene) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(s.html)?.[1]);

  it("lets the rise grow past classic's 180px a layer when the region has room", () => {
    const v = stack(few, ctx("v2"));
    expect(height(v)).toBeGreaterThan(height(stack(few, ctx())));
    expect(v.fit?.fill).toBeGreaterThanOrEqual(FULL_AT * 0.95);
  });
});

describe("annotated-figure under v2", () => {
  it("draws a small figure no larger than classic's 1.5x: past that a raster goes soft", () => {
    const src = {
      ...bare,
      figures: [{ id: "f1", src: "f1.png", caption: "Figure 1.", width: 300, height: 200 }],
    } as Source;
    const b = beat("annotated-figure", {
      headline: "Look here",
      figureId: "f1",
      notes: [{ x: 0.2, y: 0.5, text: "this part", tone: "a" }],
    });
    // The stage's overlay is the figure's height plus nothing: 200px drawn at 1.5x and 2x.
    const h = (s: Scene) => Number(/id="s1-ov" width="[\d.]+" height="([\d.]+)"/.exec(s.html)?.[1]);
    expect(h(annotatedFigure(b, ctx(undefined, src)))).toBe(300);
    expect(h(annotatedFigure(b, ctx("v2", src)))).toBe(300);
  });
});

describe("archetypes that already fill their budget", () => {
  it("report it under v2, so the gate can check the claim, and say nothing in classic", async () => {
    const { storyboard, source } = await demo();
    for (const kind of ["split-compare", "line-chart"] as const) {
      const b = storyboard.beats.find((x) => x.archetype === kind) as Beat;
      expect(emitScene(b, ctx(undefined, source)).fit, kind).toBeUndefined();
      expect(fillBand(emitScene(b, ctx("v2", source)).fit?.fill ?? 0), kind).toBe("full");
    }
  });
});

/**
 * `--design v2` layouts: the frames and the archetype variants (src/emit/look.ts).
 *
 * Two kinds of claim are pinned here. The CLASSIC frame is the old trio
 * (`contentW`, `bodyBudget`, `chrome()`) to the byte, which is what keeps a
 * classic build v0.8.0's. And every variant keeps the classic scene's TIME —
 * its holds and its chrome landing — because narration was timed against it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { bodyBudget, chrome } from "../src/emit/archetypes/title.js";
import { openSeconds } from "../src/emit/composition.js";
import type { EmitContext, Scene, Theme } from "../src/emit/kit.js";
import { contentH, contentW } from "../src/emit/kit.js";
import {
  candidates,
  classicLook,
  frameOf,
  type Look,
  RAIL_GAP,
  railWidth,
  signature,
} from "../src/emit/look.js";
import { ink } from "../src/emit/themes/ink.js";
import {
  type Beat,
  type BeatOf,
  FORMATS,
  type Format,
  type Source,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const format = FORMATS["deck-16x9"] as Format;
const theme: Theme = ink;
const repo = (rel: string) => new URL(`../${rel}`, import.meta.url);
const demo = storyboardSchema.parse(JSON.parse(readFileSync(repo("demo/storyboard.json"), "utf8")));
const demoSource = sourceSchema.parse(JSON.parse(readFileSync(repo("demo/source.json"), "utf8")));

const source: Source = {
  ...demoSource,
  figures: [
    ...demoSource.figures,
    { id: "aside", kind: "image", src: "aside.png", caption: "An aside", width: 1200, height: 900 },
    { id: "strip", kind: "image", src: "strip.png", caption: "A strip", width: 2400, height: 600 },
  ],
};
const ctx = (look?: Look, f: Format = format): EmitContext => ({
  source,
  format: f,
  theme,
  sid: "s1",
  start: 0,
  ...(look ? { look } : {}),
});

const bars = (n: number, values?: number[]): BeatOf<"bar-compare"> =>
  ({
    id: "b-bars",
    archetype: "bar-compare",
    intent: "Compare.",
    evidence: [],
    weight: 0.5,
    seconds: 7,
    params: {
      eyebrow: "Results",
      headline: "Ours is faster on every benchmark we ran",
      unit: "ms",
      bars: Array.from({ length: n }, (_, i) => ({
        label: `Method ${i}`,
        value: values?.[i] ?? 10 + i,
      })),
    },
  }) as BeatOf<"bar-compare">;

const pipe = (stages: number, loop = false): BeatOf<"pipeline"> =>
  ({
    id: "b-pipe",
    archetype: "pipeline",
    intent: "Show the flow.",
    evidence: [],
    weight: 0.5,
    seconds: 8,
    params: {
      eyebrow: "Method",
      headline: "Four steps from pixels to an answer",
      stages: Array.from({ length: stages }, (_, i) => ({ label: `Stage ${i}`, note: "detail" })),
      ...(loop ? { loop: { from: stages - 1, to: 0, label: "again" } } : {}),
    },
  }) as BeatOf<"pipeline">;

const split = (figure = false): BeatOf<"split-compare"> =>
  ({
    id: "b-split",
    archetype: "split-compare",
    intent: "Contrast.",
    evidence: [{ kind: "figure", id: "aside" }],
    weight: 0.5,
    seconds: 7,
    params: {
      eyebrow: "Setting",
      headline: "Two ways to look at a scene",
      left: figure
        ? { label: "Passive", figureId: "aside" }
        : { label: "Passive", lines: ["Fixed views", "No control"] },
      right: { label: "Active", lines: ["Chosen views", "Tests hypotheses"] },
    },
  }) as BeatOf<"split-compare">;

const claim = (
  figureId = "fig-arch",
  text = "A short claim about the figure.",
): BeatOf<"claim-figure"> =>
  ({
    id: "b-claim",
    archetype: "claim-figure",
    intent: "Point.",
    evidence: [{ kind: "figure", id: "aside" }],
    weight: 0.5,
    seconds: 7,
    params: { eyebrow: "Finding", headline: "The figure shows the point", claim: text, figureId },
  }) as BeatOf<"claim-figure">;

/** What a look must not change: holds, and when the chrome lands. */
const timing = (s: Scene) => ({ holds: s.holds, open: openSeconds(s) });

describe("the classic frame is the old trio, to the byte", () => {
  it("measures and composes exactly as contentW / bodyBudget / chrome() did", () => {
    for (const [eyebrow, headline] of [
      ["Results", "Ours is faster"],
      [undefined, "A much longer headline that wraps onto a second line at sixty-four pixels"],
    ] as const) {
      const F = frameOf(ctx(), { eyebrow, headline });
      expect(F.w).toBe(contentW(format));
      expect(F.budget(58, 26, 0)).toBe(bodyBudget(format, eyebrow, headline, 58, 26, 0));
      expect(F.budget()).toBe(bodyBudget(format, eyebrow, headline));
      expect(F.compose("<b/>")).toBe(`${chrome("s1", eyebrow, headline, contentW(format))}\n<b/>`);
      expect(F.css).toBe("");
      expect(F.tl).toEqual([]);
    }
  });

  it("draws every demo beat identically with no look and with its classic look", () => {
    // Every archetype but claim-figure: its plate cap is scoped to the scene
    // under v2 (see the claim-figure block below), which is the one intended
    // difference.
    for (const [i, beat] of demo.beats.entries()) {
      if (beat.archetype === "claim-figure") continue;
      const c = { ...ctx(), sid: `s${i + 1}` };
      expect(emitScene(beat, { ...c, look: classicLook(beat.archetype) })).toEqual(
        emitScene(beat, c),
      );
    }
  });
});

describe("rail", () => {
  const look: Look = { variant: "bars", placement: "rail" };

  it("sets the chrome in a left column and gives the body the rest of the width", () => {
    const F = frameOf(ctx(look), { eyebrow: "Results", headline: "Ours is faster" });
    expect(F.placement).toBe("rail");
    expect(F.w).toBe(contentW(format) - railWidth(format) - RAIL_GAP);
    // Nothing is stacked above the body: it has the full content height.
    expect(F.budget(0)).toBe(contentH(format));
    const html = F.compose("<i>body</i>");
    expect(html.indexOf('class="headline"')).toBeLessThan(html.indexOf("<i>body</i>"));
    expect(html).toContain('class="lk-rail"');
    expect(F.css).toContain(`grid-template-columns:${railWidth(format)}px ${F.w}px`);
  });

  it("refuses a headline too tall for the rail rather than clipping it", () => {
    expect(() => frameOf(ctx(look), { eyebrow: "X", headline: "word ".repeat(200) })).toThrow(
      /rail: the headline needs/,
    );
  });

  it("sets an aside only from a figure the beat cites and does not already draw", () => {
    const cited = frameOf(ctx(look), {
      eyebrow: "R",
      headline: "Short",
      evidence: [{ kind: "figure", id: "aside" }],
    });
    expect(cited.compose("")).toContain('src="assets/aside.png"');
    expect(cited.tl.map((t) => t.target)).toContain("#s1-ax");
    const drawn = frameOf(ctx(look), {
      eyebrow: "R",
      headline: "Short",
      drawn: ["aside"],
      evidence: [{ kind: "figure", id: "aside" }],
    });
    expect(drawn.compose("")).not.toContain("lk-aside");
    const uncited = frameOf(ctx(look), { eyebrow: "R", headline: "Short" });
    expect(uncited.compose("")).not.toContain("lk-aside");
  });

  it("is only offered on a canvas wide enough for it", () => {
    for (const f of [FORMATS["short-9x16"], FORMATS["post-1x1"]] as Format[]) {
      for (const beat of [bars(3), pipe(4), split(), claim()] as Beat[]) {
        expect(candidates(beat, f).map((l) => l.placement)).not.toContain("rail");
      }
    }
  });
});

describe("foot", () => {
  it("puts the body first and anchors the chrome under it", () => {
    const F = frameOf(ctx({ variant: "bars", placement: "foot" }), {
      eyebrow: "R",
      headline: "Short",
    });
    const html = F.compose("<i>body</i>");
    expect(html.indexOf("<i>body</i>")).toBeLessThan(html.indexOf('class="headline"'));
    // Less than the top frame's budget: the separator above the chrome is paid for.
    expect(F.budget(0, 34)).toBeLessThan(bodyBudget(format, "R", "Short", 0, 34));
  });
});

describe("every variant keeps the classic scene's time", () => {
  const beats: Beat[] = [
    bars(2),
    bars(4),
    bars(6),
    pipe(3),
    pipe(4),
    pipe(5),
    split(),
    claim(),
    claim("aside"),
  ];
  for (const beat of beats) {
    it(`${beat.id} (${beat.archetype})`, () => {
      const base = timing(emitScene(beat, ctx()));
      let drawn = 0;
      for (const look of candidates(beat, format)) {
        let scene: Scene;
        try {
          scene = emitScene(beat, ctx(look));
        } catch {
          continue; // a refusal is allowed; a different clock is not
        }
        drawn++;
        expect(timing(scene), signature(beat.archetype, look)).toEqual(base);
      }
      expect(drawn).toBeGreaterThan(1);
    });
  }
});

describe("bar-compare: columns", () => {
  const look: Look = { variant: "columns", placement: "top" };

  it("fills the height a two-bar row band leaves empty", () => {
    const rows = emitScene(bars(2), ctx());
    const cols = emitScene(bars(2), ctx(look));
    expect(rows.fill).toBeLessThan(0.5);
    expect(cols.fill).toBeGreaterThan(0.9);
    expect(cols.html).toContain('id="s1-bar1"');
    // Bars grow upward: the tween writes y and height, not x and width.
    const grow = cols.tl.find((t) => t.target === "#s1-bar0");
    expect(Object.keys(grow?.to.attr ?? {})).toEqual(["y", "height"]);
  });

  it("refuses negative values rather than drawing a zero line mid-column", () => {
    expect(() => emitScene(bars(3, [5, -2, 3]), ctx(look))).toThrow(/negative/);
  });
});

describe("pipeline: stair and column", () => {
  it("steps each stage down, and uses height the row leaves", () => {
    const row = emitScene(pipe(4), ctx());
    const stair = emitScene(pipe(4), ctx({ variant: "stair", placement: "top" }));
    expect(stair.fill ?? 0).toBeGreaterThan(row.fill ?? 0);
    expect(stair.html).not.toEqual(row.html);
  });

  it("has no stair for a loop or for two stages", () => {
    expect(() => emitScene(pipe(4, true), ctx({ variant: "stair", placement: "top" }))).toThrow(
      /return path/,
    );
    expect(() => emitScene(pipe(2), ctx({ variant: "stair", placement: "top" }))).toThrow(/slope/);
  });

  it("runs a column down the rail body, and refuses one taller than it", () => {
    const col = emitScene(pipe(3), ctx({ variant: "column", placement: "rail" }));
    expect(col.html).toContain("lk-rail");
    expect(() => emitScene(pipe(8), ctx({ variant: "column", placement: "rail" }))).toThrow(
      /column of 8 stages/,
    );
  });
});

describe("claim-figure: mirror and stacked", () => {
  it("mirror puts the figure first in the beside row", () => {
    const html = emitScene(claim("aside"), ctx({ variant: "mirror", placement: "top" })).html;
    expect(html).toContain("cf-mirror");
    expect(html.indexOf('class="figwrap"')).toBeLessThan(html.indexOf('class="claim"'));
  });

  it("mirror refuses where the classic slide would not draw the beside row", () => {
    expect(() => emitScene(claim("strip"), ctx({ variant: "mirror", placement: "top" }))).toThrow(
      /mirror needs the beside row/,
    );
  });

  it("stacked sets the claim above the figure on a wide canvas", () => {
    expect(emitScene(claim(), ctx({ variant: "stacked", placement: "top" })).html).toContain(
      "cf-stack",
    );
  });

  it("scopes the plate's height cap to its own scene under v2, and only under v2", () => {
    // Scene CSS is one global sheet, so a bare `.figwrap img{max-height}` set
    // per beat is decided for every claim-figure by the last one in the deck.
    expect(emitScene(claim(), ctx()).css).toMatch(/\n\.figwrap img\{/);
    expect(emitScene(claim(), ctx(classicLook("claim-figure"))).css).toContain("#s1 .figwrap img{");
  });
});

describe("split-compare: rows", () => {
  it("stacks two list panels as full-width bands on a wide canvas", () => {
    const cols = emitScene(split(), ctx());
    const rows = emitScene(split(), ctx({ variant: "rows", placement: "rail" }));
    expect(rows.html).not.toEqual(cols.html);
    expect(rows.html).toContain("lk-rail");
  });

  it("refuses a side that is a figure", () => {
    expect(() => emitScene(split(true), ctx({ variant: "rows", placement: "top" }))).toThrow(
      /rows are for lists/,
    );
  });
});

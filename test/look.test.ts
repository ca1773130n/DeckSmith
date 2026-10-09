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
import type { EmitContext, ListForm, Scene, Theme } from "../src/emit/kit.js";
import { contentH, contentW, DIM } from "../src/emit/kit.js";
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
import { PACKS } from "../src/emit/themes/packs.js";
import { direct } from "../src/plan/direct.js";
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
    { id: "small", kind: "image", src: "small.png", caption: "Small", width: 400, height: 300 },
    // Sized like `small`, so only its kind can keep it out of the rail.
    {
      id: "loop",
      kind: "piece",
      src: "loop.js",
      caption: "A loop",
      width: 400,
      height: 300,
      seconds: 4,
    },
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
      evidence: [{ kind: "figure", id: "small" }],
    });
    expect(cited.compose("")).toContain('src="assets/small.png"');
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

  it("never sets an animate piece as an aside: an aside is an <img>, and a piece is a script", () => {
    const piece = frameOf(ctx(look), {
      eyebrow: "R",
      headline: "Short",
      evidence: [{ kind: "figure", id: "loop" }],
    });
    expect(piece.compose("")).not.toContain("lk-aside");
    expect(piece.compose("")).not.toContain("loop.js");
  });

  it("never squeezes a big figure into the rail as an aside, where its text would be unreadable", () => {
    // ko s9 (review 2026-10-08): a 1098px results table drawn ~576px wide in the
    // rail, its numbers at 7-8px. A 1200px figure there would be drawn at 46%.
    const big = frameOf(ctx(look), {
      eyebrow: "R",
      headline: "Short",
      evidence: [{ kind: "figure", id: "aside" }],
    });
    expect(big.compose("")).not.toContain("lk-aside");
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

  it("fills the height a three-bar row band leaves empty", () => {
    const rows = emitScene(bars(3), ctx());
    const cols = emitScene(bars(3), ctx(look));
    expect(rows.fill).toBeLessThan(0.7);
    expect(cols.fill).toBeGreaterThan(0.9);
    expect(cols.html).toContain('id="s1-bar2"');
    // Bars grow upward: the tween writes y and height, not x and width.
    const grow = cols.tl.find((t) => t.target === "#s1-bar0");
    expect(Object.keys(grow?.to.attr ?? {})).toEqual(["y", "height"]);
  });

  it("refuses two columns, which leave most of the plot empty (zh s14, review 2026-10-08)", () => {
    expect(() => emitScene(bars(2), ctx(look))).toThrow(/that is a versus/);
  });

  it("refuses negative values rather than drawing a zero line mid-column", () => {
    expect(() => emitScene(bars(3, [5, -2, 3]), ctx(look))).toThrow(/negative/);
  });

  it("refuses a label it could only set by cutting a word, so the rows draw it whole", () => {
    // Five model names in five ~330px slots: "Qwen2.5-VL-32B-Instruct" is one
    // word wider than its slot at any legible size. The 2026-10-07 ja deck
    // (3a447697) drew "Qwen2." / "5-VL-7" / "B" here before this refusal.
    const long = bars(5);
    for (const b of long.params.bars) b.label = "Qwen2.5-VL-32B-Instruct-Preview";
    expect(() => emitScene(long, ctx(look))).toThrow(/word cut/);
    expect(() => emitScene(long, ctx())).not.toThrow();
  });
});

describe("bar-compare: versus", () => {
  const vs = { variant: "versus", placement: "top" } as const;

  it("sets two values as the slide's largest type, on the rows' own clock", () => {
    const rows = emitScene(bars(2, [58.4, 87.6]), ctx());
    const v = emitScene(bars(2, [58.4, 87.6]), ctx(vs));
    // Same stops: a look moves geometry, never time.
    expect(v.holds).toEqual(rows.holds);
    const sizes = [...v.html.matchAll(/class="bc-val"[^>]*font-size="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(sizes).toHaveLength(2);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(96);
    // The bar keeps the ratio: it grows along x.
    const grow = v.tl.find((t) => t.target === "#s1-bar0");
    expect(Object.keys(grow?.to.attr ?? {})).toEqual(["width"]);
    expect(v.fill).toBeGreaterThan(rows.fill ?? 0);
  });

  it("sets each figure's whole glyph box inside the chart", () => {
    // en s12 (2026-10-08): with the baseline at 0.86em the digits rose out of
    // the chart (`text_box_overflow` on #s12-v0 and -v1).
    const v = emitScene(bars(2, [58.4, 87.6]), ctx(vs));
    for (const m of v.html.matchAll(
      /<text x="[\d.]+" y="([\d.]+)"[^>]*class="bc-val"[^>]*font-size="(\d+)"/g,
    )) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0.96 * Number(m[2]) - 1e-6);
    }
  });

  it("refuses anything but two values", () => {
    expect(() => emitScene(bars(3), ctx(vs))).toThrow(/exactly two/);
    expect(() => emitScene(bars(2, [3, -1]), ctx(vs))).toThrow(/negative/);
  });
});

describe("bar-compare: rows in a rail, grown", () => {
  it("sets a unit too wide for either side of the axis from the chart's left edge", () => {
    // ja 3a447697 b11: five long model names make a wide label gutter, the rail
    // narrows the chart, and a 16-character unit fits neither after nor before
    // the axis — it was drawn end-anchored and ran off the chart's left edge.
    const b = bars(5);
    b.params.bars = b.params.bars.map((x, i) => ({ ...x, label: `Qwen2.5-VL-${7 * (i + 1)}B` }));
    b.params.unit = "最良の総合平均を与えたフレーム数・総合平均";
    const look: Look = { variant: "bars", placement: "rail" };
    const scene = emitScene(b, { ...ctx(look), design: "v2" });
    const tag = /<text x="([\d.]+)"[^>]*id="s1-unit"[^>]*>/.exec(scene.html);
    expect(tag).not.toBeNull();
    // SVG's default anchor is start, so a start-anchored caption carries none.
    const anchor = /text-anchor="(\w+)"/.exec(tag?.[0] ?? "")?.[1] ?? "start";
    expect({ x: Number(tag?.[1]), anchor }).toEqual({ x: 0, anchor: "start" });
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

describe("a pack's own forms", () => {
  // Review 2026-10-08: "one template in four colours" — the same tick, the same
  // pill, the same title on every pack. Each pack now draws them its own way.
  const withList = (list: ListForm): EmitContext => ({
    ...ctx(),
    theme: { ...theme, forms: { list } },
  });

  it("marks list items as the pack says, in the classic indent, and classic keeps its tick", () => {
    const tick = emitScene(split(), ctx()).html;
    const numbered = emitScene(split(), withList("number")).html;
    const dotted = emitScene(split(), withList("dot")).html;
    const carded = emitScene(split(), withList("card")).html;
    const ruled = emitScene(split(), withList("rule")).html;
    expect(numbered).toMatch(/font-size="40"[^>]*><tspan[^>]*>1</);
    expect(numbered).toMatch(/>2</);
    expect(dotted).toContain("<circle");
    expect(tick).not.toContain("<circle");
    expect(carded.match(new RegExp(`fill="${theme.panel}"`, "g"))?.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(ruled).not.toEqual(tick);
    // The items' text is set where classic set it: only the marks differ.
    const texts = (html: string) =>
      [...html.matchAll(/<text[^>]*>[^<]*(Fixed views|Chosen views)/g)].map((m) => m[0]);
    expect(texts(numbered)).toEqual(texts(tick));
  });

  it("gives every v2 pack its own list form, title and bar corners, and leans the Director its own way", () => {
    const lists = new Set(Object.values(PACKS).map((p) => p.forms?.list));
    expect(lists.size).toBeGreaterThanOrEqual(4);
    for (const [name, p] of Object.entries(PACKS)) {
      expect(p.skin, name).toMatch(/\.titleslide/);
      expect(p.forms?.affinity, name).toBeDefined();
    }
    const corners = new Set(
      Object.values(PACKS).map((p) => /\.bc-bar\{rx:(\d+)/.exec(p.skin ?? "")?.[1] ?? "pill"),
    );
    expect(corners.size).toBeGreaterThanOrEqual(4);
  });

  it("opens the same storyboard differently under different packs", () => {
    // The second slide of three of the four preview decks was the same
    // two-column layout at the same coordinates.
    const picks = new Set<string>();
    for (const name of ["signal", "blueprint", "atlas", "folio", "chalk", "journal"]) {
      const theme = PACKS[name] as Theme;
      const d = direct([split()], { source, format, theme, seed: "one-paper", design: "v2" });
      picks.add(d.beats[0]?.signature ?? "");
    }
    expect(picks.size).toBeGreaterThanOrEqual(3);
  });
});

describe("equation-walk under a foot headline", () => {
  it("is refused when the display and its legend do not fit above the foot", () => {
    // en s4 (2026-10-08): a pack leaning to foot looks picked display@foot for
    // this four-term walk under a two-line headline, and the legend ran into the
    // foot chrome (content_overlap at the gate). The beat, as that deck has it.
    const src = {
      ...source,
      equations: [{ id: "eq1", tex: "(\\mathcal{S}, p_0, q, y^*)", display: false }],
    } as typeof source;
    const walk = {
      id: "b-walk",
      archetype: "equation-walk",
      intent: "Read it.",
      evidence: [],
      weight: 0.5,
      seconds: 14,
      params: {
        eyebrow: "Task specification",
        headline: "Each task fixes a scene, starting pose, question, and answer.",
        equationId: "eq1",
        terms: [
          { tex: "\\mathcal{S}", label: "The 3D scene to investigate", tone: "a" },
          { tex: "p_0", label: "The agent's initial pose", tone: "b" },
          { tex: "q", label: "The natural-language question", tone: "c" },
          { tex: "y^*", label: "The ground-truth answer", tone: "d" },
        ],
      },
    } as Beat;
    const foot = { variant: "display", placement: "foot" } as const;
    const v2 = (look?: Look) => ({ ...ctx(look), source: src, design: "v2" as const });
    // The grown legend that ran into the foot is not grown there…
    expect(emitScene(walk, v2(foot)).css).not.toContain("#s1 .leg{font-size:60px}");
    // …and a walk that cannot fit even at classic sizes is refused, so the
    // Director takes the top look, which it fits.
    const six = {
      ...src,
      equations: [{ id: "eq1", tex: "(\\mathcal{S}, p_0, q, y^*, a_t, o_t)", display: false }],
    } as typeof source;
    const many = {
      ...walk,
      params: {
        ...(walk.params as object),
        terms: [
          ...(walk.params as { terms: unknown[] }).terms,
          { tex: "a_t", label: "The action at step t", tone: "a" },
          { tex: "o_t", label: "The observation at step t", tone: "b" },
        ],
      },
    } as Beat;
    const v2six = (look?: Look) => ({ ...ctx(look), source: six, design: "v2" as const });
    expect(() => emitScene(many, v2six(foot))).toThrow(/foot headline leaves/);
    expect(() => emitScene(many, v2six())).not.toThrow();
  });
});

describe("the final stop shows the whole slide under v2", () => {
  // en s3 (review 2026-10-08): three of four pipeline steps at 0.62 opacity at
  // the slide's last stop, because the restore was timed after it.
  const dimmedAtLastHold = (scene: Scene): boolean => {
    const last = Math.max(...scene.holds);
    const events = scene.tl
      .filter((t) => t.to.opacity === DIM || (t.from.opacity === DIM && t.to.opacity === 1))
      .map((t) => ({
        start: t.at,
        end: t.at + (typeof t.to.duration === "number" ? t.to.duration : 0),
        dims: t.to.opacity === DIM,
      }))
      .filter((e) => e.start <= last + 1e-9)
      .sort((a, b) => a.start - b.start);
    const final = events.at(-1);
    return !!final && (final.dims || final.end > last + 1e-9);
  };
  const stages = (n: number): Beat =>
    ({
      id: "b-pipe",
      archetype: "pipeline",
      intent: "Flow.",
      evidence: [],
      weight: 0.5,
      seconds: 9,
      params: {
        headline: "Four steps",
        stages: Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1}` })),
      },
    }) as Beat;
  const panels = {
    id: "b-call",
    archetype: "callout",
    intent: "Point.",
    evidence: [],
    weight: 0.5,
    seconds: 9,
    params: {
      headline: "Three findings",
      panels: [
        { label: "One", lines: ["a"] },
        { label: "Two", lines: ["b"] },
        { label: "Three", lines: ["c"] },
      ],
    },
  } as Beat;

  it.each([
    ["pipeline", stages(4)],
    ["callout", panels],
    ["split-compare", split()],
  ] as const)("%s: nothing is dimmed at its last hold, while classic still dims it", (_, beat) => {
    const v2 = emitScene(beat, { ...ctx(), design: "v2" });
    const classic = emitScene(beat, ctx());
    expect(dimmedAtLastHold(v2)).toBe(false);
    expect(dimmedAtLastHold(classic)).toBe(true);
    // And the stops themselves do not move.
    expect(v2.holds).toEqual(classic.holds);
  });
});

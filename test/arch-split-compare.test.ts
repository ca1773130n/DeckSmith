import { describe, expect, it } from "vitest";
import { splitCompare } from "../src/emit/archetypes/split-compare.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { contentW } from "../src/emit/kit.js";
import { MIN_FONT, textWidth } from "../src/emit/svg.js";
import type { BeatOf, Format, Source } from "../src/types.js";
import { FORMATS } from "../src/types.js";

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

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [
    { id: "tall", src: "figure_000.jpg", caption: "A <tall> crop", width: 900, height: 1200 },
    { id: "wide", src: "figure_001.jpg", caption: "A wide strip", width: 2400, height: 600 },
    { id: "square", src: "figure_002.jpg", caption: "A square one", width: 1000, height: 1000 },
  ],
  equations: [],
  tables: [],
};

const format: Format = {
  id: "deck-16x9",
  width: 1920,
  height: 1080,
  minWeight: 0,
  navigable: true,
};
const ctx = (sid: string): EmitContext => ({ source, format, theme, sid });
const core = { intent: "i", evidence: [], weight: 0.5, seconds: 9 };

type Beat = BeatOf<"split-compare">;
const beat = (id: string, params: Beat["params"]): Beat => ({
  ...core,
  id,
  archetype: "split-compare",
  params,
});

/** The schema's floor: one label and one line a side, no eyebrow, no note. */
const minimal = beat("min", {
  headline: "H",
  left: { label: "A", lines: ["one"] },
  right: { label: "B", lines: ["two"] },
});

/**
 * Every optional field present, long labels, and the deepest list that still
 * fits. Five a side, not six: with an eyebrow, a headline that wraps and a note,
 * the chrome takes 493 of the 912px canvas and content gets 419. Six bullets
 * need 438px at the 40px floor, so the sixth cannot be drawn without breaking
 * invariant 5 — and `deepest that still fits` is measured against the CURRENT
 * budget, not the flat 560 this archetype used to assume. `refuses a panel that
 * cannot fit` below pins the other side of that boundary.
 */
const maximal = beat("max", {
  eyebrow: "Ablation",
  headline: "A headline long enough to wrap onto its second line at 66px",
  left: {
    label: "Naive per-frame reconstruction",
    lines: [
      "Recomputes every step",
      "No state between frames",
      "28.10 dB at 4.1 GFLOPs",
      "Fails on fast motion",
      "Latency grows with length",
    ],
  },
  right: {
    label: "Proposed recurrent update",
    lines: [
      "Warps last step forward",
      "Hidden state persists",
      "30.47 dB at 1.6 GFLOPs",
      "Holds up in fast motion",
      "Latency flat in length",
    ],
  },
  note: "Both rows measured on the same held-out split.",
});

/** The honest-comparison case: two source figures of different aspect ratios. */
const twoFigures = beat("figs", {
  eyebrow: "Qualitative",
  headline: "H",
  left: { label: "Baseline", figureId: "tall" },
  right: { label: "Ours", figureId: "wide" },
  note: "Same crop, same scale factor.",
});

/** One of each, plus a list under the figure — the schema allows all four fields. */
const mixed = beat("mixed", {
  headline: "H",
  left: { label: "Theirs", figureId: "square", lines: ["Blurs the high-frequency detail"] },
  right: { label: "Ours", lines: ["Recovers the grating", "No ringing at the edges"] },
});

/* ------------------------------------------------------------------ geometry */

const W = 1700;

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function num(tag: string, name: string, fallback = 0): number {
  const v = attr(tag, name);
  return v === undefined ? fallback : Number(v);
}

interface Extent {
  what: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Every drawn box in the emitted SVG, in the SVG's own coordinates.
 *
 * Text is measured through `textWidth` and through the `dy` values actually
 * present in the markup rather than through the emitter's own arithmetic — the
 * point of the check is to catch the emitter being wrong, so it must not ask the
 * emitter where it put things.
 */
function extents(html: string): Extent[] {
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(html)?.[1] ?? "";
  const out: Extent[] = [];

  for (const [tag] of body.matchAll(/<rect\b[^>]*\/>/g)) {
    const x = num(tag, "x");
    const y = num(tag, "y");
    out.push({ what: "rect", x0: x, x1: x + num(tag, "width"), y0: y, y1: y + num(tag, "height") });
  }
  for (const [tag] of body.matchAll(/<image\b[^>]*>/g)) {
    const x = num(tag, "x");
    const y = num(tag, "y");
    out.push({
      what: "image",
      x0: x,
      x1: x + num(tag, "width"),
      y0: y,
      y1: y + num(tag, "height"),
    });
  }
  for (const [tag] of body.matchAll(/<line\b[^>]*\/>/g)) {
    const half = num(tag, "stroke-width", 1) / 2;
    const [x1, x2] = [num(tag, "x1"), num(tag, "x2")].sort((a, b) => a - b) as [number, number];
    const [y1, y2] = [num(tag, "y1"), num(tag, "y2")].sort((a, b) => a - b) as [number, number];
    // Ink spreads perpendicular to the run; a butt cap ends exactly on its endpoint.
    const [px, py] = x1 === x2 ? [half, 0] : [0, half];
    out.push({ what: "line", x0: x1 - px, x1: x2 + px, y0: y1 - py, y1: y2 + py });
  }
  for (const [, head, inner] of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const tag = `<text${head ?? ""}>`;
    const size = num(tag, "font-size", 40);
    const weight = num(tag, "font-weight", 400);
    const anchor = attr(tag, "text-anchor") ?? "start";
    const spans = [...(inner ?? "").matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
    const lines = spans.length
      ? spans.map((s) => ({ dy: num(`<t${s[1] ?? ""}>`, "dy"), body: s[2] ?? "" }))
      : [{ dy: 0, body: inner ?? "" }];
    let baseline = num(tag, "y");
    for (const l of lines) {
      baseline += l.dy;
      const x = num(tag, "x");
      const w = textWidth(unesc(l.body), size, weight);
      const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
      // Cap height ~0.75em above the baseline, descenders ~0.25em below.
      out.push({
        what: `text:${l.body}`,
        x0,
        x1: x0 + w,
        y0: baseline - size * 0.75,
        y1: baseline + size * 0.25,
      });
    }
  }
  return out;
}

function svgHeight(html: string): number {
  return Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(html)?.[1]);
}

/* --------------------------------------------------------------------- tests */

describe("split-compare", () => {
  const cases: [string, Beat][] = [
    ["minimal", minimal],
    ["maximal", maximal],
    ["two figures", twoFigures],
    ["figure and list", mixed],
  ];

  for (const [name, b] of cases) {
    describe(name, () => {
      const sid = "s7";
      const scene = splitCompare(b, ctx(sid));
      const code = scene.tl.join("\n");

      it("keeps every drawn box inside the svg frame", () => {
        const H = svgHeight(scene.html);
        const boxes = extents(scene.html);
        expect(boxes.length).toBeGreaterThan(4);
        for (const e of boxes) {
          expect.soft(e.x0, `${e.what} left`).toBeGreaterThanOrEqual(0);
          expect.soft(e.x1, `${e.what} right`).toBeLessThanOrEqual(W);
          expect.soft(e.y0, `${e.what} top`).toBeGreaterThanOrEqual(0);
          expect.soft(e.y1, `${e.what} bottom`).toBeLessThanOrEqual(H);
        }
      });

      it("never sets audience text below the 40px floor", () => {
        const sizes = [
          ...`${scene.css}${scene.html}`.matchAll(/font-size[:=]"?\s*(\d+(?:\.\d+)?)/g),
        ];
        expect(sizes.length).toBeGreaterThan(0);
        for (const [, v] of sizes) expect(Number(v)).toBeGreaterThanOrEqual(MIN_FONT);
      });

      it("scopes every timeline target to its own scene", () => {
        const targets = scene.tl.map((t) => t.target);
        expect(targets.length).toBeGreaterThan(0);
        for (const t of targets) expect(t.startsWith(`#${sid}`)).toBe(true);
      });

      it("uses fromTo only", () => {
        expect(code).not.toMatch(/\.from\(/);
      });

      it("holds after each side has settled, inside the beat's window", () => {
        expect(scene.holds.length).toBeGreaterThanOrEqual(2);
        expect([...scene.holds].sort((x, y) => x - y)).toEqual(scene.holds);
        for (const h of scene.holds) expect(h).toBeLessThan(b.seconds);
      });

      it("gives one focal element ambient life, gated three ways", () => {
        const css = scene.css ?? "";
        const rules = [
          ...css.matchAll(
            /@media \(prefers-reduced-motion: no-preference\)\{([^{}]+)\{[^{}]*\}\}/g,
          ),
        ];
        expect(rules).toHaveLength(1);
        expect(rules[0]?.[1]).toMatch(new RegExp(`^\\.ds-live #${sid}\\b`));
        const ungated = css.replace(/@media[^{]*\{[^{}]*\{[^{}]*\}\}/g, "");
        expect(ungated).not.toContain("animation");
      });

      it("renders byte-identically twice", () => {
        expect(JSON.stringify(splitCompare(b, ctx(sid)))).toEqual(JSON.stringify(scene));
      });
    });
  }

  it("escapes source text", () => {
    const scene = splitCompare(
      beat("esc", {
        headline: "H",
        left: { label: "<left>", lines: ["a & b"] },
        right: { label: "R", figureId: "tall" },
      }),
      ctx("s1"),
    );
    expect(scene.html).not.toMatch(/<(left|tall)>/);
    expect(scene.html).toContain("&lt;left&gt;");
    // The figure's caption survives as the image's accessible name.
    expect(scene.html).toContain("A &lt;tall&gt; crop");
  });

  it("keeps both labels out of the divider's channel", () => {
    // The hardest sizing decision on the slide: the labels are the only elements
    // that reach towards the middle, and a label that crosses the rule turns the
    // device into a smudge. Long labels must be solved down, not clipped.
    for (const b of [minimal, maximal, twoFigures]) {
      const scene = splitCompare(b, ctx("s2"));
      const labels = extents(scene.html).filter((e) => e.what.startsWith("text:"));
      const left = labels.filter((e) => e.x1 <= W / 2);
      const right = labels.filter((e) => e.x0 >= W / 2);
      expect(left.length + right.length).toBe(labels.length);
      // 46 is the gutter either side of the rule at x=850.
      for (const e of left) expect(e.x1).toBeLessThanOrEqual(W / 2 - 46);
      for (const e of right) expect(e.x0).toBeGreaterThanOrEqual(W / 2 + 46);
    }
  });

  it("matches the displayed height of two figures rather than their boxes", () => {
    // 900x1200 and 2400x600 fill their panels at wildly different heights. Showing
    // each at whatever its own box allowed would make the comparison a statement
    // about the layout, so the smaller displayed height wins for both.
    const scene = splitCompare(twoFigures, ctx("s3"));
    const images = [...scene.html.matchAll(/<image\b[^>]*>/g)].map(([t]) => t);
    expect(images).toHaveLength(2);
    const heights = images.map((t) => num(t, "height"));
    expect(heights[0]).toEqual(heights[1]);
    // ...and each keeps its own aspect ratio, which is what makes it honest.
    images.forEach((t, i) => {
      const fig = source.figures[i];
      expect(num(t, "width") / num(t, "height")).toBeCloseTo(
        (fig?.width ?? 1) / (fig?.height ?? 1),
        4,
      );
    });
  });

  it("reveals left before right", () => {
    const scene = splitCompare(maximal, ctx("s4"));
    const at = (sel: string) => scene.tl.find((t) => t.target === sel)?.at ?? Number.NaN;
    expect(at("#s4-side0")).toBeLessThan(at("#s4-side1"));
    expect(at("#s4-div")).toBeLessThan(at("#s4-side0"));
  });

  it("refuses a side that is neither a figure nor a list", () => {
    expect(() =>
      splitCompare(
        beat("bad", { headline: "H", left: { label: "A" }, right: { label: "B", lines: ["x"] } }),
        ctx("s5"),
      ),
    ).toThrow(/left side has neither/);
  });

  it("refuses a figure the source does not have", () => {
    expect(() =>
      splitCompare(
        beat("bad", {
          headline: "H",
          left: { label: "A", figureId: "nope" },
          right: { label: "B", lines: ["x"] },
        }),
        ctx("s5"),
      ),
    ).toThrow(/no figure "nope"/);
  });

  it("refuses a list too deep to set at the floor rather than shrinking past it", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `A line of evidence number ${i}`);
    expect(() =>
      splitCompare(
        beat("bad", {
          headline: "H",
          left: { label: "A", lines },
          right: { label: "B", lines: ["x"] },
        }),
        ctx("s5"),
      ),
    ).toThrow(/do not fit/);
  });

  /**
   * The boundary itself, not a value far past it. `maximal` is five bullets a
   * side because six is one more than the fully-dressed chrome leaves room for;
   * if the budget ever moves, one of these two assertions fails and says which
   * way it went — rather than the `maximal` fixture throwing at module scope and
   * taking the whole suite's collection down with it, which is how this
   * boundary announced itself the first time.
   */
  it("fits five bullets a side under a full chrome, and refuses the sixth", () => {
    const dress = (lines: string[]): Beat =>
      beat("edge", {
        eyebrow: "Ablation",
        headline: "A headline long enough to wrap onto its second line at 66px",
        left: { label: "Naive per-frame reconstruction", lines },
        right: { label: "Proposed recurrent update", lines },
        note: "Both rows measured on the same held-out split.",
      });
    const five = Array.from({ length: 5 }, (_, i) => `Latency grows with length ${i}`);
    expect(() => splitCompare(dress(five), ctx("s5"))).not.toThrow();
    expect(() => splitCompare(dress([...five, "One pass, no reuse"]), ctx("s5"))).toThrow(
      /do not fit/,
    );
  });
});

/**
 * Portrait stacks the two panels instead of setting them side by side.
 *
 * Two columns of an 860px box are 384px each, which turned every bullet into two
 * or three lines and the comparison into a pair of ragged paragraphs.
 */
describe("split-compare in portrait", () => {
  const short = FORMATS["short-9x16"] as Format;
  const tallCtx = (sid: string): EmitContext => ({ source, format: short, theme, sid });
  // Derived, not 220: `.scene`'s padding is a FRACTION of the canvas, so a
  // literal here pins the gutter to whatever 16:9 happened to use and fails
  // the moment the margin scales with the format.
  const CONTENT_9x16 = contentW(short);

  /** The bullet ticks: `roundRect` at 5px wide, one per line, in emission order. */
  const ticks = (html: string, side: number) => {
    const g = new RegExp(`<g id="s\\d+-side${side}">([\\s\\S]*?)</g>`).exec(html)?.[1] ?? "";
    return [...g.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="5"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
  };

  it("gives each panel the full width and its own band of the height", () => {
    const html = splitCompare(maximal, tallCtx("s7")).html;
    const top = ticks(html, 0);
    const bottom = ticks(html, 1);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    // Same spine, not two columns.
    expect(new Set([...top, ...bottom].map((t) => Math.round(t.x)))).toEqual(new Set([0]));
    // And disjoint bands: the whole of the first panel is above the whole of the second.
    expect(Math.max(...top.map((t) => t.y))).toBeLessThan(Math.min(...bottom.map((t) => t.y)));
  });

  it("sets a bullet that needed three lines beside a column on one across a row", () => {
    const html = splitCompare(maximal, tallCtx("s7")).html;
    // A wrapped line is emitted as a <tspan>; one line is bare text content.
    const body = /<g id="s7-side0">([\s\S]*?)<\/g>/.exec(html)?.[1] ?? "";
    const size = /font-size="(\d+)"/.exec(body)?.[1];
    expect(size).toBeDefined();
    expect(Number(size)).toBeGreaterThanOrEqual(MIN_FONT);
    expect(html).toContain(`width="${CONTENT_9x16}"`);
  });

  it("starts both headings on the same first baseline", () => {
    // Centring each on the tallest heading gave a one-line label and a two-line
    // one different first baselines, so the pair read as one having slipped.
    const uneven = beat("uneven", {
      headline: "H",
      left: { label: "A heading long enough to wrap onto a second line", lines: ["one"] },
      right: { label: "Short", lines: ["two"] },
    });
    for (const c of [ctx("s7"), tallCtx("s7")]) {
      const html = splitCompare(uneven, c).html;
      // Measured against each panel's own hairline, which sits a fixed distance
      // below the top of its band: in portrait the two panels start at different
      // absolute y, and it is the offset inside the band that has to match.
      const drop = (i: number) => {
        const t = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*id="s7-lab${i}"`).exec(html);
        const dy = new RegExp(`id="s7-lab${i}"[^>]*><tspan[^>]*dy="(-?[\\d.]+)"`).exec(html);
        const hair = new RegExp(`<line x1="[\\d.]+" y1="([\\d.]+)"[^>]*id="s7-hair${i}"`).exec(
          html,
        );
        return Number(hair?.[1] ?? 0) - (Number(t?.[1] ?? 0) + Number(dy?.[1] ?? 0));
      };
      expect(drop(0)).toBeCloseTo(drop(1), 6);
    }
  });

  it("keeps the landscape columns side by side", () => {
    const html = splitCompare(maximal, ctx("s7")).html;
    const top = ticks(html, 0);
    const bottom = ticks(html, 1);
    expect(Math.max(...top.map((t) => t.x))).toBeLessThan(Math.min(...bottom.map((t) => t.x)));
  });
});

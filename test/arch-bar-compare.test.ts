import { describe, expect, it } from "vitest";
import { barCompare } from "../src/emit/archetypes/bar-compare.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { contentW, tweenText } from "../src/emit/kit.js";
import { textWidth } from "../src/emit/svg.js";
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
  figures: [],
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

type Bar = BeatOf<"bar-compare">;

const beat = (params: Bar["params"], seconds = 9): Bar => ({
  id: "b1",
  intent: "i",
  evidence: [],
  weight: 0.5,
  seconds,
  archetype: "bar-compare",
  params,
});

/** The two ends of the schema: min bars and no optionals, max bars and all of them. */
const MINIMAL = beat({
  headline: "Two numbers",
  bars: [
    { label: "Before", value: 28.91 },
    { label: "After", value: 30.47 },
  ],
});

const MAXIMAL = beat({
  eyebrow: "Ablation",
  headline: "Every knob, measured",
  unit: "M params",
  note: "the source does not explain the last row",
  bars: [
    { label: "Baseline transformer", value: 1.592, tone: "a" },
    { label: "SwinIR", value: 0.93 },
    { label: "EDSR-baseline", value: 1.37, tone: "b" },
    { label: "CARN", value: 1.592 },
    { label: "IMDN", value: 0.715, tone: "c" },
    { label: "LatticeNet", value: 0.777 },
    { label: "Ours (small)", value: 1.129, tone: "d" },
    { label: "Ours", value: 1.13 },
  ],
});

/* ------------------------------------------------------------------ parsing */

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Digits in the name matter: `x1` and `y2` are how the axis line is addressed.
  for (const m of s.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

function frame(html: string): { w: number; h: number } {
  const a = attrsOf(/<svg ([^>]*)>/.exec(html)?.[1] ?? "");
  return { w: Number(a.width), h: Number(a.height) };
}

function rects(html: string): Record<string, string>[] {
  return [...html.matchAll(/<rect ([^>]*)\/>/g)].map((m) => attrsOf(m[1] ?? ""));
}

interface Run {
  x: number;
  y: number;
  size: number;
  weight: number;
  anchor: string;
  s: string;
}

/** One entry per rendered line, so a wrapped label is checked line by line. */
function runs(html: string): Run[] {
  const out: Run[] = [];
  for (const m of html.matchAll(/<text ([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = attrsOf(m[1] ?? "");
    const inner = m[2] ?? "";
    const base = {
      x: Number(a.x),
      y: Number(a.y),
      size: Number(a["font-size"]),
      weight: Number(a["font-weight"] ?? 400),
      anchor: a["text-anchor"] ?? "start",
    };
    if (inner.includes("<tspan")) {
      let y = base.y;
      for (const t of inner.matchAll(/<tspan[^>]*dy="([-\d.]+)"[^>]*>([^<]*)<\/tspan>/g)) {
        y += Number(t[1]);
        out.push({ ...base, y, s: t[2] ?? "" });
      }
    } else {
      out.push({ ...base, s: inner });
    }
  }
  return out;
}

function barsOf(sid: string, html: string): Record<string, string>[] {
  return rects(html).filter((r) => (r.id ?? "").startsWith(`${sid}-bar`));
}

/* -------------------------------------------------------------------- tests */

describe("bar-compare", () => {
  for (const [name, b] of [
    ["minimal", MINIMAL],
    ["maximal", MAXIMAL],
  ] as const) {
    describe(name, () => {
      const sid = "s7";
      const scene = barCompare(b, ctx(sid));
      const { w, h } = frame(scene.html);

      it("keeps every drawn box inside the frame", () => {
        expect(w).toBe(1700);
        for (const r of rects(scene.html)) {
          expect(Number(r.x)).toBeGreaterThanOrEqual(-0.01);
          expect(Number(r.y)).toBeGreaterThanOrEqual(-0.01);
          expect(Number(r.x) + Number(r.width)).toBeLessThanOrEqual(w + 0.01);
          expect(Number(r.y) + Number(r.height)).toBeLessThanOrEqual(h + 0.01);
        }
        const zero = attrsOf(/<line ([^>]*)\/>/.exec(scene.html)?.[1] ?? "");
        for (const k of ["x1", "x2"]) expect(Number(zero[k])).toBeLessThanOrEqual(w + 0.01);
        for (const k of ["y1", "y2"]) expect(Number(zero[k])).toBeLessThanOrEqual(h + 0.01);
      });

      it("keeps every glyph inside the frame", () => {
        const found = runs(scene.html);
        expect(found.length).toBeGreaterThan(0);
        for (const t of found) {
          const width = textWidth(t.s, t.size, t.weight);
          const left = t.anchor === "end" ? t.x - width : t.x;
          expect(left).toBeGreaterThanOrEqual(-0.01);
          expect(left + width).toBeLessThanOrEqual(w + 0.01);
          // Cap box above the baseline, descender below it.
          expect(t.y - t.size * 0.72).toBeGreaterThanOrEqual(-0.01);
          expect(t.y + t.size * 0.25).toBeLessThanOrEqual(h + 0.01);
        }
      });

      it("fits the canvas once the chrome and note are stacked on it", () => {
        const p = b.params;
        const total =
          (p.eyebrow ? 146 : 76) + 34 + h + (p.note ? 84 : 0) + /* .scene padding */ 168;
        expect(total).toBeLessThanOrEqual(1080);
      });

      it("never sets audience text below the 40px floor", () => {
        const sizes = [
          ...`${scene.html}${scene.css}`.matchAll(/font-size(?::\s*|=")(\d+(?:\.\d+)?)/g),
        ].map((m) => Number(m[1]));
        expect(sizes.length).toBeGreaterThan(0);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(40);
      });

      it("scopes every timeline target to its own scene", () => {
        const targets = scene.tl.map((t) => t.target);
        expect(targets.length).toBeGreaterThan(0);
        for (const t of targets) expect(t.startsWith(`#${sid}`)).toBe(true);
      });

      it("uses fromTo only", () => {
        // `Tween` cannot be written without `from`; this pins the serialiser.
        for (const t of scene.tl) expect(tweenText(t)).toMatch(/^tl\.fromTo\(/);
      });

      it("holds where a reveal has settled, inside the beat's window", () => {
        expect(scene.holds.length).toBeGreaterThan(0);
        expect([...scene.holds].sort((x, y2) => x - y2)).toEqual(scene.holds);
        for (const t of scene.holds) expect(t).toBeLessThan(b.seconds);
        // The first hold is where navigation lands, so every bar must be grown by
        // then — the last bar's tween ends at 0.95 + (n-1)*step + 0.85.
        const step = Math.min(0.4, 2.4 / b.params.bars.length);
        const grown = 0.95 + (b.params.bars.length - 1) * step + 0.85;
        expect(scene.holds[0] ?? 0).toBeGreaterThanOrEqual(grown);
      });

      it("gives exactly one focal element ambient life, gated three ways", () => {
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

      it("counts each value onto the grid its printed string sits on", () => {
        const code = scene.tl.map(tweenText).join("\n");
        for (const bar of b.params.bars) {
          const printed = String(bar.value);
          expect(scene.html).toContain(`>${printed}</text>`);
          // Snap to a coarser grid and the counter settles on a different number
          // than the static SVG shows.
          const decimals = printed.includes(".") ? (printed.split(".")[1]?.length ?? 0) : 0;
          const snap = decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
          expect(code).toContain(`textContent: ${printed}, snap: { textContent: ${snap} }`);
        }
      });
    });
  }

  it("draws lengths in the data's own proportion, from a zero baseline", () => {
    const scene = barCompare(
      beat({
        headline: "H",
        bars: [
          { label: "a", value: 4 },
          { label: "b", value: 2 },
          { label: "c", value: 1 },
        ],
      }),
      ctx("s2"),
    );
    const [a, b2, c] = barsOf("s2", scene.html).map((r) => Number(r.width));
    expect(a).toBeGreaterThan(0);
    // Two decimals of SVG precision is the whole tolerance here.
    expect((b2 ?? 0) / (a ?? 1)).toBeCloseTo(0.5, 4);
    expect((c ?? 0) / (a ?? 1)).toBeCloseTo(0.25, 4);
    // Every bar starts at zero, and zero is where the axis line is.
    const zeroX = Number(attrsOf(/<line ([^>]*)\/>/.exec(scene.html)?.[1] ?? "").x1);
    for (const r of barsOf("s2", scene.html)) expect(Number(r.x)).toBeCloseTo(zeroX, 6);
  });

  it("scales to the data rather than to a constant", () => {
    // Whatever the magnitude, the largest value fills the plot and its label
    // lands exactly on the frame edge — which is only true of a scale read off
    // the data, and false of any fixed one.
    for (const values of [
      [2, 1],
      [2000, 1000],
      [0.002, 0.001],
    ]) {
      const scene = barCompare(
        beat({ headline: "H", bars: values.map((v, i) => ({ label: `l${i}`, value: v })) }),
        ctx("s3"),
      );
      const top = String(Math.max(...values));
      const label = runs(scene.html).find((t) => t.s === top);
      expect(label).toBeDefined();
      const right = (label?.x ?? 0) + textWidth(top, label?.size ?? 40, label?.weight ?? 700);
      expect(right).toBeCloseTo(frame(scene.html).w, 1);
    }
  });

  /* The hardest decision this archetype makes: one value dwarfing the rest. */
  it("keeps a dwarfed bar visible without distorting a readable ratio", () => {
    const scene = barCompare(
      beat({
        headline: "H",
        bars: [
          { label: "huge", value: 1000 },
          { label: "tiny", value: 1 },
          { label: "none", value: 0 },
        ],
      }),
      ctx("s4"),
    );
    const [huge, tiny, none] = barsOf("s4", scene.html).map((r) => Number(r.width));
    expect(huge).toBeGreaterThan(400);
    // Visible at all — a proportional 1/1000 bar would be under a pixel.
    expect(tiny).toBeGreaterThanOrEqual(8);
    // And the lie it tells stays under 1% of the plot, which is below what anyone
    // can read off a projected slide.
    expect(tiny).toBeLessThanOrEqual((huge ?? 0) * 0.01);
    // Zero is nothing, not a stub.
    expect(none).toBe(0);
    // Every bar sits in a rail, which is what makes "next to nothing" legible.
    expect(scene.html.match(/class="bc-rail"/g)).toHaveLength(3);
  });

  it("sizes the gutter from the widest label, and never below the type floor", () => {
    const gutterOf = (labels: string[]) => {
      const scene = barCompare(
        beat({ headline: "H", bars: labels.map((l) => ({ label: l, value: 1 })) }),
        ctx("s5"),
      );
      const zeroX = Number(attrsOf(/<line ([^>]*)\/>/.exec(scene.html)?.[1] ?? "").x1);
      const label = runs(scene.html).filter((t) => t.anchor === "end");
      return { zeroX, label, scene };
    };
    const narrow = gutterOf(["Ours", "CARN"]);
    const wide = gutterOf(["Ours", "Baseline transformer variant"]);
    expect(wide.zeroX).toBeGreaterThan(narrow.zeroX);
    for (const g of [narrow, wide]) {
      for (const t of g.label) {
        expect(t.size).toBeGreaterThanOrEqual(40);
        // Right-aligned into the gutter, clear of the axis, clear of the frame.
        expect(t.x).toBeLessThan(g.zeroX);
        expect(t.x - textWidth(t.s, t.size, t.weight)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("states the unit once, and only when there is one", () => {
    expect(barCompare(MAXIMAL, ctx("s6")).html.match(/M params/g)).toHaveLength(1);
    expect(barCompare(MINIMAL, ctx("s6")).html).not.toContain("s6-unit");
  });

  it("tones only the bars the beat singles out, and steps the rest back", () => {
    const scene = barCompare(MAXIMAL, ctx("s8"));
    const fills = barsOf("s8", scene.html).map((r) => r.fill);
    expect(fills[0]).toBe(theme.tones.a);
    expect(fills[2]).toBe(theme.tones.b);
    expect(fills[1]).toBe(theme.dim);
    // With nothing singled out there is no reason to mute anything.
    const plain = barCompare(MINIMAL, ctx("s8"));
    for (const r of barsOf("s8", plain.html)) expect(r.fill).toBe(theme.accent);
  });

  it("refuses a composition it cannot set legibly instead of shipping it", () => {
    const long = "Reconstruction quality under the widest window configuration tested";
    expect(() =>
      barCompare(
        beat({
          headline: "H",
          bars: Array.from({ length: 8 }, (_, i) => ({ label: `${long} ${i}`, value: i + 1 })),
        }),
        ctx("s9"),
      ),
    ).toThrow(/Shorten the labels or split the beat/);
  });

  /**
   * The chrome this archetype charges itself has to be the one it draws.
   *
   * It used to keep a private `CHROME_H` of one eyebrow line plus one headline
   * line, flat, while `chromeHeight` — which every other archetype asks —
   * measures the wrapping both actually do. MEASURED at 1700: a two-line
   * headline is 74px more than the flat figure, a two-line eyebrow 50px more,
   * and both together 124px. The bars are solved against that budget, so every
   * one of those pixels was a bar drawn into the headline, silently and with
   * every gate green.
   *
   * Pinned as an ORDERING rather than as a pixel count: the plot under a
   * wrapping chrome must be shorter than under a chrome of the same beat that
   * fits on one line. A flat constant makes them equal, which is the bug.
   */
  it("pays for the chrome it actually draws, wrapping included", () => {
    // Eight bars, not two: at two the row height is capped by BAR_MAX and the
    // budget never binds, so both chromes would draw the same plot and the
    // assertion would pass without measuring anything.
    const bars = Array.from({ length: 8 }, (_, i) => ({ label: `Run ${i}`, value: i + 1 }));
    const plotH = (html: string): number => Number(/<svg[^>]*height="([0-9.]+)"/.exec(html)?.[1]);

    const short = barCompare(beat({ eyebrow: "Cost", headline: "Two numbers", bars }), ctx("s1"));
    const wrapped = barCompare(
      beat({
        // Both lines wrap at 1700 — the case the flat constant under-counted most.
        eyebrow: "Throughput on the held-out split, measured end to end across every length",
        headline:
          "The recurrent update keeps a hidden state across frames and stops the per-frame rebuild",
        bars,
      }),
      ctx("s2"),
    );
    expect(plotH(wrapped.html)).toBeLessThan(plotH(short.html));
  });

  it("puts zero inside the plot when a value is negative", () => {
    const scene = barCompare(
      beat({
        headline: "H",
        bars: [
          { label: "up", value: 3 },
          { label: "down", value: -1 },
        ],
      }),
      ctx("sa"),
    );
    const zeroX = Number(attrsOf(/<line ([^>]*)\/>/.exec(scene.html)?.[1] ?? "").x1);
    const [up, down] = barsOf("sa", scene.html);
    expect(Number(up?.x)).toBeCloseTo(zeroX, 6);
    expect(Number(down?.x) + Number(down?.width)).toBeCloseTo(zeroX, 6);
    expect(Number(down?.width)).toBeCloseTo(Number(up?.width) / 3, 1);
    // And the negative bar's value hangs off its left end, inside the frame.
    const label = runs(scene.html).find((t) => t.s === "-1");
    expect(label?.anchor).toBe("end");
    expect((label?.x ?? 0) - textWidth("-1", label?.size ?? 40, 700)).toBeGreaterThanOrEqual(0);
  });

  it("renders byte-identically twice", () => {
    const a = barCompare(MAXIMAL, ctx("sb"));
    const b2 = barCompare(MAXIMAL, ctx("sb"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b2));
  });
});

/**
 * Portrait moves the label onto its own line above the rail.
 *
 * Beside the rails the demo's five names took 340px of an 860px box, so 40% of
 * the width was spent naming bars that then had 60% left to differ in.
 */
describe("bar-compare in portrait", () => {
  const short = FORMATS["short-9x16"] as Format;
  const tallCtx = (sid: string): EmitContext => ({ source, format: short, theme, sid });
  // Derived, not 220: `.scene`'s padding is a FRACTION of the canvas, so a
  // literal here pins the gutter to whatever 16:9 happened to use and fails
  // the moment the margin scales with the format.
  const CONTENT_9x16 = contentW(short);

  /** The rails: `class="bc-rail"`, one per bar, in emission order. */
  const rails = (html: string) =>
    [
      ...html.matchAll(
        /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*class="bc-rail"/g,
      ),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));

  it("hands the comparison the whole width instead of a gutter", () => {
    const html = barCompare(MAXIMAL, tallCtx("s8")).html;
    const rail = rails(html)[0] as { x: number; w: number };
    // The old gutter took 40% before a bar was drawn. What is reserved now is only
    // the value at the far end of the longest bar.
    expect(rail.x).toBeLessThan(4);
    expect(rail.w).toBeGreaterThan(CONTENT_9x16 * 0.7);
  });

  it("sets every label above its own rail, on the plot's own left edge", () => {
    const html = barCompare(MAXIMAL, tallCtx("s8")).html;
    const labels = [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*class="bc-lab"/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
    );
    const rows = rails(html);
    expect(labels.length).toBe(rows.length);
    labels.forEach((l, i) => {
      const rail = rows[i] as { y: number };
      expect(l.x).toBe(0);
      expect(l.y).toBeLessThan(rail.y);
    });
    // …and no label is anchored to a right edge that no longer exists.
    expect(/class="bc-lab"[^>]*text-anchor="end"/.test(html)).toBe(false);
  });

  it("keeps the whole chart, values included, inside the content box", () => {
    for (const b of [MINIMAL, MAXIMAL]) {
      const html = barCompare(b, tallCtx("s8")).html;
      const svgW = Number(/<svg id="s8-chart" width="([\d.]+)"/.exec(html)?.[1]);
      expect(svgW).toBe(CONTENT_9x16);
      for (const r of rails(html)) expect(r.x + r.w).toBeLessThanOrEqual(CONTENT_9x16 + 0.01);
    }
  });

  it("leaves the landscape gutter exactly where it was", () => {
    const html = barCompare(MAXIMAL, ctx("s8")).html;
    const rail = rails(html)[0] as { x: number };
    expect(rail.x).toBeGreaterThan(100);
    expect(/class="bc-lab"[^>]*text-anchor="end"/.test(html)).toBe(true);
  });
});

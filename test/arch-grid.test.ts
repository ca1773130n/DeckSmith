import { describe, expect, it } from "vitest";
import { grid } from "../src/emit/archetypes/grid.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
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

const core = { intent: "i", evidence: [], weight: 0.5, seconds: 12 };

function beat(params: BeatOf<"grid">["params"]): BeatOf<"grid"> {
  return { ...core, id: "b", archetype: "grid", params };
}

/** The schema's floor: two cells, one row, one region. */
const minimal = beat({
  headline: "H",
  cols: 2,
  rows: 1,
  regions: [{ x: 0, y: 0, w: 1, h: 1, label: "Window", tone: "a" }],
});

/** The schema's ceiling: 24x16, four regions, every optional field present. */
const maximal = beat({
  eyebrow: "Method",
  headline: "Every window sees only its own neighbourhood",
  cols: 24,
  rows: 16,
  regions: [
    { x: 0, y: 0, w: 2, h: 2, label: "local attention window", tone: "a" },
    { x: 4, y: 0, w: 1, h: 1, label: "one token after patch embedding", tone: "b" },
    { x: 18, y: 12, w: 6, h: 4, label: "shifted window at the next stage", tone: "c" },
    { x: 10, y: 6, w: 3, h: 1, label: "receptive field", tone: "d" },
  ],
  note: "Shifting by half a window is what lets information cross the boundary.",
});

/* ------------------------------------------------------------- geometry ---- */

const W = 1700;

function attrsOf(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

interface Frame {
  w: number;
  h: number;
  body: string;
}

function frame(html: string): Frame {
  const m = /<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*)<\/svg>/.exec(html);
  expect(m).not.toBeNull();
  return { w: Number(m?.[1]), h: Number(m?.[2]), body: m?.[3] ?? "" };
}

interface B {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  what: string;
}

/**
 * Every drawn thing's bounding box, text included. Text is measured with the
 * emitter's own estimator — the point is not an exact bound but that the two
 * agree, since a disagreement is exactly how a label clips.
 */
function boxes(body: string): B[] {
  const out: B[] = [];
  for (const m of body.matchAll(/<rect\b[^>]*\/>/g)) {
    const a = attrsOf(m[0]);
    const x = Number(a.x);
    const y = Number(a.y);
    out.push({
      x0: x,
      y0: y,
      x1: x + Number(a.width),
      y1: y + Number(a.height),
      what: `rect ${a.class ?? ""}`,
    });
  }
  for (const m of body.matchAll(/<line\b[^>]*\/>/g)) {
    const a = attrsOf(m[0]);
    out.push({
      x0: Math.min(Number(a.x1), Number(a.x2)),
      y0: Math.min(Number(a.y1), Number(a.y2)),
      x1: Math.max(Number(a.x1), Number(a.x2)),
      y1: Math.max(Number(a.y1), Number(a.y2)),
      what: `line ${a.class ?? ""}`,
    });
  }
  for (const m of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = attrsOf(m[1] ?? "");
    const size = Number(a["font-size"]);
    const weight = Number(a["font-weight"] ?? "400");
    const x = Number(a.x);
    const spans = [...(m[2] ?? "").matchAll(/<tspan[^>]*dy="([-\d.]+)"[^>]*>([^<]*)<\/tspan>/g)];
    const lines = spans.length
      ? spans.map((s) => ({ dy: Number(s[1]), t: s[2] ?? "" }))
      : [{ dy: 0, t: m[2] ?? "" }];
    let base = Number(a.y);
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let wide = 0;
    for (const l of lines) {
      base += l.dy;
      top = Math.min(top, base);
      bottom = Math.max(bottom, base);
      wide = Math.max(wide, textWidth(l.t, size, weight));
    }
    const anchor = a["text-anchor"] ?? "start";
    const left = anchor === "middle" ? x - wide / 2 : anchor === "end" ? x - wide : x;
    // A cap sits ~0.78em above the baseline and a descender ~0.25em below it.
    out.push({
      x0: left,
      y0: top - size * 0.78,
      x1: left + wide,
      y1: bottom + size * 0.25,
      what: `text "${lines[0]?.t ?? ""}"`,
    });
  }
  return out;
}

const cells = (body: string) =>
  [...body.matchAll(/<rect\b[^>]*class="gcell"[^>]*\/>/g)].map((m) => attrsOf(m[0]));

/* ---------------------------------------------------------------- tests ---- */

describe("grid", () => {
  for (const [name, b] of [
    ["minimal", minimal],
    ["maximal", maximal],
  ] as const) {
    describe(name, () => {
      const scene = grid(b, ctx("s3"));
      const f = frame(scene.html);

      it("draws nothing outside its own frame", () => {
        // Invariant 5. The frame is 1700 wide because the shell pads 110 a side,
        // so anything past it is `container_overflow` at the layout gate.
        expect(f.w).toBe(W);
        const all = boxes(f.body);
        expect(all.length).toBeGreaterThan(b.params.cols * b.params.rows);
        for (const g of all) {
          expect.soft(g.x0, `${g.what} left`).toBeGreaterThanOrEqual(-0.5);
          expect.soft(g.y0, `${g.what} top`).toBeGreaterThanOrEqual(-0.5);
          expect.soft(g.x1, `${g.what} right`).toBeLessThanOrEqual(f.w + 0.5);
          expect.soft(g.y1, `${g.what} bottom`).toBeLessThanOrEqual(f.h + 0.5);
        }
      });

      it("keeps cells square and the field centred on what is left", () => {
        const cs = cells(f.body);
        expect(cs).toHaveLength(b.params.cols * b.params.rows);
        for (const c of cs) expect(Number(c.width)).toBeCloseTo(Number(c.height), 6);
        const size = Number(cs[0]?.width);
        for (const c of cs) expect(Number(c.width)).toBeCloseTo(size, 6);

        const left = Math.min(...cs.map((c) => Number(c.x)));
        const right = Math.max(...cs.map((c) => Number(c.x) + Number(c.width)));
        const top = Math.min(...cs.map((c) => Number(c.y)));
        const bottom = Math.max(...cs.map((c) => Number(c.y) + Number(c.height)));
        // Vertically the field is centred on the frame; horizontally on the frame
        // less whatever gutter the labels took.
        // Within the 2dp every coordinate is rounded to, which is the whole
        // precision the emitted SVG carries.
        expect(top).toBeCloseTo(f.h - bottom, 1);
        const gutter = f.w - (left + right);
        expect(gutter).toBeGreaterThanOrEqual(0);
      });

      it("scopes every timeline target to its own scene and never uses from()", () => {
        // Invariants 1 and 2.
        const code = [...(scene.setup ?? []), ...scene.tl.map(tweenText)].join("\n");
        const targets = scene.tl.map((t) => t.target);
        expect(targets.length).toBeGreaterThan(0);
        for (const t of targets) expect(t.startsWith("#s3")).toBe(true);
        expect(code).not.toMatch(/\.from\(/);
      });

      it("holds once per settled reveal, inside the beat's window", () => {
        // Invariant 7: the field, then each region, then the note.
        expect(scene.holds).toHaveLength(1 + b.params.regions.length + (b.params.note ? 1 : 0));
        expect([...scene.holds].sort((x, y) => x - y)).toEqual(scene.holds);
        for (const h of scene.holds) expect(h).toBeLessThan(b.seconds);
      });

      it("gives exactly one focal element ambient life, gated", () => {
        const css = scene.css ?? "";
        const rules = [
          ...css.matchAll(/@media \(prefers-reduced-motion: no-preference\)\{([^{}]+)\{/g),
        ];
        expect(rules).toHaveLength(1);
        expect(rules[0]?.[1]).toBe(`.ds-live #s3-rgn${b.params.regions.length - 1}`);
        const ungated = css.replace(/@media[^{]*\{[^{}]*\{[^{}]*\}\}/g, "");
        expect(ungated).not.toContain("animation");
      });

      it("renders byte-identically twice", () => {
        // Invariant 3. Nothing here may read a clock or an entropy source.
        expect(JSON.stringify(grid(b, ctx("s3")))).toBe(JSON.stringify(scene));
      });

      it("sets no audience text below the 40px floor", () => {
        const sizes = [...`${scene.css}${scene.html}`.matchAll(/font-size[:=]"?\s*([\d.]+)/g)].map(
          (m) => Number(m[1]),
        );
        expect(sizes.length).toBeGreaterThan(0);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(40);
      });
    });
  }

  it("puts a label inside the region when it fits and in the gutter when it does not", () => {
    // The archetype's hardest decision. The same label, the same grid, two region
    // sizes: the only thing that may change the answer is whether it fits.
    const label = "shifted window";
    const at = (w: number, h: number) =>
      grid(
        beat({
          headline: "H",
          cols: 12,
          rows: 8,
          regions: [{ x: 1, y: 1, w, h, label, tone: "a" }],
        }),
        ctx("s4"),
      ).html;

    const big = at(8, 5);
    expect(big).not.toContain('class="glead"');
    expect(big).toContain('text-anchor="middle"');

    const small = at(1, 1);
    expect(small).toContain('class="glead"');
    // A gutter label is left-anchored past the field's right edge, not over it.
    const f = frame(small);
    const right = Math.max(...cells(f.body).map((c) => Number(c.x) + Number(c.width)));
    const lab = attrsOf(/<text\b[^>]*>/.exec(f.body)?.[0] ?? "");
    expect(Number(lab.x)).toBeGreaterThan(right);
    expect(lab["text-anchor"]).toBeUndefined();
  });

  it("keeps two gutter labels on the same rows from landing on each other", () => {
    const scene = grid(
      beat({
        headline: "H",
        cols: 16,
        rows: 8,
        regions: [
          { x: 0, y: 3, w: 1, h: 1, label: "query window", tone: "a" },
          { x: 6, y: 3, w: 1, h: 1, label: "key window", tone: "b" },
        ],
      }),
      ctx("s5"),
    );
    const texts = boxes(frame(scene.html).body).filter((g) => g.what.startsWith("text"));
    expect(texts).toHaveLength(2);
    const [a, b] = texts as [B, B];
    expect(Math.min(a.y1, b.y1)).toBeLessThan(Math.max(a.y0, b.y0));
  });

  it("refuses a region that runs off the field", () => {
    // Silently clamping would draw a window that is not the one the beat claims.
    for (const r of [
      { x: 3, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 1, h: 2 },
    ]) {
      expect(() =>
        grid(
          beat({ headline: "H", cols: 4, rows: 2, regions: [{ ...r, label: "W", tone: "a" }] }),
          ctx("s6"),
        ),
      ).toThrow(/falls outside/);
    }
  });

  it("escapes label and note text", () => {
    const scene = grid(
      beat({
        headline: "H",
        cols: 4,
        rows: 4,
        regions: [{ x: 0, y: 0, w: 2, h: 2, label: "<w> & co", tone: "a" }],
        note: "a <note>",
      }),
      ctx("s7"),
    );
    expect(scene.html).not.toMatch(/<(w|note)>/);
    expect(scene.html).toContain("&amp;");
  });
});

/**
 * The field starts where the headline starts.
 *
 * It was centred in whatever the gutter left, which put a height-bound lattice a
 * few hundred pixels right of every other element on the slide — a mistake to
 * look at, and measurably worse (EXPERIMENT-006, 67.7% → 66.8%).
 */
describe("grid alignment", () => {
  const tall = FORMATS["short-9x16"] as Format;
  /** x of the first cell drawn, which is row 0 column 0. */
  const firstCellX = (html: string) => Number(/<rect x="([\d.]+)"/.exec(html)?.[1]);

  it("puts the field flush left in both formats, gutter or no gutter", () => {
    for (const fmt of [format, tall]) {
      for (const b of [minimal, maximal]) {
        const html = grid(b, { source, format: fmt, theme, sid: "s4" }).html;
        // MARGIN, and nothing more: half a region's outline lies outside the
        // field, and that is the only inset the field is owed.
        expect(firstCellX(html)).toBeCloseTo(6, 6);
      }
    }
  });

  /**
   * A SQUARE LATTICE IS HEIGHT-BOUND AT EVERY SIZE — measured across 2x2 to 6x6,
   * neither `CELL_MAX` nor the width term ever binds — so every pixel the note
   * takes off the budget comes straight off the cell while the width it does not
   * use sits empty. On the demo's 4x4 the note cost 98px of a 516px budget and
   * the field drew 504px wide in a 1700px box: 30% of the width, 55% of the
   * height, with the rest black.
   */
  it("sets the note beside the field when the field leaves a column for it", () => {
    // A SQUARE field with a note: `maximal` is 24x16 and leaves nothing, so this
    // is the demo's own 4x4 shape, which is the one that measured 30% of width.
    const square = beat({
      headline: "Windowing turns the field into local regions",
      cols: 4,
      rows: 4,
      regions: [{ x: 0, y: 0, w: 2, h: 2, label: "window", tone: "a" }],
      note: "The source defines windowing as W(F).",
    });
    const html = grid(square, ctx("s4")).html;
    expect(html).toContain("growbeside");
    // The wrapper carries the field's REAL extent. Without it the row is the
    // full content width before the note is added, and the note runs off the
    // canvas — which it did, clipped mid-word, with every gate green.
    const width = Number(/class="gwrap" style="width:(\d+)px/.exec(html)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(1700 - 380);
  });

  it("keeps the note under the field in portrait, where there is no spare width", () => {
    const square = beat({
      headline: "Windowing turns the field into local regions",
      cols: 4,
      rows: 4,
      regions: [{ x: 0, y: 0, w: 2, h: 2, label: "window", tone: "a" }],
      note: "The source defines windowing as W(F).",
    });
    const html = grid(square, { source, format: tall, theme, sid: "s4" }).html;
    expect(html).not.toContain("growbeside");
  });

  it("keeps a label that fits inside its own region there, however much width is spare", () => {
    // The demo's 12x8 field is height-bound at 16:9 and leaves ~930px down its
    // right. Filling that band by exiling both labels to a gutter draws two 900px
    // leaders straight across the lattice, which is more ink for less meaning.
    const wideField = beat({
      headline: "H",
      cols: 12,
      rows: 8,
      regions: [{ x: 0, y: 0, w: 4, h: 4, label: "one window", tone: "a" }],
    });
    const html = grid(wideField, ctx("s4")).html;
    expect(html).not.toContain('class="glead"');
  });
});

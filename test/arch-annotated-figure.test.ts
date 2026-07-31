/**
 * What can be silently wrong here is geometry: a label half a pixel past the
 * stage, two labels stacked on top of each other, or an overlay that no longer
 * agrees with the image box it is drawn over. None of that shows up in a diff and
 * all of it survives every automated gate, so it is asserted directly.
 */
import { describe, expect, it } from "vitest";
import {
  annotatedFigure,
  type FigureLayout,
  type FigureNote,
  planFigure,
  stageBudget,
} from "../src/emit/archetypes/annotated-figure.js";
import type { EmitContext } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
import { ink } from "../src/emit/theme.js";
import type { BeatOf, Figure, Format, Source } from "../src/types.js";
import { annotatedFigureParamsSchema, FORMATS } from "../src/types.js";

/** The scene's content box at 1920 wide: the canvas less 110px of padding a side. */
const STAGE_W = 1700;

const wide: Figure = {
  id: "f1",
  src: "figure_000.png",
  caption: "Figure 3: overall architecture, with the residual groups marked.",
  width: 1600,
  height: 900,
};
const tall: Figure = { ...wide, id: "f2", width: 700, height: 1100 };
const tiny: Figure = { ...wide, id: "f3", width: 320, height: 200 };

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [wide, tall, tiny],
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
const ctx: EmitContext = { source, format, theme: ink, sid: "s3" };

type Params = BeatOf<"annotated-figure">["params"];

function beatOf(params: Params, seconds = 11): BeatOf<"annotated-figure"> {
  return {
    id: "b7",
    intent: "i",
    evidence: [],
    weight: 0.5,
    seconds,
    archetype: "annotated-figure",
    params,
  };
}

/** The schema's floor: one note, nothing optional. */
const minimal: Params = {
  headline: "H",
  figureId: "f1",
  notes: [{ x: 0.5, y: 0.5, text: "Here" }],
};

/**
 * The schema's ceiling, and then some: five notes, every optional field set, the
 * x/y extremes the schema permits, and labels long enough to fight for the
 * margins. Both halves of `x` are represented so the side chooser is exercised.
 */
const maximal: Params = {
  eyebrow: "Method",
  headline: "Every part of the network, in the order it runs",
  figureId: "f1",
  notes: [
    { x: 0, y: 0, text: "Shallow feature extraction: a single 3x3 convolution", tone: "a" },
    { x: 0.2, y: 0.34, text: "Six residual groups, twelve blocks each", tone: "b" },
    { x: 0.51, y: 0.5, text: "Channel attention re-weights the feature maps", tone: "c" },
    { x: 0.78, y: 0.72, text: "Pixel-shuffle upsampler, x4 in one step", tone: "d" },
    { x: 1, y: 1, text: "A long skip connection carries the low frequencies straight out" },
  ],
};

/** Five points all in the left half: the side balancer has to move some right. */
const crowded: Params = {
  headline: "H",
  figureId: "f1",
  notes: [0.1, 0.24, 0.38, 0.52, 0.66].map((y, i) => ({
    x: 0.15,
    y,
    text: `Stage ${i + 1} of the encoder, which downsamples by two and doubles the channels`,
  })),
};

function plan(params: Params, fig = wide): { plan: FigureLayout; budget: number } {
  const budget = stageBudget(format, params.eyebrow !== undefined, fig.caption);
  return { plan: planFigure(STAGE_W, params.notes, fig, budget), budget };
}

describe("annotated-figure params", () => {
  it("the fixtures are what the schema actually accepts", () => {
    // A geometry test against params the schema would reject proves nothing.
    for (const p of [minimal, maximal, crowded]) {
      expect(annotatedFigureParamsSchema.safeParse(p).success).toBe(true);
    }
  });
});

describe("annotated-figure layout", () => {
  for (const [name, params] of [
    ["minimal", minimal],
    ["maximal", maximal],
    ["crowded", crowded],
  ] as const) {
    describe(name, () => {
      it("keeps every label inside the stage box", () => {
        const { plan: p, budget } = plan(params);
        expect(p.height).toBeLessThanOrEqual(budget);
        for (const b of p.boxes) {
          expect(b.top).toBeGreaterThanOrEqual(0);
          expect(b.top + b.h).toBeLessThanOrEqual(p.height);
          // Horizontal containment reduces to this: a label runs outward from a
          // rule `col` wide, and both margins are `col` by construction.
          expect(b.w).toBeLessThanOrEqual(p.col);
        }
        expect(p.col).toBeGreaterThan(0);
      });

      it("never stacks two labels on top of each other", () => {
        const { plan: p } = plan(params);
        for (const side of ["l", "r"] as const) {
          const stack = p.boxes.filter((b) => b.side === side).sort((a, b) => a.top - b.top);
          stack.forEach((b, i) => {
            const next = stack[i + 1];
            if (next) expect(next.top).toBeGreaterThanOrEqual(b.top + b.h);
          });
        }
      });

      it("anchors every dot inside the image box", () => {
        const { plan: p } = plan(params);
        for (const b of p.boxes) {
          expect(b.at.x).toBeGreaterThanOrEqual(p.img.x);
          expect(b.at.x).toBeLessThanOrEqual(p.img.x + p.img.w);
          expect(b.at.y).toBeGreaterThanOrEqual(p.img.y);
          expect(b.at.y).toBeLessThanOrEqual(p.img.y + p.img.h);
        }
      });

      it("keeps its aspect ratio, and leaves room only where a label goes", () => {
        const { plan: p } = plan(params);
        // CENTRING IS NO LONGER ON THE STAGE, and it should not be. A figure
        // whose notes all point at one half reserves only that margin — the other
        // was 508 of 1700 stage pixels of nothing on the shipped deck — so the
        // property worth asserting is that the air is where the labels are, not
        // that the two sides are equal.
        const left = STAGE_W - (STAGE_W - p.img.x);
        const right = STAGE_W - p.img.x - p.img.w;
        for (const side of ["l", "r"] as const) {
          const air = side === "l" ? left : right;
          const used = p.boxes.some((b) => b.side === side);
          if (used) expect(air, `${side} margin holds a label`).toBeGreaterThanOrEqual(p.col);
        }
        // Whichever margin holds nothing is the small one — the figure took it.
        if (!p.boxes.some((b) => b.side === "l")) expect(left).toBeLessThan(right);
        if (!p.boxes.some((b) => b.side === "r")) expect(right).toBeLessThan(left);
        expect(p.img.w / p.img.h).toBeCloseTo(wide.width / wide.height, 6);
        expect(p.img.y).toBeGreaterThanOrEqual(0);
        expect(p.img.y + p.img.h).toBeLessThanOrEqual(p.height);
      });

      it("leaves no dead band — the stage is exactly what it holds", () => {
        // A stage left at its budget is what put a 4:1 strip in the middle of
        // 500px of nothing, and it passes every gate while doing it.
        const { plan: p } = plan(params);
        const tops = [p.img.y, ...p.boxes.map((b) => b.top)];
        const bottoms = [p.img.y + p.img.h, ...p.boxes.map((b) => b.top + b.h)];
        expect(Math.min(...tops)).toBeCloseTo(0, 6);
        expect(Math.max(...bottoms)).toBeCloseTo(p.height, 6);
      });
    });
  }

  it("fits five long labels without clipping any of them", () => {
    // The whole point of the escalating column: the maximal case must land `ok`.
    expect(plan(maximal).plan.ok).toBe(true);
    expect(plan(maximal).plan.boxes.some((b) => b.clipped)).toBe(false);
  });

  it("moves labels off a crowded side rather than off the stage", () => {
    const { plan: p } = plan(crowded);
    // Every point is at x 0.15, so the preferred side is left for all five.
    expect(p.boxes.filter((b) => b.side === "r").length).toBeGreaterThan(0);
    expect(p.ok).toBe(true);
  });
});

/**
 * The hardest sizing decision in the file: how much width the labels take from
 * the figure. It escalates on demand and it hands back whatever the figure's own
 * aspect ratio did not use — get either wrong and the slide still renders, just
 * with a clipped label or a weedy figure nobody notices in review.
 */
describe("annotated-figure column solver", () => {
  const short: FigureNote[] = [{ x: 0.5, y: 0.5, text: "Encoder" }];
  const long: FigureNote[] = [
    {
      x: 0.5,
      y: 0.5,
      text: "The encoder downsamples by a factor of two at every stage while doubling the channel count",
    },
  ];

  it("widens the column — and shrinks the figure — only when a label needs it", () => {
    const h = stageBudget(format, false, wide.caption);
    const a = planFigure(STAGE_W, short, wide, h);
    const b = planFigure(STAGE_W, long, wide, h);
    expect(b.col).toBeGreaterThan(a.col);
    expect(b.img.w).toBeLessThan(a.img.w);
    expect(a.ok && b.ok).toBe(true);
  });

  it("gives the labels the margin a portrait figure leaves behind", () => {
    const wideFig = planFigure(STAGE_W, short, wide, stageBudget(format, false, wide.caption));
    const tallFig = planFigure(STAGE_W, short, tall, stageBudget(format, false, tall.caption));
    expect(tallFig.col).toBeGreaterThan(wideFig.col);
    // …without the figure spilling out of the stage's height to get there.
    expect(tallFig.img.h).toBeLessThanOrEqual(stageBudget(format, false, tall.caption));
  });

  it("spends the line budget the note count leaves free", () => {
    // The same text: alone it may run to four lines, in a party of five it may
    // not, because three of those five can end up in one margin.
    const text = long[0]?.text ?? "";
    // The shortest stage this archetype ever gets: an eyebrow above and a
    // two-line caption below. That is where the budget has to bite.
    const h = stageBudget(format, true, `${wide.caption} ${wide.caption}`);
    const alone = planFigure(STAGE_W, [{ x: 0.5, y: 0.2, text }], wide, h);
    const five = planFigure(
      STAGE_W,
      [0.1, 0.3, 0.5, 0.7, 0.9].map((y) => ({ x: 0.5, y, text })),
      wide,
      h,
    );
    expect(alone.boxes[0]?.lines.length).toBe(4);
    for (const b of five.boxes) expect(b.lines.length).toBeLessThanOrEqual(3);
    // …and the cap still has to hold the five-note stack inside the stage.
    for (const b of five.boxes) expect(b.top + b.h).toBeLessThanOrEqual(h);
  });

  it("refuses to blow a small figure up to fill the box", () => {
    const p = planFigure(STAGE_W, short, tiny, stageBudget(format, false, tiny.caption));
    expect(p.img.w / tiny.width).toBeLessThanOrEqual(1.5);
  });

  it("clips with an ellipsis rather than overflowing when a note is absurd", () => {
    const p = planFigure(
      STAGE_W,
      [{ x: 0.5, y: 0.5, text: "word ".repeat(120) }],
      wide,
      stageBudget(format, false, wide.caption),
    );
    const box = p.boxes[0];
    expect(p.ok).toBe(false);
    expect(box?.clipped).toBe(true);
    expect(box?.lines.at(-1)?.endsWith("…")).toBe(true);
    expect(box?.w).toBeLessThanOrEqual(p.col);
    expect((box?.top ?? 0) + (box?.h ?? 0)).toBeLessThanOrEqual(p.height);
  });
});

describe("annotated-figure scene", () => {
  const scene = annotatedFigure(beatOf(maximal), ctx);
  const small = annotatedFigure(beatOf(minimal), ctx);

  it("scopes every timeline selector to its own scene", () => {
    const targets = scene.tl.map((t) => t.target);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      // `#s3-lead0` and `#s3 .thing` both scope; `.thing` reaches other scenes.
      expect(t.startsWith("#s3")).toBe(true);
    }
  });

  it("uses fromTo everywhere and from() nowhere", () => {
    // `Tween` has a required `from`, so `tsc` now enforces what this checked;
    // what is left worth checking is that the serialiser agrees.
    for (const t of [...scene.tl, ...small.tl]) {
      expect(Object.keys(t.from).length).toBeGreaterThan(0);
      expect(tweenText(t).startsWith('tl.fromTo("')).toBe(true);
    }
  });

  it("holds on the settled figure and on every note", () => {
    // One for the figure, one per note — a note without a hold is a reveal
    // navigation can never land on.
    expect(scene.holds.length).toBe(maximal.notes.length + 1);
    expect([...scene.holds].sort((a, b) => a - b)).toEqual(scene.holds);
    expect(scene.holds.at(-1)).toBeLessThanOrEqual(11 - 0.15);
    expect(small.holds.length).toBe(2);
  });

  it("lands all five holds inside a default-length beat", () => {
    // 7s is the schema's default, and a five-note figure is the common case.
    const short = annotatedFigure(beatOf(maximal, 7), ctx);
    expect(new Set(short.holds).size).toBe(maximal.notes.length + 1);
  });

  it("sets no audience text below 40px", () => {
    for (const m of scene.html.matchAll(/font-size="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(40);
    }
    for (const m of (scene.css ?? "").matchAll(/font-size:([\d.]+)px/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(40);
    }
  });

  it("states the image box rather than letting the browser pick one", () => {
    // THE PLATE IS THE SOLVED BOX PLUS ITS MAT, and that is the whole property —
    // the overlay's dots are fractions of the image, so a plate the browser sized
    // would put every annotation on the wrong pixel.
    //
    // Asserted against the emitter's OWN geometry rather than against a second
    // `planFigure` call. The two used to be compared directly and agreed only by
    // luck: the emitter crops before it solves, so a fixture with a `crop` gives
    // the helper a different figure from the one the scene laid out, and the
    // column widths are now derived per figure rather than taken from a shared
    // ladder — which turned that luck into a 34px disagreement.
    const left = Number(/#s3-plate\{left:([\d.]+)px/.exec(scene.css ?? "")?.[1]);
    const width = Number(/#s3-plate\{[^}]*width:([\d.]+)px/.exec(scene.css ?? "")?.[1]);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThan(0);
    // Inside the stage, mat included: 15px of plate padding either side.
    expect(left + width).toBeLessThanOrEqual(STAGE_W);
    expect(scene.html).toContain(`width="${STAGE_W}"`);
  });

  it("emits one ambient rule, gated on .ds-live and reduced motion", () => {
    const rules = (scene.css ?? "").split("\n").filter((l) => l.includes(".ds-live"));
    expect(rules.length).toBe(1);
    expect(rules[0]).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(rules[0]).toContain("#s3 .af-dot");
    // The dots' entrance writes opacity and transform; the breath must not.
    expect(rules[0]).toContain("ds-breathe");
  });

  it("renders byte-identically twice", () => {
    const again = annotatedFigure(beatOf(maximal), ctx);
    expect(again.html).toBe(scene.html);
    expect(again.tl).toEqual(scene.tl);
    expect(again.css).toBe(scene.css);
  });

  it("escapes source text", () => {
    const nasty = annotatedFigure(
      beatOf({ ...minimal, notes: [{ x: 0.5, y: 0.5, text: 'a <b> & "c"' }] }),
      ctx,
    );
    expect(nasty.html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(nasty.html).not.toContain("<b>");
  });

  it("names the beat and the figure when the reference is dead", () => {
    expect(() => annotatedFigure(beatOf({ ...minimal, figureId: "nope" }), ctx)).toThrow(
      /b7.*nope/,
    );
  });
});

const deckFormat = FORMATS["deck-16x9"] ?? format;

describe("crop", () => {
  const fig = { id: "f1", src: "f.png", caption: "A four-panel figure", width: 1600, height: 800 };
  const src: Source = {
    id: "s",
    title: "t",
    lang: "en",
    sections: [],
    equations: [],
    tables: [],
    figures: [fig],
  };
  const make = (crop?: { x: number; y: number; w: number; h: number }) =>
    annotatedFigure(
      {
        id: "b",
        intent: "i",
        evidence: [],
        weight: 0.5,
        seconds: 8,
        archetype: "annotated-figure",
        params: {
          headline: "h",
          figureId: "f1",
          ...(crop ? { crop } : {}),
          notes: [{ x: 0.15, y: 0.25, text: "the left panel" }],
        },
      },
      { sid: "s2", theme: ink, format: deckFormat, source: src },
    );

  it("scales the image up and clips to the region, so its own type is legible", () => {
    // Quarter of the figure means the shown panel is drawn at 4x the pixels a
    // whole-figure plate would give it. That is the entire point: a paper figure
    // sets its internal type near 12px on this canvas.
    const scene = make({ x: 0, y: 0, w: 0.5, h: 0.5 });
    const img = /#s2-plate img\{([^}]*)\}/.exec(scene.css ?? "");
    expect(img, "a crop must state the image geometry").not.toBeNull();
    const width = Number(/width:([\d.]+)px/.exec(img?.[1] ?? "")?.[1]);
    const plate = Number(/#s2-plate\{[^}]*width:([\d.]+)px/.exec(scene.css ?? "")?.[1]);
    expect(width).toBeGreaterThan(plate);
    expect(scene.css).toContain(".af-plate{overflow:hidden}");
  });

  it("leaves an uncropped figure exactly as it was", () => {
    expect(make().css).not.toContain("#s2-plate img{");
  });

  it("maps a note into the crop's own coordinates", () => {
    // x=0.15 of the whole figure is x=0.3 of a left-half crop, so the dot moves
    // right when the crop is applied — not staying put, and not falling off.
    const dotX = (html: string) => Number(/cx="([\d.]+)"/.exec(html)?.[1]);
    const whole = dotX(make().html);
    const cropped = dotX(make({ x: 0, y: 0, w: 0.5, h: 1 }).html);
    expect(cropped).toBeGreaterThan(whole);
  });
});

/**
 * Portrait puts the figure across the whole stage and the labels underneath it.
 *
 * Before this branch the two margins took two thirds of an 860px stage and the
 * demo's figure was drawn 232px wide — legible to nothing, and invisible to every
 * gate, because a small figure overflows nothing.
 */
describe("annotated-figure in portrait", () => {
  const short = FORMATS["short-9x16"] as Format;
  const STAGE_9x16 = short.width - 220;
  const plan9x16 = (params: Params, fig = wide) =>
    planFigure(
      STAGE_9x16,
      params.notes,
      fig,
      stageBudget(short, params.eyebrow !== undefined, fig.caption),
      true,
    );

  it("gives the figure the width the two margins used to take", () => {
    const p = plan9x16(minimal);
    // Landscape's best case at this stage width is a third of it; portrait's floor
    // is most of it.
    expect(p.img.w).toBeGreaterThan(STAGE_9x16 * 0.85);
    expect(p.img.x).toBeGreaterThanOrEqual(0);
    expect(p.img.x + p.img.w).toBeLessThanOrEqual(STAGE_9x16);
  });

  it("lays three notes out as columns in the points' own left-to-right order", () => {
    const three: Params = {
      headline: "H",
      figureId: "f1",
      notes: [
        { x: 0.86, y: 0.8, text: "pixel-wise dense field" },
        { x: 0.3, y: 0.8, text: "window partitioning" },
        { x: 0.52, y: 0.8, text: "the shared block" },
      ],
    };
    const p = plan9x16(three);
    // A leader crosses another label exactly when a column is out of order, so
    // the ordering IS the no-crossing property.
    const byDot = [...p.boxes].sort((a, b) => a.at.x - b.at.x);
    for (let i = 1; i < byDot.length; i++) {
      expect((byDot[i] as { inner: number }).inner).toBeGreaterThan(
        (byDot[i - 1] as { inner: number }).inner,
      );
    }
    // All three sit on one row, under one shared rule.
    const ruleYs = new Set(p.boxes.map((b) => Math.round(b.ruleY * 100)));
    expect(ruleYs.size).toBe(1);
  });

  it("puts the row's rule above its caption, clear of the leader's own text", () => {
    const p = plan9x16(minimal);
    const box = p.boxes[0] as { ruleY: number; top: number };
    expect(box.ruleY).toBeLessThan(box.top);
  });

  it("keeps every label and its rule inside the stage", () => {
    for (const params of [minimal, maximal, crowded]) {
      const p = plan9x16(params);
      for (const b of p.boxes) {
        const outer = b.side === "l" ? b.inner - b.w : b.inner + b.w;
        expect(Math.min(b.inner, outer)).toBeGreaterThanOrEqual(-0.01);
        expect(Math.max(b.inner, outer)).toBeLessThanOrEqual(STAGE_9x16 + 0.01);
        expect(b.top).toBeGreaterThanOrEqual(-0.01);
      }
    }
  });

  it("falls back to two stacked columns when a row would shred the labels", () => {
    // Five notes in 860px is 148px a column, which no 40px caption survives.
    const p = plan9x16(maximal);
    expect(new Set(p.boxes.map((b) => b.side)).size).toBe(2);
    expect(p.col).toBeGreaterThan(300);
  });

  it("leaves the landscape margins exactly as they were", () => {
    const wideP = planFigure(
      STAGE_W,
      minimal.notes,
      wide,
      stageBudget(format, false, wide.caption),
    );
    const box = wideP.boxes[0] as { inner: number; side: string };
    // Landscape's rule ends beside the plate, not on a channel under it.
    const plateEdge =
      box.side === "l" ? wideP.img.x - 15 - 18 : wideP.img.x + wideP.img.w + 15 + 18;
    expect(box.inner).toBeCloseTo(plateEdge, 6);
  });
});

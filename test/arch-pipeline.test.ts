import { describe, expect, it } from "vitest";
import { pipeLayout, pipeline } from "../src/emit/archetypes/pipeline.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { contentW, tweenText } from "../src/emit/kit.js";
import { MIN_FONT, n, textWidth, wrap } from "../src/emit/svg.js";
import type { BeatOf, Format } from "../src/types.js";
import { FORMATS, pipelineParamsSchema } from "../src/types.js";

const theme: Theme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#9aa7b5",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

const format: Format = {
  id: "deck-16x9",
  width: 1920,
  height: 1080,
  minWeight: 0,
  navigable: true,
};

const ctx = (sid = "s3"): EmitContext => ({
  source: {
    id: "src",
    title: "t",
    lang: "en",
    sections: [],
    figures: [],
    equations: [],
    tables: [],
  },
  format,
  theme,
  sid,
});

type Params = BeatOf<"pipeline">["params"];

const beat = (params: Params, seconds = 9): BeatOf<"pipeline"> => ({
  id: "b",
  intent: "i",
  evidence: [],
  weight: 0.5,
  seconds,
  archetype: "pipeline",
  params: pipelineParamsSchema.parse(params),
});

/** The schema's floor: two stages, nothing optional. */
const MINIMAL: Params = { headline: "H", stages: [{ label: "In" }, { label: "Out" }] };

/** The schema's ceiling: six stages, every optional field, longest plausible copy. */
const MAXIMAL: Params = {
  eyebrow: "Method",
  headline: "The whole architecture, end to end",
  stages: [
    { label: "LQ input", note: "48x48x3", tone: "a" },
    { label: "Shallow conv", note: "3x3, 60ch" },
    { label: "Swin blocks", note: "6 groups", tone: "b" },
    { label: "Window attn", note: "8x8 windows" },
    { label: "Upsample", note: "pixel shuffle", tone: "c" },
    { label: "HQ output", note: "192x192x3", tone: "d" },
  ],
  loop: { from: 3, to: 1, label: "gradient from the reconstruction loss" },
  note: "Every block below the dashed return path is trained end to end.",
};

/** 1920x1080 less the shell's 110px gutters and 84px bands. */
const CONTENT_W = 1700;
const CONTENT_H = 912;

describe("pipeLayout", () => {
  for (const [name, params] of [
    ["minimal", MINIMAL],
    ["maximal", MAXIMAL],
  ] as const) {
    describe(name, () => {
      const loop = params.loop
        ? {
            from: params.loop.from ?? params.stages.length - 1,
            to: params.loop.to,
            label: params.loop.label,
          }
        : undefined;
      const L = pipeLayout(CONTENT_W, params.stages, loop);

      it("never sets audience text below the floor", () => {
        expect(L.size).toBeGreaterThanOrEqual(MIN_FONT);
      });

      it("keeps every box inside the canvas width", () => {
        for (const b of L.boxes) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(CONTENT_W);
        }
      });

      it("gives every box the same width and a positive gap", () => {
        const widths = new Set(L.boxes.map((b) => Math.round(b.w * 100)));
        expect(widths.size).toBe(1);
        for (let i = 1; i < L.boxes.length; i++) {
          const prev = L.boxes[i - 1] as { x: number; w: number };
          const here = L.boxes[i] as { x: number; w: number };
          expect(here.x - (prev.x + prev.w)).toBeGreaterThan(0);
        }
      });

      it("keeps every stage's text inside its box", () => {
        L.labelLines.forEach((lines, i) => {
          for (const l of lines) expect(textWidth(l, L.size, 600)).toBeLessThanOrEqual(L.innerW);
          const notes = L.noteLines[i] ?? [];
          for (const l of notes) expect(textWidth(l, MIN_FONT, 400)).toBeLessThanOrEqual(L.innerW);
          // Vertically: what the box was sized to hold is what will be drawn.
          const h =
            lines.length * L.size * 1.2 + (notes.length ? 16 + notes.length * MIN_FONT * 1.3 : 0);
          expect(h + 2 * 34).toBeLessThanOrEqual(L.boxH + 0.5);
        });
      });

      it("fits the diagram in the band the chrome leaves", () => {
        expect(L.svgH).toBeLessThanOrEqual(CONTENT_H - 300);
      });
    });
  }

  it("sizes the box against its note as well as its label", () => {
    // "192x192x3" is one unbreakable token and is wider than any of these labels.
    // Fitting the labels alone leaves it a box it does not fit in — which is
    // exactly what the first six-stage layout did.
    const stages = MAXIMAL.stages;
    const L = pipeLayout(CONTENT_W, stages);
    stages.forEach((s, i) => {
      // Wrapped on spaces, never mid-token.
      expect((L.noteLines[i] ?? []).join(" "), s.note).toBe(s.note);
    });
    expect(textWidth("192x192x3", MIN_FONT, 400)).toBeLessThanOrEqual(L.innerW);
  });

  it("caps the boxes and centres the row rather than filling 1700px with two slabs", () => {
    const L = pipeLayout(CONTENT_W, MINIMAL.stages);
    const first = L.boxes[0] as { x: number; w: number };
    const lastBox = L.boxes[1] as { x: number; w: number };
    expect(first.w).toBeLessThanOrEqual(430);
    // Centred: the margin left of the row matches the margin right of it.
    expect(first.x).toBeCloseTo(CONTENT_W - (lastBox.x + lastBox.w), 1);
    expect(first.x).toBeGreaterThan(0);
  });

  it("spends the whole canvas when the cap cannot hold the labels", () => {
    const L = pipeLayout(CONTENT_W, MAXIMAL.stages);
    const first = L.boxes[0] as { x: number };
    expect(first.x).toBeLessThan(10);
  });

  it("hits the hard case: six labels still fit on one line at readable type", () => {
    // Six is the schema's ceiling and the sizing decision that actually bites —
    // 1700px across six boxes leaves ~245px each. Ordinary stage names have to
    // survive that on a single line, or the archetype is unusable at its own max.
    const stages = ["Encoder", "Shifted", "Attention", "Merge", "Decoder", "Output"].map(
      (label) => ({
        label,
      }),
    );
    const L = pipeLayout(CONTENT_W, stages);
    expect(L.size).toBeGreaterThanOrEqual(MIN_FONT);
    for (const lines of L.labelLines) expect(lines).toHaveLength(1);
  });

  it("spends lines before it spends type", () => {
    const long = Array.from({ length: 4 }, () => ({ label: "Residual dense feature block" }));
    const L = pipeLayout(CONTENT_W, long);
    expect(L.size).toBeGreaterThanOrEqual(MIN_FONT);
    // The label cannot be set on one line in a quarter of the canvas, so it wraps
    // rather than shrinking every other stage with it.
    expect((L.labelLines[0] ?? []).length).toBeGreaterThan(1);
    // And what it wraps to is what the box was sized for.
    for (const l of L.labelLines[0] ?? []) {
      expect(textWidth(l, L.size, 600)).toBeLessThanOrEqual(L.innerW);
    }
  });

  it("grows the box rather than clipping a label that cannot fit at all", () => {
    const stages = Array.from({ length: 6 }, () => ({ label: "Reconstructionreconstruction" }));
    const L = pipeLayout(CONTENT_W, stages);
    expect(L.size).toBe(MIN_FONT);
    for (const lines of L.labelLines) {
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines) expect(textWidth(l, L.size, 600)).toBeLessThanOrEqual(L.innerW);
    }
    expect(L.boxH).toBeGreaterThan(172);
  });

  it("leaves room under the row for a loop and none without one", () => {
    const withLoop = pipeLayout(CONTENT_W, MAXIMAL.stages, { from: 3, to: 1, label: "gradient" });
    const without = pipeLayout(CONTENT_W, MAXIMAL.stages);
    expect(without.loopDrop).toBe(0);
    expect(withLoop.loopDrop).toBeGreaterThan(0);
    expect(withLoop.svgH).toBeGreaterThan(without.svgH);
  });
});

describe("pipeline emitter", () => {
  const scenes = [
    ["minimal", pipeline(beat(MINIMAL), ctx())],
    ["maximal", pipeline(beat(MAXIMAL), ctx())],
  ] as const;

  for (const [name, scene] of scenes) {
    describe(name, () => {
      it("scopes every timeline selector to its scene", () => {
        for (const t of scene.tl) {
          expect(t.target, t.target).toMatch(/^#s3[-\s]/);
        }
      });

      it("emits every target it animates", () => {
        for (const t of scene.tl) {
          if (!/^#[\w-]+$/.test(t.target)) continue;
          expect(scene.html, t.target).toContain(`id="${t.target.slice(1)}"`);
        }
      });

      it("never uses from()", () => {
        // The type has no shape without `from`; this pins the serialiser.
        for (const t of scene.tl) expect(tweenText(t)).toContain("tl.fromTo(");
      });

      it("holds only where the timeline has settled, and inside the beat", () => {
        expect(scene.holds.length).toBeGreaterThan(0);
        const ends = scene.tl.map((t) => t.at + ((t.to.duration as number) ?? 0));
        for (const h of scene.holds) {
          expect(h).toBeLessThanOrEqual(9 - 0.15 + 1e-9);
          // A hold lands after something finished, never mid-reveal.
          expect(ends.some((e) => e <= h + 1e-9)).toBe(true);
        }
        expect([...scene.holds].sort((a, b) => a - b)).toEqual(scene.holds);
      });

      it("carries one ambient rule, gated and scoped", () => {
        const rules = (scene.css ?? "").split("\n").filter((l) => l.includes(".ds-live"));
        expect(rules).toHaveLength(1);
        expect(rules[0]).toContain("prefers-reduced-motion: no-preference");
        expect(rules[0]).toContain(".ds-live #s3-stage");
        // `filter`, because the stage group's entrance already writes transform
        // and opacity and a CSS animation outranks inline style.
        expect(rules[0]).toContain("ds-breathe");
      });

      it("keeps the drawing inside its own viewBox", () => {
        const box = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(scene.html);
        expect(box).not.toBeNull();
        const h = Number(box?.[2]);
        expect(Number(box?.[1])).toBe(CONTENT_W);
        for (const m of scene.html.matchAll(/<rect [^>]*x="(-?[\d.]+)"[^>]*width="([\d.]+)"/g)) {
          expect(Number(m[1])).toBeGreaterThanOrEqual(0);
          expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(CONTENT_W);
        }
        for (const m of scene.html.matchAll(/<text [^>]*y="(-?[\d.]+)"/g)) {
          expect(Number(m[1])).toBeGreaterThan(0);
          expect(Number(m[1])).toBeLessThan(h);
        }
      });

      it("escapes nothing into markup it did not mean to", () => {
        expect(scene.html).not.toContain("undefined");
        expect(scene.html).not.toContain("NaN");
      });
    });
  }

  it("draws a connector between every pair of stages, and no more", () => {
    const scene = pipeline(beat(MAXIMAL), ctx());
    for (let i = 0; i < MAXIMAL.stages.length - 1; i++) {
      expect(scene.html).toContain(`id="s3-arrow${i}"`);
    }
    expect(scene.html).not.toContain(`id="s3-arrow${MAXIMAL.stages.length - 1}"`);
  });

  it("reveals each connector before the stage it points at", () => {
    const scene = pipeline(beat(MAXIMAL), ctx());
    const at = (sel: string) => scene.tl.find((t) => t.target === sel)?.at ?? Number.NaN;
    for (let i = 1; i < MAXIMAL.stages.length; i++) {
      expect(at(`#s3-arrow${i - 1}`)).toBeLessThan(at(`#s3-stage${i}`));
    }
  });

  it("routes the loop below the row, back to the stage it names", () => {
    const scene = pipeline(beat(MAXIMAL), ctx());
    // The dashed one: the other `<path>` in the document is an arrowhead marker.
    const d = /<path d="(M([\d.]+),([\d.]+)[^"]*)"[^>]*stroke-dasharray/.exec(scene.html);
    expect(d).not.toBeNull();
    const L = pipeLayout(CONTENT_W, MAXIMAL.stages, {
      from: 3,
      to: 1,
      label: MAXIMAL.loop?.label ?? "",
    });
    const startX = Number(d?.[2]);
    const startY = Number(d?.[3]);
    // It leaves the stage the params name, which is not the last one: a loop
    // drawn from the end would claim the tick passes through every later stage.
    const origin = L.boxes[MAXIMAL.loop?.from ?? 0] as { x: number; w: number };
    expect(startX).toBeCloseTo(origin.x + origin.w / 2, 1);
    // It leaves from the bottom edge, not through the row.
    expect(startY).toBeCloseTo(2 + L.boxH, 1);
    // And every leg stays under the boxes.
    for (const m of (d?.[1] ?? "").matchAll(/[MLQ]([\d.]+),([\d.]+)/g)) {
      expect(Number(m[2])).toBeGreaterThanOrEqual(2 + L.boxH - 0.01);
    }
  });

  // This test used to assert the FOLD, which was the bug: a self-loop was
  // rewritten to point at the previous stage, so the demo's "one thought tick"
  // drew DQ-CTM -> Window and asserted the opposite of the paper it explains.
  // Every gate passed it. A stage that ticks on itself is a real claim and is
  // now drawn as one.
  it("draws a self-loop on its own stage, not on the one before it", () => {
    const stages = [{ label: "A" }, { label: "B" }, { label: "C" }];
    const scene = pipeline(beat({ headline: "H", stages, loop: { to: 2, label: "again" } }), ctx());
    const L = pipeLayout(CONTENT_W, stages, { from: 2, to: 2, label: "again" });
    const box = L.boxes[2] as { x: number; w: number };
    const mid = box.x + box.w / 2;
    const prev = L.boxes[1] as { x: number; w: number };
    // Both endpoints straddle stage 2's centre; neither lands on stage 1.
    const xs = [...scene.html.matchAll(/[ML](\d+(?:\.\d+)?),/g)].map((m) => Number(m[1]));
    const near = xs.filter((x) => Math.abs(x - mid) < box.w);
    expect(near.length).toBeGreaterThan(0);
    expect(xs).not.toContain(n(prev.x + prev.w / 2));
  });

  it("draws nothing rather than inventing a direction for an impossible loop", () => {
    const stages = [{ label: "A" }, { label: "B" }, { label: "C" }];
    // Only the too-large case reaches the emitter: `loop.to` is a non-negative
    // int in the schema, so a negative one is refused at plan time.
    const scene = pipeline(beat({ headline: "H", stages, loop: { to: 5, label: "again" } }), ctx());
    expect(scene.html).not.toContain("again");
  });

  it("omits loop machinery entirely when there is no loop", () => {
    const scene = pipeline(beat(MINIMAL), ctx());
    expect(scene.html).not.toContain("clipPath");
    expect(scene.html).not.toContain("s3-sweep");
    expect(scene.tl.join("\n")).not.toContain("sweep");
    // One arrowhead colour, because only one colour of arrow is drawn.
    expect([...scene.html.matchAll(/<marker /g)]).toHaveLength(1);
  });

  it("tones only the stages the params tone", () => {
    const scene = pipeline(beat(MAXIMAL), ctx());
    for (const t of Object.values(theme.tones)) expect(scene.html).toContain(t);
    // Stage 1 and 3 are untoned, so the row keeps its neutral panel fill.
    expect(scene.html).toContain(theme.panel);
  });

  it("renders byte-identically twice", () => {
    const a = pipeline(beat(MAXIMAL), ctx());
    const b = pipeline(beat(MAXIMAL), ctx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps its holds inside a beat shorter than its own schedule", () => {
    const scene = pipeline(beat(MAXIMAL, 4), ctx());
    for (const h of scene.holds) expect(h).toBeLessThanOrEqual(4 - 0.15 + 1e-9);
  });

  it("wraps a loop label rather than letting it run into the legs", () => {
    // A short hop leaves little room between the legs, which is where a long
    // loop label would otherwise run straight over them.
    const label = "gradient from the reconstruction loss and the perceptual term";
    const L = pipeLayout(CONTENT_W, MAXIMAL.stages, {
      from: MAXIMAL.stages.length - 1,
      to: 4,
      label,
    });
    expect(L.loopLines.length).toBeGreaterThan(1);
    // Wrapped on word boundaries, not chopped mid-word: every line is a run of
    // whole words from the original.
    expect(L.loopLines.join(" ")).toBe(wrap(label, MIN_FONT, 1e9, 500).join(" "));
  });
});

describe("pipeline loop origin", () => {
  it("loops from the stage that actually recurs, not always the last", () => {
    // The tick returns from Refine, not from Decode: drawing it from the end
    // claims the loop passes through every later stage, which it does not.
    const scene = pipeline(
      beat(
        pipelineParamsSchema.parse({
          stages: [
            { label: "Patchify" },
            { label: "Encode" },
            { label: "Refine" },
            { label: "Decode" },
          ],
          loop: { from: 2, to: 1, label: "one tick" },
          headline: "h",
        }),
      ),
      ctx(),
    );
    const layout = pipeLayout(
      CONTENT_W,
      [{ label: "Patchify" }, { label: "Encode" }, { label: "Refine" }, { label: "Decode" }],
      { from: 2, to: 1, label: "one tick" },
    );
    const mid = (i: number) => {
      const b = layout.boxes[i];
      if (!b) throw new Error("no box");
      return b.x + b.w / 2;
    };
    // The elbow's legs sit on stage 2 and stage 1, and nowhere near stage 3.
    expect(scene.html).toContain(`${Math.round(mid(2) * 100) / 100}`);
    expect(scene.html).not.toContain(`M${Math.round(mid(3) * 100) / 100},`);
  });

  it("drops a loop that cannot point backwards rather than drawing onto itself", () => {
    const scene = pipeline(
      beat(
        pipelineParamsSchema.parse({
          stages: [{ label: "A" }, { label: "B" }],
          loop: { from: 0, to: 1, label: "backwards" },
          headline: "h",
        }),
      ),
      ctx(),
    );
    expect(scene.html).not.toContain("backwards");
  });
});

/**
 * Portrait runs the flow down the page. Everything here was false before that
 * branch existed: at 9:16 four stages shared 860px, so "Window" set as "Windo/w"
 * and the row was wider than the labels in it.
 */
describe("pipeline in portrait", () => {
  const tall = FORMATS["short-9x16"] as Format;
  const tallCtx: EmitContext = { ...ctx(), format: tall };
  // Derived, not 220: `.scene`'s padding is a FRACTION of the canvas, so a
  // literal here pins the gutter to whatever 16:9 happened to use and fails
  // the moment the margin scales with the format.
  const CONTENT_9x16 = contentW(tall);

  /** Every stage shell, in emission order. `rx="18"` is `R`, and only boxes use it. */
  const shells = (html: string) =>
    [
      ...html.matchAll(
        /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="18"/g,
      ),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));

  it("stacks the boxes down one column instead of across a row", () => {
    const boxes = shells(pipeline(beat(MAXIMAL), tallCtx).html);
    expect(boxes.length).toBe(MAXIMAL.stages.length);
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1] as { x: number; y: number; h: number };
      const here = boxes[i] as { x: number; y: number };
      expect(here.x).toBeCloseTo(prev.x, 6);
      expect(here.y).toBeGreaterThan(prev.y + prev.h);
    }
  });

  it("gives every label a box wide enough to set it without breaking a word", () => {
    const html = pipeline(beat(MAXIMAL), tallCtx).html;
    const box = shells(html)[0] as { w: number };
    for (const stage of MAXIMAL.stages) {
      // The box is the whole column, so a label only wraps at a space — which is
      // the difference between "Window" and "Windo/w".
      const longest = stage.label.split(/\s+/).reduce((a, b) => (a.length > b.length ? a : b));
      expect(textWidth(longest, MIN_FONT, 600)).toBeLessThan(box.w);
    }
  });

  it("keeps the whole diagram, loop channel included, inside the content box", () => {
    const html = pipeline(beat(MAXIMAL), tallCtx).html;
    const svgTag = /<svg id="s3-pipe" width="([\d.]+)" height="([\d.]+)"/.exec(html);
    expect(svgTag).not.toBeNull();
    expect(Number(svgTag?.[1])).toBe(CONTENT_9x16);
    // Boxes stop short of the right edge by the loop's own channel.
    const box = shells(html)[0] as { x: number; w: number };
    expect(box.x + box.w).toBeLessThan(CONTENT_9x16);
  });

  it("sweeps the loop up the column rather than back across the row", () => {
    const scene = pipeline(beat(MAXIMAL), tallCtx);
    const sweep = scene.tl.find((t) => t.target.includes("-sweep"));
    expect(sweep).toBeDefined();
    expect(Object.keys(sweep?.from ?? {})).toEqual(["y"]);
    expect(sweep?.from.y).toBeTypeOf("number");
    expect(sweep?.to.y).toBe(0);
  });

  it("leaves the landscape row exactly as it was", () => {
    // The portrait branch is reached from the format, so the 16:9 emitter must
    // not have moved: this is the shipping format.
    const boxes = shells(pipeline(beat(MAXIMAL), ctx()).html);
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1] as { x: number; y: number; w: number };
      const here = boxes[i] as { x: number; y: number };
      expect(here.y).toBeCloseTo(prev.y, 6);
      expect(here.x).toBeGreaterThan(prev.x + prev.w);
    }
  });
});

/**
 * Portrait behaviour for the six archetypes that carry the deck's type.
 *
 * Everything here is a property that was FALSE before this pass and that no
 * existing gate reads. The 9:16 build reported PASS while running an equation
 * off the frame and setting a chart 400px wide inside an 860px box: the
 * composition is the size it says it is, so nothing overflows anything a gate
 * can see. These assertions are the gate.
 */
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { fitText, isPortrait, unwidow } from "../src/emit/archetypes/title.js";
import { contentW, type EmitContext, type Theme } from "../src/emit/kit.js";
import { textWidth, wrap } from "../src/emit/svg.js";
import { type Beat, FORMATS, type Format, type Source } from "../src/types.js";

const theme: Theme = {
  bg: "#0b0c0e",
  fg: "#eef1f5",
  muted: "#aeb6c2",
  dim: "#7d8794",
  rule: "#2a2f36",
  panel: "#14171b",
  accent: "#4a90e2",
  tones: { a: "#4a90e2", b: "#f2c14e", c: "#7ed6a5", d: "#e2725b" },
  fontStack: "Inter, sans-serif",
};

const source: Source = {
  id: "src",
  title: "t",
  lang: "en",
  sections: [],
  figures: [
    { id: "fig", src: "f.png", caption: "Figure 1 — a caption.", width: 1298, height: 578 },
  ],
  equations: [
    {
      id: "eq",
      display: true,
      tex: "\\mathbf{F}=\\mathcal{E}(\\mathbf{I}_{\\mathrm{LR}}),\\qquad \\mathbf{X}=\\mathcal{W}(\\mathbf{F})",
    },
  ],
  tables: [
    {
      id: "tbl",
      columns: ["Method", "Params", "Average"],
      rows: [
        ["CARN", "1.592M", "28.970"],
        ["Ours", "1.129M", "28.983"],
      ],
    },
  ],
};

const tall = FORMATS["short-9x16"] as Format;
const wide = FORMATS["deck-16x9"] as Format;
const square = FORMATS["post-1x1"] as Format;
const ctx = (format = tall, sid = "s1"): EmitContext => ({ source, format, theme, sid });

describe("isPortrait", () => {
  it("is true only where the canvas is taller than it is wide", () => {
    expect(isPortrait(tall)).toBe(true);
    expect(isPortrait(wide)).toBe(false);
    // Square stays on the landscape branch: those arrangements survive a square
    // box, and a 1x1 post routed to the portrait branch would stack a two-panel
    // comparison it has the width to set side by side.
    expect(isPortrait(square)).toBe(false);
  });
});

describe("unwidow", () => {
  /**
   * A size chosen so the samples below WRAP, not the deck's headline scale.
   * `unwidow` has nothing to do with a headline that sets on one line, and these
   * samples only wrap at 1700 above ~60px — so this stays at 76 where
   * `HEADLINE_SIZE` came down to 64. Pinned to the live constant instead, every
   * assertion here would go vacuous the moment the scale moved under the sample,
   * silently and with the suite green.
   */
  const HEAD = 76;

  it("binds the tail so the last line cannot be one word", () => {
    const text = "Competitive with CNN baselines, behind recent models";
    const bound = unwidow(text, 1700, HEAD);
    expect(bound).toContain(" ");
    // Same words, same order — only the spaces between the last few changed.
    expect(bound.split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("never binds a run wider than the measure", () => {
    // Forced to break, the browser breaks inside a word, which is worse than the
    // orphan. 240px cannot hold two words of this headline at 76px.
    expect(
      unwidow("Competitive with CNN baselines, behind recent models", 240, HEAD),
    ).not.toContain(" ");
  });

  it("leaves a headline that already sets on one line alone", () => {
    expect(unwidow("Short enough", 1700, HEAD)).not.toContain(" ");
  });

  it("refuses a binding that strands an earlier line", () => {
    // The regression this guard exists for: binding "dense output" at 116px in an
    // 860px box pushed the run off line three and left "with" there by itself — a
    // one-word line in the MIDDLE of a headline, worse than the one at the end.
    const text = "Compact thought collides with dense output";
    const before = wrap(text, 116, 860, 700);
    const after = unwidow(text, 860, 116);
    if (after !== text) {
      const shortest = (ls: string[]) => Math.min(...ls.map((l) => textWidth(l, 116, 700)));
      expect(shortest(wrap(after, 116, 860, 700))).toBeGreaterThanOrEqual(shortest(before));
    }
  });

  it("never adds or drops a word", () => {
    for (const w of [400, 860, 1200, 1700]) {
      for (const text of [
        "The thought state is a stack the carrier is read through",
        "The method is mid-pack on parameters, not the smallest",
        "One summary token per window, or one query per pixel",
      ]) {
        expect(unwidow(text, w, HEAD).split(/\s+/)).toEqual(text.split(/\s+/));
      }
    }
  });
});

describe("fitText", () => {
  it("returns a size that actually sets in maxLines", () => {
    // The division solves for perfect packing. At 860 one long word is a fifth of
    // the measure, and the demo's title came back at 116px set on FOUR lines
    // against a cap of three — the extra line being a stranded "with".
    const text = "Compact thought collides with dense output";
    for (const [w, max] of [
      [860, 3],
      [1700, 3],
      [640, 4],
    ] as [number, number][]) {
      const size = fitText(text, w, max, 88, 156);
      expect(wrap(text, size, w, 700).length).toBeLessThanOrEqual(max);
    }
  });

  it("stays inside its own bounds and lands on the floor rather than below it", () => {
    const size = fitText("Averyveryverylongunbreakableword indeed", 300, 1, 88, 156);
    expect(size).toBe(88);
  });
});

/** Every element the emitter drew, as `[left, right]` pairs where it declared one. */
function svgSpans(html: string): number[] {
  return [...html.matchAll(/\bwidth="(\d+)"/g)].map((m) => Number(m[1]));
}

describe("portrait layouts", () => {
  it("equation-walk stacks a two-statement display and fits it in the box", () => {
    const beat = {
      id: "b",
      archetype: "equation-walk",
      seconds: 12,
      weight: 1,
      params: {
        headline: "The encoder makes the field",
        equationId: "eq",
        terms: [{ tex: "\\mathcal{E}", label: "encoder", tone: "a" }],
      },
    } as unknown as Beat;

    const portrait = emitScene(beat, ctx());
    // Two `katex.render` calls into two boxes, not one line running off the frame.
    expect(portrait.html).toContain("eqstack");
    expect((portrait.setup ?? []).filter((s) => s.includes("katex.render")).length).toBe(3);

    // 16:9 has the width, so it stays on one line — this is the shipping format.
    const landscape = emitScene(beat, ctx(wide));
    expect(landscape.html).not.toContain("eqstack");
    expect((landscape.setup ?? []).filter((s) => s.includes("katex.render")).length).toBe(2);
  });

  it("line-chart draws across the whole box and puts its readout below", () => {
    const beat = {
      id: "b",
      archetype: "line-chart",
      seconds: 12,
      weight: 1,
      params: {
        headline: "Each extra tick buys less",
        xLabel: "ticks",
        yLabel: "PSNR",
        points: [
          { x: "T=0", y: 28.91 },
          { x: "T=1", y: 29.88 },
          { x: "T=2", y: 30.47 },
        ],
        readout: "Trained to T=4.",
      },
    } as unknown as Beat;

    // Beside the readout the plot was 400 wide inside an 860 box and the category
    // labels printed on top of each other. The svg takes the content box.
    const portrait = emitScene(beat, ctx());
    expect(svgSpans(portrait.html)).toContain(contentW(tall));
    expect(portrait.html).toContain("chartstack");
    // Not `.stackwrap`: that is stack.ts's class, and one stylesheet serves the
    // whole deck, so reusing it hands this wrapper stack's `align-self:center`.
    expect(portrait.html).not.toContain("stackwrap");

    const landscape = emitScene(beat, ctx(wide));
    expect(landscape.html).not.toContain("chartstack");
    expect(svgSpans(landscape.html)[0]).toBeLessThan(contentW(wide));
  });

  it("callout stacks its panels one per row and caps the stack at their sum", () => {
    const beat = {
      id: "b",
      archetype: "callout",
      seconds: 12,
      weight: 1,
      params: {
        headline: "The same experiment reports three different numbers",
        panels: [
          { label: "abstract", lines: ["PSNR-Y 28.10 -> 30.28"] },
          { label: "sweep table", lines: ["PSNR-Y 28.91 -> 30.47"] },
        ],
        note: "A note.",
      },
    } as unknown as Beat;

    const portrait = emitScene(beat, ctx());
    expect(portrait.html).toContain("grid-template-columns:repeat(1, 1fr)");
    const landscape = emitScene(beat, ctx(wide));
    expect(landscape.html).toContain("grid-template-columns:repeat(2, 1fr)");

    // Stacked, the cap is on n rows, not on the tallest one. Capping a stack at
    // its tallest member clips every panel but that one and lays the note out
    // underneath the overflow — which is `text_occluded`, and only at 9:16.
    const capOf = (html: string) => Number(/max-height:(\d+)px/.exec(html)?.[1]);
    expect(capOf(portrait.html)).toBeGreaterThan(capOf(landscape.html));
  });

  it("claim-figure stacks, so the figure gets the whole measure", () => {
    const beat = {
      id: "b",
      archetype: "claim-figure",
      seconds: 12,
      weight: 1,
      params: { headline: "The trajectory is visible", claim: "A claim.", figureId: "fig" },
    } as unknown as Beat;

    const portrait = emitScene(beat, ctx());
    expect(portrait.html).toContain("cf-stack");
    // Beside the claim's 560px column inside an 860px box, a 2.25-aspect plate was
    // drawn 244px wide — a thumbnail of the evidence the slide exists to show.
    expect(portrait.html).not.toContain("cf-beside");
    expect(emitScene(beat, ctx(wide)).html).toContain("cf-beside");
  });

  it("data-table spends the tall box on row rhythm rather than banding", () => {
    const beat = {
      id: "b",
      archetype: "data-table",
      seconds: 12,
      weight: 1,
      params: { headline: "Competitive with CNN baselines", tableId: "tbl", highlight: [] },
    } as unknown as Beat;

    const padOf = (html: string) => Number(/padding:(\d+)px/.exec(html)?.[1]);
    const portrait = padOf(emitScene(beat, ctx()).css ?? "");
    const landscape = padOf(emitScene(beat, ctx(wide)).css ?? "");
    expect(portrait).toBeGreaterThan(landscape);
    // A cap, not a target: the type floor still governs, and the padding only
    // ever spends slack the box already had.
    expect(portrait).toBeLessThanOrEqual(68);
  });

  it("draws nothing wider than the content box in either format", () => {
    // The whole defect in one assertion. Every archetype here declared its widths
    // against a hardcoded 1700, and at 860 they ran off a frame no gate reads.
    const beats: Beat[] = [
      {
        id: "b1",
        archetype: "line-chart",
        seconds: 12,
        weight: 1,
        params: {
          headline: "H",
          xLabel: "x",
          yLabel: "y",
          points: [
            { x: "A", y: 1 },
            { x: "B", y: 2 },
          ],
          readout: "R",
        },
      },
    ] as unknown as Beat[];
    for (const format of [tall, wide]) {
      for (const beat of beats) {
        for (const w of svgSpans(emitScene(beat, ctx(format)).html)) {
          expect(w).toBeLessThanOrEqual(contentW(format));
        }
      }
    }
  });
});

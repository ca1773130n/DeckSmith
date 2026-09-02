/**
 * The prompt's reveal-count table, checked against the emitters it describes.
 *
 * This test is the whole reason that table is allowed to be text. The prompt is
 * built before any beat exists, so `systemPrompt` cannot call `emitScene`; the
 * only alternative to a table verified here is prose nobody verifies, and prose
 * nobody verifies is what shipped — "a pipeline of four stages wants five
 * sentences", against an emitter that produces four.
 */
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { ink } from "../src/emit/themes/index.js";
import { REVEALS, systemPrompt } from "../src/plan/prompt.js";
import type { Beat, Format, Source } from "../src/types.js";
import { FORMATS, prefsSchema } from "../src/types.js";

const source: Source = {
  id: "s",
  title: "t",
  lang: "en",
  sections: [{ id: "sec", depth: 1, heading: "H", text: "t" }],
  figures: [{ id: "fig", src: "f.jpg", caption: "c", width: 1000, height: 600 }],
  equations: [{ id: "eq", tex: "y = \\mathcal{E}(x) + \\mathcal{W}(z)", display: true }],
  tables: [
    {
      id: "tbl",
      caption: "c",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "4"],
        ["5", "6"],
      ],
    },
  ],
};
const ctx = {
  source,
  format: FORMATS["deck-16x9"] as Format,
  theme: ink,
  sid: "s1",
} as const;
const beat = (archetype: string, params: unknown) =>
  ({
    id: "b",
    archetype,
    weight: 0.8,
    seconds: 14,
    intent: "i",
    evidence: [],
    params,
  }) as unknown as Beat;

/** One beat per archetype, and the count the table promises for it. */
const CASES: [string, unknown, number][] = [
  ["title", { eyebrow: "E", headline: "H", sub: "s" }, 1],
  ["claim-figure", { eyebrow: "E", headline: "H", claim: "c", figureId: "fig" }, 2],
  [
    "equation-walk",
    {
      eyebrow: "E",
      headline: "H",
      equationId: "eq",
      terms: [
        { tex: "\\mathcal{E}", label: "a", tone: "a" },
        { tex: "\\mathcal{W}", label: "b", tone: "b" },
      ],
    },
    2, // one per term
  ],
  [
    "data-table",
    { eyebrow: "E", headline: "H", tableId: "tbl", highlight: [{ row: "1", tone: "a" }] },
    2, // one per highlight, plus 1
  ],
  [
    "line-chart",
    {
      eyebrow: "E",
      headline: "H",
      xLabel: "x",
      yLabel: "y",
      points: [0, 1, 2, 3].map((i) => ({ x: `T=${i}`, y: 20 + i })),
    },
    1,
  ],
  [
    "callout",
    {
      eyebrow: "E",
      headline: "H",
      panels: [
        { label: "p", lines: ["a"] },
        { label: "q", lines: ["b"] },
      ],
    },
    2, // one per panel
  ],
  [
    "pipeline",
    { eyebrow: "E", headline: "H", stages: [{ label: "A" }, { label: "B" }, { label: "C" }] },
    3, // one per stage — the prompt used to claim stages + 1
  ],
  [
    "annotated-figure",
    {
      eyebrow: "E",
      headline: "H",
      figureId: "fig",
      notes: [0, 1].map((i) => ({ x: 0.3 + i * 0.2, y: 0.7, text: `n${i}`, tone: "a" as const })),
    },
    3, // one per note, plus 1
  ],
  [
    "grid",
    {
      eyebrow: "E",
      headline: "H",
      cols: 8,
      rows: 6,
      regions: [0, 1].map((i) => ({
        x: i * 3,
        y: 0,
        w: 2,
        h: 2,
        label: `r${i}`,
        tone: "a" as const,
      })),
    },
    3, // one per region, plus 1
  ],
  [
    "bar-compare",
    {
      eyebrow: "E",
      headline: "H",
      unit: "u",
      bars: [1, 2, 3, 4, 5].map((v, i) => ({ label: `b${i}`, value: v })),
    },
    2, // TWO, whatever the bar count — the prompt used to claim bars + 1
  ],
  ["stack", { eyebrow: "E", headline: "H", layers: [1, 2, 3].map((i) => ({ label: `L${i}` })) }, 3],
  [
    "split-compare",
    {
      eyebrow: "E",
      headline: "H",
      left: { label: "L", lines: ["a", "b"] },
      right: { label: "R", lines: ["c", "d"] },
    },
    2,
  ],
];

describe("the prompt's reveal counts", () => {
  it.each(CASES)("%s has the number of stops the prompt promises", (archetype, params, want) => {
    expect(emitScene(beat(archetype, params), ctx).holds.length).toBe(want);
  });

  it("names every archetype the emitters implement", () => {
    // A new archetype with no row is a beat whose narration length nobody stated,
    // which is the defect this table exists to prevent.
    expect(Object.keys(REVEALS).sort()).toEqual(CASES.map(([a]) => a).sort());
  });

  it("puts the table in the prompt the planner actually receives", () => {
    const text = systemPrompt(prefsSchema.parse({}));
    for (const archetype of Object.keys(REVEALS)) expect(text).toContain(archetype);
    expect(text).toContain("2, however many bars there are");
    // The sentence that was wrong for most archetypes must be gone.
    expect(text).not.toContain("four stages wants five sentences");
  });
});

/**
 * The block is an exception to RULE 2 and to the inventory's "(none — no
 * claim-figure beat is possible)". An exception that is sent when it does not
 * apply is a prompt with two answers, so presence is gated and pinned here.
 */
describe("the prompt's illustrations block", () => {
  it("is absent unless images are on, and leaves the prompt byte-identical", () => {
    const off = systemPrompt(prefsSchema.parse({}));
    expect(off).not.toContain("ILLUSTRATIONS");
    // Every other image preference is inert while the switch is off: a style or
    // a cap in the config file must not change what a deck without pictures says.
    expect(
      systemPrompt(prefsSchema.parse({ images: { enabled: false, style: "woodcut", max: 9 } })),
    ).toBe(off);
    expect(systemPrompt(prefsSchema.parse({ images: { enabled: true } }))).toContain(
      "ILLUSTRATIONS",
    );
  });

  it("states the cap from the preference, and what a brief may and may not ask for", () => {
    const on = systemPrompt(prefsSchema.parse({ images: { enabled: true, max: 3 } }));
    expect(on).toMatch(/At most 3 pictures/);
    expect(on).toContain("illustration: { prompt, caption }");
    // The two slots that can carry one, and the case the inventory line denies.
    expect(on).toMatch(/claim-figure, or either side of a split-compare/);
    expect(on).toMatch(/no figures at\s+all/);
    // A picture is a scene, never something to read; and it is never evidence.
    expect(on).toMatch(/text, labels, numbers, charts or diagrams/);
    expect(on).toMatch(/not evidence/);
  });
});

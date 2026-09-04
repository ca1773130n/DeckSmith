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
import { REVEALS, renderSource, systemPrompt } from "../src/plan/prompt.js";
import type { Beat, Format, Source } from "../src/types.js";
import { beatSchema, FORMATS, prefsSchema } from "../src/types.js";

const source: Source = {
  id: "s",
  title: "t",
  lang: "en",
  sections: [{ id: "sec", depth: 1, heading: "H", text: "t" }],
  figures: [{ id: "fig", src: "f.jpg", caption: "c", width: 1000, height: 600 }],
  equations: [
    { id: "eq", tex: "y = \\mathcal{E}(x) + \\mathcal{W}(z)", display: true },
    { id: "eq2", tex: "y - \\mathcal{W}(z) = \\mathcal{E}(x)", display: true },
  ],
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
    "equation-morph",
    {
      eyebrow: "E",
      headline: "H",
      fromId: "eq",
      toId: "eq2",
      terms: [{ tex: "\\mathcal{E}(x)", label: "a", tone: "a" }],
    },
    2, // the first line, then the second
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

  /**
   * The prompt COUNTS ITSELF, and the count was wrong the moment a thirteenth
   * archetype landed: the header still said TWELVE while thirteen were listed
   * below it, so the planner was told the list was shorter than the list it
   * was given. Prose about a set, sitting beside the set, is the same defect
   * the REVEALS table above exists to prevent — so it is checked the same way,
   * against the schema rather than against a reader's memory.
   */
  it("states its own archetype count, and the drawing/describing split, correctly", () => {
    const WORDS = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
      "twenty",
    ];
    const text = systemPrompt(prefsSchema.parse({}));
    const archetypes = new Set(beatSchema.options.map((o) => o.shape.archetype.value));

    // The two sections, and the archetype each names in its left-hand column.
    // A name may sit alone on its line: `annotated-figure` is too long for the
    // column, so its description starts on the next one.
    const section = (from: string, to: string): string[] => {
      const body = text.slice(text.indexOf(from) + from.length, text.indexOf(to));
      return [...body.matchAll(/^ {2}([a-z][a-z-]+)(?: +\S.*)?$/gm)]
        .map((m) => m[1] as string)
        .filter((name) => archetypes.has(name as never));
    };
    const drawing = section("DRAWING ARCHETYPES", "DESCRIBING ARCHETYPES");
    const describing = section("DESCRIBING ARCHETYPES", "RULES");

    // Every archetype is described exactly once, in exactly one section.
    expect([...drawing, ...describing].sort()).toEqual([...archetypes].sort());

    // And the prose agrees with what is under it. Both counts open a sentence,
    // so both are capitalised.
    const cap = (n: number) => (WORDS[n] as string).replace(/^./, (c) => c.toUpperCase());
    expect(text).toContain(`THE ${(WORDS[archetypes.size] as string).toUpperCase()} ARCHETYPES`);
    expect(text).toContain(`${cap(drawing.length)} of them DRAW`);
    expect(text).toContain(`${cap(describing.length)} only\ndescribe`);
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
 * What the model is told about a picture it cannot see.
 *
 * A caption says what a figure IS. Where it sat and what the prose said about it
 * are the only evidence available for what it is FOR, which is the question the
 * planner was answering badly: shown a size and a caption, a real run redrew the
 * architecture as a synthetic pipeline and left the architecture figure unused.
 */
describe("the figure inventory", () => {
  const paper = (figures: Source["figures"]): Source => ({
    id: "s",
    title: "t",
    lang: "en",
    sections: [
      { id: "sec1", depth: 1, heading: "The mismatch", text: "Compact against dense." },
      { id: "sec2", depth: 2, heading: "Method", text: "Figure 2 shows one tick." },
    ],
    figures,
    equations: [],
    tables: [],
  });
  const arch = {
    id: "fig-arch",
    src: "a.jpg",
    caption: "Figure 2 — One tick.",
    width: 1373,
    height: 381,
  };

  it("states the count, and gives each figure its section and its prose", () => {
    const text = renderSource(
      paper([arch, { ...arch, id: "fig-err", caption: "Figure 5 — Error maps." }]),
    );

    expect(text).toContain("2 figures in this document.");
    // The id stays verbatim and next to the caption: RULE 2 and
    // `assertRefsResolve` both depend on the model having seen it exactly.
    expect(text).toContain("[figure fig-arch] 1373x381 — Figure 2 — One tick.");
  });

  it("names the section a figure sits under, by id and by heading", () => {
    const text = renderSource(paper([{ ...arch, sectionId: "sec2" }]));
    expect(text).toContain("1 figure in this document.");
    expect(text).toContain("under: [section sec2] Method");
  });

  it("carries the sentence the document refers to it with", () => {
    const text = renderSource(paper([{ ...arch, mention: "Figure 2 shows one tick." }]));
    expect(text).toContain("the document says: Figure 2 shows one tick.");
  });

  it("clips a mention rather than reprinting a section it already printed", () => {
    // The paragraph is in `== DOCUMENT ==` above in full; what is worth paying
    // for here is proximity to the id, not a second copy of the prose.
    const long = `${"word ".repeat(120)}end`;
    const text = renderSource(paper([{ ...arch, mention: long }]));
    const line = text.split("\n").find((l) => l.includes("the document says:")) ?? "";

    expect(line.length).toBeLessThan(340);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toContain("end");
  });

  it("still tells a figure-less source that no figure beat is possible", () => {
    // The line the ILLUSTRATIONS block below is the one exception to.
    const text = renderSource(paper([]));
    expect(text).toContain("(none — no annotated-figure or claim-figure beat is possible)");
    expect(text).not.toContain("figures in this document");
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

/**
 * The catalogue the planner picks from, and whether it can tell the entries apart.
 *
 * Selection is a MEASURED failure here, not a worry: across sixty-five stored
 * beats one archetype took nineteen, and `annotated-figure.crop` — the one
 * parameter that makes two beats off the same figure look like two slides — was
 * set in two of forty-two. Both are what a catalogue of look-alike entries
 * produces, so what is pinned is that each entry says what it is INSTEAD of.
 */
describe("the archetype catalogue", () => {
  const text = systemPrompt(prefsSchema.parse({}));

  it("gives every archetype a tell", () => {
    // Twelve entries, twelve tells. A row with no tell is a row the model picks
    // by name, and the names all sound equally plausible.
    expect(text.match(/The\s+tell:/g)?.length).toBe(Object.keys(REVEALS).length);
  });

  it("says what each drawing archetype is NOT, so its neighbours are separable", () => {
    // The confusable pairs, each named in the entry it would be mistaken for.
    expect(text).toMatch(
      /hand anything to each other but sit\s+one on top of another, that is stack/,
    );
    expect(text).toMatch(/ON\s+TOP OF, not THEN, which is what makes it not a pipeline/);
    expect(text).toMatch(/steps along an\s+axis rather than names[^.]*that\s+is line-chart/);
    expect(text).toMatch(/two numbers in one unit, that is bar-compare with two bars/);
    expect(text).toMatch(/for a region of a real image, that is\s+annotated-figure with a `crop`/);
  });

  it("names annotated-figure.crop where annotated-figure is described", () => {
    // Used in 2 of 42 stored beats. It was documented in the schema and nowhere
    // in the text the planner is actually sent, so the planner never saw it.
    expect(text).toContain("USE `crop` — { x, y, w, h }");
    expect(text).toMatch(/about\s+ONE REGION rather than a whole page/);
  });

  it("briefs the title archetype's eyebrow and sub instead of calling them optional", () => {
    // They were named once, as "optional eyebrow and subtitle", and a field named
    // once with no brief is a field that gets written once with no thought.
    expect(text).not.toContain("optional eyebrow and subtitle");
    expect(text).toMatch(/`eyebrow` PLACES THE WORK/);
    expect(text).toMatch(
      /`sub` states, in ONE line, the problem the work attacks or the\s+claim it lands/,
    );
  });

  /**
   * MEASURED: a 38k-character document with SEVEN tables was planned twice and
   * cited none of them, taking bar-compare four times instead. Three sentences
   * caused it, and all three were true — bar-compare said to prefer it "whenever
   * the numbers share a unit", data-table said one column of numbers "is
   * bar-compare", and data-table's own entry then warned that a table which does
   * not fit "fails the build". Choosing the archetype was the risky move, so the
   * model rationally did not. The tables were decision matrices of text values,
   * which is what data-table describes itself as being for.
   */
  it("separates bar-compare from data-table by what the viewer does, not by unit", () => {
    // Each states its own side once. Neither tells the model to prefer the other.
    expect(text).toMatch(/bar-compare[\s\S]*?MAGNITUDES THE EYE COMPARES/);
    expect(text).toMatch(/data-table[\s\S]*?CELLS THAT MUST BE READ RATHER THAN\s+COMPARED/);
    expect(text).not.toContain("use this\n                 rather than data-table");
    expect(text).not.toMatch(/one column of\s+numbers in one unit, that is bar-compare/);
  });

  it("answers a table longer than a slide with the subset rather than with bar-compare", () => {
    // The escape that produced zero cited tables. Its replacement has to be in
    // the text the planner is sent, or the parameter is one only the schema
    // knows about — which is how `annotated-figure.crop` came to be used twice
    // in forty-two beats.
    expect(text).not.toContain("cannot show a subset");
    expect(text).not.toMatch(/For a longer one, take the\s+column that carries the argument/);
    expect(text).toMatch(/SO NAME THE ROWS THAT CARRY THE ARGUMENT, in `rows`/);
    expect(text).toMatch(/states on itself how many it\s+left out/);
    // The refusal is still stated — ONCE, as this file's own rule requires — and
    // now as the case where neither the whole table nor the subset fits. (RULE 2
    // says a dangling id "fails the build" too; that is a different constraint,
    // so what is counted here is this one's own words.)
    expect(text.match(/refused rather than shrunk/g)?.length).toBe(1);
    expect(text.match(/five to seven of/g)?.length).toBe(1);
    expect(text).toMatch(/fits neither\s+whole nor as the rows you named is refused/);
  });

  it("forbids reaching for the same shape twice running", () => {
    expect(text).toMatch(/Do not use the same archetype for two beats in a row/);
    expect(text).toMatch(/take the family this deck has\s+not used yet/);
  });
});

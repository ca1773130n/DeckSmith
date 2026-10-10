/**
 * Section coverage and the literal-scene checks (src/plan/coverage.ts), and the
 * repair round that enforces them (src/plan/codex.ts).
 *
 * The fixture is the shape of the analysis that exposed the gap: a hypepaper
 * Q-template with Q4's experiments split into subsections and the limits (Q8)
 * after the summary (Q6) in the source — so the deck's order is NOT the
 * source's order.
 */
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { codexPlanner, schemaFor } from "../src/plan/codex.js";
import {
  coverageFindings,
  literalFindings,
  partOfHeading,
  sourceParts,
} from "../src/plan/coverage.js";
import { LITERAL_KIND_DOCS, sourceBlocks } from "../src/plan/prompt.js";
import { LITERAL_KIND_NAMES, prefsSchema, sourceSchema, storyboardSchema } from "../src/types.js";

const analysis = sourceSchema.parse({
  id: "emsnn",
  title: "EM-SNN: Spiking Dehazing",
  lang: "ko",
  sections: [
    { id: "sec1", depth: 1, heading: "EM-SNN: Spiking Dehazing", text: "" },
    {
      id: "sec2",
      depth: 2,
      heading: "Q1: 이 논문은 어떤 문제를 해결하려고 하는가?",
      text: "안개가 대비를 낮춘다.",
    },
    {
      id: "sec3",
      depth: 2,
      heading: "Q2: 어떤 관련 연구가 있는가?",
      text: "Dark Channel Prior (DCP).",
    },
    {
      id: "sec4",
      depth: 2,
      heading: "Q3: 논문은 이 문제를 어떻게 해결하는가?",
      text: "TM-LIF와 SSM.",
    },
    { id: "sec5", depth: 2, heading: "Q4: 논문에서는 어떤 실험을 수행했는가?", text: "" },
    { id: "sec6", depth: 3, heading: "데이터셋, 설정 및 지표", text: "LHID, DHID." },
    {
      id: "sec7",
      depth: 3,
      heading: "보고된 표의 정량적 비교",
      text: "LHID: 30.56 PSNR 및 0.9106 SSIM.",
    },
    { id: "sec9", depth: 2, heading: "Q5: 어떤 점을 더 탐구할 수 있는가?", text: "에너지 측정." },
    { id: "sec10", depth: 2, heading: "Q6: 논문의 주요 내용을 요약하라", text: "요약." },
    {
      id: "sec11",
      depth: 2,
      heading: "Q8: 이 논문의 한계는 무엇이며, 결과가 일반화되지 않을 수 있는 영역은 어디인가?",
      text: "한계.",
    },
  ],
  figures: [{ id: "gen-b02", src: "gen-b02.png", caption: "aerial", width: 1536, height: 1024 }],
  equations: [],
  tables: [],
});

const sec = (id: string) => ({ kind: "section", id });
/** Three shapes in turn, by beat number, so no plan here trips the variety rule. */
const SHAPES = [
  { archetype: "kinetic", params: { headline: "k", phrases: [{ text: "a" }, { text: "b" }] } },
  { archetype: "hero-number", params: { headline: "h", value: "4", label: "x" } },
  { archetype: "callout", params: { headline: "c", panels: [{ label: "p", lines: ["l"] }] } },
];
const beatOf = (id: string, part: string | undefined, cites: string[], extra = {}) => ({
  id,
  intent: id,
  ...(part ? { part } : {}),
  takeaway: `${id} takeaway`,
  evidence: cites.map(sec),
  ...SHAPES[Number(id.slice(1, 3)) % SHAPES.length],
  ...extra,
});
const title = {
  id: "b00-title",
  intent: "title",
  evidence: [sec("sec2")],
  archetype: "title",
  params: { headline: "EM-SNN" },
};

/** A plan that covers every part, in deck order (limits before summary). */
const covered = () => [
  title,
  {
    id: "b01-problem",
    intent: "haze",
    part: "intro",
    takeaway: "haze fades edges",
    evidence: [sec("sec2")],
    archetype: "stage",
    params: {
      headline: "haze",
      placement: "bottom-left",
      figureId: "gen-b02",
    },
    literal: { kind: "haze", picture: "b01-problem" },
  },
  beatOf("b02-prior", "prior-work", ["sec3"]),
  beatOf("b03-method", "method", ["sec4"], {
    literal: {
      kind: "spikes",
      picture: "b01-problem",
      labels: [{ slot: "threshold", text: "임계값" }],
    },
  }),
  beatOf("b04-setup", "experiments", ["sec6"]),
  beatOf("b05-results", "experiments", ["sec7"], {
    literal: {
      kind: "table",
      columns: ["", "PSNR", "SSIM"],
      rows: [["LHID", "30.56", "0.9106"]],
      highlight: [0],
    },
  }),
  beatOf("b06-future", "limits", ["sec9"]),
  beatOf("b07-limits", "limits", ["sec11"]),
  beatOf("b08-summary", "summary", ["sec10"], {
    literal: { kind: "recap", beats: ["b01-problem", "b03-method"] },
  }),
];
const plan = (beats: unknown[]) =>
  storyboardSchema.parse({ sourceId: "emsnn", title: "EM-SNN", beats });

describe("detecting a source's parts from its headings", () => {
  it("reads the hypepaper template in Korean and English, the specific part winning", () => {
    expect(partOfHeading("Q1: 이 논문은 어떤 문제를 해결하려고 하는가?")).toBe("intro");
    expect(partOfHeading("Q3: 논문은 이 문제를 어떻게 해결하는가?")).toBe("method");
    expect(
      partOfHeading(
        "Q8: 이 논문의 한계는 무엇이며, 결과가 일반화되지 않을 수 있는 영역은 어디인가?",
      ),
    ).toBe("limits");
    expect(partOfHeading("Q1: What problem does this paper try to solve?")).toBe("intro");
    expect(partOfHeading("Q3: How does the paper solve this problem?")).toBe("method");
    expect(partOfHeading("Q5: What can be explored further?")).toBe("limits");
    expect(partOfHeading("Related Work")).toBe("prior-work");
    expect(partOfHeading("Conclusion and Future Work")).toBe("summary");
    expect(partOfHeading("Cost")).toBeUndefined();
  });

  it("lists the parts in deck order, subsections inheriting their parent's part", () => {
    expect(sourceParts(analysis).map((p) => [p.part, p.sections.map((s) => s.id)])).toEqual([
      ["intro", ["sec2"]],
      ["prior-work", ["sec3"]],
      ["method", ["sec4"]],
      // sec5 has no text of its own: it is covered by covering its subsections.
      ["experiments", ["sec6", "sec7"]],
      // Q5 and Q8 are one part, and it comes BEFORE the summary although Q8 is after Q6.
      ["limits", ["sec9", "sec11"]],
      ["summary", ["sec10"]],
    ]);
  });

  it("is off for a document that is not an analysis", () => {
    const plain = sourceSchema.parse({
      ...analysis,
      sections: [
        { id: "a", depth: 1, heading: "Introduction", text: "x" },
        { id: "b", depth: 2, heading: "Cost", text: "y" },
        { id: "c", depth: 2, heading: "Limits", text: "z" },
      ],
    });
    expect(sourceParts(plain)).toEqual([]);
    expect(coverageFindings(plan([title]), plain)).toEqual([]);
  });
});

describe("coverageFindings", () => {
  it("passes a plan covering every part and section in order", () => {
    expect(coverageFindings(plan(covered()), analysis)).toEqual([]);
  });

  it("names a missing part and its sections, and the title slide does not count as the problem", () => {
    const beats = covered().filter((b) => b.id !== "b02-prior" && b.id !== "b01-problem");
    const found = coverageFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/prior work \(\[section sec3\] Q2: .*no beat covers it/),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/introduction.*\[section sec2\].*no beat covers it/),
    );
  });

  it("names a section of a covered part that no beat cites", () => {
    const beats = covered().filter((b) => b.id !== "b04-setup");
    expect(coverageFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/No "experiments" beat cites \[section sec6\]/),
    ]);
  });

  it("refuses the source's order where it is not the deck's: summary before limits", () => {
    const beats = covered();
    const summary = beats.pop();
    beats.splice(6, 0, summary as (typeof beats)[number]);
    expect(coverageFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(
        /b06-future \(part "limits"\) comes after b08-summary \(part "summary"\)/,
      ),
    ]);
  });

  it("refuses a beat with no part, and a part its evidence contradicts", () => {
    const beats = covered();
    beats[2] = beatOf("b02-prior", undefined, ["sec3"]);
    beats[3] = beatOf("b03-method", "method", ["sec3"]);
    const found = coverageFindings(plan(beats), analysis);
    expect(found).toContainEqual(expect.stringMatching(/b02-prior carry no `part`/));
    expect(found).toContainEqual(
      expect.stringMatching(/b03-method is part "method" but cites only prior-work/),
    );
  });
});

describe("literalFindings", () => {
  it("passes a plan whose literal beats resolve", () => {
    expect(literalFindings(plan(covered()), analysis, { takeaways: true })).toEqual([]);
  });

  it("refuses a picture on a later beat, or on a beat with no picture", () => {
    const beats = covered();
    beats[1] = {
      ...(beats[1] as object),
      literal: { kind: "haze", picture: "b03-method" },
    } as never;
    beats[3] = beatOf("b03-method", "method", ["sec4"], {
      literal: { kind: "sobel", picture: "b02-prior" },
    });
    const found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(expect.stringMatching(/b01-problem's haze .*a later beat/));
    expect(found).toContainEqual(
      expect.stringMatching(/b03-method's sobel .*"b02-prior", which has none/),
    );
  });

  it("refuses a table number the source never states, and a row it does not have", () => {
    const beats = covered();
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: { kind: "table", columns: ["PSNR"], rows: [["30.56"], ["31.20"]], highlight: [2] },
    });
    const found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/shows "31.20", which the source never states/),
    );
    expect(found).toContainEqual(expect.stringMatching(/highlights row 2/));
  });

  it("refuses a recap of a beat that is not an earlier literal scene", () => {
    const beats = covered();
    beats[8] = beatOf("b08-summary", "summary", ["sec10"], {
      literal: { kind: "recap", beats: ["b04-setup"] },
    });
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/recap names "b04-setup"/),
    ]);
  });

  it("asks for a takeaway on every beat but the title, only when asked to", () => {
    const beats = covered();
    beats[2] = { ...(beats[2] as object), takeaway: " " } as never;
    expect(literalFindings(plan(beats), analysis)).toEqual([]);
    expect(literalFindings(plan(beats), analysis, { takeaways: true })).toEqual([
      expect.stringMatching(/Beats b02-prior carry no `takeaway`/),
    ]);
  });
});

describe("what the planner is shown", () => {
  const v2 = prefsSchema.parse({ design: "v2" });
  const classic = prefsSchema.parse({});

  it("offers `part` only for a source with parts, and `takeaway`/`literal` only when scenes are drawn", () => {
    expect(JSON.stringify(schemaFor(classic, analysis))).toContain('"part"');
    expect(JSON.stringify(schemaFor(classic))).not.toContain('"part"');
    expect(JSON.stringify(schemaFor(classic, analysis))).not.toContain('"takeaway"');
    expect(JSON.stringify(schemaFor(classic, analysis))).not.toContain('"literal"');
    const json = JSON.stringify(schemaFor(v2, analysis));
    for (const k of LITERAL_KIND_NAMES) expect(json).toContain(`"${k}"`);
    expect(json).toContain('"takeaway"');
  });

  it("names every part with its sections, in deck order, and documents every literal kind", () => {
    const block = sourceBlocks(analysis, v2);
    const at = (s: string) => block.indexOf(s);
    expect(at("SECTION COVERAGE")).toBeGreaterThan(-1);
    expect(at("[section sec11]")).toBeLessThan(at("[section sec10]"));
    expect(at("  intro")).toBeLessThan(at("  prior-work"));
    expect(Object.keys(LITERAL_KIND_DOCS).sort()).toEqual([...LITERAL_KIND_NAMES].sort());
    for (const k of LITERAL_KIND_NAMES) expect(block).toContain(`  ${k} `);
    expect(sourceBlocks(analysis, classic)).not.toContain("LITERAL SCENES");
  });
});

describe("codexPlanner coverage repair", () => {
  const body = (beats: unknown[]) => JSON.stringify({ sourceId: "emsnn", title: "EM-SNN", beats });
  const missing = covered().filter((b) => b.id !== "b02-prior");
  // Variety is not what this tests: a short deck under no picture rules.
  const prefs = prefsSchema.parse({ slides: 5 });

  it("sends a plan missing a part back once, naming it, and keeps a repair that adds it", async () => {
    const prompts: string[] = [];
    const result = await codexPlanner(analysis, {
      prefs,
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, body(prompts.length === 1 ? missing : covered()));
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("SECTION COVERAGE");
    expect(prompts[1]).toContain("DOES NOT COVER THE SOURCE");
    expect(prompts[1]).toMatch(/prior work \(\[section sec3\]/);
    expect(prompts[1]).not.toContain("BREAKS THE VARIETY RULES");
    expect(result.beats.map((b) => b.part ?? "-")).toContain("prior-work");
  });

  it("fails loudly when the repair still misses it", async () => {
    let calls = 0;
    await expect(
      codexPlanner(analysis, {
        prefs,
        run: async ({ outPath }) => {
          calls++;
          await writeFile(outPath, body(missing));
        },
      }),
    ).rejects.toThrow(/does not cover the source .* after one repair:\n.*prior work/s);
    expect(calls).toBe(2);
  });
});

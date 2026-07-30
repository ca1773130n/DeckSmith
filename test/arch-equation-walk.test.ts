import { describe, expect, it } from "vitest";
import { equationWalk } from "../src/emit/archetypes/equation-walk.js";
import { ink } from "../src/emit/themes/index.js";
import type { BeatOf, Format, Source, Term } from "../src/types.js";
import { FORMATS } from "../src/types.js";

describe("equation-walk term matching", () => {
  const src = (tex: string): Source => ({
    id: "s",
    title: "t",
    lang: "en",
    sections: [],
    figures: [],
    equations: [{ id: "eq", tex, display: true }],
    tables: [],
  });
  const at = (tex: string) => ({
    source: src(tex),
    format: FORMATS["deck-16x9"] as Format,
    theme: ink,
    sid: "s1",
  });
  const walk = (terms: Term[]) =>
    ({
      id: "b12-loss",
      archetype: "equation-walk",
      weight: 0.8,
      seconds: 12,
      intent: "i",
      evidence: [],
      params: { eyebrow: "E", headline: "H", equationId: "eq", terms },
    }) as BeatOf<"equation-walk">;
  const norm = { tex: "\\|\\cdot\\|_1", label: "L1 norm", tone: "a" } as Term;
  const counts = (tex: string, terms: Term[]) => {
    const scene = equationWalk(walk(terms), at(tex));
    const all = (scene.setup ?? []).join(" ") + scene.html;
    return {
      wrapped: (all.match(/htmlClass\{term t-[a-d]\}/g) ?? []).length,
      legend: (all.match(/class="leg"/g) ?? []).length,
    };
  };

  // A whole deck died at the last stage on the first of these: the planner wrote
  // the norm the way a person writes it and the equation carried LaTeX's sizing
  // hints, so a literal substring test said "does not occur".
  it.each([
    ["\\left\\|\\cdot\\right\\|_1 sizing hints", "\\mathcal{L} = \\left\\|\\cdot\\right\\|_1"],
    ["whitespace", "\\mathcal{L} = \\| \\cdot \\|_1"],
    ["lVert/rVert spelling", "\\mathcal{L} = \\lVert\\cdot\\rVert_1"],
  ])("finds a term written as %s", (_name, tex) => {
    expect(counts(tex, [norm]).wrapped).toBe(1);
  });

  it("drops a term it cannot place, and its legend row with it", () => {
    const c = counts("y = \\mathcal{E}(x)", [
      { tex: "\\mathcal{E}", label: "encoder", tone: "a" },
      { tex: "\\zeta", label: "nowhere", tone: "b" },
    ]);
    // Never a legend line pointing at a symbol that was not highlighted — that
    // is the failure this archetype exists to avoid. A shorter legend is fine.
    expect(c).toEqual({ wrapped: 1, legend: 1 });
  });

  it("still refuses a beat where nothing matches, and quotes the equation", () => {
    expect(() => counts("y = x", [{ tex: "\\zeta", label: "no", tone: "a" }])).toThrow(
      /none of its 1 term\(s\) occur.*Equation/s,
    );
  });
});

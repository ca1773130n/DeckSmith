import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { equationWalk } from "../src/emit/archetypes/equation-walk.js";
import { texError } from "../src/emit/tex.js";
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
    start: 0,
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

  it("says which term it dropped, instead of shortening the legend in silence", () => {
    const scene = equationWalk(
      walk([
        { tex: "\\mathcal{E}", label: "encoder", tone: "a" },
        { tex: "\\zeta", label: "nowhere", tone: "b" },
      ]),
      at("y = \\mathcal{E}(x)"),
    );
    expect(scene.warnings).toEqual([
      expect.stringMatching(/"\\\\zeta" does not occur in eq.*"nowhere"/),
    ]);
  });
});

/**
 * Every TeX string the scene hands `katex.render` at parse time, unescaped back
 * from the JavaScript literal it was written as — i.e. what the browser parses.
 */
function rendered(setup: readonly string[]): string[] {
  return setup.flatMap((line) =>
    [...line.matchAll(/katex\.render\('((?:[^'\\]|\\.)*)'/g)].map((m) =>
      (m[1] as string).replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c)),
    ),
  );
}

/**
 * THE BEATS THAT KILLED REAL DECKS. Each case is an `equation-walk` beat copied
 * verbatim from a HypePaper deck that failed `verify` with a KaTeX ParseError
 * between 2026-10-03 and 2026-10-07 (test/fixtures/hypepaper-math.json says which
 * run). The equations themselves parsed; DeckSmith's own term wrapping broke them,
 * except for the paper macro, which the source never defined.
 */
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/hypepaper-math.json", import.meta.url)), "utf8"),
) as {
  cases: {
    kind: string;
    deck: string;
    beat: string;
    equation: { id: string; tex: string; display: boolean };
    terms: Term[];
  }[];
};
const parseFailures = fixture.cases.filter((c) =>
  ["right_swallowed", "left_outside", "bare_superscript", "undefined_macro"].includes(c.kind),
);

describe("equation-walk on the beats that failed HypePaper's verify", () => {
  const scene = (c: (typeof parseFailures)[number]) =>
    equationWalk(
      {
        id: c.beat,
        archetype: "equation-walk",
        weight: 0.8,
        seconds: 12,
        intent: "i",
        evidence: [],
        params: { headline: "H", equationId: c.equation.id, terms: c.terms },
      } as BeatOf<"equation-walk">,
      {
        source: {
          id: "s",
          title: "t",
          lang: "en",
          sections: [],
          figures: [],
          equations: [c.equation],
          tables: [],
        },
        format: FORMATS["deck-16x9"] as Format,
        theme: ink,
        sid: "s1",
        start: 0,
      },
    );

  it("has the cases it claims to", () => {
    expect(parseFailures.map((c) => c.kind).sort()).toEqual([
      "bare_superscript",
      "left_outside",
      "left_outside",
      "right_swallowed",
      "right_swallowed",
      "right_swallowed",
      "undefined_macro",
    ]);
  });

  it.each(parseFailures.map((c) => [`${c.kind} ${c.deck.slice(0, 8)} ${c.beat}`, c] as const))(
    "%s: every TeX string handed to KaTeX parses, and every term is still highlighted",
    (_name, c) => {
      const s = scene(c);
      const texs = rendered(s.setup ?? []);
      // One display plus one chip per term: nothing was skipped to get here.
      expect(texs).toHaveLength(1 + c.terms.length);
      for (const tex of texs) expect(texError(tex, !texs.indexOf(tex)), tex).toBeNull();
      expect(s.html.match(/class="leg"/g)).toHaveLength(c.terms.length);
      expect((texs[0] as string).match(/\\htmlClass\{term t-/g)).toHaveLength(c.terms.length);
    },
  );

  // The span ended at the NEXT normalised character, which is past a `\right`
  // folded away in between: `\htmlClass{term t-c}{... (o_{t+H}) \right}`.
  it("does not carry a \\right into the term before it", () => {
    const c = parseFailures.find((x) => x.deck.startsWith("f2a0f316")) as (typeof parseFailures)[0];
    const display = rendered(scene(c).setup ?? [])[0] as string;
    expect(display).toContain("\\htmlClass{term t-c}{\\text{Enc}_{\\text{ViT}}(o_{t+H})}");
    expect(display).toContain("\\right\\|^2_2");
  });

  // The term opened on a sized delimiter and the span started after the size:
  // `\left\htmlClass{term t-b}{|\hat{D}_p ...`.
  it("takes the \\left with a term that opens on the delimiter it sizes", () => {
    const c = parseFailures.find((x) => x.deck.startsWith("dcb6d8c4")) as (typeof parseFailures)[0];
    const display = rendered(scene(c).setup ?? [])[0] as string;
    expect(display).toContain("\\htmlClass{term t-b}{\\left|\\hat{D}_p-D^{\\text{gt}}_p\\right|}");
  });

  // `\}^\alpha` wrapped bare is a superscript with no argument.
  it("groups a term that is a one-token superscript", () => {
    const c = parseFailures.find((x) => x.kind === "bare_superscript") as (typeof parseFailures)[0];
    expect(rendered(scene(c).setup ?? [])[0]).toContain("^{\\htmlClass{term t-c}{\\alpha}}");
  });

  // 1.16 on a 600px term is 48px a side over its neighbours (deck 0ef77cae's
  // `G_\theta(...)` covered the `\big\|` and the minus). The scale is measured.
  it("swells each term by the amount its measured width allows, not by a constant", () => {
    const c = parseFailures[0] as (typeof parseFailures)[0];
    const s = scene(c);
    expect(s.measure?.join("\n")).toContain("var dsSwell");
    const swells = s.tl.filter((t) => t.target.includes(" .t-") && "scale" in t.to);
    expect(swells.length).toBeGreaterThan(0);
    for (const t of swells) {
      const to = t.to.scale as { __raw?: string } | number;
      const from = t.from.scale as { __raw?: string } | number;
      expect(
        [to, from].some((v) => typeof v === "object" && /^dsSwell\.[a-d]$/.test(v.__raw ?? "")),
      ).toBe(true);
      expect([to, from]).not.toContain(1.16);
    }
  });

  it("draws an undefined paper macro as its name, and says so", () => {
    const c = parseFailures.find((x) => x.kind === "undefined_macro") as (typeof parseFailures)[0];
    const s = scene(c);
    expect(rendered(s.setup ?? [])[0]).toContain("\\htmlClass{term t-b}{\\operatorname{raydir}}");
    expect(s.warnings).toEqual([
      expect.stringMatching(/\\raydir, \\camerarot, \\cameraint, \\pixelcoord are never defined/),
    ]);
  });
});

describe("equation-walk over an equation KaTeX refuses even repaired", () => {
  // A double superscript has no repair that keeps its meaning.
  const tex = "y = x^a^b + z";
  const scene = equationWalk(
    {
      id: "b3",
      archetype: "equation-walk",
      weight: 0.8,
      seconds: 9,
      intent: "i",
      evidence: [],
      params: {
        headline: "H",
        equationId: "eq",
        terms: [{ tex: "z", label: "the rest", tone: "a" }],
      },
    } as BeatOf<"equation-walk">,
    {
      source: {
        id: "s",
        title: "t",
        lang: "en",
        sections: [],
        figures: [],
        equations: [{ id: "eq", tex, display: true }],
        tables: [],
      },
      format: FORMATS["deck-16x9"] as Format,
      theme: ink,
      sid: "s1",
      start: 0,
    },
  );

  it("shows the source as plain text, with the term still marked for the walk", () => {
    expect(scene.html).toContain(
      '<div class="eq eq-plain" id="s1-eq" style="font-size:48px">y = x^a^b + <span class="term t-a">z</span></div>',
    );
    // Only the chip goes through KaTeX; the display never does, so nothing throws.
    expect(rendered(scene.setup ?? [])).toEqual(["z"]);
  });

  it("says it did, with KaTeX's reason and the formula", () => {
    expect(scene.warnings).toEqual([
      expect.stringMatching(
        /eq does not parse even after repair \(.*Double superscript.*\).*plain text/,
      ),
    ]);
  });
});

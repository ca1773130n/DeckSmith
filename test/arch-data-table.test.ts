/**
 * The subset, and the sentence that keeps it honest.
 *
 * This archetype went unused on the documents it was built for. A real 38k
 * paper with SEVEN tables was planned twice and cited none of them, because
 * every long table was a build failure waiting to happen and the prompt said so.
 * `params.rows` is the answer, and it introduces the one failure this file
 * exists to prevent: a slide that shows four of twenty rows and does not say so
 * is well-formed, passes `lint`, `check`, the type floor and `drift`, and
 * misrepresents its source. Six recorded cases in this project of green gates
 * over wrong output; this would have been the seventh.
 *
 * The row-count boundaries themselves are swept in `test/archetypes.test.ts` and
 * not repeated here.
 */
import { describe, expect, it } from "vitest";
import { dataTable } from "../src/emit/archetypes/data-table.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { MIN_FONT } from "../src/emit/svg.js";
import { REVEALS } from "../src/plan/prompt.js";
import type { BeatOf, Format, Source, Table } from "../src/types.js";
import { TYPE_FLOOR_PX } from "../src/verify/typefloor.js";

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

/** `options[i % n]`, without a non-null assertion. */
const cycle = (options: readonly string[], i: number): string => options[i % options.length] ?? "";

/**
 * The shape that goes uncited: twenty rows of text values, no column a
 * magnitude, nothing in it a bar could carry. Whole, it is refused at 16:9 —
 * the boundary there is seven or eight rows — which is exactly the position an
 * author is in with a real paper's comparison table.
 */
const NAMES = [
  "SRCNN",
  "FSRCNN",
  "VDSR",
  "LapSRN",
  "EDSR",
  "RCAN",
  "SAN",
  "HAN",
  "IGNN",
  "NLSA",
  "SwinIR",
  "ELAN",
  "CAT",
  "ART",
  "GRL",
  "DAT",
  "SRFormer",
  "HAT",
  "MambaIR",
  "DQ-CTM",
];

const MATRIX: Table = {
  id: "t-methods",
  caption: "Table 3 — Prior work by prior, supervision and cost.",
  columns: ["Method", "Prior", "Supervision", "Cost"],
  rows: NAMES.map((name, i) => [
    name,
    cycle(["none", "sparse", "deep", "learned"], i),
    cycle(["paired", "self"], i),
    cycle(["low", "medium", "high"], i),
  ]),
};

/** Short enough to draw whole, so the whole-table path can be checked against itself. */
const SHORT: Table = {
  id: "t-short",
  columns: ["Method", "Prior", "Cost"],
  rows: MATRIX.rows.slice(0, 4).map((row) => [row[0] ?? "", row[1] ?? "", row[3] ?? ""]),
};

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [MATRIX, SHORT],
};

const format: Format = {
  id: "deck-16x9",
  width: 1920,
  height: 1080,
  minWeight: 0,
  navigable: true,
};

const ctx = (sid = "s1"): EmitContext => ({ source, format, theme, sid });

type DataTable = BeatOf<"data-table">;

const beat = (params: DataTable["params"], seconds = 12): DataTable => ({
  id: "b1",
  intent: "i",
  evidence: [],
  weight: 0.5,
  seconds,
  archetype: "data-table",
  params,
});

/** The first-column value of every row the emitter actually drew, in draw order. */
const drawn = (html: string): string[] =>
  [...html.matchAll(/<tr class="trow"[^>]*><td>([^<]*)<\/td>/g)].map((m) => m[1] ?? "");

const FOUR = ["FSRCNN", "EDSR", "SwinIR", "DQ-CTM"];

/* ------------------------------------------------------------------- subset */

describe("a data-table drawing a subset", () => {
  const out = dataTable(
    beat({ headline: "Four of the twenty", tableId: "t-methods", rows: FOUR, highlight: [] }),
    ctx(),
  );

  it("draws the rows the beat named, and none of the rest", () => {
    expect(drawn(out.html)).toEqual(FOUR);
    // Not merely absent from the row list — absent from the slide, so nothing
    // downstream can read a row the viewer was never shown.
    expect(out.html).not.toContain("LapSRN");
  });

  it("keeps the source's row order rather than the order they were named", () => {
    // A table's row order is part of what the table says; the order the argument
    // wants is `highlight`'s job, and it has its own sequence.
    const reversed = dataTable(
      beat({
        headline: "Named backwards",
        tableId: "t-methods",
        rows: [...FOUR].reverse(),
        highlight: [],
      }),
      ctx(),
    );
    expect(drawn(reversed.html)).toEqual(FOUR);
  });

  it("states on the slide how many rows it left out", () => {
    // THE POINT OF THE FEATURE. Both counts, so the viewer can size the omission
    // rather than merely be told one happened.
    expect(out.html).toContain('<div class="rowomit" id="s1-omit">');
    expect(out.html).toContain("Showing 4 of 20 rows from the source table; 16 omitted.");
  });

  it("sets that line at or above the audience floor", () => {
    const size = Number((out.css ?? "").match(/\.rownote,\.rowomit\{font-size:(\d+)px/)?.[1]);
    // 40 is the floor and 40 passes: invariant 5 is inclusive, and the gate that
    // enforces it reads exactly this declaration.
    expect(size).toBeGreaterThanOrEqual(TYPE_FLOOR_PX);
    expect(TYPE_FLOOR_PX).toBe(MIN_FONT);
  });

  it("has the disclosure on screen before the first hold", () => {
    // A disclosure that arrives after the viewer has read the rows as the whole
    // story has already failed. It is tweened in with the head, and every frame
    // a presenter or a capture stops on is a hold.
    const fade = out.tl.find((t) => t.target === "#s1-omit");
    const at = fade?.at ?? Number.POSITIVE_INFINITY;
    const duration = Number(fade?.to.duration ?? 0);
    expect(at + duration).toBeLessThanOrEqual(out.holds[0] ?? 0);
    // fromTo, always — invariant 2. `from` is where it starts, not a capture.
    expect(fade?.from).toEqual({ opacity: 0 });
  });

  it("solves the type over the rows it draws, not the ones it dropped", () => {
    // A subset that leaves out the widest method name has narrower columns and
    // may be set larger. Solving against a row nobody sees would take the type
    // down for no one's benefit, which is the direction invariant 5 forbids.
    //
    // The long name is long enough to dominate the solve and short enough that
    // the WHOLE table still fits at the floor — it has to be, or `at()` with no
    // subset would hit the width refusal and this case would be testing that
    // instead of the thing it is about. Measured: the whole table solves to 47px
    // and needs 1460 of its 1700, the two-row subset solves to the 52px cap.
    const wide: Table = {
      id: "t-wide",
      columns: ["Method", "Prior", "Supervision", "Cost"],
      rows: [
        ["A considerably longer baseline method name", "none", "paired", "low"],
        ["EDSR", "none", "paired", "low"],
        ["RCAN", "deep", "self", "high"],
      ],
    };
    const at = (rows?: string[]): number =>
      Number(
        (
          dataTable(beat({ headline: "H", tableId: "t-wide", rows, highlight: [] }), {
            ...ctx(),
            source: { ...source, tables: [wide] },
          }).css ?? ""
        ).match(/table\{[^}]*font-size:(\d+)px/)?.[1],
      );
    expect(at(["EDSR", "RCAN"])).toBeGreaterThan(at());
  });

  it("takes no hold of its own, so the reveal count still matches the prompt", () => {
    // REVEALS is measured from `holds.length` and re-derived in
    // `test/prompt.test.ts`. A disclosure is not a step in the argument, so it
    // is tweened without a stop and this row is unchanged by the subset.
    expect(REVEALS["data-table"]).toBe("one per highlighted row, plus 1");
    const lit = dataTable(
      beat({
        headline: "H",
        tableId: "t-methods",
        rows: FOUR,
        highlight: [
          { row: "EDSR", tone: "a" },
          { row: "SwinIR", tone: "b" },
        ],
      }),
      ctx(),
    );
    expect(lit.holds.length).toBe(3);
    expect(out.holds.length).toBe(1);
  });
});

/* ------------------------------------------------------- rows that are not there */

describe("a data-table naming a row it cannot draw", () => {
  it("refuses a subset row the table does not have, by name", () => {
    expect(() =>
      dataTable(
        beat({
          headline: "H",
          tableId: "t-methods",
          rows: ["EDSR", "Nonexistent"],
          highlight: [],
        }),
        ctx(),
      ),
    ).toThrow(/no row labelled "Nonexistent" in table t-methods/);
  });

  it("refuses a highlight on a row the subset left out, and says where it went", () => {
    // The dangerous one. `#sid-rN` is indexed by DRAW order, so a subset
    // renumbers every row after the first gap: matched against the table, this
    // would have lit whichever drawn row sat at the missing row's old index —
    // the wrong row, emphasised, with every gate green.
    expect(() =>
      dataTable(
        beat({
          headline: "H",
          tableId: "t-methods",
          rows: FOUR,
          highlight: [{ row: "LapSRN", tone: "a" }],
        }),
        ctx(),
      ),
    ).toThrow(/no row labelled "LapSRN" is drawn — table t-methods has one, but params.rows/);
  });

  it("still refuses a highlight that matches nothing at all", () => {
    expect(() =>
      dataTable(
        beat({
          headline: "H",
          tableId: "t-short",
          highlight: [{ row: "Nonexistent", tone: "a" }],
        }),
        ctx(),
      ),
    ).toThrow(/no row labelled "Nonexistent" in table t-short/);
  });
});

/* ------------------------------------------------------------------ refusal */

describe("a data-table that does not fit", () => {
  const message = (params: DataTable["params"]): string => {
    try {
      dataTable(beat(params), ctx());
    } catch (err) {
      return (err as Error).message;
    }
    return "(drawn)";
  };

  it("refuses the whole of a twenty-row table and points at the subset", () => {
    const refusal = message({ headline: "Everything", tableId: "t-methods", highlight: [] });
    expect(refusal).toMatch(/^data-table b1: table "t-methods" has 20 rows, which with the header/);
    // The lever the author can actually pull, named before the fallback that
    // stopped tables being cited at all.
    expect(refusal).toContain("name the rows that carry the argument in params.rows");
    expect(refusal.indexOf("params.rows")).toBeLessThan(refusal.indexOf("bar-compare"));
  });

  it("refuses a subset that is still too long, and counts what the beat asked for", () => {
    // "has 20 rows" is unhelpful advice to someone who already named fifteen of
    // them, so the message says both numbers and the lever becomes "fewer".
    const refusal = message({
      headline: "Most of it",
      tableId: "t-methods",
      rows: NAMES.slice(0, 15),
      highlight: [],
    });
    expect(refusal).toContain('table "t-methods" has 20 rows and this beat names 15 of them');
    expect(refusal).toContain("name fewer rows in params.rows");
  });

  it("charges the disclosure to the budget, so a subset holds fewer rows than a table", () => {
    // The row that fits only because the disclosure was not paid for is the row
    // that pushes the disclosure off the canvas — and what a viewer would then
    // lose is the one line telling them the slide is a subset at all.
    //
    // The same n rows, at the same column widths and so at the same type size,
    // drawn once as a whole table and once as a subset of the twenty. The only
    // difference between the two is the line below the table, so any row count
    // that draws whole and refuses as a subset is that line's price.
    const draws = (n: number, as: "whole" | "subset"): boolean => {
      const rows = MATRIX.rows.slice(0, n);
      const exact: Table = { id: "t-exact", columns: MATRIX.columns, rows };
      const params: DataTable["params"] =
        as === "whole"
          ? { headline: "H", tableId: "t-exact", highlight: [] }
          : {
              headline: "H",
              tableId: "t-methods",
              rows: rows.map((row) => row[0] ?? ""),
              highlight: [],
            };
      try {
        dataTable(beat(params), { ...ctx(), source: { ...source, tables: [MATRIX, exact] } });
        return true;
      } catch {
        return false;
      }
    };
    const last = (as: "whole" | "subset"): number => {
      let n = 0;
      while (n < MATRIX.rows.length && draws(n + 1, as)) n++;
      return n;
    };
    expect(last("subset")).toBeGreaterThan(0);
    expect(last("whole")).toBeGreaterThan(last("subset"));
  });
});

/* -------------------------------------------------------- the unchanged path */

describe("a data-table drawing the whole table", () => {
  const params: DataTable["params"] = {
    eyebrow: "Ablation",
    headline: "Four methods, three columns",
    tableId: "t-short",
    note: "Figures are quoted from the papers they come from.",
    highlight: [{ row: "VDSR", tone: "a" }],
  };

  it("draws every row and claims no omission", () => {
    const out = dataTable(beat(params), ctx());
    expect(drawn(out.html)).toEqual(["SRCNN", "FSRCNN", "VDSR", "LapSRN"]);
    // A slide that omits nothing must not say it does.
    expect(out.html).not.toContain("rowomit");
    expect(out.html).not.toContain("omitted");
    expect(out.tl.some((t) => t.target.endsWith("-omit"))).toBe(false);
    // One highlight, plus 1, plus the note's own stop. THAT LAST ONE IS NOT IN
    // `REVEALS`, which says "one per highlighted row, plus 1" and is derived in
    // `test/prompt.test.ts` from a fixture with no note. Pre-existing, untouched
    // here — the subset adds no hold either way — and pinned so the next person
    // to read that row against this emitter finds the discrepancy already named.
    expect(out.holds.length).toBe(3);
  });

  it("is byte-identical to naming every one of its rows", () => {
    // The subset path is not a second layout engine. Naming all four rows is the
    // same slide as naming none, disclosure included: there is nothing to
    // disclose, so nothing is disclosed.
    const named = dataTable(beat({ ...params, rows: NAMES.slice(0, 4) }), ctx());
    expect(named).toEqual(dataTable(beat(params), ctx()));
  });
});

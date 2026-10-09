/**
 * The variety rule (src/plan/variety.ts), checked on bare archetype sequences.
 *
 * The first case is the measured failure the rule was written for, verbatim:
 * the 2026-10-09 Korean paper deck that alternated split-compare and pipeline
 * for nine beats and asked for no picture at all, with `--images` on.
 */
import { describe, expect, it } from "vitest";
import { MAX_ALTERNATION, stagesRequired, varietyFindings } from "../src/plan/variety.js";
import { prefsSchema, type Storyboard } from "../src/types.js";

const on = prefsSchema.parse({ images: { enabled: true } }).images;
const off = prefsSchema.parse({}).images;

/** Only what the rule reads: id, archetype, and a stage's placement. */
const deck = (...shapes: string[]): Storyboard =>
  ({
    beats: shapes.map((s, i) => {
      const [archetype, placement] = s.split("@");
      return { id: `b${i + 1}`, archetype, params: placement ? { placement } : {} };
    }),
  }) as unknown as Storyboard;

describe("varietyFindings", () => {
  it("refuses the measured deck: a nine-beat A/B run and no stage", () => {
    const sc = "split-compare";
    const measured = deck(
      ...["title", sc, "pipeline", sc, "pipeline", sc, "pipeline", "callout"],
      ...["pipeline", sc, "pipeline", sc, "bar-compare", "callout"],
    );
    expect(measured.beats).toHaveLength(14);
    const found = varietyFindings(measured, on);
    expect(found).toContainEqual(expect.stringMatching(/b2 to b7 alternate .* for 6 beats/));
    expect(found).toContainEqual(expect.stringMatching(/b9 to b12 alternate .* for 4 beats/));
    expect(found).toContainEqual(expect.stringMatching(/carry 0 stage beat\(s\); .* at least 3/));
    // Every pair differs: RULE 1 as it was written held, and the deck still failed.
    expect(found.filter((m) => /next to each other/.test(m))).toEqual([]);
  });

  it("refuses two of one archetype side by side", () => {
    expect(varietyFindings(deck("title", "pipeline", "pipeline"), off)).toEqual([
      expect.stringMatching(/b2 and b3 are both `pipeline`/),
    ]);
  });

  it(`allows an A/B/A return of ${MAX_ALTERNATION} and refuses the fourth`, () => {
    expect(varietyFindings(deck("pipeline", "callout", "pipeline", "grid"), off)).toEqual([]);
    expect(varietyFindings(deck("pipeline", "callout", "pipeline", "callout"), off)).toEqual([
      expect.stringMatching(/b1 to b4 alternate .* for 4 beats/),
    ]);
  });

  it("asks for one stage per four beats only when pictures may be asked for, capped by images.max", () => {
    expect(stagesRequired(7, on)).toBe(0);
    expect(stagesRequired(8, on)).toBe(2);
    expect(stagesRequired(14, on)).toBe(3);
    expect(stagesRequired(30, on)).toBe(on.max);
    expect(stagesRequired(14, off)).toBe(0);
    expect(stagesRequired(14, { ...on, max: 1 })).toBe(1);
  });

  it("passes a varied deck, and wants consecutive stages placed differently", () => {
    const varied = [
      "title",
      "stage@bottom-left",
      "pipeline",
      "split-compare",
      "stage@right",
      "bar-compare",
      "callout",
      "stage@center",
    ];
    expect(varietyFindings(deck(...varied), on)).toEqual([]);
    const same = varied.map((s) => (s.startsWith("stage") ? "stage@right" : s));
    expect(varietyFindings(deck(...same), on)).toEqual([
      expect.stringMatching(/b2 and b5 both set their words at "right"/),
      expect.stringMatching(/b5 and b8 both set their words at "right"/),
    ]);
  });
});

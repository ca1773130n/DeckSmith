/**
 * The variety rule (src/plan/variety.ts), checked on bare archetype sequences.
 *
 * The first case is the measured failure the rule was written for, verbatim:
 * the 2026-10-09 Korean paper deck that alternated split-compare and pipeline
 * for nine beats and asked for no picture at all, with `--images` on.
 */
import { describe, expect, it } from "vitest";
import {
  isScene,
  MAX_ALTERNATION,
  panelsAllowed,
  scenesRequired,
  stagesRequired,
  varietyFindings,
} from "../src/plan/variety.js";
import { prefsSchema, type Storyboard } from "../src/types.js";

const on = prefsSchema.parse({ images: { enabled: true } }).images;
const off = prefsSchema.parse({}).images;

/**
 * Only what the rule reads: id, archetype, a stage's placement, and whether a
 * diagram has a backdrop (`pipeline+bd`).
 */
const deck = (...shapes: string[]): Storyboard =>
  ({
    beats: shapes.map((s, i) => {
      const [shape, bd] = s.split("+");
      const [archetype, placement] = (shape ?? "").split("@");
      const backdrop = bd ? { backdrop: { illustration: { prompt: "p", caption: "c" } } } : {};
      return {
        id: `b${i + 1}`,
        archetype,
        params: { ...(placement ? { placement } : {}), ...backdrop },
      };
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
    expect(stagesRequired(30, { ...on, max: 4 })).toBe(4);
    expect(stagesRequired(14, off)).toBe(0);
    expect(stagesRequired(14, { ...on, max: 1 })).toBe(1);
  });

  it("passes a varied deck, and wants consecutive stages placed differently", () => {
    const varied = [
      "title",
      "stage@bottom-left",
      "pipeline+bd",
      "split-compare",
      "stage@right",
      "bar-compare+bd",
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

  it("wants most of a picture deck to be scenes, and counts a diagram over a backdrop as one", () => {
    // The 2026-10-09 ko e2e: three stages in fourteen beats passed the stage
    // minimum and left nine beats of cards on one pale ground.
    expect(scenesRequired(14, on)).toBe(9);
    expect(scenesRequired(14, { ...on, max: 4 })).toBe(4);
    expect(scenesRequired(14, off)).toBe(0);
    expect(scenesRequired(7, on)).toBe(0);
    const cards = [
      "title",
      "stage@bottom-left",
      "pipeline",
      "split-compare",
      "stage@right",
      "bar-compare",
      "callout",
      "stage@center",
    ];
    expect(varietyFindings(deck(...cards), on)).toEqual([
      expect.stringMatching(/8 beats carry 3 scene\(s\); at least 5 must be scenes/),
    ]);
    expect(varietyFindings(deck(...cards), off)).toEqual([]);
  });

  it("counts a hero number and a kinetic claim as scenes without a picture", () => {
    const [hero, claim] = deck("hero-number", "kinetic").beats;
    expect(isScene(hero as never)).toBe(true);
    expect(isScene(claim as never)).toBe(true);
  });

  it("does not count a figure card on the pale ground as a scene", () => {
    // claim-figure and annotated-figure never go through overBackdrop or
    // overField: counted as scenes, a plan met the share with cards on paper.
    const [claim, annotated] = deck("claim-figure", "annotated-figure").beats;
    expect(isScene(claim as never)).toBe(false);
    expect(isScene(annotated as never)).toBe(false);
    const figures = [
      "title",
      "stage@bottom-left",
      "claim-figure",
      "annotated-figure",
      "stage@right",
      "claim-figure",
      "annotated-figure",
      "stage@center",
    ];
    expect(varietyFindings(deck(...figures), on)).toEqual([
      expect.stringMatching(/8 beats carry 3 scene\(s\); at least 5 must be scenes/),
    ]);
  });

  it("caps the panels in a picture deck, backdrop or not, and names them", () => {
    // Round 1 of the 2026-10-09 ko e2e: ten of fourteen beats were scenes and
    // nine were still panels — pipelines, comparisons and callouts over pictures.
    expect(panelsAllowed(14, on)).toBe(5);
    expect(panelsAllowed(14, off)).toBe(Number.POSITIVE_INFINITY);
    const round1 = [
      "title",
      "stage@bottom-left",
      "pipeline+bd",
      "split-compare+bd",
      "pipeline",
      "stage@right",
      "split-compare+bd",
      "pipeline+bd",
      "stage@top-left",
      "callout",
      "split-compare",
      "callout+bd",
      "bar-compare+bd",
      "stage@center",
    ];
    const findings = varietyFindings(deck(...round1), on);
    expect(findings).toEqual([
      expect.stringMatching(/^8 of 14 beats are panels \(b3 `pipeline`.*at most 5 may be/),
    ]);
    // The same deck with three panels redrawn as numbers and claims passes.
    const redrawn = [...round1];
    redrawn[4] = "hero-number";
    redrawn[9] = "kinetic";
    redrawn[10] = "hero-number";
    expect(varietyFindings(deck(...redrawn), on)).toEqual([]);
  });
});

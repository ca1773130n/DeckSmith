/**
 * The selection rule, and the destination table it is measured against.
 *
 * The numbers in the demo cases are MEASURED, not invented: they are the
 * `data-duration` of each scene in `node dist/cli.js build demo/storyboard.json
 * --source demo/source.json --format short-9x16`, which is the narrated length
 * once `beatSeconds` has stretched every beat to fit its audio. A test written
 * against `beat.seconds` would be testing a 106-second deck that does not exist.
 *
 * They are PINNED here rather than re-read from a build. A concurrent change to
 * scene timing moves every one of them by a few tenths, and a selection test that
 * flips because a camera grew a tail teaches nothing about selection. What is
 * asserted is the RULE; the live cut is checked by running the build.
 */
import { describe, expect, it } from "vitest";
import { type Cut, selectBeats } from "../src/plan/select.js";
import {
  ARCHETYPE_FAMILY,
  type Beat,
  DESTINATIONS,
  FORMATS,
  type Format,
  maxSecondsFor,
  type Storyboard,
  storyboardSchema,
  warnSecondsFor,
} from "../src/types.js";

const short = FORMATS["short-9x16"] as Format;

/* ------------------------------------------------------------- the demo cut */

/** The demo storyboard's twelve beats, id / archetype / weight / narrated seconds. */
const DEMO: Array<[string, Beat["archetype"], number, number]> = [
  ["b01", "title", 0.95, 10.204],
  ["b02", "pipeline", 0.95, 39.142],
  ["b03", "annotated-figure", 0.9, 27.524],
  ["b04", "grid", 0.85, 19.73],
  ["b05", "equation-walk", 0.85, 13.492],
  ["b06", "stack", 0.8, 24.704],
  ["b07", "split-compare", 0.9, 20.138],
  ["b08", "bar-compare", 0.8, 14.314],
  ["b09", "data-table", 0.85, 25.446],
  ["b10", "line-chart", 0.95, 13.28],
  ["b11", "claim-figure", 0.75, 15.504],
  ["b12", "callout", 0.7, 23.004],
];

/**
 * Params good enough for each archetype the demo uses. Selection reads
 * `archetype`, `weight`, `inside` and `evidence` and nothing else, so the
 * params only have to parse.
 */
const PARAMS: Record<string, Record<string, unknown>> = {
  title: { headline: "H" },
  pipeline: { headline: "H", stages: [{ label: "a" }, { label: "b" }] },
  "annotated-figure": {
    headline: "H",
    figureId: "fig-compare",
    notes: [{ x: 0.5, y: 0.5, text: "n", tone: "a" }],
  },
  grid: {
    headline: "H",
    cols: 2,
    rows: 2,
    regions: [{ x: 0, y: 0, w: 1, h: 1, label: "r", tone: "a" }],
  },
  "equation-walk": {
    headline: "H",
    equationId: "eq-carrier",
    terms: [{ tex: "R", label: "r", tone: "a" }],
  },
  stack: { headline: "H", layers: [{ label: "a" }, { label: "b" }] },
  "split-compare": { headline: "H", left: { label: "L" }, right: { label: "R" } },
  "bar-compare": {
    headline: "H",
    unit: "M",
    bars: [
      { label: "a", value: 1 },
      { label: "b", value: 2 },
    ],
  },
  "data-table": { headline: "H", tableId: "tbl-bench", highlight: [] },
  "line-chart": {
    headline: "H",
    xLabel: "x",
    yLabel: "y",
    points: [
      { x: "1", y: 1 },
      { x: "2", y: 2 },
    ],
  },
  "claim-figure": { headline: "H", claim: "C", figureId: "fig-progress" },
  callout: { headline: "H", panels: [{ label: "p", lines: ["l"] }] },
};

/**
 * The demo's evidence, which is what makes the dangling-reference case real:
 * b08 CITES the benchmark table and DRAWS bars, so it depends on b09 to have
 * shown it. Copied from demo/storyboard.json rather than read from it, so a
 * concurrent edit to the demo cannot silently change what this asserts.
 */
const EVIDENCE: Record<string, Array<{ kind: string; id: string }>> = {
  b02: [{ kind: "section", id: "sec2" }],
  b03: [{ kind: "figure", id: "fig-compare" }],
  b05: [{ kind: "equation", id: "eq-carrier" }],
  b08: [{ kind: "table", id: "tbl-bench" }],
  b09: [{ kind: "table", id: "tbl-bench" }],
  b11: [{ kind: "figure", id: "fig-progress" }],
};

function demo(over: Partial<Record<string, Partial<Beat>>> = {}): Storyboard {
  return storyboardSchema.parse({
    sourceId: "s1",
    title: "A deck",
    beats: DEMO.map(([id, archetype, weight]) => ({
      id,
      intent: "The viewer understands.",
      archetype,
      params: PARAMS[archetype],
      evidence: EVIDENCE[id] ?? [],
      weight,
      ...over[id],
    })),
  });
}

const SECONDS = Object.fromEntries(DEMO.map(([id, , , s]) => [id, s]));
const ids = (c: Cut) => c.kept.map((b) => b.id);

describe("selectBeats on the demo at short-9x16", () => {
  it("keeps everything when nothing is over", () => {
    const cut = selectBeats(demo(), { minWeight: 0, maxSeconds: Infinity }, SECONDS);
    expect(cut.kept).toHaveLength(12);
    expect(cut.dropped).toEqual([]);
    expect(cut.seconds).toBe(246.482);
  });

  it("fits three minutes while keeping bar-compare and the closing callout", () => {
    // The whole point. `--min-weight 0.85` — the only tool that existed — drops
    // b06, b08, b11 and b12, which is both of the slides the diagram round
    // repaired plus the caveat the deck ends on.
    const cut = selectBeats(demo(), short, SECONDS);

    expect(cut.fits).toBe(true);
    expect(cut.seconds).toBeLessThanOrEqual(short.maxSeconds ?? 0);
    expect(cut.seconds).toBe(178.75);
    expect(ids(cut)).toEqual(["b01", "b02", "b04", "b05", "b07", "b08", "b09", "b10", "b12"]);
    expect(ids(cut)).toContain("b08"); // bar-compare
    expect(ids(cut)).toContain("b12"); // callout
  });

  it("beats the threshold it replaces on the author's own measure", () => {
    // Not "different" — better, in the units --min-weight itself optimises.
    // Selection: 9 beats, 7.80 of author weight, 178.750s.
    // Threshold 0.85: 8 beats, 7.20 of author weight, 168.956s. It leaves 11
    // seconds of the budget unspent and buys less with what it does spend.
    const cut = selectBeats(demo(), short, SECONDS);
    const weight = (bs: Array<{ weight: number }>) => bs.reduce((s, b) => s + b.weight, 0);
    const threshold = DEMO.filter(([, , w]) => w >= 0.85);

    expect(weight(cut.kept)).toBeGreaterThan(weight(threshold.map(([, , w]) => ({ weight: w }))));
  });

  it("keeps the ends, which are the two a threshold reaches for first", () => {
    const cut = selectBeats(demo(), short, SECONDS);
    expect(ids(cut)[0]).toBe("b01");
    expect(ids(cut).at(-1)).toBe("b12");
  });

  it("keeps at least one beat of every family the full deck used", () => {
    const cut = selectBeats(demo(), short, SECONDS);
    const families = new Set(cut.kept.map((b) => ARCHETYPE_FAMILY[b.archetype]));
    expect([...families].sort()).toEqual(["formal", "frame", "quantity", "structure"]);
  });

  it("explains every drop with the numbers behind it", () => {
    // A silent selection is how a user finds out at upload time that their best
    // slide is missing, so every casualty carries a sentence and a rule.
    const cut = selectBeats(demo(), short, SECONDS);

    expect(cut.dropped.map((d) => d.beat.id)).toEqual(["b03", "b06", "b11"]);
    for (const d of cut.dropped) {
      expect(d.rule).toBe("over_budget");
      expect(d.reason).toContain("3m00s");
      expect(d.reason).toContain(String(d.beat.weight));
      expect(d.reason).toMatch(/weight per second/);
      expect(d.reason).toMatch(/family \((frame|structure|quantity|formal)\)/);
    }
  });

  it("drops long high-weight beats before short low-weight ones, which is the fix", () => {
    // b03 at weight 0.90 goes and b08 at 0.80 stays, because b03 costs 27.5s and
    // b08 costs 14.3s. A threshold cannot express that and it is why it is wrong.
    const cut = selectBeats(demo(), short, SECONDS);
    expect(ids(cut)).not.toContain("b03");
    expect(ids(cut)).toContain("b08");
  });
});

describe("selectBeats under a tighter budget", () => {
  it("still keeps the ends and one of each family at 90 seconds", () => {
    const cut = selectBeats(demo(), { ...short, maxSeconds: 90, id: "short-9x16" }, SECONDS);

    expect(cut.fits).toBe(true);
    expect(cut.seconds).toBeLessThanOrEqual(90);
    expect(ids(cut)[0]).toBe("b01");
    expect(ids(cut).at(-1)).toBe("b12");
    expect(new Set(cut.kept.map((b) => ARCHETYPE_FAMILY[b.archetype])).size).toBe(4);
  });

  it("reports a dangling citation rather than silently breaking it", () => {
    // b08 bar-compare cites tbl-bench and draws bars; only b09 data-table shows
    // that table. A cut that keeps b08 and not b09 leaves the citation pointing
    // at nothing, which is the "as the comparison figure showed" failure. At
    // 2m30s the demo lands exactly there, and it is reported rather than
    // repaired: dropping b08 too would lose the claim to save the footnote.
    const cut = selectBeats(demo(), { ...short, maxSeconds: 150, id: "short-9x16" }, SECONDS);

    expect(ids(cut)).toContain("b08");
    expect(ids(cut)).not.toContain("b09");
    expect(cut.dangling.map((d) => `${d.beat.id}/${d.ref.id}`)).toEqual(["b08/tbl-bench"]);
    expect(cut.dangling[0]?.reason).toContain("no beat in this cut shows");
  });

  it("keeps a citation intact when both ends of it survive", () => {
    // The three-minute cut keeps b09, so b08's reference resolves and there is
    // nothing to warn about. A detector that fires either way is not a detector.
    expect(selectBeats(demo(), short, SECONDS).dangling).toEqual([]);
  });

  it("says so, rather than throwing, when no cut can fit", () => {
    // Under the title's own 10.2s there is nothing selection can do — the answer
    // is a shorter script, and a caller that gets an exception cannot say that.
    const cut = selectBeats(demo(), { minWeight: 0, maxSeconds: 5, id: "short-9x16" }, SECONDS);

    expect(cut.fits).toBe(false);
    expect(cut.kept.length).toBeGreaterThanOrEqual(0);
  });
});

describe("selectBeats and the storyboard's own rules", () => {
  it("applies the author's floor first, and says that is why", () => {
    const cut = selectBeats(demo(), { minWeight: 0.9, maxSeconds: Infinity }, SECONDS);

    expect(ids(cut)).toEqual(["b01", "b02", "b03", "b07", "b10"]);
    const b12 = cut.dropped.find((d) => d.beat.id === "b12");
    expect(b12?.rule).toBe("below_min_weight");
    expect(b12?.reason).toContain("below");
  });

  it("never keeps a beat whose `inside` container was cut", () => {
    // The camera dives from the preceding scene into a part of it. Keeping the
    // dependent without the container is not a worse deck, it is a build error.
    const sb = demo({ b09: { inside: { beat: "b08", element: "bar0" } } });
    for (const cap of [90, 120, 150, 180]) {
      const cut = selectBeats(sb, { ...short, maxSeconds: cap, id: "short-9x16" }, SECONDS);
      const kept = new Set(ids(cut));
      if (kept.has("b09")) expect(kept.has("b08")).toBe(true);
    }
  });

  it("keeps a beat the floor orphaned, and reports the relation it broke", () => {
    // THE RECONCILIATION. This used to cascade: b06 falls below the 0.85 floor,
    // so b07-inside-b06 was dropped too, and b08-inside-b07 after it — three
    // beats gone for one the author cut. The emitter never needed that.
    // `enteredParts` in src/emit/composition.ts reads `inside` off the beats that
    // SURVIVED, so an orphan draws itself and gets no camera, which
    // test/camera.test.ts has asserted since the camera landed. Deleting a 0.9
    // beat because the 0.8 beat in front of it went is the author's own flag
    // doing something they cannot predict, so the beats stay and the broken
    // relation is a note.
    const sb = demo({
      b07: { inside: { beat: "b06", element: "layer0" } },
      b08: { weight: 0.9, inside: { beat: "b07", element: "left" } },
    });
    const cut = selectBeats(sb, { minWeight: 0.85, maxSeconds: Infinity }, SECONDS);

    expect(ids(cut)).toContain("b07");
    expect(ids(cut)).toContain("b08");
    expect(cut.dropped.every((d) => d.rule === "below_min_weight")).toBe(true);
    // b07 lost its container. b08's is still there and still immediately before
    // it, so b08's dive survives and is not reported.
    const notes = cut.dangling.filter((d) => d.ref.kind === "beat");
    expect(notes.map((d) => d.beat.id)).toEqual(["b07"]);
    expect(notes[0]?.reason).toContain('inside "b06"');
  });

  it("falls back to authored seconds for a beat nothing has narrated yet", () => {
    // A storyboard straight out of `plan` has no audio. 12 beats x 7s default.
    const sb = demo();
    const cut = selectBeats(sb, { minWeight: 0, maxSeconds: Infinity });
    expect(cut.seconds).toBe(sb.beats.reduce((s, b) => s + b.seconds, 0));
  });

  it("is a pure function of its inputs", () => {
    // Invariant 10 in spirit: the same storyboard and budget must produce the
    // same cut, or a rebuild moves bytes nobody edited.
    const a = selectBeats(demo(), short, SECONDS);
    const b = selectBeats(demo(), short, SECONDS);
    expect(ids(a)).toEqual(ids(b));
    expect(a.dropped.map((d) => d.reason)).toEqual(b.dropped.map((d) => d.reason));
  });
});

/* ---------------------------------------------------------- the destinations */

describe("DESTINATIONS", () => {
  it("gives every format's budget a destination it can be traced to", () => {
    // The trap this closes: 90 seconds sat in the table as "Instagram Reels"
    // long after Instagram raised Reels to three minutes. A number with no
    // named source cannot be noticed going stale.
    for (const [id, f] of Object.entries(FORMATS)) {
      expect(f.maxSeconds, id).toBe(maxSecondsFor(f.id));
      expect(f.warnSeconds, id).toBe(warnSecondsFor(f.id));
    }
  });

  it("caps a short at the loosest destination and warns at the tightest", () => {
    expect(maxSecondsFor("short-9x16")).toBe(180); // YouTube Shorts, Instagram Reels
    expect(warnSecondsFor("short-9x16")).toBe(90); // Facebook Reels
    expect(maxSecondsFor("post-1x1")).toBe(140); // X, standard account
    expect(warnSecondsFor("post-1x1")).toBeUndefined(); // one destination, no gap
  });

  it("leaves the presented formats unbudgeted, and says so with an empty list", () => {
    for (const id of ["deck-16x9", "video-16x9"] as const) {
      expect(DESTINATIONS[id]).toEqual([]);
      expect(maxSecondsFor(id)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("states a positive, finite limit for every destination it lists", () => {
    for (const [id, list] of Object.entries(DESTINATIONS)) {
      for (const d of list) {
        expect(d.name.length, id).toBeGreaterThan(0);
        expect(Number.isFinite(d.maxSeconds), `${id}/${d.name}`).toBe(true);
        expect(d.maxSeconds, `${id}/${d.name}`).toBeGreaterThan(0);
      }
    }
  });
});

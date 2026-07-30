/**
 * The drift gate, minus the two renders.
 *
 * `drift()` itself shells out to `hyperframes render` twice and takes 20 seconds
 * on the fixture and a quarter of an hour on a real deck, so it is not run here
 * — a unit suite that boots Chrome four times is a suite nobody runs. What is
 * tested is everything between the renders: the verdict, the two parsers, and
 * the fixture's own promise that it is boring enough to hold byte-equality.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceSchema, storyboardSchema } from "../src/types.js";
import {
  FIXTURE_SAFE_ARCHETYPES,
  framePattern,
  judge,
  measureMotion,
  readScenes,
  worstFrame,
} from "../src/verify/drift.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../demo/fixtures/${name}`, import.meta.url));

/** A render in which every scene moved: what `measureMotion` returns on a healthy deck. */
const alive = { live: ["s1", "s2"], frozen: [], unmeasured: [], distinct: 138 };

const clean = { mode: "psnr" as const, floorDb: 40, frames: 100, differing: [], motion: alive };

describe("judge", () => {
  it("passes when nothing differed", () => {
    const r = judge(clean);
    expect(r.passed).toBe(true);
    expect(r.identical).toBe(100);
    expect(r.worst).toBeUndefined();
  });

  it("passes a psnr run whose worst frame clears the floor", () => {
    const r = judge({ ...clean, differing: [3, 4], worst: { frame: 4, db: 44.0 } });
    expect(r.passed).toBe(true);
    expect(r.identical).toBe(98);
    // The number has to reach the caller even on a pass: a floor that is being
    // approached run after run is the thing worth noticing before it is crossed.
    expect(r.worst).toEqual({ frame: 4, db: 44.0 });
    expect(r.findings[0]?.message).toContain("44.00 dB at frame 4");
  });

  it("fails a psnr run under the floor and names the frame to look at", () => {
    const r = judge({ ...clean, differing: [7], worst: { frame: 7, db: 21.8 } });
    expect(r.passed).toBe(false);
    expect(r.findings[0]?.rule).toBe("psnr_below_floor");
    expect(r.findings[0]?.severity).toBe("error");
    expect(r.findings[0]?.message).toContain("frame 7");
  });

  // The floor is a floor, not a threshold to be near: exactly 40 dB passes.
  it("treats the floor as inclusive", () => {
    expect(judge({ ...clean, differing: [1], worst: { frame: 1, db: 40 } }).passed).toBe(true);
    expect(judge({ ...clean, differing: [1], worst: { frame: 1, db: 39.99 } }).passed).toBe(false);
  });

  it("fails identical mode on a difference the psnr floor would have shrugged at", () => {
    const r = judge({
      ...clean,
      mode: "identical",
      differing: [2, 3],
      worst: { frame: 2, db: 62.9 },
    });
    expect(r.passed).toBe(false);
    expect(r.findings[0]?.rule).toBe("not_byte_identical");
  });

  /**
   * The case the A/B comparison is blind to by construction. Every number here
   * is the number a perfect run produces — nothing differed, so there is no
   * `worst` — and the deck is still broken.
   */
  it("fails a render whose scenes never moved, however perfectly the two agreed", () => {
    const r = judge({
      ...clean,
      frames: 210,
      motion: { live: [], frozen: ["s1", "s2"], unmeasured: [], distinct: 3 },
    });
    expect(r.passed).toBe(false);
    expect(r.findings[0]?.rule).toBe("frozen_scene");
    expect(r.findings[0]?.severity).toBe("error");
    expect(r.findings[0]?.message).toContain("s1, s2");
    // The reader has to be told why the rest of the report looks healthy.
    expect(r.findings[0]?.message).toContain("byte-identical");
  });

  it("fails the scene that froze while the rest of the deck animated", () => {
    const r = judge({
      ...clean,
      motion: { live: ["s1", "s3"], frozen: ["s2"], unmeasured: [], distinct: 500 },
    });
    expect(r.passed).toBe(false);
    expect(r.findings[0]?.message).toContain("1 of 3 scene(s)");
  });

  // With no scene windows there is nothing to name, but one image for a whole
  // render is still one image for a whole render.
  it("fails a single-image render even when no scene could be read", () => {
    const r = judge({
      ...clean,
      motion: { live: [], frozen: [], unmeasured: [], distinct: 1 },
    });
    expect(r.passed).toBe(false);
    expect(r.findings[0]?.rule).toBe("frozen_render");
  });

  it("says how the motion check went on a passing run, rather than only when it fails", () => {
    expect(judge(clean).findings[0]?.message).toContain("All 2 measurable scene(s) moved");
    const some = judge({
      ...clean,
      motion: { ...alive, unmeasured: ["s9"] },
    });
    expect(some.passed).toBe(true);
    expect(some.findings[0]?.message).toContain("too few frames of their own to judge: s9");
  });

  it("lists the first differing frames without printing hundreds of them", () => {
    const differing = Array.from({ length: 40 }, (_, i) => i + 1);
    const r = judge({ ...clean, mode: "identical", differing, worst: { frame: 1, db: 50 } });
    expect(r.findings[0]?.message).toContain("1, 2, 3, 4, 5, 6, 7, 8, …");
    expect(r.findings[0]?.message).not.toContain(", 9,");
  });
});

describe("framePattern", () => {
  it("reads the width and the start number off the first frame", () => {
    expect(framePattern("frame_000001.png")).toEqual({ pattern: "frame_%06d.png", start: 1 });
    expect(framePattern("f0000.png")).toEqual({ pattern: "f%04d.png", start: 0 });
  });

  // Better to say so than to hand ffmpeg a pattern matching no file and read
  // "printed no psnr statistics" as if the deck were at fault.
  it("gives up on a name with no frame number", () => {
    expect(framePattern("still.png")).toBeUndefined();
  });
});

describe("worstFrame", () => {
  const line = (n: number, db: string) =>
    `n:${n} mse_avg:0.10 mse_r:0.10 mse_g:0.10 mse_b:0.10 mse_a:0.00 psnr_avg:${db} psnr_r:${db} psnr_g:${db} psnr_b:${db} psnr_a:inf`;

  it("finds the lowest psnr and the frame it fell on", () => {
    const out = [line(1, "inf"), line(2, "44.02"), line(3, "51.30"), line(4, "inf")].join("\n");
    expect(worstFrame(out)).toEqual({ frame: 2, db: 44.02 });
  });

  // Two identical renders report `inf` on every frame, and Number("inf") is NaN
  // — which compares false against everything and would silently pick frame 1.
  it("reads inf as infinity, not as a very bad frame", () => {
    expect(worstFrame([line(1, "inf"), line(2, "inf")].join("\n"))?.db).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("returns nothing when ffmpeg printed no statistics", () => {
    expect(worstFrame("Output file is empty\n")).toBeUndefined();
  });
});

/**
 * The windows and the frame counts here are the plain fixture's, measured:
 * `hyperframes render` writes 210 PNGs for its 7 declared seconds, s1 is
 * [0, 3.4) and s2 is [3, 7), so the 12 frames from 90 to 101 belong to both.
 * The frozen numbers are from that same deck with its 13 `tl.fromTo` lines
 * deleted — 3 distinct images in runs of 90, 12 and 108.
 */
describe("measureMotion", () => {
  const scenes = [
    { id: "s1", start: 0, duration: 3.4 },
    { id: "s2", start: 3, duration: 4 },
  ];
  const runs = (...spans: Array<[string, number]>) =>
    spans.flatMap(([h, n]) => Array.from({ length: n }, () => h));

  it("passes a render in which both scenes changed inside their own window", () => {
    const live = Array.from({ length: 210 }, (_, i) => `frame${i}`);
    expect(measureMotion(live, scenes, 7)).toMatchObject({
      live: ["s1", "s2"],
      frozen: [],
      unmeasured: [],
      distinct: 210,
    });
  });

  /**
   * The deck the whole check exists for. Three distinct images is not one, so a
   * deck-level "did anything at all change" test passes this; the two changes
   * are HyperFrames switching scenes, which happens whether or not the deck's
   * own timeline ever ran.
   */
  it("fails the frozen deck that a whole-render distinctness test would pass", () => {
    const frozen = runs(["a", 90], ["b", 12], ["c", 108]);
    const m = measureMotion(frozen, scenes, 7);
    expect(m.distinct).toBe(3);
    expect(m.frozen).toEqual(["s1", "s2"]);
    expect(m.live).toEqual([]);
  });

  /**
   * The crossfade is the neighbour's change, not the scene's. Counting it would
   * let a scene that never animated report motion for the 12 frames in which it
   * is being replaced.
   */
  it("does not credit a scene with the frames it shares with its neighbour", () => {
    // Motion ONLY in the shared span: s1 changes at frame 95, inside [90, 102).
    const shared = runs(["a", 95], ["b", 115]);
    expect(measureMotion(shared, scenes, 7).frozen).toEqual(["s1", "s2"]);
  });

  it("reports a scene it could not judge instead of counting it as a pass", () => {
    const covered = [
      { id: "s1", start: 0, duration: 7 },
      { id: "s2", start: 3, duration: 4 },
    ];
    const m = measureMotion(
      Array.from({ length: 210 }, (_, i) => `frame${i}`),
      covered,
      7,
    );
    expect(m.unmeasured).toEqual(["s2"]);
    expect(m.live).toEqual(["s1"]);
  });

  it("measures nothing rather than dividing by zero when the deck declares no duration", () => {
    const m = measureMotion(["a", "b"], scenes, 0);
    expect(m.unmeasured).toEqual(["s1", "s2"]);
    expect(m.frozen).toEqual([]);
  });
});

describe("readScenes", () => {
  it("reads each scene's window off its own opening tag", () => {
    const html = `<div id="root" data-composition-id="main" data-start="0" data-duration="7" data-width="1920" data-height="1080">
      <div id="s1" class="scene clip" data-composition-id="s1" data-start="0" data-duration="3.4"></div>
      <div id="s2" class="scene clip" data-composition-id="s2" data-start="3" data-duration="4"></div></div>`;
    expect(readScenes(html)).toEqual([
      { id: "s1", start: 0, duration: 3.4 },
      { id: "s2", start: 3, duration: 4 },
    ]);
  });

  // `main` is the root, not a scene: giving it a window would hand every frame
  // of the deck to one entry and hide which scene stopped.
  it("leaves the root out", () => {
    expect(
      readScenes(`<div id="root" data-composition-id="main" data-start="0" data-duration="7">`),
    ).toEqual([]);
  });
});

describe("the plain fixture", () => {
  it("is a valid storyboard and source that agree on an id", async () => {
    const sb = storyboardSchema.parse(
      JSON.parse(await readFile(fixture("plain.storyboard.json"), "utf8")),
    );
    const src = sourceSchema.parse(
      JSON.parse(await readFile(fixture("plain.source.json"), "utf8")),
    );
    expect(sb.sourceId).toBe(src.id);
  });

  /**
   * The fixture's whole job is to be boring. A figure, an equation or a table
   * would put a decoded bitmap or a scaled glyph on the canvas, and `identical`
   * mode would start failing on rasteriser noise rather than on a defect.
   */
  it("carries nothing that rasterises differently between runs", async () => {
    const src = sourceSchema.parse(
      JSON.parse(await readFile(fixture("plain.source.json"), "utf8")),
    );
    expect(src.figures).toEqual([]);
    expect(src.equations).toEqual([]);
    expect(src.tables).toEqual([]);

    const sb = storyboardSchema.parse(
      JSON.parse(await readFile(fixture("plain.storyboard.json"), "utf8")),
    );
    for (const beat of sb.beats) expect(FIXTURE_SAFE_ARCHETYPES).toContain(beat.archetype);
  });

  // Two renders at 30fps, and the gate is meant to be run rather than admired.
  it("stays short enough that the gate is cheap to run", async () => {
    const sb = storyboardSchema.parse(
      JSON.parse(await readFile(fixture("plain.storyboard.json"), "utf8")),
    );
    expect(sb.beats.reduce((s, b) => s + b.seconds, 0)).toBeLessThanOrEqual(10);
  });
});

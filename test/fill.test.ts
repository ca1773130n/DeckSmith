/**
 * The fill gate's arithmetic, without a browser: what it counts as the body's
 * extent, what it divides by, and when it speaks.
 *
 * The browser half — `collectFillRegion` reading the scene's padding box and
 * chrome — is exercised by the eval on real decks; what is pinned here is the
 * part that decides the number.
 */
import { describe, expect, it } from "vitest";
import type { FitManifest } from "../src/emit/fit.js";
import {
  FILL_TOLERANCE,
  type FillRow,
  fillInk,
  finalStops,
  gradeFill,
  inkExtent,
  measureFill,
  readFitManifest,
} from "../src/verify/fill.js";

const BG: [number, number, number] = [11, 13, 16];
const test = { bg: BG, delta: 12 };

/** A W×H RGB frame of background, with the given rectangles painted white. */
function frame(w: number, h: number, rects: { x: number; y: number; w: number; h: number }[]) {
  const pixels = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) pixels.set(BG, i * 3);
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) pixels.set([240, 240, 240], (y * w + x) * 3);
  return { width: w, height: h, channels: 3, pixels };
}

describe("inkExtent", () => {
  it("is null over nothing but background", () => {
    expect(
      inkExtent(frame(40, 30, []), test, { left: 0, right: 40, top: 0, bottom: 30 }),
    ).toBeNull();
  });

  it("is the first to the last painted row and column inside the box", () => {
    const f = frame(40, 30, [
      { x: 5, y: 4, w: 10, h: 3 },
      { x: 20, y: 18, w: 6, h: 5 },
    ]);
    expect(inkExtent(f, test, { left: 0, right: 40, top: 0, bottom: 30 })).toEqual({
      left: 5,
      right: 26,
      top: 4,
      bottom: 23,
    });
  });

  it("ignores a one-pixel fringe, so a stray antialiased edge cannot stretch the body", () => {
    const f = frame(40, 30, [
      { x: 5, y: 4, w: 10, h: 3 },
      { x: 30, y: 25, w: 1, h: 1 },
    ]);
    expect(inkExtent(f, test, { left: 0, right: 40, top: 0, bottom: 30 })?.bottom).toBe(7);
  });

  it("does not count a pixel within the threshold of the background", () => {
    const f = frame(10, 10, []);
    for (let x = 0; x < 10; x++) f.pixels.set([20, 22, 25], (5 * 10 + x) * 3);
    expect(inkExtent(f, test, { left: 0, right: 10, top: 0, bottom: 10 })).toBeNull();
  });
});

describe("measureFill", () => {
  const stop = { sid: "s1", t: 2 };

  it("divides the body's painted extent by the region's HEIGHT, not by what is under the headline", () => {
    // Content box 10..110, chrome 20 tall — but centring pushed the chrome
    // down to 30..50, so only 60 rows lie under it. The body was GIVEN 80, and
    // paints rows 60..100: 40 of 80, half, not 40 of 60.
    const f = frame(100, 120, [{ x: 10, y: 60, w: 50, h: 40 }]);
    const row = measureFill(
      f,
      test,
      { left: 0, right: 100, top: 50, bottom: 110, height: 80, bg: BG },
      stop,
    );
    expect(row.fill).toBe(0.5);
    expect(row.region).toBe(80);
    expect(row.cross).toBe(0.5);
  });

  it("reads past the region's floor, so a body that spills is above 1 rather than clipped to it", () => {
    const f = frame(100, 120, [{ x: 0, y: 30, w: 100, h: 88 }]);
    const row = measureFill(
      f,
      test,
      { left: 0, right: 100, top: 30, bottom: 110, height: 80, bg: BG },
      stop,
    );
    expect(row.fill).toBe(1.1);
  });

  it("stops at a foot slide's region floor, because the headline is what lies under it", () => {
    // Body in rows 10-60 of a 10-70 region; the foot headline painted at 80-95.
    const f = frame(100, 100, [
      { x: 0, y: 10, w: 100, h: 50 },
      { x: 0, y: 80, w: 60, h: 15 },
    ]);
    const region = { left: 0, right: 100, top: 10, bottom: 70, height: 60, bg: BG };
    expect(measureFill(f, test, region, stop).fill).toBe(1.417);
    expect(measureFill(f, test, { ...region, scanBottom: 70 }, stop).fill).toBe(0.833);
  });

  it("reads 0 when the scene had no region, which grades as hollow", () => {
    const row = measureFill(frame(10, 10, []), test, null, stop);
    expect(row.fill).toBe(0);
    expect(row.region).toBe(0);
  });

  it("reports the union box of every ink pixel over the frame, chrome included", () => {
    const f = frame(100, 100, [
      { x: 10, y: 10, w: 80, h: 10 },
      { x: 10, y: 60, w: 30, h: 30 },
    ]);
    expect(measureFill(f, test, null, stop).canvas).toBe(0.64);
  });
});

describe("fillInk", () => {
  it("measures against the page's declared background, not the frame's commonest colour", () => {
    // A frame mostly covered by a panel wash: its modal colour is the panel's.
    const f = frame(100, 100, []);
    for (let y = 10; y < 90; y++)
      for (let x = 5; x < 95; x++) f.pixels.set([30, 33, 38], (y * 100 + x) * 3);
    const region = { left: 0, right: 100, top: 0, bottom: 100, height: 100, bg: BG };
    const panel: [number, number, number] = [30, 33, 38];
    // Against the modal (panel) colour, the bare background reads as ink everywhere.
    expect(measureFill(f, { bg: panel, delta: 12 }, region, { sid: "s1", t: 1 }).canvas).toBe(1);
    // Against the declared background, the panel is the body: 80 of 100 rows.
    const ink = fillInk(region, panel, 12);
    expect(ink.bg).toEqual(BG);
    expect(measureFill(f, ink, region, { sid: "s1", t: 1 }).fill).toBe(0.8);
  });

  it("falls back to the modal colour when the page declared none", () => {
    expect(fillInk(null, [1, 2, 3], 12)).toEqual({ bg: [1, 2, 3], delta: 12 });
  });

  it("measures against a background plate when a pack paints its ground", () => {
    // A blueprint-style grid: faint lines every 10 rows, 14 levels off the
    // ground — over the 12 threshold, so against one colour they are ink.
    const grid = frame(100, 100, []);
    for (let y = 0; y < 100; y += 10)
      for (let x = 0; x < 100; x++) grid.pixels.set([25, 27, 30], (y * 100 + x) * 3);
    const f = { ...grid, pixels: grid.pixels.slice() };
    for (let y = 40; y < 60; y++)
      for (let x = 0; x < 100; x++) f.pixels.set([240, 240, 240], (y * 100 + x) * 3);
    const region = { left: 0, right: 100, top: 0, bottom: 100, height: 100, bg: BG };
    // The grid alone reads as a body spanning the region.
    const at = { sid: "s1", t: 1 };
    expect(measureFill(f, fillInk(region, BG, 12), region, at).fill).toBe(0.91);
    // Against the plate only the painted band is ink.
    expect(measureFill(f, fillInk(region, BG, 12, grid), region, at).fill).toBe(0.2);
  });

  it("ignores a plate whose size is not the frame's", () => {
    const f = frame(20, 20, [{ x: 0, y: 5, w: 20, h: 5 }]);
    const wrong = frame(10, 10, [{ x: 0, y: 0, w: 10, h: 10 }]);
    const box = { left: 0, right: 20, top: 0, bottom: 20 };
    expect(inkExtent(f, { bg: BG, delta: 12, plate: wrong }, box)).toEqual(inkExtent(f, test, box));
  });
});

describe("finalStops", () => {
  it("keeps each scene's last stop, which is the hold the fill is judged at", () => {
    const stops = [
      { sid: "s1", t: 1 },
      { sid: "s1", t: 3 },
      { sid: "s2", t: 7 },
      { sid: "s2", t: 5 },
    ];
    expect(finalStops(stops)).toEqual([
      { sid: "s1", t: 3 },
      { sid: "s2", t: 7 },
    ]);
  });
});

describe("readFitManifest", () => {
  it("reads a v2 manifest and nothing else", () => {
    const m: FitManifest = { design: "v2", scenes: [] };
    expect(readFitManifest(JSON.stringify(m))).toEqual(m);
    expect(readFitManifest(null)).toBeNull();
    expect(readFitManifest("{")).toBeNull();
    expect(readFitManifest(JSON.stringify({ design: "classic", scenes: [] }))).toBeNull();
  });
});

describe("gradeFill", () => {
  const row = (fill: number): FillRow => ({
    sid: "s3",
    t: 9,
    fill,
    cross: 1,
    canvas: 0.5,
    region: 760,
  });
  const manifest = (fill?: number): FitManifest => ({
    design: "v2",
    scenes: [
      {
        id: "s3",
        beat: "b03",
        archetype: "bar-compare",
        ...(fill === undefined ? {} : { fit: { fill, region: 760, ink: fill * 760 } }),
      },
    ],
  });

  it("says nothing about a classic deck, whatever it measured — v0.8.0's verdicts do not move", () => {
    expect(gradeFill([row(0.3)], null)).toEqual([]);
  });

  it("warns at a hollow hold on a v2 deck, naming the scene, the beat and the prediction", () => {
    const [f] = gradeFill([row(0.55)], manifest(0.6));
    expect(f).toMatchObject({
      severity: "warning",
      gate: "fill",
      rule: "hollow_at_hold",
      beatId: "b03",
    });
    expect(f?.message).toContain("#s3 (bar-compare b03) paints 55%");
    expect(f?.message).toContain("predicted 60%");
  });

  it("warns when the build's prediction and the browser disagree by more than the tolerance", () => {
    expect(gradeFill([row(0.95)], manifest(0.95 - FILL_TOLERANCE + 0.01))).toEqual([]);
    const found = gradeFill([row(0.95)], manifest(0.95 - FILL_TOLERANCE - 0.05));
    expect(found.map((f) => f.rule)).toEqual(["fill_model_disagrees"]);
  });

  it("is silent about a full hold the model got right", () => {
    expect(gradeFill([row(0.93)], manifest(0.95))).toEqual([]);
  });
});

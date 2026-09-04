/**
 * The fidelity gate's three pure halves, asserted without a browser.
 *
 * The browser half is measured rather than unit-tested — its evidence is in the
 * header of `src/verify/fidelity.ts`: 466 stops over 41 decks, TP 4 / FP 0 /
 * TN 37 / FN 0, plus a hand-broken copy of the twelve-beat demo that every other
 * gate passes with zero findings and this one fails with twelve. What IS asserted
 * here is the part that would fail silently: a PNG decoded wrong reads as an
 * empty frame and fails a good deck, and a threshold measured against the wrong
 * denominator moves with a headline's line count.
 */
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { apparentPx, gradeApparent, midpoints } from "../src/verify/apparent.js";
import {
  decodePng,
  type Frame,
  gradeFidelity,
  INK_FLOOR,
  inkBelow,
  type Measured,
  readStops,
} from "../src/verify/fidelity.js";

/* --------------------------------------------------------------------- PNG */

/**
 * A minimal PNG, one IDAT, chosen filter per row.
 *
 * Written here rather than checked in as a fixture so the filter type is a
 * parameter: Chrome picks per row, and a decoder that only handles filter 0
 * passes every hand-made fixture and then reads garbage off a real screenshot.
 */
function png(
  width: number,
  height: number,
  rgba: (x: number, y: number) => [number, number, number, number],
  filter = 0,
  channels: 3 | 4 = 4,
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgba(x, y);
      row.push(r, g, b);
      if (channels === 4) row.push(a);
    }
    rows.push(row);
  }
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    raw[at] = filter;
    const row = rows[y] as number[];
    const prev = rows[y - 1];
    for (let x = 0; x < stride; x++) {
      const v = row[x] as number;
      const a = x >= channels ? (row[x - channels] as number) : 0;
      const b = prev ? (prev[x] as number) : 0;
      const c = prev && x >= channels ? (prev[x - channels] as number) : 0;
      let out: number;
      switch (filter) {
        case 1:
          out = v - a;
          break;
        case 2:
          out = v - b;
          break;
        case 3:
          out = v - ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          out = v;
      }
      raw[at + 1 + x] = out & 0xff;
    }
  }

  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type));
    body.set(data, 4);
    const out = new Uint8Array(body.length + 8);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(body, 4);
    // No CRC: the decoder does not check one, and asserting that it does not is
    // part of the point — a screenshot arrives over CDP already intact.
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A dot on a plain field, the shape every frame this measures actually has. */
const dotted =
  (
    bg: [number, number, number],
    fg: [number, number, number],
    box: [number, number, number, number],
  ) =>
  (x: number, y: number): [number, number, number, number] => {
    const [x0, y0, w, h] = box;
    const on = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
    return [...(on ? fg : bg), 255] as [number, number, number, number];
  };

describe("decodePng", () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    it(`reads back an 8-bit RGBA image written with filter ${filter}`, async () => {
      const pixels = dotted([11, 13, 16], [232, 234, 237], [3, 4, 5, 6]);
      const frame = await decodePng(png(16, 12, pixels, filter));
      expect([frame.width, frame.height, frame.channels]).toEqual([16, 12, 4]);
      for (const [x, y] of [
        [0, 0],
        [3, 4],
        [7, 9],
        [15, 11],
      ] as const) {
        const i = (y * 16 + x) * 4;
        expect([frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]]).toEqual(
          pixels(x, y).slice(0, 3),
        );
      }
    });
  }

  it("reads 3-channel RGB, which Chrome emits for an opaque capture", async () => {
    const frame = await decodePng(
      png(8, 8, dotted([250, 247, 242], [43, 38, 34], [1, 1, 2, 2]), 4, 3),
    );
    expect(frame.channels).toBe(3);
    expect(Array.from(frame.pixels.slice(0, 3))).toEqual([250, 247, 242]);
  });

  it("refuses a depth or colour type it was never measured against", async () => {
    const bad = png(4, 4, () => [0, 0, 0, 255]);
    bad[24] = 16; // IHDR bit depth
    await expect(decodePng(bad)).rejects.toThrow(/unsupported PNG/);
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a PNG/);
  });
});

/* --------------------------------------------------------------------- ink */

const frameOf = async (
  bg: [number, number, number],
  fg: [number, number, number],
  box: [number, number, number, number],
): Promise<Frame> => decodePng(png(100, 100, dotted(bg, fg, box), 0));

describe("inkBelow", () => {
  it("is zero on a frame that is nothing but background", async () => {
    expect(inkBelow(await frameOf([11, 13, 16], [11, 13, 16], [0, 0, 0, 0]), 0)).toBe(0);
  });

  it("counts non-background pixels over the WHOLE frame, not the measured band", async () => {
    // 10x10 of ink in a 100x100 frame is 1% of the frame however high the band
    // starts, which is what keeps the floor from moving when a headline wraps.
    const frame = await frameOf([11, 13, 16], [232, 234, 237], [20, 50, 10, 10]);
    expect(inkBelow(frame, 0)).toBeCloseTo(0.01, 6);
    expect(inkBelow(frame, 40)).toBeCloseTo(0.01, 6);
  });

  it("ignores everything above the band, which is how the caption is excluded", async () => {
    const frame = await frameOf([11, 13, 16], [232, 234, 237], [0, 0, 100, 20]);
    expect(inkBelow(frame, 0)).toBeCloseTo(0.2, 6);
    expect(inkBelow(frame, 20)).toBe(0);
  });

  it("reads the same on a light theme, because the reference is the modal colour", async () => {
    // The prototype used absolute luma > 26 and would call all 10,000 pixels of
    // this white frame ink. Same drawing, three backgrounds, one answer.
    for (const [bg, fg] of [
      [
        [11, 13, 16],
        [232, 234, 237],
      ],
      [
        [255, 255, 255],
        [17, 17, 17],
      ],
      [
        [250, 247, 242],
        [43, 38, 34],
      ],
    ] as const) {
      const frame = await frameOf([...bg], [...fg], [10, 10, 30, 30]);
      expect(inkBelow(frame, 0)).toBeCloseTo(0.09, 6);
    }
  });

  it("does not count a pixel within the antialiasing threshold of the background", async () => {
    // +12 exactly is not ink; +13 is. A blank frame must not accumulate ink from
    // encoder or compositor noise, or every sparse slide fails.
    expect(inkBelow(await frameOf([11, 13, 16], [23, 25, 28], [0, 0, 50, 50]), 0)).toBe(0);
    expect(inkBelow(await frameOf([11, 13, 16], [24, 26, 29], [0, 0, 50, 50]), 0)).toBeCloseTo(
      0.25,
      6,
    );
  });
});

/* ------------------------------------------------------------------- stops */

const timing = JSON.stringify({
  scenes: [
    { id: "s1", start: 0, duration: 10.204, holds: [1.9] },
    { id: "s2", start: 10.204, duration: 39.142, holds: [1.55, 2.95] },
    { id: "s3", start: 49.346, duration: 19.73, holds: [] },
  ],
});

const island = (body: unknown) =>
  `<html><script type="application/hyperframes-slideshow+json">${JSON.stringify(body)}</script></html>`;

describe("readStops", () => {
  it("adds each scene's start to its own relative holds", () => {
    // The whole gate aims at these numbers. `timing.json` holds are SCENE
    // RELATIVE — `TimedScene.holds`' doc comment says otherwise and is stale —
    // so forgetting the offset would seek 10s early and measure the wrong scene.
    expect(readStops(timing, null)).toEqual([
      { sid: "s1", t: 1.9 },
      { sid: "s2", t: 11.754 },
      { sid: "s2", t: 13.154 },
    ]);
  });

  it("falls back to the island, whose fragments are already absolute", () => {
    const page = island({
      slides: [
        { sceneId: "s1", startTime: 0, endTime: 8, fragments: [1.9] },
        { sceneId: "s2", startTime: 8, endTime: 16, fragments: [9.5, 11] },
      ],
    });
    expect(readStops(null, page)).toEqual([
      { sid: "s1", t: 1.9 },
      { sid: "s2", t: 9.5 },
      { sid: "s2", t: 11 },
    ]);
    // A 9:16 build emits no navigable page at all, so timing.json has to win.
    expect(readStops(timing, page)).toHaveLength(3);
  });

  it("reads the island rather than nothing when timing.json is unreadable", () => {
    const page = island({ slides: [{ sceneId: "s1", fragments: [2] }] });
    expect(readStops("{not json", page)).toEqual([{ sid: "s1", t: 2 }]);
    expect(readStops(JSON.stringify({ scenes: [] }), page)).toEqual([{ sid: "s1", t: 2 }]);
  });

  it("returns nothing rather than guessing when the deck declares no stops", () => {
    expect(readStops(null, null)).toEqual([]);
    expect(readStops(null, "<html></html>")).toEqual([]);
    expect(readStops(null, island({ slides: [{ sceneId: "s1" }] }))).toEqual([]);
    expect(readStops("{not json", "<html></html>")).toEqual([]);
  });

  it("drops a hold that is not a finite number instead of seeking to NaN", () => {
    const junk = JSON.stringify({
      scenes: [{ id: "s1", start: 0, holds: [1.5, null, "2", Number.NaN, 3] }],
    });
    expect(readStops(junk, null)).toEqual([
      { sid: "s1", t: 1.5 },
      { sid: "s1", t: 3 },
    ]);
  });
});

/* ----------------------------------------------------------------- grading */

const stop = (sid: string, t: number, ink: number): Measured => ({ sid, t, ink, bandTop: 0.3 });

describe("gradeFidelity", () => {
  it("says nothing about a deck whose every stop draws something", () => {
    expect(gradeFidelity([stop("s1", 1.9, 0.0173), stop("s2", 11.7, 0.0114)])).toEqual([]);
  });

  it("reports one error per scene, naming the worst stop and every time", () => {
    // vocab-16's shape: five dead stops in one scene. Five findings saying the
    // same thing is how a report becomes wallpaper and a gate becomes ignorable.
    const findings = gradeFidelity([
      stop("s1", 1.2, 0),
      stop("s1", 2.4, 0.0005),
      stop("s1", 4.1, 0.001),
      stop("s2", 11, 0.0099),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.gate).toBe("fidelity");
    expect(findings[0]?.rule).toBe("blank_at_stop");
    expect(findings[0]?.message).toMatch(/^#s1 stops 3x /);
    expect(findings[0]?.message).toContain("t=1.2s");
    expect(findings[0]?.message).toContain("1.2s, 2.4s, 4.1s");
  });

  it("puts the floor at one 40px label, and treats it as a floor not a ceiling", () => {
    // 0.0015 is the measured ink of one short label at the invariant-5 type
    // floor. The corpus only checks it: worst known-bad 0.039%, best known-good
    // 0.663%. Moving it changes what "appeared" means, so it is asserted.
    expect(INK_FLOOR).toBe(0.0015);
    expect(gradeFidelity([stop("s1", 1, INK_FLOOR)])).toEqual([]);
    expect(gradeFidelity([stop("s1", 1, INK_FLOOR - 1e-9)])).toHaveLength(1);
  });

  it("takes an explicit floor, so the corpus can be re-scored without a rebuild", () => {
    expect(gradeFidelity([stop("s1", 1, 0.005)], 0.01)).toHaveLength(1);
    expect(gradeFidelity([stop("s1", 1, 0.005)], 0.001)).toEqual([]);
  });
});

describe("the apparent type floor", () => {
  const run = (text: string, declared: number, ratio: number, opacity = 1) => ({
    text,
    declared,
    ratio,
    opacity,
  });

  it("reports a flat run at exactly what it declared", () => {
    // The control that stops this gate from arguing with the declared one. A deck
    // doing nothing clever measures its own declared size back, so `apparent` and
    // `typefloor` agree everywhere except where something actually shrank a glyph.
    // Measured in Chrome: a 46px run on an untransformed plane comes back at
    // ratio 1.000, which is 46.0.
    expect(apparentPx(run("Reconstruction", 46, 1), 1)).toBe(46);
  });

  it("divides out the stage, so portrait is not a violation", () => {
    // `typefloor` calls this "the whole argument of REF_PULL and not a violation":
    // in portrait, 40 reference px is SUPPOSED to land at 30 canvas px. The run and
    // its scene shrink together, so the ratio over the stage is 1 and 40 stays 40.
    expect(apparentPx(run("Every window", 40, 0.75), 0.75)).toBe(40);
  });

  it("sees the projection the declared scan cannot", () => {
    // Measured in Chrome at rotateX(30deg) under perspective 1400: a 46px run near
    // the top of the plane paints at ratio 0.682.
    expect(apparentPx(run("Reconstruction", 46, 0.682), 1)).toBeCloseTo(31.4, 1);
    // ...and the same run near the BOTTOM is magnified, which is not a fault.
    expect(apparentPx(run("Reconstruction", 46, 1.126), 1)).toBeCloseTo(51.8, 1);
  });

  it("sees a scale below 1 at a hold, which is the hole typefloor names", () => {
    expect(apparentPx(run("Reconstruction", 46, 0.6), 1)).toBeCloseTo(27.6, 1);
  });

  it("passes a deck whose glyphs all clear the floor", () => {
    expect(
      gradeApparent([{ sid: "s1", t: 1.5, stage: 1, settled: true, runs: [run("Encode", 40, 1)] }]),
    ).toEqual([]);
  });

  it("fails one finding per scene, naming the smallest runs and when", () => {
    const findings = gradeApparent([
      {
        sid: "s2",
        t: 7.55,
        stage: 1,
        settled: true,
        runs: [run("no pooling", 40, 0.64), run("shared ticks", 40, 0.7)],
      },
      { sid: "s3", t: 18.75, stage: 1, settled: true, runs: [run("the shared", 40, 0.6875)] },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.rule).toBe("apparent_type_floor");
    // The selector, not a bare id: `scripts/sweep.mjs` reads it back to decide
    // which beat a finding belongs to.
    expect(findings[0]?.message).toContain("#s2");
    expect(findings[0]?.message).toContain("t=7.55s");
    // Smallest first, so the worst offender is the one a reader sees.
    expect(findings[0]?.message).toContain('"no pooling" at 25.6px');
  });

  it("keeps a run a tenth of a pixel under, because that is rasteriser noise not grace", () => {
    // Measured on the tilted demo: "the next" came back at 39.8px and is a real
    // violation. A run at 39.95 is the same 40 through a rounding error.
    expect(
      gradeApparent([
        { sid: "s4", t: 27.85, stage: 1, settled: true, runs: [run("the next", 40, 0.995)] },
      ]),
    ).toHaveLength(1);
    expect(
      gradeApparent([
        { sid: "s4", t: 27.85, stage: 1, settled: true, runs: [run("the next", 40, 0.9988)] },
      ]),
    ).toEqual([]);
  });

  it("samples between the stops, but not across a scene boundary", () => {
    // The hole this closes is one interval wide: text scaled DOWN between two
    // stops is invisible to a gate that only looks at the stops. A midpoint that
    // fell across a scene seam would land in a cross-fade belonging to neither.
    expect(
      midpoints([
        { sid: "s1", t: 1 },
        { sid: "s1", t: 3 },
        { sid: "s2", t: 9 },
        { sid: "s2", t: 12 },
      ]),
    ).toEqual([
      { sid: "s1", t: 2 },
      { sid: "s2", t: 10.5 },
    ]);
  });

  it("rounds a sampled time to 3 decimals, like every other time here", () => {
    expect(
      midpoints([
        { sid: "s1", t: 1 },
        { sid: "s1", t: 2.0001 },
      ])[0]?.t,
    ).toBe(1.5);
  });

  it("ignores a run still fading in at a midpoint, so entrances are not cried wolf over", () => {
    // `annotated-figure` enters its labels from scale 0.97, so a run caught half
    // way through its own entrance is both under the floor and not yet being
    // read. Failing a build for that frame would make the gate untrustworthy.
    const entering = [
      { sid: "s3", t: 10.5, stage: 1, settled: false, runs: [run("the shared", 40, 0.6, 0.4)] },
    ];
    expect(gradeApparent(entering)).toEqual([]);
    // The identical run, arrived, at the identical instant: now it counts.
    const arrived = [
      { sid: "s3", t: 10.5, stage: 1, settled: false, runs: [run("the shared", 40, 0.6, 1)] },
    ];
    expect(gradeApparent(arrived)).toHaveLength(1);
  });

  it("still judges everything drawn at a declared stop, fading or not", () => {
    // At a stop the frame has arrived. A run that is still translucent THERE is a
    // different bug, and not this gate's to excuse.
    const atStop = [
      { sid: "s3", t: 18.75, stage: 1, settled: true, runs: [run("the shared", 40, 0.6, 0.5)] },
    ];
    expect(gradeApparent(atStop)).toHaveLength(1);
  });
});

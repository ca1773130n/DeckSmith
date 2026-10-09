/**
 * The shell's camera for an illustrated scene (src/bespoke/shots.ts): where the
 * picture's subjects land in the box, how a shot list becomes staged shots,
 * and the GSAP it emits.
 */
import { describe, expect, it } from "vitest";
import {
  CAPTION_BAND,
  calloutLayer,
  calloutZones,
  entrances,
  fitLabel,
  LABEL_MIN_PX,
  LABEL_PX,
  labelScale,
  withZone,
} from "../src/bespoke/callouts.js";
import {
  ART_BAND,
  CAMERA_MAX_SCALE,
  CLOSE_MIN,
  cameraScript,
  compileShots,
  defaultShots,
  ESTABLISH,
  frameOn,
  MIN_HOLD,
  subjectsInBox,
} from "../src/bespoke/shots.js";
import { resolveTheme } from "../src/emit/theme.js";

const W = 1700;
const H = 700;
const cues = [
  { t0: 1, t1: 5 },
  { t0: 5, t1: 9.5 },
  { t0: 9.5, t1: 14 },
  { t0: 14, t1: 18 },
];
const subjects = [
  { x: 100, y: 150, w: 400, h: 420 },
  { x: 650, y: 120, w: 380, h: 460 },
  { x: 1200, y: 160, w: 400, h: 400 },
];

describe("the subjects in the box", () => {
  it("maps shares of a picture that covers the box under the label band (slice), and drops a subject mostly cropped", () => {
    // 1536x1024 over 1700 x (700 - band): scaled by 1700/1536, centred in the space under the band.
    const k = 1700 / 1536;
    const oy = ART_BAND + (700 - ART_BAND - 1024 * k) / 2;
    const [a, b] = subjectsInBox(
      [
        [0.1, 0.3, 0.2, 0.4],
        [0.5, 0.02, 0.2, 0.1],
      ],
      { width: 1536, height: 1024 },
      { width: W, height: H },
    );
    expect(a).toEqual({
      x: Math.round(0.1 * 1536 * k),
      y: Math.round(oy + 0.3 * 1024 * k),
      w: Math.round(0.2 * 1536 * k),
      h: Math.round(0.4 * 1024 * k),
    });
    // The second sits in the band the slice crops away.
    expect(b).toBeUndefined();
  });
});

describe("the label band", () => {
  it("never puts a label in the caption band: a subject high in its picture is labelled below it, or across its top", () => {
    const [s] = subjectsInBox(
      [[0.1, 0, 0.2, 0.5]],
      { width: 1536, height: 1024 },
      { width: W, height: H },
    );
    const zones = calloutZones([s as NonNullable<typeof s>], W, H);
    expect(zones[0]?.side).not.toBe("above");
    expect(zones[0]?.y).toBeGreaterThanOrEqual(CAPTION_BAND);
  });
});

describe("staged shots", () => {
  it("frames a subject at a close scale, held inside the box", () => {
    for (const s of subjects) {
      const f = frameOn(s, W, H);
      expect(f.s).toBeGreaterThanOrEqual(CLOSE_MIN);
      expect(f.s).toBeLessThanOrEqual(CAMERA_MAX_SCALE);
      // The view never shows past the box's edges.
      expect(f.x).toBeLessThanOrEqual(0);
      expect(f.x).toBeGreaterThanOrEqual(W - W * f.s - 1);
      expect(f.y).toBeLessThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(H - H * f.s - 1);
      // And the subject's centre is in view.
      const cx = s.x + s.w / 2;
      expect(cx * f.s + f.x).toBeGreaterThan(0);
      expect(cx * f.s + f.x).toBeLessThan(W);
    }
  });

  it("establishes, pushes in on the named subjects at their cues, and reveals at the last cue", () => {
    const moves = compileShots(
      [
        { cue: 2, at: 0, subject: 1 },
        { cue: 3, at: 0.1, subject: 3 },
      ],
      cues,
      19,
      subjects,
      W,
      H,
    );
    expect(moves.map((m) => m.subject)).toEqual([1, 3, 0]);
    expect(moves[0]?.t).toBe(5);
    expect(moves[1]?.t).toBeCloseTo(9.95, 2);
    // The reveal: home, at the last cue, done before the end frame (D - 0.5).
    const reveal = moves[2] as (typeof moves)[number];
    expect(reveal).toMatchObject({ s: 1, x: 0, y: 0, t: 14 });
    expect(reveal.t + reveal.dur).toBeLessThanOrEqual(19 - 0.5);
    for (const m of moves.slice(0, 2)) expect(m.s).toBeGreaterThanOrEqual(CLOSE_MIN);
  });

  it("holds the establishing shot, drops a shot too close to the last, and never moves past the end", () => {
    const moves = compileShots(
      [
        { cue: 1, at: 0, subject: 2 },
        { cue: 1, at: 0.5, subject: 1 },
        { cue: 4, at: 0.8, subject: 2 },
      ],
      cues,
      19,
      subjects,
      W,
      H,
    );
    expect(moves[0]?.t).toBeGreaterThanOrEqual(1 + ESTABLISH);
    for (let i = 1; i < moves.length; i++)
      expect((moves[i]?.t ?? 0) - (moves[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(MIN_HOLD);
    const last = moves[moves.length - 1] as (typeof moves)[number];
    expect(last.subject).toBe(0);
    expect(last.t + last.dur).toBeLessThanOrEqual(19 - 0.5);
  });

  it('reads an "at" past 1 as seconds into the cue', () => {
    const moves = compileShots([{ cue: 2, at: 2, subject: 1 }], cues, 19, subjects, W, H);
    expect(moves[0]?.t).toBe(7);
  });

  it("stages the subjects in order when the scene's own list is empty or names none", () => {
    expect(defaultShots(4, 3)).toEqual([
      { cue: 2, at: 0, subject: 1 },
      { cue: 3, at: 0, subject: 2 },
    ]);
    expect(defaultShots(3, 3)).toEqual([
      { cue: 2, at: 0, subject: 1 },
      { cue: 2, at: 0.5, subject: 2 },
    ]);
    expect(defaultShots(2, 3)).toEqual([
      { cue: 1, at: 0.5, subject: 1 },
      { cue: 2, at: 0, subject: 2 },
    ]);
    const moves = compileShots([{ cue: 9, at: 0, subject: 7 }], cues, 19, subjects, W, H);
    expect(moves.map((m) => m.subject)).toEqual([1, 2, 0]);
    expect(compileShots([], cues, 19, [], W, H)).toEqual([]);
  });

  it("emits seek-safe GSAP: explicit from-values, immediateRender false, and a creep while held", () => {
    const moves = compileShots([{ cue: 2, at: 0, subject: 1 }], cues, 19, subjects, W, H);
    const js = cameraScript("s7", moves, W, H);
    expect(js).toContain('gsap.set("#s7-cam", { scale: 1, x: 0, y: 0, transformOrigin: "0 0" });');
    const tweens = js.split("\n").filter((l) => l.startsWith("tl."));
    expect(
      tweens.every((l) =>
        /^tl\.fromTo\("#s7-cam", \{ scale: [\d.]+, x: -?\d+, y: -?\d+ \}/.test(l),
      ),
    ).toBe(true);
    expect(tweens.every((l) => l.includes("immediateRender: false"))).toBe(true);
    // establishing creep, push, held creep, reveal
    expect(tweens).toHaveLength(4);
    expect(tweens[tweens.length - 1]).toMatch(/\{ scale: 1, x: 0, y: 0, duration: 1\.3/);
    // No two camera tweens touch: each ends before the next begins (seek-safe, lint-clean).
    const spans = tweens.map((l) => {
      const dur = Number(/duration: ([\d.]+)/.exec(l)?.[1]);
      const at = Number(/, ([\d.]+)\);$/.exec(l)?.[1]);
      return [at, at + dur];
    });
    for (let i = 1; i < spans.length; i++)
      expect((spans[i] as number[])[0]).toBeGreaterThan((spans[i - 1] as number[])[1] as number);
  });
});

describe("the shell's labels, on their subjects", () => {
  const ink = resolveTheme("ink");

  // Subjects standing in the lower middle of the picture, as the illustrator is asked.
  const low = [
    { x: 100, y: 300, w: 400, h: 360 },
    { x: 650, y: 280, w: 380, h: 380 },
    { x: 1200, y: 310, w: 400, h: 350 },
  ];

  it("gives each subject a zone above it under the caption band, else below it, else across its top — never meeting a neighbour's", () => {
    const zones = calloutZones(low, W, H);
    expect(zones.map((z) => z.side)).toEqual(["above", "above", "above"]);
    for (const [i, z] of zones.entries()) {
      const s = low[i] as (typeof low)[number];
      expect(z.y + z.h).toBeLessThanOrEqual(s.y);
      expect(z.y).toBeGreaterThanOrEqual(CAPTION_BAND);
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(W);
      // The dot is on the subject, just inside its top edge: a short leader that
      // does not run down through what the scene drew on the subject.
      expect(z.dot.y).toBeGreaterThan(s.y);
      expect(z.dot.y - s.y).toBeLessThanOrEqual(20);
      const next = zones[i + 1];
      if (next) expect(z.x + z.w).toBeLessThanOrEqual(next.x);
    }
    // No room above (the caption band): below, with the dot just inside its bottom edge.
    const [below] = calloutZones([{ x: 100, y: 140, w: 400, h: 380 }], W, H);
    expect(below?.side).toBe("below");
    expect(below?.y).toBeGreaterThanOrEqual(520);
    expect(below?.dot.y).toBeLessThan(520);
    // No room either side: across its top, still under the band.
    const [high] = calloutZones([{ x: 100, y: 130, w: 400, h: 560 }], W, H);
    expect(high?.side).toBe("top");
    expect(high?.y).toBeGreaterThanOrEqual(CAPTION_BAND);
  });

  it("sets a label on one line at 64px, shrinks it to 52, breaks it onto two, or refuses it", () => {
    const [z] = calloutZones([{ x: 600, y: 300, w: 400, h: 300 }], W, H);
    const zone = z as NonNullable<typeof z>;
    expect(fitLabel("cup", { ...zone, w: 400 }, ink)).toEqual({ fs: LABEL_PX, lines: ["cup"] });
    const two = fitLabel("image-based reasoning", { ...zone, w: 400 }, ink, H);
    expect(two?.lines).toEqual(["image-based", "reasoning"]);
    expect(two?.fs).toBeGreaterThanOrEqual(LABEL_MIN_PX);
    expect(
      fitLabel("unbreakablelongwordthatnevershrinks", { ...zone, w: 300 }, ink, H),
    ).toBeUndefined();
  });

  it("sets names big enough to read in the whole view: 60px or more, never under 52 (round 5)", () => {
    // The founder's bar, as numbers: round 4's 44-56px read small in the reveal.
    expect(LABEL_PX).toBeGreaterThanOrEqual(60);
    expect(LABEL_MIN_PX).toBeGreaterThanOrEqual(52);
    const [z] = calloutZones([{ x: 600, y: 300, w: 400, h: 300 }], W, H);
    for (const w of [200, 260, 320, 400, 640])
      for (const text of ["cup", "sorting hall", "the long evaluation gap"]) {
        const fit = fitLabel(text, { ...(z as NonNullable<typeof z>), w }, resolveTheme("ink"), H);
        if (fit) expect(fit.fs).toBeGreaterThanOrEqual(52);
      }
  });

  it("holds a label against the camera's zoom: on screen it grows by sqrt(s), and it is home at the end", () => {
    expect(labelScale(1)).toBe(1);
    expect(labelScale(2)).toBeCloseTo(1 / Math.SQRT2, 3);
    const zones = calloutZones(low, W, H);
    const moves = compileShots([{ cue: 2, at: 0, subject: 1 }], cues, 19, low, W, H);
    const layer = calloutLayer("s3", [{ subject: 1, text: "cup" }], zones, moves, ink, W, H);
    const face = layer.script.split("\n").filter((l) => l.includes("#s3-callout1-face"));
    // One tween per move that changes the scale, the last back to 1.
    expect(face.length).toBeGreaterThan(1);
    expect(face[face.length - 1]).toMatch(/\{ scale: 1, duration/);
    const push = moves.find((m) => m.subject === 1) as (typeof moves)[number];
    expect(layer.script).toContain(`scale: ${labelScale(push.s)}, duration: ${push.dur}`);
  });

  it("frames a labelled subject with its label, and lands the label as the camera arrives", () => {
    const zones = calloutZones(low, W, H);
    const target = withZone(low[0] as (typeof low)[number], zones[0]);
    expect(target.y).toBe(zones[0]?.y);
    const moves = compileShots([{ cue: 2, at: 0, subject: 1 }], cues, 19, low, W, H);
    const at = entrances(moves, 3);
    expect(at.get(1)).toBeCloseTo(5 + 0.6 * 1.1, 5);
    // A subject the camera never visits is named at the reveal.
    expect(at.get(3)).toBeCloseTo((moves[moves.length - 1]?.t ?? 0) + 0.4, 5);
    const layer = calloutLayer("s3", [{ subject: 1, text: "cup" }], zones, moves, ink, W, H);
    expect(layer.markup).toMatch(/<g id="s3-callout1" data-subject="1">/);
    expect(layer.script).toContain('gsap.set("#s3-callout1", { opacity: 0 });');
    expect(
      layer.script
        .split("\n")
        .filter((l) => l.startsWith("tl."))
        .every((l) => l.includes("immediateRender: false")),
    ).toBe(true);
  });
});

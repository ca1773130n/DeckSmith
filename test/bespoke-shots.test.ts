/**
 * The shell's camera for an illustrated scene (src/bespoke/shots.ts): where the
 * picture's subjects land in the box, how a shot list becomes staged shots,
 * and the GSAP it emits.
 */
import { describe, expect, it } from "vitest";
import {
  BLUR_MAX,
  blurAt,
  CAMERA_MAX_SCALE,
  CLOSE_MIN,
  cameraScript,
  compileShots,
  defaultShots,
  ESTABLISH,
  frameOn,
  MIN_HOLD,
  planeFrame,
  softAt,
  subjectsInBox,
} from "../src/bespoke/shots.js";

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
  it("maps shares of a picture that covers the whole box (slice), and drops a subject mostly cropped", () => {
    // 1536x1024 over 1700 x 700: scaled by 1700/1536, centred (round 6: no label band).
    const k = 1700 / 1536;
    const oy = (700 - 1024 * k) / 2;
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
    // The second sits at the top edge the slice crops away.
    expect(b).toBeUndefined();
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

/**
 * ROUND 6: the picture's depth planes. A plane at distance z is moved as a
 * pinhole camera sees it (`planeFrame`), which keeps it covering the frame
 * whenever the camera's framing does; and it is blurred by its distance from the
 * plane in focus (`blurAt`).
 */
describe("depth planes", () => {
  const FW = 1920;
  const FH = 1080;

  it("moves the subjects' plane (z 1) exactly with the camera", () => {
    for (const f of [
      { s: 1, x: 0, y: 0 },
      { s: 1.6, x: -400, y: -250 },
      { s: 1.3, x: -10, y: -300 },
    ]) {
      const p = planeFrame(f, 1, FW, FH);
      expect(p.s).toBeCloseTo(f.s, 3);
      expect(p.x).toBeCloseTo(f.x, 0);
      expect(p.y).toBeCloseTo(f.y, 0);
    }
  });

  it("is a pinhole camera: a far plane zooms and slides less, a near one more, a truck shifts by 1/z", () => {
    const push = { s: 1.6, x: -500, y: -300 };
    const far = planeFrame(push, 2.5, FW, FH);
    const near = planeFrame(push, 0.8, FW, FH);
    expect(far.s).toBeGreaterThan(1);
    expect(far.s).toBeLessThan(push.s);
    expect(near.s).toBeGreaterThan(push.s);
    // A lateral truck at scale 1: every plane at scale 1, shifted by x / z.
    const truck = { s: 1, x: -120, y: 0 };
    for (const z of [0.7, 1, 2, 3.5]) {
      const p = planeFrame(truck, z, FW, FH);
      expect(p.s).toBeCloseTo(1, 4);
      expect(p.x).toBeCloseTo(-120 / z, 0);
    }
    // The exact projection: a point of the far plane lands where a pinhole camera puts it.
    const tz = 1 - 1 / push.s;
    const ft = ((FW / 2) * (1 - push.s) - push.x) / push.s;
    const X = 300;
    const world = ((X - FW / 2) * 2.5) / 1; // the point's lateral offset on the plane, focal 1
    const seen = FW / 2 + (world - ft) / (2.5 - tz);
    expect(far.s * X + far.x).toBeCloseTo(seen, 0);
  });

  it("covers the frame with every plane whenever the camera's framing covers it, at any distance", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const covers = (p: { s: number; x: number; y: number }) =>
      p.x <= 0.5 && p.y <= 0.5 && p.x + FW * p.s >= FW - 0.5 && p.y + FH * p.s >= FH - 0.5;
    for (let k = 0; k < 500; k++) {
      const s = 1 + rnd() * 1.2;
      // Any framing held to the box, the edges included.
      const edge = rnd();
      const f = {
        s,
        x: edge < 0.2 ? 0 : edge < 0.4 ? FW - FW * s : -rnd() * (FW * s - FW),
        y: -rnd() * (FH * s - FH),
      };
      for (const z of [0.8, 1, 1.4, 2, 3])
        expect(covers(planeFrame(f, z, FW, FH)), `${z}`).toBe(true);
    }
    // And a framing that does not cover the box is not covered by any plane either.
    expect(covers(planeFrame({ s: 1.2, x: 20, y: 0 }, 2, FW, FH))).toBe(false);
  });

  it("racks focus: the plane in focus is sharp, the others blur with their distance from it, more in a close shot", () => {
    expect(softAt(1.2, 1.2, 1.6)).toBe(0);
    expect(softAt(0.6, 4, 1.6)).toBeLessThanOrEqual(1);
    expect(blurAt(1.2, 1.2, 1)).toBe(0);
    expect(blurAt(2.5, 1, 1)).toBeGreaterThan(blurAt(1.5, 1, 1));
    expect(blurAt(2.5, 1, 1.6)).toBeGreaterThan(blurAt(2.5, 1, 1));
    expect(blurAt(0.6, 4, 1.6)).toBeLessThanOrEqual(BLUR_MAX);
  });

  it("moves every plane with every camera move, racks focus to the subject framed, sweeps the light and lets the subjects breathe", () => {
    const moves = compileShots(
      [
        { cue: 2, at: 0, subject: 1 },
        { cue: 3, at: 0, subject: 2 },
      ],
      cues,
      19,
      subjects,
      W,
      H,
    );
    const depth = {
      planes: [{ z: 2.2 }, { z: 1.4 }, { z: 0.8 }],
      subjects: subjects.map((box, i) => ({ subject: i + 1, z: [1, 1.2, 0.9][i] as number, box })),
      duration: 19,
    };
    const js = cameraScript("s5", moves, W, H, { depth });
    const lines = js.split("\n");
    const cam = lines.filter((l) => l.startsWith('tl.fromTo("#s5-cam"'));
    for (const id of [
      "#s5-plate",
      "#s5-plane1",
      "#s5-plane2",
      "#s5-subj1",
      "#s5-subj2",
      "#s5-subj3",
    ]) {
      const own = lines.filter((l) => l.startsWith(`tl.fromTo("${id}"`));
      expect(own, id).toHaveLength(cam.length);
      expect(own.every((l) => l.includes("immediateRender: false"))).toBe(true);
      // No CSS blur anywhere: focus is a cross-fade to the plane's soft twin.
      expect(js).not.toContain("filter:");
    }
    // Focus on S1 while the camera holds it: S1's soft twin fades out, S2's (another distance) in.
    const softTo = (id: string) => {
      const l = lines.find((x) => x.startsWith(`tl.fromTo("${id}-soft"`) && x.endsWith(", 5);"));
      return l ? Number(/\}, \{ opacity: ([\d.]+)/.exec(l)?.[1]) : undefined;
    };
    expect(softTo("#s5-subj1") ?? 0).toBe(0);
    expect(softTo("#s5-subj2")).toBeGreaterThan(0);
    const push1 = cam.findIndex((l) => l.endsWith(", 5);"));
    // The far plane zooms less than the camera on the push.
    const far = lines.filter((l) => l.startsWith('tl.fromTo("#s5-plate"'))[push1] as string;
    const camTo = Number(/\}, \{ scale: ([\d.]+)/.exec(cam[push1] as string)?.[1]);
    const farTo = Number(/\}, \{ scale: ([\d.]+)/.exec(far)?.[1]);
    expect(farTo).toBeLessThan(camTo);
    expect(js).toContain('tl.fromTo("#s5-light"');
    // Breathing: an even number of legs (repeat odd), so each subject is home before the end.
    for (const l of lines.filter((x) => x.includes(".ds-life") && x.includes("repeat"))) {
      const rep = Number(/repeat: (\d+)/.exec(l)?.[1]);
      expect(rep % 2).toBe(1);
      const dur = Number(/duration: ([\d.]+)/.exec(l)?.[1]);
      expect((rep + 1) * dur).toBeLessThanOrEqual(19 - 0.5);
    }
  });

  it("lights the subjects in turn for a wipe: they stand dim from the first frame, never an empty frame", () => {
    const depth = {
      planes: [{ z: 2 }],
      subjects: subjects.map((box, i) => ({ subject: i + 1, z: 1, box })),
      duration: 19,
    };
    const js = cameraScript("s6", [], W, H, {
      depth,
      wipes: [
        { t: 2, dur: 0.9, share: 0.3, subject: 1 },
        { t: 6, dur: 0.9, share: 0.6, subject: 2 },
        { t: 10, dur: 0.9, share: 1, subject: 0 },
      ],
    });
    for (const k of [1, 2, 3]) {
      expect(js).toContain(`gsap.set("#s6-subj${k} > .ds-life", { opacity: 0.18 });`);
      expect(js).toMatch(
        new RegExp(
          `tl\\.fromTo\\("#s6-subj${k} > \\.ds-life", \\{ opacity: 0\\.18 \\}, \\{ opacity: 1`,
        ),
      );
    }
    // A step lights every subject it has reached from the left, and only once.
    const lights = js
      .split("\n")
      .filter((l) => /^tl\.fromTo\("#s6-subj\d > \.ds-life", \{ opacity/.test(l));
    expect(lights).toHaveLength(3);
    // The last step (share 1) lights whatever is left, even a subject no step named.
    const partial = cameraScript("s6", [], W, H, {
      depth,
      wipes: [
        { t: 2, dur: 0.9, share: 0.3, subject: 1 },
        { t: 6, dur: 0.9, share: 1, subject: 3 },
      ],
    });
    expect(partial).toMatch(
      /tl\.fromTo\("#s6-subj2 > \.ds-life", \{ opacity: 0\.18 \}, \{ opacity: 1[^)]*\}, 6\);/,
    );
    // No clip: the backdrop is never wiped.
    expect(js).not.toContain("-wipe");
  });
});

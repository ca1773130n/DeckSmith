/**
 * The shell's camera for an illustrated scene (src/bespoke/shots.ts): where the
 * picture's subjects land in the box, how a shot list becomes staged shots,
 * and the GSAP it emits.
 */
import { describe, expect, it } from "vitest";
import {
  calloutLayer,
  calloutZones,
  entrances,
  fitLabel,
  labelFades,
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
  it("leaves room above a subject that touches the top of its picture, so its label goes above it, not across its face", () => {
    const [s] = subjectsInBox(
      [[0.1, 0, 0.2, 0.5]],
      { width: 1536, height: 1024 },
      { width: W, height: H },
    );
    const zones = calloutZones([s as NonNullable<typeof s>], W);
    expect(zones[0]?.side).toBe("above");
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

  it("gives each subject a zone above it (or across its top when there is no room), never meeting a neighbour's", () => {
    const zones = calloutZones(subjects, W);
    expect(zones.map((z) => z.side)).toEqual(["above", "above", "above"]);
    for (const [i, z] of zones.entries()) {
      const s = subjects[i] as (typeof subjects)[number];
      if (z.side === "above") expect(z.y + z.h).toBeLessThanOrEqual(s.y);
      else expect(z.y).toBeGreaterThanOrEqual(s.y);
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(W);
      // The dot is on the subject, just inside its top edge: a short leader that
      // does not run down through what the scene drew on the subject.
      expect(z.dot.y).toBeGreaterThan(s.y);
      if (z.side === "above") expect(z.dot.y - s.y).toBeLessThanOrEqual(20);
      const next = zones[i + 1];
      if (next) expect(z.x + z.w).toBeLessThanOrEqual(next.x);
    }
    const high = calloutZones([{ x: 100, y: 20, w: 400, h: 500 }], W);
    expect(high[0]?.side).toBe("top");
    expect(high[0]?.y).toBeGreaterThan(20);
  });

  it("sets a label on one line, shrinks it, breaks it onto two, or refuses it", () => {
    const [z] = calloutZones([{ x: 600, y: 300, w: 400, h: 300 }], W);
    const zone = z as NonNullable<typeof z>;
    expect(fitLabel("cup", { ...zone, w: 400 }, ink)).toEqual({ fs: 56, lines: ["cup"] });
    const two = fitLabel("image-based reasoning", { ...zone, w: 400 }, ink, H);
    expect(two?.lines).toEqual(["image-based", "reasoning"]);
    expect(
      fitLabel("unbreakablelongwordthatnevershrinks", { ...zone, w: 300 }, ink, H),
    ).toBeUndefined();
  });

  it("steps a label out of a push-in that would cut it, and back in when a shot shows it whole", () => {
    const zones = calloutZones(subjects, W);
    const targets = subjects.map((s, i) => withZone(s, zones[i]));
    // Subject 1, then subject 2 (whose close framing crops subject 1's label), then the reveal.
    const moves = compileShots(
      [
        { cue: 2, at: 0, subject: 1 },
        { cue: 3, at: 0, subject: 2 },
      ],
      cues,
      19,
      targets,
      W,
      H,
    );
    expect(moves.map((m) => m.subject)).toEqual([1, 2, 0]);
    const layer = calloutLayer(
      "s3",
      [
        { subject: 1, text: "camera" },
        { subject: 2, text: "satellite" },
      ],
      zones,
      moves,
      ink,
      W,
      H,
    );
    const fades = layer.script
      .split("\n")
      .filter((l) => l.includes('"#s3-callout1"') && l.includes("power1.inOut"));
    const [toS2, reveal] = [moves[1] as (typeof moves)[number], moves[2] as (typeof moves)[number]];
    // Is label 1 cut by the framing on subject 2? Then it must step out at that move.
    const view = { x0: -toS2.x / toS2.s, x1: -toS2.x / toS2.s + W / toS2.s };
    const z1 = zones[0] as (typeof zones)[number];
    const cut = z1.x < view.x0 && z1.x + z1.w > view.x0;
    // The fixture's second shot does cut it (asserted, so the case cannot go vacuous).
    expect(cut).toBe(true);
    expect(fades[0]).toContain(
      `{ opacity: 0, duration: 0.3, ease: "power1.inOut", immediateRender: false }, ${toS2.t});`,
    );
    expect(fades[1]).toContain(
      `{ opacity: 1, duration: 0.3, ease: "power1.inOut", immediateRender: false }, ${Math.round((reveal.t + reveal.dur - 0.3) * 100) / 100});`,
    );
    // Built so that it is cut: a plate straddling the left edge of the second shot.
    const plate = { x: Math.round(view.x0 - 60), y: 40, w: 200, h: 70 };
    const fx = labelFades(
      {
        plate,
        lead: { x1: plate.x + 100, y1: 110, x2: plate.x + 100, y2: 140 },
        dot: { x: plate.x + 100, y: 150 },
      },
      moves,
      5.66,
      W,
      H,
    );
    expect(fx).toEqual([
      { t: toS2.t, to: 0 },
      { t: Math.round((reveal.t + reveal.dur - 0.3) * 100) / 100, to: 1 },
    ]);
    // Wholly outside the shot, or wholly inside: no fade.
    const far = { x: Math.round(view.x1 + 50), y: 40, w: 100, h: 70 };
    expect(
      labelFades(
        {
          plate: far,
          lead: { x1: far.x + 50, y1: 110, x2: far.x + 50, y2: 140 },
          dot: { x: far.x + 50, y: 150 },
        },
        moves,
        5.66,
        W,
        H,
      ),
    ).toEqual([]);
  });

  it("frames a labelled subject with its label, and lands the label as the camera arrives", () => {
    const zones = calloutZones(subjects, W);
    const target = withZone(subjects[0] as (typeof subjects)[number], zones[0]);
    expect(target.y).toBe(zones[0]?.y);
    const moves = compileShots([{ cue: 2, at: 0, subject: 1 }], cues, 19, subjects, W, H);
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

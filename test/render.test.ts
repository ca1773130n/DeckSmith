/**
 * The arithmetic of a narrated video, tested without ffmpeg.
 *
 * Everything that can silently ruin this feature is a number: an offset that
 * drifts, a frame count that does not add up, a sentence placed on the wrong
 * reveal. None of that needs a codec to check, and a test that shelled out to
 * ffmpeg would be a test nobody runs. So `render` is split so that the numbers
 * live in src/render/timing.ts and the processes live in src/render/ffmpeg.ts,
 * and this file exercises the first exhaustively and the second only as the
 * strings it builds.
 *
 * The composition is emitted for real rather than mocked, because the one thing
 * this module must never do is disagree with the emitter about where a scene
 * starts.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Cue } from "../src/deck/subtitles.js";
import { type DeckNarration, emitComposition, planCut } from "../src/emit/composition.js";
import { captionPage, overlayGraph, overlayInputs, union } from "../src/render/captions.js";
import {
  audioGraph,
  burnStyle,
  encoderArgs,
  pieceArgs,
  pieceFilter,
} from "../src/render/ffmpeg.js";
import { render, subtitlePlan } from "../src/render/render.js";
import {
  assertFits,
  assertHoldsAgree,
  cueMax,
  framePlan,
  place,
  planTiming,
  readDuration,
  readFragments,
  readSceneWindows,
  srtTime,
  type TimedScene,
  type Timing,
  toSrt,
  wrap,
} from "../src/render/timing.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

function format(id: string): Format {
  const f = FORMATS[id];
  if (!f) throw new Error(`no format "${id}"`);
  return f;
}

const source = sourceSchema.parse({
  id: "src-1",
  title: "Attention Is All You Need",
  lang: "en",
  sections: [{ id: "sec-1", depth: 1, heading: "Scaled dot-product attention", text: "..." }],
  figures: [],
  equations: [
    {
      id: "eq-attn",
      tex: String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V`,
      display: true,
    },
  ],
  tables: [],
});

const storyboard = storyboardSchema.parse({
  sourceId: "src-1",
  title: "Attention Is All You Need",
  beats: [
    {
      id: "b1",
      intent: "Name the paper.",
      narration: "Attention is all you need.",
      archetype: "title",
      seconds: 6,
      params: { eyebrow: "Paper analysis", headline: "Attention is all you need", sub: "2017" },
    },
    {
      id: "b2",
      intent: "Read the equation term by term.",
      narration: "Walk Q against K first. Then the scaling. Then the value mix.",
      archetype: "equation-walk",
      seconds: 11,
      params: {
        headline: "Similarity, scaled, then mixed",
        equationId: "eq-attn",
        terms: [
          { tex: "QK^{\\top}", label: "query-key similarity", tone: "a" },
          { tex: "\\sqrt{d_k}", label: "scale, to keep softmax out of saturation", tone: "b" },
        ],
      },
    },
  ],
});

/** A cue list that covers its segment, the shape edge-tts produces. */
function cues(seconds: number, text: string): Cue[] {
  return [{ start: 0, end: seconds, text }];
}

const narration: DeckNarration = {
  voice: "en-US-AndrewMultilingualNeural",
  dir: "audio",
  beats: {
    b1: [
      {
        stop: 0,
        text: "Attention is all you need.",
        audio: "a.mp3",
        seconds: 4,
        cues: cues(4, "Attention is all you need."),
      },
    ],
    b2: [
      {
        stop: 0,
        text: "Walk Q against K first.",
        audio: "b.mp3",
        seconds: 3,
        cues: cues(3, "Walk Q against K first."),
      },
      {
        stop: 1,
        text: "Then the scaling.",
        audio: "c.mp3",
        seconds: 2.5,
        cues: cues(2.5, "Then the scaling."),
      },
    ],
  },
};

const html = emitComposition(storyboard, source, format("deck-16x9"), { narration });

/* ------------------------------------------------------------------ Reading */

describe("reading the composition back", () => {
  it("finds every scene window the emitter wrote", () => {
    const scenes = readSceneWindows(html);
    expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    // The first scene starts at zero and the second starts where it ends: the
    // deck is a contiguous run of scenes, not a set of islands with gaps.
    expect(scenes[0]?.start).toBe(0);
    expect(scenes[1]?.start).toBeCloseTo(scenes[0]?.duration ?? 0, 3);
  });

  it("reads the deck's own total, not the sum of the parts", () => {
    const scenes = readSceneWindows(html);
    const summed = scenes.reduce((n, s) => n + s.duration, 0);
    expect(readDuration(html)).toBeCloseTo(summed, 2);
  });

  it("throws on something that is not one of our compositions", () => {
    expect(() => readDuration("<html><body>hello</body></html>")).toThrow(/data-duration/);
  });

  it("returns the island's fragments for a navigable format and null for a linear one", () => {
    const fragments = readFragments(html);
    expect(fragments).not.toBeNull();
    expect(Object.keys(fragments ?? {})).toEqual(["s1", "s2"]);
    const linear = emitComposition(storyboard, source, format("video-16x9"), { narration });
    expect(readFragments(linear)).toBeNull();
  });
});

/* ------------------------------------------------------------------ Staging */

describe("planTiming", () => {
  const timing = planTiming({
    storyboard,
    source,
    format: format("deck-16x9"),
    speed: 1,
    composition: html,
    narration,
  });

  it("agrees with the island about where every scene holds", () => {
    // planTiming asserts this internally; assert it again from the outside so a
    // regression cannot be hidden by the assertion being skipped.
    const fragments = readFragments(html) ?? {};
    for (const scene of timing.scenes) {
      const absolute = scene.holds.map((h) => Math.round((scene.start + h) * 1000) / 1000);
      expect(absolute).toEqual([...new Set(fragments[scene.id] ?? [])].sort((a, b) => a - b));
    }
  });

  it("gives a linear format the same staging as the navigable one", () => {
    // A video format carries no island, so it takes the unchecked path. If the
    // two ever diverge, every sentence in every short lands on a wrong frame.
    const linear = planTiming({
      storyboard,
      source,
      format: format("video-16x9"),
      speed: 1,
      composition: emitComposition(storyboard, source, format("video-16x9"), { narration }),
      narration,
    });
    expect(linear.scenes.map((s) => s.holds)).toEqual(timing.scenes.map((s) => s.holds));
    expect(linear.segments.map((s) => s.start)).toEqual(timing.segments.map((s) => s.start));
  });

  it("scales the holds with --speed, so audio still lands on its reveal", () => {
    const slow = planTiming({
      storyboard,
      source,
      format: format("deck-16x9"),
      speed: 2,
      composition: emitComposition(storyboard, source, format("deck-16x9"), {
        narration,
        speed: 2,
      }),
      narration,
      theme: storyboard.theme,
    });
    const fast = timing.scenes[0]?.holds[0] ?? 0;
    expect(slow.scenes[0]?.holds[0]).toBeCloseTo(fast * 2, 3);
  });

  /**
   * A DERIVED speed is never a round number, and two rounding bugs lived on that
   * path until one was derived. `pace` kept holds at four decimals while the
   * island and the scene divs publish three, so `assertHoldsAgree` compared
   * 87.200 against 87.199; and `assertFits` compared a full-precision `need`
   * against a duration already quantised to three decimals. Either one threw,
   * `build` wrote no timing.json, `render` refused — and every gate reported PASS.
   *
   * Swept rather than spot-checked because which speeds land on a rounding
   * boundary is not something to reason about: the demo's failure was at 0.417
   * and nowhere near it.
   */
  it("writes a manifest at every derived speed, not just the round ones", () => {
    for (let speed = 0.25; speed <= 1.0001; speed += 0.001) {
      const s = Math.round(speed * 1000) / 1000;
      expect(
        () =>
          planTiming({
            storyboard,
            source,
            format: format("deck-16x9"),
            speed: s,
            composition: emitComposition(storyboard, source, format("deck-16x9"), {
              narration,
              speed: s,
            }),
            narration,
            theme: storyboard.theme,
          }),
        `speed ${s}`,
      ).not.toThrow();
    }
  });

  it("names each segment by the stop it speaks at", () => {
    expect(timing.segments.map((s) => s.id)).toEqual(["s1.0", "s2.0", "s2.1"]);
  });

  it("refuses a composition whose scene count does not match the storyboard", () => {
    expect(() =>
      planTiming({
        storyboard,
        source,
        format: format("deck-16x9"),
        speed: 1,
        composition: emitComposition(
          storyboardSchema.parse({
            ...storyboard,
            beats: [storyboard.beats[0]],
          }),
          source,
          format("deck-16x9"),
        ),
      }),
    ).toThrow(/scenes but 2 beats/);
  });

  it("takes the beat list from the cut rather than re-deriving it", () => {
    // THE SEAM. `planTiming` used to re-derive the drawn beats with the flat
    // weight threshold, which was the same list only while the threshold was the
    // only thing that cut. Now a format can also cut to its own LENGTH, so the
    // threshold predicts the wrong beats and the manifest would index audio by
    // the wrong scene — every sentence on the wrong picture, and no gate here
    // can see it. Two assertions: it fails loudly without the list, and it
    // agrees with the composition when given it.
    const long = storyboardSchema.parse({
      ...storyboard,
      beats: [0, 1, 2, 3, 4, 5].map((n) => ({
        ...storyboard.beats[n % 2],
        id: `x${n}`,
        weight: 0.9,
        seconds: 40,
      })),
    });
    const short = format("short-9x16");
    const cut = planCut(long, source, short);
    const composition = emitComposition(long, source, short);
    expect(cut.kept.length).toBeLessThan(long.beats.length);

    expect(() =>
      planTiming({ storyboard: long, source, format: short, speed: 1, composition }),
    ).toThrow(/Pass `beats` from `emitDeck`'s cut/);
    const timed = planTiming({
      storyboard: long,
      source,
      format: short,
      speed: 1,
      composition,
      beats: cut.kept,
    });
    expect(timed.scenes).toHaveLength(cut.kept.length);
  });

  it("carries no audio directory when the deck is silent", () => {
    const silent = planTiming({
      storyboard,
      source,
      format: format("deck-16x9"),
      speed: 1,
      composition: emitComposition(storyboard, source, format("deck-16x9")),
    });
    expect(silent.segments).toEqual([]);
    expect(silent.audioDir).toBe("");
  });
});

describe("assertHoldsAgree", () => {
  const scene: TimedScene = { id: "s1", start: 0, duration: 10, holds: [2, 4], open: 0 };

  it("passes when the emitter and the island say the same thing", () => {
    expect(() => assertHoldsAgree([scene], { s1: [2, 4] })).not.toThrow();
    // Order and duplicates are the island's business, not a disagreement.
    expect(() => assertHoldsAgree([scene], { s1: [4, 2, 2] })).not.toThrow();
  });

  it("throws when they do not, rather than aiming audio at the wrong frames", () => {
    expect(() => assertHoldsAgree([scene], { s1: [2, 5] })).toThrow(/staging disagrees/);
    expect(() => assertHoldsAgree([scene], { s1: [2] })).toThrow(/staging disagrees/);
  });
});

/* ---------------------------------------------------------------- Placement */

describe("place", () => {
  const scene: TimedScene = { id: "s1", start: 10, duration: 40, holds: [1.5, 3, 4.5], open: 0 };
  const spoken = {
    s1: [
      { stop: 0, text: "", audio: "a.mp3", seconds: 5, cues: [] },
      { stop: 1, text: "", audio: "b.mp3", seconds: 6, cues: [] },
      { stop: 2, text: "", audio: "c.mp3", seconds: 7, cues: [] },
    ],
  };

  /**
   * WAS "starts each segment on its own reveal, once the earlier freezes are in",
   * pinning `[11.5, 18, 25.5]` — each sentence anchored to its hold, with the
   * earlier freezes pushed in front of it.
   *
   * That is the arithmetic that made the shipped 60-second deck 49% silent, and
   * 93% of that silence sat astride the cut between slides: the voice waited out
   * every scene's entrance and then stopped while the beat finished building.
   * Sentences now run back to back from the moment the headline lands, and the
   * picture is not waited for.
   */
  it("runs the sentences back to back from the moment the headline lands", () => {
    const placed = place([{ ...scene, open: 0.9 }], spoken);
    // Scene starts at 10, headline lands at 0.9, sentences are 5s, 6s, 7s.
    expect(placed.map((s) => s.start)).toEqual([10.9, 15.9, 21.9]);
    // `hold` still says which reveal each sentence speaks over — it is what
    // `assertFits` checks the placement against, and the two are now derived from
    // genuinely different things.
    expect(placed.map((s) => s.hold)).toEqual([11.5, 13, 14.5]);
  });

  it("leaves no gap between one sentence and the next", () => {
    // The whole point: continuous speech. Any gap here is dead air a viewer hears.
    const placed = place([{ ...scene, open: 0.9 }], spoken);
    for (let i = 1; i < placed.length; i++) {
      const previous = placed[i - 1] as (typeof placed)[number];
      expect(placed[i]?.start).toBeCloseTo(previous.start + previous.duration, 9);
    }
  });

  it("never overlaps two sentences", () => {
    const placed = place([scene], spoken);
    for (let i = 1; i < placed.length; i++) {
      const previous = placed[i - 1] as (typeof placed)[number];
      expect(placed[i]?.start).toBeGreaterThanOrEqual(previous.start + previous.duration - 1e-9);
    }
  });

  it("keeps the last sentence inside its own scene", () => {
    const placed = place([scene], spoken);
    const last = placed[placed.length - 1] as (typeof placed)[number];
    expect(last.start + last.duration).toBeLessThanOrEqual(scene.start + scene.duration);
  });

  it("speaks a stop the staging does not have over the final state", () => {
    // A deck narrated for one format and built for another whose staging has
    // fewer reveals. Dropping the sentence would lose what the author wrote.
    const placed = place([scene], {
      s1: [{ stop: 9, text: "", audio: "z.mp3", seconds: 3, cues: [] }],
    });
    expect(placed[0]?.hold).toBe(14.5);
  });

  it("refuses to place a sentence on a scene that never holds", () => {
    expect(() =>
      place([{ id: "s1", start: 0, duration: 10, holds: [], open: 0 }], {
        s1: [{ stop: 0, text: "", audio: "a.mp3", seconds: 3, cues: [] }],
      }),
    ).toThrow(/no hold to speak at/);
  });

  it("leaves a silent scene alone", () => {
    expect(place([scene], {})).toEqual([]);
  });
});

describe("assertFits", () => {
  const scene: TimedScene = { id: "s1", start: 0, duration: 10, holds: [2], open: 0.9 };

  it("passes the exact fit beatSeconds produces", () => {
    // `beatSeconds` sizes a narrated beat at `open + spoken + SETTLE`, so the
    // ordinary case is equality, and equality must not read as overflow.
    const segments = place([scene], {
      s1: [{ stop: 0, text: "", audio: "a.mp3", seconds: 9.1, cues: [] }],
    });
    expect(() => assertFits([scene], segments)).not.toThrow();
  });

  it("fails loudly rather than truncating a sentence", () => {
    const segments = place([scene], {
      s1: [{ stop: 0, text: "", audio: "a.mp3", seconds: 9.5, cues: [] }],
    });
    expect(() => assertFits([scene], segments)).toThrow(/the video is not stretched to fit/);
  });

  /**
   * THE CHECK THAT REPLACES A GUARANTEE. While the picture was frozen at the hold
   * a sentence spoke over, sync was true by construction and unfalsifiable. The
   * speech clock gives that up, so it has to be asserted — and the assertion is
   * only worth having because its two sides come from genuinely different places:
   * `hold` from `emitScene` via `holdsFor`, `start` from the measured mp3 lengths.
   */
  it("refuses a sentence that ends before the reveal it speaks over appears", () => {
    // Hand-built rather than placed, because `speechPlan` now makes this
    // impossible to construct — which is the point of it. What is left for the
    // check to catch is a manifest that DISAGREES with the composition: narration
    // re-cut after the deck was built, or a deck narrated for one format and
    // built for another whose staging is deeper. Both put every sentence of a
    // beat on the wrong picture, and nothing downstream can see it.
    const deep: TimedScene = { id: "s1", start: 0, duration: 20, holds: [1, 12], open: 0.5 };
    const stale = [
      {
        id: "s1.0",
        scene: "s1",
        stop: 0,
        audio: "a.mp3",
        hold: 1,
        start: 0.5,
        duration: 2,
        cues: [],
      },
      {
        id: "s1.1",
        scene: "s1",
        stop: 1,
        audio: "b.mp3",
        hold: 12,
        start: 2.5,
        duration: 3,
        cues: [],
      },
    ];
    // Sentence two runs 2.5-5.5s but speaks over a reveal at 12s — the voice
    // would describe a picture that is still six and a half seconds away.
    expect(() => assertFits([deep], stale)).toThrow(/cannot see yet/);
  });

  it("makes a later sentence wait for its own reveal when the build is slow", () => {
    // The other half of the same rule, and the reason the case above can only be
    // reached by a stale manifest. `--speed 2` slows the animation without
    // shortening the narration, so the voice would otherwise run ahead of the
    // picture. It waits instead, and the gap is motion worth watching.
    const deep: TimedScene = { id: "s1", start: 0, duration: 20, holds: [1, 12], open: 0.5 };
    const placed = place([deep], {
      s1: [
        { stop: 0, text: "", audio: "a.mp3", seconds: 2, cues: [] },
        { stop: 1, text: "", audio: "b.mp3", seconds: 3, cues: [] },
      ],
    });
    expect(placed.map((s) => s.start)).toEqual([0.5, 12]);
    expect(() => assertFits([deep], placed)).not.toThrow();
  });

  it("still speaks a clamped stop late over the finished picture", () => {
    // `place` deliberately clamps a surplus stop onto the last hold rather than
    // dropping the sentence. That degradation is documented and must not become a
    // hard failure, so the check exempts the final segment.
    const segments = place([scene], {
      s1: [{ stop: 9, text: "", audio: "z.mp3", seconds: 3, cues: [] }],
    });
    expect(() => assertFits([scene], segments)).not.toThrow();
  });
});

/* --------------------------------------------------------------- Frame plan */

/** A two-scene deck: 10s then 20s, holding at 2s and at 4s/8s. */
const timing: Timing = {
  version: 1,
  width: 1920,
  height: 1080,
  duration: 30,
  lang: "en",
  audioDir: "audio",
  voice: "v",
  scenes: [
    { id: "s1", start: 0, duration: 10, holds: [2], open: 0 },
    { id: "s2", start: 10, duration: 20, holds: [4, 8], open: 0 },
  ],
  segments: [
    {
      id: "s1.0",
      scene: "s1",
      stop: 0,
      audio: "a.mp3",
      hold: 2,
      start: 2,
      duration: 4,
      cues: [{ start: 0, end: 4, text: "one" }],
    },
    {
      id: "s2.0",
      scene: "s2",
      stop: 0,
      audio: "b.mp3",
      hold: 14,
      start: 14,
      duration: 5,
      cues: [{ start: 0, end: 5, text: "two" }],
    },
    {
      id: "s2.1",
      scene: "s2",
      stop: 1,
      audio: "c.mp3",
      hold: 18,
      start: 23,
      duration: 6,
      cues: [{ start: 0, end: 6, text: "three" }],
    },
  ],
};

describe("framePlan", () => {
  const plan = framePlan(timing, 30);

  it("produces exactly as many frames as the composition claims", () => {
    // This is the assertion that keeps the video its own length. Anything else
    // means the retimed cut and the audio track disagree about when the deck
    // ends, and every later sentence is off by the difference.
    expect(plan.frames).toBe(30 * 30);
  });

  /**
   * WAS two tests pinning the freeze model — motion to each hold, then a clone
   * of that frame for the length of the sentence, then a tail taken from the
   * END of the scene rather than from the source cursor.
   *
   * All of that existed because speech and motion were CONSECUTIVE: the picture
   * had to wait for the voice, and waiting costs frames, because per scene the
   * output owes `last - first` and `out = shown + freeze`, so `dropped ==
   * freeze` always. They overlap now, `beatSeconds` sizes every scene to hold
   * both, and a freeze that is not needed is a stretch of this beat's own
   * picture thrown away for nothing.
   *
   * The tail's anchoring — the assertion that mattered here, because reading the
   * source cursor instead of the scene's end silently deleted a camera dive and
   * shipped it — is now true by construction rather than by arithmetic: one
   * piece spans the whole scene, so every source frame plays, in order, dive
   * included. That is checked below on a real dive.
   */
  it("plays every scene straight through, freezing nothing", () => {
    expect(plan.pieces).toEqual([
      { from: 0, motion: 300, freeze: 0 },
      { from: 300, motion: 600, freeze: 0 },
    ]);
    // `retime` skips the re-encode entirely when nothing freezes, so this is
    // also what makes a narrated render the capture itself with audio muxed on.
    expect(plan.pieces.every((p) => p.freeze === 0)).toBe(true);
  });

  it("puts the audio where `place` said, not where the reveal is", () => {
    // THE BUG THIS REPLACED. framePlan ignored `segment.start` and re-derived
    // the audio position by playing the video to `segment.hold`. On the shipped
    // 60-second deck the manifest said the voice began at 0.375s and it actually
    // began at 0.64-1.53s — 6.03s of silence the overlap work was supposed to
    // have removed, and the reason the model said 16% while the audio measured
    // 30%. `place` owns the speech clock; there is no second opinion.
    expect(plan.audio.map((a) => a.startFrame)).toEqual(
      timing.segments.map((s) => Math.round(s.start * 30)),
    );
  });

  it("renders every frame of a camera dive parked in a scene's tail", () => {
    // The regression above, stated as the thing a reader actually cares about:
    // a scene whose window is lastHold + spoken + diveTail must put the dive's
    // own source frames on screen. 3s hold, 5s of speech, a 1.8s dive.
    const camera: Timing = {
      ...timing,
      duration: 9.8,
      scenes: [{ id: "s1", start: 0, duration: 9.8, holds: [1, 3], open: 0 }],
      segments: [
        {
          id: "s1.0",
          scene: "s1",
          stop: 0,
          audio: "a.mp3",
          hold: 1,
          start: 1,
          duration: 2,
          cues: [],
        },
        {
          id: "s1.1",
          scene: "s1",
          stop: 1,
          audio: "b.mp3",
          hold: 3,
          start: 3,
          duration: 5,
          cues: [],
        },
      ],
    };
    const shown = new Set<number>();
    for (const piece of framePlan(camera, 30).pieces) {
      for (let i = 0; i < piece.motion; i++) shown.add(piece.from + i);
    }
    // The dive occupies the last 1.8s: frames 240..294.
    for (let f = 240; f < 294; f++) expect(shown.has(f)).toBe(true);
  });

  it("delays each segment to the frame its reveal lands on in the output", () => {
    expect(plan.audio.map((a) => a.startFrame)).toEqual([60, 420, 690]);
    expect(plan.audio.map((a) => a.delayMs)).toEqual([2000, 14_000, 23_000]);
  });

  it("puts the cues on the output clock, not on the segment's", () => {
    expect(plan.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [2, 6, "one"],
      [14, 19, "two"],
      [23, 29, "three"],
    ]);
  });

  it("stays exact at a broadcast frame rate that is not an integer", () => {
    const ntsc = framePlan(timing, 30000 / 1001);
    expect(ntsc.frames).toBe(
      timing.scenes.reduce(
        (n, s) =>
          n +
          Math.round((s.start + s.duration) * (30000 / 1001)) -
          Math.round(s.start * (30000 / 1001)),
        0,
      ),
    );
  });

  it("refuses a frame rate that is not one", () => {
    expect(() => framePlan(timing, 0)).toThrow(/bad frame rate/);
  });

  it("throws when the freezes overrun the scene rather than producing a short video", () => {
    const tight: Timing = {
      ...timing,
      scenes: [{ id: "s1", start: 0, duration: 5, holds: [2], open: 0 }],
      segments: [{ ...(timing.segments[0] as Timing["segments"][number]), duration: 9 }],
    };
    expect(() => framePlan(tight, 30)).toThrow(/does not fit/);
  });

  it("keeps two sentences clamped onto one reveal in sequence", () => {
    // Two segments on the same hold used to need special handling: each one
    // asked for the motion up to its hold, and the second one's was zero, which
    // is an empty stream the concat cannot join. Nothing freezes now, so the
    // case is ordinary — what still has to hold is that the two sentences do not
    // overlap in the output, because `audioGraph` mixes rather than trims and
    // two voices at once is audible on the first play.
    const doubled: Timing = {
      version: 1,
      width: 1920,
      height: 1080,
      duration: 10,
      lang: "en",
      audioDir: "audio",
      voice: "v",
      scenes: [{ id: "s1", start: 0, duration: 10, holds: [2], open: 0 }],
      segments: [
        {
          id: "s1.0",
          scene: "s1",
          stop: 0,
          audio: "a.mp3",
          hold: 2,
          start: 2,
          duration: 3,
          cues: [],
        },
        {
          id: "s1.1",
          scene: "s1",
          stop: 1,
          audio: "b.mp3",
          hold: 2,
          start: 5,
          duration: 4,
          cues: [],
        },
      ],
    };
    const folded = framePlan(doubled, 30);
    expect(folded.pieces).toEqual([{ from: 0, motion: 300, freeze: 0 }]);
    expect(folded.audio.map((a) => a.startFrame)).toEqual([60, 150]);
    // The second starts exactly where the first ends: 60 + 3s×30 = 150.
    expect(folded.audio[1]?.startFrame).toBe(
      (folded.audio[0]?.startFrame ?? 0) + (doubled.segments[0]?.duration ?? 0) * 30,
    );
    expect(folded.frames).toBe(300);
  });

  it("leaves an un-narrated deck as one whole piece per scene", () => {
    // No freezes at all is the signal `render` uses to skip the re-encode
    // entirely, so it has to be reachable.
    const silent: Timing = { ...timing, segments: [] };
    const plain = framePlan(silent, 30);
    expect(plain.pieces).toEqual([
      { from: 0, motion: 300, freeze: 0 },
      { from: 300, motion: 600, freeze: 0 },
    ]);
    expect(plain.frames).toBe(900);
  });

  /**
   * THE DEFECT A HUMAN FOUND BY WATCHING THE MP4: a six-stage pipeline showed
   * its first stage, froze for the whole sentence, then JUMPED to the assembled
   * diagram. The owner described it as "sudden showing all other three blocks at
   * once". It was 98 of 195 source frames unplayed with all six holds inside the
   * gap, and every gate was green — `lint`, `check`, the type floor, and `drift`
   * twice over, because both renders were identically frozen.
   *
   * The numbers are the real ones: a six-stage pipeline's holds paced by
   * `animationSpeed: 0.417`, which is what `durationPlan` derives for 60s over
   * twelve slides, and one 3.25s sentence at stop 0, which is what
   * `narration.density: low` produces.
   *
   * ASSERTED AS A PROPERTY, not as a piece list. `dropped == freeze` holds for
   * every arrangement, so the count of skipped frames is not the defect and
   * pinning it would pass for the wrong reason. What must be true is that the
   * dropped frames are the interchangeable stills AFTER the last reveal — so
   * every frame up to the settled diagram is on screen, and the beat never skips
   * a stage.
   */
  it("plays every reveal, and pays the last freeze out of the dead tail", () => {
    const holds = [0.5, 1.04, 1.58, 2.13, 2.67, 3.25];
    const spoken = 3.25;
    const duration = (holds[5] as number) + spoken;
    const pipeline: Timing = {
      ...timing,
      duration,
      scenes: [{ id: "s1", start: 0, duration, holds, open: 0 }],
      segments: [
        {
          id: "s1.0",
          scene: "s1",
          stop: 0,
          audio: "a.mp3",
          hold: holds[0] as number,
          start: holds[0] as number,
          duration: spoken,
          cues: [],
        },
      ],
    };

    const built = framePlan(pipeline, 30);
    const played = new Set<number>();
    for (const piece of built.pieces)
      for (let i = 0; i < piece.motion; i++) played.add(piece.from + i);

    // Every frame up to the settled diagram is on screen. `holds` is
    // tween-end + 0.05s, so the frame one before the last hold has the final
    // stage fully drawn — which is why the bound is exclusive.
    const settled = Math.round((holds[5] as number) * 30);
    for (let frame = 0; frame < settled; frame++) {
      expect(played.has(frame), `source frame ${frame} is never shown`).toBe(true);
    }

    // The output still owes the composition exactly its own length, and the
    // audio has not moved by a single millisecond — the picture was the only
    // thing wrong.
    expect(built.frames).toBe(Math.round(duration * 30));
    expect(built.audio.map((a) => a.delayMs)).toEqual([500]);
  });
});

/* ---------------------------------------------------------------- Subtitles */

describe("subtitlePlan", () => {
  it("ships the sidecar and burns nothing, for every format", () => {
    // THE DEFAULT, and the point of it: a burned-in band is a decision taken
    // away from the viewer, and the frame the owner opened had one over the
    // bottom of a diagram. There is no canvas that changes this answer — the old
    // rule burned on anything vertical or square, which is precisely the shape
    // whose diagrams have the least room to give away.
    expect(subtitlePlan("sidecar")).toEqual({ sidecar: true, burn: false });
    expect(subtitlePlan("auto")).toEqual({ sidecar: true, burn: false });
  });

  it("burns only when someone typed burn", () => {
    expect(subtitlePlan("burn")).toEqual({ sidecar: true, burn: true });
  });

  it("means none, including the sidecar", () => {
    // `none` used to still write the .srt, which was harmless while the sidecar
    // was the thing nobody got. Now it is the default, so this is the only way
    // to ask for a bare mp4 and it has to actually deliver one.
    expect(subtitlePlan("none")).toEqual({ sidecar: false, burn: false });
  });

  it("takes no notice of the canvas at all", () => {
    // The old decision read timing.width <= timing.height. Nothing pure is left
    // that could: the plan is a function of one argument, which is the change.
    expect(subtitlePlan.length).toBe(1);
  });
});

/* ---------------------------------------------------------- Playback ceiling */

/**
 * The measured case: a 128.40s composition asked to reach 60s, which is 2.14×.
 *
 * One cue at 59 characters over 3 seconds puts the p95 at 19.67 cps, which is
 * what the deck this was found on actually measures — a deck already denser
 * than broadcast practice at 1×, like every deck this tool plans.
 */
const overlong = (): Timing => ({
  version: 1,
  width: 1920,
  height: 1080,
  duration: 128.4,
  lang: "en",
  audioDir: "audio",
  voice: "en-US-AndrewMultilingualNeural",
  scenes: [{ id: "s1", start: 0, duration: 128.4, holds: [1], open: 0.9 }],
  segments: [
    {
      id: "s1.0",
      scene: "s1",
      stop: 0,
      audio: "s1.0.mp3",
      hold: 1,
      start: 1,
      duration: 3,
      cues: [{ start: 0, end: 3, text: "x".repeat(59) }],
    },
  ],
});

/** A deck directory holding nothing but the manifest, which is the point. */
async function manifestOnly(timing: Timing): Promise<string> {
  const deck = await mkdtemp(join(tmpdir(), "ds-playback-"));
  await writeFile(join(deck, "timing.json"), JSON.stringify(timing));
  return deck;
}

/**
 * `--video` points at a file that is not there, so anything downstream of the
 * check fails at `probe`. That is the assertion: the refusal has to be
 * reachable with no capture, no browser and no video on disk — the old one sat
 * after capture, retime AND mux, so it could only ever be delivered an hour
 * late, on top of a file it had just spent that hour making.
 */
async function renderFailure(opts: { targetSeconds: number; allowFastPlayback?: boolean }) {
  const deck = await manifestOnly(overlong());
  const lines: string[] = [];
  const message = await render({
    deck,
    out: join(deck, "out.mp4"),
    video: join(deck, "never-captured.mp4"),
    log: (line) => lines.push(line),
    ...opts,
  }).then(
    () => "resolved, which it must not",
    (err: Error) => err.message,
  );
  return { message, lines };
}

describe("the playback ceiling", () => {
  it("refuses an unreachable --duration before a single frame is captured", async () => {
    const { message, lines } = await renderFailure({ targetSeconds: 60 });
    expect(message).toContain("2.14× playback");
    expect(message).toContain("1.25× ceiling");
    expect(message).toContain("plan --duration 60");
    expect(message).toContain("103s or more");
    // Nothing was logged, because nothing was done yet.
    expect(lines).toEqual([]);
  });

  it("does not refuse a target this deck can actually reach", async () => {
    // 103s is 1.247×, inside the ceiling. It gets as far as the missing video,
    // which is exactly as far as it should.
    const { message } = await renderFailure({ targetSeconds: 103 });
    expect(message).not.toContain("1.25× ceiling");
  });

  it("lets --allow-fast-playback past, since the ceiling is a bar and not a wall", async () => {
    const { message } = await renderFailure({ targetSeconds: 60, allowFastPlayback: true });
    expect(message).not.toContain("1.25× ceiling");
  });
});

describe("srtTime", () => {
  it("writes SubRip's clock, comma decimal and all", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(1.904)).toBe("00:00:01,904");
    expect(srtTime(3671.5)).toBe("01:01:11,500");
  });

  it("never emits a negative time", () => {
    expect(srtTime(-1)).toBe("00:00:00,000");
  });
});

describe("wrap", () => {
  it("leaves a line that already fits", () => {
    expect(wrap("short enough")).toBe("short enough");
  });

  it("breaks at the word boundary nearest the middle", () => {
    const text = "The model reads every token at once and nothing at all recurs here";
    const [a, b] = wrap(text).split("\n");
    expect(`${a} ${b}`).toBe(text);
    expect(Math.abs((a?.length ?? 0) - (b?.length ?? 0))).toBeLessThan(12);
  });

  it("never breaks a single long word", () => {
    const word = "x".repeat(90);
    expect(wrap(word)).toBe(word);
  });

  it("produces at most two lines, which is what the burn-in band is sized for", () => {
    const text = "a ".repeat(41).trim(); // 81 characters, just under splitCue's cap
    expect(wrap(text).split("\n")).toHaveLength(2);
  });
});

describe("toSrt", () => {
  it("numbers from one and separates blocks with a blank line", () => {
    const srt = toSrt([
      { start: 0, end: 1, text: "one" },
      { start: 1, end: 2, text: "two" },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\none\n\n2\n00:00:01,000 --> 00:00:02,000\ntwo\n",
    );
  });

  it("clips an overlap rather than putting two captions on screen at once", () => {
    // edge-tts has been seen to end a cue a frame after the next one begins,
    // and a burned-in band cannot survive two lines stacked on each other.
    const srt = toSrt([
      { start: 0, end: 2.04, text: "one" },
      { start: 2, end: 4, text: "two" },
    ]);
    expect(srt).toContain("00:00:02,040 --> 00:00:04,000");
  });

  it("drops a cue with nothing left to show", () => {
    expect(toSrt([{ start: 0, end: 1, text: "   " }])).toBe("");
    expect(
      toSrt([
        { start: 0, end: 1, text: "one" },
        { start: 0.99, end: 1.01, text: "two" },
      ]),
    ).not.toContain("two");
  });
});

/* ------------------------------------------------------------------- ffmpeg */

describe("the ffmpeg arguments", () => {
  it("counts frames rather than seconds, so a cut cannot round", () => {
    expect(pieceFilter(60, 120)).toBe(
      "trim=end_frame=60,setpts=N/FRAME_RATE/TB,tpad=stop_mode=clone:stop=120",
    );
    expect(pieceFilter(60, 0)).toBe("trim=end_frame=60,setpts=N/FRAME_RATE/TB");
  });

  it("seeks the input rather than decoding from zero, half a frame in", () => {
    const args = pieceArgs("raw.mp4", 300, 60, 30, 30, "p.ts");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("10.016667");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("90");
    expect(args).toContain("mpegts");
  });

  it("pins every piece to the same encoder so the concat can copy", () => {
    expect(encoderArgs(30)).toEqual(encoderArgs(30));
    expect(encoderArgs(30)).toContain("cfr");
  });

  it("sums the segments instead of averaging them", () => {
    // amix's default normalizes by input count, which on a 37-segment deck is
    // the narration 31 dB down — indistinguishable from a broken voice.
    const graph = audioGraph(
      [
        { file: "a.mp3", delayMs: 0 },
        { file: "b.mp3", delayMs: 2000 },
      ],
      30,
    );
    expect(graph).toContain("[1:a]");
    expect(graph).toContain("[2:a]");
    expect(graph).toContain("adelay=2000:all=1");
    expect(graph).toContain("amix=inputs=2:normalize=0");
    expect(graph).toContain("apad=whole_dur=30.000");
  });

  it("shifts the audio inputs past the caption bands", () => {
    // The bands take inputs 1..n, so the mp3s start after them. Off by one here
    // and `adelay` reads a PNG: the video comes out silent with every gate green.
    const graph = audioGraph([{ file: "a.mp3", delayMs: 0 }], 30, 4);
    expect(graph).toContain("[4:a]");
    expect(graph).not.toContain("[1:a]");
  });

  it("names a burn-in font the deck's language actually has glyphs for", () => {
    expect(burnStyle(1080, 1920, "Noto Sans KR").font).toBe("Noto Sans KR");
  });
});

describe("captions", () => {
  const style = burnStyle(1080, 1920);
  const band = { files: ["a.png", "b.png"], x: 43, y: 1600, width: 994, height: 147 };
  const cues: Cue[] = [
    { start: 0, end: 2.5, text: "one\ntwo" },
    { start: 2.5, end: 4, text: "three" },
  ];

  it("gives the burn-in generous type and its own scrim", () => {
    // Sized so the widest line an 84-character cue can produce still fits on
    // ONE line. See the measurement in `burnStyle`.
    expect(style.fontSize).toBe(40);
    expect(style.marginV).toBe(173); // clear of the player chrome
    const widest = 46 * 0.485 * style.fontSize;
    expect(widest).toBeLessThan(style.width - 2 * style.marginX - 16);

    const page = captionPage(cues, style, null);
    expect(page).toContain("background: rgba(0, 0, 0, 0.7)");
    // Per LINE, as ASS's BorderStyle=4 was. One box round a block whose second
    // line is two words wide is a letterbox, not a caption.
    expect(page).toContain("box-decoration-break: clone");
    expect(page).toContain("bottom: 173px");
    expect(page).toContain("font-size: 40px");
    // The hard breaks `wrap` already chose have to survive into the layout.
    expect(page).toContain("white-space: pre-wrap");
    expect(page).toContain("one\ntwo");
  });

  it("puts the deck's own font at the head of the stack, and links its bundle", () => {
    const ko = captionPage(cues, burnStyle(1080, 1920, "Noto Sans KR"), "file:///d/fonts.css");
    expect(ko).toContain('font-family: "Noto Sans KR", "Helvetica Neue"');
    expect(ko).toContain('<link rel="stylesheet" href="file:///d/fonts.css">');
    // A quote or a backslash in the family name would close the CSS string and
    // silently reshape the page — the tofu failure, arriving as a layout bug.
    expect(captionPage(cues, burnStyle(1080, 1920, 'X", monospace; }'), null)).toContain(
      'font-family: "X, monospace; }", "Helvetica Neue"',
    );
  });

  it("escapes markup in a cue rather than rendering it", () => {
    const page = captionPage([{ start: 0, end: 1, text: "a < b & <b>c</b>" }], style, null);
    expect(page).toContain("a &lt; b &amp; &lt;b&gt;c&lt;/b&gt;");
  });

  it("gates each band to a half-open range", () => {
    const graph = overlayGraph(cues, band);
    // `between` closes both ends and `splitCue` hands over at a shared instant,
    // so every sentence boundary would show two captions for one frame.
    expect(graph).toContain("enable='gte(t,0.000)*lt(t,2.500)'");
    expect(graph).toContain("enable='gte(t,2.500)*lt(t,4.000)'");
    expect(graph).not.toContain("between(");
  });

  it("chains the overlays from the video to one output label", () => {
    const graph = overlayGraph(cues, band);
    expect(graph).toContain("[0:v][1:v]overlay=x=43:y=1600");
    expect(graph).toContain("[v1][2:v]overlay=x=43:y=1600");
    expect(graph.trimEnd().endsWith("[vout]")).toBe(true);
    // Full-resolution alpha through the blend; the default frays a 40px glyph.
    expect(graph).toContain("format=yuv444");
    expect(overlayInputs(band)).toEqual(["-i", "a.png", "-i", "b.png"]);
  });

  it("rounds a band's times to 3 decimals so float drift moves no byte", () => {
    const graph = overlayGraph([{ start: 1 / 3, end: 2 / 3, text: "x" }], band);
    expect(graph).toContain("gte(t,0.333)*lt(t,0.667)");
  });

  it("shortens a cue for a script whose characters are wider", () => {
    // 84 is two lines of 42 at Latin's 0.485em per character. Hangul advances
    // 0.80em, so 42 of them is 1,346px against a 994px band: MEASURED, the
    // Korean cue went to a third line at 64 characters and stayed on two at 60.
    expect(cueMax("plain english caption prose")).toBe(84);
    expect(cueMax("이 논문은 작게 유지되는 사고 과정을")).toBeLessThanOrEqual(60);
    expect(cueMax("これは日本語の字幕です")).toBeLessThanOrEqual(60);
    // Mixed text scales in proportion rather than falling off a cliff.
    const mixed = cueMax("인코더가 SwinIR established the style for this");
    expect(mixed).toBeGreaterThan(cueMax("이 논문은 작게 유지되는 사고 과정을"));
    expect(mixed).toBeLessThan(84);
  });

  it("wraps a Korean cue on the Korean budget, not the Latin one", () => {
    // `wrap`'s default has to track `cueMax`, or the .srt and the burned band
    // break in different places and the band is the one that overflows.
    const ko = "이 논문은 작게 유지되는 사고 과정을 아주 커다란 출력을";
    expect(wrap(ko).split("\n")).toHaveLength(2);
    for (const line of wrap(ko).split("\n")) expect(line.length).toBeLessThanOrEqual(30);
  });

  it("snaps the shared band box outwards to whole pixels", () => {
    // A fractional clip makes Chrome resample, and a resampled caption is soft.
    const box = union([
      { x: 100.4, y: 1600.6, w: 300.2, h: 60.1 },
      { x: 80.9, y: 1540.2, w: 500.5, h: 120.6 },
    ]);
    expect(box).toEqual({ x: 80, y: 1540, width: 502, height: 121 });
  });
});

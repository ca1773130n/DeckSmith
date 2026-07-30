import { describe, expect, it } from "vitest";
import {
  activeCue,
  audioSrc,
  CUE_MAX_CHARS,
  type Cue,
  type Narration,
  parseNarration,
  segmentFor,
  splitCue,
} from "../src/deck/subtitles.js";

/** The shape edge-tts actually produced: one cue per sentence, back to back. */
const cues: Cue[] = [
  { start: 0, end: 2.787, text: "Attention is all you need." },
  { start: 2.787, end: 5.4, text: "The encoder has six identical layers." },
];

const narration: Narration = {
  voice: "en-US-AriaNeural",
  dir: "audio",
  scenes: {
    s1: [{ stop: 0, audio: "s1-0.mp3", cues }],
    s2: [
      { stop: 0, audio: "s2-0.mp3", cues: [] },
      { stop: 1, audio: "s2-1.mp3", cues: [{ start: 0, end: 1, text: "Then the residual." }] },
    ],
  },
};

describe("activeCue", () => {
  it("puts a cue on screen from its start", () => {
    expect(activeCue(cues, 0)?.text).toBe("Attention is all you need.");
    expect(activeCue(cues, 1.4)?.text).toBe("Attention is all you need.");
  });

  it("hands over at the boundary without ever showing two lines", () => {
    // Half-open: the shared instant belongs to the incoming cue alone. Closing
    // both ends would double up for a frame at every sentence edge-tts emits,
    // and every boundary it emits is shared like this one.
    expect(activeCue(cues, 2.787)?.text).toBe("The encoder has six identical layers.");
    expect(activeCue(cues, 2.786)?.text).toBe("Attention is all you need.");
  });

  it("shows nothing once the last cue has ended", () => {
    // Audio usually runs a beat past the final word; the band must clear rather
    // than leave the last sentence hanging over the next reveal.
    expect(activeCue(cues, 5.4)).toBeNull();
    expect(activeCue(cues, 99)).toBeNull();
  });

  it("shows nothing in a gap between cues", () => {
    const gapped: Cue[] = [
      { start: 0, end: 1, text: "one" },
      { start: 3, end: 4, text: "two" },
    ];
    expect(activeCue(gapped, 2)).toBeNull();
    expect(activeCue(gapped, 1)).toBeNull();
    expect(activeCue(gapped, 3)?.text).toBe("two");
  });

  it("shows nothing before the first cue, or with no cues at all", () => {
    expect(activeCue([{ start: 0.5, end: 1, text: "late" }], 0)).toBeNull();
    expect(activeCue([], 0)).toBeNull();
  });
});

describe("segmentFor", () => {
  it("finds the segment for a stop by scene id and stop index", () => {
    expect(segmentFor(narration, "s1", 0)?.audio).toBe("s1-0.mp3");
    expect(segmentFor(narration, "s2", 1)?.audio).toBe("s2-1.mp3");
  });

  it("is silent for a stop, a scene, or a deck with no narration", () => {
    // Every one of these is a real deck: a beat the narrator skipped, a scene
    // added after the audio was rendered, and yesterday's silent deck.
    expect(segmentFor(narration, "s1", 1)).toBeNull();
    expect(segmentFor(narration, "s9", 0)).toBeNull();
    expect(segmentFor(null, "s1", 0)).toBeNull();
  });
});

describe("parseNarration", () => {
  it("reads the island the emitter writes", () => {
    const parsed = parseNarration(JSON.stringify(narration));
    expect(parsed?.voice).toBe("en-US-AriaNeural");
    expect(parsed?.scenes.s2?.[1]?.cues[0]?.text).toBe("Then the residual.");
  });

  it("ignores fields it does not know, so a newer emitter cannot break it", () => {
    const json = '{"voice":"v","scenes":{"s1":[{"stop":0,"audio":"a.mp3","seconds":3,"cues":[]}]}}';
    expect(parseNarration(json)?.scenes.s1?.[0]).toEqual({ stop: 0, audio: "a.mp3", cues: [] });
  });

  it("sorts cues, because the first match is the one shown", () => {
    const json =
      '{"scenes":{"s1":[{"stop":0,"audio":"a.mp3","cues":' +
      '[{"start":2,"end":3,"text":"b"},{"start":0,"end":2,"text":"a"}]}]}}';
    expect(parseNarration(json)?.scenes.s1?.[0]?.cues.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("falls silent rather than throwing on anything it cannot use", () => {
    expect(parseNarration(null)).toBeNull();
    expect(parseNarration("")).toBeNull();
    expect(parseNarration("{oops")).toBeNull();
    expect(parseNarration("[]")).toBeNull();
    expect(parseNarration('{"voice":"v"}')).toBeNull();
    expect(parseNarration('{"scenes":{}}')).toBeNull();
    // A segment with no audio file is not a segment.
    expect(parseNarration('{"scenes":{"s1":[{"stop":0}]}}')).toBeNull();
    // Nor is one at a stop that cannot exist.
    expect(parseNarration('{"scenes":{"s1":[{"stop":-1,"audio":"a.mp3"}]}}')).toBeNull();
  });

  it("drops a malformed cue and keeps the rest of the segment", () => {
    const json =
      '{"scenes":{"s1":[{"stop":0,"audio":"a.mp3","cues":' +
      '[{"start":0,"end":1,"text":"ok"},{"start":"x","end":2,"text":"bad"},{"start":5,"end":4}]}]}}';
    const seg = parseNarration(json)?.scenes.s1?.[0];
    expect(seg?.cues).toEqual([{ start: 0, end: 1, text: "ok" }]);
  });
});

describe("audioSrc", () => {
  it("hangs a bare filename off the narration's directory", () => {
    expect(audioSrc(narration, { stop: 0, audio: "s1-0.mp3", cues: [] })).toBe("audio/s1-0.mp3");
    expect(audioSrc({ ...narration, dir: "audio/" }, { stop: 0, audio: "a.mp3", cues: [] })).toBe(
      "audio/a.mp3",
    );
  });

  it("leaves a path that already resolves alone", () => {
    // A deck whose audio is hosted, or written relative to the page itself:
    // prefixing either one produces a 404 and a silent slide.
    const s = (audio: string) => audioSrc(narration, { stop: 0, audio, cues: [] });
    expect(s("https://cdn.example/a.mp3")).toBe("https://cdn.example/a.mp3");
    expect(s("/deck/a.mp3")).toBe("/deck/a.mp3");
    expect(s("./a.mp3")).toBe("./a.mp3");
    expect(audioSrc({ ...narration, dir: "" }, { stop: 0, audio: "a.mp3", cues: [] })).toBe(
      "a.mp3",
    );
  });
});

describe("splitCue", () => {
  /** The real offender from the demo deck: 121 characters on one wrapped line. */
  const long =
    "The body of the paper states a gain of 1.4611 dB where the sweep table gives 0.59 dB, " +
    "and the abstract disagrees with both.";

  it("leaves a cue that already fits alone", () => {
    const cue = { start: 1, end: 3, text: "Compact thought collides with dense output." };
    expect(splitCue(cue)).toEqual([cue]);
  });

  it("caps every piece at the two-line budget", () => {
    for (const piece of splitCue({ start: 0, end: 10, text: long })) {
      expect(piece.text.length).toBeLessThanOrEqual(CUE_MAX_CHARS);
    }
  });

  it("keeps the words, in order, and breaks only at spaces", () => {
    const pieces = splitCue({ start: 0, end: 10, text: long });
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((p) => p.text).join(" ")).toBe(long);
  });

  it("covers the original span with no gap and no overlap", () => {
    const pieces = splitCue({ start: 4, end: 14, text: long });
    expect(pieces[0]?.start).toBe(4);
    expect(pieces.at(-1)?.end).toBe(14); // exact, not within an epsilon
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i]?.start).toBe(pieces[i - 1]?.end);
    }
  });

  it("gives the longer piece the longer time", () => {
    const [a, b] = splitCue({ start: 0, end: 10, text: `${"x".repeat(80)} ${"y".repeat(20)}` });
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    expect(a.end - a.start).toBeGreaterThan(b.end - b.start);
  });

  it("does not break a single word that is longer than the budget", () => {
    const word = "s".repeat(CUE_MAX_CHARS + 20);
    expect(splitCue({ start: 0, end: 2, text: word })).toEqual([{ start: 0, end: 2, text: word }]);
  });

  /**
   * The one that was actually on screen: 90 characters, so greedy packing put
   * 81 of them in the first piece and left "pipeline." alone for 0.57s. Six of
   * the demo's cues did this. Both sides are pinned — the piece count must not
   * grow to buy the balance, and no piece may be a scrap.
   */
  it("splits an over-long cue evenly instead of orphaning the tail", () => {
    const text =
      "That loop is a single tick, and it runs in place rather than around the whole pipeline.";
    const pieces = splitCue({ start: 0, end: 10, text });
    expect(pieces.length).toBe(2); // not one caption more than greedy needed
    expect(pieces.map((p) => p.text).join(" ")).toBe(text);
    for (const piece of pieces) {
      expect(piece.text.length).toBeLessThanOrEqual(CUE_MAX_CHARS);
      // A caption on screen for a fifth of its cue is a flash, not a caption.
      expect(piece.end - piece.start).toBeGreaterThan(2);
    }
  });

  it("splits on the way in, so an old deck is fixed by reloading it", () => {
    const parsed = parseNarration(
      JSON.stringify({
        voice: "v",
        dir: "audio",
        scenes: { s1: [{ stop: 0, audio: "a.mp3", cues: [{ start: 0, end: 6, text: long }] }] },
      }),
    );
    const got = parsed?.scenes.s1?.[0]?.cues ?? [];
    expect(got.length).toBeGreaterThan(1);
    expect(got.every((c) => c.text.length <= CUE_MAX_CHARS)).toBe(true);
  });
});

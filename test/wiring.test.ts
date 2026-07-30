/**
 * The seams between the five layers, asserted where they actually meet.
 *
 * Each of `prefs`, `themes`, `narrate`, `pack` and the step layer is tested on
 * its own elsewhere. What is only observable here is whether they were joined
 * correctly: whether a theme name reaches a palette, whether a speed multiplier
 * reaches both the tweens and the slide windows, and whether narration keyed by
 * beat id comes out keyed by scene id with its audio in the right place. Every
 * one of those is a place where two agents could both be right and the deck
 * still be broken.
 *
 * Nothing here touches the network: narration is a hand-written fixture in the
 * exact shape `narrate` returns.
 */
import { describe, expect, it } from "vitest";
import {
  DECK_PAGE,
  type DeckNarration,
  emitComposition,
  emitDeck,
} from "../src/emit/composition.js";
import { THEME_NAMES } from "../src/emit/theme.js";
import {
  FORMATS,
  type Format,
  narrationSchema,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";
import { scanNarration } from "../src/verify/index.js";

function format(id: string): Format {
  const f = FORMATS[id];
  if (!f) throw new Error(`no format "${id}"`);
  return f;
}

const source = sourceSchema.parse({
  id: "src-1",
  title: "A source",
  lang: "en",
  sections: [{ id: "sec-1", depth: 1, heading: "One", text: "..." }],
  figures: [],
  equations: [],
  tables: [],
});

const storyboard = storyboardSchema.parse({
  sourceId: "src-1",
  title: "A deck",
  beats: [
    {
      id: "b1",
      intent: "Open.",
      archetype: "title",
      seconds: 6,
      params: { headline: "Opening" },
    },
    {
      id: "b2",
      intent: "Show the shape of the method.",
      narration: "First the encoder. Then the ticks. Then the decoder.",
      archetype: "pipeline",
      seconds: 12,
      params: {
        headline: "End to end",
        stages: [{ label: "encode" }, { label: "tick" }, { label: "decode" }],
      },
    },
  ],
});

const deck = format("deck-16x9");

/** Every scene wrapper's window, in emission order. */
function windows(doc: string): { sid: string; start: number; duration: number }[] {
  const re = /<div\s+id="(s\d+)"[^>]*?data-start="([\d.]+)"[^>]*?data-duration="([\d.]+)"/g;
  return [...doc.matchAll(re)].map(([, sid = "", start = "", duration = ""]) => ({
    sid,
    start: Number(start),
    duration: Number(duration),
  }));
}

function narrationIsland(page: string): {
  voice: string;
  dir: string;
  scenes: Record<string, Array<{ stop: number; audio: string; seconds: number }>>;
} | null {
  const m = page.match(
    /<script type="application\/decksmith-narration\+json">([\s\S]*?)<\/script>/,
  );
  return m ? JSON.parse(m[1] ?? "") : null;
}

/* ------------------------------------------------------------------- themes */

describe("theme wiring", () => {
  it("renders every registered theme", () => {
    for (const name of THEME_NAMES) {
      const html = emitComposition(storyboard, source, deck, { theme: name });
      expect(html).toContain("<!doctype html>");
    }
  });

  it("names the ones that exist when given one that does not", () => {
    expect(() => emitComposition(storyboard, source, deck, { theme: "puce" })).toThrow(
      /unknown theme "puce" — known: /,
    );
  });

  it("uses the storyboard's theme when nothing overrides it", () => {
    const paper = { ...storyboard, theme: "paper" };
    expect(emitComposition(paper, source, deck)).toBe(
      emitComposition(storyboard, source, deck, { theme: "paper" }),
    );
  });

  it("overrides the storyboard's theme when told to", () => {
    const paper = { ...storyboard, theme: "paper" };
    expect(emitComposition(paper, source, deck, { theme: "ink" })).toBe(
      emitComposition(storyboard, source, deck),
    );
  });
});

/* -------------------------------------------------------------------- speed */

describe("animation speed", () => {
  it("is byte-identical at 1, so a default deck never moved", () => {
    expect(emitComposition(storyboard, source, deck, { speed: 1 })).toBe(
      emitComposition(storyboard, source, deck),
    );
  });

  it("scales the slide windows by the same factor as the tweens", () => {
    // The whole risk: `pace` scales a scene's holds, and if the beat's own
    // length is left alone the last reveal falls outside its slide window and
    // `emitIsland` throws. That it does not throw is half the assertion; the
    // windows moving in step is the other half.
    const slow = emitComposition(storyboard, source, deck, { speed: 2 });
    // s1's SLIDE is 12 — which is where s2 starts, and what the running clock
    // accumulates — but the div carries its CLIP, one scaled `HANDOFF_SECONDS`
    // longer, so s1 is still on screen and dissolving while s2 opens on its own
    // 0.3s of nothing. The handoff scales with `speed` like every other
    // duration; s2 is last and has nothing to hand off to.
    expect(windows(slow)).toEqual([
      { sid: "s1", start: 0, duration: 12.8 },
      { sid: "s2", start: 12, duration: 24 },
    ]);
  });

  it("holds stay inside their slide at 0.5x and 3x", () => {
    for (const speed of [0.5, 3]) {
      expect(() => emitComposition(storyboard, source, deck, { speed })).not.toThrow();
    }
  });
});

/* ---------------------------------------------------------------- narration */

const narration: DeckNarration = {
  voice: "en-US-AvaMultilingualNeural",
  dir: "audio",
  beats: {
    b2: [
      {
        stop: 0,
        text: "First the encoder.",
        audio: "aaaa1111.mp3",
        seconds: 2.5,
        cues: [{ start: 0, end: 2.4, text: "First the encoder." }],
      },
      {
        stop: 1,
        text: "Then the ticks.",
        audio: "bbbb2222.mp3",
        seconds: 2,
        cues: [{ start: 0, end: 1.9, text: "Then the ticks." }],
      },
    ],
  },
};

/** One fixture segment, by stop. A throw here is a broken fixture, not a failure. */
function seg(stop: number) {
  const found = narration.beats.b2?.[stop];
  if (!found) throw new Error(`fixture has no segment at stop ${stop}`);
  return found;
}

describe("narration wiring", () => {
  const built = emitDeck(storyboard, source, deck, "/*runtime*/", { narration });

  it("keys the island by scene id, not beat id", () => {
    // `narrate` speaks beats; the runtime only ever sees scene ids. This is the
    // one translation nothing else in the pipeline performs.
    const island = narrationIsland(built.page ?? "");
    expect(Object.keys(island?.scenes ?? {})).toEqual(["s2"]);
    expect(island?.dir).toBe("audio");
    expect(island?.voice).toBe("en-US-AvaMultilingualNeural");
  });

  it("carries stop, audio and cues, and drops the duplicated script", () => {
    const segments = narrationIsland(built.page ?? "")?.scenes.s2 ?? [];
    expect(segments.map((s) => s.stop)).toEqual([0, 1]);
    expect(segments.map((s) => s.audio)).toEqual(["aaaa1111.mp3", "bbbb2222.mp3"]);
    expect(JSON.stringify(segments)).not.toContain('First the encoder.","audio');
  });

  it("keeps the island out of the composition", () => {
    // index.html is rendered headlessly; an audio manifest there is dead weight
    // at best, and a second root-level island at worst.
    expect(built.composition).not.toContain("decksmith-narration");
  });

  it("still contains no data-composition-id in the presented page (invariant 6)", () => {
    expect(built.page).not.toContain("data-composition-id");
  });

  it("lengthens a narrated beat to fit what is said, and leaves silent ones alone", () => {
    const silent = windows(emitComposition(storyboard, source, deck));
    const spoken = windows(emitComposition(storyboard, source, deck, { narration }));
    expect(spoken[0]).toEqual(silent[0]); // b1 says nothing
    // b2's authored 12s already covers its 4.5s of speech, so it does not grow;
    // shrinking to the speech would push its own reveals out of the window.
    expect(spoken[1]?.duration).toBe(12);

    const long: DeckNarration = {
      ...narration,
      beats: { b2: [{ ...seg(0), seconds: 40 }] },
    };
    expect(
      windows(emitComposition(storyboard, source, deck, { narration: long }))[1]?.duration,
    ).toBeGreaterThan(40);
  });

  it("emits no island when narration names beats this deck does not have", () => {
    // Narration is stored per storyboard and outlives an edit; a segment whose
    // beat was cut must vanish rather than shift onto its neighbour's scene id.
    const stale: DeckNarration = { ...narration, beats: { b99: narration.beats.b2 ?? [] } };
    const page = emitDeck(storyboard, source, deck, "", { narration: stale }).page;
    expect(page).not.toContain("decksmith-narration");
  });

  it("has nowhere to put an island in a linear format, and does not try", () => {
    const video = format("video-16x9");
    expect(video.navigable).toBe(false);
    expect(emitDeck(storyboard, source, video, "", { narration }).page).toBeUndefined();
  });

  it("accepts exactly what `narrate` produces", () => {
    // The shape the narrate agent writes to narration.json, validated by the
    // contract, then handed to the emitter with only `dir` added.
    const fromDisk = narrationSchema.parse({ voice: narration.voice, beats: narration.beats });
    const page = emitDeck(storyboard, source, deck, "", {
      narration: { ...fromDisk, dir: "audio" },
    }).page;
    expect(narrationIsland(page ?? "")?.scenes.s2).toHaveLength(2);
  });
});

/* ------------------------------------------------------------- verify gate */

describe("scanNarration", () => {
  const page = emitDeck(storyboard, source, deck, "", { narration }).page ?? "";

  it("says nothing about a deck with no narration at all", () => {
    expect(scanNarration(`<html></html>`, new Set())).toEqual([]);
    expect(scanNarration("", new Set())).toEqual([]);
  });

  it("passes when every named file shipped", () => {
    expect(scanNarration(page, new Set(["audio/aaaa1111.mp3", "audio/bbbb2222.mp3"]))).toEqual([]);
  });

  it("fails, by name, when one did not", () => {
    const [finding, ...rest] = scanNarration(page, new Set(["audio/aaaa1111.mp3"]));
    expect(rest).toEqual([]);
    expect(finding?.severity).toBe("error");
    expect(finding?.rule).toBe("audio_missing");
    expect(finding?.message).toContain("bbbb2222.mp3");
    expect(finding?.message).toContain(DECK_PAGE);
  });

  it("leaves hosted audio to whoever hosts it", () => {
    const hosted = emitDeck(storyboard, source, deck, "", {
      narration: {
        ...narration,
        beats: {
          b2: [{ ...seg(0), audio: "https://cdn.example/a.mp3" }],
        },
      },
    }).page;
    expect(scanNarration(hosted ?? "", new Set())).toEqual([]);
  });

  it("reports an island it cannot read rather than falling silent", () => {
    const broken = `<script type="application/decksmith-narration+json">{nope}</script>`;
    expect(scanNarration(broken, new Set())[0]?.rule).toBe("island_unparseable");
  });
});

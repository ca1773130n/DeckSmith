/**
 * Narration, replayed rather than synthesised.
 *
 * `RECORDED` below is a verbatim capture of `edge-tts --write-subtitles` on this
 * machine — three sentences, one cue each, comma decimals — and every test here
 * feeds it through an injected `Runner`. Nothing in this file may reach the
 * network: edge-tts needs it, CI does not have it, and a test that sometimes
 * needs a websocket is a test nobody trusts.
 */
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  narrate,
  planSegments,
  splitSentences,
  stopCount,
  stopsFor,
} from "../src/narrate/narrate.js";
import {
  cacheKey,
  parseCues,
  type Runner,
  resolveEdgeTts,
  synthesize,
} from "../src/narrate/tts.js";
import { pickVoice } from "../src/narrate/voices.js";
import { FORMATS, type Format, prefsSchema, sourceSchema, storyboardSchema } from "../src/types.js";

/**
 * Captured from:
 *   edge-tts -v en-US-AndrewMultilingualNeural --rate=+0% --pitch=+0Hz \
 *     -t "Attention is all you need. The model reads every token at once. Nothing recurs." \
 *     --write-media a.mp3 --write-subtitles a.vtt
 * ffprobe reported 6.000000s for the mp3, i.e. longer than the last cue's end.
 */
const RECORDED = `1
00:00:00,050 --> 00:00:01,800
Attention is all you need.

2
00:00:01,800 --> 00:00:04,587
The model reads every token at once.

3
00:00:04,587 --> 00:00:05,937
Nothing recurs.
`;

/** Replays the capture and counts what it was asked to say. */
function replay(seconds = 6, srt = RECORDED) {
  const said: string[] = [];
  const runner: Runner = {
    async speak(job) {
      said.push(job.text);
      await writeFile(job.audio, "ID3stub");
      await writeFile(job.subs, srt);
    },
    async measure() {
      return seconds;
    },
  };
  return { runner, said };
}

const dir = () => mkdtemp(join(tmpdir(), "decksmith-narrate-"));

const format = FORMATS["deck-16x9"] as Format;

/* ------------------------------------------------------------ SRT parsing */

describe("parseCues", () => {
  it("reads the SRT edge-tts writes into a file it calls .vtt", () => {
    // One cue per sentence, not per file: three sentences in, three cues out.
    expect(parseCues(RECORDED)).toEqual([
      { start: 0.05, end: 1.8, text: "Attention is all you need." },
      { start: 1.8, end: 4.587, text: "The model reads every token at once." },
      { start: 4.587, end: 5.937, text: "Nothing recurs." },
    ]);
  });

  it("reads the comma as a decimal point, not as a thousands separator", () => {
    // The whole reason this is not a WebVTT parser. `,050` is 50ms.
    const [cue] = parseCues("1\n00:01:02,050 --> 01:00:00,500\nx\n");
    expect(cue).toEqual({ start: 62.05, end: 3600.5, text: "x" });
  });

  it("survives CRLF, missing blank lines and a cue with no text", () => {
    const cues = parseCues(
      "1\r\n00:00:00,000 --> 00:00:01,000\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\nhi\r\n",
    );
    expect(cues).toEqual([{ start: 1, end: 2, text: "hi" }]);
  });

  it("joins a cue wrapped over two lines", () => {
    const [cue] = parseCues("1\n00:00:00,000 --> 00:00:02,000\none\ntwo\n");
    expect(cue?.text).toBe("one two");
  });
});

/* ----------------------------------------------------------------- Caching */

describe("cacheKey", () => {
  const k = () => cacheKey("hello", "en-US-AndrewMultilingualNeural", "+0%", "+0Hz");

  it("is stable for the same words in the same voice", () => {
    expect(k()).toBe(k());
  });

  it("changes with the voice, the rate and the pitch", () => {
    expect(cacheKey("hello", "ko-KR-HyunsuMultilingualNeural", "+0%", "+0Hz")).not.toBe(k());
    expect(cacheKey("hello", "en-US-AndrewMultilingualNeural", "+15%", "+0Hz")).not.toBe(k());
    expect(cacheKey("hello", "en-US-AndrewMultilingualNeural", "+0%", "-5Hz")).not.toBe(k());
  });

  it("changes with the text", () => {
    expect(cacheKey("hallo", "en-US-AndrewMultilingualNeural", "+0%", "+0Hz")).not.toBe(k());
  });
});

/* --------------------------------------------------------------- Synthesis */

describe("synthesize", () => {
  it("returns measured seconds and parsed cues, and leaves no subtitle file behind", async () => {
    const out = await dir();
    const { runner, said } = replay();
    const speech = await synthesize("Attention is all you need.", {
      voice: "en-US-AndrewMultilingualNeural",
      dir: out,
      runner,
    });

    expect(said).toHaveLength(1);
    expect(speech.seconds).toBe(6);
    expect(speech.cues).toHaveLength(3);
    expect(speech.file).toBe(
      `${cacheKey("Attention is all you need.", "en-US-AndrewMultilingualNeural", "+0%", "+0Hz")}.mp3`,
    );
    // mp3 plus its sidecar, and nothing else: the .srt is consumed, not shipped.
    const files = await readdir(out);
    expect(files.filter((f) => f.endsWith(".srt"))).toEqual([]);
    expect(files).toHaveLength(2);
  });

  it("trusts ffprobe over the cue timings and clamps a cue that overruns", async () => {
    // The file is what plays; the cues are what the synthesiser meant to make.
    const { runner } = replay(4);
    const speech = await synthesize("x", { voice: "v", dir: await dir(), runner });
    expect(speech.seconds).toBe(4);
    expect(speech.cues.map((c) => c.end)).toEqual([1.8, 4, 4]);
  });

  it("falls back to the last cue when ffprobe cannot answer", async () => {
    const { runner } = replay(0);
    const speech = await synthesize("x", { voice: "v", dir: await dir(), runner });
    expect(speech.seconds).toBe(5.937);
  });

  it("re-synthesises nothing the second time round", async () => {
    // A four-second edit loop instead of a three-minute one.
    const out = await dir();
    const { runner, said } = replay();
    const opts = { voice: "v", dir: out, runner };
    const first = await synthesize("Nothing recurs.", opts);
    const second = await synthesize("Nothing recurs.", opts);
    expect(said).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("re-synthesises when the voice changes", async () => {
    const out = await dir();
    const { runner, said } = replay();
    await synthesize("Nothing recurs.", { voice: "a", dir: out, runner });
    await synthesize("Nothing recurs.", { voice: "b", dir: out, runner });
    expect(said).toHaveLength(2);
  });
});

/* -------------------------------------------------------------- Resolution */

describe("resolveEdgeTts", () => {
  it("says how to install edge-tts rather than throwing a spawn error", async () => {
    const err = await resolveEdgeTts(async () => false).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("pip install --user edge-tts");
    expect(err?.message).toContain("DECKSMITH_EDGE_TTS");
    expect(err?.message).not.toContain("ENOENT");
  });

  it("falls through to the python module when no binary answers", async () => {
    const tried: string[][] = [];
    const argv = await resolveEdgeTts(async (a) => {
      tried.push(a);
      return a[0] === "python3";
    });
    expect(argv).toEqual(["python3", "-m", "edge_tts"]);
    expect(tried[0]).toEqual(["edge-tts"]);
  });
});

/* ------------------------------------------------------------------ Voices */

describe("pickVoice", () => {
  const prefs = (o: Record<string, unknown>) => prefsSchema.parse(o);

  it("lets an explicit voice win over the table", () => {
    expect(pickVoice(prefs({ lang: "ko", narration: { voice: "ja-JP-KeitaNeural" } }))).toBe(
      "ja-JP-KeitaNeural",
    );
  });

  it("maps language and tone to a real voice id", () => {
    expect(pickVoice(prefs({ lang: "ko-KR", tone: "plain" }))).toBe(
      "ko-KR-HyunsuMultilingualNeural",
    );
    expect(pickVoice(prefs({ lang: "ja", tone: "academic" }))).toBe("ja-JP-KeitaNeural");
    expect(pickVoice(prefs({ lang: "zh-Hans-CN", tone: "punchy" }))).toBe("zh-CN-YunjianNeural");
  });

  it("gives an unlisted language the multilingual English voice", () => {
    // Wrong accent beats no narration.
    expect(pickVoice(prefs({ lang: "sw", tone: "plain" }))).toBe("en-US-AndrewMultilingualNeural");
  });
});

/* --------------------------------------------------------------- Sentences */

describe("splitSentences", () => {
  it("keeps a decimal point inside its number", () => {
    expect(splitSentences("It drops to 0.5 in one step. Then it settles.")).toEqual([
      "It drops to 0.5 in one step.",
      "Then it settles.",
    ]);
  });

  it("splits CJK on its own terminators, which carry no following space", () => {
    expect(splitSentences("어텐션이 전부다. 순환은 없다.")).toEqual([
      "어텐션이 전부다.",
      "순환은 없다.",
    ]);
    expect(splitSentences("注意力就是一切。没有循环。")).toEqual([
      "注意力就是一切。",
      "没有循环。",
    ]);
  });

  it("keeps an unterminated tail", () => {
    expect(splitSentences("One. And a trailing thought")).toEqual([
      "One.",
      "And a trailing thought",
    ]);
  });
});

describe("planSegments", () => {
  const text = "One. Two. Three.";

  it("gives each stop its own sentence when the counts match", () => {
    expect(planSegments(text, 3)).toEqual(["One.", "Two.", "Three."]);
  });

  it("leaves later stops silent rather than inventing copy", () => {
    expect(planSegments("Only this.", 3)).toEqual(["Only this.", "", ""]);
  });

  it("groups the surplus into the last stop", () => {
    expect(planSegments(text, 2)).toEqual(["One.", "Two. Three."]);
    expect(planSegments(text, 1)).toEqual(["One. Two. Three."]);
  });

  it("treats a beat with no stops as one stop", () => {
    expect(planSegments("Hi.", 0)).toEqual(["Hi."]);
  });
});

describe("stopCount", () => {
  it("mirrors buildStops: dedup, drop the hold at the scene start, never zero", () => {
    expect(stopCount([1.2, 2.4, 2.4, 3.6])).toBe(3);
    expect(stopCount([0, 1.5])).toBe(1);
    expect(stopCount([])).toBe(1);
  });
});

/* --------------------------------------------------------------- Narration */

const source = sourceSchema.parse({
  id: "src-1",
  title: "Attention Is All You Need",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
});

const pipe = {
  id: "b2",
  intent: "Show the three stages.",
  archetype: "pipeline",
  seconds: 12,
  params: {
    headline: "Three stages",
    stages: [{ label: "Encode" }, { label: "Attend" }, { label: "Decode" }],
  },
};

function board(beats: unknown[]) {
  return storyboardSchema.parse({ sourceId: "src-1", title: "t", beats });
}

describe("narrate", () => {
  const prefs = prefsSchema.parse({ lang: "en", tone: "plain", narration: { enabled: true } });

  it("gives every stop of a beat its own segment when there is a sentence for each", async () => {
    // The stop count belongs to the emitter, so ask it rather than assume.
    const stops = stopsFor(board([pipe]).beats[0] as never, source, format, "s1");
    expect(stops).toBeGreaterThan(1);
    const narration = Array.from({ length: stops }, (_, i) => `Line ${i + 1}.`).join(" ");

    const { runner, said } = replay();
    const out = await narrate(board([{ ...pipe, narration }]), source, prefs, {
      dir: await dir(),
      runner,
    });

    expect(out.voice).toBe("en-US-AndrewMultilingualNeural");
    expect(out.beats.b2?.map((s) => s.stop)).toEqual([...Array(stops).keys()]);
    expect(said).toHaveLength(stops);
    expect(out.beats.b2?.[0]?.text).toBe("Line 1.");
  });

  it("skips silent stops instead of emitting empty segments", async () => {
    const { runner } = replay();
    const out = await narrate(board([{ ...pipe, narration: "Only one line." }]), source, prefs, {
      dir: await dir(),
      runner,
    });
    expect(out.beats.b2).toHaveLength(1);
    expect(out.beats.b2?.[0]).toMatchObject({ stop: 0, text: "Only one line.", seconds: 6 });
  });

  it("omits a beat that has nothing to say", async () => {
    const { runner, said } = replay();
    const out = await narrate(board([pipe]), source, prefs, { dir: await dir(), runner });
    expect(out.beats).toEqual({});
    expect(said).toEqual([]);
  });

  it("names audio by content, so two beats saying the same thing share one file", async () => {
    const { runner, said } = replay();
    const out = await narrate(
      board([
        { ...pipe, id: "b2", narration: "Same words." },
        { ...pipe, id: "b3", narration: "Same words." },
      ]),
      source,
      prefs,
      { dir: await dir(), runner },
    );
    expect(said).toHaveLength(1);
    expect(out.beats.b2?.[0]?.audio).toBe(out.beats.b3?.[0]?.audio);
    // Relative to the audio directory, never absolute: the deck has to move.
    expect(out.beats.b2?.[0]?.audio).toMatch(/^[0-9a-f]{16}\.mp3$/);
  });
});

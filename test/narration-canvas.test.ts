/**
 * Narration staged one way, built another.
 *
 * MEASURED before any check existed, through `dist/cli.js` with edge-tts
 * stubbed: the demo's `stack` beat is refused at 1600×900, so `narrate --width
 * 1600 --height 900` put all four of its sentences in one segment on the
 * landing. `build --format deck-16x9` stages the same beat with four stops,
 * spoke a 20.35s paragraph over the first reveal, left the other three silent,
 * and printed `PASS — 0 error(s)`. `scanNarrationDrift` could not see it: the
 * words were the right words, split differently.
 *
 * The first fix recorded the canvas and refused any other one. Review measured
 * that proxy wrong both ways, and both are pinned below: it refused `deck-16x9`
 * narration at `short-9x16` and under `--reserve-captions`, where the built
 * files come out byte-identical to a matched build; and it passed a Korean deck
 * whose font face made `narrate` and `build` stage one beat differently at the
 * same size. So `narrate` records each beat's stop count, stages with the
 * build's look, and a build refuses only a kept beat whose sentences it would
 * split differently.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { type DeckNarration, emitComposition, emitDeck } from "../src/emit/composition.js";
import { deckLook, ink } from "../src/emit/theme.js";
import {
  assertNarrationStaging,
  narrate,
  stopsFor,
  uncheckedNarration,
} from "../src/narrate/narrate.js";
import type { Runner } from "../src/narrate/tts.js";
import { planTiming } from "../src/render/timing.js";
import {
  bandReserve,
  FORMATS,
  type Format,
  narrationSchema,
  prefsSchema,
  resizeFormat,
  type Storyboard,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const deck = FORMATS["deck-16x9"] as Format;
const video = FORMATS["video-16x9"] as Format;
const short = FORMATS["short-9x16"] as Format;
const wide = resizeFormat(deck, 1600, 900);
const reserved: Format = { ...deck, captionReserve: bandReserve(deck.width, deck.height) };

const demo = storyboardSchema.parse(JSON.parse(readFileSync(repo("demo/storyboard.json"), "utf8")));
const source = sourceSchema.parse(JSON.parse(readFileSync(repo("demo/source.json"), "utf8")));
/** The title, and the stack beat that 1600×900 refuses. */
const storyboard = { ...demo, beats: demo.beats.filter((b) => ["b01", "b08"].includes(b.id)) };

const prefsAt = (density: "high" | "medium" | "low") =>
  prefsSchema.parse({ lang: "en", tone: "plain", narration: { enabled: true, density } });
const prefs = prefsAt("high");

/** Two seconds of nothing per sentence. Nothing here reaches the network. */
const runner: Runner = {
  async speak(job) {
    await writeFile(job.audio, "ID3stub");
    await writeFile(job.subs, `1\n00:00:00,000 --> 00:00:02,000\n${job.text}\n`);
  },
  async measure() {
    return 2;
  },
};

async function narrated(
  format: Format,
  board: Storyboard = storyboard,
  p = prefs,
): Promise<DeckNarration> {
  const dir = await mkdtemp(join(tmpdir(), "decksmith-canvas-"));
  const out = await narrate(board, source, p, { dir, runner, format });
  return { ...out, dir: "audio" };
}

const stops = (n: DeckNarration, beat: string) => n.beats[beat]?.map((s) => s.stop);

describe("narration staged at another canvas", () => {
  it("still differs where it was measured: stack is one stop at 1600×900 and four at 1920×1080", async () => {
    // The precondition. If an emitter change ever makes these agree, the
    // refusals below are over a mismatch that no longer happens.
    expect(stops(await narrated(wide), "b08")).toEqual([0]);
    expect(stops(await narrated(deck), "b08")).toEqual([0, 1, 2, 3]);
  });

  it("records the canvas, each narrated beat's stop count, and no cap at high density", async () => {
    const n = await narrated(wide);
    expect(n.canvas).toEqual({
      format: "custom-1600x900",
      width: 1600,
      height: 900,
      captionReserve: 0,
    });
    expect(n.stops).toEqual({ b01: 1, b08: 1 });
    expect(n.speakingStops).toBeUndefined();
  });

  it("is refused by emitDeck, naming the beat, both canvases and the command that fixes it", async () => {
    const narration = await narrated(wide);
    const build = () => emitDeck(storyboard, source, deck, "", { narration });
    expect(build).toThrow(/b08 \(narrated over 1, 4 here\)/);
    expect(build).toThrow(
      /staged for 1600×900, and this deck is laid out at deck-16x9 at 1920×1080/,
    );
    expect(build).toThrow(/Re-run `decksmith narrate` with --format deck-16x9/);
    // The cache sentence must not promise a cache hit an unpacked deck lacks.
    expect(build).toThrow(/An unpacked \.deck carries the audio but not that cache/);
  });

  it("is refused by emitComposition, so a linear format is no way round it", async () => {
    const narration = await narrated(wide);
    expect(() => emitComposition(storyboard, source, video, { narration })).toThrow(
      /b08 \(narrated over 1, 4 here\)/,
    );
  });

  it("is refused by planTiming, so no manifest places it", async () => {
    const narration = await narrated(deck);
    const composition = emitComposition(storyboard, source, deck, { narration });
    const timing = (n: DeckNarration) => () =>
      planTiming({ storyboard, source, format: deck, speed: 1, composition, narration: n });
    expect(timing(narration)).not.toThrow();
    expect(timing({ ...narration, stops: { ...narration.stops, b08: 1 } })).toThrow(
      /b08 \(narrated over 1, 4 here\)/,
    );
  });

  it("names a custom canvas by its size, since that is what --width/--height stage", () => {
    const canvas = { format: "deck-16x9", width: 1920, height: 1080, captionReserve: 0 };
    const narration = { canvas, stops: { b08: 1 }, beats: { b08: [{ text: "One. Two." }] } };
    expect(() => assertNarrationStaging(narration, new Map([["b08", 4]]), wide)).toThrow(
      /laid out at 1600×900, .* --width 1600 --height 900,/s,
    );
  });

  it("says the beats moved, not the canvas, when the canvas is the same", async () => {
    // A params edit that changes a beat's reveals without changing its words is
    // exactly this, and `scanNarrationDrift` compares only the words.
    const narration = await narrated(deck);
    expect(() =>
      emitDeck(storyboard, source, deck, "", {
        narration: { ...narration, stops: { ...narration.stops, b08: 2 } },
      }),
    ).toThrow(/narrated at this same canvas, deck-16x9 at 1920×1080, so the beats themselves/);
  });
});

/* ------------------------------- Review finding 1: harmless canvases pass */

describe("narration staged at another canvas that stages every kept beat the same", () => {
  /**
   * Review measured these through the CLI: main built them, the canvas check
   * refused them, and main's `index.html`, `timing.json` and `deck.html` were
   * byte-identical to a build narrated at the matching canvas. Pinned here at
   * the library, whole demo, both artifacts compared.
   */
  it.each([
    ["short-9x16", short],
    ["deck-16x9 with the caption reserve", reserved],
  ])(
    "builds deck-16x9 narration at %s, byte for byte what matched narration builds",
    async (_, format) => {
      const onBeatError = () => {};
      const across = emitDeck(demo, source, format, "", {
        narration: await narrated(deck, demo),
        onBeatError,
      });
      const matched = emitDeck(demo, source, format, "", {
        narration: await narrated(format, demo),
        onBeatError,
      });
      expect(across.composition).toBe(matched.composition);
      expect(across.page).toBe(matched.page);
    },
  );

  it("builds narration whose beat the build leaves out: a beat not drawn speaks nowhere", async () => {
    const narration = await narrated(deck);
    const dropped: string[] = [];
    const onBeatError = (id: string) => void dropped.push(id);
    expect(() =>
      emitComposition(storyboard, source, wide, { narration, onBeatError }),
    ).not.toThrow();
    expect(dropped).toEqual(["b08"]);
  });

  it("checks only the beats the budget kept", async () => {
    const narration = await narrated(deck, demo);
    const onBeatError = () => {};
    // The stub speaks two seconds a sentence, so no real budget cuts anything;
    // half of what the whole deck runs does.
    const whole = emitDeck(demo, source, deck, "", { narration, onBeatError }).cut.seconds;
    const tight: Format = { ...deck, maxSeconds: Math.round(whole / 2) };
    const { cut } = emitDeck(demo, source, tight, "", { narration, onBeatError });
    /** A beat whose speaking count moves if its record says one stop. */
    const moves = (id: string) =>
      (narration.stops?.[id] ?? 1) > 1 && (narration.beats[id]?.length ?? 0) > 1;
    const cutId = cut.dropped
      .filter((d) => d.rule === "over_budget")
      .map((d) => d.beat.id)
      .find(moves);
    const keptId = cut.kept.map((b) => b.id).find(moves);
    expect(cutId).toBeDefined();
    expect(keptId).toBeDefined();
    const tamper = (id: string) => ({ ...narration, stops: { ...narration.stops, [id]: 1 } });
    expect(() =>
      emitDeck(demo, source, tight, "", { narration: tamper(cutId as string), onBeatError }),
    ).not.toThrow();
    expect(() =>
      emitDeck(demo, source, tight, "", { narration: tamper(keptId as string), onBeatError }),
    ).toThrow(new RegExp(`${keptId} \\(narrated over 1,`));
  });

  it("compares the stops that SPEAK, so a density cap that hides the difference builds", async () => {
    // At `low` density one stop speaks whatever the staging, so stack narrated
    // at 1600×900 (one stop) and built at 1920×1080 (four) says the same thing
    // on the same stop. At `medium` two may speak, and the build would give the
    // second one words the narration put on the first.
    const low = prefsAt("low");
    const across = await narrated(wide, storyboard, low);
    expect(across.speakingStops).toBe(1);
    const matched = await narrated(deck, storyboard, low);
    expect(emitComposition(storyboard, source, deck, { narration: across })).toBe(
      emitComposition(storyboard, source, deck, { narration: matched }),
    );

    const medium = await narrated(wide, storyboard, prefsAt("medium"));
    expect(medium.speakingStops).toBe(2);
    expect(() => emitComposition(storyboard, source, deck, { narration: medium })).toThrow(
      /b08 \(narrated over 1, 4 here\)/,
    );
  });
});

/* --------------------------- Review finding 2: the font face stages too */

describe("a CJK storyboard, narrated and built at the same canvas", () => {
  const ko = {
    ...demo,
    lang: "ko",
    beats: demo.beats.filter((b) => ["b01", "b02"].includes(b.id)),
  };
  const box = resizeFormat(deck, 1380, 776);
  const callout = ko.beats.find((b) => b.id === "b02");

  it("still stages differently in the bare theme and the build's: the face decides the fit", () => {
    // The precondition, measured in review: `narrate` staged with `ink`, whose
    // stack names no Hangul face, and the callout did not fit.
    if (!callout) throw new Error("demo has no b02");
    expect(stopsFor(callout, source, box, "s2", ink)).toBe(1);
    expect(stopsFor(callout, source, box, "s2", deckLook(ko).theme)).toBe(4);
  });

  it("is narrated with the build's face, so its sentences land on the build's stops", async () => {
    const narration = await narrated(box, ko);
    expect(narration.stops?.b02).toBe(4);
    expect(stops(narration, "b02")).toEqual([0, 1, 2]);
    expect(() => emitDeck(ko, source, box, "", { narration })).not.toThrow();
  });

  it("refuses narration split over the bare theme's staging", async () => {
    const narration = await narrated(box, ko);
    const segments = narration.beats.b02 ?? [];
    const asBefore: DeckNarration = {
      ...narration,
      stops: { ...narration.stops, b02: 1 },
      beats: {
        ...narration.beats,
        b02: [
          {
            ...(segments[0] as (typeof segments)[number]),
            text: segments.map((s) => s.text).join(" "),
          },
        ],
      },
    };
    expect(() => emitDeck(ko, source, box, "", { narration: asBefore })).toThrow(
      /b02 \(narrated over 1, 4 here\)/,
    );
  });
});

/* ---------------------------------------------------- Backward compatibility */

describe("narration written before its staging was recorded", () => {
  /**
   * ACCEPTED, with a warning the CLI prints. Refusing would leave every pack
   * written so far unbuildable until re-narrated, and a pack carries the mp3s but
   * not the cache sidecars, so that means synthesising every sentence again.
   */
  const legacy = async (): Promise<DeckNarration> => {
    const { canvas: _c, stops: _s, speakingStops: _p, ...rest } = await narrated(wide);
    return rest;
  };

  it("still builds, even staged differently: there is nothing recorded to compare against", async () => {
    const narration = await legacy();
    expect(() => emitDeck(storyboard, source, deck, "", { narration })).not.toThrow();
  });

  it("says it was not checked, and how to record it", async () => {
    const said = uncheckedNarration(await legacy(), wide);
    expect(said).toMatch(/records no stop counts/);
    expect(said).toMatch(/Re-run `decksmith narrate` with --width 1600 --height 900/);
  });

  it("says nothing once the stops are recorded", async () => {
    expect(uncheckedNarration(await narrated(deck), deck)).toBeUndefined();
  });

  it("keeps the record through the schema that build and a pack read it with", async () => {
    // zod strips unknown keys: a field missing from the schema would turn every
    // recorded narration back into an unchecked one on the way off disk.
    const narration = await narrated(wide, storyboard, prefsAt("medium"));
    const parsed = narrationSchema.parse(narration);
    expect(parsed.canvas).toEqual(narration.canvas);
    expect(parsed.stops).toEqual(narration.stops);
    expect(parsed.speakingStops).toBe(2);
  });
});

/* ----------------------------------------------------------------- the CLI */

/**
 * The pairing the bullet was about, end to end: two real `decksmith` invocations.
 * edge-tts and ffprobe are two shell stubs on a private PATH, so nothing is
 * synthesised and nothing reaches the network. Needs `dist/cli.js`, which CI's
 * `npm ci` builds; skipped without it, and stale after a source change until
 * `npm run build`.
 */
const cli = repo("dist/cli.js");
const built = await stat(cli).then(
  () => true,
  () => false,
);

describe.skipIf(!built)("decksmith narrate, then build at another canvas", () => {
  async function stubs(dir: string): Promise<NodeJS.ProcessEnv> {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const edge = join(bin, "edge-tts");
    await writeFile(
      edge,
      [
        "#!/bin/sh",
        'for a; do [ "$a" = --help ] && exit 0; done',
        'while [ $# -gt 0 ]; do case "$1" in -t) t="$2"; shift;; --write-media) m="$2"; shift;; --write-subtitles) s="$2"; shift;; esac; shift; done',
        'printf stub > "$m"',
        'printf \'1\\n00:00:00,000 --> 00:00:02,000\\n%s\\n\' "$t" > "$s"',
        "",
      ].join("\n"),
    );
    await writeFile(join(bin, "ffprobe"), "#!/bin/sh\necho 2\n");
    await chmod(edge, 0o755);
    await chmod(join(bin, "ffprobe"), 0o755);
    return {
      ...process.env,
      DECKSMITH_EDGE_TTS: edge,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    };
  }

  it("refuses the build before writing the deck, and names the fix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decksmith-canvas-cli-"));
    const env = await stubs(dir);
    const sb = join(dir, "storyboard.json");
    await writeFile(sb, JSON.stringify(storyboard));
    const src = join(dir, "source.json");
    await writeFile(src, JSON.stringify(source));
    const audio = join(dir, "audio");
    const out = join(dir, "deck");

    await run(
      process.execPath,
      [cli, "narrate", sb, "--source", src, "-o", audio, "--width", "1600", "--height", "900"],
      { env },
    );
    const written = narrationSchema.parse(
      JSON.parse(await readFile(join(audio, "narration.json"), "utf8")),
    );
    expect(written.canvas).toMatchObject({ width: 1600, height: 900, captionReserve: 0 });
    expect(written.stops).toEqual({ b01: 1, b08: 1 });
    expect(written.beats.b08?.map((s) => s.stop)).toEqual([0]);

    // Refused only if `loadNarration` carried `stops` off disk: without them
    // the build is unchecked and exits 0.
    const refused = await run(
      process.execPath,
      [cli, "build", sb, "--source", src, "-o", out, "--format", "deck-16x9", "--no-fidelity"],
      { env },
    ).then(
      () => undefined,
      (err: { code?: number; stderr?: string }) => err,
    );
    expect(refused?.code).not.toBe(0);
    expect(refused?.stderr).toMatch(/b08 \(narrated over 1, 4 here\)/);
    expect(refused?.stderr).toMatch(/staged for 1600×900, and this deck is laid out at deck-16x9/);
    expect(refused?.stderr).toMatch(/--format deck-16x9/);
    expect(await stat(join(out, "index.html")).catch(() => null)).toBeNull();

    // And `--reserve-captions` on narrate is what a burned-caption build pairs with.
    await run(
      process.execPath,
      [cli, "narrate", sb, "--source", src, "-o", audio, "--reserve-captions"],
      { env },
    );
    const withReserve = narrationSchema.parse(
      JSON.parse(await readFile(join(audio, "narration.json"), "utf8")),
    );
    expect(withReserve.canvas).toEqual({
      format: "deck-16x9",
      width: 1920,
      height: 1080,
      captionReserve: bandReserve(1920, 1080),
    });
  }, 60_000);
});

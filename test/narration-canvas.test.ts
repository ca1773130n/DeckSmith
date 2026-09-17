/**
 * Narration staged at one canvas, built at another.
 *
 * MEASURED before this check existed, through `dist/cli.js` with edge-tts
 * stubbed: the demo's `stack` beat is refused at 1600×900, so `narrate --width
 * 1600 --height 900` put all four of its sentences in one segment on the
 * landing. `build --format deck-16x9` stages the same beat with four stops,
 * spoke a 20.35s paragraph over the first reveal, left the other three silent,
 * and printed `PASS — 0 error(s)`. `scanNarrationDrift` could not see it: the
 * words were the right words, split differently.
 *
 * So `narrate` records the canvas and every stage that lays narration over
 * staged holds refuses another one. The demo beat is used rather than a
 * hand-built one because the refusal only matters where staging really
 * differs, and the first test below fails if that stops being true.
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
import { narrate } from "../src/narrate/narrate.js";
import type { Runner } from "../src/narrate/tts.js";
import { planTiming } from "../src/render/timing.js";
import {
  assertNarrationCanvas,
  bandReserve,
  FORMATS,
  type Format,
  narrationSchema,
  prefsSchema,
  resizeFormat,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const deck = FORMATS["deck-16x9"] as Format;
const video = FORMATS["video-16x9"] as Format;
const wide = resizeFormat(deck, 1600, 900);

const demo = storyboardSchema.parse(JSON.parse(readFileSync(repo("demo/storyboard.json"), "utf8")));
const source = sourceSchema.parse(JSON.parse(readFileSync(repo("demo/source.json"), "utf8")));
/** The title, and the stack beat that 1600×900 refuses. */
const storyboard = { ...demo, beats: demo.beats.filter((b) => ["b01", "b08"].includes(b.id)) };

const prefs = prefsSchema.parse({ lang: "en", tone: "plain", narration: { enabled: true } });

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

async function narrated(format: Format): Promise<DeckNarration> {
  const dir = await mkdtemp(join(tmpdir(), "decksmith-canvas-"));
  const out = await narrate(storyboard, source, prefs, { dir, runner, format });
  return { ...out, dir: "audio" };
}

const stops = (n: DeckNarration, beat: string) => n.beats[beat]?.map((s) => s.stop);

describe("narration staged for another canvas", () => {
  it("still differs where it was measured: stack is one stop at 1600×900 and four at 1920×1080", async () => {
    // The precondition. If an emitter change ever makes these agree, the rest of
    // this file is testing a refusal over a mismatch that no longer hurts.
    expect(stops(await narrated(wide), "b08")).toEqual([0]);
    expect(stops(await narrated(deck), "b08")).toEqual([0, 1, 2, 3]);
  });

  it("records the canvas it staged against", async () => {
    expect((await narrated(wide)).canvas).toEqual({
      format: "custom-1600x900",
      width: 1600,
      height: 900,
      captionReserve: 0,
    });
  });

  it("is refused by emitDeck, naming both canvases and the command that fixes it", async () => {
    const narration = await narrated(wide);
    const build = () => emitDeck(storyboard, source, deck, "", { narration });
    expect(build).toThrow(
      /staged for 1600×900, but this deck is laid out at deck-16x9 at 1920×1080/,
    );
    expect(build).toThrow(/Re-run `decksmith narrate` with --format deck-16x9/);
  });

  it("is refused by emitComposition, so a linear format is no way round it", async () => {
    const narration = await narrated(wide);
    expect(() => emitComposition(storyboard, source, video, { narration })).toThrow(
      /staged for 1600×900/,
    );
  });

  it("is refused by planTiming, so no manifest places it", async () => {
    const narration = await narrated(deck);
    const composition = emitComposition(storyboard, source, deck, { narration });
    const timing = (n: DeckNarration) => () =>
      planTiming({ storyboard, source, format: deck, speed: 1, composition, narration: n });
    expect(timing(narration)).not.toThrow();
    expect(
      timing({
        ...narration,
        canvas: { format: "custom-1600x900", width: 1600, height: 900, captionReserve: 0 },
      }),
    ).toThrow(/staged for 1600×900/);
  });

  it("builds at the canvas it was staged for, and at a same-sized profile of another name", async () => {
    const narration = await narrated(deck);
    const page = emitDeck(storyboard, source, deck, "", { narration }).page ?? "";
    expect(page).toContain("decksmith-narration");
    // `video-16x9` is the same box: staging reads the box, not the name.
    expect(() => emitComposition(storyboard, source, video, { narration })).not.toThrow();
    // `onBeatError` because 1600×900 refuses the stack beat, which is the point.
    const small = await narrated(wide);
    const dropped: string[] = [];
    const onBeatError = (id: string) => void dropped.push(id);
    expect(() =>
      emitComposition(storyboard, source, wide, { narration: small, onBeatError }),
    ).not.toThrow();
    expect(dropped).toEqual(["b08"]);
  });

  it("refuses a caption reserve the narration was not staged with, and names the flag", async () => {
    const narration = await narrated(deck);
    const reserved: Format = { ...deck, captionReserve: bandReserve(deck.width, deck.height) };
    expect(() => emitComposition(storyboard, source, reserved, { narration })).toThrow(
      /--format deck-16x9 --reserve-captions/,
    );
  });

  it("names a custom canvas by its size, since that is what --width/--height stage", () => {
    const canvas = { format: "deck-16x9", width: 1920, height: 1080, captionReserve: 0 };
    expect(() => assertNarrationCanvas({ canvas }, wide)).toThrow(
      /laid out at 1600×900\. .* --width 1600 --height 900,/s,
    );
  });
});

/* ---------------------------------------------------- Backward compatibility */

describe("narration written before the canvas was recorded", () => {
  /**
   * ACCEPTED, with a warning the CLI prints. Refusing would leave every pack
   * written so far unbuildable until re-narrated, and a pack carries the mp3s but
   * not the cache sidecars, so that means synthesising every sentence again.
   */
  const legacy = async (): Promise<DeckNarration> => {
    const { canvas: _, ...rest } = await narrated(deck);
    return rest;
  };

  it("still builds", async () => {
    const narration = await legacy();
    expect(() => emitDeck(storyboard, source, deck, "", { narration })).not.toThrow();
    // Even at another canvas: there is nothing recorded to compare against.
    const onBeatError = () => {};
    expect(() =>
      emitComposition(storyboard, source, wide, { narration, onBeatError }),
    ).not.toThrow();
  });

  it("says it was not checked, and how to record the canvas", async () => {
    const said = assertNarrationCanvas(await legacy(), wide);
    expect(said).toMatch(/records no canvas/);
    expect(said).toMatch(/Re-run `decksmith narrate` with --width 1600 --height 900/);
  });

  it("says nothing once a canvas is recorded and agrees", async () => {
    expect(assertNarrationCanvas(await narrated(deck), deck)).toBeUndefined();
  });

  it("keeps the canvas through the schema that build and a pack read it with", async () => {
    // zod strips unknown keys: a field missing from the schema would turn every
    // recorded narration back into an unchecked one on the way off disk.
    const narration = await narrated(wide);
    expect(narrationSchema.parse(narration).canvas).toEqual(narration.canvas);
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
    expect(written.beats.b08?.map((s) => s.stop)).toEqual([0]);

    const refused = await run(
      process.execPath,
      [cli, "build", sb, "--source", src, "-o", out, "--format", "deck-16x9", "--no-fidelity"],
      { env },
    ).then(
      () => undefined,
      (err: { code?: number; stderr?: string }) => err,
    );
    expect(refused?.code).not.toBe(0);
    expect(refused?.stderr).toMatch(/staged for 1600×900, but this deck is laid out at deck-16x9/);
    expect(refused?.stderr).toMatch(/--format deck-16x9/);
    expect(await stat(join(out, "index.html")).catch(() => null)).toBeNull();

    // And `--reserve-captions` on narrate is what a burned-caption build pairs with.
    await run(
      process.execPath,
      [cli, "narrate", sb, "--source", src, "-o", audio, "--reserve-captions"],
      { env },
    );
    const reserved = narrationSchema.parse(
      JSON.parse(await readFile(join(audio, "narration.json"), "utf8")),
    );
    expect(reserved.canvas).toEqual({
      format: "deck-16x9",
      width: 1920,
      height: 1080,
      captionReserve: bandReserve(1920, 1080),
    });
  }, 60_000);
});

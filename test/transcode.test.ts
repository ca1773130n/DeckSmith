/**
 * Normalising a harvested video, in the two halves the suite can afford.
 *
 * The arithmetic and the command are pure and are tested with nothing
 * installed — which is what CI runs, because CI has no ffmpeg any more than it
 * has a Chrome. Everything else here needs a REAL encode: what a flag does to a
 * file is exactly the thing a string assertion cannot tell you, and the header
 * of src/source/transcode.ts makes claims (the audio goes, the bytes shrink, two
 * runs agree) that are only worth writing down if something checks them. So the
 * second half is gated the way test/harvest.test.ts gates its browser, and it
 * builds its own input with ffmpeg rather than carrying a fixture: a video whose
 * size, length and audio track are stated by the command that made it is a
 * better witness than a checked-in mp4 nobody can re-derive.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { probe } from "../src/render/ffmpeg.js";
import { fitBox, transcode, transcodeArgs } from "../src/source/transcode.js";

const run = promisify(execFile);

describe("fitBox", () => {
  it("fits the long edge and leaves the aspect where it was", () => {
    expect(fitBox(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    // Portrait through the same bound: the long edge is the height, and a box
    // that capped the height at 720 would have made this 405 wide.
    expect(fitBox(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never upscales", () => {
    expect(fitBox(640, 480, 1280)).toEqual({ width: 640, height: 480 });
    // Odd and already small: the only thing that may happen to it is losing the
    // odd pixel VP9 will not take, and that is downwards.
    expect(fitBox(641, 481, 1280)).toEqual({ width: 640, height: 480 });
  });

  it("floors every edge to even", () => {
    // 1600x900 at the 1280 bound is 1280x720; 1600x901 is 720.8 and must not
    // become 722, which is what rounding would do to it.
    expect(fitBox(1600, 901, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitBox(3840, 2160, 1000)).toEqual({ width: 1000, height: 562 });
  });
});

describe("transcodeArgs", () => {
  const args = transcodeArgs("in.mp4", "out.webm", { width: 1280, height: 720 });

  it("asks for VP9 in a webm with no audio in it", () => {
    expect(args.join(" ")).toContain("-c:v libvpx-vp9");
    expect(args).toContain("-an");
    expect(args.at(-1)).toBe("out.webm");
  });

  it("carries the scale the caller computed rather than an expression", () => {
    expect(args.join(" ")).toContain("-vf scale=1280:720");
  });

  it("passes the flags the header claims determinism from", () => {
    const line = args.join(" ");
    // Without these three the muxer writes a random SegmentUID and its own
    // version string, and two runs of one input differ — measured.
    expect(line).toContain("-fflags +bitexact");
    expect(line).toContain("-flags:v +bitexact");
    expect(line).toContain("-map_metadata -1");
  });

  it("only bounds the duration when it was given one", () => {
    expect(args).not.toContain("-t");
    const capped = transcodeArgs("in.mp4", "out.webm", { width: 640, height: 360, seconds: 1.5 });
    expect(capped.join(" ")).toContain("-t 1.500");
  });
});

/* ------------------------------------------------------- The whole stage */

/**
 * No ffmpeg, no encode — and no pretending otherwise. CI installs none, so
 * these are skipped there; the block above is what runs on every push.
 */
const ffmpeg = await run("ffmpeg", ["-version"]).then(
  () => true,
  () => false,
);

describe.skipIf(!ffmpeg)("transcode, through a real ffmpeg", () => {
  let dir = "";
  let big = "";
  let small = "";

  /** A source with everything under test in it: too wide, too long, and noisy. */
  async function make(path: string, size: string, seconds: number) {
    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${size}:rate=30:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ]);
    return path;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-transcode-"));
    big = await make(join(dir, "big.mp4"), "1920x1080", 3);
    small = await make(join(dir, "small.mp4"), "320x240", 1);
  }, 120_000);

  it("comes back smaller, scaled, muted, and measured off the file it wrote", async () => {
    const out = join(dir, "big.webm");
    const got = await transcode(big, out, { maxEdgePx: 1280 });

    expect(got.path).toBe(out);
    expect(got.transcoded).toBe(true);
    expect(got.warnings).toEqual([]);

    // The point of the module, stated as bytes.
    const before = (await stat(big)).size;
    const after = (await stat(out)).size;
    expect(after).toBeLessThan(before);

    // webm's EBML magic, which is also what `videoSize` sniffs for — a file the
    // ingest parser cannot recognise would have been refused inside transcode.
    const head = await readFile(out);
    expect(head.readUInt32BE(0)).toBe(0x1a45dfa3);

    const real = await probe(out);
    expect(real.hasAudio).toBe(false);
    expect([real.width, real.height]).toEqual([1280, 720]);
    // What it RETURNED is what the file IS, which is the whole reason the output
    // is re-measured rather than assumed from the arithmetic.
    expect([got.width, got.height]).toEqual([real.width, real.height]);
    expect(got.seconds).toBeCloseTo(3, 1);
  }, 120_000);

  it("does not enlarge a video that is already inside the box", async () => {
    const out = join(dir, "small.webm");
    const got = await transcode(small, out, { maxEdgePx: 1280 });
    expect([got.width, got.height]).toEqual([320, 240]);
  }, 120_000);

  it("truncates at the cap and says what the cap was", async () => {
    const out = join(dir, "capped.webm");
    const got = await transcode(big, out, { maxEdgePx: 640, maxSeconds: 1.5 });

    expect(got.seconds).toBeCloseTo(1.5, 1);
    expect((await probe(out)).seconds).toBeCloseTo(1.5, 1);
    // A trim is the failure that hides: a clip shorter than its beat holds its
    // last frame with every gate green, so the number and the option that set it
    // both have to be in the warning.
    expect(got.warnings).toHaveLength(1);
    expect(got.warnings[0]).toContain("1.5s cap (maxSeconds)");
    expect(got.warnings[0]).toContain("3.0s");
  }, 120_000);

  it("writes the same bytes twice from the same input", async () => {
    const one = join(dir, "det-1.webm");
    const two = join(dir, "det-2.webm");
    await transcode(small, one);
    await transcode(small, two);
    // Only claimed for one machine and one ffmpeg build; that is what a suite
    // running on one machine can honestly check, and it is what the flags buy.
    expect(await readFile(one)).toEqual(await readFile(two));
  }, 120_000);

  it("hands back the original, and what to install, when there is no ffmpeg", async () => {
    const out = join(dir, "never-written.webm");
    const got = await transcode(big, out, { ffmpeg: "decksmith-no-such-ffmpeg" });

    // A deck that is bigger than it needed to be is far better than no deck.
    expect(got.path).toBe(big);
    expect(got.transcoded).toBe(false);
    expect([got.width, got.height]).toEqual([1920, 1080]);
    expect(got.seconds).toBeCloseTo(3, 1);
    expect(got.warnings[0]).toContain("not installed");
    expect(got.warnings[0]).toContain("brew install ffmpeg");
    await expect(stat(out)).rejects.toThrow();
  }, 120_000);

  it("refuses an input it cannot measure, rather than guessing a box", async () => {
    const bad = join(dir, "not-a-video.mp4");
    await writeFile(bad, "not a video at all");
    await expect(transcode(bad, join(dir, "bad.webm"))).rejects.toThrow(/neither an ISO/);
  });
});

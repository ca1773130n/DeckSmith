/**
 * Normalise a harvested video into a slide-sized VP9 webm.
 *
 * A page's video is whatever that page happened to serve: an H.264 mp4 at 4K, a
 * 40 MB clip for a 900px plate, a codec Chrome may or may not decode while the
 * deck is being captured. A deck pays for that twice. Once in bytes, because the
 * file is copied into its assets and shipped with it. And once at render,
 * because hyperframes PRE-DECODES every video to one still per output frame
 * before capture begins, at the SOURCE's own resolution — its extract command
 * carries no scale filter at all (node_modules/hyperframes/dist/cli.js:87575),
 * so a 4K source writes 4K stills that the slide then draws into an ~860px
 * plate. Transcoding once, here, makes the deck smaller, the render cheaper and
 * the codec certain.
 *
 * THE SCALE IS THE HALF THAT MAKES THE RENDER CHEAPER, AND VP9 IS NOT — saying
 * so is the point of this paragraph, because the obvious reading of the
 * paragraph above is that both do. hyperframes treats vp9 as alpha-capable
 * (`ALPHA_CAPABLE_CODECS = new Set(["vp9", "vp8", "prores"])`, cli.js:88610), so
 * `resolveFrameFormat` returns "png" for every VP9 file whether or not it
 * carries an alpha channel (cli.js:87863) and `decoderForCodec` hands the
 * extract command `libvpx-vp9`, which is software decode (cli.js:87857). Going
 * to webm therefore swaps the render's JPEG stills for PNG ones and gives up
 * whatever hardware decode the mp4 had. It wins on bytes and loses on that; the
 * pixels this drops are what pays for both. Nothing here has measured which way
 * that trade lands on a real deck — measure it before believing either
 * direction.
 *
 * WHY NOT ffprobe FOR THE MEASUREMENT, given that a machine which just ran the
 * encode certainly has one. Because `videoSize` in ./harvest.ts already reads a
 * width, a height and a duration out of an mp4 or webm header with no binary at
 * all, and reusing it buys two things a probe would not. The file handed back is
 * measured by the SAME parser the rest of ingest measures with, so a webm that
 * parser cannot read is caught here rather than a stage later. And the skip path
 * below — where there is no ffmpeg to ask anything — measures the original with
 * that one function instead of needing a second answer for it.
 *
 * That import points BACK at harvest, which is where the wiring will call this
 * from. Nothing here touches `videoSize` at module scope, so the cycle that
 * makes is one on paper: both sides only reach across it inside a call.
 *
 * ABSENCE IS NOT FAILURE. ffmpeg is a render dependency in this project
 * (src/mcp/prereqs.ts says so, and the comment over `videoSize` records the
 * decision that ingest must not acquire one), so a laptop with a browser and no
 * ffmpeg has to
 * come out of here with a working clip. It does: the original file, untouched,
 * and a warning naming what was skipped and what to install. A deck that is
 * bigger than it needed to be is far better than no deck. The same is true of an
 * encode that fails or overruns — every one of those degrades to the original
 * rather than ending an ingest that has already spent its download budget.
 *
 * DETERMINISM, MEASURED on this machine at ffmpeg 8.1 / libvpx: two runs over
 * one input are byte-identical WITH the flags below and are not without them —
 * the matroska muxer writes a random SegmentUID and stamps its own version
 * ("Lavf62.12.100") into the file, and `-fflags +bitexact -flags:v +bitexact
 * -map_metadata -1` is what removes all three. What those flags do NOT buy is
 * byte-equality across machines: the same command with `-threads 1` produced a
 * different file from the default thread count on the same build, because
 * libvpx partitions the frame by thread count. So this is reproducible on a
 * machine, and it is not reproducible across ffmpeg builds or core counts. It is
 * not claimed to be.
 *
 * WHAT THE CALLER OWES ITS FIGURE. `width`, `height`, `seconds` and the file all
 * move together — types.ts:48 says a clip figure's box is the VIDEO's, and every
 * fit, crop and leader-line fraction downstream is a fraction of it. Write the
 * numbers this returns, not the ones the page's file had.
 */
import { readFile, rm } from "node:fs/promises";
import { basename } from "node:path";
import { runTool } from "../render/ffmpeg.js";
import { videoSize } from "./harvest.js";

/**
 * The longest edge a clip is ever drawn at, whichever way it is turned.
 *
 * ONE number for both edges rather than a 1280x720 box, because the deck renders
 * vertical formats too: bounding the height at 720 would take a 1080x1920
 * portrait clip to 405x720 and leave a 1080-wide slide upscaling it back into a
 * soft plate. 1280 sits comfortably above the largest plate any format offers —
 * `figMax` on a 1920x1080 slide is what the claim and the caption leave, and the
 * emitter caps the tag in CSS at that (claim-figure.ts:344).
 */
const CLIP_EDGE_PX = 1280;

/**
 * The longest clip kept, in seconds.
 *
 * 60 is not a taste. types.ts:516 caps a BEAT at 60 seconds, so a clip trimmed
 * to 60 can still never end before the beat it plays under. That is the failure
 * being avoided: the deck seeks a clip on its own absolute clock, so a video
 * shorter than its beat holds its last frame for the remainder with every gate
 * green — written up at src/emit/archetypes/claim-figure.ts:133.
 */
const MAX_CLIP_SECONDS = 60;

/** Room for a 4K source, and short enough that a wedged encode is not a hang. */
const TIMEOUT_MS = 600_000;

export interface TranscodeOptions {
  /** Longest edge of the box to fit inside, in pixels. Default 1280. */
  maxEdgePx?: number;
  /** Seconds to keep. A longer video is TRUNCATED, and the trim is warned. */
  maxSeconds?: number;
  /** Wall clock for the ffmpeg run before it is killed. Default 10 minutes. */
  timeoutMs?: number;
  /**
   * TEST SEAM: the binary to run. Only ever "ffmpeg" in src.
   *
   * It exists so test/transcode.test.ts can prove the skip path by naming a
   * binary that is not installed, which is the one branch here that cannot be
   * exercised on a machine where the feature works.
   */
  ffmpeg?: string;
}

export interface Transcoded {
  /** The `out` given, or the `input` given back when nothing was done to it. */
  path: string;
  /** Measured off the file `path` names — never the arithmetic that asked for it. */
  width: number;
  height: number;
  /** Absent when the container declares no usable duration, as `Measured` says. */
  seconds?: number;
  /** False when `path` is still the original's bytes. */
  transcoded: boolean;
  /** What was skipped or traded, and why. Empty when nothing was. */
  warnings: string[];
}

/**
 * The even box `width`x`height` fits inside, never larger than it started.
 *
 * FLOOR to even rather than round, on both edges. Even because VP9 in yuv420p
 * refuses odd dimensions and says so in a way nobody reads as "your width is
 * odd"; floor because rounding UP a 1919-wide source that needs no scaling at
 * all would enlarge it by a pixel, and "never upscale" is easier to keep than to
 * qualify.
 *
 * Rounding each edge independently moves the aspect ratio by up to a pixel's
 * worth, and there is one place downstream where that is visible: claim-figure
 * picks a full-width layout at exactly `width / height >= 3` (claim-figure.ts:197),
 * so a source sitting on that boundary can land either side of it afterwards.
 * That is a layout choice moving one step, not a deck disagreeing with its file
 * — the figure carries the measured box, so the planner and the emitter still
 * describe the same rectangle.
 */
export function fitBox(
  width: number,
  height: number,
  maxEdgePx: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdgePx / width, maxEdgePx / height);
  return { width: even(width * scale), height: even(height * scale) };
}

/**
 * ROUNDED TO A PIXEL BEFORE IT IS FLOORED TO EVEN, and that is not tidiness.
 * 1080 * (1280 / 1920) is 719.9999999999999 in binary, and flooring that
 * straight to even gives 718 — a two-pixel aspect error conjured out of the
 * arithmetic rather than out of the picture.
 */
function even(n: number): number {
  return Math.max(2, Math.floor(Math.round(n) / 2) * 2);
}

/**
 * The command, built where it can be read and tested without running anything.
 *
 * The house pattern from src/render/ffmpeg.ts: an exported pure args builder and
 * a one-line `runTool` at the use site, so the flags are assertable on a machine
 * with no ffmpeg on it.
 *
 * `-an` drops the audio track outright. A clip is emitted muted on purpose — the
 * deck already spends its single audio track on narration (claim-figure.ts:121)
 * — so carrying the audio is pure bytes for something nothing will ever unmute.
 *
 * `-crf 32 -b:v 0` is libvpx-vp9's constant-quality mode; `-deadline good
 * -cpu-used 4 -row-mt 1` is the speed setting that makes this affordable at
 * ingest time (4 seconds of 1080p in 0.8s of wall clock, measured) rather than
 * the several-minutes-per-clip the encoder's defaults cost. The three bitexact
 * and metadata flags are the determinism story in the header.
 */
export function transcodeArgs(
  input: string,
  out: string,
  plan: { width: number; height: number; seconds?: number },
): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    ...(plan.seconds === undefined ? [] : ["-t", plan.seconds.toFixed(3)]),
    "-an",
    "-map_metadata",
    "-1",
    "-vf",
    `scale=${plan.width}:${plan.height}`,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "32",
    "-b:v",
    "0",
    "-deadline",
    "good",
    "-cpu-used",
    "4",
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    out,
  ];
}

/** One `-version` per binary per process: a page with four clips must not pay four probes. */
const probed = new Map<string, Promise<boolean>>();

/**
 * Is there an ffmpeg to run at all, asked BEFORE the encode.
 *
 * `runTool` turns a missing binary into an Error reading "`render` needs it",
 * which is the wrong sentence for a stage that is not render and the wrong shape
 * for a stage that degrades rather than refusing. So absence is a question, the
 * way src/mcp/prereqs.ts asks it, and the sentence about it is written here.
 */
function installed(file: string): Promise<boolean> {
  const asked = probed.get(file);
  if (asked !== undefined) return asked;
  const answer = runTool(file, ["-version"], { timeoutMs: 5_000 }).then(
    () => true,
    () => false,
  );
  probed.set(file, answer);
  return answer;
}

/**
 * Shrink `input` into `out`, and say what the result actually is.
 *
 * Throws for exactly one thing: an `input` this cannot measure. That is a bug at
 * the call site rather than a machine missing a tool — `grabVideo` in harvest
 * measures the same bytes with the same function before it writes them, and
 * refuses what it cannot read — and there is no honest box to hand back for a
 * file whose header says nothing. Everything else that can go wrong comes back
 * as the original plus a warning.
 */
export async function transcode(
  input: string,
  out: string,
  opts: TranscodeOptions = {},
): Promise<Transcoded> {
  const file = opts.ffmpeg ?? "ffmpeg";
  const maxSeconds = opts.maxSeconds ?? MAX_CLIP_SECONDS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const name = basename(input);

  const source = videoSize(await readFile(input));
  const box = fitBox(source.width, source.height, opts.maxEdgePx ?? CLIP_EDGE_PX);
  const kept = (why: string): Transcoded => ({
    path: input,
    width: source.width,
    height: source.height,
    seconds: source.seconds,
    transcoded: false,
    warnings: [`${name} was shipped as the page served it: ${why}`],
  });

  if (!(await installed(file))) {
    return kept(
      `${file} is not installed, or not on PATH, so it could not be shrunk to ` +
        `${box.width}x${box.height} VP9 — \`brew install ffmpeg\` / \`apt install ffmpeg\` ` +
        "and re-ingest to spend fewer bytes and a shorter render on it.",
    );
  }

  // Capped whenever the source is longer than the cap OR declares no length at
  // all: an unmeasurable duration is exactly where a 40-minute video hides.
  const trim = source.seconds === undefined || source.seconds > maxSeconds;
  const started = Date.now();
  try {
    await runTool(
      file,
      transcodeArgs(input, out, { ...box, ...(trim ? { seconds: maxSeconds } : {}) }),
      { timeoutMs },
    );
  } catch (err) {
    // The child `runTool` spawned is the only process signalled, and only by
    // `execFile`'s own timeout, which SIGTERMs that pid and nothing else. What
    // it leaves behind is a truncated webm under the name the caller expects a
    // whole one at, so it goes before anything can adopt it.
    await rm(out, { force: true });
    const over = Date.now() - started >= timeoutMs;
    return kept(
      over
        ? `${file} ran past its ${(timeoutMs / 1000).toFixed(0)}s budget and was stopped ` +
            "(raise timeoutMs, or cap the clip harder with maxSeconds)."
        : `${file} failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let measured: ReturnType<typeof videoSize>;
  try {
    measured = videoSize(await readFile(out));
  } catch (err) {
    // Measured with the ingest parser rather than ffprobe on purpose, so this
    // branch means what it says: whatever was written is not a file the rest of
    // this pipeline can read a box out of, and a figure whose box is a guess
    // misplaces every annotation taken against it.
    await rm(out, { force: true });
    return kept(
      `the webm ${file} wrote could not be measured — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const warnings: string[] = [];
  // Only when it demonstrably stopped AT the cap. `-t` is passed for an unknown
  // duration too, and warning there on a five-second video would be a lie.
  if (trim && measured.seconds !== undefined && measured.seconds >= maxSeconds - 0.05) {
    warnings.push(
      `${name} was trimmed to the ${maxSeconds}s cap (maxSeconds) from ` +
        `${source.seconds === undefined ? "an unstated length" : `${source.seconds.toFixed(1)}s`}: ` +
        "a clip is pre-decoded to one still per output frame, so everything past the cap " +
        "is bytes and decode that no beat is long enough to reach.",
    );
  }

  return {
    path: out,
    width: measured.width,
    height: measured.height,
    seconds: measured.seconds,
    transcoded: true,
    warnings,
  };
}

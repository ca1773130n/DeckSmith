/**
 * The ffmpeg surface, kept deliberately thin.
 *
 * Everything that can be wrong about a narrated video is arithmetic, and the
 * arithmetic is in ./timing.ts where it can be tested with no ffmpeg on the
 * machine. What is left here is process plumbing: probe a file, build a
 * filtergraph, run a command. Nothing in this module decides a time.
 *
 * WHY PIECES, AND NOT ONE FILTERGRAPH. The obvious way to retime a video is
 * `split` into N branches, `trim` each, and `concat` them back. It works on a
 * ten-second clip and it is a memory bomb on a four-minute one: `concat` will
 * not pull from branch 5 until branches 0-4 have run dry, so branch 5's trim
 * output queues in RAM for as long as that takes. On a 246-second 1080p deck
 * that is gigabytes, in a feature whose fourth requirement is surviving memory
 * pressure. So each piece is its own ffmpeg run over a linear graph — flat
 * memory, one process at a time — written to an MPEG-TS intermediate and joined
 * with the concat demuxer at `-c copy`. TS rather than MP4 because concatenated
 * elementary streams are what the format was designed for; mp4-to-mp4 copy
 * concat depends on the parameter sets matching in ways nothing checks.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Long renders and long encodes both. A four-minute deck takes minutes. */
const DEFAULT_TIMEOUT_MS = 3_600_000;

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Run a command, and on failure raise the last of its output rather than the
 * whole log. ffmpeg says what is wrong in its final lines; the four hundred
 * before them are the build configuration.
 */
export async function runTool(
  file: string,
  args: string[],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(file, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 64 << 20,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === "ENOENT") {
      throw new Error(`${file} is not installed, or not on PATH. \`render\` needs it.`);
    }
    const tail = (e.stderr ?? e.stdout ?? e.message).trim().split("\n").slice(-8).join("\n");
    throw new Error(`${file} failed:\n${tail}`);
  }
}

/**
 * Run a command with its stderr going straight to ours, live.
 *
 * `runTool` buffers, which is right for ffprobe and wrong for the capture: a
 * seven-minute render that prints nothing until it ends is a render you cannot
 * tell from a hung one, and the failure this verb is meant to survive is
 * exactly a long job dying two thirds of the way through. Streaming means the
 * frame counter is on screen when it stops.
 */
export function runLive(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new Error(`${file} is not installed, or not on PATH. \`render\` needs it.`)
          : err,
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal) {
        // A killed capture is almost always the OS reclaiming memory, and the
        // exit status alone reads like a crash in our code.
        reject(
          new Error(
            `${file} was killed by ${signal}. On a machine under memory pressure this is the OS reclaiming the browser; free memory, or lower --workers, and run again.`,
          ),
        );
      } else reject(new Error(`${file} exited ${code}.`));
    });
  });
}

export interface Probe {
  width: number;
  height: number;
  /** Exact, from `r_frame_rate` — 30000/1001 must not become 29.97. */
  fps: number;
  frames: number;
  seconds: number;
  hasAudio: boolean;
}

/** What a rendered file actually is, as opposed to what we asked for. */
export async function probe(path: string): Promise<Probe> {
  const { stdout } = await runTool("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration",
    "-of",
    "json",
    path,
  ]);
  const json = JSON.parse(stdout) as {
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      nb_frames?: string;
    }[];
    format?: { duration?: string };
  };
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`${path} has no video stream.`);

  const [num, den] = (video.r_frame_rate ?? "30/1").split("/");
  const fps = Number(num) / (Number(den) || 1);
  const seconds = Number(json.format?.duration ?? 0);
  // nb_frames is present for mp4 and absent for some containers; the product is
  // the honest fallback and is exact for the CFR output hyperframes writes.
  const frames = Number(video.nb_frames ?? 0) || Math.round(seconds * fps);

  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps,
    frames,
    seconds,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

/* -------------------------------------------------------------------- Video */

/**
 * Encoder settings, shared by every piece so the concat demuxer can copy.
 *
 * `-g 12` because each piece is opened at a keyframe anyway and short GOPs cost
 * little at this bitrate; `veryfast` because the whole point of the piece
 * pipeline is that it runs once per stop and there are dozens of them.
 */
export function encoderArgs(fps: number): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "12",
    "-r",
    String(fps),
    "-fps_mode",
    "cfr",
  ];
}

/**
 * One piece: `motion` frames from `fromFrame`, then `freeze` clones of the last.
 *
 * `-ss` on the INPUT so the decoder seeks rather than decoding and discarding
 * from zero — on a four-minute source the difference between the two is the
 * difference between a minute and an hour. It is a keyframe seek refined to the
 * requested time, so the first frame can land one frame either side of the one
 * asked for; the piece's LENGTH is exact regardless, because `trim=end_frame`
 * and `tpad=stop` count frames rather than seconds. A frame of content offset
 * is invisible. A frame of length error would accumulate across dozens of
 * pieces and pull every later sentence off its picture, which is the whole
 * failure this feature exists to prevent.
 */
export function pieceFilter(motion: number, freeze: number): string {
  const chain = [`trim=end_frame=${motion}`, "setpts=N/FRAME_RATE/TB"];
  if (freeze > 0) chain.push(`tpad=stop_mode=clone:stop=${freeze}`);
  return chain.join(",");
}

export function pieceArgs(
  source: string,
  fromFrame: number,
  motion: number,
  freeze: number,
  fps: number,
  out: string,
): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    // Half a frame in, so a time that is exactly on a boundary cannot round to
    // the frame before it.
    "-ss",
    ((fromFrame + 0.5) / fps).toFixed(6),
    "-i",
    source,
    "-an",
    "-vf",
    pieceFilter(motion, freeze),
    "-frames:v",
    String(motion + freeze),
    ...encoderArgs(fps),
    "-f",
    "mpegts",
    out,
  ];
}

/* -------------------------------------------------------------------- Audio */

export interface AudioInput {
  /** Path to the mp3, as ffmpeg will be given it. */
  file: string;
  delayMs: number;
}

/**
 * Delay every segment onto one track and sum them.
 *
 * `amix` with `normalize=0` sums rather than averaging: the default divides by
 * the input count, which on a 37-segment deck would render the narration 31 dB
 * down and sound exactly like a bug in the TTS. The segments never overlap — the
 * timing model gives each one the video's undivided attention — so summing is
 * safe. `dropout_transition=0` stops amix ramping the gain as inputs end.
 *
 * Every input is resampled and laid out identically first, because amix refuses
 * a mismatch and edge-tts emits 24 kHz mono while the video wants 48 kHz.
 * `apad` runs the track out to the video's length so the mux does not have to
 * choose between a short audio stream and `-shortest` truncating the picture.
 */
export function audioGraph(
  inputs: readonly AudioInput[],
  seconds: number,
  /**
   * ffmpeg input index of the first mp3. 1 when the video is the only other
   * input; higher once the burned-in caption bands have taken 1..n, and getting
   * this wrong points `adelay` at a PNG and mixes silence.
   */
  first = 1,
): string {
  const lines = inputs.map(
    (input, i) =>
      `[${first + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${input.delayMs}:all=1[d${i}]`,
  );
  const labels = inputs.map((_, i) => `[d${i}]`).join("");
  lines.push(
    `${labels}amix=inputs=${inputs.length}:normalize=0:dropout_transition=0:duration=longest,apad=whole_dur=${seconds.toFixed(3)}[aout]`,
  );
  return lines.join(";\n");
}

/* ----------------------------------------------------------------- Playback */

/**
 * Speed a finished mp4 up by `factor`, pitch preserved.
 *
 * `setpts` compresses the video's timestamps and `atempo` time-stretches the
 * audio without transposing it, so the voice stays the voice. This is the cheap
 * half of duration control: MEASURED at 169.0s → 58.3s in 4.1 seconds of wall
 * clock on experiments/010-burn-in/short.mp4, with no re-synthesis, no re-render
 * and no rebuild. The expensive half — how much is said in the first place —
 * happens back at plan time, because time-stretching cannot make 196 seconds of
 * sentences into 60 seconds of listenable ones.
 *
 * `chain` is `tempoChain`'s, and it is the caller's because `atempo` clamps to
 * 2.0 per instance and the decomposition is arithmetic that belongs where it can
 * be tested with no ffmpeg — the rule this file's header states.
 *
 * `-fps_mode cfr` at the source's own rate is what turns compressed timestamps
 * back into a normal file: frames are dropped to hold the frame rate, rather
 * than the container being handed a 37.5 fps stream nothing expects.
 */
export function respeedArgs(
  source: string,
  factor: number,
  chain: readonly number[],
  fps: number,
  hasAudio: boolean,
  out: string,
): string[] {
  const video = `[0:v]setpts=PTS/${factor}[v]`;
  const audio = hasAudio ? `;[0:a]${chain.map((t) => `atempo=${t}`).join(",")}[a]` : "";
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    source,
    "-filter_complex",
    `${video}${audio}`,
    "-map",
    "[v]",
    ...(hasAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] : ["-an"]),
    ...encoderArgs(fps),
    out,
  ];
}

/* ---------------------------------------------------------------- Subtitles */

export interface BurnStyle {
  width: number;
  height: number;
  fontSize: number;
  marginV: number;
  marginX: number;
  font: string;
}

/**
 * How a burned-in caption is styled.
 *
 * Vertical and square are watched muted, so the caption is the format rather
 * than an accessibility extra — it gets generous type and its own scrim.
 *
 * The band is drawn HERE and never in the composition. A band inside the slide
 * collides with content the archetypes already fill their canvas with; that was
 * measured once and fixed by moving the band out of the slide, and re-importing
 * it as a composition element would re-import the collision.
 */
export function burnStyle(width: number, height: number, font = "Arial"): BurnStyle {
  return {
    width,
    height,
    font,
    // MEASURED, not guessed. `splitCue` caps a cue at 84 characters and `wrap`
    // breaks it near the middle, so the longer of the two lines runs to about
    // 46 characters in real caption prose. Bold Arial advances 0.485em per
    // character on that prose (measured in a browser over the demo's own
    // narration), so 46 characters at F px is 22.3F wide, and the usable width
    // here is 978px. F = 40 leaves 9% of headroom; F = 45 — which is what
    // "4% of the width" looked like on paper — overflows to a THIRD line, and a
    // three-line band covers the bottom of the slide.
    fontSize: Math.round(width * 0.037),
    // Clear of the play button, the progress bar and the handle every vertical
    // player draws across the bottom eighth of the frame.
    marginV: Math.round(height * 0.09),
    marginX: Math.round(width * 0.04),
  };
}

/**
 * The band is drawn by ./captions.ts and composited with \`overlay\`, so nothing
 * here converts a cue to a subtitle format. What used to live below was an ASS
 * writer and a probe for the \`subtitles\` filter; both were deleted when the
 * libass path turned out to be unavailable on the ffmpeg most customers have.
 */

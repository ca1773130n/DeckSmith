/**
 * `render`: a built deck in, a finished video out.
 *
 * Four things happen here, in order, and each one is checked before the next
 * begins because the failure this verb exists to fix was a silent one — a
 * narrated deck rendering to a video with a single stream while thirty-seven
 * mp3s sat unused beside it, every gate green.
 *
 *   1. hyperframes renders the composition to a silent mp4.
 *   2. ./timing.ts says where each sentence goes; the video is retimed so the
 *      picture waits at each stop for exactly as long as the sentence takes.
 *   3. The segments are delayed onto one track and muxed on.
 *   4. Subtitles: an .srt beside the file. Burned in only when asked.
 *
 * MEMORY. The measured failure was a `--workers 1` render of the four-minute
 * demo dying at frame 5547 of 7395 with `Protocol error
 * (Page.captureScreenshot): Target closed` — not a timeout, a dead Chrome. One
 * page held open for 7,395 sequential screenshots is the thing that breaks; the
 * shape of the failure is a job that dies two thirds of the way through, which
 * is the worst shape there is. Three answers, all here:
 *
 *   - `--workers` defaults to hyperframes' auto rather than 1, because auto
 *     restarts pages across shards and 1 does not.
 *   - `--protocol-timeout` is raised from the 5-minute default, so a page that
 *     is merely slow is not mistaken for a page that is gone.
 *   - `--video` skips capture entirely and retimes an mp4 you already have, so
 *     a render that died in the mux does not cost another hour of Chrome.
 *
 * The mux itself is memory-flat by construction — see the note at the top of
 * ./ffmpeg.ts on why the video is retimed one piece per process rather than in
 * one filtergraph.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Cue } from "../deck/subtitles.js";
import { p95CueRate, playbackFactor, playbackWarning, tempoChain } from "../plan/duration.js";
import { familyFor } from "../source/fonts.js";
import { captionBlocker, overlayGraph, overlayInputs, renderCaptions } from "./captions.js";
import {
  type AudioInput,
  audioGraph,
  burnStyle,
  pieceArgs,
  probe,
  respeedArgs,
  runLive,
  runTool,
} from "./ffmpeg.js";
import { type FramePlan, framePlan, TIMING_FILE, type Timing, toSrt } from "./timing.js";

/** Written beside the mp4, and the source of the burned-in captions too. */
const SRT_NAME = (out: string) => `${basename(out).replace(/\.[^.]+$/, "")}.srt`;

export type SubtitleMode = "auto" | "burn" | "sidecar" | "none";

/** What a mode actually does. Pure, so the default can be tested without ffmpeg. */
export interface SubtitlePlan {
  /** Write the .srt beside the mp4. */
  sidecar: boolean;
  /** Cook the caption band into the picture too. */
  burn: boolean;
}

/**
 * SIDECAR BY DEFAULT. A burned-in caption is a decision taken away from the
 * viewer: every player on earth has a subtitle toggle and none of them can turn
 * off a band that is part of the picture. The band sits over the bottom ninth of
 * the frame (`burnStyle` in ./ffmpeg.ts) and the archetypes do not know it is
 * coming, so on a diagram that fills its canvas it lands on the content — which
 * is the frame the owner opened and the reason this default flipped.
 *
 * `auto` used to mean "burn if the canvas is vertical or square". It is kept as
 * a spelling of the default rather than removed, so an existing `--subtitles
 * auto` in someone's script keeps working — but it no longer decides anything,
 * because the thing it was deciding was not the renderer's to decide.
 *
 * Burning is still right for one case and it is a real one: a Reel or a Short
 * posted to a feed, watched muted, where the platform's own caption track is
 * either unavailable or off by default. That is `--subtitles burn`, typed on
 * purpose, and it costs a full libx264 re-encode — the sidecar path copies the
 * video bitstream through untouched.
 */
export function subtitlePlan(mode: SubtitleMode): SubtitlePlan {
  return { sidecar: mode !== "none", burn: mode === "burn" };
}

/**
 * WHAT A REAL FIX NEEDS. Making the band optional did not stop it covering the
 * slide; it only means you can now choose not to be covered. Anyone who wants
 * `--subtitles burn` to be safe rather than merely available has to do this, and
 * the shape of it is not obvious, so it is written down once here.
 *
 * THE MEASUREMENT. At 1080x1920 the band is 862x120px and `burnStyle`'s
 * `marginV` puts its baseline 173px off the bottom, so it occupies the bottom
 * 293px — 15.3% of the frame. Nothing in `src/emit` knows that. Extracted from
 * two frames of the same deck rendered both ways, the difference is confined to
 * exactly that strip (mean |Δ|Y of 8.2 there against 0.10 over the rest, which is
 * re-encode noise), and in the strip it lands on the title rule and the sub-line.
 *
 * THE CAUSE, precisely: the burn decision is taken HERE, at render time, and the
 * layout was fixed at build time. A render-time flag cannot move content that was
 * positioned an hour earlier. So every step below exists to move the decision
 * earlier, not to draw the band differently.
 *
 *  1. ONE SOURCE FOR THE BAND'S BOX. Today its height is implied by `burnStyle`
 *     (./ffmpeg.ts) plus the CSS in `captionPage` (./captions.ts) and is only
 *     known after a browser has laid the text out. Export a pure
 *     `bandReserve(width, height): number` — the bottom strip the band may
 *     occupy, `marginV` included, for the two-line worst case `wrap` and
 *     `splitCue` already bound. Both the renderer and the emitter must read that
 *     one function; a second copy of 0.09 and 0.037 is how this drifts back.
 *
 *  2. THE FORMAT HAS TO CARRY IT. `Format` in src/types.ts gains a
 *     `captionReserve: number`, defaulting to 0 and set by `build` when the
 *     caller says the render will burn — `build --subtitles burn`, or a
 *     `--reserve-captions` flag. It belongs on `Format` and not on `DeckOptions`
 *     because it changes the drawable box, which is what a format IS.
 *
 *  3. THE DRAWABLE BOX SHRINKS, IN ONE PLACE. `contentH` in src/emit/kit.ts
 *     becomes `height - 2·padY - captionReserve`. That is the whole geometric
 *     change: every archetype was audited for this and none of the twelve reads
 *     `format.height` directly — only `title.ts`, and only to ask which way up
 *     the canvas is. They all lay out into `contentH`, so subtracting there moves
 *     all of them at once. Note it must NOT go into `padY`: the padding is
 *     symmetric and the reserve is not, and a symmetric version would throw away
 *     as much off the top for nothing.
 *
 *  4. A GATE, OR THIS REGRESSES. `src/verify/check.ts` must fail a deck whose
 *     audience text falls inside the reserve — invariant 5 with a new floor. A
 *     purely geometric fix with no gate is one refactor away from being undone,
 *     and this failure is invisible to every gate that exists: the deck passes,
 *     the video renders, and only a person opening a frame ever finds out.
 *
 *  5. THE RENDERER REFUSES WHAT IT CANNOT HONOUR. `Timing` (./timing.ts) records
 *     the `captionReserve` the deck was built with, and `render --subtitles burn`
 *     errors when it is 0 — the same way `assertCapture` refuses a video that
 *     does not match its manifest. Otherwise the flag silently reintroduces the
 *     collision on any deck built before the reserve existed.
 *
 * NOT WORTH DOING: drawing the band inside the composition instead. That was
 * tried and reverted (see `burnStyle`), and it makes the collision unconditional
 * rather than opt-in, which is the wrong direction from where this now stands.
 */

export interface RenderOptions {
  /** A built deck directory — the one `build -o` wrote. */
  deck: string;
  /** Where the mp4 goes. */
  out: string;
  /** Skip capture and retime this file instead. */
  video?: string;
  workers?: string;
  quality?: string;
  fps?: number;
  /** CDP protocol timeout in ms, handed to hyperframes. */
  protocolTimeoutMs?: number;
  subtitles?: SubtitleMode;
  /**
   * Speed the finished video up to land near this many seconds.
   *
   * Only ever a SPEED-UP, and only ever the last thing that happens: the deck's
   * length is decided at plan time by how much it says, and this closes whatever
   * gap survived that. A video already inside the target is left alone rather
   * than padded — dead air is worse than eight seconds short.
   */
  targetSeconds?: number;
  /** Leave the per-piece intermediates on disk. */
  keep?: boolean;
  /** Progress, one line at a time. */
  log?: (message: string) => void;
}

export interface RenderResult {
  out: string;
  srt?: string;
  seconds: number;
  frames: number;
  segments: number;
  burned: boolean;
  /** What `targetSeconds` cost, if anything. 1 means the file was not respeeded. */
  playback: number;
}

export async function render(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.log ?? (() => {});
  const deck = resolve(opts.deck);
  const out = resolve(opts.out);
  // Named after the output, not fixed, so two renders into one directory — the
  // 16:9 cut and the vertical one, which is the ordinary case — cannot delete
  // each other's pieces halfway through.
  const work = join(dirname(out), `.${basename(out)}.parts`);

  const timing = await readTiming(deck);
  const plan0 = subtitlePlan(opts.subtitles ?? "sidecar");
  // Asked BEFORE the capture, because discovering it after is discovering it an
  // hour late. Burning is now only ever explicit, so a blocker is a refusal and
  // never a downgrade: the caller asked for something this machine cannot do.
  //
  // This used to ask ffmpeg whether it had libass, and on the ffmpeg most people
  // have the answer was no — see the note at the top of ./captions.ts. It now
  // asks whether there is a browser, which `render` needed anyway to capture the
  // picture, so on any machine that can render at all the answer is yes.
  if (plan0.burn) {
    const blocker = await captionBlocker();
    if (blocker) throw new Error(`Cannot burn in captions: ${blocker}`);
  }
  const burnable = plan0.burn;

  await mkdir(work, { recursive: true });

  try {
    const raw = opts.video
      ? resolve(opts.video)
      : await capture(deck, join(work, "raw.mp4"), opts, log);

    const shot = await probe(raw);
    log(
      `render: ${shot.frames} frames, ${shot.width}×${shot.height}, ${shot.fps.toFixed(3)} fps, ${shot.seconds.toFixed(2)}s`,
    );
    assertCapture(timing, shot);

    const plan = framePlan(timing, shot.fps);
    if (plan.frames > shot.frames) {
      throw new Error(
        `the retimed video needs ${plan.frames} frames but only ${shot.frames} were captured. The deck and its ${TIMING_FILE} disagree — re-run \`build\`.`,
      );
    }

    const retimed = await retime(raw, plan, work, log);
    const srtPath = join(dirname(out), SRT_NAME(out));

    // The factor is computed HERE, before a caption is written, from the frame
    // count the retimer is about to produce — `plan.frames / fps` is what the
    // muxed file will be, to the frame. Doing it after the mux would mean writing
    // the .srt against one timeline and shipping the mp4 on another, which is the
    // 40%-out-of-sync failure this feature is most able to produce and which
    // every gate in the stack would pass.
    const playback = opts.targetSeconds
      ? playbackFactor(plan.frames / shot.fps, opts.targetSeconds)
      : 1;
    // Burned captions are part of the picture and get sped up with it. The
    // sidecar is a separate file on a separate clock, so its times are divided.
    const cues = playback > 1 ? plan.cues.map((c) => scaleCue(c, playback)) : plan.cues;

    // `--subtitles none` used to still write the sidecar, which was harmless
    // while the sidecar was the thing nobody wanted. Now that it is the default,
    // "none" has to mean none, or there is no way to ask for a bare mp4.
    const srt = plan0.sidecar ? toSrt(cues) : "";
    if (srt) await writeFile(srtPath, srt);

    const burn = burnable && srt.length > 0;
    await mux(retimed, timing, plan, deck, out, work, burn ? plan.cues : undefined, shot.fps, log);

    if (playback > 1) {
      log(`render: speeding playback ${playback}× to reach ${opts.targetSeconds}s`);
      // Warned, never refused. The cue rate is measured off this deck's own
      // captions, so the ceiling it names is this deck's rather than a guess.
      const warning = playbackWarning(playback, p95CueRate(plan.cues));
      if (warning) log(`render: ${warning}`);
      const fast = join(work, `fast.${basename(out)}`);
      const muxed = await probe(out);
      await runTool(
        "ffmpeg",
        respeedArgs(out, playback, tempoChain(playback), shot.fps, muxed.hasAudio, fast),
      );
      await rename(fast, out);
    }

    const final = await probe(out);
    if (plan.audio.length > 0 && !final.hasAudio) {
      throw new Error(`${out} came out with no audio stream. The mux silently dropped it.`);
    }
    return {
      out,
      ...(srt ? { srt: srtPath } : {}),
      seconds: final.seconds,
      frames: final.frames,
      segments: plan.audio.length,
      burned: burn,
      playback,
    };
  } finally {
    if (!opts.keep) await rm(work, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ Reading */

async function readTiming(deck: string): Promise<Timing> {
  const path = join(deck, TIMING_FILE);
  const text = await readFile(path, "utf8").catch(() => {
    throw new Error(
      `${path} is missing. \`render\` needs the timing manifest \`build\` writes; rebuild the deck.`,
    );
  });
  const timing = JSON.parse(text) as Timing;
  if (timing.version !== 1) throw new Error(`${path} is version ${timing.version}; expected 1.`);
  return timing;
}

/**
 * The captured file has to be the deck the manifest describes.
 *
 * Everything downstream indexes frames by scene start, so a video of a
 * different length — a stale render, a deck rebuilt at another `--speed` — puts
 * every sentence somewhere it does not belong. Half a second of tolerance
 * covers the container rounding its duration and nothing else.
 */
function assertCapture(timing: Timing, shot: { width: number; height: number; seconds: number }) {
  if (shot.width !== timing.width || shot.height !== timing.height) {
    throw new Error(
      `the capture is ${shot.width}×${shot.height} but ${TIMING_FILE} describes a ${timing.width}×${timing.height} deck.`,
    );
  }
  if (Math.abs(shot.seconds - timing.duration) > 0.5) {
    throw new Error(
      `the capture is ${shot.seconds.toFixed(2)}s but ${TIMING_FILE} describes a ${timing.duration.toFixed(2)}s deck. One of them is stale.`,
    );
  }
}

/**
 * A cue on the sped-up timeline. Three decimals, invariant 10 — `toSrt` renders
 * milliseconds, and a cue that rounds differently between two runs moves a byte.
 */
function scaleCue(cue: Cue, factor: number): Cue {
  const at = (t: number) => Math.round((t / factor) * 1000) / 1000;
  return { ...cue, start: at(cue.start), end: at(cue.end) };
}

/* ------------------------------------------------------------------ Capture */

async function capture(
  deck: string,
  out: string,
  opts: RenderOptions,
  log: (m: string) => void,
): Promise<string> {
  const args = ["hyperframes", "render", deck, "-o", out];
  if (opts.fps) args.push("--fps", String(opts.fps));
  if (opts.quality) args.push("--quality", opts.quality);
  if (opts.workers) args.push("--workers", opts.workers);
  args.push("--protocol-timeout", String(opts.protocolTimeoutMs ?? 900_000));

  log("render: capturing the composition — this is the long part");
  await runLive("npx", args);
  return out;
}

/* ------------------------------------------------------------------ Retiming */

/**
 * Cut the captured video into pieces and clone a frame at every stop.
 *
 * A deck with no narration produces exactly one piece per scene and no freezes
 * at all, and then this is a no-op that would cost a full re-encode for
 * nothing — so the captured file is passed straight through and `mux` copies
 * the bitstream rather than encoding it. An un-narrated deck therefore comes
 * out of `render` with exactly the picture hyperframes produced, which matters
 * because the image-free fixture's byte-identical render is this project's
 * strongest regression test and a silent re-encode would void it.
 */
async function retime(
  raw: string,
  plan: FramePlan,
  work: string,
  log: (m: string) => void,
): Promise<string> {
  if (plan.pieces.every((p) => p.freeze === 0)) return raw;

  const list: string[] = [];
  for (const [i, piece] of plan.pieces.entries()) {
    const file = join(work, `p${String(i).padStart(4, "0")}.ts`);
    await runTool("ffmpeg", pieceArgs(raw, piece.from, piece.motion, piece.freeze, plan.fps, file));
    list.push(file);
    if ((i + 1) % 10 === 0 || i === plan.pieces.length - 1) {
      log(`render: retimed ${i + 1}/${plan.pieces.length} pieces`);
    }
  }

  const listFile = join(work, "pieces.txt");
  await writeFile(
    listFile,
    `${list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`,
  );
  const joined = join(work, "retimed.mp4");
  await runTool("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    joined,
  ]);
  return joined;
}

/* ---------------------------------------------------------------------- Mux */

async function mux(
  video: string,
  timing: Timing,
  plan: FramePlan,
  deck: string,
  out: string,
  work: string,
  burnCues: readonly Cue[] | undefined,
  fps: number,
  log: (m: string) => void,
): Promise<void> {
  const inputs: AudioInput[] = plan.audio.map((a) => ({
    file: join(deck, timing.audioDir, a.audio),
    delayMs: a.delayMs,
  }));

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", video];

  const graph: string[] = [];
  // The bands are inputs 1..n, so the audio segments have to come after them or
  // every `adelay` would land on a PNG. `audioGraph` indexes from 1 by
  // construction, so it is given the offset the band inputs pushed it to.
  const band = burnCues
    ? await renderCaptions(
        burnCues,
        burnStyle(timing.width, timing.height, familyFor(timing.lang) ?? "Arial"),
        deck,
        work,
      )
    : undefined;
  if (band) {
    log(`render: drew ${band.files.length} caption band(s), ${band.width}×${band.height}px`);
    graph.push(overlayGraph(burnCues as readonly Cue[], band));
  }
  if (band) args.push(...overlayInputs(band));
  for (const input of inputs) args.push("-i", input.file);
  if (inputs.length > 0) {
    graph.push(audioGraph(inputs, plan.frames / fps, 1 + (band?.files.length ?? 0)));
  }

  if (graph.length > 0) {
    const script = join(work, "mux.filter");
    await writeFile(script, `${graph.join(";\n")}\n`);
    args.push("-filter_complex_script", script);
  }

  args.push("-map", burnCues ? "[vout]" : "0:v");
  if (inputs.length > 0) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  if (burnCues) {
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "copy");
  }
  args.push("-movflags", "+faststart", out);

  log(
    `render: muxing ${inputs.length} segment(s)${burnCues ? " and burning in the captions" : ""} → ${out}`,
  );
  await mkdir(dirname(out), { recursive: true });
  await runTool("ffmpeg", args, { cwd: work });
}

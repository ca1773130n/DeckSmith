/**
 * The drift gate: render the same deck twice and compare the frames.
 *
 * Every other gate reads one artifact. This one is the only thing in the
 * pipeline that can catch a deck whose *capture* is unstable — a tween that
 * lands on a clock, a font that resolves late, a figure that decodes after the
 * shutter. `scanDeterminism` catches the sources it can name in the source text;
 * this catches the ones it cannot, by measurement.
 *
 * Two modes, because one guarantee does not fit both cases (EXPERIMENT-006,
 * "Where it actually comes from, and why the guarantee has to change"):
 *
 *  - `identical` — every frame byte for byte. Holds only for an image-free deck
 *    whose text is never scaled; `demo/fixtures/plain.storyboard.json` is that
 *    deck and exists for this mode alone. A regression here is a real defect,
 *    not rasteriser noise.
 *  - `psnr` — a floor of 40 dB per frame, for real decks. Skia rasterises a
 *    scaled glyph outline differently between runs and nothing the page can
 *    reach changes that; the measured worst case on a two-beat equation deck is
 *    44.0 dB, and every defect worth failing on — a blank plate, a missing
 *    reveal, a font fallen back to tofu, a layout shift — is a 20 dB event or
 *    worse. A gate that can never pass is worse than no gate, and byte equality
 *    on a real deck could never pass.
 *
 * Frames are compared, not videos. Comparing two mp4s conflates capture drift
 * with encoder decisions, and hypothesis 3 in EXPERIMENT-006 died on exactly
 * that confusion — the raw frames already differed before x264 ran.
 *
 * AND ONE THING THE A/B COMPARISON STRUCTURALLY CANNOT SEE. Its premise is that
 * two renders of one input should match, so a deck that renders FROZEN — GSAP
 * absent, a timeline never applied, motion hung off an `onUpdate` that
 * `suppressEvents` swallows (invariant 11) — passes by construction: two still
 * images are byte-identical, `identical` mode reports 100%, `psnr` reports `inf`.
 * MEASURED: the plain fixture with its 13 `tl.fromTo` lines deleted renders 210
 * frames carrying 3 distinct images, and every A/B number stays perfect. So this
 * gate also measures WITHIN one render — `measureMotion` below.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Finding, Verdict } from "../types.js";
import { readCanvas } from "./budget.js";

const run = promisify(execFile);

/** Below this, two renders of the same deck differ in a way a viewer would see. */
export const FLOOR_DB = 40;

/** The composition `build` writes. `deck.html` is the presented page and is not rendered. */
const COMPOSITION_PAGE = "index.html";

/**
 * Per render, and this runs two.
 *
 * The demo deck — 12 beats, 246 s, 7395 frames — takes about ten minutes a
 * render on an M-series Mac, because `--no-browser-gpu` puts every pixel through
 * SwiftShader. Generous rather than tight: a render cut off at the deadline
 * reports as a broken deck, which is the most expensive kind of wrong answer a
 * gate can give.
 */
const DEFAULT_RENDER_TIMEOUT_MS = 1_800_000;

/**
 * The archetypes a byte-identical fixture may use.
 *
 * Everything left out tweens `scale` on something that carries text, or draws a
 * raster: `equation-walk` scales the term it is explaining, `grid` scales whole
 * labelled cells, `line-chart` pops its dots from zero, and the two figure
 * archetypes place a decoded bitmap. Scaling an outline hands Skia a glyph-cache
 * decision that comes out differently between runs (EXPERIMENT-006), which is
 * exactly the noise `identical` mode must not contain — so a fixture that grew
 * one of these would start failing for a reason that is not a defect.
 *
 * Enforced by `test/drift.test.ts` against the committed fixture, because the
 * pressure on a fixture is always to make it more interesting.
 */
export const FIXTURE_SAFE_ARCHETYPES: ReadonlySet<string> = new Set([
  "title",
  "callout",
  "data-table",
  "pipeline",
  "stack",
  "bar-compare",
  "split-compare",
]);

export type DriftMode = "identical" | "psnr";

export interface DriftOptions {
  /** Default `psnr`. Use `identical` only on a deck that can actually hold it. */
  mode?: DriftMode;
  /** Per-frame PSNR floor in dB. Ignored in `identical` mode. */
  floorDb?: number;
  /**
   * Passed to `hyperframes render -w`. Worker sharding was tested and refuted as
   * a source of drift (EXPERIMENT-006, hypothesis 2), so this defaults to `auto`
   * and exists to re-test that, not to work around it.
   */
  workers?: number | "auto";
  /** Where the two frame directories go. A fresh temp directory by default. */
  workDir?: string;
  /** Keep the frames even when the gate passes. They are kept on failure regardless. */
  keep?: boolean;
  /** Per render, not for the pair. */
  timeoutMs?: number;
}

export interface DriftReport extends Verdict {
  mode: DriftMode;
  frames: number;
  /** Frames whose two PNGs are byte for byte the same. */
  identical: number;
  /** The lowest per-frame PSNR and the 1-based frame it fell on. Absent when nothing differed. */
  worst?: { frame: number; db: number };
  /** The two frame directories, when they were kept. */
  kept?: { a: string; b: string };
  /** What moved inside the first render. */
  motion: Motion;
}

/** One scene's window as the composition declares it, in seconds. */
export interface SceneWindow {
  id: string;
  start: number;
  duration: number;
}

/** What changed inside a single render. */
export interface Motion {
  /** Scenes that had frames of their own to compare, and did change. */
  live: readonly string[];
  /** Scenes that had frames of their own to compare, and did not. */
  frozen: readonly string[];
  /**
   * Scenes with fewer than two frames the scene does not share with a
   * neighbour. Reported rather than counted as a pass: "no rule applied" and
   * "the rule passed" have to stay distinguishable.
   */
  unmeasured: readonly string[];
  /** Distinct frames across the whole render — the only measure when no scene could be read. */
  distinct: number;
}

/**
 * `<div data-composition-id="s3" data-start="…" data-duration="…">` for every
 * scene, in document order.
 *
 * The attribute triple is EXPERIMENT-003's, and `emitComposition` puts it on
 * scenes and nothing else — `scanBudget` reads the same three. Anchored on the
 * opening tag rather than swept with one greedy pattern because a `[\s\S]{0,200}`
 * bridge between two attributes reads across the boundary into the next element
 * on a scene whose attribute order ever changes.
 */
export function readScenes(html: string): SceneWindow[] {
  const out: SceneWindow[] = [];
  for (const tag of html.match(/<div\b[^>]*>/g) ?? []) {
    const id = /\bdata-composition-id="(s\d+)"/.exec(tag)?.[1];
    const start = /\bdata-start="([0-9.]+)"/.exec(tag)?.[1];
    const duration = /\bdata-duration="([0-9.]+)"/.exec(tag)?.[1];
    if (id && start !== undefined && duration !== undefined)
      out.push({ id, start: Number(start), duration: Number(duration) });
  }
  return out;
}

/**
 * Did anything move, and where not?
 *
 * PER SCENE, not per deck, because the deck-level question has no threshold that
 * survives contact. MEASURED on the frozen fixture: 210 frames, 3 distinct
 * images, 2 frame-to-frame changes — one per scene switch, which HyperFrames
 * performs itself and which happens whether or not the deck's own timeline ever
 * ran. A twelve-scene frozen deck would show about twelve. So "more than N
 * distinct frames" is a bar that rises with the scene count and can be cleared by
 * a deck in which nothing the emitter wrote has any effect at all. Per scene the
 * bar is fixed and needs no calibration: a scene either changed during its own
 * window or it did not.
 *
 * A RATIO does not work either, and the two decks say why: the fixture's live
 * render is 138 distinct frames in 210 (65.7%) and the shipped demo's is 1198 in
 * 7395 (16.2%), because narration stretches every beat and a hold is one image
 * for as long as it lasts. A threshold set from the fixture fails the demo; one
 * set from the demo passes a deck where ten of twelve scenes are dead.
 *
 * ITS OWN WINDOW means the frames it does not share with a neighbour. Scenes
 * overlap by a crossfade — the fixture's s1 is [0, 3.4) and s2 is [3, 7) — and
 * those shared frames carry the switch, which is exactly the change that is not
 * evidence of the scene animating. Dropping them takes the frozen fixture's
 * per-scene count from 1 change to 0, against 55 and 92 in the live render, so
 * the rule is "at least one change", with no constant to argue about.
 *
 * That leaves the partial freeze visible too: one archetype whose reveal is
 * driven by a callback fails its own scene while the other eleven pass.
 */
export function measureMotion(
  hashes: readonly string[],
  scenes: readonly SceneWindow[],
  seconds: number,
): Motion {
  const distinct = new Set(hashes).size;
  const live: string[] = [];
  const frozen: string[] = [];
  const unmeasured: string[] = [];
  // Derived from what the renderer wrote, not from a nominal fps: the two
  // disagree by rounding (the demo is 7395 frames over 246.5s) and a frame index
  // off by one at a scene edge would attribute a switch to the wrong scene.
  const fps = seconds > 0 ? hashes.length / seconds : 0;

  for (const scene of scenes) {
    const end = scene.start + scene.duration;
    const mine = hashes.filter((_, i) => {
      const t = i / fps;
      if (t < scene.start || t >= end) return false;
      return !scenes.some((o) => o !== scene && t >= o.start && t < o.start + o.duration);
    });
    if (fps <= 0 || mine.length < 2) unmeasured.push(scene.id);
    else if (new Set(mine).size > 1) live.push(scene.id);
    else frozen.push(scene.id);
  }
  return { live, frozen, unmeasured, distinct };
}

/**
 * Render `dir` twice and compare.
 *
 * `dir` is a built deck directory — the thing `decksmith build -o` writes, with
 * `index.html` and `hyperframes.json` in it.
 */
export async function drift(dir: string, opts: DriftOptions = {}): Promise<DriftReport> {
  const mode = opts.mode ?? "psnr";
  const floorDb = opts.floorDb ?? FLOOR_DB;
  const work = opts.workDir ?? (await mkdtemp(join(tmpdir(), "decksmith-drift-")));
  const a = join(work, "a");
  const b = join(work, "b");

  const report = await compare(dir, a, b, mode, floorDb, opts);
  const keep = opts.keep || !report.passed;
  if (keep) report.kept = { a, b };
  // Only clean up what we made. A caller-supplied workDir is the caller's.
  else if (!opts.workDir) await rm(work, { recursive: true, force: true });
  return report;
}

async function compare(
  dir: string,
  a: string,
  b: string,
  mode: DriftMode,
  floorDb: number,
  opts: DriftOptions,
): Promise<DriftReport> {
  const empty = {
    mode,
    frames: 0,
    identical: 0,
    motion: { live: [], frozen: [], unmeasured: [], distinct: 0 },
  };

  // THE TWO PASSES USE DIFFERENT WORKER COUNTS, and that is the point.
  //
  // Rendering twice with identical settings tests one thing: run-to-run
  // stability. It is blind to a whole class of defect that this project measured
  // and could not see — `hyperframes render` shards frames CONTIGUOUSLY, one page
  // per worker, so worker k's first seek lands mid-deck. Anything a scene
  // measures lazily therefore measures under different conditions per worker. The
  // Seam B prototype put numbers on it: a lazily-measured arrow differed in
  // 286 of 360 frames between `--workers 1` and `--workers 3`, by up to 42px,
  // while `hyperframes check` reported `layout ok, 0 findings` and drift passed
  // both — because both renders used the same worker count.
  //
  // Since `render()` pins `--no-browser-gpu`, worker count must not change a
  // correct deck's pixels: SwiftShader is bit-exact across shard boundaries
  // (EXPERIMENT-007 measured 0/360 both ways). So a difference here is a real
  // order dependence, not rasteriser noise, and the same two renders now test
  // both properties for the same cost.
  //
  // `opts.workers`, when a caller sets it, still wins for both passes — a caller
  // who pinned a count is asking about that count.
  const counts: (number | "auto")[] =
    opts.workers !== undefined ? [opts.workers, opts.workers] : [1, 3];
  for (const [i, [out, label]] of [
    [a, "first"],
    [b, "second"],
  ].entries() as IterableIterator<[number, readonly [string, string]]>) {
    const why = await render(dir, out, { ...opts, workers: counts[i] });
    if (why)
      return {
        passed: false,
        findings: [finding("render_failed", `The ${label} render of ${dir} failed: ${why}`)],
        ...empty,
      };
  }

  const fa = await frames(a);
  const fb = await frames(b);
  if (fa.length === 0)
    return {
      passed: false,
      findings: [
        finding(
          "no_frames",
          `\`hyperframes render --format png-sequence\` wrote no frames to ${a}. Nothing was compared.`,
        ),
      ],
      ...empty,
    };
  if (fa.length !== fb.length)
    return {
      passed: false,
      findings: [
        finding(
          "frame_count_differs",
          `Two renders of the same deck produced ${fa.length} and ${fb.length} frames. The composition's duration is not stable, so no frame-by-frame comparison is meaningful.`,
        ),
      ],
      ...empty,
      frames: fa.length,
    };

  const differing: number[] = [];
  const ha: string[] = [];
  for (const [i, name] of fa.entries()) {
    const one = await sha(join(a, name));
    ha.push(one);
    if (one !== (await sha(join(b, name)))) differing.push(i + 1);
  }

  // The first render only. A second render that froze where the first did not is
  // already the largest PSNR event this gate can report; what needs its own
  // measurement is the case where BOTH froze, and one of them says that.
  const html = await readFile(join(dir, COMPOSITION_PAGE), "utf8").catch(() => "");
  const motion = measureMotion(ha, readScenes(html), readCanvas(html)?.seconds ?? 0);

  // Put a number on any difference whichever mode we are in: "12 frames differ"
  // is not actionable, "12 frames differ, worst 18.3 dB at frame 91" says
  // whether to look at frame 91 or to shrug.
  let worst: { frame: number; db: number } | undefined;
  if (differing.length > 0) {
    const stats = await psnr(a, b, fa[0] as string);
    if ("error" in stats)
      return {
        passed: false,
        findings: [finding("psnr_failed", stats.error)],
        mode,
        frames: fa.length,
        identical: fa.length - differing.length,
        motion,
      };
    worst = stats.worst;
  }
  return judge({
    mode,
    floorDb,
    frames: fa.length,
    differing,
    motion,
    ...(worst ? { worst } : {}),
  });
}

/**
 * Turn the measurement into a verdict. Pure, and separated from the plumbing
 * because this is the part with an opinion in it — everything above just shells
 * out and hashes.
 */
export function judge(m: {
  mode: DriftMode;
  floorDb: number;
  frames: number;
  /** 1-based indices of the frames whose two PNGs differ. */
  differing: readonly number[];
  /** Required whenever `differing` is non-empty. */
  worst?: { frame: number; db: number };
  motion: Motion;
}): DriftReport {
  const { mode, floorDb, frames, differing, worst, motion } = m;
  const identical = frames - differing.length;
  const base = { mode, frames, identical, motion, ...(worst ? { worst } : {}) };

  // BEFORE the A/B verdict, because the A/B verdict cannot be trusted here: two
  // frozen renders agree perfectly, so a deck that animates nothing arrives at
  // this function with a clean sheet and would otherwise be reported as the
  // healthiest deck the gate has ever seen.
  const still = stillness(motion, frames);
  if (still) return { ...base, passed: false, findings: [still] };

  if (differing.length === 0 || !worst)
    return {
      ...base,
      passed: true,
      findings: [
        note(
          `${frames} frames, all byte-identical across two renders at different worker counts${mode === "psnr" ? " — well clear of the floor" : ""}.${moved(motion)}`,
        ),
      ],
    };

  const where = `worst ${worst.db.toFixed(2)} dB at frame ${worst.frame} of ${frames}`;
  if (mode === "identical")
    return {
      ...base,
      passed: false,
      findings: [
        finding(
          "not_byte_identical",
          // The precondition is STATED, not asserted. `--identical` holds only for
          // a deck that is image-free and never scales a glyph, and nothing here
          // checks that the deck passed in is one — the flag is the caller's claim.
          // This message used to assert "this fixture is image-free and never
          // scales a glyph, so it has no rasteriser noise to blame", which is a
          // fact about `demo/fixtures/plain.storyboard.json` and false of every
          // real deck. Pointed at the vertical demo it reads as a determinism bug
          // and sends the reader hunting for a clock, when the truth is that
          // `equation-walk` tweens `scale: 1.16` on a glyph and Skia rasterises a
          // scaled outline differently between runs — exactly the noise `psnr`
          // mode exists to tolerate. Naming the dB lets the reader tell the two
          // apart in one line instead of one render.
          `${differing.length} of ${frames} frames differ between two renders (${where}). \`--identical\` holds only for a deck that is image-free and never scales a glyph; if this deck does either, that is rasteriser noise and the ${floorDb} dB floor is the gate you want — drop \`--identical\`. If it does neither, something in the deck or the engine became render-time dependent. Differing frames: ${differing.slice(0, 8).join(", ")}${differing.length > 8 ? ", …" : ""}.`,
        ),
      ],
    };

  if (worst.db < floorDb)
    return {
      ...base,
      passed: false,
      findings: [
        finding(
          "psnr_below_floor",
          `${differing.length} of ${frames} frames differ between two renders, ${where}, under the ${floorDb} dB floor. That is not rasteriser noise — a blank plate, a missing reveal, a font fallen back, or a layout shift all land here. Open frame ${worst.frame} in both renders and look.`,
        ),
      ],
    };

  return {
    ...base,
    passed: true,
    findings: [
      note(
        `${identical} of ${frames} frames byte-identical, ${differing.length} differing, ${where} — above the ${floorDb} dB floor.${moved(motion)}`,
      ),
    ],
  };
}

/**
 * One render to a PNG sequence. Returns why it failed, or nothing.
 *
 * `--no-browser-gpu` is pinned rather than defaulted: hardware and SwiftShader
 * produce different pixels, and hardware is not even stable across worker
 * counts, so a gate that let Chrome probe for a GPU would be measuring the host
 * rather than the deck.
 */
async function render(dir: string, out: string, opts: DriftOptions): Promise<string | undefined> {
  const args = [
    "hyperframes",
    "render",
    dir,
    "--format",
    "png-sequence",
    "--no-browser-gpu",
    "--quiet",
    "-o",
    out,
  ];
  if (opts.workers !== undefined) args.push("-w", String(opts.workers));
  try {
    await run("npx", args, {
      timeout: opts.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
      maxBuffer: 32 << 20,
    });
    return undefined;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    return tail(e.stderr ?? "") || e.message.trim() || "no reason given";
  }
}

/** The PNGs a png-sequence render wrote, in frame order. */
async function frames(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(".png")).sort();
}

async function sha(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

const STAT = /^n:(\d+)\b.*\bpsnr_avg:(inf|-?[\d.]+)/;

/**
 * `frame_000001.png` → `frame_%06d.png`, for ffmpeg's image2 demuxer.
 *
 * Derived from what the renderer actually wrote rather than hardcoded, because
 * the naming is HyperFrames' business: a version that renames its frames should
 * make this say so, not silently compare nothing.
 */
export function framePattern(name: string): { pattern: string; start: number } | undefined {
  const m = /^(.*?)(\d+)(\.png)$/.exec(name);
  if (!m) return undefined;
  const digits = m[2] as string;
  return { pattern: `${m[1]}%0${digits.length}d${m[3]}`, start: Number(digits) };
}

/** The lowest `psnr_avg` in an ffmpeg stats stream, and the frame it fell on. */
export function worstFrame(stats: string): { frame: number; db: number } | undefined {
  let worst: { frame: number; db: number } | undefined;
  for (const line of stats.split("\n")) {
    const s = STAT.exec(line);
    if (!s) continue;
    // Identical frames report `inf`; they are the ones we are not looking for.
    const db = s[2] === "inf" ? Number.POSITIVE_INFINITY : Number(s[2]);
    if (!worst || db < worst.db) worst = { frame: Number(s[1]), db };
  }
  return worst;
}

/**
 * Per-frame PSNR for two frame directories, via ffmpeg's `psnr` filter.
 *
 * The average is over every plane the frames carry, alpha included. That dilutes
 * a colour-only difference by about 1.25 dB against an RGB-only comparison,
 * which is far inside the margin between the 40 dB floor and the 44 dB worst
 * case — and it means a plate that renders transparent instead of dark is
 * caught, which an RGB comparison would miss entirely.
 */
async function psnr(
  a: string,
  b: string,
  firstFrame: string,
): Promise<{ worst: { frame: number; db: number } } | { error: string }> {
  const seq = framePattern(firstFrame);
  if (!seq) return { error: `Cannot read a frame-number pattern out of "${firstFrame}".` };

  let stdout: string;
  try {
    ({ stdout } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-start_number",
        String(seq.start),
        "-i",
        join(a, seq.pattern),
        "-start_number",
        String(seq.start),
        "-i",
        join(b, seq.pattern),
        "-lavfi",
        "psnr=stats_file=-",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 64 << 20 },
    ));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT")
      return { error: "ffmpeg is not on PATH, so the frames could not be compared." };
    return {
      error: `ffmpeg could not compare the two frame sequences: ${tail(e.stderr ?? e.message)}`,
    };
  }

  const worst = worstFrame(stdout);
  if (!worst) return { error: `ffmpeg printed no psnr statistics. Last output: ${tail(stdout)}` };
  return { worst };
}

/**
 * The finding for a render that did not move, or nothing.
 *
 * Worth a separate rule from anything else here because the repair is different
 * in kind. Every other drift failure says "two renders disagree, go look at the
 * frame". This one says the deck never animated at all, and the causes are a
 * short list: the timeline never got built, the vendored GSAP is not there, or —
 * the one that has cost this project the most — a tween whose state is applied
 * from a callback, which `seek(suppressEvents)` never fires (invariant 11).
 */
function stillness(motion: Motion, frames: number): Finding | undefined {
  const measured = motion.live.length + motion.frozen.length;
  if (motion.frozen.length > 0)
    return finding(
      "frozen_scene",
      `${motion.frozen.length} of ${measured} scene(s) hold one unchanging image for every frame they do not share with a neighbour: ${motion.frozen.join(", ")}. ` +
        `Two renders of a frozen deck are byte-identical, so nothing else in this gate can see it. ` +
        `Look for a timeline that was never built, a missing vendor/gsap.min.js, or motion applied from a GSAP callback — \`seek()\` passes \`suppressEvents\`, so \`onUpdate\` never fires under capture and callback-driven motion renders still (invariant 11).`,
    );
  if (measured === 0 && frames > 1 && motion.distinct <= 1)
    return finding(
      "frozen_render",
      `All ${frames} frames of this render are the same image, and no scene windows could be read from the composition to say which scene stopped. The deck animates nothing. ` +
        `Two renders of a frozen deck are byte-identical, so nothing else in this gate can see it.`,
    );
  return undefined;
}

/** How the per-scene measurement went, for the note on a passing run. */
function moved(motion: Motion): string {
  const measured = motion.live.length + motion.frozen.length;
  if (measured === 0)
    return ` No scene window was readable, so motion was judged on the whole render: ${motion.distinct} distinct frames.`;
  const rest =
    motion.unmeasured.length > 0
      ? ` ${motion.unmeasured.length} scene(s) had too few frames of their own to judge: ${motion.unmeasured.join(", ")}.`
      : "";
  return ` All ${measured} measurable scene(s) moved within their own window.${rest}`;
}

function finding(rule: string, message: string): Finding {
  return { severity: "error", gate: "drift", rule, message };
}

function note(message: string): Finding {
  return { severity: "info", gate: "drift", rule: "stable", message };
}

function tail(s: string): string {
  return s.trim().split("\n").slice(-3).join(" / ").slice(0, 400);
}

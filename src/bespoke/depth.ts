/**
 * ROUND 6: the picture moves, not the UI over it.
 *
 * The founder's verdict on round 5 was that animated plates, chips, labels and
 * growing bars are old-fashioned motion. So an illustrated scene's motion now
 * comes from the picture itself, as a 2.5D camera move through it — the "3D
 * Ken Burns" effect (Niklaus et al. 2019, arXiv 1909.05483), built the way
 * single-image view synthesis builds it: a MULTIPLANE IMAGE (Zhou et al. 2018;
 * Tucker & Snavely 2020), a few fronto-parallel RGBA planes at fixed depths.
 * A multiplane image under a pinhole camera that translates and dollies is
 * rendered EXACTLY by giving each plane its own scale and offset — which is a
 * CSS transform per plane, tweened like any other (`planeFrame` in shots.ts).
 * So the effect needs no WebGL, stays inside every DOM gate, and is as
 * deterministic as the round-5 camera it replaces.
 *
 * WHERE THE DEPTH COMES FROM. Depth Anything V2 Small (Yang et al. 2024,
 * arXiv 2406.09414), Apple's Core ML build (`apple/coreml-depth-anything-v2-
 * small`, F16, 48 MB), run by a small Swift helper compiled once per machine.
 * MEASURED 2026-10-10 on an M4 at 12-22% free memory: 1.5s and 156 MB peak a
 * picture on the CPU, and a clean room-and-objects depth on round 5's flat
 * vector art. It runs on the BACKDROP only: round 5's pictures are already two
 * layers, so the subjects need no depth of their own — each stands where its
 * foot meets the backdrop's floor — and the backdrop is complete behind them,
 * so the disocclusions a single-image 3D photo has to inpaint (Shih et al.
 * 2020) are mostly not there. What a nearer backdrop plane uncovers on the one
 * behind it is filled by push-pull (sheet.ts), which suits flat colour.
 *
 * SHARPNESS. The image tool draws ~1.57 MP whatever it is asked. Pictures are
 * upscaled 2x before slicing by Real-ESRGAN's animevideov3 model (Wang et al.
 * 2021) through its ncnn/Vulkan build: MEASURED 1.6s and 129 MB a picture, and
 * crisp edges where Lanczos was soft.
 *
 * BOTH ARE OPTIONAL. Off macOS, without Swift, without the model or without the
 * upscaler, the picture is used as drawn: the backdrop becomes one far plane and
 * the subjects one near plane (round 5's parallax, in the new layout), and the
 * report says which and why (`DepthInfo`). Model weights never go in git:
 * `DECKSMITH_DEPTH_MODEL` / `DECKSMITH_UPSCALER` name them, else they are
 * looked for under `~/.cache/decksmith/`.
 */
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decodePng } from "../verify/fidelity.js";
import type { DepthCopies } from "./art.js";
import { exec, swiftBinary } from "./inspect.js";
import { depthPlanes } from "./sheet.js";

/** The Core ML package's directory name. */
export const DEPTH_MODEL_NAME = "DepthAnythingV2SmallF16.mlpackage";
/** The ncnn model the upscaler is run with (x2). */
export const UPSCALE_MODEL = "realesr-animevideov3";

/** How the planes of one picture were made, for the report. */
export interface DepthInfo {
  /** "depth-anything-v2-small" when the model ran; "flat" when it did not. */
  model: "depth-anything-v2-small" | "flat";
  /** Why it is flat. */
  reason?: string;
  /** 2 when the picture was upscaled before slicing; 1 when it was not (and why). */
  upscale: number;
  upscaleReason?: string;
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/** `~/.cache/decksmith`, where the optional models live. */
export function decksmithCache(env: NodeJS.ProcessEnv = process.env): string {
  return env.DECKSMITH_CACHE_DIR || join(env.HOME || homedir(), ".cache", "decksmith");
}

/** The depth model's path, or the reason there is none. */
export async function depthModel(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): Promise<{ path: string } | { reason: string }> {
  if (platform !== "darwin") return { reason: "no Core ML off macOS" };
  const path = env.DECKSMITH_DEPTH_MODEL || join(decksmithCache(env), "models", DEPTH_MODEL_NAME);
  return (await exists(path)) ? { path } : { reason: `no depth model at ${path}` };
}

/** The upscaler's binary and its models folder, or the reason there is none. */
export async function upscaler(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ bin: string; models: string } | { reason: string }> {
  const bin =
    env.DECKSMITH_UPSCALER ||
    join(decksmithCache(env), "tools", "realesrgan", "realesrgan-ncnn-vulkan");
  const models = join(dirname(bin), "models");
  if (!(await exists(bin))) return { reason: `no upscaler at ${bin}` };
  if (!(await exists(join(models, `${UPSCALE_MODEL}-x2.bin`))))
    return { reason: `no ${UPSCALE_MODEL}-x2 model in ${models}` };
  return { bin, models };
}

/**
 * The Swift helper: `depth <model> <in.png> <out.png>`. The package is compiled
 * on first use and the compiled model kept beside the helper, so later pictures
 * skip the compile. CPU only: the answer is cached per picture, and the CPU's
 * is the one that does not change with what else the GPU is doing.
 */
export const DEPTH_SWIFT = `import Foundation
import CoreML
import CoreImage
import ImageIO
import Vision

let a = CommandLine.arguments
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\\n").data(using: .utf8)!); exit(1) }
guard a.count == 5 else { fail("usage: depth <model.mlpackage> <compiled dir> <in.png> <out.png>") }
let pkg = URL(fileURLWithPath: a[1])
let compiled = URL(fileURLWithPath: a[2])
do {
  if !FileManager.default.fileExists(atPath: compiled.path) {
    let tmp = try MLModel.compileModel(at: pkg)
    try? FileManager.default.createDirectory(at: compiled.deletingLastPathComponent(), withIntermediateDirectories: true)
    let staged = compiled.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".mlmodelc")
    try FileManager.default.moveItem(at: tmp, to: staged)
    if (try? FileManager.default.moveItem(at: staged, to: compiled)) == nil { try? FileManager.default.removeItem(at: staged) }
  }
  let cfg = MLModelConfiguration()
  cfg.computeUnits = .cpuOnly
  let model = try MLModel(contentsOf: compiled, configuration: cfg)
  guard let (inName, inDesc) = model.modelDescription.inputDescriptionsByName.first,
        let c = inDesc.imageConstraint,
        let outName = model.modelDescription.outputDescriptionsByName.keys.first else { fail("not an image model") }
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[3]) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("cannot read the picture") }
  let fv = try MLFeatureValue(cgImage: img, constraint: c, options: [.cropAndScale: VNImageCropAndScaleOption.scaleFill.rawValue])
  let out = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: [inName: fv]))
  guard let pb = out.featureValue(for: outName)?.imageBufferValue else { fail("no depth image") }
  try CIContext().writePNGRepresentation(of: CIImage(cvPixelBuffer: pb), to: URL(fileURLWithPath: a[4]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  print("{\\"width\\":\\(CVPixelBufferGetWidth(pb)),\\"height\\":\\(CVPixelBufferGetHeight(pb))}")
} catch { fail("\\(error)") }
`;

/** One model run at a time per process: the machine is often short of memory. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

/**
 * The backdrop's depth as a grey RGBA PNG (Depth Anything's relative inverse
 * depth: brighter is nearer; RGBA because the repository's PNG reader takes
 * no greyscale), at the model's own 518x392. Rejects with why.
 */
export function estimateDepth(
  png: string,
  out: string,
  toolDir: string,
  model: string,
): Promise<void> {
  return serial(async () => {
    const bin = await swiftBinary("depth", DEPTH_SWIFT, toolDir);
    const compiled = join(toolDir, "models", DEPTH_MODEL_NAME.replace(/\.mlpackage$/, ".mlmodelc"));
    await exec(bin, [model, compiled, png, out], 120_000);
  });
}

/** `in.png` upscaled 2x into `out.png`, alpha kept. Rejects with why. */
export function upscale2x(
  png: string,
  out: string,
  up: { bin: string; models: string },
): Promise<void> {
  return serial(async () => {
    await mkdir(dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.tmp.png`;
    await exec(
      up.bin,
      ["-i", png, "-o", tmp, "-n", UPSCALE_MODEL, "-s", "2", "-m", up.models],
      180_000,
    );
    await rename(tmp, out).catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    });
  });
}

/**
 * Where to cut the backdrop into planes: depth quantiles of its pixels (a far
 * plane for the farther half, a middle and a near one), merged where two
 * planes would sit closer than `MIN_SEPARATION` in depth — a plane that moves
 * like its neighbour is bytes for nothing. `values` is the depth map's pixels
 * (0..255). Returns the cut points (0..1, ascending) — none for a flat picture.
 */
export const CUT_QUANTILES = [0.5, 0.82] as const;
export const MIN_SEPARATION = 0.12;

export function depthCuts(values: ArrayLike<number>): number[] {
  const n = values.length;
  if (n === 0) return [];
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(values[i] as number)));
    hist[v] = (hist[v] as number) + 1;
  }
  const at = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v] as number;
      if (acc >= q * n) return v / 255;
    }
    return 1;
  };
  const lo = at(0.02);
  const hi = at(0.98);
  const cuts: number[] = [];
  let prev = lo;
  for (const q of CUT_QUANTILES) {
    const c = at(q);
    // Each band must be deep enough to move differently from the one before it,
    // and the last must leave room for a band beyond it.
    if (c - prev >= MIN_SEPARATION && hi - c >= MIN_SEPARATION / 2) {
      cuts.push(Math.round(c * 1000) / 1000);
      prev = c;
    }
  }
  return cuts;
}

/**
 * The nearest and farthest a plane may be put, in subject-plane units. A plane
 * at z zooms by z / (z - (1 - 1/s)) when the camera pushes to s: MEASURED
 * 2026-10-10 on the first r6 deck, a foreground plane at 0.6 swung to 2.7x on a
 * 1.6x push and filled half the frame with a blurred wall. At 0.8 it is 1.9x.
 */
export const Z_NEAR = 0.8;
export const Z_FAR = 3;
/** Subjects stay within this range of the reference plane: their boxes are the camera's targets. */
export const SUBJECT_Z: readonly [number, number] = [0.8, 1.25];

/**
 * A plane's distance from the camera, from its relative inverse depth `u`
 * (0 far .. 1 near), with the subjects' typical `u` at distance 1 — the plane
 * the shell's camera frames (`#sid-cam`). Depth Anything's output is affine-
 * invariant disparity, so `0.35` stands in for its unknown shift: a far wall
 * at u≈0.1 lands at ~2x the subjects' distance, a near floor at ~0.75x.
 */
export function zOf(u: number, uRef: number): number {
  const z = (0.35 + uRef) / (0.35 + Math.max(0, u));
  return Math.round(Math.min(Z_FAR, Math.max(Z_NEAR, z)) * 1000) / 1000;
}

/** A subject's distance: where it stands on the backdrop, held near the reference plane. */
export function subjectZ(uFoot: number, uRef: number): number {
  const z = zOf(uFoot, uRef);
  return Math.round(Math.min(SUBJECT_Z[1], Math.max(SUBJECT_Z[0], z)) * 1000) / 1000;
}

/**
 * The depth under each subject's foot (the bottom centre of its box, a little
 * inside), read from the backdrop's depth map. Boxes are shares of the
 * picture; `depth` is the map, row-major, `w` x `h`.
 */
export function footDepths(
  depth: ArrayLike<number>,
  w: number,
  h: number,
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
): number[] {
  return boxes.map(([x, y, bw, bh]) => {
    const vals: number[] = [];
    const y0 = Math.min(h - 1, Math.max(0, Math.round((y + bh * 0.92) * h)));
    for (let dy = -2; dy <= 2; dy++) {
      const yy = Math.min(h - 1, Math.max(0, y0 + dy));
      for (let k = 0.3; k <= 0.701; k += 0.1) {
        const xx = Math.min(w - 1, Math.max(0, Math.round((x + bw * k) * w)));
        vals.push((depth[yy * w + xx] as number) / 255);
      }
    }
    vals.sort((a, b) => a - b);
    return Math.round((vals[vals.length >> 1] ?? 0.5) * 1000) / 1000;
  });
}

/** What `cutPicture` is given: a drawn picture, and where to work. */
export interface CutInput {
  /** The subjects' picture (transparent ground), or the whole picture when there is no backdrop. */
  subjects: Buffer;
  /** The backdrop, when the illustrator drew one. */
  plate?: Buffer;
  /** The subjects' boxes, shares of the subjects' picture (src/bespoke/inspect.ts). */
  boxes: ReadonlyArray<readonly [number, number, number, number]>;
  /** The frame the planes must cover, px. */
  frame: { width: number; height: number };
  /** Scratch for the intermediate PNGs. */
  work: string;
  tag: string;
  /** Where the compiled helpers live (the inspection's). */
  toolDir: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * A drawn picture cut into depth planes for the shell's camera: upscaled 2x
 * when the upscaler is there, its backdrop's depth estimated when the model is
 * there, sliced (sheet.ts `depthPlanes`), and every plane and subject given a
 * distance. Each optional step that cannot run is recorded in `info` and the
 * cut goes on without it; only a Chrome that cannot draw the planes throws.
 */
export async function cutPicture(i: CutInput): Promise<DepthCopies> {
  const env = i.env ?? process.env;
  const info: DepthInfo = { model: "flat", upscale: 1 };
  const backdrop = i.plate ?? i.subjects;
  const boxes = i.plate ? i.boxes : [];
  const file = (name: string) => join(i.work, `${i.tag}.${name}.png`);
  await mkdir(i.work, { recursive: true });
  await writeFile(file("plate"), backdrop);
  await writeFile(file("subjects"), i.subjects);
  const msg = (e: unknown) =>
    (e instanceof Error ? e.message : String(e)).split("\n").slice(-1)[0]?.slice(0, 160) ?? "";

  let plate2 = backdrop;
  let subj2 = i.subjects;
  const up = await upscaler(env);
  if ("bin" in up) {
    try {
      await upscale2x(file("plate"), file("plate2x"), up);
      if (i.plate) await upscale2x(file("subjects"), file("subjects2x"), up);
      plate2 = await readFile(file("plate2x"));
      if (i.plate) subj2 = await readFile(file("subjects2x"));
      info.upscale = 2;
    } catch (e) {
      info.upscaleReason = `the upscaler failed: ${msg(e)}`;
    }
  } else info.upscaleReason = up.reason;

  let depthPng: Buffer | undefined;
  let cuts: number[] = [];
  let feet: number[] = boxes.map(() => 0.5);
  const model = await depthModel(env);
  if ("path" in model) {
    try {
      await estimateDepth(file("plate"), file("depth"), i.toolDir, model.path);
      depthPng = await readFile(file("depth"));
      const f = await decodePng(depthPng);
      const values = new Uint8Array(f.width * f.height);
      for (let k = 0; k < values.length; k++) values[k] = f.pixels[k * f.channels] as number;
      cuts = depthCuts(values);
      if (boxes.length) feet = footDepths(values, f.width, f.height, boxes);
      info.model = "depth-anything-v2-small";
    } catch (e) {
      depthPng = undefined;
      info.reason = `the depth model failed: ${msg(e)}`;
    }
  } else info.reason = model.reason;

  const cut = await depthPlanes(plate2, depthPng, cuts, subj2, boxes, i.frame);
  const uRef = referenceDepth(
    feet,
    cut.planes.flatMap((p) => (p.u === undefined ? [] : [p.u])),
  );
  // Far to near, each nearer than the last; a flat picture's one backdrop plane
  // sits at round 5's parallax (half the subjects' zoom ≈ twice their distance).
  const planes: DepthCopies["planes"] = [];
  for (const p of cut.planes) {
    let z = depthPng && p.u !== undefined ? zOf(p.u, uRef) : FLAT_Z;
    const prev = planes[planes.length - 1];
    if (prev && z > prev.z - 0.05) z = Math.round((prev.z - 0.05) * 1000) / 1000;
    planes.push({ webp: p.webp, soft: p.soft, z });
  }
  return {
    frame: i.frame,
    scale: cut.scale,
    planes,
    subjects: cut.subjects.map((s) => ({
      webp: s.webp,
      soft: s.soft,
      z: depthPng ? subjectZ(feet[s.index] ?? uRef, uRef) : 1,
      subject: s.index + 1,
      box: s.box,
    })),
    info,
  };
}

/** A flat picture's backdrop distance: it moves at half the subjects' zoom, as round 5's did. */
export const FLAT_Z = 2;

/** The subjects' depth is at least this much nearer than the backdrop's farthest band (relative inverse depth). */
export const REF_BEHIND = 0.15;

/**
 * The depth the camera's plane (distance 1) is put at: the subjects' median
 * foot, held IN the scene — at least `REF_BEHIND` nearer than the backdrop's
 * farthest band and no nearer than its nearest — whatever the feet read (a
 * subject drawn high in its picture can land on the far wall of the
 * backdrop's map). MEASURED 2026-10-10: one picture's feet read farther than
 * every backdrop band, every plane landed nearer than the subjects, and the
 * backdrop zoomed MORE than they did (shot_variety: "no parallax").
 * `bands` are the planes' mean depths, far to near.
 */
export function referenceDepth(feet: readonly number[], bands: readonly number[]): number {
  const sorted = [...feet].sort((a, b) => a - b);
  const median = sorted.length ? (sorted[sorted.length >> 1] as number) : 0.5;
  if (!bands.length) return median;
  const lo = (bands[0] as number) + REF_BEHIND;
  const hi = Math.max(lo, bands[bands.length - 1] as number);
  return Math.min(hi, Math.max(lo, median));
}

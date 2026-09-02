/**
 * Briefs into pictures.
 *
 * A beat the planner could not find a figure for carries an `illustration`
 * instead. This turns each one into a file under `assets/`, registers it as an
 * ordinary `Figure` in the source and points the beat at it — after which
 * nothing downstream knows the picture was generated. It is a plan-time step,
 * like `narrate`: the picture is made once, here, and never during `build` or
 * at render time (VOCABULARY.md, Gap 3).
 *
 * Content-addressed the way narration is, and for the same reason: the file's
 * name carries the hash of everything that produced it — rung, model, aspect,
 * style, prompt — so re-running after an edit redraws only the briefs that
 * moved, and a second run over a finished storyboard calls nothing at all. The
 * brief stays on the beat afterwards as the provenance that hash is of.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prefs } from "../prefs.js";
import { imageSize } from "../source/assets.js";
import {
  type Figure,
  type Illustration,
  type Source,
  type Storyboard,
  sourceSchema,
  storyboardSchema,
} from "../types.js";
import {
  type ImageAspect,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  imageChain,
  resolveImageBackend,
  svgSize,
  toolSvg,
} from "./providers.js";

export interface IllustrateOpts {
  prefs: Prefs;
  /** `<dir of source.json>/assets`. Created if missing. */
  assetsDir: string;
  /** Tests inject; the default is `imageChain(prefs.images, resolveImageBackend())`. */
  chain?: ImageProvider[];
  /** Progress lines. Silent by default, for the reason `buildDeck` gives. */
  onStep?: (message: string) => void;
}

export interface Illustrated {
  beatId: string;
  figureId: string;
  /** Which rung drew it. */
  provider: string;
  /** The figure's `src`: a file name under `assetsDir`. */
  src: string;
  /** Found on disk from an earlier run; no provider was asked. */
  cached: boolean;
}

/** One picture to make: where it goes and what it is drawn from. */
interface Slot {
  /** For the log: `b03`, or `b03 left`. */
  label: string;
  beatId: string;
  figureId: string;
  aspect: ImageAspect;
  brief: Illustration;
  /** Writes the id into the beat once the figure exists. */
  assign: (figureId: string) => void;
}

const EXT: Readonly<Record<ImageResult["mime"], string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
};

/**
 * Draw every pending brief. Always finishes: the tool rung is last and pure.
 *
 * Returns fresh objects parsed through the schemas; the ones passed in are not
 * touched, so a caller that keeps the old storyboard around still holds the
 * pending one.
 */
export async function illustrate(
  storyboard: Storyboard,
  source: Source,
  opts: IllustrateOpts,
): Promise<{ storyboard: Storyboard; source: Source; illustrated: Illustrated[] }> {
  const { images } = opts.prefs;
  const step = opts.onStep ?? (() => {});
  const next = structuredClone(storyboard);
  const pending = slots(next, new Set(source.figures.map((f) => f.id)));
  let figures = [...source.figures];
  const illustrated: Illustrated[] = [];

  // The tool is always last, whatever was injected: the promise that this
  // function finishes rests on a rung that cannot fail being at the bottom.
  const chain = [...(opts.chain ?? imageChain(images, resolveImageBackend()))];
  const last = chain.at(-1);
  const tool = last?.id === "svg" ? last : toolSvg();
  if (tool !== last) chain.push(tool);

  // A rung that failed once is not asked again this run. That bounds spend: an
  // account with no image tool pays one `codex exec` to find out, not one per
  // picture — and a backend that is down is reported once, not six times.
  const dropped = new Set<string>();

  if (pending.length > 0) await mkdir(opts.assetsDir, { recursive: true });

  for (const [i, slot] of pending.entries()) {
    let rungs = chain;
    if (i >= images.max) {
      step(`illustrate: ${slot.label} is past images.max (${images.max}), so the tool draws it`);
      rungs = [tool];
    }
    const req: ImageRequest = {
      prompt: slot.brief.prompt,
      style: images.style,
      aspect: slot.aspect,
      ...(images.model === undefined ? {} : { model: images.model }),
    };
    const live = rungs.filter((p) => !dropped.has(p.id));
    for (const [j, provider] of live.entries()) {
      const name = `${slot.figureId}-${cacheKey(provider.id, req).slice(0, 8)}`;
      try {
        const picture = await draw(provider, req, name, opts.assetsDir);
        const figure: Figure = {
          id: slot.figureId,
          src: picture.src,
          caption: slot.brief.caption,
          width: picture.width,
          height: picture.height,
        };
        // Replace, never duplicate: a re-planned storyboard can arrive with a
        // stale `gen-b03` still in the source, and two figures under one id
        // would leave the emitter showing whichever it found first.
        figures = [...figures.filter((f) => f.id !== figure.id), figure];
        slot.assign(slot.figureId);
        illustrated.push({
          beatId: slot.beatId,
          figureId: slot.figureId,
          provider: provider.id,
          src: picture.src,
          cached: picture.cached,
        });
        break;
      } catch (err) {
        const after = live[j + 1];
        if (!after) throw err;
        const why = err instanceof Error ? err.message : String(err);
        step(`illustrate: ${slot.label} via ${provider.id} failed (${why}); trying ${after.id}`);
        dropped.add(provider.id);
      }
    }
  }

  return {
    storyboard: storyboardSchema.parse(next),
    source: sourceSchema.parse({ ...source, figures }),
    illustrated,
  };
}

/**
 * Every slot still waiting for a picture, in beat order. A slot whose
 * `figureId` names a figure the source has is done — that is what a finished
 * run leaves behind — and a slot with no brief has nothing to draw from.
 * `assign` writes into `storyboard`, which is the caller's clone.
 */
function slots(storyboard: Storyboard, known: ReadonlySet<string>): Slot[] {
  const done = (id: string | undefined) => id !== undefined && known.has(id);
  const out: Slot[] = [];
  for (const beat of storyboard.beats) {
    if (beat.archetype === "claim-figure") {
      const p = beat.params;
      if (p.illustration && !done(p.figureId)) {
        out.push({
          label: beat.id,
          beatId: beat.id,
          figureId: `gen-${beat.id}`,
          aspect: "landscape",
          brief: p.illustration,
          assign: (id) => {
            p.figureId = id;
          },
        });
      }
    } else if (beat.archetype === "split-compare") {
      for (const side of ["left", "right"] as const) {
        const s = beat.params[side];
        if (s.illustration && !done(s.figureId)) {
          out.push({
            label: `${beat.id} ${side}`,
            beatId: beat.id,
            figureId: `gen-${beat.id}-${side}`,
            aspect: "square",
            brief: s.illustration,
            assign: (id) => {
              s.figureId = id;
            },
          });
        }
      }
    }
  }
  return out;
}

/** Everything that changes the picture. `v1` so the shape can move without a stale hit. */
function cacheKey(providerId: string, req: ImageRequest): string {
  return createHash("sha256")
    .update(["v1", providerId, req.model ?? "", req.aspect, req.style, req.prompt].join("\n"))
    .digest("hex");
}

/**
 * The picture for one rung: from disk if an earlier run left it, else drawn
 * and written. Written through a temp name in the SAME directory and renamed,
 * so a crash mid-write leaves no half file that a later run would read as a
 * cache hit; the temp is removed in `finally` for the same reason.
 */
async function draw(
  provider: ImageProvider,
  req: ImageRequest,
  name: string,
  dir: string,
): Promise<{ src: string; width: number; height: number; cached: boolean }> {
  for (const ext of Object.values(EXT)) {
    const src = `${name}${ext}`;
    const bytes = await readFile(join(dir, src)).catch(() => null);
    if (bytes) return { src, ...sizeOf(bytes, ext), cached: true };
  }
  await provider.check();
  const img = await provider.generate(req);
  const src = `${name}${EXT[img.mime]}`;
  const tmp = join(dir, `.${name}.tmp`);
  try {
    await writeFile(tmp, img.bytes);
    await rename(tmp, join(dir, src));
  } finally {
    await rm(tmp, { force: true });
  }
  return { src, width: img.width, height: img.height, cached: false };
}

function sizeOf(bytes: Buffer, ext: string): { width: number; height: number } {
  return ext === ".svg" ? svgSize(bytes) : imageSize(bytes);
}

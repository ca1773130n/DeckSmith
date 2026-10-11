/**
 * region — parts of a picture picked out by a RULE with stated numbers, never
 * by coordinates the planner cannot see: `cut` crops (`count` random crops of
 * side `size`, drawn to scale on the picture at the training size `resize`,
 * then `gather`ed into one batch) or grid (cells of side `size`, lit row by
 * row). The crops' positions are random, as training draws them, from a
 * seeded generator: the same plan cuts the same crops.
 *
 * The picture is example material (the gate requires the tag); the sizes and
 * the count are the source's. The cut pieces are left for a later `evolve` to
 * stream (`material.tiles`).
 */
import type { KindImpl } from "../kind.js";
import { widthOf } from "../kind.js";
import { cropOf, cropOrigins, nativeSize } from "../kinds-shared.js";
import { type Rgb, readRgb } from "../kit.js";
import { type Tensor, tensor } from "../ops.js";
import type { Frame, MechanismResult, Prim, Raster } from "./common.js";
import { fitBox, resample, TYPE } from "./common.js";
import { num } from "./read.js";
import {
  placeholderPicture,
  rasterOf,
  runVerb,
  stagedFragment,
  type VerbCtx,
  writeLayers,
} from "./stage.js";

type Ctx = VerbCtx<"region">;

/** The picture as training sees it: resized to `resize`×`resize` (its middle square), or as it is. */
export async function trainingPicture(image: string, resize: number | undefined): Promise<Rgb> {
  const { w, h } = await nativeSize(image);
  const k = Math.min(1, 1600 / Math.max(w, h));
  const full = await readRgb(image, Math.round(w * k), Math.round(h * k));
  if (resize === undefined) return full;
  const side = Math.min(full.w, full.h);
  return resample(
    cropOf(full, Math.floor((full.w - side) / 2), Math.floor((full.h - side) / 2), side),
    resize,
    resize,
  );
}

export function region(c: Ctx): MechanismResult {
  const d = c.lit;
  const size = num(d.size.value, "region size");
  const resize = d.resize ? num(d.resize.value, "region resize") : undefined;
  if (!Number.isInteger(size) || size < 2)
    throw new Error("region size must be a whole number of pixels ≥ 2");
  if (resize !== undefined && (!Number.isInteger(resize) || resize < size))
    throw new Error("region resize must be a whole number of pixels, at least the size");
  if (!c.labels.picture?.trim()) throw new Error("region needs the `picture` slot");
  // At plan time the picture is a placeholder at the training size.
  const img = c.dry
    ? resample(
        placeholderPicture(),
        resize ?? Math.max(4 * size, 512),
        resize ?? Math.max(3 * size, 384),
      )
    : c.image;
  if (!img) throw new Error("region: the picture did not resolve to an image");
  if (img.w < size || img.h < size)
    throw new Error(`region: a ${size}px piece does not fit the ${img.w}×${img.h} picture`);
  return d.cut === "crops" ? crops(c, img, size) : grid(c, img, size);
}

const asTensor = (r: Rgb): Tensor => tensor(r.h, r.w, 3, r.d);

function crops(c: Ctx, img: Rgb, size: number): MechanismResult {
  const d = c.lit;
  if (!d.count) throw new Error("region crops needs `count`: how many crops (the batch)");
  const n = num(d.count.value, "region count");
  if (!Number.isInteger(n) || n < 1 || n > 8)
    throw new Error(`region draws 1–8 crops, got ${d.count.value}`);
  if (d.gather && !c.labels.batch?.trim())
    throw new Error("region `gather` needs the `batch` slot");
  const origins = cropOrigins(img.w, img.h, size, n, 4);
  const pieces = origins.map(([x, y]) => cropOf(img, x, y, size));
  const { width: W, height: H } = c.region;
  const top = 64;
  const tray = d.gather ? Math.min(560, W * 0.34) : 0;
  const B = fitBox(img.w, img.h, 0, top, W - tray - (tray ? 48 : 0), H - top);
  const k = B.w / img.w;
  const rasters: Record<string, Raster> = { pic: rasterOf(asTensor(img)) };
  pieces.forEach((p, i) => {
    rasters[`c${i}`] = rasterOf(asTensor(p));
  });
  const pic: Prim[] = [
    { p: "text", x: B.x, y: 8, size: TYPE.body, role: "fg", anchor: "start", slot: "picture" },
    { p: "image", x: B.x, y: B.y, w: B.w, h: B.h, layer: "pic", cam: true },
  ];
  const boxes = (reveal: boolean): Prim[] =>
    origins.map(
      ([x, y], i) =>
        ({
          p: "rect",
          x: B.x + x * k,
          y: B.y + y * k,
          w: size * k,
          h: size * k,
          role: "accent",
          width: 5,
          cam: true,
          ...(reveal ? { at: i + 1 } : {}),
        }) as Prim,
    );
  const frames: Frame[] = [{ id: "cut", prims: [...pic, ...boxes(true)], vars: {} }];
  if (d.gather) {
    const tx = W - tray;
    const cols = n <= 2 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const ts = Math.min((tray - (cols - 1) * 16) / cols, (H - top - (rows - 1) * 16) / rows);
    frames.push({
      id: "batch",
      prims: [
        ...pic,
        ...boxes(false),
        { p: "text", x: tx, y: 8, size: TYPE.body, role: "fg", anchor: "start", slot: "batch" },
        ...pieces.map(
          (_, i) =>
            ({
              p: "image",
              x: tx + (i % cols) * (ts + 16),
              y: top + Math.floor(i / cols) * (ts + 16),
              w: ts,
              h: ts,
              layer: `c${i}`,
              at: i + 1,
            }) as Prim,
        ),
      ],
      vars: {},
    });
  }
  return {
    rasters,
    frames,
    data: { thumb: "pic" },
    vars: {},
    material: { tiles: pieces.map(asTensor) },
  };
}

function grid(c: Ctx, img: Rgb, size: number): MechanismResult {
  const cols = Math.floor(img.w / size);
  const rows = Math.floor(img.h / size);
  if (cols > 32 || rows > 32)
    throw new Error(`region grid of ${cols}×${rows} cells is too fine to draw; at most 32×32`);
  const { width: W, height: H } = c.region;
  const top = 64;
  const B = fitBox(img.w, img.h, 0, top, W, H - top);
  const k = B.w / img.w;
  const prims: Prim[] = [
    { p: "text", x: B.x, y: 8, size: TYPE.body, role: "fg", anchor: "start", slot: "picture" },
    { p: "image", x: B.x, y: B.y, w: B.w, h: B.h, layer: "pic", cam: true },
  ];
  for (let q = 0; q <= cols; q++)
    prims.push({
      p: "line",
      x1: B.x + q * size * k,
      y1: B.y,
      x2: B.x + q * size * k,
      y2: B.y + rows * size * k,
      role: "fg",
      width: 2,
      opacity: 0.7,
      cam: true,
    });
  for (let r = 0; r <= rows; r++)
    prims.push({
      p: "line",
      x1: B.x,
      y1: B.y + r * size * k,
      x2: B.x + cols * size * k,
      y2: B.y + r * size * k,
      role: "fg",
      width: 2,
      opacity: 0.7,
      cam: true,
    });
  // Rows lit in turn (grouped when there are more than twelve).
  const per = Math.ceil(rows / 12);
  for (let r = 0; r < rows; r++)
    prims.push({
      p: "rect",
      x: B.x,
      y: B.y + r * size * k,
      w: cols * size * k,
      h: size * k,
      fill: "accent",
      opacity: 0.22,
      cam: true,
      at: Math.floor(r / per) + 1,
      wipe: true,
    });
  const tiles: Tensor[] = [];
  for (let r = 0; r < rows && tiles.length < 24; r++)
    for (let q = 0; q < cols && tiles.length < 24; q++)
      tiles.push(asTensor(cropOf(img, q * size, r * size, size)));
  return {
    rasters: { pic: rasterOf(asTensor(img)) },
    frames: [{ id: "grid", prims, vars: {} }],
    data: { thumb: "pic" },
    vars: {},
    material: { tiles },
  };
}

/** region as the build's kind: it reads the picture at the training size, not a display size. */
export const regionKind: KindImpl = {
  picture: true,
  async layers(input) {
    const lit = input.spec.data as Ctx["lit"];
    if (!input.image) throw new Error("literal: the region scene needs its picture");
    const resize = lit.resize ? num(lit.resize.value, "region resize") : undefined;
    const image = await trainingPicture(input.image, resize);
    const r = runVerb(region, {
      lit,
      labels: input.spec.labels,
      region: input.region,
      theme: input.theme,
      measure: (t, s) => widthOf(t, s, input.theme),
      dry: false,
      image,
      earlier: input.earlier,
      assets: {},
    });
    const L = await writeLayers(r, input.beatId, input.dir);
    return r.material ? { ...L, material: r.material } : L;
  },
  fragment(L, region, cues, spec, theme, href) {
    return stagedFragment("region", L, region, cues, spec, theme, href);
  },
};

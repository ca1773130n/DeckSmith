/**
 * region — parts of a picture picked out by a RULE, never by coordinates the
 * planner cannot see: `cut` crops (`count` random crops of side `size`, drawn
 * to scale on the picture at the training size `resize`, then `gather`ed into
 * one batch), grid (cells of side `size`, lit row by row), or panels (the
 * source's own figure split along its blank gutters, `findPanels`, each panel
 * then zoomed on its own sentence). The crops' positions are random, as training draws them, from a
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
  if (!c.labels.picture?.trim()) throw new Error("region needs the `picture` slot");
  if (d.cut === "panels") {
    const fig = c.dry ? placeholderFigure() : c.image;
    if (!fig) throw new Error("region: the figure did not resolve to an image");
    return panels(c, fig);
  }
  if (!d.size) throw new Error(`region ${d.cut} needs \`size\`: the piece's side`);
  const size = num(d.size.value, "region size");
  const resize = d.resize ? num(d.resize.value, "region resize") : undefined;
  if (!Number.isInteger(size) || size < 2)
    throw new Error("region size must be a whole number of pixels ≥ 2");
  if (resize !== undefined && (!Number.isInteger(resize) || resize < size))
    throw new Error("region resize must be a whole number of pixels, at least the size");
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

/* ----------------------------------------------------------------- panels */

/** A box in figure pixels. */
export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A figure's panels, from its pixels: recursive XY-cut along blank gutters.
 *
 * The ground is the colour of the figure's border; a pixel is ink when it
 * differs from it by more than 0.1 on any channel. A box is trimmed to its ink,
 * then split at the middle of its widest blank run of rows or columns, if that
 * run is at least 1.5% of the figure's side and leaves two parts big enough to
 * be panels (each side 12% of the figure's shorter side, each 3% of its area).
 * What cannot be split is a panel. Read in rows (top to bottom, a row being
 * panels whose tops are within 10% of the figure's height), left to right in
 * each. Deterministic: the same figure gives the same panels.
 */
export function findPanels(img: Rgb): PanelBox[] {
  const { w: W, h: H, d } = img;
  const at = (x: number, y: number, k: number) => d[(y * W + x) * 3 + k] as number;
  // The ground: the median of the border's pixels, channel by channel.
  const border: number[][] = [[], [], []];
  for (let x = 0; x < W; x++)
    for (const y of [0, H - 1]) for (let k = 0; k < 3; k++) border[k]?.push(at(x, y, k));
  for (let y = 0; y < H; y++)
    for (const x of [0, W - 1]) for (let k = 0; k < 3; k++) border[k]?.push(at(x, y, k));
  const ground = border.map((v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 1);
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let on = 0;
      for (let k = 0; k < 3; k++) if (Math.abs(at(x, y, k) - (ground[k] as number)) > 0.1) on = 1;
      ink[y * W + x] = on;
    }
  const minSide = 0.12 * Math.min(W, H);
  const minArea = 0.03 * W * H;
  const gutterMin = (side: number) => Math.max(4, Math.round(0.015 * side));
  const trim = (b: PanelBox): PanelBox | undefined => {
    let x0 = b.x + b.w;
    let y0 = b.y + b.h;
    let x1 = b.x - 1;
    let y1 = b.y - 1;
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++)
        if (ink[y * W + x]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    return x1 < x0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  /** The widest blank run inside `b` across `axis`, as [start, length]. */
  const gutter = (b: PanelBox, rows: boolean): [number, number] => {
    const n = rows ? b.h : b.w;
    const span = rows ? b.w : b.h;
    let best: [number, number] = [0, 0];
    let run = 0;
    for (let i = 0; i < n; i++) {
      let count = 0;
      for (let j = 0; j < span; j++) {
        const x = rows ? b.x + j : b.x + i;
        const y = rows ? b.y + i : b.y + j;
        count += ink[y * W + x] as number;
      }
      run = count <= span * 0.002 ? run + 1 : 0;
      if (run > best[1]) best = [i - run + 1, run];
    }
    return best;
  };
  const leaves: PanelBox[] = [];
  const cut = (box: PanelBox, depth: number) => {
    const b = trim(box);
    if (!b) return;
    const fits = (p: PanelBox) => p.w >= minSide && p.h >= minSide && p.w * p.h >= minArea;
    if (depth < 5) {
      const tries = (
        [
          [true, ...gutter(b, true)],
          [false, ...gutter(b, false)],
        ] as Array<[boolean, number, number]>
      ).sort((p, q) => q[2] - p[2]);
      for (const [rows, start, len] of tries) {
        if (len < gutterMin(rows ? H : W)) continue;
        const mid = start + Math.floor(len / 2);
        const a = rows ? { ...b, h: mid } : { ...b, w: mid };
        const z = rows
          ? { x: b.x, y: b.y + mid, w: b.w, h: b.h - mid }
          : { x: b.x + mid, y: b.y, w: b.w - mid, h: b.h };
        const ta = trim(a);
        const tz = trim(z);
        if (ta && tz && fits(ta) && fits(tz)) {
          cut(a, depth + 1);
          cut(z, depth + 1);
          return;
        }
      }
    }
    if (fits(b)) leaves.push(b);
  };
  cut({ x: 0, y: 0, w: W, h: H }, 0);
  const band = 0.1 * H;
  return leaves.sort((p, q) => (Math.abs(p.y - q.y) < band ? p.x - q.x : p.y - q.y));
}

/** At plan time: a white figure of three panels, so a plan can be checked without its figure. */
function placeholderFigure(): Rgb {
  const W = 480;
  const H = 300;
  const d = new Float32Array(W * H * 3).fill(1);
  const block = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) for (let k = 0; k < 3; k++) d[(y * W + x) * 3 + k] = v;
  };
  block(10, 10, 220, 280, 0.3);
  block(250, 10, 220, 130, 0.5);
  block(250, 160, 220, 130, 0.7);
  return { w: W, h: H, d };
}

function crop(img: Rgb, b: PanelBox): Rgb {
  const d = new Float32Array(b.w * b.h * 3);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      for (let k = 0; k < 3; k++)
        d[(y * b.w + x) * 3 + k] = img.d[((b.y + y) * img.w + (b.x + x)) * 3 + k] as number;
  return { w: b.w, h: b.h, d };
}

function panels(c: Ctx, img: Rgb): MechanismResult {
  const d = c.lit;
  const found = findPanels(img);
  if (found.length < 2)
    throw new Error(
      `region panels: the figure has no blank gutters to split it by (found ${found.length} panel); draw it as a figure, not as panels`,
    );
  const want = d.count ? num(d.count.value, "region count") : Math.min(6, found.length);
  if (!Number.isInteger(want) || want < 2 || want > 6)
    throw new Error(`region panels shows 2–6 panels, got ${want}`);
  if (want > found.length)
    throw new Error(
      `region panels: \`count\` is ${want} and the figure has ${found.length} panels`,
    );
  const list = found.slice(0, want);
  const { width: W, height: H } = c.region;
  const top = 64;
  const B = fitBox(img.w, img.h, 0, top, W, H - top);
  const k = B.w / img.w;
  const rasters: Record<string, Raster> = { pic: rasterOf(asTensor(img)) };
  const title: Prim = {
    p: "text",
    x: 0,
    y: 8,
    size: TYPE.body,
    role: "fg",
    anchor: "start",
    slot: "picture",
  };
  // The whole figure, its panels outlined one by one.
  const frames: Frame[] = [
    {
      id: "figure",
      prims: [
        title,
        { p: "image", x: B.x, y: B.y, w: B.w, h: B.h, layer: "pic", cam: true },
        ...list.map(
          (b, i) =>
            ({
              p: "rect",
              x: B.x + b.x * k,
              y: B.y + b.y * k,
              w: b.w * k,
              h: b.h * k,
              role: "accent",
              width: 5,
              cam: true,
              at: i + 1,
            }) as Prim,
        ),
      ],
      vars: {},
    },
  ];
  // Then each panel as large as the region holds, beside the figure in small
  // with that panel outlined: where in the figure this part sits.
  const thumbW = Math.min(360, W * 0.24);
  list.forEach((b, i) => {
    rasters[`p${i}`] = rasterOf(asTensor(crop(img, b)));
    const big = fitBox(b.w, b.h, 0, top, W - thumbW - 32, H - top);
    const T = fitBox(img.w, img.h, W - thumbW, top, thumbW, (H - top) / 2);
    const tk = T.w / img.w;
    frames.push({
      id: `panel${i}`,
      prims: [
        title,
        { p: "image", x: big.x, y: big.y, w: big.w, h: big.h, layer: `p${i}`, cam: true },
        { p: "image", x: T.x, y: T.y, w: T.w, h: T.h, layer: "pic", opacity: 0.85 } as Prim,
        {
          p: "rect",
          x: T.x + b.x * tk,
          y: T.y + b.y * tk,
          w: b.w * tk,
          h: b.h * tk,
          role: "accent",
          width: 4,
        },
      ],
      vars: {},
    });
  });
  return { rasters, frames, data: { thumb: "pic", panels: list }, vars: {} };
}

/** region as the build's kind: it reads the picture at the training size, not a display size. */
export const regionKind: KindImpl = {
  picture: true,
  async layers(input) {
    const lit = input.spec.data as Ctx["lit"];
    if (!input.image) throw new Error("literal: the region scene needs its picture");
    const resize = lit.resize ? num(lit.resize.value, "region resize") : undefined;
    // Panels read the figure as it is; crops and grid at the training size.
    const image = await trainingPicture(input.image, lit.cut === "panels" ? undefined : resize);
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

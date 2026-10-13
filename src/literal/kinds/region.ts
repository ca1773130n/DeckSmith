/**
 * region — the things in a picture the source says matter, picked out (the
 * approved look, .planning/designs/2026-10-12-verb-looks/5-region.png): the
 * picture large on the left, a numbered box on each thing with its number
 * outside the box, the numbered list of what each means on the right, then the
 * `outcome` the source draws from them, under a rule. The picture's legend
 * sits under it. Each thing is revealed with its line; the outcome last.
 *
 * The boxes are never the planner's guess: `plan` finds each `thing` in the
 * panel the scene shows (src/plan/locate.ts) and writes its box, as fractions of
 * that panel, into the storyboard. The panel is cut as `findPanels` cuts it, at
 * plan and at build alike. The picture is zoomed onto its marks only as far as
 * its own pixels allow (`MAX_UPSCALE`) and never past `CONTEXT` of the panel:
 * a stop sign alone says nothing.
 */
import type { KindImpl } from "../kind.js";
import { widthOf } from "../kind.js";
import { nativeSize } from "../kinds-shared.js";
import { type Rgb, readRgb } from "../kit.js";
import { type Tensor, tensor } from "../ops.js";
import type { MechanismResult, Prim } from "./common.js";
import { TYPE, wrapBy } from "./common.js";
import {
  placeholderPicture,
  rasterOf,
  runVerb,
  stagedFragment,
  type VerbCtx,
  withPushRoom,
  writeLayers,
} from "./stage.js";

type Ctx = VerbCtx<"region">;

/** The longest side a figure is read at: its own pixels, up to this. */
export const FIGURE_SIDE = 3200;

/** A figure at its own pixels (at most `FIGURE_SIDE` a side). */
export async function readFigure(image: string): Promise<Rgb> {
  const { w, h } = await nativeSize(image);
  const k = Math.min(1, FIGURE_SIDE / Math.max(w, h));
  return readRgb(image, Math.round(w * k), Math.round(h * k));
}

/** How many panels the build will cut a figure file into (`findPanels`). */
export async function figurePanels(image: string): Promise<number> {
  return findPanels(await readFigure(image)).length;
}

/** The picture a marked scene shows: the figure's `panel` (1-based), or all of it. */
export function panelOf(fig: Rgb, panel: number | undefined): Rgb {
  if (panel === undefined) return fig;
  const found = cutOf(fig);
  const b = found[panel - 1];
  if (!b)
    throw new Error(
      `region: \`panel\` is ${panel} and the figure has ${found.length} panel${found.length === 1 ? "" : "s"}`,
    );
  return crop(fig, b);
}

/** The most a figure is magnified over its own pixels: past it a crop shows its blur. */
export const MAX_UPSCALE = 2;

export function region(c: Ctx): MechanismResult {
  // At plan time: a photo-shaped placeholder; the panel is checked against the figure's count.
  const pic = c.dry ? placeholderPhoto() : c.image && panelOf(c.image, c.lit.panel);
  if (!pic) throw new Error("region: the picture did not resolve to an image");
  return withPushRoom(marked)({ ...c, image: pic });
}

const asTensor = (r: Rgb): Tensor => tensor(r.h, r.w, 3, r.d);

/* -------------------------------------------------------- the marked picture */

/** The list beside the picture: its width, a share of the scene's, within these. */
const SIDE_MIN = 440;
const SIDE_MAX = 560;
const SIDE_SHARE = 0.34;
const COL_GAP = 50;
/** A number's disc, and its gap to its box. */
const BADGE = 56;
const BADGE_GAP = 10;
const ROW_GAP = 30;
const LINE = Math.round(TYPE.label * 1.3);
/** The least share of the panel a zoom keeps: the things in their scene. */
const CONTEXT = 0.6;
/** Room kept around the marks' union when zooming, as a share of the panel's shorter side. */
const MARGIN = 0.12;
const LEGEND_GAP = 24;
const MAX_MARKS = 5;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Plan time: marks spread across the placeholder, where the locator has not looked yet. */
const placeholderBox = (i: number, n: number): Box => ({
  x: 0.15 + (0.7 * i) / n,
  y: 0.45,
  w: 0.08,
  h: 0.12,
});

function marked(c: Ctx): MechanismResult {
  const d = c.lit;
  const pic = c.image as Rgb;
  const n = d.marks.length;
  if (n < 1 || n > MAX_MARKS)
    throw new Error(`region marks 1–${MAX_MARKS} things in the picture, got ${n}`);
  // Each mark's box in the panel's pixels.
  const boxes = d.marks.map((m, i): Box => {
    const b = m.box ?? (c.dry ? placeholderBox(i, n) : undefined);
    if (!b)
      throw new Error(
        `region: mark ${i + 1} ("${m.thing}") has no box. \`decksmith plan\` finds each thing in the picture and writes it`,
      );
    if (!(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001))
      throw new Error(`region: mark ${i + 1}'s box is not inside the picture (fractions 0..1)`);
    return { x: b.x * pic.w, y: b.y * pic.h, w: b.w * pic.w, h: b.h * pic.h };
  });
  const { width: W, height: H } = c.region;
  const legend = c.labels.legend?.trim();
  const legendH = legend ? LEGEND_GAP + Math.round(TYPE.label * 1.18) : 0;
  if (legend && c.measure(legend, TYPE.label) > W)
    throw new Error("region: the `legend` is wider than the scene; shorten it");

  // The list: each mark's number and its words, then the outcome under a rule.
  const sideW = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, W * SIDE_SHARE)));
  const textW = sideW - BADGE - 20;
  const rowsOf = d.marks.map((m) => wrapBy(m.text, TYPE.label, textW, c.measure));
  const outcome = d.outcome && {
    title: wrapBy(d.outcome.title, TYPE.label, sideW, c.measure),
    lines: d.outcome.lines.flatMap((l) => wrapBy(l, TYPE.label, sideW, c.measure)),
  };
  if (d.outcome && (d.outcome.lines.length < 1 || d.outcome.lines.length > 3))
    throw new Error("region `outcome` takes 1–3 lines");
  const rowH = rowsOf.map((ls) => Math.max(BADGE, ls.length * LINE));
  const outcomeH = outcome
    ? ROW_GAP + 2 + 28 + (outcome.title.length + outcome.lines.length) * LINE
    : 0;
  const sideH = rowH.reduce((a, b) => a + b, 0) + (n - 1) * ROW_GAP + outcomeH;
  if (sideH > H)
    throw new Error(
      `region: the list of ${n} marks${outcome ? " and the outcome" : ""} is ${Math.round(sideH)}px tall and the scene holds ${Math.round(H)}px: give shorter \`text\` or fewer marks`,
    );

  // The window shown: the marks with room around them, in the panel's own shape, at
  // least CONTEXT of it, and no more magnified than its pixels allow.
  const areaW = W - sideW - COL_GAP;
  const areaH = H - legendH;
  const ux0 = Math.min(...boxes.map((b) => b.x));
  const uy0 = Math.min(...boxes.map((b) => b.y));
  const ux1 = Math.max(...boxes.map((b) => b.x + b.w));
  const uy1 = Math.max(...boxes.map((b) => b.y + b.h));
  const m = MARGIN * Math.min(pic.w, pic.h);
  const fit = Math.min(areaW / pic.w, areaH / pic.h);
  const f = Math.min(
    1,
    Math.max(CONTEXT, (ux1 - ux0 + 2 * m) / pic.w, (uy1 - uy0 + 2 * m) / pic.h, fit / MAX_UPSCALE),
  );
  const win: Box = { x: 0, y: 0, w: Math.round(f * pic.w), h: Math.round(f * pic.h) };
  win.x = Math.round(Math.min(pic.w - win.w, Math.max(0, (ux0 + ux1) / 2 - win.w / 2)));
  win.y = Math.round(Math.min(pic.h - win.h, Math.max(0, (uy0 + uy1) / 2 - win.h / 2)));
  const k = Math.min(fit / f, MAX_UPSCALE);
  const P: Box = { x: 0, y: 0, w: win.w * k, h: win.h * k };
  if (P.w < areaW * 0.5)
    throw new Error("region: the picture is too small to show beside its list; mark fewer things");

  // The group — picture, gap, list — centred across, the taller of the two centred down.
  const groupW = P.w + COL_GAP + sideW;
  const ox = Math.max(0, (W - groupW) / 2);
  const leftH = P.h + legendH;
  const oy = Math.max(0, (H - Math.max(leftH, sideH)) / 2);
  P.x = ox;
  P.y = oy + Math.max(0, (sideH - leftH) / 2);
  const sx = ox + P.w + COL_GAP;
  const sy = oy + Math.max(0, (leftH - sideH) / 2);

  const shown = boxes.map(
    (b): Box => ({
      x: P.x + (b.x - win.x) * k,
      y: P.y + (b.y - win.y) * k,
      w: b.w * k,
      h: b.h * k,
    }),
  );
  // Each number outside its box: right, left, above or below — the side that
  // covers the least of the other boxes and numbers, inside the picture.
  const placed: Box[] = [];
  const badges = shown.map((b) => {
    const cy = b.y + b.h / 2 - BADGE / 2;
    const cx = b.x + b.w / 2 - BADGE / 2;
    const tries: Box[] = [
      { x: b.x + b.w + BADGE_GAP, y: cy, w: BADGE, h: BADGE },
      { x: b.x - BADGE_GAP - BADGE, y: cy, w: BADGE, h: BADGE },
      { x: cx, y: b.y - BADGE_GAP - BADGE, w: BADGE, h: BADGE },
      { x: cx, y: b.y + b.h + BADGE_GAP, w: BADGE, h: BADGE },
    ];
    const cost = (t: Box) => {
      const out =
        Math.max(0, P.x - t.x) +
        Math.max(0, t.x + t.w - P.x - P.w) +
        Math.max(0, P.y - t.y) +
        Math.max(0, t.y + t.h - P.y - P.h);
      return (
        out * 1e4 +
        [...shown, ...placed].reduce(
          (s, o) => s + overlap(t, { x: o.x - 6, y: o.y - 6, w: o.w + 12, h: o.h + 12 }),
          0,
        )
      );
    };
    const best = tries.reduce((a, t) => (cost(t) < cost(a) ? t : a));
    placed.push(best);
    return best;
  });

  // A number on its disc. Never faded: dark digits on a disc at the preview's
  // opacity read at 1.78:1 (contrast_aa_failure, measured on the first build).
  const badge = (x: number, y: number, i: number, step: Partial<Prim>): Prim[] => [
    { p: "circle", cx: x + BADGE / 2, cy: y + BADGE / 2, r: BADGE / 2, fill: "b", ...step } as Prim,
    {
      p: "text",
      x: x + BADGE / 2,
      y: y + (BADGE - TYPE.label) / 2 - TYPE.label * 0.05,
      size: TYPE.label,
      role: "auto",
      anchor: "middle",
      weight: 700,
      text: String(i + 1),
      ...step,
    } as Prim,
  ];
  const prims: Prim[] = [
    { p: "image", x: P.x, y: P.y, w: P.w, h: P.h, layer: "pic", cam: true },
    ...(legend
      ? [
          {
            p: "text",
            x: P.x,
            y: P.y + P.h + LEGEND_GAP,
            size: TYPE.label,
            role: "muted",
            anchor: "start",
            slot: "legend",
          } as Prim,
        ]
      : []),
  ];
  let y = sy;
  d.marks.forEach((_, i) => {
    const at = i + 1;
    const b = shown[i] as Box;
    const g = badges[i] as Box;
    prims.push(
      // A dark ring under the stroke, so the box reads on a bright picture too.
      {
        p: "rect",
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        role: "panel",
        width: 11,
        opacity: 0.55,
        radius: 10,
        cam: true,
        at,
        wipe: true,
      },
      {
        p: "rect",
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        role: "b",
        width: 5,
        radius: 10,
        cam: true,
        at,
        wipe: true,
      },
      // On the picture: drawn in at its step (a wipe is never previewed). In the
      // list: there from the start, the list's numbered skeleton.
      ...badge(g.x, g.y, i, { at, wipe: true, cam: true }),
      ...badge(sx, y, i, {}),
    );
    const ls = rowsOf[i] as string[];
    ls.forEach((t, j) => {
      prims.push({
        p: "text",
        x: sx + BADGE + 20,
        y: y + (BADGE - TYPE.label * 1.18) / 2 + j * LINE,
        size: TYPE.label,
        role: "fg",
        anchor: "start",
        text: t,
        at,
      });
    });
    y += (rowH[i] as number) + ROW_GAP;
  });
  if (outcome) {
    const at = n + 1;
    prims.push({ p: "rect", x: sx, y, w: sideW, h: 2, fill: "rule", at });
    y += 2 + 28;
    for (const t of outcome.title) {
      prims.push({
        p: "text",
        x: sx,
        y,
        size: TYPE.label,
        role: "fg",
        anchor: "start",
        text: t,
        at,
      });
      y += LINE;
    }
    for (const t of outcome.lines) {
      prims.push({
        p: "text",
        x: sx,
        y,
        size: TYPE.label,
        role: "d",
        anchor: "start",
        weight: 600,
        text: t,
        at,
      });
      y += LINE;
    }
  }
  return {
    rasters: { pic: rasterOf(asTensor(crop(pic, win))) },
    frames: [{ id: "marks", prims, vars: {}, preview: true }],
    data: { thumb: "pic" },
    vars: {},
  };
}

/** At plan time: a photo's shape at a photo's pixels, where the marks are laid out. */
function placeholderPhoto(): Rgb {
  photo ??= (() => {
    const p = placeholderPicture();
    const w = 1280;
    const h = 720;
    const d = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let k = 0; k < 3; k++)
          d[(y * w + x) * 3 + k] = p.d[
            (Math.floor((y * p.h) / h) * p.w + Math.floor((x * p.w) / w)) * 3 + k
          ] as number;
    return { w, h, d };
  })();
  return photo;
}
let photo: Rgb | undefined;

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
 * be panels (each side 12% of the figure's shorter side, each 3% of its area);
 * failing that, at a gutter that splits off a part too small to be a panel —
 * before panels side by side, or a filled title band off one — which is
 * dropped. What cannot be split is a panel. Read in rows (top to bottom, a row
 * being panels whose tops are within 10% of the figure's height), left to right in
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
  /** The share of a box that is ink. */
  const filled = (b: PanelBox) => {
    let n = 0;
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) n += ink[y * W + x] as number;
    return n / (b.w * b.h);
  };
  const fits = (p: PanelBox) => p.w >= minSide && p.h >= minSide && p.w * p.h >= minArea;
  const cut = (box: PanelBox, depth: number): PanelBox[] => {
    const b = trim(box);
    if (!b) return [];
    if (depth < 5) {
      const tries = (
        [
          [true, ...gutter(b, true)],
          [false, ...gutter(b, false)],
        ] as Array<[boolean, number, number]>
      ).sort((p, q) => q[2] - p[2]);
      // Two panels if a gutter leaves them; else a strip too small to be a panel
      // split off and dropped: before panels side by side (a row's title bars run
      // edge to edge, so the gutter between its photos is blank only under them),
      // or off one panel when the strip is a FILLED bar (a panel's title band).
      // Never a strip of mostly ground off one panel: that is its own content —
      // a line of a text figure — and dropping it lost six of a trace's nine rows.
      for (const strip of [false, true])
        for (const [rows, start, len] of tries) {
          if (len < gutterMin(rows ? H : W)) continue;
          const mid = start + Math.floor(len / 2);
          const a = rows ? { ...b, h: mid } : { ...b, w: mid };
          const z = rows
            ? { x: b.x, y: b.y + mid, w: b.w, h: b.h - mid }
            : { x: b.x + mid, y: b.y, w: b.w - mid, h: b.h };
          const ta = trim(a);
          const tz = trim(z);
          if (!ta || !tz) continue;
          if (!strip && fits(ta) && fits(tz)) return [...cut(a, depth + 1), ...cut(z, depth + 1)];
          if (strip && fits(ta) !== fits(tz)) {
            const rest = cut(fits(ta) ? a : z, depth + 1);
            if (rest.length > 1 || (rest.length === 1 && filled(fits(ta) ? tz : ta) >= 0.5))
              return rest;
          }
        }
    }
    return fits(b) ? [b] : [];
  };
  const leaves = cut({ x: 0, y: 0, w: W, h: H }, 0);
  const band = 0.1 * H;
  return leaves.sort((p, q) => (Math.abs(p.y - q.y) < band ? p.x - q.x : p.y - q.y));
}

/** Cut once per picture: plan-time checks cut the one placeholder in every format. */
const cuts = new WeakMap<Rgb, PanelBox[]>();
function cutOf(img: Rgb): PanelBox[] {
  const c = cuts.get(img) ?? findPanels(img);
  cuts.set(img, c);
  return c;
}

/** `b` grown by `m` px a side, inside the picture. */
function _grow(img: Rgb, b: PanelBox, m: number): PanelBox {
  const x = Math.max(0, b.x - m);
  const y = Math.max(0, b.y - m);
  return {
    x,
    y,
    w: Math.min(img.w, b.x + b.w + m) - x,
    h: Math.min(img.h, b.y + b.h + m) - y,
  };
}

function crop(img: Rgb, b: PanelBox): Rgb {
  const d = new Float32Array(b.w * b.h * 3);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      for (let k = 0; k < 3; k++)
        d[(y * b.w + x) * 3 + k] = img.d[((b.y + y) * img.w + (b.x + x)) * 3 + k] as number;
  return { w: b.w, h: b.h, d };
}

/** region as the build's kind: it reads its figure at the figure's own pixels. */
export const regionKind: KindImpl = {
  picture: true,
  async layers(input) {
    const lit = input.spec.data as Ctx["lit"];
    if (!input.image) throw new Error("literal: the region scene needs its picture");
    const r = runVerb(region, {
      lit,
      labels: input.spec.labels,
      region: input.region,
      theme: input.theme,
      measure: (t, s) => widthOf(t, s, input.theme),
      dry: false,
      image: await readFigure(input.image),
      earlier: input.earlier,
      assets: {},
    });
    return writeLayers(r, input.beatId, input.dir);
  },
  fragment(L, region, cues, spec, theme, href) {
    return stagedFragment("region", L, region, cues, spec, theme, href);
  },
};

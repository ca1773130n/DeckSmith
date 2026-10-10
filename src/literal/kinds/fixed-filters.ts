/**
 * fixed-filters — the two Sobel kernels with their numbers, their
 * responses, and the structure map their sum makes: nothing in it is learned.
 */
import { join } from "node:path";
import { even, img, type KindImpl, LAB_H, lab, mean, normBy, panel, stepStarts } from "../kind.js";
import {
  AIRLIGHT,
  baseCss,
  EDGE,
  haze,
  LABEL,
  label,
  luma,
  mapRgba,
  px,
  quantile,
  readRgb,
  SMALL,
  T_HAZE,
  Tl,
  writeRaster,
} from "../kit.js";

export const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1] as const;
export const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1] as const;

/** SSM's structure map (analysis Q3): |Gx| + |Gy| of the channel mean, divided by its spatial mean. */
export function structureMap(
  l: Float32Array,
  w: number,
  h: number,
): { gx: Float32Array; gy: Float32Array; s: Float32Array } {
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < 9; j++) {
        const v = at(x + (j % 3) - 1, y + Math.floor(j / 3) - 1);
        sx += (SOBEL_X[j] as number) * v;
        sy += (SOBEL_Y[j] as number) * v;
      }
      gx[y * w + x] = Math.abs(sx);
      gy[y * w + x] = Math.abs(sy);
    }
  const sum = gx.map((v, i) => v + (gy[i] as number));
  const m = Math.max(1e-9, mean(sum));
  return { gx, gy, s: sum.map((v) => v / m) };
}

const FF_W = 420;
const FF_H = 280;

export const fixedFiltersKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, FF_W, FF_H), T_HAZE, AIRLIGHT);
    const { gx, gy, s } = structureMap(luma(hazy), FF_W, FF_H);
    const top = quantile(
      gx.map((v, i) => Math.max(v, gy[i] as number)),
      0.99,
    );
    const files = { gx: `${beatId}-gx.png`, gy: `${beatId}-gy.png`, s: `${beatId}-s.png` };
    await writeRaster(join(dir, files.gx), FF_W, FF_H, mapRgba(normBy(gx, top), EDGE));
    await writeRaster(join(dir, files.gy), FF_W, FF_H, mapRgba(normBy(gy, top), EDGE));
    await writeRaster(join(dir, files.s), FF_W, FF_H, mapRgba(normBy(s, quantile(s, 0.99))));
    return { files: { ...files, thumb: files.s }, data: {} };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "fixed-filters";
    const f = L.files as Record<string, string>;
    const cell = 64;
    const kw = cell * 3;
    const g = 28;
    const mw = Math.min(FF_W, even((W - 2 * kw - 4 * g - 16) / 3));
    const mh = even(mw / 1.5);
    const y0 = LAB_H;
    const kernel = (id: string, k: readonly number[], x: number) =>
      `<div id="SCENEID-${id}" style="position:absolute;left:${px(x)};top:${px(y0 + (mh - kw) / 2)};width:${px(kw)};height:${px(kw)}">${k
        .map(
          (v, i) =>
            `<div style="position:absolute;left:${px((i % 3) * cell)};top:${px(Math.floor(i / 3) * cell)};width:${px(cell - 4)};height:${px(cell - 4)};background:${theme.panel};border:2px solid ${theme.rule};box-sizing:border-box;color:${theme.fg};font-size:${SMALL}px;line-height:${px(cell - 8)};text-align:center;font-weight:600">${v}</div>`,
        )
        .join("")}</div>`;
    const xs = [0, kw + g, kw + 2 * g + mw, 2 * kw + 3 * g + mw];
    const xS = W - mw;
    const yCap = y0 + mh + 10;
    const yP = Math.min(H - 2 * LAB_H, yCap + 90);
    // The small learned part, named as the source names it — words, not a box of cards.
    const learned = lab(K, spec, "learned");
    const markup = `<div id="SCENEID-lit">
${label("l-k", lab(K, spec, "kernels"), 0, 0, LABEL, theme.fg)}
${kernel("kx", SOBEL_X, xs[0] as number)}
${panel("gx", xs[1] as number, y0, mw, mh, img("gx-i", href(f.gx as string), 0, 0, mw, mh), "lit-dark")}
${kernel("ky", SOBEL_Y, xs[2] as number)}
${panel("gy", xs[3] as number, y0, mw, mh, img("gy-i", href(f.gy as string), 0, 0, mw, mh), "lit-dark")}
${label("l-s", lab(K, spec, "structure"), xS, 0, LABEL, theme.fg)}
${panel("s", xS, y0, mw, mh, img("s-i", href(f.s as string), 0, 0, mw, mh), "lit-dark")}
${label("l-gx", "|Gx|", xs[1] as number, yCap, SMALL, theme.muted)}
${label("l-gy", "|Gy|", xs[3] as number, yCap, SMALL, theme.muted)}
${label("l-sf", lab(K, spec, "formula"), xS, yCap, SMALL, theme.muted)}
${label("l-p", lab(K, spec, "params"), 0, yP, LABEL, theme.accent)}
${learned ? label("l-learned", learned, 0, yP + LAB_H + 8, LABEL, theme.fg) : ""}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    const tl = new Tl();
    tl.show("l-k", 0.1);
    // Step 1: two fixed kernels and their responses on the picture.
    tl.show("kx", s0 + 0.2, 0.5);
    tl.show("gx", s0 + 0.8, 0.6);
    tl.show("l-gx", s0 + 0.8);
    tl.show("ky", s0 + 1.4, 0.5);
    tl.show("gy", s0 + 2.0, 0.6);
    tl.show("l-gy", s0 + 2.0);
    // Step 2: their sum, normalised, is the structure map; nothing in it is learned.
    tl.show("l-s", s1);
    tl.show("s", s1, 0.8);
    tl.show("l-sf", s1 + 0.4);
    tl.show("l-p", s1 + 1.2);
    if (learned) tl.show("l-learned", s1 + 2.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

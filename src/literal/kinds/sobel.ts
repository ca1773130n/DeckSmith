/**
 * sobel — the real 3×3 Sobel response of the hazy picture; the reweighting
 * F·(1 + S) is a schematic of "the structure map gates and reweights the
 * features", not the paper's exact SSM layer.
 */
import { join } from "node:path";
import type { Fragment } from "../../bespoke/contract.js";
import type { Theme } from "../../emit/kit.js";
import { even, type KindImpl, type KindSpec } from "../kind.js";
import type { Box } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  boxBlur,
  type Cue,
  EDGE,
  haze,
  LABEL,
  type Layers,
  label,
  luma,
  mapRgba,
  ON_PHOTO,
  px,
  quantile,
  readRgb,
  SMALL,
  scale,
  slotText,
  sobel,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

/** The Sobel scene: the hazy picture, its Sobel structure map, a smoothed feature and its reweighting. */
async function sobelLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const hazy = haze(await readRgb(image, w, h), T_HAZE, AIRLIGHT);
  const files = {
    hazy: `${beatId}-hazy.jpg`,
    edges: `${beatId}-sobel.png`,
    feat: `${beatId}-feat.png`,
    featS: `${beatId}-feat-s.png`,
    featW: `${beatId}-feat-w.png`,
    thumb: `${beatId}-feat-w.png`,
  };
  await writeRaster(join(dir, files.hazy), w, h, toRgba(hazy));
  const e = sobel(luma(hazy), w, h);
  // Shown on the picture: the strongest structure, not every texel of texture — a p99.5 scale
  // and a 1.8 gamma, so roads and field boundaries stand out (at p98.5, linear, an aerial
  // picture's texture washed the whole map yellow).
  const s = scale(e, 1 / Math.max(1e-6, quantile(e, 0.995))).map((v) => Math.min(1, v) ** 1.8);
  await writeRaster(join(dir, files.edges), w, h, mapRgba(s, EDGE));
  // The feature panels at their own size.
  const fw = box.feat.w;
  const fh = box.feat.h;
  const hs = haze(await readRgb(image, fw, fh), T_HAZE, AIRLIGHT);
  const lf = luma(hs);
  // A smoothed feature (the membrane's low-pass), stretched for display.
  const f = boxBlur(lf, fw, fh, 5);
  const lo = quantile(f, 0.02);
  const hi = quantile(f, 0.98);
  const fn = f.map((v) => (v - lo) / Math.max(1e-6, hi - lo));
  const ef = sobel(lf, fw, fh);
  const sn = scale(ef, 1 / Math.max(1e-6, quantile(ef, 0.985)));
  // Gated and reweighted: F · (0.5 + 1.5·S), on the same display scale as F —
  // flat regions dim, edges and texture come forward.
  const fw2 = fn.map(
    (v, i) =>
      v * 0.55 * (0.5 + 1.5 * Math.min(1, sn[i] as number)) + 0.35 * Math.min(1, sn[i] as number),
  );
  await writeRaster(join(dir, files.feat), fw, fh, mapRgba(scale(fn, 0.55)));
  await writeRaster(join(dir, files.featS), fw, fh, mapRgba(sn, EDGE));
  await writeRaster(join(dir, files.featW), fw, fh, mapRgba(fw2));
  return { files, data: {} };
}

function layout(W: number, H: number): Box {
  const ih = H;
  const iw = even(ih * 1.5);
  const cw = W - iw - 56;
  const fh = even((H - 2 * 64 - 40) / 2);
  return {
    W,
    H,
    img: { w: iw, h: even(ih) },
    edge: { w: 0, h: 0 },
    feat: { w: even(Math.min(cw, fh * 1.5)), h: fh },
  };
}

function sobelFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: KindSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const lab = (k: string) => slotText("sobel", spec.labels, k);
  const iw = box.img.w;
  const ih = box.img.h;
  const cx = iw + 56;
  const fw = box.feat.w;
  const fh = box.feat.h;
  const y1 = 64;
  const y2 = y1 + fh + 40 + 64;
  const k = 62; // kernel cell
  const kernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  // The kernel rides INSIDE the picture, from its left edge to its right.
  const kx = 24;
  const ky = ih - 3 * k - 40;
  const kcells = kernel
    .map((v, i) => {
      const c = i % 3;
      const r = Math.floor(i / 3);
      return `<div style="position:absolute;left:${px(c * k)};top:${px(r * k)};width:${px(k - 4)};height:${px(k - 4)};background:rgba(13,16,20,.82);color:#fff;font-size:${SMALL}px;line-height:${px(k - 4)};text-align:center;border-radius:4px;font-weight:600">${v}</div>`;
    })
    .join("");
  const markup = `<div id="SCENEID-lit">
<div class="lit-panel" style="left:0;top:0;width:${px(iw)};height:${px(ih)}">
<img id="SCENEID-photo" src="${href(L.files.hazy as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
<div id="SCENEID-reveal" style="position:absolute;left:0;top:0;width:${px(iw)};height:${px(ih)};overflow:hidden">
<div style="position:absolute;left:0;top:0;width:${px(iw)};height:${px(ih)};background:rgba(13,16,20,.72)"></div>
<img src="${href(L.files.edges as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
</div>
<div id="SCENEID-sweep" style="position:absolute;left:0;top:0;width:4px;height:${px(ih)};background:#fff;box-shadow:0 0 18px rgba(255,255,255,.9)"></div>
${label("tag-hazy", lab("hazy"), 28, 22, LABEL, "", ON_PHOTO)}
${label("tag-sobel", lab("structure"), 28, 22, LABEL, "", ON_PHOTO)}
</div>
<div id="SCENEID-kernel" style="position:absolute;left:${px(kx)};top:${px(ky)};width:${px(3 * k)};height:${px(3 * k)}">${label("k-label", "Sobel 3×3", 0, -58, SMALL, "", ON_PHOTO)}${kcells}</div>
${label("f-label", lab("feature"), cx, 0, LABEL, theme.fg)}
<div id="SCENEID-fpanel" class="lit-panel lit-dark" style="left:${px(cx)};top:${px(y1)};width:${px(fw)};height:${px(fh)}">
<img id="SCENEID-feat" src="${href(L.files.feat as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
</div>
${label("w-label", lab("reweighted"), cx, y2 - 64, LABEL, theme.fg)}
<div id="SCENEID-wpanel" class="lit-panel lit-dark" style="left:${px(cx)};top:${px(y2)};width:${px(fw)};height:${px(fh)}">
<img id="SCENEID-feat2" src="${href(L.files.feat as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
<img id="SCENEID-featw" src="${href(L.files.featW as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
<img id="SCENEID-feats" src="${href(L.files.featS as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
</div>
</div>`;
  const c0 = cues[0] ?? { t0: 0.8, t1: 10 };
  const tl = new Tl();
  tl.show("photo", 0.05, 0.5);
  tl.show("tag-hazy", 0.3);
  tl.fromTo("tag-sobel", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  // The kernel slides across the picture; behind it, the edges it measured light up.
  const s0 = Math.max(1.2, c0.t0 + 0.4);
  const span = 4.2;
  tl.show("kernel", s0 - 0.5, 0.4);
  tl.show("sweep", s0 - 0.3, 0.3);
  tl.fromTo("reveal", { width: 0 }, { width: iw, duration: span, ease: "none" }, s0);
  tl.fromTo("sweep", { x: 0 }, { x: iw - 4, duration: span, ease: "none" }, s0);
  tl.fromTo("kernel", { x: 0 }, { x: iw - 3 * k - 48, duration: span, ease: "none" }, s0);
  tl.hide("sweep", s0 + span, 0.3);
  tl.hide("kernel", s0 + span, 0.3);
  tl.hide("tag-hazy", s0 + span - 0.2, 0.4);
  tl.show("tag-sobel", s0 + span + 0.1);
  // Then the structure map gates the feature, and the reweighted feature keeps the edges —
  // on the second sentence, when there is one.
  const f0 = Math.max(s0 + span + 0.5, (cues[1]?.t0 ?? 0) + 0.2);
  tl.show("f-label", f0);
  tl.show("fpanel", f0, 0.4);
  tl.show("wpanel", f0 + 0.6, 0.4);
  tl.show("feat", f0, 0.6);
  tl.show("w-label", f0 + 0.6);
  tl.show("feat2", f0 + 0.6, 0.6);
  tl.fromTo("featw", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("feats", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  const g0 = f0 + 1.4;
  tl.fromTo("feats", { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power2.out" }, g0);
  tl.fromTo("featw", { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "sine.inOut" }, g0 + 1.0);
  tl.fromTo("feats", { opacity: 1 }, { opacity: 0, duration: 1.2, ease: "sine.inOut" }, g0 + 1.2);
  return { markup, css: baseCss(theme), script: tl.script };
}

export const sobelKind: KindImpl = {
  picture: true,
  layers: ({ image, dir, beatId, region }) =>
    sobelLayers(image as string, dir, beatId, layout(region.width, region.height)),
  fragment: (L, region, cues, spec, theme, href) =>
    sobelFragment(L, layout(region.width, region.height), cues, spec, theme, href),
};

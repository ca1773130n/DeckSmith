/**
 * haze — the atmospheric scattering model I = J·t + A·(1−t) with a uniform t.
 * A crossfade from J to I at opacity α IS that model at t' = 1 − α(1 − t), so
 * the fade is the physics, not an approximation of it. Sobel is linear and
 * blind to a constant, so the edge map under haze is exactly t × the clear
 * one, and the brightness profile is the clear one scaled by t about A.
 */
import { join } from "node:path";
import type { Fragment } from "../../bespoke/contract.js";
import type { Theme } from "../../emit/kit.js";
import { even, type KindImpl, type KindSpec } from "../kind.js";
import type { Box } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  type Cue,
  haze,
  LABEL,
  type Layers,
  label,
  luma,
  mapRgba,
  ON_PHOTO,
  px,
  quantile,
  r3,
  readRgb,
  round3,
  scale,
  slotText,
  sobel,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

/** The haze scene: clear and hazy picture, their edge maps on ONE scale, one row's brightness. */
async function hazeLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const clear = await readRgb(image, w, h);
  const hazy = haze(clear, T_HAZE, AIRLIGHT);
  const files = {
    clear: `${beatId}-clear.jpg`,
    hazy: `${beatId}-hazy.jpg`,
    edgeClear: `${beatId}-edge-clear.png`,
    edgeHazy: `${beatId}-edge-hazy.png`,
    thumb: `${beatId}-hazy.jpg`,
  };
  await writeRaster(join(dir, files.clear), w, h, toRgba(clear));
  await writeRaster(join(dir, files.hazy), w, h, toRgba(hazy));
  // Edge maps at the panel's own size, both divided by the CLEAR map's p99, so
  // the hazy one is dimmer by exactly t and nothing renormalises it back up.
  const ew = box.edge.w;
  const eh = box.edge.h;
  const small = await readRgb(image, ew, eh);
  const eClear = sobel(luma(small), ew, eh);
  const eHazy = sobel(luma(haze(small, T_HAZE, AIRLIGHT)), ew, eh);
  const norm = 1 / Math.max(1e-6, quantile(eClear, 0.99));
  await writeRaster(join(dir, files.edgeClear), ew, eh, mapRgba(scale(eClear, norm)));
  await writeRaster(join(dir, files.edgeHazy), ew, eh, mapRgba(scale(eHazy, norm)));
  // The row with the most going on, in the picture's middle band: its brightness profile.
  const l = luma(clear);
  let best = Math.round(h / 2);
  let bestVar = -1;
  for (let y = Math.round(h * 0.3); y < Math.round(h * 0.7); y++) {
    let s = 0;
    let s2 = 0;
    for (let x = 0; x < w; x++) {
      const v = l[y * w + x] as number;
      s += v;
      s2 += v * v;
    }
    const varY = s2 / w - (s / w) ** 2;
    if (varY > bestVar) {
      bestVar = varY;
      best = y;
    }
  }
  const N = 120;
  const profile: number[] = [];
  for (let i = 0; i < N; i++) {
    const x0 = Math.floor((i * w) / N);
    const x1 = Math.floor(((i + 1) * w) / N);
    let s = 0;
    let n = 0;
    for (let y = best - 1; y <= best + 1; y++)
      for (let x = x0; x < x1; x++, n++) s += l[y * w + x] as number;
    profile.push(round3(s / n));
  }
  const airY = 0.2126 * AIRLIGHT[0] + 0.7152 * AIRLIGHT[1] + 0.0722 * AIRLIGHT[2];
  return { files, data: { row: best, profile, air: round3(airY), t: T_HAZE } };
}

function layout(W: number, H: number): Box {
  const ih = H;
  const iw = even(ih * 1.5);
  const cw = W - iw - 56;
  return {
    W,
    H,
    img: { w: iw, h: even(ih) },
    edge: { w: even(cw), h: even(cw / 1.5) },
    feat: { w: 0, h: 0 },
  };
}

function hazeFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: KindSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const { W, H } = box;
  const iw = box.img.w;
  const ih = box.img.h;
  const cx = iw + 56;
  const cw = W - cx;
  const ew = box.edge.w;
  const eh = box.edge.h;
  const d = L.data as { row: number; profile: number[]; air: number; t: number };
  const lab = (k: string) => slotText("haze", spec.labels, k);
  // Profile plot: luma 0..1, 1 at the top.
  const py0 = 64 + eh + 110;
  const ph = H - py0 - 6;
  const pw = cw - 40;
  const yOf = (v: number) => r3(py0 + (1 - v) * ph);
  const pts = d.profile
    .map((v, i) => `${r3((i / (d.profile.length - 1)) * pw)},${yOf(v)}`)
    .join(" ");
  const hi = Math.max(...d.profile);
  const lo = Math.min(...d.profile);
  const airY = yOf(d.air);
  const bx = pw + 22;
  const markup = `<div id="SCENEID-lit">
<div id="SCENEID-photo" class="lit-panel" style="left:0;top:0;width:${px(iw)};height:${px(ih)}">
<img id="SCENEID-clear" src="${href(L.files.clear as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
<div id="SCENEID-front" style="position:absolute;left:0;bottom:0;width:${px(iw)};height:0;overflow:hidden"><img src="${href(L.files.hazy as string)}" style="left:0;top:auto;bottom:0;width:${px(iw)};height:${px(ih)}" alt=""></div>
<div id="SCENEID-scan" style="position:absolute;left:0;top:${px(d.row - 2)};width:${px(iw)};height:4px;background:${theme.accent};transform-origin:0 50%"></div>
${label("tag-clear", lab("clear"), 28, 22, LABEL, "", ON_PHOTO)}
${label("tag-hazy", lab("hazy"), 28, ih - 76, LABEL, "", ON_PHOTO)}
</div>
${label("edge-label", lab("edges"), cx, 0, LABEL, theme.fg)}
<div id="SCENEID-edge" class="lit-panel lit-dark" style="left:${px(cx)};top:64px;width:${px(ew)};height:${px(eh)}">
<img src="${href(L.files.edgeClear as string)}" style="left:0;top:0;width:${px(ew)};height:${px(eh)}" alt="">
<div id="SCENEID-edge-front" style="position:absolute;left:0;bottom:0;width:${px(ew)};height:0;overflow:hidden;background:#0d1014"><img src="${href(L.files.edgeHazy as string)}" style="left:0;top:auto;bottom:0;width:${px(ew)};height:${px(eh)}" alt=""></div>
</div>
${label("prof-label", lab("profile"), cx, 64 + eh + 36, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${cw}" height="${H}" viewBox="0 0 ${cw} ${H}" style="left:${px(cx)};top:0">
<line x1="0" y1="${airY}" x2="${pw}" y2="${airY}" stroke="${theme.muted}" stroke-width="2" stroke-dasharray="6 8" opacity="0.7"/>
<g id="SCENEID-prof">
<polyline points="${pts}" fill="none" stroke="${theme.accent}" stroke-width="4" stroke-linejoin="round"/>
<path d="M${bx - 10} ${yOf(hi)}H${bx + 10}M${bx} ${yOf(hi)}V${yOf(lo)}M${bx - 10} ${yOf(lo)}H${bx + 10}" stroke="${theme.fg}" stroke-width="4" fill="none"/>
</g>
</svg>
</div>`;
  const c0 = cues[0] ?? { t0: 0.8, t1: 8 };
  const tl = new Tl();
  tl.show("clear", 0.05, 0.5);
  tl.show("tag-clear", 0.3, 0.5);
  tl.fromTo("scan", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.inOut" }, 0.5);
  tl.show("edge-label", 0.5);
  tl.show("edge", 0.6);
  tl.show("prof-label", 0.9);
  tl.show("plot", 1.0);
  // ONE causal step: the haze rises from the bottom; where it has arrived the
  // transmission is t, so a still mid-rise shows the picture, its edges and the
  // line's brightness both before and after.
  const h0 = Math.max(2.4, c0.t0 + 1.4);
  const dur = Math.max(3, Math.min(4.5, (c0.t1 - h0) * 0.7));
  tl.fromTo("front", { height: 0 }, { height: ih, duration: dur, ease: "none" }, h0);
  tl.fromTo("edge-front", { height: 0 }, { height: eh, duration: dur, ease: "none" }, h0);
  tl.fromTo(
    "tag-hazy",
    { opacity: 0 },
    { opacity: 1, duration: 0.6, ease: "power2.out" },
    h0 + 0.2,
  );
  // The brightness line flattens toward the airlight when the front crosses it.
  const atRow = h0 + (dur * (ih - d.row)) / ih;
  tl.fromTo(
    "prof",
    { scaleY: 1, svgOrigin: `0 ${airY}` },
    { scaleY: d.t, svgOrigin: `0 ${airY}`, duration: 0.7, ease: "sine.inOut" },
    atRow - 0.35,
  );
  tl.hide("tag-clear", h0 + dur - 0.6, 0.5);
  return { markup, css: baseCss(theme), script: tl.script };
}

export const hazeKind: KindImpl = {
  picture: true,
  layers: ({ image, dir, beatId, region }) =>
    hazeLayers(image as string, dir, beatId, layout(region.width, region.height)),
  fragment: (L, region, cues, spec, theme, href) =>
    hazeFragment(L, layout(region.width, region.height), cues, spec, theme, href),
};

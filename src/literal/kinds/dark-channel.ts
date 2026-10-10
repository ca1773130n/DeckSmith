/**
 * dark-channel — the classical Dark Channel Prior (He et al.: min filter,
 * top-0.1% airlight, ω = 0.95, t₀ = 0.1, guided-filter refinement), run for real
 * on the picture under haze of a KNOWN uniform t, so the estimate is checked
 * against the truth on screen. Prior work, labelled as that.
 */
import { join } from "node:path";
import { even, img, type KindImpl, LAB_H, lab, mean, panel, stepStarts } from "../kind.js";
import {
  AIRLIGHT,
  baseCss,
  boxBlur,
  haze,
  LABEL,
  label,
  luma,
  mapRgba,
  ON_PHOTO,
  px,
  quantile,
  type Rgb,
  r3,
  readRgb,
  SMALL,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

/** Separable min filter of radius r (a (2r+1)² patch), edges clamped. */
export function minFilter(v: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = Number.POSITIVE_INFINITY;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          const s = src[yy * w + xx] as number;
          if (s < m) m = s;
        }
        out[y * w + x] = m;
      }
    return out;
  };
  return pass(pass(v, true), false);
}

/** The dark channel: the patch minimum of the per-pixel minimum over colour. */
export function darkChannel(img: Rgb, r: number, A: readonly number[] = [1, 1, 1]): Float32Array {
  const m = new Float32Array(img.w * img.h);
  for (let i = 0, j = 0; i < m.length; i++, j += 3)
    m[i] = Math.min(
      (img.d[j] as number) / (A[0] as number),
      (img.d[j + 1] as number) / (A[1] as number),
      (img.d[j + 2] as number) / (A[2] as number),
    );
  return minFilter(m, img.w, img.h, r);
}

/** He et al.'s guided filter, grey guide. */
export function guidedFilter(
  I: Float32Array,
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = I.length;
  const mul = (a: Float32Array, b: Float32Array) => a.map((v, i) => v * (b[i] as number));
  const mI = boxBlur(I, w, h, r);
  const mP = boxBlur(p, w, h, r);
  const cII = boxBlur(mul(I, I), w, h, r);
  const cIP = boxBlur(mul(I, p), w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = (cII[i] as number) - (mI[i] as number) ** 2;
    const cov = (cIP[i] as number) - (mI[i] as number) * (mP[i] as number);
    a[i] = cov / (varI + eps);
    b[i] = (mP[i] as number) - (a[i] as number) * (mI[i] as number);
  }
  const mA = boxBlur(a, w, h, r);
  const mB = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = (mA[i] as number) * (I[i] as number) + (mB[i] as number);
  return q;
}

export interface DcpResult {
  dark: Float32Array;
  A: [number, number, number];
  t: Float32Array;
  J: Rgb;
}

/** The classical Dark Channel Prior dehaze (He, Sun, Tang), guided-filter refined. */
export function dcp(I: Rgb, r: number, omega = 0.95, t0 = 0.1): DcpResult {
  const { w, h } = I;
  const dark = darkChannel(I, r);
  // Airlight: among the brightest 0.1% of the dark channel, the brightest input pixel.
  const order = Array.from(dark, (v, i) => [v, i] as const).sort(
    (a, b) => b[0] - a[0] || a[1] - b[1],
  );
  const top = order.slice(0, Math.max(1, Math.round(dark.length * 0.001)));
  let best = (top[0] as readonly [number, number])[1];
  let bestY = -1;
  const L = luma(I);
  for (const [, i] of top)
    if ((L[i] as number) > bestY) {
      bestY = L[i] as number;
      best = i;
    }
  const A: [number, number, number] = [
    I.d[best * 3] as number,
    I.d[best * 3 + 1] as number,
    I.d[best * 3 + 2] as number,
  ];
  const raw = darkChannel(I, r, A).map((v) => 1 - omega * v);
  const t = guidedFilter(L, raw, w, h, Math.max(4, r * 4), 1e-3).map((v) =>
    Math.max(0, Math.min(1, v)),
  );
  const d = new Float32Array(I.d.length);
  for (let i = 0; i < w * h; i++) {
    const ti = Math.max(t[i] as number, t0);
    for (let c = 0; c < 3; c++) {
      const a = A[c] as number;
      d[i * 3 + c] = Math.max(0, Math.min(1, ((I.d[i * 3 + c] as number) - a) / ti + a));
    }
  }
  return { dark, A, t, J: { w, h, d } };
}

const DCP_W = 600;
const DCP_H = 400;
/** Where the estimate misses the transmission we applied by more than this, the prior failed. */
export const DCP_MISS = 0.08;

export const darkChannelKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const clear = await readRgb(image as string, DCP_W, DCP_H);
    const hazy = haze(clear, T_HAZE, AIRLIGHT);
    const r = 7; // a 15×15 patch, He et al.'s, at this width
    const { dark, t, J, A } = dcp(hazy, r);
    const files = {
      hazy: `${beatId}-hazy.jpg`,
      dark: `${beatId}-dark.png`,
      trans: `${beatId}-trans.png`,
      rec: `${beatId}-rec.jpg`,
      miss: `${beatId}-miss.png`,
      thumb: `${beatId}-rec.jpg`,
    };
    await writeRaster(join(dir, files.hazy), DCP_W, DCP_H, toRgba(hazy));
    await writeRaster(join(dir, files.dark), DCP_W, DCP_H, mapRgba(dark));
    await writeRaster(join(dir, files.trans), DCP_W, DCP_H, mapRgba(t));
    await writeRaster(join(dir, files.rec), DCP_W, DCP_H, toRgba(J));
    // Where the estimate misses the truth: opacity grows with the miss beyond the tolerance.
    const miss = t.map((v) => {
      const e = Math.abs(v - T_HAZE);
      return e > DCP_MISS ? Math.min(0.9, 0.45 + (e - DCP_MISS) * 8) : 0;
    });
    await writeRaster(join(dir, files.miss), DCP_W, DCP_H, mapRgba(miss, [255, 64, 160]));
    // The row the estimate misses most on, in the middle band: its transmission profile.
    let row = Math.round(DCP_H / 2);
    let worst = -1;
    for (let y = Math.round(DCP_H * 0.25); y < Math.round(DCP_H * 0.75); y++) {
      let e = 0;
      for (let x = 0; x < DCP_W; x++) e += Math.abs((t[y * DCP_W + x] as number) - T_HAZE);
      if (e > worst) {
        worst = e;
        row = y;
      }
    }
    const N = 120;
    const profile: number[] = [];
    for (let i = 0; i < N; i++) {
      const x0 = Math.floor((i * DCP_W) / N);
      const x1 = Math.floor(((i + 1) * DCP_W) / N);
      let s = 0;
      for (let x = x0; x < x1; x++) s += t[row * DCP_W + x] as number;
      profile.push(r3(s / (x1 - x0)));
    }
    const missFrac = r3(mean(miss.map((v) => (v > 0 ? 1 : 0))));
    // The prior's own premise, tested on the CLEAR picture: its dark channel should be about 0.
    const premise = quantile(darkChannel(clear, r), 0.5).toFixed(2);
    return {
      files,
      data: {
        row: row / DCP_H,
        profile,
        tTrue: T_HAZE,
        A: A.map(r3),
        missFrac,
        premise,
      },
    };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as {
      row: number;
      profile: number[];
      tTrue: number;
      missFrac: number;
      premise: string;
    };
    const K = "dark-channel";
    const f = L.files as Record<string, string>;
    const gap = 28;
    const ph = even((H - 2 * LAB_H - gap) / 2);
    const pw = even(ph * 1.5);
    const x2 = pw + gap;
    const y2 = LAB_H * 2 + ph + gap;
    const qx = 2 * pw + gap + 64;
    const qw = W - qx;
    const rowY = r3(d.row * ph);
    const tile = (id: string, src: string, x: number, y: number, over = "") =>
      panel(id, x, y, pw, ph, `${img(`${id}-i`, href(src), 0, 0, pw, ph)}${over}`, "lit-dark");
    // Transmission plot: 0..1 up the axis, the truth as a dashed line.
    const py0 = LAB_H + 20;
    const plotH = H - py0 - LAB_H * 4 - 30;
    const plotW = qw - 10;
    // A window around the truth, so a miss of a few hundredths is visible.
    const lo = Math.max(0, Math.min(d.tTrue - 0.2, ...d.profile) - 0.02);
    const hi = Math.min(1, Math.max(d.tTrue + 0.2, ...d.profile) + 0.02);
    const yOf = (v: number) => r3(py0 + (1 - (v - lo) / (hi - lo)) * plotH);
    const pts = d.profile
      .map((v, i) => `${r3((i / (d.profile.length - 1)) * plotW)},${yOf(v)}`)
      .join(" ");
    const truthY = yOf(d.tTrue);
    const scan = (id: string) =>
      `<div id="SCENEID-${id}" style="position:absolute;left:0;top:${px(rowY - 2)};width:${px(pw)};height:4px;background:${theme.accent}"></div>`;
    const t = { t: d.tTrue };
    const legendY = py0 + plotH + 24;
    const markup = `<div id="SCENEID-lit">
${label("l-hazy", lab(K, spec, "hazy"), 0, 0, LABEL, theme.fg)}
${tile("p-hazy", f.hazy as string, 0, LAB_H)}
${label("l-dark", lab(K, spec, "dark"), x2, 0, LABEL, theme.fg)}
${panel("p-dark", x2, LAB_H, pw, ph, `${img("dark-u", href(f.hazy as string), 0, 0, pw, ph)}<div id="SCENEID-dark-w" style="position:absolute;left:0;top:0;width:0;height:${px(ph)};overflow:hidden">${img("dark-i", href(f.dark as string), 0, 0, pw, ph)}</div>`, "lit-dark")}
${label("l-trans", lab(K, spec, "transmission"), 0, y2 - LAB_H, LABEL, theme.fg)}
${tile("p-trans", f.trans as string, 0, y2, `${scan("scan")}${img("miss", href(f.miss as string), 0, 0, pw, ph)}${label("l-miss", lab(K, spec, "miss", t), 20, ph - 64, SMALL, "", ON_PHOTO)}`)}
${label("l-rec", lab(K, spec, "recovered"), x2, y2 - LAB_H, LABEL, theme.fg)}
${tile("p-rec", f.rec as string, x2, y2)}
${label("l-plot", lab(K, spec, "profile"), qx, 0, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${qw}" height="${H}" viewBox="0 0 ${qw} ${H}" style="left:${px(qx)};top:0">
<line x1="0" y1="${py0}" x2="0" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line x1="0" y1="${r3(py0 + plotH)}" x2="${plotW}" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line id="SCENEID-truth" x1="0" y1="${truthY}" x2="${plotW}" y2="${truthY}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="12 10"/>
<polyline id="SCENEID-est" points="${pts}" fill="none" stroke="${theme.accent}" stroke-width="4" stroke-linejoin="round"/>
</svg>
${label("l-truth", lab(K, spec, "truth", t), qx, legendY, SMALL, theme.fg)}
${label("l-est", lab(K, spec, "estimate"), qx + qw / 2, legendY, SMALL, theme.accent)}
${label("l-premise", lab(K, spec, "premise"), qx, H - LAB_H * 3 + 4, SMALL, theme.fg)}
${label("l-premise2", lab(K, spec, "premiseValue", { v: d.premise }), qx, H - LAB_H * 2 + 4, SMALL, theme.accent)}
${label("l-share", lab(K, spec, "missShare", { p: Math.round(d.missFrac * 100) }), qx, H - LAB_H + 4, SMALL, theme.accent)}
</div>`;
    const [s0, s1, s2, s3] = stepStarts(cues, 4) as [number, number, number, number];
    const tl = new Tl();
    // Step 1: the classical prior is applied to the hazy input.
    tl.show("p-hazy", 0.05, 0.5);
    tl.show("l-hazy", 0.2);
    tl.show("l-dark", Math.max(0.6, s0 + 0.6));
    tl.show("p-dark", Math.max(0.6, s0 + 0.6), 0.4);
    // Step 2: the dark channel, computed patch by patch, sweeps across the input it is computed from.
    tl.fromTo(
      "dark-w",
      { width: 0 },
      { width: pw, duration: 2.4, ease: "none" },
      Math.max(1.2, s1 + 0.2),
    );
    // Step 3: transmission from the dark channel; along one line it is checked against the truth.
    tl.show("l-trans", s2);
    tl.show("p-trans", s2, 0.8);
    tl.fromTo("scan", { opacity: 0 }, { opacity: 1, duration: 0.4 }, s2 + 1.0);
    tl.show("l-plot", s2 + 1.0);
    tl.show("plot", s2 + 1.0, 0.5);
    tl.show("l-truth", s2 + 1.2);
    tl.show("l-est", s2 + 1.6);
    tl.fromTo("est", { opacity: 0 }, { opacity: 1, duration: 0.8 }, s2 + 1.6);
    tl.fromTo("miss", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "sine.inOut" }, s2 + 2.6);
    tl.show("l-miss", s2 + 2.8);
    // Step 4: the recovered picture — plausible to the eye — and, measured, how much of its
    // transmission was wrong and what the prior assumed. (Its colour error is NOT larger where
    // the transmission missed on every picture: measured on the r2 deck it was 0.8×, so the
    // scene states the miss itself, never "the recovery fails there".)
    tl.show("l-rec", s3);
    tl.show("p-rec", s3, 0.8);
    tl.show("l-share", s3 + 1.4);
    tl.show("l-premise", s3 + 2.4);
    tl.show("l-premise2", s3 + 2.8);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

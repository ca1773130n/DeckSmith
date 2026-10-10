/**
 * ema-threshold — TM-LIF's running threshold, θ = α × the EMA of the
 * variance, calibrated over random training crops and frozen at inference. α, μ
 * and the crop size are the plan's number slots, never constants here.
 */
import { join } from "node:path";
import { even, img, type KindImpl, LAB_H, lab, num, panel, std, stepStarts } from "../kind.js";
import { cropOf, cropOrigins, nativeSize } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  haze,
  LABEL,
  label,
  luma,
  px,
  type Rgb,
  r3,
  readRgb,
  SMALL,
  sobel,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

export interface EmaRun {
  /** Each training crop's own value, α·σ²: the threshold that crop alone would set. */
  own: number[];
  /** The threshold after each crop: α·v̂, v̂ the EMA of the variance. */
  theta: number[];
}

/**
 * TM-LIF's running estimate as the source states it: v̂ ← μ·v̂ + (1−μ)·σ², and
 * the threshold PROPORTIONAL TO v̂ with scale α — θ = α·v̂, no square root.
 * v̂ starts at the first crop's variance.
 */
export function emaThresholds(variances: readonly number[], mu: number, alpha: number): EmaRun {
  let v = variances[0] ?? 0;
  const theta: number[] = [];
  variances.forEach((s, i) => {
    if (i > 0) v = mu * v + (1 - mu) * s;
    theta.push(alpha * v);
  });
  return { own: variances.map((s) => alpha * s), theta };
}

const N_CROPS = 16;
/** The test picture's haze: denser than training's, so its statistics differ (illustrative). */
const T_TEST = 0.2;

function sobelVariance(img: Rgb): number {
  return std(sobel(luma(img), img.w, img.h)) ** 2;
}

export const emaKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId, spec }) {
    const K = "ema-threshold";
    const alpha = num(K, spec, "alpha");
    const mu = num(K, spec, "momentum");
    const crop = num(K, spec, "crop");
    const { w, h } = await nativeSize(image as string);
    const origins = cropOrigins(w, h, crop, N_CROPS, 20261010);
    const full = haze(await readRgb(image as string, w, h), T_HAZE, AIRLIGHT);
    const vars = origins.map(([x, y]) => sobelVariance(cropOf(full, x, y, crop)));
    const run = emaThresholds(vars, mu, alpha);
    const testImg = haze(await readRgb(image as string, w, h), T_TEST, AIRLIGHT);
    const testOwn = alpha * sobelVariance(testImg);
    const DW = 720;
    const DH = Math.round((DW * h) / w);
    const files = { hazy: `${beatId}-train.jpg`, test: `${beatId}-test.jpg` };
    await writeRaster(
      join(dir, files.hazy),
      DW,
      DH,
      toRgba(haze(await readRgb(image as string, DW, DH), T_HAZE, AIRLIGHT)),
    );
    await writeRaster(
      join(dir, files.test),
      DW,
      DH,
      toRgba(haze(await readRgb(image as string, DW, DH), T_TEST, AIRLIGHT)),
    );
    // Six significant figures: the values are relative, and a variance is small.
    const sig = (v: number) => Number(v.toPrecision(6));
    return {
      files,
      data: {
        w,
        h,
        crop,
        origins,
        own: run.own.map(sig),
        theta: run.theta.map(sig),
        testOwn: sig(testOwn),
      },
    };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "ema-threshold";
    const d = L.data as {
      w: number;
      h: number;
      crop: number;
      origins: Array<[number, number]>;
      own: number[];
      theta: number[];
      testOwn: number;
    };
    const f = L.files as Record<string, string>;
    const pw = Math.min(760, even(((H - LAB_H) * 1.5) | 0));
    const ph = even((pw * d.h) / d.w);
    const k = pw / d.w;
    const cs = r3(d.crop * k);
    const qx = pw + 72;
    const qw = W - qx;
    // Plot: crops 1..N on the left 68%, then the inference column.
    const n = d.own.length;
    const trainW = qw * 0.68;
    const infX = trainW + 60;
    const py0 = LAB_H * 2 + 20;
    const plotH = H - py0 - LAB_H * 2 - 10;
    const vals = [...d.own, ...d.theta, d.testOwn];
    const vmax = Math.max(...vals) * 1.15;
    const vmin = Math.min(...vals) * 0.8;
    const yOf = (v: number) => r3(py0 + (1 - (v - vmin) / (vmax - vmin)) * plotH);
    const xOf = (i: number) => r3(((i + 0.5) / n) * trainW);
    const dots = d.own
      .map(
        (v, i) =>
          `<circle id="SCENEID-o${i}" cx="${xOf(i)}" cy="${yOf(v)}" r="9" fill="${theme.muted}"/>`,
      )
      .join("");
    const segs = d.theta
      .map((v, i) => {
        const x0 = i === 0 ? 0 : xOf(i - 1);
        const y0 = i === 0 ? yOf(v) : yOf(d.theta[i - 1] as number);
        return `<line id="SCENEID-e${i}" x1="${x0}" y1="${y0}" x2="${xOf(i)}" y2="${yOf(v)}" stroke="${theme.accent}" stroke-width="5" stroke-linecap="round"/>`;
      })
      .join("");
    const last = d.theta[n - 1] as number;
    const markup = `<div id="SCENEID-lit">
${label("l-train", lab(K, spec, "train"), 0, 0, LABEL, theme.fg)}
${label("l-infer", lab(K, spec, "infer"), 0, 0, LABEL, theme.fg)}
${panel("pic", 0, LAB_H, pw, ph, `${img("train", href(f.hazy as string), 0, 0, pw, ph)}${img("test", href(f.test as string), 0, 0, pw, ph)}<div id="SCENEID-crop" style="position:absolute;left:0;top:0;width:${px(cs)};height:${px(cs)};border:4px solid ${theme.accent};box-sizing:border-box"></div>`, "lit-dark")}
${label("l-ema", lab(K, spec, "formula"), qx, 0, LABEL, theme.accent)}
${label("l-own", lab(K, spec, "own"), qx, LAB_H + 4, SMALL, theme.muted)}
<svg id="SCENEID-plot" width="${qw}" height="${H}" viewBox="0 0 ${qw} ${H}" style="left:${px(qx)};top:0">
<line x1="0" y1="${r3(py0 + plotH)}" x2="${qw}" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<rect id="SCENEID-zone" x="${r3(infX - 24)}" y="${py0}" width="${r3(qw - infX + 24)}" height="${r3(plotH)}" fill="${theme.rule}" opacity="0.35"/>
${dots}${segs}
<line id="SCENEID-frozen" x1="${xOf(n - 1)}" y1="${yOf(last)}" x2="${qw}" y2="${yOf(last)}" stroke="${theme.accent}" stroke-width="5" stroke-dasharray="14 10"/>
<circle id="SCENEID-tdot" cx="${r3(infX + (qw - infX) / 2)}" cy="${yOf(d.testOwn)}" r="12" fill="none" stroke="${theme.fg}" stroke-width="4"/>
<line id="SCENEID-gap" x1="${r3(infX + (qw - infX) / 2)}" y1="${yOf(d.testOwn)}" x2="${r3(infX + (qw - infX) / 2)}" y2="${yOf(last)}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="4 6"/>
</svg>
${label("l-frozen", lab(K, spec, "frozen"), qx + infX - 24, py0 + plotH + 6, SMALL, theme.accent)}
${label("l-test", lab(K, spec, "test"), qx, H - LAB_H + 6, SMALL, theme.fg)}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    const tl = new Tl();
    tl.show("l-train", 0.1);
    tl.show("pic", 0.05, 0.5);
    tl.show("l-ema", 0.4);
    tl.show("plot", 0.4, 0.5);
    tl.fromTo("test", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    tl.fromTo("l-infer", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    tl.fromTo("zone", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    // Step 1, training: the crop visits N places; each one's variance moves the running average.
    const c0 = s0 + 0.8;
    const span = Math.max(4, Math.min(n * 0.55, s1 - c0 - 0.6));
    const dt = span / n;
    tl.show("crop", c0 - 0.3, 0.3);
    tl.show("l-own", c0);
    d.origins.forEach(([x, y], i) => {
      const at = c0 + i * dt;
      const prev = d.origins[i - 1] ?? [x, y];
      tl.fromTo(
        "crop",
        { x: r3(prev[0] * k), y: r3(prev[1] * k) },
        { x: r3(x * k), y: r3(y * k), duration: Math.min(0.2, dt * 0.5), ease: "power1.inOut" },
        at,
      );
      tl.show(`o${i}`, at + dt * 0.4, 0.25);
      tl.show(`e${i}`, at + dt * 0.5, 0.25);
    });
    // Step 2, inference: the threshold stops; a differently hazed picture arrives and is not recalibrated.
    const i0 = Math.max(c0 + span + 0.4, s1);
    tl.hide("crop", i0, 0.3);
    tl.hide("l-train", i0, 0.4);
    tl.fromTo("l-infer", { opacity: 0 }, { opacity: 1, duration: 0.5 }, i0 + 0.3);
    tl.fromTo("zone", { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, i0);
    tl.show("frozen", i0 + 0.3, 0.6);
    tl.show("l-frozen", i0 + 0.5);
    tl.fromTo("test", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "sine.inOut" }, i0 + 1.0);
    tl.show("tdot", i0 + 2.0, 0.5);
    tl.show("gap", i0 + 2.4, 0.5);
    tl.show("l-test", i0 + 2.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

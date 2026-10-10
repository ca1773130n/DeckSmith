/**
 * channel-threshold — TM-LIF's per-channel threshold against one fixed
 * threshold. The quantizer is clip(⌊u/θ⌋, 0, D)/D; α and D are the plan's number
 * slots. The CHANNELS are fixed filter responses, not the trained network's, and
 * θ = α·σ reads "proportional to the variance" through the spread so a threshold
 * has u's units: the slots say "illustrative" where that matters.
 */
import { join } from "node:path";
import {
  even,
  img,
  type KindImpl,
  type KindSpec,
  LAB_H,
  lab,
  mean,
  normBy,
  num,
  panel,
  std,
  stepStarts,
  widthOf,
} from "../kind.js";
import { tmQuantize } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  boxBlur,
  haze,
  LABEL,
  label,
  luma,
  mapRgba,
  px,
  quantile,
  type Rgb,
  r3,
  readRgb,
  SMALL,
  T_HAZE,
  Tl,
  writeRaster,
} from "../kit.js";

/*
 * NO PAPER'S CONSTANTS LIVE HERE. α, the level count D, the EMA momentum μ and
 * the crop size are the plan's number slots (src/types.ts `LITERAL_SLOTS`),
 * checked against the source before the build runs: a kind used for another
 * paper computes with that paper's values or refuses to draw.
 */

/**
 * A threshold per channel from its spread, θ = α·σ. ILLUSTRATIVE: the source
 * says "proportional to the variance estimate"; a threshold compared with u
 * has u's units, so the quantizer scene reads it through the spread, and the
 * scene's slots say the values are illustrative.
 */
export const thetaOf = (sigma: number, alpha: number) => alpha * sigma;

interface Channel {
  u: Float32Array;
}

/** Five fixed-filter channels of a picture, of very different scales (illustrative, not the trained network's). */
export function channelsOf(img: Rgb): Channel[] {
  const { w, h } = img;
  const l = luma(img);
  const rb = new Float32Array(w * h);
  for (let i = 0; i < rb.length; i++)
    rb[i] = Math.abs((img.d[i * 3] as number) - (img.d[i * 3 + 2] as number));
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const gx = new Float32Array(w * h);
  const lap = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      gx[y * w + x] = Math.abs(
        -at(x - 1, y - 1) +
          at(x + 1, y - 1) -
          2 * at(x - 1, y) +
          2 * at(x + 1, y) -
          at(x - 1, y + 1) +
          at(x + 1, y + 1),
      );
      lap[y * w + x] = Math.abs(
        4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1),
      );
    }
  const bl = boxBlur(l, w, h, 3);
  const hp = l.map((v, i) => Math.abs(v - (bl[i] as number)));
  // Each channel's membrane is its deviation from its own mean (a normalised feature's magnitude).
  const centred = (v: Float32Array) => {
    const m = mean(v);
    return v.map((x) => Math.abs(x - m));
  };
  // In the order `channelNames` documents: luma, horizontal Sobel, R−B, Laplacian, high-pass.
  return [l, gx, rb, lap, hp].map((v) => ({ u: centred(v) }));
}

/** The channel names a plan gives, one per channel `channelsOf` draws, or a loud refusal. */
function channelNames(spec: KindSpec, n: number): string[] {
  const names = lab("channel-threshold", spec, "channelNames")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length !== n)
    throw new Error(
      `literal: channel-threshold draws ${n} channels; channelNames names ${names.length} ("${names.join('", "')}")`,
    );
  return names;
}

const CH_W = 360;
const CH_H = 240;
/** The histogram's log axis, decades of the membrane potential. */
const LOG_LO = -3.5;
const LOG_HI = 0.5;
const BINS = 40;

const logPos = (v: number) => (Math.log10(Math.max(10 ** LOG_LO, v)) - LOG_LO) / (LOG_HI - LOG_LO);

export const channelThresholdKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId, spec }) {
    const alpha = num("channel-threshold", spec, "alpha");
    const D = num("channel-threshold", spec, "levels");
    const hazy = haze(await readRgb(image as string, CH_W, CH_H), T_HAZE, AIRLIGHT);
    const chans = channelsOf(hazy);
    channelNames(spec, chans.length);
    // ONE fixed threshold for all: α × the spread of every channel pooled.
    const pooled = new Float32Array(chans.reduce((n, c) => n + c.u.length, 0));
    let o = 0;
    for (const c of chans) {
      pooled.set(c.u, o);
      o += c.u.length;
    }
    const thetaFixed = thetaOf(std(pooled), alpha);
    const files: Record<string, string> = {};
    const out: Array<Record<string, unknown>> = [];
    for (const [k, c] of chans.entries()) {
      const theta = thetaOf(std(c.u), alpha);
      const fix = tmQuantize(c.u, thetaFixed, D);
      const cal = tmQuantize(c.u, theta, D);
      files[`map${k}`] = `${beatId}-ch${k}.png`;
      files[`fix${k}`] = `${beatId}-ch${k}-fix.png`;
      files[`cal${k}`] = `${beatId}-ch${k}-cal.png`;
      await writeRaster(
        join(dir, files[`map${k}`] as string),
        CH_W,
        CH_H,
        mapRgba(normBy(c.u, quantile(c.u, 0.99))),
      );
      await writeRaster(join(dir, files[`fix${k}`] as string), CH_W, CH_H, mapRgba(fix));
      await writeRaster(join(dir, files[`cal${k}`] as string), CH_W, CH_H, mapRgba(cal));
      const hist = new Array<number>(BINS).fill(0);
      for (const v of c.u) {
        const b = Math.min(BINS - 1, Math.max(0, Math.floor(logPos(v) * BINS)));
        hist[b] = (hist[b] as number) + 1;
      }
      const top = Math.max(...hist);
      out.push({
        hist: hist.map((n) => r3(n / top)),
        theta: r3(logPos(theta)),
        fired: {
          fix: r3(mean(fix.map((v) => (v > 0 ? 1 : 0)))),
          cal: r3(mean(cal.map((v) => (v > 0 ? 1 : 0)))),
        },
      });
    }
    // The recap's thumbnail: the smallest channel's calibrated spikes, silent under the fixed threshold.
    const fixOf = (i: number) => (out[i]?.fired as { fix: number } | undefined)?.fix ?? 1;
    const quiet = out.reduce((a, _b, i) => (fixOf(i) < fixOf(a) ? i : a), 0);
    files.thumb = files[`cal${quiet}`] as string;
    return {
      files,
      data: { channels: out, thetaFixed: r3(logPos(thetaFixed)), alpha, D },
    };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "channel-threshold";
    const d = L.data as {
      channels: Array<{
        hist: number[];
        theta: number;
        fired: { fix: number; cal: number };
      }>;
      thetaFixed: number;
      alpha: number;
      D: number;
    };
    const f = L.files as Record<string, string>;
    const n = d.channels.length;
    const names = channelNames(spec, n);
    const gap = 24;
    const cw = Math.floor((W - (n - 1) * gap) / n);
    // Two rows of maps, a histogram row and four label lines must fit the region's height:
    // the maps shrink (keeping 3:2) before anything runs off the bottom.
    const histH = 120;
    const ch = even(Math.min(cw / 1.5, (H - LAB_H * 4 - histH - 24 - 20 - 20) / 2));
    const mw = even(ch * 1.5);
    const yMap = LAB_H * 2;
    const yHist = yMap + ch + 24;
    const yRow = yHist + histH + 20;
    const ySp = yRow + LAB_H;
    const cols = d.channels
      .map((c, k) => {
        const x = k * (cw + gap);
        const bw = cw / c.hist.length;
        const bars = c.hist
          .map(
            (v, i) =>
              `<rect x="${r3(i * bw)}" y="${r3(histH - v * (histH - 8))}" width="${r3(bw - 1)}" height="${r3(v * (histH - 8))}" fill="${theme.muted}"/>`,
          )
          .join("");
        return `${label(`n${k}`, names[k] as string, x, LAB_H, SMALL, theme.fg)}
${panel(`m${k}`, x, yMap, mw, ch, img(`mi${k}`, href(f[`map${k}`] as string), 0, 0, mw, ch), "lit-dark")}
<svg id="SCENEID-h${k}" width="${cw}" height="${histH}" viewBox="0 0 ${cw} ${histH}" style="left:${px(x)};top:${px(yHist)}">${bars}<line x1="0" y1="${histH}" x2="${cw}" y2="${histH}" stroke="${theme.rule}" stroke-width="2"/></svg>
<div id="SCENEID-th${k}" style="position:absolute;left:${px(x + d.thetaFixed * cw - 2)};top:${px(yHist - 6)};width:5px;height:${px(histH + 12)};background:${theme.accent}"></div>
${panel(`s${k}`, x, ySp, mw, ch, `${img(`sf${k}`, href(f[`fix${k}`] as string), 0, 0, mw, ch)}${img(`sc${k}`, href(f[`cal${k}`] as string), 0, 0, mw, ch)}`, "lit-dark")}`;
      })
      .join("\n");
    const note = lab(K, spec, "note", { alpha: d.alpha, D: d.D });
    const standIn = lab(K, spec, "standIn");
    const markup = `<div id="SCENEID-lit">
${label("l-ch", lab(K, spec, "channels"), 0, 0, LABEL, theme.fg)}
${label("l-note", note, W - widthOf(note, SMALL, theme) - 8, 0, SMALL, theme.muted)}
${cols}
${label("l-fix", lab(K, spec, "fixed"), 0, yRow, LABEL, theme.fg)}
${label("l-cal", lab(K, spec, "calibrated"), 0, yRow, LABEL, theme.accent)}
${label("l-stand", standIn, 0, ySp + ch + 20, SMALL, theme.muted)}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    // With one cue, the calibration is the cue's second half.
    const cal =
      cues.length >= 2 ? s1 : Math.max(s0 + 4.5, ((cues[0]?.t0 ?? 0.8) + (cues[0]?.t1 ?? 9)) / 2);
    const tl = new Tl();
    tl.show("l-ch", 0.1);
    tl.show("l-note", 0.4);
    tl.show("l-stand", 0.8);
    for (let k = 0; k < n; k++) {
      tl.show(`m${k}`, 0.2 + k * 0.12, 0.5);
      tl.show(`n${k}`, 0.2 + k * 0.12, 0.5);
      tl.show(`h${k}`, s0 + 0.6 + k * 0.1, 0.5);
    }
    // Step 1: ONE threshold for every channel; the small-scale ones fall silent.
    const f0 = s0 + 1.6;
    tl.show("l-fix", f0);
    for (let k = 0; k < n; k++) {
      tl.show(`th${k}`, f0, 0.4);
      tl.show(`s${k}`, f0 + 0.3, 0.6);
      tl.fromTo(`sc${k}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    }
    tl.fromTo("l-cal", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    // Step 2: each channel's threshold moves to its own scale, and its spikes appear.
    d.channels.forEach((c, k) => {
      tl.fromTo(
        `th${k}`,
        { x: 0 },
        { x: r3((c.theta - d.thetaFixed) * cw), duration: 1.6, ease: "sine.inOut" },
        cal,
      );
      tl.fromTo(
        `sc${k}`,
        { opacity: 0 },
        { opacity: 1, duration: 1.0, ease: "sine.inOut" },
        cal + 0.9,
      );
    });
    tl.hide("l-fix", cal, 0.4);
    tl.fromTo("l-cal", { opacity: 0 }, { opacity: 1, duration: 0.5 }, cal + 0.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

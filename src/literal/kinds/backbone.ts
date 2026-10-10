/**
 * backbone — an encoder–decoder of FIXED operations at true relative sizes.
 * Not learned; its output, which needs trained weights, is never drawn.
 */
import { join } from "node:path";
import {
  even,
  img,
  type KindImpl,
  LAB_H,
  lab,
  normBy,
  panel,
  std,
  stepStarts,
  widthOf,
  wrap,
} from "../kind.js";
import { tmQuantize } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  boxBlur,
  haze,
  label,
  luma,
  mapRgba,
  px,
  quantile,
  r3,
  readRgb,
  SMALL,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

const BB_W = 384;
const BB_H = 256;

/** 2×2 average pooling. */
export function avgPool(v: Float32Array, w: number, h: number): Float32Array {
  const W = w >> 1;
  const H = h >> 1;
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      o[y * W + x] =
        ((v[2 * y * w + 2 * x] as number) +
          (v[2 * y * w + 2 * x + 1] as number) +
          (v[(2 * y + 1) * w + 2 * x] as number) +
          (v[(2 * y + 1) * w + 2 * x + 1] as number)) /
        4;
  return o;
}

/** Nearest-neighbour 2× upsampling. */
export function upsample(v: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(w * h * 4);
  for (let y = 0; y < 2 * h; y++)
    for (let x = 0; x < 2 * w; x++) o[y * 2 * w + x] = v[(y >> 1) * w + (x >> 1)] as number;
  return o;
}

/**
 * The backbone's display quantizer: θ = σ of the map, four levels. A choice of
 * this illustration (the scene says its operations are fixed, not the trained
 * network), not any paper's α or D.
 */
const BB_LEVELS = 4;

/** Spike-quantize a map at its own spread, returning levels in [0, 1] and θ. */
function spikeMap(u: Float32Array): { s: Float32Array; theta: number } {
  const theta = std(u);
  return { s: tmQuantize(u, theta, BB_LEVELS), theta };
}

export interface Backbone {
  shallow: Float32Array;
  enc: Float32Array[];
  dec: Float32Array[];
  prb: Float32Array;
}

/** An encoder–decoder of FIXED operations on a grey map w×h (w, h divisible by 8). */
export function fixedBackbone(l: Float32Array, w: number, h: number): Backbone {
  // Shallow: a fixed 3×3 (8-neighbour Laplacian) response, rectified.
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const shallow = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 8 * at(x, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) s -= at(x + dx, y + dy);
      shallow[y * w + x] = Math.abs(s);
    }
  const s0 = spikeMap(shallow).s;
  const enc: Float32Array[] = [s0];
  let cw = w;
  let chh = h;
  for (let i = 0; i < 3; i++) {
    const pooled = avgPool(enc[i] as Float32Array, cw, chh);
    cw >>= 1;
    chh >>= 1;
    enc.push(spikeMap(pooled).s);
  }
  // Decoder: up 2×, add the skip from the encoder at that scale, quantize.
  const dec: Float32Array[] = [];
  let cur = enc[3] as Float32Array;
  for (let i = 2; i >= 0; i--) {
    const up = upsample(cur, cw, chh);
    cw <<= 1;
    chh <<= 1;
    const skip = enc[i] as Float32Array;
    const sum = up.map((v, j) => v + (skip[j] as number));
    cur = spikeMap(sum).s;
    dec.unshift(cur);
  }
  // PRB (fixed stand-in): spike levels back to a continuous map, smoothed by a 7×7 mean —
  // wide enough that four levels read as a continuous grey, which a 3×3 did not.
  const prb = boxBlur(dec[0] as Float32Array, w, h, 3);
  return { shallow, enc, dec, prb };
}

export const backboneKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, BB_W, BB_H), T_HAZE, AIRLIGHT);
    const bb = fixedBackbone(luma(hazy), BB_W, BB_H);
    const files: Record<string, string> = {
      input: `${beatId}-input.jpg`,
      shallow: `${beatId}-shallow.png`,
      prb: `${beatId}-prb.png`,
    };
    await writeRaster(join(dir, files.input as string), BB_W, BB_H, toRgba(hazy));
    await writeRaster(
      join(dir, files.shallow as string),
      BB_W,
      BB_H,
      mapRgba(normBy(bb.shallow, quantile(bb.shallow, 0.99))),
    );
    const sizes = [1, 2, 4, 8];
    for (let i = 1; i <= 3; i++) {
      files[`e${i}`] = `${beatId}-e${i}.png`;
      await writeRaster(
        join(dir, files[`e${i}`] as string),
        BB_W / (sizes[i] as number),
        BB_H / (sizes[i] as number),
        mapRgba(bb.enc[i] as Float32Array),
      );
    }
    for (let i = 0; i <= 2; i++) {
      files[`d${i}`] = `${beatId}-d${i}.png`;
      await writeRaster(
        join(dir, files[`d${i}`] as string),
        BB_W / (sizes[i] as number),
        BB_H / (sizes[i] as number),
        mapRgba(bb.dec[i] as Float32Array),
      );
    }
    await writeRaster(join(dir, files.prb as string), BB_W, BB_H, mapRgba(bb.prb));
    files.thumb = files.prb as string;
    return { files, data: { w: BB_W, h: BB_H } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "backbone";
    const f = L.files as Record<string, string>;
    // A U: full size at the top corners, then halving down the middle and back up.
    // Every map at its TRUE relative size; seven columns = 3.625 full widths + six gaps.
    const gap = 40;
    const full = even(Math.min(420, (W - 6 * gap) / 3.625, ((H - 2 * LAB_H) / 2) * 1.5));
    const sz = [full, full / 2, full / 4, full / 8].map((v) => even(v));
    const hz = sz.map((v) => even(v / 1.5));
    const lv = [0, 1, 2, 3, 2, 1, 0];
    const X: number[] = [];
    let x = 0;
    for (const l of lv) {
      X.push(x);
      x += (sz[l] as number) + gap;
    }
    const off = Math.max(0, (W - (x - gap)) / 2);
    for (let i = 0; i < X.length; i++) X[i] = (X[i] as number) + off;
    const fullH = hz[0] as number;
    const yIn = H - fullH;
    // Levels step down between the top row and the bottom of the region.
    const bottom = H - (hz[3] as number) - 4;
    const top1 = LAB_H + fullH * 0.62;
    const Y = lv.map((l) => (l === 0 ? LAB_H : top1 + ((bottom - top1) * (l - 1)) / 2));
    const box = (i: number) => {
      const l = lv[i] as number;
      return {
        x: X[i] as number,
        y: Y[i] as number,
        w: sz[l] as number,
        h: hz[l] as number,
      };
    };
    const centre = (i: number) => {
      const b = box(i);
      return [b.x + b.w / 2, b.y + b.h / 2] as const;
    };
    const map = (id: string, file: string, i: number, pix = true) => {
      const b = box(i);
      return panel(
        id,
        b.x,
        b.y,
        b.w,
        b.h,
        img(`${id}-i`, href(file), 0, 0, b.w, b.h, pix ? "image-rendering:pixelated" : ""),
        "lit-dark",
      );
    };
    const mapLabel = (id: string, text: string, i: number) =>
      label(id, text, X[i] as number, (Y[i] as number) - LAB_H, SMALL, theme.fg);
    // The data flow, as arrows: input → 3×3 → down the encoder → up the decoder → PRB → output.
    const arrow = (id: string, x1: number, y1: number, x2: number, y2: number) =>
      `<line id="SCENEID-${id}" x1="${r3(x1)}" y1="${r3(y1)}" x2="${r3(x2)}" y2="${r3(y2)}" stroke="${theme.fg}" stroke-width="4" marker-end="url(#SCENEID-ah)"/>`;
    const flow: string[] = [];
    const inB = { x: X[0] as number, y: yIn, w: full, h: fullH };
    flow.push(arrow("a0", inB.x + full / 2, inB.y - 8, inB.x + full / 2, LAB_H + fullH + 14));
    for (let i = 0; i < 6; i++) {
      const a = box(i);
      const b = box(i + 1);
      flow.push(arrow(`a${i + 1}`, a.x + a.w + 6, a.y + a.h / 2, b.x - 10, b.y + b.h / 2));
    }
    const m6 = box(6);
    flow.push(arrow("a7", m6.x + full / 2, m6.y + m6.h + 8, m6.x + full / 2, yIn - LAB_H - 6));
    // Skips run along the maps' top edges, clear of the level labels.
    const skip = (i: number, j: number) => {
      const y = (Y[i] as number) + 12;
      const a = box(i);
      return `<line id="SCENEID-k${i}" x1="${r3(a.x + a.w + 6)}" y1="${r3(y)}" x2="${r3((X[j] as number) - 6)}" y2="${r3(y)}" stroke="${theme.muted}" stroke-width="4" stroke-dasharray="10 9"/>`;
    };
    const outLines = wrap(lab(K, spec, "untrained"), SMALL, full - 48, theme);
    const outText = outLines
      .map((t, i) =>
        label(`ot${i}`, t, (X[6] as number) + 24, yIn + 24 + i * 52, SMALL, theme.muted),
      )
      .join("");
    const note = lab(K, spec, "note");
    // The depth note sits in the free band left of the bottom map, wrapped to it.
    const dx = (X[1] as number) - 10;
    const dw = (X[3] as number) - dx - 24;
    const depthLines = wrap(lab(K, spec, "depth"), SMALL, dw, theme);
    const depth = depthLines
      .map((t, i) => label(`dn${i}`, t, dx, H - (depthLines.length - i) * 52, SMALL, theme.muted))
      .join("");
    const markup = `<div id="SCENEID-lit">
${label("l-in", lab(K, spec, "input"), X[0] as number, yIn - LAB_H, SMALL, theme.fg)}
${panel("in", X[0] as number, yIn, full, fullH, img("in-i", href(f.input as string), 0, 0, full, fullH), "lit-dark")}
${mapLabel("l0", lab(K, spec, "shallow"), 0)}
${map("m0", f.shallow as string, 0, false)}
${mapLabel("l1", lab(K, spec, "encoder"), 1)}${map("m1", f.e1 as string, 1)}
${map("m2", f.e2 as string, 2)}
${map("m3", f.e3 as string, 3)}
${map("m4", f.d2 as string, 4)}
${mapLabel("l5", lab(K, spec, "decoder"), 5)}${map("m5", f.d1 as string, 5)}
${mapLabel("l6", lab(K, spec, "prb"), 6)}
${panel("m6", X[6] as number, Y[6] as number, full, fullH, `${img("m6-s", href(f.d0 as string), 0, 0, full, fullH, "image-rendering:pixelated")}${img("m6-c", href(f.prb as string), 0, 0, full, fullH)}`, "lit-dark")}
<svg id="SCENEID-flow" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="left:0;top:0"><defs><marker id="SCENEID-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${theme.fg}"/></marker></defs>${flow.join("")}${skip(0, 6)}${skip(1, 5)}${skip(2, 4)}</svg>
${label("l-skip", lab(K, spec, "skip"), (X[2] as number) - 10, (Y[1] as number) + 12 - 54, SMALL, theme.muted)}
${label("l-out", lab(K, spec, "output"), X[6] as number, yIn - LAB_H, SMALL, theme.fg)}
<div id="SCENEID-out" style="position:absolute;left:${px(X[6] as number)};top:${px(yIn)};width:${px(full)};height:${px(fullH)};border:3px dashed ${theme.muted};box-sizing:border-box;border-radius:6px"></div>
${outText}
${label("l-fixed", note, Math.max(X[1] as number, (W - widthOf(note, SMALL, theme)) / 2), 0, SMALL, theme.muted)}
${depth}
</div>`;
    const [s0, s1, s2, s3] = stepStarts(cues, 4) as [number, number, number, number];
    const tl = new Tl();
    tl.show("in", 0.05, 0.5);
    tl.show("l-in", 0.2);
    tl.show("l-fixed", 0.6);
    tl.show("flow", 0.05, 0.01);
    for (let i = 0; i <= 7; i++)
      tl.fromTo(`a${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    for (const i of [0, 1, 2])
      tl.fromTo(`k${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    const appear = (
      id: string,
      i: number,
      from: readonly [number, number],
      scale: number,
      at: number,
    ) => {
      const [cx, cy] = centre(i);
      tl.fromTo(
        id,
        { opacity: 0, x: r3(from[0] - cx), y: r3(from[1] - cy), scale },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.9, ease: "power2.inOut" },
        at,
      );
    };
    // Step 1: a 3×3 filter turns the input into shallow features.
    tl.show("a0", s0 + 0.4, 0.4);
    appear("m0", 0, [(X[0] as number) + full / 2, yIn + fullH / 2], 1, s0 + 0.6);
    tl.show("l0", s0 + 1.3);
    // Step 2: down, scale by scale — each map is the one before, pooled to half and spiked.
    for (let i = 1; i <= 3; i++) {
      const at = s1 + 0.3 + (i - 1) * 1.1;
      tl.show(`a${i}`, at - 0.2, 0.3);
      appear(`m${i}`, i, centre(i - 1), 2, at);
      if (i === 1) tl.show("l1", at + 0.6);
    }
    for (let i = 0; i < depthLines.length; i++) tl.show(`dn${i}`, s1 + 3.8);
    // Step 3: up, scale by scale, each joined by the encoder's map across its skip.
    for (const [i, from] of [
      [4, 3],
      [5, 4],
    ] as const) {
      const at = s2 + 0.5 + (i - 4) * 1.4;
      tl.show(`k${6 - i}`, at - 0.4, 0.5);
      tl.show(`a${i}`, at - 0.2, 0.3);
      appear(`m${i}`, i, centre(from), 0.5, at);
      if (i === 5) tl.show("l5", at + 0.6);
    }
    tl.show("l-skip", s2 + 0.2);
    // Step 4: the output is not drawn (it needs trained weights); full size as spike levels,
    // then the PRB's continuous map — the scene ends on what the fixed operations computed.
    tl.show("l-out", s3);
    tl.show("out", s3, 0.5);
    for (let i = 0; i < outLines.length; i++) tl.show(`ot${i}`, s3 + 0.3);
    tl.show("k0", s3 + 0.6, 0.5);
    tl.show("a6", s3 + 0.8, 0.3);
    appear("m6", 6, centre(5), 0.5, s3 + 1.0);
    tl.show("l6", s3 + 1.6);
    tl.fromTo("m6-c", { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "sine.inOut" }, s3 + 2.4);
    tl.show("a7", s3 + 3.4, 0.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

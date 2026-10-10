/**
 * crops — training crops of the stated size, drawn to scale on the training
 * picture, then gathered into one batch of the stated size.
 */
import { join } from "node:path";
import { even, img, type KindImpl, LAB_H, lab, num, panel, stepStarts } from "../kind.js";
import { cropOf, cropOrigins, nativeSize } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  haze,
  LABEL,
  label,
  px,
  type Rgb,
  r3,
  readRgb,
  slotNumber,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

/** The picture a crops scene cuts from: the training size the source states (a centred square), or its own. */
async function trainingPicture(image: string, size: number | undefined): Promise<Rgb> {
  if (size === undefined) {
    const { w, h } = await nativeSize(image);
    return readRgb(image, w, h);
  }
  // Resized to size×size as the source says; the middle square, so nothing is stretched.
  const { w, h } = await nativeSize(image);
  const side = Math.min(w, h);
  const full = await readRgb(image, w, h);
  const sq = cropOf(full, Math.floor((w - side) / 2), Math.floor((h - side) / 2), side);
  return resample(sq, size);
}

/** Area-average resample of a square picture to n×n. */
function resample(img: Rgb, n: number): Rgb {
  const d = new Float32Array(n * n * 3);
  const k = img.w / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor(x * k);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * k));
      const y0 = Math.floor(y * k);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) s += img.d[(yy * img.w + xx) * 3 + c] as number;
        d[(y * n + x) * 3 + c] = s / ((x1 - x0) * (y1 - y0));
      }
    }
  return { w: n, h: n, d };
}

export const cropsKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId, spec }) {
    const K = "crops";
    const crop = num(K, spec, "crop");
    const batch = num(K, spec, "batch");
    if (!Number.isInteger(batch) || batch < 1 || batch > 8)
      throw new Error(`literal: crops draws a batch of 1 to 8 crops, got ${batch}`);
    const size = slotNumber(K, spec.labels, "size");
    const pic = haze(await trainingPicture(image as string, size), T_HAZE, AIRLIGHT);
    const { w, h } = pic;
    // Exactly `batch` random crops, as training draws them: they may overlap.
    const origins = cropOrigins(w, h, crop, batch, 4);
    const files: Record<string, string> = { pic: `${beatId}-pic.jpg` };
    await writeRaster(join(dir, files.pic as string), w, h, toRgba(pic));
    for (const [i, [x, y]] of origins.entries()) {
      files[`c${i}`] = `${beatId}-crop${i}.jpg`;
      await writeRaster(
        join(dir, files[`c${i}`] as string),
        crop,
        crop,
        toRgba(cropOf(pic, x, y, crop)),
      );
    }
    return { files, data: { w, h, crop, origins } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "crops";
    const d = L.data as { w: number; h: number; crop: number; origins: Array<[number, number]> };
    const f = L.files as Record<string, string>;
    const n = d.origins.length;
    const right = 600;
    const pw = even(Math.min(W - right - 60, (H - LAB_H) * (d.w / d.h)));
    const ph = even((pw * d.h) / d.w);
    const k = pw / d.w;
    const cs = r3(d.crop * k);
    const bx = pw + 60;
    const cols = n <= 1 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const tile = Math.min(
      260,
      (W - bx - 24 * (cols - 1)) / cols,
      (H - LAB_H - 24 * (rows - 1)) / rows,
    );
    const slot = (i: number) =>
      [bx + (i % cols) * (tile + 24), LAB_H + Math.floor(i / cols) * (tile + 24)] as const;
    const crops = d.origins
      .map(([x, y], i) => {
        const [sx, sy] = slot(i);
        return `<div id="SCENEID-r${i}" style="position:absolute;left:${px(x * k)};top:${px(LAB_H + y * k)};width:${px(cs)};height:${px(cs)};border:4px solid ${theme.accent};box-sizing:border-box"></div>
<div id="SCENEID-t${i}" class="lit-panel" style="left:${px(sx)};top:${px(sy)};width:${px(tile)};height:${px(tile)}">${img(`t${i}-i`, href(f[`c${i}`] as string), 0, 0, tile, tile)}</div>`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
${label("l-pic", lab(K, spec, "picture"), 0, 0, LABEL, theme.fg)}
${panel("pic", 0, LAB_H, pw, ph, img("pic-i", href(f.pic as string), 0, 0, pw, ph), "lit-dark")}
${label("l-batch", lab(K, spec, "batchLabel"), bx, 0, LABEL, theme.fg)}
${crops}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    const tl = new Tl();
    tl.show("pic", 0.05, 0.5);
    tl.show("l-pic", 0.2);
    // Step 1: random crops, at true scale on the picture, one after another.
    const c0 = Math.max(0.8, s0 + 0.4);
    const dt = Math.max(0.6, Math.min(1.4, (s1 - c0 - 0.4) / n));
    for (let i = 0; i < n; i++) tl.show(`r${i}`, c0 + i * dt, 0.4);
    // Step 2: the crops leave the picture and stack into one batch.
    const b0 = Math.max(s1, c0 + n * dt + 0.2);
    tl.show("l-batch", b0);
    d.origins.forEach(([x, y], i) => {
      const at = b0 + 0.3 + i * 0.6;
      const [sx, sy] = slot(i);
      tl.fromTo(
        `t${i}`,
        {
          opacity: 0,
          x: r3(x * k - sx + (cs - tile) / 2),
          y: r3(LAB_H + y * k - sy + (cs - tile) / 2),
          scale: r3(cs / tile),
        },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.8, ease: "power2.inOut" },
        at,
      );
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

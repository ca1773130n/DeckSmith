/**
 * dark-channel — the classical Dark Channel Prior (He et al.: min filter,
 * top-0.1% airlight, ω = 0.95, t₀ = 0.1, guided-filter refinement), run for real
 * on the picture under haze of a KNOWN uniform t, so the estimate is checked
 * against the truth on screen. Prior work, labelled as that.
 */
import { join } from "node:path";
import {
  drift,
  even,
  img,
  type KindImpl,
  LAB_H,
  lab,
  mean,
  panel,
  REST,
  spread,
  stepStarts,
  tag,
  wrap,
} from "../kind.js";
import { darkChannel, dcp } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  haze,
  LABEL,
  label,
  mapRgba,
  ON_PHOTO,
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

// The classical prior's maths is shared with prior-work, which runs it too (kinds-shared.ts).
export { type DcpResult, darkChannel, dcp, guidedFilter, minFilter } from "../kinds-shared.js";

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
    // The four pictures as large as the region allows, their titles ON them (a title line
    // above each row took 120px of picture); the plot column keeps room for its words.
    const ph = even(Math.min((H - gap) / 2, ((W - 600 - 64 - gap) / 2 / 1.5) | 0));
    const pw = even(ph * 1.5);
    const x2 = pw + gap;
    const y2 = ph + gap;
    const qx = 2 * pw + gap + 64;
    const qw = W - qx;
    const rowY = r3(d.row * ph);
    const onTile = (id: string, text: string, x = 0, y = 0) =>
      tag(id, text, x + 20, y + 14, pw - 40, LABEL, "", theme, ON_PHOTO);
    const tile = (id: string, src: string, x: number, y: number, over = "") =>
      panel(
        id,
        x,
        y,
        pw,
        ph,
        `<div id="SCENEID-${id}-cam" style="position:absolute;left:0;top:0;width:${px(pw)};height:${px(ph)}">${img(`${id}-i`, href(src), 0, 0, pw, ph)}${over}</div>`,
        "lit-dark",
      );
    // The plot column's words, wrapped to it: the premise is a sentence in the deck's language.
    const lines = (id: string, text: string, y: number, color: string) => {
      const ls = wrap(text, SMALL, qw, theme);
      return {
        h: ls.length * 50,
        html: ls.map((t, i) => label(`${id}${i}`, t, qx, y + i * 50, SMALL, color)).join(""),
        ids: ls.map((_, i) => `${id}${i}`),
      };
    };
    const t = { t: d.tTrue };
    const share = lab(K, spec, "missShare", { p: Math.round(d.missFrac * 100) });
    const premise = lab(K, spec, "premise");
    const premiseV = lab(K, spec, "premiseValue", { v: d.premise });
    const foot = [premise, premiseV, share].reduce(
      (n, s) => n + wrap(s, SMALL, qw, theme).length * 50,
      0,
    );
    // Transmission plot: 0..1 up the axis, the truth as a dashed line.
    const py0 = LAB_H + 20;
    const plotH = H - py0 - 2 * 50 - foot - 40;
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
    const legendY = py0 + plotH + 24;
    const fShare = lines("l-share", share, legendY + 100, theme.accent);
    const fPrem = lines("l-premise", premise, legendY + 100 + fShare.h, theme.fg);
    const fPremV = lines("l-premise2", premiseV, legendY + 100 + fShare.h + fPrem.h, theme.accent);
    const markup = `<div id="SCENEID-lit">
${tile("p-hazy", f.hazy as string, 0, 0)}
${onTile("l-hazy", lab(K, spec, "hazy"))}
${panel("p-dark", x2, 0, pw, ph, `${img("dark-u", href(f.hazy as string), 0, 0, pw, ph)}<div id="SCENEID-dark-w" style="position:absolute;left:0;top:0;width:0;height:${px(ph)};overflow:hidden">${img("dark-i", href(f.dark as string), 0, 0, pw, ph)}</div><div id="SCENEID-dark-edge" style="position:absolute;left:0;top:0;width:4px;height:${px(ph)};background:${theme.accent}"></div>`, "lit-dark")}
${onTile("l-dark", lab(K, spec, "dark"), x2)}
${tile("p-trans", f.trans as string, 0, y2, `${scan("scan")}${img("miss", href(f.miss as string), 0, 0, pw, ph)}`)}
${onTile("l-trans", lab(K, spec, "transmission"), 0, y2)}
${tag("l-miss", lab(K, spec, "miss", t), 20, y2 + ph - 64, pw - 40, SMALL, "", theme, ON_PHOTO, true)}
${panel("p-rec", x2, y2, pw, ph, `<div id="SCENEID-p-rec-cam" style="position:absolute;left:0;top:0;width:${px(pw)};height:${px(ph)}">${img("rec-u", href(f.hazy as string), 0, 0, pw, ph)}<div id="SCENEID-rec-w" style="position:absolute;left:0;top:0;width:0;height:${px(ph)};overflow:hidden">${img("rec-i", href(f.rec as string), 0, 0, pw, ph)}</div></div>`, "lit-dark")}
${onTile("l-rec", lab(K, spec, "recovered"), x2, y2)}
${label("l-plot", lab(K, spec, "profile"), qx, 0, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${qw}" height="${H}" viewBox="0 0 ${qw} ${H}" style="left:${px(qx)};top:0">
<line x1="0" y1="${py0}" x2="0" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line x1="0" y1="${r3(py0 + plotH)}" x2="${plotW}" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line id="SCENEID-truth" x1="0" y1="${truthY}" x2="${plotW}" y2="${truthY}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="12 10"/>
<polyline id="SCENEID-est" points="${pts}" fill="none" stroke="${theme.accent}" stroke-width="4" stroke-linejoin="round"/>
</svg>
${label("l-truth", lab(K, spec, "truth", t), qx, legendY, SMALL, theme.fg)}
${label("l-est", lab(K, spec, "estimate"), qx, legendY + 50, SMALL, theme.accent)}
${fShare.html}${fPrem.html}${fPremV.html}
</div>`;
    const [, s1, s2, s3] = stepStarts(cues, 4) as [number, number, number, number];
    const end = cues[3]?.t1 ?? s3 + 8;
    const tl = new Tl();
    // The frame is full from the first: the hazy input opens alone, as large as the region
    // holds it; on the dark channel's sentence it makes room and the two stand side by side,
    // large; on the transmission's they settle into the grid the last two steps fill. Each
    // tile keeps its 3:2, so every move is one uniform scale (origin top-left) and a shift;
    // the words on a tile travel with its corner and keep their size.
    const SA = Math.min(W / pw, H / ph);
    const A = { x: (W - pw * SA) / 2, y: (H - ph * SA) / 2, s: SA };
    const SB = Math.min((W - gap) / 2 / pw, H / ph);
    const bx = (W - (2 * pw * SB + gap)) / 2;
    const by = (H - ph * SB) / 2;
    const B = { x: bx, y: by, s: SB };
    const Bd = { x: bx + pw * SB + gap - x2, y: by, s: SB };
    const pose = (p: { x: number; y: number; s: number }) => ({
      x: r3(p.x),
      y: r3(p.y),
      scale: r3(p.s),
      transformOrigin: "0 0",
    });
    const shift = (p: { x: number; y: number }) => ({ x: r3(p.x), y: r3(p.y) });
    const move = (
      id: string,
      from: Record<string, unknown>,
      to: Record<string, unknown>,
      t: number,
    ) => tl.fromTo(id, from, { ...to, duration: 0.9, ease: "power2.inOut" }, t);
    const home = { x: 0, y: 0, scale: 1, transformOrigin: "0 0" };
    // Step 1: the classical prior is applied to the hazy input — the camera reads across it.
    tl.fromTo(
      "p-hazy",
      { opacity: 0, ...pose(A) },
      { opacity: 1, ...pose(A), duration: 0.5 },
      0.05,
    );
    tl.fromTo(
      "l-hazy",
      { opacity: 0, ...shift(A) },
      { opacity: 1, ...shift(A), duration: 0.6 },
      0.2,
    );
    const b0 = Math.max(1.6, s1 - 0.4);
    drift(tl, "p-hazy-cam", 0.6, b0 - 0.1, { x: -pw * 0.06, y: 0, scale: 1.14 });
    move("p-hazy", pose(A), pose(B), b0);
    move("l-hazy", shift(A), shift(B), b0);
    tl.fromTo(
      "p-dark",
      { opacity: 0, ...pose(Bd) },
      { opacity: 1, ...pose(Bd), duration: 0.4 },
      b0 + 0.5,
    );
    tl.fromTo(
      "l-dark",
      { opacity: 0, ...shift(Bd) },
      { opacity: 1, ...shift(Bd), duration: 0.6 },
      b0 + 0.6,
    );
    // Step 2: the dark channel, computed patch by patch, sweeps across the input it is computed
    // from — for the length of its sentence.
    const sweep = Math.max(2.4, Math.min(6, s2 - b0 - 1.6));
    const w0 = b0 + 0.9;
    tl.fromTo("dark-w", { width: 0 }, { width: pw, duration: sweep, ease: "none" }, w0);
    tl.fromTo("dark-edge", { x: 0 }, { x: pw - 4, duration: sweep, ease: "none" }, w0);
    tl.hide("dark-edge", w0 + sweep, 0.3);
    drift(tl, "p-hazy-cam", w0, w0 + sweep, REST, { x: -pw * 0.06, y: 0, scale: 1.14 });
    // Step 3: the pair settles into the grid; transmission from the dark channel, and along
    // one line it is checked against the truth.
    const c0 = Math.max(w0 + sweep + 0.3, s2 - 0.3);
    move("p-hazy", pose(B), home, c0);
    move("l-hazy", shift(B), { x: 0, y: 0 }, c0);
    move("p-dark", pose(Bd), home, c0);
    move("l-dark", shift(Bd), { x: 0, y: 0 }, c0);
    tl.show("l-trans", c0 + 0.6);
    tl.show("p-trans", c0 + 0.6, 0.8);
    tl.fromTo("scan", { opacity: 0 }, { opacity: 1, duration: 0.4 }, c0 + 1.4);
    tl.show("l-plot", c0 + 1.4);
    tl.show("plot", c0 + 1.4, 0.5);
    tl.show("l-truth", c0 + 1.6);
    tl.show("l-est", c0 + 2.0);
    tl.fromTo("est", { opacity: 0 }, { opacity: 1, duration: 0.8 }, c0 + 2.0);
    tl.fromTo("miss", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "sine.inOut" }, c0 + 3.0);
    tl.show("l-miss", c0 + 3.2);
    // Step 4: the recovered picture — plausible to the eye — sweeps over the hazy one, and,
    // measured, how much of its transmission was wrong and what the prior assumed. (Its colour
    // error is NOT larger where the transmission missed on every picture: measured on the r2
    // deck it was 0.8x, so the scene states the miss itself, never "the recovery fails there".)
    tl.show("l-rec", s3);
    tl.show("p-rec", s3, 0.6);
    const r0 = s3 + 0.5;
    const rd = Math.max(2.4, Math.min(4.5, (end - s3) * 0.3));
    tl.fromTo("rec-w", { width: 0 }, { width: pw, duration: rd, ease: "sine.inOut" }, r0);
    const at = spread(r0 + rd, end, 3, 0.6, 3.2);
    for (const id of fShare.ids) tl.show(id, at[0] as number);
    for (const id of fPrem.ids) tl.show(id, at[1] as number);
    for (const id of fPremV.ids) tl.show(id, (at[2] as number) + 0.3);
    // While the premise is read, the camera settles on the recovered picture.
    drift(tl, "p-rec-cam", r0 + rd, end - 0.2, { x: pw * 0.05, y: -ph * 0.04, scale: 1.12 });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

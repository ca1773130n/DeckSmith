/**
 * spikes — a leaky integrate-and-fire neuron (soft reset) per feature cell,
 * simulated for `STEPS` steps. The features are the hazy picture's own edge
 * energy. The input gain is chosen so that the weakest 40% of cells sit
 * below threshold — an illustrative parameter, NOT the paper's measurement.
 */
import { join } from "node:path";
import type { Fragment } from "../../bespoke/contract.js";
import type { Theme } from "../../emit/kit.js";
import { even, type KindImpl, type KindSpec, widthOf } from "../kind.js";
import type { Box } from "../kinds-shared.js";
import {
  AIRLIGHT,
  baseCss,
  type Cue,
  cellMeans,
  haze,
  LABEL,
  type Layers,
  LEAK,
  type LifRun,
  label,
  lif,
  luma,
  mapRgba,
  px,
  quantile,
  r3,
  readRgb,
  round3,
  SMALL,
  STEPS,
  slotText,
  sobel,
  T_HAZE,
  THETA,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";

/** Every literal scene's feature grid. 3:2 like the picture. */
export const GRID = { cols: 18, rows: 12 } as const;

/** The spike scene: the hazy picture's edge energy per cell, each cell an LIF neuron. */
async function spikeLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const hazy = haze(await readRgb(image, w, h), T_HAZE, AIRLIGHT);
  const files: Record<string, string> = { hazy: `${beatId}-hazy.jpg` };
  await writeRaster(join(dir, files.hazy as string), w, h, toRgba(hazy));
  const e = sobel(luma(hazy), w, h);
  const cols = GRID.cols;
  const rows = GRID.rows;
  const cells = cellMeans(e, w, h, cols, rows);
  const top = Math.max(1e-6, quantile(cells, 0.98));
  const x = cells.map((c) => Math.min(1, c / top));
  // Gain: the weakest 40% of cells settle below threshold (x·g/(1−λ) < θ).
  const gain = (THETA * (1 - LEAK)) / Math.max(1e-6, quantile(x, 0.4));
  const runs = x.map((xi) => lif(xi * gain * 0.999, STEPS, LEAK, THETA));
  const counts = runs.map((r) => r.spikes.length);
  const out = spikeOutput(counts, gain);
  // The recap's thumbnail: the map the next layer receives, one cell per neuron.
  const outMap = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x2 = 0; x2 < w; x2++) {
      const c = Math.min(cols - 1, Math.floor((x2 * cols) / w));
      const r = Math.min(rows - 1, Math.floor((y * rows) / h));
      outMap[y * w + x2] = out[r * cols + c] as number;
    }
  const thumb = `${beatId}-spikes-out.png`;
  await writeRaster(join(dir, thumb), w, h, mapRgba(outMap));
  files.thumb = thumb;
  // Three witnesses: a strong, a middling and a weak cell, each its own trace.
  // Interior cells only: a witness on the map's border is half hidden by the panel's edge.
  const inside = (i: number) =>
    i % cols > 0 &&
    i % cols < cols - 1 &&
    Math.floor(i / cols) > 0 &&
    Math.floor(i / cols) < rows - 1;
  const order = x
    .map((v, i) => [v, i] as const)
    .filter(([, i]) => inside(i))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pick = (q: number) =>
    (order[Math.round(q * (order.length - 1))] as readonly [number, number])[1];
  const witnesses = [pick(0.93), pick(0.62), pick(0.22)].map((i) => ({
    cell: i,
    x: round3(x[i] as number),
    input: round3((x[i] as number) * gain * 0.999),
    ...runs[i],
    pre: (runs[i] as LifRun).pre.map(round3),
    post: (runs[i] as LifRun).post.map(round3),
    // Without the leak the same input would cross: what the leak costs.
    noLeak: lif((x[i] as number) * gain * 0.999, STEPS, 1, THETA),
  }));
  return {
    files,
    data: {
      cols,
      rows,
      x: x.map(round3),
      counts,
      out,
      witnesses,
      steps: STEPS,
      leak: LEAK,
      theta: THETA,
    },
  };
}

/**
 * What each cell passes on, ON THE INPUT'S SCALE: its spikes carried n·θ over
 * the run, and it was given x·gain per step, so n·θ / (STEPS·gain) is directly
 * comparable with x — never larger, since the leak and the residual keep the
 * rest. Drawn at that brightness, the output map can only lose what the input
 * had, which is the point of the scene.
 */
export function spikeOutput(counts: readonly number[], gain: number): number[] {
  return counts.map((n) => round3(Math.min(1, (n * THETA) / (STEPS * gain))));
}

function layout(W: number, H: number): Box {
  // Two maps stacked, each under its own label line.
  const ph = even((H - 2 * 56 - 28) / 2);
  return { W, H, img: { w: even(ph * 1.5), h: ph }, edge: { w: 0, h: 0 }, feat: { w: 0, h: 0 } };
}

function spikeFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: KindSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const { W, H } = box;
  const lab = (k: string) => slotText("spikes", spec.labels, k);
  const d = L.data as {
    cols: number;
    rows: number;
    x: number[];
    counts: number[];
    out: number[];
    steps: number;
    theta: number;
    witnesses: Array<{
      cell: number;
      pre: number[];
      post: number[];
      spikes: number[];
      noLeak: LifRun;
    }>;
  };
  // Input map above, output map below, on the left; the neurons' traces fill the right.
  const pw = box.img.w;
  const ph = box.img.h;
  const top = 56;
  const ax = 0; // map A
  const cyp = top + ph + 28 + 56; // map C's top
  const bx = pw + 64; // traces
  const bw = W - bx;
  const cw = pw / d.cols;
  const chh = ph / d.rows;
  const heat = "#f4f1ea"; // a neutral, so the witnesses' tones read against it
  const tones = [theme.tones.a, theme.tones.b, theme.tones.c];
  const cellRects = (prefix: string, alpha: (i: number) => number) =>
    d.x
      .map((_, i) => {
        const c = i % d.cols;
        const r = Math.floor(i / d.cols);
        return `<rect id="SCENEID-${prefix}${i}" x="${r3(c * cw + 1)}" y="${r3(r * chh + 1)}" width="${r3(cw - 2)}" height="${r3(chh - 2)}" fill="${heat}" opacity="${r3(alpha(i))}"/>`;
      })
      .join("");
  const outline = (i: number, k: number, pfx: string) => {
    const c = i % d.cols;
    const r = Math.floor(i / d.cols);
    return `<rect id="SCENEID-${pfx}${k}" x="${r3(c * cw - 3)}" y="${r3(r * chh - 3)}" width="${r3(cw + 6)}" height="${r3(chh + 6)}" fill="none" stroke="${tones[k]}" stroke-width="6"/>`;
  };
  // Traces: one row per witness.
  const rowH = (H - top) / 3;
  // Room for the threshold's word at the right, as wide as the plan's word is.
  const plotW = bw - Math.max(190, widthOf(lab("threshold"), SMALL, theme) + 40);
  const vmax = 1.6 * d.theta;
  const stepW = plotW / d.steps;
  const rowY = (k: number) => top + k * rowH;
  const vy = (k: number, v: number) =>
    r3(rowY(k) + rowH - 26 - (Math.min(v, vmax) / vmax) * (rowH - 70));
  const tracePath = (k: number, pre: number[], post: number[]) => {
    let p = `M0 ${vy(k, 0)}`;
    pre.forEach((v, s) => {
      const x0 = r3(s * stepW);
      const x1 = r3((s + 1) * stepW);
      // Between steps the potential holds; at a step it jumps to `pre`, then resets to `post`.
      p += ` L${x0} ${vy(k, s === 0 ? 0 : (post[s - 1] as number))} L${r3(x0 + stepW * 0.15)} ${vy(k, v)}`;
      if ((post[s] as number) !== v) p += ` L${r3(x0 + stepW * 0.15)} ${vy(k, post[s] as number)}`;
      p += ` L${x1} ${vy(k, post[s] as number)}`;
    });
    return p;
  };
  const dotY = (k: number) => r3(rowY(k) + 22);
  const traces = d.witnesses
    .map((wt, k) => {
      const ty = vy(k, d.theta);
      const dots = wt.spikes
        .map(
          (s) =>
            `<circle id="SCENEID-dot${k}-${s}" cx="${r3(s * stepW + stepW * 0.15)}" cy="${dotY(k)}" r="11" fill="${tones[k]}"/>`,
        )
        .join("");
      return `<g id="SCENEID-row${k}">
<line x1="0" y1="${r3(rowY(k) + rowH - 26)}" x2="${plotW}" y2="${r3(rowY(k) + rowH - 26)}" stroke="${theme.rule}" stroke-width="2"/>
<line x1="0" y1="${ty}" x2="${plotW}" y2="${ty}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="12 10"/>
<rect x="-14" y="${r3(rowY(k) + 14)}" width="8" height="${r3(rowH - 40)}" fill="${tones[k]}"/>
<g clip-path="url(#SCENEID-clip${k})"><path d="${tracePath(k, wt.pre, wt.post)}" fill="none" stroke="${tones[k]}" stroke-width="5" stroke-linejoin="round"/></g>
${dots}
</g>`;
    })
    .join("");
  const weak = d.witnesses[2];
  const ghost = weak
    ? (() => {
        const run = weak.noLeak;
        let p = `M0 ${vy(2, 0)}`;
        run.pre.forEach((v, s) => {
          const x0 = r3(s * stepW);
          p += ` L${x0} ${vy(2, s === 0 ? 0 : (run.post[s - 1] as number))} L${r3(x0 + stepW * 0.15)} ${vy(2, v)}`;
          if ((run.post[s] as number) !== v)
            p += ` L${r3(x0 + stepW * 0.15)} ${vy(2, run.post[s] as number)}`;
          p += ` L${r3((s + 1) * stepW)} ${vy(2, run.post[s] as number)}`;
        });
        const gd = run.spikes
          .map(
            (s) =>
              `<circle cx="${r3(s * stepW + stepW * 0.15)}" cy="${dotY(2)}" r="10" fill="none" stroke="${tones[2]}" stroke-width="4"/>`,
          )
          .join("");
        return `<g id="SCENEID-ghost"><g clip-path="url(#SCENEID-clipg)"><path d="${p}" fill="none" stroke="${tones[2]}" stroke-width="4" stroke-dasharray="10 9" opacity="0.85"/></g>${gd}</g>`;
      })()
    : "";
  const clips = [0, 1, 2]
    .map(
      (k) =>
        `<clipPath id="SCENEID-clip${k}"><rect id="SCENEID-cr${k}" x="-4" y="${r3(rowY(k))}" width="${r3(plotW + 8)}" height="${r3(rowH)}"/></clipPath>`,
    )
    .join("");
  const thetaY = vy(0, d.theta);
  const markup = `<div id="SCENEID-lit">
${label("a-label", lab("features"), ax, 0, LABEL, theme.fg)}
<div class="lit-panel" style="left:${px(ax)};top:${px(top)};width:${px(pw)};height:${px(ph)}">
<img id="SCENEID-photo" src="${href(L.files.hazy as string)}" style="left:0;top:0;width:${px(pw)};height:${px(ph)}" alt="">
<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" style="left:0;top:0"><rect id="SCENEID-shade" width="${pw}" height="${ph}" fill="#0d1014"/><g id="SCENEID-heat">${cellRects("h", (i) => d.x[i] as number)}</g>${d.witnesses.map((wt, k) => outline(wt.cell, k, "oa")).join("")}</svg>
</div>
${label("b-label", lab("membrane"), bx, 0, LABEL, theme.fg)}
<svg id="SCENEID-traces" width="${bw}" height="${H}" viewBox="0 0 ${bw} ${H}" style="left:${px(bx)};top:0">
<defs>${clips}<clipPath id="SCENEID-clipg"><rect id="SCENEID-crg" x="-4" y="${r3(rowY(2))}" width="${r3(plotW + 8)}" height="${r3(rowH)}"/></clipPath></defs>
${traces}
${ghost}
<line id="SCENEID-head" x1="0" y1="${top}" x2="0" y2="${H - 10}" stroke="${theme.fg}" stroke-width="3" opacity="0.6"/>
</svg>
${label("theta", lab("threshold"), bx + plotW + 18, thetaY - 26, SMALL, theme.fg)}
${label("ghost-label", lab("noLeak"), bx + plotW - widthOf(lab("noLeak"), SMALL, theme), vy(2, d.theta) - 62, SMALL, tones[2] as string)}
${label("c-label", lab("output"), ax, cyp - 56, LABEL, theme.fg)}
<div id="SCENEID-cpanel" class="lit-panel lit-dark" style="left:${px(ax)};top:${px(cyp)};width:${px(pw)};height:${px(ph)}">
<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" style="left:0;top:0">${cellRects("c", () => 0)}${d.witnesses.map((wt, k) => outline(wt.cell, k, "oc")).join("")}</svg>
</div>
</div>`;
  const [c0, c1, c2] = [
    cues[0] ?? { t0: 0.8, t1: 7 },
    cues[1] ?? { t0: 8, t1: 15 },
    cues[2] ?? { t0: 16, t1: 21 },
  ];
  const tl = new Tl();
  // Cue 1: the features the hazy picture gives, and three of its cells as neurons.
  tl.show("a-label", 0.1);
  tl.show("photo", 0.1, 0.5);
  tl.fromTo(
    "shade",
    { opacity: 0 },
    { opacity: 0.85, duration: 0.8, ease: "power2.out" },
    c0.t0 + 0.2,
  );
  tl.show("heat", c0.t0 + 0.4, 0.9);
  d.witnesses.forEach((_, k) => {
    tl.show(`oa${k}`, c0.t0 + 1.4 + k * 0.25, 0.4);
    tl.show(`row${k}`, c0.t0 + 1.6 + k * 0.25, 0.5);
    tl.fromTo(`cr${k}`, { attr: { width: 0 } }, { attr: { width: 0 }, duration: 0.01 }, 0);
  });
  tl.show("b-label", c0.t0 + 1.4);
  tl.show("theta", c0.t0 + 1.9);
  tl.show("c-label", c0.t0 + 2.2);
  tl.show("cpanel", c0.t0 + 2.2);
  for (let k = 0; k < d.witnesses.length; k++) tl.show(`oc${k}`, c0.t0 + 2.3, 0.4);
  // The time steps: the head sweeps, the potentials integrate, leak and fire.
  const s0 = c0.t0 + 2.6;
  const s1 = Math.max(s0 + d.steps * 0.75, Math.min(c1.t0 + 4.5, c1.t1 - 0.4));
  const span = s1 - s0;
  tl.fromTo("head", { x: 0, opacity: 0 }, { x: 0, opacity: 0.6, duration: 0.3 }, s0 - 0.3);
  tl.fromTo("head", { x: 0 }, { x: plotW, duration: span, ease: "none" }, s0);
  for (let k = 0; k < 3; k++)
    tl.fromTo(
      `cr${k}`,
      { attr: { width: 0 } },
      { attr: { width: plotW + 8 }, duration: span, ease: "none" },
      s0,
    );
  const stepAt = (s: number) => s0 + ((s + 0.15) / d.steps) * span;
  d.witnesses.forEach((wt, k) => {
    for (const s of wt.spikes) {
      tl.fromTo(
        `dot${k}-${s}`,
        { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.2, ease: "back.out(2)" },
        stepAt(s),
      );
    }
  });
  // The next layer receives only spikes: each output cell lights, step by step, to what its
  // spikes carried — on the INPUT's scale, so a cell is never brighter than what it was given.
  d.counts.forEach((n, i) => {
    if (n === 0) return;
    tl.fromTo(
      `c${i}`,
      { opacity: 0 },
      { opacity: d.out[i] as number, duration: span, ease: `steps(${n})` },
      s0,
    );
  });
  tl.fromTo("head", { opacity: 0.6 }, { opacity: 0, duration: 0.4 }, s1 + 0.1);
  // Cue 3: the leak. The weak cell's input, kept without leaking, would have crossed.
  tl.fromTo("ghost", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("ghost-label", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("crg", { attr: { width: 0 } }, { attr: { width: 0 }, duration: 0.01 }, 0);
  const g0 = Math.max(s1 + 0.6, c2.t0 + 0.3);
  tl.fromTo("ghost", { opacity: 0 }, { opacity: 1, duration: 0.4 }, g0);
  tl.fromTo(
    "crg",
    { attr: { width: 0 } },
    { attr: { width: plotW + 8 }, duration: 2.6, ease: "none" },
    g0,
  );
  tl.show("ghost-label", g0 + 0.3);
  return { markup, css: baseCss(theme), script: tl.script };
}

export const spikesKind: KindImpl = {
  picture: true,
  layers: ({ image, dir, beatId, region }) =>
    spikeLayers(image as string, dir, beatId, layout(region.width, region.height)),
  fragment: (L, region, cues, spec, theme, href) =>
    spikeFragment(L, layout(region.width, region.height), cues, spec, theme, href),
};

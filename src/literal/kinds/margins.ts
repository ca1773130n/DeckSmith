/**
 * margins — results against the best OTHER method, as positions: each setting
 * (a dataset, a split) placed by its margin on one metric (a strip) or two (a
 * plane), zero being "level with the best other method". Where the method leads
 * and where it trails is then a place on screen, not a cell to read.
 *
 * EXACT ARITHMETIC ON THE SOURCE'S NUMBERS. The plan gives, per setting and
 * metric, the method's value, the best other method's value and its name, as
 * the source states them (the truth gate holds every one to the source); the
 * margin is their difference, signed so that positive is better, printed with
 * as many decimals as the values carry. Each axis is scaled to its own largest
 * margin, which the `scaled` slot says on screen. No dataset picture is drawn:
 * a source without one has none to show, and none is made up.
 */
import { type KindImpl, LAB_H, lab, spread, stepStarts, widthOf, wrap } from "../kind.js";
import { baseCss, esc, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

export interface MarginsData {
  ours: string;
  metrics: Array<{ name: string; lowerIsBetter: boolean }>;
  settings: Array<{
    name: string;
    values: Array<{ ours: string; best: string; rival: string }>;
  }>;
}

export interface Margin {
  /** Positive: the method is better than the best other method on this metric. */
  gap: number;
  /** The gap as printed: signed, with the values' own decimals. */
  text: string;
}

const decimals = (v: string) => (v.split(".")[1] ?? "").length;

/** One margin: ours − best (best − ours when lower is better), at the values' precision. */
export function marginOf(ours: string, best: string, lowerIsBetter: boolean): Margin {
  const a = Number(ours);
  const b = Number(best);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    throw new Error(
      `literal: margins needs numbers as the source writes them, got "${ours}" and "${best}"`,
    );
  const k = Math.max(decimals(ours), decimals(best));
  const gap = Number(((lowerIsBetter ? b - a : a - b) as number).toFixed(k));
  const text = `${gap > 0 ? "+" : gap < 0 ? "−" : "±"}${Math.abs(gap).toFixed(k)}`;
  return { gap, text };
}

/** Every setting's margins, metric by metric; refuses a setting with the wrong number of values. */
export function marginsOf(d: MarginsData): Margin[][] {
  if (d.metrics.length < 1 || d.metrics.length > 2)
    throw new Error(`literal: margins draws one or two metrics, got ${d.metrics.length}`);
  if (d.settings.length < 2)
    throw new Error("literal: margins needs at least two settings to place against each other");
  return d.settings.map((s) => {
    if (s.values.length !== d.metrics.length)
      throw new Error(
        `literal: margins setting "${s.name}" gives ${s.values.length} value(s) for ${d.metrics.length} metric(s)`,
      );
    return s.values.map((v, m) =>
      marginOf(v.ours, v.best, (d.metrics[m] as MarginsData["metrics"][number]).lowerIsBetter),
    );
  });
}

/** Each axis's half-range: its largest |margin|, with room so no point sits on the frame. */
export function axisSpan(margins: readonly Margin[][], m: number): number {
  const top = Math.max(...margins.map((r) => Math.abs((r[m] as Margin).gap)));
  return top > 0 ? top * 1.18 : 1;
}

export const marginsKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const K = "margins";
    const d = spec.data as MarginsData;
    const M = marginsOf(d);
    const two = d.metrics.length === 2;
    const n = d.settings.length;
    const ahead = lab(K, spec, "ahead");
    const behind = lab(K, spec, "behind");
    const zero = lab(K, spec, "zero");
    const scaled = lab(K, spec, "scaled");
    // The readout column: the spoken setting's own numbers, as the source states them — the
    // margin, then the method's value, then the best other method's, each wrapped to the column.
    const readW = Math.max(
      420,
      ...d.settings.flatMap((s) =>
        s.values.flatMap((v) => [
          widthOf(`${d.ours} ${v.ours}`, SMALL, theme),
          widthOf(`${v.rival} ${v.best}`, SMALL, theme),
        ]),
      ),
    );
    const rw = Math.min(readW, W * 0.34);
    const scaledLines = wrap(scaled, SMALL, W - rw - 64, theme);
    const footH = scaledLines.length * 50 + 10;
    const pw = W - rw - 64;
    const ph = H - footH;
    const span = d.metrics.map((_, m) => axisSpan(M, m));
    const tone = (g: Margin[]) =>
      g.every((x) => x.gap > 0)
        ? theme.accent
        : g.every((x) => x.gap < 0)
          ? theme.muted
          : theme.tones.b;
    const metricW = (m: number) => widthOf(d.metrics[m]?.name ?? "", SMALL, theme);
    // Plane: x = the first metric's margin, y = the second's. Strip: one row per setting.
    const cx = pw / 2;
    const cy = two ? ph / 2 : ph / 2;
    const xOf = (g: number) => r3(cx + (g / (span[0] as number)) * (pw / 2 - 40));
    const yOf = (g: number) => r3(cy - (g / (span[1] ?? 1)) * (ph / 2 - 60));
    const rowH = Math.min(120, (ph - LAB_H * 2) / n);
    const rowY = (i: number) => r3(LAB_H * 1.5 + (i + 0.5) * rowH);
    const point = (i: number): [number, number] => {
      const g = M[i] as Margin[];
      return two
        ? [xOf((g[0] as Margin).gap), yOf((g[1] as Margin).gap)]
        : [xOf((g[0] as Margin).gap), rowY(i)];
    };
    // Axes and the zero lines: level with the best other method.
    const axes = two
      ? `<line x1="0" y1="${r3(cy)}" x2="${r3(pw)}" y2="${r3(cy)}" stroke="${theme.fg}" stroke-width="3"/>
<line x1="${r3(cx)}" y1="0" x2="${r3(cx)}" y2="${r3(ph)}" stroke="${theme.fg}" stroke-width="3"/>
<rect x="${r3(cx)}" y="0" width="${r3(pw / 2)}" height="${r3(cy)}" fill="${theme.accent}" opacity="0.08"/>
<rect x="0" y="${r3(cy)}" width="${r3(cx)}" height="${r3(ph - cy)}" fill="${theme.muted}" opacity="0.08"/>`
      : `<line x1="${r3(cx)}" y1="${LAB_H}" x2="${r3(cx)}" y2="${r3(ph)}" stroke="${theme.fg}" stroke-width="3"/>
<rect x="${r3(cx)}" y="${LAB_H}" width="${r3(pw / 2)}" height="${r3(ph - LAB_H)}" fill="${theme.accent}" opacity="0.08"/>
<rect x="0" y="${LAB_H}" width="${r3(cx)}" height="${r3(ph - LAB_H)}" fill="${theme.muted}" opacity="0.08"/>${d.settings
          .map(
            (_, i) =>
              `<line x1="0" y1="${rowY(i)}" x2="${r3(pw)}" y2="${rowY(i)}" stroke="${theme.rule}" stroke-width="2"/>`,
          )
          .join("")}`;
    const guides = d.settings
      .map((_, i) => {
        const [x, y] = point(i);
        return two
          ? `<g id="SCENEID-gd${i}"><line x1="${x}" y1="${r3(cy)}" x2="${x}" y2="${y}" stroke="${theme.fg}" stroke-width="2" stroke-dasharray="6 8"/><line x1="${r3(cx)}" y1="${y}" x2="${x}" y2="${y}" stroke="${theme.fg}" stroke-width="2" stroke-dasharray="6 8"/></g>`
          : `<g id="SCENEID-gd${i}"><line x1="${r3(cx)}" y1="${y}" x2="${x}" y2="${y}" stroke="${tone(M[i] as Margin[])}" stroke-width="6"/></g>`;
      })
      .join("");
    const dots = d.settings
      .map((_, i) => {
        const [x, y] = point(i);
        return `<circle id="SCENEID-p${i}" cx="${x}" cy="${y}" r="15" fill="${tone(M[i] as Margin[])}"/>`;
      })
      .join("");
    // A point's name beside it: to its right, unless that runs off the plot.
    const names = d.settings
      .map((s, i) => {
        const [x, y] = point(i);
        const w = widthOf(s.name, SMALL, theme);
        const lx = two ? (x + 26 + w > pw ? x - 26 - w : x + 26) : x >= cx ? x + 26 : x - 26 - w;
        const ly = two ? y - 26 : y - 56;
        return label(`n${i}`, s.name, Math.max(0, lx), ly, SMALL, theme.fg);
      })
      .join("");
    const corner = two
      ? `${label("l-ahead", ahead, pw - widthOf(ahead, SMALL, theme) - 12, 10, SMALL, theme.accent)}
${label("l-behind", behind, 12, ph - 58, SMALL, theme.muted)}
${label("l-x", `${d.metrics[0]?.name ?? ""} →`, pw - metricW(0) - 60, cy + 10, SMALL, theme.fg)}
${label("l-y", `${d.metrics[1]?.name ?? ""} ↑`, cx + 14, 10, SMALL, theme.fg)}
${label("l-zero", zero, cx + 14, ph - 58, SMALL, theme.muted)}`
      : `${label("l-ahead", ahead, pw - widthOf(ahead, SMALL, theme) - 12, 0, SMALL, theme.accent)}
${label("l-behind", behind, 12, 0, SMALL, theme.muted)}
${label("l-zero", zero, cx - widthOf(zero, SMALL, theme) / 2, ph + 4 - LAB_H, SMALL, theme.muted)}
${label("l-x", `${d.metrics[0]?.name ?? ""}`, cx - metricW(0) / 2, LAB_H * 0.5, SMALL, theme.fg)}`;
    // The readout: per setting, its name, then per metric the margin and the two values it is made of.
    const rx = pw + 64;
    const readLines = d.settings.map((s, i) =>
      s.values.flatMap((v, m) => [
        ...wrap(
          `${d.metrics[m]?.name ?? ""}  ${(M[i] as Margin[])[m]?.text ?? ""}`,
          LABEL,
          rw,
          theme,
        ).map((t, j) => ({ t, big: true, first: j === 0 && m > 0 })),
        ...wrap(`${d.ours} ${v.ours}`, SMALL, rw, theme).map((t) => ({
          t,
          big: false,
          first: false,
        })),
        ...wrap(`${v.rival} ${v.best}`, SMALL, rw, theme).map((t) => ({
          t,
          big: false,
          first: false,
        })),
      ]),
    );
    const readout = d.settings
      .map((s, i) => {
        let y = 70;
        const html = (readLines[i] as Array<{ t: string; big: boolean; first: boolean }>)
          .map((ln, j) => {
            if (ln.first) y += 28;
            const at = y;
            y += ln.big ? 56 : 48;
            return `<div id="SCENEID-q${i}-${j}" class="lit-label" style="left:0;top:${px(at)};font-size:${ln.big ? LABEL : SMALL}px;color:${ln.big ? theme.fg : theme.muted};white-space:nowrap">${esc(ln.t)}</div>`;
          })
          .join("");
        if (y > H)
          throw new Error(
            `literal: margins' readout for "${s.name}" needs ${Math.ceil(y)}px and has ${H}px; shorten the method names`,
          );
        return `<div id="SCENEID-q${i}" style="position:absolute;left:${px(rx)};top:0;width:${px(rw)};height:${px(H)}">${label(`qn${i}`, s.name, 0, 0, LABEL, tone(M[i] as Margin[]))}${html}</div>`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
<svg id="SCENEID-plot" width="${r3(pw)}" height="${r3(ph)}" viewBox="0 0 ${r3(pw)} ${r3(ph)}" style="left:0;top:0">${axes}${guides}${dots}</svg>
${corner}
${names}
${readout}
${scaledLines.map((t, i) => label(`sc${i}`, t, 0, ph + 10 + i * 50, SMALL, theme.muted)).join("")}
</div>`;
    const at = stepStarts(cues, n);
    const end = cues[cues.length - 1]?.t1 ?? (at[n - 1] as number) + 7;
    const tl = new Tl();
    tl.show("plot", 0.1, 0.6);
    for (const id of ["l-ahead", "l-behind", "l-x", "l-zero", ...(two ? ["l-y"] : [])])
      tl.show(id, 0.4, 0.5);
    for (let i = 0; i < scaledLines.length; i++) tl.show(`sc${i}`, 0.8);
    for (let i = 0; i < n; i++) {
      tl.fromTo(`p${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      tl.fromTo(`gd${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      tl.fromTo(`q${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    }
    // One setting per sentence: its point lands where its margins put it, the guides tie it to
    // the axes, and its numbers are read out line by line while it is said. The settings
    // already placed stay, quieter, so the pattern builds up.
    d.settings.forEach((s, i) => {
      const t0 = Math.max(1.0, (at[i] as number) + 0.2);
      const t1 = (at[i + 1] as number | undefined) ?? end;
      tl.fromTo(
        `p${i}`,
        { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.5, ease: "back.out(2)" },
        t0,
      );
      tl.show(`n${i}`, t0 + 0.3, 0.4);
      tl.fromTo(`gd${i}`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, t0 + 0.4);
      tl.fromTo(`q${i}`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, t0 + 0.2);
      const lines = (readLines[i] as unknown[]).length;
      for (let j = 0; j < lines; j++)
        tl.fromTo(`q${i}-${j}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      spread(t0 + 0.7, t1, lines, 0.5, 1.8, 1.4).forEach((t, j) => {
        tl.fromTo(`q${i}-${j}`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, t);
      });
      if (i > 0) {
        tl.fromTo(`q${i - 1}`, { opacity: 1 }, { opacity: 0, duration: 0.3 }, t0);
        tl.fromTo(`gd${i - 1}`, { opacity: 1 }, { opacity: 0.35, duration: 0.5 }, t0);
      }
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/**
 * table — numbers and claims the source reports, cited, rows lit in spoken
 * order, winning or missing cells marked.
 */
import { type KindImpl, LAB_H, lab, stepStarts, widthOf, wrap } from "../kind.js";
import { baseCss, esc, LABEL, label, px, SMALL, Tl } from "../kit.js";

interface TableData {
  columns: string[];
  rows: string[][];
  highlight: number[];
  marks: Array<{ row: number; col: number }>;
}

/**
 * Which rows light on which step: spoken order, spread over the cues when there
 * are more rows than cues — the LATER steps take the extra rows, since a
 * narration names its point first and then elaborates.
 */
export function rowSteps(highlight: readonly number[], cues: number): number[][] {
  const len = highlight.length;
  const n = Math.min(Math.max(1, cues), Math.max(1, len));
  const out: number[][] = Array.from({ length: n }, () => []);
  highlight.forEach((r, i) => {
    const k = n - 1 - Math.floor(((len - 1 - i) * n) / len);
    (out[k] as number[]).push(r);
  });
  return out;
}

/**
 * Column widths that fit `W`: water-filling from the narrowest column, so a
 * short column keeps its natural width and only the widest ones wrap.
 */
export function fitColumns(natural: readonly number[], W: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= W) return natural.map((w) => w + (W - total) / natural.length);
  const widths = new Array<number>(natural.length).fill(0);
  let avail = W;
  let left = natural.length;
  const order = natural.map((w, j) => [w, j] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [w, j] of order) {
    const share = avail / left;
    widths[j] = Math.min(w, share);
    avail -= widths[j] as number;
    left--;
  }
  return widths;
}

export const tableKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const t = spec.data as TableData;
    const size = LABEL;
    const head = SMALL;
    const padX = 24;
    const lineH = Math.round(size * 1.25);
    const natural = t.columns.map(
      (c, j) =>
        Math.max(widthOf(c, head, theme), ...t.rows.map((r) => widthOf(r[j] ?? "", size, theme))) +
        2 * padX,
    );
    const widths = fitColumns(natural, W);
    const xs = widths.map((_, j) => widths.slice(0, j).reduce((a, b) => a + b, 0));
    const linesOf = (text: string, j: number, sz: number) =>
      wrap(text, sz, (widths[j] as number) - 2 * padX, theme);
    const caption = lab("table", spec, "caption");
    const capH = caption ? 90 : 0;
    const headLines = Math.max(...t.columns.map((c, j) => linesOf(c, j, head).length));
    const bodyLines = t.rows.map((r) => Math.max(...r.map((c, j) => linesOf(c, j, size).length)));
    const content = headLines * lineH + bodyLines.reduce((a, b) => a + b, 0) * lineH;
    // Rows breathe to fill the region (quiet, not crammed), within limits — and never past its
    // bottom: a table that cannot fit even unpadded is refused, not drawn under its caption.
    const room = H - content - capH;
    if (room < 2 * 4 * (t.rows.length + 1))
      throw new Error(
        `literal: the table needs ${Math.ceil(content + capH)}px and the scene has ${Math.floor(H)}px; shorten its cells or split it`,
      );
    const pad = Math.max(
      4,
      Math.min(44, Math.min(H * 0.86 - content - capH, room) / (2 * (t.rows.length + 1))),
    );
    const headH = headLines * lineH + 2 * pad;
    const bodyH = bodyLines.map((n) => n * lineH + 2 * pad);
    const lit = new Set(t.highlight);
    const isMarked = (i: number, j: number) => t.marks.some((m) => m.row === i && m.col === j);
    // One cell's lines in a box of its own, so a mark can change the cell's colour as a whole.
    const cell = (
      id: string,
      text: string,
      j: number,
      y: number,
      h: number,
      color: string,
      sz: number,
      weight = 600,
    ) => {
      const lines = linesOf(text, j, sz);
      const top = y + (h - lines.length * lineH) / 2;
      return `<div id="SCENEID-${id}" style="position:absolute;left:0;top:0;width:100%;height:100%">${lines
        .map(
          (ln, i) =>
            `<div class="lit-label" style="left:${px((xs[j] as number) + padX)};top:${px(top + i * lineH + (lineH - sz * 1.15) / 2)};font-size:${sz}px;color:${color};font-weight:${weight}">${esc(ln)}</div>`,
        )
        .join("")}</div>`;
    };
    const y0 = 0;
    const headRow = t.columns
      .map((c, j) => cell(`h${j}`, c, j, y0, headH, theme.muted, head))
      .join("");
    let y = y0 + headH;
    const bodies: string[] = [];
    t.rows.forEach((r, i) => {
      const h = bodyH[i] as number;
      const cells = r
        .map((c, j) => {
          // A mark on a row that is never spoken is emphasised from the start; on a spoken
          // row, the cell turns to the accent when the row is spoken — a colour, not a box.
          if (!isMarked(i, j)) return cell(`c${i}-${j}`, c, j, y, h, theme.fg, size);
          if (!lit.has(i)) return cell(`c${i}-${j}`, c, j, y, h, theme.accent, size, 700);
          return `${cell(`c${i}-${j}`, c, j, y, h, theme.fg, size)}${cell(`k${i}-${j}`, c, j, y, h, theme.accent, size, 700)}`;
        })
        .join("");
      bodies.push(
        `<div id="SCENEID-band${i}" style="position:absolute;left:0;top:${px(y)};width:${px(W)};height:${px(h)};background:${theme.rule}"></div><div id="SCENEID-row${i}" style="position:absolute;left:0;top:0;width:100%;height:100%">${cells}</div><div style="position:absolute;left:0;top:${px(y + h)};width:${px(W)};height:2px;background:${theme.rule}"></div>`,
      );
      y += h;
    });
    const markup = `<div id="SCENEID-lit">
<div id="SCENEID-head" style="position:absolute;left:0;top:0;width:100%;height:100%">${headRow}<div style="position:absolute;left:0;top:${px(y0 + headH - 2)};width:${px(W)};height:3px;background:${theme.fg}"></div></div>
${bodies.join("\n")}
${caption ? label("cap", caption, 0, y + Math.min(30, (capH - LAB_H) / 2 + 10), SMALL, theme.muted) : ""}
</div>`;
    const steps = rowSteps(t.highlight, cues.length);
    const at = stepStarts(cues, steps.length);
    const tl = new Tl();
    tl.show("head", 0.1, 0.5);
    // The whole table is there from the start, quiet; a row comes forward when it is spoken.
    t.rows.forEach((_, i) => {
      tl.fromTo(
        `row${i}`,
        { opacity: 0 },
        { opacity: lit.has(i) ? 0.4 : 1, duration: 0.6 },
        0.3 + i * 0.08,
      );
      tl.fromTo(`band${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      if (lit.has(i))
        for (const m of t.marks.filter((mm) => mm.row === i))
          tl.fromTo(`k${i}-${m.col}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    });
    if (caption) tl.show("cap", 0.6);
    steps.forEach((rows, s) => {
      const t0 = Math.max(0.3 + t.rows.length * 0.08 + 0.7, (at[s] as number) + 0.2);
      for (const i of rows) {
        tl.fromTo(
          `row${i}`,
          { opacity: 0.4 },
          { opacity: 1, duration: 0.6, ease: "power2.out" },
          t0,
        );
        tl.fromTo(`band${i}`, { opacity: 0 }, { opacity: 0.45, duration: 0.6 }, t0);
        for (const m of t.marks.filter((mm) => mm.row === i)) {
          tl.fromTo(`k${i}-${m.col}`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, t0 + 0.3);
          tl.fromTo(`c${i}-${m.col}`, { opacity: 1 }, { opacity: 0, duration: 0.6 }, t0 + 0.3);
        }
      }
      // The rows lit on the step before step back, so the spoken one leads.
      for (const i of steps[s - 1] ?? [])
        tl.fromTo(
          `band${i}`,
          { opacity: 0.45 },
          { opacity: 0, duration: 0.6, immediateRender: false },
          t0,
        );
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

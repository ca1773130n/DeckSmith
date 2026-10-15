/**
 * place, measure length — reported quantities as AREAS to scale. Never bars.
 *
 * Each item is a block whose area is its value on one shared scale, drawn whole
 * and faded in; nothing grows (the brief bans growing bars, and r2's "97M vs 6M"
 * drew two horizontal bars that read as a bar chart however they arrived). A
 * group of whole counts no larger than `UNITS_MAX` is drawn as that many unit
 * cells (35 tokens are 35 cells); any other group as squares whose sides go as
 * √value. A group's blocks sit on one baseline across the region's width, so the
 * scene fills its frame however unequal the values are, with each item's name
 * and value under its block.
 *
 * Squares: the smallest block's outline then slides onto the largest, so the two
 * are compared at one scale; with `tile` the quotient the source states is
 * printed beside it (`tileRatio`, the number the truth gate checks).
 */
import { type KindImpl, LAB_H, lab, stepStarts, widthOf } from "../kind.js";
import { tileRatio } from "../kinds-shared.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

interface ScaleData {
  groups: Array<{ label: string; unit: string; items: Array<{ label: string; value: string }> }>;
  tile: boolean;
}

/** A group of whole counts up to this is drawn as unit cells; larger values as squares. */
export const UNITS_MAX = 100;
const GAP = 56;
const CELL_GAP = 0.16;

type Group = ScaleData["groups"][number];

/** Whether a group is drawn as unit cells: every value a whole count, 1–UNITS_MAX. */
export const unitCells = (g: Group) =>
  g.items.every((it) => {
    const v = Number(it.value);
    return Number.isInteger(v) && v >= 1 && v <= UNITS_MAX;
  });

/** A count's cells as a near-square grid: columns and rows. */
const grid = (v: number) => {
  const cols = Math.ceil(Math.sqrt(v));
  return { cols, rows: Math.ceil(v / cols) };
};

/** place, measure length: reported quantities as areas to scale. */
export const lengthsForm: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const s = (spec.data as { lengths?: ScaleData }).lengths;
    if (!s) throw new Error("literal: place measure length needs `lengths`");
    for (const g of s.groups)
      for (const it of g.items)
        if (!(Number(it.value) > 0))
          throw new Error(`place length: "${it.label}" needs a positive value, got "${it.value}"`);
    const tones = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d];
    const caption = lab("place", spec, "caption");
    const capH = caption ? LAB_H : 0;
    const rowGap = 40;
    const rowH = (H - capH - (s.groups.length - 1) * rowGap) / s.groups.length;
    // Under each block: its name, then its value and unit.
    const textH = 2 * LAB_H + 8;
    const blockRoom = rowH - (LAB_H + 10) - textH - 12;
    if (blockRoom < 80)
      throw new Error(
        `place length: ${s.groups.length} group(s) leave ${Math.floor(blockRoom)}px for the blocks; use fewer groups`,
      );
    const parts: string[] = [];
    const plan: Array<{ squares: boolean; big: number; small: number; ratio?: string }> = [];
    s.groups.forEach((g, gi) => {
      const top = gi * (rowH + rowGap);
      const vals = g.items.map((it) => Number(it.value));
      const max = Math.max(...vals);
      const cells = unitCells(g);
      const textW = g.items.map((it) =>
        Math.max(widthOf(it.label, LABEL, theme), widthOf(`${it.value} ${g.unit}`, LABEL, theme)),
      );
      // The block sizes at scale k: a cell's side, or the largest square's side.
      const sizes = (k: number) =>
        vals.map((v) => {
          if (cells) {
            const { cols, rows } = grid(v);
            return { w: cols * k, h: rows * k };
          }
          const side = k * Math.sqrt(v / max);
          return { w: side, h: side };
        });
      const tallest = cells ? Math.max(...vals.map((v) => grid(v).rows)) : 1;
      let k = Math.min(cells ? 120 : blockRoom, blockRoom / tallest);
      const across = (kk: number) =>
        sizes(kk).reduce((a, b, i) => a + Math.max(b.w, textW[i] as number), 0) +
        (g.items.length - 1) * GAP;
      while (across(k) > W && k > 4) k *= 0.95;
      if (across(k) > W)
        throw new Error(
          `place length: the names and values of "${g.label}" are wider than the scene; shorten them or use fewer items`,
        );
      const sz = sizes(k);
      const colW = sz.map((b, i) => Math.max(b.w, textW[i] as number));
      // Across the whole width: first block at the left edge, last at the right.
      const free = W - colW.reduce((a, b) => a + b, 0);
      const gap = g.items.length > 1 ? free / (g.items.length - 1) : 0;
      const base = top + LAB_H + 10 + blockRoom;
      parts.push(label(`g${gi}`, `${g.label} (${g.unit})`, 0, top, LABEL, theme.fg));
      parts.push(
        `<div id="SCENEID-b${gi}" style="position:absolute;left:0;top:${px(base + 6)};width:${px(W)};height:3px;background:${theme.rule}"></div>`,
      );
      let x = g.items.length > 1 ? 0 : (W - (colW[0] as number)) / 2;
      g.items.forEach((it, i) => {
        const b = sz[i] as { w: number; h: number };
        const cw = colW[i] as number;
        const bx = x + (cw - b.w) / 2;
        const tone = tones[i % tones.length] as string;
        let block = "";
        if (cells) {
          const v = vals[i] as number;
          const { cols } = grid(v);
          const g0 = r3(k * CELL_GAP);
          for (let q = 0; q < v; q++) {
            const cx = bx + (q % cols) * k;
            // Filled from the baseline up, row by row.
            const cy = base - (Math.floor(q / cols) + 1) * k;
            block += `<div style="position:absolute;left:${px(cx)};top:${px(cy)};width:${px(k - g0)};height:${px(k - g0)};background:${tone};border-radius:${px(Math.min(6, k * 0.12))}"></div>`;
          }
        } else
          block = `<div style="position:absolute;left:${px(bx)};top:${px(base - b.h)};width:${px(b.w)};height:${px(b.h)};background:${tone};border-radius:6px"></div>`;
        parts.push(
          `<div id="SCENEID-i${gi}-${i}">${block}${label(`n${gi}-${i}`, it.label, x + (cw - widthOf(it.label, LABEL, theme)) / 2, base + 16, LABEL, theme.fg)}${label(`v${gi}-${i}`, `${it.value} ${g.unit}`, x + (cw - widthOf(`${it.value} ${g.unit}`, LABEL, theme)) / 2, base + 16 + LAB_H, LABEL, theme.muted)}</div>`,
        );
        x += cw + gap;
      });
      const iMax = vals.indexOf(max);
      const iMin = vals.indexOf(Math.min(...vals));
      const ratio = s.tile ? tileRatio(g.items) : undefined;
      if (!cells && g.items.length >= 2 && iMax !== iMin) {
        // The smallest square's outline, at its own place; it slides onto the largest.
        const small = sz[iMin] as { w: number };
        const xOf = (j: number) =>
          colW.slice(0, j).reduce((a, b) => a + b + gap, 0) +
          ((colW[j] as number) - (sz[j] as { w: number }).w) / 2;
        parts.push(
          `<div id="SCENEID-o${gi}" style="position:absolute;left:${px(xOf(iMin))};top:${px(base - small.w)};width:${px(small.w)};height:${px(small.w)};border:5px solid ${theme.fg};box-sizing:border-box;border-radius:6px"></div>`,
        );
        if (ratio) {
          // Beside the large square, on the side with room.
          const rw = widthOf(ratio, SMALL, theme);
          const right = xOf(iMax) + (sz[iMax] as { w: number }).w + 24;
          const rx = right + rw <= W ? right : Math.max(0, xOf(iMax) - 24 - rw);
          parts.push(label(`r${gi}`, ratio, rx, base - LAB_H, SMALL, theme.muted));
        }
        plan.push({
          squares: true,
          big: r3(xOf(iMax) - xOf(iMin)),
          small: iMin,
          ...(ratio ? { ratio } : {}),
        });
      } else {
        if (ratio) parts.push(label(`r${gi}`, ratio, 0, top + LAB_H + 10, SMALL, theme.muted));
        plan.push({ squares: false, big: 0, small: iMin, ...(ratio ? { ratio } : {}) });
      }
    });
    const markup = `<div id="SCENEID-lit">
${parts.join("\n")}
${caption ? label("cap", caption, 0, H - capH, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, s.groups.length);
    const ends = s.groups.map(
      (_, gi) => cues[gi + 1]?.t0 ?? cues[cues.length - 1]?.t1 ?? (at[gi] as number) + 8,
    );
    const tl = new Tl();
    s.groups.forEach((g, gi) => {
      // The first group is there as the scene opens: the narration names it at once.
      const t0 = gi === 0 ? 0.1 : (at[gi] as number) + 0.2;
      const end = ends[gi] as number;
      // Every group is on screen from the start, quiet, so the frame is full at every stop;
      // a later group comes forward when it is spoken.
      const parts = [`g${gi}`, `b${gi}`, ...g.items.map((_, i) => `i${gi}-${i}`)];
      if (gi === 0)
        for (const [j, id] of parts.entries()) tl.show(id, t0 + Math.max(0, j - 1) * 0.3, 0.6);
      else
        for (const [j, id] of parts.entries()) {
          tl.fromTo(id, { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, 0.6);
          tl.fromTo(
            id,
            { opacity: 0.35 },
            { opacity: 1, duration: 0.6, ease: "power2.out", immediateRender: false },
            t0 + Math.max(0, j - 1) * 0.3,
          );
        }
      const p = plan[gi] as (typeof plan)[number];
      const o0 = t0 + 1.2 + g.items.length * 0.3;
      if (p.squares) {
        // The outline appears on the small square, then slides onto the large one.
        const od = r3(Math.max(1.2, Math.min(2.6, (end - o0) * 0.4)));
        tl.show(`o${gi}`, o0, 0.4);
        tl.fromTo(
          `o${gi}`,
          { x: 0 },
          { x: p.big, duration: od, ease: "sine.inOut", immediateRender: false },
          o0 + 0.5,
        );
        if (p.ratio) tl.show(`r${gi}`, o0 + 0.6 + od, 0.6);
      } else if (p.ratio) tl.show(`r${gi}`, o0, 0.6);
    });
    if (caption) tl.show("cap", 1.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/**
 * scope — what a claim rests on and what lies outside it, as nested regions:
 * the innermost holds what the source shows results for, each ring out what it
 * shows less of (a qualitative comparison, a mention), the outermost what it
 * never tested. The datasets a paper evaluated, the limits of a conclusion and
 * the reach of a method are each a distance from the middle, not a row to read.
 *
 * Every word is the plan's (`rings`, inner to outer, each a label and its
 * items), held to the source by the truth gate. The layout is computed here,
 * measured in the deck's own face, and refuses a plan that cannot fit.
 */
import type { Theme } from "../../emit/kit.js";
import { type KindImpl, lab, spread, stepStarts, widthOf } from "../kind.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

export interface ScopeData {
  rings: Array<{ label: string; items: string[] }>;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chip: an item's words in a rounded box, laid in rows. */
export interface Chip {
  ring: number;
  item: number;
  x: number;
  y: number;
  w: number;
}

export interface ScopeLayout {
  boxes: Box[];
  chips: Chip[];
  labels: Array<{ x: number; y: number }>;
  captionY: number;
}

const CHIP_H = 64;
const CHIP_PAD = 22;
const CHIP_GAP = 16;
const INSET = 30;

/** Lay `widths` in rows of at most `maxW`, left to right; returns each chip's row and x. */
export function flow(widths: readonly number[], maxW: number): Array<{ row: number; x: number }> {
  const out: Array<{ row: number; x: number }> = [];
  let row = 0;
  let x = 0;
  for (const w of widths) {
    if (x > 0 && x + w > maxW) {
      row++;
      x = 0;
    }
    if (w > maxW)
      throw new Error(
        `literal: scope item is ${Math.ceil(w)}px wide, its ring ${Math.floor(maxW)}px`,
      );
    out.push({ row, x });
    x += w + CHIP_GAP;
  }
  return out;
}

/**
 * The nested regions, outermost first in `boxes[rings - 1]`: each ring's label
 * and chips in the band along the top of its region, the next ring inside it,
 * the innermost's chips centred in what is left. Throws when it cannot fit.
 */
export function scopeLayout(
  d: ScopeData,
  W: number,
  H: number,
  measure: (text: string, size: number) => number,
  captionH = 0,
): ScopeLayout {
  const R = d.rings.length;
  if (R < 2 || R > 4) throw new Error(`literal: scope draws two to four rings, got ${R}`);
  for (const r of d.rings)
    if (!r.items.length) throw new Error(`literal: scope ring "${r.label}" has no items`);
  const chipW = (t: string) => measure(t, SMALL) + 2 * CHIP_PAD;
  const boxes: Box[] = new Array(R);
  const chips: Chip[] = [];
  const labels: Array<{ x: number; y: number }> = new Array(R);
  let box: Box = { x: 0, y: 0, w: W, h: H - captionH };
  for (let r = R - 1; r >= 1; r--) {
    boxes[r] = box;
    const ring = d.rings[r] as ScopeData["rings"][number];
    labels[r] = { x: box.x + INSET, y: box.y + 16 };
    const inner = box.w - 2 * INSET;
    const pos = flow(ring.items.map(chipW), inner);
    const rows = (pos[pos.length - 1]?.row ?? 0) + 1;
    pos.forEach((p, i) => {
      chips.push({
        ring: r,
        item: i,
        x: box.x + INSET + p.x,
        y: box.y + 16 + 62 + p.row * (CHIP_H + CHIP_GAP),
        w: chipW(ring.items[i] as string),
      });
    });
    const band = 16 + 62 + rows * (CHIP_H + CHIP_GAP) + 10;
    box = { x: box.x + INSET, y: box.y + band, w: box.w - 2 * INSET, h: box.h - band - INSET };
  }
  boxes[0] = box;
  const core = d.rings[0] as ScopeData["rings"][number];
  labels[0] = { x: box.x + INSET, y: box.y + 16 };
  const inner = box.w - 2 * INSET;
  const pos = flow(core.items.map(chipW), inner);
  const rows = (pos[pos.length - 1]?.row ?? 0) + 1;
  const need = 16 + 62 + rows * (CHIP_H + CHIP_GAP) + 10;
  if (box.h < need || box.w < 200)
    throw new Error(
      `literal: scope's innermost ring needs ${Math.ceil(need)}px and has ${Math.floor(box.h)}px; shorten the items or use fewer rings`,
    );
  // The innermost's chips sit centred in its region, row by row.
  const rowW = (row: number) =>
    pos.reduce(
      (w, p, i) => (p.row === row ? Math.max(w, p.x + chipW(core.items[i] as string)) : w),
      0,
    );
  const top = box.y + 78 + (box.h - 78 - rows * (CHIP_H + CHIP_GAP)) / 2;
  pos.forEach((p, i) => {
    chips.push({
      ring: 0,
      item: i,
      x: box.x + (box.w - rowW(p.row)) / 2 + p.x,
      y: top + p.row * (CHIP_H + CHIP_GAP),
      w: chipW(core.items[i] as string),
    });
  });
  return { boxes, chips, labels, captionY: H - captionH + 6 };
}

/** How a ring is drawn: the core solid in the accent, the outermost dashed, between them solid and quiet. */
function ringStyle(r: number, R: number, theme: Theme) {
  if (r === 0)
    return { border: `4px solid ${theme.accent}`, fill: theme.accent, alpha: 0.1, ink: theme.fg };
  if (r === R - 1)
    return { border: `4px dashed ${theme.muted}`, fill: "none", alpha: 0, ink: theme.muted };
  return { border: `3px solid ${theme.muted}`, fill: theme.muted, alpha: 0.05, ink: theme.fg };
}

export const scopeKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const d = spec.data as ScopeData;
    const R = d.rings.length;
    const caption = lab("scope", spec, "caption");
    const L = scopeLayout(d, W, H, (t, s) => widthOf(t, s, theme), caption ? 56 : 0);
    const regions = L.boxes
      .map((b, r) => {
        const st = ringStyle(r, R, theme);
        const bg = st.fill === "none" ? "transparent" : st.fill;
        return `<div id="SCENEID-z${r}" style="position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};border:${st.border};border-radius:18px;box-sizing:border-box"><div style="position:absolute;inset:0;border-radius:14px;background:${bg};opacity:${st.alpha}"></div></div>`;
      })
      .reverse()
      .join("\n");
    // A ring's widening: an outline that grows out of the ring inside it to the ring's own edge.
    const ripples = L.boxes
      .map((b, r) =>
        r === 0
          ? ""
          : `<div id="SCENEID-zr${r}" style="position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};border:4px solid ${theme.fg};border-radius:18px;box-sizing:border-box"></div>`,
      )
      .join("");
    const names = d.rings
      .map((ring, r) => {
        const p = L.labels[r] as { x: number; y: number };
        return label(`zl${r}`, ring.label, p.x, p.y, LABEL, r === 0 ? theme.accent : theme.fg);
      })
      .join("\n");
    const chips = L.chips
      .map((c) => {
        const st = ringStyle(c.ring, R, theme);
        const text = d.rings[c.ring]?.items[c.item] ?? "";
        const border =
          c.ring === R - 1
            ? `3px dashed ${theme.muted}`
            : `3px solid ${c.ring === 0 ? theme.accent : theme.rule}`;
        return `<div id="SCENEID-c${c.ring}-${c.item}" style="position:absolute;left:${px(c.x)};top:${px(c.y)};width:${px(c.w)};height:${px(CHIP_H)};border:${border};border-radius:32px;box-sizing:border-box">${label(`ct${c.ring}-${c.item}`, text, CHIP_PAD - 3, (CHIP_H - 6 - SMALL * 1.15) / 2, SMALL, st.ink)}</div>`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
${regions}
${ripples}
${names}
${chips}
${caption ? label("cap", caption, 0, L.captionY, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, R);
    const end = cues[cues.length - 1]?.t1 ?? (at[R - 1] as number) + 6;
    const tl = new Tl();
    // Every region and its name are there from the start, quiet, so the frame is whole. Ring by
    // ring, from the middle out, on its sentence: the region comes forward — each ring after the
    // first WIDENING out of the one inside it, the scope reaching past what was shown — and its
    // items arrive one by one while it is spoken.
    for (let r = R - 1; r >= 0; r--) {
      const t = r3(0.2 + (R - 1 - r) * 0.15);
      tl.fromTo(`z${r}`, { opacity: 0 }, { opacity: 0.25, duration: 0.6 }, t);
      tl.fromTo(`zl${r}`, { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, t + 0.1);
      if (r > 0) tl.fromTo(`zr${r}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    }
    if (caption) tl.show("cap", 0.8);
    d.rings.forEach((ring, r) => {
      const t0 = Math.max(1.0, (at[r] as number) + 0.1);
      const t1 = (at[r + 1] as number | undefined) ?? end;
      let from = t0 + 0.6;
      if (r > 0) {
        const o = L.boxes[r] as Box;
        const i = L.boxes[r - 1] as Box;
        const grow = Math.max(1.5, Math.min(4, (t1 - t0) * 0.45));
        const origin = `${r3(i.x - o.x + i.w / 2)}px ${r3(i.y - o.y + i.h / 2)}px`;
        tl.fromTo(
          `zr${r}`,
          { opacity: 0.9, scaleX: r3(i.w / o.w), scaleY: r3(i.h / o.h), transformOrigin: origin },
          {
            opacity: 0,
            scaleX: 1,
            scaleY: 1,
            transformOrigin: origin,
            duration: grow,
            ease: "power2.inOut",
          },
          t0,
        );
        from = t0 + grow * 0.8;
      }
      tl.fromTo(
        `z${r}`,
        { opacity: 0.25 },
        { opacity: 1, duration: 0.6, ease: "power2.out" },
        from - 0.4,
      );
      tl.fromTo(`zl${r}`, { opacity: 0.35 }, { opacity: 1, duration: 0.5 }, from - 0.3);
      spread(from + 0.2, t1, ring.items.length, 0.4, 3.2, 1.0).forEach((t, i) => {
        tl.fromTo(
          `c${r}-${i}`,
          { opacity: 0, scale: 0.85, transformOrigin: "50% 50%" },
          {
            opacity: 1,
            scale: 1,
            transformOrigin: "50% 50%",
            duration: 0.45,
            ease: "back.out(1.6)",
          },
          t,
        );
      });
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

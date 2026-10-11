/**
 * scope — what a claim rests on and what lies outside it, as one region SPLIT
 * into side-by-side parts, from what the source shows results for (left), to
 * what it shows less of (only a qualitative comparison, only a mention), to what
 * it never tested (right). The parts exclude each other, so they are drawn
 * apart: an earlier version nested them as rings, which drew a dataset with
 * results INSIDE a region labelled "not shown" (review, 2026-10-11).
 *
 * Each part is a rule styled by its weight of evidence (solid in the accent,
 * solid and quiet, dashed), its label, and its items as words — no pills, which
 * read as a bulleted list of chips. Every word is the plan's (`rings`, most
 * evidence first, each a label and its items), held to the source by the truth
 * gate; the layout is computed here, measured in the deck's own face, and
 * refuses a plan that cannot fit.
 */
import type { Theme } from "../../emit/kit.js";
import { drift, type KindImpl, lab, REST, spread, stepStarts, widthOf } from "../kind.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";
import { wrapBy } from "./common.js";

export interface ScopeData {
  rings: Array<{ label: string; items: string[] }>;
}

/** One part of the split: its column, its label's lines, its items' lines and where they sit. */
export interface ScopePart {
  x: number;
  w: number;
  label: string[];
  items: Array<{ lines: string[]; y: number }>;
}

export interface ScopeLayout {
  parts: ScopePart[];
  /** Where the items start, under the rules and the labels. */
  top: number;
  captionY: number;
}

const GAP = 56;
const RULE_Y = 8;
const LABEL_LH = 54;
const ITEM_LH = 54;

/**
 * The split: 2–4 equal columns side by side, each its rule, its label and its
 * items stacked down the column with the room shared out between them, so a
 * short list still uses the height. Throws when a part cannot fit.
 */
export function scopeLayout(
  d: ScopeData,
  W: number,
  H: number,
  measure: (text: string, size: number) => number,
  captionH = 0,
): ScopeLayout {
  const R = d.rings.length;
  if (R < 2 || R > 4) throw new Error(`literal: scope draws two to four parts, got ${R}`);
  for (const r of d.rings)
    if (!r.items.length) throw new Error(`literal: scope part "${r.label}" has no items`);
  const w = Math.floor((W - (R - 1) * GAP) / R);
  if (w < 240) throw new Error(`literal: scope's parts would be ${w}px wide; use fewer`);
  const wrapTo = (t: string, size: number) => wrapIn(t, size, w, measure);
  const labels = d.rings.map((r) => wrapTo(r.label, LABEL));
  const top = RULE_Y + 30 + Math.max(...labels.map((l) => l.length)) * LABEL_LH + 36;
  const bottom = H - captionH - 8;
  const parts = d.rings.map((ring, k) => {
    const lines = ring.items.map((t) => wrapTo(t, LABEL));
    const need = lines.reduce((a, l) => a + l.length * ITEM_LH, 0);
    const room = bottom - top;
    if (need > room)
      throw new Error(
        `literal: scope part "${ring.label}" needs ${Math.ceil(need)}px for its items and has ${Math.floor(room)}px; shorten the items or give fewer`,
      );
    // The spare height between items, capped so a short list reads as a list, not scattered.
    const gap = Math.min(72, (room - need) / Math.max(1, lines.length));
    let y = top;
    const items = lines.map((l) => {
      const at = y;
      y += l.length * ITEM_LH + gap;
      return { lines: l, y: at };
    });
    return { x: k * (w + GAP), w, label: labels[k] as string[], items };
  });
  return { parts, top, captionY: H - captionH + 6 };
}

/** `wrapBy`, refusing a unit wider than the part: it would run into the next one. */
function wrapIn(
  text: string,
  size: number,
  maxW: number,
  measure: (t: string, s: number) => number,
): string[] {
  const lines = wrapBy(text, size, maxW, measure);
  for (const l of lines)
    if (measure(l, size) > maxW)
      throw new Error(
        `literal: scope's "${l}" is ${Math.ceil(measure(l, size))}px wide, its part ${Math.floor(maxW)}px`,
      );
  return lines.length ? lines : [""];
}

/** How a part's rule is drawn: by its weight of evidence, strongest first. */
function ruleStyle(k: number, R: number, theme: Theme) {
  if (k === 0) return { rule: `8px solid ${theme.accent}`, ink: theme.accent };
  if (k === R - 1) return { rule: `8px dashed ${theme.muted}`, ink: theme.muted };
  return { rule: `8px solid ${theme.muted}`, ink: theme.fg };
}

/** place, form sets: what a claim rests on and what lies outside it. */
export const setsForm: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const d = (spec.data as { sets?: ScopeData }).sets;
    if (!d) throw new Error("literal: place form sets needs `sets`");
    const R = d.rings.length;
    const caption = lab("place", spec, "caption");
    const L = scopeLayout(d, W, H, (t, s) => widthOf(t, s, theme), caption ? 56 : 0);
    const bottom = H - (caption ? 56 : 0) - 8;
    const parts = L.parts
      .map((p, k) => {
        const st = ruleStyle(k, R, theme);
        const name = p.label
          .map((t, j) => label(`zl${k}-${j}`, t, 0, RULE_Y + 30 + j * LABEL_LH, LABEL, st.ink))
          .join("");
        const items = p.items
          .map(
            (it, i) =>
              `<div id="SCENEID-c${k}-${i}" style="position:absolute;left:0;top:${px(it.y)};width:${px(p.w)};height:${px(it.lines.length * ITEM_LH)}">${it.lines
                .map((t, j) =>
                  label(
                    `ct${k}-${i}-${j}`,
                    t,
                    0,
                    j * ITEM_LH,
                    LABEL,
                    k === R - 1 ? theme.muted : theme.fg,
                  ),
                )
                .join("")}</div>`,
          )
          .join("");
        const divider =
          k > 0
            ? `<div style="position:absolute;left:${px(-GAP / 2 - 1)};top:0;width:2px;height:${px(bottom)};background:${theme.rule}"></div>`
            : "";
        return `<div id="SCENEID-z${k}" style="position:absolute;left:${px(p.x)};top:0;width:${px(p.w)};height:${px(bottom)}">${divider}<div id="SCENEID-zc${k}" style="position:absolute;left:0;top:0;width:100%;height:100%"><div style="position:absolute;left:0;top:${px(RULE_Y)};width:100%;height:0;border-top:${st.rule}"></div>${name}${items}</div></div>`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
${parts}
${caption ? label("cap", caption, 0, L.captionY, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, R);
    const end = cues[cues.length - 1]?.t1 ?? (at[R - 1] as number) + 6;
    const tl = new Tl();
    // Every part and its name are there from the start, quiet but legible, so the frame is
    // whole and the split is seen at once. Part by part, on its sentence, it comes forward and
    // its items arrive one by one while it is spoken; the part before steps back.
    const IDLE = 0.55;
    for (let k = 0; k < R; k++) {
      tl.fromTo(`z${k}`, { opacity: 0 }, { opacity: IDLE, duration: 0.6 }, r3(0.2 + k * 0.15));
      for (let i = 0; i < (d.rings[k]?.items.length ?? 0); i++)
        tl.fromTo(`c${k}-${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    }
    if (caption) tl.show("cap", 0.8);
    d.rings.forEach((ring, k) => {
      const t0 = Math.max(1.0, (at[k] as number) + 0.1);
      const t1 = (at[k + 1] as number | undefined) ?? end;
      tl.fromTo(`z${k}`, { opacity: IDLE }, { opacity: 1, duration: 0.6, ease: "power2.out" }, t0);
      if (k > 0) tl.fromTo(`z${k - 1}`, { opacity: 1 }, { opacity: 0.75, duration: 0.6 }, t0);
      const times = spread(t0 + 0.5, t1, ring.items.length, 0.6, 3.2, 1.0);
      // While the rest of its sentence is spoken, the camera leans in on the part: a slow
      // push-in, the only motion a short list has left once its items are all there.
      const last = (times[times.length - 1] as number) + 0.5;
      // From the part's top-left corner, so its first word never leaves the region.
      drift(tl, `zc${k}`, last, t1 - 0.1, { x: 0, y: 0, scale: 1.04 }, REST, "0% 0%");
      times.forEach((t, i) => {
        tl.fromTo(
          `c${k}-${i}`,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
          t,
        );
      });
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

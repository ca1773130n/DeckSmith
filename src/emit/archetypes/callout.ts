/**
 * Labelled panels side by side — the archetype for the things a paper does not
 * put in a figure: a contradiction between two tables, a caveat, a limit on what
 * was actually tested. Panels appear one at a time so each can be spoken to.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc, spotlighter } from "../kit.js";
import { wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  BODY_LH,
  BODY_SIZE,
  bodyBudget,
  chrome,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  noteCss,
  noteHeight,
  noteWidth,
  tween,
} from "./title.js";

const TONES = ["a", "b", "c"] as const;

/** Panel metrics. Named because the height cap below has to agree with the CSS. */
const PANEL_GAP = 44;
const PANEL_PAD_X = 40;
const PANEL_PAD_Y = 36;
const LABEL_SIZE = 50;
const LABEL_GAP = 24;
const LINE_TOP = 10;

export const callout: Emitter<"callout"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const panels = p.panels
    .map((panel, i) => {
      const colour = theme.tones[TONES[i] ?? "a"];
      const lines = panel.lines.map((l) => `<div class="pline">${esc(l)}</div>`).join("");
      return `<div class="panel" id="${sid}-p${i}" style="border-left-color:${colour}"><div class="plabel" style="color:${colour}">${esc(panel.label)}</div>${lines}</div>`;
    })
    .join("\n  ");

  // How tall the panels are *allowed* to grow.
  //
  // Letting them take the whole remaining box filled the canvas — 74% by the
  // measure — with two 500px boxes holding two lines each, which is emptier to
  // look at than the short panels it replaced. Fill is not the goal; a panel
  // whose air is proportional to its content is. So the cap is the content plus
  // a fifth, and whatever is left over goes back to the slide's margins where it
  // reads as air rather than as a hole inside a border. 1.5 was tried first and
  // still left 180px of empty panel under the last line.
  // Measured against the panel's own column, which is what `.panels`' grid gives
  // it — not against the content box, which is that column times the panel count.
  // The cap below is `max-height`, so an over-wide measure under-counts the lines
  // a panel wraps to, and the panels are then clipped by a cap too short for what
  // is inside them while the note lays out underneath the overflow. At 16:9 the
  // two agreed closely enough to look right; at 9:16 the column is 860/n wide and
  // the old measure was up to twice that.
  // PORTRAIT: one panel per row. Two panels across 860 gave each a 368px column,
  // and every line the demo puts in one — "PSNR-Y 28.10 → 30.28" — broke after the
  // arrow, so a table of four readings was set as eight half-lines. A comparison
  // reads down a phone just as well as it reads across a slide, and each row then
  // gets the whole measure, which is what stops the wrapping.
  // LANDSCAPE: side by side, which is what 1700px is for.
  const cols = isPortrait(ctx.format) ? 1 : p.panels.length;
  const box = contentW(ctx.format);
  const column = (box - PANEL_GAP * (cols - 1)) / cols;
  const inner = column - 2 * PANEL_PAD_X;
  const heights = p.panels.map((panel) => {
    const label = wrap(panel.label, LABEL_SIZE, inner, 600).length * LABEL_SIZE * 1.2;
    const body = panel.lines.reduce(
      (h, l) => h + wrap(l, BODY_SIZE, inner).length * BODY_SIZE * BODY_LH + LINE_TOP,
      0,
    );
    return 2 * PANEL_PAD_Y + label + LABEL_GAP + body;
  });
  // The cap is on `.panels`, which holds one row of n panels across or n rows of
  // one down. Across, the tallest panel is the row; down, the rows sum. Capping a
  // stack at the height of its tallest member clips every panel but that one, and
  // the note then lays out underneath the overflow rather than below it.
  const stackedH = heights.reduce((a, b) => a + b, 0) + PANEL_GAP * (heights.length - 1);
  // Across, the row is the tallest panel; down, the rows sum. This is the height
  // the panels ARE, before any slack.
  const need = cols === 1 ? stackedH : Math.max(...heights);
  // …and this is the height the slide has for them, which every other archetype
  // here asks for and this one did not. The cap below is derived from the content
  // alone, so it grows with the text and walks straight past the box: at 16:9,
  // three panels of four lines want 834px of a 693px box. `.panels` is
  // `flex:1;min-height:0`, so the BOX is clamped to the budget whatever the cap
  // says — the TEXT is what overflows, out through the panel's own border, over
  // the note, and off the bottom, where `.scene` clips it away silently.
  const budget = bodyBudget(
    ctx.format,
    p.eyebrow,
    p.headline,
    noteHeight(p.note, noteWidth(ctx.format)),
  );
  // Refused rather than clipped, and refused rather than shrunk: the body is
  // 44px against a 40px audience floor, which is 9% of a height that can be over
  // by 50%. A callout is the archetype for a caveat or a contradiction — a panel
  // needing eight lines is a beat that wanted to be two, and `onBeatError` is
  // what tells the caller so. Same contract as split-compare's own fit gate.
  if (need > budget) {
    throw new Error(
      `callout ${beat.id}: ${Math.round(need)}px of panel in a ${Math.round(budget)}px box — shorten the lines or split the beat`,
    );
  }
  // 1.22 of the TALLEST panel is ~120px of slack. 1.22 of a SUM is that times the
  // panel count, and two panels each carrying 130px of empty floor is the hole
  // inside a border this fraction was chosen to avoid. Same intent, applied to
  // the thing that is actually growing.
  const cap = Math.min(budget, Math.round(need * (cols === 1 ? 1.1 : 1.22)));

  const note = p.note ? `\n<div class="conote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, box)}
<div class="panels" style="grid-template-columns:repeat(${cols}, 1fr);max-height:${cap}px">
  ${panels}
</div>${note}`;

  const first = 0.8;
  const step = Math.min(0.9, Math.max(0.4, (beat.seconds - first - 1.6) / p.panels.length));
  const tl = [...chromeIn(sid, p.eyebrow !== undefined)];
  const holds: number[] = [];

  // Panels are read one at a time, so the one being read is the one at full
  // weight; the ones already made step back to DIM rather than competing.
  const spot = spotlighter(sid);

  p.panels.forEach((_, i) => {
    const at = first + i * step;
    tl.push(
      tween(`#${sid}-p${i}`, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55 }, at),
      // The panel's own contents arrive in reading order rather than as one
      // block: the label, then its lines a frame apart. A stagger inside the
      // panel costs no hold and is the difference between a card appearing and
      // a point being made.
      tween(
        `#${sid}-p${i} .pline`,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, immediateRender: false },
        at + 0.18,
      ),
    );
    if (i > 0) tl.push(...spot.dim(`p${i - 1}`, at + 0.15));
    holds.push(at + 0.65);
  });

  if (p.note) {
    const at = first + p.panels.length * step;
    tl.push(tween(`#${sid}-note`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }
  if (p.panels.length > 1) tl.push(...spot.restore(first + p.panels.length * step));

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Column count is set inline, so this block is identical for every callout
      // scene and the shell emits it once.
      //
      // `flex:1` + `align-items:stretch`: the panels were content-height, so two
      // three-line panels made a 250px band across the middle of a 912px box and
      // the slide measured 43% full. Growing into the box cannot overflow it —
      // a flex child only ever absorbs the space `.scene` already had spare, and
      // `.scene`'s `justify-content:center` becomes a no-op once nothing is
      // spare. That is the safe direction; a fixed panel height is not.
      `.panels{display:grid;gap:${PANEL_GAP}px;margin-top:34px;align-items:stretch;flex:1;min-height:0}`,
      `.panel{background:${theme.panel};border:1px solid ${theme.rule};border-left:6px solid ${theme.accent};border-radius:14px;padding:${PANEL_PAD_Y}px ${PANEL_PAD_X}px;font-size:${BODY_SIZE}px;line-height:${BODY_LH};color:${theme.fg}}`,
      // The label is the panel's headline, so it is sized as one rather than as
      // bold body copy that happens to sit on the first line.
      `.plabel{font-size:${LABEL_SIZE}px;line-height:1.2;font-weight:600;margin-bottom:${LABEL_GAP}px}`,
      `.pline{color:${theme.muted};margin-top:${LINE_TOP}px}`,
      noteCss("conote", theme),
      // The last panel's label — the panel that lands last is the one still being
      // spoken to at the final hold. Its label carries the panel's accent colour,
      // and no tween touches it: the entrance moves the panel around it.
      ...(p.panels.length === 0 ? [] : [ambient(sid, `-p${p.panels.length - 1} .plabel`, BREATHE)]),
    ].join("\n"),
  };
};

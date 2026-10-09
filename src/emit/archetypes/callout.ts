/**
 * Labelled panels side by side — the archetype for the things a paper does not
 * put in a figure: a contradiction between two tables, a caveat, a limit on what
 * was actually tested. Panels appear one at a time so each can be spoken to.
 */
import { EMPTY_BELOW, fitOf, growToFit, isV2, MEASURE_SLACK } from "../fit.js";
import type { Emitter } from "../kit.js";
import { esc, lift, settle, spotlighter } from "../kit.js";
import { frameOf, variantOf } from "../look.js";
import { faceOf, typeOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  BODY_LH,
  BODY_SIZE,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  noteCss,
  noteHeight,
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
/**
 * v2: how far a callout's TYPE may grow to meet its box. 1.4, under the fit
 * engine's 1.6, because this is running prose: 56px body copy is already a
 * headline's weight, and past it a panel stops reading as a panel.
 */
const TYPE_GROWTH = 1.4;
/** The panel's air over its content, from the cap below — the same 1.22 / 1.1. */
const AIR_ACROSS = 1.22;
const AIR_DOWN = 1.1;
/**
 * v2: grown body type never passes this share of the headline. Panel titles
 * grown to 70px under a 62px headline flipped the slide's hierarchy (ja s3,
 * s14, review 2026-10-08).
 */
const HEADLINE_CAP = 0.9;
/** `rows`: the label column's share of the box, the gutter beside it, and a row's air. */
const ROW_LABEL_SHARE = 0.32;
const ROW_GUTTER = 56;
const ROW_PAD_Y = 30;
/** How much of its box a `rows` table opens out to when its rows are short. */
const ROWS_FILL = 0.75;
/** `rows` is a table of short statements: past this many lines a panel wants its box. */
const ROW_MAX_LINES = 4;

export const callout: Emitter<"callout"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const face = faceOf(theme.fontStack);

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
  // `rows` (v2): each panel a row of a table — label left, lines right — so a
  // callout of short panels reads as a designed table across the slide instead
  // of short boxes with holes inside their borders (en s8, s15 measured ~0.4
  // full in the review of 2026-10-08).
  const rowsVariant = variantOf(ctx, "callout") === "rows";
  if (rowsVariant) {
    if (isPortrait(ctx.format) || p.panels.length < 2) {
      throw new Error(`callout ${beat.id}: rows need two panels or more on a wide slide`);
    }
    if (p.panels.some((panel) => panel.lines.length > ROW_MAX_LINES)) {
      throw new Error(
        `callout ${beat.id}: a panel of more than ${ROW_MAX_LINES} lines is not a table row`,
      );
    }
  }
  const cols = isPortrait(ctx.format) || rowsVariant ? 1 : p.panels.length;
  // The content box, or what the chosen placement leaves (src/emit/look.ts).
  const F = frameOf(ctx, { eyebrow: p.eyebrow, headline: p.headline, evidence: beat.evidence });
  const box = F.w;
  const column = (box - PANEL_GAP * (cols - 1)) / cols;
  const inner = column - 2 * PANEL_PAD_X;
  /** The two type sizes at scale `k`, floored so the CSS and this arithmetic agree to the px. */
  const sizes = (k: number) => ({
    label: Math.floor(LABEL_SIZE * k),
    body: Math.floor(BODY_SIZE * k),
  });
  /** `measure` under 1 is v2's conservative count — see `MEASURE_SLACK`. */
  const labelW = Math.round(box * ROW_LABEL_SHARE);
  const linesW = box - labelW - ROW_GUTTER;
  const needAt = (k: number, measure = 1) => {
    const { label: ls, body: bs } = sizes(k);
    if (rowsVariant) {
      return p.panels
        .map((panel) => {
          const label = wrap(panel.label, ls, labelW * measure, 600, 0, face).length * ls * 1.2;
          const body = panel.lines.reduce(
            (h, l) => h + wrap(l, bs, linesW * measure, 400, 0, face).length * bs * BODY_LH,
            0,
          );
          return Math.max(label, body) + 2 * ROW_PAD_Y;
        })
        .reduce((a, b) => a + b, 0);
    }
    const w = inner * measure;
    const heights = p.panels.map((panel) => {
      const label = wrap(panel.label, ls, w, 600, 0, face).length * ls * 1.2;
      const body = panel.lines.reduce(
        (h, l) => h + wrap(l, bs, w, 400, 0, face).length * bs * BODY_LH + LINE_TOP,
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
    return cols === 1 ? stackedH : Math.max(...heights);
  };
  const v2 = isV2(ctx);
  // …and this is the height the slide has for them, which every other archetype
  // here asks for and this one did not. The cap below is derived from the content
  // alone, so it grows with the text and walks straight past the box: at 16:9,
  // three panels of four lines want 834px of a 693px box. `.panels` is
  // `flex:1;min-height:0`, so the BOX is clamped to the budget whatever the cap
  // says — the TEXT is what overflows, out through the panel's own border, over
  // the note, and off the bottom, where `.scene` clips it away silently.
  const budget = F.budget(noteHeight(p.note, F.noteW, undefined, face));
  // Refused rather than clipped, and refused rather than shrunk: the body is
  // 44px against a 40px audience floor, which is 9% of a height that can be over
  // by 50%. A callout is the archetype for a caveat or a contradiction — a panel
  // needing eight lines is a beat that wanted to be two, and `onBeatError` is
  // what tells the caller so. Same contract as split-compare's own fit gate.
  const need1 = needAt(1);
  if (need1 > budget) {
    throw new Error(
      `callout ${beat.id}: ${Math.round(need1)}px of panel in a ${Math.round(budget)}px box — shorten the lines or split the beat`,
    );
  }
  // 1.22 of the TALLEST panel is ~120px of slack. 1.22 of a SUM is that times the
  // panel count, and two panels each carrying 130px of empty floor is the hole
  // inside a border this fraction was chosen to avoid. Same intent, applied to
  // the thing that is actually growing.
  // v2 takes the smaller air across too: its `need` is already counted at
  // MEASURE_SLACK, which over-predicts wrapping by ~8%, so 1.22 on top of it
  // left the bottom third of every panel blank (ko deck b09, 2026-10-09: three
  // panels to y≈655, their text ending at y≈445-500).
  const air = cols === 1 || v2 ? AIR_DOWN : AIR_ACROSS;
  // v2: the TYPE grows until the panels, with their air, meet the box — the
  // panel stays proportional to its content (the reason for the cap above) and
  // the content is what gets bigger. Checked only after classic's own refusal,
  // so v2 refuses exactly the beats classic does.
  const growth = Math.max(
    1,
    Math.min(TYPE_GROWTH, (HEADLINE_CAP * typeOf(face).headline.size) / LABEL_SIZE),
  );
  const k = v2 ? growToFit((x) => needAt(x, MEASURE_SLACK) * air, budget, 1, growth) : 1;
  const need = k === 1 ? need1 : needAt(k, MEASURE_SLACK);
  // A table's rows may take more air than a box's panels: the rules between them
  // are what hold a sparse table together, where air inside a border reads as a
  // hole. So short rows open out to `ROWS_FILL` of the box, their text centred.
  const cap = Math.min(
    budget,
    Math.round(rowsVariant ? Math.max(need * air, budget * ROWS_FILL) : need * air),
  );

  const note = p.note ? `\n<div class="conote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html =
    F.compose(`<div class="panels" style="grid-template-columns:repeat(${cols}, 1fr);max-height:${cap}px">
  ${panels}
</div>${note}`);

  const first = 0.8;
  const step = Math.min(0.9, Math.max(0.4, (beat.seconds - first - 1.6) / p.panels.length));
  const tl = [...chromeIn(sid, p.eyebrow !== undefined), ...F.tl];
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
    const emph = Math.min(0.4, step / 2);
    // v2: the last part's arrival brings everything back to full instead of
    // dimming its neighbour, so the slide's FINAL stop — the frame a paused
    // viewer, a contact sheet and the deck's last hold all show — is whole. The
    // restore below used to land after that stop, where only a render saw it
    // (en s3, three of four steps at 0.62 at #3.4; review 2026-10-08).
    if (i > 0) {
      const finale = v2 && i === p.panels.length - 1;
      if (!finale) tl.push(...spot.dim(`p${i - 1}`, at + 0.15));
      else if (i > 1) tl.push(...spot.restore(at + 0.15));
      if (!rowsVariant) tl.push(settle(`#${sid}-p${i - 1}`, at, emph));
    }
    // A table's rows do not stand proud: a lifted row is wider than the rules
    // of the rows around it, and the table reads as misaligned.
    if (!rowsVariant) tl.push(lift(`#${sid}-p${i}`, at, emph));
    holds.push(at + 0.65);
  });

  if (p.note) {
    const at = first + p.panels.length * step;
    tl.push(tween(`#${sid}-note`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }
  if (p.panels.length > 1 && !v2) tl.push(...spot.restore(first + p.panels.length * step));

  const grown = sizes(k);
  const region = F.budget(0, 0, 0);
  const noteH = noteHeight(p.note, F.noteW, undefined, face);

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    // `.panels` is `flex:1` under a `max-height` of `cap`, so it is exactly `cap`
    // tall whenever the box has that much; the note sits under it.
    ...(v2 ? { fit: fitOf(cap + noteH, region) } : {}),
    // What the Director scores looks on: how much of its box the panels'
    // CONTENT takes, with its air. Not `cap`: a `rows` table is opened out to
    // `ROWS_FILL` of the box whatever it holds, so `cap / budget` reported 0.75
    // for two two-line rows that left half the slide empty (ko deck b06,
    // 2026-10-09) and the Director preferred it for a fullness it did not have.
    ...(v2 ? { fill: Math.min(1, Math.round(((need * air) / budget) * 1000) / 1000) } : {}),
    ...(v2 && rowsVariant && (need * air) / budget < EMPTY_BELOW
      ? {
          warnings: [
            `callout ${beat.id}: the rows hold ${Math.round((100 * need * air) / budget)}% of their box and the table is opened out with air — give each row more to say, or draw the beat as another shape`,
          ],
        }
      : {}),
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
      // Scene-scoped: two callouts in one deck grow by different amounts, and the
      // shell emits each archetype's shared block once.
      // v2: what air a panel keeps is split above and below its content rather
      // than pooled under the last line, and a wrapped line is balanced so no
      // panel ends on a lone "= 0.9" (b09, same review).
      ...(v2
        ? [
            `#${sid} .pline,#${sid} .plabel{text-wrap:balance}`,
            ...(rowsVariant
              ? []
              : [`#${sid} .panel{display:flex;flex-direction:column;justify-content:center}`]),
          ]
        : []),
      ...(v2 && k > 1
        ? [
            `#${sid} .panel{font-size:${grown.body}px}`,
            `#${sid} .plabel{font-size:${grown.label}px}`,
          ]
        : []),
      // The last panel's label — the panel that lands last is the one still being
      // spoken to at the final hold. Its label carries the panel's accent colour,
      // and no tween touches it: the entrance moves the panel around it.
      ...(p.panels.length === 0 ? [] : [ambient(sid, `-p${p.panels.length - 1} .plabel`, BREATHE)]),
      ...(rowsVariant
        ? [
            // Rows share the table's height evenly, so a short table opens out.
            `#${sid} .panels{gap:0;grid-auto-rows:1fr;border-bottom:2px solid ${theme.rule}}`,
            `#${sid} .panel{display:grid;grid-template-columns:${labelW}px 1fr;column-gap:${ROW_GUTTER}px;align-content:center;background:none;border:0;border-top:2px solid ${theme.rule};border-radius:0;padding:${ROW_PAD_Y}px 0}`,
            `#${sid} .plabel{grid-row:1 / span ${ROW_MAX_LINES + 1};margin:0}`,
            `#${sid} .pline{grid-column:2;margin-top:0}`,
          ]
        : []),
      ...(F.css ? [F.css] : []),
    ].join("\n"),
  };
};

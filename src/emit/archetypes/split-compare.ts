/**
 * Two panels set against each other across a labelled divider.
 *
 * The comparison is the content, so the divider is drawn rather than implied: a
 * rule down the middle, the two labels flanking it, and a tone-coloured hairline
 * running out from the rule under each label. A gap between two columns says
 * "these are two things"; this device says "these two are the same question
 * answered twice", which is the only reason a slide has two halves.
 *
 * Left lands, then right. Revealing both at once makes a pair; revealing them in
 * order makes the second one an answer to the first, and the viewer reads the
 * difference instead of scanning for it.
 *
 * A side is a source figure, a short list, or both. When both sides are figures
 * their *displayed* heights are matched — two crops shown at whatever size their
 * boxes happened to allow is a comparison the geometry has already prejudiced.
 *
 * Side by side is a landscape idea. Two columns of an 860px box are 384px each,
 * which turns "one summary token" into three lines and the comparison into two
 * ragged paragraphs. So portrait stacks the two panels instead — full-width rows
 * across a horizontal divider, top then bottom. The argument is unchanged: same
 * device, same order, same claim that these are one question answered twice.
 */
import type { Figure } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentW, esc } from "../kit.js";
import type { Box } from "../svg.js";
import {
  drawFrom,
  line,
  MIN_FONT,
  n,
  roundRect,
  svg,
  text,
  textWidth,
  tracks,
  wrap,
} from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
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

/** Clear space either side of the divider. Labels stop here, and so does content. */
const GUTTER = 46;
/** Labels start here and are only reduced if they would cross the gutter. */
const LABEL_MAX = 56;
/** White card padding around an embedded figure — source figures are ink on white. */
const PAD = 16;
/** Bullet-to-text indent in a list panel. */
const INDENT = 40;
/** A figure smaller than this has stopped being evidence of anything. */
const MIN_FIG = 180;
/** Gap between a side's figure and its list, when it has both. */
const STACK_GAP = 28;

const ITEM_LH = 1.45;
const ITEM_GAP = 0.45;
/**
 * Tried in order, largest first. The floor is `MIN_FONT`; below it the slide
 * passes every gate. The head of the list used to be 42 — two notches off the
 * floor — which meant a two-item panel set at 42px inside a 560px box and left
 * a 476x812 hole down the right of the canvas.
 */
const ITEM_SIZES = [52, 50, 48, 46, 44, 42, MIN_FONT];

const NAME = ["left", "right"] as const;

function itemHeight(t: string, size: number, width: number): number {
  return wrap(t, size, width).length * size * ITEM_LH;
}

function listHeight(lines: string[], size: number, width: number): number {
  if (lines.length === 0) return 0;
  return (
    lines.reduce((h, t) => h + itemHeight(t, size, width), 0) + size * ITEM_GAP * (lines.length - 1)
  );
}

/**
 * `svg.ts` has no raster primitive and should not grow one for a single caller.
 * The caption rides along as `<title>`: it is the figure's own words, it costs no
 * layout, and a bare `<image>` is otherwise unreadable to anything but an eye.
 */
function image(fig: Figure, b: Box): string {
  return `<image href="assets/${esc(fig.src)}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" preserveAspectRatio="xMidYMid meet"><title>${esc(fig.caption)}</title></image>`;
}

export const splitCompare: Emitter<"split-compare"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const sides = [p.left, p.right];
  const tones = [theme.tones.a, theme.tones.b];

  const figs = sides.map((side) => {
    if (side.figureId === undefined) return undefined;
    const fig = ctx.source.figures.find((f) => f.id === side.figureId);
    if (!fig) {
      throw new Error(
        `split-compare ${beat.id}: no figure "${side.figureId}" in source ${ctx.source.id}`,
      );
    }
    if (fig.width <= 0 || fig.height <= 0) {
      throw new Error(`split-compare ${beat.id}: figure "${fig.id}" has no usable dimensions`);
    }
    return fig;
  });
  sides.forEach((side, i) => {
    if (!figs[i] && !side.lines?.length) {
      throw new Error(
        `split-compare ${beat.id}: the ${NAME[i]} side has neither a figure nor lines`,
      );
    }
  });

  // The body takes what the chrome and the note actually left, measured rather
  // than budgeted for the worst legal case. The old flat 560 was the worst case
  // — eyebrow, a two-line headline and a note — charged to every slide including
  // the ones that had none of them, which is 250px of the canvas thrown away on
  // the common case to protect the rare one.
  const W = contentW(ctx.format);
  const H = bodyBudget(
    ctx.format,
    p.eyebrow,
    p.headline,
    noteHeight(p.note, noteWidth(ctx.format)),
  );

  // Two equal panels with a 2×GUTTER channel between them for the divider —
  // columns across the box in landscape, rows down it in portrait.
  const tall = isPortrait(ctx.format);
  const lanes = tracks(tall ? H : W, 2, GUTTER * 2);
  const pw = tall ? W : (lanes[0]?.w ?? W / 2);
  /** Height one panel has to itself, before its own heading has taken any. */
  const sideH = tall ? (lanes[0]?.w ?? H / 2) : H;
  /** A panel's origin. Only one of the two coordinates ever moves. */
  const sideX = (i: number) => (tall ? 0 : (lanes[i]?.x ?? 0));
  const sideY = (i: number) => (tall ? (lanes[i]?.x ?? 0) : 0);
  const mid = tall ? H / 2 : W / 2;

  // The labels are the one thing that can collide with the divider, so solve the
  // size against the half-width rather than picking one and hoping. `textWidth`
  // is linear in size, so the largest that clears the gutter is a division. At
  // the floor a label wraps instead of shrinking — two readable lines beat one
  // unreadable one.
  const labelSize = Math.max(
    MIN_FONT,
    Math.floor(Math.min(LABEL_MAX, ...sides.map((s) => pw / textWidth(s.label, 1, 700)))),
  );
  const labelLh = labelSize * 1.25;
  const bandH = Math.max(...sides.map((s) => wrap(s.label, labelSize, pw, 700).length)) * labelLh;
  const hairY = bandH + 20;
  const contentY = hairY + 36;
  const contentH = sideH - contentY;

  // One size for every list on the slide. Two panels set at different sizes reads
  // as one of them mattering more, which is a claim this archetype must not make
  // on its own initiative.
  const fits = (size: number) =>
    sides.every((side, i) => {
      const list = listHeight(side.lines ?? [], size, pw - INDENT);
      const fig = figs[i] ? MIN_FIG + (list > 0 ? STACK_GAP : 0) : 0;
      return list + fig <= contentH;
    });
  const itemSize = ITEM_SIZES.find(fits);
  if (itemSize === undefined) {
    throw new Error(
      `split-compare ${beat.id}: the panels do not fit beside each other at the ${MIN_FONT}px floor — shorten the lines or split the beat`,
    );
  }
  const itemW = pw - INDENT;

  // Displayed image height per side, then matched when both sides are figures.
  // Matching can only ever shrink one of them, so the narrower box still holds.
  const natural = figs.map((fig, i) => {
    const side = sides[i];
    if (!fig || !side) return 0;
    const list = listHeight(side.lines ?? [], itemSize, itemW);
    const boxH = contentH - list - (list > 0 ? STACK_GAP : 0);
    return Math.min(boxH - 2 * PAD, ((pw - 2 * PAD) * fig.height) / fig.width);
  });
  const matched = figs[0] && figs[1] ? Math.min(...natural) : undefined;

  const groups = sides.map((side, i) => {
    const tone = tones[i] ?? theme.accent;
    const x0 = sideX(i);
    const y0 = sideY(i);
    const inner = i === 0 ? mid - GUTTER : mid + GUTTER;
    const outer = i === 0 ? x0 : x0 + pw;
    const fig = figs[i];
    // Top-aligned, not centred on the tallest heading. Centring gave a one-line
    // heading and a two-line one different first baselines, so the pair read as
    // one of them having slipped — which at 9:16, where the left heading wraps
    // and the right does not, is exactly what it looked like (EXPERIMENT-006,
    // "Known, not fixed"). Identical arithmetic whenever both wrap the same.
    const ownBand = wrap(side.label, labelSize, pw, 700).length * labelLh;

    const parts = [
      // Both headings start at their own panel's left edge, on the same spine
      // as the bullets and figures under them. Mirroring them against the divider
      // was symmetrical and read as an orphan — the left heading floated away
      // from the list it names and towards the column it is being compared with
      // (EXPERIMENT-006, "Known, not fixed").
      text(
        side.label,
        { x: x0, y: y0 + ownBand / 2 },
        {
          size: labelSize,
          fill: theme.fg,
          weight: 700,
          maxWidth: pw,
          lineHeight: 1.25,
          vAlign: "middle",
          id: `${sid}-lab${i}`,
        },
      ),
      // Landscape draws it from the rule outwards, so the hairline reads as
      // belonging to the divider rather than underlining a column that happens to
      // sit near it. Stacked, the divider runs the other way and the two panels
      // are already one above the other, so the hairline simply underlines its own
      // heading for the full width. Butt caps, not round: a round cap would put
      // 1.5px of ink past the outer edge of the canvas, where it is clipped
      // rather than seen.
      line(
        { x: tall ? x0 : inner, y: y0 + hairY },
        { x: tall ? x0 + pw : outer, y: y0 + hairY },
        { id: `${sid}-hair${i}`, stroke: tone, "stroke-width": 3 },
      ),
    ];

    const imgH = fig ? (matched ?? natural[i] ?? 0) : 0;
    const imgW = fig ? (fig.width * imgH) / fig.height : 0;
    const cardH = fig ? imgH + 2 * PAD : 0;
    const list = side.lines ?? [];
    const listH = listHeight(list, itemSize, itemW);
    const stackH = cardH + listH + (cardH > 0 && listH > 0 ? STACK_GAP : 0);
    // A list-only side loosens down its column rather than sitting as a tight
    // block in the middle of it. The cap is half a line: at a full line the three
    // bullets came apart into three unrelated sentences, which is worse than the
    // band it was spending — a list has to still read as one list.
    const spread =
      !fig && list.length > 1
        ? Math.min(itemSize * 0.5, Math.max(0, (contentH - stackH) / (list.length - 1)))
        : 0;
    let y = y0 + contentY + (contentH - stackH - spread * (list.length - 1)) / 2;

    if (fig) {
      const cardX = x0 + (pw - imgW - 2 * PAD) / 2;
      parts.push(
        roundRect({ x: cardX, y, w: imgW + 2 * PAD, h: cardH }, 14, {
          fill: "#ffffff",
          stroke: theme.rule,
          "stroke-width": 1,
        }),
        image(fig, { x: cardX + PAD, y: y + PAD, w: imgW, h: imgH }),
      );
      y += cardH + (listH > 0 ? STACK_GAP : 0);
    }

    for (const item of list) {
      const h = itemHeight(item, itemSize, itemW);
      // A tick rather than a dot: it carries the side's tone at the height of the
      // first line, so a list reads as belonging to its half at a glance.
      parts.push(
        roundRect({ x: x0, y: y + itemSize * 0.32, w: 5, h: itemSize * 0.95 }, 2.5, { fill: tone }),
        text(
          item,
          { x: x0 + INDENT, y: y + h / 2 },
          {
            size: itemSize,
            fill: theme.fg,
            maxWidth: itemW,
            lineHeight: ITEM_LH,
            vAlign: "middle",
          },
        ),
      );
      y += h + itemSize * ITEM_GAP + spread;
    }

    return `<g id="${sid}-side${i}">${parts.join("")}</g>`;
  });

  const divider = tall
    ? `<g id="${sid}-div">${line(
        { x: 0, y: mid },
        { x: W, y: mid },
        { stroke: theme.rule, "stroke-width": 2 },
      )}${
        // The heavier stretch runs under the headings' own spine, which stacked is
        // the left of the box rather than the top of the divider.
        line({ x: 0, y: mid }, { x: W * 0.32, y: mid }, { stroke: theme.muted, "stroke-width": 3 })
      }</g>`
    : `<g id="${sid}-div">` +
      line({ x: mid, y: 0 }, { x: mid, y: H }, { stroke: theme.rule, "stroke-width": 2 }) +
      // The stretch the labels stand on is weighted, so the device reads as a header
      // rule that continues downwards rather than a hairline someone forgot to stop.
      line({ x: mid, y: 0 }, { x: mid, y: hairY }, { stroke: theme.muted, "stroke-width": 3 }) +
      "</g>";

  const note = p.note ? `\n<div class="sc-note" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, W)}
<div class="sc-body">${svg(`${sid}-sc`, W, H, divider + groups.join(""))}</div>${note}`;

  const at = [1.15, 2.05];
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    // The frame before either side of the argument: the divider grows down from
    // under the headline, and the panels arrive into a structure that already exists.
    tween(
      `#${sid}-div`,
      // The origin is named in both halves so it never *changes* mid-tween; GSAP
      // compensates an origin change with a translate that outlives the tween.
      // It grows away from the headline: down the middle in landscape, out from
      // the left in portrait, where the headline's spine is the left edge.
      tall
        ? { opacity: 0, scaleX: 0, svgOrigin: `0 ${n(mid)}` }
        : { opacity: 0, scaleY: 0, svgOrigin: `${n(mid)} 0` },
      tall
        ? {
            opacity: 1,
            scaleX: 1,
            svgOrigin: `0 ${n(mid)}`,
            duration: 0.6,
            ease: "power2.out",
          }
        : {
            opacity: 1,
            scaleY: 1,
            svgOrigin: `${n(mid)} 0`,
            duration: 0.6,
            ease: "power2.out",
          },
      0.75,
    ),
  ];
  const holds: number[] = [];
  sides.forEach((_, i) => {
    const t = at[i] ?? 0;
    // Each side enters from its own outer edge and settles against the divider —
    // the motion is the two halves being brought into comparison.
    const axis = tall ? "y" : "x";
    tl.push(
      tween(
        `#${sid}-side${i}`,
        { opacity: 0, [axis]: i === 0 ? -26 : 26 },
        { opacity: 1, [axis]: 0, duration: 0.6, ease: "power2.out" },
        t,
      ),
      tween(
        `#${sid}-hair${i}`,
        drawFrom(pw),
        { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" },
        t,
      ),
    );
    holds.push(t + 0.8);
  });

  if (p.note) {
    const t = (at[1] ?? 0) + 0.9;
    tl.push(tween(`#${sid}-note`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, t));
    holds.push(t + 0.7);
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".sc-body{margin-top:34px;display:flex;justify-content:center}",
      noteCss("sc-note", theme),
      // The right-hand label — the side the comparison is arguing for, and the one
      // still on screen at the last hold. Its group's entrance owns `opacity` and
      // `transform`; the breath is on the label itself and moves `filter`, so the
      // two never write the same property on the same element.
      ambient(sid, "-lab1", BREATHE),
    ].join("\n"),
  };
};

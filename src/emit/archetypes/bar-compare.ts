/**
 * Magnitudes, drawn.
 *
 * A table of figures makes the viewer do arithmetic: "1.592 against 0.930" is two
 * numbers and a subtraction. The same pair as two bars is one glance. So nothing
 * here is decoration — the bar lengths carry the entire claim, which is why the
 * scale is derived from the data and anchored at zero. A bar chart whose baseline
 * is not zero is a chart that asserts a ratio the numbers do not support, and it
 * would pass every gate we have.
 *
 * Three decisions worth knowing before changing anything:
 *
 * 1. Every bar sits in a full-width rail. The rail is what makes a dwarfed bar
 *    legible (see MIN_LEN) — the eye reads "almost none of the extent" rather
 *    than "nothing was drawn".
 * 2. Values count up rather than fade in, and they count on the same decimal grid
 *    their printed string is on, so the number GSAP lands on is byte-identical to
 *    the one in the static SVG.
 * 3. The bars are one reveal, not N. Holding on bar 3 of 8 asks the viewer to
 *    compare it against bars that have not been drawn yet.
 *
 * A label gutter beside the rails is a landscape idea. At 9:16 the demo's five
 * names took 340px of an 860px box, so 40% of the width was spent naming bars
 * that then had 60% left to differ in. Portrait puts the label on its own line
 * above the rail instead and hands the whole width to the comparison — which is
 * also where the height it needs comes from, since portrait has height to spare
 * and width it does not.
 */
import type { Emitter } from "../kit.js";
import { contentH, contentW, esc, spotlighter } from "../kit.js";
import { group, id, line, MIN_FONT, nv, roundRect, svg, text, textWidth, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  chrome,
  chromeCss,
  chromeIn,
  EYEBROW_H,
  HEADLINE_H,
  holdsWithin,
  isPortrait,
  noteCss,
  noteHeight,
  tween,
} from "./title.js";

/** Rendered height of the chrome block, eyebrow included or not. */
const CHROME_H = { with: EYEBROW_H + HEADLINE_H, without: HEADLINE_H };
/** `.bc-wrap` margin-top. */
const BODY_TOP = 34;
/**
 * `.bc-note`: one body line plus its margin.
 *
 * Measured against a single glyph on purpose. A bar note is one short line by
 * contract, so this band is a constant of the archetype rather than of the
 * format, and the note's own column never enters into it.
 */
const NOTE_H = noteHeight("x", MIN_FONT, 26);
/** Room under the plot for the unit caption. */
const UNIT_BAND = 58;
/**
 * Allowance under the last row for descenders and the overhang of a wrapped
 * label. Only a first guess so `bar` can be solved for; the exact figure is
 * computed once the type sizes are known and checked against the budget.
 */
const FOOT = 40;

const BAR_MAX = 96;
/** Row gap as a fraction of the bar height. */
const GAP_RATIO = 0.55;
const LABEL_MAX = 46;
const LABEL_WEIGHT = 600;
const VALUE_MAX = 48;
/** Between the label and the zero line. */
const GUTTER_PAD = 34;
/** Past this the gutter is eating the comparison it exists to label. */
const GUTTER_MAX = 714;
/** Between a bar's end and its value. */
const VALUE_GAP = 22;
/** Below this a plot is too short to read a ratio off. */
const MIN_PLOT = 420;
/**
 * The box `GUTTER_MAX` and `MIN_PLOT` were measured in, and the rule that keeps
 * them meaning what they were chosen to mean.
 *
 * Neither is really a pixel count: 714 is 42% of a 1700px content box — "the
 * gutter must not eat the comparison it labels" — and 420 is 24.7% of it — "a
 * plot this short cannot be read as a ratio". Left absolute they say something
 * else in every other format. At 9:16 the box is 860 wide, so the same two
 * numbers hand 83% of it to the labels and then refuse to draw at all, because
 * 420px of plot is a floor no portrait bar chart can ever clear. The demo's
 * eight bars want 340px of labels and 176px of values, which leaves a 344px plot
 * — 40% of its box, and a perfectly readable one.
 *
 * `(width * px) / REF_W` and not `width * fraction`: at 1700 it is exact integer
 * arithmetic, so 16:9 emits the byte it emitted before.
 */
const REF_W = 1700;
const share = (px: number, width: number) => (width * px) / REF_W;
/**
 * The floor on a bar's length, and the one place this archetype knowingly departs
 * from the data.
 *
 * When one value dwarfs the rest — 1000 against 3 — the small bars land under a
 * pixel and the slide silently becomes "one bar and some labels". The honest
 * fixes all cost more than they buy: a log scale makes the ratio unreadable,
 * which is the only thing the viewer came for, and a broken axis is a lie with a
 * zigzag drawn on it. So the scale stays strictly linear and short bars are given
 * a visible stub instead. 8px is under 1% of a ~900px plot — below the resolution
 * anyone can eyeball off a projected slide, so the floor cannot distort a ratio a
 * viewer could have read. The rail behind it carries the real message: a stub
 * against a full-width track reads as "next to nothing", which is the truth.
 */
const MIN_LEN = 8;

/** Descender depth as a fraction of the type size, erring deep. */
const DESCENT = 0.25;

/** Portrait only: the label's own line, and the air under it before the rail. */
const HEAD_GAP = 14;

export const barCompare: Emitter<"bar-compare"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const count = p.bars.length;

  /* ---------------------------------------------------------- the budget */

  /** The scene's content box — the format's, less the shell's padding. */
  const W = contentW(ctx.format);
  // Portrait moves the label onto its own line above the rail. See the header.
  const tall = isPortrait(ctx.format);
  const unitBand = p.unit ? UNIT_BAND : 0;
  const avail =
    contentH(ctx.format) -
    (p.eyebrow ? CHROME_H.with : CHROME_H.without) -
    BODY_TOP -
    (p.note ? NOTE_H : 0);

  // H = count*bar + (count-1)*gap, with gap a fixed fraction of bar.
  let bar = Math.min(BAR_MAX, (avail - unitBand - FOOT) / (count + GAP_RATIO * (count - 1)));
  let pitch = bar * (1 + GAP_RATIO);

  /* ------------------------------- the gutter, sized by the widest label */

  // Stacked, a label has the whole width and there is no gutter to keep it out
  // of; the only cap left is the type scale itself.
  const gutterMax = tall ? 0 : share(GUTTER_MAX, W);
  const gutterInner = tall ? W : gutterMax - GUTTER_PAD;
  // textWidth is linear in size, so the size at which the widest label exactly
  // fills the gutter is a division rather than a search.
  const unitWidth = Math.max(1, ...p.bars.map((b) => textWidth(b.label, 1, LABEL_WEIGHT)));
  const labelSize = Math.max(
    MIN_FONT,
    // A stacked label is not competing with its bar for height, so it is not
    // sized against one either — `bar * 0.86` is what keeps a label inside the
    // rail it sits beside, and beside is the case that has gone.
    Math.min(LABEL_MAX, tall ? LABEL_MAX : bar * 0.86, gutterInner / unitWidth),
  );
  const lines = p.bars.map((b) => wrap(b.label, labelSize, gutterInner, LABEL_WEIGHT));
  const maxLines = Math.max(...lines.map((l) => l.length));
  const lead = labelSize * 1.12;
  /** Portrait: the band a row spends on its label before the rail starts. */
  const head = tall ? maxLines * lead + HEAD_GAP : 0;

  if (tall) {
    // Every row now costs its label's band as well as its bar, so the bar is
    // re-solved against what is left rather than clamped afterwards.
    bar = Math.min(
      BAR_MAX,
      (avail - unitBand - FOOT - count * head) / (count + GAP_RATIO * (count - 1)),
    );
    pitch = head + bar * (1 + GAP_RATIO);
  } else {
    const needed = maxLines * lead + 10;
    if (needed > pitch) {
      // A label that only fits on two lines needs a taller row than its bar does.
      // Growing the row is right; setting the label below MIN_FONT never is.
      pitch = needed;
      bar = Math.min(bar, pitch / (1 + GAP_RATIO));
    }
  }

  const valueSize = Math.max(MIN_FONT, Math.min(VALUE_MAX, bar * 0.9));
  const barsH = (count - 1) * pitch + head + bar;
  // What hangs below the last row's centre line: a value's descender, or half a
  // wrapped label block plus its descender. Stacked, the label is above its own
  // bar and can never be what hangs below it.
  const foot = Math.max(
    0,
    Math.ceil(
      Math.max(
        valueSize * (0.34 + DESCENT),
        tall ? 0 : ((maxLines - 1) * lead) / 2 + labelSize * (0.34 + DESCENT),
      ) -
        bar / 2,
    ) + 4,
  );
  const H = barsH + unitBand + foot;
  if (H > avail) {
    throw new Error(
      `bar-compare ${beat.id}: ${count} bars with labels this long need ${Math.ceil(H)}px of the ${Math.floor(avail)}px this slide has. Shorten the labels or split the beat.`,
    );
  }
  // Ceiled. The label is right-aligned to the gutter's inner edge, so a gutter
  // that is a fraction of a pixel narrower than the text it holds puts the first
  // glyph a hair outside the frame — measured at -0.002px, which is nothing to
  // look at and exactly the near-miss this file already refuses to round down to
  // elsewhere. A whole pixel costs nothing and cannot be off by a fraction.
  const gutter = tall
    ? 0
    : Math.min(
        gutterMax,
        Math.ceil(
          Math.max(...lines.flat().map((l) => textWidth(l, labelSize, LABEL_WEIGHT))) + GUTTER_PAD,
        ),
      );

  /* ------------------------------------- the scale, derived from the data */

  const metrics = p.bars.map((b) => {
    const printed = String(b.value);
    const dot = printed.indexOf(".");
    const decimals = dot < 0 ? 0 : printed.length - dot - 1;
    return {
      ...b,
      printed,
      /** The decimal grid `printed` sits on, so the counter cannot land beside it. */
      snap: decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`,
      /** Exponent notation and deep decimals have no such grid; those labels fade. */
      countable: !printed.includes("e") && decimals <= 4,
      tail: textWidth(printed, valueSize, 700) + VALUE_GAP,
    };
  });

  // Reserve on both sides so the outermost bar's value stays inside the frame.
  const reserveR = Math.max(...metrics.map((m) => (m.value < 0 ? 0 : m.tail)));
  const reserveL = Math.max(0, ...metrics.map((m) => (m.value < 0 ? m.tail : 0)));
  const plotW = W - gutter - reserveL - reserveR;
  if (plotW < share(MIN_PLOT, W)) {
    throw new Error(
      `bar-compare ${beat.id}: labels and values leave only ${Math.floor(plotW)}px to compare in. Shorten them or split the beat.`,
    );
  }
  const plotX = gutter + reserveL;

  // Anchored at zero, always. A negative value puts zero inside the plot rather
  // than at its left edge — the axis moves, the anchor does not.
  const lo = Math.min(0, ...p.bars.map((b) => b.value));
  const hi = Math.max(0, ...p.bars.map((b) => b.value));
  const span = hi - lo || 1;
  const zeroX = plotX + ((0 - lo) / span) * plotW;

  const rows = metrics.map((m, i) => {
    // `head` is zero beside a gutter, so the rail starts at the row's own top.
    const top = i * pitch + head;
    const mid = top + bar / 2;
    const len = m.value === 0 ? 0 : Math.max(MIN_LEN, (Math.abs(m.value) / span) * plotW);
    const x = m.value < 0 ? zeroX - len : zeroX;
    return {
      ...m,
      i,
      top,
      mid,
      /** Where the label sets: on its own line above the rail, or beside it. */
      labelY: tall ? i * pitch + (head - HEAD_GAP) / 2 : mid,
      len,
      x,
      valueX: m.value < 0 ? x - VALUE_GAP : x + len + VALUE_GAP,
      anchor: m.value < 0 ? ("end" as const) : ("start" as const),
    };
  });

  /* ------------------------------------------------------------- painting */

  // One focal point. Toned bars are what the beat singles out, so everything else
  // steps back to `dim`; with nothing singled out the accent carries all of them
  // and length alone does the ranking.
  const toned = p.bars.some((b) => b.tone);
  const fillOf = (t: "a" | "b" | "c" | "d" | undefined) =>
    t ? theme.tones[t] : toned ? theme.dim : theme.accent;
  const valueFill = (t: "a" | "b" | "c" | "d" | undefined) =>
    t ? theme.tones[t] : toned ? theme.muted : theme.fg;

  const unitText = p.unit
    ? text(
        p.unit,
        { x: zeroX, y: barsH + 44 },
        {
          size: MIN_FONT,
          weight: 500,
          fill: theme.dim,
          // The caption follows the axis, and the axis is only at the left edge
          // when every value is positive.
          anchor: zeroX + textWidth(p.unit, MIN_FONT, 500) > W ? "end" : "start",
          id: id(sid, "unit"),
        },
      )
    : "";

  const body = [
    ...rows.map((r) =>
      roundRect({ x: plotX, y: r.top, w: plotW, h: bar }, bar / 2, { class: "bc-rail" }),
    ),
    // One rule the full height of the plot beside a gutter. Stacked, the labels
    // sit at the same x as the axis, so it is drawn as one segment per rail
    // instead — a continuous rule would run straight through every label.
    tall
      ? group(
          rows.map((r) =>
            line(
              { x: zeroX, y: r.top },
              { x: zeroX, y: r.top + bar },
              { stroke: theme.rule, "stroke-width": 2 },
            ),
          ),
          { id: id(sid, "zero") },
        )
      : line(
          { x: zeroX, y: 0 },
          { x: zeroX, y: barsH },
          {
            id: id(sid, "zero"),
            stroke: theme.rule,
            "stroke-width": 2,
          },
        ),
    ...rows.map((r) =>
      roundRect({ x: r.x, y: r.top, w: r.len, h: bar }, bar / 2, {
        id: id(sid, "bar", r.i),
        // Classed as well as identified: the spotlight needs a scope to say
        // "every bar but this one", and `:not()` on a class is the only way to
        // write that once however many bars there are.
        class: "bc-bar",
        fill: fillOf(r.tone),
      }),
    ),
    ...rows.map((r) =>
      text(
        r.label,
        { x: tall ? 0 : gutter - GUTTER_PAD, y: r.labelY },
        {
          size: labelSize,
          weight: LABEL_WEIGHT,
          fill: r.tone ? theme.fg : theme.muted,
          // Flush against the rail it names: the right edge of the gutter beside
          // one, the left edge of the plot above one.
          anchor: tall ? "start" : "end",
          maxWidth: gutterInner,
          lineHeight: 1.12,
          vAlign: "middle",
          class: "bc-lab",
        },
      ),
    ),
    ...rows.map((r) =>
      text(
        r.printed,
        // Baseline, not `vAlign: "middle"`. Centring emits a <tspan>, and the
        // counter writes textContent on the <text>, which would delete it and
        // drop the value back to its own y on the first frame.
        { x: r.valueX, y: r.mid + valueSize * 0.34 },
        {
          size: valueSize,
          weight: 700,
          fill: valueFill(r.tone),
          anchor: r.anchor,
          class: "bc-val",
          id: id(sid, "v", r.i),
        },
      ),
    ),
    unitText,
  ].join("");

  const note = p.note ? `\n<div class="bc-note" id="${id(sid, "note")}">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, W)}
<div class="bc-wrap">
${svg(id(sid, "chart"), W, H, body)}
</div>${note}`;

  /* ------------------------------------------------------------- motion */

  const railsAt = 0.6;
  const barsAt = 0.95;
  const step = Math.min(0.4, 2.4 / count);
  const grow = 0.85;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid} .bc-rail`,
      { opacity: 0 },
      { opacity: 1, duration: 0.45, stagger: 0.05 },
      railsAt,
    ),
    tween(`#${id(sid, "zero")}`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, railsAt),
    tween(
      `#${sid} .bc-lab`,
      { opacity: 0, x: -18 },
      { opacity: 1, x: 0, duration: 0.4, stagger: nv(step) },
      0.8,
    ),
    tween(
      `#${sid} .bc-val`,
      { opacity: 0 },
      { opacity: 1, duration: 0.3, stagger: nv(step) },
      barsAt + 0.15,
    ),
  ];

  for (const r of rows) {
    const at = barsAt + r.i * step;
    tl.push(
      tween(
        `#${id(sid, "bar", r.i)}`,
        { attr: { x: nv(zeroX), width: 0 } },
        { attr: { x: nv(r.x), width: nv(r.len) }, duration: grow, ease: "power3.out" },
        at,
      ),
    );
    if (r.countable) {
      tl.push(
        tween(
          `#${id(sid, "v", r.i)}`,
          { textContent: 0 },
          {
            textContent: r.value,
            snap: { textContent: Number(r.snap) },
            duration: 0.8,
            ease: "power2.out",
          },
          at + 0.1,
        ),
      );
    }
  }

  // One reveal, not `count` of them: the comparison only exists once every bar is
  // drawn, so that is the frame navigation should land on.
  const settled = barsAt + (count - 1) * step + grow + 0.05;
  const holds = [settled + 0.2];

  // The longest bar is the slide's focal point whatever the tones say.
  const focal = rows.reduce((best, r) => (Math.abs(r.value) > Math.abs(best.value) ? r : best));

  // Every bar is drawn before anything is claimed about them, and THEN the
  // claim: the chart settles, and the bar the sentence is about stays at full
  // weight while the rest step back. Before this, a row of eight bars said
  // nothing about which one the beat was for.
  const spot = spotlighter(sid, ".bc-bar");
  if (count > 1) tl.push(...spot.lit(`#${id(sid, "bar", focal.i)}`, settled));

  const tailAt = settled + 0.3;
  if (p.unit) {
    tl.push(tween(`#${id(sid, "unit")}`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, tailAt));
  }
  if (p.note) {
    tl.push(
      tween(
        `#${id(sid, "note")}`,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.6 },
        tailAt,
      ),
    );
  }
  if (p.unit || p.note) holds.push(tailAt + 0.7);
  // NO RESTORE HERE, deliberately. The other archetypes bring their parts back
  // for the last hold because the beat ends on the whole diagram; a comparison
  // ends on its answer, and the tail is 0.3s after the settle — a restore there
  // would undo the dim before anyone had read it. 0.62 is legible by
  // construction, so the losing bars are still there to be compared against.

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      `.bc-wrap{margin-top:${BODY_TOP}px}`,
      `.bc-rail{fill:${theme.panel}}`,
      noteCss("bc-note", theme, 26),
      // `filter`, because this bar's entrance owns its `width` and `x` attributes
      // and a CSS animation outranks whatever GSAP wrote there.
      ambient(sid, `-bar${focal.i}`, BREATHE),
    ].join("\n"),
  };
};

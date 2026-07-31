/**
 * The source's own figure, with the explanation drawn onto it.
 *
 * `claim-figure` parks a screenshot beside a sentence and leaves the viewer to
 * find the part being talked about. This archetype removes that search: each
 * note is a dot on the exact pixel, a leader out to the nearest margin, and a
 * label sitting on a coloured rule — revealed one at a time, so the figure is
 * read in the order the argument needs rather than all at once.
 *
 * `notes[].x/y` are fractions of the figure, never pixels, so the overlay is
 * solved in the figure's own space and stays correct at any layout size. That is
 * only true if the displayed image box is known exactly, which is why the `<img>`
 * gets explicit pixel dimensions derived here rather than `max-width:100%`: a box
 * the browser chooses is a box this file cannot annotate.
 *
 * Margins either side of the figure is a landscape idea. In portrait two of them
 * cost two thirds of an 860px stage, and the demo's figure came out 232px wide —
 * a postage stamp in a tall black frame, which is the one thing a slide whose
 * whole subject is a figure may not be. So portrait puts the figure across the
 * full width and stacks the labels underneath it in two columns instead. The
 * device is unchanged either way: a dot on the pixel, a leader out to a rule, and
 * the label sitting on it. Only which way "out" points has moved.
 */
import type { BeatOf, Format } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentH, contentW, esc } from "../kit.js";
import type { Box, Pt } from "../svg.js";
import {
  circle,
  drawFrom,
  group,
  id,
  line,
  MIN_FONT,
  n,
  path,
  svg,
  text,
  textWidth,
  tracks,
  wrap,
} from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  chrome,
  chromeCss,
  chromeIn,
  EYEBROW_H,
  HEADLINE_H,
  holdsWithin,
  isPortrait,
  tween,
} from "./title.js";

/* --------------------------------------------------------------- the budget */

/** Read off `chromeCss` rather than restated here — a local copy drifts silently. */
const HEAD_H = HEADLINE_H;
const BROW_H = EYEBROW_H;
/**
 * Air above and below the stage. Both are wider than a dot's halo plus its
 * shadow, because a note at `y: 0` puts that halo outside the overlay's box and
 * the only thing between it and the headline is this gap.
 */
const STAGE_GAP = 30;
const CAP_GAP = 26;

const CAP_LH = 1.35;
/**
 * A figure caption is provenance; the notes carry the meaning. One that wraps to
 * four lines would take a fifth of the stage away from the thing being explained,
 * so the reserve stops at two and the CSS clamps to match.
 */
const CAP_LINES = 2;

/** Plate padding plus its 1px border, per side. The white mat under the figure. */
const PLATE = 15;
/** Clear air between the plate's edge and the inner end of a leader's rule. */
const LEAD = 18;
/** Slack kept at the stage's outer edges, so a label can never reach the canvas. */
const EDGE = 10;

const LAB = MIN_FONT;
const LAB_WEIGHT = 600;
const LAB_LH = 1.3;
/** Cap-and-ascender height above the baseline, for turning a line count into a box. */
const ASCENT = LAB * 0.78;
/** Last baseline down to the rule, and the rule's own weight. */
const RULE_LIFT = 16;
const RULE_W = 3;
/**
 * Minimum air between two stacked labels on the same side.
 *
 * It has to beat the label's own line spacing. At 22px the gap *between* two
 * labels was less than half the gap between two lines of one, so a stack read as
 * a single paragraph and the coloured rule under one label looked like an
 * underline for the label beneath it. Derived from the leading for that reason,
 * plus a little, so the two can never converge again.
 */
const LAB_GAP = Math.round(LAB * LAB_LH) + 12;

/** Past four lines a callout label has stopped being a label. */
const LINE_CEIL = 4;

/**
 * Portrait only: the channel between the two label columns under the figure, and
 * the air between the plate's bottom edge and the first label.
 *
 * The channel is what keeps a left label's last word off a right label's first.
 * Both columns' rules end at it, so the leaders converge on one central axis
 * rather than each finding its own — the same reading the two margins give in
 * landscape, turned a quarter turn.
 */
const MID_GAP = 56;
const BAND_GAP = 34;
/**
 * Portrait's preferred arrangement: one column per note, side by side under the
 * figure, each with a short leader up to its own point.
 *
 * It is preferred over two stacked columns because a stack cannot be drawn
 * without crossings — a leader reaching the second row has to pass through the
 * label in the first, since both live in the band below the figure rather than
 * in a margin beside it. A row has no rows to cross. `MIN_COL` is where a 40px
 * caption stops setting and starts shredding, so three notes get the row at
 * 860px wide and four fall back to the stack.
 */
const COL_GAP = 28;
const MIN_COL = 250;

/**
 * How tall a label is allowed to get, in lines.
 *
 * A fixed cap would have to assume the worst note count and would then clip a
 * lone label that had the whole margin to itself. This derives the cap instead:
 * the worst split of N notes puts ceil(N/2) of them in one margin, so the tallest
 * label that provably cannot overrun the stage falls out of the stage's own
 * height. Five notes get three lines; one note gets four. What is over budget is
 * clipped with an ellipsis — a planning bug you can see beats a slide that runs
 * off the canvas.
 */
function lineBudget(count: number, stageH: number): number {
  const perSide = Math.max(1, Math.ceil(count / 2));
  const room = (stageH - (perSide - 1) * LAB_GAP) / perSide;
  const lines = Math.floor((room - ASCENT - RULE_LIFT - RULE_W) / (LAB * LAB_LH)) + 1;
  return Math.min(LINE_CEIL, Math.max(1, lines));
}

/**
 * Label column widths to try, DERIVED FROM THE LABELS rather than listed.
 *
 * The trade is real in both directions: widening a column shrinks the figure, and
 * a figure 200px smaller still reads where a label that lost its last clause does
 * not. So the search walks from tight to generous and stops at the first width
 * that holds — `ok` refuses a column its labels overflow.
 *
 * WHAT WAS HERE was `[320, 380, 470, 560]`, four numbers with no derivation, and
 * the bug was in the head rather than the tail: 320 is where the search STARTS,
 * so no figure was ever offered narrower. Measured on the shipped deck's four
 * figures, every column came back 320px reserved against 256-303px of actual
 * label while three of the four figures were width-bound at scale 0.71-0.75,
 * downscaled with 643px of stage height unused. Replacing it with
 * `[220, 260, 320, …]` fixed those four and was the same mistake one notch along
 * — 220 was "a hair over the widest word THESE labels carry", which is a constant
 * tuned to one deck.
 *
 * The bounds are properties of the text:
 *
 *   FLOOR   the widest single WORD any label contains. Under it `wrap` has to
 *           break mid-word, which `measure` then reports as overflow, so no
 *           narrower column can ever succeed and trying one is wasted work.
 *   CEILING the widest label ENTIRE. Past it nothing wraps, so a wider column
 *           buys no label anything and costs the figure width.
 *
 * Between them, geometric steps: each is a fixed fraction wider than the last, so
 * a two-word label and a two-clause one get the same *relative* granularity
 * rather than the same pixel one. `STEPS` is how many attempts that is worth —
 * each is arithmetic over strings with no browser, and past a handful the widths
 * differ by less than a space.
 */
const STEPS = 6;

function columns(notes: readonly FigureNote[], stageW: number): number[] {
  const words = notes.flatMap((n) => n.text.split(/\s+/).filter(Boolean));
  if (words.length === 0) return [stageW / 3];
  const floor = Math.max(...words.map((w) => textWidth(w, LAB, LAB_WEIGHT)));
  const ceiling = Math.max(...notes.map((n) => textWidth(n.text, LAB, LAB_WEIGHT)));
  // A single word longer than the widest label cannot happen, but a label of one
  // word makes them equal — one attempt is then the whole search.
  const hi = Math.max(floor, ceiling);
  if (hi <= floor) return [floor];
  const ratio = (hi / floor) ** (1 / (STEPS - 1));
  return Array.from({ length: STEPS }, (_, k) => floor * ratio ** k);
}

/**
 * Never blow a small figure up more than this. Beyond it the interpolation is
 * doing the explaining, and a 300px thumbnail at 3x is worse than one that simply
 * sits smaller in a wider pair of label columns.
 */
const MAX_UPSCALE = 1.5;

const DOT_R = 9;
const HALO_R = 18;

/* ---------------------------------------------------------------- the solve */

export interface FigureNote {
  x: number;
  y: number;
  text: string;
}

export interface NoteBox {
  /** Which margin this label was given. */
  side: "l" | "r";
  lines: string[];
  /**
   * Stage-space x of the rule's inner end — the one the leader arrives at, with
   * the label running outward from it.
   *
   * Solved here rather than in the emitter because it is the one number the two
   * arrangements disagree about: beside the plate in landscape, either side of
   * the centre channel under the figure in portrait.
   */
  inner: number;
  /** Widest line — also the length of the rule the label sits on. */
  w: number;
  h: number;
  /** Stage-space top of the text block. */
  top: number;
  /** Stage-space y of the rule, where the leader arrives from the dot. */
  ruleY: number;
  /** The annotated point, in stage space. */
  at: Pt;
  clipped: boolean;
}

export interface FigureLayout {
  /** The image box in stage space. The plate is this grown by `PLATE` a side. */
  img: Box;
  /** Width available to a label in either margin. */
  col: number;
  /**
   * What the stage actually needs, which is at most the budget it was solved
   * against. A 4:1 strip uses 230px of a 726px budget, and a stage left at the
   * budget puts a 250px dead band above and below the only thing on the slide.
   */
  height: number;
  boxes: NoteBox[];
  /** False when a label had to be clipped or a stack had to overlap. */
  ok: boolean;
}

interface Measured {
  lines: string[];
  w: number;
  h: number;
  clipped: boolean;
}

function measure(content: string, col: number, maxLines: number): Measured {
  const all = wrap(content, LAB, col, LAB_WEIGHT);
  const clipped = all.length > maxLines;
  const lines = all.slice(0, maxLines);
  if (clipped) {
    let tail = lines[maxLines - 1] ?? "";
    while (tail && textWidth(`${tail}…`, LAB, LAB_WEIGHT) > col) tail = tail.slice(0, -1);
    lines[maxLines - 1] = `${tail.trimEnd()}…`;
  }
  return {
    lines,
    w: Math.max(0, ...lines.map((l) => textWidth(l, LAB, LAB_WEIGHT))),
    h: (lines.length - 1) * LAB * LAB_LH + ASCENT + RULE_LIFT + RULE_W,
    clipped,
  };
}

interface Work extends Measured {
  i: number;
  at: Pt;
  side: "l" | "r";
  top: number;
  inner: number;
  ruleY: number;
}

/**
 * Which margins this attempt reserves, and therefore which sides may hold labels.
 *
 * Landscape reserves a label column on BOTH sides, always — and a figure whose
 * notes all point at its left half never fills the right one. Measured on the
 * shipped sixty-second deck: `fig-progress` carries one note, on the left, and
 * the empty right margin cost it 508 of 1700 stage pixels. The paper's densest
 * asset — a six-by-three grid of image crops — drew at 55% of the width it could
 * have had, with dead space beside it.
 *
 * So the margin is a CHOICE the search makes rather than a constant, and it is a
 * choice because it cannot be decided in advance: dropping a margin makes the
 * figure wider, a wider figure is a taller one, and a taller figure leaves its
 * labels less room. `planFigure` therefore tries the tight arrangement first and
 * falls back to reserving both — the same shape as the column-width search it
 * already runs, and for the same reason.
 */
interface Sides {
  l: boolean;
  r: boolean;
}

/** The side each note would prefer: the margin its own half of the figure faces. */
function wantedSides(notes: readonly FigureNote[]): Sides {
  const want = { l: false, r: false };
  for (const note of notes) want[(note.x ?? 0) < 0.5 ? "l" : "r"] = true;
  // A figure with no notes still needs somewhere for the caption's spine; keeping
  // both is the arrangement every deck built before this had.
  return want.l || want.r ? want : { l: true, r: true };
}

function attempt(
  stageW: number,
  notes: FigureNote[],
  fig: { width: number; height: number },
  stageH: number,
  want: number,
  tall: boolean,
  sides: Sides = { l: true, r: true },
): FigureLayout {
  // A row of columns when they are wide enough to read in, two stacked columns
  // otherwise. See `MIN_COL`.
  const band = tall ? tracks(stageW, notes.length, COL_GAP) : [];
  const row = tall && (band[0]?.w ?? 0) >= MIN_COL;
  // Portrait reserves the shallowest band its labels could possibly need — one
  // line each — and hands the figure the whole width above it. Landscape reserves
  // width instead, which is what `want` is.
  const stacks = row ? 1 : Math.max(1, Math.ceil(notes.length / 2));
  const bandMin = tall
    ? stacks * (ASCENT + RULE_LIFT + RULE_W) + (stacks - 1) * LAB_GAP + BAND_GAP
    : 0;
  // Ask for `want`, then hand the labels whatever the figure did not use: a
  // portrait figure leaves 600px of margin a side and the labels should have it.
  //
  // The widths `columns` derives come from the TEXT and know nothing about the
  // stage, so a long label on a narrow canvas asks for more than half of it,
  // `plateMax` goes negative, and the figure is drawn inside-out — which no gate
  // reads as wrong. A column may never take more than a third of the stage it
  // sits in. At 1700 that is 566px and clamps almost nothing; at 860 it is what
  // keeps the arithmetic the right way up.
  const asked = Math.min(want, stageW / 3);
  // A margin only costs width when it is going to hold something. `sides` is the
  // arrangement this attempt is making; `planFigure` tries the tight one first.
  const margin = (s: "l" | "r") => (tall || !sides[s] ? EDGE : asked + LEAD + EDGE);
  const plateMax = tall ? stageW - 2 * EDGE : stageW - margin("l") - margin("r");
  const scale = Math.min(
    (plateMax - 2 * PLATE) / fig.width,
    (stageH - bandMin - 2 * PLATE) / fig.height,
    MAX_UPSCALE,
  );
  const img: Box = {
    w: fig.width * scale,
    h: fig.height * scale,
    // Centred between the MARGINS, not on the stage. With both reserved the two
    // are the same number; with one, centring on the stage walks the figure into
    // the margin its own labels are standing in.
    x: tall ? (stageW - fig.width * scale) / 2 : margin("l") + (plateMax - fig.width * scale) / 2,
    // Portrait pins the figure to the top of the stage — the labels take the
    // band under it, so centring it would open a gap the labels then hang off.
    y: tall ? PLATE : (stageH - fig.height * scale) / 2,
  };
  // THE COLUMN IS THE RESERVED MARGIN, not the left one. It used to be
  // `img.x - PLATE - LEAD - EDGE` and that was the same number both ways only
  // while both margins were always reserved: with the figure pushed left to fill
  // an unused left margin, `img.x` is the leftover air and not the label column,
  // so a 30px label was measured against 29px of column and reported as fitting.
  const col = row
    ? (band[0]?.w ?? stageW)
    : tall
      ? (stageW - MID_GAP) / 2
      : sides.l
        ? img.x - PLATE - LEAD - EDGE
        : stageW - (img.x + img.w) - PLATE - LEAD - EDGE;
  /** Portrait: the top of the label band, and the height it has. */
  const stackTop = tall ? img.y + img.h + PLATE + BAND_GAP : 0;
  const room = stageH - stackTop;
  /** The x a leader arrives at, with the label running outward from it. */
  const innerOf = (side: "l" | "r") =>
    tall
      ? side === "l"
        ? col
        : stageW - col
      : side === "l"
        ? img.x - PLATE - LEAD
        : img.x + img.w + PLATE + LEAD;

  const maxLines = lineBudget(notes.length, room);
  const work: Work[] = notes.map((no, i) => ({
    ...measure(no.text, col, maxLines),
    i,
    at: { x: img.x + no.x * img.w, y: img.y + no.y * img.h },
    side: "l",
    top: 0,
    inner: 0,
    ruleY: 0,
  }));

  const used = { l: 0, r: 0 };
  if (row) {
    // Columns follow the points' own left-to-right order, so no leader ever has
    // to reach past another one's label. Everything runs rightward from its
    // column's left edge, which is also the spine the caption sets on.
    //
    // The rule goes ABOVE the caption here, not under it, and all three sit on
    // one line directly beneath the figure. Under the caption it would be the
    // leader that suffers: the leader arrives at the rule's left end, which in a
    // column is directly below the words, so the diagonal came down through its
    // own label's second line. Above, it lands on bare canvas every time.
    [...work]
      .sort((a, b) => a.at.x - b.at.x || a.i - b.i)
      .forEach((w, k) => {
        w.side = "r";
        w.inner = band[k]?.x ?? 0;
        w.ruleY = stackTop + RULE_W / 2;
        w.top = stackTop + RULE_W + RULE_LIFT;
      });
  } else {
    // Top-down, so a stack's order matches the order the eye scans it.
    const order = [...work].sort((a, b) => a.at.y - b.at.y || a.i - b.i);

    // Side by the point's own half, unless that side is already full. Crossing the
    // figure is ugly; a label pushed off the bottom of the stage is broken.
    const cost = (s: "l" | "r", h: number) => used[s] + (used[s] > 0 ? LAB_GAP : 0) + h;
    for (const w of order) {
      const pref: "l" | "r" = (notes[w.i]?.x ?? 0) < 0.5 ? "l" : "r";
      const across: "l" | "r" = pref === "l" ? "r" : "l";
      // Only escape to the other margin if this attempt RESERVED it — the width
      // went to the figure otherwise, and a label sent there hangs off a stage
      // that was sized without it. `sides[pref]` is true by construction (the
      // preference is what `wantedSides` read), so nothing is left homeless.
      const other = sides[across] ? across : pref;
      w.side =
        cost(pref, w.h) <= room
          ? pref
          : cost(other, w.h) <= room
            ? other
            : used[pref] <= used[other]
              ? pref
              : other;
      used[w.side] = cost(w.side, w.h);
      w.inner = innerOf(w.side);
    }

    for (const side of ["l", "r"] as const) {
      const stack = order.filter((w) => w.side === side);
      // Down: every label wants to sit centred on its own dot, and gives that up
      // only to stay clear of the one above it. In portrait the dots are all above
      // `stackTop`, so that preference is never satisfiable and the stack simply
      // packs downward from the band's top — which is what a caption block is.
      let floorY = stackTop;
      for (const w of stack) {
        w.top = Math.max(w.at.y - w.h / 2, floorY);
        floorY = w.top + w.h + LAB_GAP;
      }
      // Up: pull the stack back inside the stage from the bottom. The `max(…)` is
      // the last line of defence — when a stack genuinely cannot fit it packs
      // rather than escapes, and `ok` is already false by then.
      let ceilY = stageH;
      for (let k = stack.length - 1; k >= 0; k--) {
        const w = stack[k];
        if (!w) continue;
        w.top = Math.max(stackTop, Math.min(w.top, ceilY - w.h));
        ceilY = w.top - LAB_GAP;
      }
    }
    for (const w of work) {
      w.ruleY = w.top + (w.lines.length - 1) * LAB * LAB_LH + ASCENT + RULE_LIFT + RULE_W / 2;
    }
  }

  // Collapse the stage onto what it holds. The budget was only ever there to
  // give the labels somewhere to go; leaving it as the stage's height is what put
  // a strip figure in the middle of 500px of nothing. A pure translation, so
  // everything solved above stays solved.
  //
  // Portrait counts the plate rather than the image: nothing sits above the
  // figure there, so the plate's own 15px mat is what the stage's top edge is,
  // and collapsing onto `img.y` would hang it off the top by exactly that.
  const top = tall ? img.y - PLATE : Math.min(img.y, ...work.map((w) => w.top));
  const bottom = Math.max(
    img.y + img.h + (tall ? PLATE : 0),
    // A row's rule is above its text, so its block runs from `ruleY` to the last
    // descender rather than from `top` to a rule below it.
    ...work.map((w) => (row ? w.top + w.lines.length * LAB * LAB_LH : w.top + w.h)),
  );

  return {
    img: { ...img, y: img.y - top },
    col,
    height: bottom - top,
    ok:
      (row ? bottom - stackTop <= room : used.l <= room && used.r <= room) &&
      // THE COLUMN HOLDS WHAT WAS MEASURED AGAINST IT. `measure` wraps to `col`,
      // so a label wider than `col` means the column shrank AFTER the wrap — the
      // one-margin arrangement widening the figure into it. Without this the
      // search calls that a fit and never falls back, and the label runs off the
      // stage: measured at 30px of text in 29.1px of column.
      !work.some((w) => w.w > col) &&
      !work.some((w) => w.clipped),
    boxes: work.map((w) => ({
      side: w.side,
      lines: w.lines,
      inner: w.inner,
      w: w.w,
      h: w.h,
      top: w.top - top,
      ruleY: w.ruleY - top,
      at: { x: w.at.x, y: w.at.y - top },
      clipped: w.clipped,
    })),
  };
}

/**
 * Size the figure and place its labels.
 *
 * Exported because this is the one thing here that can be wrong without looking
 * wrong in a diff: a label half a pixel past the stage, or two overlapping in a
 * stack, is a property worth asserting directly rather than through rendered SVG.
 */
export function planFigure(
  stageW: number,
  notes: FigureNote[],
  fig: { width: number; height: number },
  stageH: number,
  tall = false,
): FigureLayout {
  // Portrait's column is fixed at half the stage, so there is nothing to widen
  // and the search has one entry.
  if (tall) return attempt(stageW, notes, fig, stageH, 0, true);

  // TWO AXES, TIGHT FIRST. The margins a figure's own notes actually face, then
  // both — and each arrangement walks the column widths as before.
  //
  // A search rather than a decision because the two axes fight: dropping the
  // empty margin makes the figure wider, a wider figure is TALLER, and a taller
  // figure leaves its labels less vertical room, which is what `ok` reports. So
  // the tight arrangement is an attempt and not an assumption, and a figure that
  // cannot afford it falls back to exactly the layout every deck had before.
  const wanted = wantedSides(notes);
  const both: Sides = { l: true, r: true };
  const tries = wanted.l && wanted.r ? [both] : [wanted, both];
  const cols = columns(notes, stageW);
  let plan: FigureLayout | undefined;
  for (const sides of tries) {
    for (const col of cols) {
      plan = attempt(stageW, notes, fig, stageH, col, false, sides);
      if (plan.ok) return plan;
    }
  }
  // Nothing fit. Return the last attempt, which is the widest column of the
  // both-margins arrangement — the most forgiving one — and let `ok: false`
  // travel with it.
  return plan as FigureLayout;
}

/**
 * Height the stage may spend, once the chrome and the caption have taken theirs.
 * A budget, not a size — `planFigure` gives back only what it used.
 */
export function stageBudget(format: Format, eyebrow: boolean, caption: string): number {
  const lines = Math.min(CAP_LINES, wrap(caption, LAB, contentW(format)).length);
  const capH = lines * LAB * CAP_LH;
  return Math.max(
    360,
    contentH(format) - (eyebrow ? BROW_H : 0) - HEAD_H - STAGE_GAP - CAP_GAP - capH,
  );
}

/* --------------------------------------------------------------- the emitter */

/** Start the leader clear of the dot rather than under it. */
function offDot(from: Pt, to: Pt): Pt {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d === 0) return from;
  const k = Math.min(1, (DOT_R + 8) / d);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** The figure settles here; the first note starts after it. */
const FIG_IN = 1.55;
const NOTE_0 = 1.9;
/** Five notes then land the last hold at 6.6s, inside a default 7s beat. */
const STEP = 0.95;

export const annotatedFigure: Emitter<"annotated-figure"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const fig = ctx.source.figures.find((f) => f.id === p.figureId);
  if (!fig) {
    throw new Error(
      `annotated-figure ${beat.id}: no figure "${p.figureId}" in source ${ctx.source.id}`,
    );
  }

  // Cropping changes both the aspect the layout solves for and the coordinate
  // space the notes live in. Do both here, once, so everything downstream keeps
  // working in "fractions of what is on screen".
  const crop = p.crop;
  const view = crop
    ? { width: fig.width * crop.w, height: fig.height * crop.h }
    : { width: fig.width, height: fig.height };
  // A note outside the crop is a planning error — the crop is supposed to
  // contain what the beat points at — so clamp to the edge rather than drop it,
  // which would silently lose an annotation the storyboard asked for.
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const notes: BeatOf<"annotated-figure">["params"]["notes"] = crop
    ? p.notes.map((no) => ({
        ...no,
        x: clamp((no.x - crop.x) / crop.w),
        y: clamp((no.y - crop.y) / crop.h),
      }))
    : p.notes;

  /** The stage's own box: the content width the shell's padding leaves. */
  const STAGE_W = contentW(ctx.format);
  const plan = planFigure(
    STAGE_W,
    notes,
    view,
    stageBudget(ctx.format, p.eyebrow !== undefined, fig.caption),
    isPortrait(ctx.format),
  );
  const stageH = plan.height;
  const plate: Box = {
    x: plan.img.x - PLATE,
    y: plan.img.y - PLATE,
    w: plan.img.w + 2 * PLATE,
    h: plan.img.h + 2 * PLATE,
  };

  const lengths: number[] = [];
  const parts = plan.boxes.map((b, i) => {
    const left = b.side === "l";
    const tone = notes[i]?.tone;
    const c = tone ? theme.tones[tone] : theme.accent;
    // The rule's inner end — `LEAD` off the plate in landscape, on the centre
    // channel in portrait — with the label running outward from it, so both
    // stacks keep a hard edge facing the figure. `plan` owns which; see `inner`.
    const inner = b.inner;
    const outer = left ? inner - b.w : inner + b.w;
    const knee: Pt = { x: inner, y: b.ruleY };
    const start = offDot(b.at, knee);
    // One stroke from the dot to the label and along under it: the leader becomes
    // the rule, so the reveal is a single gesture rather than two events.
    lengths[i] = Math.hypot(knee.x - start.x, knee.y - start.y) + b.w;

    const anchor = left ? "end" : "start";
    const first = b.top + ASCENT;
    return [
      path(`M${n(start.x)},${n(start.y)} L${n(knee.x)},${n(knee.y)} L${n(outer)},${n(knee.y)}`, {
        id: id(sid, "lead", i),
        stroke: c,
        "stroke-width": 3,
        "stroke-linejoin": "round",
      }),
      group(
        [
          circle(b.at, HALO_R, { fill: c, opacity: 0.22, class: "af-halo" }),
          // The background-coloured ring is what keeps a dot legible on top of a
          // figure that is white here and a dense plot two inches away.
          circle(b.at, DOT_R, {
            fill: c,
            class: "af-dot",
            stroke: theme.bg,
            "stroke-width": 4,
          }),
        ],
        { id: id(sid, "dot", i) },
      ),
      group(
        [
          ...b.lines.map((l, k) =>
            text(
              l,
              { x: inner, y: first + k * LAB * LAB_LH },
              { size: LAB, weight: LAB_WEIGHT, anchor },
            ),
          ),
          line(knee, { x: outer, y: knee.y }, { stroke: c, "stroke-width": RULE_W }),
        ],
        { id: id(sid, "lab", i), class: "af-lab" },
      ),
    ].join("");
  });

  const html = `${chrome(sid, p.eyebrow, p.headline, STAGE_W)}
<div class="af-stage" id="${sid}-stage">
  <div class="af-plate" id="${sid}-plate"><img${crop ? " data-layout-allow-overflow" : ""} src="assets/${esc(fig.src)}" alt="${esc(fig.caption)}" /></div>
  ${svg(`${sid}-ov`, STAGE_W, stageH, `<g class="af-ov-g">${parts.join("")}</g>`)}
</div>
<div class="af-cap" id="${sid}-cap">${esc(fig.caption)}</div>`;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid}-plate`,
      { opacity: 0, scale: 0.97 },
      { opacity: 1, scale: 1, duration: 0.8 },
      0.7,
    ),
  ];
  const holds = [FIG_IN];
  plan.boxes.forEach((b, i) => {
    const at = NOTE_0 + i * STEP;
    tl.push(
      tween(
        `#${sid}-dot${i}`,
        // An explicit svgOrigin, not "center": a group's bbox includes the halo,
        // and the dot must grow out of the pixel it is pointing at. It has to be
        // named in both halves — an origin declared only in the `to` vars is an
        // origin *change*, and GSAP absorbs a change with a compensating translate
        // that never unwinds, leaving the dot 18px up-left of that exact pixel.
        { opacity: 0, scale: 0, svgOrigin: `${n(b.at.x)} ${n(b.at.y)}` },
        {
          opacity: 1,
          scale: 1,
          svgOrigin: `${n(b.at.x)} ${n(b.at.y)}`,
          duration: 0.3,
          ease: "back.out(2)",
        },
        at,
      ),
      tween(
        `#${sid}-lead${i}`,
        drawFrom(lengths[i] ?? 0),
        { strokeDashoffset: 0, duration: 0.55, ease: "none" },
        at + 0.1,
      ),
      tween(
        `#${sid}-lab${i}`,
        { opacity: 0, x: b.side === "l" ? -16 : 16 },
        { opacity: 1, x: 0, duration: 0.4 },
        at + 0.45,
      ),
    );
    holds.push(at + 0.9);
  });
  // Settled before the first hold, not landing on it — a caption still fading up
  // when navigation stops is a half-built frame.
  tl.push(tween(`#${sid}-cap`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.0));

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".af-stage{position:relative;flex:none}",
      `.af-plate{position:absolute;background:#fff;border:1px solid ${theme.rule};border-radius:12px;padding:${PLATE - 1}px}`,
      // The plate clips, and a cropped image is deliberately bigger than it —
      // that is the crop. The layout gate is right to flag an overflowing child
      // in general, so the image opts out explicitly rather than the rule being
      // weakened for every figure.
      ".af-plate{overflow:hidden}",
      ".af-plate img{display:block;width:100%;height:100%}",
      // A crop shows one panel of the figure at the plate's size. Papers set
      // their figures for A4 at reading distance, which lands their internal
      // type near 12px on a 1920 canvas — unreadable from the back of a room,
      // and invisible to every gate, because it is pixels in a raster rather
      // than DOM the contrast gate can measure. Scaling the image up and
      // clipping to the region is what a presenter does with a laser pointer.
      ...(crop
        ? [
            `#${sid}-plate img{position:absolute;width:${n(plan.img.w / crop.w)}px;height:${n(plan.img.h / crop.h)}px;left:${n(PLATE - (crop.x * plan.img.w) / crop.w)}px;top:${n(PLATE - (crop.y * plan.img.h) / crop.h)}px;max-width:none}`,
          ]
        : []),
      // One shadow for the whole overlay, not one per element: it outlines every
      // stroke and glyph at once, which is what lets a light tone survive a white
      // figure without a second backing stroke under every leader.
      ".af-ov-g{filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}",
      `.af-lab text{fill:${theme.fg}}`,
      `.af-cap{font-size:${LAB}px;line-height:${CAP_LH};color:${theme.dim};margin-top:${CAP_GAP}px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${CAP_LINES};overflow:hidden}`,
      // Per-scene geometry: the overlay is only correct because the image box is
      // stated rather than negotiated with the layout engine.
      `#${sid}-stage{width:${STAGE_W}px;height:${n(stageH)}px;margin-top:${STAGE_GAP}px}`,
      `#${sid}-plate{left:${n(plate.x)}px;top:${n(plate.y)}px;width:${n(plate.w)}px;height:${n(plate.h)}px}`,
      // `overflow:visible` because a dot sitting on the figure's own edge puts its
      // halo outside the viewBox, and a clipped halo reads as a rendering fault.
      `#${sid}-ov{position:absolute;left:0;top:0;overflow:visible}`,
      // The dots are the archetype. Their entrance owns opacity and transform, so
      // the breath takes `filter` — the one property nothing else here writes.
      ambient(sid, " .af-dot", BREATHE),
    ].join("\n"),
  };
};

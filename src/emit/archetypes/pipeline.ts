/**
 * The architecture overview, redrawn as motion.
 *
 * Every paper has this figure and every paper renders it as a flat PNG the
 * reader has to decode all at once. Drawn here instead, one stage at a time with
 * its connector arriving first, the viewer watches the method assemble in the
 * order it actually runs — which is the only reading order a static diagram
 * cannot impose.
 *
 * Two decisions carry the whole archetype:
 *
 * Boxes are all one width, solved from the widest label (`pipeLayout`). Boxes
 * sized individually to their own text is what a generator produces; a row of
 * equal boxes on a shared centreline is what a designer draws. When the labels
 * genuinely do not fit on one line the answer is more lines, not smaller type —
 * type stops at `MIN_FONT` and the box grows downwards, because a stage nobody
 * in the third row can read is not a stage.
 *
 * The two connector reveals are different on purpose. A stage-to-stage arrow is
 * ~120px, so it fades in as one object and its head is never orphaned. The
 * feedback loop is a ~1000px elbow, and something that long has to be watched
 * travelling: it is revealed by a clip sweeping against the flow, so the path
 * appears in the direction it runs and its arrowhead lands last, on the stage it
 * returns to.
 *
 * A row is a landscape idea. In portrait the same four stages get 860px to share
 * and come out as columns — the demo's "Window" broke to "Windo/w" and "DQ-CTM"
 * to "DQ-CT/M", which is a diagram that has stopped being one. So portrait turns
 * the flow ninety degrees and runs it down the page instead: full-width boxes,
 * arrows pointing down, and the return path up a channel on the right. See
 * `columnLayout` — the two arrangements share their type, their reveal and their
 * furniture, and nothing else.
 */
import type { BeatOf } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentW, esc, spotlighter } from "../kit.js";
import {
  arrow,
  arrowDefs,
  circle,
  elbow,
  fitBoxes,
  group,
  id,
  MIN_FONT,
  nv,
  rect,
  roundRect,
  svg,
  type Track,
  text,
  textWidth,
  travel,
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

type Stage = BeatOf<"pipeline">["params"]["stages"][number];
type Loop = { from: number; to: number; label: string };

/** A box edge sits on the viewBox edge otherwise, and half its stroke is clipped. */
const M = 2;
const R = 18;

/** The dot that rides an arrow. Half the arrowhead, so it reads as cargo, not a second head. */
const PULSE_R = 13;
/** The return path's dash, and therefore the distance one flow cycle travels. */
const LOOP_DASH = "16 12";
const LOOP_PERIOD = 28;

/** Preferred label size. Reduced only after the gaps have already been spent. */
const LABEL = 52;
/**
 * Notes, and the loop's label, are set at the floor. At six stages the label is
 * near the floor too, so the hierarchy is carried by weight and colour rather
 * than by size — which is the only thing left once both are 40px.
 */
const NOTE = MIN_FONT;
const LABEL_LH = 1.2;
const NOTE_LH = 1.3;
const NOTE_TOP = 16;
/**
 * Inner padding per side, in ems. Small on purpose: at six stages the row leaves
 * ~250px a box, and every em of padding there is a character the label loses. At
 * two or three stages the boxes are capped well below their share anyway, so the
 * padding is never what you notice.
 */
const PAD_X_EM = 0.45;
const PAD_Y = 34;
const MIN_BOX_H = 172;
/** Arrowheads are a fixed 26px, so even the tight gap still reads as a chevron. */
const GAP = 120;
const MIN_GAP = 30;
/**
 * A two-stage pipeline given the whole 1700px produces two 800px slabs with a
 * word in the middle of each — the layout gate passes it and it reads as a
 * placeholder. Boxes stop here and the row centres itself instead.
 */
const MAX_BOX_W = 430;
/**
 * The same judgement turned ninety degrees — see `need`. Two stages given the
 * whole column would be two slabs with a word in them.
 */
const MAX_BOX_H = 340;
/** Box height as a fraction of its own width, before content overrides it. */
const BOX_ASPECT = 0.9;
/**
 * Box bottom to the feedback leg, and the leg to its label.
 *
 * The label goes *below* the long leg, not above it. Above, it shares a band
 * with the two vertical legs, so a short hop leaves it a couple of hundred
 * pixels and the text comes out character-broken. Below the leg nothing else is
 * drawn at all, so the label gets the width it needs whatever the hop.
 */
const LOOP_TOP = 56;
const LOOP_LABEL_TOP = 18;
const LOOP_BOTTOM = 10;

export interface PipeLayout {
  /** Label type size. Never below `MIN_FONT`, whatever the labels cost. */
  size: number;
  /**
   * Position and extent along the flow axis: `x`/`w` read as x/width across a
   * row, and as y/height down a column. One field rather than two so the emitter
   * paints both arrangements with one expression — a second `rows` array is how
   * the landscape and portrait geometries drift apart.
   */
  boxes: Track[];
  /** The cross-axis extent every box shares: its height in a row, its width in a column. */
  boxH: number;
  boxX: number;
  boxW: number;
  /** True when the flow runs down the page. Decides every axis below it. */
  vertical: boolean;
  /** Width available to text inside a box — what every `wrap` here is given. */
  innerW: number;
  /** Wrapped lines per stage. The box height is derived from these, not guessed. */
  labelLines: string[][];
  noteLines: string[][];
  /** Box bottom to the feedback leg. Zero when there is no loop. */
  loopDrop: number;
  loopLines: string[];
  /** The loop's label column, and where it starts. Portrait only. */
  loopX: number;
  loopW: number;
  svgH: number;
}

/* ------------------------------------------------------ the portrait column */

/** Box to box. The arrow between them lives here, so it is not merely air. */
const V_GAP = 74;
/**
 * The same judgement as `MAX_BOX_H`, applied downwards. Four stages in a 1300px
 * portrait budget could have 300px each; at that height a box with two words in
 * it is a slab, and the row of them reads as a table rather than a flow.
 */
const V_BOX_H = 268;
/** Box's right edge to the return leg, and the leg to its label. */
const V_LOOP_SIDE = 56;
const V_LOOP_PAD = 18;

/**
 * The flow turned ninety degrees, for a canvas that is twice as tall as it is
 * wide.
 *
 * There is no `fitBoxes` here and no `k`-line search, because neither has
 * anything to solve: every box is the full column, so a label that needed three
 * balanced lines in a 250px share of a row sets on one. What is scarce in
 * portrait is height, so that is what is solved — the box grows to fill the
 * budget between `need` and `V_BOX_H`, rather than sitting at its content height
 * in the middle of 700px of nothing.
 */
function columnLayout(
  stageW: number,
  stageH: number,
  stages: readonly Stage[],
  loop?: Loop,
): PipeLayout {
  const count = stages.length;
  // The return path gets a channel of its own down the right, wide enough for
  // its label to set beside the leg. Running it *under* the column as landscape
  // does would put it below the last box, pointing back up past everything.
  const loopW = loop ? Math.max(240, Math.round(stageW * 0.32)) : 0;
  const boxX = M;
  const boxW = stageW - 2 * M - (loop ? V_LOOP_SIDE + V_LOOP_PAD + loopW : 0);

  // `textWidth` is linear in size, so the size at which the widest label exactly
  // fills the box is a division. It is almost never binding at this width.
  const unit = Math.max(1, ...stages.map((s) => textWidth(s.label, 1, 600)));
  const size = Math.max(MIN_FONT, Math.min(LABEL, Math.floor(boxW / (unit + 2 * PAD_X_EM))));
  const innerW = Math.max(size, boxW - 2 * PAD_X_EM * size);

  const labelLines = stages.map((s) => wrap(s.label, size, innerW, 600));
  const noteLines = stages.map((s) => (s.note ? wrap(s.note, NOTE, innerW, 400) : []));
  const need = Math.max(
    MIN_BOX_H,
    ...stages.map((_, i) => {
      const label = (labelLines[i]?.length ?? 1) * size * LABEL_LH;
      const note = noteLines[i]?.length ?? 0;
      return Math.ceil(2 * PAD_Y + label + (note > 0 ? NOTE_TOP + note * NOTE * NOTE_LH : 0));
    }),
  );
  const room = (stageH - 2 * M - (count - 1) * V_GAP) / count;
  // `need` outranks the budget: a box shorter than its own text is the one
  // failure a taller-than-the-canvas column is still better than.
  const boxH = Math.max(need, Math.min(room, V_BOX_H));

  return {
    size,
    boxes: Array.from({ length: count }, (_, i) => ({ x: M + i * (boxH + V_GAP), w: boxH })),
    boxH,
    boxX,
    boxW,
    vertical: true,
    innerW,
    labelLines,
    noteLines,
    loopDrop: 0,
    loopLines: loop ? wrap(loop.label, NOTE, loopW, 500) : [],
    loopX: boxX + boxW + V_LOOP_SIDE,
    loopW,
    svgH: 2 * M + count * boxH + (count - 1) * V_GAP,
  };
}

/**
 * Split a label into at most `k` word-groups of near-equal width.
 *
 * Only used to ask how wide a box must be if its label may take `k` lines. The
 * real breaks are made by `wrap` inside the box; greedy wrapping is optimal for
 * line count, so a box wide enough for this split never needs more than `k`.
 */
function balance(label: string, k: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  if (k <= 1 || words.length <= 1) return [label];
  const w = words.map((x) => textWidth(x, 1, 600));
  const share = w.reduce((a, b) => a + b, 0) / k;
  const lines: string[] = [];
  let cur: string[] = [];
  let run = 0;
  words.forEach((word, i) => {
    // Break once this line has taken its share, but never so late that a line
    // below it would be left with no words at all.
    if (
      cur.length > 0 &&
      lines.length < k - 1 &&
      run >= share &&
      words.length - i >= k - lines.length - 1
    ) {
      lines.push(cur.join(" "));
      cur = [];
      run = 0;
    }
    cur.push(word);
    run += w[i] ?? 0;
  });
  if (cur.length > 0) lines.push(cur.join(" "));
  return lines;
}

/** Centre of a stage's box. */
function centre(boxes: readonly Track[], i: number): number {
  const b = boxes[i];
  return b ? b.x + b.w / 2 : 0;
}

/**
 * How wide the loop's label may be set. It is centred between the two legs, so
 * the binding constraint is the nearer canvas edge: a short hop at the right of
 * the row would otherwise centre a wide block half off the slide.
 */
function loopLabelWidth(boxes: readonly Track[], from: number, to: number, stageW: number): number {
  const mid = (centre(boxes, from) + centre(boxes, to)) / 2;
  return Math.max(NOTE * 6, Math.min(stageW - 2 * M - 80, 2 * Math.min(mid, stageW - mid) - 40));
}

/** The widest of a label's lines — the string the box has to be sized against. */
function widest(lines: string[]): string {
  return lines.reduce((a, b) => (textWidth(b, 1, 600) > textWidth(a, 1, 600) ? b : a));
}

/**
 * Fit the row into `width`, centred in the canvas, with labels on `k` lines.
 *
 * A stage is represented by whichever of its two lines is wider — the note is
 * usually shorter than the label, but "192x192x3" is one unbreakable token and
 * fitting only the label leaves it a box it cannot fit in. Measuring the note at
 * the label's weight overstates it by 4%, which is the direction to be wrong in.
 */
function fitAt(stages: readonly Stage[], k: number, width: number, stageW: number) {
  return fitBoxes({
    labels: stages.map((s) => widest([...balance(s.label, k), ...balance(s.note ?? "", k)])),
    width,
    size: LABEL,
    gap: GAP,
    minGap: MIN_GAP,
    padEm: PAD_X_EM,
    weight: 600,
    x0: M + (stageW - 2 * M - width) / 2,
  });
}

/** More lines before smaller type: legibility is the constraint, height is not. */
function solve(stages: readonly Stage[], width: number, stageW: number) {
  let fit = fitAt(stages, 1, width, stageW);
  for (let k = 2; !fit.ok && k <= 3; k++) fit = fitAt(stages, k, width, stageW);
  return fit;
}

/**
 * All the geometry, with no SVG in sight.
 *
 * Exported because "the text stays inside the box" is the one thing this
 * archetype must never get wrong, and asserting it against numbers beats
 * asserting it against a rendered string.
 */
export function pipeLayout(stageW: number, stages: readonly Stage[], loop?: Loop): PipeLayout {
  const width = stageW - 2 * M;
  const capped = Math.min(width, stages.length * MAX_BOX_W + (stages.length - 1) * GAP);
  // Try the capped row first, and only spend the full canvas when the labels
  // actually need it — the cap is a preference, not a constraint.
  let fit = solve(stages, capped, stageW);
  if (!fit.ok && capped < width) fit = solve(stages, width, stageW);
  // Floor rather than round, so the box is never asked to hold type a fraction
  // wider than it was solved for. `fit.size` is already at or above the floor
  // whenever `fit.ok`; the clamp only matters for labels that cannot fit at all,
  // and those wrap harder rather than shrink.
  const size = Math.max(MIN_FONT, Math.floor(fit.size));
  const boxes = fit.boxes;
  const innerW = Math.max(size, (boxes[0]?.w ?? width) - 2 * PAD_X_EM * size);

  const labelLines = stages.map((s) => wrap(s.label, size, innerW, 600));
  const noteLines = stages.map((s) => (s.note ? wrap(s.note, NOTE, innerW, 400) : []));
  // The floor is a proportion of the box's own width, not a constant.
  //
  // A row of boxes tall enough for their own text is *correct*, and it is tiny:
  // the demo's four stages came out 190px tall inside a 912px content box — 49%
  // fill, with the diagram the smallest thing on a slide whose whole subject is
  // the diagram. Tying the floor to the width keeps the boxes in proportion at
  // any stage count, where a flat 340 would make six narrow stages into columns.
  const boxW = boxes[0]?.w ?? width;
  const need = Math.max(
    MIN_BOX_H,
    Math.min(MAX_BOX_H, boxW * BOX_ASPECT),
    ...stages.map((_, i) => {
      const label = (labelLines[i]?.length ?? 1) * size * LABEL_LH;
      const note = noteLines[i]?.length ?? 0;
      return Math.ceil(2 * PAD_Y + label + (note > 0 ? NOTE_TOP + note * NOTE * NOTE_LH : 0));
    }),
  );

  // The loop's own furniture has to come out of the budget before the boxes can
  // have the rest, and its label width depends on the boxes — but only on their
  // *x*, which is already fixed. So it can be measured first.
  const loopLines: string[] = loop
    ? wrap(loop.label, NOTE, loopLabelWidth(boxes, loop.from, loop.to, stageW), 500)
    : [];
  const below = loop
    ? LOOP_TOP + LOOP_LABEL_TOP + loopLines.length * NOTE * NOTE_LH + LOOP_BOTTOM
    : M;

  const boxH = need;

  return {
    size,
    boxes,
    boxH,
    boxX: M,
    boxW: boxes[0]?.w ?? width,
    vertical: false,
    innerW,
    labelLines,
    noteLines,
    loopDrop: loop ? LOOP_TOP : 0,
    loopLines,
    loopX: 0,
    loopW: 0,
    svgH: M + boxH + below,
  };
}

export const pipeline: Emitter<"pipeline"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const last = p.stages.length - 1;

  // `from` defaults to the last stage, which is the plain end-to-start loop.
  //
  // A SELF-LOOP IS LEGAL AND IS DRAWN AS ONE. `to === from` means "this stage
  // ticks on itself", which is a real and common claim — it is exactly what the
  // demo's DQ-CTM stage asserts, and what its beat's own intent says: "the
  // recurrence sits after the encoder, not around it".
  //
  // This used to clamp `to` to `from - 1` and draw the arrow onto the PREVIOUS
  // box. The deck then said the recurrence spans Window→DQ-CTM, which is the
  // opposite of what the paper claims and of what the storyboard asked for, and
  // it shipped that way with every gate green — the tenth case in this project
  // of green gates over wrong output. Silently substituting a different claim is
  // worse than refusing to draw: a missing arrow is visible, a wrong one is not.
  //
  // An inverted pair (`to > from`, and not equal) is still a planner error with
  // no sensible reading, so it draws nothing rather than inventing a direction.
  const loop = (() => {
    if (!p.loop) return undefined;
    const from = Math.min(Math.max(0, p.loop.from ?? last), last);
    // Out of range is a planner error with no honest reading — folding it onto
    // the nearest stage is how the demo came to draw the wrong claim. Nothing is
    // drawn, the beat keeps its other content, and the missing arrow is visible.
    if (p.loop.to < 0 || p.loop.to > last || p.loop.to > from) return undefined;
    return { from, to: p.loop.to, label: p.loop.label, self: p.loop.to === from };
  })();
  /** The stage's box: the content width the shell's padding leaves. */
  const W = contentW(ctx.format);
  // Portrait is a different arrangement, not the same one squeezed: at 1080 wide
  // a four-stage row gives each box ~170px, which is narrower than the words in
  // it. See `columnLayout`.
  const tall = isPortrait(ctx.format);
  const L = tall
    ? columnLayout(
        W,
        bodyBudget(
          ctx.format,
          p.eyebrow,
          p.headline,
          noteHeight(p.note, noteWidth(ctx.format), 36),
          38,
        ),
        p.stages,
        loop,
      )
    : pipeLayout(W, p.stages, loop);

  /** Cross-axis centre of the row/column — the spine every connector sits on. */
  const spine = L.vertical ? L.boxX + L.boxW / 2 : M + L.boxH / 2;
  /** Centre of stage `i` along the flow axis. */
  const cx = (i: number) => {
    const b = L.boxes[i];
    return b ? b.x + b.w / 2 : 0;
  };
  /** Stage `i`'s box, in whichever direction the flow runs. */
  const boxOf = (i: number) => {
    const b = L.boxes[i] ?? { x: M, w: 0 };
    return L.vertical
      ? { x: L.boxX, y: b.x, w: L.boxW, h: b.w }
      : { x: b.x, y: M, w: b.w, h: L.boxH };
  };

  // What a camera aimed at `stageN` would land on. Written in the same loop that
  // gives the group its id, so the label and the index it is filed under cannot
  // drift apart. See `Scene.parts`.
  const parts: Record<string, string> = {};

  const stages = p.stages.map((stage, i) => {
    parts[`stage${i}`] = stage.label;
    const box = boxOf(i);
    const tone = stage.tone ? theme.tones[stage.tone] : undefined;
    // A toned stage is the slide's focal point, so it takes the only saturated
    // fill in the row. 12% over the deck's near-black reads as a tint, not a
    // second background.
    const shell = tone
      ? roundRect(box, R, { fill: tone, "fill-opacity": "0.12", stroke: tone, "stroke-width": 4 })
      : roundRect(box, R, { fill: theme.panel, stroke: theme.rule, "stroke-width": 3 });

    const labelH = (L.labelLines[i]?.length ?? 1) * L.size * LABEL_LH;
    const noteCount = L.noteLines[i]?.length ?? 0;
    const noteH = noteCount > 0 ? NOTE_TOP + noteCount * NOTE * NOTE_LH : 0;
    const top = box.y + (box.h - labelH - noteH) / 2;

    const label = text(
      stage.label,
      { x: box.x + box.w / 2, y: top + labelH / 2 },
      {
        size: L.size,
        weight: 600,
        fill: tone ?? theme.fg,
        anchor: "middle",
        maxWidth: L.innerW,
        lineHeight: LABEL_LH,
        vAlign: "middle",
      },
    );
    const note =
      noteCount > 0 && stage.note
        ? text(
            stage.note,
            { x: box.x + box.w / 2, y: top + labelH + NOTE_TOP + (noteH - NOTE_TOP) / 2 },
            {
              size: NOTE,
              fill: theme.muted,
              anchor: "middle",
              maxWidth: L.innerW,
              lineHeight: NOTE_LH,
              vAlign: "middle",
            },
          )
        : "";
    return group([shell, label, note], { id: id(sid, "stage", i) });
  });

  /**
   * Each connector, and the route the pulse rides along it.
   *
   * Kept as one list rather than two maps because the pulse's route IS the
   * arrow's geometry: computing it twice is how a pulse ends up travelling
   * beside its own arrow after someone edits the inset.
   */
  const links = p.stages.slice(1).flatMap((_, i) => {
    const a = L.boxes[i];
    const b = L.boxes[i + 1];
    if (!a || !b) return [];
    // `inset` pulls the shaft back so the head stops short of the next box
    // instead of sitting on its stroke.
    const from = L.vertical ? { x: spine, y: a.x + a.w } : { x: a.x + a.w, y: spine };
    const to = L.vertical ? { x: spine, y: b.x } : { x: b.x, y: spine };
    return [{ i, from, to }];
  });

  const connectors = links.map((l) =>
    arrow(sid, l.from, l.to, {
      stroke: theme.muted,
      width: 5,
      inset: 8,
      id: id(sid, "arrow", l.i),
    }),
  );

  /**
   * What travels the arrow: one dot per connector, parked at the arrow's tail
   * and invisible until its own leg of the reveal.
   *
   * ONE PER ARROW, because `travel` writes the element's `x`/`y` from a single
   * immediate render and a second route on the same dot would start from the
   * first route's end. The dot is drawn at the tail in document coordinates,
   * so its `from` transform is the identity and a build that never runs the
   * tween still has it in the right place.
   */
  const pulses = links.map((l) =>
    circle(l.from, PULSE_R, {
      id: id(sid, "pulse", l.i),
      fill: theme.tones.a ?? theme.fg,
      opacity: "0",
    }),
  );

  // The return path is the one thing on the slide that moves against the read
  // direction, so it gets the one warm colour and a dashed stroke.
  const loopColour = theme.tones.b;
  let loopSvg = "";
  /** How far the clip travels, and on which axis. Both are zero without a loop. */
  let sweep = 0;
  if (loop) {
    // Landscape drops the return under the row; portrait takes it up a channel on
    // the right, because "under the column" is past the last box and would point
    // back up through everything below it.
    const edge = L.vertical ? L.boxX + L.boxW : M + L.boxH;
    const via = L.vertical ? L.loopX : edge + L.loopDrop;
    const labelBlock = L.loopLines.length * NOTE * NOTE_LH;
    const label = text(
      loop.label,
      L.vertical
        ? { x: L.loopX + V_LOOP_PAD, y: (cx(loop.from) + cx(loop.to)) / 2 }
        : {
            x: (cx(loop.from) + cx(loop.to)) / 2,
            y: via + LOOP_LABEL_TOP + labelBlock / 2,
          },
      {
        size: NOTE,
        weight: 500,
        fill: loopColour,
        anchor: L.vertical ? "start" : "middle",
        maxWidth: L.vertical
          ? L.loopW
          : loop.self
            ? (L.boxes[loop.from]?.w ?? W / 3)
            : loopLabelWidth(L.boxes, last, loop.to, W),
        lineHeight: NOTE_LH,
        vAlign: "middle",
      },
    );
    // A self-loop leaves one side of its box and returns to the other, so the two
    // endpoints are offset around the SAME centre rather than sitting on two
    // boxes. Without a span the elbow would be a zero-width line straight down
    // and back, which reads as a dropped stroke rather than a loop.
    const selfSpan = loop.self ? Math.min((L.boxes[loop.from]?.w ?? 200) * 0.55, 180) : 0;
    const leaveAt = cx(loop.from) + selfSpan / 2;
    const landAt = cx(loop.to) - selfSpan / 2;
    const route = elbow(
      sid,
      L.vertical ? { x: edge, y: leaveAt } : { x: leaveAt, y: edge },
      L.vertical ? { x: edge, y: landAt } : { x: landAt, y: edge },
      {
        stroke: loopColour,
        width: 4,
        dash: LOOP_DASH,
        inset: 10,
        via,
        id: id(sid, "loop"),
        // "h" leaves and arrives horizontally, so the long leg runs down the
        // channel at `via`; "v" is the landscape shape, under the row.
        axis: L.vertical ? "h" : "v",
        radius: 22,
      },
    );
    // The sweep only has to cover the loop's own bounds — route and label, which
    // on a short hop is wider than the route. Sizing it to the whole canvas would
    // spend a third of the tween revealing empty space.
    const mid = (cx(loop.from) + cx(loop.to)) / 2;
    // A SELF-LOOP's two endpoints are `selfSpan` apart around one centre, so
    // `cx(from) === cx(to)` and the ±30 below covers nothing: the route reaches
    // `selfSpan / 2` either side of `mid`, a distance with no relation to how
    // wide the label is. Sizing the sweep from the label alone therefore clips
    // the elbow, and since the clip is where the tween ENDS the loop can never
    // finish drawing — both corners and the arrowhead are gone for good. In
    // `short-9x16` that is the whole loop: a 72px band over a 147px route left a
    // dashed stub floating beside the box, with every gate green. Landscape
    // escaped only because "one thought tick" is wider than the span it labels.
    // 16 clears the 4px stroke and the arrow marker.
    const routeHalf = loop.self ? selfSpan / 2 + 16 : 0;
    const half = Math.max(
      routeHalf,
      L.vertical
        ? labelBlock / 2 + 10
        : Math.max(...L.loopLines.map((l) => textWidth(l, NOTE, 500)), 0) / 2 + 10,
    );
    const span = L.vertical ? L.svgH : W;
    const a0 = Math.max(0, Math.min(cx(loop.to) - 30, mid - half));
    sweep = Math.min(span, Math.max(cx(loop.from) + 30, mid + half)) - a0;
    const clip = L.vertical
      ? { x: 0, y: a0, w: W, h: sweep }
      : { x: a0, y: 0, w: sweep, h: L.svgH };
    loopSvg =
      `<defs><clipPath id="${id(sid, "loopclip")}">` +
      `${rect(clip, { id: id(sid, "sweep") })}` +
      `</clipPath></defs>` +
      group([route, label], { "clip-path": `url(#${id(sid, "loopclip")})` });
  }

  const body = [
    arrowDefs(sid, loop ? [theme.muted, loopColour] : [theme.muted]),
    loopSvg,
    ...connectors,
    ...stages,
    // After the stages: the dot rides OVER the boxes it is arriving at, which
    // is what makes it read as the thing being handed along.
    ...pulses,
  ].join("");

  const note = p.note ? `\n<div class="pipenote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, W)}
<div class="pipewrap">${svg(id(sid, "pipe"), W, L.svgH, body)}</div>${note}`;

  /* ------------------------------------------------------------- the reveal */

  const t0 = 1.0;
  // Fill the beat rather than always racing: a two-stage pipeline gets room to
  // breathe, a six-stage one stays inside its own seconds.
  const step = Math.min(1.4, Math.max(0.55, (beat.seconds - 2.8) / p.stages.length));
  const tl = [...chromeIn(sid, p.eyebrow !== undefined)];
  const holds: number[] = [];

  // The light follows the flow: as each stage lands, the one behind it steps
  // back to DIM, so the box being spoken about is the only one at full weight.
  // `dim` mode, not `lit`: the stages arrive one at a time, and dimming a
  // stage that has not entered yet would fight its own entrance.
  const spot = spotlighter(sid);

  p.stages.forEach((_, i) => {
    const at = t0 + i * step;
    const link = links.find((l) => l.i === i - 1);
    if (i > 0) {
      tl.push(
        tween(
          `#${id(sid, "arrow", i - 1)}`,
          { opacity: 0, x: -18 },
          { opacity: 1, x: 0, duration: 0.32, ease: "power2.out" },
          at - 0.3,
        ),
      );
    }
    if (link) {
      // The dot leaves the box behind as the arrow finishes arriving and lands
      // exactly when the next box pops, so the pop reads as the arrival of the
      // thing that travelled rather than as a second, unrelated entrance.
      const rides = 0.28;
      const leaves = at - rides;
      tl.push(
        tween(
          `#${id(sid, "pulse", link.i)}`,
          { opacity: 0 },
          { opacity: 1, duration: 0.1 },
          leaves,
        ),
        // RELATIVE to where the dot is drawn. `travel` writes `x`/`y`, which on
        // an SVG element is a TRANSFORM and adds to the `cx`/`cy` already in the
        // markup: handing it the arrow's absolute endpoints put the dot at twice
        // its own offset, 159px below the arrow it was supposed to ride, with
        // every gate green and every test passing. Found by looking at a frame.
        ...travel(
          `#${id(sid, "pulse", link.i)}`,
          [
            { x: 0, y: 0 },
            { x: link.to.x - link.from.x, y: link.to.y - link.from.y },
          ],
          leaves,
          rides,
        ),
        tween(
          `#${id(sid, "pulse", link.i)}`,
          { opacity: 1 },
          { opacity: 0, duration: 0.18, immediateRender: false },
          at,
        ),
      );
    }
    const box = boxOf(i);
    const origin = `${nv(box.x + box.w / 2)} ${nv(box.y + box.h / 2)}`;
    tl.push(
      tween(
        `#${id(sid, "stage", i)}`,
        { opacity: 0, y: 24, scale: 0.92, svgOrigin: origin },
        { opacity: 1, y: 0, scale: 1, svgOrigin: origin, duration: 0.5, ease: "power2.out" },
        at,
      ),
    );
    // NO LIFT HERE, and it was tried: `pipeLayout` solves the boxes to fill the
    // content width, so there is no room to grow one — 3% of a 383px box is
    // 11px past an edge with 2px of margin, and `container_overflow` reported
    // exactly that on the last stage. The dim carries the emphasis instead.
    if (i > 0) tl.push(...spot.dim(`stage${i - 1}`, at + 0.1));
    holds.push(at + 0.55);
  });

  let end = t0 + last * step + 0.55;
  if (loop) {
    const at = end + 0.25;
    // The clip starts displaced along the flow's own return direction and slides
    // back to rest, so the path appears travelling the way it runs: leftwards
    // across a row, upwards along a column.
    const axis = L.vertical ? "y" : "x";
    tl.push(
      tween(
        `#${id(sid, "sweep")}`,
        { [axis]: nv(sweep) },
        { [axis]: 0, duration: 0.9, ease: "power2.inOut" },
        at,
      ),
      // And the dashes run while it is revealed. Exactly ONE period, linearly:
      // the pattern at the end is the pattern at the start, so the tween can
      // stop dead at a hold without a visible jump, and `ease: "none"` is what
      // makes a flow read as a flow rather than as a nudge.
      tween(
        `#${id(sid, "loop")}`,
        { strokeDashoffset: LOOP_PERIOD },
        { strokeDashoffset: 0, duration: 0.9, ease: "none" },
        at,
      ),
    );
    end = at + 1.0;
    holds.push(end);
  }
  if (p.note) {
    const at = end + 0.15;
    tl.push(tween(`#${sid}-note`, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, at));
    holds.push(at + 0.6);
  }
  // The whole row comes back for the last hold: the beat ends on the pipeline
  // as one thing, and a deck that leaves five of six boxes at 0.62 has spent
  // its final seconds saying "look here" about a slide nobody is reading.
  if (p.stages.length > 1) tl.push(...spot.restore(end + (p.note ? 0.15 : 0)));

  // The last toned stage if there is one, else the stage the flow ends on —
  // either way the box still being spoken to at the final hold. Its entrance
  // owns `opacity` and `y`, so the breath takes `filter`.
  const focus = p.stages.reduce((acc, s, i) => (s.tone ? i : acc), last);

  return {
    html,
    parts,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".pipewrap{margin-top:38px;display:flex;justify-content:center}",
      noteCss("pipenote", theme, 36),
      ambient(sid, `-stage${focus}`, BREATHE),
    ].join("\n"),
  };
};

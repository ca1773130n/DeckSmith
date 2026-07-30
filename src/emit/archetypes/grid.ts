/**
 * A field, and the windows that move over it.
 *
 * Attention spans, receptive fields, patches, pooling kernels, token sequences —
 * every paper draws these as a rectangle over a lattice, and every slide deck
 * then writes "8x8 shifted windows" in a bullet and calls it explained. The
 * content of the idea is *which cells* and *how many of them*, and a sentence
 * cannot show that; a lattice with the rectangle lit on it shows nothing else.
 *
 * Everything here is solved from the box that is actually free after the chrome
 * and the note, so a 24x16 feature map and a 2x1 pair of patches are the same
 * code. A constant cell size would be right for one grid and wrong for the other
 * twenty-three, and nobody would ever find out which.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc } from "../kit.js";
import type { Box } from "../svg.js";
import {
  drawFrom,
  group,
  id,
  line,
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
  noteCss,
  noteHeight,
  noteWidth,
  tween,
} from "./title.js";

/** One notch above `MIN_FONT`. Region labels are the audience text on this slide. */
const LABEL = 42;
const LH = 1.25;
/** Breathing room between a region's edge and its own label. */
const PAD = 16;
/** Cell gap as a fraction of the cell, so `cell + gap` stays one unknown. */
const GAP = 0.14;
/**
 * Past this a cell stops reading as one square in a lattice and starts reading
 * as a panel. Without it the smallest legal grid — 2x1 — fills 1700x800 with two
 * slabs, which is arithmetically correct and is not a field.
 */
const CELL_MAX = 280;
/**
 * A region's outline is centred on the field's edge, so half of it lies outside
 * the field. The frame carries that much on every side — without it a region in
 * row 0 loses its top stroke to the svg's own clip, which nothing reports.
 */
const MARGIN = 6;
/**
 * A gutter label wraps to at most this. Four labels four lines deep do not fit
 * the frame's height however politely they are stacked, and a stack that
 * overflows is worse than a gutter that is wide.
 */
const MAX_LINES = 2;
const FIELD_TOP = 52;

interface Field {
  cell: number;
  gap: number;
  w: number;
  h: number;
}

type Region = { x: number; y: number; w: number; h: number; label: string };

export const grid: Emitter<"grid"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  for (const r of p.regions) {
    // A region past the edge draws outside the field and, for a big enough
    // overshoot, outside the canvas. Refusing is the call `data-table` makes for
    // a highlight matching no row: the params name something that is not there.
    if (r.x + r.w > p.cols || r.y + r.h > p.rows) {
      throw new Error(
        `grid: region "${r.label}" (${r.x},${r.y} ${r.w}x${r.h}) falls outside the ${p.cols}x${p.rows} field`,
      );
    }
  }

  /** The scene's content width — the format's, less the shell's side padding. */
  const W = contentW(ctx.format);

  // The field takes exactly what the chrome and the note leave, measured rather
  // than guessed: a two-line headline over a three-line note costs 300px more
  // than a one-line pair, and a constant that clears the worst case throws that
  // away in every other. The field is height-bound in nearly every real grid, so
  // this is the number that decides how big the diagram is.
  //
  // `wrap` errs wide, so it over-counts lines rather than under-counting them —
  // the safe direction, since an under-count overflows the canvas.
  const budget = bodyBudget(
    ctx.format,
    p.eyebrow,
    p.headline,
    noteHeight(p.note, noteWidth(ctx.format)),
    FIELD_TOP,
  );

  /**
   * Square cells mean one unknown: `cell + gap = cell * (1 + GAP)`, so N cells
   * span `cell * (N + GAP * (N - 1))`. Take whichever axis runs out first.
   */
  const solve = (boxW: number): Field => {
    const cell = Math.min(
      CELL_MAX,
      (boxW - 2 * MARGIN) / (p.cols + GAP * (p.cols - 1)),
      (budget - 2 * MARGIN) / (p.rows + GAP * (p.rows - 1)),
    );
    const gap = cell * GAP;
    return {
      cell,
      gap,
      w: p.cols * cell + (p.cols - 1) * gap,
      h: p.rows * cell + (p.rows - 1) * gap,
    };
  };

  const innerW = (f: Field, w: number) => w * f.cell + (w - 1) * f.gap - 2 * PAD;

  /** Does the label set inside the region itself, or does it need the gutter? */
  const fitsInside = (f: Field, r: Region): boolean => {
    const bw = innerW(f, r.w);
    const bh = r.h * f.cell + (r.h - 1) * f.gap - 2 * PAD;
    if (bw <= 0 || bh <= 0) return false;
    // `wrap` breaks mid-word when it must, so a returned line can still be wider
    // than the ask when a single glyph does not fit. Measure the result.
    const lines = wrap(r.label, LABEL, bw, 700);
    if (Math.max(...lines.map((l) => textWidth(l, LABEL, 700))) > bw) return false;
    return lines.length * LABEL * LH <= bh;
  };

  /**
   * Two regions that share cells cannot both keep their label inside them: the
   * second is drawn over the first, over both tints, and is unreadable — which
   * is what a shifted window, a stride, or a pair of nested receptive fields
   * always looks like. Overlap is the *point* of this archetype more often than
   * not, so it is the common case rather than the corner one, and the answer is
   * the gutter that already exists for labels too big to sit inside.
   */
  const hits = (a: Region, b: Region) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const crowded = p.regions.map((r, i) => p.regions.some((o, k) => k !== i && hits(r, o)));

  const bare = solve(W);
  // Sized from the widest label over *every* region, not only the ones that
  // missed at pass one: reserving the gutter shrinks the cells, which can push a
  // further region out, and a gutter able to grow a second time never settles.
  const widest = Math.max(...p.regions.map((r) => textWidth(r.label, LABEL, 600)));
  /** Column width at which no label wraps at all, and at which none wraps past `MAX_LINES`. */
  const oneLine = Math.min(620, widest * 1.06);
  const wrapped = Math.min(620, (widest / MAX_LINES) * 1.12);

  // A label that fits inside its own region stays there, however much width the
  // field left over. Moving both of the demo's out to a free right-hand gutter
  // was measured: it filled the band and drew two 900px leaders straight across
  // the lattice to do it, which is more ink for less meaning. The gutter is a
  // remedy, not a use for spare canvas.
  const free = W - bare.w - 2 * MARGIN;
  const needsGutter = p.regions.some((r, i) => crowded[i] || !fitsInside(bare, r));
  // Floored at what the labels need rather than at a flat 220: the old floor was
  // what made a 42px label wrap with ~350px of gutter sitting unused
  // (EXPERIMENT-006, "Known, not fixed"). Given the room, every label gets one line.
  const lw = needsGutter ? Math.max(wrapped, Math.min(oneLine, free - 90)) : 0;
  const gutter = needsGutter ? lw + 90 : 0;
  const f = needsGutter ? solve(W - gutter) : bare;

  /** Which labels the gutter has to carry. Fixed by `f`, so it settles here. */
  const inGutter = p.regions.map((r, i) => crowded[i] || !fitsInside(f, r));
  const lines = (r: Region) => wrap(r.label, LABEL, lw, 600).length;
  const stackH = p.regions
    .filter((_, i) => inGutter[i])
    .reduce((t, r, i) => t + lines(r) * LABEL * LH + (i > 0 ? 14 : 16), 0);

  // The frame hugs whatever it ended up holding rather than keeping the whole
  // budget. A 2x1 field left in an 800px frame is centred inside the frame and
  // therefore *not* centred on the slide — it reads as having drifted down from
  // a headline it is no longer attached to. Shrinking the frame hands the
  // centring back to the scene, which centres the composition as one block.
  const H = Math.min(budget, Math.max(f.h + 2 * MARGIN, stackH));

  // Flush left, on the eyebrow's and the headline's own spine. Centring it in
  // whatever the gutter left read as a mistake — every other element on the slide
  // starts at the same x and the diagram did not — and it measured worse as well
  // as looking worse (EXPERIMENT-006, 67.7% → 66.8%). The width the field does
  // not want now goes to the gutter rather than to a pair of even margins.
  const fx = MARGIN;
  const fy = (H - f.h) / 2;
  // One source for the pitch: rows read a `Track`'s `x`/`w` as `y`/`h`, which is
  // the same arithmetic and is why `tracks` exists rather than being inlined.
  const cols = tracks(f.w, p.cols, f.gap, fx);
  const rows = tracks(f.h, p.rows, f.gap, fy);

  const corner = Math.min(10, f.cell * 0.12);
  // Row-major, so the timeline's `grid:` stagger walks the field the way a
  // reader does.
  const cells = rows
    .flatMap((row) =>
      cols.map((col) =>
        roundRect({ x: col.x, y: row.x, w: col.w, h: row.w }, corner, { class: "gcell" }),
      ),
    )
    .join("");

  const stroke = Math.max(3, Math.min(6, f.cell * 0.16));

  // The bounds check above makes the fallbacks unreachable; they exist because
  // an out-of-range index is `undefined` under `noUncheckedIndexedAccess`.
  const boxOf = (r: Region): Box => {
    const c0 = cols[r.x] ?? { x: fx, w: f.cell };
    const y0 = rows[r.y] ?? { x: fy, w: f.cell };
    // Grown by a share of the gap so the highlight reads as enclosing the cells
    // rather than sitting on them, less the half-outline the margin is already
    // spending — together they are what has to fit inside the frame.
    const bleed = Math.max(0, Math.min(f.gap * 0.35, fx - stroke / 2, fy - stroke / 2));
    return {
      x: c0.x - bleed,
      y: y0.x - bleed,
      w: r.w * c0.w + (r.w - 1) * f.gap + 2 * bleed,
      h: r.h * y0.w + (r.h - 1) * f.gap + 2 * bleed,
    };
  };

  const boxes = p.regions.map(boxOf);

  /** Perimeter of the rounded outline, so the draw-on needs no `getTotalLength`. */
  const perimeter = (b: Box): number => {
    const rr = Math.min(corner, b.w / 2, b.h / 2);
    return 2 * (b.w - 2 * rr) + 2 * (b.h - 2 * rr) + 2 * Math.PI * rr;
  };

  const lx = W - gutter + 40;
  const outside = p.regions
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => inGutter[i])
    .map(({ r, i }) => {
      const b = boxes[i] ?? { x: fx, y: fy, w: f.cell, h: f.cell };
      const half = (lines(r) * LABEL * LH) / 2;
      return { i, half, y: b.y + b.h / 2, from: { x: b.x + b.w, y: b.y + b.h / 2 } };
    })
    .sort((a, b) => a.y - b.y || a.i - b.i);

  // Two windows on the same rows ask for the same label y. Push the stack apart
  // and slide it back inside the frame: without this the second label lands on
  // the first, which passes every gate and is unreadable.
  let floor = 8;
  for (const o of outside) {
    o.y = Math.max(o.y, floor + o.half);
    floor = o.y + o.half + 14;
  }
  const spill = floor - 14 - (H - 8);
  if (spill > 0) for (const o of outside) o.y = Math.max(o.half + 8, o.y - spill);
  const outById = new Map(outside.map((o) => [o.i, o]));

  const rects: string[] = [];
  const leads: string[] = [];
  const labels: string[] = [];
  const leadLen: number[] = [];

  p.regions.forEach((r, i) => {
    const b = boxes[i] ?? { x: fx, y: fy, w: f.cell, h: f.cell };
    const tone = theme.tones[r.tone];
    rects.push(
      roundRect(b, corner, {
        class: "grgn",
        id: id(sid, "rgn", i),
        fill: tone,
        stroke: tone,
        "stroke-width": n(stroke),
      }),
    );
    const out = outById.get(i);
    if (out) {
      const to = { x: lx - 16, y: out.y };
      leadLen.push(Math.hypot(to.x - out.from.x, to.y - out.from.y));
      leads.push(line(out.from, to, { class: "glead", id: id(sid, "lead", i), stroke: tone }));
      labels.push(
        text(
          r.label,
          { x: lx, y: out.y },
          {
            size: LABEL,
            fill: tone,
            weight: 600,
            maxWidth: lw,
            lineHeight: LH,
            vAlign: "middle",
            class: "grlab",
            id: id(sid, "lab", i),
          },
        ),
      );
      return;
    }
    leadLen.push(0);
    labels.push(
      text(
        r.label,
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        {
          size: LABEL,
          fill: tone,
          weight: 700,
          anchor: "middle",
          maxWidth: innerW(f, r.w),
          lineHeight: LH,
          vAlign: "middle",
          class: "grlab",
          id: id(sid, "lab", i),
        },
      ),
    );
  });

  const field = svg(
    id(sid, "field"),
    W,
    H,
    group(cells, { class: "gcells" }) + group(rects) + leads.join("") + labels.join(""),
  );
  const note = p.note ? `\n<div class="gdnote" id="${id(sid, "note")}">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, W)}
<div class="gwrap">${field}</div>${note}`;

  // The empty field first, fast and low-contrast: it is the thing being operated
  // on, not the point, and it has to be there before a window can mean anything.
  const drawn = 1.6;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid} .gcell`,
      // transformOrigin belongs in BOTH halves. Declared only in the `to` vars it
      // is an origin *change*, which GSAP's smoothOrigin absorbs with a translate
      // that never unwinds: the cells came to rest 8.08px up-left of the field,
      // 2.08px outside the svg, and the layout gate caught it at a hold.
      { opacity: 0, scale: 0.72, transformOrigin: "center" },
      {
        opacity: 1,
        scale: 1,
        transformOrigin: "center",
        duration: 0.35,
        ease: "power2.out",
        stagger: { amount: 0.55, grid: [p.rows, p.cols], from: "start" },
      },
      0.7,
    ),
  ];
  const holds = [drawn];

  const first = drawn + 0.15;
  const step = Math.min(1.2, Math.max(0.6, (beat.seconds - first - 1.3) / p.regions.length));
  p.regions.forEach((_, i) => {
    const at = first + i * step;
    const len = perimeter(boxes[i] ?? { x: 0, y: 0, w: 0, h: 0 });
    tl.push(
      tween(
        `#${id(sid, "rgn", i)}`,
        drawFrom(len),
        { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" },
        at,
      ),
      tween(
        `#${id(sid, "rgn", i)}`,
        { fillOpacity: 0 },
        { fillOpacity: 0.18, duration: 0.45 },
        at + 0.35,
      ),
    );
    if (outById.has(i)) {
      const len2 = leadLen[i] ?? 0;
      tl.push(
        tween(
          `#${id(sid, "lead", i)}`,
          drawFrom(len2),
          { strokeDashoffset: 0, duration: 0.35, ease: "none" },
          at + 0.3,
        ),
      );
    }
    tl.push(
      tween(
        `#${id(sid, "lab", i)}`,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.45 },
        at + 0.45,
      ),
    );
    holds.push(at + 0.9);
  });

  if (p.note) {
    const at = first + p.regions.length * step;
    tl.push(tween(`#${id(sid, "note")}`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".gwrap{margin-top:52px}",
      `.gcell{fill:${theme.panel};stroke:${theme.rule};stroke-width:1}`,
      // `fill-opacity` and the dash offset are what the reveal animates; the
      // stylesheet holds the pre-reveal state so a still render is a bare field.
      ".grgn{fill-opacity:0;stroke-linejoin:round}",
      // Subordinate to both the region it leaves and the label it arrives at: a
      // leader that competes with them is a line across the diagram for nothing.
      ".glead{stroke-width:3;stroke-linecap:round;opacity:.62}",
      noteCss("gdnote", theme),
      // The last region is the one still being spoken to at the final hold. Its
      // entrance owns the dash and the fill, so the breath takes `filter`.
      ambient(sid, `-rgn${p.regions.length - 1}`, BREATHE),
    ].join("\n"),
  };
};

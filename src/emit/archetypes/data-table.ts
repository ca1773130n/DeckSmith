/**
 * A table from the source, revealed row by row, then read for the viewer: the
 * highlighted rows light up in the order the argument needs them.
 *
 * Nothing here invents numbers, and nothing here drops them SILENTLY: every row
 * the beat names is drawn, at 40px or above, or the beat is refused. The type
 * is solved from the WIDTH — upwards from the 40px floor, capped — and the height
 * rule then asks whether those rows, drawn at that size, fit on the canvas. The
 * one lever the height rule owns is the row padding, and it is already shut to
 * `PAD_Y_MIN` whenever this refuses, so "will not fit" is a measurement of this
 * slide rather than a preference about it.
 *
 * `params.rows` NAMES A SUBSET, because real tables are longer than a slide
 * holds and the previous answer to that — cite one column in bar-compare — is
 * measurably why tables went uncited: a document with seven of them was planned
 * twice and drew none. A subset is drawn in the SOURCE's row order, and the
 * slide states in its own words how many rows it left out, at the same 40px the
 * note is set at. THAT LINE IS THE POINT OF THE FEATURE. A table quietly showing
 * five of twenty rows is a lie no gate here can see — `lint`, `check`, the type
 * floor and `drift` all pass a well-formed slide that misrepresents its source —
 * and this project has six recorded cases of green gates over wrong output.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: buy rows by taking the type back down toward
 * 40. That would be legal — invariant 5 is a floor, not a fixed size, and a table
 * declined here at 52px would often fit at 40 — but it makes `cell` solve two
 * constraints at once, and the width solve is the one that has been measured. So
 * the refusal names the size it refused AT, and the choice stays visible to
 * whoever reads the error instead of being buried in this file.
 */
import type { Table } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentW, esc, mathy, PAD_Y, spotlighter } from "../kit.js";
import { MIN_FONT, textWidth } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  BODY_SIZE,
  bodyBudget,
  chrome,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  noteHeight,
  noteWidth,
  tween,
} from "./title.js";

/** Cell padding, per side. Doubles as the minimum channel between two columns. */
const CELL_PAD = 14;
/** Largest cell type. Past this a five-row table reads as a menu rather than data. */
const CELL_MAX = 52;
/**
 * `th` letter-spacing, in em. ONE constant because the width solve and the CSS
 * have to agree: the solve read 0 while the CSS drew .04em, and a column whose
 * heading is its widest cell was solved that much short.
 */
const TH_TRACKING = 0.04;

/**
 * Largest row padding, per side, by orientation.
 *
 * 40 is right for 912px of box: a five-row table at 52px type then stands about
 * 850 tall and fills it. Portrait has 1752 and the same five rows, so the cap
 * bound at 40 and left 370px of the box empty under a table banded across its
 * middle. 68 is the pitch that spends it — a row is then 204px tall against
 * 52px type, which on a phone is the rhythm of a list you can actually track a
 * finger down, and it is a cap rather than a target so a ten-row table still
 * closes up to 12.
 */
const PAD_Y_MAX = { wide: 40, tall: 68 };

/**
 * Tightest row padding, per side. The other floor: below this the rules between
 * rows stop reading as a table and start reading as a wall of digits, so the
 * height a table NEEDS is settled by `MIN_FONT` and this together.
 */
const PAD_Y_MIN = 12;

/**
 * The rules between rows, in px — the one under the head and the one under each
 * body row.
 *
 * Declared rather than written twice because they are BOTH stylesheet and
 * arithmetic: `border-collapse:collapse` makes each rule part of the height its
 * row occupies, so a table of eleven rows stands eleven-ish px taller than its
 * type and padding alone predict. That is the difference between drawing 24 rows
 * at 9:16 and drawing them 11px off the canvas, and `kit.ts` has already named
 * the hazard of a stylesheet that disagrees with the arithmetic reading it.
 */
const RULE_HEAD = 2;
const RULE_ROW = 1;

/**
 * The rows a beat named, in the SOURCE's order.
 *
 * Source order rather than the order they were named in, because a table's row
 * order is part of what the table says — an ablation runs in the order it was
 * run — and the order the ARGUMENT wants is already carried by `highlight`,
 * which lights the rows one at a time in whatever sequence it likes.
 *
 * A name that matches nothing throws, in the same words a dangling
 * `highlight[].row` throws in, for the same reason: a row cited and not drawn is
 * a pointer at something the viewer never sees, and it looks fine in every gate.
 */
function subset(who: string, table: Table, named: readonly string[]): string[][] {
  for (const label of named) {
    if (!table.rows.some((row) => row[0] === label)) {
      throw new Error(`${who}: no row labelled "${label}" in table ${table.id}`);
    }
  }
  return table.rows.filter((row) => named.some((label) => row[0] === label));
}

/**
 * What the slide says about the rows it is not showing.
 *
 * Both counts, in the archetype's own voice rather than the author's, because
 * the author is the one party who cannot be trusted to write it: a subset is
 * asked for precisely when the whole table is inconvenient. It is set at
 * `BODY_SIZE`, the same 40px floor the note is set at, so it is read at the back
 * of the room like everything else the slide asserts.
 */
const omission = (drawn: number, total: number): string =>
  `Showing ${drawn} of ${total} rows from the source table; ${total - drawn} omitted.`;

export const dataTable: Emitter<"data-table"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const table = ctx.source.tables.find((t) => t.id === p.tableId);
  if (!table) {
    throw new Error(`data-table ${beat.id}: no table "${p.tableId}" in source ${ctx.source.id}`);
  }

  // The rows this slide is accountable for, and what it owes the viewer for the
  // rest of them. `left` is 0 for the whole table, and `said` is undefined then:
  // a slide that omits nothing must not claim to, and `noteHeight` charges 0 for
  // an absent line, so the whole-table path costs exactly what it did before.
  const shown = p.rows === undefined ? table.rows : subset(`data-table ${beat.id}`, table, p.rows);
  const left = table.rows.length - shown.length;
  const said = left > 0 ? omission(shown.length, table.rows.length) : undefined;

  // Type grows to whatever the widest row allows, and stops at the floor.
  //
  // A flat 40px is right for a table that only just fits and wrong for the three
  // -column table that is the common case — the demo's filled 16.8% of the canvas
  // with a 789x498 hole in the middle of it. `textWidth` is linear in size, so
  // the largest size that fits is a division: sum the widest cell per column at
  // 1px, add the padding, divide the content width by the total. Deriving it
  // *downwards* is what invariant 5 forbids and `MIN_FONT` here is the floor
  // that keeps this a growth-only rule.
  // `tabular: true` because the CSS below sets `font-variant-numeric:
  // tabular-nums` — which is the whole point of a table, and makes every figure
  // 0.649em rather than the 0.413 a proportional "1" costs. Measuring these
  // cells in proportional figures solved every column short by up to 8%.
  //
  // AND THE HEADING CARRIES `TH_TRACKING`, which this did not ask for. `th` is
  // drawn at `letter-spacing:.04em` below; a heading measured without it is
  // short by .04em a character, about 6% of a heading's width, and a column
  // whose heading is its widest cell is exactly where that lands. The weight
  // stays at 600 against a th's real 500 and a td's 400: it bounds both, and a
  // margin that is deliberate is worth more here than a margin that is exact.
  // MEASURED OVER THE ROWS THAT WILL BE DRAWN, not over the table. A subset that
  // leaves out the one row with a 40-character method name in it genuinely has
  // narrower columns, and solving against a row nobody will see would set the
  // type smaller than the slide can read — which is the direction invariant 5
  // exists to forbid.
  const box = contentW(ctx.format);
  const units = table.columns.reduce((total, col, i) => {
    const head = textWidth(col, 1, 600, TH_TRACKING, true);
    const body = shown.map((r) => textWidth(r[i] ?? "", 1, 600, 0, true));
    return total + Math.max(head, ...body);
  }, 0);
  const channels = 2 * CELL_PAD * table.columns.length;
  const cell = Math.max(MIN_FONT, Math.min(CELL_MAX, Math.floor((box - channels) / units)));

  // AND THE WIDTH IS REFUSED THE WAY THE HEIGHT IS, a few lines down.
  //
  // The solve above is a MAXIMUM that stops at the floor: if the size that would
  // fit is under `MIN_FONT` the clamp keeps 40 and the table is simply wider
  // than the slide. Cells are `white-space:nowrap` — a table that wraps its
  // cells has stopped being scannable, which is the whole reason to draw one —
  // so nothing gives, and the row runs off the canvas.
  //
  // That case shipped unnoticed for as long as nothing chose this archetype.
  // The moment the planner started citing real paper tables it arrived at once:
  // a 7-column decision matrix of text values planned from a real document
  // built FAIL with 34 `canvas_overflow` errors, one per cell, on one beat.
  // Failing in `check` after a browser has laid the deck out is the worst of the
  // three available outcomes — the author gets 34 findings and no sentence about
  // what to do. Refusing here gives them one, and `onBeatError` drops the beat
  // and keeps the deck, exactly as the height refusal already does.
  const needed = Math.round(units * MIN_FONT + channels);
  if (needed > box) {
    const widest = table.columns
      .map((col, i) => ({
        col,
        w: Math.max(
          textWidth(col, MIN_FONT, 600, TH_TRACKING, true),
          ...shown.map((r) => textWidth(r[i] ?? "", MIN_FONT, 600, 0, true)),
        ),
      }))
      .sort((a, b) => b.w - a.w)[0];
    throw new Error(
      `data-table ${beat.id}: table "${table.id}" needs ${needed}px of width at the ` +
        `${MIN_FONT}px floor and this slide has ${Math.round(box)}px. Cells are not ` +
        `wrapped — a table whose cells wrap has stopped being scannable — and nothing ` +
        `may be set smaller, so the lever is upstream of this beat: show fewer columns, ` +
        `shorten the longest cells${widest ? ` (the "${widest.col}" column is the widest)` : ""}, ` +
        `or carry this comparison as callout panels or bar-compare instead.`,
    );
  }

  const rows = shown.length + 1;
  // LAST in the queue for space, so it passes its own floor: `bodyBudget`'s 320
  // default is the lie that put claim-figure's caption 7px off the canvas. It
  // changes no output on this tree — every table here has a remainder well over
  // 320 — and it is what stops a huge HEADLINE buying room the slide has not got.
  //
  // A huge EYEBROW still can, and this is not the place to stop it: `chromeHeight`
  // charges one `EYEBROW_H` however many lines the eyebrow sets in, so a long one
  // overstates the remainder by a line box each time it wraps and the refusal
  // below inherits that. It is a defect in the shared budget rather than in this
  // rule — callout, split-compare and claim-figure all read the same number — and
  // it wants fixing there, against the uppercasing and letter-spacing an eyebrow
  // is drawn with, which `wrap` does not model either.
  //
  // The omission line is charged for HERE, beside the note, because it is below
  // the table in the same way and costs the same line box. Charging it anywhere
  // later would let a subset buy its rows with the very space its own disclosure
  // needs, and push that disclosure — the one part of the slide the viewer needs
  // in order not to be misled — off the bottom of the canvas.
  const width = noteWidth(ctx.format);
  const budget = bodyBudget(
    ctx.format,
    p.eyebrow,
    p.headline,
    noteHeight(p.note, width, 26) + noteHeight(said, width, 26),
    34,
    0,
  );

  // Row padding takes what is left over vertically, so a five-row table fills
  // the box instead of banding across its middle. Capped, or a two-row table
  // becomes two rules a third of a canvas apart.
  const spare = budget - rows * cell * 1.2;
  const roomiest = isPortrait(ctx.format) ? PAD_Y_MAX.tall : PAD_Y_MAX.wide;
  const padY = Math.round(Math.max(PAD_Y_MIN, Math.min(roomiest, spare / (2 * rows))));

  // WHAT WILL BE DRAWN, AND WHAT THERE IS TO DRAW IT IN. Both derived from decks
  // that were built and measured, one table per deck, because two earlier
  // versions of this rule were derived from arithmetic and both shipped tables
  // off the canvas.
  //
  //   `drawn` counts type and padding ONLY. `border-collapse:collapse` folds
  //   each row's rule into the height that row already occupies, so adding
  //   `RULE_ROW` per row on top over-counted by ~11px on a twelve-row table —
  //   enough to move a boundary by one row.
  //
  //   `canvas` is the content box plus ONE `PAD_Y`. Once the body exceeds the
  //   box it pins to the top padding and the whole overrun goes downward, so
  //   only the bottom's padding is ever spendable. Charging two assumed
  //   symmetric overflow and let a 9x5 table ship 74px off the bottom.
  //
  // Measured boundaries, last row count that renders entirely inside the canvas:
  //
  //   16:9 3 short cols  7      9:16 3 cols       23
  //   16:9 3 wide cols   8      16:9 tight chrome  6
  //   16:9 6 cols        7
  //
  // This rule reproduces all of those except the last, where it stops at 5. That
  // one is `noteHeight` predicting two lines where the browser sets one — a
  // text-metric gap shared with `chromeHeight`'s eyebrow under-count, not a fault
  // in the bound. It errs toward refusing a table that would have fitted, which
  // is the side to err on.
  const drawn = rows * (cell * 1.2 + 2 * padY);
  const canvas = budget + PAD_Y;

  // WHY REFUSE RATHER THAN OVERFLOW AND LET THE GATE CATCH IT, which is what
  // this did until now. The width rule can afford that — an over-wide table runs
  // off the side, and the thing that leaves the canvas is the table, which is
  // the thing at fault. Height cannot: `.scene` is centred, so an over-tall
  // column hangs off BOTH ends and what the gate reports is `#sN-h` above the
  // canvas and `#sN-note` below it — a headline and a note that are individually
  // blameless, with the table itself looking fine and the author's actual lever
  // unguessable from the report. That is exactly why nine rows at 16:9 sat open
  // in `scripts/sweep.mjs` unfixed. Both outcomes fail the whole build today;
  // only one of them names the cause.
  if (drawn > canvas) {
    // The count is what this beat ASKED FOR, so the number in the message is the
    // number the author can act on: "has 20 rows" is unhelpful advice to someone
    // who already named 9 of them.
    const has =
      said === undefined
        ? `has ${table.rows.length} rows, which`
        : `has ${table.rows.length} rows and this beat names ${shown.length} of them, which`;
    // The subset is named FIRST because it is the lever that keeps the table a
    // table. bar-compare stays on the list, last, as what to do when no subset of
    // the rows is the argument — but leading with it is how a document with seven
    // tables was planned twice and cited none of them.
    const lever =
      said === undefined
        ? `name the rows that carry the argument in params.rows — the slide draws those and ` +
          `states on itself how many it left out — or take the one column that carries it to ` +
          `bar-compare`
        : `name fewer rows in params.rows, or take the one column that carries the argument to ` +
          `bar-compare`;
    throw new Error(
      `data-table ${beat.id}: table "${table.id}" ${has} with the ` +
        `header stand ${Math.round(drawn)}px tall at ${cell}px type on ${padY}px of row ` +
        `padding, and this slide has ${Math.round(canvas)}px. Every row this beat names is ` +
        `drawn and none is set below ${MIN_FONT}px, so the lever is upstream of this beat: ` +
        `${lever}.`,
    );
  }

  const head = table.columns.map((c) => `<th>${mathy(c)}</th>`).join("");
  const body = shown
    .map(
      (row, i) =>
        `<tr class="trow" id="${sid}-r${i}">${row.map((cell) => `<td>${mathy(cell)}</td>`).join("")}</tr>`,
    )
    .join("\n      ");

  // Directly under the table, ABOVE the author's note: it is a fact about the
  // thing immediately above it, and a viewer who reads down the slide meets it
  // before they read anything the author concluded from those rows.
  const omit = said ? `\n<div class="rowomit" id="${sid}-omit">${esc(said)}</div>` : "";
  const note = p.note ? `\n<div class="rownote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, box)}
<table>
  <thead><tr id="${sid}-thead">${head}</tr></thead>
  <tbody>
      ${body}
  </tbody>
</table>${omit}${note}`;

  const rowsIn = 0.9;
  const stagger = Math.min(0.16, 2.4 / Math.max(1, shown.length));
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(`#${sid}-thead`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.7),
    // WITH THE HEAD, not after the rows: the frame that establishes "this is a
    // table" is the frame that has to say "and it is not all of it", so the
    // disclosure is up before the first hold rather than arriving once the
    // viewer has already read the rows as the whole story. It takes no hold of
    // its own — `REVEALS` in `prompt.ts` is measured from `holds.length`, and a
    // disclosure is not a step in the argument.
    ...(said ? [tween(`#${sid}-omit`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.7)] : []),
    tween(
      `#${sid} .trow`,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.45, stagger },
      rowsIn,
    ),
  ];

  const settled = rowsIn + stagger * shown.length + 0.45;
  const holds = [settled + 0.2];
  const room = Math.max(0.6, (beat.seconds - settled - 1.2) / Math.max(1, p.highlight.length));
  const step = Math.min(1.2, room);

  // The row the argument lands on, and so the row a presenter holds on.
  let focus: number | undefined;

  // A table is a wall of numbers and the recolour alone asks the eye to find
  // the one that changed. Dimming the rest says it instead: the row under
  // discussion is the only one at full weight, and the light moves row to row
  // with the argument. `lit` mode — every row is on screen by now.
  const spot = spotlighter(sid, ".trow");

  p.highlight.forEach((h, i) => {
    // SEARCHED AMONG THE DRAWN ROWS, not the table's. `#sid-rN` is indexed by
    // draw order, so a subset that leaves out row 3 renumbers every row after
    // it: matching against the table would light whichever drawn row happens to
    // sit at the missing row's old index — the wrong number, emphasised, with
    // every gate green.
    const index = shown.findIndex((row) => row[0] === h.row);
    if (index < 0) {
      // An emphasis that matches nothing animates nothing, and looks fine in every gate.
      const why = table.rows.some((row) => row[0] === h.row)
        ? `no row labelled "${h.row}" is drawn — table ${table.id} has one, but params.rows left it out`
        : `no row labelled "${h.row}" in table ${table.id}`;
      throw new Error(`data-table ${beat.id}: ${why}`);
    }
    const at = settled + 0.3 + i * step;
    tl.push(
      tween(
        `#${sid}-r${index} td`,
        { color: theme.muted, fontWeight: 400 },
        { color: theme.tones[h.tone], fontWeight: 600, duration: 0.5 },
        at,
      ),
      ...spot.lit(`#${sid}-r${index}`, at),
    );
    focus = index;
    holds.push(at + 0.6);
  });

  if (p.note) {
    const at = settled + 0.3 + p.highlight.length * step;
    tl.push(tween(`#${sid}-note`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }
  // The table is whole again for the last hold: the highlighted rows keep their
  // colour, which is what ties them to the claim, and the rest come back to
  // full weight so the numbers around them can still be read.
  if (p.highlight.length > 0) {
    tl.push(...spot.restore(settled + 0.3 + p.highlight.length * step));
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Never derived *downwards*. Shrinking to fit is the one failure mode
      // invariant 5 names: a 30px table clears every automated gate and is
      // unreadable projected. A table too wide at 40px eats its margin first and
      // then trips the layout gate at the canvas edge, which someone can see —
      // small type is not. A table too TALL to draw is refused above instead,
      // because there the thing that leaves the canvas is the headline rather
      // than the table. `cell` is floored at 40 for exactly that.
      // SCOPED TO THIS SCENE, because two of these rules carry numbers this scene
      // solved for itself. A deck shares one stylesheet, so an unscoped
      // `td{padding:${padY}px}` is written once per data-table and the last one
      // wins for all of them: two tables of different heights in one deck then
      // render at a single padding, and the shorter one is drawn with the
      // taller one's arithmetic. The height guard above cannot see that, because
      // it reasons about the value this scene emitted.
      //
      // All six are scoped, not only the two that vary. Scoping `th,td` alone
      // lifts it to an id's specificity and it would then beat
      // `td:first-child{text-align:left}`, right-aligning the first column of
      // every table — a fix that quietly breaks the thing next to it.
      `#${sid} table{border-collapse:collapse;width:100%;margin-top:34px;font-size:${cell}px}`,
      `#${sid} th,#${sid} td{font-size:inherit;padding:${padY}px ${CELL_PAD}px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}`,
      `#${sid} th{color:${theme.dim};font-weight:500;letter-spacing:${TH_TRACKING}em;border-bottom:${RULE_HEAD}px solid ${theme.rule}}`,
      `#${sid} td:first-child,#${sid} th:first-child{text-align:left}`,
      `#${sid} tbody tr{border-bottom:${RULE_ROW}px solid ${theme.rule}}`,
      `#${sid} tbody td{color:${theme.muted}}`,
      // ONE rule for both lines below the table, and deliberately identical: the
      // omission is a caption about the table, set exactly as the author's note
      // is, and the words are what tell them apart. `BODY_SIZE` is 40 — the
      // audience floor of invariant 5, which is inclusive — so the line that
      // discloses the omission can never be the thing that gets shrunk to fit.
      // The 26 here is the 26 `noteHeight` was charged above for each of them.
      `.rownote,.rowomit{font-size:${BODY_SIZE}px;line-height:1.45;color:${theme.dim};margin-top:26px}`,
      // A table with nothing emphasised has no focal row, and so no ambient life.
      // `filter` again: the emphasis tween owns this row's colour and weight.
      ...(focus === undefined ? [] : [ambient(sid, `-r${focus} td`, BREATHE)]),
    ].join("\n"),
  };
};

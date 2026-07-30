/**
 * A table from the source, revealed row by row, then read for the viewer: the
 * highlighted rows light up in the order the argument needs them.
 *
 * Nothing here invents numbers, and nothing here resizes them either: the cells
 * are 40px because that is the floor, and a table that will not fit at 40px is a
 * table the planner has to cut columns from.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc, mathy } from "../kit.js";
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

export const dataTable: Emitter<"data-table"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const table = ctx.source.tables.find((t) => t.id === p.tableId);
  if (!table) {
    throw new Error(`data-table ${beat.id}: no table "${p.tableId}" in source ${ctx.source.id}`);
  }

  // Type grows to whatever the widest row allows, and stops at the floor.
  //
  // A flat 40px is right for a table that only just fits and wrong for the three
  // -column table that is the common case — the demo's filled 16.8% of the canvas
  // with a 789x498 hole in the middle of it. `textWidth` is linear in size, so
  // the largest size that fits is a division: sum the widest cell per column at
  // 1px, add the padding, divide the content width by the total. Deriving it
  // *downwards* is what invariant 10 forbids and `MIN_FONT` here is the floor
  // that keeps this a growth-only rule.
  const box = contentW(ctx.format);
  const units = table.columns.reduce((total, col, i) => {
    const cells = [col, ...table.rows.map((r) => r[i] ?? "")];
    return total + Math.max(...cells.map((c) => textWidth(c, 1, 600)));
  }, 0);
  const channels = 2 * CELL_PAD * table.columns.length;
  const cell = Math.max(MIN_FONT, Math.min(CELL_MAX, Math.floor((box - channels) / units)));

  // Row padding takes what is left over vertically, so a five-row table fills
  // the box instead of banding across its middle. Capped, or a two-row table
  // becomes two rules a third of a canvas apart.
  const rows = table.rows.length + 1;
  const spare =
    bodyBudget(ctx.format, p.eyebrow, p.headline, noteHeight(p.note, noteWidth(ctx.format), 26)) -
    rows * cell * 1.2;
  const roomiest = isPortrait(ctx.format) ? PAD_Y_MAX.tall : PAD_Y_MAX.wide;
  const padY = Math.round(Math.max(12, Math.min(roomiest, spare / (2 * rows))));

  const head = table.columns.map((c) => `<th>${mathy(c)}</th>`).join("");
  const body = table.rows
    .map(
      (row, i) =>
        `<tr class="trow" id="${sid}-r${i}">${row.map((cell) => `<td>${mathy(cell)}</td>`).join("")}</tr>`,
    )
    .join("\n      ");

  const note = p.note ? `\n<div class="rownote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, box)}
<table>
  <thead><tr id="${sid}-thead">${head}</tr></thead>
  <tbody>
      ${body}
  </tbody>
</table>${note}`;

  const rowsIn = 0.9;
  const stagger = Math.min(0.16, 2.4 / Math.max(1, table.rows.length));
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(`#${sid}-thead`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.7),
    tween(
      `#${sid} .trow`,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.45, stagger },
      rowsIn,
    ),
  ];

  const settled = rowsIn + stagger * table.rows.length + 0.45;
  const holds = [settled + 0.2];
  const room = Math.max(0.6, (beat.seconds - settled - 1.2) / Math.max(1, p.highlight.length));
  const step = Math.min(1.2, room);

  // The row the argument lands on, and so the row a presenter holds on.
  let focus: number | undefined;

  p.highlight.forEach((h, i) => {
    const index = table.rows.findIndex((row) => row[0] === h.row);
    if (index < 0) {
      // An emphasis that matches nothing animates nothing, and looks fine in every gate.
      throw new Error(`data-table ${beat.id}: no row labelled "${h.row}" in table ${table.id}`);
    }
    const at = settled + 0.3 + i * step;
    tl.push(
      tween(
        `#${sid}-r${index} td`,
        { color: theme.muted, fontWeight: 400 },
        { color: theme.tones[h.tone], fontWeight: 600, duration: 0.5 },
        at,
      ),
    );
    focus = index;
    holds.push(at + 0.6);
  });

  if (p.note) {
    const at = settled + 0.3 + p.highlight.length * step;
    tl.push(tween(`#${sid}-note`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Never derived *downwards*. Shrinking to fit is the one failure mode
      // invariant 10 names: a 30px table clears every automated gate and is
      // unreadable projected. A table too wide at 40px eats its margin first and
      // then trips the layout gate at the canvas edge — both of which someone can
      // see, which small type is not. `cell` is floored at 40 for exactly that.
      `table{border-collapse:collapse;width:100%;margin-top:34px;font-size:${cell}px}`,
      `th,td{font-size:inherit;padding:${padY}px ${CELL_PAD}px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}`,
      `th{color:${theme.dim};font-weight:500;letter-spacing:.04em;border-bottom:2px solid ${theme.rule}}`,
      "td:first-child,th:first-child{text-align:left}",
      `tbody tr{border-bottom:1px solid ${theme.rule}}`,
      `tbody td{color:${theme.muted}}`,
      `.rownote{font-size:${BODY_SIZE}px;line-height:1.45;color:${theme.dim};margin-top:26px}`,
      // A table with nothing emphasised has no focal row, and so no ambient life.
      // `filter` again: the emphasis tween owns this row's colour and weight.
      ...(focus === undefined ? [] : [ambient(sid, `-r${focus} td`, BREATHE)]),
    ].join("\n"),
  };
};

/**
 * One number that owns the frame — the result an explainer video stops on.
 *
 * A bar-compare holds a magnitude in a chart; this holds it in the viewer's
 * face. The value is set as large as the frame allows (`NUM_MAX`, never under
 * `NUM_MIN`) and its digits ROLL into place like an odometer: each digit is a
 * reel — a strip of 0-9 repeated, clipped to one cell — and the reel's `y` is
 * tweened from its first cell to the digit's. That is a property tween on a
 * transform, NOT a counter: writing `textContent` from an `onUpdate` is the
 * obvious way to count up, and it is exactly what invariant 11 forbids. Every
 * frame here is a pure function of the timeline's time.
 *
 * Reels to the right turn more (`turnsOf`), and every reel lands left to right,
 * so the number settles the way a counter does: the most significant figure
 * first. Characters that are not digits ("." "/" "%") stand still.
 *
 * `compare` is the number the value is read against. When both parse as plain
 * numbers they are drawn as a pair of bars in one scale — the baseline first,
 * then the value — so "a quarter of the energy" is a length the eye takes in
 * rather than two figures it has to divide. Otherwise the baseline is a second,
 * smaller figure.
 *
 * Never on the pack's pale ground: `emitScene` sets it over its `backdrop`, or
 * over the accent field (src/emit/backdrop.ts), and emits it in the glass theme
 * either way — so every ink here is light, and its contrast is that module's
 * proof rather than this one's.
 *
 * NOTHING SHRINKS BELOW THE FLOOR. The number steps down from `NUM_MAX` until
 * the whole block fits the frame; a value that does not fit at `NUM_MIN`, or a
 * headline past two lines, is refused by name, never squeezed.
 */
import { MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween } from "../kit.js";
import { contentH, contentW, esc } from "../kit.js";
import { displayFace, faceOf, textWidth, typeOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import { holdsWithin, tween } from "./title.js";

/**
 * The number's size range, reference px: as large as the frame holds — a
 * single digit takes over half its height — and never under 160, still four
 * times the floor.
 */
const NUM_MAX = 560;
const NUM_MIN = 160;
const NUM_STEP = 20;
/** A reel's cell, as a share of the number's size: one digit with a little air. */
const CELL_LH = 1.06;
/** The unit beside the number, as a share of its size. */
const UNIT_SHARE = 0.3;
const UNIT_GAP = 0.08;
/** What the number measures, under it. */
const LABEL_SIZE = 48;
const LABEL_LH = 1.25;
/** The sentence the number says. */
const HEAD_SIZE = 56;
const HEAD_LH = 1.18;
const MAX_HEAD_LINES = 2;
/** The comparison: a row per number, label and value either side of a bar. */
const ROW_SIZE = 44;
const ROW_LH = 1.2;
const BAR_H = 26;
const ROW_GAP = 22;
const BARS_TOP = 44;
/**
 * The bar labels' column: as wide as the longer label needs, between these
 * shares of the frame, and two lines at most. A fixed 30% column refused
 * "EM-SNN의 LHID PSNR" and cost the deck its slide (ko e2e, 2026-10-09).
 */
const LABEL_COL_MIN = 0.22;
const LABEL_COL_MAX = 0.42;
const LABEL_GUTTER = 32;
const ROW_MAX_LINES = 2;
const VALUE_COL = 0.24;
/** A figure-only comparison line. */
const VERSUS_SIZE = 56;
/** Vertical rhythm between blocks, and the larger step before the sentence. */
const GAP = 28;
const HEAD_GAP = 52;

/** When each part arrives. The roll is the beat; everything else waits on it. */
const EYEBROW_AT = 0.15;
const NUM_AT = 0.3;
const ROLL_BASE = 1.2;
const ROLL_PER_REEL = 0.12;
const LABEL_AT = 1.2;
const COMPARE_AT = 1.7;
const BAR_IN = 0.7;
const HERO_BAR_AT = 2.1;
const HEAD_AFTER = 0.4;
const HEAD_IN = 0.6;

/** The value's characters: a digit is a reel, anything else stands still. */
type Glyph = { reel: true; digit: number } | { reel: false; char: string };

function glyphs(value: string): Glyph[] {
  return [...value].map((c) =>
    c >= "0" && c <= "9" ? { reel: true, digit: c.charCodeAt(0) - 48 } : { reel: false, char: c },
  );
}

/**
 * How many full turns reel `i` (0 the leftmost) makes before it lands: one for the most
 * significant, up to three for the least — a counter's right-hand wheels spin
 * fastest.
 */
export function turnsOf(i: number): number {
  return 1 + Math.min(2, i);
}

/**
 * `s` as a plain number, or undefined. Thousands separators are allowed; a
 * fraction, a percentage or a multiplier is not a length on one scale with
 * anything, so it is not drawn as one.
 */
export function plainNumber(s: string): number | undefined {
  const t = s.replace(/[,   ]/g, "").replace("−", "-");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export const heroNumber: Emitter<"hero-number"> = (beat, ctx) => {
  const { sid, theme, format } = ctx;
  const p = beat.params;
  const who = `hero-number ${beat.id}`;
  const face = faceOf(theme.fontStack);
  const type = typeOf(face);
  const dFace = displayFace(face);
  const weight = type.headline.weight;
  const eb = type.eyebrow;
  const W = contentW(format);
  const H = contentH(format);

  const marks = glyphs(p.value);
  const reels = marks.filter((g) => g.reel).length;
  if (reels === 0) {
    throw new Error(`${who}: value "${p.value}" has no digit to roll — a hero number is a number`);
  }

  const a = p.compare ? plainNumber(p.compare.value) : undefined;
  const b = plainNumber(p.value);
  const bars = p.compare !== undefined && a !== undefined && b !== undefined;

  // THE WORDS FIRST: their height does not depend on the number's size.
  const head = wrap(p.headline, HEAD_SIZE, W * MEASURE_SLACK, weight, 0, dFace);
  if (head.length > MAX_HEAD_LINES) {
    throw new Error(
      `${who}: the headline sets on ${head.length} lines at ${HEAD_SIZE}px and the frame holds ${MAX_HEAD_LINES} under the number — shorten it`,
    );
  }
  const label = wrap(p.label, LABEL_SIZE, W * MEASURE_SLACK, 500, 0, face);
  const rowLine = Math.round(ROW_SIZE * ROW_LH);
  const valueColW = Math.round(W * VALUE_COL);
  const rowLabels = bars && p.compare ? [p.compare.label, p.label] : [];
  const widest = Math.max(0, ...rowLabels.map((l) => textWidth(l, ROW_SIZE, 500, 0, false, face)));
  const labelColW = Math.round(
    Math.min(W * LABEL_COL_MAX, Math.max(W * LABEL_COL_MIN, widest / MEASURE_SLACK + LABEL_GUTTER)),
  );
  const rowLines = rowLabels.map(
    (l) => wrap(l, ROW_SIZE, (labelColW - LABEL_GUTTER) * MEASURE_SLACK, 500, 0, face).length,
  );
  rowLabels.forEach((l, k) => {
    if ((rowLines[k] ?? 0) > ROW_MAX_LINES) {
      throw new Error(
        `${who}: the bar label "${l}" sets on ${rowLines[k]} lines in a ${labelColW}px column at ${ROW_SIZE}px — shorten it`,
      );
    }
  });
  const versus =
    p.compare && !bars
      ? wrap(
          `${p.compare.value}${p.unit ? ` ${p.unit}` : ""} · ${p.compare.label}`,
          VERSUS_SIZE,
          W * MEASURE_SLACK,
          500,
          0,
          face,
        )
      : [];
  if (versus.length > 1) {
    throw new Error(
      `${who}: the comparison "${p.compare?.label}" does not fit one line — shorten it`,
    );
  }
  const words =
    (p.eyebrow ? Math.round(eb.size * eb.lh) + GAP : 0) +
    (bars ? 0 : GAP + label.length * Math.round(LABEL_SIZE * LABEL_LH)) +
    (bars
      ? BARS_TOP + rowLines.reduce((h, n) => h + Math.max(n * rowLine, BAR_H), 0) + ROW_GAP
      : 0) +
    (versus.length ? GAP + Math.round(VERSUS_SIZE * 1.2) : 0) +
    HEAD_GAP +
    head.length * Math.round(HEAD_SIZE * HEAD_LH);

  // THE NUMBER: the largest size at which value and unit fit across, and the
  // whole block fits down.
  const across = (size: number) =>
    textWidth(p.value, size, 800, 0, true, dFace) +
    (p.unit
      ? size * UNIT_GAP + textWidth(p.unit, Math.round(size * UNIT_SHARE), 600, 0, false, face)
      : 0);
  let size = NUM_MAX;
  while (
    size > NUM_MIN &&
    (across(size) > W * MEASURE_SLACK || Math.round(size * CELL_LH) + GAP + words > H)
  ) {
    size -= NUM_STEP;
  }
  if (across(size) > W * MEASURE_SLACK) {
    throw new Error(
      `${who}: "${p.value}${p.unit ? ` ${p.unit}` : ""}" does not fit across the frame at ${NUM_MIN}px — a hero number is a figure, not a phrase`,
    );
  }
  if (Math.round(size * CELL_LH) + GAP + words > H) {
    throw new Error(
      `${who}: the number, its label${p.compare ? ", the comparison" : ""} and the headline do not fit the frame with the number at ${NUM_MIN}px — shorten the words`,
    );
  }
  const cell = Math.round(size * CELL_LH);
  const unitSize = Math.round(size * UNIT_SHARE);

  // THE REELS. Clipped by `clip-path`, not `overflow`: a reel's other digits
  // are drawn outside its cell on purpose, and both hyperframes audits skip
  // text a clip-path paints nowhere (`isClippedAway`) — while text an
  // `overflow:hidden` box hides is still probed, and was reported as text
  // buried under the field or the backdrop's scrim. Mid-roll a digit is half in
  // its cell and half out, which is the reel working, so the cell also says
  // `data-layout-allow-occlusion`; `-overflow` for the strip that runs past the
  // cell and the canvas while it rolls.
  let r = 0;
  const reelTl: Tween[] = [];
  const num = marks
    .map((g) => {
      if (!g.reel) return `<span class="hn-c">${esc(g.char)}</span>`;
      const i = r++;
      const stops = turnsOf(i) * 10 + g.digit;
      const strip = Array.from({ length: stops + 1 }, (_, k) => `<span>${k % 10}</span>`).join("");
      reelTl.push(
        tween(
          `#${sid}-r${i}`,
          { y: 0 },
          {
            y: -stops * cell,
            duration: Math.round((ROLL_BASE + ROLL_PER_REEL * i) * 1000) / 1000,
            ease: "power3.out",
          },
          NUM_AT,
        ),
      );
      return `<span class="hn-r" data-layout-allow-overflow data-layout-allow-occlusion><span class="hn-s" id="${sid}-r${i}">${strip}</span></span>`;
    })
    .join("");
  const landed = NUM_AT + ROLL_BASE + ROLL_PER_REEL * (reels - 1);

  // THE COMPARISON. The longer bar takes the whole track; the other its share.
  const longest = bars ? Math.max(a as number, b as number) : 1;
  const share = (v: number) => Math.max(0.02, Math.round((v / longest) * 1000) / 1000);
  const unit = p.unit ? ` ${esc(p.unit)}` : "";
  const row = (k: 0 | 1, name: string, value: string, v: number) =>
    `<div class="hn-row"><div class="hn-rl" id="${sid}-rl${k}">${esc(name)}</div>` +
    `<div class="hn-tr"><div class="hn-b hn-b${k}" id="${sid}-b${k}" style="width:${Math.round(share(v) * 1000) / 10}%"></div></div>` +
    `<div class="hn-rv" id="${sid}-rv${k}">${esc(value)}${unit}</div></div>`;
  const compare =
    bars && p.compare
      ? `<div class="hn-bars">${row(0, p.compare.label, p.compare.value, a as number)}${row(1, p.label, p.value, b as number)}</div>`
      : versus.length
        ? `<div class="hn-vs" id="${sid}-vs">${esc(versus[0] ?? "")}</div>`
        : "";

  const html = [
    `<div class="hn" id="${sid}-hn">`,
    p.eyebrow ? `<div class="hn-e" id="${sid}-e">${esc(p.eyebrow)}</div>` : "",
    `<div class="hn-n" id="${sid}-n" role="img" aria-label="${esc(p.value)}${unit}">${num}${p.unit ? `<span class="hn-u" id="${sid}-u">${esc(p.unit)}</span>` : ""}</div>`,
    // Bars carry the label on their own row; without them it sits under the number.
    bars ? "" : `<div class="hn-l" id="${sid}-l">${esc(p.label)}</div>`,
    compare,
    `<h2 class="hn-h" id="${sid}-h">${esc(p.headline)}</h2>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");

  const tl: Tween[] = [];
  if (p.eyebrow) {
    tl.push(
      tween(`#${sid}-e`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 }, EYEBROW_AT),
    );
  }
  tl.push(
    tween(`#${sid}-n`, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, NUM_AT),
  );
  tl.push(...reelTl);
  if (p.unit) {
    tl.push(
      tween(`#${sid}-u`, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5 }, landed - 0.3),
    );
  }
  let settled = landed;
  if (bars) {
    // The baseline, then the value against it: the bar that is the point grows last.
    const at = [COMPARE_AT, HERO_BAR_AT] as const;
    for (const k of [0, 1] as const) {
      tl.push(
        tween(`#${sid}-rl${k}`, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5 }, at[k]),
        tween(
          `#${sid}-b${k}`,
          { scaleX: 0 },
          { scaleX: 1, duration: BAR_IN, ease: "power2.out" },
          at[k],
        ),
        tween(`#${sid}-rv${k}`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, at[k] + 0.3),
      );
    }
    settled = Math.max(settled, HERO_BAR_AT + BAR_IN);
  } else {
    tl.push(
      tween(`#${sid}-l`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, LABEL_AT),
    );
    settled = Math.max(settled, LABEL_AT + 0.5);
    if (versus.length) {
      tl.push(
        tween(`#${sid}-vs`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, COMPARE_AT),
      );
      settled = Math.max(settled, COMPARE_AT + 0.5);
    }
  }
  // Two decimals, as `tween` places it, so the hold is where the headline lands.
  const headAt = Math.round((settled - HEAD_IN + HEAD_AFTER) * 100) / 100;
  tl.push(
    tween(
      `#${sid}-h`,
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: HEAD_IN, ease: "power3.out" },
      headAt,
    ),
  );

  const family =
    typeof face === "string" ? "" : `font-family:${theme.displayStack ?? theme.fontStack};`;
  return {
    html,
    tl,
    holds: holdsWithin([headAt + HEAD_IN], beat.seconds),
    css: [
      `.hn{display:flex;flex-direction:column;align-items:flex-start;width:100%}`,
      // The deck's own eyebrow, as the chrome sets it (`chromeCss`), in glass ink.
      `.hn-e{${family}font-size:${eb.size}px;line-height:${eb.lh};letter-spacing:${eb.tracking}em;text-transform:${eb.upper ? "uppercase" : "none"};color:${eb.color === "accent" ? theme.accent : theme.muted};font-weight:${eb.weight};margin-bottom:${GAP}px}`,
      `.hn-n{${family}display:flex;align-items:flex-end;font-weight:800;color:${theme.fg};font-variant-numeric:tabular-nums;letter-spacing:-0.02em}`,
      `#${ctx.sid} .hn-n{font-size:${size}px;line-height:${cell}px;height:${cell}px}`,
      `.hn-r,.hn-c{display:inline-block;vertical-align:top}`,
      `#${ctx.sid} .hn-r{height:${cell}px;clip-path:inset(0)}`,
      // Every cell exactly `cell` tall, whatever the face's own line box: the
      // roll moves the strip by whole cells, so a taller cell lands between digits.
      `.hn-s,.hn-s>span{display:block}`,
      `#${ctx.sid} .hn-s>span{height:${cell}px;line-height:${cell}px}`,
      `#${ctx.sid} .hn-u{font-size:${unitSize}px;line-height:1;margin-left:${Math.round(size * UNIT_GAP)}px;margin-bottom:${Math.round(cell * 0.16)}px;font-weight:600;color:${theme.accent}}`,
      `.hn-l{font-size:${LABEL_SIZE}px;line-height:${LABEL_LH};font-weight:500;color:${theme.muted};margin-top:${GAP}px}`,
      `.hn-vs{font-size:${VERSUS_SIZE}px;line-height:1.2;font-weight:500;color:${theme.muted};margin-top:${GAP}px}`,
      `.hn-bars{width:100%;margin-top:${BARS_TOP}px;display:flex;flex-direction:column;gap:${ROW_GAP}px}`,
      `.hn-row{display:grid;align-items:center;font-size:${ROW_SIZE}px;line-height:${ROW_LH}}`,
      `#${ctx.sid} .hn-row{grid-template-columns:${labelColW}px 1fr ${valueColW}px}`,
      `.hn-rl{font-weight:500;color:${theme.muted};padding-right:${LABEL_GUTTER}px}`,
      `.hn-tr{height:${BAR_H}px}`,
      `.hn-b{height:100%;border-radius:${BAR_H / 2}px;transform-origin:left center}`,
      `.hn-b0{background:${theme.rule}}`,
      `.hn-b1{background:${theme.accent}}`,
      `.hn-rv{text-align:right;font-weight:700;color:${theme.fg};font-variant-numeric:tabular-nums}`,
      `.hn-h{${family}font-size:${HEAD_SIZE}px;line-height:${HEAD_LH};font-weight:${weight};color:${theme.fg};margin-top:${HEAD_GAP}px;text-wrap:balance}`,
      // The bar that is the point breathes, when there is one; else the number.
      ambient(sid, bars ? "-b1" : "-n", BREATHE),
    ].join("\n"),
  };
};

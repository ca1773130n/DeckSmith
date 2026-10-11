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
 * NOT BARS WHEN BARS SAY "EQUAL". On one zero-based scale 29.73 against 30.56
 * is two bars 20px apart in 730 (ko e2e round 2, b09 and b11): the one visual
 * argument of the slide read as "the same". Past `NEAR` the baseline is the
 * smaller figure instead, with the signed difference after it in the accent —
 * the difference is the claim, so it is what the viewer is given. A truncated
 * axis would show the gap and lie about the scale; this does neither.
 *
 * Never on the pack's pale ground: `emitScene` sets it over its `backdrop`, or
 * over the accent field (src/emit/backdrop.ts), and emits it in the glass theme
 * either way — so every ink here is light, and its contrast is that module's
 * proof rather than this one's.
 *
 * UNDER v2 IT IS A STATEMENT, NOT A SPECTACLE. The founder (2026-10-10): the
 * fonts are too large, and UI elements doing moves are old-fashioned. So a v2
 * hero number is set at the headline's 56px (`TYPE_SCALE`) in the accent, with no
 * reels; its label and comparison are body lines; bars are drawn at their
 * length; and every part simply fades in where it stands. What moves is the
 * picture under it — the backdrop's drift, the field. Classic keeps the
 * odometer below, byte for byte.
 *
 * NOTHING SHRINKS BELOW THE FLOOR. The number steps down from `NUM_MAX` until
 * the whole block fits the frame; a value that does not fit at `NUM_MIN`, or a
 * headline past two lines, is refused by name, never squeezed.
 */
import { isV2, MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween, Vars } from "../kit.js";
import { contentH, contentW, esc } from "../kit.js";
import { displayFace, faceOf, textWidth, typeOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import { TYPE_SCALE, v2Text } from "../type.js";
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
/** Bars only when the shorter is at most this share of the longer — see the header. */
export const NEAR = 0.85;
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
/** v2: the figure's fade, in place of the roll. */
const NUM_FADE = 0.6;

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

/**
 * `value - compare`, signed, at the finer of the two's decimal places, with the
 * unit: "+0.83 dB". Only called when both are plain numbers.
 */
export function signedDelta(value: string, compare: string, unit?: string): string {
  const places = (s: string) => /\.(\d+)/.exec(s.replace(/[,\s]/g, ""))?.[1]?.length ?? 0;
  const dp = Math.max(places(value), places(compare));
  const d = (plainNumber(value) ?? 0) - (plainNumber(compare) ?? 0);
  const mag = Math.abs(d).toFixed(dp);
  const sign = Number(mag) === 0 ? "±" : d > 0 ? "+" : "−";
  return `${sign}${mag}${unit ? ` ${unit}` : ""}`;
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

  // v2: a STATEMENT, not a spectacle (founder, 2026-10-10: no 160-560px
  // numerals, no UI elements doing moves). The figure is set at the headline's
  // size in the accent, with no reels; every part fades in where it stands,
  // and the motion is the backdrop's or the field's. Classic keeps the odometer.
  const v2 = isV2(ctx);
  const labelSize = v2Text(v2, LABEL_SIZE);
  const versusSize = v2Text(v2, VERSUS_SIZE);
  const marks = glyphs(p.value);
  const reels = marks.filter((g) => g.reel).length;
  if (reels === 0) {
    throw new Error(`${who}: value "${p.value}" has no digit to roll — a hero number is a number`);
  }

  const a = p.compare ? plainNumber(p.compare.value) : undefined;
  const b = plainNumber(p.value);
  const plain = p.compare !== undefined && a !== undefined && b !== undefined;
  const bars = plain && Math.min(a, b) / Math.max(a, b) <= NEAR;
  // Too close for bars: the signed difference, in the value's own precision.
  const delta = plain && !bars ? signedDelta(p.value, p.compare?.value ?? "", p.unit) : "";

  // THE WORDS FIRST: their height does not depend on the number's size.
  const head = wrap(p.headline, HEAD_SIZE, W * MEASURE_SLACK, weight, 0, dFace);
  if (head.length > MAX_HEAD_LINES) {
    throw new Error(
      `${who}: the headline sets on ${head.length} lines at ${HEAD_SIZE}px and the frame holds ${MAX_HEAD_LINES} under the number — shorten it`,
    );
  }
  const label = wrap(p.label, labelSize, W * MEASURE_SLACK, 500, 0, face);
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
          `${p.compare.value}${p.unit ? ` ${p.unit}` : ""} · ${p.compare.label}${delta ? ` · ${delta}` : ""}`,
          versusSize,
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
    (bars ? 0 : GAP + label.length * Math.round(labelSize * LABEL_LH)) +
    (bars
      ? BARS_TOP + rowLines.reduce((h, n) => h + Math.max(n * rowLine, BAR_H), 0) + ROW_GAP
      : 0) +
    (versus.length ? GAP + Math.round(versusSize * 1.2) : 0) +
    HEAD_GAP +
    head.length * Math.round(HEAD_SIZE * HEAD_LH);

  // THE NUMBER: the largest size at which value and unit fit across, and the
  // whole block fits down.
  const unitOf = (size: number) => v2Text(v2, Math.round(size * UNIT_SHARE), TYPE_SCALE.body);
  const across = (size: number) =>
    textWidth(p.value, size, 800, 0, true, dFace) +
    (p.unit ? size * UNIT_GAP + textWidth(p.unit, unitOf(size), 600, 0, false, face) : 0);
  const numMin = v2 ? TYPE_SCALE.headline : NUM_MIN;
  let size = v2 ? TYPE_SCALE.headline : NUM_MAX;
  while (
    size > numMin &&
    (across(size) > W * MEASURE_SLACK || Math.round(size * CELL_LH) + GAP + words > H)
  ) {
    size -= NUM_STEP;
  }
  if (across(size) > W * MEASURE_SLACK) {
    throw new Error(
      `${who}: "${p.value}${p.unit ? ` ${p.unit}` : ""}" does not fit across the frame at ${numMin}px — a hero number is a figure, not a phrase`,
    );
  }
  if (Math.round(size * CELL_LH) + GAP + words > H) {
    throw new Error(
      `${who}: the number, its label${p.compare ? ", the comparison" : ""} and the headline do not fit the frame with the number at ${numMin}px — shorten the words`,
    );
  }
  const cell = Math.round(size * CELL_LH);
  const unitSize = unitOf(size);

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
  const num = v2
    ? esc(p.value)
    : marks
        .map((g) => {
          if (!g.reel) return `<span class="hn-c">${esc(g.char)}</span>`;
          const i = r++;
          const stops = turnsOf(i) * 10 + g.digit;
          const strip = Array.from({ length: stops + 1 }, (_, k) => `<span>${k % 10}</span>`).join(
            "",
          );
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
  // v2 has no roll: the figure has landed when its fade has.
  const landed = v2 ? NUM_AT + NUM_FADE : NUM_AT + ROLL_BASE + ROLL_PER_REEL * (reels - 1);

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
        ? `<div class="hn-vs" id="${sid}-vs">${esc(`${p.compare?.value}${p.unit ? ` ${p.unit}` : ""} · ${p.compare?.label}`)}${delta ? ` · <span class="hn-d">${esc(delta)}</span>` : ""}</div>`
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
  /**
   * An arrival: classic's own move, or under v2 the same opacity reveal at the
   * same time and length with the move taken out — so holds stay where they
   * were and nothing slides.
   */
  const enter = (target: string, from: Vars, to: Vars, at: number): Tween => {
    if (!v2) return tween(target, from, to, at);
    const keep = Object.fromEntries(
      Object.entries(to).filter(([k]) => k !== "x" && k !== "y" && k !== "ease"),
    ) as Vars;
    return tween(target, { opacity: 0 }, { ...keep, opacity: 1, ease: "sine.out" }, at);
  };
  if (p.eyebrow) {
    tl.push(
      enter(`#${sid}-e`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 }, EYEBROW_AT),
    );
  }
  tl.push(
    tween(
      `#${sid}-n`,
      { opacity: 0 },
      { opacity: 1, duration: v2 ? NUM_FADE : 0.4, ease: v2 ? "sine.out" : "power1.out" },
      NUM_AT,
    ),
  );
  if (!v2) tl.push(...reelTl);
  if (p.unit) {
    tl.push(
      enter(`#${sid}-u`, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5 }, landed - 0.3),
    );
  }
  let settled = landed;
  if (bars) {
    // The baseline, then the value against it: the bar that is the point grows
    // last — in classic. v2 draws each bar at its length and fades it in.
    const at = [COMPARE_AT, HERO_BAR_AT] as const;
    for (const k of [0, 1] as const) {
      tl.push(
        enter(`#${sid}-rl${k}`, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5 }, at[k]),
        v2
          ? tween(
              `#${sid}-b${k}`,
              { opacity: 0 },
              { opacity: 1, duration: BAR_IN, ease: "sine.out" },
              at[k],
            )
          : tween(
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
      enter(`#${sid}-l`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, LABEL_AT),
    );
    settled = Math.max(settled, LABEL_AT + 0.5);
    if (versus.length) {
      tl.push(
        enter(`#${sid}-vs`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, COMPARE_AT),
      );
      settled = Math.max(settled, COMPARE_AT + 0.5);
    }
  }
  // Two decimals, as `tween` places it, so the hold is where the headline lands.
  const headAt = Math.round((settled - HEAD_IN + HEAD_AFTER) * 100) / 100;
  tl.push(
    enter(
      `#${sid}-h`,
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: HEAD_IN, ease: "power3.out" },
      headAt,
    ),
  );

  const family =
    typeof face === "string" ? "" : `font-family:${theme.displayStack ?? theme.fontStack};`;
  const said = Math.round((headAt + HEAD_IN) * 100) / 100;
  const holds = holdsWithin([said], beat.seconds);
  return {
    html,
    tl,
    holds,
    // Clamped into a short beat, the hold stops the deck before the sentence
    // (and the bar it explains) has landed. Say so, as kinetic does.
    ...((holds[0] ?? 0) < said
      ? {
          warnings: [
            `the number and its sentence need ${said}s to land and the beat is ${beat.seconds}s, so it stops mid-reveal — give it more seconds`,
          ],
        }
      : {}),
    css: [
      `.hn{display:flex;flex-direction:column;align-items:flex-start;width:100%}`,
      // The deck's own eyebrow, as the chrome sets it (`chromeCss`), in glass ink.
      `.hn-e{${family}font-size:${eb.size}px;line-height:${eb.lh};letter-spacing:${eb.tracking}em;text-transform:${eb.upper ? "uppercase" : "none"};color:${eb.color === "accent" ? theme.accent : theme.muted};font-weight:${eb.weight};margin-bottom:${GAP}px}`,
      `.hn-n{${family}display:flex;align-items:flex-end;font-weight:800;color:${v2 ? theme.accent : theme.fg};font-variant-numeric:tabular-nums;letter-spacing:-0.02em}`,
      `#${ctx.sid} .hn-n{font-size:${size}px;line-height:${cell}px;height:${cell}px}`,
      `.hn-r,.hn-c{display:inline-block;vertical-align:top}`,
      `#${ctx.sid} .hn-r{height:${cell}px;clip-path:inset(0)}`,
      // Every cell exactly `cell` tall, whatever the face's own line box: the
      // roll moves the strip by whole cells, so a taller cell lands between digits.
      `.hn-s,.hn-s>span{display:block}`,
      `#${ctx.sid} .hn-s>span{height:${cell}px;line-height:${cell}px}`,
      `#${ctx.sid} .hn-u{font-size:${unitSize}px;line-height:1;margin-left:${Math.round(size * UNIT_GAP)}px;margin-bottom:${Math.round(cell * 0.16)}px;font-weight:600;color:${theme.accent}}`,
      `.hn-l{font-size:${labelSize}px;line-height:${LABEL_LH};font-weight:500;color:${theme.muted};margin-top:${GAP}px}`,
      `.hn-vs{font-size:${versusSize}px;line-height:1.2;font-weight:500;color:${theme.muted};margin-top:${GAP}px}`,
      `.hn-d{font-weight:700;color:${theme.accent}}`,
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

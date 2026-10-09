/**
 * One figure that owns the whole frame.
 *
 * Every other archetype draws inside the scene's padded content box under a
 * headline, so a deck of them is one layout repeated: headline top, body below,
 * the figure in a framed plate. A stage beat is the other kind of slide — a
 * product UI, a scene, a photo or an animate piece edge to edge, with no plate,
 * border or side column, and the words (if any) set over it.
 *
 * WHAT KEEPS THE WORDS READABLE IS THE SCRIM, NOT THE PICTURE. The media is
 * arbitrary — a white paper figure, a dark night scene — so the text is always
 * white over a black scrim whose solid part covers the whole text block at
 * `SCRIM` alpha. At 0.55 black over a pure-white pixel the background is
 * 115/255, which white text clears at about 4.8:1 — over the 4.5:1 bar for
 * body text, though every stage line is large text (3:1) — so the contrast
 * gate passes on any picture rather than on the one it was tried with. It was
 * 0.66 (7:1), which read as a grey slab over a light picture. The solid extent is
 * DERIVED from the text block's measured height and width, and is
 * bounded on BOTH axes (`scrimFor`): a scrim that ran the whole width dimmed
 * the picture's subject wherever it shared the words' rows.
 *
 * THE TEXT IS NEVER SHRUNK. Headline and line have fixed sizes above the 40px
 * floor (invariant 5). Text that does not fit its placement's column in
 * `MAX_HEAD_LINES` / `MAX_LINE_LINES` takes the next wider column (`WIDER`),
 * so the words cover more of the picture rather than the slide being dropped;
 * only text that will not fit across the whole content width is refused by
 * name, the same answer callout and split-compare give.
 *
 * THE CAPTION RESERVE IS LEFT CLEAR. The media and its scrim stop `reserveRef`
 * above the bottom edge, so a deck that asked for burned captions keeps the
 * strip it asked for (`ink_in_caption_reserve`). Nothing that MOVES is that
 * box: the entrance scales an inner wrapper the box clips, so no frame of it
 * reaches the strip either.
 */
import type { Figure, STAGE_PLACEMENTS } from "../../types.js";
import { isV2, MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween } from "../kit.js";
import { contentW, esc, PAD_X, PAD_Y, refHeight, refWidth, reserveRef } from "../kit.js";
import { displayFace, faceOf, textWidth, typeOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import { V2_TYPE } from "../type.js";
import { pieceTimeline, plate } from "./claim-figure.js";
import { holdsWithin, isPortrait, tween } from "./title.js";

/** Headline over the picture: larger than the chrome's, because it is the slide's only text. */
const HEAD_SIZE = 72;
const HEAD_LH = 1.12;
const MAX_HEAD_LINES = 3;
/** The optional line under it. Above `BODY_SIZE` because it sits on a picture, not a panel. */
const LINE_SIZE = 44;
const LINE_LH = 1.4;
const MAX_LINE_LINES = 2;
const LINE_GAP = 18;
/** Black at this alpha under the whole text block — see the header. */
const SCRIM = 0.55;
/** Margin of solid scrim past the text block, then the fade to clear. */
const SCRIM_MARGIN = 56;
const SCRIM_FADE = 360;
/**
 * The fade's shape, as [share of `SCRIM_FADE`, share of the solid alpha]. A
 * straight ramp from a flat plateau leaves a visible edge where the slope
 * starts (Mach banding), so on a light picture the scrim read as a grey block;
 * this ease-out curve (Larsen's "easing gradients" scrim) has no such corner.
 */
const EASE: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.19, 0.738],
  [0.34, 0.541],
  [0.47, 0.382],
  [0.565, 0.278],
  [0.65, 0.194],
  [0.73, 0.126],
  [0.802, 0.075],
  [0.861, 0.042],
  [0.91, 0.021],
  [0.952, 0.008],
  [0.982, 0.002],
  [1, 0],
];
/**
 * Past this upscale a raster figure is soft at full bleed. Claim-figure caps its
 * plate at 1.25x (`UPSCALE_MAX`); a stage cannot cap without a frame, so it
 * draws and says so instead (`Scene.warnings`).
 */
const SOFT_ABOVE = 1.5;
/** A cover fit that crops more of the figure than this is warned about too. */
const CROP_ABOVE = 0.3;

/** The media's entrance, then the text's. Holds wait for both. */
const MEDIA_IN = 1.1;
const HEAD_AT = 0.9;
const LINE_AT = 1.3;
/** Every entrance has landed by here when there is text; `MEDIA_IN` when there is none. */
const TEXT_SETTLED = 2.1;

type Placed = Exclude<(typeof STAGE_PLACEMENTS)[number], "none">;

/** The column each placement sets its text in, as a share of the content width. */
const COLUMN: Readonly<Record<Placed, number>> = {
  "bottom-left": 0.62,
  "top-left": 0.62,
  center: 0.82,
  right: 0.42,
};

/**
 * The wider columns a placement's words move to, in order, when they do not fit
 * its own. A 61-character headline sets on four lines in `right`'s 0.42 column
 * at 16:9, and the planner is told up to 80 is fine; refusing it dropped the
 * slide from the deck at build. The block keeps its corner and the scrim is
 * re-derived from the wider column, so only the share of picture covered moves.
 */
const WIDER = [0.62, 0.82, 1] as const;

/** Where the block sits in the scene's flex column, and which way its scrim runs. */
const BLOCK: Readonly<Record<Placed, string>> = {
  "bottom-left": "margin-top:auto;align-self:flex-start",
  "top-left": "margin-bottom:auto;align-self:flex-start",
  center: "align-self:center;text-align:center",
  // Flush right, so the words hug the edge their scrim is measured from even
  // when a wrapped block is as wide as its column.
  right: "align-self:flex-end;text-align:right",
};

/**
 * The scrim for a text block `textH` tall whose longest line is `textW` wide,
 * in reference px of a scrim box `boxW` x `boxH`. The words' own width, not
 * their column's: a one-line headline in a 62% column left the scrim solid over
 * picture the words never reach. Solid over the block and `SCRIM_MARGIN` past it,
 * then a `SCRIM_FADE` to clear — so the picture is untouched away from the
 * words, on both axes.
 *
 * TWO GRADIENTS, MULTIPLIED: `background` runs along one axis and `mask` along
 * the other, so the scrim's alpha is the product — solid only where both are,
 * which is the block plus its margin. Two `background` layers cannot do this:
 * layers composite as a union, and a union of two full-length bands is the
 * header bar across the slide this archetype exists to avoid.
 */
export function scrimFor(
  placement: Placed,
  textH: number,
  textW: number,
  boxW: number,
  boxH: number,
): { background: string; mask: string } {
  const at = (alpha: number, px: number) => `rgba(0,0,0,${+alpha.toFixed(3)}) ${Math.round(px)}px`;
  /** The fade from `alpha` at `from` to clear at `to`, eased (`EASE`), as stops. */
  const fade = (alpha: number, from: number, to: number) =>
    EASE.map(([t, k]) => at(alpha * k, from + (to - from) * t));
  const ramp = (alpha: number, dir: string, solid: number) =>
    `linear-gradient(${dir},${[at(alpha, 0), ...fade(alpha, solid, solid + SCRIM_FADE)].join(",")})`;
  const band = (alpha: number, dir: string, mid: number, half: number) => {
    const lo = mid - half - SCRIM_MARGIN;
    const hi = mid + half + SCRIM_MARGIN;
    const stops = [
      ...fade(alpha, lo, lo - SCRIM_FADE).reverse(),
      ...fade(alpha, hi, hi + SCRIM_FADE),
    ];
    return `linear-gradient(${dir},${stops.join(",")})`;
  };
  // The block is centred in the content box, whose centre is the scrim box's:
  // the padding is symmetric once the reserve is out of both.
  const rows = (alpha: number) => band(alpha, "to bottom", boxH / 2, textH / 2);
  // The left-hand placements' lines start at the padding, `right`'s end there
  // (`BLOCK`), and `center`'s are centred on the frame.
  const fromLeft = (alpha: number) => ramp(alpha, "to right", PAD_X + textW + SCRIM_MARGIN);
  switch (placement) {
    case "bottom-left":
      return {
        background: ramp(SCRIM, "to top", PAD_Y + textH + SCRIM_MARGIN),
        mask: fromLeft(1),
      };
    case "top-left":
      return {
        background: ramp(SCRIM, "to bottom", PAD_Y + textH + SCRIM_MARGIN),
        mask: fromLeft(1),
      };
    case "right":
      return {
        background: ramp(SCRIM, "to left", PAD_X + textW + SCRIM_MARGIN),
        mask: rows(1),
      };
    case "center":
      return { background: rows(SCRIM), mask: band(1, "to right", boxW / 2, textW / 2) };
  }
}

/**
 * How much a cover fit upscales the figure and how much of it falls outside the
 * frame. In memory only, for the warning.
 */
function coverOf(fig: Figure, w: number, h: number): { scale: number; cropped: number } {
  const scale = Math.max(w / fig.width, h / fig.height);
  return { scale, cropped: 1 - (w * h) / (fig.width * scale * fig.height * scale) };
}

export const stage: Emitter<"stage"> = (beat, ctx) => {
  const { sid, theme, format } = ctx;
  const p = beat.params;
  const who = `stage ${beat.id}`;
  // `emitDeck` is public, so a pending brief is refused by name here too, not
  // as `no figure "undefined"` (claim-figure does the same).
  if (p.figureId === undefined) {
    throw new Error(`${who}: illustration not generated — run \`decksmith illustrate\``);
  }
  const fig = ctx.source.figures.find((f) => f.id === p.figureId);
  if (!fig) throw new Error(`${who}: no figure "${p.figureId}" in source ${ctx.source.id}`);

  // The media box: the whole frame but the caption reserve, in reference px for
  // the CSS and canvas px for a piece's buffer.
  const reserve = reserveRef(format);
  const boxH = refHeight(format) - reserve;
  const buffer = {
    width: format.width,
    height: format.height - Math.max(0, format.captionReserve ?? 0),
  };
  const piece =
    fig.kind === "piece" ? pieceTimeline(fig, sid, who, beat.seconds, theme.fontStack) : undefined;
  const media = plate(fig, sid, who, ctx.start, buffer);

  const warnings: string[] = [];
  if (fig.kind !== "piece") {
    const { scale, cropped } = coverOf(fig, buffer.width, buffer.height);
    if (scale > SOFT_ABOVE || cropped > CROP_ABOVE) {
      warnings.push(
        `figure "${fig.id}" (${fig.width}x${fig.height}) fills the frame at ${scale.toFixed(2)}x with ${Math.round(cropped * 100)}% cropped — ` +
          "a stage wants a picture near the frame's shape and size",
      );
    }
  }

  // THE TEXT, measured before anything is drawn, because the scrim is sized
  // from it and an over-long block is refused rather than shrunk.
  const placement = p.placement === "none" ? undefined : p.placement;
  const face = faceOf(theme.fontStack);
  const type = typeOf(face);
  // v2: the headline is the deck's headline size (`V2_TYPE`), picture or not.
  const headSize = isV2(ctx) ? V2_TYPE.headline : HEAD_SIZE;
  let col = 0;
  let textH = 0;
  let textW = 0;
  if (placement) {
    const full = contentW(format);
    // A portrait frame has no room for a side column: every placement is the
    // full width there, and `right` is told apart by its alignment instead.
    const own = isPortrait(format) ? 1 : COLUMN[placement];
    const shares = [own, ...WIDER.filter((s) => s > own)];
    let head: string[] = [];
    let lines: string[] = [];
    for (const share of shares) {
      col = Math.round(full * share);
      const measure = col * MEASURE_SLACK;
      head = wrap(p.headline, headSize, measure, type.headline.weight, 0, displayFace(face));
      lines = p.line ? wrap(p.line, LINE_SIZE, measure, 400, 0, face) : [];
      if (head.length <= MAX_HEAD_LINES && lines.length <= MAX_LINE_LINES) break;
    }
    if (head.length > MAX_HEAD_LINES) {
      throw new Error(
        `${who}: the headline sets on ${head.length} lines in the ${placement} column at ${headSize}px, ` +
          `and the overlay holds ${MAX_HEAD_LINES} even across the full width — shorten it`,
      );
    }
    if (lines.length > MAX_LINE_LINES) {
      throw new Error(
        `${who}: the line sets on ${lines.length} lines in the ${placement} column at ${LINE_SIZE}px, ` +
          `and the overlay holds ${MAX_LINE_LINES} even across the full width — shorten it`,
      );
    }
    if (col > Math.round(full * own)) {
      warnings.push(
        `the words do not fit the ${placement} column in ${MAX_HEAD_LINES} headline and ${MAX_LINE_LINES} line lines, ` +
          `so they take a ${Math.round((100 * col) / full)}% column and cover more of the picture — shorten them to keep it`,
      );
    }
    // Widened by the slack the wrap allowed for (the measure is an estimate),
    // and never past the column the browser sets the lines in.
    const widest = Math.max(
      ...head.map((l) => textWidth(l, headSize, type.headline.weight, 0, false, displayFace(face))),
      ...lines.map((l) => textWidth(l, LINE_SIZE, 400, 0, false, face)),
    );
    textW = Math.min(col, Math.ceil(widest / MEASURE_SLACK));
    textH = head.length * Math.round(headSize * HEAD_LH);
    if (lines.length) textH += LINE_GAP + lines.length * Math.round(LINE_SIZE * LINE_LH);
  }
  const scrim = placement && scrimFor(placement, textH, textW, refWidth(format), boxH);

  const line = placement && p.line ? `\n<p class="stg-l" id="${sid}-l">${esc(p.line)}</p>` : "";
  const html = [
    // `data-layout-allow-overflow`: the picture is drawn past its box on purpose
    // while it settles and drifts, and the box clips it to the frame. The box
    // itself never moves — `-mi` inside it is what enters — so the clip holds
    // at every frame, and the caption reserve below the box stays clear.
    `<div class="stg-m" id="${sid}-m" data-layout-allow-overflow><div class="stg-mi" id="${sid}-mi">${media.html}</div></div>`,
    ...(placement
      ? [
          `<div class="stg-scrim" id="${sid}-sc"></div>`,
          `<div class="stg-t stg-${placement}" id="${sid}-t"><h2 class="stg-h" id="${sid}-h">${esc(p.headline)}</h2>${line}</div>`,
        ]
      : []),
  ].join("\n");

  const tl: Tween[] = [
    tween(
      `#${sid}-mi`,
      { opacity: 0, scale: 1.06 },
      { opacity: 1, scale: 1, duration: MEDIA_IN, ease: "power2.out" },
      0,
    ),
  ];
  // A still picture keeps moving, barely, for the length of the beat — on the
  // element inside the clipping box, from exactly where its own scale starts.
  // A piece is its own motion, and a scaled canvas is a blurred one.
  if (!piece) {
    tl.push(
      tween(
        `#${sid}-m ${media.el}`,
        { scale: 1 },
        { scale: 1.04, duration: Math.max(2, beat.seconds - MEDIA_IN), ease: "none" },
        MEDIA_IN,
      ),
    );
  }
  if (placement) {
    tl.push(tween(`#${sid}-sc`, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.5));
    tl.push(
      tween(
        `#${sid}-h`,
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" },
        HEAD_AT,
      ),
    );
    if (p.line) {
      tl.push(
        tween(`#${sid}-l`, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6 }, LINE_AT),
      );
    }
  }
  if (piece) tl.push(piece.tween);

  const settled = placement ? TEXT_SETTLED : MEDIA_IN;
  const family =
    typeof face === "string" ? "" : `font-family:${theme.displayStack ?? theme.fontStack};`;
  return {
    html,
    tl,
    holds: holdsWithin([Math.max(settled, piece?.hold ?? 0)], beat.seconds),
    ...(piece ? { measure: [piece.mount], plugins: ["dsAnimate"] } : {}),
    ...(warnings.length ? { warnings } : {}),
    css: [
      // The box is the frame less the reserve, in the scene's own reference
      // px. Absolute against `.scene`, so the padding never reaches it.
      `.stg-m,.stg-scrim{position:absolute;left:0;top:0;right:0;bottom:${reserve}px}`,
      ".stg-m{overflow:hidden}",
      ".stg-mi{width:100%;height:100%}",
      ".stg-mi>img,.stg-mi>video,.stg-mi>canvas{display:block;width:100%;height:100%;object-fit:cover}",
      // The picture is the focal element. A luminance breath, because its
      // entrance tween owns `transform`; the scrim is a sibling, so the words'
      // contrast is not what breathes.
      ambient(sid, "-m", BREATHE),
      ...(placement
        ? [
            `#${sid} .stg-scrim{background:${scrim?.background};-webkit-mask-image:${scrim?.mask};mask-image:${scrim?.mask}}`,
            // In the scene's flex column, the one child in flow: the placement
            // is where the column's free space goes.
            `.stg-t{position:relative;display:flex;flex-direction:column}`,
            `#${sid} .stg-t{max-width:${col}px;${BLOCK[placement]}}`,
            `.stg-h{${family}font-size:${headSize}px;line-height:${HEAD_LH};font-weight:${type.headline.weight};color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.45);text-wrap:balance}`,
            `.stg-l{font-size:${LINE_SIZE}px;line-height:${LINE_LH};color:#ececec;margin-top:${LINE_GAP}px;text-shadow:0 2px 10px rgba(0,0,0,.45)}`,
          ]
        : []),
    ].join("\n"),
  };
};

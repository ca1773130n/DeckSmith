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
 * `SCRIM` alpha. At 0.66 black over a pure-white pixel the background is
 * 87/255, which white text clears at about 7:1, so the contrast gate passes on
 * any picture rather than on the one it was tried with. The solid extent is
 * DERIVED from the text block's measured height, so a third headline line moves
 * the scrim with it.
 *
 * THE TEXT IS NEVER SHRUNK. Headline and line have fixed sizes above the 40px
 * floor (invariant 5); text that does not fit its placement's column in
 * `MAX_HEAD_LINES` / `MAX_LINE_LINES` is refused by name, the same answer
 * callout and split-compare give.
 *
 * THE CAPTION RESERVE IS LEFT CLEAR. The media and its scrim stop `reserveRef`
 * above the bottom edge, so a deck that asked for burned captions keeps the
 * strip it asked for (`ink_in_caption_reserve`).
 */
import type { Figure, STAGE_PLACEMENTS } from "../../types.js";
import { MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween } from "../kit.js";
import { contentW, esc, PAD_X, PAD_Y, refHeight, reserveRef } from "../kit.js";
import { displayFace, faceOf, typeOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
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
const SCRIM = 0.66;
/** Margin of solid scrim past the text block, then the fade to clear. */
const SCRIM_MARGIN = 56;
const SCRIM_FADE = 360;
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

/** Where the block sits in the scene's flex column, and which way its scrim runs. */
const BLOCK: Readonly<Record<Placed, string>> = {
  "bottom-left": "margin-top:auto;align-self:flex-start",
  "top-left": "margin-bottom:auto;align-self:flex-start",
  center: "align-self:center;text-align:center",
  right: "align-self:flex-end",
};

/**
 * The scrim for a text block `textH` tall and `col` wide, in reference px of a
 * scrim box `boxH` tall. Solid over the block and `SCRIM_MARGIN` past it, then
 * a `SCRIM_FADE` to clear — so the picture is untouched away from the words.
 */
function scrimFor(placement: Placed, textH: number, col: number, boxH: number): string {
  const dark = `rgba(0,0,0,${SCRIM})`;
  const clear = "rgba(0,0,0,0)";
  const ramp = (dir: string, solid: number) =>
    `linear-gradient(${dir},${dark} 0px,${dark} ${solid}px,${clear} ${solid + SCRIM_FADE}px)`;
  switch (placement) {
    case "bottom-left":
      return ramp("to top", PAD_Y + textH + SCRIM_MARGIN);
    case "top-left":
      return ramp("to bottom", PAD_Y + textH + SCRIM_MARGIN);
    case "right":
      return ramp("to left", PAD_X + col + SCRIM_MARGIN);
    case "center": {
      // The block is centred in the content box, whose centre is the scrim
      // box's: the padding is symmetric once the reserve is out of both.
      const lo = Math.round(boxH / 2 - textH / 2 - SCRIM_MARGIN);
      const hi = Math.round(boxH / 2 + textH / 2 + SCRIM_MARGIN);
      return `linear-gradient(to bottom,${clear} ${lo - SCRIM_FADE}px,${dark} ${lo}px,${dark} ${hi}px,${clear} ${hi + SCRIM_FADE}px)`;
    }
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
  const col = placement
    ? Math.round(isPortrait(format) ? contentW(format) : contentW(format) * COLUMN[placement])
    : 0;
  let textH = 0;
  if (placement) {
    const measure = col * MEASURE_SLACK;
    const head = wrap(p.headline, HEAD_SIZE, measure, type.headline.weight, 0, displayFace(face));
    if (head.length > MAX_HEAD_LINES) {
      throw new Error(
        `${who}: the headline sets on ${head.length} lines in the ${placement} column at ${HEAD_SIZE}px, and the overlay holds ${MAX_HEAD_LINES} — ` +
          "shorten it, or use placement center, which has the widest column",
      );
    }
    textH = head.length * Math.round(HEAD_SIZE * HEAD_LH);
    if (p.line) {
      const line = wrap(p.line, LINE_SIZE, measure, 400, 0, face);
      if (line.length > MAX_LINE_LINES) {
        throw new Error(
          `${who}: the line sets on ${line.length} lines in the ${placement} column at ${LINE_SIZE}px, and the overlay holds ${MAX_LINE_LINES} — shorten it`,
        );
      }
      textH += LINE_GAP + line.length * Math.round(LINE_SIZE * LINE_LH);
    }
  }

  const line = placement && p.line ? `\n<p class="stg-l" id="${sid}-l">${esc(p.line)}</p>` : "";
  const html = [
    // `data-layout-allow-overflow`: the picture is drawn past its box on purpose
    // while it settles and drifts, and the box clips it to the frame.
    `<div class="stg-m" id="${sid}-m" data-layout-allow-overflow>${media.html}</div>`,
    ...(placement
      ? [
          `<div class="stg-scrim" id="${sid}-sc"></div>`,
          `<div class="stg-t stg-${placement}" id="${sid}-t"><h2 class="stg-h" id="${sid}-h">${esc(p.headline)}</h2>${line}</div>`,
        ]
      : []),
  ].join("\n");

  const tl: Tween[] = [
    tween(
      `#${sid}-m`,
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
      ".stg-m>img,.stg-m>video,.stg-m>canvas{display:block;width:100%;height:100%;object-fit:cover}",
      // The picture is the focal element. A luminance breath, because its
      // entrance tween owns `transform`; the scrim is a sibling, so the words'
      // contrast is not what breathes.
      ambient(sid, "-m", BREATHE),
      ...(placement
        ? [
            `#${sid} .stg-scrim{background:${scrimFor(placement, textH, col, boxH)}}`,
            // In the scene's flex column, the one child in flow: the placement
            // is where the column's free space goes.
            `.stg-t{position:relative;display:flex;flex-direction:column}`,
            `#${sid} .stg-t{max-width:${col}px;${BLOCK[placement]}}`,
            `.stg-h{${family}font-size:${HEAD_SIZE}px;line-height:${HEAD_LH};font-weight:${type.headline.weight};color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.45)}`,
            `.stg-l{font-size:${LINE_SIZE}px;line-height:${LINE_LH};color:#ececec;margin-top:${LINE_GAP}px;text-shadow:0 2px 10px rgba(0,0,0,.45)}`,
          ]
        : []),
    ].join("\n"),
  };
};

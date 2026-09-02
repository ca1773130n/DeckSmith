/**
 * A claim from the source, shown next to the figure that backs it.
 *
 * The layout is chosen from the figure's own aspect ratio rather than being a
 * parameter: EXPERIMENT-002 full-bled a 1.98-aspect figure and pushed its
 * caption 200px off-canvas. Only a genuine strip earns the full width.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc, words } from "../kit.js";
import { wrap } from "../svg.js";
import { ambient, DRIFT } from "../theme.js";
import {
  BODY_LH,
  BODY_SIZE,
  bodyBudget,
  chrome,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  tween,
} from "./title.js";

/** Caption line box plus its top margin — what the figure has to leave behind. */
const CAP_BAND = 26 + 2 * 58;

/**
 * At 1920 wide the figure box is ~1668px, and the budget under the headline —
 * once the claim and caption have their 40px lines — is about 550px tall. A
 * figure only fills the width without shrinking if it is at least that flat.
 */
const FULL_WIDTH_ASPECT = 3;

/** `.claim`'s type, its border and its padding. Named so the portrait budget agrees with the CSS. */
const CLAIM_SIZE = 50;
const CLAIM_LH = 1.5;
const CLAIM_RULE = 6 + 32;
/** The claim's column in `.cf-beside`. Named because the fit test has to agree with the CSS. */
const BESIDE_COL = 560;

/**
 * The shortest plate that is still evidence rather than a thumbnail of it.
 *
 * Two caption lines' worth of height (`BODY_SIZE * BODY_LH`, rounded, doubled).
 * A figure shorter than its own caption is not what the slide is about — which
 * is the judgement EXPERIMENT-002 already made about the 244px plate the
 * portrait grid used to draw, expressed here as the one measurement the layout
 * has on hand.
 */
const MIN_PLATE = 2 * Math.round(BODY_SIZE * BODY_LH);

export const claimFigure: Emitter<"claim-figure"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  // `emitDeck` is public, so `assertRefsResolve` is not the only way here: a
  // pending brief has to be refused by name rather than as `no figure "undefined"`.
  if (p.figureId === undefined) {
    throw new Error(
      `claim-figure ${beat.id}: illustration not generated — run \`decksmith illustrate\``,
    );
  }
  const fig = ctx.source.figures.find((f) => f.id === p.figureId);
  if (!fig) {
    throw new Error(
      `claim-figure ${beat.id}: no figure "${p.figureId}" in source ${ctx.source.id}`,
    );
  }
  const box = contentW(ctx.format);
  // PORTRAIT: everything stacks, so the aspect test never applies — a 3.6-aspect
  // strip and a square plate both get the full 860 and differ only in how much
  // height they then ask for.
  const portrait = isPortrait(ctx.format);
  const wide = !portrait && fig.width / fig.height >= FULL_WIDTH_ASPECT;

  // BESIDE IS ONLY VIABLE IF THE CLAIM FITS THE ROW. `.cf-beside` gives the claim
  // a fixed 560px column and centres the row on its tallest item, so a long claim
  // grows the row past the body box and — being centred — hangs off BOTH ends. A
  // 220-character claim rendered 27px below the canvas with every gate green.
  //
  // Nothing about the figure's size fixes that: the column is fixed, so the
  // claim's height is fixed by its own text. What fixes it is the measure. The
  // same claim over the full 1700px box wraps to roughly a third as many lines,
  // which is the stacked layout portrait already uses — so an over-tall claim
  // falls back to it rather than being refused or clipped.
  const bandFor = (width: number) =>
    wrap(p.claim, CLAIM_SIZE, width - CLAIM_RULE).length * Math.round(CLAIM_SIZE * CLAIM_LH) + 34;
  const rowBudget = bodyBudget(ctx.format, p.eyebrow, p.headline, CAP_BAND, 26);
  const tall = portrait || (!wide && bandFor(BESIDE_COL) - 34 > rowBudget);

  // Stacked, the claim is above the figure rather than beside it, so it comes out
  // of the figure's height budget. Measured against the box because that is the
  // column it now sets in; the 560px `.cf-beside` column no longer exists.
  const claimBand = tall ? bandFor(box) : 0;
  // 550 was a flat cap that left 250px of the box unused under the plate and put
  // a 1507x208 band across the top of the slide. The figure is the evidence, so
  // it takes what the chrome and the caption leave; `32` is the plate's padding
  // and border, which the cap is on the *image* rather than the wrapper.
  //
  // THE FLOOR IS ASKED FOR EXPLICITLY WHEN STACKED, and that is the whole of
  // bug ten. `bodyBudget`'s 320px default is a floor for a caller who gets space
  // FIRST — beside, the row is centred and the figure sets the height. Stacked,
  // the figure gets what the claim and the caption leave, and a 216-character
  // claim leaves 163. Told 320, the plate was sized for 320, `.cf-stack`
  // overflowed by the difference, and the caption's text landed at y=1087.16 on
  // a 1080 canvas — seven pixels, invisible to the gate until it started
  // sampling the deck's own stops rather than nine midpoints of a 92s timeline.
  const figMax =
    Math.round(
      bodyBudget(ctx.format, p.eyebrow, p.headline, CAP_BAND + claimBand, 26, tall ? 0 : undefined),
    ) - 32;
  // A claim long enough to leave no plate is not a layout to solve, it is a beat
  // to split — the same answer `split-compare` and `callout` already give, in the
  // same words. Without this the cap goes negative, the browser discards an
  // invalid `max-height`, and the figure renders at natural size: the 7px
  // overflow becomes a 400px one.
  if (figMax < MIN_PLATE) {
    throw new Error(
      `claim-figure ${beat.id}: the claim takes ${claimBand}px and leaves ${figMax}px for the figure, ` +
        `under the ${MIN_PLATE}px floor — shorten the claim or split the beat`,
    );
  }

  // The claim is the sentence the slide is FOR, so it arrives as a sentence:
  // word by word, in reading order, instead of as a block sliding in from the
  // left. Same words, same measure, same size.
  const claim = `<div class="claim" id="${sid}-c">${words(p.claim)}</div>`;
  // `figure.src` is relative to the deck's asset directory.
  const figure = `<div class="figwrap" id="${sid}-f"><img src="assets/${esc(fig.src)}" alt="${esc(fig.caption)}" /></div>`;
  const caption = `<div class="caption" id="${sid}-cap">${esc(fig.caption)}</div>`;

  // PORTRAIT: claim, then figure, then caption, each across the whole box. Side
  // by side inside 860 the grid gave the claim its authored 560px and the figure
  // the 244 that were left, which drew a 2.25-aspect plate 244px wide — a
  // thumbnail of the evidence, with its own caption set in a column so narrow it
  // broke "Reconstruction" onto its own line. The figure is the point of the
  // slide, and in portrait it can only be the point at full width.
  const body = tall
    ? `<div class="cf-stack">${claim}\n<div>${figure}\n${caption}</div></div>`
    : wide
      ? `${figure}\n<div class="cf-under">${claim}\n${caption}</div>`
      : `<div class="cf-beside">${claim}\n<div>${figure}\n${caption}</div></div>`;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid}-c .w`,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: "power2.out" },
      0.7,
    ),
    tween(`#${sid}-f`, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.8 }, 1.0),
    tween(`#${sid}-cap`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 1.7),
    // And then the picture keeps moving, barely: 3.5% over the whole beat, from
    // where its entrance left it. A figure that is still being looked at while
    // a claim is read should not be a frozen JPEG. `immediateRender: false` and
    // a `from` of exactly 1 because the entrance above owns this element's
    // first `scale` render — the invariant that cost this project a frozen
    // video once already.
    tween(
      `#${sid}-f`,
      { scale: 1 },
      {
        scale: 1.035,
        duration: Math.max(2, beat.seconds - 2.2),
        ease: "none",
        immediateRender: false,
      },
      1.8,
    ),
  ];

  return {
    html: `${chrome(sid, p.eyebrow, p.headline, box)}\n${body}`,
    tl,
    holds: holdsWithin([1.4, 2.4], beat.seconds),
    css: [
      chromeCss(theme),
      // 560, not 640: the claim was set in a column narrow enough to break a
      // sentence over four lines while the figure beside it was capped short, so
      // both halves were smaller than the slide could carry.
      `.cf-beside{display:grid;grid-template-columns:${BESIDE_COL}px 1fr;gap:56px;align-items:center;margin-top:34px}`,
      ".cf-under{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start;margin-top:26px}",
      // PORTRAIT. Two children, not three: the caption is wrapped with the plate
      // it captions. `space-between` across claim/figure/caption separately put
      // 400px between the plate and its own caption, which reads as a second note
      // about the slide rather than as the figure's label. `justify-content:center`
      // then keeps the pair together and lets the leftover fall above and below as
      // margin; `min-height:0` because the figure is the flex child that would
      // otherwise refuse to shrink past its own image. `space-evenly` rather than
      // `center`: the figure is width-bound at 860, so centring the pair left a
      // 350px hole between the headline and the claim and half that under the
      // caption. Evenly divided, the same slack reads as three equal margins.
      ".cf-stack{display:flex;flex-direction:column;justify-content:space-evenly;flex:1;min-height:0;margin-top:34px}",
      `.claim{font-size:${CLAIM_SIZE}px;line-height:${CLAIM_LH};color:${theme.fg};border-left:${CLAIM_RULE - 32}px solid ${theme.accent};padding-left:32px}`,
      // The words rise, so they have to be blocks; `inline-block` on an inline
      // run is what makes a transform apply at all.
      ".claim .w{display:inline-block}",
      `.figwrap{background:#fff;border:1px solid ${theme.rule};border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:center;margin-top:26px}`,
      // Height-capped rather than width-driven: a square figure in the beside
      // layout would otherwise be ~970px tall and run off the canvas. The cap is
      // the measured remainder, not a constant — see `figMax`.
      `.figwrap img{max-width:100%;max-height:${figMax}px;width:auto;height:auto;display:block}`,
      `.caption{font-size:${BODY_SIZE}px;line-height:${BODY_LH};color:${theme.dim};margin-top:16px}`,
      // The image, not its wrapper: the wrapper's entrance already writes
      // `transform`. 1.2% of the 550px cap is 3.3px a side, which the wrapper's
      // 16px padding absorbs — the swell can never reach the canvas edge.
      ambient(sid, "-f img", DRIFT),
    ].join("\n"),
  };
};

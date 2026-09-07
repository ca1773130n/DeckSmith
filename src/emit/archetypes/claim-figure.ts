/**
 * A claim from the source, shown next to the figure that backs it.
 *
 * The layout is chosen from the figure's own aspect ratio rather than being a
 * parameter: EXPERIMENT-002 full-bled a 1.98-aspect figure and pushed its
 * caption 200px off-canvas. Only a genuine strip earns the full width.
 */
import type { Figure } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentW, esc, words } from "../kit.js";
import { faceOf, wrap } from "../svg.js";
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

/**
 * Two caption line boxes plus the margin above them — what the figure has to
 * leave behind.
 *
 * DERIVED, because the literal it replaces went stale silently. `58` was
 * `40 * 1.45` frozen when `BODY_SIZE` was 40; the density pass moved `BODY_SIZE`
 * to 44 and the line box became 64, so every claim-figure beat was told the
 * caption needed 12px less than it does, and spent the difference on the plate.
 * The size has since come back to 40 and the arithmetic agrees again — which is
 * exactly why this has to derive rather than sit at a number that happens to be
 * right today.
 *
 * The `26` is deliberately not `.caption`'s 16px margin: it is the same figure
 * `bodyBudget` is given as `top`, and over-counting the band by 10px is the
 * direction that leaves the caption on the canvas.
 *
 * TWO LINES IS AN ASSUMPTION, not a measurement, and it is the one number here
 * that can be wrong in the dangerous direction: a caption that wraps to three
 * charges the figure a line it was never given, so the plate is solved too tall
 * and the caption is the thing pushed down. The demo's own claim-figure sets a
 * three-line caption. It is left as an assumption rather than measured because
 * the caption's column is not known until the layout branch below has chosen
 * (beside, under or stacked), and that branch reads this number — measuring it
 * properly means breaking that circle, which is more than this fix. What the
 * constant buys instead is a name: the next person to see a caption sitting low
 * has something to grep for.
 */
const CAP_LINES_ASSUMED = 2;
const CAP_BAND = 26 + CAP_LINES_ASSUMED * Math.round(BODY_SIZE * BODY_LH);

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

/** What the plate holds, and the tag its height cap and its drift rule name. */
interface Plate {
  html: string;
  /** `img` or `video`. One CSS rule is written, for whichever is actually there. */
  el: "img" | "video";
}

/**
 * A CLIP WE HOLD THE FILE FOR IS A `<video>`. EVERYTHING ELSE IS AN `<img>`.
 *
 * A PLAYER-PAGE CLIP IS NOT AN ERROR PATH, and that is the whole of why this
 * branches on `href` rather than on `kind`. `href` is present exactly when the
 * video's bytes were unavailable — src/types.ts calls it "Absent for a clip we
 * hold the file for" — and the still is then everything any format can show,
 * which is what `renderSource` already promises the planner in those words
 * ("its still is all any format will ever show"). Refusing there would delete a
 * beat the planner was told it could spend, over a picture that draws perfectly
 * well.
 *
 * The `<img>` branch is byte-for-byte the markup every still has always had, so
 * a deck with no clip in it is the deck it was.
 */
function plate(fig: Figure, sid: string, beatId: string, start: number | undefined): Plate {
  const img = (src: string): Plate => ({
    html: `<img src="assets/${esc(src)}" alt="${esc(fig.caption)}" />`,
    el: "img",
  });
  if (fig.kind !== "clip") return img(fig.src);
  if (fig.href !== undefined) {
    // Nothing to draw, said with the one instruction that fixes it. A clip with
    // neither bytes nor a still is a harvest that half-ran; the beat is not the
    // thing that is wrong, so the message names the figure and the step.
    if (fig.poster === undefined) {
      throw new Error(
        `claim-figure ${beatId}: figure "${fig.id}" is a clip we hold no file for and no still of — ` +
          `re-ingest it so its poster is measured, or point the beat at a figure this deck has`,
      );
    }
    return img(fig.poster);
  }

  // MUTED, AND THAT IS A DECISION ABOUT THE ONE AUDIO TRACK rather than about
  // taste. hyperframes muxes a clip's audio only where the tag says
  // `data-has-audio="true"`, and its compiler derives that attribute from this
  // one: a muted tag compiles to `data-has-audio="false"`. The deck already
  // spends its single track on narration, so an unmuted clip would put the
  // paper's own soundtrack underneath the voice explaining it.
  //
  // NO `autoplay` AND NO `controls`. The deck holds a clip paused on its poster
  // until someone presses play — again the promise `renderSource` makes to the
  // planner — and `controls` would paint a browser's own chrome into every
  // rendered frame.
  //
  // `data-start` IS LOAD-BEARING, NOT DECORATION, AND IT IS ABSOLUTE. The
  // runtime seeks `video[data-start]` and nothing else, and it reads the value
  // as a second on the DECK's clock: `currentTime = t − data-start`. So a clip
  // that declares a scene-relative start is seeked into a window that closed
  // before its own scene opened, and the plate holds the clip's last frame for
  // the length of the beat with every gate green.
  //
  // MEASURED at 0.8.27, because the alternative reads as correct. hyperframes'
  // compiler injects `data-start="0" data-hf-auto-start=""` into a media tag
  // that declares no timing, and its runtime resolves that marker against the
  // enclosing `[data-composition-id]` — this scene's wrapper — so the marker
  // ought to be enough. It is not: on a two-beat deck whose clip runs red, then
  // green, then blue, two seconds each, with the claim-figure scene starting at
  // 7s, the marker rendered BLUE at composition 9.5s, 10.5s and 12.5s — one
  // frozen frame, the clip having ended at second 6 — while `data-start="7"`
  // rendered green, green, blue, which is clip seconds 2.5, 3.5 and 5.5.
  //
  // `ctx.start` is that number, already rounded to invariant 10's three places
  // by the shell, and it is the SAME number the scene wrapper publishes. It is
  // optional on `EmitContext` because eleven other archetypes never ask for it —
  // so a clip refuses by name rather than guessing when nobody has said.
  //
  // INVARIANT 11 IS NOT BROKEN HERE, AND MUST NOT BE "FIXED" INTO BEING. The
  // clip advances because the runtime's media adapter writes `currentTime` from
  // OUTSIDE the timeline, per captured frame; nothing on this scene's timeline
  // touches the element. The obvious improvement — an `onUpdate` that pushes
  // `currentTime` — is exactly the callback invariant 11 forbids, and it would
  // buy a seek the runtime already performs at 24x the non-reproducible frames.
  if (start === undefined) {
    throw new Error(
      `claim-figure ${beatId}: figure "${fig.id}" is a clip, and nobody said when this scene starts — ` +
        "the video is seeked on the deck's absolute clock, so `EmitContext.start` has to be passed",
    );
  }
  const poster = fig.poster === undefined ? "" : ` poster="assets/${esc(fig.poster)}"`;
  return {
    html: `<video id="${sid}-v" src="assets/${esc(fig.src)}"${poster} data-start="${start}" preload="auto" playsinline muted></video>`,
    el: "video",
  };
}

export const claimFigure: Emitter<"claim-figure"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const face = faceOf(theme.fontStack);

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
    wrap(p.claim, CLAIM_SIZE, width - CLAIM_RULE, 400, 0, face).length *
      Math.round(CLAIM_SIZE * CLAIM_LH) +
    34;
  const rowBudget = bodyBudget(ctx.format, p.eyebrow, p.headline, CAP_BAND, 26, undefined, face);
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
      bodyBudget(
        ctx.format,
        p.eyebrow,
        p.headline,
        CAP_BAND + claimBand,
        26,
        tall ? 0 : undefined,
        face,
      ),
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
  const held = plate(fig, sid, beat.id, ctx.start);
  const figure = `<div class="figwrap" id="${sid}-f">${held.html}</div>`;
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
    html: `${chrome(sid, p.eyebrow, p.headline, box, face)}\n${body}`,
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
      //
      // NAMED FOR THE TAG THAT IS ACTUALLY THERE rather than written for both.
      // A rule listing `img, video` would move the bytes of every deck we have
      // ever built to describe an element almost none of them contain, and a
      // rule naming only `img` over a clip is a cap that silently does not
      // apply — the video would render at its natural 1920x1080 and run off the
      // canvas, which is invariant-5 territory that no gate reads.
      `.figwrap ${held.el}{max-width:100%;max-height:${figMax}px;width:auto;height:auto;display:block}`,
      `.caption{font-size:${BODY_SIZE}px;line-height:${BODY_LH};color:${theme.dim};margin-top:16px}`,
      // The image, not its wrapper: the wrapper's entrance already writes
      // `transform`. 1.2% of the 550px cap is 3.3px a side, which the wrapper's
      // 16px padding absorbs — the swell can never reach the canvas edge. Same
      // reason as the cap above for naming the tag: a drift rule aimed at `img`
      // over a `<video>` is one ambient rule that animates nothing, and the
      // slide reads as dead rather than as held.
      ambient(sid, `-f ${held.el}`, DRIFT),
    ].join("\n"),
  };
};

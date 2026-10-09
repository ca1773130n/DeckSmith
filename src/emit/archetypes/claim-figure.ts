/**
 * A claim from the source, shown next to the figure that backs it.
 *
 * The layout is chosen from the figure's own aspect ratio rather than being a
 * parameter: EXPERIMENT-002 full-bled a 1.98-aspect figure and pushed its
 * caption 200px off-canvas. Only a genuine strip earns the full width.
 */
import type { Figure } from "../../types.js";
import { PIECE_ATTR } from "../animate-runtime.js";
import { type Fit, fitOf, isV2, MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween } from "../kit.js";
import { esc, staggerFor, wordAtoms, words } from "../kit.js";
import { frameOf, variantOf } from "../look.js";
import { type Face, faceOf, textWidth, wrap } from "../svg.js";
import { ambient, DRIFT } from "../theme.js";
import {
  BODY_LH,
  BODY_SIZE,
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

/* ------------------------------------------------------------------ v2 fit */

/** v2: the claim may grow to this, never to more lines than it set on at `CLAIM_SIZE`. */
const CLAIM_MAX = 72;
/**
 * v2: a figure is drawn up to this many times its natural pixel size. The plate
 * used to be `width:auto;height:auto`, so a 632px figure stayed 632px in a
 * 1000px column. It was 2, and the review (2026-10-08) found two figures
 * upscaled 1.8x and 2.07x and visibly blurry (en s11, s13); past about 1.25x a
 * raster figure is soft, which is a worse slide than a smaller sharp one.
 */
const UPSCALE_MAX = 1.25;
/** `.figwrap`'s padding and border, both sides: what the plate adds around the image. */
const PLATE_PAD = 34;
/** Below this aspect a figure is too tall to set full-width above its claim. */
const UNDER_MIN_ASPECT = 1.5;
/** Another arrangement must beat the classic one by this much fill to replace it. */
const SWITCH_MARGIN = 0.08;
/**
 * …and must not draw the figure smaller than this share of the classic one's
 * area. Fill is a vertical extent, so a full-width plate holding a
 * height-bound image read as FULL while the image shrank: en s13's 491x282
 * photo in a 1760px plate (review, 2026-10-08).
 */
const SWITCH_AREA = 0.9;

/* ------------------------------------------------------------ the piece */

/**
 * An animate piece starts with its plate: the figure's entrance tween below
 * begins at 1.0s, so frame 0 fades in with the plate and the piece then plays.
 */
const PIECE_AT = 1;
/** Static frames after the piece's last one, before the hold that follows it. */
const PIECE_TAIL = 0.3;
/**
 * The rate a piece is baked at: hyperframes' render default. On animate's twos
 * that steps evenly at 15 Hz. `render --fps 24` resamples it, with judder.
 */
const PIECE_FPS = 30;
/** A piece's id is written into a script; nothing that needs escaping gets there. */
const PIECE_ID = /^[A-Za-z0-9_.-]+$/;
/** Invariant 10 at the piece's clock. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Mode = "tall" | "wide" | "beside";

/** One way to draw the beat, predicted. */
export interface Arrangement {
  mode: Mode;
  claimSize: number;
  plate: { w: number; h: number };
  fit: Fit;
}

/**
 * The v2 arrangements this beat can take, each with the figure SIZED rather
 * than capped, and the classic one's mode first.
 *
 * The arithmetic is the same the classic path does — `bandFor`'s claim lines,
 * two-caption-line bands, the plate's padding — but solved FOR the plate's size
 * instead of capping it: the image gets the largest box that fits both its
 * column and the height left under the chrome, at its own aspect, up to
 * `UPSCALE_MAX`. `under` (the full-width arrangement classic reserves for 3:1
 * strips) is offered to any figure flatter than `UNDER_MIN_ASPECT`, because the
 * median HypePaper figure is 2.3:1 and beside a 560px claim it is width-bound at
 * about 450px tall in a 760px region.
 */
function arrangements(
  classic: Mode,
  fig: Figure,
  claim: string,
  caption: string,
  box: number,
  region: number,
  portrait: boolean,
  face: Face,
): Arrangement[] {
  const aspect = fig.width / fig.height;
  // Against `MEASURE_SLACK` of the column, and counted as the browser sets
  // `words()`: these line counts are what the plate is then sized against, to
  // the pixel, so a line the browser adds is a line pushed through the bottom
  // of the slide. See `blockLines` and the constant.
  const claimLines = (width: number, size: number) =>
    blockLines(claim, size, (width - CLAIM_RULE) * MEASURE_SLACK, face);
  const claimH = (width: number, size: number) =>
    claimLines(width, size) * Math.round(size * CLAIM_LH);
  const capH = (width: number) =>
    16 +
    wrap(caption, BODY_SIZE, width * MEASURE_SLACK, 400, 0, face).length *
      Math.round(BODY_SIZE * BODY_LH);
  /** Grow the claim without adding a line, and without passing `room`. */
  const grownClaim = (width: number, room: number) => {
    const lines = claimLines(width, CLAIM_SIZE);
    let size = CLAIM_MAX;
    while (size > CLAIM_SIZE && (claimLines(width, size) > lines || claimH(width, size) > room))
      size--;
    return size;
  };
  const plateIn = (w: number, h: number) => {
    const k = Math.max(0, Math.min(w / fig.width, h / fig.height, UPSCALE_MAX));
    return { w: Math.floor(fig.width * k), h: Math.floor(fig.height * k) };
  };
  const out: Arrangement[] = [];
  const add = (mode: Mode) => {
    if (mode === "beside") {
      const col = box - BESIDE_COL - 56;
      const cap = capH(col);
      const plate = plateIn(col - PLATE_PAD, region - 34 - 26 - PLATE_PAD - cap);
      const claimSize = grownClaim(BESIDE_COL, region - 34);
      const right = 26 + plate.h + PLATE_PAD + cap;
      out.push({
        mode,
        claimSize,
        plate,
        fit: fitOf(Math.max(claimH(BESIDE_COL, claimSize), right), region),
      });
    } else if (mode === "wide") {
      const half = (box - 56) / 2;
      // The claim grows only into height the figure does not need at its classic
      // size (its own pixels, or the box's width). Grown without a bound, a
      // 120-character claim took the plate down to 206px tall — 40% of what
      // v0.8.0 drew (set20 8872a314 s3, fix-round Tier A).
      const classicH = Math.min(fig.height, ((box - PLATE_PAD) * fig.height) / fig.width);
      const claimSize = grownClaim(half, Math.max(0, region - 26 - PLATE_PAD - 26 - classicH));
      const row = Math.max(claimH(half, claimSize), capH(half) - 16);
      const plate = plateIn(box - PLATE_PAD, region - 26 - PLATE_PAD - 26 - row);
      out.push({ mode, claimSize, plate, fit: fitOf(plate.h + PLATE_PAD + 26 + row, region) });
    } else {
      // Stacked: the claim takes the figure's height, so it does not grow here.
      const band = claimH(box, CLAIM_SIZE);
      const cap = capH(box);
      const plate = plateIn(box - PLATE_PAD, region - 34 - band - 26 - PLATE_PAD - cap);
      const used = band + 26 + plate.h + PLATE_PAD + cap;
      // `.cf-stack` is `space-evenly`: of the slack, the two gaps between its
      // children are inside the painted extent and the two ends are not.
      const slack = Math.max(0, region - 34 - used);
      out.push({ mode, claimSize: CLAIM_SIZE, plate, fit: fitOf(used + slack / 3, region) });
    }
  };
  add(classic);
  if (!portrait && classic === "beside" && aspect >= UNDER_MIN_ASPECT) add("wide");
  return out;
}

/** The arrangement to draw: the classic mode unless another fills clearly more. */
export function choose(options: readonly Arrangement[]): Arrangement {
  const score = (a: Arrangement) => Math.min(1, a.fit.fill);
  const area = (a: Arrangement) => a.plate.w * a.plate.h;
  let best = options[0] as Arrangement;
  for (const a of options.slice(1)) {
    if (score(a) > score(best) + SWITCH_MARGIN && area(a) >= SWITCH_AREA * area(best)) best = a;
  }
  return best;
}

/**
 * Lines the claim sets on, counted the way the browser lays out `words()`.
 *
 * `words()` makes every whitespace-separated run an `inline-block` so it can
 * rise on its own — and an inline-block is never broken across a line: a run
 * that does not fit what is left of the line moves to the next one WHOLE, and
 * a run wider than the column is a block of its own, full width, wrapping
 * inside. `wrap` breaks a long run in place, which is the right count for prose
 * and the wrong one here. On a Japanese claim with Latin numbers in it —
 * "ResNet34版は38.3 → 46.9、V2-99版は41.9 → …" — `wrap` said four lines and
 * the browser set eight, and the grown claim ran 44px off the canvas.
 */
function blockLines(text: string, size: number, width: number, face: Face): number {
  const space = textWidth(" ", size, 400, 0, false, face);
  let lines = 0;
  /** Width used on the line being filled; 0 when it is empty. */
  let used = 0;
  // The atoms `words(…, { unspaced: true })` draws — a CJK run per character —
  // with a space charged only where the text has one.
  for (const { text: run, spaced } of wordAtoms(text)) {
    const gap = spaced ? space : 0;
    const w = textWidth(run, size, 400, 0, false, face);
    if (w > width) {
      // Its own block, from a fresh line, full width to its last line.
      if (used > 0) lines++;
      lines += wrap(run, size, width, 400, 0, face).length - 1;
      used = width;
    } else if (used === 0) {
      used = w;
    } else if (used + gap + w <= width) {
      used += gap + w;
    } else {
      lines++;
      used = w;
    }
  }
  return used > 0 ? lines + 1 : lines;
}

/** What the plate holds, and the tag its height cap and its drift rule name. */
interface Plate {
  html: string;
  /** `img`, `video` or `canvas`. One CSS rule is written, for whichever is actually there. */
  el: "img" | "video" | "canvas";
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
 *
 * AND IT STAYS AN `<img>` NOW THAT `deck.html` CAN BUILD A REAL PLAYER FROM THE
 * SAME FIGURE. `emitDeck` asks `embedUrl` for the frame-able form of this
 * `href` and writes it into a deck-only island, so a presented deck offers
 * click-to-play where the mp4 shows the still. None of that reaches here, and it
 * must not: this markup goes into `index.html`, which is the document the
 * renderer CAPTURES. A third-party frame there breaks invariant 4 twice over —
 * virtual time is propagated only into same-origin frames, so the embed would
 * play at wall-clock speed while the deck is seeked; and the compile-time
 * localiser has no pattern for an iframe's src, so every render would refetch it
 * from the network. `scanDeterminism` refuses a literal `<iframe` in a
 * composition, and test/emit.test.ts ("never embeds a document it does not own")
 * asserts the vocabulary never writes one — or this figure's watch URL — to
 * begin with.
 */
function plate(fig: Figure, sid: string, beatId: string, start: number | undefined): Plate {
  const img = (src: string): Plate => ({
    html: `<img src="assets/${esc(src)}" alt="${esc(fig.caption)}" />`,
    el: "img",
  });
  // A PIECE IS A CANVAS AND THE SCRIPT THAT DRAWS ON IT. The script registers the
  // piece's factory as the document parses; the scene's `measure` mounts it on
  // this canvas, and the `dsAnimate` tween draws it (see the emitter below).
  // `role="img"` and the caption as its label, because a canvas has no `alt`.
  // `PIECE_ATTR` marks it 2D, so a checker without WebGL still measures it.
  if (fig.kind === "piece") {
    return {
      html:
        `<canvas id="${sid}-pc" ${PIECE_ATTR} width="${fig.width}" height="${fig.height}" role="img" aria-label="${esc(fig.caption)}"></canvas>` +
        `<script src="assets/${esc(fig.src)}"></script>`,
      el: "canvas",
    };
  }
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

/**
 * What a piece adds to the scene: the statement that mounts it, ONE `fromTo`
 * that plays it, and the hold after its last frame.
 *
 * THE TWEEN IS THE ONLY THING THAT DRAWS (invariants 1 and 11). Its value is
 * the piece's own second — `0` to `seconds` over `seconds`, ease "none" —
 * and the `dsAnimate` plugin draws that second as part of the seek
 * (src/emit/animate-runtime.ts). No callback, no CSS animation: before the
 * tween the canvas holds frame 0, after it the last frame, so holds and slide
 * edges are static.
 *
 * `hand` is the deck's font stack, for the kit's `HAND`: a piece draws no text,
 * and the kit's `measureText` should still never name a family the deck does
 * not declare (invariant 9).
 *
 * REFUSED BY NAME rather than clamped: a piece with no length has no clock, and
 * a beat too short for the piece would end it mid-motion with the hold clamped
 * on top of a moving frame.
 */
function pieceTimeline(
  fig: Figure,
  sid: string,
  beatId: string,
  seconds: number,
  hand: string,
): { tween: Tween; mount: string; hold: number } {
  if (fig.seconds === undefined) {
    throw new Error(
      `claim-figure ${beatId}: figure "${fig.id}" is a piece with no \`seconds\` — a piece is its own clock, so its source.json entry has to say how long it plays`,
    );
  }
  if (!PIECE_ID.test(fig.id)) {
    throw new Error(
      `claim-figure ${beatId}: piece "${fig.id}" has an id a script cannot carry as written — use letters, digits, ".", "_" and "-"`,
    );
  }
  const run = r3(fig.seconds);
  const hold = r3(PIECE_AT + run + PIECE_TAIL);
  if (hold > seconds) {
    throw new Error(
      `claim-figure ${beatId}: piece "${fig.id}" plays ${run}s from ${PIECE_AT}s and holds ${PIECE_TAIL}s, ` +
        `which needs ${hold}s, and the beat is ${seconds}s — lengthen the beat or shorten the piece`,
    );
  }
  const cfg = `{ seconds: ${run}, fps: ${PIECE_FPS}, hand: ${JSON.stringify(hand)} }`;
  return {
    tween: tween(
      `#${sid}-pc`,
      { dsAnimate: 0 },
      { dsAnimate: run, duration: run, ease: "none" },
      PIECE_AT,
    ),
    mount: `DSAnimate.mount(document.getElementById("${sid}-pc"), "${fig.id}", ${cfg})`,
    hold,
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
  const piece =
    fig.kind === "piece"
      ? pieceTimeline(fig, sid, beat.id, beat.seconds, theme.fontStack)
      : undefined;
  /**
   * The content box, or what the chosen placement leaves the body
   * (src/emit/look.ts). The figure this beat draws is named so an aside in the
   * rail never repeats it.
   */
  const F = frameOf(ctx, {
    eyebrow: p.eyebrow,
    headline: p.headline,
    drawn: [p.figureId],
    evidence: beat.evidence,
  });
  const box = F.w;
  const variant = variantOf(ctx, "claim-figure");
  // PORTRAIT: everything stacks, so the aspect test never applies — a 3.6-aspect
  // strip and a square plate both get the full 860 and differ only in how much
  // height they then ask for. The `stacked` variant asks for that arrangement on
  // a wide canvas too.
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
  const rowBudget = F.budget(CAP_BAND, 26);
  const tall = portrait || variant === "stacked" || (!wide && bandFor(BESIDE_COL) - 34 > rowBudget);
  // `mirror` is the beside row with the figure first. Where the row is not drawn —
  // a strip figure set under, or a claim too long to stand beside — it would
  // be the classic slide under another name, which is exactly what the sameness
  // metrics must not be told. So it refuses, and the Director looks elsewhere.
  const mirror = variant === "mirror";
  if (mirror && (tall || wide)) {
    throw new Error(`claim-figure ${beat.id}: mirror needs the beside row, and this beat stacks`);
  }

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
  const figMax = Math.round(F.budget(CAP_BAND + claimBand, 26, tall ? 0 : undefined)) - 32;
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

  // v2 decides the arrangement and SIZES the plate, after every classic refusal
  // above has had its say — so v2 draws exactly the beats classic draws.
  const v2 = isV2(ctx);
  // A layout variant (src/emit/look.ts) IS an arrangement, so the fit engine
  // only sizes it: `mirror` stays a beside row rather than being swapped for the
  // full-width one, which would be the classic slide under another name.
  const chosen = v2
    ? choose(
        arrangements(
          tall ? "tall" : wide ? "wide" : "beside",
          fig,
          p.claim,
          fig.caption,
          box,
          F.budget(0, 0, 0),
          portrait,
          face,
        ).filter((a) => !mirror || a.mode === "beside"),
      )
    : undefined;
  const mode: Mode = chosen?.mode ?? (tall ? "tall" : wide ? "wide" : "beside");

  // The claim is the sentence the slide is FOR, so it arrives as a sentence:
  // word by word, in reading order, instead of as a block sliding in from the
  // left. Same words, same measure, same size.
  // v2 sets a CJK claim character by character (`wordAtoms`), so it wraps like
  // the script it is instead of in sentence-long blocks.
  const claim = `<div class="claim" id="${sid}-c">${words(p.claim, "w", { unspaced: v2 })}</div>`;
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
  const body =
    mode === "tall"
      ? `<div class="cf-stack">${claim}\n<div>${figure}\n${caption}</div></div>`
      : mode === "wide"
        ? `${figure}\n<div class="cf-under">${claim}\n${caption}</div>`
        : mirror
          ? `<div class="cf-beside cf-mirror"><div>${figure}\n${caption}</div>\n${claim}</div>`
          : `<div class="cf-beside">${claim}\n<div>${figure}\n${caption}</div></div>`;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    ...F.tl,
    tween(
      `#${sid}-c .w`,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: v2 ? staggerFor(wordAtoms(p.claim).length, 0.05) : 0.05,
        ease: "power2.out",
      },
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
    ...(piece ? [piece.tween] : []),
  ];

  // The area the image is painted at: the solved plate under v2, and what
  // `max-width:100%` and `figMax` leave of its natural size otherwise.
  const column = mode === "beside" ? box - BESIDE_COL - 56 - PLATE_PAD : box - PLATE_PAD;
  const natural = Math.min(1, column / fig.width, figMax / fig.height);
  const figureArea = chosen
    ? chosen.plate.w * chosen.plate.h
    : Math.round(fig.width * natural * fig.height * natural);

  return {
    html: F.compose(body),
    tl,
    holds: holdsWithin(piece ? [piece.hold] : [1.4, 2.4], beat.seconds),
    ...(piece ? { measure: [piece.mount], plugins: ["dsAnimate"] } : {}),
    ...(chosen ? { fit: chosen.fit } : {}),
    figureArea,
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
      //
      // SCOPED TO THE SCENE UNDER `--design v2`. Scene CSS is one global sheet,
      // so this per-beat number, written as a bare class rule, is decided for
      // EVERY claim-figure in the deck by whichever one comes last: measured on a
      // shipped v0.8.0 deck (3b9eaf0b.en), four rules of 308/492/492/566px, and a
      // plate solved for 308 then drawn at up to 566. Classic keeps its bytes;
      // v2 scopes it so each plate gets the height its own slide solved.
      `${ctx.look || v2 ? `#${sid} ` : ""}.figwrap ${held.el}{max-width:100%;max-height:${figMax}px;width:auto;height:auto;display:block}`,
      `.caption{font-size:${BODY_SIZE}px;line-height:${BODY_LH};color:${theme.dim};margin-top:16px}`,
      // The image, not its wrapper: the wrapper's entrance already writes
      // `transform`. 1.2% of the 550px cap is 3.3px a side, which the wrapper's
      // 16px padding absorbs — the swell can never reach the canvas edge. Same
      // reason as the cap above for naming the tag: a drift rule aimed at `img`
      // over a `<video>` is one ambient rule that animates nothing, and the
      // slide reads as dead rather than as held.
      ambient(sid, `-f ${held.el}`, DRIFT),
      // v2: the plate is SIZED, not capped, and scoped to this scene. The shared
      // rule above carries whichever scene's `figMax` the stylesheet emitted
      // last — `max-height:none` here is what stops a neighbour's cap squashing
      // this plate. `object-fit` covers the sub-pixel the floors leave.
      ...(chosen
        ? [
            `#${sid} .figwrap ${held.el}{width:${chosen.plate.w}px;height:${chosen.plate.h}px;max-height:none;object-fit:contain}`,
            // The plate HUGS its image. It was a block as wide as its column, so a
            // height-bound figure sat small in a wide white slab — on a dark deck,
            // an empty white box (en s13: 25% of a 1760x318 plate was picture).
            `#${sid} .figwrap{width:fit-content;max-width:100%;margin-left:auto;margin-right:auto}`,
            ...(chosen.claimSize === CLAIM_SIZE
              ? []
              : [`#${sid} .claim{font-size:${chosen.claimSize}px}`]),
          ]
        : []),
      ...(mirror ? [`#${sid} .cf-mirror{grid-template-columns:1fr ${BESIDE_COL}px}`] : []),
      ...(F.css ? [F.css] : []),
    ].join("\n"),
  };
};

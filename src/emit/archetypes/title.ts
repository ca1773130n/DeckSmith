/**
 * The opening beat — and the slide chrome the other five archetypes reuse.
 *
 * A title slide is that chrome, enlarged and centred, so the eyebrow/headline
 * block and its theme-derived CSS live here rather than being written out five
 * more times. `kit.ts` owns the seam between shell and vocabulary; it does not
 * own the vocabulary's typography.
 */
import type { Format } from "../../types.js";
import type { Emitter, Theme, Tween, Vars } from "../kit.js";
import { contentH, contentW, esc, fromTo, words } from "../kit.js";
import { type Face, faceOf, textWidth, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";

/**
 * Whether this format's content box is taller than it is wide.
 *
 * The one question an archetype has to ask before it lays anything out. At
 * `short-9x16` the box is 860x1752 against 16:9's 1700x912 — half as wide and
 * nearly twice as tall — so a two-column comparison wants to become two stacked
 * rows and a chart wants its readout underneath rather than beside it. Clamping
 * a wide arrangement to the narrower width fits and still looks wrong.
 *
 * Read off the format rather than off `contentW`/`contentH` so `post-1x1`
 * (1080x1080, box 860x912) stays on the landscape branch: it is square, and the
 * landscape arrangements are the ones that survive a square box.
 */
export function isPortrait(format: Format): boolean {
  return format.height > format.width;
}

/**
 * The chrome's type scale, and the line boxes that fall out of it.
 *
 * These are exported because every archetype that draws a diagram has to know
 * how much room the chrome took before it can decide how big the diagram is. A
 * duplicated `const HEADLINE_H = 64` in five files is a type scale that can only
 * ever be changed in one of them, and the other four then overflow or leave a
 * band — both silent.
 *
 * 64/42/40, down from 76/42/44. The density pass that set 76 was answering a
 * real complaint — at 66/40 the whole slide read as body text with one slightly
 * larger line — but it overshot the measure. MEASURED at contentW 1700: a 76px
 * headline line holds 45 characters, and the planner is asked for headlines
 * longer than that, so TEN of `demo/storyboard.json`'s twelve wrapped to two
 * lines and each spent 174px of a 912px box saying one sentence. At 64 the same
 * line holds 53: three still wrap, seven stop, and a headline that stops hands
 * 100px back to the body (174 -> 74) while one that still wraps hands back 26
 * (174 -> 148). Across the demo that is 804px, 67 a beat — which is the space
 * the owner said the deck was wasting.
 *
 * EYEBROW_SIZE STAYS AT 42. It is the one line that is already short by
 * contract, so shrinking it buys ~10px and costs the only contrast the chrome
 * has between its two lines.
 *
 * BODY_SIZE goes to 40, which IS the floor. That is deliberate and it is legal:
 * `scanTypeFloor` compares `px < floorPx` (src/verify/typefloor.ts), so 40
 * passes, and the demo already declares 40 in ten places. There is no room under
 * this one — the next archetype that wants a body notch smaller has to take less
 * text instead.
 */
export const EYEBROW_SIZE = 42;
export const EYEBROW_LH = 1.2;
/** One line box. The block is this per line, plus `margin-bottom` once. */
export const EYEBROW_LINE = Math.round(EYEBROW_SIZE * EYEBROW_LH);
export const EYEBROW_GAP = 22;
/** One line box plus `margin-bottom` — the one-line case, which is the common one. */
export const EYEBROW_H = EYEBROW_LINE + EYEBROW_GAP;
/**
 * The eyebrow is drawn UPPERCASE at `.14em` of tracking, and the headline at
 * `-.015em`. Neither is decoration to the arithmetic below: measured against the
 * browser, a 60-character eyebrow sets on two lines where an untracked
 * lowercase measurement predicts one, and a 138-character headline sets on three
 * where an untracked one predicts four.
 */
export const EYEBROW_TRACKING = 0.14;
export const HEADLINE_TRACKING = -0.015;
export const HEADLINE_SIZE = 64;
export const HEADLINE_LH = 1.15;
export const HEADLINE_H = Math.round(HEADLINE_SIZE * HEADLINE_LH);

/** Body copy — notes, captions, claims. ON the floor, deliberately: see above. */
export const BODY_SIZE = 40;
export const BODY_LH = 1.45;

/**
 * A last line of this many words or fewer is an orphan, not a line.
 *
 * The density pass that grew the headline to 76px had five of the demo's twelve
 * breaking as "…is read / through", "…not the / smallest", "…behind recent
 * / models". One stranded word under a full measure reads as a typesetting
 * accident. Coming back down to 64 removes six of those breaks outright but not
 * the shape: at 9:16 — where the box is 860 wide and the type is proportionally
 * twice as large — nearly every headline of any length still does it.
 */
const ORPHAN_WORDS = 2;

/** Spelled as an escape. As a literal it is a space nobody reviewing this file can see. */
const NBSP = "\u00a0";

/**
 * Bind the tail of a headline so it cannot break to a one- or two-word last line.
 *
 * Gluing the final words with U+00A0 pulls one more word down with the orphan:
 * "…the carrier is read / through" becomes "…the carrier is / read through". The
 * line count does not change — greedy wrapping only ever moves words forward — so
 * `chromeHeight` needs no adjustment and keeps measuring the raw string. (`wrap`
 * splits on `\s`, which U+00A0 is, so it would not see the binding anyway; the
 * width guard below is what keeps the browser's line count in step.)
 *
 * The run bound is the WIDEST that fits the measure, from `tail + 1` words down
 * to two, rather than `tail + 1` alone. `wrap` errs wide by construction, so its
 * last line is not the browser's: it broke "…reports three / different numbers"
 * where the browser broke "…reports three different / numbers", and the three
 * words it asked for were both too wide for the measure and aimed at an orphan
 * that was not the one on screen. Any run that fits protects the same seam, and
 * binding words that already sit together costs nothing.
 *
 * A candidate is REJECTED if it would leave some earlier line raggeder than the
 * orphan it removes. Binding "dense output" in the demo's title pushed the run
 * off line three and stranded "with" there by itself — a one-word line in the
 * MIDDLE of a headline, which is worse than the one at the end. So each candidate
 * is re-wrapped with the bound run held together as a single token, and kept only
 * if the shortest line does not get shorter and no line is added.
 *
 * Two cases are left alone rather than forced: a headline that IS the orphan
 * (nothing to borrow from), and one where every candidate is wider than the
 * measure — the browser would break that anyway, and then in mid-word.
 */
export function unwidow(
  text: string,
  width: number,
  size: number,
  weight = 700,
  face: Face = "latin",
): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = wrap(text, size, width, weight, 0, face);
  const tail = (lines[lines.length - 1] ?? "").split(/\s+/).filter(Boolean).length;
  // `+ 1` because this guard is reading a measurement the rest of this file
  // already distrusts: `wrap` errs wide by construction, so where it predicts a
  // two-word tail the browser has often broken one word earlier and left a
  // one-word orphan. The run-selection loop below already compensates for that;
  // this bail-out did not, and four headlines across the two formats went out
  // widowed — "…query per / pixel", "…not the / smallest" — because `wrap` saw
  // a tail it considered acceptable and returned before trying anything.
  // Widening the guard only costs an NBSP on headlines that did not need one.
  if (lines.length < 2 || tail > ORPHAN_WORDS + 1) return text;
  const shortest = (ls: string[]) =>
    Math.min(...ls.map((l) => textWidth(l, size, weight, 0, false, face)));
  const rag = shortest(lines);
  // Widest first: any run that fits protects the same seam, and `wrap` erring
  // wide means its idea of the last line is not always the browser's.
  for (let n = Math.min(tail + 1, words.length - 1); n >= 2; n--) {
    const bound = words.slice(-n).join(" ");
    if (textWidth(bound, size, weight, 0, false, face) > width) continue;
    const after = wrapTokens([...words.slice(0, -n), bound], size, width, weight, face);
    if (after.length > lines.length || shortest(after) < rag) continue;
    return [...words.slice(0, -n), words.slice(-n).join(NBSP)].join(" ");
  }
  return text;
}

/**
 * `wrap`, but over tokens that may not be broken — a bound run is one token.
 *
 * `wrap` itself cannot answer this: it splits on `\s`, and U+00A0 is `\s`, so it
 * would take the binding apart before measuring it. Only used to score a
 * candidate binding, never to decide a height.
 */
function wrapTokens(
  tokens: string[],
  size: number,
  width: number,
  weight: number,
  face: Face,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (line && textWidth(candidate, size, weight, 0, false, face) > width) {
      lines.push(line);
      line = token;
      continue;
    }
    line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Height the chrome will actually occupy, headline wrapping included.
 *
 * `wrap` errs wide, so this over-counts lines rather than under-counting them.
 * That is the safe direction: an under-count overflows the canvas, and `.scene`
 * is centred so it overflows off *both* edges at once.
 */
export function chromeHeight(
  eyebrow: string | undefined,
  headline: string,
  width: number,
  face: Face = "latin",
): number {
  const lines = wrap(headline, HEADLINE_SIZE, width, 700, HEADLINE_TRACKING, face).length;
  // COUNTS THE EYEBROW'S LINES. It used to charge one `EYEBROW_H` however many
  // an eyebrow wrapped to, and measured it as untracked lowercase besides — so a
  // long one was charged a single 72px line while the browser drew two 50px ones
  // plus the gap. Four archetypes read this number to decide whether they can
  // draw, and every one of them inherited the shortfall as room it did not have.
  //
  // `toUpperCase` rather than a flag: `text-transform` changes which glyphs are
  // measured, and the width table already knows what a capital costs.
  const brow = eyebrow
    ? wrap(eyebrow.toUpperCase(), EYEBROW_SIZE, width, 500, EYEBROW_TRACKING, face).length *
        EYEBROW_LINE +
      EYEBROW_GAP
    : 0;
  return brow + lines * HEADLINE_H;
}

/**
 * The floor `bodyBudget` applies when the caller does not name one.
 *
 * A scene whose chrome genuinely eats the canvas has a planner problem, and
 * returning a negative budget turns that into a diagram drawn inside-out rather
 * than one that is merely tight.
 */
const BODY_FLOOR = 320;

/**
 * What is left for the body once the chrome, the body's own top margin, and
 * anything below it (a note, a caption band) have been paid for.
 *
 * `floor` IS A LAST RESORT, NOT A BUDGET, and the difference has already cost a
 * defect. `claim-figure` asked for the space left under a 216-character claim,
 * was told 320 when the true remainder was 163, sized the figure to fit 320, and
 * drew the caption 7px below the canvas — with every gate green, because the
 * gate was sampling nine midpoints and never looked at that hold. A caller that
 * is LAST in the queue for space has to be able to hear "there is almost none",
 * so it can pass its own floor and act on the answer.
 */
export function bodyBudget(
  format: Format,
  eyebrow: string | undefined,
  headline: string,
  below = 0,
  top = 34,
  floor = BODY_FLOOR,
  face: Face = "latin",
): number {
  const width = contentW(format);
  return Math.max(
    floor,
    contentH(format) - chromeHeight(eyebrow, headline, width, face) - top - below,
  );
}

/**
 * The largest size at which `text` sets in `width` lines of `maxLines`, capped
 * both ends. Used where a headline should grow to meet its box instead of
 * sitting at one authored size with 600px of air beside it.
 *
 * The division solves for perfect packing — every line filled to the last pixel —
 * which no real line break achieves. At 1700 the slack is a few percent and the
 * answer holds; at 860 it is not, because one long word is a fifth of the
 * measure. The demo's title came back at 116px, set on FOUR lines against a cap
 * of three, and the extra line was a stranded "with". So the quotient is an
 * upper bound, and `wrap` is asked whether it is true.
 *
 * Stepping down rather than bisecting: the answer is within a few px of the
 * bound in every case that matters, and a monotone scan cannot pick a size that
 * a bisection's midpoint happened to skip. `lo` is a floor, not a target — a
 * string that will not set in `maxLines` at `lo` simply lands there, as before.
 */
export function fitText(
  text: string,
  width: number,
  maxLines: number,
  lo: number,
  hi: number,
  weight = 700,
  face: Face = "latin",
): number {
  const units = textWidth(text, 1, weight, 0, false, face);
  const bound = Math.max(lo, Math.min(hi, Math.floor((width * maxLines) / units)));
  let size = bound;
  while (size > lo && wrap(text, size, width, weight, 0, face).length > maxLines) size--;
  return size;
}

/** Accumulated float times print as `7.199999999999999`; renders must be byte-identical. */
function sec(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The vocabulary's own constructor: a `fromTo` at a rounded position.
 *
 * `kit.fromTo` is the bare structure; this is what an archetype calls, and the
 * only thing it adds is invariant 10. Every archetype's positions are sums of
 * authored beat times, so they accumulate float tails — `7.199999999999999` —
 * and a position that prints differently between two builds of one storyboard
 * moves a byte in the composition. Rounded HERE rather than in the serialiser
 * because `camera.ts` rounds its own positions to three places against a clock
 * the shell owns, and a second rounding on the way out would quietly truncate
 * them.
 *
 * Every tween is `fromTo` — `from()` captures its end state when the timeline
 * is constructed, which is wrong the moment the deck seeks somewhere else, and
 * seeking is all deck navigation does. That is now the `Tween` type's doing
 * rather than this comment's: there is no shape here that omits `from`.
 */
export function tween(target: string, from: Vars, to: Vars, at: number): Tween {
  return fromTo(target, from, to, sec(at));
}

/**
 * Hold points become absolute island fragment times and must land inside the
 * slide's window, so a beat planned shorter than its own reveal schedule gets
 * its holds clamped rather than silently pushed into the next slide.
 */
export function holdsWithin(times: number[], seconds: number): number[] {
  const last = Math.round(Math.max(0, seconds - 0.15) * 100) / 100;
  const clamped = times.map((t) => Math.min(Math.round(t * 100) / 100, last));
  return [...new Set(clamped)].sort((a, b) => a - b);
}

/**
 * The eyebrow + headline block. Ids are scoped by `sid`, as every selector must be.
 *
 * `width` is the measure the headline will set in — always `contentW(ctx.format)`,
 * since `.headline` is a block child of `.scene` and so spans the content box.
 *
 * Required, not optional. It was optional for one round while eleven emitters
 * were being changed by different hands, and the six that never got the argument
 * were exactly the six still printing one-word last lines ("…is read / through",
 * "…not the / smallest"). A defaulted measure is indistinguishable at the call
 * site from a deliberate one, so the next archetype would inherit the same
 * silent opt-out; requiring it makes the omission a type error instead.
 */
export function chrome(
  sid: string,
  eyebrow: string | undefined,
  headline: string,
  width: number,
  face: Face = "latin",
): string {
  const set = unwidow(headline, width, HEADLINE_SIZE, 700, face);
  const brow = eyebrow ? `<div class="eyebrow" id="${sid}-e">${esc(eyebrow)}</div>\n` : "";
  return `${brow}<h2 class="headline" id="${sid}-h">${esc(set)}</h2>`;
}

/** Reveals the chrome. Finishes at 0.9s, which is where archetype bodies pick up. */
export function chromeIn(sid: string, eyebrow: boolean): Tween[] {
  const s: Tween[] = [];
  if (eyebrow) {
    s.push(tween(`#${sid}-e`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 }, 0.15));
  }
  s.push(tween(`#${sid}-h`, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6 }, 0.3));
  return s;
}

export function chromeCss(t: Theme): string {
  return [
    `.eyebrow{font-size:${EYEBROW_SIZE}px;line-height:${EYEBROW_LH};letter-spacing:.14em;text-transform:uppercase;color:${t.muted};font-weight:500;margin-bottom:22px}`,
    `.headline{font-size:${HEADLINE_SIZE}px;line-height:${HEADLINE_LH};font-weight:700;letter-spacing:-.015em;color:${t.fg}}`,
  ].join("\n");
}

/**
 * The note that closes a slide. Eight archetypes each declared their own copy of
 * this at 40px with a different class name; the sizes then drifted apart by
 * archetype, which is a hierarchy nobody chose.
 */
export function noteCss(cls: string, t: Theme, top = 34): string {
  return `.${cls}{font-size:${BODY_SIZE}px;line-height:${BODY_LH};color:${t.muted};margin-top:${top}px;max-width:${NOTE_MAX_W}px}`;
}

/**
 * A measure cap, not a width. Beyond ~36em a note stops being read and starts
 * being scanned, so the note column is narrower than the content box at 16:9 —
 * and wider than it at 9:16, where `max-width` simply never binds.
 */
const NOTE_MAX_W = 1600;

/** The column a `.<cls>` note actually sets in: the cap, or the box if that is narrower. */
export function noteWidth(format: Format): number {
  return Math.min(NOTE_MAX_W, contentW(format));
}

/**
 * One `.<cls>` line box, wrapping included — what `bodyBudget`'s `below` wants.
 *
 * `width` is the caller's because two archetypes set their note in a column of
 * their own rather than across the box. Everyone else passes `noteWidth(format)`;
 * measuring against the bare 1600 cap at 9:16 under-counts the lines by half and
 * hands the body a budget the note then overruns.
 */
export function noteHeight(
  note: string | undefined,
  width: number,
  top = 34,
  face: Face = "latin",
): number {
  if (!note) return 0;
  return wrap(note, BODY_SIZE, width, 400, 0, face).length * Math.round(BODY_SIZE * BODY_LH) + top;
}

export const title: Emitter<"title"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  // The headline grows to meet the canvas instead of sitting at one authored
  // size. At a flat 88px the demo's title slide filled 21% of 1920x1080 with a
  // 1920x414 hole under it — the emptiest slide in the deck by a factor of two,
  // and the first thing anyone sees. Three lines is the cap because a title that
  // wants four is a title, not a headline.
  const width = contentW(ctx.format);
  const face = faceOf(ctx.theme.fontStack);
  const size = fitText(p.headline, width, 3, 88, 156, 700, face);
  // The title is the one headline set at its own size, so it is un-widowed
  // against that size rather than against `HEADLINE_SIZE`. Left alone, the demo
  // broke as "Compact thought / collides with dense / output" at 16:9 and stranded
  // a single word under a full measure on the first slide anyone sees.
  const head = unwidow(p.headline, width, size, 700, face);
  const brow = p.eyebrow ? `<div class="eyebrow" id="${sid}-e">${esc(p.eyebrow)}</div>\n  ` : "";
  const sub = p.sub ? `\n  <div class="sub" id="${sid}-s">${esc(p.sub)}</div>` : "";
  // The headline is set word by word so it can RISE word by word. `words()`
  // escapes each one and rejoins with single spaces, so the line breaks exactly
  // where `unwidow` decided it would and the type floor measures the same size.
  const html = `<div class="titleslide">
  ${brow}<h1 class="bighead" id="${sid}-t" style="font-size:${size}px">${words(head)}</h1>${sub}
</div>`;

  const tl: Tween[] = [];
  if (p.eyebrow) {
    tl.push(tween(`#${sid}-e`, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6 }, 0.2));
  }
  // The first thing anyone sees in the deck, and until now it was a block of
  // text fading up. A headline that arrives word by word reads as a sentence
  // being said; the stagger is the whole difference and it costs no hold.
  tl.push(
    tween(
      `#${sid}-t .w`,
      { opacity: 0, y: 38 },
      { opacity: 1, y: 0, duration: 0.9, stagger: 0.06, ease: "power3.out" },
      0.4,
    ),
  );
  let end = 1.3;
  if (p.sub) {
    tl.push(tween(`#${sid}-s`, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7 }, 1.0));
    end = 1.7;
  }

  return {
    html,
    tl,
    holds: holdsWithin([end + 0.2], beat.seconds),
    css: [
      chromeCss(theme),
      // `space-between`, not `center`. Centring stacked the three lines in the
      // middle band and left 400px of nothing above and below them; anchoring the
      // eyebrow to the top and the sub to the bottom turns that same air into the
      // composition. `.titleslide` is the whole content box, so nothing moves off
      // the canvas — the block cannot grow past the box it is already filling.
      ".titleslide{display:flex;flex-direction:column;justify-content:space-between;height:100%}",
      `.bighead{line-height:1.06;font-weight:700;letter-spacing:-.025em;color:${theme.fg}}`,
      // `inline-block`, or the per-word rise is a no-op: a transform on an
      // inline box does nothing, and the headline would fade in place with
      // every gate green.
      ".bighead .w{display:inline-block}",
      // The rule is the sub's, not the headline's: it reads as the deck's spine
      // rather than as an underline someone drew under the title.
      `.sub{font-size:48px;line-height:1.5;color:${theme.muted};margin-top:44px;padding-top:36px;max-width:1500px;border-top:3px solid ${theme.rule}}`,
      // The headline is the slide. Its entrance owns `opacity` and `y`, so the
      // ambient breath takes the one property left.
      ambient(sid, "-t", BREATHE),
    ].join("\n"),
  };
};

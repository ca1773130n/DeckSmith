/**
 * A claim set as moving type — the explainer-video move for a point that is a
 * sentence rather than a shape.
 *
 * Two to four phrases, stacked down the frame on a slight stair, each set as
 * large as the frame allows (`SIZES`) and each ARRIVING WITH A MOVE OF ITS OWN
 * (`MOVES`): one rises, the next slides in from the reading side, the next
 * drops, the next zooms down to size. Word by word inside a phrase, so it reads
 * as being said. Once a phrase has landed its `key` word is struck through by a
 * highlight — a chip swept left to right behind it, the word turning dark on
 * it and lifting slightly — and the deck stops: one stop per phrase, so the
 * narration says one sentence per phrase and the type keeps pace with the voice.
 *
 * UNDER v2 THE TYPE DOES NO TRICKS (founder, 2026-10-10: "graphic animation by
 * animated UI elements is old-fashioned, and the fonts are too large"). Phrases
 * are set at most at the headline's 56px (`SIZES_V2`), every word fades in in
 * place, and the key word turns the accent instead of being swept by a chip.
 * The motion is the backdrop's or the field's. Classic is unchanged.
 *
 * THE MOVES ARE THE CONTENT, so the scene says so (`Scene.ownEntrances`): the
 * v2 motion grammar would otherwise re-voice every phrase into the deck's one
 * verb for the scene, and four phrases arriving the same way are a paragraph
 * fading in.
 *
 * Never on the pack's pale ground: `emitScene` sets it over its `backdrop`, or
 * over the accent field (src/emit/backdrop.ts), in the glass theme. The chip is
 * the glass accent — lifted to clear 4.5:1 on the worst ground — with the dark
 * glass ground as its ink, so the key word reads at well over 4.5:1 on it.
 *
 * NOTHING SHRINKS BELOW THE FLOOR. The size steps down until every phrase sets
 * on two lines or fewer in its column and the stack fits the frame; at the
 * smallest size that still fails it is refused by name.
 */
import { isV2, MEASURE_SLACK } from "../fit.js";
import type { Emitter, Tween, Vars } from "../kit.js";
import { contentH, contentW, esc, staggerFor, wordAtoms, words } from "../kit.js";
import { fnv1a } from "../motion.js";
import { displayFace, faceOf, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import { V2_TYPE } from "../type.js";
import { holdsWithin, isPortrait, tween } from "./title.js";

/** Type sizes tried in order, reference px. The smallest is still half again the floor. */
const SIZES = [120, 108, 96, 88, 80, 72, 64] as const;
/**
 * v2: the confirmed scale (`V2_TYPE`) — a phrase is a headline, 56px at most,
 * and steps down to the body size before it is refused. "No 64px+ kinetic
 * type" (founder, 2026-10-10).
 */
const SIZES_V2 = [V2_TYPE.headline, 52, 48, V2_TYPE.body] as const;
const LH = 1.1;
const MAX_LINES = 2;
/** Space between phrases, as a share of the size. */
const GAP = 0.32;
/** The stair: each phrase starts this share of the content width right of the one above. */
const STEP = 0.06;
/** The key word lifts by this much when it is struck. Up, never down. */
const KEY_LIFT = 1.06;

/** The first phrase starts here; each later one just after the stop before it. */
const FIRST_AT = 0.3;
const AFTER_STOP = 0.15;
const WORD_IN = 0.7;
const WORD_STAGGER = 0.07;
const KEY_IN = 0.45;
const KEY_AFTER = 0.1;
const INK_AFTER = 0.1;
const INK_TURN = 0.2;

/**
 * The moves a phrase can arrive with: what each word starts at, and the ease.
 * Four, so a deck's kinetic beats at most four phrases long never repeat a move
 * inside one beat. The first move a beat uses is seeded by its id.
 */
const MOVES: readonly { from: Vars; ease: string }[] = [
  { from: { opacity: 0, y: 70 }, ease: "power3.out" },
  { from: { opacity: 0, x: -90 }, ease: "expo.out" },
  { from: { opacity: 0, y: -60 }, ease: "back.out(1.4)" },
  { from: { opacity: 0, scale: 1.35 }, ease: "power4.out" },
];

/**
 * v2: every phrase arrives the one way — its words fade in, in reading order,
 * in place. Four different MOVES (rise, slide, drop, zoom) and a chip swept
 * behind the key word were type doing tricks, which is the "animated UI
 * elements" the founder called old-fashioned (2026-10-10). The key word is
 * still marked: it turns the accent, a colour change, nothing moving.
 */
const FADE = { from: { opacity: 0 }, ease: "sine.out" } as const;

/** `text` as word spans, with `key` (if any) as one struck span. */
function phraseHtml(
  sid: string,
  i: number,
  text: string,
  key: string | undefined,
  chip = true,
): string {
  const w = (s: string) => words(s, "kn-w", { unspaced: true });
  if (key === undefined) return w(text);
  const at = text.indexOf(key);
  const before = text.slice(0, at);
  const after = text.slice(at + key.length);
  const hl = chip ? `<span class="kn-hl" id="${sid}-hl${i}"></span>` : "";
  const struck = `<span class="kn-w kn-k" id="${sid}-k${i}">${hl}<span class="kn-kt" id="${sid}-kt${i}">${esc(key)}</span></span>`;
  return [
    before.trim() ? w(before) : "",
    /\s$/.test(before) ? " " : "",
    struck,
    /^\s/.test(after) ? " " : "",
    after.trim() ? w(after) : "",
  ].join("");
}

export const kinetic: Emitter<"kinetic"> = (beat, ctx) => {
  const { sid, theme, format } = ctx;
  const p = beat.params;
  const who = `kinetic ${beat.id}`;
  const face = displayFace(faceOf(theme.fontStack));
  const W = contentW(format);
  const H = contentH(format);
  const step = isPortrait(format) ? 0 : STEP;
  const v2 = isV2(ctx);
  const sizes: readonly number[] = v2 ? SIZES_V2 : SIZES;

  // THE SIZE: the largest at which every phrase sets in two lines in its own
  // column of the stair, and the stack fits down the frame.
  const linesAt = (size: number) =>
    p.phrases.map(
      (ph, i) => wrap(ph.text, size, W * (1 - step * i) * MEASURE_SLACK, 800, 0, face).length,
    );
  const heightAt = (size: number) =>
    linesAt(size).reduce((h, n) => h + n * Math.round(size * LH), 0) +
    (p.phrases.length - 1) * Math.round(size * GAP);
  const size = sizes.find((s) => linesAt(s).every((n) => n <= MAX_LINES) && heightAt(s) <= H);
  if (size === undefined) {
    const last = sizes[sizes.length - 1] as number;
    throw new Error(
      `${who}: the phrases do not set in ${MAX_LINES} lines each, stacked inside the frame, even at ${last}px — shorten them or use fewer`,
    );
  }

  const seed = fnv1a(beat.id);
  const tl: Tween[] = [];
  const holds: number[] = [];
  let at = FIRST_AT;
  const html = p.phrases.map((ph, i) => {
    const move = v2 ? FADE : (MOVES[(seed + i) % MOVES.length] as (typeof MOVES)[number]);
    const atoms = wordAtoms(ph.text).length;
    const stagger = staggerFor(atoms, WORD_STAGGER);
    tl.push(
      tween(
        `#${sid}-p${i} .kn-w`,
        move.from,
        {
          ...Object.fromEntries(
            Object.keys(move.from).map((k) => [k, k === "opacity" || k === "scale" ? 1 : 0]),
          ),
          duration: WORD_IN,
          stagger,
          ease: move.ease,
        },
        at,
      ),
    );
    // Where the last word has landed. Two decimals, as `tween` places things.
    let stop = Math.round((at + WORD_IN + stagger * (atoms - 1)) * 100) / 100;
    if (ph.key !== undefined && v2) {
      // The key turns the accent where it stands. Same strike, same stop, so
      // the voice and the holds are where they were.
      const strike = Math.round((stop + KEY_AFTER) * 100) / 100;
      tl.push(
        tween(
          `#${sid}-kt${i}`,
          { color: theme.fg },
          { color: theme.accent, duration: KEY_IN, ease: "sine.out", immediateRender: false },
          strike,
        ),
      );
      stop = Math.round((strike + KEY_IN) * 100) / 100;
    } else if (ph.key !== undefined) {
      const strike = Math.round((stop + KEY_AFTER) * 100) / 100;
      tl.push(
        // The chip's only tween, so it renders its `from` at build: swept shut
        // until the strike. With `immediateRender: false` it sat at its CSS
        // width, a full chip fading in with the words before anything struck.
        tween(
          `#${sid}-hl${i}`,
          { scaleX: 0 },
          { scaleX: 1, duration: KEY_IN, ease: "power2.out" },
          strike,
        ),
        // The ink turns while the chip is under most of the word, and fast:
        // light ink on the pale chip, or dark ink on the field, is the one
        // moment the key is hard to read.
        // `immediateRender: false` on the ink and the lift: the ink's first
        // frame is its CSS colour, and the key's scale belongs to the word
        // entrance above until the strike.
        tween(
          `#${sid}-kt${i}`,
          { color: theme.fg },
          { color: theme.bg, duration: INK_TURN, ease: "none", immediateRender: false },
          Math.round((strike + INK_AFTER) * 100) / 100,
        ),
        tween(
          `#${sid}-k${i}`,
          { scale: 1 },
          { scale: KEY_LIFT, duration: KEY_IN, ease: "power2.out", immediateRender: false },
          strike,
        ),
      );
      stop = Math.round((strike + KEY_IN) * 100) / 100;
    }
    holds.push(stop);
    at = stop + AFTER_STOP;
    const indent = Math.round(W * step * i);
    return `<p class="kn-p" id="${sid}-p${i}"${indent ? ` style="margin-left:${indent}px"` : ""}>${phraseHtml(sid, i, ph.text, ph.key, !v2)}</p>`;
  });

  const family =
    typeof face === "string" ? "" : `font-family:${theme.displayStack ?? theme.fontStack};`;
  let lastKey = -1;
  p.phrases.forEach((ph, i) => {
    if (ph.key !== undefined) lastKey = i;
  });
  const kept = holdsWithin(holds, beat.seconds);
  return {
    html: `<div class="kn" id="${sid}-kn">\n${html.join("\n")}\n</div>`,
    tl,
    holds: kept,
    ownEntrances: true,
    ...(kept.length < holds.length
      ? {
          warnings: [
            `${p.phrases.length} phrases need ${holds[holds.length - 1]}s to land and the beat is ${beat.seconds}s, so the last stops merge — give it more seconds or fewer phrases`,
          ],
        }
      : {}),
    css: [
      `.kn{display:flex;flex-direction:column;align-items:flex-start;width:100%}`,
      `.kn-p{${family}font-weight:800;line-height:${LH};color:${theme.fg};letter-spacing:-0.02em;text-wrap:balance}`,
      `#${sid} .kn-p{font-size:${size}px}`,
      `#${sid} .kn-p+.kn-p{margin-top:${Math.round(size * GAP)}px}`,
      // `inline-block`, or the per-word moves are no-ops: a transform on an
      // inline box does nothing, and every phrase would fade in place.
      `.kn-w{display:inline-block}`,
      // Its own stacking context, so the chip sits under the word and over the field.
      // A little air either side, so a key set inside a word (a Korean stem
      // before its particle) does not butt its chip against the letters.
      `.kn-k{position:relative;isolation:isolate;transform-origin:50% 60%;margin:0 0.14em}`,
      `.kn-hl{position:absolute;left:-0.08em;right:-0.08em;top:0.06em;bottom:0.02em;z-index:-1;border-radius:0.12em;background:${theme.accent};transform-origin:left center}`,
      // The phrase's ink until the strike tweens it to the chip's.
      `.kn-kt{color:${theme.fg}}`,
      // The last struck word is what the beat lands on; with none, the last phrase.
      ambient(
        sid,
        lastKey >= 0 ? `-${v2 ? "kt" : "hl"}${lastKey}` : `-p${p.phrases.length - 1}`,
        BREATHE,
      ),
    ].join("\n"),
  };
};

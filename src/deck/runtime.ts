/**
 * The browser step layer — the only runtime code DeckSmith owns.
 *
 * HyperFrames' own deck navigation is dead at 0.7.71/0.7.72 and still dead at
 * 0.7.90: `player.scenes` never populates, so `SlideshowController` has no
 * slide→time map and every key press is a no-op. EXPERIMENT-003 reproduced that
 * on their own reference example, and established that `player.seek(t)` works
 * exactly as documented. Re-measured on the pin bump to 0.7.90 — `player.scenes`
 * is still 0 and `dist/hyperframes-slideshow.global.js` is byte-identical to
 * 0.7.71, so this layer is not redundant yet.
 * So we read the island ourselves, flatten it into stop times, and drive seek().
 * Because `paint()` is ours, a forward step is swept across a few frames rather
 * than cut, which is the whole difference between a deck that reveals and a deck
 * that flicks between stills.
 *
 * Bundled to an IIFE (`scripts/build.mjs`) and inlined into every navigable
 * deck. Zero dependencies, and every DOM lookup is defensive — this ships inside
 * artifacts that will outlive our control.
 */
import { CHANNEL, type FromDeck, isOurs } from "./protocol.js";
import {
  activeCue,
  audioSrc,
  type Cue,
  NARRATION_ISLAND,
  type Narration,
  parseNarration,
  segmentFor,
} from "./subtitles.js";

/* --------------------------------------------------------------- Stop list */

/** One entry of the slideshow island's `slides` array. */
export interface SlideSpec {
  sceneId: string;
  /** Absolute seconds. Present when the island lives outside the composition. */
  startTime?: number;
  endTime?: number;
  /** Absolute positions on the deck timeline, inside this slide's window. */
  fragments?: number[];
  notes?: string;
}

export interface Stop {
  /** Absolute position on the deck timeline, in seconds. */
  t: number;
  /** 0-based, over the slides that could be placed. */
  slide: number;
  /** 0 is the slide itself; 1..n are its fragments in time order. */
  fragment: number;
  notes: string;
  /**
   * The scene this stop belongs to. Carried through because it is the only id
   * shared with the narration island — `slide` is a position over the slides we
   * could place, which shifts the moment one of them is unplaceable.
   */
  sceneId: string;
}

export interface Pos {
  slide: number;
  fragment: number;
}

function finite(...candidates: (number | undefined)[]): number | undefined {
  for (const c of candidates) if (typeof c === "number" && Number.isFinite(c)) return c;
  return undefined;
}

/**
 * Flatten the island into the ordered list of positions a presenter steps
 * through: each slide's start, then each of its fragments.
 *
 * Placement comes from the island alone. This code only ever runs in the wrapper
 * page, where the scene divs are inside the player's iframe and unreachable — so
 * `emitIsland` always writes `startTime`/`endTime`, and there is nothing to
 * scrape from the DOM.
 */
export function buildStops(slides: readonly SlideSpec[]): Stop[] {
  const stops: Stop[] = [];

  for (const spec of slides) {
    const start = finite(spec.startTime);
    // Unplaceable: seeking it would land on 0 and silently mean "slide 1".
    if (start === undefined) continue;
    const end = finite(spec.endTime) ?? Number.POSITIVE_INFINITY;

    const slide = stops.length === 0 ? 0 : (stops[stops.length - 1] as Stop).slide + 1;
    const notes = spec.notes ?? "";

    // Sorted, deduped, and clamped to the slide's window: a stop outside it
    // would step to a time that belongs to a different slide (invariant 8).
    const fragments = [...new Set(spec.fragments ?? [])]
      .filter((t) => Number.isFinite(t) && t > start && t <= end)
      .sort((a, b) => a - b);

    // Navigation seeks to a paused frame, so a stop at the raw `startTime` shows
    // the moment BEFORE the scene's entrance runs — every element still at its
    // `from` state, i.e. a blank slide. Each fragment is a settled time (an
    // emitter records one after every reveal), so the first fragment is the
    // slide's real landing point and the raw start is a keystroke showing
    // nothing. Only a scene with no reveals at all falls back to it.
    const [landing, ...rest] = fragments;
    const sceneId = spec.sceneId;
    stops.push({ t: landing ?? start, slide, fragment: 0, notes, sceneId });
    for (const [i, t] of rest.entries()) {
      stops.push({ t, slide, fragment: i + 1, notes, sceneId });
    }
  }
  return stops;
}

/* --------------------------------------------------------------- Transition */

/**
 * Longest span, in composition seconds, we are willing to play through.
 *
 * A step inside a slide is fragment-to-fragment and is short: 0.7s and 1.2s in
 * the deck EXPERIMENT-004 measured. A longer span means the step crossed a slide
 * boundary, and most of it is the outgoing slide's hold — five seconds of
 * watching nothing happen, then the entrance. Cut those; play the rest.
 */
const MAX_SPAN = 2.5;

export interface TransitionPlan {
  animate: boolean;
  /** Wall-clock milliseconds to spend. 0 whenever `animate` is false. */
  durationMs: number;
}

/**
 * Decide whether a step plays or cuts. Pure, so the policy is testable without
 * a DOM; the rAF loop that obeys it is not.
 */
export function planTransition(
  fromT: number,
  toT: number,
  opts: { reducedMotion?: boolean } = {},
): TransitionPlan {
  const span = toT - fromT;
  // Backward: entrance tweens run in reverse read as elements un-drawing
  // themselves. Zero: there is nothing to show. Reduced motion: asked not to.
  if (opts.reducedMotion === true || span <= 0 || span > MAX_SPAN) {
    return { animate: false, durationMs: 0 };
  }
  // 1x. The reveal was authored at this speed, so it plays at this speed.
  return { animate: true, durationMs: span * 1000 };
}

/** Long enough to read a line of anything. */
const MIN_DWELL = 1500;
/** Past this a hold is the author pausing, and autoplay should not sit it out. */
const MAX_DWELL = 8000;

/**
 * How long autoplay waits on the stop it is on, or `null` for "do not set a
 * timer". Pure, for the same reason `planTransition` and `refused` are: the
 * decision has two callers and lives inside `start`, which no test in this
 * project can reach.
 *
 * `heard` is the whole point of the split. A narrated stop is timed by its own
 * audio — speech drives the deck, which is this project's entire timing model —
 * so it waits for `ended` and wants no timer. But `voice.at` answers
 * synchronously about whether a segment EXISTS, while `play()` rejects a beat
 * later, so at arrival a stop whose file is missing is indistinguishable from a
 * working one. Ask again when `play()` settles and the answer can flip either
 * way: to `false`, and the stop needs the clock after all or autoplay waits
 * forever for an `ended` that a source which never loaded cannot fire; or back
 * to `true`, when a gesture retried the segment and it is speaking now, and the
 * timer armed while it was silent would cut the sentence it just started.
 *
 * `gapMs` is the gap the author left before the next stop, the same number the
 * linear render used, clamped so neither a back-to-back pair nor a long hold
 * turns into a bad wait.
 */
export function dwellMs(opts: { playing: boolean; heard: boolean; gapMs: number }): number | null {
  if (!opts.playing || opts.heard) return null;
  return Math.min(MAX_DWELL, Math.max(MIN_DWELL, opts.gapMs));
}

/* --------------------------------------------------------------------- Hash */

/** `#3` is slide 3; `#3.2` is slide 3, second fragment. Both 1-based. */
export function formatHash(pos: Pos): string {
  return pos.fragment > 0 ? `#${pos.slide + 1}.${pos.fragment}` : `#${pos.slide + 1}`;
}

export function parseHash(hash: string): Pos | null {
  const m = /^#?(\d+)(?:\.(\d+))?$/.exec(hash.trim());
  if (!m) return null;
  const slide = Number(m[1]);
  if (slide < 1) return null;
  return { slide: slide - 1, fragment: m[2] === undefined ? 0 : Number(m[2]) };
}

/**
 * Index of `pos` in the stop list. A deep link that names a fragment we no
 * longer emit falls back to its slide rather than to nothing.
 */
export function findStop(stops: readonly Stop[], pos: Pos): number {
  const exact = stops.findIndex((s) => s.slide === pos.slide && s.fragment === pos.fragment);
  return exact >= 0 ? exact : stops.findIndex((s) => s.slide === pos.slide);
}

/* ----------------------------------------------------------------- The page */

const ISLAND = 'script[type="application/hyperframes-slideshow+json"]';

interface Player extends HTMLElement {
  ready?: boolean;
  seek: (t: number) => void;
  pause?: () => void;
}

/** Only what we call on a GSAP timeline. */
interface Seekable {
  seek: (t: number) => void;
}

interface Frame {
  doc: Document;
  timelines: Record<string, Seekable>;
}

/**
 * The composition, reached through the player's iframe.
 *
 * Same-origin only, which means a deck must be served over http — opening
 * `deck.html` from the filesystem gives the iframe an opaque origin and we
 * cannot drive it. `present()` says so out loud rather than rendering blank.
 */
export function frameOf(player: Player): Frame | null {
  const iframe =
    player.shadowRoot?.querySelector("iframe") ?? player.querySelector("iframe") ?? null;
  try {
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow as
      | (Window & { __timelines?: Record<string, Seekable> })
      | null;
    // READ THROUGH TO THE WINDOW, never a snapshot of it. This used to copy
    // `win.__timelines` into the returned object, and the copy is taken ONCE, at
    // `frameOf(player)` below. A composition whose scene scripts had not run at
    // that instant handed back a frozen empty map — and `paint` then goes on
    // toggling `display` correctly while every `timelines[sceneId]?.seek(...)`
    // no-ops, so the deck navigates perfectly and shows every scene at its
    // `from` state, with nothing to see in any log.
    //
    // Today the ordering saves it — deck.html's own DOMContentLoaded, then
    // `whenReady`, by which point the composition has registered — but that is
    // a race that has not fired rather than one that cannot. A getter costs
    // nothing and removes the ordering from the contract.
    return doc && win
      ? {
          doc,
          get timelines() {
            return win.__timelines ?? {};
          },
        }
      : null;
  } catch {
    return null; // cross-origin
  }
}

/**
 * Put the composition on the frame at time `t`.
 *
 * `player.seek()` moves the player's own clock; under the render engine that is
 * enough, because the engine drives each scene's timeline and clip visibility
 * itself. The standalone player bundle does neither — so a seeked deck shows
 * every scene stacked with all its entrance tweens still at their `from` state,
 * i.e. blank. Scenes are addressed by the ids the island already carries, so
 * this needs nothing scraped from the DOM.
 */
function paint(frame: Frame, slides: readonly SlideSpec[], t: number): void {
  for (const slide of slides) {
    const start = slide.startTime ?? 0;
    const end = slide.endTime ?? Number.POSITIVE_INFINITY;
    const showing = t >= start && t < end;

    // Duck-typed, not `instanceof HTMLElement`: the iframe is a separate realm
    // with its own constructors, so an instanceof against ours is always false
    // and the scene never gets hidden.
    const el = frame.doc.getElementById(slide.sceneId) as HTMLElement | null;
    if (el?.style) el.style.display = showing ? "" : "none";
    if (showing) frame.timelines[slide.sceneId]?.seek(Math.max(0, t - start));
  }
}

function readIsland(doc: Document): SlideSpec[] {
  const el = doc.querySelector(ISLAND);
  if (!el?.textContent) return [];
  try {
    const parsed: unknown = JSON.parse(el.textContent);
    const slides = (parsed as { slides?: unknown })?.slides;
    if (!Array.isArray(slides)) return [];
    return slides.filter((s): s is SlideSpec => typeof (s as SlideSpec)?.sceneId === "string");
  } catch {
    return [];
  }
}

/** Upstream's own readiness contract: the flag, else one `ready` event, else give up. */
function whenReady(player: Player): Promise<void> {
  if (player.ready === true) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      player.removeEventListener("ready", done);
      resolve();
    }, 5000);
    player.addEventListener("ready", done, { once: true });
  });
}

/**
 * The presenter chrome, styled here because it is injected here.
 *
 * Asked whether these `ds-` names want a longer prefix against collision, the
 * answer is no, and the reason is worth writing down once so nobody re-derives
 * it: every name below is ONE-SIDED — defined in this template, used only by
 * `mountChrome` and the handlers around it, and living in deck.html's own
 * document. Two `<decksmith-player>` elements on a page are two iframes with two
 * documents, so there is nothing for them to collide with.
 *
 * `.ds-live` is the exception and the one to be careful with. The emitter writes
 * it too (`ambient` in src/emit/theme.ts gates every archetype's ambient rule on
 * it, invariant 6) and eight test files assert it by name, so renaming it is a
 * three-sided change — and it already lives in the INNER composition document,
 * which is the collision it would be renamed to avoid.
 *
 * If a prefix is ever added anyway — for a runtime hosted outside a frame —
 * `.ds-cap` is the trap. It is toggled on `doc.documentElement` and its rule
 * assumes 100vh is the frame's box, so outside one it computes a wrong height
 * under a correct name: a mis-sized slide, not an error, and no BUILD GATE
 * opens deck.html to notice. `test/deck-page.test.ts` does, and asserts `.ds-cap`
 * toggles — but it measures one viewport, so a rule that is right at one window
 * size and wrong at others would still get through.
 */
const CSS = `
.ds-chrome{position:fixed;inset:auto 0 0 0;z-index:2147483000;pointer-events:none;
  font:500 13px/1.5 ui-sans-serif,system-ui,sans-serif;color:#fff}
.ds-bar{height:3px;background:rgba(255,255,255,.14)}
.ds-bar>i{display:block;height:100%;background:currentColor;transform-origin:0 50%;
  transform:scaleX(0);transition:transform .18s ease-out}
.ds-count{position:absolute;right:14px;bottom:10px;opacity:.45;font-variant-numeric:tabular-nums}
/* The only control the deck offers by pointer. Bottom-right beside the counter,
   because that is where a viewer already looks to know where they are. */
.ds-play{position:absolute;right:70px;bottom:6px;width:26px;height:26px;padding:0;
  border:0;border-radius:50%;background:rgba(255,255,255,.10);color:#fff;cursor:pointer;
  pointer-events:auto;opacity:.55;transition:opacity .15s,background-color .15s;
  display:grid;place-items:center;font:inherit;line-height:1}
.ds-play:hover{opacity:1;background:rgba(255,255,255,.2)}
.ds-play::before{content:"";display:block;width:0;height:0;margin-left:2px;
  border-left:9px solid currentColor;border-top:6px solid transparent;border-bottom:6px solid transparent}
.ds-play[data-on="1"]::before{margin-left:0;width:8px;height:10px;border:0;
  background:linear-gradient(to right,currentColor 0 3px,transparent 3px 5px,currentColor 5px 8px)}
/* THE PLAYER-PAGE VIDEO, and everything it needs lives INSIDE .ds-chrome. That
   buys two things without writing them twice: the click-to-advance handler
   already skips anything the chrome contains, and pointer-events are already off
   everywhere the overlay is not.

   A LIGHTBOX RATHER THAN AN OVERLAY ALIGNED TO THE POSTER, deliberately. The
   poster is an image inside the player's iframe, drawn at 1920x1080 and scaled
   to the viewport by the player; putting a rectangle exactly over it means the
   iframe's own rect times the player's scale, recomputed on resize, on
   fullscreen (the "f" key), and again whenever .ds-cap shrinks the player to
   make room for subtitles. That arithmetic is right at one window size and
   silently wrong at every other. test/deck-page.test.ts opens deck.html now, but
   at a single viewport, so it would not catch that either — which is still the
   argument for the lightbox: it is the same size wherever the poster is.
   (No backticks in this block: it is inside the CSS template literal, and one
   would end the string.) */
.ds-video{position:absolute;right:106px;bottom:6px;height:26px;padding:0 12px;border:0;
  border-radius:13px;background:rgba(255,255,255,.10);color:#fff;cursor:pointer;
  pointer-events:auto;opacity:.55;font:inherit;line-height:26px;
  transition:opacity .15s,background-color .15s}
.ds-video:hover{opacity:1;background:rgba(255,255,255,.2)}
.ds-video[hidden]{display:none}
.ds-film{position:fixed;inset:0;display:grid;place-items:center;
  background:rgba(0,0,0,.88);pointer-events:auto}
.ds-film iframe{width:min(92vw,158vh);aspect-ratio:16/9;border:0;background:#000}
.ds-shut{position:absolute;top:16px;right:16px;width:34px;height:34px;padding:0;border:0;
  border-radius:50%;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;
  font:inherit;line-height:34px}
.ds-notes{position:absolute;left:0;right:0;bottom:0;max-height:38vh;overflow:auto;
  padding:20px 24px;background:rgba(10,10,10,.92);font-size:19px;line-height:1.6;
  white-space:pre-wrap;pointer-events:auto}
.ds-notes[hidden]{display:none}
.ds-flags{position:absolute;left:14px;bottom:10px;opacity:.5;letter-spacing:.02em}

/* The subtitle lives BELOW the slide, in a strip the player is shrunk to make
   room for. Overlaying it was tried and does not work: the slide is 1920x1080
   of composition the archetypes already fill, and a two-line band is ~160 of
   those pixels. Overlaid, it ran through the bottom note of grid, stack,
   split-compare and bar-compare. Reserving the space inside the composition
   instead — growing the scene's bottom padding — moved the collision rather
   than removing it: scene content is vertically CENTRED, so the six tallest
   archetypes simply overflowed upward and pushed their eyebrows off the top of
   the frame, by 79px on bar-compare. Both gates passed both times.

   Out here there is nothing to collide with, no scrim is needed because the
   strip is page background rather than slide, and no archetype has to know that
   narration exists. The slide gets smaller; nothing gets covered.

   The strip is reserved for the whole session, not per cue, so the slide does
   not resize every time someone stops talking. Two lines is its budget, which
   splitCue in ./subtitles.ts guarantees by capping cue length.

   "pretty", never "balance": balance evens line lengths by SHRINKING the box,
   which turned an 81-character cue into three short lines inside a box half the
   width it was given. The band must fill the width it has before taking another
   line, or the two-line budget is a fiction. */
.ds-cap{--ds-cap-font:clamp(22px,2.2vw,38px)}
.ds-cap hyperframes-player{height:calc(100vh - var(--ds-cap-h))}
.ds-cap{--ds-cap-h:calc(var(--ds-cap-font) * 3.5)}
.ds-subs{position:absolute;left:0;right:0;bottom:0;height:var(--ds-cap-h,0px);
  display:flex;align-items:center;justify-content:center;padding:0 5vw;
  text-align:center;color:#fff;font-weight:600;font-size:var(--ds-cap-font);
  line-height:1.35;text-wrap:pretty}
.ds-subs[hidden]{visibility:hidden}
`;

function mountChrome(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.append(style);

  const chrome = doc.createElement("div");
  chrome.className = "ds-chrome";
  chrome.innerHTML =
    '<div class="ds-bar"><i></i></div><button class="ds-play" type="button" ' +
    'aria-label="Play the deck"></button><button class="ds-video" type="button" hidden>' +
    "Video</button>" +
    '<div class="ds-count"></div><div class="ds-flags"></div>' +
    '<div class="ds-subs" hidden></div><div class="ds-notes" hidden></div>';
  doc.body.append(chrome);

  return {
    chrome,
    fill: chrome.querySelector("i") as HTMLElement,
    play: chrome.querySelector(".ds-play") as HTMLButtonElement,
    video: chrome.querySelector(".ds-video") as HTMLButtonElement,
    count: chrome.querySelector(".ds-count") as HTMLElement,
    notes: chrome.querySelector(".ds-notes") as HTMLElement,
    flags: chrome.querySelector(".ds-flags") as HTMLElement,
    subs: chrome.querySelector(".ds-subs") as HTMLElement,
  };
}

/* -------------------------------------------------------------- Narration */

export interface Voice {
  /**
   * Arrive at a stop: cut whatever was speaking, start this stop from zero.
   * Returns whether this stop has anything to say — autoplay needs to know,
   * because a silent stop has no `ended` event to wait for and would otherwise
   * be where playback quietly stops forever.
   */
  at: (stop: Stop) => boolean;
  /**
   * Stop talking without arriving anywhere. The deck has ONE audio track and
   * `claim-figure` already spends it on narration — see its `muted` note — so
   * anything else that wants to make a sound has to take it first.
   */
  hush: () => void;
  toggleMute: () => void;
  toggleSubtitles: () => void;
  /** Called when the segment for the CURRENT stop finishes of its own accord. */
  onEnded: (fn: () => void) => void;
  /**
   * Called when the CURRENT stop's `play()` settles, with whether there is going
   * to be a sound. Autoplay needs it because `at` answers one beat too early:
   * `at` says a segment EXISTS, and `play()` says whether it can be heard.
   *
   * BOTH answers matter. False means no `ended` will ever fire, so a deck
   * playing itself must fall back to its own clock or sit on that slide forever
   * with the button lit. True is how it gives that clock back — a segment
   * retried after a dropped connection is speaking now, and a timer armed while
   * it was silent would cut the sentence it just started.
   */
  onSettled: (fn: (heard: boolean) => void) => void;
  /**
   * A real gesture: retry the segment for the stop we are on. Covers the
   * autoplay policy, which is what it was written for, and a file that failed to
   * load — see `refused` for why the second one is never retried unasked.
   */
  unlock: () => void;
}

const SILENT: Voice = {
  at: () => false,
  hush: () => {},
  toggleMute: () => {},
  toggleSubtitles: () => {},
  onEnded: () => {},
  onSettled: () => {},
  unlock: () => {},
};

/**
 * Was that `play()` rejection the autoplay policy, or an audio file we will
 * never be able to play? Pure, so the classification is testable without a
 * browser; the element that produces the rejection is not.
 *
 * The two need telling apart because they are not the same failure and must not
 * be reported as one. The policy is recoverable by construction: the first
 * gesture retries the segment and it speaks, so "press any key for sound" is
 * simply true. A file that did not load MIGHT be — a two-second wifi drop and a
 * one-off 503 look exactly like this from here — but it is just as likely a deck
 * whose audio directory never got copied, and telling THAT viewer to press a key
 * names the wrong culprit and goes on being wrong every time they try.
 *
 * So this split decides what the strip says, and whether anything retries
 * unasked. It does NOT decide whether a person may retry: a gesture re-arms
 * either failure (see `unlock`), because someone asking is not the same as us
 * guessing. `test/deck-page.test.ts` now opens deck.html and asserts the strip
 * NAMES an unplayable segment instead of going quiet — it was one of the four
 * regressions that gate was proved against. Nothing still plays a sound, so
 * which of the two failures a real browser hits is untested.
 *
 * `NotSupportedError` is the unplayable one — observed rather than taken from
 * the spec: a source that cannot be fetched at all rejects `play()` with
 * `NotSupportedError` and leaves `audio.error.code` at 4
 * (`MEDIA_ERR_SRC_NOT_SUPPORTED`), and so does one that is fetched but is not
 * media.
 *
 * Be honest about what that is worth. It is ONE run, on this machine, in a
 * headless browser whose engine and version nobody wrote down, and that run
 * could not show the other side of the split at all: the build played an
 * ungestured sound even under
 * `--autoplay-policy=document-user-activation-required`, so no `NotAllowedError`
 * ever arrived to compare against. Nothing here has watched the two failures
 * come out of the same browser. Treat "a missing segment reads as missing on the
 * first attempt" as what that one run did, not as a cross-engine guarantee.
 *
 * Everything else FAILS SAFE to the policy, `NotAllowedError` included, and that
 * is exactly what makes such thin evidence affordable: rejection names are
 * per-engine, and an unknown one degrading to what ships today is the smaller
 * mistake — "press any key" over a file we could have played still recovers on
 * the first gesture, whereas the other way round leaves a recoverable deck
 * permanently silent.
 */
export function refused(err: unknown): boolean {
  return (err as { name?: unknown } | null | undefined)?.name !== "NotSupportedError";
}

/**
 * Speech and subtitles for one presented deck.
 *
 * Two rules earn their own object. First, leaving a stop must silence it
 * immediately by every route — arrow, click, Home/End, hashchange — so all of
 * them funnel through `at`, which stops before it starts; two sentences talking
 * over each other is worse than no narration at all.
 *
 * Second, cues are timed against `audio.currentTime` and nothing else. A timer
 * started alongside `play()` agrees with the audio right up until the first
 * stall, and then never again — and a stall is exactly when a viewer is looking
 * at the subtitle to find out what they missed.
 *
 * Exported, with `Voice`, only so a test can drive its failure paths: everything
 * that matters below happens after `play()` rejects, and nothing else in this
 * module can hand it that promise. `start` is the only caller.
 */
export function mountVoice(
  doc: Document,
  narration: Narration,
  ui: { subs: HTMLElement; flags: HTMLElement },
): Voice {
  const audio = doc.createElement("audio");
  audio.preload = "auto";
  doc.body.append(audio);

  let muted = false;
  let subtitles = true;
  /**
   * Reserving the caption strip is what shrinks the slide to make room for it,
   * so it belongs to "this deck has subtitles on", not to "a cue is up right
   * now" — the alternative resizes the slide every time the speaker pauses.
   */
  const reserve = () => doc.documentElement.classList.toggle("ds-cap", subtitles);
  reserve();
  /** Set when the autoplay policy refused us; cleared by the first gesture. */
  let blocked = false;
  /**
   * Set when the segment's own file could not be played. Deliberately NOT
   * `blocked`, because only `blocked` may promise a viewer that a key will help.
   * A gesture retries this one too — the same rejection is what a dropped
   * connection produces — but nothing retries it on its own, so an absent file
   * is asked for once per arrival and once per gesture rather than forever.
   */
  let unplayable = false;
  /** Shown once and never again — a nag is worse than silence. */
  let told = false;
  let cues: readonly Cue[] = [];
  let raf = 0;
  let showing: Cue | null = null;
  let here: Stop | null = null;
  /**
   * Bumped on every arrival. `play()` settles asynchronously, so without it a
   * rejection belonging to the stop we just left would arrive after the next
   * one has started and tear down its subtitles.
   */
  let epoch = 0;

  const flags = () => {
    const bits: string[] = [];
    if (blocked && told) bits.push("press any key for sound");
    // Ahead of `muted`, because it is the one a viewer can do nothing about:
    // being told the narration is missing beats being told it is turned down.
    else if (unplayable) bits.push("narration unavailable");
    else if (muted) bits.push("muted");
    if (!subtitles) bits.push("subtitles off");
    ui.flags.textContent = bits.join("   ·   ");
  };

  const paint = () => {
    const cue = subtitles ? activeCue(cues, audio.currentTime) : null;
    if (cue === showing) return;
    showing = cue;
    ui.subs.textContent = cue?.text ?? "";
    ui.subs.hidden = cue === null;
  };

  /**
   * One pass per frame, because a cue boundary lands between `timeupdate`s —
   * the element fires those about four times a second, and a subtitle that
   * changes a quarter-second late is a subtitle that is visibly wrong.
   *
   * Ends at the last word, or if playback stops after having started: a media
   * error leaves `ended` false forever, and a frame loop nobody can end is the
   * one bug a presented deck cannot recover from.
   */
  const follow = () => {
    paint();
    const done = audio.ended || (audio.paused && audio.currentTime > 0);
    raf = done ? 0 : requestAnimationFrame(follow);
  };

  const silence = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    // Not just `pause()`: a `play()` promise still in flight would otherwise
    // resolve after we have left and start the previous stop's sentence over
    // the new one. Dropping the source aborts it.
    audio.removeAttribute("src");
    audio.load();
    cues = [];
    paint();
  };

  /**
   * Fired when a segment reaches its own end — never when it is cut short by a
   * step, because `silence()` pauses, drops the source and calls `load()`, which
   * aborts without firing `ended`. THAT is what keeps a late event from the stop
   * we just left out of the one we are on, and it is a property of `silence`.
   *
   * It used to say an `epoch` guard did it. The guard read `const mine = epoch`
   * and then compared `mine === epoch` on the next line — always true, on a
   * listener installed once with no per-stop value to close over. Removed rather
   * than made real: capturing the epoch per segment means registering the
   * listener per segment, which trades a dead guard for a live leak.
   */
  let ended: () => void = () => {};
  audio.addEventListener("ended", () => {
    if (!blocked) ended();
  });

  /** Its counterpart: whether this stop's segment is going to be heard at all. */
  let settled: (heard: boolean) => void = () => {};

  const speak = (stop: Stop): boolean => {
    const mine = ++epoch;
    here = stop;
    silence();
    // "narration unavailable" belongs to the segment that failed, not to the
    // deck. Cleared on arrival — including the arrival at a stop with nothing to
    // say, which returns below without ever reaching a `play()` handler.
    unplayable = false;
    flags();
    const segment = segmentFor(narration, stop.sceneId, stop.fragment);
    if (!segment) return false;

    cues = segment.cues;
    // Muting keeps the audio playing, silently. It is not the same as not
    // playing: the element's clock is what subtitles read, so a viewer who
    // wants captions without sound still gets them — and a muted element is
    // exempt from the autoplay policy, so mute is also the escape hatch.
    audio.muted = muted;
    audio.src = audioSrc(narration, segment);
    void Promise.resolve(audio.play()).then(
      () => {
        if (mine !== epoch) return;
        blocked = false;
        unplayable = false;
        flags();
        settled(true);
      },
      (err: unknown) => {
        // Autoplay refused, or the file is missing. Either way navigation has
        // already happened and must not care; we only stop pretending to speak.
        // WHICH of the two it was decides what the viewer is told and whether a
        // gesture retries — see `refused`.
        if (mine !== epoch) return;
        blocked = refused(err);
        unplayable = !blocked;
        if (blocked) told = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        cues = [];
        paint();
        flags();
        // Whoever is driving is timing this stop by a sound that is not coming.
        // Reported for BOTH failures: a refusal leaves the deck exactly as
        // silent as a missing file, and `ended` fires for neither.
        settled(false);
      },
    );
    if (raf === 0) raf = requestAnimationFrame(follow);
    return true;
  };

  return {
    at: speak,
    // The same teardown a step performs, without the arrival: `silence()` pauses
    // and drops the source, so a `play()` still in flight cannot resolve into
    // the middle of whatever took the track.
    hush: silence,
    onEnded: (fn) => {
      ended = fn;
    },
    onSettled: (fn) => {
      settled = fn;
    },
    toggleMute: () => {
      muted = !muted;
      audio.muted = muted;
      flags();
    },
    toggleSubtitles: () => {
      subtitles = !subtitles;
      reserve();
      paint();
      flags();
    },
    // Both recoverable failures, retried only when a person asks for it.
    // `unplayable` is here because the rejection that means "this file is not
    // there" is also what a network that dropped for two seconds produces, and
    // `blocked` used to be the only state this looked at — so one bad moment
    // left the deck silent for the rest of the session with no way back. If the
    // file really is gone the retry rejects again and puts the same honest flag
    // back, which is exactly why it is safe to offer and still wrong to take
    // unasked.
    unlock: () => {
      if (!here || !(blocked || unplayable)) return;
      blocked = false;
      flags();
      speak(here);
    },
  };
}

/* ------------------------------------------------------------------- Video */

/** Selector for the island `emitDeckPage` writes. Absent from every deck without a clip. */
const VIDEO_ISLAND = 'script[type="application/decksmith-video+json"]';

/** One player-page video, keyed in the island by the scene that draws its still. */
export interface ClipSpec {
  /** Already in embeddable form — `embedUrl` in src/pack/media.ts did that at build time. */
  url: string;
  /** The figure's caption. It titles the frame, which is all a screen reader gets. */
  title: string;
}

/**
 * Read the island, defensively, for the same reason `parseNarration` is
 * defensive: a deck built before this existed has no island, and one built by a
 * newer emitter may carry fields this reader has never heard of. Neither may do
 * anything worse than leave the poster alone.
 */
export function parseClips(json: string | null | undefined): Record<string, ClipSpec> {
  if (!json) return {};
  const found: Record<string, ClipSpec> = {};
  try {
    const parsed = JSON.parse(json) as { scenes?: Record<string, Partial<ClipSpec>> };
    for (const [sid, clip] of Object.entries(parsed?.scenes ?? {})) {
      // `https:` AND NOTHING ELSE. This string becomes a frame's `src`, and a
      // `javascript:` URL there would make the island a script the deck runs —
      // the island is emitted by us today, and a deck is a file that gets copied,
      // edited and served by people who are not us.
      if (typeof clip?.url === "string" && /^https:\/\//i.test(clip.url)) {
        found[sid] = {
          url: clip.url,
          title: typeof clip.title === "string" ? clip.title : "Video",
        };
      }
    }
  } catch {
    return {};
  }
  return found;
}

interface Clips {
  /** Arriving at a stop: close whatever was open, offer this stop's video if it has one. */
  at: (stop: Stop) => void;
  /** Open it, or close it if it is open. What the button and `v` both call. */
  toggle: () => void;
  /** Close an open player. `false` when there was nothing open, so Escape can fall through. */
  close: () => boolean;
}

const NO_CLIPS: Clips = { at: () => {}, toggle: () => {}, close: () => false };

/**
 * The third-party player, in `deck.html` and nowhere else.
 *
 * THE ASYMMETRY IS THE WHOLE DESIGN, AND THIS IS THE FILE THAT ACTS ON IT. A
 * clip whose bytes we could not fetch is a poster in the composition and stays
 * one: `index.html` is what `render` captures, virtual time propagates only into
 * same-origin frames, and the compile-time localiser has no pattern for an
 * iframe — so an embed there would play at wall-clock speed, refetch itself from
 * the network on every render, and be refused outright by `scanDeterminism`.
 * `deck.html` is never captured and never scanned, and is already a framing
 * document — the player builds its own frame around `index.html` there — so the
 * frame that is a defect one file over is correct here. See `videoIsland` in
 * src/emit/composition.ts for the long version.
 *
 * The tag is never written as markup, and test/deck.test.ts pins that: this
 * module is inlined verbatim into `deck.html`, so a literal in it is a literal
 * in a shipped HTML file — the same reasoning that keeps the composition-id
 * attribute out of this bundle, one test up.
 *
 * CLICK TO PLAY, AND `allow` IS WHERE THAT IS ENFORCED rather than promised.
 * The frame is created by the click, its src is the island's URL verbatim, and
 * it is granted no autoplay feature — so even a host that would like to start
 * on load cannot. A deck that makes noise the moment it opens is a bug, and
 * five of them at once is the same bug five times.
 *
 * LOADED ON DEMAND, which is not only politeness. A YouTube or Vimeo frame is
 * several hundred KB of player and a live connection the instant it exists, so
 * five live frames in a twelve-slide deck is megabytes fetched before slide two,
 * five third-party origins told what is being presented and when, and five
 * players in the document at once. The viewer asked for one video; they get one.
 *
 * REMOVING THE FRAME IS THE ONLY WAY TO STOP IT. The player is cross-origin and
 * we hold no handle on it — no pause, no postMessage we are entitled to send —
 * so leaving a stop tears the element out. Without that, the video keeps talking
 * underneath the next slide.
 */
function mountClips(
  doc: Document,
  clips: Record<string, ClipSpec>,
  ui: { chrome: HTMLElement; video: HTMLButtonElement },
  /** Called before a player opens, so the deck can put down the audio track. */
  taken: () => void,
): Clips {
  let box: HTMLElement | null = null;
  let here: ClipSpec | null = null;

  const close = (): boolean => {
    if (!box) return false;
    box.remove();
    box = null;
    return true;
  };

  const open = () => {
    if (!here || box) return;
    taken();
    box = doc.createElement("div");
    box.className = "ds-film";
    const frame = doc.createElement("iframe");
    frame.src = here.url;
    // The only thing a screen reader is given: a cross-origin frame is opaque,
    // so its title is the whole of what the caption said about the video.
    frame.title = here.title;
    // NARROW ON PURPOSE. `fullscreen` because the player's own button is inside
    // the frame and dead without it; nothing else, and `autoplay` least of all —
    // see the click-to-play note above. The deck's OWN sandbox (a CSP directive
    // on the served response, which nested contexts inherit) already withholds
    // popups, forms, modals and top-navigation from it, so the embed's
    // "watch on the site" chrome is inert.
    frame.allow = "fullscreen";
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    const shut = doc.createElement("button");
    shut.type = "button";
    shut.className = "ds-shut";
    shut.textContent = "✕";
    shut.setAttribute("aria-label", "Close the video");
    shut.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
    });
    box.append(frame, shut);
    ui.chrome.append(box);
    // Focus lands OUTSIDE the frame, so Escape and the arrow keys still reach
    // the deck's own handlers. A click into the player hands the keyboard to the
    // player, which is what a viewer watching a video means by it.
    shut.focus();
  };

  const toggle = () => {
    if (!close()) open();
  };

  // `stopPropagation`, exactly as `.ds-play` does: the deck advances on a click
  // in the outer third, and this click must not also step. It also keeps the
  // gesture away from the document-level `unlock` listener, which would restart
  // the narration that `taken()` has just stopped, over the video.
  ui.video.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  return {
    at: (stop) => {
      // Unconditional, including a re-clamp at the last stop: an open frame that
      // outlives the slide it belongs to is the failure worth being blunt about.
      close();
      here = clips[stop.sceneId] ?? null;
      ui.video.hidden = here === null;
      if (here) ui.video.setAttribute("aria-label", `Play the video: ${here.title}`);
    },
    toggle,
    close,
  };
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""));
}

async function start(doc: Document): Promise<void> {
  const slides = readIsland(doc);
  const player = doc.querySelector<Player>("hyperframes-player");
  // No island or no player means this document is being rendered, not presented.
  if (slides.length === 0 || !player) return;

  const stops = buildStops(slides);
  if (stops.length === 0) return;

  const ui = mountChrome(doc);
  // Absent island = the silent deck we shipped before narration existed.
  const narration = parseNarration(doc.querySelector(NARRATION_ISLAND)?.textContent);
  const voice = narration ? mountVoice(doc, narration, ui) : SILENT;
  // Absent island = a deck with no player-page clip in it, which is almost every
  // deck. `NO_CLIPS` keeps the button hidden and costs `go` one call per step.
  const found = parseClips(doc.querySelector(VIDEO_ISLAND)?.textContent);
  const clips =
    Object.keys(found).length === 0
      ? NO_CLIPS
      : mountClips(doc, found, ui, () => {
          // The deck has one audio track. Narration stops so the video can have
          // it, and autoplay stops because a deck that steps to the next slide
          // while someone is watching a video is a deck fighting its viewer.
          voice.hush();
          setPlaying(false);
        });
  let at = 0;
  /**
   * The composition, resolved ONCE and only after `whenReady`, below.
   *
   * Making this lazy — reach for the frame on the first step that needs one — is
   * the tempting fix for "what if it is not readable yet", and it is wrong.
   * `<hyperframes-player>` builds its iframe in its CONSTRUCTOR, so until the
   * composition navigation commits, `contentDocument` is already a perfectly
   * readable `about:blank`. Every handler below — keydown, click, hashchange,
   * the host bridge — is registered BEFORE `await whenReady(player)`, which
   * waits on the player's one-shot `ready` event for up to five seconds. So one
   * Space, one click or one host `go` inside that window would latch the throwaway
   * document for the rest of the session: a deck that steps perfectly, paints
   * nothing, and never puts `.ds-live` on the real composition, which by
   * invariant 6 leaves every ambient rule inert too. Measured on 2026-09-08 in
   * headless Chromium 145 against an iframe built like the player's: at the outer
   * document's DOMContentLoaded the frame's document is `about:blank`, and the
   * one that commits later is a DIFFERENT object.
   *
   * A retry is only safe if it asks WHICH document it got, not merely whether it
   * got one. Until something checks for the composition, once-after-ready is the
   * construction that cannot latch the wrong answer.
   */
  let frame: Frame | null = null;
  /** Composition time currently painted. Mid-flight this is between stops. */
  let shown = 0;
  /** Handle of the transition in flight, or 0. */
  let raf = 0;
  /** Last stop handed to the voice. -1 so the opening stop always speaks. */
  let spoken = -1;

  /** Land on `t` and hand the player's clock the same answer. */
  const cutTo = (t: number) => {
    player.seek(t);
    if (frame) paint(frame, slides, t);
    shown = t;
  };

  const glide = (f: Frame, toT: number, durationMs: number) => {
    const fromT = shown;
    // The frame's own timestamp, not `performance.now()`: same clock, and it
    // keeps every wall-clock call out of deck.html, which the determinism scan
    // reads along with the composition.
    let startedAt = 0;
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      // Progress from wall-clock, never a frame count: a dropped frame then
      // costs travel rather than stretching the transition.
      const p = Math.min(1, (now - startedAt) / durationMs);
      if (p < 1) {
        shown = fromT + (toT - fromT) * p;
        paint(f, slides, shown);
        raf = requestAnimationFrame(tick);
        return;
      }
      raf = 0;
      cutTo(toT); // exact landing, and the player's clock catches up here
    };
    raf = requestAnimationFrame(tick);
  };

  /* ------------------------------------------------------------- autoplay */

  /**
   * Play the deck without a hand on it.
   *
   * Deliberately a MODE rather than a change to what stepping means: wiring
   * `ended` straight to "next" would make every narrated deck advance itself,
   * which is wrong for the case this deck is mostly used for — someone standing
   * in front of it, talking over it. So nothing moves until it is turned on.
   *
   * Manual navigation does not cancel it. Stepping while playing is a viewer
   * skipping ahead, not asking it to stop, and the arrival re-arms the clock
   * either way.
   */
  let playing = false;
  let dwell: ReturnType<typeof setTimeout> | 0 = 0;
  const clearDwell = () => {
    if (dwell) clearTimeout(dwell);
    dwell = 0;
  };
  const advance = () => {
    if (!playing) return;
    if (at + 1 < stops.length) go(at + 1);
    else setPlaying(false); // the end is a stop, not a loop
  };
  /**
   * Put autoplay's clock where `dwellMs` says it goes, given the latest answer
   * to "is this stop actually being narrated?".
   *
   * Called from two places, and the second one is the point. `go` calls it on
   * arrival with what `voice.at` said; `voice.onSettled` calls it again when
   * `play()` settles and says whether that was true. Without the second call a
   * deck playing itself waits for an `ended` that can never arrive and stops
   * dead on that slide — forever, with the play button still lit — which is what
   * shipped before this. Both routes go through `dwellMs` so the policy is in
   * one testable place and neither caller can drift from the other.
   */
  const settleDwell = (heard: boolean) => {
    clearDwell();
    const stop = stops[at] as Stop;
    const next = stops[at + 1];
    const ms = dwellMs({ playing, heard, gapMs: next ? (next.t - stop.t) * 1000 : 0 });
    if (ms !== null) dwell = setTimeout(advance, ms);
  };
  const setPlaying = (on: boolean) => {
    playing = on;
    clearDwell();
    ui.play.dataset.on = on ? "1" : "0";
    ui.play.setAttribute("aria-label", on ? "Pause the deck" : "Play the deck");
    if (on) {
      // Re-speak the stop we are on, so pressing play says the current sentence
      // rather than sitting silent until the next one.
      spoken = -1;
      go(at, true);
    }
  };

  /**
   * THE HOST BRIDGE. Silent until a host says hello, and harmless when nobody
   * ever does — a deck opened directly has no parent to talk to and this costs
   * it one comparison per step.
   *
   * `hostOrigin` starts null and is set ONLY from the handshake. Nothing is ever
   * posted to "*": a stop carries the slide's speaker notes, and any page can
   * put a deck in a frame, so a wildcard post would hand an arbitrary framer the
   * presenter's notes.
   */
  let hostOrigin: string | null = null;
  const post = (msg: FromDeck) => {
    if (hostOrigin === null || parent === window) return;
    parent.postMessage(msg, hostOrigin);
  };

  addEventListener("message", (e: MessageEvent) => {
    // Only our parent, only our channel. A deck shares its window with nothing
    // else, but it may be framed by a page that talks to other frames.
    if (e.source !== parent || parent === window || !isOurs(e.data)) return;
    const msg = e.data;
    if (msg.type === "hello") {
      hostOrigin = e.origin;
      post({
        channel: CHANNEL,
        type: "ready",
        stops: stops.map((s, i) => ({
          i,
          label: `${s.slide + 1} / ${(stops[stops.length - 1] as Stop).slide + 1}`,
          notes: s.notes,
        })),
        at,
      });
      return;
    }
    // A command before the handshake is not answered, because there is nowhere
    // safe to answer to.
    if (hostOrigin !== e.origin) return;
    if (msg.type === "next") go(at + 1);
    else if (msg.type === "prev") go(at - 1);
    else if (msg.type === "go") go(msg.at, true);
    else if (msg.type === "play") setPlaying(msg.on);
  });

  /** `instant` marks a jump rather than a step: Home/End, deep link, hashchange. */
  const go = (next: number, instant = false) => {
    at = Math.max(0, Math.min(stops.length - 1, next));
    const stop = stops[at] as Stop;

    // Arrow-mashing is the normal case, so a new navigation always wins: an
    // orphaned loop would keep painting and could settle on the old stop.
    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    // Read the media query per step — a presenter may flip the OS setting
    // mid-deck, and startup is the wrong time to have decided.
    const reducedMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plan = planTransition(shown, stop.t, { reducedMotion });
    // No frame means nothing to paint, so there is nothing to animate either.
    if (plan.animate && !instant && frame) glide(frame, stop.t, plan.durationMs);
    else cutTo(stop.t);

    // After the transition is decided, as the frame it lands on begins: the
    // sentence belongs to the reveal, so it starts when the reveal does rather
    // than once it has finished. Reduced motion is deliberately not consulted —
    // a viewer who wants less movement may still want to be told what they are
    // looking at.
    //
    // Guarded on the index, not called unconditionally: arrowing past the last
    // stop clamps back to it, and that is not an arrival — restarting the
    // sentence there would make the end of a deck stutter.
    let speaking = false;
    if (at !== spoken) {
      spoken = at;
      speaking = voice.at(stop);
    }
    // Unguarded, unlike the voice: this tears an open player down, and a frame
    // that survives into the next slide keeps playing under it.
    clips.at(stop);
    // Autoplay's clock — see `settleDwell`. This is the provisional answer: what
    // `voice.at` said synchronously, which is only whether a segment exists.
    settleDwell(speaking);

    history.replaceState(null, "", formatHash(stop));
    post({
      channel: CHANNEL,
      type: "stop",
      at,
      total: stops.length,
      label: `${stop.slide + 1} / ${(stops[stops.length - 1] as Stop).slide + 1}`,
      notes: stop.notes,
      playing,
    });
    ui.fill.style.transform = `scaleX(${(at + 1) / stops.length})`;
    ui.count.textContent = `${stop.slide + 1} / ${(stops[stops.length - 1] as Stop).slide + 1}`;
    ui.notes.textContent = stop.notes;
  };

  // A finished sentence is the cue to move on, but only while playing — the
  // handler is installed once and asks `playing` each time rather than being
  // attached and detached, which is one fewer thing to get out of step.
  voice.onEnded(advance);
  // `voice.at` answered before `play()` did, so this is where a stop's timing is
  // actually decided: the same call again, with the real answer. Handed the
  // function itself rather than wrapped, so there is one visible line saying the
  // settled answer reaches the clock — the wiring a source-reading test checks,
  // because `start` runs only in a browser.
  voice.onSettled(settleDwell);
  ui.play.addEventListener("click", (e) => {
    e.stopPropagation(); // the deck advances on click; this button must not
    setPlaying(!playing);
  });

  // Pasting a deep link while the deck is already open is a same-document
  // navigation: nothing reloads, so without this the URL and the slide diverge.
  // `go`'s own replaceState does not fire hashchange, so this cannot loop.
  addEventListener("hashchange", () => {
    const pos = parseHash(location.hash);
    if (!pos) return;
    const i = findStop(stops, pos);
    if (i >= 0 && i !== at) go(i, true);
  });

  doc.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || typing(e.target)) return;
    switch (e.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        go(at + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        go(at - 1);
        break;
      case "Home":
        go(0, true);
        break;
      case "End":
        go(stops.length - 1, true);
        break;
      case "n":
        ui.notes.hidden = !ui.notes.hidden;
        break;
      case "m":
        voice.toggleMute();
        break;
      case "s":
        voice.toggleSubtitles();
        break;
      case "p":
        setPlaying(!playing);
        break;
      case "v":
        clips.toggle();
        break;
      case "Escape":
        // Ours only while a player is open. Otherwise fall through untouched —
        // Escape is also how a browser leaves fullscreen, and swallowing it
        // would trap a presenter there.
        if (!clips.close()) return;
        break;
      case "f": {
        const fs = doc.fullscreenElement
          ? doc.exitFullscreen()
          : doc.documentElement.requestFullscreen();
        void fs.catch(() => {});
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  });

  doc.addEventListener("click", (e) => {
    if (ui.chrome.contains(e.target as Node)) return;
    const third = (doc.documentElement.clientWidth || 1) / 3;
    if (e.clientX > third * 2) go(at + 1);
    else if (e.clientX < third) go(at - 1);
  });

  // Registered after the navigation handlers on purpose. A browser refuses the
  // first `play()` until the page has been interacted with; by the time these
  // run, a gesture that also navigated has already moved us, so the retry
  // re-arms the stop we are on rather than the one we just left.
  const unlock = () => voice.unlock();
  doc.addEventListener("keydown", unlock);
  doc.addEventListener("click", unlock);

  await whenReady(player);
  if (typeof player.seek !== "function") return;
  player.pause?.();

  frame = frameOf(player);
  // The ambient CSS is gated on `.ds-live`, and only a presented deck sets it:
  // `render`/`check`/`snapshot` see a still document and stay byte-identical.
  frame?.doc.documentElement.classList.add("ds-live");
  if (!frame) {
    // Without the frame every seek lands on an unpainted composition. Saying so
    // beats the alternative, which is a deck that navigates perfectly and shows
    // nothing — the failure this whole module exists to prevent.
    console.warn("[decksmith] composition unreachable; serve the deck over http, not file://");
  }

  const deepLink = parseHash(location.hash);
  go(deepLink ? Math.max(0, findStop(stops, deepLink)) : 0, true);
}

/**
 * Self-boot, and no matching teardown ON PURPOSE.
 *
 * Asked for a `dispose()` returning from `start`, the answer is that THE FRAME
 * IS THE TEARDOWN. Everything `start` installs is owned by the document it was
 * handed or by that document's window — the keydown/click/hashchange handlers,
 * the subtitle-follow and glide rAF loops, the autoplay dwell timeout, and the
 * `<audio>` element `mountVoice` appends to `doc.body`. `DecksmithPlayer`
 * removes the iframe in `#teardown` (src/deck/player.ts), which discards that
 * document and every one of them with it, on both live paths: the element's own
 * `disconnectedCallback`, and the server UI clearing the canvas before it mounts
 * the next deck.
 *
 * So a `dispose` would have no caller and no test — `start` is invoked from the
 * two bare statements below, which discard the promise, and nothing imports it —
 * and it would be new dead code in the one file every navigable deck inlines
 * byte for byte. It becomes worth having the day a host DETACHES the element
 * without it leaving the document (`display:none` would do it), because then the
 * frame lives on with its audio and its rAF loops still running. That is an
 * element-level `pause()`, not a runtime-level `dispose()`.
 */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start(document), { once: true });
  } else {
    void start(document);
  }
}

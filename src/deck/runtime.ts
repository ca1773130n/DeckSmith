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
function frameOf(player: Player): Frame | null {
  const iframe =
    player.shadowRoot?.querySelector("iframe") ?? player.querySelector("iframe") ?? null;
  try {
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow as
      | (Window & { __timelines?: Record<string, Seekable> })
      | null;
    return doc && win ? { doc, timelines: win.__timelines ?? {} } : null;
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
    'aria-label="Play the deck"></button><div class="ds-count"></div><div class="ds-flags"></div>' +
    '<div class="ds-subs" hidden></div><div class="ds-notes" hidden></div>';
  doc.body.append(chrome);

  return {
    chrome,
    fill: chrome.querySelector("i") as HTMLElement,
    play: chrome.querySelector(".ds-play") as HTMLButtonElement,
    count: chrome.querySelector(".ds-count") as HTMLElement,
    notes: chrome.querySelector(".ds-notes") as HTMLElement,
    flags: chrome.querySelector(".ds-flags") as HTMLElement,
    subs: chrome.querySelector(".ds-subs") as HTMLElement,
  };
}

/* -------------------------------------------------------------- Narration */

interface Voice {
  /**
   * Arrive at a stop: cut whatever was speaking, start this stop from zero.
   * Returns whether this stop has anything to say — autoplay needs to know,
   * because a silent stop has no `ended` event to wait for and would otherwise
   * be where playback quietly stops forever.
   */
  at: (stop: Stop) => boolean;
  toggleMute: () => void;
  toggleSubtitles: () => void;
  /** Called when the segment for the CURRENT stop finishes of its own accord. */
  onEnded: (fn: () => void) => void;
  /** First real gesture: retry a segment the autoplay policy refused. */
  unlock: () => void;
}

const SILENT: Voice = {
  at: () => false,
  toggleMute: () => {},
  toggleSubtitles: () => {},
  onEnded: () => {},
  unlock: () => {},
};

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
 */
function mountVoice(
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
   * step, because `silence()` pauses rather than ending. Guarded by `epoch` so a
   * late event from the stop we just left cannot advance the one we are on.
   */
  let ended: () => void = () => {};
  audio.addEventListener("ended", () => {
    const mine = epoch;
    if (mine === epoch && !blocked) ended();
  });

  const speak = (stop: Stop): boolean => {
    const mine = ++epoch;
    here = stop;
    silence();
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
        flags();
      },
      () => {
        // Autoplay refused, or the file is missing. Either way navigation has
        // already happened and must not care; we only stop pretending to speak.
        if (mine !== epoch) return;
        blocked = true;
        told = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        cues = [];
        paint();
        flags();
      },
    );
    if (raf === 0) raf = requestAnimationFrame(follow);
    return true;
  };

  return {
    at: speak,
    onEnded: (fn) => {
      ended = fn;
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
    unlock: () => {
      if (!blocked || !here) return;
      blocked = false;
      flags();
      speak(here);
    },
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
  let at = 0;
  // Resolved once the player has built its iframe, below.
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
    // Autoplay's clock. A narrated stop is timed by its own audio, which is the
    // whole timing model of this project — speech drives the deck. A silent one
    // has no `ended` to wait for, so it gets the gap the author left before the
    // next stop, which is the same number the linear render would have used.
    // Without this, playback stops dead on the first slide nobody narrated.
    clearDwell();
    if (playing && !speaking) {
      const next = stops[at + 1];
      const gap = next ? (next.t - stop.t) * 1000 : 0;
      dwell = setTimeout(advance, Math.min(8000, Math.max(1500, gap)));
    }

    history.replaceState(null, "", formatHash(stop));
    ui.fill.style.transform = `scaleX(${(at + 1) / stops.length})`;
    ui.count.textContent = `${stop.slide + 1} / ${(stops[stops.length - 1] as Stop).slide + 1}`;
    ui.notes.textContent = stop.notes;
  };

  // A finished sentence is the cue to move on, but only while playing — the
  // handler is installed once and asks `playing` each time rather than being
  // attached and detached, which is one fewer thing to get out of step.
  voice.onEnded(advance);
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

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start(document), { once: true });
  } else {
    void start(document);
  }
}

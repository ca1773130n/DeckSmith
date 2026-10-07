/**
 * The v2 player's viewer preferences, its stage geometry and its keymap — the
 * parts of the presented deck that can be wrong without a browser, kept apart
 * from runtime.ts so they are tested directly.
 *
 * WHAT "v2" MEANS HERE. A deck page opts in with one tag in its head,
 * `<meta name="decksmith-player" content="2">` (`PLAYER_META`). `--design v2`
 * writes it at build time and `decksmith repack` writes it into a deck that was
 * already built. Without it the runtime behaves exactly as it did at v0.8.0:
 * the same chrome, the same keys, the same caption strip. One bundle serves
 * both, so a deck never depends on which file a host happened to copy.
 *
 * Everything below is pure: no DOM, no storage, no clock.
 */
import { PAD_Y, refHeight } from "../emit/kit.js";

/** The meta tag a v2 deck page carries. Read by the runtime, written by the emitter and `repack`. */
export const PLAYER_META = "decksmith-player";
export const PLAYER_MARKER = `<meta name="${PLAYER_META}" content="2" />`;

/**
 * `page` with the v2 marker as the first thing in its head. Idempotent: a page
 * that already names a player version is returned with that tag replaced, so
 * marking twice — or repacking a repacked deck — changes nothing.
 */
export function markV2(page: string): string {
  const existing = new RegExp(`<meta name="${PLAYER_META}"[^>]*>`);
  if (existing.test(page)) return page.replace(existing, PLAYER_MARKER);
  const head = /<head[^>]*>/i.exec(page);
  if (!head) throw new Error("not a deck page: it has no <head> to mark");
  const at = head.index + head[0].length;
  return `${page.slice(0, at)}\n    ${PLAYER_MARKER}${page.slice(at)}`;
}

/* ------------------------------------------------------------------- prefs */

/**
 * Narration speeds a viewer can choose. The list YouTube and video.js offer,
 * minus 0.5 (edge-tts at half speed is a different voice, not a slower one).
 * Gecko mutes outside 0.25–4, so every entry plays everywhere.
 */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type CaptionSize = "s" | "m" | "l" | "xl";
export const CAPTION_SIZES: readonly CaptionSize[] = ["s", "m", "l", "xl"];
/** Multipliers on the M caption font. 80–160%, inside FCC 79.103's 50–200%. */
export const CAPTION_SCALE: Readonly<Record<CaptionSize, number>> = {
  s: 0.8,
  m: 1,
  l: 1.3,
  xl: 1.6,
};

/**
 * What a viewer chose. `speed` is the narration's playbackRate and divides
 * every glide and silent dwell; `cc` shows the caption strip; `ccsize` scales it.
 * Mute is deliberately not here: it is a moment's choice, not a preference.
 */
export interface PlayerPrefs {
  speed: number;
  cc: boolean;
  ccsize: CaptionSize;
}

export const DEFAULT_PREFS: PlayerPrefs = { speed: 1, cc: true, ccsize: "m" };

/** The localStorage key. Versioned so a later shape never misreads this one. */
export const PREFS_KEY = "decksmith.prefs.v1";

/**
 * The message a v2 deck posts to its parent whenever the VIEWER changes a
 * preference, and accepts from its parent to apply one. Not on the `CHANNEL`
 * protocol in ./protocol.ts on purpose: that one waits for a `hello` handshake
 * before it says anything, and HypePaper embeds a plain iframe that never sends
 * one. Posted to "*" because it carries nothing but three playback settings —
 * never notes, never position. A host must still check `event.origin`.
 *
 *   { type: "decksmith:prefs", speed: 1.25, cc: true, ccsize: "m" }
 *
 * Incoming, every field is optional; whatever is valid is applied and saved.
 */
export const PREFS_MESSAGE = "decksmith:prefs";

export interface PrefsMessage extends PlayerPrefs {
  type: typeof PREFS_MESSAGE;
}

/** The nearest offered rate, or undefined for anything that is not a positive number. */
export function snapRate(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  let best: number = RATES[0];
  for (const r of RATES) if (Math.abs(r - n) < Math.abs(best - n)) best = r;
  return best;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "1" || s === "on" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "off" || s === "false" || s === "no") return false;
  return undefined;
}

function size(v: unknown): CaptionSize | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (CAPTION_SIZES as readonly string[]).includes(s) ? (s as CaptionSize) : undefined;
}

/**
 * Whatever is valid in `raw`, and nothing else. Reads a stored blob, a host
 * message and a parsed query string alike, so a deck handed garbage keeps its
 * own defaults instead of throwing.
 */
export function cleanPrefs(raw: unknown): Partial<PlayerPrefs> {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PlayerPrefs> = {};
  const speed = snapRate(r.speed);
  if (speed !== undefined) out.speed = speed;
  const cc = bool(r.cc);
  if (cc !== undefined) out.cc = cc;
  const ccsize = size(r.ccsize);
  if (ccsize !== undefined) out.ccsize = ccsize;
  return out;
}

/** `?speed=1.25&cc=0&ccsize=l`, as a partial. Unknown and invalid params are ignored. */
export function prefsFromQuery(search: string): Partial<PlayerPrefs> {
  const q = new URLSearchParams(search);
  return cleanPrefs({
    speed: q.get("speed") ?? undefined,
    cc: q.get("cc") ?? undefined,
    ccsize: q.get("ccsize") ?? undefined,
  });
}

/** A stored blob, read defensively: anything unparseable is "nothing stored". */
export function prefsFromStored(text: string | null | undefined): Partial<PlayerPrefs> {
  if (!text) return {};
  try {
    return cleanPrefs(JSON.parse(text));
  } catch {
    return {};
  }
}

/**
 * Precedence, lowest first: default, stored, URL. A host message arriving later
 * is applied on top of whatever this produced.
 */
export function resolvePrefs(
  stored: Partial<PlayerPrefs>,
  query: Partial<PlayerPrefs>,
): PlayerPrefs {
  return { ...DEFAULT_PREFS, ...stored, ...query };
}

/** One step up or down the rate list, clamped at both ends. */
export function stepRate(current: number, dir: 1 | -1): number {
  const i = RATES.indexOf((snapRate(current) ?? 1) as (typeof RATES)[number]);
  return RATES[Math.max(0, Math.min(RATES.length - 1, i + dir))] as number;
}

/** "1×", "1.25×", "0.75×" — the speed button's face. */
export function rateLabel(rate: number): string {
  return `${rate}×`;
}

/* ---------------------------------------------------------------- geometry */

/** Caption font as a fraction of the slide's short side, at size M. */
export const CAPTION_RATIO = 0.03;
/** Below this a caption is not read, whatever the slide size. */
export const CAPTION_MIN_PX = 13;
export const CAPTION_MAX_PX = 56;
/**
 * The floor per size. Every size has the 13px floor, but on a stage small
 * enough for it to bind, L and XL used to land on it too, and the size control
 * then changed nothing at all on the phone embed — the one place a viewer most
 * needs it. Each larger size keeps a floor of its own instead, so a step up is
 * always a step up. S cannot go under the floor M is on: below 13px a caption
 * is not read.
 */
export const CAPTION_FLOOR_PX: Readonly<Record<CaptionSize, number>> = {
  s: CAPTION_MIN_PX,
  m: CAPTION_MIN_PX,
  l: 16,
  xl: 19,
};
/**
 * The strip, in caption fonts: two lines at line-height 1.25 (2.5) plus a
 * quarter-font of air above and below. Two lines is the budget `splitCue` and
 * `splitForScreen` cut every cue to.
 */
export const STRIP_FONTS = 3;
export const CAPTION_LINE_HEIGHT = 1.25;

/** The smallest control target (plan QW2), and the largest a big screen gets. */
export const BTN_MIN = 40;
export const BTN_MAX = 52;
/** A bar is its buttons plus this much air. */
export const BAR_AIR = 8;
/** The strip's least side gutter, as `.ds-subs` pads it. */
const STRIP_GUTTER = 12;
/**
 * How wide the control clusters are, in buttons. The right one is speed (a
 * label, about 1.4 buttons), CC, size and full screen; the left is play and the
 * "3 / 15" counter. The strip pads both sides by the wider, so a caption is
 * centred under the slide and never reaches a button.
 */
const FULL_SIDE_BTNS = 4.6;
/** Compact: play on one side, one settings button on the other. */
const COMPACT_SIDE_BTNS = 1.2;
/**
 * A caption line narrower than this many of its own ems wraps a two-line cue
 * into three. Below it the full control set gives way to the compact one.
 */
const MIN_MEASURE_EM = 24;
/** Slack a word-wrapping browser leaves at each line's end, as in SCREEN_CUE_EM. */
const WRAP_SLACK = 0.88;
/** The most a cue is ever allowed, whatever the screen: subtitles.ts's SCREEN_CUE_EM. */
const CUE_EM_MAX = 44;

/**
 * Where the control bar lives. The rule it exists for: A CONTROL NEVER COVERS
 * TEXT — not a caption, and not the slide's own text either.
 *
 * - `letterbox`: under the slide and its strip, in space the viewport has spare
 *   (a portrait phone, a tall embed). Costs nothing.
 * - `pad`: over the slide's bottom PADDING — the band every composition leaves
 *   empty of text (`.scene`'s `PAD_Y`, less a margin; see `safeBottomFor`).
 *   Only when the bar fits inside it at a full 40px target, i.e. on a slide
 *   about 720px tall or more. Costs nothing; it hides when idle.
 * - `band`: a strip of its own under the slide, shared side by side with the
 *   captions when they are on, so it costs at most the difference between the
 *   bar and the caption strip. Everything smaller than the two cases above.
 *
 * v2 used to put the bar inside the slide's box on every screen. Measured on the
 * preview decks (2026-10-08 review), it covered the foot headline in 12 of 12
 * cases at 390x844 and 11 of 12 at 800x450: on a small slide a 48px bar is a
 * fifth of the height, and no layout can keep a fifth of itself empty.
 */
export type Dock = "letterbox" | "pad" | "band";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stage {
  /** The slide's box, in CSS px. */
  slideW: number;
  slideH: number;
  slideX: number;
  slideY: number;
  /** Caption font and strip height. Both 0 with captions off. */
  capFont: number;
  capH: number;
  /** Where the control bar sits, and its box. */
  dock: Dock;
  bar: Box;
  /** Button size, px. */
  btn: number;
  /** One settings button instead of speed, CC, size and full screen. */
  compact: boolean;
  /** Space between the bar's edges and its outermost buttons. */
  barInset: number;
  /** The caption strip's box, and the padding each side that its text never enters. */
  strip: Box;
  stripPad: number;
  /** Two caption lines at this measure, in caption ems, for `splitForScreen`. */
  cueEm: number;
}

/**
 * Where the slide, its caption strip and the control bar go in a `vw`×`vh`
 * viewport. `safeBottom` is the share of the slide's height at its foot that the
 * composition keeps free of text (`safeBottomFor`); 0 means "assume none".
 *
 * NOT CIRCULAR. The v0.8.0 rule sized the caption from the viewport width and
 * the critic's first fix sized it from the stage rect — but the stage is the
 * viewport minus the strip, and the strip is a multiple of the font. Solving
 * once for the slide height that leaves exactly one strip below it,
 *
 *   H0 = min(vw / aspect,  vh / (1 + STRIP_FONTS · CAPTION_RATIO · scale · short))
 *
 * (`short` is the slide's short side over its height: 1 for landscape), and
 * deriving the font from THAT, gives a font that does not depend on the result
 * it determines. The floor can only make the strip taller than the solve
 * assumed, so the final height is re-clamped against the real strip.
 *
 * Slide, strip and (in the letterbox) bar are centred as one block: on a
 * portrait phone the caption and the controls sit under the slide rather than
 * at the bottom of the screen, and the slide gives up nothing for either.
 */
export function stageGeometry(
  vw: number,
  vh: number,
  aspect: number,
  captions: { on: boolean; size: CaptionSize },
  opts: { safeBottom?: number } = {},
): Stage {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
  const w = Math.max(0, vw);
  const h = Math.max(0, vh);
  const short = Math.min(a, 1);
  const safe = Math.max(0, Math.min(0.25, opts.safeBottom ?? 0));
  let capFont = 0;
  let capH = 0;
  if (captions.on) {
    const k = CAPTION_RATIO * CAPTION_SCALE[captions.size] * short;
    const h0 = Math.min(w / a, h / (1 + STRIP_FONTS * k));
    capFont = Math.min(CAPTION_MAX_PX, Math.max(CAPTION_FLOOR_PX[captions.size], k * h0));
    capH = STRIP_FONTS * capFont;
  }
  const fullGutter = Math.max(STRIP_GUTTER, 0.04 * w);
  const measureEm = (px: number) =>
    capFont > 0 ? Math.min(CUE_EM_MAX, (2 * WRAP_SLACK * Math.max(0, px)) / capFont) : CUE_EM_MAX;

  // 1. As the slide and strip stand, is there room for the bar beneath them?
  const slideH0 = Math.max(0, Math.min(w / a, h - capH));
  const spare = h - slideH0 - capH;
  if (spare >= BTN_MIN + BAR_AIR) {
    const slideW = slideH0 * a;
    const btn = Math.min(BTN_MAX, Math.max(BTN_MIN, slideW / 10), spare - BAR_AIR);
    const barH = btn + BAR_AIR;
    const slideX = (w - slideW) / 2;
    const slideY = Math.max(0, (h - slideH0 - capH - barH) / 2);
    return {
      slideW,
      slideH: slideH0,
      slideX,
      slideY,
      capFont,
      capH,
      dock: "letterbox",
      bar: { x: slideX, y: slideY + slideH0 + capH, w: slideW, h: barH },
      btn,
      compact: slideW < 2 * FULL_SIDE_BTNS * btn,
      barInset: 6,
      strip: { x: 0, y: slideY + slideH0, w, h: capH },
      stripPad: fullGutter,
      cueEm: measureEm(w - 2 * fullGutter),
    };
  }

  // 2. Does a full-size bar fit inside the padding the composition keeps empty?
  const padBar = Math.min(BTN_MAX + BAR_AIR, safe * slideH0);
  if (padBar >= BTN_MIN + BAR_AIR) {
    const slideW = slideH0 * a;
    const slideX = (w - slideW) / 2;
    const slideY = Math.max(0, (h - slideH0 - capH) / 2);
    return {
      slideW,
      slideH: slideH0,
      slideX,
      slideY,
      capFont,
      capH,
      dock: "pad",
      bar: { x: slideX, y: slideY + slideH0 - padBar, w: slideW, h: padBar },
      btn: padBar - BAR_AIR,
      compact: slideW < 2 * FULL_SIDE_BTNS * BTN_MIN,
      barInset: 6,
      strip: { x: 0, y: slideY + slideH0, w, h: capH },
      stripPad: fullGutter,
      cueEm: measureEm(w - 2 * fullGutter),
    };
  }

  // 3. A band of its own under the slide, shared with the captions side by side.
  // Full: the clusters line up with the slide's edges. Compact: they hug the
  // window's, because on a phone embed the pillarbox is width the caption needs.
  const btn = BTN_MIN;
  const solve = (sideBtns: number, hug: boolean) => {
    const bandH = Math.max(capH, btn);
    const slideH = Math.max(0, Math.min(w / a, h - bandH));
    const slideW = slideH * a;
    const inset = hug ? 4 : Math.max(4, (w - slideW) / 2);
    const pad = inset + sideBtns * btn + STRIP_GUTTER / 2;
    return { bandH, slideH, slideW, inset, pad, measure: w - 2 * pad };
  };
  let compact = false;
  let s = solve(FULL_SIDE_BTNS, false);
  const tooNarrow = captions.on
    ? s.measure < MIN_MEASURE_EM * capFont
    : s.measure < STRIP_GUTTER * 2;
  if (tooNarrow) {
    compact = true;
    s = solve(COMPACT_SIDE_BTNS, true);
  }
  const slideX = (w - s.slideW) / 2;
  const slideY = Math.max(0, (h - s.slideH - s.bandH) / 2);
  const bandY = slideY + s.slideH;
  return {
    slideW: s.slideW,
    slideH: s.slideH,
    slideX,
    slideY,
    capFont,
    capH: captions.on ? s.bandH : 0,
    dock: "band",
    bar: { x: 0, y: bandY, w, h: s.bandH },
    btn,
    compact,
    barInset: s.inset,
    strip: { x: 0, y: bandY, w, h: captions.on ? s.bandH : 0 },
    stripPad: s.pad,
    cueEm: measureEm(s.measure),
  };
}

/**
 * The share of a composition's height at its foot that no layout draws text in:
 * `.scene`'s bottom padding (`PAD_Y`, in reference px) less a margin, over the
 * reference height. 16:9 at 1920x1080 is (84 − 16) / 1080 ≈ 6.3%.
 *
 * NOT FOR A FORMAT THAT RESERVES A CAPTION BAND: burned captions live there.
 * Decks never do (`captionReserve` is a video setting), and an unknown shape
 * reads as 0, which only ever moves the bar into a band of its own.
 */
export function safeBottomFor(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 0;
  const refH = refHeight({ width, height } as Parameters<typeof refHeight>[0]);
  return Math.max(0, (PAD_Y - SAFE_MARGIN) / refH);
}
/** Reference px kept between the lowest text a layout may set and the bar's top. */
export const SAFE_MARGIN = 16;

/* ------------------------------------------------------------------- keys */

export type KeyAction =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "play"
  | "captions"
  | "faster"
  | "slower"
  | "bigger"
  | "smaller"
  | "mute"
  | "notes"
  | "video"
  | "escape"
  | "fullscreen";

export interface KeyLike {
  key: string;
  /** The physical key, layout-independent: `KeyC` whatever the IME makes of it. */
  code?: string;
  isComposing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/**
 * The v2 keymap. Founder's call (2026-10-07): Space is NEXT SLIDE, as it is in
 * every presenter; Enter is play/pause.
 *
 * Any key held with Cmd, Ctrl or Alt belongs to the browser — v0.8.0 took
 * Cmd+F for fullscreen and swallowed find. Toggles ignore auto-repeat, so a
 * held `c` does not strobe the captions; stepping keys repeat on purpose.
 */
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const key = latinKey(e);
  const step = STEP_KEYS[key];
  if (step) return step;
  if (e.repeat) return null;
  return TOGGLE_KEYS[key] ?? null;
}

/**
 * The letter a viewer meant. With a Korean (2-set) or Japanese IME on — the
 * normal state for those viewers — a letter key arrives as Hangul jamo or kana
 * (`c` as "ㅊ") or as "Process", and every toggle keyed on `e.key` did nothing.
 * Those fall back to the physical key. Anything ASCII is taken as given, so a
 * layout that really types a different letter (AZERTY's `a` on KeyQ) keeps it.
 */
function latinKey(e: KeyLike): string {
  const foreign =
    e.key === "Process" || e.isComposing === true || [...e.key].some((c) => c.charCodeAt(0) > 0x7f);
  if (!foreign) return e.key;
  const m = /^Key([A-Z])$/.exec(e.code ?? "");
  return m ? (m[1] as string).toLowerCase() : e.key;
}

const STEP_KEYS: Readonly<Record<string, KeyAction>> = {
  ArrowRight: "next",
  PageDown: "next",
  " ": "next",
  ArrowLeft: "prev",
  PageUp: "prev",
};

const TOGGLE_KEYS: Readonly<Record<string, KeyAction>> = {
  Home: "first",
  End: "last",
  Enter: "play",
  p: "play",
  k: "play",
  c: "captions",
  s: "captions",
  ">": "faster",
  "<": "slower",
  "+": "bigger",
  "=": "bigger",
  "-": "smaller",
  m: "mute",
  n: "notes",
  v: "video",
  Escape: "escape",
  f: "fullscreen",
};

/** One size step, clamped. */
export function stepSize(current: CaptionSize, dir: 1 | -1): CaptionSize {
  const i = CAPTION_SIZES.indexOf(current);
  return CAPTION_SIZES[Math.max(0, Math.min(CAPTION_SIZES.length - 1, i + dir))] as CaptionSize;
}

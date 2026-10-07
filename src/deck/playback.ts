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
 * The strip, in caption fonts: two lines at line-height 1.25 (2.5) plus a
 * quarter-font of air above and below. Two lines is the budget `splitCue` and
 * `splitForScreen` cut every cue to.
 */
export const STRIP_FONTS = 3;
export const CAPTION_LINE_HEIGHT = 1.25;

export interface Stage {
  /** The slide's box, in CSS px. */
  slideW: number;
  slideH: number;
  slideX: number;
  slideY: number;
  /** Caption font and strip height. Both 0 with captions off. */
  capFont: number;
  capH: number;
}

/**
 * Where the slide and its caption strip go in a `vw`×`vh` viewport.
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
 * The slide and strip are centred as one block: on a portrait phone the caption
 * sits under the slide in the letterbox rather than at the bottom of the
 * screen, and the slide gives up nothing for it (100% share).
 */
export function stageGeometry(
  vw: number,
  vh: number,
  aspect: number,
  captions: { on: boolean; size: CaptionSize },
): Stage {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
  const w = Math.max(0, vw);
  const h = Math.max(0, vh);
  const short = Math.min(a, 1);
  let capFont = 0;
  let capH = 0;
  if (captions.on) {
    const k = CAPTION_RATIO * CAPTION_SCALE[captions.size] * short;
    const h0 = Math.min(w / a, h / (1 + STRIP_FONTS * k));
    capFont = Math.min(CAPTION_MAX_PX, Math.max(CAPTION_MIN_PX, k * h0));
    capH = STRIP_FONTS * capFont;
  }
  const slideH = Math.max(0, Math.min(w / a, h - capH));
  const slideW = slideH * a;
  return {
    slideW,
    slideH,
    slideX: (w - slideW) / 2,
    slideY: Math.max(0, (h - slideH - capH) / 2),
    capFont,
    capH,
  };
}

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
  const step = STEP_KEYS[e.key];
  if (step) return step;
  if (e.repeat) return null;
  return TOGGLE_KEYS[e.key] ?? null;
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

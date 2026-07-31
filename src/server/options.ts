/**
 * The form fields, turned into the two objects the pipeline actually runs on: a
 * `Format` (canvas and budget) and a `Prefs` (what is said and how it sounds).
 *
 * Every field is optional and every one has a server-side default, so the
 * smallest legal request is a file and nothing else. Validation is delegated to
 * `prefsSchema` wherever the schema already has an opinion — there is one place
 * that decides what a legal tone is, and it is not this file.
 *
 * `loadPrefs` is deliberately NOT used. It walks up from a working directory
 * looking for `decksmith.config.json`, which on a server means a file somewhere
 * above the job directory silently changing what a stranger's upload produces.
 * A request states its own preferences or takes the schema's.
 */
import {
  canvasProblem,
  canvasWarnings,
  FORMATS,
  type Format,
  LEGIBLE_W,
  MAX_ASPECT,
  MAX_EDGE,
  MIN_EDGE,
  type Prefs,
  prefsSchema,
  resizeFormat,
  slidesFor,
  THEME_NAMES,
} from "../index.js";
import { UploadError } from "./upload.js";

/**
 * The ONE canvas rule this server adds to the library's.
 *
 * Everything else — whole numbers, `MIN_EDGE`, `MAX_EDGE`, `MAX_ASPECT` — is
 * `canvasProblem`'s, and is derived there from the layout and from Chrome's
 * texture ceiling. This file used to restate the whole question as
 * `MIN_SIDE = 320 … MAX_SIDE = 2560`, which meant three files held three
 * different opinions about what a canvas may be: src/types.ts said 64–16384,
 * this said 320–2560, and src/server/ui.ts's number inputs said 240–7680. The
 * UI's own maximum was refused by the server it posts to — 3840×2160 came back
 * 400 — so the picker offered sizes that could not be built.
 *
 * What survives is the part the library cannot know: this process holds whole
 * frames of width×height×4 bytes in flight during capture, on a box shared with
 * every other job. That is a deployment limit, not a layout one, so it belongs
 * here — and it is published in `catalog()` so the page can enforce the same
 * number rather than guess at one.
 *
 * With `MAX_ASPECT` also in force this implies a longest edge of about 5650px
 * (`MAX_SIDE` below), which is why no separate edge cap is stated: a second
 * number would only be a way to disagree with this one.
 */
export const MAX_PIXELS = 4_000_000;

/**
 * The longest edge that can actually be BUILT, which is not quite the longest
 * edge that satisfies the two limits above.
 *
 * `sqrt(MAX_PIXELS × MAX_ASPECT)` is 5656.85, so 5656 looks like the answer —
 * and it is unbuildable. At 5656 wide the aspect limit needs a height of at
 * least 707 and the pixel limit allows at most 707.2, so 707 is the only height
 * that fits; 707 is odd, `even()` rounds it to 706, and 5656/706 is 8.01:1,
 * which is refused. An advertised maximum that returns 400 at every height is
 * exactly the kind of number this reconciliation exists to delete.
 *
 * Rounding down to a multiple of 16 fixes it by construction: it makes
 * `MAX_SIDE / MAX_ASPECT` an even integer, so the extreme canvas is exactly
 * 8:1 with both sides even, and `MAX_SIDE² / MAX_ASPECT ≤ MAX_PIXELS` follows
 * from the same square root. 5648×706 = 3.99 megapixels, and it builds.
 * Asserted in test/server.test.ts rather than left to this comment.
 */
export const MAX_SIDE = Math.min(
  MAX_EDGE,
  16 * Math.floor(Math.sqrt(MAX_PIXELS * MAX_ASPECT) / 16),
);

export interface JobOptions {
  format: Format;
  /** The preset the format came from, for the log line and the job view. */
  formatId: string;
  prefs: Prefs;
  narrate: boolean;
  video: boolean;
  /**
   * Whether the REQUEST said so, as opposed to the schema defaulting.
   *
   * `prefs` comes back fully populated, so a theme sitting at "ink" is
   * indistinguishable from one nobody mentioned — and the two must behave
   * differently: the storyboard records the theme it was planned under and the
   * document knows what language it is in, and both should beat a default and
   * lose to anything a person chose. Same rule `stated()` enforces in src/cli.ts.
   */
  stated: { theme: boolean; lang: boolean };
  /** Anything we corrected rather than refused. Surfaced on the finished job. */
  warnings: string[];
}

/** `GET /api/formats`: what the picker needs to draw itself. */
export function formatCatalog(): {
  id: string;
  width: number;
  height: number;
  navigable: boolean;
  maxSeconds: number | null;
}[] {
  return Object.entries(FORMATS).map(([id, f]) => ({
    id,
    width: f.width,
    height: f.height,
    navigable: f.navigable,
    // JSON has no Infinity; null reads as "no ceiling", which is what it means.
    maxSeconds: f.maxSeconds === undefined || !Number.isFinite(f.maxSeconds) ? null : f.maxSeconds,
  }));
}

/** Everything the picker needs, in one payload, so the UI makes no assumptions. */
export function catalog(): Record<string, unknown> {
  return {
    formats: formatCatalog(),
    themes: THEME_NAMES,
    tones: ["plain", "academic", "conversational", "punchy"],
    densities: ["sparse", "normal", "dense"],
    /** How many of a beat's stops speak. A different axis from `densities`. */
    narrationDensities: ["high", "medium", "low"],
    slides: { min: 3, max: 40, default: prefsSchema.parse({}).slides },
    /** `null` default: no target, which is what every deck did before this. */
    duration: { min: 10, max: 1800, default: null },
    speed: { min: 0.25, max: 3, default: 1 },
    // The picker enforces exactly these, so a size the page offers is a size
    // this server will build. They were three different tables until the UI's
    // own maximum came back 400 from the server it posts to.
    canvas: {
      minSide: MIN_EDGE,
      maxSide: MAX_SIDE,
      maxPixels: MAX_PIXELS,
      maxAspect: MAX_ASPECT,
      /** Below this a deck lays out but is not legible. A warning, never a refusal. */
      legibleWidth: LEGIBLE_W,
    },
    defaults: { format: "deck-16x9", narrate: false, video: false },
  };
}

export function parseOptions(fields: Record<string, string>): JobOptions {
  const warnings: string[] = [];
  const formatId = str(fields.format) ?? "deck-16x9";
  const preset = FORMATS[formatId];
  if (!preset) {
    throw new UploadError(
      `Unknown format "${formatId}".`,
      `Choose one of: ${Object.keys(FORMATS).join(", ")}. GET /api/formats lists their sizes.`,
    );
  }

  const format = withCanvas(preset, fields, warnings);

  // Built as a patch and parsed once, so a bad tone and a bad slide count are
  // reported by the same schema that the CLI's flags go through.
  const patch: Record<string, unknown> = {};
  if (str(fields.theme) !== undefined) patch.theme = requireTheme(str(fields.theme) as string);
  if (str(fields.slides) !== undefined) patch.slides = int("slides", fields.slides as string);
  if (str(fields.lang) !== undefined) patch.lang = requireLang(str(fields.lang) as string);
  if (str(fields.tone) !== undefined) patch.tone = str(fields.tone);
  if (str(fields.density) !== undefined) patch.density = str(fields.density);
  // An empty number input posts "", which `str` reads as absent — and absent is
  // exactly "no target", so an untouched Duration field must not become a 400.
  if (str(fields.duration) !== undefined)
    patch.duration = num("duration", fields.duration as string);
  if (str(fields.speed) !== undefined) patch.animationSpeed = num("speed", fields.speed as string);

  const narrateWanted = bool(fields.narrate) ?? false;
  const video = bool(fields.video) ?? false;
  // `render` reads timing.json, and `buildDeck` only writes one when it has
  // narration to place. So a video without narration is not a quieter video, it
  // is a render that refuses — turn it on and say so rather than fail two
  // minutes of work in.
  const narrate = narrateWanted || video;
  if (video && !narrateWanted)
    warnings.push("video needs narration to time itself, so narration was turned on");

  const narration: Record<string, unknown> = { enabled: narrate };
  if (str(fields.voice) !== undefined) narration.voice = requireVoice(str(fields.voice) as string);
  // Posted under its own name because it is its own axis: `density` is how much
  // text a SLIDE carries, this is how many of a beat's stops SPEAK. One name for
  // both would reach the planner as a single instruction about two things.
  if (str(fields.narrationDensity) !== undefined) narration.density = str(fields.narrationDensity);
  // FELL ON THE FLOOR UNTIL NOW. `prefsSchema` has carried `rate` and `pitch`
  // since narration existed and this parser never read them, so a request that
  // set either got the default with no error and no warning — the silent-setting
  // failure this file's own `stated` comment exists to prevent, one field over.
  // Validated by the schema below like everything else, so a bad shape is a 400
  // rather than a surprise at synthesis time.
  if (str(fields.rate) !== undefined) narration.rate = str(fields.rate);
  if (str(fields.pitch) !== undefined) narration.pitch = str(fields.pitch);
  patch.narration = narration;

  const parsed = prefsSchema.safeParse(patch);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "options";
    throw new UploadError(
      `${where}: ${issue?.message ?? "is not a valid option"}.`,
      "GET /api/formats lists every option and the range it accepts.",
    );
  }

  // THE SLIDE COUNT IS DERIVED FROM THE DURATION, and this path was not deriving
  // it. `slidesFor` is applied in `loadPrefs`, which the header above explains is
  // deliberately not used here — so a request for ten minutes got the schema's
  // flat default of twelve while the same request through the CLI got thirty.
  // Measured: `--duration 600` is 30 slides at 20s a beat on one path and 12 at
  // 50s on the other, from one number nobody chose.
  //
  // Applied HERE rather than in the schema because it can only run once `stated`
  // is still visible: a twelve that the caller asked for must survive, and only
  // the absence of the field distinguishes the two.
  const prefs =
    fields.slides === undefined && parsed.data.duration !== undefined
      ? { ...parsed.data, slides: slidesFor(parsed.data) }
      : parsed.data;

  return {
    format,
    formatId,
    prefs,
    narrate,
    video,
    stated: { theme: patch.theme !== undefined, lang: patch.lang !== undefined },
    warnings,
  };
}

/* ------------------------------------------------------------------ internals */

/**
 * `width` and `height` override the preset's canvas.
 *
 * Built with `resizeFormat`, NOT with `{ ...preset, width, height }`. The spread
 * kept the preset's id, so a 1080×1350 canvas asked for as `short-9x16` came
 * back still calling itself `short-9x16` — and that id is what the budget gate
 * and every cut explanation quote. The deck would be told it had 180 seconds
 * because YouTube Shorts does, on a canvas no Short is. `resizeFormat` renames
 * it `custom-1080x1350` and keeps the pacing it inherited, which is the
 * distinction src/types.ts spells out at length; the request still names the
 * profile it wants the behaviour of.
 *
 * Odd dimensions are rounded down rather than refused, BEFORE `resizeFormat`
 * sees them. h264 with yuv420p needs even sides, and the failure otherwise
 * arrives from ffmpeg two minutes into a render, which is a bad place to learn
 * that 1081 is odd.
 */
function withCanvas(preset: Format, fields: Record<string, string>, warnings: string[]): Format {
  const hasW = str(fields.width) !== undefined;
  const hasH = str(fields.height) !== undefined;
  if (!hasW && !hasH) return preset;
  if (hasW !== hasH) {
    throw new UploadError(
      "width and height must be given together.",
      `Send both, or neither and let the "${preset.id}" preset decide.`,
    );
  }
  const width = even("width", fields.width as string, warnings);
  const height = even("height", fields.height as string, warnings);

  // The library's rules first, so the reason a canvas is refused is the derived
  // one — texture ceiling, padding collapse — rather than a number this file
  // invented. `canvasProblem`'s sentences are written for the CLI and name
  // `--width`; the flag spelling is the same field name, so they read correctly.
  const problem = canvasProblem(width, height);
  if (problem) {
    throw new UploadError(
      problem.replace(/--/g, ""),
      `Canvases run ${MIN_EDGE}–${MAX_SIDE}px a side, up to ${MAX_PIXELS / 1e6} megapixels, between 1:${MAX_ASPECT} and ${MAX_ASPECT}:1. GET /api/formats states all of it.`,
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new UploadError(
      `${width}×${height} is ${((width * height) / 1e6).toFixed(1)} megapixels, over this server's ${MAX_PIXELS / 1e6} megapixel ceiling.`,
      "Pick a smaller canvas; capture holds whole frames in memory and this box is shared.",
    );
  }
  // Legal, but probably not meant — an unreadably small canvas lays out fine and
  // no gate downstream measures rendered glyph size. Said, never fatal.
  warnings.push(...canvasWarnings(width, height));
  return resizeFormat(preset, width, height);
}

function even(name: string, raw: string, warnings: string[]): number {
  const n = int(name, raw);
  if (n % 2 === 0 || !Number.isFinite(n)) return n;
  warnings.push(`${name} ${n} rounded down to ${n - 1}; h264 needs even dimensions`);
  return n - 1;
}

function requireTheme(value: string): string {
  if (!THEME_NAMES.includes(value)) {
    throw new UploadError(`Unknown theme "${value}".`, `Choose one of: ${THEME_NAMES.join(", ")}.`);
  }
  return value;
}

/**
 * BCP-47 shape only. The tag picks a TTS voice and a font subset; both look it
 * up in a closed table, so this is about refusing junk, not about interpolation.
 */
function requireLang(value: string): string {
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(value)) {
    throw new UploadError(
      `"${value}" is not a language tag.`,
      'Use a BCP-47 tag such as "en", "ko" or "en-GB".',
    );
  }
  return value;
}

/** An edge-tts voice id. Reaches a subprocess as one argv element, never a shell. */
function requireVoice(value: string): string {
  if (!/^[A-Za-z]{2,3}-[A-Za-z0-9-]{2,40}Neural$/.test(value)) {
    throw new UploadError(
      `"${value}" is not an edge-tts voice id.`,
      'Voice ids look like "en-US-AvaMultilingualNeural". Leave it unset to get one chosen for the language and tone.',
    );
  }
  return value;
}

function str(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** HTML checkboxes send "on" and omit themselves entirely when unchecked. */
function bool(value: string | undefined): boolean | undefined {
  const v = str(value)?.toLowerCase();
  if (v === undefined) return undefined;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  throw new UploadError(`"${value}" is not a yes or no.`, "Send true or false.");
}

function num(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new UploadError(
      `${name} expects a number, got "${raw}".`,
      "Send a plain decimal number.",
    );
  }
  return n;
}

function int(name: string, raw: string): number {
  const n = num(name, raw);
  if (!Number.isInteger(n)) {
    throw new UploadError(
      `${name} expects a whole number, got "${raw}".`,
      "Drop the decimal point.",
    );
  }
  return n;
}

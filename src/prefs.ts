/**
 * Where a preference comes from, and what happens when it comes from nowhere.
 *
 * Three layers, in increasing precedence: the defaults baked into `prefsSchema`,
 * a `decksmith.config.json` found by walking up from the working directory, and
 * whatever the caller passes explicitly. Walking up is what every other tool in
 * a repo does, so a config at the project root governs a deck built from a
 * subdirectory without anyone naming a path.
 *
 * An unknown key in the config file is an error, not a shrug. A misspelled
 * preference that is silently dropped looks exactly like a preference the tool
 * ignores, and the user spends the next hour wondering why `slideCount` did
 * nothing — so the message names the key and lists the ones that exist.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { slidesFor } from "./plan/duration.js";
import { prefsSchema } from "./types.js";

export type Prefs = z.infer<typeof prefsSchema>;

/**
 * A partial Prefs. `narration` and `images` are the two nested objects, so they
 * are the two places a patch merges rather than replaces: `--voice` must not
 * wipe a `rate` the config file set, and `--image-style` must not wipe its
 * `provider`.
 */
export type PrefsPatch = Partial<Omit<Prefs, "narration" | "images">> & {
  narration?: Partial<Prefs["narration"]>;
  images?: Partial<Prefs["images"]>;
};

export const CONFIG_FILE = "decksmith.config.json";

const PREF_KEYS = Object.keys(prefsSchema.shape);
const NARRATION_KEYS = Object.keys(prefsSchema.shape.narration.unwrap().shape);
const IMAGES_KEYS = Object.keys(prefsSchema.shape.images.unwrap().shape);
/** The nested blocks, with the keys each one admits. `checkKeys` and `merge` walk this. */
const NESTED = { narration: NARRATION_KEYS, images: IMAGES_KEYS } as const;

/**
 * Resolve the preferences that govern one run.
 *
 * `cwd` is where the search for a config file starts; the search stops at the
 * filesystem root. Returns a fully-populated Prefs — every consumer downstream
 * reads fields, never optionals.
 */
export async function loadPrefs(overrides: PrefsPatch = {}, cwd = process.cwd()): Promise<Prefs> {
  const found = await findConfig(cwd);
  const fromFile = found ? checkKeys(found.value, found.path) : {};
  const merged = merge(fromFile, overrides);
  const parsed = parsePrefs(merged, found?.path);

  // THE ONE PREFERENCE WHOSE DEFAULT DEPENDS ON ANOTHER, so it is the one that
  // cannot be a constant in the schema. Twelve slides is right at three minutes
  // and wrong at one: `duration / slides` is what every derived number comes
  // from, and at 60 seconds twelve beats leave each one a single sentence, which
  // cannot be a story whoever writes it (see `SENTENCES_PER_BEAT`).
  //
  // Derived only when NOBODY SAID. `slides` is one of the three knobs the owner
  // asked to hold, so a number in the config file or on the command line is
  // obeyed even when it cannot flow — `durationPlan` reports that rather than
  // quietly overruling it. This is the layer that already owns "what happens when
  // a preference comes from nowhere", which is exactly the question.
  if (merged.slides === undefined && parsed.duration !== undefined) {
    return { ...parsed, slides: slidesFor(parsed) };
  }
  return parsed;
}

/**
 * Turn CLI flags into a patch. Values arrive as strings from commander and are
 * not validated here beyond the numbers: `loadPrefs` runs them through the
 * schema, so there is exactly one place that decides what a legal tone is.
 */
export function prefsFromFlags(flags: PrefFlags): PrefsPatch {
  const patch: PrefsPatch = {};
  if (flags.slides !== undefined) patch.slides = number("--slides", flags.slides);
  if (flags.lang !== undefined) patch.lang = flags.lang;
  if (flags.tone !== undefined) patch.tone = flags.tone as Prefs["tone"];
  if (flags.density !== undefined) patch.density = flags.density as Prefs["density"];
  if (flags.duration !== undefined) patch.duration = number("--duration", flags.duration);
  if (flags.theme !== undefined) patch.theme = flags.theme;
  if (flags.speed !== undefined) patch.animationSpeed = number("--speed", flags.speed);

  const narration: Partial<Prefs["narration"]> = {};
  if (flags.narrate !== undefined) narration.enabled = flags.narrate;
  if (flags.voice !== undefined) narration.voice = flags.voice;
  if (flags.rate !== undefined) narration.rate = flags.rate;
  if (flags.pitch !== undefined) narration.pitch = flags.pitch;
  if (flags.subtitles !== undefined) narration.subtitles = flags.subtitles;
  if (flags.narrationDensity !== undefined)
    narration.density = flags.narrationDensity as Prefs["narration"]["density"];
  // An empty narration patch must stay absent, or it reads as "the caller asked
  // for the default narration block" and outranks the config file's.
  if (Object.keys(narration).length) patch.narration = narration;

  const images: Partial<Prefs["images"]> = {};
  if (flags.images !== undefined) images.enabled = flags.images;
  if (flags.imageProvider !== undefined)
    images.provider = flags.imageProvider as Prefs["images"]["provider"];
  if (flags.imageModel !== undefined) images.model = flags.imageModel;
  if (flags.imageStyle !== undefined) images.style = flags.imageStyle;
  // A number here, an integer in the schema — the same split `--slides` uses, so
  // "four" and "2.5" each get one message from the one place that owns it.
  if (flags.imageMax !== undefined) images.max = number("--image-max", flags.imageMax);
  if (Object.keys(images).length) patch.images = images;

  return patch;
}

/** The flag surface the CLI exposes. Every one optional: absent means unstated. */
export interface PrefFlags {
  slides?: string | number;
  lang?: string;
  tone?: string;
  density?: string;
  duration?: string | number;
  theme?: string;
  speed?: string | number;
  narrate?: boolean;
  voice?: string;
  rate?: string;
  pitch?: string;
  subtitles?: boolean;
  /** `--narration-density`. Spelled apart from `density`, which is a slide's. */
  narrationDensity?: string;
  /** `--images`. A boolean like `narrate`, so `flags()` in cli.ts reads it beside `--no-subtitles`. */
  images?: boolean;
  imageProvider?: string;
  imageModel?: string;
  imageStyle?: string;
  imageMax?: string | number;
}

/* ------------------------------------------------------------------ internals */

async function findConfig(from: string): Promise<{ path: string; value: unknown } | undefined> {
  let dir = resolve(from);
  for (;;) {
    const path = join(dir, CONFIG_FILE);
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text !== undefined) {
      try {
        return { path, value: JSON.parse(text) };
      } catch {
        throw new Error(`${path} is not valid JSON.`);
      }
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * Reject keys the schema does not have, by name. Zod's own strict mode would
 * catch the top level, but it cannot see inside `narration` or `images` without
 * restating the shape, and `narration.speed` is exactly the typo worth catching.
 */
function checkKeys(value: unknown, path: string): PrefsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${path} must contain a JSON object of preferences.`);

  for (const key of Object.keys(value)) {
    if (!PREF_KEYS.includes(key))
      throw new Error(`${path}: unknown preference "${key}". Valid: ${PREF_KEYS.join(", ")}.`);
  }

  for (const [name, keys] of Object.entries(NESTED)) {
    const block = (value as Record<string, unknown>)[name];
    if (block === undefined) continue;
    if (typeof block !== "object" || block === null || Array.isArray(block))
      throw new Error(`${path}: "${name}" must be an object. Valid: ${keys.join(", ")}.`);
    for (const key of Object.keys(block)) {
      if (!keys.includes(key))
        throw new Error(`${path}: unknown preference "${name}.${key}". Valid: ${keys.join(", ")}.`);
    }
  }

  return value as PrefsPatch;
}

/** Shallow, except for the two nested objects, which merge field by field. */
function merge(base: PrefsPatch, patch: PrefsPatch): PrefsPatch {
  const narration = { ...base.narration, ...patch.narration };
  const images = { ...base.images, ...patch.images };
  return {
    ...base,
    ...patch,
    ...(Object.keys(narration).length ? { narration } : {}),
    ...(Object.keys(images).length ? { images } : {}),
  };
}

function parsePrefs(value: PrefsPatch, path?: string): Prefs {
  const parsed = prefsSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid preferences${path ? ` (${path})` : ""}:\n${issues}`);
  }
  return parsed.data;
}

function number(flag: string, value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${flag} expects a number, got "${value}".`);
  return n;
}

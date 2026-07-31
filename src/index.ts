// biome-ignore-all assist/source/organizeImports: the re-exports below are grouped
// by pipeline stage — ingest, plan, narrate, emit, verify, pack — and each group
// carries the comment explaining why those names are public. Alphabetising them
// merges the groups and orphans every comment.

/**
 * The library surface.
 *
 * DeckSmith started as a CLI and stays one, but a server that generates a deck
 * per paper should not shell out to a binary: it wants the errors as exceptions,
 * the storyboard as an object it can edit between stages, and no argv round-trip
 * for a 200 KB JSON document. So this file is the seam.
 *
 * It is chosen, not generated. Every name below is a promise we cannot quietly
 * break, so each one carries the reason it is here; anything a consumer can
 * reasonably reach by composing the names below is deliberately absent. The
 * house rule for adding to this file: a consumer must have asked for it, and
 * there must be no way to get it from what is already exported.
 *
 * Generating a deck is pure Node. Only `check`/`verify` and the video render
 * reach outside for Chrome, and only `narrate` for edge-tts — see README.
 */

import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DECK_PAGE, type DeckNarration, emitDeck, PLAYER_FILE } from "./emit/composition.js";
import type { Cut } from "./plan/select.js";
import { planTiming, TIMING_FILE } from "./render/timing.js";
import { bundleFont } from "./source/fonts.js";
import { type Format, FORMATS, type Source, type Storyboard } from "./types.js";

/* ------------------------------------------------------------------ ingest */

/**
 * Markdown (and LaTeX-ish markdown) in, typed `Source` out. The one parser we
 * have; a consumer that already holds structured text can skip it and hand
 * `sourceSchema.parse(...)` straight to the planner.
 */
export { parseMarkdown } from "./source/markdown.js";
export type { ParseOptions } from "./source/markdown.js";

/**
 * Figures referenced by URL, downloaded beside the source. Separate from
 * `parseMarkdown` because it touches the network and a server may want to fetch
 * through its own client instead.
 */
export { fetchFigures } from "./source/assets.js";

/**
 * Subset a CJK webfont over the glyphs a deck actually renders. Exported
 * because invariant 9 — a font stack naming a family the bundle does not
 * declare falls back silently — is not something a consumer can debug from the
 * outside, and `buildDeck` calls it for you only for its own output directory.
 */
export { bundleFont } from "./source/fonts.js";
export type { FontBundle } from "./source/fonts.js";

/* -------------------------------------------------------------------- plan */

/**
 * The planner. `Runner` is exported with it on purpose: `codexPlanner` shells
 * to the Codex CLI by default, which is wrong for a server, and substituting a
 * runner is the supported way to drive it from an SDK instead of a subprocess.
 */
export { codexPlanner } from "./plan/codex.js";
export type { CodexOptions, Runner } from "./plan/codex.js";

/**
 * Fails loudly when a beat cites a figure, table or equation the source does
 * not contain. `buildDeck` does not call it — a caller assembling a storyboard
 * by hand wants this before it spends a render on a dangling ref.
 */
export { assertInsideResolves, assertRefsResolve } from "./plan/refs.js";

/** The prompt, so a consumer driving its own model can reproduce our planning. */
export { renderSource, systemPrompt } from "./plan/prompt.js";

/**
 * The three exposed length knobs — `duration`, `slides`, `narration.density` —
 * turned into the two derived ones. Pure arithmetic over preferences, so a
 * caller can ask what a target costs before spending a plan on it.
 */
export {
  COMFORTABLE_CPS,
  durationPlan,
  LAST_HOLD_SECONDS,
  MAX_PLAYBACK,
  MIN_SENTENCE_CHARS,
  MOTION_SHARE,
  p95CueRate,
  playbackFactor,
  playbackWarning,
  SPEAKING_STOPS,
  SPEECH_CPS,
  STOPS_PER_BEAT,
  tempoChain,
} from "./plan/duration.js";
export type { DurationPlan } from "./plan/duration.js";

/* ----------------------------------------------------------------- narrate */

/**
 * Text-to-speech over a storyboard. Needs the `edge-tts` binary on PATH, which
 * is why it is a separate call and not a `buildDeck` option.
 */
export { narrate } from "./narrate/narrate.js";
export type { NarrateOpts } from "./narrate/narrate.js";
export { narratableLangs, pickVoice } from "./narrate/voices.js";
/**
 * The synthesiser, behind an interface.
 *
 * edge-tts is an unofficial client of Edge's Read Aloud endpoint — no terms, no
 * SLA, and a signed-token scheme that has broken clients before. So it is one
 * implementation of `SpeechProvider` rather than the shape of the code: hand
 * `synthesize` a provider and nothing else here knows the difference. Register
 * a new one in `PROVIDERS`, or select at runtime with DECKSMITH_TTS.
 */
export {
  edgeProvider,
  parseCues,
  PROVIDERS,
  resolveProvider,
  synthesize,
} from "./narrate/tts.js";
export type {
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  SynthOpts,
} from "./narrate/tts.js";

/* -------------------------------------------------------------------- emit */

/**
 * The pure core: storyboard + source + format → HTML strings, no I/O. Exported
 * beneath `buildDeck` for callers that write to something other than a
 * filesystem — object storage, a response body, a test.
 */
export { DECK_PAGE, emitComposition, emitDeck, planCut, PLAYER_FILE } from "./emit/composition.js";
export type { Deck, DeckNarration, DeckOptions } from "./emit/composition.js";

/**
 * Which beats a format keeps and why the rest went. `emitDeck` returns one on
 * every build; `planCut` answers the same question without emitting a deck, for
 * a caller costing a cut before committing to it. `selectBeats` is the rule
 * itself, exported so it can be run against a budget no `Format` states.
 */
export { selectBeats } from "./plan/select.js";
export type { Cut, Dangling, Dropped, DropRule, SelectionBudget } from "./plan/select.js";

/** Themes are a named, closed set; a consumer needs to enumerate and validate. */
export { resolveTheme, THEME_NAMES, THEMES } from "./emit/themes/index.js";
export type { DeckTheme } from "./emit/themes/index.js";

/* ------------------------------------------------------------------ verify */

/**
 * The gates. `verify` is ours plus HyperFrames'; `check` is HyperFrames' alone
 * and needs its CLI. A build that never opens a browser can still run `verify`
 * for the determinism and narration scans, which are pure string work.
 */
export { verify } from "./verify/index.js";

/**
 * The storyboard advisory `plan` prints and `verify` folds in: a headline that
 * recites the visual's own labels as a list. Exported because it is pure over a
 * storyboard — no browser, no built deck — so a caller can run it on a plan
 * before spending anything on it, which is the only moment it is worth acting on.
 */
export { scanHeadlines, scanNarrationLead, scanRepeatedObject } from "./verify/index.js";
export { check, parseCheckReport } from "./verify/check.js";
export type { CheckOptions } from "./verify/check.js";

/**
 * The determinism gate: render the deck twice and compare. Separate from
 * `verify` because it costs two full renders — minutes, not milliseconds — so
 * it is a thing you schedule, not a thing you run on a request path. `identical`
 * is only honest on an image-free deck with no camera; see
 * `demo/fixtures/plain.storyboard.json` and .planning/EXPERIMENT-006.
 */
export { drift, FLOOR_DB } from "./verify/index.js";
export type { DriftMode, DriftOptions, DriftReport } from "./verify/index.js";

/* ------------------------------------------------------------------ render */

/**
 * Deck directory in, mp4 out. Needs Chrome and ffmpeg, so — like `verify` —
 * this is the batch half of the library, not the request path. `planTiming` and
 * `framePlan` are exported beside it because they are pure arithmetic: a caller
 * sizing a job, or costing a render before paying for it, wants the frame count
 * without spawning anything.
 */
export { render } from "./render/render.js";
export type { RenderOptions, RenderResult, SubtitleMode } from "./render/render.js";
export { framePlan, planTiming, TIMING_FILE, toSrt } from "./render/timing.js";
export type { FramePlan, Timing, TimingInput, TimedScene, TimedSegment } from "./render/timing.js";

/* -------------------------------------------------------------- pack/unpack */

/** The .deck container. Read and write, because a server does both. */
export { openPack, readPack, writePack } from "./pack/pack.js";
export type { Pack, PackFiles } from "./pack/pack.js";
export { mediaSummary, planMedia } from "./pack/media.js";
export type { AssetRequest, Fetcher, Media, MediaPlan } from "./pack/media.js";

/* -------------------------------------------------------------- preferences */

/**
 * `decksmith.config.json` and its defaults. `prefsFromFlags` is deliberately
 * NOT here — it translates commander's flag object, which is the CLI's problem.
 */
export { CONFIG_FILE, loadPrefs } from "./prefs.js";
export type { Prefs, PrefsPatch } from "./prefs.js";

/* ------------------------------------------------------------------- types */

/**
 * Every schema and type. Unusually broad for this file, and justified: `types.ts`
 * is nothing but the wire format — what `source.json`, `storyboard.json`,
 * `narration.json` and `.deck` already are on disk. It is a published contract
 * whether or not this file re-exports it, so hiding half of it would only make
 * consumers restate the halves they need.
 */
export * from "./types.js";

/* ------------------------------------------------------------------- build */

/** Where the emitted deck's parts came from and where they went. */
export interface BuildResult {
  /** Absolute path of the directory written. */
  out: string;
  /** `deck.html` was written — true for navigable formats only. */
  navigable: boolean;
  /** Every path written, absolute, for a caller that wants to upload them. */
  files: string[];
  /**
   * Which beats were drawn and why the rest were not.
   *
   * A caller with no terminal — a server, a queue worker — gets the same answer
   * `build` prints, because "the short came out three minutes" is not a useful
   * thing to learn without "and here is what it cost".
   */
  cut: Cut;
}

export interface BuildDeckOptions {
  /**
   * Called when one beat cannot be drawn, instead of failing the whole build.
   * Absent, the emitter's error propagates — see `DeckOptions.onBeatError`.
   */
  onBeatError?: (beatId: string, err: Error) => void;
  /** Any name in `THEME_NAMES`. Overrides `storyboard.theme`. */
  theme?: string;
  /** Multiplies every duration and hold. 1 leaves the bytes untouched. */
  speed?: number;
  /** Default `FORMATS["deck-16x9"]`. */
  format?: Format;
  /** From `narrate`. `dir` is where the mp3s sit relative to `deck.html`. */
  narration?: DeckNarration;
  /** Directory holding those mp3s now; they are copied into the deck. */
  audioFrom?: string;
  /** Directory whose `assets/` is copied in. Defaults to `out`'s neighbours. */
  assetsFrom?: string;
  /** Progress lines. Silent by default: a library that prints is a library you
   *  cannot run inside a request handler. */
  onStep?: (message: string) => void;
}

/**
 * The `build` verb, minus argv: emit the deck and write everything it needs to
 * open with no network — the composition, the navigable page, the player, the
 * KaTeX CSS and fonts, the source's assets, the narration audio, and a refreshed
 * font subset.
 *
 * It does NOT run the gates. `verify` needs the HyperFrames CLI and a browser,
 * which a caller may not have and may not want on the request path; call it
 * yourself when you do.
 *
 * NOTE: this is the same sequence as `build` in src/cli.ts, written out a second
 * time rather than shared, because that file is owned elsewhere this pass. The
 * next person to touch cli.ts should delete its copy and call this — two
 * implementations of "what a deck directory contains" is exactly the kind of
 * drift that ends in a deck that opens locally and 404s in production.
 */
export async function buildDeck(
  storyboard: Storyboard,
  source: Source,
  outDir: string,
  opts: BuildDeckOptions = {},
): Promise<BuildResult> {
  const format = opts.format ?? FORMATS["deck-16x9"];
  if (!format) throw new Error("no deck-16x9 format"); // noUncheckedIndexedAccess
  const step = opts.onStep ?? (() => {});
  const out = resolve(outDir);
  await mkdir(out, { recursive: true });

  // Resolved once and handed to both the emitter and `planTiming`. They must
  // agree exactly — the manifest indexes audio by holds the emitter scaled, so a
  // default applied in one place and not the other puts every sentence off its
  // reveal by the ratio. `emitComposition` also defaults to 1; this states it.
  const speed = opts.speed ?? 1;

  const deck = emitDeck(storyboard, source, format, await deckRuntime(), {
    speed,
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.narration ? { narration: opts.narration } : {}),
    ...(opts.onBeatError ? { onBeatError: opts.onBeatError } : {}),
  });

  const files: string[] = [];
  const write = async (name: string, text: string) => {
    await writeFile(join(out, name), text);
    files.push(join(out, name));
  };

  await write("index.html", deck.composition);
  await write("hyperframes.json", HYPERFRAMES_JSON);

  // `render` reads this and refuses without it, so a library caller who skipped
  // it got "timing.json is missing, rebuild the deck" — advice that could never
  // work, because rebuilding through `buildDeck` never wrote one. The CLI has
  // always written it; this is the same call with the same failure policy.
  //
  // A failure here does NOT fail the build, for the reason `build` gives: a deck
  // that presents perfectly well can still be one narration cannot be placed on.
  // Say so, write nothing, and let `render` refuse rather than guess.
  if (opts.narration) {
    try {
      const timing = planTiming({
        storyboard,
        source,
        format,
        composition: deck.composition,
        // What was drawn, not what the threshold would have kept: a budgeted
        // format cuts to its own length as well, and the two lists differ.
        beats: deck.cut.kept,
        narration: opts.narration,
        speed,
        ...(opts.theme ? { theme: opts.theme } : {}),
      });
      await write(TIMING_FILE, `${JSON.stringify(timing, null, 2)}\n`);
      step(`build: timing for ${timing.segments.length} narration segment(s)`);
    } catch (err) {
      step(
        `build: cannot place narration on this deck, so no ${TIMING_FILE} was written and \`render\` will refuse. ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (deck.page) {
    await write(DECK_PAGE, deck.page);
    await cp(playerBundle(), join(out, PLAYER_FILE));
    files.push(join(out, PLAYER_FILE));
  }
  files.push(...(await vendorKatex(out)));
  if (opts.assetsFrom) files.push(...(await copyAssets(opts.assetsFrom, out)));
  if (opts.narration && opts.audioFrom) {
    files.push(...(await copyAudio(opts.audioFrom, opts.narration, out)));
  }
  await refreshFont(storyboard, source, out, step);

  // What was DRAWN, not what was offered. This said `storyboard.beats.length`,
  // which is the same number only while nothing is cut — it overstated any deck
  // built at a format with a weight floor, and now overstates any deck a budget
  // trimmed as well. A build log that overstates what it emitted is the one
  // place a silent cut would hide.
  const of =
    deck.cut.kept.length === storyboard.beats.length ? "" : ` of ${storyboard.beats.length}`;
  step(
    `build: ${deck.cut.kept.length}${of} beats at ${format.width}×${format.height} → ${join(out, "index.html")}`,
  );
  for (const d of deck.cut.dropped) step(`build:   cut ${d.beat.id} — ${d.reason}`);
  for (const d of deck.cut.dangling) step(`build:   check the wording — ${d.reason}`);
  return { out, navigable: Boolean(deck.page), files, cut: deck.cut };
}

/* ------------------------------------------------------------ build's parts */

/** Enough for `hyperframes check` to recognise a project and find the assets. */
const HYPERFRAMES_JSON = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: { assets: "assets" },
  },
  null,
  2,
)}\n`;

/**
 * The step layer, read from our own build output — `dist/index.js` and
 * `dist/deck-runtime.js` are siblings, exactly as `dist/cli.js` and it are.
 * Reading it rather than bundling it keeps the emitter a pure function of its
 * arguments, and keeps one copy of the runtime in the package instead of three.
 */
async function deckRuntime(): Promise<string> {
  const path = fileURLToPath(new URL(`./${"deck-runtime.js"}`, import.meta.url));
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Error(`Deck runtime missing at ${path}. Run "npm run build" first.`);
  }
}

/** The player ships inside hyperframes, so a built deck needs no CDN to navigate. */
function playerBundle(): string {
  const require = createRequire(import.meta.url);
  try {
    return join(dirname(require.resolve("hyperframes/package.json")), "dist", PLAYER_FILE);
  } catch {
    throw new Error('Cannot locate the hyperframes player. Run "npm install".');
  }
}

/**
 * Vendor KaTeX's stylesheet and woff2 fonts beside the deck. The HyperFrames
 * compiler inlines `<script src>` but not `<link rel=stylesheet>`, so a
 * CDN-linked stylesheet is fetched — with its fonts — during capture, which
 * both breaks "no network at render time" and makes equation decks
 * nondeterministic. See the long note in src/cli.ts for how that was cornered.
 */
async function vendorKatex(out: string): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const dist = join(dirname(require.resolve("katex/package.json")), "dist");
  const css = await readFile(join(dist, "katex.min.css"), "utf8");

  const written: string[] = [];
  await mkdir(join(out, "katex/fonts"), { recursive: true });
  for (const file of await readdir(join(dist, "fonts"))) {
    if (!file.endsWith(".woff2")) continue;
    await cp(join(dist, "fonts", file), join(out, "katex/fonts", file));
    written.push(join(out, "katex/fonts", file));
  }
  // Each src is a comma-separated list; keep the woff2 entry and drop the rest,
  // so nothing requests a file we did not copy.
  const woff2Only = css.replace(/src:([^;}]*)/g, (whole, list: string) => {
    const kept = list
      .split(",")
      .filter((part) => part.includes(".woff2"))
      .join(",");
    return kept ? `src:${kept}` : whole;
  });
  await writeFile(join(out, "katex/katex.min.css"), woff2Only);
  written.push(join(out, "katex/katex.min.css"));
  return written;
}

/** `assets/` beside source.json, if there is one. Absent is the ordinary case. */
async function copyAssets(sourceDir: string, out: string): Promise<string[]> {
  const from = join(resolve(sourceDir), "assets");
  if (!(await stat(from).catch(() => null))) return [];
  await cp(from, join(out, "assets"), { recursive: true });
  return [join(out, "assets")];
}

/** Only the mp3s the island names: an audio directory accumulates every take. */
async function copyAudio(from: string, narration: DeckNarration, out: string): Promise<string[]> {
  const dir = join(out, narration.dir);
  await mkdir(dir, { recursive: true });
  const names = [
    ...new Set(
      Object.values(narration.beats)
        .flat()
        .map((s) => s.audio),
    ),
  ].sort();
  for (const name of names) {
    await cp(join(resolve(from), name), join(dir, name)).catch(() => {
      throw new Error(`Narration names ${name}, but it is not in ${from}. Re-run \`narrate\`.`);
    });
  }
  return names.map((n) => join(dir, n));
}

/**
 * The planner writes headlines the source never contained, so the subset
 * `ingest` cut can be missing glyphs — and a missing glyph falls back silently,
 * which is the failure invariant 9 exists to prevent. Re-cut over the text the
 * deck really renders. Content-hashed, so a no-op when nothing new appeared.
 */
async function refreshFont(
  storyboard: Storyboard,
  source: Source,
  out: string,
  step: (m: string) => void,
): Promise<void> {
  try {
    const bundle = await bundleFont(
      storyboard.lang,
      JSON.stringify(source) + JSON.stringify(storyboard),
      join(out, "assets", "fonts"),
    );
    if (bundle) step(`build: font bundle covers ${bundle.family}`);
  } catch (err) {
    step(
      `build: could not refresh the font bundle (${err instanceof Error ? err.message : err}); keeping the one from ingest`,
    );
  }
}

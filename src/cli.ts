/**
 * Seven verbs, one pipeline: ingest → plan → narrate → build → verify, with
 * pack/unpack hanging off the side as the container the user actually keeps.
 *
 * `plan` deliberately stops and writes a file rather than flowing into `build`.
 * The storyboard is the human checkpoint — fixing a plan is cheap, fixing twelve
 * realized slides is not (INITIAL_DESIGN §2) — so there is no `decksmith run`
 * that quietly skips it. `narrate` is separate for the same reason plus one
 * more: it is the only verb that needs the network, and a build that silently
 * required it would be a build you cannot run on a plane.
 *
 * Progress goes to stderr, findings go to stdout, and nothing ever prints a
 * stack trace: a failure here is a bad document or a bad path, not a bug the
 * user can read.
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { z } from "zod";
import { DECK_PAGE, type DeckNarration, emitDeck, PLAYER_FILE } from "./emit/composition.js";
import { THEME_NAMES } from "./emit/theme.js";
import { narrate } from "./narrate/narrate.js";
import { type AssetRequest, mediaSummary, planMedia } from "./pack/media.js";
import { type Pack, type PackFiles, readPack, writePack } from "./pack/pack.js";
import { codexPlanner } from "./plan/codex.js";
import { durationPlan } from "./plan/duration.js";
import { assertInsideResolves, assertRefsResolve } from "./plan/refs.js";
import type { Cut } from "./plan/select.js";
import { loadPrefs, type PrefFlags, type Prefs, prefsFromFlags } from "./prefs.js";
import { render, type SubtitleMode } from "./render/render.js";
import { planTiming, TIMING_FILE } from "./render/timing.js";
import { fetchFigures } from "./source/assets.js";
import { bundleFont } from "./source/fonts.js";
import { parseMarkdown } from "./source/markdown.js";
import {
  type Beat,
  canvasWarnings,
  FORMATS,
  type Format,
  MAX_EDGE,
  MIN_EDGE,
  narrationSchema,
  PACK_VERSION,
  prefsSchema,
  resizeFormat,
  type Source,
  type Storyboard,
  sourceSchema,
  storyboardSchema,
  type Verdict,
} from "./types.js";
import { drift, FLOOR_DB, scanHeadlines, scanRepeatedObject, verify } from "./verify/index.js";

type Narration = z.infer<typeof narrationSchema>;

/**
 * Where a narrated deck keeps its voice, in the built deck and inside a pack
 * alike. One name in one place: the emitter writes it into the island, `build`
 * copies into it, `pack` stores under it, and `unpack` restores it — and none of
 * them has to agree with the others by memory.
 */
const AUDIO_DIR = "audio";
const NARRATION_FILE = "narration.json";

/** What `prefsSchema` says when nobody has said anything. See `stated`. */
const DEFAULTS: Prefs = prefsSchema.parse({});

/**
 * The step layer, read from our own build output — `dist/cli.js` and
 * `dist/deck-runtime.js` are siblings. Reading it at build time rather than
 * bundling it into the CLI keeps the emitter a pure function of its arguments.
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
 * Vendor KaTeX's stylesheet and fonts beside the deck.
 *
 * The HyperFrames compiler inlines `<script src>` but NOT `<link rel=stylesheet>`,
 * so a CDN-linked `katex.min.css` — and every `@font-face` it points at — was
 * being fetched by the capture browser on every render. Two consequences, both
 * bad: it violates "no network at render time", and it made equation decks
 * nondeterministic in a way that took four experiments to corner. The frame that
 * finally showed it differed by exactly one glyph, the caligraphic W of
 * `\mathcal{W}`, present in one render and not the other — a font that had
 * arrived by that frame on one run and not on the next.
 *
 * Only woff2 is copied. KaTeX ships woff2, woff and ttf of every family; every
 * browser this deck will ever open in reads woff2, and the other two are three
 * quarters of the payload. The rewrite drops their `url(...)` entries so nothing
 * requests a file that is not there.
 */
async function vendorKatex(out: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const dist = join(dirname(require.resolve("katex/package.json")), "dist");
  const css = await readFile(join(dist, "katex.min.css"), "utf8");

  await mkdir(join(out, "katex/fonts"), { recursive: true });
  for (const file of await readdir(join(dist, "fonts"))) {
    if (file.endsWith(".woff2"))
      await cp(join(dist, "fonts", file), join(out, "katex/fonts", file));
  }
  // Each src is a comma-separated list; keep the woff2 entry and drop the rest.
  const woff2Only = css.replace(/src:([^;}]*)/g, (whole, list: string) => {
    const kept = list
      .split(",")
      .filter((part) => part.includes(".woff2"))
      .join(",");
    return kept ? `src:${kept}` : whole;
  });
  await writeFile(join(out, "katex/katex.min.css"), woff2Only);
}

/**
 * The two scripts a deck runs, copied beside it.
 *
 * Pinned by package.json rather than by a URL, so the version that renders is
 * the version that was installed and tested. See the note on GSAP_SRC in
 * src/emit/composition.ts for why this is not left to the compiler's inliner.
 */
async function vendorScripts(out: string): Promise<void> {
  const require = createRequire(import.meta.url);
  await mkdir(join(out, "vendor"), { recursive: true });
  for (const [pkg, rel, name] of [
    ["gsap/package.json", "dist/gsap.min.js", "gsap.min.js"],
    ["katex/package.json", "dist/katex.min.js", "katex.min.js"],
  ] as const) {
    const from = join(dirname(require.resolve(pkg)), rel);
    await cp(from, join(out, "vendor", name));
  }
}

/** Enough for `hyperframes check` to recognise a project and find the assets. */
const HYPERFRAMES_JSON = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: { assets: "assets" },
  },
  null,
  2,
)}\n`;

/* --------------------------------------------------------------- preferences */

/**
 * Flags that change what is *said*. On `plan`, and on `pack` because a pack
 * records the preferences the deck was made under.
 */
function planFlags(cmd: Command): Command {
  return cmd
    .option("--lang <bcp47>", "language of the deck's copy")
    .option("--tone <tone>", "plain | academic | conversational | punchy")
    .option("--density <level>", "sparse | normal | dense");
}

/**
 * The three knobs that decide how LONG it is, and its own group because they are
 * the only ones every one of `plan`, `narrate` and `build` needs.
 *
 * All THREE are here, because the length budget is spent in three places: the
 * planner writes to a character count, `narrate` decides which stops speak and at
 * what rate, and `build` derives the animation speed. A flag missing from one of
 * those is a deck whose three stages disagree about how long it is.
 *
 * `--slides` used to sit in `planFlags` alone, and that is exactly the failure the
 * paragraph above describes: every one of those three numbers is derived from
 * `duration / slides`, so a deck planned at five slides and narrated without the
 * flag was SPOKEN at the twelve-slide rate — a different voice from the one its
 * own budget was written for. Nothing reported it.
 *
 * What is NOT here: words per sentence, and narration or animation speed. Those
 * are derived — see `durationPlan`. Exposing them as well would only be a way to
 * disagree with the target.
 */
function lengthFlags(cmd: Command): Command {
  return cmd
    .option("--duration <s>", "target length of the finished video, in seconds (10–1800)")
    .option("--slides <n>", "target beat count (3–40)")
    .option(
      "--narration-density <level>",
      "how many stops speak: high (every reveal) | medium (two a beat) | low (one a beat)",
    );
}

/** Flags that change how it *looks*. */
function lookFlags(cmd: Command): Command {
  return cmd
    .option("--theme <name>", `palette: ${THEME_NAMES.join(" | ")}`)
    .option("--speed <x>", "multiply every animation duration (0.25–3)");
}

/** Flags that change how it *sounds*. */
function voiceFlags(cmd: Command): Command {
  return cmd
    .option("--voice <id>", "edge-tts voice id, e.g. en-US-AvaMultilingualNeural")
    .option("--rate <r>", 'speech rate, e.g. "+10%"')
    .option("--pitch <p>", 'speech pitch, e.g. "-5Hz"')
    .option("--no-subtitles", "synthesise audio without subtitle cues");
}

/**
 * Commander gives a plain `--flag` `undefined` until it is passed, which is
 * exactly the "unstated" that `prefsFromFlags` needs — except for `--no-x`,
 * which defaults to `true` and would therefore outrank the config file on every
 * run. So the negation is read as a negation and nothing else.
 */
function flags(o: Record<string, unknown>): PrefFlags {
  const patch: PrefFlags = {};
  for (const key of [
    "slides",
    "lang",
    "tone",
    "density",
    "duration",
    "narrationDensity",
    "theme",
    "speed",
    "voice",
    "rate",
    "pitch",
  ] as const) {
    const value = o[key];
    if (value !== undefined) patch[key] = value as string;
  }
  if (o.subtitles === false) patch.subtitles = false;
  return patch;
}

/**
 * Whether anyone actually chose this preference.
 *
 * `loadPrefs` returns a fully-populated object, so a field sitting at its schema
 * default is indistinguishable from one nobody mentioned — which is the right
 * answer here: a stored artifact (the storyboard's theme, the source's language)
 * should win over a default, and lose to anything a person typed.
 */
function stated<K extends keyof Prefs>(prefs: Prefs, key: K): Prefs[K] | undefined {
  return prefs[key] === DEFAULTS[key] ? undefined : prefs[key];
}

/* -------------------------------------------------------------------- verbs */

const program = new Command();
program
  .name("decksmith")
  .description("Turn a source document into an animated explanation deck.")
  .version("0.1.0");

program
  .command("ingest")
  .description("Parse a document into source.json, localising its figures and font.")
  .argument("<input>", "source document (markdown)")
  .requiredOption("-o, --out <file>", "where to write source.json")
  .option("--lang <bcp47>", "override the sniffed language")
  .action(async (input: string, o: { out: string; lang?: string }) => {
    const md = await readFile(resolve(input), "utf8").catch(() => {
      throw new Error(`Cannot read ${input}.`);
    });
    const parsed = parseMarkdown(md, { lang: o.lang });
    const assets = join(dirname(resolve(o.out)), "assets");

    step(
      `ingest: ${parsed.sections.length} sections, ${parsed.figures.length} figures, ${parsed.equations.length} equations`,
    );
    const source = await fetchFigures(parsed, assets);
    const bundle = await bundleFont(source.lang, glyphs(source), join(assets, "fonts"));
    if (bundle) step(`ingest: bundled ${bundle.family} for ${source.lang}`);

    await writeJson(o.out, source);
    step(`ingest: wrote ${o.out}`);
  });

lookFlags(
  planFlags(
    lengthFlags(program.command("plan"))
      .description("Ask Codex for a storyboard. Read and edit the result before building.")
      .argument("<source>", "source.json from ingest")
      .requiredOption("-o, --out <file>", "where to write storyboard.json"),
  ),
).action(async (src: string, o: { out: string } & Record<string, unknown>) => {
  const source = await readValidated(src, sourceSchema, "source");
  // Nobody naming a language means "the one the document is in" — the planner is
  // being asked to explain this source, not to translate it by accident.
  const chosen = await loadPrefs(prefsFromFlags(flags(o)));
  const prefs: Prefs = stated(chosen, "lang") ? chosen : { ...chosen, lang: source.lang };

  step(`plan: asking Codex for ~${prefs.slides} ${prefs.tone} beats in ${prefs.lang}`);
  step("plan: this takes a few minutes");
  const planned = await codexPlanner(source, { prefs });
  const storyboard: Storyboard = {
    ...planned,
    lang: prefs.lang,
    theme: stated(prefs, "theme") ?? planned.theme,
  };
  assertRefsResolve(storyboard, source);
  assertInsideResolves(storyboard, source);
  await writeJson(o.out, storyboard);
  step(`plan: ${storyboard.beats.length} beats → ${o.out}`);
  // Said HERE, not only at `verify`, because this is the moment the advice below
  // is about: the headline is one string in a file the author is being told to
  // open, and fixing it costs a keystroke now against a rebuild later.
  for (const f of [...scanHeadlines(storyboard), ...scanRepeatedObject(storyboard)])
    step(`plan:   ${f.message}`);

  // THE SCRIPT, END TO END, WITH THE SLIDE BOUNDARIES TAKEN OUT.
  //
  // Every defect this narration has had was invisible in the file and obvious the
  // moment the lines were read in a row. Twelve fields each holding a true
  // sentence look fine one at a time; joined, they were twelve captions that did
  // not know the others existed, and it took the owner watching an mp4 to say so.
  //
  // No gate can see this. A cohesion score was built and then defeated in one
  // edit — prefixing a discourse marker to each of the twelve rejected sentences,
  // changing no content, moved it from 42% to 92%, above the hand-written demo.
  // So the check is the thing that has actually worked six times in this project:
  // a human looking at the artifact. Printing it costs three lines and is the
  // only moment before a render when the fix is still one keystroke.
  const script = storyboard.beats
    .map((b) => b.narration?.trim())
    .filter(Boolean)
    .join(" ");
  if (script) {
    step("plan: the narration, read as one script —");
    for (const line of wrapScript(script, 76)) step(`plan:   ${line}`);
  }
  step("plan: read it and edit it before building. This is where the quality is won.");
});

voiceFlags(
  sizeFlags(
    lengthFlags(program.command("narrate"))
      .description("Speak every beat with edge-tts, one segment per stop. Needs the network.")
      .argument("<storyboard>", "storyboard.json")
      .requiredOption("--source <file>", "source.json the storyboard was planned from")
      .requiredOption("-o, --out <dir>", `directory for the audio and ${NARRATION_FILE}`)
      .option("--format <id>", "staging profile — it decides the stop count", "deck-16x9"),
  ),
).action(async (sbPath: string, o: { source: string; out: string } & Record<string, unknown>) => {
  const storyboard = await readValidated(sbPath, storyboardSchema, "storyboard");
  const source = await readValidated(String(o.source), sourceSchema, "source");
  // The canvas decides how a beat stages, and staging decides how many sentences
  // are spoken. Narrating at one size and building at another puts a sentence on
  // a reveal that is not there — so `narrate` takes the same two flags `build`
  // does, and the two invocations must be given the same ones.
  const format = pickFormat(String(o.format), o.width as string, o.height as string);
  const chosen = await loadPrefs(prefsFromFlags(flags(o)));
  // The words already exist and are in the storyboard's language; asking for a
  // voice in another one would read them with the wrong mouth.
  const prefs: Prefs = stated(chosen, "lang") ? chosen : { ...chosen, lang: storyboard.lang };

  const dir = resolve(String(o.out));
  const speaking = storyboard.beats.filter((b) => b.narration?.trim()).length;
  if (speaking === 0) {
    throw new Error(`No beat in ${sbPath} has a "narration" field, so there is nothing to speak.`);
  }
  step(`narrate: ${speaking} of ${storyboard.beats.length} beats have narration`);

  const narration = await narrate(storyboard, source, prefs, { dir, format });
  await writeJson(join(dir, NARRATION_FILE), narration);

  const segments = Object.values(narration.beats).flat();
  const seconds = segments.reduce((sum, s) => sum + s.seconds, 0);
  step(
    `narrate: ${segments.length} segments, ${seconds.toFixed(1)}s in ${narration.voice} → ${join(dir, NARRATION_FILE)}`,
  );
});

lookFlags(
  sizeFlags(
    lengthFlags(program.command("build"))
      .description("Emit the composition, write its assets, and run the gates.")
      .argument("<storyboard>", "storyboard.json, edited to taste")
      .requiredOption("--source <file>", "source.json the storyboard was planned from")
      .requiredOption("-o, --out <dir>", "directory to write the deck into")
      .option("--format <id>", `output profile: ${Object.keys(FORMATS).join(" | ")}`, "deck-16x9")
      .option("--min-weight <n>", "keep only beats at or above this weight — see the budget gate")
      .option("--narration <file>", `${NARRATION_FILE} from \`decksmith narrate\``)
      .option("--no-narration", "ignore narration sitting beside the storyboard")
      .option("--no-fidelity", "skip the frame check — only for a machine with no browser"),
  ),
).action(
  async (
    sbPath: string,
    o: {
      source: string;
      out: string;
      format: string;
      minWeight?: string;
      width?: string;
      height?: string;
    } & Record<string, unknown>,
  ) => {
    const storyboard = await readValidated(sbPath, storyboardSchema, "storyboard");
    const source = await readValidated(o.source, sourceSchema, "source");
    assertRefsResolve(storyboard, source);

    // `--min-weight` raises the FLOOR for this one invocation. It is still the
    // author's editorial knob — which beats are worth keeping in a shorter cut is
    // a call about THIS deck, not a property of the canvas — so it lives on the
    // invocation rather than in `FORMATS`, and `planCut` applies it first and
    // reports its casualties separately from the budget's.
    //
    // It is no longer the ONLY instrument. A format also carries a length
    // (`DESTINATIONS`), and `planCut` now fits the deck to it, so `build
    // --format short-9x16` produces a postable short with no flag at all. The
    // flag remains an override in the honest sense: a floor the budget cannot
    // lower, and the way to say "I know which beats I want gone" rather than
    // letting the optimiser choose. `format` is passed to both `emitDeck` and
    // `writeTiming`, so overriding it here keeps the two cuts in step.
    //
    // `--width/--height` resize whichever profile was named, and nothing else:
    // the floor, the budget and the navigability stay the base's, because a
    // pixel count implies none of them. See `resizeFormat`.
    const format = withMinWeight(pickFormat(o.format, o.width, o.height), o.minWeight);
    const prefs = await loadPrefs(prefsFromFlags(flags(o)));
    // The storyboard records the theme it was planned under; `--theme` or a
    // config file restates it. Language is not overridable here — it describes
    // the copy that is already written, not a wish.
    const theme = stated(prefs, "theme") ?? storyboard.theme;

    const out = resolve(o.out);
    await mkdir(out, { recursive: true });

    const found = await findNarration(sbPath, o.narration);
    const narration = found ? await loadNarration(found) : undefined;
    if (narration && !format.navigable) {
      step(`build: ${format.id} renders linearly, so its narration is timing only`);
    }

    // The pace the DURATION target implies, which is `prefs.animationSpeed`
    // itself when no target was asked for — so a deck built without one is
    // byte-for-byte the deck it was before this existed. Resolved once and used
    // by both the emitter and the timing manifest: the manifest indexes audio by
    // holds the emitter scaled, and two answers here put every sentence off its
    // reveal by the ratio.
    const paced = durationPlan(prefs);
    for (const w of paced.warnings) step(`build: ${w}`);

    const deck = emitDeck(storyboard, source, format, await deckRuntime(), {
      theme,
      speed: paced.speed,
      ...(narration ? { narration } : {}),
    });
    await writeFile(join(out, "index.html"), deck.composition);
    await writeFile(join(out, "hyperframes.json"), HYPERFRAMES_JSON);
    await writeTiming(out, {
      storyboard,
      source,
      format,
      theme,
      speed: paced.speed,
      composition: deck.composition,
      // The beats the composition actually drew, not the rule that chose them.
      // `planTiming` used to re-derive the list with the flat threshold; once the
      // budget can cut as well, a second derivation is a second answer, and this
      // one indexes audio by scene.
      beats: deck.cut.kept,
      ...(narration ? { narration } : {}),
    });
    if (deck.page) {
      await writeFile(join(out, DECK_PAGE), deck.page);
      await cp(playerBundle(), join(out, PLAYER_FILE));
    }
    await vendorKatex(out);
    await vendorScripts(out);
    await copyAssets(dirname(resolve(o.source)), out, source.figures);
    if (found && narration) await copyAudio(dirname(found), narration, out);
    await refreshFont(storyboard, source, out);

    const look = [theme, paced.speed === 1 ? "" : `${paced.speed}× speed`]
      .filter(Boolean)
      .join(", ");
    // Count what was drawn, not what was offered: below the format's minWeight a
    // beat is filtered out of both artifacts, and reporting the storyboard's
    // length would announce twelve beats over an eight-beat deck.
    const { cut } = deck;
    const floor = cut.dropped.filter((d) => d.rule === "below_min_weight").length;
    const of = cut.kept.length === storyboard.beats.length ? "" : ` of ${storyboard.beats.length}`;
    step(
      `build: ${cut.kept.length}${of} beats at ${format.width}×${format.height} in ${look}${floor > 0 ? ` (${floor} below minWeight ${format.minWeight})` : ""} → ${join(out, "index.html")}`,
    );
    // THE CUT, SAID OUT LOUD. A budget that trims quietly is the failure the old
    // budget gate refused to become: the deck comes out PASS with a third of its
    // explanation gone and nothing anywhere says which third. `selectBeats`
    // writes a sentence per casualty naming what it cost, what it was worth, and
    // what the deck still has of its kind — those sentences are the whole reason
    // this may trim at all, so they are printed on every build that trims, not
    // buried in a return value or deferred to a gate that may not run.
    reportCut(cut);
    if (deck.page) step(`build: navigable deck → ${join(out, DECK_PAGE)}`);

    await gate(out, false, storyboard, cut.kept, o.fidelity !== false);
  },
);

program
  .command("verify")
  .description("Re-run the gates on a built deck.")
  .argument("<dir>", "a built deck directory")
  .option("--snapshots", "also write the contrast-pass PNGs to <dir>/snapshots", false)
  .option("--no-fidelity", "skip the frame check — only for a machine with no browser")
  .action(async (dir: string, o: { snapshots: boolean; fidelity: boolean }) => {
    await gate(resolve(dir), o.snapshots, undefined, undefined, o.fidelity !== false);
  });

program
  .command("drift")
  .description("Render a built deck twice and compare, frame by frame. Minutes, not seconds.")
  .argument("<dir>", "a built deck directory")
  .option("--identical", "require every frame byte-identical — image-free decks only", false)
  .option("--floor <dB>", "per-frame PSNR floor", String(FLOOR_DB))
  .option("--keep", "keep both frame directories even when they agree")
  // Pinning both passes to one count is how you tell a real order dependence
  // from this deck's own rasteriser noise: the gate varies the count on purpose,
  // so the control has to be able to hold it still.
  .option("--workers <n>", "pin both renders to one worker count (default: 1 vs 3)")
  .action(
    async (
      dir: string,
      o: { identical: boolean; floor: string; keep?: boolean; workers?: string },
    ) => {
      step("drift: rendering twice, several minutes a render");
      const verdict = await drift(resolve(dir), {
        mode: o.identical ? "identical" : "psnr",
        floorDb: Number(o.floor),
        ...(o.keep ? { keep: true } : {}),
        ...(o.workers ? { workers: Number(o.workers) } : {}),
      });
      process.stdout.write(report(verdict));
      step(
        `drift: ${verdict.identical}/${verdict.frames} frames byte-identical` +
          (verdict.worst
            ? `, worst ${verdict.worst.db.toFixed(2)} dB at frame ${verdict.worst.frame}`
            : ""),
      );
      if (verdict.kept) step(`drift: frames kept in ${verdict.kept.a} and ${verdict.kept.b}`);
      if (!verdict.passed) process.exitCode = 1;
    },
  );

program
  .command("render")
  .description("Render a built deck to a finished video: picture, narration, subtitles.")
  .argument("<dir>", "a built deck directory")
  .requiredOption("-o, --out <file>", "where to write the mp4")
  .option("--video <file>", "retime an mp4 already captured, instead of capturing again")
  .option("--fps <n>", "frame rate (default: the composition's, else 30)")
  .option("--quality <q>", "draft | standard | high")
  .option("-w, --workers <n>", "parallel capture workers, a number or auto")
  .option("--protocol-timeout <ms>", "CDP timeout handed to the renderer", "900000")
  // The default is the sidecar for EVERY format. A burned-in band cannot be
  // turned off by the person watching, and it covers the bottom of whatever the
  // slide drew there; an .srt beside the mp4 is a track every player toggles.
  // `burn` stays for the destinations that ignore sidecars — see `subtitlePlan`.
  .option(
    "--subtitles <mode>",
    "sidecar (an .srt every player can toggle) | burn (into the picture) | none",
    "sidecar",
  )
  // The one place a FINISHED video can be shortened. It is a speed-up of what
  // was already said, with the pitch preserved, and it needs no re-synthesis and
  // no rebuild — which also makes it the cheap way to try three targets on one
  // capture (`--video`) instead of three captures.
  .option("--duration <s>", "speed the finished video up to land near this many seconds")
  .option("--keep", "leave the per-piece intermediates beside the output")
  .action(
    async (
      dir: string,
      o: {
        out: string;
        video?: string;
        fps?: string;
        quality?: string;
        workers?: string;
        protocolTimeout: string;
        subtitles: SubtitleMode;
        duration?: string;
        keep?: boolean;
      },
    ) => {
      // `auto` is accepted and undocumented: it used to be the default and it
      // is in people's scripts, and it now resolves to the sidecar like
      // everything else. Rejecting it would break invocations to no purpose.
      if (!["auto", "burn", "sidecar", "none"].includes(o.subtitles)) {
        throw new Error(`Unknown --subtitles "${o.subtitles}". Use sidecar, burn or none.`);
      }
      const result = await render({
        deck: resolve(dir),
        out: resolve(o.out),
        subtitles: o.subtitles,
        protocolTimeoutMs: Number(o.protocolTimeout),
        log: step,
        ...(o.video ? { video: o.video } : {}),
        ...(o.fps ? { fps: Number(o.fps) } : {}),
        ...(o.quality ? { quality: o.quality } : {}),
        ...(o.workers ? { workers: o.workers } : {}),
        ...(o.duration ? { targetSeconds: Number(o.duration) } : {}),
        ...(o.keep ? { keep: true } : {}),
      });
      step(
        `render: ${result.frames} frames, ${result.seconds.toFixed(2)}s, ${result.segments} narration segment(s)${result.burned ? ", captions burned in" : ""} → ${result.out}`,
      );
      if (result.srt) step(`render: subtitles → ${result.srt}`);
    },
  );

voiceFlags(
  lookFlags(
    planFlags(
      lengthFlags(program.command("pack"))
        .description("Put the whole deck — source, storyboard, narration, media — in one file.")
        .argument("<storyboard>", "storyboard.json")
        .requiredOption("--source <file>", "source.json the storyboard was planned from")
        .requiredOption("-o, --out <file>", "where to write the .deck")
        .option("--bake", "copy every asset's bytes into the pack (the default)")
        .option("--link", "keep asset URLs instead of copying their bytes")
        .option("--narration <file>", `${NARRATION_FILE} to travel with the deck`)
        .option("--no-narration", "leave narration out of the pack"),
    ),
  ),
).action(async (sbPath: string, o: { source: string; out: string } & Record<string, unknown>) => {
  const storyboard = await readValidated(sbPath, storyboardSchema, "storyboard");
  const sourcePath = resolve(String(o.source));
  const source = await readValidated(sourcePath, sourceSchema, "source");
  assertRefsResolve(storyboard, source);
  if (o.bake && o.link) throw new Error("Choose --bake or --link, not both.");

  const chosen = await loadPrefs(prefsFromFlags(flags(o)));
  // A pack records what the deck actually is, so the artifacts win over a
  // default: reopening it a year later must rebuild the same deck.
  const prefs: Prefs = {
    ...chosen,
    lang: stated(chosen, "lang") ?? storyboard.lang,
    theme: stated(chosen, "theme") ?? storyboard.theme,
  };

  const found = await findNarration(sbPath, o.narration);
  const narration = found ? await loadNarration(found) : undefined;

  const prefer = o.link ? "link" : "bake";
  const plan = await planMedia(figureAssets(source, sourcePath, prefer));
  const files: PackFiles = { ...plan.files };
  if (found && narration) Object.assign(files, await audioFiles(dirname(found), narration));

  const pack: Pack = {
    version: PACK_VERSION,
    createdAt: new Date().toISOString(),
    title: storyboard.title,
    prefs: { ...prefs, narration: { ...prefs.narration, enabled: narration !== undefined } },
    source,
    storyboard,
    ...(narration ? { narration } : {}),
    media: plan.media,
  };

  const out = resolve(String(o.out));
  const bytes = await writePack(pack, files, out);
  if (plan.demoted.length) {
    step(`pack: kept as links, not bakeable — ${plan.demoted.join(", ")}`);
  }
  if (plan.promoted.length) {
    step(`pack: baked anyway, nothing to link to — ${plan.promoted.join(", ")}`);
  }
  step(
    `pack: ${mediaSummary(plan)}${narration ? `, ${Object.keys(narration.beats).length} beats narrated` : ""}`,
  );
  step(`pack: ${size(bytes)} → ${out}`);
});

program
  .command("unpack")
  .description("Open a .deck back into the files build reads.")
  .argument("<file>", "a .deck archive")
  .requiredOption("-o, --out <dir>", "directory to open it into")
  .action(async (file: string, o: { out: string }) => {
    const { pack, files } = await readPack(resolve(file));
    const out = resolve(o.out);

    await writeJson(join(out, "source.json"), pack.source);
    await writeJson(join(out, "storyboard.json"), pack.storyboard);
    await writeJson(join(out, "decksmith.config.json"), pack.prefs);
    if (pack.narration) await writeJson(join(out, AUDIO_DIR, NARRATION_FILE), pack.narration);

    // Baked figures go back where `build` looks for them — beside source.json,
    // under the name the Source already records — rather than staying at their
    // content-addressed pack path, which nothing downstream knows about.
    const figures = new Map(pack.source.figures.map((f) => [f.id, f.src]));
    for (const [path, bytes] of Object.entries(files)) {
      const media = pack.media.find((m) => m.path === path);
      const src = media && figures.get(media.id);
      const to = src ? join("assets", src) : path;
      await mkdir(dirname(join(out, to)), { recursive: true });
      await writeFile(join(out, to), bytes);
    }

    const linked = pack.media.filter((m) => m.policy !== "bake");
    step(`unpack: "${pack.title}", ${pack.storyboard.beats.length} beats → ${out}`);
    if (linked.length) {
      step(
        `unpack: ${linked.length} asset(s) travel as ${[...new Set(linked.map((m) => m.policy))].join("/")} and are fetched at view time`,
      );
    }
    step(
      `unpack: decksmith build ${join(relative(process.cwd(), out) || ".", "storyboard.json")} --source ${join(relative(process.cwd(), out) || ".", "source.json")} -o deck`,
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`decksmith: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

/* --------------------------------------------------------------------- gates */

/**
 * What the budget took, in the terminal, on the build that took it.
 *
 * Floor drops are not reported here: the author asked for those by passing
 * `--min-weight`, and the count is already in the line above. Budget drops are
 * the deck editing itself, which is a different thing entirely and has to be
 * visible without anyone going looking.
 */
function reportCut(cut: Cut): void {
  for (const d of cut.dropped) {
    if (d.rule === "below_min_weight") continue;
    step(`build:   cut ${d.beat.id} (${d.beat.archetype}, ${d.seconds.toFixed(1)}s) — ${d.reason}`);
  }
  // Not a drop and not a warning about one: a beat that stayed now cites
  // something no beat in the cut shows, and only the author can decide whether
  // that sentence still reads. Printed even when nothing was cut, because a
  // storyboard can arrive with one.
  for (const d of cut.dangling) step(`build:   check the wording — ${d.reason}`);
}

/**
 * `build` has the storyboard in hand and so gets the beat-level gates too;
 * `verify <dir>` is handed a built directory and nothing else, and skips them.
 * `kept` is the cut `build` emitted — without it the budget gate has to guess
 * which beats the scenes it is reading correspond to.
 */
async function gate(
  dir: string,
  snapshots = false,
  storyboard?: Storyboard,
  kept?: readonly Beat[],
  fidelity = true,
): Promise<void> {
  step(
    `verify: running the hyperframes gates${fidelity ? " and opening a frame at every stop" : ""}, about a minute`,
  );
  const verdict = await verify(dir, { snapshots, fidelity }, storyboard, kept);
  process.stdout.write(report(verdict));
  if (snapshots) step(`verify: snapshots in ${join(dir, "snapshots")}`);
  // Non-zero, but let the process unwind: exitCode beats process.exit() here.
  if (!verdict.passed) process.exitCode = 1;
}

function report(v: Verdict): string {
  const count = (s: string) => v.findings.filter((f) => f.severity === s).length;
  const lines = v.findings.map(
    (f) => `  ${f.severity.padEnd(7)} ${f.gate.padEnd(11)} ${f.rule}  ${f.message}`,
  );
  lines.push(
    `${v.passed ? "PASS" : "FAIL"} — ${count("error")} error(s), ${count("warning")} warning(s)`,
  );
  return `${lines.join("\n")}\n`;
}

/* ----------------------------------------------------------------- narration */

/**
 * Which `narration.json` this run should use, if any.
 *
 * An explicit `--narration` must exist — naming a file that is not there is a
 * typo, not a preference. Otherwise look beside the storyboard, `audio/` first,
 * because that is the layout `narrate -o audio` and `unpack` both produce. Not
 * finding one is the ordinary case and says nothing.
 */
async function findNarration(sbPath: string, flag: unknown): Promise<string | undefined> {
  if (flag === false) return undefined; // --no-narration
  if (typeof flag === "string") {
    const path = resolve(flag);
    if (!(await stat(path).catch(() => null))) throw new Error(`Cannot read narration ${flag}.`);
    return path;
  }
  const beside = dirname(resolve(sbPath));
  for (const candidate of [join(beside, AUDIO_DIR, NARRATION_FILE), join(beside, NARRATION_FILE)]) {
    if (await stat(candidate).catch(() => null)) {
      step(`narration: using ${candidate}`);
      return candidate;
    }
  }
  return undefined;
}

async function loadNarration(path: string): Promise<DeckNarration> {
  const narration = await readValidated(path, narrationSchema, "narration");
  return { voice: narration.voice, dir: AUDIO_DIR, beats: narration.beats };
}

/** Every distinct mp3 the narration names, deduplicated — segments share files. */
function audioNames(narration: Narration | DeckNarration): string[] {
  return [
    ...new Set(
      Object.values(narration.beats)
        .flat()
        .map((s) => s.audio),
    ),
  ].sort();
}

/**
 * Copy the spoken audio into the deck. Only the files the island references: an
 * audio directory is content-addressed and accumulates every take ever made, and
 * shipping the ones a re-edit orphaned would double a deck's size for nothing.
 */
async function copyAudio(from: string, narration: DeckNarration, out: string): Promise<void> {
  const dir = join(out, AUDIO_DIR);
  await mkdir(dir, { recursive: true });
  const names = audioNames(narration);
  for (const name of names) {
    await cp(join(from, name), join(dir, name)).catch(() => {
      throw new Error(`Narration names ${name}, but it is not in ${from}. Re-run \`narrate\`.`);
    });
  }
  step(`narration: ${names.length} audio file(s) → ${dir}`);
}

/** The same files, as pack entries under `audio/`. */
async function audioFiles(from: string, narration: Narration): Promise<PackFiles> {
  const files: PackFiles = {};
  for (const name of audioNames(narration)) {
    const bytes = await readFile(join(from, name)).catch(() => {
      throw new Error(`Narration names ${name}, but it is not in ${from}. Re-run \`narrate\`.`);
    });
    files[`${AUDIO_DIR}/${name}`] = new Uint8Array(bytes);
  }
  return files;
}

/** Greedy wrap, so the script reads as prose in a terminal rather than one line. */
function wrapScript(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/* -------------------------------------------------------------------- timing */

/**
 * The manifest `render` reads: where every scene sits, where it holds, and
 * which sentence is spoken at each hold.
 *
 * Written by `build` because `build` is the only place that has the storyboard
 * and the emitted composition in the same hand. Making the renderer re-derive
 * it would mean two implementations of the same arithmetic, and the one that
 * drifted would drift silently — audio a second off its picture looks like a
 * bad take, not like a bug.
 *
 * A failure here does NOT fail the build. `build`'s job is the deck, and a deck
 * that presents perfectly well can still be one this cannot place audio on — an
 * archetype with no holds, narration re-cut after the beat was sized. So it
 * says loudly what went wrong and writes nothing, and `render` then refuses to
 * guess.
 */
async function writeTiming(out: string, input: Parameters<typeof planTiming>[0]): Promise<void> {
  try {
    const timing = planTiming(input);
    await writeJson(join(out, TIMING_FILE), timing);
    step(
      `build: timing for ${timing.segments.length} narration segment(s) → ${join(out, TIMING_FILE)}`,
    );
  } catch (err) {
    step(
      `build: cannot place narration on this deck, so no ${TIMING_FILE} was written and \`render\` will refuse. ${err instanceof Error ? err.message : err}`,
    );
  }
}

/* --------------------------------------------------------------------- media */

/**
 * The Source's figures as pack assets.
 *
 * `figure.src` is relative to the deck's asset directory, which on disk is
 * `assets/` beside source.json — that is where `ingest` localises them to. A src
 * that is still absolute never made it through ingestion, and is passed through
 * so `planMedia` can decide whether it is a file or a player.
 */
function figureAssets(source: Source, sourcePath: string, prefer: "bake" | "link"): AssetRequest[] {
  const assets = join(dirname(sourcePath), "assets");
  return source.figures.map((f) => ({
    id: f.id,
    url: /^[a-z][a-z0-9+.-]*:/i.test(f.src) ? f.src : join(assets, f.src),
    prefer,
  }));
}

/* ------------------------------------------------------------------- helpers */

/**
 * The named profile, then the caller's canvas over the top of it.
 *
 * Two flags rather than one because they answer different questions. `--format`
 * picks a PROFILE — pacing, weight floor, duration budget, whether the deck is
 * clickable — and those are properties of where the file is going, not of its
 * pixel count. `--width/--height` change only the pixels. Everything else the
 * resized format carries traces back to a profile someone named; see
 * `resizeFormat` for why nothing is invented for a size nobody named.
 *
 * Warnings are printed here rather than thrown, because "this will be too small
 * to read" is a thing the caller may well have meant.
 */
function pickFormat(id: string, width?: string, height?: string): Format {
  const base = FORMATS[id];
  if (!base)
    throw new Error(`Unknown format "${id}". Available: ${Object.keys(FORMATS).join(", ")}.`);
  if (width === undefined && height === undefined) return base;
  if (width === undefined || height === undefined) {
    throw new Error(
      `--width and --height go together. Give both, or give neither and take ${id}'s ${base.width}×${base.height}.`,
    );
  }
  // `Number()` rather than `parseInt`: "1080px" and "10e3" must be typos, not
  // silently truncated canvases. `canvasProblem` rejects the NaN with the flag
  // name attached.
  const format = resizeFormat(base, Number(width), Number(height));
  for (const warning of canvasWarnings(format.width, format.height)) step(`format: ${warning}`);
  return format;
}

/** `--width`/`--height`, on every verb that has to agree about the canvas. */
function sizeFlags(cmd: Command): Command {
  return cmd
    .option("--width <px>", `canvas width in pixels (${MIN_EDGE}–${MAX_EDGE})`)
    .option("--height <px>", `canvas height in pixels (${MIN_EDGE}–${MAX_EDGE})`);
}

/**
 * `--min-weight`, validated. Absent leaves the profile's own default alone.
 *
 * Rejects anything outside 0..1 rather than clamping: `--min-weight 85` is
 * someone typing a percentage, and clamping it to 1 would drop every beat and
 * report the emptiness as a deliberate cut.
 */
function withMinWeight(format: Format, raw: string | undefined): Format {
  if (raw === undefined) return format;
  const minWeight = Number(raw);
  if (!Number.isFinite(minWeight) || minWeight < 0 || minWeight > 1)
    throw new Error(`--min-weight takes a number from 0 to 1, not "${raw}".`);
  return { ...format, minWeight };
}

async function copyAssets(
  sourceDir: string,
  out: string,
  figures: readonly { src: string }[],
): Promise<void> {
  const from = join(sourceDir, "assets");
  if (!(await stat(from).catch(() => null))) {
    step(`build: no assets/ beside source.json, skipping`);
    return;
  }
  // NAMED FILES ONLY, never the directory.
  //
  // This was `cp(from, ..., { recursive: true })`, which copied whatever happened
  // to be beside the figures. Two costs, one of them a hole: the shipped demo
  // carried 640 KB of JPEGs no beat referenced, and — since a deck is served over
  // HTTP from a directory a stranger's upload contributed to — an `.svg` or
  // `.html` that rode along was served from the deck's own path. The CSP sandbox
  // now covers that, but a file that never arrives needs no containment.
  //
  // `fonts/` is the one directory that comes along, because `refreshFont` writes
  // the subsetted bundle into it and the stylesheet names its own files.
  const wanted = new Set(figures.map((f) => f.src.replace(/^\.?\//, "")));
  await mkdir(join(out, "assets"), { recursive: true });
  let copied = 0;
  for (const name of wanted) {
    const src = resolve(join(from, name));
    // The same containment proof the server applies to a zip entry: a figure
    // `src` is document-supplied text and must not reach outside `assets/`.
    if (!src.startsWith(`${resolve(from)}/`)) continue;
    if (!(await stat(src).catch(() => null))) continue;
    await mkdir(dirname(join(out, "assets", name)), { recursive: true });
    await cp(src, join(out, "assets", name));
    copied++;
  }
  const fonts = join(from, "fonts");
  if (await stat(fonts).catch(() => null)) {
    await cp(fonts, join(out, "assets", "fonts"), { recursive: true });
  }
  step(`build: copied ${copied} referenced figure(s)`);
}

/**
 * The planner writes headlines the source never contained, so the subset `ingest`
 * cut can be missing glyphs — and a missing glyph falls back silently, which is
 * the failure invariant 9 exists to prevent. Re-cut over the text the deck really
 * renders. The bundle is content-hashed, so this is a no-op when nothing new
 * appeared, and a build that cannot reach the font service keeps what it copied.
 */
async function refreshFont(storyboard: Storyboard, source: Source, out: string): Promise<void> {
  try {
    const bundle = await bundleFont(
      storyboard.lang,
      glyphs(source) + glyphs(storyboard),
      join(out, "assets", "fonts"),
    );
    if (bundle) step(`build: font bundle covers ${bundle.family}`);
  } catch (err) {
    step(
      `build: could not refresh the font bundle (${err instanceof Error ? err.message : err}); keeping the one from ingest`,
    );
  }
}

/**
 * Every glyph a document or plan can put on screen. Serializing the whole object
 * over-collects ids and TeX, but those are ASCII and the bundle only exists for
 * CJK — over-collecting costs a few bytes, under-collecting costs a tofu box.
 */
function glyphs(value: unknown): string {
  return JSON.stringify(value);
}

async function readValidated<T>(file: string, schema: z.ZodType<T>, label: string): Promise<T> {
  const text = await readFile(resolve(file), "utf8").catch(() => {
    throw new Error(`Cannot read ${label} file ${file}.`);
  });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${file} is not a valid ${label}:\n${issues}`);
  }
  return parsed.data;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const path = resolve(file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const n = bytes / 1024;
  return n < 1024 ? `${n < 10 ? n.toFixed(1) : Math.round(n)} KB` : `${(n / 1024).toFixed(1)} MB`;
}

function step(message: string): void {
  process.stderr.write(`${message}\n`);
}

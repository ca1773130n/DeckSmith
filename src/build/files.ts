/**
 * What a built deck directory contains besides the HTML the emitter produced.
 *
 * Two callers emit a deck — the `build` verb in src/cli.ts and `buildDeck` in
 * src/index.ts — and both must put the same files beside it. Each used to carry
 * its own copy of how, and the copies drifted in three places that a reader
 * comparing them would have called cosmetic:
 *
 *   - `vendorScripts` existed only in cli.ts, so a deck built through the
 *     library named `./vendor/gsap.min.js` in its head and shipped no such
 *     file. Every deck the server produced was a deck whose timeline could not
 *     be built.
 *   - `copyAssets` copied NAMED FILES in cli.ts and the WHOLE DIRECTORY in
 *     index.ts, so the containment proof below — and the 640 KB of unreferenced
 *     JPEGs it was written to stop — applied to one path and not the other.
 *   - `copyAudio` wrote to the `AUDIO_DIR` constant in cli.ts and to
 *     `narration.dir` in index.ts. See the note on `copyAudio` for which of
 *     those is right and why.
 *
 * So this module is the one answer, and the callers differ only in what they do
 * with the return value: the CLI prints, the library collects the paths.
 *
 * Everything here writes into a directory the caller has already made. Nothing
 * here reaches the network, and nothing here is called at render time.
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeckNarration } from "../emit/composition.js";
import { bundleFont } from "../source/fonts.js";
import type { Source, Storyboard } from "../types.js";

/** Progress, for a caller that has somewhere to put it. */
type Step = (message: string) => void;

/**
 * Where a narrated deck keeps its voice, in the built deck and inside a pack
 * alike. One name in one place: the emitter writes it into the island, `build`
 * copies into it, `pack` stores under it, and `unpack` restores it — and none of
 * them has to agree with the others by memory.
 */
export const AUDIO_DIR = "audio";

/** The mp3s an island names, deduplicated and in a stable order. */
export function audioNames(narration: { beats: Record<string, { audio: string }[]> }): string[] {
  return [
    ...new Set(
      Object.values(narration.beats)
        .flat()
        .map((s) => s.audio),
    ),
  ].sort();
}

/**
 * Vendor KaTeX's stylesheet and woff2 fonts beside the deck.
 *
 * The HyperFrames compiler inlines `<script src>` but not `<link rel=stylesheet>`,
 * so a CDN-linked stylesheet is fetched — with its fonts — during capture. That
 * breaks "no network at render time" (invariant 4) and makes equation decks
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
export async function vendorKatex(out: string): Promise<string[]> {
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
  // Each src is a comma-separated list; keep the woff2 entry and drop the rest.
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

/**
 * The scripts a deck runs, copied beside it.
 *
 * Pinned by package.json rather than by a URL, so the version that renders is
 * the version that was installed and tested. See the note on GSAP_SRC in
 * src/emit/composition.ts for why this is not left to the compiler's inliner.
 *
 * WHAT THE HEAD LOADS, AND NOTHING ELSE. `composition` is read rather than
 * `laid.plugins` threaded out of `emit`, because the question this is answering
 * is literally "which of these does the page ask for" — and asking the page
 * cannot drift from the page. It also makes the conditional plugins honest on
 * disk as well as in the head: MorphSVG is 21,195 bytes that a deck without a
 * reshape neither loads NOR carries, which is the rule `PLUGINS` states.
 */
export async function vendorScripts(out: string, composition: string): Promise<string[]> {
  const require = createRequire(import.meta.url);
  await mkdir(join(out, "vendor"), { recursive: true });
  const wanted = (name: string) => composition.includes(`./vendor/${name}`);
  const written: string[] = [];
  for (const [pkg, rel, name] of [
    ["gsap/package.json", "dist/gsap.min.js", "gsap.min.js"],
    ["gsap/package.json", "dist/DrawSVGPlugin.min.js", "DrawSVGPlugin.min.js"],
    ["gsap/package.json", "dist/MorphSVGPlugin.min.js", "MorphSVGPlugin.min.js"],
    ["katex/package.json", "dist/katex.min.js", "katex.min.js"],
  ] as const) {
    if (!wanted(name)) continue;
    const from = join(dirname(require.resolve(pkg)), rel);
    await cp(from, join(out, "vendor", name));
    written.push(join(out, "vendor", name));
  }
  // Ours, not a package's: the morph runtime is built beside dist/cli.js by
  // scripts/build.mjs, exactly as the step layer is. `import.meta.url` is the
  // bundle's own — this module is compiled INTO dist/cli.js and dist/index.js,
  // and dist/ds-morph.js is a sibling of both.
  if (wanted("ds-morph.js")) {
    await cp(
      fileURLToPath(new URL("./ds-morph.js", import.meta.url)),
      join(out, "vendor", "ds-morph.js"),
    );
    written.push(join(out, "vendor", "ds-morph.js"));
  }
  return written;
}

/**
 * `assets/` beside source.json, if there is one. Absent is the ordinary case.
 *
 * NAMED FILES ONLY, never the directory.
 *
 * This was `cp(from, ..., { recursive: true })`, which copied whatever happened
 * to be beside the figures. Two costs, one of them a hole: the shipped demo
 * carried 640 KB of JPEGs no beat referenced, and — since a deck is served over
 * HTTP from a directory a stranger's upload contributed to — an `.svg` or
 * `.html` that rode along was served from the deck's own path. The CSP sandbox
 * now covers that, but a file that never arrives needs no containment.
 *
 * `fonts/` is the one directory that comes along, because `refreshFont` writes
 * the subsetted bundle into it and the stylesheet names its own files.
 *
 * A CLIP CONTRIBUTES TWO FILES, and forgetting the second is a 404 at run time
 * rather than a build error: `poster` is what the video shows before its first
 * frame decodes, and what a player-page clip degrades to when there is no
 * downloadable file at all. Named here because this set is the ONLY thing that
 * reaches the built deck — a poster left out is simply absent, and the deck's
 * own runtime reports it as `http_error 404`, a long way from this line.
 */
export async function copyAssets(
  sourceDir: string,
  out: string,
  figures: readonly { src: string; poster?: string }[],
  step: Step,
): Promise<string[]> {
  const from = join(resolve(sourceDir), "assets");
  if (!(await stat(from).catch(() => null))) {
    step(`build: no assets/ beside source.json, skipping`);
    return [];
  }
  const wanted = new Set(
    figures
      .flatMap((f) => [f.src, f.poster])
      .filter((n) => n !== undefined)
      .map((n) => n.replace(/^\.?\//, "")),
  );
  await mkdir(join(out, "assets"), { recursive: true });
  const written: string[] = [];
  let copied = 0;
  for (const name of wanted) {
    const src = resolve(join(from, name));
    // The same containment proof the server applies to a zip entry: a figure
    // `src` is document-supplied text and must not reach outside `assets/`.
    if (!src.startsWith(`${from}/`)) continue;
    if (!(await stat(src).catch(() => null))) continue;
    await mkdir(dirname(join(out, "assets", name)), { recursive: true });
    await cp(src, join(out, "assets", name));
    written.push(join(out, "assets", name));
    copied++;
  }
  const fonts = join(from, "fonts");
  if (await stat(fonts).catch(() => null)) {
    // The directory rather than its entries: the stylesheet `refreshFont`
    // returned names its own files, and enumerating them here would be a second
    // list to keep in step with it.
    await cp(fonts, join(out, "assets", "fonts"), { recursive: true });
    written.push(join(out, "assets", "fonts"));
  }
  step(`build: copied ${copied} referenced figure(s)`);
  return written;
}

/**
 * Copy the spoken audio into the deck. Only the files the island references: an
 * audio directory is content-addressed and accumulates every take ever made, and
 * shipping the ones a re-edit orphaned would double a deck's size for nothing.
 *
 * `narration.dir`, NOT the `AUDIO_DIR` constant, and the difference is not a
 * preference. `dir` is the string the emitter wrote into the island, so it is
 * what the built page asks the network for; copying to a name the page does not
 * name is a 404 per sentence and silence for the whole deck. `AUDIO_DIR` is
 * where `dir` COMES FROM — `loadNarration` and the server both set it — which is
 * why the two have never disagreed, and exactly why nothing would have caught
 * them if they had.
 */
export async function copyAudio(
  from: string,
  narration: DeckNarration,
  out: string,
  step: Step,
): Promise<string[]> {
  const dir = join(out, narration.dir);
  await mkdir(dir, { recursive: true });
  const names = audioNames(narration);
  for (const name of names) {
    await cp(join(resolve(from), name), join(dir, name)).catch(() => {
      throw new Error(`Narration names ${name}, but it is not in ${from}. Re-run \`narrate\`.`);
    });
  }
  step(`narration: ${names.length} audio file(s) → ${dir}`);
  return names.map((n) => join(dir, n));
}

/**
 * The planner writes headlines the source never contained, so the subset `ingest`
 * cut can be missing glyphs — and a missing glyph falls back silently, which is
 * the failure invariant 9 exists to prevent. Re-cut over the text the deck really
 * renders. The bundle is content-hashed, so this is a no-op when nothing new
 * appeared, and a build that cannot reach the font service keeps what it copied.
 *
 * Every glyph a document or plan can put on screen: serializing the whole object
 * over-collects ids and TeX, but those are ASCII and the bundle only exists for
 * CJK — over-collecting costs a few bytes, under-collecting costs a tofu box.
 */
export async function refreshFont(
  storyboard: Storyboard,
  source: Source,
  out: string,
  step: Step,
): Promise<string | undefined> {
  try {
    const bundle = await bundleFont(
      storyboard.lang,
      JSON.stringify(source) + JSON.stringify(storyboard),
      join(out, "assets", "fonts"),
    );
    if (bundle) step(`build: font bundle covers ${bundle.family}`);
    // The CSS goes back to the caller so the composition can DECLARE the face
    // rather than link it. Writing the file is still what puts the woff2 beside
    // the deck; only the declaration moves.
    return bundle?.css;
  } catch (err) {
    step(
      `build: could not refresh the font bundle (${err instanceof Error ? err.message : err}); keeping the one from ingest`,
    );
    return undefined;
  }
}

/**
 * The six verbs, run against the LIBRARY rather than the CLI.
 *
 * Everything here is a call into src/index.ts: no argv round-trip for a 200 KB
 * source document, errors arrive as exceptions instead of exit codes, and the
 * storyboard is an object between stages rather than a file we re-read. The one
 * thing shelled out to is Codex, and that is `codexPlanner`'s own `spawn` with
 * an argv array — checked, not assumed; see the note above `plan`.
 *
 * Layout under the job directory. Only `deck/` is ever served:
 *
 *   upload/   what arrived, unpacked. Never served, never on a URL.
 *   src/      source.json and its assets/, generated pictures included
 *   audio/    narration.json and the mp3s
 *   deck/     the built deck, plus video.mp4, video.srt and deck.deck
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  type AssetRequest,
  assertRefsResolve,
  buildDeck,
  codexPlanner,
  type DeckNarration,
  durationPlan,
  fetchFigures,
  hasIllustrations,
  type ImageProvider,
  illustrate,
  narrate,
  PACK_VERSION,
  type Pack,
  type PackFiles,
  parseMarkdown,
  planMedia,
  type Runner,
  render,
  type Source,
  type Storyboard,
  scanBeatCount,
  writePack,
} from "../index.js";
import type { JobOptions } from "./options.js";
import type { JobHandle, JobResult, Stage } from "./queue.js";
import {
  insideRoot,
  looksLikeZip,
  MARKDOWN_EXTS,
  pickMarkdown,
  readZip,
  type Upload,
  UploadError,
} from "./upload.js";

const AUDIO_DIR = "audio";
const NARRATION_FILE = "narration.json";

/** Figures are not worth an unbounded fetch loop even when fetching is allowed. */
const MAX_REMOTE_FIGURES = 40;

/**
 * Formats whose file is uploaded to a feed, where a sidecar .srt is dropped on
 * the way in. Keyed by the id the REQUEST named, so a resized short still counts.
 */
const FEED_FORMATS = new Set(["short-9x16", "post-1x1"]);

export interface PipelineInput {
  upload: Upload;
  options: JobOptions;
  /**
   * Whether a figure named by an http(s) URL may be downloaded.
   *
   * OFF by default, and that is a security decision, not a performance one. The
   * document is a stranger's; `![](http://169.254.169.254/latest/meta-data/)` is
   * a request this process would make from inside the network it runs in, and a
   * hostname allowlist does not close it because DNS can answer differently the
   * second time. Off, the figure is dropped and named in the warnings. On (the
   * owner's own box, own papers), it is fetched with a count and a timeout.
   */
  fetchRemoteFigures: boolean;
  /**
   * The rungs `illustrate` draws through. A test injects the tool's own SVG and
   * nothing else; absent, the stage resolves its providers from the environment
   * at call time, like `narrate` does — so there is no server option to plumb
   * and nothing to configure but the env vars.
   */
  imageChain?: ImageProvider[];
  /**
   * The planner's `Runner`, handed straight to `codexPlanner`. The seam
   * test/plan.test.ts already drives the parse path through; here it is what
   * lets a test carry a job PAST `plan` — into `illustrate` — without a Codex.
   */
  run?: Runner;
}

/** Which rows the step list should have, decided before anything runs. */
export function stagesFor(options: JobOptions): Stage[] {
  const stages: Stage[] = ["ingest", "plan"];
  if (options.images) stages.push("illustrate");
  if (options.narrate) stages.push("narrate");
  stages.push("build");
  if (options.video) stages.push("render");
  return stages;
}

export async function runPipeline(job: JobHandle, input: PipelineInput): Promise<JobResult> {
  const { options } = input;
  const dirs = {
    upload: join(job.dir, "upload"),
    src: join(job.dir, "src"),
    audio: join(job.dir, AUDIO_DIR),
    deck: join(job.dir, "deck"),
  };
  const warnings = [...options.warnings];
  const url = (rel: string) => `/d/${job.id}/${rel}`;

  /* ---------------------------------------------------------------- ingest */
  job.begin("ingest");
  // `let`, both of these: `illustrate` hands back new objects and everything
  // after it — build, pack — must read those, not what the planner returned.
  let source = await ingest(job, input, dirs, warnings);
  // `source.figures` is the post-guard list, and the log line inside `ingest`
  // reports the pre-guard one. Saying only the first put "0 figures" in the step
  // row twelve pixels above a log line reading "4 figures" — both true, and no
  // way to tell from the page which was the lie. The dropped ones each left a
  // warning behind, so count those and say so on the spot rather than at the end.
  const dropped = warnings.filter((w) => w.startsWith("figure ")).length;
  job.done(
    "ingest",
    `${source.sections.length} sections, ${source.figures.length} figures${dropped > 0 ? ` (${dropped} left out)` : ""}`,
  );

  /* ------------------------------------------------------------------ plan */
  job.begin("plan");
  job.log("plan: asking Codex for a storyboard — this is the slow one, about a minute");
  // The document knows what language it is in; only an explicit request outranks
  // it, or the planner translates the paper by accident.
  const prefs = options.stated.lang ? options.prefs : { ...options.prefs, lang: source.lang };
  const planned = await codexPlanner(source, {
    prefs,
    ...(input.run ? { run: input.run } : {}),
  });
  let storyboard: Storyboard = {
    ...planned,
    lang: prefs.lang,
    theme: options.stated.theme ? prefs.theme : planned.theme,
  };
  // A brief without a figure is what `illustrate` exists to fill, so it is only
  // a plan this job can build when that stage is going to run. Everywhere else
  // it is refused by name, as `build` and `pack` refuse it on the CLI.
  assertRefsResolve(storyboard, source, { pending: options.images ? "allow" : "refuse" });
  await writeJson(join(job.dir, "storyboard.json"), storyboard);
  job.done("plan", `${storyboard.beats.length} beats`);
  // `slides` is a FLOOR, and the planner can still come back under it. Said here
  // rather than at the end, for the same reason the CLI says it at `plan`: the
  // narrate stage below is about to spend a minute of TTS on whatever came back,
  // and the number it came back with is what the rest of this job is budgeted at.
  for (const f of scanBeatCount(storyboard, prefs)) warnings.push(f.message);

  /* ------------------------------------------------------------ illustrate */
  if (options.images) {
    job.begin("illustrate");
    const drawn = await illustrate(storyboard, source, {
      prefs,
      assetsDir: join(dirs.src, "assets"),
      ...(input.imageChain ? { chain: input.imageChain } : {}),
      onStep: (line) => job.log(line),
    });
    // REASSIGNED, not merely written to disk: build and pack below read the
    // objects in hand, and these are the ones with the pictures registered and
    // the slots pointing at them. The files are rewritten for the same reason
    // `ingest` and `plan` write theirs — a retry, and a person, can read them.
    storyboard = drawn.storyboard;
    source = drawn.source;
    await writeJson(join(dirs.src, "source.json"), source);
    await writeJson(join(job.dir, "storyboard.json"), storyboard);
    for (const p of drawn.illustrated) {
      job.log(
        `illustrate: ${p.beatId} → assets/${p.src} via ${p.provider}${p.cached ? " (cached)" : ""}`,
      );
    }
    if (drawn.illustrated.length === 0) {
      job.skip("illustrate", "the plan found a figure for every beat and asked for no pictures");
    } else {
      const rungs = [...new Set(drawn.illustrated.map((p) => p.provider))].join(", ");
      job.done("illustrate", `${drawn.illustrated.length} pictures via ${rungs}`);
    }
  }

  /* --------------------------------------------------------------- narrate */
  let narration: DeckNarration | undefined;
  if (options.narrate) {
    job.begin("narrate");
    const speaking = storyboard.beats.filter((b) => b.narration?.trim()).length;
    if (speaking === 0) {
      job.skip("narrate", "no beat came back with narration text");
      warnings.push("the plan had nothing to say aloud, so the deck is silent");
    } else {
      job.log(`narrate: ${speaking} of ${storyboard.beats.length} beats speak`);
      await mkdir(dirs.audio, { recursive: true });
      const spoken = await narrate(storyboard, source, prefs, {
        dir: dirs.audio,
        format: options.format,
      });
      await writeJson(join(dirs.audio, NARRATION_FILE), spoken);
      narration = { voice: spoken.voice, dir: AUDIO_DIR, beats: spoken.beats };
      const segments = Object.values(spoken.beats).flat();
      const seconds = segments.reduce((sum, s) => sum + s.seconds, 0);
      job.done("narrate", `${segments.length} segments, ${seconds.toFixed(1)}s in ${spoken.voice}`);
    }
  }

  /* ----------------------------------------------------------------- build */
  job.begin("build");
  // The same count `narrate` above was given — `narrate` reads `beats.length`
  // off this storyboard too — so the rate the voice was spoken at and the speed
  // the animation is paced at come from one budget. See `durationPlan`'s header.
  const paced = durationPlan(prefs, storyboard.beats.length);
  for (const w of paced.warnings) warnings.push(w);
  const built = await buildDeck(storyboard, source, dirs.deck, {
    format: options.format,
    theme: options.stated.theme ? prefs.theme : storyboard.theme,
    // The DURATION target owns the pace when there is one, and is `animationSpeed`
    // itself when there is not. Its warnings are the job's: a target that cannot
    // be met is something the person who asked for it must be told.
    speed: paced.speed,
    assetsFrom: dirs.src,
    ...(narration ? { narration, audioFrom: dirs.audio } : {}),
    onStep: (line) => job.log(line),
    // A beat the planner over-filled costs that slide, not the deck. Named in
    // the warnings so the result says what is missing rather than quietly
    // showing eleven slides where twelve were planned.
    onBeatError: (id, err) => {
      warnings.push(`slide ${id} was left out: ${err.message}`);
      job.log(`build: dropped ${id} — ${err.message}`);
    },
  });
  for (const d of built.cut.dropped) warnings.push(`cut ${d.beat.id} — ${d.reason}`);
  for (const d of built.cut.dangling) warnings.push(`check the wording — ${d.reason}`);
  const packUrl = await pack(job, { storyboard, source, prefs, narration, dirs, url });
  job.done(
    "build",
    `${built.cut.kept.length} beats at ${options.format.width}×${options.format.height}`,
  );

  /* ---------------------------------------------------------------- render */
  let videoUrl: string | undefined;
  let srtUrl: string | undefined;
  let duration = built.cut.seconds;
  if (options.video) {
    job.begin("render");
    if (!narration) {
      job.skip("render", "there is no narration to time the video against");
      warnings.push("no video: a render needs narration for its timing manifest");
    } else {
      job.log("render: capturing frames — two minutes for a four-minute video");
      // SIDECAR, STATED. This said `"auto"`, which used to mean "burn on a
      // vertical canvas" and now resolves to sidecar like everything else — a
      // spelling kept alive for existing scripts, not a choice (see
      // `subtitlePlan` in src/render/render.ts). Naming the mode we actually
      // want means the day `auto` is finally deleted this keeps working.
      const out = await render({
        deck: dirs.deck,
        out: join(dirs.deck, "video.mp4"),
        subtitles: "sidecar",
        log: (line) => job.log(line),
        // The last of the three length levers, and the only one that acts on a
        // finished file. Plan time already spent the budget on what gets said;
        // this closes whatever gap survived it, and says what it cost.
        //
        // NO `allowFastPlayback`, ON PURPOSE. `render` refuses a gap wider than
        // `MAX_PLAYBACK`, and on this path there should never be one: the same
        // `prefs.duration` already sized the deck — `parseOptions` derives the
        // slide count from it via `slidesFor` — so a residual past 1.25× means
        // plan-time sizing broke, not that the caller asked for too much. A job
        // that fails there is a bug report; a job that quietly ships a 2× video
        // is a bug nobody files. The CLI has `--allow-fast-playback` because a
        // human can look at the file and decide; a hosted job cannot.
        ...(prefs.duration ? { targetSeconds: prefs.duration } : {}),
      });
      videoUrl = url("video.mp4");
      if (out.srt) srtUrl = url(relative(dirs.deck, out.srt).split("\\").join("/"));
      duration = out.seconds;
      if (out.playback > 1) {
        warnings.push(
          `playback was sped up ${out.playback}× to reach the ${prefs.duration}s target; the audio is time-stretched, not re-spoken`,
        );
      }
      // Only where it changes what someone should do. A sidecar is the right
      // default and needs no announcement on a deck or a long-form video — but
      // a feed platform discards an uploaded .srt, so on a short it is the
      // difference between captioned and not, and the API has no field to ask
      // for burning. Named formats only: a custom canvas has no destination.
      if (!out.burned && out.srt && FEED_FORMATS.has(options.formatId)) {
        warnings.push(
          `captions are a separate ${relative(dirs.deck, out.srt)} — feed platforms discard an uploaded .srt, so for a short run \`decksmith render --subtitles burn\` to put them in the picture`,
        );
      }
      job.done("render", `${out.frames} frames, ${out.seconds.toFixed(1)}s`);
    }
  }

  // A non-navigable format emits no deck.html; index.html is the composition and
  // still opens. Saying which is which beats a 404 on the link we handed back.
  if (!built.navigable) {
    warnings.push(
      `${options.formatId} renders linearly, so the deck opens as index.html with no navigation`,
    );
  }
  return {
    deckUrl: url(built.navigable ? "deck.html" : "index.html"),
    ...(videoUrl ? { videoUrl } : {}),
    ...(srtUrl ? { srtUrl } : {}),
    ...(packUrl ? { packUrl } : {}),
    slides: built.cut.kept.length,
    duration: Math.round(duration * 1000) / 1000,
    warnings,
  };
}

/* ------------------------------------------------------------------- ingest */

async function ingest(
  job: JobHandle,
  input: PipelineInput,
  dirs: { upload: string; src: string },
  warnings: string[],
): Promise<Source> {
  await mkdir(dirs.upload, { recursive: true });
  const root = resolve(dirs.upload);
  let docPath: string;

  if (looksLikeZip(input.upload.bytes)) {
    const { files, warnings: zipWarnings } = readZip(input.upload.bytes);
    warnings.push(...zipWarnings);
    for (const [rel, bytes] of Object.entries(files)) {
      const to = resolve(join(root, rel));
      // `safeEntryPath` already rebuilt this path from inspected segments; this
      // is the second lock on the same door, because zip slip is the one bug in
      // this file that is worth paying for twice.
      if (!insideRoot(root, to))
        throw new UploadError(`Refusing to write ${rel}.`, "Re-zip from inside the folder.");
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, bytes);
    }
    docPath = join(root, pickMarkdown(files));
    job.log(
      `ingest: unpacked ${Object.keys(files).length} file(s), reading ${pickMarkdown(files)}`,
    );
  } else {
    const ext = (input.upload.filename.match(/\.[^.\\/]+$/)?.[0] ?? "").toLowerCase();
    if (ext && !MARKDOWN_EXTS.includes(ext)) {
      throw new UploadError(
        `"${input.upload.filename}" is a ${ext} file.`,
        `DeckSmith reads ${MARKDOWN_EXTS.join(", ")} or a .zip containing one. Export the document to markdown first.`,
      );
    }
    docPath = join(root, "document.md");
    await writeFile(docPath, input.upload.bytes);
  }

  const text = await readFile(docPath, "utf8");
  const parsed = parseMarkdown(text, {
    lang: input.options.stated.lang ? input.options.prefs.lang : undefined,
  });
  if (parsed.sections.length === 0) {
    throw new UploadError(
      "The document has no readable content.",
      "It parsed to nothing — check that you uploaded the markdown and not an empty or binary file.",
    );
  }
  if (parsed.sections.every((s) => s.heading.trim() === "")) {
    throw new UploadError(
      "The document has no headings, so there is nothing to structure a deck around.",
      "Add at least one `# Heading`. DeckSmith plans one beat per idea and headings are how it finds them.",
    );
  }
  job.log(
    `ingest: ${parsed.sections.length} sections, ${parsed.figures.length} figures, ${parsed.equations.length} equations, ${parsed.tables.length} tables`,
  );

  const guarded = await guardFigures(parsed, root, input.fetchRemoteFigures, warnings);
  // Only now does anything touch the filesystem on a figure's behalf, and every
  // `src` it will read is an absolute path this function chose.
  const source = await fetchFigures(guarded, join(resolve(dirs.src), "assets"));
  await writeJson(join(dirs.src, "source.json"), source);
  return source;
}

/**
 * Addresses an uploaded document may not send this process to.
 *
 * Fetching a figure means making a request from wherever this server runs, with
 * a URL a stranger chose. On by default now, because a paper's markdown links
 * its images and a deck that drops them silently is not the deck anyone asked
 * for — so the flag stopped being the guard and this is.
 *
 * The classic target is the metadata service on 169.254.169.254, and after that
 * anything on the LAN that answers without asking who is calling. Resolution
 * happens here, before the fetch, so a hostname that points inward is refused by
 * the address it resolves to rather than by how it is spelled — an allowlist of
 * names cannot do that.
 *
 * Honest about its limit: a name that resolves to a public address here and a
 * private one when `fetch` looks again is not stopped by this (DNS rebinding).
 * Closing that needs the request pinned to the address already resolved, which
 * Node's fetch does not expose. This blocks the whole naive class, which is what
 * a document with a URL in it actually is.
 */
const BLOCKED = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

async function reachable(url: string): Promise<string | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "is not a URL this server can parse";
  }
  const bare = host.replace(/^\[|\]$/g, "");
  // A literal address needs no lookup, and `dns.lookup` on one just echoes it.
  const addrs: string[] = [];
  try {
    const { lookup } = await import("node:dns/promises");
    for (const a of await lookup(bare, { all: true })) addrs.push(a.address);
  } catch {
    return "does not resolve";
  }
  for (const addr of addrs) {
    if (BLOCKED.some((re) => re.test(addr))) return `resolves to a private address (${addr})`;
    // IPv6 loopback, link-local and unique-local.
    const v6 = addr.toLowerCase();
    if (v6 === "::1" || v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) {
      return `resolves to a private address (${addr})`;
    }
  }
  return addrs.length === 0 ? "does not resolve" : null;
}

/**
 * Rewrite every figure's `src` to something safe to read, or drop the figure.
 *
 * `fetchFigures` does `readFile(src)` for anything that is not an http URL, and
 * `src` is whatever the document's markdown said. A document containing
 * `![](../../../../etc/ssh/ssh_host_rsa_key)` would otherwise have this process
 * read it — the image sniffer rejects it a moment later, but the read already
 * happened and the error message quotes the path. So relative paths are resolved
 * inside the upload directory and confined there, and everything else is dropped
 * unless remote fetching has been deliberately switched on.
 *
 * Dropped figures leave before the planner sees the source, so no beat can cite
 * one and `assertRefsResolve` has nothing to fail on.
 */
async function guardFigures(
  source: Source,
  root: string,
  allowRemote: boolean,
  warnings: string[],
): Promise<Source> {
  const figures: Source["figures"] = [];
  let remote = 0;
  for (const figure of source.figures) {
    const src = figure.src.trim();
    const scheme = src.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();

    if (scheme === "http" || scheme === "https") {
      if (!allowRemote) {
        warnings.push(
          `figure ${figure.id} was left out: it is hosted at ${host(src)} and this server does not fetch remote figures`,
        );
        continue;
      }
      if (++remote > MAX_REMOTE_FIGURES) {
        warnings.push(
          `figure ${figure.id} was left out: more than ${MAX_REMOTE_FIGURES} remote figures`,
        );
        continue;
      }
      const why = await reachable(src);
      if (why) {
        warnings.push(`figure ${figure.id} was left out: ${host(src)} ${why}`);
        continue;
      }
      figures.push(figure);
      continue;
    }
    if (scheme) {
      warnings.push(`figure ${figure.id} was left out: "${scheme}:" figures are not read`);
      continue;
    }

    // A relative path, which is what a zip's own figures look like. Resolve it
    // inside the upload and refuse anything that lands outside.
    const abs = resolve(join(root, src.replace(/^\.?\//, "")));
    if (!insideRoot(root, abs)) {
      warnings.push(`figure ${figure.id} was left out: "${src}" points outside the upload`);
      continue;
    }
    if (!(await stat(abs).catch(() => null))?.isFile()) {
      warnings.push(`figure ${figure.id} was left out: "${src}" is not in the upload`);
      continue;
    }
    figures.push({ ...figure, src: abs });
  }
  return { ...source, figures };
}

/* --------------------------------------------------------------------- pack */

/**
 * The `.deck` container, built from what is already in hand.
 *
 * The fetcher is local-only on purpose: after `ingest` every figure is a file
 * inside the job directory, so a pack has no business opening a socket, and
 * handing `planMedia` its default network fetcher would re-open the door
 * `guardFigures` just closed.
 */
async function pack(
  job: JobHandle,
  ctx: {
    storyboard: Storyboard;
    source: Source;
    prefs: JobOptions["prefs"];
    narration: DeckNarration | undefined;
    dirs: { src: string; audio: string; deck: string };
    url: (rel: string) => string;
  },
): Promise<string | undefined> {
  try {
    const assets = join(resolve(ctx.dirs.src), "assets");
    const requests: AssetRequest[] = ctx.source.figures.map((f) => ({
      id: f.id,
      url: join(assets, f.src),
      prefer: "bake",
    }));
    const plan = await planMedia(requests, async (url) => ({
      bytes: new Uint8Array(await readFile(url)),
    }));
    const files: PackFiles = { ...plan.files };
    if (ctx.narration) {
      for (const name of audioNames(ctx.narration)) {
        files[`${AUDIO_DIR}/${name}`] = new Uint8Array(await readFile(join(ctx.dirs.audio, name)));
      }
    }
    const container: Pack = {
      version: PACK_VERSION,
      createdAt: new Date().toISOString(),
      title: ctx.storyboard.title,
      prefs: {
        ...ctx.prefs,
        narration: { ...ctx.prefs.narration, enabled: ctx.narration !== undefined },
        // Same rule as the line above: what the pack CARRIES, not what the
        // request ticked. A job that asked for pictures and got a plan with no
        // briefs has none to carry.
        images: { ...ctx.prefs.images, enabled: hasIllustrations(ctx.storyboard, ctx.source) },
      },
      source: ctx.source,
      storyboard: ctx.storyboard,
      ...(ctx.narration ? { narration: await readJson(join(ctx.dirs.audio, NARRATION_FILE)) } : {}),
      media: plan.media,
    };
    const bytes = await writePack(container, files, join(ctx.dirs.deck, "deck.deck"));
    job.log(`pack: ${Math.round(bytes / 1024)} KB → deck.deck`);
    return ctx.url("deck.deck");
  } catch (err) {
    // A pack is a convenience, not the deliverable. Losing it must not lose the
    // deck the caller actually waited for.
    job.log(`pack: skipped — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function audioNames(narration: DeckNarration): string[] {
  return [
    ...new Set(
      Object.values(narration.beats)
        .flat()
        .map((s) => s.audio),
    ),
  ].sort();
}

/* ------------------------------------------------------------------ helpers */

function host(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return "another host";
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

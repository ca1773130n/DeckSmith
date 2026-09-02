/**
 * `npm run serve` — the whole configuration surface, and the reasons for the
 * defaults.
 *
 * Everything is an environment variable with a default that is safe rather than
 * generous, because the default is what runs. The two that matter most:
 *
 *   HOST binds 127.0.0.1. There is NO AUTH in this server. A default of 0.0.0.0
 *   would put an unauthenticated Codex spend endpoint on the local network the
 *   first time someone typed `npm run serve` on a laptop in a cafe. Opening it
 *   is a decision, and a decision should have to be typed.
 *
 *   DECKSMITH_FETCH_FIGURES is ON. A document whose figures are hosted rather
 *   than attached is the normal case — a paper's markdown links its images — and
 *   a deck that silently drops them is not the deck anyone asked for. It is a
 *   request this process makes from inside whatever network it runs in, so the
 *   guard is not the flag: `guardFigures` in ./pipeline.ts refuses any URL that
 *   resolves to a private, loopback or link-local address. Set the variable to 0
 *   to turn fetching off entirely.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Through the bundle, never a deep path: `build:server` transpiles without
// bundling, so `../narrate/tts.js` would survive into dist/server/ and resolve
// to nothing. `test/server.test.ts` fails the build for it, and caught this.
import { imageChain, prefsSchema, resolveImageBackend, resolveProvider } from "../index.js";
import { createDeckServer } from "./http.js";
import { MAX_UPLOAD_BYTES } from "./upload.js";

const env = process.env;

const options = {
  port: int(env.PORT, 8475),
  host: env.DECKSMITH_HOST ?? "127.0.0.1",
  work: env.DECKSMITH_WORK ?? join(tmpdir(), "decksmith-server"),
  maxUploadBytes: int(env.DECKSMITH_MAX_UPLOAD, MAX_UPLOAD_BYTES),
  maxQueued: int(env.DECKSMITH_MAX_QUEUE, 8),
  ttlMs: int(env.DECKSMITH_JOB_TTL_MIN, 120) * 60_000,
  jobsPerHour: int(env.DECKSMITH_JOBS_PER_HOUR, 5),
  requestsPerMinute: int(env.DECKSMITH_REQS_PER_MIN, 240),
  fetchRemoteFigures: flag(env.DECKSMITH_FETCH_FIGURES, true),
  sandboxDecks: flag(env.DECKSMITH_DECK_SANDBOX, true),
  removeDir: (dir: string) => void rm(dir, { recursive: true, force: true }).catch(() => {}),
  log: (line: string) => process.stderr.write(`${line}\n`),
};

mkdirSync(options.work, { recursive: true });

const { server, queue } = createDeckServer(options);

// One sweep a minute rather than a timer per job: a job's files outlive its
// record by whatever fraction of a minute it took to notice, which is cheap, and
// a thousand pending timers is not.
const sweeper = setInterval(() => queue.sweep(), 60_000);
sweeper.unref();

/**
 * Directories from a previous life.
 *
 * The queue is in memory, so a restart forgets every job while leaving its
 * files on disk — and nothing would ever sweep them, which on a long-lived box
 * is an unbounded disk leak with a deck directory as its unit. Age is the only
 * safe criterion: a deck someone has open right now is younger than the TTL and
 * its link keeps working, because `/d/:id` reads the filesystem and never asks
 * the queue.
 */
function sweepOrphans(): void {
  const cutoff = Date.now() - options.ttlMs;
  for (const entry of readdirSync(options.work, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(options.work, entry.name);
    // A directory with no `deck/` never finished, and nothing can ever finish it:
    // the queue that was driving it died with the process. Age does not protect
    // it, because being recent is exactly what a job interrupted mid-run looks
    // like. Keeping it only preserved the shape of a job whose every API read is
    // a 404 — which the browser polls forever, and which is what "it hangs"
    // turned out to be. A finished deck is different and is kept for its TTL:
    // `/d/:id` reads the filesystem, so its link still works.
    if (!existsSync(join(dir, "deck"))) {
      // Interrupted. Drop what the dead run derived — none of it is finishable,
      // because the queue that was driving it went with the process — and keep
      // the two files a retry needs. The upload is the one thing here the user
      // cannot regenerate, and deleting it turned a restart into data loss.
      if (existsSync(join(dir, "job.json"))) {
        for (const derived of ["src", "audio", "deck", "upload", "storyboard.json"]) {
          options.removeDir(join(dir, derived));
        }
        options.log(`decksmith: ${entry.name} interrupted — upload kept, it can be run again`);
        continue;
      }
      options.removeDir(dir);
      options.log(`decksmith: dropped ${entry.name} — interrupted, nothing to keep`);
      continue;
    }
    if (statSync(dir).mtimeMs > cutoff) continue;
    options.removeDir(dir);
    options.log(`decksmith: swept ${entry.name} from a previous run`);
  }
}
sweepOrphans();

server.listen(options.port, options.host, () => {
  options.log(`decksmith: http://${options.host}:${options.port}`);
  options.log(`decksmith: work ${options.work}, one job at a time, ${options.maxQueued} may wait`);
  options.log(
    `decksmith: no auth, no TLS. Bound to ${options.host}${options.host === "127.0.0.1" ? " — set DECKSMITH_HOST to open it, knowing that" : " — anyone who can reach this port can spend your Codex quota"}.`,
  );
  // Said at startup rather than discovered a minute into the first job. Async
  // because finding edge-tts means asking candidates whether they run; the
  // banner above is already out, so the answer arrives a beat later.
  void preflight();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    options.log("decksmith: stopping");
    server.close(() => process.exit(0));
    // A render in flight holds the process; do not wait forever for it.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

/**
 * What is missing, said once, at the start.
 *
 * None of these is fatal — a deck with no narration needs no edge-tts and no
 * ffmpeg, and only the video needs a browser — so this warns rather than exits.
 * The point is that "Codex is not installed" should be legible before someone
 * uploads a paper and waits a minute to be told.
 */
async function preflight(): Promise<void> {
  const runtime = fileURLToPath(new URL("../deck-runtime.js", import.meta.url));
  const missing: string[] = [];
  if (!existsSync(runtime)) missing.push(`the deck runtime (${runtime}) — run \`npm run build\``);
  for (const [bin, why] of [
    ["codex", "planning; every job needs it"],
    ["ffmpeg", "video"],
  ] as const) {
    if (!onPath(bin)) missing.push(`${bin} — needed for ${why}`);
  }

  // NARRATION IS NOT A PATH LOOKUP. This asked PATH for `edge-tts` and reported
  // a working install as missing: resolution tries five things — the
  // DECKSMITH_EDGE_TTS override, PATH, the two directories a `pip --user`
  // install actually lands in, and finally `python3 -m edge_tts` — because a
  // console script that is nowhere on PATH is the NORMAL state of that install
  // rather than an edge case. On the machine this was found on, PATH had
  // nothing and `~/Library/Python/3.9/bin/edge-tts` answered, so the banner
  // warned about narration the server could perfectly well synthesise. A
  // warning that is wrong is worse than none: it teaches whoever reads this
  // banner to skim past the ones that are right.
  //
  // Asked through `resolveProvider().check()` rather than by resolving edge-tts
  // directly, so it follows DECKSMITH_TTS to whichever provider will actually
  // be used, and so it cannot disagree with what synthesis does a minute later
  // — which was the whole defect.
  const tts = resolveProvider();
  await tts
    .check()
    .then(() => options.log(`decksmith: narration via ${tts.id}`))
    .catch(() => missing.push(`${tts.id} — needed for narration`));

  // PICTURES NEVER GO MISSING. The last rung is an SVG the tool draws itself, so
  // a job that asks for illustrations always finishes, whatever is installed —
  // this line says where they would come from, not whether they can. The one
  // thing that can be wrong is a backend the environment names and cannot use
  // (DECKSMITH_IMAGES set, the key not), and that is reported here, at startup,
  // rather than by the first job that asks for a picture. Reported, never
  // thrown: a deck with no pictures in it needs none of this.
  try {
    const backend = resolveImageBackend();
    const rungs = imageChain(prefsSchema.parse({}).images, backend).map((p) => p.id);
    options.log(`decksmith: images via ${backend ? backend.id : rungs.join(", then ")}`);
  } catch (err) {
    missing.push(`the image backend — ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const line of missing) options.log(`decksmith: MISSING ${line}`);
  if (missing.length === 0) options.log("decksmith: codex, edge-tts and ffmpeg all found");
}

/**
 * PATH walked directly rather than shelled out to `which`. `which` is a process
 * per binary at startup, and `command -v` is a shell builtin, which would mean
 * spawning a shell with a name in it — the one thing nothing here does.
 */
function onPath(bin: string): boolean {
  return (env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, bin)));
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return ["1", "true", "on", "yes"].includes(raw.toLowerCase());
}

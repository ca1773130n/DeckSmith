/**
 * DeckSmith as four MCP tools: a document and some settings in, a deck out.
 *
 * WHY THIS IS NOT ONE BLOCKING TOOL. The pipeline is minutes long — Codex takes
 * one to three, edge-tts thirty seconds and a network round trip per sentence,
 * `hyperframes check` boots a browser, and a render is another one to two. A
 * single tool call that does all of it runs five to eight minutes and every MCP
 * client gives up long before that. So a job is submitted and then WAITED ON in
 * bounded slices: `wait_seconds` returns whatever is true when it expires, and
 * the agent calls again. The work keeps running between calls.
 *
 * WHY IT REUSES `src/server`. The async machinery already exists and is tested
 * by 95 tests: `Queue` takes the work as an injected `run(handle)`, tracks
 * state, position and a log, and `runPipeline` is the one place the SSRF guard
 * and the zip-slip lock live. An MCP that shelled out to the CLI would have to
 * rebuild that registry over child processes in order to avoid using it.
 *
 * WHY NO FIELD HAS A DEFAULT. `JobOptions.stated` exists because a theme sitting
 * at "ink" must be distinguishable from one nobody mentioned — the storyboard
 * records the theme it was planned under and the document knows its own
 * language, and both must beat a default and lose to a choice. Writing
 * `.default("ink")` here destroys that before `parseOptions` ever sees it, and
 * the symptom is a Korean paper narrated in English. Absence is the signal.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { durationPlan, FORMATS, THEME_NAMES } from "../index.js";
import { catalog, parseOptions } from "../server/options.js";
import { runPipeline, stagesFor } from "../server/pipeline.js";
import { type JobView, Queue } from "../server/queue.js";
import { MAX_UPLOAD_BYTES } from "../server/upload.js";
import { imageBackend, missingFor, type Prereq, prereqs } from "./prereqs.js";

const formatIds = Object.keys(FORMATS) as [string, ...string[]];
const themeIds = [...THEME_NAMES] as [string, ...string[]];

/**
 * The settings surface, mirroring `prefsSchema` and validated by it downstream.
 *
 * Every field optional and NONE with a default — see the header. The
 * descriptions carry what six sessions of measurement learned, because a tool
 * schema is the only documentation an agent reads.
 */
export const settingsSchema = z.object({
  format: z
    .enum(formatIds)
    .optional()
    .describe(
      "deck-16x9 is a navigable slide deck. video-16x9, short-9x16 and post-1x1 are linear and budgeted — they drop beats that do not fit their length.",
    ),
  theme: z.enum(themeIds).optional().describe("Omit and the storyboard's own theme wins."),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/)
    .optional()
    .describe(
      "BCP-47. OMIT THIS unless you want a translation — absent means the document's own language.",
    ),
  tone: z.enum(["plain", "academic", "conversational", "punchy"]).optional(),
  density: z
    .enum(["sparse", "normal", "dense"])
    .optional()
    .describe("How much text a SLIDE carries. A different axis from narration_density."),
  duration: z
    .number()
    .min(10)
    .max(1800)
    .optional()
    .describe(
      "Target seconds. Sets the pace, derives the slide count when you give none, and overrides animation_speed. Call decksmith_estimate_length first — a short target buys its words by saying less, not by playing faster.",
    ),
  slides: z
    .int()
    .min(3)
    .max(40)
    .optional()
    .describe(
      "Target beat count. Derived from duration when omitted. Stating it is obeyed even when it cannot flow, and you are told what it cost.",
    ),
  animation_speed: z
    .number()
    .min(0.25)
    .max(3)
    .optional()
    .describe("Multiplies every tween. IGNORED when duration is set."),
  narrate: z.boolean().optional().describe("Speak the deck with edge-tts. Required for video."),
  voice: z
    .string()
    .optional()
    .describe('e.g. "en-US-AndrewMultilingualNeural". Omit to have one chosen for lang and tone.'),
  rate: z
    .string()
    .regex(/^[+-]\d{1,3}%$/)
    .optional()
    .describe("IGNORED when duration is set."),
  pitch: z
    .string()
    .regex(/^[+-]\d{1,3}Hz$/)
    .optional(),
  narration_density: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe(
      "How many of a beat's stops SPEAK. `low` is one sentence a beat and is what makes a short target reachable — the demo has 12 beats but 37 stops, so a 60s target spread over stops is four words each.",
    ),
  video: z
    .boolean()
    .optional()
    .describe(
      "Also render an mp4. Adds 1-2 minutes, needs ffmpeg and Chrome, and turns narrate on.",
    ),
  images: z
    .boolean()
    .optional()
    .describe(
      "Let the plan ask for a picture where the document has no figure to show. Each brief is drawn through the configured image backend, else the Codex account's own image tool, else an SVG DeckSmith draws itself — so it never fails for lack of one. Adds about 30 seconds a picture; decksmith_capabilities says which backend is configured.",
    ),
});

export type Settings = z.infer<typeof settingsSchema>;

/** `settings` as the multipart field names `parseOptions` already validates. */
function fieldsFor(s: Settings): Record<string, string> {
  const f: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined) f[k] = String(v);
  };
  put("format", s.format);
  put("theme", s.theme);
  put("lang", s.lang);
  put("tone", s.tone);
  put("density", s.density);
  put("duration", s.duration);
  put("slides", s.slides);
  put("speed", s.animation_speed);
  put("narrate", s.narrate);
  put("voice", s.voice);
  put("rate", s.rate);
  put("pitch", s.pitch);
  put("narrationDensity", s.narration_density);
  put("video", s.video);
  put("images", s.images);
  return f;
}

export const capabilitiesSchema = z.object({});

export const estimateSchema = z.object({
  settings: settingsSchema.describe("The same settings you would pass to decksmith_create_deck."),
});

export const createSchema = z.object({
  document_path: z
    .string()
    .optional()
    .describe("Absolute path to a markdown file. Must sit under the server's root."),
  document_text: z.string().optional().describe("The markdown itself, if you have no file."),
  settings: settingsSchema.optional(),
  wait_seconds: z
    .number()
    .min(0)
    .max(300)
    .optional()
    .describe(
      "How long to block before answering. Default 45. The job keeps running when this expires — poll decksmith_job_status with the id.",
    ),
});

export const statusSchema = z.object({
  job_id: z.string(),
  wait_seconds: z
    .number()
    .min(0)
    .max(300)
    .optional()
    .describe("Block up to this long for the job to finish or change stage. Default 45."),
});

/** How long a call blocks before answering with whatever is true. */
const DEFAULT_WAIT = 45;

export interface McpOptions {
  /** Documents must live under here. Nothing outside is readable. */
  root: string;
  /** Where jobs write. Defaults under the OS temp dir. */
  work: string;
  /** Injected in tests so no test reaches the network or the clock. */
  now?: () => number;
  /**
   * Injected for the same reason as `now`: which binaries a machine happens to
   * have is not what a test is about, and CI has no Codex. Defaults to the real
   * probe, so the server itself is unchanged.
   */
  probe?: () => Promise<Prereq[]>;
  /**
   * The environment the image backend is resolved from, for `capabilities` and
   * the refusal in `create`. Injected for the reason `probe` is. The pipeline
   * itself still reads `process.env` when its `illustrate` stage runs — in a
   * server the two are the same object, and a test never lets a job get there.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * The four tools, over one queue.
 *
 * Returned as plain functions rather than registered against a transport so the
 * tests can call them directly — the protocol is `main.ts`'s business and every
 * behaviour worth checking is here.
 */
export function deckTools(opts: McpOptions) {
  const queue = new Queue({ maxQueued: 8 });
  const root = resolve(opts.root);
  let cached: Prereq[] | undefined;

  const found = async () => {
    cached ??= await (opts.probe ?? prereqs)();
    return cached;
  };

  /**
   * A path an agent handed us, or a refusal.
   *
   * A stdio MCP server runs with the user's own credentials, so a path is a file
   * this process WILL read. Fenced to `root` with a separator-terminated prefix
   * test after `resolve`, which is what stops `/rootabc` passing for `/root` —
   * the same shape of check `src/server/upload.ts` uses on zip members.
   */
  const insideRoot = (p: string): string => {
    if (!isAbsolute(p)) throw new Error(`document_path must be absolute; got "${p}".`);
    const full = resolve(p);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(
        `document_path is outside the server's root. It may only read files under ${root}.`,
      );
    }
    return full;
  };

  return {
    /** Formats, themes, every setting's range, and what is actually installed. */
    async capabilities() {
      return {
        ...catalog(),
        // Over the catalogue's `{ backend }`: the same id, plus whether it can
        // be used and why not. The catalogue swallows that for the picker's
        // sake; an agent deciding whether to ask for pictures needs it.
        images: imageBackend(opts.env),
        prerequisites: await found(),
        root,
        work: opts.work,
      };
    },

    /**
     * What a duration/slides/density combination costs, before a minute of Codex
     * is spent finding out. Pure arithmetic — no job, no browser, instant.
     *
     * Returns `durationPlan`'s warnings VERBATIM. They are the product telling
     * the author what their settings cost ("60s over 12 slides leaves 85
     * characters a slide, which is one sentence"), and an MCP that swallowed
     * them would ship the exact failure this project keeps having.
     *
     * EVERY NUMBER HERE IS AT THE REQUESTED SLIDE COUNT, which is the only one a
     * pre-flight has — there is no plan yet, so there are no beats to strike the
     * budget at. `create` below builds the deck at the count the planner returns
     * (see `durationPlan`'s header), so a plan that comes back short reports
     * different numbers than this did, and `scanBeatCount` says by how much. The
     * field names carry it: `slides` is the request, and everything `_per_slide`
     * is per requested slide.
     */
    estimate(input: z.infer<typeof estimateSchema>) {
      const options = parseOptions(fieldsFor(input.settings));
      const plan = durationPlan(options.prefs);
      return {
        slides: options.prefs.slides,
        format: options.formatId,
        seconds_per_slide: plan.beatSeconds,
        animation_speed: plan.speed,
        narration_rate: plan.rate,
        characters_per_slide: plan.chars,
        sentences_per_slide: plan.sentences,
        speech_seconds_per_slide: plan.speechSeconds,
        warnings: [...plan.warnings, ...options.warnings],
      };
    },

    /** Submit a document, wait a bounded slice, report. */
    async create(input: z.infer<typeof createSchema>) {
      if (!input.document_path === !input.document_text) {
        throw new Error("Pass exactly one of document_path or document_text.");
      }
      const settings = input.settings ?? {};
      const options = parseOptions(fieldsFor(settings));

      // The fence BEFORE the probe below. It is pure string work — nothing is
      // read here — and a path outside the root is refused whatever happens to
      // be installed. Probing first meant a machine without Codex answered
      // `/etc/passwd` with "codex is not installed", which is the security check
      // reporting somebody else's news, and it is how the two tests that pin the
      // fence came to pass only on a machine that had Codex.
      const file = input.document_path ? insideRoot(input.document_path) : undefined;

      // BEFORE ANYTHING EXPENSIVE. A job that dies four minutes in because ffmpeg
      // is absent has spent a Codex plan to deliver a message this returns in
      // milliseconds.
      const missing = missingFor(await found(), options);
      if (missing.length) {
        throw new Error(
          `Cannot run this job: ${missing.map((m) => `${m.name} is not installed (needed for ${m.neededFor}) — ${m.install}`).join("; ")}`,
        );
      }
      // Pictures need nothing installed, so there is no `Prereq` for them — but
      // a backend the environment names and cannot use would fail this job a
      // minute in, after the plan is paid for. Same rule as above: refuse now,
      // and only a job that asked; a deck without pictures never meets this.
      if (options.images) {
        const images = imageBackend(opts.env);
        if (!images.ok) {
          throw new Error(
            `Cannot run this job: the image backend is misconfigured — ${images.why}. Or omit images.`,
          );
        }
      }

      const filename = input.document_path ? input.document_path.split(sep).pop() : "document.md";
      const bytes = file
        ? await readFile(file)
        : new TextEncoder().encode(input.document_text as string);
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(
          `Document is ${(bytes.byteLength / 1e6).toFixed(1)} MB, over the ${(MAX_UPLOAD_BYTES / 1e6).toFixed(0)} MB cap.`,
        );
      }

      const id = randomBytes(16).toString("base64url");
      const dir = join(opts.work, id);
      await mkdir(dir, { recursive: true });
      queue.submit({
        id,
        dir,
        stages: stagesFor(options),
        run: (handle) =>
          runPipeline(handle, {
            upload: { filename: filename ?? "document.md", bytes, fields: {} },
            options,
            // A stranger's document is not in play here — this is the user's own
            // machine and their own papers — but the guard downstream is the one
            // that resolves DNS and refuses link-local, and it stays on.
            fetchRemoteFigures: true,
          }),
      });
      return this.status({ job_id: id, wait_seconds: input.wait_seconds });
    },

    /** Poll, blocking up to `wait_seconds` for the job to move on. */
    async status(input: z.infer<typeof statusSchema>) {
      const seen = queue.view(input.job_id);
      if (!seen) throw new Error(`No job "${input.job_id}". It may have expired.`);
      const settled = await waitFor(queue, input.job_id, input.wait_seconds ?? DEFAULT_WAIT);
      return report(settled, dirOf(opts.work, input.job_id));
    },
  };
}

function dirOf(work: string, id: string): string {
  return join(work, id);
}

/**
 * Block until the job finishes or the slice expires, whichever comes first.
 *
 * Resolved from the queue's own watcher rather than by polling it, so a job that
 * finishes in two seconds answers in two seconds rather than at the end of the
 * slice. The unsubscribe runs on both paths — a watcher left attached to a
 * finished job is a leak per call.
 */
function waitFor(queue: Queue, id: string, seconds: number): Promise<JobView> {
  const now = queue.view(id) as JobView;
  if (now.state === "done" || now.state === "error" || seconds <= 0) return Promise.resolve(now);
  return new Promise((done) => {
    const finish = (v: JobView) => {
      clearTimeout(timer);
      stop();
      done(v);
    };
    const timer = setTimeout(() => finish(queue.view(id) as JobView), seconds * 1000);
    const stop = queue.watch(id, (v) => {
      if (v.state === "done" || v.state === "error") finish(v);
    });
  });
}

/**
 * A job view an agent can act on.
 *
 * `storyboard_path` is the point of this whole surface. AGENTS.md and every
 * `plan` run say the same thing — "read it and edit it before building, this is
 * where the quality is won" — and a storyboard is JSON on disk that an agent can
 * read and edit natively, which is a thing a human with a CLI almost never does.
 * So the path is handed back on every report, finished or not.
 */
function report(view: JobView, dir: string) {
  const done = view.state === "done";
  return {
    job_id: view.id,
    state: view.state,
    stage: view.stage,
    queue_position: view.queuePosition,
    elapsed_seconds: Math.round(view.ms / 1000),
    steps: view.steps.map((s) => ({ name: s.name, state: s.state })),
    log: view.log.slice(-12),
    ...(view.error ? { error: view.error } : {}),
    // `join(dir, "storyboard.json")` — where `runPipeline` actually writes it
    // (src/server/pipeline.ts). This said `src/storyboard.json` for one run, which
    // is the shape of the CLI's output directory and not the server's, and an
    // agent told to read it would have found nothing there.
    storyboard_path: join(dir, "storyboard.json"),
    ...(done && view.result
      ? {
          deck_path: join(dir, "deck"),
          slides: view.result.slides,
          duration_seconds: view.result.duration,
          warnings: view.result.warnings,
        }
      : {}),
    next: done
      ? "Read storyboard_path, and deck_path holds index.html plus any video."
      : view.state === "error"
        ? "Fix what the error names and call decksmith_create_deck again."
        : `Still ${view.state}. Call decksmith_job_status with this job_id to keep waiting.`,
  };
}

/** Where jobs write when nobody said. */
export function defaultWork(): string {
  return join(tmpdir(), "decksmith-mcp");
}

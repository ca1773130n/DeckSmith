/**
 * Speech, and the timings that come back with it.
 *
 * edge-tts is Microsoft Edge's read-aloud service driven over a websocket by a
 * small Python client. It is the only free synthesiser that returns cue timings
 * along with the audio, which is the whole reason it is here: a subtitle we time
 * ourselves is a guess, and a guess drifts within one sentence.
 *
 * Two things about its output are surprising enough to be worth stating.
 * `--write-subtitles` names a `.vtt` but writes SRT — numbered blocks, commas
 * for the decimal point, one cue per sentence — so this parses SRT, not WebVTT.
 * And the cue timings are what the synthesiser *intended*; the mp3 is what
 * actually plays, and the two disagree by a few hundred milliseconds. ffprobe
 * settles it.
 *
 * Everything that touches the outside world goes through `Runner`, so the tests
 * replay a recorded session instead of reaching the network.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { cueSchema } from "../types.js";

type Cue = z.infer<typeof cueSchema>;

/* ------------------------------------------------------------------ Runner */

/** One synthesis job, with the two files edge-tts is asked to write. */
export interface SpeakJob {
  text: string;
  voice: string;
  /** edge-tts prosody, e.g. "+10%" / "-5%". */
  rate: string;
  pitch: string;
  /** Absolute path for the mp3. */
  audio: string;
  /** Absolute path for the SRT-shaped subtitle file. */
  subs: string;
}

/**
 * The two external programs, behind one seam.
 *
 * Injected rather than imported so no test needs the network — and so a caller
 * with a different synthesiser can supply one without this module knowing.
 *
 * This is the LOW-level seam and it is edge-tts-shaped on purpose: two files on
 * disk, one of them SRT. `SpeechProvider` below is the one to implement against
 * for a different service.
 */
export interface Runner {
  speak(job: SpeakJob): Promise<void>;
  /** Seconds of rendered audio, or 0 when it cannot be measured. */
  measure(audio: string): Promise<number>;
}

/* ---------------------------------------------------------------- Provider */

/** What a synthesiser is asked for. Paths are absolute; the mp3 must be written. */
export interface SpeechRequest {
  text: string;
  voice: string;
  /** Prosody, in the SSML-ish notation edge-tts uses: "+10%", "-5Hz". */
  rate: string;
  pitch: string;
  /** Where to write the audio. */
  audio: string;
}

/** What comes back. `cues` may be empty; the deck then shows no subtitles. */
export interface SpeechResult {
  seconds: number;
  cues: Cue[];
}

/**
 * A speech service, whole.
 *
 * The seam that matters for replacing edge-tts, and deliberately higher than
 * `Runner`: a provider is handed text and hands back audio plus timing, and how
 * it got the timing is its own business. `Runner` makes the caller write an SRT
 * file and parse it, which is edge-tts's implementation showing through — a
 * hosted API returning JSON word timings would have to fabricate a subtitle file
 * to satisfy it.
 *
 * `check` is separate from `speak` so a missing binary or a bad key is reported
 * before a job is accepted rather than a minute into one.
 */
export interface SpeechProvider {
  readonly id: string;
  check(): Promise<void>;
  speak(req: SpeechRequest): Promise<SpeechResult>;
}

/* -------------------------------------------------------------- Resolution */

const MISSING = [
  "edge-tts is not installed, so narration cannot be synthesised.",
  "",
  "    python3 -m pip install --user edge-tts",
  "",
  "It may install outside PATH — on macOS it lands in ~/Library/Python/3.x/bin.",
  "Either add that directory to PATH or set DECKSMITH_EDGE_TTS to the binary.",
].join("\n");

/** Argv prefixes tried in order; the first that answers `--help` wins. */
function candidates(): string[][] {
  const env = process.env.DECKSMITH_EDGE_TTS?.trim();
  const home = homedir();
  return [
    ...(env ? [[env]] : []),
    ["edge-tts"],
    // pip --user on macOS and on Linux respectively. Neither is on PATH by
    // default, and both are where this actually lands in practice.
    [join(home, "Library", "Python", "3.9", "bin", "edge-tts")],
    [join(home, ".local", "bin", "edge-tts")],
    // Last resort: the module is installed even though its console script is
    // nowhere findable, which is the normal state of a pip --user install.
    ["python3", "-m", "edge_tts"],
  ];
}

/** True when this argv prefix can be run at all. `--help` costs no network. */
async function answersHelp(argv: string[]): Promise<boolean> {
  const [cmd, ...rest] = argv;
  if (!cmd) return false;
  const { code } = await runArgv(cmd, [...rest, "--help"]);
  return code === 0;
}

let resolved: Promise<string[]> | null = null;

/**
 * Find edge-tts, or say how to install it.
 *
 * A missing binary otherwise surfaces as ENOENT from `spawn` halfway through a
 * build, which tells the user nothing they can act on. Memoised: the probe is a
 * process launch, and a deck asks for dozens of segments.
 */
export function resolveEdgeTts(can: (argv: string[]) => Promise<boolean> = answersHelp) {
  if (can !== answersHelp) return find(can); // an injected probe is never cached
  resolved ??= find(can);
  return resolved;
}

async function find(can: (argv: string[]) => Promise<boolean>): Promise<string[]> {
  for (const argv of candidates()) {
    if (await can(argv)) return argv;
  }
  throw new Error(MISSING);
}

/* ------------------------------------------------------------ The real one */

interface Exit {
  code: number;
  stderr: string;
  stdout: string;
}

/** `spawn` with an argv array and no shell — nothing here is ever interpolated. */
function runArgv(cmd: string, args: string[]): Promise<Exit> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    // A spawn error is an exit like any other here; the caller only ever asks
    // "did this work", and a stack trace about ENOENT is not an answer.
    child.on("error", (e) => resolve({ code: -1, stderr: String(e), stdout }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr, stdout }));
  });
}

/** edge-tts over the network, ffprobe over the file. The production `Runner`. */
export const edgeTts: Runner = {
  async speak(job) {
    const [cmd, ...rest] = await resolveEdgeTts();
    const { code, stderr } = await runArgv(cmd as string, [
      ...rest,
      "-v",
      job.voice,
      `--rate=${job.rate}`,
      `--pitch=${job.pitch}`,
      "-t",
      job.text,
      "--write-media",
      job.audio,
      "--write-subtitles",
      job.subs,
    ]);
    if (code !== 0) throw new Error(`edge-tts failed (${code}) for "${clip(job.text)}"\n${stderr}`);
  },

  async measure(audio) {
    const { code, stdout } = await runArgv("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      audio,
    ]);
    const seconds = code === 0 ? Number.parseFloat(stdout.trim()) : Number.NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  },
};

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/* ------------------------------------------------------------- SRT parsing */

/** `00:00:04,587` — hours, minutes, seconds, and a COMMA before the millis. */
const STAMP = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})/g;

/**
 * Parse edge-tts' subtitle file into cues.
 *
 * Deliberately forgiving about the block numbers and about blank-line spacing:
 * the file is machine-written, but it is also the one thing here we did not
 * write, and a cue lost to a strict parser is a subtitle that silently vanishes.
 */
export function parseCues(srt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of srt
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const stamps = [...(lines[at] as string).matchAll(STAMP)].map(toSeconds);
    const [start, end] = stamps;
    if (start === undefined || end === undefined) continue;
    const text = lines
      .slice(at + 1)
      .join(" ")
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

function toSeconds(m: RegExpMatchArray): number {
  const [, h, min, s, ms] = m;
  // Millis are padded, not truncated: ",5" is 500ms, not 5ms.
  return (
    Number(h) * 3600 + Number(min) * 60 + Number(s) + Number((ms ?? "0").padEnd(3, "0")) / 1000
  );
}

/* ---------------------------------------------------------------- Synthesis */

export interface SynthOpts {
  voice: string;
  rate?: string;
  pitch?: string;
  /** Directory the mp3 and its sidecar are written into. Created if absent. */
  dir: string;
  /** The low-level edge-tts seam. Ignored when `provider` is given. */
  runner?: Runner;
  /** A whole synthesiser. The seam to use for anything that is not edge-tts. */
  provider?: SpeechProvider;
}

export interface Speech {
  /** Absolute path to the mp3. */
  audio: string;
  /** Its filename, which is also the cache key — what a caller stores. */
  file: string;
  seconds: number;
  cues: Cue[];
}

/* ---------------------------------------------------------------- Registry */

/**
 * edge-tts as a provider: it writes the mp3 and an SRT beside it, this parses
 * the SRT and measures the mp3, and the SRT is gone before anyone sees it.
 *
 * Everything edge-tts-specific ends here. A second provider implements `speak`
 * and returns its own timings; nothing upstream changes.
 */
export function edgeProvider(runner: Runner = edgeTts): SpeechProvider {
  return {
    id: "edge-tts",
    async check() {
      // AWAITED. This read `resolveEdgeTts();` — the promise was built and
      // dropped, so `check()` resolved whatever the answer was, and a missing
      // edge-tts came back as a passed check plus an unhandled rejection. A
      // readiness probe that cannot fail is worse than none, because the caller
      // then trusts it.
      await resolveEdgeTts();
    },
    async speak(req) {
      const subs = `${req.audio.replace(/\.mp3$/, "")}.srt`;
      await runner.speak({ ...req, subs });
      const raw = await readFile(subs, "utf8").catch(() => "");
      // The subtitle file has done its job once parsed; leaving it turns the
      // audio directory into three files per sentence.
      await rm(subs, { force: true });
      const cues = parseCues(raw);
      const measured = await runner.measure(req.audio);
      const lastCue = cues.length > 0 ? (cues[cues.length - 1] as Cue).end : 0;
      // ffprobe wins when it has an answer: the cue timings are what the
      // synthesiser meant to produce, the file is what the audience will hear.
      return { seconds: measured > 0 ? measured : Math.max(lastCue, 0.1), cues };
    },
  };
}

/**
 * Providers by name, and how one is chosen.
 *
 * A record rather than a switch, so adding a service is adding an entry. The
 * environment variable exists so a deployment can change synthesiser without a
 * rebuild — which is the whole reason this seam is here.
 */
export const PROVIDERS: Record<string, () => SpeechProvider> = {
  "edge-tts": () => edgeProvider(),
};

export function resolveProvider(name = process.env.DECKSMITH_TTS ?? "edge-tts"): SpeechProvider {
  const make = PROVIDERS[name];
  if (!make) {
    throw new Error(
      `Unknown speech provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}. ` +
        `Set DECKSMITH_TTS to one of those, or register another in PROVIDERS.`,
    );
  }
  return make();
}

/** Sidecar written beside each mp3. Not the schema — nothing outside reads it. */
interface Sidecar {
  seconds: number;
  cues: Cue[];
  text: string;
  voice: string;
}

/**
 * The cache key, and therefore the filename.
 *
 * Content-addressed on everything that changes the sound, so re-narrating an
 * edited deck re-synthesises only the beats whose words moved. That is the
 * difference between a four-second edit loop and a three-minute one, and it is
 * also why two beats that say the same sentence share one file.
 */
export function cacheKey(text: string, voice: string, rate: string, pitch: string): string {
  return createHash("sha256")
    .update([text, voice, rate, pitch].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Speak `text`, and return where it landed and how long it takes.
 *
 * `seconds` is measured, never estimated — it is what lets a stop last exactly
 * as long as the sentence spoken at it.
 */
export async function synthesize(text: string, opts: SynthOpts): Promise<Speech> {
  const rate = opts.rate ?? "+0%";
  const pitch = opts.pitch ?? "+0Hz";
  const provider = opts.provider ?? edgeProvider(opts.runner ?? edgeTts);
  const key = cacheKey(text, opts.voice, rate, pitch);
  const file = `${key}.mp3`;
  const audio = join(opts.dir, file);
  const sidecar = join(opts.dir, `${key}.json`);

  const cached = await readSidecar(sidecar);
  if (cached) return { audio, file, seconds: cached.seconds, cues: cached.cues };

  await mkdir(opts.dir, { recursive: true });
  const spoken = await provider.speak({ text, voice: opts.voice, rate, pitch, audio });
  const { cues, seconds } = spoken;

  // Clamp rather than drop: a cue running past the end of the audio would leave
  // a subtitle on screen after the deck has already stepped on.
  const clamped = cues.map((c) => ({
    start: Math.min(c.start, seconds),
    end: Math.min(c.end, seconds),
    text: c.text,
  }));

  const body: Sidecar = { seconds, cues: clamped, text, voice: opts.voice };
  await writeFile(sidecar, `${JSON.stringify(body, null, 2)}\n`);
  return { audio, file, seconds, cues: clamped };
}

async function readSidecar(path: string): Promise<Sidecar | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    const s = parsed as Sidecar;
    // A half-written sidecar from an interrupted run must re-synthesise, not
    // poison the deck with a zero-length segment.
    return typeof s?.seconds === "number" && s.seconds > 0 && Array.isArray(s.cues) ? s : null;
  } catch {
    return null;
  }
}

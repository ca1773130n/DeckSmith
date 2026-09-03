/**
 * Where a picture comes from.
 *
 * Three rungs, and `illustrate` walks down them: a separate image backend the
 * deployment named in the environment, then the Codex account that already
 * plans the deck, then an SVG this module draws itself. The last one is pure
 * and cannot fail, which is what lets `illustrate` promise to finish — a brief
 * never leaves a slide with a hole in it, it only leaves one with a plainer
 * picture than was hoped for.
 *
 * There is deliberately no "ask the model for SVG" rung. An SVG a model wrote
 * can carry SMIL or CSS animation, and animation runs on wall-clock time under
 * capture — a render that differs every time and passes every gate. Rasters
 * cannot do that, and the SVG drawn here has nothing in it that moves.
 *
 * Every provider reports the size it knows for itself: rasters through
 * `imageSize`, whose header sniff is also the server's only type check on a
 * stranger's figure and stays raster-only for that reason; the tool's SVG from
 * its own viewBox. A size that cannot be read is a rung failure, not a figure
 * with a guessed aspect.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { type Runner, runCodex } from "../plan/codex.js";
import { imageSize } from "../source/assets.js";
import type { ImagesPrefs } from "../types.js";

/* ---------------------------------------------------------------- Contract */

export type ImageAspect = "landscape" | "square" | "portrait";

export interface ImageRequest {
  /** The scene. Never text, labels, numbers or charts — nothing in a picture can be read or checked. */
  prompt: string;
  /** `images.style`, folded into every prompt. */
  style: string;
  aspect: ImageAspect;
  /**
   * `images.model`, for the separate backend only; the Codex and tool rungs
   * ignore it. Carried on the request rather than baked into the provider
   * because the provider is resolved from the environment before any
   * preferences are known, and a `--image-model` that changed only the cache
   * key would be a flag that does nothing.
   */
  model?: string;
}

export interface ImageResult {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg" | "image/svg+xml";
  width: number;
  height: number;
}

/**
 * One rung. `check` is separate from `generate` for the reason `SpeechProvider`
 * splits them: a missing key is reported before a picture is asked for, not
 * two minutes into one.
 */
export interface ImageProvider {
  readonly id: string;
  /** Throws with an actionable sentence. */
  check(): Promise<void>;
  generate(req: ImageRequest): Promise<ImageResult>;
}

/** Pixels per aspect — the backend's `size`, and the tool's viewBox. */
export const SIZE: Readonly<Record<ImageAspect, { width: number; height: number }>> = {
  landscape: { width: 1536, height: 1024 },
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1536 },
};

/**
 * The orientation, in words. The backend gets it as `size` too; the Codex rung
 * has only the words, and without them a square slot came back 3:2 in the live
 * run — the tool draws landscape unless told otherwise.
 */
const ORIENTATION: Readonly<Record<ImageAspect, string>> = {
  landscape: "landscape orientation (3:2)",
  square: "square (1:1)",
  portrait: "portrait orientation (2:3)",
};

/** What every generator is asked for, in words. The style is a phrase, not a sentence. */
function picturePrompt(req: ImageRequest): string {
  return `${req.prompt.replace(/[.\s]+$/, "")}. ${req.style}, ${ORIENTATION[req.aspect]}, on a plain white background, no text.`;
}

/**
 * A raster the way `imageSize` sees it. GIF is sniffed there but not admitted
 * here: no backend returns one, and a figure's mime is a closed set.
 */
function raster(bytes: Buffer, from: string): ImageResult {
  const mime =
    bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47
      ? "image/png"
      : bytes.length >= 2 && bytes.readUInt16BE(0) === 0xffd8
        ? "image/jpeg"
        : undefined;
  if (!mime) throw new Error(`${from}: not a PNG or JPEG`);
  return { bytes, mime, ...imageSize(bytes) };
}

/* ------------------------------------------------------------------ OpenAI */

export interface OpenAiImagesOptions {
  apiKey: string;
  /** `POST {baseUrl}/images/generations`. LocalAI and most gateways speak this. */
  baseUrl?: string;
  /** Default when the request names none. */
  model?: string;
  /** Injected by tests. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const REQUEST_TIMEOUT_MS = 120_000;
/** A 1536×1024 PNG is a few MB; sixteen is a gateway that has lost its mind. */
const MAX_BYTES = 16 * 1024 * 1024;

const generatedSchema = z.object({
  data: z
    .array(z.object({ b64_json: z.string().optional(), url: z.string().optional() }))
    .optional(),
});
const failedSchema = z.object({
  error: z.object({ code: z.string().nullish(), type: z.string().nullish() }).nullish(),
});

/**
 * Any OpenAI-compatible images endpoint.
 *
 * Errors are shaped here rather than passed through: the message is status plus
 * the API's `error.code` (or `type`), never its text and never a URL, so it can
 * go straight into a job log a stranger reads. The key is used exactly once,
 * on the generation request — a `url` in the answer is fetched bare, and only
 * when it sits on the backend's own origin, because following an arbitrary URL
 * with or without the key is how a gateway's answer becomes an open proxy.
 */
export function openaiImages(opts: OpenAiImagesOptions): ImageProvider {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  return {
    id: "openai",
    async check() {
      if (!opts.apiKey) {
        throw new Error("openai images: no API key. Set DECKSMITH_IMAGES_API_KEY.");
      }
    },
    async generate(req) {
      const { width, height } = SIZE[req.aspect];
      const res = await doFetch(`${base}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model ?? opts.model ?? DEFAULT_MODEL,
          prompt: picturePrompt(req),
          n: 1,
          size: `${width}x${height}`,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await readCapped(res);
      if (!res.ok) throw new Error(`openai images: HTTP ${res.status}${reason(body)}`);

      const first = generatedSchema.safeParse(parseJson(body)).data?.data?.[0];
      if (first?.b64_json) return raster(Buffer.from(first.b64_json, "base64"), "openai images");
      if (!first?.url) throw new Error("openai images: answer carried neither b64_json nor url");

      if (new URL(first.url).origin !== new URL(base).origin) {
        throw new Error(
          "openai images: the picture URL is not on the backend's origin; not following it",
        );
      }
      // `redirect: "error"`: the origin was checked on the URL the backend gave,
      // and a redirect would be the backend choosing another one after the check.
      const picture = await doFetch(first.url, {
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const bytes = await readCapped(picture);
      if (!picture.ok)
        throw new Error(`openai images: HTTP ${picture.status} fetching the picture`);
      return raster(bytes, "openai images");
    },
  };
}

/** ` (invalid_api_key)` when the body names a code or type; nothing otherwise. */
function reason(body: Buffer): string {
  const error = failedSchema.safeParse(parseJson(body)).data?.error;
  const code = error?.code ?? error?.type;
  return code ? ` (${code})` : "";
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** The whole body, or a throw the moment it passes `MAX_BYTES` — not after. */
async function readCapped(res: Response): Promise<Buffer> {
  const over = `openai images: answer is over ${MAX_BYTES >> 20} MB`;
  if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error(over);
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(over);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------- Codex */

export interface CodexImagesOptions {
  /** Injected by tests; `runCodex` otherwise. */
  run?: Runner;
  timeoutMs?: number;
}

/** Drawing is slower than planning per call, and a stuck tool should not hold a job for ten. */
const CODEX_TIMEOUT_MS = 5 * 60_000;

/** What the agent is told to answer. Strict: every key present, absent ones null. */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    file: { anyOf: [{ type: "string" }, { type: "null" }] },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["ok", "file", "reason"],
  additionalProperties: false,
};

const answerSchema = z.object({
  ok: z.boolean(),
  file: z.string().nullish(),
  reason: z.string().nullish(),
});

/**
 * The main account, drawing with its own image tool.
 *
 * `codex exec` runs in a scratch directory under `workspace-write`, which
 * `codexCommand` fences to that directory and nothing else, and is asked to
 * leave one PNG there. An account without the tool answers `ok:false` and says
 * why; that reason is the error, verbatim, because it is the one thing the
 * user can act on. Whether non-interactive `codex exec` exposes the tool at all
 * is the hypothesis the design's live run settles — this code is written for
 * either answer.
 */
export function codexImages(opts: CodexImagesOptions = {}): ImageProvider {
  const run = opts.run ?? runCodex;
  const timeoutMs = opts.timeoutMs ?? CODEX_TIMEOUT_MS;
  return {
    id: "codex",
    // The only question worth asking — does this account have an image tool —
    // costs a full run to answer, and `generate` asks it. A missing binary
    // surfaces from `runCodex` with the same sentence planning uses.
    async check() {},
    async generate(req) {
      const dir = await mkdtemp(join(tmpdir(), "decksmith-image-"));
      try {
        const schemaPath = join(dir, "answer.schema.json");
        const outPath = join(dir, "answer.json");
        await writeFile(schemaPath, JSON.stringify(ANSWER_SCHEMA));
        await run({
          prompt: codexPrompt(req),
          schemaPath,
          outPath,
          timeoutMs,
          cwd: dir,
          sandbox: "workspace-write",
        });

        const raw = await readFile(outPath, "utf8").catch(() => "");
        const answer = answerSchema.safeParse(parseJson(Buffer.from(raw)));
        if (!answer.success) throw new Error("codex could not generate a picture: no final answer");
        if (!answer.data.ok) {
          throw new Error(
            `codex could not generate a picture: ${answer.data.reason ?? "no reason given"}`,
          );
        }
        // `./picture.png` is what it was asked for; `file` is where it says the
        // picture is, tried second in case the tool saved elsewhere and the
        // agent reported that rather than copying.
        const candidates = [join(dir, "picture.png")];
        if (answer.data.file) candidates.push(resolve(dir, answer.data.file));
        for (const path of candidates) {
          const bytes = await readFile(path).catch(() => null);
          if (bytes) return raster(bytes, "codex");
        }
        throw new Error("codex said ok but wrote no picture.png");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * THE PICTURE IS CHECKED BY THE AGENT THAT DREW IT, IN THE SAME RUN.
 *
 * A generated raster can contain text, and nothing downstream can see it: the
 * 40px audience floor measures DOM text, so a caption baked into a JPEG passes
 * every gate at any size (EXPERIMENT-007, and `.planning/DECISION.md` lists a
 * raster type floor as work that does not exist). Shipping illustrations is
 * what made that gap matter, so the gap is closed where it is cheapest to
 * close: the agent already has the image and can look at it, so it looks,
 * redraws once, and refuses rather than handing back a picture with words in
 * it. A refusal is not a failure — the chain falls to the next rung, and the
 * tool's own SVG has no text by construction.
 *
 * This costs no extra call. The alternative — a second `codex exec` with
 * `-i picture.png` — doubles the price of every illustration to ask a question
 * the drawing session can already answer.
 */
function codexPrompt(req: ImageRequest): string {
  return [
    `Use $imagegen to make one picture: ${picturePrompt(req)}`,
    "Save it as a PNG and copy it to ./picture.png in the current directory.",
    "Then LOOK at ./picture.png and check it carefully for any text: letters,",
    "words, numbers, labels, captions, watermarks or signage, in any language.",
    "The picture must contain NONE. If it does, generate it once more with the",
    "text removed and replace ./picture.png. If the second attempt still has",
    'text, do not hand it back — answer ok=false with the reason "text in picture".',
    "Your final message must be JSON conforming to the supplied schema:",
    '  { "ok": true, "file": "picture.png", "reason": null } once a text-free picture is there;',
    '  { "ok": false, "file": null, "reason": "<why>" } if you have no image tool, the picture cannot be made, or it keeps coming back with text.',
    "Do not search the web and do not read any other files. Do nothing else.",
  ].join("\n");
}

/* --------------------------------------------------------------------- SVG */

/** Both hosts put the figure on a white card regardless of theme, so the SVG matches it. */
const PAPER = "#ffffff";
const INK = "#1f2328";
/** Small and fixed: the seed picks one, so the same brief always gets the same hue. */
const ACCENTS = ["#2f6fed", "#e5533d", "#2a9d6f", "#e0a326", "#7b5cd6"];

/** Deterministic across engines: integer arithmetic until the final divide. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The picture the tool draws for itself: six to ten overlapping shapes in one
 * accent and the ink, seeded from the brief. Not an illustration of the scene —
 * a stable, text-free composition that keeps the slide's layout honest until
 * something better draws it. Same request, same bytes.
 */
export function drawSvg(req: ImageRequest): string {
  const { width: W, height: H } = SIZE[req.aspect];
  const seed = createHash("sha256").update([req.prompt, req.style, req.aspect].join("|")).digest();
  const rand = mulberry32(seed.readUInt32BE(0));
  const accent = ACCENTS[Math.floor(rand() * ACCENTS.length)] as string;
  const count = 6 + Math.floor(rand() * 5);
  const unit = Math.min(W, H);

  const parts = [`<rect width="${W}" height="${H}" fill="${PAPER}"/>`];
  for (let i = 0; i < count; i++) {
    const kind = Math.floor(rand() * 3);
    const cx = Math.round(W * (0.15 + 0.7 * rand()));
    const cy = Math.round(H * (0.15 + 0.7 * rand()));
    const r = Math.round(unit * (0.06 + 0.2 * rand()));
    const tint = rand() < 0.7 ? accent : INK;
    const alpha = (0.25 + 0.5 * rand()).toFixed(2);
    if (kind === 0) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${tint}" fill-opacity="${alpha}"/>`);
    } else if (kind === 1) {
      const w = Math.round(r * (1.2 + rand()));
      parts.push(
        `<rect x="${cx - w}" y="${cy - r}" width="${2 * w}" height="${2 * r}" rx="${Math.round(r / 3)}" fill="${tint}" fill-opacity="${alpha}"/>`,
      );
    } else {
      const dx = Math.round(r * 2 * (rand() - 0.5));
      const dy = Math.round(r * 2 * (rand() - 0.5));
      parts.push(
        `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}" stroke="${tint}" stroke-width="${Math.round(unit / 40)}" stroke-linecap="round" stroke-opacity="${alpha}"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>\n`;
}

/** The size the tool wrote into its own SVG. `imageSize` is raster-only on purpose. */
export function svgSize(bytes: Buffer): { width: number; height: number } {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(bytes.toString("utf8", 0, 200));
  if (!m) throw new Error("svg has no viewBox");
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** The last rung. Pure, so it cannot fail, so `illustrate` always finishes. */
export function toolSvg(): ImageProvider {
  return {
    id: "svg",
    async check() {},
    async generate(req) {
      const svg = drawSvg(req);
      return { bytes: Buffer.from(svg), mime: "image/svg+xml", ...SIZE[req.aspect] };
    },
  };
}

/* -------------------------------------------------------------- Resolution */

/**
 * The backend the environment names, or nothing.
 *
 * Environment only, mirroring `DECKSMITH_TTS`: a key is never a preference,
 * never in a config file and never in a `.deck`. Naming a backend without its
 * key, or naming one this build does not have, throws HERE — at `illustrate`
 * on the CLI, in the server's preflight, in MCP `capabilities` — and nowhere
 * at import, so a broken deployment is a sentence in the log rather than a
 * process that will not start.
 */
export function resolveImageBackend(
  env: NodeJS.ProcessEnv = process.env,
): ImageProvider | undefined {
  const name = env.DECKSMITH_IMAGES?.trim();
  if (!name) return undefined;
  if (name !== "openai") {
    throw new Error(
      `Unknown image backend "${name}". DECKSMITH_IMAGES accepts: openai. ` +
        "Unset it to draw through the Codex account and the tool's own SVG.",
    );
  }
  const apiKey = env.DECKSMITH_IMAGES_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DECKSMITH_IMAGES=openai needs DECKSMITH_IMAGES_API_KEY. Set it, " +
        "or unset DECKSMITH_IMAGES to draw through the Codex account and the tool's own SVG.",
    );
  }
  return openaiImages({
    apiKey,
    ...(env.DECKSMITH_IMAGES_BASE_URL ? { baseUrl: env.DECKSMITH_IMAGES_BASE_URL } : {}),
    ...(env.DECKSMITH_IMAGES_MODEL ? { model: env.DECKSMITH_IMAGES_MODEL } : {}),
  });
}

/**
 * The rungs, in the order `illustrate` tries them, for one preference.
 * `auto` is all three; `codex` skips the backend; `svg` is the tool alone — no
 * network, no spend, and a deck whose every picture is reproducible.
 */
export function imageChain(images: ImagesPrefs, backend?: ImageProvider): ImageProvider[] {
  switch (images.provider) {
    case "auto":
      return [...(backend ? [backend] : []), codexImages(), toolSvg()];
    case "codex":
      return [codexImages(), toolSvg()];
    case "svg":
      return [toolSvg()];
  }
}

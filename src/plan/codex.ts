/**
 * Planning, backed by the Codex CLI already installed on the machine.
 *
 * Planning is the one step that needs a model, and metered API tokens are a poor
 * trade for a step whose whole design is that a human reads and edits it. `codex
 * exec` runs under the subscription that is already paid for, and its
 * `--output-schema` gives the same guarantee an API structured-output call does:
 * the final message is schema-conformant JSON and nothing else — no prose, no
 * code fences to strip.
 *
 * Two gates, deliberately redundant. The schema makes the response well-formed;
 * `storyboardSchema.parse` proves it anyway, because the schema handed to the CLI
 * is a lossy subset (see `forStructuredOutput`). Then `assertRefsResolve` proves
 * the storyboard is about *this* source — the property no schema can express and
 * the one a planner actually gets wrong.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Prefs } from "../prefs.js";
import { prefsSchema, type Source, type Storyboard, storyboardSchema } from "../types.js";
import { renderSource, systemPrompt } from "./prompt.js";
import { assertRefsResolve } from "./refs.js";

/** Planning a long source is minutes of work, not seconds. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * Keywords JSON Schema supports but structured-output backends generally do not.
 * Dropping them loses only redundant validation — `storyboardSchema.parse` still
 * enforces every one of them on the way back.
 */
const UNSUPPORTED = new Set([
  "$schema",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

/**
 * Rewrite a zod-emitted JSON Schema into the strict dialect the backend accepts.
 *
 * The one that is not obvious, and that no amount of reading found — it took the
 * first live call to surface: **every key in `properties` must appear in
 * `required`.** Leaving an optional field out is a 400, not a permissive
 * default. So optionality is expressed the only way strict mode allows: the key
 * is required, and its value may be null. `stripNulls` turns those back into
 * `undefined` on the way in, which is what zod's `.optional()` expects.
 */
function forStructuredOutput(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forStructuredOutput);
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (UNSUPPORTED.has(key)) continue;
    out[key === "oneOf" ? "anyOf" : key] = forStructuredOutput(value);
  }

  if (out.type === "object") {
    out.additionalProperties = false;
    const properties = out.properties as Record<string, unknown> | undefined;
    if (properties) {
      const wasRequired = new Set((src.required as string[] | undefined) ?? []);
      for (const key of Object.keys(properties)) {
        if (wasRequired.has(key)) continue;
        properties[key] = { anyOf: [properties[key], { type: "null" }] };
      }
      out.required = Object.keys(properties);
    }
  }
  return out;
}

/**
 * Drop the nulls that stand in for absent optional fields. Only object keys:
 * an explicit null inside an array would be data, and the schema never asks for
 * one.
 */
function stripNulls(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNulls);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null) continue;
    out[key] = stripNulls(value);
  }
  return out;
}

// `io: "input"` so fields carrying a zod default stay optional — the model must
// not be forced to invent a theme name it has never seen.
export const SCHEMA = forStructuredOutput(z.toJSONSchema(storyboardSchema, { io: "input" }));

export interface CodexOptions {
  /** Left unset by default: use whatever model the user's Codex is configured for. */
  model?: string;
  timeoutMs?: number;
  /**
   * What the person asking for the deck chose. Omitted means the schema's
   * defaults, which is what a bare `codexPlanner(source)` has always sent.
   */
  prefs?: Prefs;
  /** Swappable so a test can drive the real parse path without spawning anything. */
  run?: Runner;
}

/** What the planner needs from the outside world: a prompt in, a final message out. */
export type Runner = (args: {
  prompt: string;
  schemaPath: string;
  outPath: string;
  model?: string;
  timeoutMs: number;
}) => Promise<void>;

export async function codexPlanner(source: Source, opts: CodexOptions = {}): Promise<Storyboard> {
  const dir = await mkdtemp(join(tmpdir(), "decksmith-plan-"));
  try {
    const schemaPath = join(dir, "storyboard.schema.json");
    const outPath = join(dir, "storyboard.json");
    await writeFile(schemaPath, JSON.stringify(SCHEMA));

    await (opts.run ?? runCodex)({
      prompt: buildPrompt(source, opts.prefs ?? prefsSchema.parse({})),
      schemaPath,
      outPath,
      ...(opts.model === undefined ? {} : { model: opts.model }),
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const raw = await readFile(outPath, "utf8").catch(() => "");
    if (raw.trim() === "") {
      throw new Error("Codex produced no final message. Re-run, or try a shorter source.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Codex's final message was not JSON, so --output-schema did not hold. First 200 chars:\n${raw.slice(0, 200)}`,
      );
    }

    const result = storyboardSchema.safeParse(stripNulls(parsed));
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Codex returned a storyboard that does not validate:\n${issues}`);
    }

    assertRefsResolve(result.data, source);
    return result.data;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The prompt. Codex `exec` has no separate system slot, so the instructions and
 * the source travel together — and it is told not to search, because everything
 * it needs is in this message and a search is latency and tokens spent on
 * nothing.
 */
function buildPrompt(source: Source, prefs: Prefs): string {
  return `${systemPrompt(prefs)}

Do not search the web and do not read files. Everything you need is below.
Return the storyboard as your final message, conforming to the supplied schema.

${renderSource(source)}`;
}

function runCodex(args: {
  prompt: string;
  schemaPath: string;
  outPath: string;
  model?: string;
  timeoutMs: number;
}): Promise<void> {
  // read-only sandbox: planning is a pure text transform and has no business
  // touching the workspace. --ephemeral keeps session files out of the user's
  // Codex history for what is a library call, not a conversation.
  const argv = [
    "exec",
    "--output-schema",
    args.schemaPath,
    "-o",
    args.outPath,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    ...(args.model ? ["--model", args.model] : []),
    "-",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("codex", argv, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Codex did not finish within ${Math.round(args.timeoutMs / 1000)}s.`));
    }, args.timeoutMs);

    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error(
              'The "codex" CLI is not on PATH. Install it, or sign in with `codex login`, then retry.',
            )
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        new Error(`codex exec exited ${code}.\n${stderr.trim().split("\n").slice(-8).join("\n")}`),
      );
    });

    child.stdin.end(args.prompt);
  });
}

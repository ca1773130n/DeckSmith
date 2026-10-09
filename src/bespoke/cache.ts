/**
 * Content-addressed storage for generated scenes, so a rebuild never pays twice.
 *
 * THE KEY IS EVERYTHING THE SCENE WAS DRAWN FROM, and nothing else: the beat's
 * own words and parameters, the paper excerpts the prompt quoted, the cue
 * timings (the keyframes), the box it was drawn into, the pack's colours and
 * faces, the prompt and contract versions, and the model. Change any of those
 * and the old scene is wrong for the new beat, so it is a miss. Change anything
 * else — the scene's position in the deck, the deck's other beats, the build
 * directory — and it is the same scene, so it is a hit.
 *
 * VERDICTS ARE CACHED, NOT ONLY SCENES. A beat whose scene failed the gates
 * after its critique round is recorded as `rejected`, and a rebuild falls back
 * to its archetype without calling anyone. What is NOT recorded is a fallback
 * the beat did not earn — a call cap, a quota, a timeout — because those say
 * nothing about the beat and the next build may well have the budget.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Fragment } from "./contract.js";

/** Bump when the shape of an entry changes. */
export const CACHE_VERSION = 1;

/** What a key is computed from. Every field is part of the scene's meaning. */
export interface KeyInput {
  promptVersion: string;
  contractVersion: string;
  /** `codex exec --model`, or `"default"` for the account's own. */
  model: string;
  lang: string;
  beat: {
    id: string;
    archetype: string;
    intent: string;
    claim?: string;
    narration?: string;
    params: unknown;
  };
  /** The paper excerpts and equations the prompt quoted, verbatim. */
  context: string;
  /** Scene-relative cue windows and their words. */
  cues: ReadonlyArray<{ t0: number; t1: number; text: string }>;
  duration: number;
  holds: readonly number[];
  region: { width: number; height: number };
  /** The pack: name, colours, faces. */
  pack: unknown;
  /** The illustration's art key (src/bespoke/art.ts), when the scene was drawn around one. */
  art?: string;
  /**
   * The scene's visual device and its idea (`assignDevices`): both are in its
   * prompt. The beat's own only — no other beat's device is in a scene's
   * prompt, so editing one beat does not re-key the scenes after it.
   */
  device?: string;
  idea?: string;
  /** The shot grammar of an illustrated scene: it is in the prompt (rule 10). */
  grammar?: string;
}

export interface CacheEntry {
  version: number;
  key: string;
  verdict: "accepted" | "rejected";
  fragment?: Fragment;
  /** Why it was rejected, or which round's scene was kept. */
  note: string;
  /** Codex calls it took to reach this verdict. */
  calls: number;
  model: string;
  promptVersion: string;
  /**
   * `GATES_VERSION` when the verdict was reached. A rejection is the gates'
   * opinion, so one from other gates is not trusted; an acceptance is re-gated
   * on every build anyway.
   */
  gates?: string;
  /** The art key of the illustration the scene places, when it has one. */
  art?: string;
}

/** JSON with sorted keys, so two equal objects hash equal whatever order they were built in. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export function cacheKey(input: KeyInput): string {
  return createHash("sha256").update(canonical(input)).digest("hex").slice(0, 32);
}

/** `$XDG_CACHE_HOME/decksmith/bespoke`, else `~/.cache/decksmith/bespoke`. */
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "decksmith", "bespoke");
}

export class SceneCache {
  constructor(readonly dir: string) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const text = await readFile(join(this.dir, `${key}.json`), "utf8").catch(() => null);
    if (text === null) return undefined;
    try {
      const entry = JSON.parse(text) as CacheEntry;
      // A file from another shape is a miss, not a crash: the next write replaces it.
      if (entry.version !== CACHE_VERSION || entry.key !== key) return undefined;
      if (entry.verdict === "accepted" && !entry.fragment) return undefined;
      return entry;
    } catch {
      return undefined;
    }
  }

  /** Written to a temp name and renamed, so a reader never sees half an entry. */
  async put(entry: CacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${entry.key}.json`);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`);
    await rename(tmp, path);
  }
}

/**
 * The `.deck` container: a ZIP holding `deck.json`, the baked `media/`, and the
 * narration `audio/`.
 *
 * A pack carries the source and the storyboard, never a built deck. The HTML is
 * a projection of those two — every format profile builds a different one from
 * the same pack — so shipping it would be shipping a stale copy of something
 * that regenerates in a second.
 *
 * Reading is the interesting half. A pack arrives from other people, so nothing
 * inside it is trusted: the version is checked before the manifest is believed,
 * the manifest is validated against `packSchema`, entry paths are checked for
 * escapes, and every failure mode surfaces as a sentence rather than as a
 * decompressor's internal error.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { unzipSync, zipSync } from "fflate";
import type { z } from "zod";
import { PACK_VERSION, packSchema } from "../types.js";

export type Pack = z.infer<typeof packSchema>;

/** Everything in the archive except `deck.json`, keyed by its path inside it. */
export type PackFiles = Record<string, Uint8Array>;

/**
 * A fixed timestamp, so the same pack twice is the same bytes twice. The zip
 * date field starts at 1980 and is stored in local time, hence a midday date
 * safely inside that year rather than the epoch.
 */
const MTIME = Date.UTC(1980, 0, 2, 12);

/** Already-compressed payloads; deflating them again buys nothing but minutes. */
const STORED = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp3",
  ".m4a",
  ".mp4",
  ".webm",
  ".mov",
  ".ogg",
  ".opus",
  ".woff",
  ".woff2",
]);

/** Write `out`, returning the size of the pack so a caller can report it. */
export async function writePack(pack: Pack, files: PackFiles, out: string): Promise<number> {
  const manifest = packSchema.parse(pack); // a malformed pack should never reach disk
  for (const m of manifest.media) {
    if (m.policy !== "bake") continue;
    if (!m.path) throw new Error(`media "${m.id}" is baked but has no path`);
    if (!(m.path in files)) throw new Error(`media "${m.id}" is baked but ${m.path} was not given`);
  }
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {
    "deck.json": new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  // Sorted so the archive's byte order does not depend on the caller's map order.
  for (const path of Object.keys(files).sort()) {
    const bytes = files[path];
    if (!bytes) continue;
    if (path === "deck.json") throw new Error("deck.json is written from the manifest, not passed");
    check(path);
    entries[path] = STORED.has(extname(path).toLowerCase()) ? [bytes, { level: 0 }] : bytes;
  }
  const zip = zipSync(entries, { mtime: MTIME });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, zip);
  return zip.length;
}

export async function readPack(path: string): Promise<{ pack: Pack; files: PackFiles }> {
  return openPack(new Uint8Array(await readFile(path)), path);
}

/** The parse half of `readPack`, separated so bytes from anywhere can be checked. */
export function openPack(bytes: Uint8Array, label = "pack"): { pack: Pack; files: PackFiles } {
  // Checked before unzipping so the common mistake — handing over a PDF, or a
  // half-finished download — reads as itself rather than as "invalid zip data".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error(`${label}: not a .deck archive (no zip header)`);
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch (err) {
    throw new Error(`${label}: corrupt .deck archive (${(err as Error).message})`);
  }
  const manifest = raw["deck.json"];
  if (!manifest) throw new Error(`${label}: not a .deck archive (no deck.json inside)`);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(manifest));
  } catch (err) {
    throw new Error(`${label}: deck.json is not valid JSON (${(err as Error).message})`);
  }
  // The version gate comes first and reads the field by hand: schema validation
  // of a format we do not know would report twenty confusing field errors
  // instead of the one true one.
  const version = (json as { version?: unknown })?.version;
  if (version !== PACK_VERSION)
    throw new Error(
      `${label}: written by pack format v${typeof version === "number" ? version : "unknown"}, ` +
        `this build understands v${PACK_VERSION}`,
    );
  const parsed = packSchema.safeParse(json);
  if (!parsed.success)
    throw new Error(`${label}: deck.json is not a valid pack — ${why(parsed.error)}`);

  const files: PackFiles = {};
  for (const [name, content] of Object.entries(raw)) {
    if (name === "deck.json" || name.endsWith("/")) continue;
    check(`${label}: ${name}`, name);
    files[name] = content;
  }
  return { pack: parsed.data, files };
}

/**
 * Reject anything that would escape the pack when a caller writes it out. We
 * hand back bytes rather than extracting, so this cannot bite us — but it can
 * bite whoever unpacks, and the archive is the place to catch it.
 */
function check(label: string, path = label): void {
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").includes(".."))
    throw new Error(`${label}: unsafe path in pack`);
}

function why(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

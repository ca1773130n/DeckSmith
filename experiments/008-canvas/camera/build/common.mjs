/**
 * Shared bits for the camera experiment: load the three real beats, emit them
 * with the real emitters, and offset a Scene's relative timeline to absolute.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { emitScene, resolveTheme, baseCss, FORMATS } from "./emit.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..", "..");
export const OUT = join(HERE, "..", "out");

export const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

/** The three beats that share conceptual space, in tour order. */
export const BEAT_IDS = ["b02", "b04", "b06"];

export async function loadPlates() {
  const sb = JSON.parse(await readFile(join(ROOT, "demo/storyboard.json"), "utf8"));
  const source = JSON.parse(await readFile(join(ROOT, "demo/source.json"), "utf8"));
  const theme = resolveTheme(sb.theme);
  const format = FORMATS["deck-16x9"];

  const plates = BEAT_IDS.map((id, i) => {
    const beat = sb.beats.find((b) => b.id === id);
    if (!beat) throw new Error(`no beat ${id}`);
    const sid = `s${i + 1}`;
    const scene = emitScene(beat, { source, format, theme, sid });
    return { id, sid, beat, scene };
  });
  return { sb, source, theme, format, plates };
}

/**
 * The position parameter of a `tl.fromTo(...)` statement — the same trailing
 * number `pace()` scales. Offsetting it is the entire transform needed to move
 * a Scene from its own relative clock onto a shared one.
 */
const AT = /,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/;

export function offsetTl(statements, offset) {
  return statements.map((raw) => {
    const s = raw.trim();
    if (!AT.test(s)) throw new Error(`statement has no position parameter: ${s}`);
    return s.replace(AT, (_m, at) => `, ${round(Number(at) + offset)});`);
  });
}

export function round(n) {
  return Math.round(n * 10000) / 10000;
}

export const t = (n) => String(Math.round(n * 1000) / 1000);

export function themeCss(theme, format) {
  return baseCss(theme, format);
}

export const HF_JSON = `${JSON.stringify(
  { $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" } },
  null,
  2,
)}\n`;

/**
 * The shared kit of the literal scenes (src/literal/index.ts and every kind
 * under src/literal/kinds/): decoding and writing rasters through ffmpeg, and
 * the fragment helpers that keep each scene inside the deck's invariants
 * (fromTo only, scoped selectors, 3-decimal times, type never under 40px). The
 * maths is in ./ops.ts.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Theme } from "../emit/kit.js";
import { TYPE_SCALE } from "../emit/type.js";
import { type LITERAL_KIND_NAMES, literalSlotsOf } from "../types.js";

type LiteralKindName = (typeof LITERAL_KIND_NAMES)[number];

const run = promisify(execFile);

/* ------------------------------------------------------------------- rasters */

/** An RGB picture, 0..1 per channel, row-major. */
export interface Rgb {
  w: number;
  h: number;
  d: Float32Array;
}

/** Decode any picture ffmpeg reads, resampled (area) to w×h. */
export async function readRgb(file: string, w: number, h: number): Promise<Rgb> {
  const { stdout } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `scale=${w}:${h}:flags=area`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 256 << 20 },
  );
  const buf = stdout as unknown as Buffer;
  if (buf.length !== w * h * 3)
    throw new Error(
      `literal: ffmpeg decoded ${buf.length} bytes of ${file}, expected ${w * h * 3}`,
    );
  const d = new Float32Array(w * h * 3);
  for (let i = 0; i < d.length; i++) d[i] = (buf[i] as number) / 255;
  return { w, h, d };
}

/** Write RGBA bytes as a PNG (lossless) or a JPEG (`.jpg`, photographs only). */
export async function writeRaster(
  out: string,
  w: number,
  h: number,
  rgba: Uint8Array,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "decksmith-literal-"));
  try {
    const raw = join(dir, "in.rgba");
    await writeFile(raw, rgba);
    const jpg = out.endsWith(".jpg");
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${w}x${h}`,
      "-i",
      raw,
      ...(jpg ? ["-q:v", "2", "-pix_fmt", "yuvj444p"] : ["-pix_fmt", "rgba"]),
      "-frames:v",
      "1",
      out,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function toRgba(img: Rgb): Uint8Array {
  const o = new Uint8Array(img.w * img.h * 4);
  for (let i = 0, j = 0; i < img.w * img.h; i++, j += 3) {
    o[i * 4] = clamp255(img.d[j] as number);
    o[i * 4 + 1] = clamp255(img.d[j + 1] as number);
    o[i * 4 + 2] = clamp255(img.d[j + 2] as number);
    o[i * 4 + 3] = 255;
  }
  return o;
}

/** A grey map (0..1) as RGBA: `color` at `alpha` = value, or grey levels when no colour. */
export function mapRgba(v: Float32Array, color?: [number, number, number]): Uint8Array {
  const o = new Uint8Array(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    const a = Math.max(0, Math.min(1, v[i] as number));
    if (color) {
      o[i * 4] = color[0];
      o[i * 4 + 1] = color[1];
      o[i * 4 + 2] = color[2];
      o[i * 4 + 3] = clamp255(a);
    } else {
      const g = clamp255(a);
      o[i * 4] = g;
      o[i * 4 + 1] = g;
      o[i * 4 + 2] = g;
      o[i * 4 + 3] = 255;
    }
  }
  return o;
}

export function clamp255(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x * 255)));
}

export interface Layers {
  /** File names under `LITERAL_DIR`. */
  files: Record<string, string>;
  /** Numbers the fragment draws (profiles, grids, traces). */
  data: Record<string, unknown>;
  /** The arrays a verb computed, in memory, for a later verb to stream (`evolve` from). */
  material?: Material;
}

/** What a verb computed that a later one may take as input. */
export interface Material {
  /** The last output. */
  final?: import("./ops.js").Tensor;
  /** Pieces of it (crops, tiles), in order. */
  tiles?: import("./ops.js").Tensor[];
}

/* ---------------------------------------------------------------- fragments */

export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const round3 = r3;
export const px = (n: number) => `${Math.round(n)}px`;
/** Escape a label for markup. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The scene's tween lines, every one `fromTo` (invariant 2), every selector `#SCENEID-…` (invariant 3). */
export class Tl {
  lines: string[] = [];
  private seen = new Set<string>();
  /**
   * An element's FIRST tween renders its "from" state at once (GSAP's default),
   * so whatever enters later is hidden from the scene's first frame; every
   * later tween of it waits for its own start (`immediateRender: false`), so it
   * cannot overwrite the earlier one's state when the timeline is built.
   */
  fromTo(id: string, from: Record<string, unknown>, to: Record<string, unknown>, at: number): void {
    const first = !this.seen.has(id);
    this.seen.add(id);
    // Invariant 10 holds for a duration as for a position: a computed span
    // (10.324000000000002) would move a byte with float drift.
    const timed = typeof to.duration === "number" ? { ...to, duration: r3(to.duration) } : to;
    this.lines.push(
      `tl.fromTo("#SCENEID-${id}", ${JSON.stringify(from)}, ${JSON.stringify(first ? timed : { ...timed, immediateRender: false })}, ${r3(at)});`,
    );
  }
  /** Fade in (opacity 0→1) at `at`. */
  show(
    id: string,
    at: number,
    dur = 0.6,
    extra: { from?: Record<string, unknown>; to?: Record<string, unknown> } = {},
  ) {
    this.fromTo(
      id,
      { opacity: 0, ...extra.from },
      { opacity: 1, duration: dur, ease: "power2.out", ...extra.to },
      at,
    );
  }
  hide(id: string, at: number, dur = 0.5) {
    this.fromTo(id, { opacity: 1 }, { opacity: 0, duration: dur, ease: "power1.inOut" }, at);
  }
  get script(): string {
    return this.lines.join("\n");
  }
}

export interface Cue {
  t0: number;
  t1: number;
  /** This sentence opens a narration stop: a hold sits at its start (src/bespoke/scene.ts `bespokeHolds`). */
  stop?: boolean;
}

/**
 * The stretches of [from, to] in which no tween of a scene's script runs —
 * what a viewer sees as the picture standing still. Read off the emitted
 * script (`tl.fromTo(..., {...duration...}, at)`), so it measures what ships.
 * A tween with no duration runs GSAP's default 0.5s. Pure; the tests hold
 * every kind to a ceiling with it (r1 of an early literal deck had 13 stretches
 * of 6–9s where nothing moved).
 */
export function stillSpans(script: string, from: number, to: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const line of script.split("\n")) {
    const m = /^tl\.fromTo\(.*, (\{.*\}), (-?\d+(?:\.\d+)?)\);$/.exec(line.trim());
    if (!m) continue;
    const at = Number(m[2]);
    const dur = /"duration":(\d+(?:\.\d+)?)/.exec(m[1] as string);
    runs.push([at, at + (dur ? Number(dur[1]) : 0.5)]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let cursor = from;
  for (const [a, b] of runs) {
    if (b <= cursor) continue;
    if (a > cursor) out.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push([cursor, to]);
  return out.filter(([a, b]) => b - a > 1e-6 && a < to);
}

/* --------------------------------------------------------------------- slots */

/**
 * A scene's words by slot (src/types.ts `LITERAL_KIND_DOCS`). Throws on a slot the
 * kind does not declare — a fragment reading an undocumented slot is a bug,
 * since the planner was never told to fill it — and on a required one the
 * plan left out: no kind has a default, in any language or for any paper.
 * `{name}` in the text is replaced by the computed `vars[name]`.
 */
export function slotText(
  kind: LiteralKindName,
  labels: Readonly<Record<string, string>>,
  slot: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  const decl = literalSlotsOf(kind)[slot];
  if (!decl)
    throw new Error(
      `literal: ${kind} reads slot "${slot}", which its LITERAL_KIND_DOCS entry does not declare`,
    );
  const text = labels[slot];
  if (text === undefined || !text.trim()) {
    if (decl.optional) return "";
    throw new Error(`literal: ${kind} needs the label slot "${slot}" (${decl.what})`);
  }
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!decl.vars?.includes(name) || vars[name] === undefined)
      throw new Error(
        `literal: ${kind} slot "${slot}" names ${m}, which the scene does not compute`,
      );
    return String(vars[name]);
  });
}

export const LABEL = TYPE_SCALE.body; // 44
export const SMALL = TYPE_SCALE.label; // 40

/** A label as positioned HTML. Never below 40px (invariant 5). */
export function label(
  id: string,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  extra = "",
): string {
  return `<div id="SCENEID-${id}" class="lit-label" style="left:${px(x)};top:${px(y)};font-size:${size}px;color:${color};${extra}">${esc(text)}</div>`;
}

export const ON_PHOTO =
  "color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.75),0 0 2px rgba(0,0,0,.9);font-weight:600";

export function baseCss(theme: Theme): string {
  return [
    "#SCENEID-lit{position:absolute;left:0;top:0;width:100%;height:100%}",
    "#SCENEID-lit .lit-label{position:absolute;white-space:nowrap;line-height:1.15;font-weight:600}",
    "#SCENEID-lit img{position:absolute;display:block}",
    "#SCENEID-lit .lit-panel{position:absolute;overflow:hidden;border-radius:6px}",
    `#SCENEID-lit .lit-dark{background:#0d1014}`,
    `#SCENEID-lit svg{position:absolute;overflow:visible}`,
    `#SCENEID-lit .lit-muted{color:${theme.muted}}`,
  ].join("\n");
}

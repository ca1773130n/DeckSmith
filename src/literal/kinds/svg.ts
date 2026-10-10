/**
 * One frame of a mechanism kind as SVG: what the framework draws, and what the
 * preview strips and the judge frames are rasterised from. Pure: rasters are
 * referenced by `href(layer)`, slot texts come from `text(slot, vars)`, and
 * every colour is a style-pack token (fg, muted, dim, rule, panel, accent,
 * tones): a heat layer is a white alpha mask the theme colours here, so one
 * computed file serves a dark pack and a light one. The ground (`bg`) is the
 * shell's: it is painted only in a preview (`ground: true`), and read only to
 * judge contrast against.
 *
 * Also the contrast arithmetic (WCAG 2 relative luminance) the tests hold the
 * frames to, and the backdrop lookup a text with role "auto" is resolved by.
 */
import type { Theme } from "../../emit/kit.js";
import type { DataRgb, Frame, Prim, Raster, Region, Role } from "./common.js";

/** An sRGB colour, 0..255 per channel. */
export type Rgb8 = [number, number, number];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const css = (c: Rgb8) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;

export function hex(c: string): Rgb8 {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`svg: "${c}" is not a #rrggbb colour`);
  const v = Number.parseInt(m[1] as string, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function roleRgb(theme: Theme, role: Role): Rgb8 {
  switch (role) {
    case "a":
    case "b":
    case "c":
    case "d":
      return hex(theme.tones[role]);
    default:
      return hex(theme[role]);
  }
}

/** Kept for callers that want the theme's own string. */
export function roleColor(theme: Theme, role: Role): string {
  return css(roleRgb(theme, role));
}

/** The heat ramp: the panel colour at 0, the accent at 1. */
export function heatRgb(theme: Theme, t: number): Rgb8 {
  const a = hex(theme.panel);
  const b = hex(theme.accent);
  const k = Math.max(0, Math.min(1, t));
  return a.map((v, i) => Math.round(v + ((b[i] as number) - v) * k)) as Rgb8;
}

/** Tone weights (a, b, c, d) mixed over the panel: hue from their proportions, strength from their sum. */
export function mixRgb(theme: Theme, w: readonly number[]): Rgb8 {
  const tones = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d].map(hex);
  const base = hex(theme.panel);
  const tot = w.reduce((s, x) => s + Math.max(0, x), 0);
  if (tot <= 0) return base;
  const hue = [0, 1, 2].map((c) =>
    w.reduce((s, x, i) => s + (Math.max(0, x) / tot) * ((tones[i] as Rgb8)[c] as number), 0),
  );
  const k = Math.min(1, tot);
  return base.map((v, c) => Math.round(v + ((hue[c] as number) - v) * k)) as Rgb8;
}

const dataRgb = (c: DataRgb): Rgb8 =>
  c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)) as Rgb8;

/** A filled shape's fill, or undefined when it has none. */
export function fillRgb(
  theme: Theme,
  p: { fill?: Role; heat?: number; mix?: number[]; rgb?: DataRgb },
): Rgb8 | undefined {
  if (p.rgb) return dataRgb(p.rgb);
  if (p.mix) return mixRgb(theme, p.mix);
  if (p.heat !== undefined) return heatRgb(theme, p.heat);
  if (p.fill) return roleRgb(theme, p.fill);
  return undefined;
}

/* --------------------------------------------------------------- contrast */

function luminance(c: Rgb8): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrastRatio(a: Rgb8, b: Rgb8): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Where a primitive sits, for finding what is under it. */
export function anchorOf(p: Prim): [number, number] {
  switch (p.p) {
    case "line":
      // The far end: a line leaving a marker (an arrow from a head) is judged where it lands.
      return [p.x2, p.y2];
    case "path": {
      const k = Math.floor(p.pts.length / 4) * 2;
      return [p.pts[k] as number, p.pts[k + 1] as number];
    }
    case "rect":
    case "image":
      return [p.x + p.w / 2, p.y + p.h / 2];
    case "circle":
    case "ellipse":
      return [p.cx, p.cy];
    case "text": {
      const dx = p.anchor === "start" ? p.size * 0.3 : p.anchor === "end" ? -p.size * 0.3 : 0;
      return [p.x + dx, p.y + p.size / 2];
    }
  }
}

/** A fill that holds things (a panel, a cell, a node) rather than being a mark itself. */
function isContainer(q: Prim): boolean {
  if (q.p !== "rect" && q.p !== "circle") return false;
  return q.heat !== undefined || !!q.mix || q.fill === "panel" || q.fill === "rule";
}

/**
 * The colour under prims[index] at its anchor: the last opaque filled rect or
 * circle drawn before it that contains the point, else the ground. Undefined
 * when a picture is under it (its colour is the data's, not the theme's).
 * `containersOnly`: look through marks (another series' head, a start dot) to
 * the panel or ground they sit on — how a mark is judged.
 */
export function backdropOf(
  prims: readonly Prim[],
  index: number,
  theme: Theme,
  containersOnly = false,
): Rgb8 | undefined {
  const [x, y] = anchorOf(prims[index] as Prim);
  return backdropAt(prims, index, x, y, theme, containersOnly);
}

/** What is under (x, y) among prims[0..before): a translucent fill is blended over what is under it. */
function backdropAt(
  prims: readonly Prim[],
  before: number,
  x: number,
  y: number,
  theme: Theme,
  containersOnly: boolean,
): Rgb8 | undefined {
  for (let j = before - 1; j >= 0; j--) {
    const q = prims[j] as Prim;
    if (q.p === "image") {
      if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) return undefined;
      continue;
    }
    if (containersOnly && !isContainer(q)) continue;
    const inside =
      (q.p === "rect" && x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) ||
      (q.p === "circle" && Math.hypot(x - q.cx, y - q.cy) <= q.r);
    if (!inside || (q.p !== "rect" && q.p !== "circle")) continue;
    const f = fillRgb(theme, q);
    if (!f) continue;
    const a = q.opacity ?? 1;
    if (a >= 1) return f;
    const under = backdropAt(prims, j, x, y, theme, containersOnly);
    if (!under) return undefined;
    return f.map((v, c) => v * a + (under[c] as number) * (1 - a)) as Rgb8;
  }
  return hex(theme.bg);
}

/** A text's colour: its role's, or for "auto" the ink or the panel colour, whichever reads better on its backdrop. */
export function textRgb(prims: readonly Prim[], index: number, theme: Theme): Rgb8 {
  const p = prims[index] as Extract<Prim, { p: "text" }>;
  if (p.role !== "auto") return roleRgb(theme, p.role);
  const under = backdropOf(prims, index, theme) ?? hex(theme.bg);
  const ink = hex(theme.fg);
  const panel = hex(theme.panel);
  return contrastRatio(ink, under) >= contrastRatio(panel, under) ? ink : panel;
}

/**
 * An "auto" text's halo: when neither ink nor panel reaches 4.5:1 on a
 * mid-tone fill (a bright accent at half strength), the text gets a 6px
 * outline in the other colour, and that outline is what it is read against.
 */
export function textHalo(prims: readonly Prim[], index: number, theme: Theme): Rgb8 | undefined {
  const p = prims[index] as Extract<Prim, { p: "text" }>;
  if (p.role !== "auto") return undefined;
  const c = textRgb(prims, index, theme);
  const under = backdropOf(prims, index, theme) ?? hex(theme.bg);
  if (contrastRatio(c, under) >= 4.5) return undefined;
  const ink = hex(theme.fg);
  return c.every((v, i) => v === ink[i]) ? hex(theme.panel) : ink;
}

/* ----------------------------------------------------------------- drawing */

/** How a raster layer is drawn: a picture as itself, a heat mask in a theme colour at an opacity. */
export type LayerPaint = { mask: Role; alpha: number } | undefined;

interface Draw {
  theme: Theme;
  href: (layer: string) => string;
  text: (slot: string, vars: Readonly<Record<string, string | number>>) => string;
  paint: (layer: string) => LayerPaint;
  /** Prefix of every id this frame defines (masks), so two frames in one page never collide. */
  ids: string;
}

function prim(prims: readonly Prim[], index: number, d: Draw): string {
  const { theme, href, text } = d;
  const p = prims[index] as Prim;
  const op = p.opacity !== undefined ? ` opacity="${n2(p.opacity)}"` : "";
  const stroke = (role: Role | undefined, width: number | undefined) =>
    role ? ` stroke="${css(roleRgb(theme, role))}" stroke-width="${n2(width ?? 2)}"` : "";
  switch (p.p) {
    case "line": {
      const c = css(p.mix ? mixRgb(theme, p.mix) : roleRgb(theme, p.role));
      const dash = p.dash ? ` stroke-dasharray="${n2(p.width * 3)} ${n2(p.width * 2)}"` : "";
      let s = `<line x1="${n2(p.x1)}" y1="${n2(p.y1)}" x2="${n2(p.x2)}" y2="${n2(p.y2)}" stroke="${c}" stroke-width="${n2(p.width)}" stroke-linecap="round"${dash}${op}/>`;
      if (p.arrow) {
        const a = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
        const L = Math.max(10, p.width * 4);
        const pts = [
          [p.x2, p.y2],
          [p.x2 - L * Math.cos(a - 0.45), p.y2 - L * Math.sin(a - 0.45)],
          [p.x2 - L * Math.cos(a + 0.45), p.y2 - L * Math.sin(a + 0.45)],
        ];
        s += `<polygon points="${pts.map(([x, y]) => `${n2(x as number)},${n2(y as number)}`).join(" ")}" fill="${c}"${op}/>`;
      }
      return s;
    }
    case "path": {
      const pts: string[] = [];
      for (let i = 0; i + 1 < p.pts.length; i += 2)
        pts.push(`${n2(p.pts[i] as number)},${n2(p.pts[i + 1] as number)}`);
      const tag = p.closed ? "polygon" : "polyline";
      const fill = p.fill ? css(roleRgb(theme, p.fill)) : "none";
      const dash = p.dash ? ` stroke-dasharray="${n2(p.width * 3)} ${n2(p.width * 2)}"` : "";
      return `<${tag} points="${pts.join(" ")}" fill="${fill}" stroke="${css(roleRgb(theme, p.role))}" stroke-width="${n2(p.width)}" stroke-linejoin="round" stroke-linecap="round"${dash}${op}/>`;
    }
    case "rect": {
      const f = fillRgb(theme, p);
      const r = p.radius ? ` rx="${n2(p.radius)}"` : "";
      return `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}"${r} fill="${f ? css(f) : "none"}"${stroke(p.role, p.width)}${op}/>`;
    }
    case "circle": {
      const f = fillRgb(theme, p);
      return `<circle cx="${n2(p.cx)}" cy="${n2(p.cy)}" r="${n2(p.r)}" fill="${f ? css(f) : "none"}"${stroke(p.role, p.width)}${op}/>`;
    }
    case "ellipse": {
      const fill = p.rgb ? css(dataRgb(p.rgb)) : "none";
      return `<ellipse cx="0" cy="0" rx="${n2(p.rx)}" ry="${n2(p.ry)}" transform="translate(${n2(p.cx)} ${n2(p.cy)}) rotate(${n2(p.angle)})" fill="${fill}"${stroke(p.role, p.width)}${op}/>`;
    }
    case "text": {
      const s = p.text ?? (p.slot ? text(p.slot, p.vars ?? {}) : "");
      if (!s) return "";
      const y = p.y + p.size * 0.8;
      const halo = textHalo(prims, index, theme);
      const outline = halo
        ? ` stroke="${css(halo)}" stroke-width="6" stroke-linejoin="round" paint-order="stroke"`
        : "";
      return `<text x="${n2(p.x)}" y="${n2(y)}" font-size="${p.size}" font-weight="${p.weight ?? 600}" text-anchor="${p.anchor}" fill="${css(textRgb(prims, index, theme))}"${outline}${op}>${esc(s)}</text>`;
    }
    case "image": {
      const box = `x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}"`;
      const pix = p.pixelated ? ' style="image-rendering:pixelated"' : "";
      const img = `<image ${box} preserveAspectRatio="none" href="${esc(href(p.layer))}"${pix}/>`;
      const paint = d.paint(p.layer);
      if (!paint) return img.replace("/>", `${op}/>`);
      // A heat layer: white where the value is, alpha = value; the theme colours it.
      const id = `${d.ids}m${index}`;
      return `<mask id="${id}" maskUnits="userSpaceOnUse" ${box}>${img}</mask><rect ${box} fill="${css(roleRgb(theme, paint.mask))}" opacity="${n2((p.opacity ?? 1) * paint.alpha)}" mask="url(#${id})"/>`;
    }
  }
}

/** A whole frame as one region-sized SVG. `ground` paints the theme's ground under it (previews only). */
export function frameSvg(
  frame: Frame,
  region: Region,
  href: (layer: string) => string,
  text: (slot: string, vars: Readonly<Record<string, string | number>>) => string,
  opts: {
    theme: Theme;
    pad?: number;
    ground?: boolean;
    paint?: (layer: string) => LayerPaint;
    ids?: string;
    attrs?: string;
  },
): string {
  const { theme } = opts;
  const pad = opts.pad ?? 0;
  const W = region.width + 2 * pad;
  const H = region.height + 2 * pad;
  const d: Draw = {
    theme,
    href,
    text,
    paint: opts.paint ?? (() => undefined),
    ids: opts.ids ?? `${frame.id}-`,
  };
  const body = frame.prims.map((_, i) => prim(frame.prims, i, d)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(theme.fontStack)}"${opts.attrs ?? ""}>
${opts.ground ? `<rect width="100%" height="100%" fill="${theme.bg}"/>\n` : ""}<g transform="translate(${pad} ${pad})">
${body}
</g>
</svg>`;
}

/** How each raster of a result is drawn (see `LayerPaint`). */
export function layerPaints(
  rasters: Readonly<Record<string, Raster>>,
): (layer: string) => LayerPaint {
  return (layer) => {
    const L = rasters[layer];
    return L && "heat" in L ? { mask: L.role, alpha: L.alpha } : undefined;
  };
}

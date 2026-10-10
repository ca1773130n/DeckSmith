/**
 * One frame of a mechanism kind as SVG: what the framework draws, and what the
 * preview strips and the judge fixtures are rasterised from. Pure: rasters are
 * referenced by `href(layer)`, slot texts come from `text(slot, vars)`.
 */
import type { Theme } from "../../emit/kit.js";
import type { Frame, Prim, Region, Role } from "./common.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (n: number) => String(Math.round(n * 100) / 100);

export function roleColor(theme: Theme, role: Role): string {
  switch (role) {
    case "a":
    case "b":
    case "c":
    case "d":
      return theme.tones[role];
    default:
      return theme[role];
  }
}

function hex(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`svg: "${c}" is not a #rrggbb colour`);
  const v = Number.parseInt(m[1] as string, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The heat ramp: the panel colour at 0, the accent at 1. */
export function heatColor(theme: Theme, t: number): string {
  const a = hex(theme.panel);
  const b = hex(theme.accent);
  const k = Math.max(0, Math.min(1, t));
  const c = a.map((v, i) => Math.round(v + ((b[i] as number) - v) * k));
  return `rgb(${c.join(",")})`;
}

const rgbOf = (c: readonly [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")})`;

/** Tone weights (a, b, c, d) mixed over the panel: hue from their proportions, strength from their sum. */
export function mixColor(theme: Theme, w: readonly number[]): string {
  const tones = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d].map(hex);
  const base = hex(theme.panel);
  const tot = w.reduce((s, x) => s + Math.max(0, x), 0);
  if (tot <= 0) return `rgb(${base.join(",")})`;
  const hue = [0, 1, 2].map((c) =>
    w.reduce((s, x, i) => s + (Math.max(0, x) / tot) * ((tones[i] as number[])[c] as number), 0),
  );
  const k = Math.min(1, tot);
  return `rgb(${base.map((v, c) => Math.round(v + ((hue[c] as number) - v) * k)).join(",")})`;
}

function fillOf(
  theme: Theme,
  p: { fill?: Role; heat?: number; mix?: number[]; rgb?: readonly [number, number, number] },
): string {
  if (p.rgb) return rgbOf(p.rgb);
  if (p.mix) return mixColor(theme, p.mix);
  if (p.heat !== undefined) return heatColor(theme, p.heat);
  if (p.fill) return roleColor(theme, p.fill);
  return "none";
}

function prim(
  p: Prim,
  theme: Theme,
  href: (layer: string) => string,
  text: (slot: string, vars: Readonly<Record<string, string | number>>) => string,
): string {
  const op = p.opacity !== undefined ? ` opacity="${n2(p.opacity)}"` : "";
  switch (p.p) {
    case "line": {
      const c = p.mix ? mixColor(theme, p.mix) : roleColor(theme, p.role);
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
      const fill = p.fill ? roleColor(theme, p.fill) : "none";
      const dash = p.dash ? ` stroke-dasharray="${n2(p.width * 3)} ${n2(p.width * 2)}"` : "";
      return `<${tag} points="${pts.join(" ")}" fill="${fill}" stroke="${roleColor(theme, p.role)}" stroke-width="${n2(p.width)}" stroke-linejoin="round" stroke-linecap="round"${dash}${op}/>`;
    }
    case "rect": {
      const stroke = p.role
        ? ` stroke="${roleColor(theme, p.role)}" stroke-width="${n2(p.width ?? 2)}"`
        : "";
      const r = p.radius ? ` rx="${n2(p.radius)}"` : "";
      return `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}"${r} fill="${fillOf(theme, p)}"${stroke}${op}/>`;
    }
    case "circle": {
      const stroke = p.role
        ? ` stroke="${roleColor(theme, p.role)}" stroke-width="${n2(p.width ?? 2)}"`
        : "";
      return `<circle cx="${n2(p.cx)}" cy="${n2(p.cy)}" r="${n2(p.r)}" fill="${fillOf(theme, p)}"${stroke}${op}/>`;
    }
    case "ellipse": {
      const stroke = p.role
        ? ` stroke="${roleColor(theme, p.role)}" stroke-width="${n2(p.width ?? 2)}"`
        : "";
      const fill = p.rgb ? rgbOf(p.rgb) : "none";
      return `<ellipse cx="0" cy="0" rx="${n2(p.rx)}" ry="${n2(p.ry)}" transform="translate(${n2(p.cx)} ${n2(p.cy)}) rotate(${n2(p.angle)})" fill="${fill}"${stroke}${op}/>`;
    }
    case "text": {
      const s = p.text ?? (p.slot ? text(p.slot, p.vars ?? {}) : "");
      if (!s) return "";
      const y = p.y + p.size * 0.8;
      return `<text x="${n2(p.x)}" y="${n2(y)}" font-size="${p.size}" font-weight="${p.weight ?? 600}" text-anchor="${p.anchor}" fill="${roleColor(theme, p.role)}"${op}>${esc(s)}</text>`;
    }
    case "image":
      return `<image x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" preserveAspectRatio="none" href="${esc(href(p.layer))}"${p.pixelated ? ' style="image-rendering:pixelated"' : ""}${op}/>`;
  }
}

/** A whole frame, region-sized, on the theme's background. */
export function frameSvg(
  frame: Frame,
  region: Region,
  theme: Theme,
  href: (layer: string) => string,
  text: (slot: string, vars: Readonly<Record<string, string | number>>) => string,
  pad = 0,
): string {
  const W = region.width + 2 * pad;
  const H = region.height + 2 * pad;
  const body = frame.prims.map((p) => prim(p, theme, href, text)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(theme.fontStack)}">
<rect width="100%" height="100%" fill="${theme.bg}"/>
<g transform="translate(${pad} ${pad})">
${body}
</g>
</svg>`;
}

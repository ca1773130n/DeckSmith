/**
 * Invariant 5, measured on the artifact instead of guessed from the input.
 *
 * WHY THIS EXISTS AT ALL. The floor is enforced at emit time — seven archetypes
 * refuse a beat they cannot lay out above it — but the enforcement is a mixture
 * of measurement and PROXY, and the proxies are where it leaks. The clearest one
 * is `src/emit/archetypes/equation-walk.ts:187`, which picks a font size from
 * `tex.length`: 68px past 120 characters, 80 past 90, 92 past 55. A character
 * count is not a width. `\alpha` is six characters and one glyph; `\!` is two
 * characters and negative width. The review of `.planning/VOCABULARY.md` found
 * the same substitution being used as a DEFECT TEST — `coherence.mjs:92` scored a
 * headline as broken at "73 chars > 60" — built the deck, and found the
 * 73-character headline wrapping to two lines at full size, looking correct
 * (VOCABULARY-REVIEW §3.3). A rule that fires on text that renders fine is a rule
 * people learn to ignore, and a rule that passes text that renders too small is
 * worse. So nothing here counts characters. It reads the size the deck declares.
 *
 * REFERENCE SPACE, NOT CANVAS PIXELS. An archetype lays out in a unit system
 * `refWidth` wide and `baseCss` zooms the finished scene onto the real canvas
 * exactly once (`src/emit/kit.ts`, `REF_PULL`). Every absolute measurement in the
 * vocabulary — including the floor — is therefore written in reference space and
 * left untouched by the format: MEASURED on the demo, both `deck-16x9` and
 * `short-9x16` declare the same smallest size, 40. At 1920 the zoom is exactly 1
 * and reference px are canvas px; in portrait the same 40 deliberately lands at
 * 30 canvas px, which is the whole argument of `REF_PULL` and not a violation. So
 * the declared number is the number the floor is about, and the scan compares it
 * to 40 as written, with no per-format normalisation to get wrong.
 *
 * WHAT IT DOES NOT SEE, stated because a gate that overclaims is the thing this
 * file was written to stop. It reads declared sizes, so text shrunk by a
 * `scale` below 1 at a hold reads as its unscaled size — `apparent.ts` is the
 * gate that closes exactly that, by measuring the painted glyph instead, and it
 * catches a 3D projection the same way; and it says nothing about
 * whether the text FITS — `container_overflow` and `text_occluded` in
 * `hyperframes check` are the gates for that, and `check.ts` already grades them
 * up to errors.
 */
import type { Finding } from "../types.js";

/**
 * Audience text never below this, in reference-space px (invariant 5).
 *
 * Inclusive: the demo declares exactly 40 in ten places, and a floor that failed
 * its own reference deck would be a floor nobody could build against.
 */
export const TYPE_FLOOR_PX = 40;

/** A declaration that puts text under the floor. */
interface Small {
  /** Reference-space px, after any SVG user-unit correction. */
  px: number;
  /** The element or selector it was declared on. */
  where: string;
}

/** `font-size: 40px` in a stylesheet or a style attribute. */
const CSS_PX = /font-size\s*:\s*([0-9.]+)px/g;

/** `<text font-size="40">` — SVG's presentation attribute, in user units. */
const SVG_ATTR = /\bfont-size="([0-9.]+)"/g;

/**
 * A size in a unit this scan cannot resolve without a browser.
 *
 * Reported rather than skipped. Nothing in `src/emit` emits one today — measured:
 * zero across both demo formats — so the first one to appear is a change in how
 * type is written, and it must not arrive as a silent hole in the floor.
 */
const RELATIVE = /font-size\s*:\s*[0-9.]+(em|rem|%|vw|vh|ch|ex|pt)\b/g;

/**
 * Every text size the composition declares, against the floor.
 *
 * `file` names the composition in the finding, the way `scanDeterminism` does —
 * a deck can hold more than one and "some size is 28px" is not a repair.
 */
export function scanTypeFloor(html: string, file: string, floorPx = TYPE_FLOOR_PX): Finding[] {
  const findings: Finding[] = [];
  const zones = svgZones(html);
  const small: Small[] = [];

  for (const pattern of [CSS_PX, SVG_ATTR]) {
    // A shared regex object carries `lastIndex` between calls, and a stale one
    // silently starts the scan in the middle of the file.
    pattern.lastIndex = 0;
    for (const m of html.matchAll(pattern)) {
      const px = Number(m[1]) * userUnit(zones, m.index);
      if (px < floorPx) small.push({ px, where: where(html, m.index) });
    }
  }

  if (small.length > 0) {
    const worst = [...small].sort((a, b) => a.px - b.px);
    const named = worst
      .slice(0, 6)
      .map((s) => `${round(s.px)}px on ${s.where}`)
      .join(", ");
    findings.push({
      severity: "error",
      gate: "typography",
      rule: "type_below_floor",
      message:
        `${file} declares ${small.length} text size(s) under the ${floorPx}px floor: ${named}${worst.length > 6 ? ", …" : ""}. ` +
        `Sizes are in reference space, so this is the floor as authored and not an artefact of the format's zoom. ` +
        `Raise the size, or give the archetype less to say — a beat that only fits below the floor is a beat that has to be cut in two.`,
    });
  }

  const units = [...new Set([...html.matchAll(RELATIVE)].map((m) => m[1]))];
  if (units.length > 0) {
    findings.push({
      severity: "warning",
      gate: "typography",
      rule: "type_unmeasurable",
      message: `${file} sizes some text in ${units.join("/")}, which resolves against an inherited size this scan cannot follow, so the ${floorPx}px floor was not checked there. Declare it in px, or measure it in a browser.`,
    });
  }
  return findings;
}

/** One `<svg>` and how many reference px a user unit inside it is worth. */
interface Zone {
  start: number;
  end: number;
  unit: number;
}

/**
 * `<svg width="1700" viewBox="0 0 1700 478">` — a user unit is one reference px
 * only while those two agree, and the demo's five SVGs all set them equal. A
 * later one that does not would render its 40 as something else entirely, so the
 * ratio is read rather than assumed.
 */
function svgZones(html: string): Zone[] {
  const zones: Zone[] = [];
  for (const m of html.matchAll(/<svg\b([^>]*)>/g)) {
    const width = Number(/\bwidth="([0-9.]+)"/.exec(m[1] as string)?.[1]);
    const box = Number(/\bviewBox="[0-9.-]+\s+[0-9.-]+\s+([0-9.]+)/.exec(m[1] as string)?.[1]);
    const close = html.indexOf("</svg>", m.index);
    zones.push({
      start: m.index,
      end: close < 0 ? html.length : close,
      unit: width > 0 && box > 0 ? width / box : 1,
    });
  }
  return zones;
}

/** Innermost zone wins: a nested `<svg>` rescales again. */
function userUnit(zones: readonly Zone[], at: number): number {
  return zones.filter((z) => at >= z.start && at < z.end).reduce((unit, z) => unit * z.unit, 1);
}

/**
 * The element or selector a size was declared on.
 *
 * "28px somewhere in index.html" sends a repair round reading 70,000 characters;
 * "28px on #s7-lab1" sends it to the archetype that emitted it.
 */
function where(html: string, at: number): string {
  const open = html.lastIndexOf("<", at);
  const closed = html.lastIndexOf(">", at);
  if (open > closed) {
    const end = html.indexOf(">", at);
    const tag = html.slice(open, end < 0 ? undefined : end + 1);
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    if (id) return `#${id}`;
    const name = /^<([a-zA-Z][\w-]*)/.exec(tag)?.[1] ?? "an element";
    const cls = /\bclass="([^"]+)"/.exec(tag)?.[1]?.split(/\s+/)[0];
    return cls ? `${name}.${cls}` : name;
  }
  // In a stylesheet: the selector is whatever precedes the rule's `{`.
  const brace = html.lastIndexOf("{", at);
  if (brace < 0) return "the stylesheet";
  const from = Math.max(html.lastIndexOf("}", brace), html.lastIndexOf(">", brace));
  const selector = html
    .slice(from + 1, brace)
    .trim()
    .split("\n")
    .pop()
    ?.trim();
  return selector ? selector : "the stylesheet";
}

/** Whole px where they are whole, so `40px` never prints as `40.000000000000004px`. */
function round(px: number): number {
  return Math.round(px * 100) / 100;
}

/**
 * The v2 style packs: a palette, a type spec and a skin, chosen per deck.
 *
 * `ink`, `mono` and `paper` are positions on a palette. A pack is a whole visual
 * identity — its own typeface pairing and type scale (`../type.ts`), its own
 * ground and accent, its own eyebrow and figure treatment, its own surface — so
 * two decks on two packs read as two designs rather than one design recoloured.
 * Three dark and three light. Only the dark three are PICKED (`rankPacks` in
 * pick.ts): the founder, 2026-10-11, after watching a deck in `chalk`, "I prefer
 * dark theme". The light three stay registered, so `--theme folio` still works.
 *
 * Every palette clears the theme suite's WCAG bars (`test/themes.test.ts` runs
 * over every registered theme): 4.5:1 for every ink on the ground, 3:1 on the
 * panel, four tones a viewer can tell apart.
 *
 * THE SKIN IS NOT ALLOWED TO MOVE A PIXEL OF LAYOUT. It is appended after the
 * base stylesheet and reaches elements the archetypes style, so it may change
 * only what no measurement reads: colours, radii, shadows, decoration, a
 * `background-image` on the body, and absolutely positioned pseudo-elements.
 * Anything that changes a box — a size, a margin, a border width, a face — goes
 * through the type spec, where `chromeHeight` can charge it.
 * `test/style-packs.test.ts` parses every skin and enforces that list.
 */
import { TYPES, type TypeSpec } from "../type.js";
import type { DeckTheme } from "./index.js";

/**
 * In a rail the look draws its own accent kicker over the chrome
 * (src/emit/look.ts), so a pack's eyebrow mark there would be a second marker
 * stacked on the first. One rule, appended to every pack that marks its eyebrow
 * with a pseudo-element.
 */
const RAIL_ONE_MARK =
  ".lk-head .eyebrow::before,.lk-head .eyebrow::after{content:none;position:absolute}";

function typed(t: TypeSpec | undefined): Pick<DeckTheme, "fontStack" | "displayStack"> {
  if (!t) throw new Error("unknown type spec");
  return { fontStack: t.stack, displayStack: t.displayStack };
}

/** Magma, HypePaper's brand accent, on a violet-black ground. Grotesk display. */
export const signal: DeckTheme = {
  ground: "dark",
  bg: "#0e0b12",
  fg: "#f5f2f7",
  muted: "#b4abbf",
  dim: "#8f86a0",
  rule: "#2e2638",
  panel: "#1b1622",
  accent: "#ff2d55",
  tones: { a: "#ff6b8b", b: "#ffb547", c: "#a594ff", d: "#4fd1c5" },
  ...typed(TYPES["grotesk-inter"]),
  skin: [
    "body{background-image:radial-gradient(ellipse 70% 60% at 92% 0%,#ff2d5526 0%,transparent 70%),radial-gradient(ellipse 60% 55% at 0% 100%,#6b2bd921 0%,transparent 70%)}",
    ".scene .eyebrow{position:relative}",
    '.scene .eyebrow::before{content:"";position:absolute;left:0;top:-20px;width:72px;height:6px;border-radius:3px;background:#ff2d55}',
    RAIL_ONE_MARK,
    ".scene .figwrap,.scene .af-plate{border-color:#ff2d5566;border-radius:18px;box-shadow:0 30px 80px -30px #ff2d5559}",
    ".scene .panel{border-radius:18px}",
    ".scene .sub{border-top-color:#ff2d55}",
    // Title: the headline glows on the brand's own light.
    ".titleslide .bighead{text-shadow:0 0 90px #ff2d5540}",
  ].join("\n"),
  forms: {
    list: "tick",
    affinity: { placement: { foot: 1 }, variant: { "split-compare:columns": 1 } },
  },
};

/** Navy drafting film, a cyan rule, a faint grid. IBM Plex throughout. */
export const blueprint: DeckTheme = {
  ground: "dark",
  bg: "#0a1828",
  fg: "#e7f1fb",
  muted: "#a3b9cf",
  dim: "#8299b2",
  rule: "#233a52",
  panel: "#11233a",
  accent: "#4cc9f0",
  tones: { a: "#5ec8f2", b: "#f7c948", c: "#ff8fa3", d: "#7ee0a1" },
  ...typed(TYPES.plex),
  skin: [
    "body{background-image:linear-gradient(#4cc9f012 1px,transparent 1px),linear-gradient(90deg,#4cc9f012 1px,transparent 1px);background-size:64px 64px}",
    ".scene .eyebrow{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:12px;text-decoration-color:#4cc9f0}",
    ".scene .figwrap,.scene .af-plate{border-color:#4cc9f0;border-radius:2px;box-shadow:12px 12px 0 #4cc9f026}",
    ".scene .panel{border-radius:2px}",
    ".scene .sub{border-top-style:dashed;border-top-color:#4cc9f0}",
    // Bars are square, on dashed drafting tracks.
    ".scene .bc-bar{rx:0}",
    ".scene .bc-rail{rx:0;fill-opacity:0;stroke:#4cc9f066;stroke-width:2;stroke-dasharray:8 8}",
    // Title: a drawing frame, registration corners and all.
    ".titleslide{position:relative;outline:2px solid #4cc9f02e;outline-offset:40px}",
    '.titleslide::before{content:"";position:absolute;left:-40px;top:-40px;width:44px;height:44px;border-top:4px solid #4cc9f0;border-left:4px solid #4cc9f0}',
    '.titleslide::after{content:"";position:absolute;right:-40px;bottom:-40px;width:44px;height:44px;border-bottom:4px solid #4cc9f0;border-right:4px solid #4cc9f0}',
  ].join("\n"),
  forms: {
    list: "number",
    affinity: {
      placement: { rail: 1 },
      variant: { "split-compare:rows": 1, "pipeline:column": 1 },
    },
  },
};

/** Espresso ground, amber accent, a serif headline over Inter. Matted figures. */
export const atlas: DeckTheme = {
  ground: "dark",
  bg: "#15110c",
  fg: "#f2eadc",
  muted: "#c2b49c",
  dim: "#9e9078",
  rule: "#3a3127",
  panel: "#211b14",
  accent: "#e9a23b",
  tones: { a: "#e9a23b", b: "#8fc1e3", c: "#ee8aa1", d: "#a6c97c" },
  ...typed(TYPES["serif-inter"]),
  skin: [
    "body{background-image:radial-gradient(ellipse 85% 75% at 50% 42%,transparent 55%,#00000070 100%)}",
    ".scene .eyebrow{position:relative}",
    '.scene .eyebrow::before{content:"";position:absolute;left:0;top:-20px;width:120px;height:2px;background:#e9a23b}',
    RAIL_ONE_MARK,
    ".scene .figwrap,.scene .af-plate{border-color:#e9a23b80;border-radius:4px;box-shadow:0 0 0 8px #15110c,0 0 0 9px #e9a23b4d}",
    ".scene .panel{border-radius:4px}",
    ".scene .sub{border-top-color:#e9a23b}",
    ".scene .bc-bar{rx:4}",
    ".scene .bc-rail{rx:4;fill-opacity:.55}",
    // Title: centred under a gold rule, like a frontispiece.
    ".titleslide{text-align:center}",
    ".titleslide .eyebrow::before{position:absolute;left:calc(50% - 60px)}",
    ".titleslide .sub{border-top-color:transparent}",
  ].join("\n"),
  forms: {
    list: "dot",
    affinity: { placement: { top: 1 }, variant: { "claim-figure:mirror": 1, "callout:rows": 1 } },
  },
};

/** Cream stock, oxblood accent, Source Serif throughout. A journal page. */
export const folio: DeckTheme = {
  ground: "light",
  bg: "#f7f1e6",
  fg: "#1c1814",
  muted: "#5a5045",
  dim: "#685d50",
  rule: "#dcd2c1",
  panel: "#efe7d8",
  accent: "#9a2333",
  tones: { a: "#9a2333", b: "#1d5c8f", c: "#7a5200", d: "#2e6b3f" },
  ...typed(TYPES.serif),
  skin: [
    ".scene .eyebrow{position:relative}",
    '.scene .eyebrow::after{content:"";position:absolute;left:0;bottom:-9px;width:56px;height:3px;background:#9a2333}',
    RAIL_ONE_MARK,
    ".scene .figwrap,.scene .af-plate{border-color:#cfc3ae;border-radius:2px;box-shadow:0 1px 0 #0000000d,0 22px 44px -22px #3b2a1047}",
    ".scene .panel{border-radius:4px}",
    ".scene .sub{border-top-color:#9a2333}",
    ".scene .bc-bar{rx:0}",
    ".scene .bc-rail{fill-opacity:0}",
    // Title: a journal masthead, a heavy rule over a hairline.
    ".titleslide{position:relative}",
    '.titleslide::before{content:"";position:absolute;left:0;right:0;top:-34px;height:6px;border-top:4px solid #1c1814;border-bottom:1px solid #1c1814}',
  ].join("\n"),
  forms: {
    list: "number",
    affinity: {
      placement: { top: 1 },
      variant: { "split-compare:rows": 1, "bar-compare:versus": 1 },
    },
  },
};

/** Cool white, ultramarine accent, a grotesk headline over Plex. Dotted ground. */
export const chalk: DeckTheme = {
  ground: "light",
  bg: "#f5f7fa",
  fg: "#0e1621",
  muted: "#475569",
  dim: "#566275",
  rule: "#d6dde6",
  panel: "#eaeff5",
  accent: "#2547d0",
  tones: { a: "#2547d0", b: "#b4400a", c: "#b0186a", d: "#0f7a5a" },
  ...typed(TYPES["grotesk-plex"]),
  skin: [
    "body{background-image:radial-gradient(#0e16211a 1.6px,transparent 1.8px);background-size:40px 40px}",
    ".scene .eyebrow{text-decoration:underline;text-decoration-thickness:4px;text-underline-offset:10px;text-decoration-color:#2547d059}",
    ".scene .figwrap,.scene .af-plate{border-color:#2547d040;border-radius:16px;box-shadow:0 24px 48px -24px #0e162147}",
    ".scene .panel{border-radius:18px}",
    ".scene .sub{border-top-color:#2547d0}",
    ".scene .bc-bar{rx:14;stroke:#0e1621;stroke-width:3}",
    // Title: every word run over with a highlighter.
    ".titleslide .bighead .w{background-image:linear-gradient(transparent 62%,#2547d02e 62%,#2547d02e 94%,transparent 94%)}",
  ].join("\n"),
  forms: {
    list: "card",
    affinity: { placement: { foot: 1 }, variant: { "callout:rows": 1, "bar-compare:versus": 1 } },
  },
};

/** Sage ground, forest accent, a Plex headline over a serif body. Tabbed plates. */
export const journal: DeckTheme = {
  ground: "light",
  bg: "#eef1ea",
  fg: "#17201a",
  muted: "#4d5a50",
  dim: "#5a665c",
  rule: "#d3dacd",
  panel: "#e3e8dd",
  accent: "#1f6b4a",
  tones: { a: "#1f6b4a", b: "#8a4b0f", c: "#6b3fa0", d: "#1e5a8a" },
  ...typed(TYPES["plex-serif"]),
  skin: [
    ".scene .eyebrow{position:relative}",
    // One marker, on the text's own margin: a dot above the eyebrow. It was a bar
    // hung 30px left of the margin, beside the rail's own kicker (review 2026-10-08).
    '.scene .eyebrow::before{content:"";position:absolute;left:0;top:-24px;width:14px;height:14px;border-radius:7px;background:#1f6b4a}',
    RAIL_ONE_MARK,
    ".scene .figwrap,.scene .af-plate{border-color:#1f6b4a59;border-radius:10px;box-shadow:-10px 0 0 #1f6b4a}",
    ".scene .panel{border-radius:10px}",
    ".scene .sub{border-top-color:#1f6b4a}",
    ".scene .bc-bar{rx:3}",
    ".scene .bc-rail{rx:3;fill-opacity:0;stroke:#d3dacd;stroke-width:2}",
    // Title: a forest bar down the whole title block.
    ".titleslide{position:relative}",
    '.titleslide::before{content:"";position:absolute;left:-46px;top:0;bottom:0;width:8px;border-radius:4px;background:#1f6b4a}',
  ].join("\n"),
  forms: {
    list: "rule",
    affinity: {
      placement: { rail: 1 },
      variant: { "split-compare:rows": 1, "claim-figure:stacked": 1 },
    },
  },
};

/** The packs `--design v2` chooses among, in a fixed order the picker hashes into. */
export const PACKS: Readonly<Record<string, DeckTheme>> = {
  signal,
  blueprint,
  atlas,
  folio,
  chalk,
  journal,
};

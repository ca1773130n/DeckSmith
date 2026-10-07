/**
 * The theme registry.
 *
 * A theme is a name and a palette, and that is the whole extension point: a new
 * one is a file here plus a line in `THEMES`, and nothing in the shell or in any
 * archetype learns it exists. Emitters read `ctx.theme` and never a theme name —
 * the moment one branches on `name === "paper"` the registry has stopped being a
 * registry and the archetype has acquired a second, invisible stylesheet.
 *
 * Three of them, each a position rather than a hue: dark room, lit room, and the
 * room where colour does not survive.
 */
import type { Theme } from "../kit.js";
import { ink } from "./ink.js";
import { mono } from "./mono.js";
import { PACKS } from "./packs.js";
import { paper } from "./paper.js";

/**
 * `Theme` plus what only the shared stylesheet reads.
 *
 * `Theme` in `kit.ts` is the archetypes' contract and stays exactly as wide as
 * they need. Body weight is not theirs — every archetype sets its own weights —
 * it belongs to the one `body` rule in `baseCss`, so it lives out here where a
 * theme can carry it and an emitter cannot see it.
 */
export interface DeckTheme extends Theme {
  /** `body`'s font-weight. Omitted means 400, which is what `ink` and `paper` want. */
  bodyWeight?: number;
  /**
   * A v2 style pack's ground, so a picker can keep light and dark both in use.
   * Absent on the classic themes, which are never picked — only named.
   */
  ground?: "dark" | "light";
  /**
   * A v2 pack's finish: CSS appended after the base stylesheet. It may change
   * only what no measurement reads — colour, radius, shadow, decoration, the
   * body's `background-image`, absolutely positioned pseudo-elements. See
   * `./packs.ts`; the rule is enforced in `test/style-packs.test.ts`.
   */
  skin?: string;
}

/**
 * The classic three, then the v2 packs. Every one is reachable by `--theme`,
 * which is also how a storyboard or a caller forces a pack; `--design v2` picks
 * among `PACKS` when nobody named one (`./pick.ts`).
 */
export const THEMES: Readonly<Record<string, DeckTheme>> = { ink, mono, paper, ...PACKS };

/** Sorted, so an error message and a `--help` listing agree without coordinating. */
export const THEME_NAMES: readonly string[] = Object.keys(THEMES).sort();

/**
 * A theme by name, or a failure that says what the names are.
 *
 * Throwing rather than falling back to `ink`: a misspelt theme that silently
 * renders in the default is a whole deck built wrong, discovered at the point
 * someone presents it.
 */
export function resolveTheme(name: string): DeckTheme {
  const theme = THEMES[name];
  if (!theme) throw new Error(`unknown theme "${name}" — known: ${THEME_NAMES.join(", ")}`);
  return theme;
}

export { ink, mono, PACKS, paper };

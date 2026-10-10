/**
 * The palettes the mechanism kinds draw in. A kind never names a colour: its
 * primitives carry roles (ground, ink, accent, muted, tones …) and the renderer
 * resolves them against the active theme, so a style pack recolours every kind.
 *
 * Until the style-pack token names arrive with the literal interface, the two
 * presets are the repo's own classic themes: `ink` (dark) and `paper` (light).
 * Decks default to DARK (founder, 2026-10-10).
 */
import type { Theme } from "../../emit/kit.js";
import { ink } from "../../emit/themes/ink.js";
import { paper } from "../../emit/themes/paper.js";

export const MECHANISM_THEMES: Readonly<Record<"dark" | "light", Theme>> = {
  dark: ink,
  light: paper,
};

export const DEFAULT_THEME: Theme = MECHANISM_THEMES.dark;

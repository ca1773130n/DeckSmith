/**
 * Near-monochrome: white ground, black type, one red, used rarely.
 *
 * For the two rooms where colour is a lie — the conference projector with a
 * blown lamp and a washed-out gamma, and the greyscale printer. Both destroy
 * hue and keep value, so this theme encodes everything in value and spends its
 * single hue on the one thing per slide that must be found.
 *
 * That is what makes the tones different in kind from the other two themes'.
 * `a` is the accent; `b`, `c`, `d` are a ladder of greys about two stops apart,
 * so they stay told apart after a photocopier has finished with them. Four hues
 * would have collapsed into one grey, which is the failure this theme exists to
 * avoid. The ladder bottoms out at #6f6f6f because a lighter grey drops below
 * 4.5:1 on the panel.
 *
 * `bodyWeight` is the other half of it: a stop of extra weight is what keeps
 * type legible once a bad projector has eaten the thin end of every stroke.
 */
import type { DeckTheme } from "./index.js";

export const mono: DeckTheme = {
  bg: "#ffffff",
  fg: "#0a0a0a",
  muted: "#3a3a3a",
  dim: "#5e5e5e",
  rule: "#b0b0b0",
  panel: "#f4f4f4",
  accent: "#c8102e",
  tones: { a: "#c8102e", b: "#0a0a0a", c: "#464646", d: "#6f6f6f" },
  fontStack: '"Inter", system-ui, sans-serif',
  bodyWeight: 500,
};

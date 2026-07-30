/**
 * Light: a warm off-white ground, near-black text, one quiet accent.
 *
 * For a lit room, a handout, and the screenshot that ends up in a doc. It is not
 * `ink` inverted — inverting a dark theme yields pastel tones that vanish on
 * white, because a hue bright enough to read on #0b0d10 is by definition close
 * to the light end.
 *
 * So the tones are re-picked rather than flipped, and picked to one rule: each
 * clears 4.5:1 on both the ground and the panel, and all four sit at nearly the
 * same value, so they read as four hues rather than as a ranking. That is the
 * mirror of `ink`'s arrangement, arrived at from the opposite direction.
 *
 * The accent is deliberately dull for a light theme. Saturated blue on warm
 * white is the one combination that looks like a default rather than a choice.
 */
import type { DeckTheme } from "./index.js";

export const paper: DeckTheme = {
  // Warm, not white: #fff under a projector is a lamp pointed at the audience.
  bg: "#faf7f2",
  fg: "#14110d",
  muted: "#57503f",
  dim: "#6b6252",
  rule: "#ded7c9",
  // A half-step off the ground. Anything darker reads as a hole in the slide,
  // and drags every tone drawn on it below AA.
  panel: "#f3eee5",
  accent: "#1f5fa8",
  tones: { a: "#1b5fa8", b: "#8a5000", c: "#a8203f", d: "#1c6b45" },
  fontStack: '"Inter", system-ui, sans-serif',
};

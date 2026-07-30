/**
 * The original: a deep blue-black ground with cool light on it.
 *
 * Written for a dark room and a projector that has one job. The four tones are
 * four hues at roughly one value — nothing here is "the important one", because
 * an archetype assigns them by position in a list, not by rank.
 *
 * Its numbers are frozen. Every render this project has ever compared against
 * came out of them, so a nicer blue is a broken regression test.
 */
import type { DeckTheme } from "./index.js";

export const ink: DeckTheme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#9aa7b5",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

/**
 * PLAN-TIME CHECKS of the visual data kinds — the forms a table would
 * otherwise take (prior-work, margins, scope, ablation). Each is drawn here
 * exactly as the build draws it, at the region and in the face the build lays
 * it out with, on placeholder layers and no cues: what it refuses (a lane with
 * nothing to show, a setting with the wrong number of values, rings that do
 * not fit) is sent back to the planner for repair instead of failing
 * `build --literal`. The mechanism kinds have their own (`mechanismProblems`).
 */
import type { Theme } from "../emit/kit.js";
import type { Literal, LiteralKind } from "../types.js";
import { KINDS } from "./registry.js";

export const VISUAL_KINDS = [
  "prior-work",
  "margins",
  "scope",
  "ablation",
] as const satisfies readonly LiteralKind[];
export const isVisual = (k: string): k is (typeof VISUAL_KINDS)[number] =>
  (VISUAL_KINDS as readonly string[]).includes(k);

/** The layers a visual kind's fragment reads, as placeholders: prior-work's input and lanes. */
function placeholders(lit: Literal): Record<string, string> {
  if (lit.kind !== "prior-work") return {};
  return Object.fromEntries([
    ["in", "in.jpg"],
    ...lit.lanes.map((_, k) => [`l${k}`, `l${k}.png`] as const),
  ]);
}

/** What stops a visual kind being drawn at `region`, or nothing. */
export function visualProblems(
  lit: Literal,
  region: { width: number; height: number },
  theme: Theme,
): string[] {
  if (!isVisual(lit.kind)) return [];
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  try {
    KINDS[lit.kind].fragment(
      { files: placeholders(lit), data: {} },
      region,
      [],
      { labels, data: lit },
      theme,
      (f) => f,
    );
    return [];
  } catch (e) {
    return [(e as Error).message.replace(/^literal: /, "")];
  }
}

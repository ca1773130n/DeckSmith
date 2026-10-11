/**
 * PLAN-TIME CHECKS: every literal scene drawn as the build draws it, at the
 * region and in the face the build lays it out with, without its material — a
 * verb on placeholder material (its own run), a word form or a cross-cutting
 * kind by its fragment on placeholder layers and no cues. What it refuses (a
 * step label with no room, a lane with nothing to show, rings that do not fit,
 * a parameter an op does not take) is sent back to the planner for repair
 * instead of failing `build --literal`.
 */
import type { Theme } from "../emit/kit.js";
import type { Literal } from "../types.js";
import { evolve } from "./kinds/evolve.js";
import { flow } from "./kinds/flow.js";
import { operate } from "./kinds/operate.js";
import { placeForm, points } from "./kinds/place.js";
import { region } from "./kinds/region.js";
import { verbProblems } from "./kinds/stage.js";
import { KINDS } from "./registry.js";

/** The layers a word form's fragment reads, as placeholders. */
function placeholders(lit: Literal): Record<string, string> {
  if (lit.kind === "prior-work")
    return Object.fromEntries(
      lit.lanes.flatMap((l, k) => (l.from ? [[`l${k}`, `l${k}.png`] as const] : [])),
    );
  if (lit.kind === "recap")
    return Object.fromEntries(lit.beats.map((_, k) => [`p${k}`, `p${k}.png`]));
  return {};
}

/** What stops a literal scene being drawn at `region`, or nothing. */
export function drawProblems(
  lit: Literal,
  region_: { width: number; height: number },
  theme: Theme,
): string[] {
  switch (lit.kind) {
    case "operate":
      return verbProblems("operate", operate, lit, region_, theme);
    case "evolve":
      return verbProblems("evolve", evolve, lit, region_, theme);
    case "flow":
      return verbProblems("flow", flow, lit, region_, theme);
    case "region":
      return verbProblems("region", region, lit, region_, theme);
    case "place":
      if (placeForm(lit) === "points") return verbProblems("place", points, lit, region_, theme);
      break;
    default:
      break;
  }
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  try {
    KINDS[lit.kind].fragment(
      { files: placeholders(lit), data: lit.kind === "recap" ? { beats: lit.beats } : {} },
      region_,
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

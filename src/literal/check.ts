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

/**
 * When each part of a literal scene's script is first SHOWN — a fade from 0 or a
 * wipe from width 0 — and when that reveal ends, scene seconds, in order. Read
 * off the emitted script (`Tl` writes JSON), so it judges what ships. A part
 * hidden only by its parent is not seen here.
 */
export function firstShown(script: string): Array<{ id: string; at: number; end: number }> {
  type Vars = { opacity?: number; attr?: { width?: number }; duration?: number };
  const rows: Array<{ id: string; from: Vars; to: Vars; at: number }> = [];
  for (const line of script.split("\n")) {
    const m = /^tl\.fromTo\("#SCENEID-([\w-]+)", (\{.*\}), (\{.*\}), (-?\d+(?:\.\d+)?)\);$/.exec(
      line.trim(),
    );
    if (!m) continue;
    try {
      rows.push({
        id: m[1] as string,
        from: JSON.parse(m[2] as string) as Vars,
        to: JSON.parse(m[3] as string) as Vars,
        at: Number(m[4]),
      });
    } catch {
      // Not Tl's JSON: not a part this check can read.
    }
  }
  rows.sort((a, b) => a.at - b.at);
  const hidden = new Map<string, boolean>();
  const out: Array<{ id: string; at: number; end: number }> = [];
  for (const r of rows) {
    if (!hidden.has(r.id)) hidden.set(r.id, r.from.opacity === 0 || r.from.attr?.width === 0);
    if (!hidden.get(r.id)) continue;
    if ((r.to.opacity ?? 0) > 0 || (r.to.attr?.width ?? 0) > 0) {
      hidden.set(r.id, false);
      out.push({ id: r.id, at: r.at, end: r.at + (r.to.duration ?? 0.5) });
    }
  }
  return out;
}

/** A part must stand whole on screen at least this long before its scene cuts away. */
export const SEEN_WHOLE_S = 1.0;

/**
 * The parts of a literal scene that arrive too late to be seen: first shown
 * less than `SEEN_WHOLE_S` before the scene ends (`duration`, scene seconds),
 * or still arriving when it does. r2's scope lit its last item so late that
 * the 2s frames never caught it before the cut.
 *
 * A step after the last hold is the stage's business, not this check's: the
 * holds are the starts of the narration's STOPS, and the stage
 * (src/literal/kinds/stage.ts) puts a scene's last step no later than the
 * sentence that opens its last stop, then tours the finished picture.
 */
export function lateReveals(
  script: string,
  duration: number,
): Array<{ id: string; at: number; end: number }> {
  return firstShown(script).filter((r) => r.end > duration - SEEN_WHOLE_S);
}

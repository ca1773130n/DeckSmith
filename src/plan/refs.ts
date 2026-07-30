/**
 * The integrity check no schema can express: is this storyboard about *this*
 * source?
 *
 * A schema proves the shape. It cannot prove that `figureId: "fig7"` names a
 * figure that exists — and a confidently-cited id that isn't there is the
 * failure a planner actually produces. Kept apart from any one planner because
 * it is a property of the pair, and `build` re-checks it on a hand-edited
 * storyboard that no planner ever touched.
 */
import type { Beat, Source, Storyboard } from "../types.js";

export function assertRefsResolve(storyboard: Storyboard, source: Source): void {
  const known = {
    figure: new Set(source.figures.map((f) => f.id)),
    equation: new Set(source.equations.map((e) => e.id)),
    table: new Set(source.tables.map((t) => t.id)),
    section: new Set(source.sections.map((s) => s.id)),
  };

  const dangling: string[] = [];
  const check = (beat: Beat, kind: keyof typeof known, id: string, where: string) => {
    if (!known[kind].has(id)) {
      dangling.push(`beat "${beat.id}" ${where}: no ${kind} "${id}" in source "${source.id}"`);
    }
  };

  if (storyboard.sourceId !== source.id) {
    dangling.push(`storyboard.sourceId is "${storyboard.sourceId}", not "${source.id}"`);
  }

  for (const beat of storyboard.beats) {
    for (const ref of beat.evidence) check(beat, ref.kind, ref.id, "evidence");
    switch (beat.archetype) {
      case "claim-figure":
        check(beat, "figure", beat.params.figureId, "params.figureId");
        break;
      case "equation-walk":
        check(beat, "equation", beat.params.equationId, "params.equationId");
        break;
      case "data-table":
        check(beat, "table", beat.params.tableId, "params.tableId");
        break;
      case "annotated-figure":
        check(beat, "figure", beat.params.figureId, "params.figureId");
        break;
      case "split-compare":
        // Either side may be a list rather than a picture, so only cite what is cited.
        for (const side of ["left", "right"] as const) {
          const id = beat.params[side].figureId;
          if (id) check(beat, "figure", id, `params.${side}.figureId`);
        }
        break;
    }
  }

  if (dangling.length) {
    throw new Error(`Storyboard cites ids that do not exist:\n  ${dangling.join("\n  ")}`);
  }
}

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
import { emitScene } from "../emit/archetypes/index.js";
import { enterableIds, partLabelProblem } from "../emit/camera.js";
import { ink } from "../emit/theme.js";
import type { Beat, Format, Source, Storyboard } from "../types.js";
import { FORMATS } from "../types.js";

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

/**
 * Every `inside` names a part the previous beat actually draws — and, where the
 * plan said which part it meant, the RIGHT one.
 *
 * THE SAME SHAPE AS THE CHECK ABOVE, one level in: a schema proves `inside` has
 * a beat and an element, and cannot prove the element exists. RULE 11 says only a
 * pipeline's `stageN`, a grid's `rgnN` and a stack's `layN` have interiors worth
 * entering, and a real plan asked to fly into `stage1` of an ANNOTATED-FIGURE —
 * which has notes and leader lines and no stages at all.
 *
 * AND ONE LEVEL IN AGAIN, because existing is not enough. `element` is an index,
 * so a plan that means the second stage and writes the third names a part that
 * does exist; `partLabelProblem` compares `inside.label` — what the plan says is
 * there — against what the archetype reports drawing.
 *
 * WHY IT MOVED HERE. The emitter already refuses this, so nothing shipped
 * broken. But it refuses at BUILD, which is after `narrate` has spent a minute
 * and a dozen network round trips synthesising speech for a storyboard that was
 * never going to build. `plan` is where the author is being told to read the file
 * anyway, and emitting a scene is cheap — the emitters build strings.
 *
 * Cheap enough to be exact rather than a table: the previous beat is emitted and
 * `enterableIds` is asked what it drew, so this cannot drift from the emitter the
 * way a hardcoded list of archetype interiors would. The same `Scene` carries
 * `parts`, so the label comparison rides along for nothing.
 */
export function assertInsideResolves(storyboard: Storyboard, source: Source): void {
  const format = FORMATS["deck-16x9"] as Format;
  const problems: string[] = [];

  for (const [i, beat] of storyboard.beats.entries()) {
    if (!beat.inside) continue;
    const previous = storyboard.beats[i - 1];
    if (!previous || previous.id !== beat.inside.beat) {
      problems.push(
        `${beat.id} happens inside "${beat.inside.beat}", which is not the beat immediately before it. Only the previous beat is still on screen to move through (RULE 11).`,
      );
      continue;
    }
    let drawn: string[];
    let parts: Readonly<Record<string, string>> | undefined;
    try {
      const sid = `s${i}`;
      const scene = emitScene(previous, { source, format, theme: ink, sid });
      drawn = enterableIds(sid, scene.html).map((id) => id.replace(`${sid}-`, ""));
      parts = scene.parts;
    } catch {
      // The beat cannot be drawn at all; `build` will say so in its own words.
      continue;
    }
    if (!drawn.includes(beat.inside.element)) {
      problems.push(
        `${beat.id} happens inside "${beat.inside.element}", which ${previous.id} (${previous.archetype}) does not draw. It draws: ${drawn.join(", ") || "nothing enterable"}.`,
      );
      continue;
    }
    const mismatch = partLabelProblem(beat.inside.element, beat.inside.label, parts);
    if (mismatch) {
      problems.push(
        `${beat.id} happens inside "${beat.inside.element}", which ${previous.id} (${previous.archetype}) ${mismatch}`,
      );
    }
  }

  if (problems.length) {
    throw new Error(
      `Storyboard asks for a camera move that cannot happen:\n  ${problems.join("\n  ")}`,
    );
  }
}

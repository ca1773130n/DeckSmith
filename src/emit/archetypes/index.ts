/**
 * The explanatory vocabulary, indexed by archetype.
 *
 * The mapped type is the point: adding an archetype to `Beat` without an emitter
 * beside it fails to compile, which is the only guarantee that keeps the union in
 * `types.ts` honest.
 */
import type { Archetype, Beat } from "../../types.js";
import { backdropFigure, glass, overBackdrop } from "../backdrop.js";
import type { EmitContext, Emitter, Scene } from "../kit.js";
import { annotatedFigure } from "./annotated-figure.js";
import { barCompare } from "./bar-compare.js";
import { callout } from "./callout.js";
import { claimFigure } from "./claim-figure.js";
import { dataTable } from "./data-table.js";
import { equationMorph } from "./equation-morph.js";
import { equationWalk } from "./equation-walk.js";
import { grid } from "./grid.js";
import { lineChart } from "./line-chart.js";
import { pipeline } from "./pipeline.js";
import { splitCompare } from "./split-compare.js";
import { stack } from "./stack.js";
import { stage } from "./stage.js";
import { title } from "./title.js";

export const emitters: { [A in Archetype]: Emitter<A> } = {
  // The ones that draw the mechanism. Listed first because that is the order the
  // planner is told to reach for them in.
  pipeline,
  "annotated-figure": annotatedFigure,
  grid,
  "bar-compare": barCompare,
  stack,
  "split-compare": splitCompare,
  "equation-walk": equationWalk,
  "equation-morph": equationMorph,
  "line-chart": lineChart,
  // The one that gives a picture the whole frame.
  stage,
  // The ones that describe.
  title,
  "claim-figure": claimFigure,
  "data-table": dataTable,
  callout,
};

/**
 * Dispatch a beat to its emitter, over its backdrop when it has one. The cast is the one place the pairing is taken
 * on trust: `emitters[beat.archetype]` is a union of fourteen emitters and TypeScript
 * will not narrow the key and the beat together. The table above already proves
 * every archetype has exactly one emitter of the right shape.
 */
export function emitScene(beat: Beat, ctx: EmitContext): Scene {
  const emit = emitters[beat.archetype] as Emitter<Archetype>;
  // A beat with a drawn backdrop is the same scene in glass colours, over its
  // picture (src/emit/backdrop.ts). Here rather than in the shell so every
  // pass that emits a beat — planCut, narrate, timing, the Director — sees it.
  const fig = backdropFigure(beat, ctx);
  if (!fig) return emit(beat, ctx);
  return overBackdrop(emit(beat, { ...ctx, theme: glass(ctx.theme) }), fig, ctx, beat.seconds);
}

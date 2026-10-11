/**
 * The explanatory vocabulary, indexed by archetype.
 *
 * The mapped type is the point: adding an archetype to `Beat` without an emitter
 * beside it fails to compile, which is the only guarantee that keeps the union in
 * `types.ts` honest.
 */
import { bespokeScene } from "../../bespoke/scene.js";
import type { Archetype, Beat } from "../../types.js";
import { FIELD_ARCHETYPES, V2_FIELD_ARCHETYPES } from "../../types.js";
import { backdropFigure, glass, overBackdrop, overField } from "../backdrop.js";
import { isV2 } from "../fit.js";
import type { EmitContext, Emitter, Scene, Tween } from "../kit.js";
import { PREVIEW, previewed } from "../kit.js";
import { annotatedFigure } from "./annotated-figure.js";
import { barCompare } from "./bar-compare.js";
import { callout } from "./callout.js";
import { claimFigure } from "./claim-figure.js";
import { dataTable } from "./data-table.js";
import { equationMorph } from "./equation-morph.js";
import { equationWalk } from "./equation-walk.js";
import { grid } from "./grid.js";
import { heroNumber } from "./hero-number.js";
import { kinetic } from "./kinetic.js";
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
  // The full-bleed ones that need no picture: a number, and a claim in motion.
  "hero-number": heroNumber,
  kinetic,
  // The ones that describe.
  title,
  "claim-figure": claimFigure,
  "data-table": dataTable,
  callout,
};

/**
 * Dispatch a beat to its emitter, over its backdrop when it has one. The cast is the one place the pairing is taken
 * on trust: `emitters[beat.archetype]` is a union of sixteen emitters and TypeScript
 * will not narrow the key and the beat together. The table above already proves
 * every archetype has exactly one emitter of the right shape.
 */
export function emitScene(beat: Beat, ctx: EmitContext): Scene {
  // A bespoke scene replaces the archetype for this beat and only this beat,
  // backdrop and field included: it is drawn around its own illustration.
  // Here rather than in `layout` so that every caller staging the beat gets it.
  const bespoke = ctx.bespoke?.[beat.id];
  if (bespoke) return bespokeScene(beat, ctx, bespoke);
  const scene = archetypeScene(beat, ctx);
  return isV2(ctx) ? previewParts(scene, ctx.sid) : scene;
}

/** The chrome's ids, which arrive as the slide opens and are never previewed. */
const CHROME = /-(?:e|h|k)$/;

/**
 * v2: every PART of a scene stands at `PREVIEW` from the open instead of
 * arriving from nothing, and comes to full when its tween runs — so every hold
 * shows the whole layout (the fill gate measures the content's box at each one,
 * src/verify/fill.ts) and the reveal still says which part is being spoken to.
 *
 * A part is an element addressed by id alone whose FIRST tween fades it in
 * from 0, and which no later tween fades out again: a transient (a packet, a
 * morph's intermediate, a highlight that comes and goes) or a part shown in
 * place of another would read as a ghost, so it keeps its own entrance. The
 * chrome and class-addressed words are left alone. The entrance's offset and
 * scale (`x`, `y`, `scale…`) are dropped: a previewed part stands where and as
 * large as it lands, so its words are never drawn under their declared size.
 */
export function previewParts(scene: Scene, sid: string): Scene {
  const firsts = new Map<string, Tween>();
  const hidden = new Set<string>();
  const byTime = [...scene.tl].sort((a, b) => a.at - b.at);
  for (const t of byTime) {
    if (!firsts.has(t.target)) firsts.set(t.target, t);
    else if (t.to.opacity === 0) hidden.add(t.target);
  }
  const part = (t: Tween) =>
    new RegExp(`^#${sid}-[\\w-]+$`).test(t.target) &&
    !CHROME.test(t.target) &&
    firsts.get(t.target) === t &&
    !hidden.has(t.target) &&
    t.from.opacity === 0 &&
    typeof t.to.opacity === "number" &&
    t.to.opacity > PREVIEW;
  const tl = scene.tl.flatMap((t): Tween[] => {
    if (!part(t)) return [t];
    const { x: _x, y: _y, scale: _s, scaleX: _sx, scaleY: _sy, ...from } = t.from;
    const { x: _tx, y: _ty, scale: _ts, scaleX: _tsx, scaleY: _tsy, ...to } = t.to;
    return previewed(t.target, from, to, t.at);
  });
  return { ...scene, tl };
}

function archetypeScene(beat: Beat, ctx: EmitContext): Scene {
  const emit = emitters[beat.archetype] as Emitter<Archetype>;
  // A beat with a drawn backdrop is the same scene in glass colours, over its
  // picture (src/emit/backdrop.ts). Here rather than in the shell so every
  // pass that emits a beat — planCut, narrate, timing, the Director — sees it.
  const fig = backdropFigure(beat, ctx);
  if (fig) {
    return overBackdrop(emit(beat, { ...ctx, theme: glass(ctx.theme) }), fig, ctx, beat.seconds);
  }
  // The full-bleed archetypes never fall back to the pack's ground: with no
  // picture they stand on a field of one of its colours (`fieldStep`), in glass.
  if (
    (FIELD_ARCHETYPES as readonly Archetype[]).includes(beat.archetype) ||
    (isV2(ctx) && (V2_FIELD_ARCHETYPES as readonly Archetype[]).includes(beat.archetype))
  ) {
    return overField(emit(beat, { ...ctx, theme: glass(ctx.theme) }), ctx, beat.seconds);
  }
  return emit(beat, ctx);
}

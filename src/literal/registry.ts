/**
 * EVERY KIND THE BUILD DRAWS, by name: one entry per name in src/types.ts
 * `LITERAL_KIND_NAMES`, a `Record` so a name added there does not compile
 * until it is drawn here, and nothing is registered at run time.
 *
 * - THE VERBS compose general operations on the source's own numbers:
 *   operate (an op chain on a picture, vectors or a matrix), evolve (a state
 *   under a stated rule), flow (stages, a graph, a timeline), place (items on
 *   axes, and the word forms: margins, lengths, combos, sets) and region
 *   (pieces of a picture cut by a stated rule). Most are drawn on the stage
 *   (./kinds/stage.ts).
 * - THE CROSS-CUTTING KINDS: recap (earlier scenes' own layers), prior-work
 *   (families by what an earlier scene computed or by their numbers) and
 *   table (the last resort).
 */
import type { LiteralKind } from "../types.js";
import type { KindImpl } from "./kind.js";
import { evolve } from "./kinds/evolve.js";
import { flow } from "./kinds/flow.js";
import { operate } from "./kinds/operate.js";
import { placeKind } from "./kinds/place.js";
import { priorWorkKind } from "./kinds/prior-work.js";
import { recapKind } from "./kinds/recap.js";
import { regionKind } from "./kinds/region.js";
import { verbKind } from "./kinds/stage.js";
import { tableKind } from "./kinds/table.js";

/** How large a verb reads its picture, for display (region reads the training size itself). */
export const PICTURE_SIDE = 768;

export const KINDS: Readonly<Record<LiteralKind, KindImpl>> = {
  operate: verbKind("operate", operate, {
    pictureSide: PICTURE_SIDE,
    pictureOf: (l) => (l.kind === "operate" ? l.picture : undefined),
  }),
  evolve: verbKind("evolve", evolve, {
    pictureSide: PICTURE_SIDE,
    pictureOf: (l) => (l.kind === "evolve" && l.rule === "noise" ? l.picture : undefined),
  }),
  flow: verbKind("flow", flow, { pictureSide: 0 }),
  place: placeKind,
  region: regionKind,
  recap: recapKind,
  "prior-work": priorWorkKind,
  table: tableKind,
};

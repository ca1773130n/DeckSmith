/**
 * Shared by the literal-scene tests: a kind's every declared slot, filled, so a
 * fragment can be drawn — there are no defaults (src/types.ts `LITERAL_KIND_DOCS`).
 */
import { type LITERAL_KIND_NAMES, literalSlotsOf } from "../src/types.js";

type Kind = (typeof LITERAL_KIND_NAMES)[number];

/** Every slot a kind declares, filled with its own name (and the values it may name). */
export function slotsFor(kind: Kind, over: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(literalSlotsOf(kind)).map(([slot, d]) => [
        slot,
        `${slot}${(d.vars ?? []).map((v) => ` {${v}}`).join("")}`,
      ]),
    ),
    ...over,
  };
}

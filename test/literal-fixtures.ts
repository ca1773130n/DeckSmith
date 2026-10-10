/**
 * Shared by the literal-scene tests: a kind's every declared slot, filled, so a
 * fragment can be drawn — there are no defaults (src/types.ts `LITERAL_KIND_DOCS`).
 */
import { type LITERAL_KIND_NAMES, literalSlotsOf } from "../src/types.js";

type Kind = (typeof LITERAL_KIND_NAMES)[number];

/** Every slot a kind declares, filled: numbers with these values, texts with their own names. */
export function slotsFor(kind: Kind, over: Record<string, string> = {}): Record<string, string> {
  const nums: Record<string, string> = {
    alpha: "0.6",
    levels: "4",
    momentum: "0.9",
    crop: "256",
    batch: "4",
    size: "512",
  };
  return {
    ...Object.fromEntries(
      Object.entries(literalSlotsOf(kind)).map(([slot, d]) => [
        slot,
        d.number
          ? (nums[slot] as string)
          : `${slot}${(d.vars ?? []).map((v) => ` {${v}}`).join("")}`,
      ]),
    ),
    ...over,
  };
}

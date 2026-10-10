/**
 * The mechanism family: seven literal kinds that show HOW a method works, each
 * a pure function of the source's own inputs (see each module's header for
 * what is exact and what is derived). Their slots and takeaway templates are
 * listed here so the planner, the judge and the tests read one table.
 */
import * as attention from "./attention.js";
import type { LiteralSlot } from "./common.js";
import * as diffusion from "./diffusion.js";
import * as messagePassing from "./message-passing.js";
import * as optimization from "./optimization.js";
import * as retrieval from "./retrieval.js";
import * as rlRollout from "./rl-rollout.js";
import * as splatting from "./splatting.js";

export const MECHANISM_KIND_NAMES = [
  "attention",
  "diffusion",
  "optimization",
  "splatting",
  "message-passing",
  "rl-rollout",
  "retrieval",
] as const;

export type MechanismKindName = (typeof MECHANISM_KIND_NAMES)[number];

export const MECHANISM_KINDS: Readonly<
  Record<MechanismKindName, { slots: Readonly<Record<string, LiteralSlot>>; takeaway: string }>
> = {
  attention: { slots: attention.SLOTS, takeaway: attention.TAKEAWAY },
  diffusion: { slots: diffusion.SLOTS, takeaway: diffusion.TAKEAWAY },
  optimization: { slots: optimization.SLOTS, takeaway: optimization.TAKEAWAY },
  splatting: { slots: splatting.SLOTS, takeaway: splatting.TAKEAWAY },
  "message-passing": { slots: messagePassing.SLOTS, takeaway: messagePassing.TAKEAWAY },
  "rl-rollout": { slots: rlRollout.SLOTS, takeaway: rlRollout.TAKEAWAY },
  retrieval: { slots: retrieval.SLOTS, takeaway: retrieval.TAKEAWAY },
};

export { attention, diffusion, messagePassing, optimization, retrieval, rlRollout, splatting };

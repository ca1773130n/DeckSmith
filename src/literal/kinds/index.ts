/**
 * The mechanism family: seven literal kinds that show HOW a method works, each
 * a pure function of the source's own inputs (see each module's header for
 * what is exact and what is derived). Their slots and truth rules are their
 * planner entries (src/types.ts `LITERAL_KIND_DOCS`); their adapters to the
 * literal pass are in ./mechanisms.ts. Listed here with their takeaway
 * templates, so the judge fixtures and the tests read one table.
 */
import * as attention from "./attention.js";
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

/** The sentence each kind's frames convey, `{var}` filled from the result. */
export const MECHANISM_TAKEAWAYS: Readonly<Record<MechanismKindName, string>> = {
  attention: attention.TAKEAWAY,
  diffusion: diffusion.TAKEAWAY,
  optimization: optimization.TAKEAWAY,
  splatting: splatting.TAKEAWAY,
  "message-passing": messagePassing.TAKEAWAY,
  "rl-rollout": rlRollout.TAKEAWAY,
  retrieval: retrieval.TAKEAWAY,
};

export { attention, diffusion, messagePassing, optimization, retrieval, rlRollout, splatting };

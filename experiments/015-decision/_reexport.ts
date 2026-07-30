/**
 * The shipped pieces this experiment must use rather than re-implement.
 *
 * Bundled to `out/bits.mjs` by `bits.sh` so the experiment can `import` them
 * from plain Node without a TypeScript loader. Every name here is shipped code:
 * the point of the whole exercise is that no gate in it is a lookalike
 * (VOCABULARY-REVIEW §3.3, §4.3).
 */
export { systemPrompt, renderSource } from "../../src/plan/prompt.js";
export { SCHEMA } from "../../src/plan/codex.js";
export { storyboardSchema, FORMATS, sourceSchema, prefsSchema } from "../../src/types.js";
export { assertRefsResolve } from "../../src/plan/refs.js";

export { check } from "../../src/verify/check.js";
export { scanTypeFloor, TYPE_FLOOR_PX } from "../../src/verify/typefloor.js";
// The new primary metric (017 PREREGISTERED §4). Shipped code, at its shipped
// default floor — a floor tuned for this experiment would void it (§8).
export { fidelity } from "../../src/verify/fidelity.js";
export { resolveTheme } from "../../src/emit/themes/index.js";

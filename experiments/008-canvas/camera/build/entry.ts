/**
 * Re-export exactly what the camera experiment needs from the real emit layer,
 * so the plates it tours are byte-for-byte the scenes DeckSmith ships today.
 * Bundled by `build.mjs`; nothing under src/ is modified.
 */
export { emitScene } from "../../../../src/emit/archetypes/index.js";
export { emitComposition } from "../../../../src/emit/composition.js";
export { emitIsland } from "../../../../src/emit/island.js";
export { resolveTheme, baseCss, pace } from "../../../../src/emit/theme.js";
export { FORMATS } from "../../../../src/types.js";
export type { Scene, EmitContext } from "../../../../src/emit/kit.js";

/**
 * Arm VOCAB's schema: the compositional animation vocabulary under test.
 *
 * Objects, transforms, a camera — the three things the owner's question names.
 * Carried forward from `experiments/013-vocabulary/planner/schema.mjs` almost
 * unchanged, on purpose: the point of this experiment is to re-measure the same
 * vocabulary against a metric fixed in advance and a build that actually happens,
 * not to invent a different vocabulary and lose comparability with the 26 runs
 * already on disk. The additions are the camera (§3 of PREREGISTERED.md demands
 * it of both arms) and `size` on text, which the emitter needs to wrap a label.
 *
 * The constraints it must satisfy to be adoptable at all, unchanged from 013:
 *  - Every animation is a fromTo over an explicit [start, start+dur) window, so
 *    scene state is a pure function of t. No updaters, no callbacks, no
 *    ValueTrackers. (Invariants 1, 2, 11.)
 *  - Date.now / Math.random / network are not expressible.
 *  - Expressive enough to hand-write demo/storyboard.json's b02 (pipeline), b05
 *    (equation-walk) and b08 (bar-compare) without an archetype — which is what
 *    `control/` demonstrates.
 *
 * NO `description` STRINGS, deliberately. The shipped `SCHEMA` has zero of them
 * (measured: 0 occurrences in 18,265 bytes), so adding them here would hand this
 * arm an information channel the other arm does not use. See PREREGISTERED §2.1.
 */
import { z } from "zod";

/* ------------------------------------------------ copy of codex.ts internals */

/**
 * `forStructuredOutput` from `src/plan/codex.ts:60`, copied because it is not
 * exported. Copied VERBATIM rather than approximated: it is the lossy rewrite
 * that makes every optional property required and widens it with `{type:"null"}`,
 * and it is the reason both arms' captures need null-stripping before they
 * validate (`scripts/score.mjs:stripNulls`, `VOCABULARY-REVIEW` §9.3). Both arms
 * go through the identical transport or the comparison is not one.
 */
const UNSUPPORTED = new Set([
  "$schema",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

export function forStructuredOutput(node) {
  if (Array.isArray(node)) return node.map(forStructuredOutput);
  if (node === null || typeof node !== "object") return node;
  const src = node;
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (UNSUPPORTED.has(key)) continue;
    out[key === "oneOf" ? "anyOf" : key] = forStructuredOutput(value);
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    const properties = out.properties;
    if (properties) {
      const wasRequired = new Set(src.required ?? []);
      for (const key of Object.keys(properties)) {
        if (wasRequired.has(key)) continue;
        properties[key] = { anyOf: [properties[key], { type: "null" }] };
      }
      out.required = Object.keys(properties);
    }
  }
  return out;
}

export function stripNulls(node) {
  if (Array.isArray(node)) return node.map(stripNulls);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null) continue;
    out[key] = stripNulls(value);
  }
  return out;
}

/* ------------------------------------------------------------ the vocabulary */

const tone = z.enum(["a", "b", "c", "d", "muted"]);
const slug = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const vec = z.object({ x: z.number(), y: z.number() });

export const objectSchema = z.object({
  id: slug,
  kind: z.enum(["text", "tex", "rect", "ellipse", "arrow", "polyline", "image", "group"]),
  parent: slug.optional(),
  at: vec,
  size: z.object({ w: z.number(), h: z.number() }).optional(),
  text: z.string().optional(),
  tex: z.string().optional(),
  figureId: z.string().optional(),
  points: z.array(vec).optional(),
  fontPx: z.number().optional(),
  tone: tone.optional(),
  fill: z.enum(["none", "tone", "surface"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
});

export const animSchema = z.object({
  target: slug,
  op: z.enum([
    "fadeIn",
    "fadeOut",
    "draw",
    "growFrom",
    "moveTo",
    "scaleTo",
    "recolor",
    "highlight",
    "countTo",
    "morphInto",
  ]),
  from: z.number().optional(),
  to: z.number().optional(),
  toPos: vec.optional(),
  toObject: slug.optional(),
  toTone: tone.optional(),
  anchor: z.enum(["left", "right", "top", "bottom", "centre"]).optional(),
  part: z.string().optional(),
  start: z.number().min(0),
  dur: z.number().positive(),
  ease: z.enum(["linear", "out", "inOut", "back"]),
});

/**
 * The camera, shaped exactly like the shipped one (`src/emit/camera.ts:Dive`)
 * and for the reason PREREGISTERED §3 gives: a dive that LANDS AND ENDS THE
 * SCENE, never a dive that lands and then holds. The shipped `inside` works that
 * way — the zoomed frame the audience stops on is the *next* beat's own scene at
 * scale 1, so no arm-MENU deck ever holds on a magnified plate. An arm-VOCAB
 * camera that held while zoomed would fail `canvas_overflow` at that hold for a
 * reason the menu structurally avoids, and the primary metric would be measuring
 * my choice of camera semantics instead of the vocabulary.
 */
export const cameraSchema = z.object({
  on: slug,
  k: z.number(),
  t0: z.number().min(0),
  dur: z.number().positive(),
});

export const refSchema = z.object({
  kind: z.enum(["section", "figure", "equation", "table"]),
  id: z.string(),
});

export const sceneSchema = z.object({
  id: z.string(),
  intent: z.string(),
  claim: z.string().optional(),
  narration: z.string(),
  evidence: z.array(refSchema),
  weight: z.number().min(0).max(1),
  seconds: z.number().positive().max(60),
  objects: z.array(objectSchema).min(1),
  anims: z.array(animSchema),
  holds: z.array(z.number()).min(1),
  camera: cameraSchema.optional(),
});

export const compositionSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  lang: z.string(),
  scenes: z.array(sceneSchema).min(1),
});

export const COMPOSITION_JSON_SCHEMA = forStructuredOutput(
  z.toJSONSchema(compositionSchema, { io: "input" }),
);

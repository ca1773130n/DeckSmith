/**
 * The compositional ("algebra") vocabulary under test.
 *
 * Design constraints it must satisfy to be adoptable at all:
 *  - Every animation is a fromTo over an explicit [start, start+dur) interval,
 *    so scene state is a pure function of t. No updaters, no ValueTrackers, no
 *    callbacks. (Invariants 1, 2, 11.)
 *  - No Date.now / Math.random / network is expressible.
 *  - Expressive enough to hand-write demo/storyboard.json's b02 (pipeline),
 *    b05 (equation-walk) and b08 (bar-compare) without an archetype.
 *
 * The JSON Schema handed to Codex is produced through the same lossy rewrite
 * production uses (src/plan/codex.ts forStructuredOutput), copied here verbatim
 * so the two arms are measured through identical machinery.
 */
import { z } from "zod";

/* ------------------------------------------------ copy of codex.ts internals */

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

/**
 * A drawable. Positions and sizes are fractions of the 1920x1080 stage; `at` is
 * the CENTRE of the object. `fontPx` is literal pixels at 1920x1080 so the
 * 40px audience-text floor is directly checkable.
 */
export const objectSchema = z.object({
  id: slug,
  kind: z.enum(["text", "tex", "rect", "ellipse", "arrow", "polyline", "image", "group"]),
  /** Group membership. A transform on a group applies to every member. */
  parent: slug.optional(),
  at: vec,
  size: z.object({ w: z.number(), h: z.number() }).optional(),
  /** text / tex / image payloads. Exactly one is meaningful per kind. */
  text: z.string().optional(),
  tex: z.string().optional(),
  figureId: z.string().optional(),
  /** arrow and polyline geometry, stage fractions, in draw order. */
  points: z.array(vec).optional(),
  fontPx: z.number().optional(),
  tone: tone.optional(),
  fill: z.enum(["none", "tone", "surface"]).optional(),
  /** State at t=0, before any animation touches it. */
  opacity: z.number().min(0).max(1).optional(),
});

/**
 * One tween. Semantics are fromTo over [start, start+dur): whatever the op
 * changes is at its `from` value for t <= start and its `to` value for
 * t >= start+dur. Nothing outside an anim's window may depend on it.
 */
export const animSchema = z.object({
  target: slug,
  op: z.enum([
    "fadeIn",
    "fadeOut",
    "draw", // stroke-dash reveal; arrow / polyline / rect only
    "growFrom", // scale one axis from 0; needs `anchor`
    "moveTo", // needs `toPos`
    "scaleTo", // needs `to`
    "recolor", // needs `toTone`
    "highlight", // emphasise `part` of a tex object; needs `part`
    "countTo", // number roll on a text object; needs `from` and `to`
    "morphInto", // Transform(a, b); needs `toObject`
  ]),
  from: z.number().optional(),
  to: z.number().optional(),
  toPos: vec.optional(),
  toObject: slug.optional(),
  toTone: tone.optional(),
  anchor: z.enum(["left", "right", "top", "bottom", "centre"]).optional(),
  /** For `highlight`: a substring of the target tex, verbatim. */
  part: z.string().optional(),
  /** Seconds from the start of this scene. */
  start: z.number().min(0),
  dur: z.number().positive(),
  ease: z.enum(["linear", "out", "inOut", "back"]),
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
  /** Total length of the scene in seconds. Every anim must finish inside it. */
  seconds: z.number().positive().max(60),
  objects: z.array(objectSchema).min(1),
  anims: z.array(animSchema),
  /** Absolute seconds inside the scene where the render freezes for the voice. */
  holds: z.array(z.number()).min(1),
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

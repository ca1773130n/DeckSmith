/**
 * Planning, backed by the Codex CLI already installed on the machine.
 *
 * Planning is the one step that needs a model, and metered API tokens are a poor
 * trade for a step whose whole design is that a human reads and edits it. `codex
 * exec` runs under the subscription that is already paid for, and its
 * `--output-schema` gives the same guarantee an API structured-output call does:
 * the final message is schema-conformant JSON and nothing else — no prose, no
 * code fences to strip.
 *
 * Two gates, deliberately redundant. The schema makes the response well-formed;
 * `storyboardSchema.parse` proves it anyway, because the schema handed to the CLI
 * is a lossy subset (see `forStructuredOutput`). Then `assertRefsResolve` proves
 * the storyboard is about *this* source — the property no schema can express and
 * the one a planner actually gets wrong.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { bespokeFor, designFor, type Prefs } from "../prefs.js";
import {
  type Archetype,
  type Beat,
  type Literal,
  literalSchema,
  prefsSchema,
  type Source,
  type Storyboard,
  storyboardSchema,
} from "../types.js";
import { paperArcRequested } from "./arc.js";
import {
  coverageFindings,
  literalFindings,
  pictureFindings,
  slidewareFindings,
  sourceParts,
  withStockLabels,
} from "./coverage.js";
import { renderSource, sourceBlocks, systemPrompt } from "./prompt.js";
import { assertRefsResolve, pendingIllustrations } from "./refs.js";
import { beatCap, lengthFindings, shapesFor, sizeFindings, varietyFindings } from "./variety.js";

/** Planning a long source is minutes of work, not seconds. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * Keywords JSON Schema supports but structured-output backends generally do not.
 *
 * Dropping them does NOT lose only redundant validation, which this note used to
 * claim. `storyboardSchema.parse` still enforces every one of them on the way
 * back — and that is the hazard, not the reassurance: a bound the model cannot
 * see is a bound it can cross, and crossing it fails the parse and throws away
 * the whole storyboard. Ten minutes of planning lost to a number nobody told the
 * model about. A field with a range the backend cannot express therefore belongs
 * in `PLANNER_INVISIBLE` until the prompt can carry the range in prose.
 *
 * `minItems` and `maxItems` ARE kept (2026-10-16). Stripped, they cost seven
 * refusals over two unseen papers — an empty `terms`, `notes`, or a one-item
 * `points`, each a raw zod path the repair could not act on, Chinchilla's twice
 * in a row. Asked live for `[]` under `minItems: 2`, Codex returned two items;
 * asked for six under `maxItems: 3`, three. The rest here are untested.
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
  "uniqueItems",
]);

/**
 * Rewrite a zod-emitted JSON Schema into the strict dialect the backend accepts.
 *
 * The one that is not obvious, and that no amount of reading found — it took the
 * first live call to surface: **every key in `properties` must appear in
 * `required`.** Leaving an optional field out is a 400, not a permissive
 * default. So optionality is expressed the only way strict mode allows: the key
 * is required, and its value may be null. `stripNulls` turns those back into
 * `undefined` on the way in, which is what zod's `.optional()` expects.
 */
function forStructuredOutput(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forStructuredOutput);
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (UNSUPPORTED.has(key)) continue;
    out[key === "oneOf" ? "anyOf" : key] = forStructuredOutput(value);
  }

  if (out.type === "object") {
    out.additionalProperties = false;
    const properties = out.properties as Record<string, unknown> | undefined;
    if (properties) {
      const wasRequired = new Set((src.required as string[] | undefined) ?? []);
      for (const key of Object.keys(properties)) {
        if (wasRequired.has(key)) continue;
        properties[key] = { anyOf: [properties[key], { type: "null" }] };
      }
      out.required = Object.keys(properties);
    }
  }
  return out;
}

/**
 * Drop the nulls that stand in for absent optional fields. Only object keys:
 * an explicit null inside an array would be data, and the schema never asks for
 * one.
 */
function stripNulls(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNulls);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null) continue;
    out[key] = stripNulls(value);
  }
  return out;
}

// `io: "input"` so fields carrying a zod default stay optional — the model must
// not be forced to invent a theme name it has never seen.
/**
 * Params the planner must not see, by name.
 *
 * `tilt` is the first. It carries a range — 0 to 18 degrees — that
 * `forStructuredOutput` strips, because no structured-output backend takes
 * `minimum`. So the schema the model receives declares `tilt` as an unbounded
 * number AND lists it in `required`, which is an invitation to write one; and
 * `storyboardSchema.safeParse` then rejects anything over 18 and discards the
 * entire storyboard. The model was being required to guess inside a range it was
 * never shown.
 *
 * It is not a planner concern yet in any case. A tilt is paid for out of the
 * layout's type budget, and nothing in the prompt tells the model when depth
 * earns its place, so the honest state is "hand authors and the emitter may set
 * this; the planner may not". When there is a rule worth trusting, this is where
 * it stops being hidden.
 */
const PLANNER_INVISIBLE = new Set(["tilt"]);

/**
 * The keys hidden from THIS run's schema.
 *
 * `role` is hidden unless the paper arc was asked for, and that is not tidiness:
 * strict mode requires every declared property to appear in `required`, so a
 * `role` left in the schema would force the planner to consider a structural job
 * on every beat of every deck — including the twelve archetypes' worth of
 * general explainers that have no arc. Hidden, a general-genre plan CANNOT come
 * back carrying one, so no post-hoc check is needed to reject what the model was
 * never offered, and the schema bytes are identical to what they were.
 */
function plannerInvisible(
  prefs: Pick<Prefs, "genre" | "bespoke" | "design"> & { images?: Prefs["images"] },
  source?: Source,
): ReadonlySet<string> {
  const hidden = new Set(PLANNER_INVISIBLE);
  // Picture briefs with images off: `readPlan` refuses every one, so a schema that
  // offers them (strict mode makes each a required key) asks the model for a plan
  // that is thrown away. 0.9.4 grew them to 12 backdrop and 20 illustration keys,
  // and 12 of 109 HypePaper plans on 2026-10-12 died on exactly this.
  if (prefs.images && !prefs.images.enabled) {
    hidden.add("illustration");
    hidden.add("backdrop");
  }
  if (!paperArcRequested(prefs)) hidden.add("role");
  // `bespoke` for the same reason as `role`: shown only to a plan whose build
  // will draw bespoke scenes (v2, unless `--no-bespoke`), so a classic plan's
  // schema bytes are what they were. `takeaway` and `literal` ride with it:
  // a literal scene is a scene the build draws instead of a bespoke one.
  if (!bespokeFor(prefs, designFor(prefs))) {
    hidden.add("bespoke");
    hidden.add("takeaway");
    hidden.add("literal");
  }
  // `part` only when the source HAS parts (src/plan/coverage.ts): a source that
  // is not an analysis is planned exactly as it was.
  if (!source || !sourceParts(source).length) hidden.add("part");
  return hidden;
}

/** Strip `hidden` keys, and the `required` entries naming them. */
function hideFromPlanner(node: unknown, hidden: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => hideFromPlanner(n, hidden));
  if (node === null || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "properties" && value && typeof value === "object") {
      const kept: Record<string, unknown> = {};
      for (const [prop, sub] of Object.entries(value as Record<string, unknown>))
        if (!hidden.has(prop)) kept[prop] = hideFromPlanner(sub, hidden);
      // A figure archetype takes `figureId` OR an `illustration`. With the brief
      // hidden, the id is the only way left, so its null goes too: strict mode
      // had made it nullable, and unseen-paper plans (2026-10-14) sent
      // `figureId: null` on claim-figure and stage, refused twice over.
      const fig = kept.figureId as { anyOf?: Array<{ type?: string }> } | undefined;
      if ("illustration" in value && hidden.has("illustration") && fig?.anyOf) {
        const real = fig.anyOf.filter((t) => t.type !== "null");
        if (real.length === 1) kept.figureId = real[0];
      }
      out.properties = kept;
      continue;
    }
    if (key === "required" && Array.isArray(value)) {
      out.required = value.filter((r) => typeof r !== "string" || !hidden.has(r));
      continue;
    }
    out[key] = hideFromPlanner(value, hidden);
  }
  return out;
}

/** An `operate` draws a stated formula term by term, from these fields… */
const OPERATE_TERMS = ["equation", "given", "terms"];
/** …or runs an input through a chain of ops, from these. */
const OPERATE_CHAIN = [
  "picture",
  "vectors",
  "bins",
  "matrix",
  "condition",
  "chain",
  "compare",
  "alt",
];

/**
 * THE PLANNER PICKS ONE OPERATE: a formula or a chain, never neither.
 *
 * As one object every one of these fields is optional, so strict mode makes each
 * nullable, and the planner sent an operate with an `equation` and nothing to
 * evaluate — eight times over two unseen papers (2026-10-14), each refused at
 * plan time. `minItems` cannot say "this one or that one" (an optional field
 * is still nullable); two variants can. The formula variant REQUIRES `terms`,
 * `equation` and `given` (their nulls dropped) and has no chain fields; the
 * chain variant has no formula fields, so the only way to an equation is terms.
 * Absent keys come back as zod's defaults, so the storyboard schema is unchanged.
 */
function splitOperate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(splitOperate);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] =
      key === "anyOf" && Array.isArray(value)
        ? value.flatMap((v) => (isOperate(v) ? operateVariants(v) : [splitOperate(v)]))
        : splitOperate(value);
  }
  return out;
}

function isOperate(v: unknown): v is { properties: Record<string, unknown> } {
  const kind = (v as { properties?: { kind?: { const?: unknown } } } | null)?.properties?.kind;
  return kind?.const === "operate";
}

function operateVariants(v: { properties: Record<string, unknown> }): unknown[] {
  const only = (drop: readonly string[], need: readonly string[] = []) => {
    const properties: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(v.properties)) {
      if (drop.includes(k)) continue;
      const any = (p as { anyOf?: Array<{ type?: string }> }).anyOf;
      const real = any?.filter((t) => t.type !== "null");
      properties[k] = need.includes(k) && real?.length === 1 ? real[0] : p;
    }
    return { ...v, properties, required: Object.keys(properties) };
  };
  return [only(OPERATE_CHAIN, OPERATE_TERMS), only(OPERATE_TERMS)];
}

/**
 * The schema for one run. `role` is present only when the paper arc was asked
 * for; `part` only when `source` has parts to cover.
 */
export function schemaFor(
  prefs: Pick<Prefs, "genre" | "bespoke" | "design"> & { images?: Prefs["images"] },
  source?: Source,
): unknown {
  return shareLiteral(
    splitOperate(
      hideFromPlanner(
        forStructuredOutput(z.toJSONSchema(storyboardSchema, { io: "input" })),
        plannerInvisible(prefs, source),
      ),
    ),
  );
}

/**
 * ONE `literal`, REFERENCED BY EVERY BEAT (2026-10-16). zod inlines it into each
 * of the sixteen archetype variants: 18.5 KB sixteen times, 297 of the
 * schema's 327 KB. From 12:34 that day every deck ask failed within seconds on
 * "Incomplete response returned, reason: max_output_tokens" — FlashAttention
 * and Chinchilla alike, at any reasoning effort, tools on or off — and so did a
 * one-line prompt with that schema, while the same prompt with a small schema
 * answered in 7s. With the scene in `$defs` the schema is 49 KB and the
 * one-line prompt answers in 9s.
 */
function shareLiteral(schema: unknown): unknown {
  const root = schema as {
    properties: { beats: { items: { anyOf: Array<{ properties: Record<string, unknown> }> } } };
  };
  const variants = root.properties.beats.items.anyOf;
  const literal = variants[0]?.properties.literal;
  if (!literal) return schema;
  const one = JSON.stringify(literal);
  if (!variants.every((v) => JSON.stringify(v.properties.literal) === one))
    throw new Error("schemaFor: the beat variants carry different `literal` schemas.");
  const ref = { $ref: "#/$defs/literal" };
  return {
    ...root,
    $defs: { literal },
    properties: {
      ...root.properties,
      beats: {
        ...root.properties.beats,
        items: {
          ...root.properties.beats.items,
          anyOf: variants.map((v) => ({ ...v, properties: { ...v.properties, literal: ref } })),
        },
      },
    },
  };
}

/**
 * The default-preferences schema, still exported: `general` hides `role`, and
 * images default off, so it hides the picture briefs too (0.9.5).
 */
export const SCHEMA = schemaFor(prefsSchema.parse({}));

export interface CodexOptions {
  /** Left unset by default: use whatever model the user's Codex is configured for. */
  model?: string;
  timeoutMs?: number;
  /**
   * What the person asking for the deck chose. Omitted means the schema's
   * defaults, which is what a bare `codexPlanner(source)` has always sent.
   */
  prefs?: Prefs;
  /** Swappable so a test can drive the real parse path without spawning anything. */
  run?: Runner;
  /** Told what a plan broke, before each repair round (at most `REPAIRS`) is asked for. */
  onRepair?: (broken: readonly string[]) => void;
  /** Told each deck answer's beat count and the beats that carry a literal scene. */
  onAnswer?: (beats: number, scenes: readonly string[]) => void;
  /** Told a scene is redrawn on its own, after the deck, and why. */
  onScene?: (beat: string, broken: readonly string[]) => void;
  /** Told the beats whose scene was dropped (still broken after its own repairs, or broken only by a symbolic quantity), and why. */
  onDropScenes?: (beats: readonly string[], why: readonly string[]) => void;
  /** Told a beat still beside its own shape after the last repair is redrawn on its own, as one of `shapes`. */
  onReshape?: (beat: string, shapes: readonly string[]) => void;
  /** Each source figure's panel count as the build will cut it, when the caller read them. */
  panels?: Readonly<Record<string, number>>;
}

export interface RunnerArgs {
  prompt: string;
  schemaPath: string;
  outPath: string;
  model?: string;
  timeoutMs: number;
  /** Where the agent runs. Absent means wherever this process is, which planning never cares about. */
  cwd?: string;
  /**
   * `read-only` unless said otherwise. `workspace-write` exists for the one
   * caller that needs a file back — `illustrate`'s Codex rung — and needs a
   * `cwd` to fence the writes to.
   */
  sandbox?: "read-only" | "workspace-write";
  /** Images attached to the prompt (`codex exec -i`). The bespoke critique round sends its frames. */
  images?: string[];
  /** The CLI to run. Absent: `codex` on PATH. */
  bin?: string;
  /** Told the run's token count when the CLI reports one. */
  onUsage?: (tokens: number) => void;
  /** Extra `-c key=value` overrides, in order (see `leanCodexConfig`). */
  config?: readonly string[];
}

/** What the planner needs from the outside world: a prompt in, a final message out. */
export type Runner = (args: RunnerArgs) => Promise<void>;

export async function codexPlanner(source: Source, opts: CodexOptions = {}): Promise<Storyboard> {
  const prefs = opts.prefs ?? prefsSchema.parse({});
  const dir = await mkdtemp(join(tmpdir(), "decksmith-plan-"));
  try {
    const schemaPath = join(dir, "storyboard.schema.json");
    const outPath = join(dir, "storyboard.json");
    // Per run, not the module constant: `role` exists in the schema only when
    // the paper arc was asked for.
    const schema = schemaFor(prefs, source);
    await writeFile(schemaPath, JSON.stringify(schema));

    const ask = async (prompt: string): Promise<Storyboard> => {
      await rm(outPath, { force: true });
      await (opts.run ?? runCodex)({
        prompt,
        schemaPath,
        outPath,
        ...(opts.model === undefined ? {} : { model: opts.model }),
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      return withStockLabels(await readPlan(outPath, source, prefs), source);
    };

    // VARIETY AND COVERAGE ARE CHECKED, NOT HOPED FOR (src/plan/variety.ts,
    // src/plan/coverage.ts). A plan that breaks either — or that fails the
    // schema's bounds or cites what the source lacks (`PlanRejected`) — goes back
    // with the reasons and its own JSON, so the repair keeps the planner's content
    // and changes only what is named, at most `REPAIRS` times; a plan still broken
    // then is refused, loudly, rather than written to a storyboard that builds
    // green and looks like every other deck or skips half the source. Until 0.9.5
    // a schema or reference miss threw on the first answer: most of HypePaper's 40
    // failed plans on 2026-10-12 were one out-of-range number or one invented id.
    const prompt = buildPrompt(source, prefs);
    const takeaways = !!bespokeFor(prefs, designFor(prefs));
    const literalBroken = (plan: Storyboard) =>
      literalFindings(plan, source, { takeaways, ...(opts.panels ? { panels: opts.panels } : {}) });
    /** A finding a beat's own scene answers for. */
    const of = (id: string) => (m: string) => m.startsWith(`${id}'s `) || m.startsWith(`${id} `);
    /** The literal findings, as the deck's and as each scene's. */
    const split = (plan: Storyboard) => {
      const all = literalBroken(plan);
      const ids = plan.beats.filter((b) => b.literal).map((b) => b.id);
      const scene = all.filter((m) => ids.some((id) => of(id)(m)));
      return { deck: all.filter((m) => !scene.includes(m)), scene };
    };
    const findings = (plan: Storyboard): Findings => ({
      refused: [],
      size: sizeFindings(plan, prefs.slides),
      variety: varietyFindings(plan, prefs.images, prefs.design),
      coverage: [...coverageFindings(plan, source), ...split(plan).deck],
      advice: [...pictureFindings(plan, source), ...slidewareFindings(plan, source)],
    });
    /** One answer: the plan if it validated, the JSON either way, what it broke. */
    type Answer = { plan?: Storyboard; json: unknown; broken: Findings; rejected?: string };
    // A DECK REPAIR KEEPS ITS SCENES (2026-10-15). A deck repair is never asked
    // to remove a scene — the scene's own findings wait for `scenes` — yet
    // FlashAttention's seven went to none on a repair asked only for coverage,
    // and Chinchilla's two on a merge. So a beat that comes back under its id
    // without the scene it last had gets that scene back, and `scenes` judges
    // it. A merged beat under a new id has no scene to get back.
    const drawn = new Map<string, Literal>();
    const restored = (plan: Storyboard): { plan: Storyboard; back: Set<string> } => {
      const back = new Set(
        plan.beats.filter((b) => !b.literal && drawn.has(b.id)).map((b) => b.id),
      );
      const beats = plan.beats.map((b) => {
        const lit = back.has(b.id) ? drawn.get(b.id) : b.literal;
        if (lit) drawn.set(b.id, lit);
        return lit ? { ...b, literal: lit } : b;
      });
      return { plan: { ...plan, beats }, back };
    };
    const attempt = async (p: string): Promise<Answer> => {
      try {
        const { plan, back } = restored(await ask(p));
        opts.onAnswer?.(
          plan.beats.length,
          plan.beats
            .filter((b) => b.literal)
            .map(
              (b) => `${b.id} (${b.literal?.kind}${back.has(b.id) ? ", kept from before" : ""})`,
            ),
        );
        return { plan, json: plan, broken: findings(plan) };
      } catch (err) {
        if (!(err instanceof PlanRejected)) throw err;
        // A REFUSED PLAN IS STILL COUNTED (2026-10-23). Chinchilla's round 27 came
        // back at 24 beats with one invented figure id; the repair was told only
        // of the id, fixed it, kept 24 beats, and was refused on the last round
        // for a length it had never been told of.
        const size = lengthFindings(beatCount(err.plan), prefs.slides);
        const broken = { refused: err.problems, size, variety: [], coverage: [], advice: [] };
        return { json: err.plan, broken, rejected: err.message };
      }
    };

    // EACH SCENE IS REPAIRED ON ITS OWN, AFTER THE DECK (2026-10-15). Repaired
    // with the deck, a broken scene was cheapest to fix by deleting it: twelve
    // rounds over two unseen papers, and every plan that converged drew no scene
    // at all. Here the deck is fixed, a scene's ask may return only that scene,
    // and one still broken after `SCENE_REPAIRS` costs that beat its scene — it is
    // drawn by its archetype, and named — never the deck.
    const sceneSchemaPath = join(dir, "scene.schema.json");
    const brokenOf = (plan: Storyboard, id: string) => split(plan).scene.filter(of(id));
    // A DROP IS TOLD BY THE LAST ATTEMPT (2026-10-18). The warning used to
    // re-judge the scene as first planned, so the last redraw's findings were
    // computed and never shown: b08's place findings for an operate scene.
    const lastTry = new Map<string, readonly string[]>();
    const redraw = async (deck: Storyboard, id: string): Promise<Literal | undefined> => {
      let plan = deck;
      let broken = brokenOf(plan, id);
      for (let t = 1; t <= SCENE_REPAIRS; t++) {
        opts.onScene?.(id, broken);
        const out = join(dir, `scene-${id}-${t}.json`);
        try {
          await (opts.run ?? runCodex)({
            prompt: scenePrompt(prompt, plan, id, broken),
            schemaPath: sceneSchemaPath,
            outPath: out,
            ...(opts.model === undefined ? {} : { model: opts.model }),
            timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          });
        } catch (err) {
          broken = [`${id}'s scene: the ask failed: ${err instanceof Error ? err.message : err}`];
          continue;
        }
        const got = await readScene(out);
        if ("problems" in got) {
          broken = got.problems.map((m) => `${id}'s scene: ${m}`);
          continue;
        }
        const next = withStockLabels(withScene(plan, id, got.literal), source);
        try {
          assertRefsResolve(next, source, { pending: prefs.images.enabled ? "allow" : "refuse" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          broken = msg
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((m) => `${id}'s scene: ${m}`);
          continue;
        }
        plan = next;
        broken = brokenOf(plan, id);
        if (!broken.length) return plan.beats.find((b) => b.id === id)?.literal;
      }
      lastTry.set(id, broken);
      return undefined;
    };
    const scenes = async (planned: Storyboard): Promise<Storyboard> => {
      let deck = planned;
      // A SYMBOLIC QUANTITY IS NOT REDRAWN (2026-10-15). Θ(N²) against
      // Θ(N²d²/M) has no length to draw (Θ hides the constants), and Codex
      // asked again kept the symbols: 5 of FlashAttention's 8 drops in round 17.
      // A scene broken only by them is dropped before any ask, and its beat's
      // archetype shows the expressions as the paper writes them.
      const symbolic = deck.beats.filter((b) => {
        const broken = b.literal ? brokenOf(deck, b.id) : [];
        return broken.length > 0 && broken.every(isSymbolic);
      });
      if (symbolic.length) {
        opts.onDropScenes?.(
          symbolic.map((b) => b.id),
          split(deck).scene.filter((m) => symbolic.some((b) => of(b.id)(m))),
        );
        deck = {
          ...deck,
          beats: deck.beats.map((b) => (symbolic.includes(b) ? withoutScene(b) : b)),
        };
      }
      const todo = deck.beats
        .filter((b) => b.literal && brokenOf(deck, b.id).length)
        .map((b) => b.id);
      if (!todo.length && !symbolic.length) return deck;
      await writeFile(sceneSchemaPath, JSON.stringify(sceneSchemaFor(prefs, source)));
      const fixed = new Map<string, Literal>();
      const queue = [...todo];
      // ponytail: a fixed pool of SCENE_PARALLEL Codex runs; each holds a few hundred MB.
      await Promise.all(
        Array.from({ length: Math.min(SCENE_PARALLEL, queue.length) }, async () => {
          for (let id = queue.shift(); id; id = queue.shift()) {
            const lit = await redraw(deck, id);
            if (lit) fixed.set(id, lit);
          }
        }),
      );
      let plan = deck;
      for (const [id, lit] of fixed) plan = withScene(plan, id, lit);
      // Settled together: each was redrawn against the others as first planned,
      // and a scene can name another (a lane, a recap) that is now gone.
      for (;;) {
        const bad = plan.beats.filter((b) => b.literal && brokenOf(plan, b.id).length);
        if (!bad.length) break;
        const now = split(plan).scene;
        opts.onDropScenes?.(
          bad.map((b) => b.id),
          bad.flatMap((b) => lastTry.get(b.id) ?? now.filter(of(b.id))),
        );
        plan = { ...plan, beats: plan.beats.map((b) => (bad.includes(b) ? withoutScene(b) : b)) };
      }
      const left = listOf({ ...findings(plan), advice: [] });
      if (left.length)
        throw new Error(
          `Codex's plan broke after its scenes were redrawn or dropped:\n${left.map((m) => `  ${m}`).join("\n")}`,
        );
      return plan;
    };
    // A LAST PAIR OF NEIGHBOURS IS REDRAWN ONE BEAT AT A TIME (2026-10-16).
    // Chinchilla was refused after three deck repairs, each of which fixed the
    // pairs it was told of and redrew a beat as its other neighbour's shape —
    // also when the finding named that shape. So a plan whose only fault after
    // the last repair is a beat sharing its neighbour's archetype gets that beat
    // back on its own, in a schema that offers only `shapesFor` it: the planner
    // still writes the beat, and the shape cannot be wrong.
    const beatSchemaPath = join(dir, "beat.schema.json");
    const offered = beatVariants(schema).map((v) => v.properties.archetype.const);
    const reshape = async (deck: Storyboard, i: number): Promise<Storyboard> => {
      const beat = deck.beats[i] as Beat;
      const shapes = shapesFor(deck, i, offered, prefs.images);
      if (!shapes.length) return deck;
      await writeFile(beatSchemaPath, JSON.stringify(beatSchemaFor(schema, shapes)));
      let problems: string[] = [];
      for (let t = 1; t <= SCENE_REPAIRS; t++) {
        opts.onReshape?.(beat.id, shapes);
        const out = join(dir, `beat-${beat.id}-${t}.json`);
        try {
          await (opts.run ?? runCodex)({
            prompt: beatPrompt(prompt, deck, beat, shapes, problems),
            schemaPath: beatSchemaPath,
            outPath: out,
            ...(opts.model === undefined ? {} : { model: opts.model }),
            timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          });
          const got = (stripNulls(JSON.parse(await readFile(out, "utf8"))) as { beat?: object })
            ?.beat;
          const redrawn = {
            ...got,
            id: beat.id,
            ...(beat.literal ? { literal: beat.literal } : {}),
          };
          const beats = deck.beats.map((b, k) => (k === i ? redrawn : b));
          return withStockLabels(checkPlan({ ...deck, beats }, source, prefs), source);
        } catch (err) {
          problems =
            err instanceof PlanRejected
              ? err.problems
              : [`the ask failed: ${err instanceof Error ? err.message : err}`];
        }
      }
      return deck;
    };
    const neighbours = async (planned: Storyboard): Promise<Storyboard> => {
      let plan = planned;
      for (let i = 1; i < plan.beats.length; i++)
        if (plan.beats[i]?.archetype === plan.beats[i - 1]?.archetype)
          plan = await reshape(plan, i);
      return plan;
    };

    let answer = await attempt(prompt);
    if (answer.plan && listOf(answer.broken).length === 0) return await scenes(answer.plan);
    const firstBeats = beatCount(answer.json);
    // Merging beats IS the repair of a plan that was too long.
    let merging = answer.broken.size.length > 0;
    for (let round = 1; ; round++) {
      opts.onRepair?.(listOf(answer.broken));
      const next = await attempt(
        repairPrompt(prompt, answer.json, answer.broken, prefs.images.enabled, prefs.slides),
      );
      // A REPAIR MAY NOT SHRINK THE DECK. Dropping beats is not a shape change,
      // and under STAGE_MIN_BEATS it also escapes the stage minimum outright: a
      // 12-beat plan with no stage came back as 4 beats and passed (review,
      // 2026-10-09). The prompt asks for every beat; this holds it to that.
      const n = next.plan?.beats.length ?? firstBeats;
      const dropped =
        n < firstBeats && !merging
          ? [
              `the repair returned ${n} beats for a plan of ${firstBeats}; a repair changes shapes and may not drop beats.`,
            ]
          : [];
      // The pictures are asked for once: a repair that still leaves one unused is kept.
      const still: Findings = {
        ...next.broken,
        variety: [...dropped, ...next.broken.variety],
        advice: [],
      };
      if (next.plan && listOf(still).length === 0) return await scenes(next.plan);
      if (round === REPAIRS) {
        if (!next.plan || !listOf(still).every(isNeighbour)) throw unrepaired(next, still, round);
        const plan = await neighbours(next.plan);
        const left = { ...findings(plan), advice: [] };
        if (listOf(left).length) throw unrepaired(next, left, round);
        return await scenes(plan);
      }
      merging ||= still.size.length > 0;
      answer = { ...next, broken: still };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * How many times a broken plan goes back. One was the rule until two unseen
 * papers (FlashAttention, Chinchilla; 2026-10-14) were refused in twelve plans of
 * twelve: a first plan carried 10–23 findings, and the one repair fixed what it
 * was told and broke something else. Two was the rule until both, with
 * appendix coverage gone (2026-10-15), came within one or two findings after the
 * second repair (18, 1, 1 and 11, 6, 2), every last one a variety rule.
 */
const REPAIRS = 3;

/** How many times one broken scene, or one beat beside its own shape, goes back on its own. */
const SCENE_REPAIRS = 2;

/**
 * A scene finding that is only a symbolic quantity where a verb takes one
 * number: Θ(N²), N²d²/M, a ratio `s`. Not "약 19" or "100KB", which a redraw
 * can give as the number.
 */
function isSymbolic(finding: string): boolean {
  const value =
    /"([^"]+)" is not one number as the source writes it/.exec(finding)?.[1] ??
    /must be one number as the source writes it, got "([^"]+)"/.exec(finding)?.[1];
  return (
    value !== undefined && /[A-Za-zΑ-ω]/.test(value) && !/^[\d.,\s]+[\p{L}%]+$/u.test(value.trim())
  );
}

/** Scenes redrawn at once: each is a Codex run. */
const SCENE_PARALLEL = 3;

/** The schema of a scene's ask: one `literal`, never null — a scene, redrawn. */
function sceneSchemaFor(
  prefs: Pick<Prefs, "genre" | "bespoke" | "design"> & { images?: Prefs["images"] },
  source: Source,
): unknown {
  const hidden = new Set(plannerInvisible(prefs, source));
  hidden.delete("literal");
  return splitOperate(
    hideFromPlanner(
      forStructuredOutput(z.toJSONSchema(z.object({ literal: literalSchema }), { io: "input" })),
      hidden,
    ),
  );
}

/** A scene's answer: the scene, or why it is none. */
async function readScene(outPath: string): Promise<{ literal: Literal } | { problems: string[] }> {
  const raw = await readFile(outPath, "utf8").catch(() => "");
  if (!raw.trim()) return { problems: ["Codex produced no final message"] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problems: [`the answer was not JSON: ${raw.slice(0, 120)}`] };
  }
  const r = literalSchema.safeParse((stripNulls(parsed) as { literal?: unknown } | null)?.literal);
  return r.success
    ? { literal: r.data }
    : { problems: r.error.issues.map((i) => `${i.path.join(".") || "literal"}: ${i.message}`) };
}

function withScene(plan: Storyboard, id: string, literal: Literal): Storyboard {
  return { ...plan, beats: plan.beats.map((b) => (b.id === id ? { ...b, literal } : b)) };
}

function withoutScene(b: Storyboard["beats"][number]): Storyboard["beats"][number] {
  const { literal: _, ...rest } = b;
  return rest as Storyboard["beats"][number];
}

/** One scene's ask: the deck as planned, fixed, and what that scene broke. */
function scenePrompt(
  prompt: string,
  plan: Storyboard,
  id: string,
  broken: readonly string[],
): string {
  const list = broken.map((m) => `  - ${m}`).join("\n");
  return `${prompt}

THE DECK IS PLANNED. ONE SCENE IS LEFT.

The storyboard below is settled. Beat ${id} draws a literal scene that is refused for:
${list}

Return {"literal": ...}: beat ${id}'s scene, redrawn so none of these hold — every number, word and figure one the source states, every slot its verb needs filled. Keep its verb unless a finding names another. Return a scene: this ask has no way to leave it out. No other beat is yours to change.

THE STORYBOARD:
${JSON.stringify(plan, null, 2)}`;
}

/** A variety finding that is only two neighbours sharing an archetype (`varietyFindings`, RULE 1). */
function isNeighbour(finding: string): boolean {
  return /^\S+ and \S+ are both `[^`]+`, next to each other\./.test(finding);
}

type BeatVariant = { properties: { archetype: { const: Archetype } } & Record<string, unknown> };

/** The planner schema's beat variants, one per archetype offered. */
function beatVariants(schema: unknown): BeatVariant[] {
  return (schema as { properties: { beats: { items: { anyOf: BeatVariant[] } } } }).properties.beats
    .items.anyOf;
}

/** The schema of one beat's redraw: the planner's beat, as one of `shapes`, its scene kept out. */
function beatSchemaFor(schema: unknown, shapes: readonly Archetype[]): unknown {
  const anyOf = beatVariants(schema)
    .filter((v) => shapes.includes(v.properties.archetype.const))
    .map((v) => hideFromPlanner(v, new Set(["literal"])));
  return {
    type: "object",
    properties: { beat: { anyOf } },
    required: ["beat"],
    additionalProperties: false,
  };
}

/** One beat's ask: the deck, fixed, and the shapes that beat may take. */
function beatPrompt(
  prompt: string,
  plan: Storyboard,
  beat: Beat,
  shapes: readonly Archetype[],
  problems: readonly string[],
): string {
  const refused = problems.length
    ? `\nYour last answer was refused for:\n${problems.map((m) => `  - ${m}`).join("\n")}\n`
    : "";
  return `${prompt}

THE DECK IS PLANNED. ONE BEAT'S SHAPE IS LEFT.

The storyboard below is settled, but beat ${beat.id} is \`${beat.archetype}\` beside a beat of the same shape, and no two beats in a row may share an archetype.
${refused}
Return {"beat": ...}: beat ${beat.id} redrawn as one of ${shapes.map((s) => `\`${s}\``).join(", ")} — whichever shows its point best — with the params that shape needs, every number, word and figure one the source states. Keep its id, its point, its evidence, its narration and its part. No other beat is yours to change.

THE STORYBOARD:
${JSON.stringify(plan, null, 2)}`;
}

function listOf(b: Findings): string[] {
  return [...b.refused, ...b.size, ...b.variety, ...b.coverage, ...b.advice];
}

/** The refusal for a plan still broken after the last repair, by its first broken rule. */
function unrepaired(answer: { rejected?: string }, still: Findings, rounds: number): Error {
  const after = rounds === 1 ? "one repair" : `${rounds} repairs`;
  const lines = (ms: readonly string[]) => ms.map((m) => `  ${m}`).join("\n");
  if (answer.rejected)
    return new Error(`Codex's plan is still refused after ${after}. ${answer.rejected}`);
  if (still.size.length || still.variety.length)
    return new Error(
      `Codex's plan breaks the variety rule (src/plan/variety.ts) even after ${after}:\n${lines([...still.size, ...still.variety])}`,
    );
  return new Error(
    `Codex's plan does not cover the source (src/plan/coverage.ts) even after ${after}:\n${lines(still.coverage)}`,
  );
}

/**
 * The second ask: the same instructions and source, then the plan that came back
 * and exactly what is wrong with it. Asking again from scratch would re-roll
 * every beat to fix the shapes of a few.
 */
/** What a plan broke, by the rule it broke: each group gets its own repair advice. */
interface Findings {
  /** Out of the schema's bounds, or citing what the source lacks (`PlanRejected`). */
  refused: string[];
  /** Too many beats (src/plan/variety.ts `sizeFindings`): the one group whose repair drops beats. */
  size: string[];
  variety: string[];
  coverage: string[];
  /** Asked for once (`pictureFindings`); a repair that still misses it is kept. */
  advice: string[];
}

function repairPrompt(
  prompt: string,
  plan: unknown,
  broken: Findings,
  images: boolean,
  slides: number,
): string {
  const list = (ms: readonly string[]) => ms.map((m) => `  - ${m}`).join("\n");
  const refused = broken.refused.length
    ? `
YOUR PREVIOUS STORYBOARD, BELOW, IS REFUSED FOR:
${list(broken.refused)}

Fix these by correcting the fields named: keep every number inside its bounds
and cite only ids the source lists${images ? "" : "; images are off, so brief no picture"}. A beat
whose shape needs what the source cannot give it (a figure archetype with no
figure left to cite) is redrawn as another shape. Keep every other beat as it is.
`
    : "";
  // With images off there is no picture to brief: suggesting one invites the
  // plan `readPlan` refuses.
  const moves = images
    ? "change archetypes, add stage beats with illustration briefs, give\ndiagram beats a backdrop brief, redraw a panel as a hero-number or a kinetic\nclaim where its point is a number or a claim,"
    : "change archetypes, redraw a panel as a hero-number or a kinetic claim\nwhere its point is a number or a claim,";
  const variety = broken.variety.length
    ? `
YOUR PREVIOUS STORYBOARD, BELOW, BREAKS THE VARIETY RULES:
${list(broken.variety)}

Fix these by changing shapes. Keep every beat whose shape is not named above as
it is; ${moves} or reorder neighbours only as far as the fix
needs.
`
    : "";
  // A MISSING SECTION IS CITED BEFORE IT IS ADDED (2026-10-23). "ADDING beats"
  // was the only move offered: Chinchilla's round 27, eight sections uncited
  // (three of them 4.2.7 and its two subsections), went from 14 beats to 24,
  // over the cap of 21. The rule takes a beat citing several sections.
  const coverage = broken.coverage.length
    ? `
YOUR PREVIOUS STORYBOARD, BELOW, DOES NOT COVER THE SOURCE:
${list(broken.coverage)}

Fix these by CITING each missing section from the beat of that part whose point
it belongs to (a beat may cite several sections, and a subsection goes with its
parent's beat), and let that beat say it. ADD a beat, in its place in the part
order, only for a section no beat's point covers.
The deck may have at most ${beatCap(slides)} beats; this one has ${beatCount(plan)}.
Correct the fields named, and keep every other beat as it is.
`
    : "";
  const size = broken.size.length
    ? `
YOUR PREVIOUS STORYBOARD, BELOW, IS TOO LONG:
${list(broken.size)}

Fix these by MERGING beats that make one point: fold a setup beat into the
results it introduces, and join neighbours that say one thing. Keep every
section covered and every other rule above.
`
    : "";
  const advice = broken.advice.length
    ? `
YOUR PREVIOUS STORYBOARD, BELOW, LEAVES THE SOURCE'S PICTURES UNUSED:
${list(broken.advice)}

Fix this by redrawing an existing beat; keep the beat count.
`
    : "";
  // The neighbour check closes the prompt: every repair of an unseen paper on
  // 2026-10-14 (four of four) fixed what was named, then was refused for two
  // beats in a row sharing an archetype.
  return `${prompt}
${refused}${size}${variety}${coverage}${advice}
Return the whole storyboard again with these fixed. ${
    broken.size.length
      ? "Merge only as the TOO LONG list asks; drop nothing else."
      : "Never drop or merge beats: a repair with fewer beats than the plan below is refused."
  }
Before returning, read the archetypes in order: a beat you redrew must differ from
both its neighbours, since no two beats in a row may share an archetype.

${JSON.stringify(plan)}`;
}

/** A plan's beat count, read off JSON that may not have validated. */
function beatCount(plan: unknown): number {
  const beats = (plan as { beats?: unknown } | null)?.beats;
  return Array.isArray(beats) ? beats.length : 0;
}

/**
 * A plan Codex answered that this source cannot build — out of the schema's
 * bounds, a picture brief with images off, an id the source lacks — with what
 * is wrong and the JSON it came as, for the repair rounds.
 */
export class PlanRejected extends Error {
  constructor(
    message: string,
    readonly problems: string[],
    readonly plan: unknown,
  ) {
    super(message);
    this.name = "PlanRejected";
  }
}

/** Parse, validate and integrity-check the final message Codex left at `outPath`. */
async function readPlan(outPath: string, source: Source, prefs: Prefs): Promise<Storyboard> {
  const raw = await readFile(outPath, "utf8").catch(() => "");
  if (raw.trim() === "") {
    throw new Error("Codex produced no final message. Re-run, or try a shorter source.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Codex's final message was not JSON, so --output-schema did not hold. First 200 chars:\n${raw.slice(0, 200)}`,
    );
  }

  return checkPlan(stripNulls(parsed), source, prefs);
}

/** Validate and integrity-check a plan, as `readPlan` does a final message. */
function checkPlan(plan: unknown, source: Source, prefs: Prefs): Storyboard {
  const result = storyboardSchema.safeParse(plan);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new PlanRejected(
      `Codex returned a storyboard that does not validate:\n${issues.map((i) => `  ${i}`).join("\n")}`,
      issues,
      plan,
    );
  }

  // The schema always admits a brief — it is one schema, and `illustrate`
  // reads the same field — so with images off the model can still write one
  // it was never told about. That is not a plan to run `illustrate` on; it is
  // a plan that asked for something the user did not, and the fix is the flag.
  if (!prefs.images.enabled) {
    const pending = pendingIllustrations(result.data);
    if (pending.length) {
      const beats = [...new Set(pending.map((p) => p.beatId))].join(", ");
      const msg =
        `Codex asked for ${pending.length} illustration${pending.length === 1 ? "" : "s"} (${beats}) with images off. ` +
        "Pass --images to let the plan request pictures, or re-run without it.";
      throw new PlanRejected(
        msg,
        [
          `${beats} asked for a picture with images off: remove every illustration and backdrop brief`,
        ],
        plan,
      );
    }
  }
  try {
    assertRefsResolve(result.data, source, { pending: prefs.images.enabled ? "allow" : "refuse" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PlanRejected(
      msg,
      msg
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      plan,
    );
  }
  return result.data;
}

/**
 * The prompt. Codex `exec` has no separate system slot, so the instructions and
 * the source travel together — and it is told not to search, because everything
 * it needs is in this message and a search is latency and tokens spent on
 * nothing.
 */
function buildPrompt(source: Source, prefs: Prefs): string {
  return `${systemPrompt(prefs)}${sourceBlocks(source, prefs)}

Do not search the web and do not read files. Everything you need is below.
Return the storyboard as your final message, conforming to the supplied schema.

${renderSource(source)}`;
}

/**
 * The `codex` command line for a run, and the environment it needs.
 *
 * Pure, and exported for that reason: the argv is a contract with a binary
 * nothing in the test suite may spawn, so it is pinned by reading this rather
 * than by running it.
 */
export function codexCommand(args: RunnerArgs): { argv: string[]; env?: NodeJS.ProcessEnv } {
  const sandbox = args.sandbox ?? "read-only";
  if (sandbox === "workspace-write" && args.cwd === undefined) {
    throw new Error("codex workspace-write needs a cwd to fence the writes to.");
  }
  // read-only sandbox by default: planning is a pure text transform and has no
  // business touching the workspace. --ephemeral keeps session files out of the
  // user's Codex history for what is a library call, not a conversation.
  //
  // workspace-write is for a caller that wants a file back, and it is fenced to
  // `cwd` three ways. The two overrides stop Codex from also opening `/tmp` and
  // `$TMPDIR` for writing, which it does by default; the env pins `TMPDIR` to
  // `cwd` because in agent sessions it points at the repo, and a sandbox that
  // may write to `$TMPDIR` would be a sandbox that may write to the repo.
  const argv = [
    "exec",
    "--output-schema",
    args.schemaPath,
    "-o",
    args.outPath,
    ...(args.cwd === undefined ? [] : ["-C", args.cwd]),
    "--sandbox",
    sandbox,
    ...(sandbox === "workspace-write"
      ? [
          "-c",
          "sandbox_workspace_write.exclude_tmpdir_env_var=true",
          "-c",
          "sandbox_workspace_write.exclude_slash_tmp=true",
        ]
      : []),
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    ...(args.model ? ["--model", args.model] : []),
    ...(args.config ?? []).flatMap((c) => ["-c", c]),
    ...(args.images ?? []).flatMap((path) => ["-i", path]),
    "-",
  ];
  return sandbox === "workspace-write" && args.cwd !== undefined
    ? { argv, env: { ...process.env, TMPDIR: args.cwd } }
    : { argv };
}

/**
 * Features that give a `codex exec` run TOOLS. A call that is a pure text
 * transform — a prompt in, a schema-held JSON reply out — needs none of them,
 * and with them the agent spends turns on the account's own setup instead:
 * MEASURED 2026-10-08 on one bespoke draft prompt, the default config ran
 * `cat` on the user's global AGENTS.md and an animation skill before
 * answering — 56,679 input tokens over several turns and 135-488s — where the
 * same prompt with these off was one turn of 18,247 input tokens.
 */
export const TOOL_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "multi_agent",
  "browser_use",
  "computer_use",
  "image_generation",
  "skill_search",
  "tool_suggest",
] as const;

let leanMemo: Promise<string[]> | undefined;

/**
 * `-c` overrides for a tool-less, single-turn `codex exec`: every tool feature
 * off, web search off, and every MCP server the account configured disabled by
 * name (the config's own names, read once per process with `codex mcp list`;
 * a name the config does not define cannot be disabled, only invented). If the
 * list cannot be read, the features alone still remove the shell.
 */
export function leanCodexConfig(
  bin = "codex",
  list: (bin: string) => Promise<string> = listMcp,
): Promise<string[]> {
  leanMemo ??= (async () => {
    const out = [...TOOL_FEATURES.map((f) => `features.${f}=false`), 'web_search="disabled"'];
    try {
      const servers = JSON.parse(await list(bin)) as Array<{ name?: unknown; enabled?: unknown }>;
      for (const s of servers)
        if (typeof s.name === "string" && /^[\w-]+$/.test(s.name) && s.enabled !== false)
          out.push(`mcp_servers.${s.name}.enabled=false`);
    } catch {
      // No list: the shell is still gone, which is most of the cost.
    }
    return out;
  })();
  return leanMemo;
}

/**
 * `leanCodexConfig` with ONE tool back: the image tool, for the bespoke pass's
 * illustration call (src/bespoke/art.ts). The shell stays off — the agent
 * reports where the tool saved the picture and the caller reads it from there —
 * and so does `view_image`, which would spend the call's tokens looking at a
 * picture the scene call is shown anyway. MEASURED 2026-10-09: 42s and 19k
 * tokens for one picture this way, against 49s and 45k with the agent asked to
 * inspect it.
 */
export async function artCodexConfig(
  bin = "codex",
  list: (bin: string) => Promise<string> = listMcp,
): Promise<string[]> {
  const lean = await leanCodexConfig(bin, list);
  return [
    ...lean.filter((c) => c !== "features.image_generation=false"),
    "features.view_image=false",
  ];
}

function listMcp(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ["-c", "features.plugins=false", "-c", "features.apps=false", "mcp", "list", "--json"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`codex mcp list exited ${code}`));
    });
  });
}

/** The production `Runner`: `codex exec` on PATH, stdin in, a file out. */
export function runCodex(args: RunnerArgs): Promise<void> {
  const { argv, env } = codexCommand(args);

  return new Promise((resolve, reject) => {
    const child = spawn(args.bin ?? "codex", argv, {
      stdio: ["pipe", args.onUsage ? "pipe" : "ignore", "pipe"],
      ...(env === undefined ? {} : { env }),
    });
    let stderr = "";
    // Only the tail matters (the usage line is last), and a pipe nobody reads
    // fills and stalls the child, so it is drained into a bounded buffer.
    let stdout = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout = (stdout + c.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Codex did not finish within ${Math.round(args.timeoutMs / 1000)}s.`));
    }, args.timeoutMs);

    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error(
              `The "${args.bin ?? "codex"}" CLI is not on PATH. Install it, or sign in with \`codex login\`, then retry.`,
            )
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const used = /tokens used\s*\n?\s*([\d,]+)/i.exec(`${stdout}\n${stderr}`);
      if (used?.[1] && args.onUsage) args.onUsage(Number(used[1].replace(/,/g, "")));
      if (code === 0) return resolve();
      reject(
        new Error(`codex exec exited ${code}.\n${stderr.trim().split("\n").slice(-8).join("\n")}`),
      );
    });

    child.stdin?.end(args.prompt);
  });
}

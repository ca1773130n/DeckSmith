/**
 * The contract every layer builds against.
 *
 * Two objects matter. `Source` is what ingestion produces: the document's
 * structure with every asset addressable by id. `Storyboard` is what planning
 * produces: an ordered list of beats, each accountable to something in the
 * Source. Everything downstream is a projection of the Storyboard.
 *
 * The Storyboard describes pedagogy, not geometry. It carries no canvas size,
 * no colours, no coordinates — those are decisions `emit` makes per format, so
 * one storyboard can render as a 16:9 deck and a 9:16 short without replanning.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ Source */

/** A pointer back into the Source. Provenance is what makes a beat checkable. */
export const refSchema = z.object({
  kind: z.enum(["figure", "equation", "table", "section"]),
  id: z.string(),
});

export const figureSchema = z.object({
  id: z.string(),
  /** Path relative to the deck's asset directory. */
  src: z.string(),
  caption: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  /**
   * WHERE THE FIGURE LIVES IN THE ARGUMENT, which a caption does not say.
   *
   * The planner never sees the image. All it had was "1373x381 — Figure 2", and
   * from that it cannot tell whether the picture belongs to the method or to the
   * results, so it redraws the method as a synthetic diagram and leaves the
   * authors' own figure unused. The section it sat under and the prose that
   * refers to it are the two facts a reader uses to answer the same question,
   * and they cost nothing to carry.
   *
   * Both are OPTIONAL: every source stored before they existed still parses, and
   * a document may genuinely drop an image in with nothing said about it.
   */
  sectionId: z.string().optional(),
  /** The sentence or paragraph that refers to it, verbatim from the document. */
  mention: z.string().optional(),
});

export const equationSchema = z.object({
  id: z.string(),
  tex: z.string(),
  display: z.boolean(),
});

export const tableSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const sectionSchema = z.object({
  id: z.string(),
  depth: z.int().min(1).max(6),
  heading: z.string(),
  /** Prose under this heading, with figures/equations/tables lifted out. */
  text: z.string(),
});

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** BCP-47. Drives font subsetting and the language of generated copy. */
  lang: z.string().default("en"),
  sections: z.array(sectionSchema),
  figures: z.array(figureSchema),
  equations: z.array(equationSchema),
  tables: z.array(tableSchema),
});

/* -------------------------------------------------------------- Archetypes */

/**
 * The explanatory vocabulary. Each archetype is one way of making a point, and
 * maps to exactly one emitter. Adding a domain means adding archetypes here and
 * an emitter beside it — nothing else in the pipeline learns about the domain.
 *
 * These six came out of hand-building a real deck (EXPERIMENT-002), not from
 * guessing at what might be useful.
 */

/** One symbol in an equation, highlighted while it is explained. */
export const termSchema = z.object({
  /** Exactly as it appears in the TeX, e.g. "R" or "\\mathcal{E}". */
  tex: z.string(),
  label: z.string(),
  tone: z.enum(["a", "b", "c", "d"]),
});

export const titleParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  sub: z.string().optional(),
});

/**
 * A brief for a picture that does not exist yet.
 *
 * The planner writes it where no inventory figure fits; `illustrate` turns it
 * into a file under `assets/`, registers that as an ordinary `Figure`, and
 * points the slot's `figureId` at it. The brief stays on the beat afterwards as
 * provenance — the figure's file name carries the hash of what produced it,
 * and this is the thing it hashes.
 */
export const illustrationSchema = z.object({
  /** The scene: objects, arrangement, mood. Never text, labels, numbers, charts. */
  prompt: z.string(),
  /** claim-figure prints it under the picture; a split-compare side keeps it as the figure's title. */
  caption: z.string(),
});

export const claimFigureParamsSchema = z
  .object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    claim: z.string(),
    /**
     * A figure in the inventory. Optional only because `illustration` is the
     * alternative; it comes FIRST in key order because structured output decodes
     * in that order, and the model should look for a real figure before it
     * writes a brief for an invented one.
     */
    figureId: z.string().optional(),
    /**
     * Requested instead of `figureId` when nothing in the inventory fits. A slot
     * with a brief and no `figureId` is PENDING: `assertRefsResolve` refuses it
     * everywhere but the planner, and the emitter refuses it by name.
     */
    illustration: illustrationSchema.optional(),
  })
  // A refinement rather than a union of two shapes: `z.toJSONSchema` drops the
  // check and keeps one flat object, which is what structured output needs, and
  // `storyboardSchema.parse` enforces it on the way back.
  .refine((p) => p.figureId !== undefined || p.illustration !== undefined, {
    message: "claim-figure needs a figureId or an illustration",
    path: ["figureId"],
  });

export const equationWalkParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  equationId: z.string(),
  /** Walked in order, one hold-point each. */
  terms: z.array(termSchema).min(1).max(4),
});

export const dataTableParamsSchema = z
  .object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    tableId: z.string(),
    /**
     * OPTIONAL subset: the rows to draw, named by first-column value exactly as
     * `highlight[].row` names them. Omitted, the whole table is drawn.
     *
     * Real tables are longer than a slide holds, and the answer to that used to be
     * "cite one column in bar-compare" — which is why a seven-table document was
     * planned twice with zero tables in either deck. The rows a table is cited FOR
     * are usually three or four of them; this names those, and the slide says on
     * itself how many it left out.
     */
    rows: z.array(z.string()).min(1).optional(),
    /** Row labels (first-column values) to emphasise, in reveal order. */
    highlight: z.array(z.object({ row: z.string(), tone: z.enum(["a", "b", "c", "d"]) })).max(4),
    note: z.string().optional(),
  })
  /**
   * A HIGHLIGHT MUST BE A ROW THE SLIDE DRAWS. `rows` chooses what is on screen
   * and `highlight` colours one of them; naming a highlight the subset left out
   * is a plan that cannot be drawn, and the emitter refuses it. Caught here so
   * it fails at plan time with the pair named, rather than costing a beat at
   * build. Whole-table beats are unaffected — with no `rows`, every row is drawn.
   */
  .refine((p) => p.rows === undefined || p.highlight.every((h) => p.rows?.includes(h.row)), {
    path: ["highlight"],
    message: "every highlight must name a row that params.rows draws",
  });

export const lineChartParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  xLabel: z.string(),
  yLabel: z.string(),
  points: z.array(z.object({ x: z.string(), y: z.number() })).min(2),
  /** Inter-point annotations, e.g. per-step deltas. One fewer than `points`. */
  deltas: z.array(z.string()).optional(),
  readout: z.string().optional(),
});

export const calloutParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  panels: z
    .array(z.object({ label: z.string(), lines: z.array(z.string()) }))
    .min(1)
    .max(3),
  note: z.string().optional(),
});

/* --------------------------------------------------- Diagrammatic archetypes

 * The ones that draw the mechanism rather than describe it.
 *
 * Placing a source figure beside a sentence is what every slide generator does,
 * and it is the weak, crowded space. These six generate vector graphics from the
 * source's own content and animate them stage by stage — which is the only thing
 * here a human could not have produced faster in Keynote.
 */

const tone = z.enum(["a", "b", "c", "d"]);

/** A labelled stage in a flow. */
export const stageSchema = z.object({
  label: z.string(),
  /** One short line under the label — a shape, a count, a rate. */
  note: z.string().optional(),
  tone: tone.optional(),
});

export const pipelineParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  /** Drawn left to right, arrowed, revealed one at a time. */
  stages: z.array(stageSchema).min(2).max(6),
  /**
   * A labelled feedback arrow routed below the row, from stage `from` back to
   * stage `to` (both 0-based). `from` defaults to the last stage.
   *
   * It is not optional decoration: a recurrent block in the middle of a pipeline
   * is the most common thing this archetype is asked to draw, and looping from
   * the end instead draws a claim the method does not make — the tick appearing
   * to pass through every later stage.
   */
  loop: z
    .object({ from: z.int().min(0).optional(), to: z.int().min(0), label: z.string() })
    .optional(),
  note: z.string().optional(),
});

export const annotatedFigureParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  figureId: z.string(),
  /**
   * Show only this region of the figure, as fractions of the whole, scaled to
   * fill the plate.
   *
   * A paper figure is drawn to be read at A4 with the reader's nose a foot away:
   * its internal type lands around 12px on a 1920 canvas, which is invisible
   * from the back of a room and which no automated gate can see, because the
   * text is pixels in a raster rather than DOM the contrast gate can measure.
   * Cropping to the panel actually under discussion is what a presenter does
   * with a laser pointer, and it is the difference between showing a figure and
   * using one. `notes` stay in whole-figure coordinates — the emitter maps them.
   */
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0.05).max(1),
      h: z.number().min(0.05).max(1),
    })
    .optional(),
  /**
   * Leader lines drawn onto the figure and revealed in turn. `x`/`y` are
   * fractions of the figure's own box, so they survive any layout decision.
   */
  notes: z
    .array(
      z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        text: z.string(),
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(5),
});

export const gridParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  cols: z.int().min(2).max(24),
  rows: z.int().min(1).max(16),
  /** Cell-space rectangles lit in turn: windows, patches, tokens, receptive fields. */
  regions: z
    .array(
      z.object({
        x: z.int().min(0),
        y: z.int().min(0),
        w: z.int().min(1),
        h: z.int().min(1),
        label: z.string(),
        tone: tone,
      }),
    )
    .min(1)
    .max(4),
  note: z.string().optional(),
});

export const barCompareParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  unit: z.string().optional(),
  /** Grown from zero in order. A magnitude comparison beats a table of figures. */
  bars: z
    .array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() }))
    .min(2)
    .max(8),
  note: z.string().optional(),
});

export const stackParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  /** Drawn bottom-up as offset planes, revealed in order. */
  layers: z
    .array(z.object({ label: z.string(), note: z.string().optional() }))
    .min(2)
    .max(7),
  note: z.string().optional(),
});

/**
 * One half of a split-compare: a figure, a list, or both. `illustration` sits
 * beside `figureId` for the same reason it does on claim-figure — a side with a
 * brief and no figure is pending until `illustrate` has run. Unlike claim-figure
 * nothing is required, because a side may be a list alone.
 */
const splitSideSchema = z.object({
  label: z.string(),
  figureId: z.string().optional(),
  illustration: illustrationSchema.optional(),
  lines: z.array(z.string()).optional(),
});

export const splitCompareParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  left: splitSideSchema,
  right: splitSideSchema,
  note: z.string().optional(),
});

/* ------------------------------------------------------------------- Beats */

/**
 * "This beat happens inside that part of the beat before it."
 *
 * The one field the canvas investigation endorsed, and the only one. A camera
 * move between two beats reads as continuity — rather than as a fancier cut —
 * exactly when the source supplies a containment or adjacency relation between
 * them; the camera renders a relation, it never creates one. Counted honestly
 * over the twelve-beat demo, two or three of eleven transitions have one, which
 * is why this is optional and off by default rather than an infinite canvas.
 *
 * `element` names a part of the containing beat's own drawing, by the suffix
 * `src/emit/svg.ts`'s `id(sid, part, i)` gives it: a pipeline's third stage is
 * `stage2`, a grid's first region is `rgn0`. The shell resolves it against the
 * containing scene and refuses to emit a camera at a part that beat did not
 * draw, so a wrong name is a build error rather than a camera that lands on
 * nothing.
 *
 * WHICH LEAVES THE INDEX ITSELF UNCHECKED, and that is what `label` is for. Get
 * the number wrong rather than the name and every one of those checks passes:
 * `stage2` exists, it has a rect, and the deck dives smoothly into whichever
 * stage happens to be third. `label` says what the plan believes is there, the
 * archetype reports what it drew (`Scene.parts`), and the two are compared
 * before the camera is built — at `plan` and again at `build`.
 */
export const insideSchema = z.object({
  /** The id of the IMMEDIATELY PRECEDING beat. Anything else is rejected. */
  beat: z.string(),
  /** A part of that beat's drawing, e.g. "stage1". */
  element: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /**
   * The label that part carries, verbatim — "Window" for the stage listed as
   * `{ label: "Window" }`. Compared case- and spacing-insensitively at emit; a
   * mismatch is a build error naming both.
   *
   * OPTIONAL, and that is load-bearing rather than lenient: 130 references were
   * committed before this field existed, and requiring it would invalidate every
   * one of them along with the sha256s in `experiments/score/scored.test.mjs`.
   * The price is that those 130 are unchecked — including the one in
   * `experiments/015-decision/runs-n32/menu-20/plan.json` that is wrong.
   */
  label: z.string().optional(),
});

const beatCore = {
  id: z.string(),
  /** What the viewer should understand after this beat. */
  intent: z.string(),
  /** Optional: this beat happens inside a named part of the beat before it. */
  inside: insideSchema.optional(),
  /** The source sentence or equation this beat is accountable to. */
  claim: z.string().optional(),
  evidence: z.array(refSchema).default([]),
  /** Salience, 0–1. Decides what survives a 30-second cut. */
  weight: z.number().min(0).max(1).default(0.5),
  /** Seconds this beat holds in a linear render. Deck mode is human-paced. */
  seconds: z.number().positive().max(60).default(7),
};

/**
 * The fields a beat writes AFTER it has chosen its picture.
 *
 * Structured output decodes in schema key order, and stored model plans confirm
 * it: `id, intent, claim, evidence, narration, weight, seconds, archetype,
 * params`. So `narration` sitting in `beatCore` meant every line was written
 * BEFORE the archetype was picked and before a single label existed — the model
 * was asked to say what the slide shows while it had not yet decided what the
 * slide shows. That is most of why the narration comes out generic, and why "name
 * its parts in the order it draws them" was unsatisfiable rather than merely
 * ignored.
 *
 * Moving it after `params` costs nothing: zod ignores key order on parse, so all
 * 136 stored plans still validate and `experiments/score/scored.test.mjs` hashes
 * their bytes unchanged.
 */
const beatTail = {
  /** What the presenter says over this beat. Written last, knowing the picture. */
  narration: z.string().optional(),
};

export const beatSchema = z.discriminatedUnion("archetype", [
  z.object({ ...beatCore, archetype: z.literal("title"), params: titleParamsSchema, ...beatTail }),
  z.object({
    ...beatCore,
    archetype: z.literal("claim-figure"),
    params: claimFigureParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("equation-walk"),
    params: equationWalkParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("data-table"),
    params: dataTableParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("line-chart"),
    params: lineChartParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("callout"),
    params: calloutParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("pipeline"),
    params: pipelineParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("annotated-figure"),
    params: annotatedFigureParamsSchema,
    ...beatTail,
  }),
  z.object({ ...beatCore, archetype: z.literal("grid"), params: gridParamsSchema, ...beatTail }),
  z.object({
    ...beatCore,
    archetype: z.literal("bar-compare"),
    params: barCompareParamsSchema,
    ...beatTail,
  }),
  z.object({ ...beatCore, archetype: z.literal("stack"), params: stackParamsSchema, ...beatTail }),
  z.object({
    ...beatCore,
    archetype: z.literal("split-compare"),
    params: splitCompareParamsSchema,
    ...beatTail,
  }),
]);

/**
 * Archetypes that draw rather than describe. `verify` warns when a deck leans on
 * the others — a deck of headlines and bullet panels is the thing every slide
 * generator already makes, and is not what this tool is for.
 *
 * `claim-figure` IS in the set, because the test is whether the beat draws and
 * not whether we drew it: a slide carrying the paper's own figure puts a picture
 * in front of the audience exactly as `annotated-figure` does, minus the leader
 * lines. Counting it as text made the deck that USES the authors' figures score
 * worse than the deck that redraws each one as a synthetic diagram, which is the
 * opposite of what this warning is for.
 */
export const DIAGRAMMATIC: ReadonlySet<string> = new Set([
  "pipeline",
  "annotated-figure",
  "claim-figure",
  "grid",
  "bar-compare",
  "stack",
  "split-compare",
  "equation-walk",
  "line-chart",
]);

/**
 * The four things a beat can BE, as opposed to the twelve ways it can be drawn.
 *
 * Used by src/plan/select.ts to keep a shortened cut recognisable as the same
 * argument. Coverage has to be checked at this grain and not per-archetype: the
 * demo's twelve beats have twelve distinct archetypes, so "keep one of each
 * archetype" protects the entire deck and cuts nothing, while "keep one of each
 * family" is a rule that can actually bind.
 *
 * - `frame` states or bounds a claim: the title, the assertion over a figure,
 *   the caveat at the end. What the deck SAYS.
 * - `structure` shows how something is put together or how two things differ.
 * - `quantity` shows numbers: bars, a curve, a table. The EVIDENCE — and
 *   `frame` outnumbers it in most decks, which is why a cut that optimises on
 *   weight alone reliably ends up all claim and no proof.
 * - `formal` walks an equation.
 *
 * `claim-figure` sits in `frame`, not `quantity`, even though a figure is on
 * screen: the beat's work is the assertion, and the figure is its illustration.
 */
export type ArchetypeFamily = "frame" | "structure" | "quantity" | "formal";

export const ARCHETYPE_FAMILY: Readonly<Record<Archetype, ArchetypeFamily>> = {
  title: "frame",
  "claim-figure": "frame",
  callout: "frame",
  pipeline: "structure",
  grid: "structure",
  stack: "structure",
  "split-compare": "structure",
  "annotated-figure": "structure",
  "bar-compare": "quantity",
  "line-chart": "quantity",
  "data-table": "quantity",
  "equation-walk": "formal",
};

export const storyboardSchema = z
  .object({
    sourceId: z.string(),
    title: z.string(),
    lang: z.string().default("en"),
    theme: z.string().default("ink"),
    beats: z.array(beatSchema).min(1),
  })
  /**
   * `inside` is checked here, at plan time, because the alternative is a broken
   * camera. A reference to a beat that is not the one immediately before means
   * there is no shared frame to move through: the containing diagram is off
   * screen by then, so the "move" is a pan over an empty world, which is the
   * exact failure the spike documented. A reference to a beat that does not
   * exist at all is the planner inventing a relation, which is the failure
   * `assertRefsResolve` exists to catch one layer down.
   */
  .superRefine((sb, ctx) => {
    const known = new Set(sb.beats.map((b) => b.id));
    sb.beats.forEach((beat, i) => {
      if (!beat.inside) return;
      const path = ["beats", i, "inside", "beat"];
      const target = beat.inside.beat;
      if (target === beat.id) {
        ctx.addIssue({ code: "custom", path, message: `beat "${beat.id}" is inside itself` });
      } else if (!known.has(target)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `beat "${beat.id}" is inside "${target}", which is not a beat in this storyboard`,
        });
      } else if (i === 0 || sb.beats[i - 1]?.id !== target) {
        const before = i === 0 ? "nothing — it is the first beat" : `"${sb.beats[i - 1]?.id}"`;
        ctx.addIssue({
          code: "custom",
          path,
          message:
            `beat "${beat.id}" is inside "${target}", but the beat before it is ${before}. ` +
            `A camera can only enter the beat immediately before, because that is the only one still on screen to move through; ` +
            `between anything else the move is a cut with extra seconds. Reorder the beats or drop \`inside\`.`,
        });
      }
    });
  });

/* ------------------------------------------------------------- Preferences */

/**
 * What the person asking for the deck gets to decide.
 *
 * Split deliberately: `plan` reads the ones that change what is said, `emit`
 * reads the ones that change how it looks. Neither reaches for a field it does
 * not own, which is why a preferences change never invalidates a storyboard.
 */
export const prefsSchema = z.object({
  /* --- planning --- */
  /** Target beat count. The planner treats it as a target, not a quota. */
  slides: z.int().min(3).max(40).default(12),
  /** BCP-47. Drives the copy, the TTS voice, and the font subset. */
  lang: z.string().default("en"),
  /** Register of the written copy and the narration. */
  tone: z.enum(["plain", "academic", "conversational", "punchy"]).default("plain"),
  /** How much text a slide may carry before it should have been a diagram. */
  density: z.enum(["sparse", "normal", "dense"]).default("normal"),
  /**
   * How long the finished thing should run, in seconds. Optional: absent means
   * "as long as it takes", which is what every deck built before this did.
   *
   * It is a TARGET, and it drives the two numbers a user should not have to
   * think about — how long a narration sentence may be, and how fast the
   * animation runs — via `durationPlan` in src/plan/duration.ts. A gap that
   * survives planning is closed by speeding up playback, warned about rather
   * than applied silently — but only up to `MAX_PLAYBACK`. Past that the render
   * is REFUSED rather than clamped or quietly sped up, because the length of a
   * deck is decided at plan time by how much it says: see `playbackRefusal`.
   * `--allow-fast-playback` overrides it. The floor is 10s because a deck of
   * three slides cannot say anything in less.
   */
  duration: z.number().min(10).max(1800).optional(),

  /* --- look --- */
  theme: z.string().default("ink"),
  /**
   * Multiplies every emitted tween duration. Below 1 is faster.
   *
   * IGNORED when `duration` is set: the target owns the pace, and the two cannot
   * both be honoured. `durationPlan` says so in a warning rather than silently.
   */
  animationSpeed: z.number().min(0.25).max(3).default(1),

  /* --- narration --- */
  narration: z
    .object({
      enabled: z.boolean().default(false),
      /** Explicit edge-tts voice. Omitted means "pick one for `lang` and `tone`". */
      voice: z.string().optional(),
      /** edge-tts prosody, e.g. "+10%" / "-5%". */
      rate: z.string().default("+0%"),
      pitch: z.string().default("+0Hz"),
      subtitles: z.boolean().default(true),
      /**
       * How many of a beat's stops speak. A DIFFERENT axis from `density`
       * above, which is about how much text a slide carries — sharing one name
       * would confuse the prompt, which is told about both.
       *
       * `high` narrates every reveal and is what the deck has always done.
       * `low` narrates one sentence per BEAT and leaves the rest of the stops
       * silent, which is the only thing that makes a short target reachable: a
       * 60-second budget over the demo's 37 stops is four words a stop.
       */
      density: z.enum(["high", "medium", "low"]).default("high"),
    })
    // Zod 4 wants the resolved shape, not `{}` — spell the defaults once here so
    // an omitted `narration` block still yields a fully-populated object.
    .default({ enabled: false, rate: "+0%", pitch: "+0Hz", subtitles: true, density: "high" }),

  /* --- illustrations --- */
  images: z
    .object({
      /** The planner may ask for pictures, and the server runs the `illustrate` stage. */
      enabled: z.boolean().default(false),
      /**
       * Where the provider chain starts. `codex` — the DEFAULT — draws on the
       * account that already planned the deck, then falls to the tool's own SVG;
       * `auto` puts a configured backend in front of it; `svg` is the tool alone
       * — no network, no spend, fully deterministic.
       *
       * CODEX IS THE DEFAULT rather than `auto` because the two rungs are not
       * the same kind of thing to reach for by accident. The Codex account is
       * already paying for the plan, and its spend is the one the user has
       * consented to by running the tool at all; a backend named in the
       * environment is metered per image and belongs to whoever set the variable
       * — which, on a shared machine or a server, is not necessarily the person
       * whose deck is being built. Defaulting to `auto` meant "spend money if a
       * key happens to be around", and a default should never be the expensive
       * branch. `--image-provider auto` is one flag away.
       */
      provider: z.enum(["auto", "codex", "svg"]).default("codex"),
      /**
       * Model for the separate backend only. The Codex rung draws with the
       * account's own model — `--model` there selects the agent, not the picture
       * — so there is no default to spell here.
       */
      model: z.string().optional(),
      /** One phrase folded into every picture prompt. */
      style: z.string().default("flat vector illustration"),
      /**
       * Most PICTURES drawn through the chain — a split-compare beat with two
       * briefs spends two. Briefs past it are drawn by the tool, which is free.
       * Zero is legal and means "every picture by the tool".
       */
      max: z.int().min(0).default(4),
    })
    // Same reason as `narration`: the resolved shape, spelled once, so an omitted
    // block reads fully populated and a `.deck` manifest carries every field.
    .default({ enabled: false, provider: "codex", style: "flat vector illustration", max: 4 }),
});

/* -------------------------------------------------------------- Narration */

/** One subtitle line with the timing edge-tts measured for it. */
export const cueSchema = z.object({
  /** Seconds from the start of this segment's audio. */
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string(),
});

/**
 * What is spoken at one stop.
 *
 * One segment per stop, so the audio and the reveal advance together: the
 * presenter says the sentence that belongs to the thing that just appeared.
 * `seconds` is measured from the rendered audio, never estimated — it is what
 * lets a beat's length follow its narration instead of a number someone guessed.
 */
export const segmentSchema = z.object({
  /** Stop index within the beat: 0 is the beat's landing, 1..n its reveals. */
  stop: z.int().min(0),
  text: z.string(),
  /** Path relative to the deck's audio directory. */
  audio: z.string(),
  seconds: z.number().positive(),
  cues: z.array(cueSchema),
});

export const narrationSchema = z.object({
  voice: z.string(),
  beats: z.record(z.string(), z.array(segmentSchema)),
});

/* ------------------------------------------------------------------- Media */

/**
 * How one external asset travels with the deck.
 *
 * `bake` copies the bytes in, so the pack works offline and forever. `link`
 * keeps the URL, so the pack stays small and the asset stays current. `embed` is
 * for things that are not files at all — a YouTube or Vimeo URL is a player, and
 * downloading it would be both wrong and, usually, against its terms.
 */
export const mediaSchema = z.object({
  id: z.string(),
  policy: z.enum(["bake", "link", "embed"]),
  /** Present for `bake`: path inside the pack. */
  path: z.string().optional(),
  /** Present for `link` and `embed`. */
  url: z.string().optional(),
  mime: z.string().optional(),
  bytes: z.int().nonnegative().optional(),
});

/* -------------------------------------------------------------------- Pack */

/** Bumped only when an older reader could misread a newer pack. */
export const PACK_VERSION = 1;

/**
 * `deck.json` inside a `.deck` archive: everything needed to rebuild the deck,
 * and nothing that can be derived from it.
 *
 * A pack is the unit a user keeps, sends, and re-opens. It carries the source
 * and the storyboard rather than the built HTML, because the built HTML is a
 * projection of those two and every format profile makes a different one.
 */
export const packSchema = z.object({
  version: z.literal(PACK_VERSION),
  createdAt: z.string(),
  title: z.string(),
  prefs: prefsSchema,
  source: sourceSchema,
  storyboard: storyboardSchema,
  narration: narrationSchema.optional(),
  media: z.array(mediaSchema).default([]),
});

/* ----------------------------------------------------------------- Formats */

/**
 * The profiles that ship with a name. `FORMATS` is keyed by these and nothing
 * else; `DESTINATIONS` and the budget helpers are indexed by them.
 *
 * `Format["id"]` is deliberately WIDER than this — a canvas the caller sized
 * itself is a real format with a real id, and it is not in this union. See
 * `resizeFormat`.
 */
export type PresetId = "deck-16x9" | "video-16x9" | "short-9x16" | "post-1x1";

/**
 * Output profiles. A profile decides canvas, pacing, and how many beats
 * survive — never what the beats mean.
 *
 * A plain type, not a schema: the preset table below is the only source of NAMED
 * formats there is, and the one other constructor (`resizeFormat`) validates its
 * own arguments, so there is no boundary at which one could arrive unvalidated.
 */
export interface Format {
  /**
   * A `PresetId` for the four named profiles, `custom-<w>x<h>` for a canvas the
   * caller sized. Printed in build lines and in cut explanations, so it has to
   * describe the thing that was actually built: a resized profile keeps its
   * base's pacing but NOT its name, because "short-9x16" over a 1080x1350 canvas
   * would be a lie in every message that quotes it.
   */
  id: string;
  width: number;
  height: number;
  /** Keep only beats at or above this weight. */
  minWeight: number;
  /** Deck mode emits a slideshow island; video mode does not. */
  navigable: boolean;
  /**
   * The longest NARRATED cut this format may produce, in seconds.
   *
   * A length, like a canvas, is part of what a format is: a 9x16 file that runs
   * four minutes is not a short, it is a tall video nobody can post. So the
   * number is a hard ceiling and `verify`'s budget gate reads it — see
   * src/verify/budget.ts for why exceeding it fails the build rather than
   * silently trimming beats.
   *
   * `Infinity` where no platform imposes one. That is not "unchecked": a
   * presented deck is paced by the person clicking through it, and long-form
   * video has no ceiling worth encoding, so any finite number here would be a
   * house rule dressed up as a constraint.
   *
   * Optional in the TYPE, mandatory in the TABLE — `test/types.test.ts` asserts
   * every entry in `FORMATS` states one. A required field cannot tell "chose
   * Infinity" apart from "forgot the field", and it would force every test
   * fixture that needs a canvas to invent a length it does not care about.
   * Absent reads as unbudgeted, which is the safe direction for a fixture and
   * the one the coherence test refuses for a shipped profile.
   */
  maxSeconds?: number;
  /**
   * A tighter ceiling that only some destinations impose — a warning, not a
   * failure. Omitted when every destination for the format agrees on `maxSeconds`.
   */
  warnSeconds?: number;
}

/** A real place a built file gets uploaded, and the length it stops accepting at. */
export interface Destination {
  /** What a person would call it. Printed in budget findings. */
  name: string;
  /** Longest video this destination takes, in seconds. */
  maxSeconds: number;
}

/**
 * Where each format's file is actually going.
 *
 * The budget numbers used to be two literals with a comment, and a comment is
 * not a check: Instagram raised Reels from 90 seconds to three minutes in early
 * 2025, and the table went on quoting 90 as an Instagram limit long after that
 * stopped being true. A number in a table nobody can trace is a trap, so
 * `maxSeconds` and `warnSeconds` are DERIVED from this list — you cannot state a
 * budget here without naming the destination it came from.
 *
 * WHAT IS DELIBERATELY ABSENT. TikTok takes ten minutes and LinkedIn takes
 * fifteen, and neither is listed, because the cap is the LOOSEST limit among a
 * format's destinations: adding one permissive platform would raise `short-9x16`
 * to 600s and the gate would stop failing the four-minute short it exists to
 * catch. So a destination belongs here only if it CONSTRAINS the deliverable —
 * a platform that accepts anything the others accept adds nothing but slack.
 *
 * Verified by hand, not by network (nothing here may reach one). These move;
 * when one does, the finding it produces names it, so the stale number is
 * findable from the message rather than only from this file.
 */
export const DESTINATIONS: Readonly<Record<PresetId, readonly Destination[]>> = {
  // A presented deck is paced by the person clicking through it, and long-form
  // video has no ceiling worth encoding. An empty list is "unbudgeted", stated.
  "deck-16x9": [],
  "video-16x9": [],
  "short-9x16": [
    { name: "YouTube Shorts", maxSeconds: 180 },
    { name: "Instagram Reels", maxSeconds: 180 },
    { name: "Facebook Reels", maxSeconds: 90 },
  ],
  "post-1x1": [{ name: "X (standard account)", maxSeconds: 140 }],
};

/**
 * The destinations for an id, or none.
 *
 * `id` is a `string` and not a `PresetId` because a resized format carries
 * `custom-1080x1350`, which is in no table. Empty is the honest answer for it:
 * a budget must name the destination it came from (see `DESTINATIONS`), and a
 * canvas nobody named has no destination to name. Written as a lookup rather
 * than a cast so that an unknown id returns `[]` instead of crashing on
 * `undefined.length` — the cast compiles and the lookup is true.
 */
function destinationsFor(id: string): readonly Destination[] {
  return (DESTINATIONS as Record<string, readonly Destination[] | undefined>)[id] ?? [];
}

/** The loosest destination: what the format may produce at all. */
export function maxSecondsFor(id: string): number {
  const d = destinationsFor(id);
  return d.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...d.map((x) => x.maxSeconds));
}

/** The tightest destination, when it is tighter — a warning, never a failure. */
export function warnSecondsFor(id: string): number | undefined {
  const d = destinationsFor(id);
  if (d.length === 0) return undefined;
  const min = Math.min(...d.map((x) => x.maxSeconds));
  return min < maxSecondsFor(id) ? min : undefined;
}

/** The destination a given ceiling came from, for a message that can name it. */
export function destinationAt(id: string, seconds: number): Destination | undefined {
  return destinationsFor(id).find((d) => d.maxSeconds === seconds);
}

/**
 * Attach the derived budget. Written as a function rather than as two more
 * literals per row so that a new destination cannot be added without the
 * ceiling moving with it — which is exactly how the stale 90 survived.
 */
function budgeted(f: Omit<Format, "maxSeconds" | "warnSeconds">): Format {
  const warn = warnSecondsFor(f.id);
  return {
    ...f,
    maxSeconds: maxSecondsFor(f.id),
    ...(warn === undefined ? {} : { warnSeconds: warn }),
  };
}

export const FORMATS: Record<string, Format> = {
  "deck-16x9": budgeted({
    id: "deck-16x9",
    width: 1920,
    height: 1080,
    minWeight: 0,
    navigable: true,
  }),
  "video-16x9": budgeted({
    id: "video-16x9",
    width: 1920,
    height: 1080,
    minWeight: 0,
    navigable: false,
  }),
  "short-9x16": budgeted({
    id: "short-9x16",
    width: 1080,
    height: 1920,
    minWeight: 0.6,
    navigable: false,
  }),
  "post-1x1": budgeted({
    id: "post-1x1",
    width: 1080,
    height: 1080,
    minWeight: 0.7,
    navigable: false,
  }),
};

/* ------------------------------------------------------- Arbitrary canvases */

/**
 * The smallest edge a canvas may have.
 *
 * Not a taste call. Every absolute measurement in `src/emit/kit.ts` is scaled by
 * `width / 1920`; at 64px wide that factor is 0.033, which rounds the scene
 * padding to 4px and puts every emitted type size under 3px. The composition is
 * still valid HTML — it is just an image of grey smears, and no gate can tell
 * that from a deck. Below this there is nothing left to be wrong about.
 */
export const MIN_EDGE = 64;

/**
 * The largest edge a canvas may have.
 *
 * Chrome's `Page.captureScreenshot` — which is how `render` gets every frame —
 * is bounded by the maximum texture size, 16384px on the desktop builds
 * hyperframes drives. Past it capture fails partway through a job that has
 * already burned an hour, which is the worst possible place to learn a number.
 */
export const MAX_EDGE = 16384;

/**
 * The most lopsided canvas the layout survives, long edge over short.
 *
 * DERIVED, not chosen for looks. `padY` in src/emit/kit.ts is `84 × width/1920`
 * — the vertical padding scales with WIDTH, because the type it clears scales
 * with width — so on a canvas `k` times wider than tall the two paddings take
 * `0.0875 × k` of the height. At k = 8 that is 70% of the frame gone to margin
 * and 30% left to draw in; at k = 11.4 the content box is exactly zero and every
 * archetype lays out into negative space without a single gate firing. 8 is the
 * last ratio at which "the slide is mostly margin" is still a slide.
 *
 * Applied in both directions. The tall side has no such collapse — it fails
 * through the type scale instead, which `canvasWarnings` reports below.
 */
export const MAX_ASPECT = 8;

/**
 * Below this width the deck is legible only to a machine.
 *
 * Half of the 1920 canvas every measurement in `src/emit` was chosen against.
 *
 * MEASURED, on the demo storyboard, by emitting at each canvas and bisecting
 * (experiments/011-sizing/sweep.mjs). Two things came out of it, and they are
 * why this is a WARNING and only a warning:
 *
 *   - The archetypes already refuse rather than shrink. The smallest 16:9 canvas
 *     the demo lays out on is about 1325x745; below it `split-compare` throws
 *     `the panels do not fit beside each other at the 40px floor`, by name, with
 *     the beat id. Square gives up around 740x740 and 9:16 around 429x763 — the
 *     narrow shapes get further because they stack instead of sitting side by
 *     side. So the range between here and there produces a clear build error, not
 *     a bad deck, and does not need a warning on top of it.
 *   - Under that boundary the sizes that DO emit put the 40px type floor between
 *     20 and 28 real canvas pixels depending on `REF_PULL` in src/emit/kit.ts,
 *     and text that small does not survive H.264 chroma subsampling at any
 *     bitrate. Nothing in the gate stack measures rendered glyph size, so this
 *     line is the only warning that will ever be given.
 *
 * Not an error, because a 100x100 deck is a legal thing to ask for — a thumbnail
 * strip, a favicon-scale loop — and this is not the place to argue about it.
 */
export const LEGIBLE_W = 960;

/**
 * Why this canvas cannot be built, in one sentence, or nothing.
 *
 * Separate from `canvasWarnings` because the two have different consequences and
 * the caller must not have to tell them apart by reading the prose.
 */
export function canvasProblem(width: number, height: number): string | undefined {
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return `--${name} takes a whole number of pixels, not "${value}".`;
    }
    if (value <= 0) return `--${name} must be positive; ${value} is not a canvas.`;
    if (value < MIN_EDGE) {
      return `--${name} ${value} is below ${MIN_EDGE}px. Every measurement in the layout scales by width/1920, so at this size the scene padding rounds to a few pixels and all the type collapses to the same illegible smear.`;
    }
    if (value > MAX_EDGE) {
      return `--${name} ${value} is above ${MAX_EDGE}px, the largest frame Chrome will screenshot. \`render\` would capture for an hour and then fail.`;
    }
  }
  const aspect = Math.max(width / height, height / width);
  if (aspect > MAX_ASPECT) {
    const shape = width > height ? "wide" : "tall";
    return `${width}x${height} is ${aspect.toFixed(1)}:1 — too ${shape}. The scene padding scales with width, so past ${MAX_ASPECT}:1 it takes more than 70% of the frame and the archetypes lay out into what is left. Use a canvas between 1:${MAX_ASPECT} and ${MAX_ASPECT}:1.`;
  }
  return undefined;
}

/**
 * What is legal but probably not what the caller meant. Printed, never fatal.
 */
export function canvasWarnings(width: number, height: number): string[] {
  const out: string[] = [];
  // The same arithmetic `MAX_ASPECT` is derived from, one step short of the
  // error: `padY` is `84 × width/1920` top and bottom (src/emit/kit.ts — restated
  // here rather than imported, because kit.ts imports this file). Once it is
  // eating 40% of the frame the slide is more margin than content, which is
  // survivable and is nearly always a typo in one of the two numbers.
  const paddingShare = (2 * Math.round(84 * (width / 1920))) / height;
  if (paddingShare > 0.4) {
    out.push(
      `${width}x${height} leaves the archetypes only ${Math.round((1 - paddingShare) * 100)}% of the height to draw in — the scene padding scales with width, and on a canvas this wide it takes the rest.`,
    );
  }
  if (width < LEGIBLE_W) {
    out.push(
      `${width}px wide is under ${LEGIBLE_W}px, half the canvas the whole layout vocabulary was sized against. Measured on the demo storyboard, the type floor lands in the low twenties of real pixels at this width and no gate here measures rendered glyph size. Open a frame before you ship this.`,
    );
  }
  return out;
}

/**
 * The same profile on a different canvas.
 *
 * WHAT IS AND IS NOT DERIVED. `minWeight`, the duration budget and `navigable`
 * come from `base` untouched, because there is nothing about a pixel count that
 * implies any of them: `short-9x16`'s 0.6 floor and 180-second ceiling are facts
 * about YouTube Shorts, not about being 1080 wide, and inventing an equivalent
 * for 1080x1350 would be exactly the house-rule-dressed-as-a-constraint that the
 * note on `DESTINATIONS` exists to forbid. So a resized format inherits from a
 * profile the caller NAMED — `--width 1080 --height 1350` alone means
 * "deck-16x9 at another size": unbudgeted, no floor, navigable — and
 * `--format short-9x16 --width 1080 --height 1350` means "a Reel, but 4:5".
 *
 * A canvas identical to the base's returns the base itself, so that stating the
 * size you were going to get anyway cannot rename your format or cost you the
 * budget attached to its name.
 */
export function resizeFormat(base: Format, width: number, height: number): Format {
  const problem = canvasProblem(width, height);
  if (problem) throw new Error(problem);
  if (width === base.width && height === base.height) return base;
  return { ...base, id: `custom-${width}x${height}`, width, height };
}

/** Whether this format's canvas was given rather than named. */
export function isCustom(format: Format): boolean {
  return !(format.id in FORMATS);
}

/* ------------------------------------------------------------------ Verify */

/** Verdicts are produced and printed in one process; nothing parses them back. */
export interface Finding {
  severity: "error" | "warning" | "info";
  /** Which gate produced it: lint | runtime | layout | motion | contrast. */
  gate: string;
  rule: string;
  message: string;
  beatId?: string;
}

export interface Verdict {
  passed: boolean;
  findings: Finding[];
}

/* ------------------------------------------------------------------- Types */

export type Ref = z.infer<typeof refSchema>;
export type Figure = z.infer<typeof figureSchema>;
export type Equation = z.infer<typeof equationSchema>;
export type Table = z.infer<typeof tableSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Term = z.infer<typeof termSchema>;
export type Illustration = z.infer<typeof illustrationSchema>;
/** The `images` block of the preferences, resolved. What `illustrate` reads. */
export type ImagesPrefs = z.infer<typeof prefsSchema>["images"];
export type Beat = z.infer<typeof beatSchema>;
export type Inside = z.infer<typeof insideSchema>;
export type Archetype = Beat["archetype"];
export type Storyboard = z.infer<typeof storyboardSchema>;

/** Narrow a beat to one archetype — the emitters' entry point. */
export type BeatOf<A extends Archetype> = Extract<Beat, { archetype: A }>;

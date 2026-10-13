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
  /**
   * WHAT THE ASSET IS. A CLIP IS A FIGURE.
   *
   * A harvested page hands back stills and video in one pass, and the obvious
   * shape for the video — a fifth `Source` array and a fifth `refSchema` kind —
   * costs every layer that already knows what a figure is: the inventory
   * `renderSource` prints, `assertRefsResolve`, the archetypes that take a
   * `figureId`, and the pack. All of them would need a second word for "the
   * thing this beat points at", and `refSchema` is a CLOSED enum of four kinds
   * that a fifth entry would put into every stored plan's schema. A clip is a
   * rectangle with intrinsic pixels and a caption that a beat points at, which
   * is what a figure is; what differs is one branch at emit.
   *
   * DEFAULTED rather than required, and that is the whole point of the field
   * being an enum with a default: every `source.json` written before clips
   * existed parses unchanged and comes back an `image`, which is what it has
   * always been.
   *
   * A PIECE IS A FIGURE ON THE SAME TERMS: a rectangle with intrinsic pixels, a
   * caption and a duration, whose asset is an animate scene SCRIPT that
   * `claim-figure` draws on a `<canvas>`, seeked by the `dsAnimate` plugin
   * (src/emit/animate-runtime.ts). Hand-written into `source.json` — no ingest
   * path produces one — and only `claim-figure` and `stage` take it; every
   * other figure archetype refuses it by name. One per deck in this version.
   */
  kind: z.enum(["image", "clip", "piece"]).default("image"),
  /** Path relative to the deck's asset directory. */
  src: z.string(),
  caption: z.string(),
  /**
   * The intrinsic pixel size layout keys off — for a clip, the VIDEO's own
   * dimensions, not the poster's. Every fit, crop and leader-line fraction
   * downstream is expressed against this box, so a clip whose poster was
   * letterboxed to another shape would put every annotation in the wrong place.
   */
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
  // THE THREE FIELDS ONLY A CLIP USES. All optional, for the same reason `kind`
  // is defaulted: an image carries none of them, and a source written before
  // clips existed parses into exactly the object it always did.
  /**
   * The local still that represents the clip — what the deck shows before
   * anyone presses play, and what stands in wherever the video cannot run at
   * all. A clip whose video could not be downloaded is this still and nothing
   * else, so it is the picture the beat is really planned around.
   */
  poster: z.string().optional(),
  /**
   * How long the clip runs. Seconds, as measured off the file, never guessed.
   * For a piece, how long it plays — REQUIRED there, and `claim-figure` and
   * `stage` refuse a piece without it, because it is the piece's own clock.
   */
  seconds: z.number().positive().optional(),
  /**
   * The page the video lives ON, when the video itself is not a file we can
   * fetch — a player page, an embed, anything whose terms or DRM make the bytes
   * unavailable. Then `poster` is all the deck can show, and this is where a
   * viewer goes to watch the thing. Absent for a clip we hold the file for.
   */
  href: z.string().optional(),
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
  /**
   * claim-figure prints it under the picture; a split-compare side keeps it as
   * the figure's title; a stage draws no caption and carries it as alt text.
   */
  caption: z.string(),
});

/**
 * A picture BEHIND a diagram: the frame-filling scene a pipeline, a comparison
 * or a callout is drawn over, so a deck reads as a sequence of scenes rather
 * than as cards on one pale ground (the founder's bar, 2026-10-09).
 *
 * The same two fields stage takes, for the same reasons: `figureId` first, so
 * a real figure is looked for before a brief is written; `illustration` when
 * none fits, which `illustrate` turns into a `gen-<beat>-bd` figure. A backdrop
 * with a brief and no figure is PENDING exactly as a stage is.
 *
 * Optional on every archetype that takes it, and absent means the archetype's
 * own ground: every storyboard written before this parses and emits the bytes
 * it did. The emitter draws the panels as dark glass over a scrim when it is
 * present (`src/emit/backdrop.ts`), so the words' contrast never depends on the
 * picture.
 */
export const backdropSchema = z.object({
  figureId: z.string().optional(),
  illustration: illustrationSchema.optional(),
});

/**
 * The archetypes that take a `backdrop`: the diagrams and comparisons, drawn
 * over a scene, and the two full-bleed ones that are otherwise drawn over a
 * field of colour (`FIELD_ARCHETYPES`).
 */
export const BACKDROP_ARCHETYPES = [
  "pipeline",
  "split-compare",
  "callout",
  "bar-compare",
  "hero-number",
  "kinetic",
] as const;

/**
 * The archetypes that never sit on the pack's pale ground: with no `backdrop`
 * they are drawn over a deep field of one of the pack's colours instead
 * (src/emit/backdrop.ts, `overField`).
 */
export const FIELD_ARCHETYPES = ["hero-number", "kinetic"] as const;

/**
 * Archetypes that stand on the field in v2 only. A bar-compare with no backdrop
 * was the one chart left on the pale ground in round 2 of the 2026-10-09 ko
 * e2e (b10, a plain bar chart between two panels); classic is v0.8.0 exactly
 * and keeps drawing it on its ground.
 */
export const V2_FIELD_ARCHETYPES = ["bar-compare"] as const;

/**
 * The id prefix `illustrate` gives every figure it draws (`gen-b03`,
 * `gen-b04-left`). Such a figure is the DECK's, not the document's: it was
 * drawn from a brief the planner wrote, so nothing that sizes a deck to what
 * the document contains may count it (`sourcePoints`).
 */
export const GENERATED_FIGURE_PREFIX = "gen-";

/** Whether `illustrate` drew this figure, rather than the document carrying it. */
export function isGeneratedFigure(id: string): boolean {
  return id.startsWith(GENERATED_FIGURE_PREFIX);
}

export const claimFigureParamsSchema = z
  .object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    claim: z.string(),
    /**
     * The figure's caption in the DECK'S language, short. The source's own caption
     * is printed only when it is written in the deck's language: r2 printed
     * "Figure 2 Comparison of CoT paradigms." under a Chinese slide.
     */
    caption: z.string().optional(),
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

/**
 * Two equations from the source, the first becoming the second.
 *
 * `terms` are the parts that TRAVEL: each must occur in both equations, and is
 * carried from its place in the first to its place in the second as one rigid
 * body. Everything else dissolves. Which terms are keyed IS the animation —
 * the same two strings are a glyph riot unkeyed and an exchange keyed.
 */
export const equationMorphParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  fromId: z.string(),
  toId: z.string(),
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

const chartPointSchema = z.object({ x: z.string(), y: z.number() });

export const lineChartParamsSchema = z
  .object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    xLabel: z.string(),
    yLabel: z.string(),
    points: z.array(chartPointSchema).min(2),
    /** Inter-point annotations, e.g. per-step deltas. One fewer than `points`. */
    deltas: z.array(z.string()).optional(),
    readout: z.string().optional(),
    /**
     * THE SAME MEASUREMENT UNDER A SECOND CONDITION — a baseline the main series
     * is to be read against, where the point is the change in the SHAPE of the
     * curve rather than two numbers.
     *
     * Drawn first and alone; then the curve lifts off it and reshapes into
     * `points`, leaving this one behind as a ghost. `label` names the ghost and
     * is drawn wherever the chart has room for it.
     *
     * KEEP IT SHORT — two or three words. A label wider than the plot is refused
     * outright, and that refusal reaches `onBeatError` and costs the whole beat.
     * One that fits but cannot be placed clear of the axis names, the tick and
     * category labels, the values, the deltas and both curves is DROPPED
     * instead, silently: an unnamed ghost is still legibly the fainter, earlier
     * curve, where a name printed through a number is a defect in both of them.
     * Nothing warns about that one — see the placement note in
     * `src/emit/archetypes/line-chart.ts`.
     */
    compare: z.object({ label: z.string(), points: z.array(chartPointSchema).min(2) }).optional(),
  })
  /**
   * A COMPARISON IS BETWEEN THE SAME x VALUES OR IT IS NOT A COMPARISON.
   *
   * Two series of different lengths, or of the same length over different
   * categories, draw two curves the eye reads as measured against one axis when
   * they were not — and the reshape then carries point i of one condition onto
   * point i of a different one, which is a smooth, convincing lie. Nothing
   * downstream can catch it: both curves fit the plot, both clear the type
   * floor, and `drift` renders the same wrong thing twice.
   *
   * Here rather than in `plan/refs.ts` because these are LITERALS, not ids into
   * `source` — there is no dangling reference for that gate to resolve. A params
   * invariant belongs in the schema, where a bad plan fails before a beat has
   * been spent on it.
   */
  .superRefine((p, ctx) => {
    if (!p.compare) return;
    if (p.compare.points.length !== p.points.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compare", "points"],
        message: `compare has ${p.compare.points.length} points against ${p.points.length}; a comparison is over the same x values`,
      });
      return;
    }
    const off = p.compare.points.findIndex((c, i) => c.x !== p.points[i]?.x);
    if (off >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compare", "points", off, "x"],
        message: `compare point ${off} is "${p.compare.points[off]?.x}" where points has "${p.points[off]?.x}"`,
      });
    }
  });

export const calloutParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  panels: z
    .array(z.object({ label: z.string(), lines: z.array(z.string()) }))
    .min(1)
    .max(3),
  note: z.string().optional(),
  /** A full-bleed scene behind the diagram. See `backdropSchema`. */
  backdrop: backdropSchema.optional(),
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
  /** A full-bleed scene behind the diagram. See `backdropSchema`. */
  backdrop: backdropSchema.optional(),
});

export const annotatedFigureParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  figureId: z.string(),
  /**
   * The figure's caption in the DECK'S language, short. The source's own caption
   * is printed only when it is written in the deck's language: r2 printed
   * "Figure 2 Comparison of CoT paradigms." under a Chinese slide.
   */
  caption: z.string().optional(),
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
  /** A full-bleed scene behind the diagram. See `backdropSchema`. */
  backdrop: backdropSchema.optional(),
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
  /**
   * Tilt the slab stack away from the viewer, so the planes read as stacked in
   * depth rather than merely offset up the page.
   *
   * OPTIONAL, and absent means flat — every storyboard written before this
   * existed still parses, and every deck that does not ask for it emits exactly
   * the bytes it did before.
   *
   * Degrees, and bounded at 18 rather than by taste: the tilt is paid for in
   * declared type, because perspective shrinks the far half of the plane and
   * invariant 5 is about what the audience SEES. At 18 degrees a 40px floor
   * already needs 53.8px declared (`src/emit/depth.ts`), and past that a
   * headline cannot spend enough and still fit its own line.
   */
  tilt: z.number().min(0).max(18).optional(),
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
  /** A full-bleed scene behind the diagram. See `backdropSchema`. */
  backdrop: backdropSchema.optional(),
});

/**
 * Where a stage beat sets its words over the picture, or `none` for no words.
 *
 * A SMALL FIXED SET rather than coordinates: each one is a layout the emitter
 * has a scrim for, so the contrast under the text is decided once per entry
 * and never by the planner. An enum, so the model sees exactly these values.
 */
export const STAGE_PLACEMENTS = ["none", "bottom-left", "center", "top-left", "right"] as const;

/**
 * One figure that owns the whole frame — a product UI, a scene, a photo, an
 * animate piece — edge to edge, with no plate, border or side column.
 *
 * `headline` is required even under `placement: "none"`: it is the scene's
 * label (the composition's title attribute, the deck's notes fallback), and a
 * beat with nothing to say about its picture has no business being a beat.
 *
 * `illustration` is claim-figure's alternative to `figureId`, for the same
 * reason: without it a source whose only figures are plots — a typical paper —
 * had no legal way to a full-bleed slide at all, and every slide kept the
 * headline-over-body layout.
 */
export const stageParamsSchema = z
  .object({
    headline: z.string(),
    /** First, for the reason claim-figure gives: look for a real figure before writing a brief. */
    figureId: z.string().optional(),
    /** A picture to generate when no figure in the inventory can own the frame. */
    illustration: illustrationSchema.optional(),
    placement: z.enum(STAGE_PLACEMENTS),
    /** One short line under the headline. Dropped under `placement: "none"`. */
    line: z.string().optional(),
  })
  .refine((p) => p.figureId !== undefined || p.illustration !== undefined, {
    message: "stage needs a figureId or an illustration",
    path: ["figureId"],
  });

/**
 * ONE NUMBER THAT OWNS THE FRAME — the result an explainer video stops on.
 *
 * `value` is the figure as the source prints it ("43.63", "1/4", "75.1%"); its
 * digits are drawn as odometer reels that roll into place, every other
 * character standing still. `compare` is the number it is read against — the
 * baseline, the before — drawn as a second figure, and as a pair of bars when
 * both parse as plain numbers in one unit (`unit`). `label` names what `value`
 * measures; `headline` is the sentence the number says, set under it.
 *
 * Full-bleed like `stage`: over a `backdrop` picture when it has one, else over
 * a deep field of one of the pack's colours (src/emit/backdrop.ts), never on the pale
 * ground a deck of cards sits on.
 */
export const heroNumberParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  label: z.string(),
  compare: z.object({ value: z.string(), label: z.string() }).optional(),
  /** A full-bleed scene behind the number. See `backdropSchema`. */
  backdrop: backdropSchema.optional(),
});

/**
 * A CLAIM SET AS MOVING TYPE. Two to four phrases, each arriving with its own
 * move and stopped on, with one `key` word in it struck through by a highlight.
 *
 * `headline` labels the slide — the composition's title, the notes fallback —
 * and is not drawn, as under a stage's `placement: "none"`: the phrases are
 * what the audience reads. `key` must appear verbatim in its phrase.
 */
export const kineticParamsSchema = z
  .object({
    headline: z.string(),
    phrases: z
      .array(z.object({ text: z.string(), key: z.string().optional() }))
      .min(2)
      .max(4),
    /** A full-bleed scene behind the words. See `backdropSchema`. */
    backdrop: backdropSchema.optional(),
  })
  .superRefine((p, ctx) => {
    p.phrases.forEach((ph, i) => {
      if (ph.key !== undefined && !ph.text.includes(ph.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["phrases", i, "key"],
          message: `key "${ph.key}" is not in phrase "${ph.text}"`,
        });
      }
    });
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

/**
 * The structural job a beat does in a paper-shaped deck.
 *
 * A ROLE IS NOT AN ARCHETYPE AND NOT A HEADING. Position and archetype cannot
 * tell these beats apart — a limitation and a conclusion are both naturally a
 * `callout`, and the prompt lists both under one tell — and a check on headline
 * wording is the failure `scanHeadlines` documents, where a sharpened rule was
 * answered by swapping one verb. So the plan SAYS which beat is which, and
 * everything downstream reads the declaration rather than guessing at prose.
 *
 * AN ENUM, DELIBERATELY, AND THAT IS WHY IT MAY BE SHOWN TO THE MODEL.
 * `forStructuredOutput` strips numeric and length bounds, which is how `tilt`
 * came to be required as an unbounded number that `safeParse` then rejected,
 * discarding whole runs. `enum` is not in that stripped set, so the model sees
 * exactly the values `storyboardSchema` will accept and cannot cross a bound it
 * was never shown.
 *
 * Optional, and hidden from the planner's schema entirely unless the paper arc
 * was asked for — see `plannerInvisible` in src/plan/codex.ts. A deck that did
 * not ask for the arc is byte-for-byte what it was.
 */
export const beatRoleSchema = z.enum(["intro", "background", "limitations", "conclusion"]);

/**
 * The part of the source a beat belongs to, in the order a deck covers them:
 * the problem, what was done before, the method, the experiments (setup and
 * results), the limits and what is left to explore, the summary.
 *
 * NOT `role`. A role is one beat's structural job and belongs to one slide; a
 * part is a stretch of the deck and has as many beats as the source gives it.
 * Read by the coverage check (src/plan/coverage.ts), which detects the parts a
 * source HAS from its headings and holds the plan to covering each, in order.
 * Optional, and hidden from the planner unless the source has such parts.
 */
export const beatPartSchema = z.enum([
  "intro",
  "prior-work",
  "method",
  "experiments",
  "limits",
  "summary",
]);

/**
 * The literal scenes a beat can be drawn as (src/literal/), by name: five VERBS
 * that compose the paper's own operations on its own numbers, and three
 * cross-cutting kinds. One list, read by the schema, the planner's prompt and
 * the build, which draws every one (src/literal/registry.ts). No name here is a
 * paper's topic: a new paper is planned with these and needs no new code.
 */
export const LITERAL_KIND_NAMES = [
  "operate",
  "evolve",
  "flow",
  "place",
  "region",
  "recap",
  "prior-work",
  "table",
] as const;

/**
 * One label slot of a literal scene. Required unless `optional`. A text may
 * name the scene's computed values as `{name}` (the kind says which), filled
 * in at build time — and only where every input of the scene is stated
 * (src/plan/coverage.ts refuses it on example material).
 */
export interface LiteralSlot {
  what: string;
  optional?: true;
  /** The computed values the text may name as `{name}`. */
  vars?: readonly string[];
}

/** The slot every kind has: the section name the shell draws above the headline. */
export const LITERAL_COMMON_SLOTS: Readonly<Record<string, LiteralSlot>> = {
  eyebrow: {
    what: "the section this beat belongs to, drawn above the headline",
    optional: true,
  },
};

/** The tag that says a scene runs on example material, in the deck's languages. */
const EXAMPLE_SLOT: LiteralSlot = {
  what: "a tag drawn under the scene saying it is an example, in the deck's language (example · 예시 · 例 · 示例); required whenever any input is example material (a picture, an unprinted vector, a `condition`, a split the source does not state)",
  optional: true,
};

/** Everything the planner is told, and checked against, for one literal kind. */
export interface LiteralKindDoc {
  /**
   * What the kind draws and what it takes, shown in the prompt after the
   * kind's name. Continuation lines are indented 21 spaces to sit under it.
   */
  doc: string;
  /**
   * EVERY SLOT THE KIND READS, and nothing else: the planner is shown them,
   * `literalFindings` refuses a slot not listed or a required one missing, and
   * a fragment reading a slot not listed here throws. No text has a default.
   */
  slots: Readonly<Record<string, LiteralSlot>>;
  /**
   * What the scene's takeaway and labels must not claim, each shown in the
   * prompt and checked against them: what the scene computes cannot back it.
   */
  mustNotClaim?: readonly LiteralClaimBan[];
}

/** One claim a kind's takeaway and labels must not make. */
export interface LiteralClaimBan {
  /** The claim, in the planner's words. */
  what: string;
  /** Why the scene cannot back it: what it computes instead. */
  because: string;
  /** Words that make the claim, in the deck's languages (en, ko, ja, zh). */
  pattern: RegExp;
}

/** A verb computes known operations: it never shows what a trained model outputs. */
const NO_LEARNED_OUTPUT: LiteralClaimBan = {
  what: "what a trained model or network outputs, predicts or has learned",
  because:
    "the scene runs only operations whose every parameter the source states; a learned component is a `flow` stage drawn as a box, never computed",
  pattern:
    /\b(?:predict(?:s|ed|ion)?|learn(?:s|ed|t)|trained (?:model|network|weights)|network(?:'s)? output)\b|예측(?:한|된)|학습된|学習済み|予測(?:した|された)|预测(?:的|出)|训练好的|学到的/i,
};

/* ---------------------------------------------------------- the op library */

/** One parameter an op or rule takes: a number the source states, in a ROLE. */
export interface LiteralParamDoc {
  what: string;
  /**
   * The role's nouns, en/ko/ja/zh. A value is grounded for the role only when
   * it (or the symbol the source binds it to) sits within 40 characters of one.
   */
  nouns: RegExp;
  optional?: true;
  /** A whole number (a size, a count). */
  int?: true;
}

/** One variant (`how`, `stat`, `over`, `reset`, `schedule`) and the words that name it. */
export interface LiteralVariantDoc {
  what: string;
  /** Some passage naming the op must also hold one of these words. */
  words: RegExp;
}

/** One operation of the library (src/literal/ops.ts), as the planner and the gate see it. */
export interface LiteralOpDoc {
  doc: string;
  /** The words that name the op; a passage holding one grounds its variants. */
  nouns: RegExp;
  how?: Readonly<Record<string, LiteralVariantDoc>>;
  /** The variant used when `how` is absent (definitional, needs no word). */
  defaultHow?: string;
  params?: Readonly<Record<string, LiteralParamDoc>>;
  /** Further enum fields the op reads (`stat`, `over`). */
  enums?: Readonly<Record<string, Readonly<Record<string, LiteralVariantDoc>>>>;
}

const W = {
  mean: /\bmean\b|averag|평균|平均|均值/i,
  min: /\bmin(?:imum)?\b|최소|最小|min\s*\(/i,
  max: /\bmax(?:imum)?\b|최대|最大|max\s*\(/i,
  // No bare 합: it sits inside 결합, 통합 and 합성곱, so it names anything.
  sum: /\bsum\b|\badd(?:s|ed|ing)?\b|\btotal\b|합산|합계|총합|더하|더한|더해|総和|合計|加算|求和|总和|相加/i,
  variance: /varian|분산|分散|方差/i,
  std: /standard deviation|\bstd\b|표준편차|標準偏差|标准差/i,
  channel: /channel|채널|チャネル|チャンネル|通道/i,
  row: /\brow|\btoken|행별|각 행|토큰|行ごと|トークン|每行|词元/i,
  threshold: /threshold|임계|閾値|阈值|门限/i,
};

export const LITERAL_OPS = {
  channels: {
    doc: "collapse the colour channels of a picture to one map",
    nouns: W.channel,
    how: {
      mean: { what: "their mean", words: W.mean },
      min: { what: "their minimum", words: W.min },
      max: { what: "their maximum", words: W.max },
      luma: {
        what: "Rec. 709 luma",
        words: /luma|luminance|gr[ae]yscale|brightness|휘도|밝기|輝度|明るさ|亮度|灰度/i,
      },
    },
  },
  conv: {
    doc: "2-D convolution of every channel (1-D along a vector), edges replicated",
    nouns:
      /convol|filter|kernel|합성곱|컨볼루션|필터|커널|畳み込み|フィルタ|カーネル|卷积|滤波|算子/i,
    how: {
      "sobel-x": { what: "the horizontal Sobel kernel", words: /sobel|소벨|ソーベル|索贝尔/i },
      "sobel-y": { what: "the vertical Sobel kernel", words: /sobel|소벨|ソーベル|索贝尔/i },
      laplacian: { what: "the 3×3 Laplacian", words: /laplac|라플라시안|ラプラシアン|拉普拉斯/i },
      "prewitt-x": { what: "the horizontal Prewitt kernel", words: /prewitt|프리윗|プレヴィット/i },
      "prewitt-y": { what: "the vertical Prewitt kernel", words: /prewitt|프리윗|プレヴィット/i },
      box: {
        what: "a box (mean) filter of side `size`",
        words:
          /\bbox\b|mean filter|average filter|평균 필터|박스|ボックス|平均フィルタ|均值滤波|方框/i,
      },
      gaussian: { what: "a Gaussian of `sigma`", words: /gauss|가우시안|가우스|ガウス|高斯/i },
      weights: {
        what: "the `weights` matrix, every row printed in the source",
        words: /kernel|weights?|matrix|커널|가중치|행렬|カーネル|重み|行列|核|权重|矩阵/i,
      },
    },
    params: {
      size: {
        what: "the kernel side",
        nouns: /size|kernel|window|크기|커널|サイズ|大小|尺寸|×/i,
        optional: true,
        int: true,
      },
      sigma: {
        what: "the Gaussian's σ",
        nouns: /σ|sigma|standard deviation|표준편차|標準偏差|标准差/i,
        optional: true,
      },
    },
  },
  reduce: {
    doc: "a statistic over a window of side `window`: sliding (stride 1) or pooled (`stride` = window)",
    nouns:
      /patch|window|pool|neighbou?rhood|local|패치|윈도|창|풀링|국소|이웃|パッチ|窓|プーリング|局所|近傍|块|窗口|池化|局部|邻域/i,
    how: {
      min: { what: "the minimum", words: W.min },
      max: { what: "the maximum", words: W.max },
      mean: { what: "the mean", words: W.mean },
    },
    params: {
      window: {
        what: "the window side, in pixels or elements",
        nouns: /patch|window|pool|size|kernel|패치|윈도|창|크기|パッチ|窓|サイズ|块|窗口|大小/i,
        int: true,
      },
      stride: {
        what: "the stride",
        nouns: /stride|step|보폭|스트라이드|ストライド|步长|步幅/i,
        optional: true,
        int: true,
      },
    },
  },
  combine: {
    doc: "an elementwise combination of two earlier outputs (`of`: their indexes, 0 = the input)",
    nouns:
      /absolute|magnitude|\bsum\b|\badd|\bmin\b|\bmax\b|product|multipl|differen|subtract|residual|절댓값|절대값|크기|합|더하|최소|최대|곱|차이|빼|잔차|絶対値|大きさ|和|積|差|最小|最大|绝对值|幅值|乘|最小值|最大值/i,
    how: {
      "abs-sum": {
        what: "|a| + |b|",
        words: /absolute|\|[^|]{1,12}\|\s*\+|절댓값|절대값|絶対値|绝对值/i,
      },
      // Each variant's words name THAT combination: no bare 크기/大きさ (size), 곱 (in 합성곱),
      // 差 (in 误差) or "different", which a passage holds whatever it combines.
      magnitude: {
        what: "√(a² + b²)",
        words:
          /magnitude|euclidean|hypot|√|유클리드|그래디언트 크기|기울기 크기|勾配の大きさ|勾配強度|ユークリッド|幅值|模长|欧几里得/i,
      },
      min: { what: "min(a, b)", words: W.min },
      max: { what: "max(a, b)", words: W.max },
      sum: { what: "a + b", words: W.sum },
      product: {
        what: "a · b",
        words: /\bproducts?\b|multipl|곱셈|곱한|곱하|곱해|要素積|乗算|掛け|乘积|相乘|乘以/i,
      },
      diff: {
        what: "a − b",
        words: /\bdifferences?\b|subtract|minus|차분|뺄셈|빼|감산|差分|引き算|減算|相减|减去|差值/i,
      },
      posdiff: {
        what: "max(0, a − b), the positive part",
        words: /max\s*\(\s*0|positive part|\)_?\+|양수 부분|正の部分|正部/i,
      },
    },
  },
  normalise: {
    doc: "divide or rescale by a statistic",
    nouns: /normali[sz]|정규화|正規化|归一化|标准化|softmax|소프트맥스|ソフトマックス/i,
    how: {
      mean: { what: "by the mean", words: W.mean },
      max: { what: "by the maximum", words: W.max },
      range: { what: "to [0, 1] between min and max", words: /range|min.?max|범위|範囲|范围/i },
      sum: { what: "to sum to 1", words: /\bsum|total|합이|합계|총합|総和|合計|求和|总和/i },
      std: { what: "by the standard deviation", words: W.std },
      softmax: { what: "softmax", words: /softmax|소프트맥스|ソフトマックス/i },
    },
    enums: {
      over: {
        all: { what: "over everything", words: /./ },
        channel: { what: "each channel", words: W.channel },
        row: { what: "each row", words: W.row },
      },
    },
  },
  threshold: {
    doc: "keep or fire where x ≥ θ: a stated `theta`, or θ = `scale` × a statistic (`stat`) of the input, `over` all or per channel",
    nouns: W.threshold,
    how: {
      binary: {
        what: "1 where x ≥ θ, else 0 (fire)",
        words: /fire|spike|binary|발화|스파이크|이진|発火|二値|发放|二值/i,
      },
      keep: {
        what: "x where x ≥ θ, else 0",
        words: /keep|pass|retain|suppress|유지|통과|억제|保持|抑制|通过/i,
      },
    },
    defaultHow: "binary",
    params: {
      theta: { what: "the threshold θ", nouns: W.threshold, optional: true },
      scale: {
        what: "the scale θ is proportional with",
        nouns: /scal|factor|proportional|비례|스케일|계수|比例|係数|系数/i,
        optional: true,
      },
    },
    enums: {
      stat: {
        mean: { what: "the mean", words: W.mean },
        var: { what: "the variance", words: W.variance },
        std: { what: "the standard deviation", words: W.std },
      },
      over: {
        all: { what: "over everything", words: /./ },
        channel: { what: "per channel", words: W.channel },
      },
    },
  },
  quantize: {
    doc: "clip(rounding(x / step), 0, levels) / levels: integer levels",
    nouns: /quanti[sz]|level|양자화|수준|레벨|量子化|レベル|量化|级别/i,
    how: {
      floor: {
        what: "rounded down",
        words: /floor|⌊|round(?:ed|s)? down|truncat|내림|버림|切り捨て|向下取整/i,
      },
      round: {
        what: "rounded to the nearest",
        words: /round(?:ing|ed|s)? to (?:the )?nearest|nearest integer|반올림|四捨五入|四舍五入/i,
      },
    },
    params: {
      levels: {
        what: "the number of levels D",
        nouns: /level|quanti[sz]|수준|레벨|양자화|レベル|量子化|级|量化/i,
        int: true,
      },
      step: {
        what: "the step (the threshold one level spans)",
        nouns: /step|threshold|interval|간격|임계|間隔|閾値|步长|阈值/i,
      },
    },
  },
  formula: {
    doc: "an elementwise expression (`expr`: + − × ÷ ^ min max abs exp log sqrt clip, `x` the previous output, `x0`… the earlier ones, named params), grounded by `checks` the source prints",
    nouns: /./,
  },
  matmul: {
    doc: "a matrix product: two earlier outputs (`of`), or the previous output times the stated `weights`",
    nouns: /matri|multipl|product|행렬|곱|行列|積|矩阵|乘/i,
  },
  select: {
    doc: "pick by rank along each row (`over` row) or over all",
    nouns:
      /top-?\s?k|\btop\b|argmax|arg\s?max|sort|rank|cumulative|cumsum|상위|정렬|순위|누적|上位|並べ|累積|排序|累积|前\s?k/i,
    how: {
      topk: {
        what: "keep the top `k`, zero the rest",
        words: /top-?\s?k|\btop\b|상위|上位|前\s?k/i,
      },
      argmax: { what: "one-hot at the largest", words: /argmax|arg\s?max|가장 큰|最大/i },
      sort: { what: "sort descending", words: /sort|rank|정렬|순위|並べ|排序/i },
      cumsum: { what: "running sum", words: /cumulative|cumsum|누적|累積|累积/i },
    },
    params: {
      k: { what: "how many are kept", nouns: /\bk\b|top|상위|上位|前/i, optional: true, int: true },
    },
    enums: {
      over: { row: { what: "each row", words: /./ }, all: { what: "over everything", words: /./ } },
    },
  },
  transform: {
    doc: "the magnitude spectrum |DFT| of each row",
    nouns:
      /fourier|\bFFT\b|\bDFT\b|spectr|frequenc|푸리에|스펙트럼|주파수|フーリエ|スペクトル|周波数|傅里叶|频谱|频率/i,
    how: {
      fft: {
        what: "|DFT|, bins 0..n/2",
        words: /fourier|\bFFT\b|\bDFT\b|spectr|푸리에|스펙트럼|フーリエ|スペクトル|傅里叶|频谱/i,
      },
    },
    defaultHow: "fft",
  },
} as const satisfies Readonly<Record<string, LiteralOpDoc>>;

export type LiteralOpName = keyof typeof LITERAL_OPS;
export const LITERAL_OP_NAMES = Object.keys(LITERAL_OPS) as [LiteralOpName, ...LiteralOpName[]];

/** Every variant name any op takes: the schema's `how`. */
const OP_HOWS = [
  ...new Set(
    Object.values(LITERAL_OPS as Record<string, LiteralOpDoc>).flatMap((o) =>
      Object.keys(o.how ?? {}),
    ),
  ),
] as [string, ...string[]];

/** The update rules `evolve` runs: the presets and the general one. */
export const LITERAL_RULES = {
  recur: {
    doc: "s' = a·s + b·x (`how` ema: b = 1−a; leaky: b = 1; linear: `b` stated), with an optional threshold (`theta`, or θ = `scale`·s) and `reset`",
    nouns:
      /moving average|\bEMA\b|momentum|leak|integrat|decay|recurren|이동평균|모멘텀|누설|적분|감쇠|移動平均|モーメンタム|リーク|積分|減衰|滑动平均|动量|泄漏|积分|衰减/i,
    how: {
      ema: {
        what: "b = 1 − a",
        words: /moving average|\bEMA\b|이동평균|移動平均|滑动平均|指数平均/i,
      },
      leaky: { what: "b = 1", words: /leak|integrat|누설|적분|リーク|積分|泄漏|积分/i },
      linear: { what: "`b` stated", words: /./ },
    },
    params: {
      a: {
        what: "the factor on the old state (momentum, decay, leak)",
        nouns:
          /momentum|decay|leak|\bEMA\b|moving average|smooth|모멘텀|감쇠|누설|이동평균|モーメンタム|減衰|リーク|移動平均|动量|衰减|泄漏|滑动平均/i,
      },
      b: {
        what: "the factor on the input",
        nouns: /gain|input|weight|이득|입력|ゲイン|入力|增益|输入/i,
        optional: true,
      },
      theta: { what: "a fixed threshold the state fires at", nouns: W.threshold, optional: true },
      scale: {
        what: "θ = scale · state: inputs are compared with it",
        nouns: /scal|factor|proportional|비례|스케일|계수|比例|係数|系数/i,
        optional: true,
      },
    },
    enums: {
      reset: {
        none: { what: "no reset", words: /./ },
        soft: {
          what: "subtract θ on firing",
          words: /soft reset|subtract|residual|잔여|뺄셈|減算|残差|软重置|减去|残余/i,
        },
        hard: {
          what: "back to 0 on firing",
          words: /hard reset|reset to (?:zero|0)|하드 리셋|0으로|ゼロに|硬重置|归零/i,
        },
      },
    },
  },
  noise: {
    doc: "the forward noising of the picture, x_t = √ᾱ_t·x₀ + √(1−ᾱ_t)·ε, on a stated schedule (`T`, `betaStart`, `betaEnd`)",
    nouns: /diffusion|noise|denois|확산|노이즈|拡散|ノイズ|扩散|噪声/i,
    params: {
      T: {
        what: "the number of steps T",
        nouns: /steps?|timesteps?|\bT\b|단계|스텝|ステップ|步/i,
        int: true,
      },
      betaStart: {
        what: "β₁",
        nouns: /β|beta|noise|variance|노이즈|분산|ノイズ|分散|噪声|方差/i,
        optional: true,
      },
      betaEnd: {
        what: "β_T",
        nouns: /β|beta|noise|variance|노이즈|분산|ノイズ|分散|噪声|方差/i,
        optional: true,
      },
    },
    enums: {
      schedule: {
        linear: { what: "β linear in t", words: /linear|선형|線形|线性/i },
        cosine: { what: "ᾱ on a cosine", words: /cosine|코사인|コサイン|余弦/i },
      },
    },
  },
  formula: {
    doc: "s' = `expr` over `s` (the state), `x` (the input) and named params, grounded by `checks` or printed verbatim in the source",
    nouns: /./,
  },
  lanes: {
    doc: "lanes of runs, one row each: serial runs one after another, a parallel run at once; a lane as long as its stated time",
    nouns: /./,
  },
  trace: {
    doc: "the source's own steps, one row each: `steps` ({lead, parts: [{text, tag}]}) whose parts are tagged by `tags` ({tag, label, tone, strike})",
    nouns: /./,
  },
} as const satisfies Readonly<Record<string, LiteralOpDoc>>;

export type LiteralRuleName = keyof typeof LITERAL_RULES;

/** The nouns a few non-op numbers are grounded by (src/plan/coverage.ts). */
export const LITERAL_ROLE_NOUNS = {
  /** A count of runs on a lane, or of tokens. */
  count:
    /token|step|run|draft|pass|iteration|position|토큰|단계|스텝|횟수|トークン|ステップ|回|词元|步|令牌|次/i,
  /** A stated duration: a lane's total, a run's cost. */
  duration:
    /latency|time|second|\bms\b|\bs\b|cost|지연|시간|초|비용|遅延|時間|秒|コスト|延迟|时间|成本/i,
  /** A stream's statistic (mean, variance, std). */
  stat: /./,
} as const;

/* ------------------------------------------------------------ kinds' docs */

/**
 * THE PLANNER'S LIST: one entry per name in `LITERAL_KIND_NAMES`, a `Record` so
 * a name added there does not compile until it has an entry here, and the
 * build draws it (src/literal/registry.ts). Listed in the order the prompt
 * shows them. Every example is generic: no paper's facts live in src/.
 */
export const LITERAL_KIND_DOCS: Readonly<Record<LiteralKind, LiteralKindDoc>> = {
  operate: {
    doc: `a stated formula EVALUATED TERM BY TERM, or an input run through
                     a chain of operations. TERMS: when the source prints a
                     formula and the values it is evaluated at, and reports
                     the result (an expected count, a speedup, a probability),
                     give \`equation\` (the source's TeX, exactly), \`given\`
                     ({name, symbol, value as printed, what it is in the deck's
                     language}) and \`terms\` ({term over k and the given
                     names, from, to: a number or a given's name, between: the
                     step from one term to the next as the source would write
                     it, combine sum · product, reported: the source's own
                     number for the result}). Each term is a cell, computed;
                     the result must match \`reported\` or the plan is refused.
                     Slots \`cell\` ({n}), \`cells\`, \`match\`. CHAIN: an input run through a CHAIN of known operations (the op library
                     below), each output computed for real at build time and
                     revealed on its sentence. The input is a \`picture\` (a beat
                     carrying one), \`vectors\` over \`bins\` (1–2 vectors, e.g.
                     two distributions, over 2–24 bins; a number in a bin's
                     label must be one the source prints) or a \`matrix\`. Each \`chain\` step names an
                     \`op\`, its \`how\`, its \`params\` ({name, value, symbol}
                     exactly as the source writes them) and a \`label\` in the
                     deck's language. \`condition\` (contrast · noise · blur,
                     \`amount\`) degrades the input as an EXAMPLE; \`compare\`
                     condition shows the chain on the clean and the degraded
                     input side by side, \`compare\` params runs \`alt\` (another
                     parameterisation of step \`alt.step\`) beside it.
                     NOT ONLY PICTURES. A sampling or acceptance rule the
                     source states over two distributions — keep min(p, q),
                     resample from the residual max(0, p − q) normalised — is
                     \`vectors\` [{label "p", values [0.1, 0.4, 0.3, 0.2]},
                     {label "q", values [0.3, 0.3, 0.1, 0.3]}] over \`bins\`
                     ["a", "b", "c", "d"], \`chain\` [{op combine, how min, of
                     [0, 1]}, {op combine, how posdiff, of [0, 1]}, {op
                     normalise, how sum}], each step labelled with the
                     source's own name for it. The distributions are example
                     input, so \`example\` is set and no computed value is
                     printed: the rule is shown bin by bin, for real. The same
                     holds for any stated rule over an array: a top-k, a
                     softmax, a cumulative sum, a threshold.`,
    slots: {
      input: { what: "op chains: title of the input (required with a chain)", optional: true },
      output: {
        what: "op chains: title of the last output (required with a chain)",
        vars: ["max", "sum", "mean"],
        optional: true,
      },
      cell: {
        what: "terms: each cell's title, with {n} its place (e.g. 'token {n}')",
        vars: ["n"],
        optional: true,
      },
      cells: { what: "terms: under the cells, what a cell's number is", optional: true },
      match: {
        what: "terms: beside the result, the source's own number it matches and where (required with `reported`)",
        optional: true,
      },
      condition: {
        what: "title of the degraded input (required with `condition`)",
        optional: true,
      },
      alt: {
        what: "title of the alternative's output (required with `compare` params)",
        optional: true,
      },
      caption: {
        what: "under the scene: what is computed on what; required on a picture: say the stated operations run on an example image",
        optional: true,
      },
      example: EXAMPLE_SLOT,
    },
    mustNotClaim: [NO_LEARNED_OUTPUT],
  },
  evolve: {
    doc: `the source's own steps as rows, or a state stepping
                     through iterations under a stated \`rule\`. TRACE: a
                     worked example the source writes out step by step (tokens
                     proposed, accepted, rejected and corrected; a derivation
                     line by line) is \`rule\` trace — \`tags\` its legend (1–4,
                     each a tone, \`strike\` for what is thrown away), \`steps\`
                     one row each ({lead: what it carries on from, parts:
                     [{text, tag}]}), \`note\` the facts beside it. A trace
                     printed only in a FIGURE: give \`picture\` (the beat citing
                     it), \`panel\` when it has several, and \`read\` (what to
                     read off it) — \`plan\` transcribes the steps; leave them
                     out. LANES: serial against parallel work, a latency
                     budget, is \`rule\` lanes, one row a lane:
                     \`lanes\` ({label, total, runs: [{label,
                     count, dur, parallel}]}) — a \`count\` is a NUMBER the
                     source prints (a symbol like K or γ is not a count: leave
                     \`count\` out, the runs are then example, tagged, and the
                     symbol goes in the run's label) — serial runs one after another,
                     a parallel run covering its count at once; a lane is as
                     long as its stated \`total\` (printed at its end; or Σ
                     count·dur), else as its serial steps: a parallel run is
                     ONE step, so verifying γ+1 positions at once is drawn
                     shorter than γ+1 serial runs. A stated duration with no
                     count is one block. Lanes of equal steps are refused.
                     Fills the \`unit\` slot: what one run is. Otherwise:
                     recur (EMA, leaky integration, with a threshold and a
                     reset), noise (forward noising of a \`picture\`) or formula
                     (any update the source prints). Its \`input\` is \`values\`
                     the source prints, or \`from\` an earlier operate beat
                     whose computed tiles stream in (\`stat\` mean · var ·
                     std of each). \`phases\` ({from, label, freeze}) split the
                     run: a frozen phase keeps receiving inputs while the state
                     holds. Every number is the source's, in its role. A
                     STATED UPDATE IN ANY FIELD: a running average the source
                     prints as s' = β·s + (1 − β)·x with β = 0.9 and the
                     inputs it lists is \`rule\` recur, \`how\` ema, \`params\`
                     [{name "a", value "0.9", symbol "β"}], \`input\`
                     values as printed; a recurrence the source writes out
                     with the values it produces is \`rule\` formula, \`expr\`
                     over s and x, grounded by its \`checks\`. A closed-form
                     rule of one variable with the values it produces is a
                     \`place\` plane with \`curves\` instead.`,
    slots: {
      state: {
        what: "recur, formula: legend of the inputs (the values the source prints, or the tiles streaming in)",
        optional: true,
      },
      trace: {
        what: "recur, formula: legend of the state's bar; noise: of the signal's bar",
        optional: true,
      },
      threshold: {
        what: "legend of the threshold's tick and of a step that reaches it (required with a threshold)",
        optional: true,
      },
      noise: { what: "noise: legend of the noise's bar", optional: true },
      unit: { what: "lanes: what one run is (required with lanes)", optional: true },
      caption: { what: "under the scene: what steps and what the state is", optional: true },
      example: EXAMPLE_SLOT,
    },
    mustNotClaim: [NO_LEARNED_OUTPUT],
  },
  flow: {
    doc: `data passing through stages. \`form\` chain: \`stages\` ({id,
                     label, learned, \`shape\` as the source writes it,
                     \`tokens\` the token row a model holds ({label, count as
                     the source states it, name, tone}), \`show\` an earlier
                     verb beat's computed layer, \`figure\` the source's own
                     figure id, \`quote\` what the stage puts out in the
                     source's words, \`phase\` train · infer · both}) joined
                     by \`edges\` ({from, to, via: the token group the wire
                     carries}). Drawn in up to 4 columns by depth: what enters
                     on the left (a figure under its name, plain inputs as
                     pills), a model as a box with its token row, what comes
                     out stacked on the right, each with a figure or a quote.
                     A stage holds one of tokens, a picture, a quote. A
                     \`shape\` that is a stated count (4, γ, γ+1) is drawn as
                     that many token chips (past 16: 1, 2, …, the count). A
                     chain where NO stage has \`tokens\`, a \`show\`, a
                     \`figure\`, a \`quote\` or a count \`shape\` is refused:
                     it is empty boxes with names, so draw that mechanism as an
                     \`evolve\` instead. A train-only
                     stage is dashed and tagged with the \`train\` slot;
                     \`phases\` true then shows inference with it faded. A
                     learned stage never shows a computed layer.`,
    slots: {
      train: {
        what: "the tag on a training-only stage, e.g. 'training only' (required when one is)",
        optional: true,
      },
      caption: { what: "under the scene: what flows", optional: true },
      example: EXAMPLE_SLOT,
    },
    mustNotClaim: [NO_LEARNED_OUTPUT],
  },
  place: {
    doc: `items positioned by the source's numbers. \`form\` plane (two
                     \`axes\`) or strip (one): \`items\` ({label, values exactly as
                     the source writes them, one per axis, group; on a plane a
                     method the source gives only one of the two numbers for
                     keeps "--" for the other and is drawn as a dashed line at
                     the one it has), revealed in
                     spoken order or \`reveal\` groups (a group's points with
                     \`connect\` are a series: the source's rows over steps).
                     Items that share one label are named by their \`group\`.
                     A label and a group are the source's own words, NOT
                     translated in a deck in another language: a table row's
                     name cells ("ResNet-50", "ImageNet") and a condition as its
                     column head and the row's value print it ("Temp 0",
                     "γ=5"); never a value of another column.
                     \`diagonal\` true when both axes are ONE measure under two
                     conditions (α at temp 0 against α at temp 1): both axes
                     share a scale and y = x is drawn, so above or below it is
                     the finding. A results plane names EVERY row the source
                     reports for it (2–16), not a pick; \`figure\` puts the
                     source's own picture of what was measured beside the plot
                     (slot \`scene\`), and \`compare\` the comparison the source
                     itself draws ({ours, rival} item labels): a dashed link
                     and the slot \`delta\` naming the computed {dx} and {dy}.
                     Each axis is ticked;
                     \`curves\` ({label, expr, x, fixed params, checks}) draw a
                     stated formula under the points, grounded by checks the
                     source prints. Curves are not only for images: a
                     systems paper printing S = 1/((1-f)+f/n) with measured
                     speedups for f = 0.9 at n = 2, 4, 8 is a plane, axes
                     [n, S], items the measured rows, curves [{label "f = 0.9",
                     expr "1/((1-f)+f/n)", x "n", fixed [{name "f", value
                     "0.9"}], checks [{inputs [{name "n", value "2"}, {name
                     "f", value "0.9"}], output "1.82"}, {inputs [{name "n",
                     value "8"}, {name "f", value "0.9"}], output "4.71"}]}] —
                     the rule computed over its range and checked against the
                     paper's own numbers. \`measure\` margin: the method against the
                     best OTHER method (\`margins\`: ours, metrics {name,
                     lowerIsBetter}, settings {name, values [{ours, best,
                     rival}]}) — a strip for one metric, a plane for two.
                     \`measure\` length: reported quantities as AREAS to scale,
                     never bars (\`lengths\`: groups {label, unit, items}): whole
                     counts up to 100 as that many unit cells, other values as
                     squares; \`tile\` prints the quotient of the largest by the
                     smallest, only where the source states that ratio. \`form\`
                     combos: experiments not run as empty cells (\`combos\`:
                     components, reported {with, result}, settings {name,
                     value}, others). \`form\` sets: what was and was not
                     evaluated (\`sets\`: rings {label, items}, most evidence
                     first).`,
    slots: {
      caption: { what: "under the scene: what the positions are", optional: true },
      scene: {
        what: "title over the `figure` beside the plot: what was measured (required with `figure`)",
        optional: true,
      },
      delta: {
        what: "on the `compare` link: how `ours` differs from `rival`, naming the computed gaps; required with `compare`",
        optional: true,
        vars: ["dx", "dy"],
      },
      better: {
        what: "plane or strip: the word for 'better', drawn with an arrow down an axis where lower is better (axes run low to high)",
        optional: true,
      },
      ahead: { what: "margin only: where the method leads on every metric", optional: true },
      behind: { what: "margin only: where it trails on every metric", optional: true },
      zero: {
        what: "margin only: on the zero line(s), level with the best other method",
        optional: true,
      },
      scaled: {
        what: "margin only: says each axis is scaled to its own largest margin",
        optional: true,
      },
      on: { what: "combos only: beside a component kept", optional: true },
      off: { what: "combos only: beside a component removed", optional: true },
      missing: { what: "combos only: beside the mark of an empty square", optional: true },
      tested: {
        what: "combos only: title of the settings, each tested at one value",
        optional: true,
      },
    },
  },
  region: {
    doc: `the things in a picture that the source says matter,
                     picked out: the picture large with a numbered box on each
                     thing, beside it the numbered list of what each one means
                     (\`marks\`, 1–5, in the order spoken: \`thing\` is what
                     to find in the picture, plainly — "the stop sign", "the
                     orange barrel at the right edge of the road" — and \`text\`
                     is the source's point about it in the deck's language), then
                     the \`outcome\` the source draws from them (\`title\` and
                     1–3 \`lines\`, e.g. a model's decision). The boxes are
                     found in the picture by \`plan\`, never guessed: leave
                     \`box\` out. \`picture\` is the beat that cites the
                     figure; \`panel\` is which of its panels (1 = first,
                     reading order) when the figure has several — required then.
                     A worked example printed in a figure is an \`evolve\`
                     trace, not a region.`,
    slots: {
      legend: {
        what: "under the picture: whose example it is and what its own colours or marks mean",
        optional: true,
      },
      caption: { what: "under the scene: what is picked out", optional: true },
      example: EXAMPLE_SLOT,
    },
  },
  recap: {
    doc: `the layers the deck's earlier literal scenes computed, in order:
                     each a tile, the one being spoken also large, then the
                     \`result\` in its place. Takes \`beats\` (earlier operate,
                     evolve, region or flow-with-show beats, or a prior-work
                     with a \`from\` lane).`,
    slots: {
      caption: { what: 'one word per tile, joined by "→"', optional: true },
      result: { what: "what the source reports came of it, in its own numbers", optional: true },
    },
  },
  "prior-work": {
    doc: `earlier approaches by what they do, one lane per family (2–4),
                     lit in spoken order: \`family\`, \`members\` (the source's
                     names, separated by ·), \`gap\` (where the source says it
                     runs out), and either \`numbers\` ({label, value}) the
                     source reports beside a member, or \`from\` an earlier
                     operate or evolve beat whose computed layer IS what the
                     family does: the family or members name that operation,
                     and the source names each member beside it. A learned
                     family is shown only by its numbers. EVERY lane needs one
                     or the other: when the source only names the families
                     (a related-work section with no numbers and no earlier
                     scene), do not use prior-work — leave \`literal\` null.`,
    slots: {
      reported: {
        what: "over a numbers lane: these are the source's reported values (required with numbers)",
        optional: true,
      },
      example: {
        what: "on a `from` lane computed on example material: it is an example (example · 예시 · 例 · 示例)",
        optional: true,
      },
      caption: { what: "under the lanes: what this is", optional: true },
    },
  },
  table: {
    doc: `numbers or claims the source reports, as a quiet table; rows lit
                     in the order they are spoken (\`highlight\`, row indexes
                     from 0), \`marks\` ({row, col}) emphasise cells. Every number
                     in a cell is the source's. THE LAST RESORT, at most one a
                     deck. Takes \`columns\`, \`rows\`, \`highlight\`, \`marks\`.`,
    slots: { caption: { what: "under the table: what the numbers are", optional: true } },
  },
};

/** The slots a kind has: its own and the common ones. */
export function literalSlotsOf(
  kind: (typeof LITERAL_KIND_NAMES)[number],
): Readonly<Record<string, LiteralSlot>> {
  return { ...LITERAL_COMMON_SLOTS, ...LITERAL_KIND_DOCS[kind].slots };
}

/**
 * What is wrong with a scene's labels against its kind's slots: a slot the
 * kind does not have (the planner invented it, and it would be dropped
 * silently), a required one missing, a `{name}` the slot does not compute.
 * Empty when they are right.
 */
export function literalSlotProblems(
  kind: (typeof LITERAL_KIND_NAMES)[number],
  labels: ReadonlyArray<{ slot: string; text: string }>,
): string[] {
  const slots = literalSlotsOf(kind);
  const out: string[] = [];
  const given = new Map(labels.map((l) => [l.slot, l.text]));
  for (const [slot, text] of given) {
    const decl = slots[slot];
    if (!decl) {
      out.push(`has no slot "${slot}" (its slots: ${Object.keys(slots).join(", ")})`);
      continue;
    }
    for (const m of text.matchAll(/\{(\w+)\}/g))
      if (!decl.vars?.includes(m[1] as string))
        out.push(
          `slot "${slot}" names {${m[1]}}, which it does not compute${decl.vars?.length ? ` (it computes ${decl.vars.map((v) => `{${v}}`).join(", ")})` : ""}`,
        );
  }
  for (const [slot, decl] of Object.entries(slots))
    if (!decl.optional && !given.get(slot)?.trim()) out.push(`needs slot "${slot}": ${decl.what}`);
  return out;
}

/* ----------------------------------------------------------------- schema */

/** One of a literal scene's few on-screen words, by the slot the scene puts it in. */
const literalLabelSchema = z.object({ slot: z.string(), text: z.string() });
const literalLabels = { labels: z.array(literalLabelSchema).default([]) };

/** A number exactly as the source writes it, with the symbol the source binds it to. */
const numSchema = z.object({ value: z.string(), symbol: z.string().optional() });
/** A named number in a role (an op's `window`, a rule's `a`). */
const paramSchema = z.object({
  name: z.string(),
  value: z.string(),
  symbol: z.string().optional(),
});
/** One case of a formula the source prints: its inputs and its output, as written. */
const checkSchema = z.object({
  inputs: z.array(z.object({ name: z.string(), value: z.string() })),
  output: z.string(),
});

/** One step of an `operate` chain: an op of the library and its grounded parameters. */
const opSchema = z.object({
  op: z.enum(LITERAL_OP_NAMES),
  /** The variant (LITERAL_OPS[op].how). */
  how: z.enum(OP_HOWS).optional(),
  /** threshold: the statistic θ is proportional with. */
  stat: z.enum(["mean", "var", "std"]).optional(),
  /** normalise, threshold, select: over everything, per channel or per row. */
  over: z.enum(["all", "channel", "row"]).optional(),
  params: z.array(paramSchema).default([]),
  /** conv weights or matmul's right-hand matrix, every row as the source prints it. */
  weights: z.array(z.array(z.number())).default([]),
  /** combine and matmul: the outputs combined, by index (0 = the input, k = step k). */
  of: z.array(z.int()).default([]),
  /** formula: the expression. */
  expr: z.string().optional(),
  checks: z.array(checkSchema).default([]),
  /** The step's title, in the deck's language. */
  label: z.string(),
});

/**
 * A beat drawn as the paper's own mechanism acting on real material, instead of
 * a metaphor. ARRAYS, NOT RECORDS: strict structured output sets
 * `additionalProperties: false` on every object, which would forbid every key of
 * a record. NO BOUNDS either (no `min`, no `.int().min(0)`): the backend strips
 * them, so the model cannot see them, and crossing one would fail the parse and
 * discard the whole plan. `literalFindings` (src/plan/coverage.ts) checks them
 * instead, where a miss is sent back for repair.
 */
export const literalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("operate"),
    /** The beat whose picture is the input (example material, always). */
    picture: z.string().optional(),
    /** 1–2 vectors over `bins`, as the source prints them (else example). */
    vectors: z.array(z.object({ label: z.string(), values: z.array(z.number()) })).default([]),
    bins: z.array(z.string()).default([]),
    /** A matrix input, every row as the source prints it (else example). */
    matrix: z.array(z.array(z.number())).default([]),
    /** An example degradation of the input. */
    condition: z
      .object({ how: z.enum(["contrast", "noise", "blur"]), amount: z.number() })
      .optional(),
    chain: z.array(opSchema).default([]),
    /** terms: the source's own equation over them, its TeX exactly as the source prints it. */
    equation: z.string().optional(),
    /** terms: the values the source states, each with what it is (in the deck's language). */
    given: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          symbol: z.string().optional(),
          what: z.string(),
        }),
      )
      .default([]),
    /**
     * A stated formula evaluated term by term on `given`: `term` over k (and the
     * given names), k from `from` to `to` (a number or a given's name), each term a
     * cell; `combine` sum or product; `reported` the source's own number for the
     * result, which the computed one must match.
     */
    terms: z
      .object({
        term: z.string(),
        from: z.int(),
        to: z.string(),
        between: z.string().optional(),
        combine: z.enum(["sum", "product"]),
        reported: z.string().optional(),
      })
      .optional(),
    compare: z.enum(["none", "condition", "params"]).default("none"),
    /** compare params: step `step` (1-based) with these params instead. */
    alt: z
      .object({ step: z.int(), how: z.enum(OP_HOWS).optional(), params: z.array(paramSchema) })
      .optional(),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("evolve"),
    rule: z.enum(["recur", "noise", "formula", "trace", "lanes"]),
    /** lanes: one a row, its runs serial or parallel, as long as its time. */
    lanes: z
      .array(
        z.object({
          label: z.string(),
          total: numSchema.optional(),
          runs: z.array(
            z.object({
              label: z.string(),
              count: numSchema.optional(),
              dur: numSchema.optional(),
              parallel: z.boolean(),
            }),
          ),
        }),
      )
      .default([]),

    /** trace: what each part is, the legend: 1–4 tags, each a tone; `strike` crosses its parts out. */
    tags: z
      .array(
        z.object({
          tag: z.string(),
          label: z.string(),
          tone: z.enum(["a", "b", "c", "d"]),
          strike: z.boolean().default(false),
        }),
      )
      .default([]),
    /** trace: the steps, one row each — `lead` what the row carries on from (muted), then its tagged parts. */
    steps: z
      .array(
        z.object({
          lead: z.string().optional(),
          parts: z.array(z.object({ text: z.string(), tag: z.string() })),
        }),
      )
      .default([]),
    /** Beside the rows, under the legend: the source's facts about the run (the models, a count). */
    note: z.array(z.string()).default([]),
    /** trace from a figure (`picture`): what to read off it; `plan` transcribes the steps (src/plan/locate.ts). */
    read: z.string().optional(),
    /** trace from a figure: which of its panels, 1 = first in reading order. */
    panel: z.int().min(1).optional(),
    /** recur's variant (LITERAL_RULES.recur.how). */
    how: z.enum(["ema", "leaky", "linear"]).optional(),
    params: z.array(paramSchema).default([]),
    reset: z.enum(["none", "soft", "hard"]).default("none"),
    schedule: z.enum(["linear", "cosine"]).optional(),
    /** formula: the next state over `s`, `x` and the params. */
    expr: z.string().optional(),
    checks: z.array(checkSchema).default([]),
    /** noise: the beat whose picture is noised. */
    picture: z.string().optional(),
    input: z
      .object({
        /** Values the source prints, in order. */
        values: z.array(numSchema).default([]),
        /** An earlier operate beat whose computed tiles stream in. */
        from: z.string().optional(),
        stat: z.enum(["mean", "var", "std"]).optional(),
      })
      .optional(),
    phases: z
      .array(z.object({ from: z.int(), label: z.string(), freeze: z.boolean() }))
      .default([]),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("flow"),
    form: z.enum(["chain"]),
    stages: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          learned: z.boolean(),
          /** As the source writes it ("4B", "256×256"), or a stated count ("γ+1") drawn as chips. */
          shape: z.string().optional(),
          /** The token row a model holds, group by group: the chip's text and the count the source states. */
          tokens: z
            .array(
              z.object({
                label: z.string(),
                count: numSchema.optional(),
                /** What the group is, printed with its count under the row. */
                name: z.string().optional(),
                tone: tone.optional(),
              }),
            )
            .default([]),
          /** An earlier verb beat whose computed layer this stage shows. */
          show: z.string().optional(),
          /** The source's own figure, shown unedited. */
          figure: z.string().optional(),
          /** What the stage puts out, in the source's words (a reasoning line). */
          quote: z.string().optional(),
          phase: z.enum(["train", "infer", "both"]).optional(),
        }),
      )
      .default([]),
    edges: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          /** The token group of `from` the wire carries: it takes that group's colour. */
          via: z.string().optional(),
        }),
      )
      .default([]),
    phases: z.boolean().default(false),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("place"),
    form: z.enum(["plane", "strip", "combos", "sets"]),
    measure: z.enum(["value", "margin", "length"]).default("value"),
    axes: z
      .array(
        z.object({ name: z.string(), lowerIsBetter: z.boolean(), log: z.boolean().optional() }),
      )
      .default([]),
    items: z
      .array(
        z.object({ label: z.string(), values: z.array(z.string()), group: z.string().optional() }),
      )
      .default([]),
    connect: z.boolean().default(false),
    /** plane or strip: the source's own figure of what was measured, beside the plot. */
    figure: z.string().optional(),
    /** plane: the comparison the source itself draws, two items by label: a dashed link and the computed deltas. */
    compare: z.object({ ours: z.string(), rival: z.string() }).optional(),
    /** plane: both axes are one measure under two conditions; draws y = x on one scale. */
    diagonal: z.boolean().default(false),
    reveal: z.enum(["items", "groups"]).default("items"),
    curves: z
      .array(
        z.object({
          label: z.string(),
          expr: z.string(),
          /** The variable along the x axis. */
          x: z.string(),
          fixed: z.array(paramSchema).default([]),
          checks: z.array(checkSchema).default([]),
        }),
      )
      .default([]),
    margins: z
      .object({
        ours: z.string(),
        metrics: z.array(z.object({ name: z.string(), lowerIsBetter: z.boolean() })),
        settings: z.array(
          z.object({
            name: z.string(),
            values: z.array(z.object({ ours: z.string(), best: z.string(), rival: z.string() })),
          }),
        ),
      })
      .optional(),
    lengths: z
      .object({
        groups: z.array(
          z.object({
            label: z.string(),
            unit: z.string(),
            items: z.array(z.object({ label: z.string(), value: z.string() })),
          }),
        ),
        tile: z.boolean().default(false),
      })
      .optional(),
    combos: z
      .object({
        components: z.array(z.string()),
        reported: z.array(z.object({ with: z.array(z.string()), result: z.string() })).default([]),
        settings: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
        others: z.array(z.string()).default([]),
      })
      .optional(),
    sets: z
      .object({ rings: z.array(z.object({ label: z.string(), items: z.array(z.string()) })) })
      .optional(),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("region"),
    picture: z.string(),
    /** Which panel of the picture's figure, 1 = first in reading order (`findPanels`); absent = all of it. */
    panel: z.int().min(1).optional(),
    marks: z
      .array(
        z.object({
          /** What to find in the picture, plainly: the locator reads it. */
          thing: z.string(),
          /** The source's point about it, in the deck's language. */
          text: z.string(),
          /** Where it is, as fractions of the panel: found by `plan` (src/plan/locate.ts), not planned. */
          box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
        }),
      )
      .default([]),
    /** What the source concludes from the marked things: a decision, a verdict. */
    outcome: z.object({ title: z.string(), lines: z.array(z.string()) }).optional(),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("recap"),
    /** Earlier literal beats whose computed layers come back, in order. */
    beats: z.array(z.string()),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("prior-work"),
    lanes: z.array(
      z.object({
        family: z.string(),
        members: z.string(),
        /** The source's reported values for the members, exactly as written. */
        numbers: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
        /** An earlier verb beat whose computed layer shows what the family does. */
        from: z.string().optional(),
        /** Where the source says the family runs out. */
        gap: z.string(),
      }),
    ),
    ...literalLabels,
  }),
  z.object({
    kind: z.literal("table"),
    /** Every cell holding a number holds one the source states (src/plan/coverage.ts). */
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    /**
     * Rows lit in the order they are spoken, by index into `rows`. With more
     * entries than narration cues, they are spread over the cues in order.
     */
    highlight: z.array(z.int()).default([]),
    /** Cells that win or matter (a best value, a missing result), emphasised when their row is lit. */
    marks: z.array(z.object({ row: z.int(), col: z.int() })).default([]),
    ...literalLabels,
  }),
]);

const beatCore = {
  id: z.string(),
  /** What the viewer should understand after this beat. */
  intent: z.string(),
  /**
   * OPTIONAL, and only ever present when `prefs.genre` is `paper`. The
   * structural job this beat does; see `beatRoleSchema`.
   */
  role: beatRoleSchema.optional(),
  /** Optional: this beat happens inside a named part of the beat before it. */
  inside: insideSchema.optional(),
  /** The source sentence or equation this beat is accountable to. */
  claim: z.string().optional(),
  evidence: z.array(refSchema).default([]),
  /** Salience, 0–1. Decides what survives a 30-second cut. */
  weight: z.number().min(0).max(1).default(0.5),
  /** Seconds this beat holds in a linear render. Deck mode is human-paced. */
  seconds: z.number().positive().max(60).default(7),
  /**
   * OPTIONAL, and only read by `build --design v2 --bespoke`: the planner's hint
   * that this beat explains a mechanism worth a generated scene (`true`), or
   * must keep its archetype (`false`). A hint, not an order — see
   * src/bespoke/select.ts. Hidden from the planner's schema unless the plan was
   * asked for with `--bespoke`, so every other plan is byte-for-byte unchanged.
   */
  bespoke: z.boolean().optional(),
  /** OPTIONAL: the part of the source this beat covers. See `beatPartSchema`. */
  part: beatPartSchema.optional(),
  /**
   * OPTIONAL: the ONE thing the viewer can explain after this beat, as a
   * sentence a judge watching only the frames can check. Narrower than
   * `intent`: not what the beat is about, but what it leaves the viewer able
   * to say. Shown to the planner when the build draws scenes (v2).
   */
  takeaway: z.string().optional(),
  /** OPTIONAL: draw this beat as its mechanism (src/literal/). See `literalSchema`. */
  literal: literalSchema.optional(),
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
    archetype: z.literal("equation-morph"),
    params: equationMorphParamsSchema,
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
  z.object({ ...beatCore, archetype: z.literal("stage"), params: stageParamsSchema, ...beatTail }),
  z.object({
    ...beatCore,
    archetype: z.literal("hero-number"),
    params: heroNumberParamsSchema,
    ...beatTail,
  }),
  z.object({
    ...beatCore,
    archetype: z.literal("kinetic"),
    params: kineticParamsSchema,
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
  "equation-morph",
  "line-chart",
  "stage",
  // A magnitude, drawn and measured against its baseline. `kinetic` is not
  // here: moving type is still a sentence, however it arrives.
  "hero-number",
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
  // Same reason as claim-figure: the picture illustrates what the beat says.
  stage: "frame",
  // A claim, however it moves.
  kinetic: "frame",
  callout: "frame",
  "hero-number": "quantity",
  pipeline: "structure",
  grid: "structure",
  stack: "structure",
  "split-compare": "structure",
  "annotated-figure": "structure",
  "bar-compare": "quantity",
  "line-chart": "quantity",
  "data-table": "quantity",
  "equation-walk": "formal",
  "equation-morph": "formal",
};

/**
 * Which generation of the look a deck is built in.
 *
 * `classic` is every deck built before 0.9 and stays byte-identical: it is what
 * an unset design means, so an npm user and every ink golden see no change. `v2`
 * opts into the redesign: the v2 player in deck.html (speed, CC, caption size,
 * remembered preferences — src/deck/playback.ts), the fit engine
 * (src/emit/fit.ts), a style pack per deck (src/emit/themes/pick.ts), varied
 * layouts (src/plan/direct.ts) and the motion grammar (src/emit/motion.ts). One
 * switch rather than one flag per feature, so a deck is always one coherent
 * design and `--design classic` is a complete rollback.
 *
 * OPTIONAL rather than defaulted in both schemas, so a storyboard, a config or
 * a pack that never mentions it serialises exactly as it did.
 */
export const designSchema = z.enum(["classic", "v2"]);
export type Design = z.infer<typeof designSchema>;

export const storyboardSchema = z
  .object({
    sourceId: z.string(),
    title: z.string(),
    lang: z.string().default("en"),
    theme: z.string().default("ink"),
    /**
     * The design this storyboard asks to be built in. OPTIONAL with no default,
     * so a stored storyboard parses to exactly the object it did before this
     * field existed and nothing hashed from it moves. `--design` on `build`
     * overrides it; absent everywhere means `classic`.
     */
    design: designSchema.optional(),
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
   * What kind of document is being explained, DECLARED and never sniffed.
   *
   * `paper` asks the planner for the shape a research talk has: open on the
   * problem and the ground the work stands on, close on what it does not do and
   * then what to take away. `general` is every deck built before this existed
   * and changes nothing — no prompt block, no `role` in the planner's schema, no
   * scan.
   *
   * WHY DECLARED. A ten-role heading lexicon (en/ko/ja/zh, numbered-prefix
   * tolerant) run over all 351 markdown files in this repository scored 345 of
   * them at zero role hits and none at three or more. `src/source/markdown.ts`
   * says why in its first line: the input is a hypepaper-style ANALYSIS of a
   * paper, a rewrite that has already discarded the headings a detector would
   * key on. A classifier here would be a guess with a confidence score attached,
   * and it would guess wrong on the Korean fixture. So the author says so once —
   * `--genre paper`, or one line in a `decksmith.config.json` above a directory
   * of papers — and every run under it costs no further typing.
   */
  genre: z.enum(["general", "paper"]).default("general"),
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
   * Which generation of the look to emit (see `designSchema`). Unset means the
   * storyboard's own, else `classic` — v0.8.0, byte for byte, so an npm user's
   * decks do not change under them. `v2` turns on the redesign: the player, the
   * fit engine, a style pack per deck (`src/emit/themes/pick.ts`), layouts and
   * motion.
   */
  design: designSchema.optional(),
  /**
   * What `--design v2` hashes to pick a pack. Absent means the storyboard's
   * `sourceId`. A caller with one paper in several languages passes the paper's
   * id here so every language wears the same pack.
   */
  packSeed: z.string().optional(),
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
       *
       * TEN, so a fourteen-beat deck can be mostly scenes (`SCENE_SHARE` in
       * src/plan/variety.ts): at four, three stages spent the cap and every
       * diagram was cards on the pack's ground.
       */
      max: z.int().min(0).default(10),
    })
    // Same reason as `narration`: the resolved shape, spelled once, so an omitted
    // block reads fully populated and a `.deck` manifest carries every field.
    .default({ enabled: false, provider: "codex", style: "flat vector illustration", max: 10 }),

  /* --- bespoke scenes --- */
  /**
   * `--design v2` only: every beat drawn by a model-written GSAP+SVG scene, the
   * archetype only where a scene fails its gates (src/bespoke/). ON UNDER V2
   * UNLESS `enabled` IS false (`--no-bespoke`) — `bespokeFor` (src/prefs.ts)
   * decides. The block is still OPTIONAL WITH NO DEFAULT,
   * unlike the two blocks above, and that is deliberate: a resolved prefs
   * object travels into `.deck` manifests, and a defaulted block would move the
   * bytes of every pack built without it.
   */
  bespoke: z
    .object({
      /** Absent: on under v2. `false` (`--no-bespoke`) keeps every archetype. */
      enabled: z.boolean().optional(),
      /**
       * Hard cap on scene calls for one deck: a draft and at most one critique
       * per beat, so 40 pays for a 14-beat deck with room to spare. The device
       * call and the pictures are counted apart.
       */
      maxCalls: z.int().min(0).max(80).default(40),
      /**
       * Hard cap on the bespoke pass's wall time, seconds. A 14-beat deck at two
       * calls in flight is ~14 pictures-or-not, 14 drafts at 135-371s each and
       * up to 14 critiques: an hour is the budget, and what is left falls back.
       */
      maxSeconds: z.int().min(60).max(14400).default(3600),
      /**
       * One scene call's ceiling, seconds: the per-scene timeout. MEASURED
       * 2026-10-08..09 at medium effort, tools off: drafts 135-371s, critiques
       * ~100-300s. A call past this is killed and its beat keeps its draft or
       * its archetype.
       */
      callSeconds: z.int().min(60).max(1800).default(600),
      /** Passed to `codex exec --model`. Absent: whatever the account is configured for. */
      model: z.string().optional(),
      /** The Codex CLI to run. Absent: `codex` on PATH. */
      cli: z.string().optional(),
      /** Where generated scenes are cached. Absent: the user cache directory. */
      cache: z.string().optional(),
      /**
       * Codex calls in flight at once — pictures, the device call and scenes
       * alike. Two: every beat is drawn now, and each call is a Codex process on
       * a machine that measured 8-23% memory free through this work; five in
       * flight was measured faster (2026-10-08) for a five-beat deck only.
       */
      concurrency: z.int().min(1).max(8).default(2),
      /**
       * `model_reasoning_effort` for the bespoke calls. MEASURED 2026-10-08, one
       * draft prompt, tools off: medium 166s and 24k tokens, high 371s and 50k.
       * The references and the gates carry the look; the extra reasoning bought
       * time. Absent from a config file means medium; "default" leaves the
       * account's own setting.
       */
      effort: z.enum(["low", "medium", "high", "default"]).default("medium"),
      /**
       * Illustrations per deck: each bespoke beat may first have ONE picture
       * drawn by the same account's image tool (src/bespoke/art.ts), which its
       * scene is built around. 0 turns them off. Counted apart from `maxCalls`:
       * MEASURED 2026-10-09, one picture is 36-49s and 19-25k tokens.
       */
      art: z.int().min(0).max(6).default(6),
    })
    .optional(),
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

/**
 * The canvas a narration's sentences were split against. Recorded so a refusal
 * can say where the narration was staged and which `narrate` flags stage it
 * where the build is; it is NOT what is compared. See `assertNarrationStaging`
 * in src/narrate/narrate.ts.
 */
export const narrationCanvasSchema = z.object({
  format: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  captionReserve: z.number().min(0),
});

export type NarrationCanvas = z.infer<typeof narrationCanvasSchema>;

export const narrationSchema = z.object({
  voice: z.string(),
  /**
   * `canvas`, `stops` and `speakingStops` are what `narrate` split the sentences
   * over. All three are optional because every `narration.json` and every pack
   * written before they were recorded has none of them; a build accepts such a
   * file unchecked, and the CLI says so.
   */
  canvas: narrationCanvasSchema.optional(),
  /**
   * The stop count the emitter staged for each narrated beat, before the density
   * cap, keyed by beat id.
   *
   * THIS is what a build compares, not the canvas. MEASURED 2026-09-18: the
   * canvas is a proxy that is wrong both ways. Narration made at `deck-16x9` was
   * refused at `short-9x16` and with `--reserve-captions`, where not one demo
   * beat that draws changes its stop count and the built files were
   * byte-identical to a matched build. And a `lang: "ko"` callout narrated and
   * built at the same 1380×776 was one stop in `narrate` and four in the build,
   * because `narrate` staged with another font face.
   */
  stops: z.record(z.string(), z.number().int().positive()).optional(),
  /**
   * The narration density's cap on how many of a beat's stops speak. Absent
   * when every stop may, which is `density: "high"`: JSON has no Infinity.
   */
  speakingStops: z.number().int().positive().optional(),
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
  /**
   * Canvas px of the bottom of the frame reserved for a burned-in caption, which
   * the drawable box gives up. 0 — the default — means nothing is reserved.
   *
   * ON `Format` AND NOT ON `DeckOptions`, because it changes the drawable box,
   * and the drawable box is what a format IS. Two decks built from one
   * storyboard, one reserving and one not, are different formats in every sense
   * that matters downstream: different `contentH`, different archetype layouts,
   * different type sizes. `id` is left alone — the profile's pacing, budget and
   * navigability are unchanged — but `writeTiming` records the number so
   * `render` can refuse to burn over a deck that never made room. See the
   * design note above `RenderOptions` in src/render/render.ts.
   *
   * Optional in the TYPE for the same reason as `maxSeconds`: every test fixture
   * that needs a canvas would otherwise have to invent a reserve it does not
   * care about, and absent must read as "reserved nothing", which is the state
   * every deck built before this existed is actually in.
   */
  captionReserve?: number;
}

/* ------------------------------------------------- The burned caption's box */

/**
 * THE ONE SOURCE FOR THE BAND'S BOX, because a second copy of these ratios is
 * exactly how the collision came back.
 *
 * These live in `types.ts` rather than beside `burnStyle` (src/render/ffmpeg.ts)
 * for a layering reason that is not negotiable: `src/emit` may not import
 * `src/render` — the dependency runs the other way, `src/render/timing.ts`
 * imports four things out of `src/emit`. The emitter is the side that has to
 * shrink its drawable box, so the numbers have to sit where BOTH can reach
 * them, and `Format` is already here.
 *
 * `burnStyle` reads these; it does not restate them.
 */
export const CAPTION_FONT_RATIO = 0.037;
export const CAPTION_MARGIN_V_RATIO = 0.09;
export const CAPTION_MARGIN_X_RATIO = 0.04;
/** The `--line` default `captionPage` writes, as a multiple of the font size. */
export const CAPTION_LINE_RATIO = 1.6;
/**
 * Two, and it is bounded rather than hoped for: `splitCue` caps a cue at 84
 * characters and `wrap` breaks it near the middle, and `burnStyle`'s font size
 * is chosen so the longer half still fits one line with 9% to spare. A third
 * line is the failure that sizing exists to prevent, so reserving for two is
 * reserving for the worst case that can actually occur.
 */
export const CAPTION_MAX_LINES = 2;

/**
 * The burned caption's size, reference px: `TYPE_SCALE.caption` in
 * src/emit/type.ts, restated here because this file may import nothing from
 * `src/emit`. A quiet lower third, the founder's ask on 2026-10-10: 4% of a
 * 1920 canvas was a 71px caption, larger than the slide's own headline.
 */
export const CAPTION_FONT_PX = 40;

/**
 * The burned band's font size at this canvas width: `CAPTION_FONT_RATIO` of it,
 * never more than `CAPTION_FONT_PX` — which is what every format's ratio
 * already gave at its 1080px side, and now also holds at 1920.
 */
export function captionFontSize(width: number): number {
  return Math.min(CAPTION_FONT_PX, Math.round(width * CAPTION_FONT_RATIO));
}

/**
 * The bottom strip the burned caption may occupy, `marginV` included, in CANVAS
 * px — everything `src/emit` must therefore keep its ink out of.
 *
 * AN UPPER BOUND, DELIBERATELY, and derived from the CSS rather than from a
 * browser. `captionPage` declares `line-height: round(F * 1.6)` and the real
 * painted line box is whatever the font actually produces, which is smaller: at
 * 1080x1920 this returns **301px** against the **293px** measured off two
 * rendered frames in `.planning/EXPERIMENT-010-reconcile.md`. Eight px of slack,
 * on the safe side. A bound that needed a browser to compute could not be read
 * by the emitter at all, which is the whole reason the collision survived this
 * long — the band's height was only known after layout, an hour too late.
 *
 * Under-reserving reintroduces the defect silently, so if these two ever have to
 * disagree, this one is the one that must be larger.
 */
export function bandReserve(width: number, height: number): number {
  const line = Math.round(captionFontSize(width) * CAPTION_LINE_RATIO);
  return Math.round(height * CAPTION_MARGIN_V_RATIO) + CAPTION_MAX_LINES * line;
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
 *
 * LAST CHECKED 2026-09-17, against each platform's own pages where they would
 * load. And it happened again: FACEBOOK REELS IS GONE, because its 90 was stale
 * the same way Instagram's once was. Meta's newsroom, 2025-06-17: "Reels on
 * Facebook will also not have any length or format restrictions." By the rule
 * above a platform that takes anything adds nothing but slack — and the 90 was
 * not harmless slack, it was the tightest entry, so it made `near_budget` tell
 * every short between 1m30s and 3m00s that it was "not postable everywhere",
 * naming a destination that would have taken it. The 90 had been flagged in
 * EXPERIMENT-010 as "from memory, not the network" for months before anyone
 * looked.
 *
 * Note what each remaining number MEANS, because they are not the same thing:
 *
 * - YouTube Shorts, 180 — a CLASSIFICATION limit. A vertical or square upload of
 *   three minutes or less is a Short; longer is long-form, off the Shorts feed.
 *   YouTube Help, "Understand three-minute YouTube Shorts".
 * - Instagram Reels, 180 — a DISTRIBUTION limit, not an upload cap. Uploads run
 *   longer, but "we recommend videos to unconnected audiences that are 3 minutes
 *   or less" (Instagram for Creators, FAQ). For a short, reaching people who do
 *   not follow you is the point, so this is the limit that constrains it.
 * - X, standard account, 140 — NOT verified at source: X's help centre refused
 *   the fetch. Every secondary source agrees and it has not moved in years.
 */
export const DESTINATIONS: Readonly<Record<PresetId, readonly Destination[]>> = {
  // A presented deck is paced by the person clicking through it, and long-form
  // video has no ceiling worth encoding. An empty list is "unbudgeted", stated.
  "deck-16x9": [],
  "video-16x9": [],
  "short-9x16": [
    { name: "YouTube Shorts", maxSeconds: 180 },
    { name: "Instagram Reels", maxSeconds: 180 },
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
export type Backdrop = z.infer<typeof backdropSchema>;
/** The `images` block of the preferences, resolved. What `illustrate` reads. */
export type ImagesPrefs = z.infer<typeof prefsSchema>["images"];
export type Beat = z.infer<typeof beatSchema>;
export type BeatRole = z.infer<typeof beatRoleSchema>;
export type BeatPart = z.infer<typeof beatPartSchema>;
export type Literal = z.infer<typeof literalSchema>;
export type LiteralKind = Literal["kind"];

/** The source figures a literal scene shows unedited: a flow stage's, a place's `figure`. */
export function literalFigures(lit: Literal): string[] {
  if (lit.kind === "flow") return lit.stages.flatMap((s) => (s.figure ? [s.figure] : []));
  if (lit.kind === "place" && lit.figure) return [lit.figure];
  return [];
}
export type Inside = z.infer<typeof insideSchema>;
export type Archetype = Beat["archetype"];
export type Storyboard = z.infer<typeof storyboardSchema>;

/** Narrow a beat to one archetype — the emitters' entry point. */
export type BeatOf<A extends Archetype> = Extract<Beat, { archetype: A }>;

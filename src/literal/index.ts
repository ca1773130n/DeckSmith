/**
 * LITERAL SCENES (prototype): a beat drawn as the paper's own mechanism acting
 * on real material from its domain, instead of a metaphor device.
 *
 * WHY THIS EXISTS. The bespoke pass asks Codex for a unique *metaphor* per beat
 * (`devicePrompt`), so "weak features are suppressed" came back as a red gate
 * in a canyon. A viewer watching it learns nothing about spikes. Here the beat
 * names a mechanism (`kind`) and the one thing the viewer must be able to
 * explain afterwards (`takeaway`); the build computes the mechanism's real
 * intermediate layers from the deck's own picture, and the scene shows them
 * changing one causal step at a time, on the narration's cues.
 *
 * EVERY LAYER IS COMPUTED AT BUILD TIME, deterministically (invariant 4): the
 * picture is decoded through ffmpeg (already `render`'s dependency), the maths
 * is plain TypeScript, and the layers are written back as files under
 * `assets/literal/`. Nothing here runs in the page but tweens.
 *
 * WHAT IS EXACT AND WHAT IS ILLUSTRATIVE is stated in each kind's own module
 * (src/literal/kinds/<name>.ts); the kinds are listed in `registry.ts` and
 * share the contract in `kind.ts` and the raster maths in `kit.ts`.
 *
 * The emitted fragment goes through the same shell as a Codex-written scene
 * (`bespokeScene`): the deck keeps its chrome, holds and handoffs.
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Fragment } from "../bespoke/contract.js";
import { type BespokeEntry, type BespokeMap, bespokeRegion } from "../bespoke/scene.js";
import {
  bespokeStaging,
  type DeckNarration,
  emitComposition,
  planCut,
} from "../emit/composition.js";
import type { EmitContext, Theme } from "../emit/kit.js";
import { deckLook } from "../emit/theme.js";
import { planTiming, type Timing } from "../render/timing.js";
import {
  type Beat,
  type Format,
  LITERAL_KIND_NAMES,
  type LiteralKind,
  literalSlotProblems,
  type Source,
  type Storyboard,
} from "../types.js";
import { type Cue, type Layers, round3 } from "./kit.js";
import { KINDS } from "./registry.js";

/* ------------------------------------------------------------------ the plan */

const specSchema = z.object({
  kind: z.enum(LITERAL_KIND_NAMES),
  /** The one thing the viewer can explain after this scene. Judged against. */
  takeaway: z.string().min(1),
  /** The scene's few words, in the deck's language, by slot. */
  labels: z.record(z.string(), z.string()).default({}),
  /** This scene's picture, relative to the plan file; absent means the plan's `image`. */
  image: z.string().min(1).optional(),
  /** A data kind's own content (table rows, scale values, recap beats): the storyboard's `literal`. */
  data: z.unknown().optional(),
});
export type LiteralSpec = z.infer<typeof specSchema> & { kind: LiteralKind };

/**
 * What the pass draws, by beat. Built from the storyboard's own `literal` beats
 * (`literalPlanOf`), or read from a prototype side file of this shape.
 */
export const literalPlanSchema = z.object({
  /** The domain picture every layer is computed from, relative to the plan file. */
  image: z.string().min(1).optional(),
  beats: z.record(z.string(), specSchema),
});
export type LiteralPlan = z.infer<typeof literalPlanSchema>;

/** The figure a beat shows: its own, a split-compare side's, or its backdrop's. */
function figureOf(beat: Beat): string | undefined {
  const p = beat.params as Record<string, unknown>;
  for (const slot of [p, p.left, p.right, p.backdrop]) {
    const id = (slot as { figureId?: unknown } | undefined)?.figureId;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * The plan the storyboard carries: every beat with a `literal`, its takeaway,
 * its labels, and the file its `picture` beat's figure lives in (under
 * `assetsDir`, the source's `assets/`). Fails loudly on a picture that does
 * not resolve: a scene computed from no picture is no scene.
 */
export function literalPlanOf(
  storyboard: Storyboard,
  source: Source,
  assetsDir: string,
): LiteralPlan {
  const byId = new Map(storyboard.beats.map((b) => [b.id, b]));
  const figures = new Map(source.figures.map((f) => [f.id, f]));
  const beats: LiteralPlan["beats"] = {};
  for (const beat of storyboard.beats) {
    const lit = beat.literal;
    if (!lit) continue;
    let image: string | undefined;
    // A picture kind always names one; attention and splatting may (patches, a plane of pixels).
    if ("picture" in lit && lit.picture) {
      const owner = byId.get(lit.picture);
      const fig = owner && figures.get(figureOf(owner) ?? "");
      if (!fig)
        throw new Error(
          `literal: ${beat.id} runs on the picture of "${lit.picture}", which has no figure in the source. Run \`decksmith illustrate\` first, or fix \`picture\`.`,
        );
      image = resolve(assetsDir, fig.src);
    }
    beats[beat.id] = {
      kind: lit.kind,
      takeaway: beat.takeaway?.trim() || beat.intent,
      labels: Object.fromEntries(lit.labels.map((l) => [l.slot, l.text])),
      ...(image ? { image } : {}),
      // The literal itself, for a data kind, and for one that reads both a picture and its data
      // (attention, splatting: `picture: false`, a picture optional).
      ...(image && KINDS[lit.kind].picture ? {} : { data: lit }),
    };
  }
  return { beats };
}

/** Where the computed layers live in a deck. */
export const LITERAL_DIR = "assets/literal";

/** One literal scene's fragment, in token form, from its computed layers. */
export function literalFragment(
  kind: LiteralKind,
  layers: Layers,
  region: { width: number; height: number },
  cues: readonly Cue[],
  spec: LiteralSpec,
  theme: Theme,
): Fragment {
  const href = (f: string) => `${LITERAL_DIR}/${f}`;
  return KINDS[kind].fragment(layers, region, cues, spec, theme, href);
}

/* -------------------------------------------------------------------- the pass */

/**
 * A scene's narration as its SENTENCES — one cue per sentence spoken, from its
 * first subtitle line to its last — on the scene's clock. Not the subtitle
 * lines: the voice splits a long sentence into two lines, and a scene timed on
 * lines took one causal step per half-sentence (r1, b17: the second row lit in
 * the middle of the first row's sentence). Not the stops either: a stage beat
 * speaks several sentences in one stop, and each is still a step.
 */
export function sentenceCues(timing: Pick<Timing, "scenes" | "segments">, sid: string): Cue[] {
  const scene = timing.scenes.find((s) => s.id === sid);
  if (!scene) return [];
  const out: Cue[] = [];
  for (const g of timing.segments) {
    if (g.scene !== sid) continue;
    let open: number | undefined;
    g.cues.forEach((c, i) => {
      open ??= c.start;
      const ends = /[.!?。！？]["'”’)\]]*$/.test(c.text.trim()) || i === g.cues.length - 1;
      if (!ends) return;
      out.push({
        t0: round3(g.start + open - scene.start),
        t1: round3(g.start + c.end - scene.start),
      });
      open = undefined;
    });
  }
  return out.filter((c) => c.t1 > c.t0).sort((a, b) => a.t0 - b.t0);
}

export interface LiteralInput {
  storyboard: Storyboard;
  source: Source;
  format: Format;
  narration: DeckNarration;
  theme: string;
  plan: LiteralPlan;
  /** Directory the plan's `image` is relative to. */
  planDir: string;
  /** The deck directory: layers go under `<out>/assets/literal/`. */
  out: string;
  onStep?: (m: string) => void;
}

export interface LiteralReport {
  version: 1;
  scenes: Array<{
    beat: string;
    kind: LiteralKind;
    takeaway: string;
    layers: string[];
    cues: Cue[];
  }>;
}

/**
 * Compute every literal beat's layers and fragment. A beat not in the plan, or
 * one the cut dropped, keeps its archetype.
 */
export async function literalPass(
  input: LiteralInput,
): Promise<{ map: BespokeMap; report: LiteralReport }> {
  const { storyboard, source, format, narration, plan } = input;
  const step = input.onStep ?? (() => {});
  const { theme } = deckLook(storyboard, input.theme);
  const base = {
    theme: input.theme,
    design: "v2" as const,
    narration,
    speed: 1,
    onBeatError: () => {},
  };
  const kept = planCut(storyboard, source, format, base).kept;
  const ctxFor = (sid: string): EmitContext => ({
    source,
    format,
    theme,
    sid,
    start: 0,
    design: "v2",
  });
  // Every kind is drawn (the plan's schema admits no other), so a beat in the plan is picked.
  const picked = kept.filter((b) => plan.beats[b.id] !== undefined);
  const placeholder: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const beat of picked) {
    const { holds } = bespokeStaging(beat, ctxFor("s0"), narration.beats[beat.id] ?? [], 1);
    placeholder[beat.id] = { fragment: { markup: "", css: "", script: "" }, holds };
  }
  // The cue windows, read off the deck as it will be timed (as the bespoke pass does).
  const composition = emitComposition(storyboard, source, format, {
    ...base,
    bespoke: placeholder,
  });
  const timing = planTiming({
    storyboard,
    source,
    format,
    speed: 1,
    composition,
    beats: kept,
    narration,
    theme: input.theme,
    bespoke: placeholder,
  });
  const cuesOf = new Map<string, Cue[]>();
  for (const sc of timing.scenes) {
    const beat = kept[Number(sc.id.slice(1)) - 1];
    if (beat) cuesOf.set(beat.id, sentenceCues(timing, sc.id));
  }
  const dir = join(input.out, LITERAL_DIR);
  await mkdir(dir, { recursive: true });
  const map: Record<string, BespokeEntry> = {};
  const report: LiteralReport = { version: 1, scenes: [] };
  const earlier = new Map<
    string,
    { kind: string; layers: Layers; labels: Record<string, string> }
  >();
  for (const beat of picked as Beat[]) {
    const spec = plan.beats[beat.id] as LiteralSpec;
    // A slot the kind does not read would be dropped silently; a missing one has no default.
    const problems = literalSlotProblems(
      spec.kind,
      Object.entries(spec.labels).map(([slot, text]) => ({ slot, text })),
    );
    if (problems.length)
      throw new Error(`literal: ${beat.id} (${spec.kind}) ${problems.join("; ")}`);
    const eyebrow = spec.labels.eyebrow?.trim() || undefined;
    const region = bespokeRegion(beat, ctxFor("s0"), eyebrow);
    const cues = cuesOf.get(beat.id) ?? [];
    const impl = KINDS[spec.kind];
    const rel = spec.image ?? plan.image;
    if (impl.picture && !rel)
      throw new Error(`literal: ${beat.id} (${spec.kind}) has no picture to compute from`);
    const image = rel ? resolve(input.planDir, rel) : undefined;
    const layers = await impl.layers({
      beatId: beat.id,
      ...(image ? { image } : {}),
      dir,
      region,
      spec,
      earlier,
    });
    earlier.set(beat.id, { kind: spec.kind, layers, labels: spec.labels });
    const fragment = literalFragment(spec.kind, layers, region, cues, spec, theme);
    map[beat.id] = {
      fragment,
      holds: placeholder[beat.id]?.holds ?? [],
      ...(eyebrow ? { eyebrow } : {}),
    };
    report.scenes.push({
      beat: beat.id,
      kind: spec.kind,
      takeaway: spec.takeaway,
      layers: Object.values(layers.files),
      cues,
    });
    step(
      `literal: ${beat.id} ${spec.kind} — ${Object.keys(layers.files).length} layer(s), ${cues.length} cue(s)`,
    );
  }
  return { map, report };
}

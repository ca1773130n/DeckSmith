/**
 * LITERAL SCENES (prototype): a beat drawn as the paper's own mechanism acting
 * on real material from its domain, instead of a metaphor device.
 *
 * WHY THIS EXISTS. The bespoke pass asks Codex for a unique *metaphor* per beat
 * (`devicePrompt`), so "weak features are suppressed" came back as a red gate
 * in a canyon. A viewer watching it learns nothing about the mechanism. Here the beat
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
 * WHAT IS EXACT AND WHAT IS EXAMPLE is stated in each verb's own module
 * (src/literal/kinds/<verb>.ts); the verbs and kinds are listed in
 * `registry.ts`, share the contract in `kind.ts`, the op library in `ops.ts`
 * and the stage they are drawn on in `kinds/stage.ts`. No module knows a
 * paper: a verb's parameters are the source's numbers, grounded by the truth
 * gate (src/plan/coverage.ts).
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
  GENERATED_FIGURE_PREFIX,
  LITERAL_KIND_NAMES,
  type LiteralKind,
  literalSlotProblems,
  type Source,
  type Storyboard,
} from "../types.js";
import { lateReveals, SEEN_WHOLE_S } from "./check.js";
import { figurePanels } from "./kinds/region.js";
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
  /** The storyboard's `literal`: the scene's own content. */
  data: z.unknown().optional(),
  /** The source's own figures a scene may show, by id → absolute file. */
  assets: z.record(z.string(), z.string()).optional(),
  /** The beat's headline: what it names is the scene's subject (`subjectOf`). */
  headline: z.string().optional(),
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
  // The source's own figures (never one `illustrate` drew): what a flow stage may show unedited.
  const own = Object.fromEntries(
    source.figures
      .filter((f) => !f.id.startsWith(GENERATED_FIGURE_PREFIX))
      .map((f) => [f.id, resolve(assetsDir, f.src)]),
  );
  for (const beat of storyboard.beats) {
    const lit = beat.literal;
    if (!lit) continue;
    let image: string | undefined;
    const pic = "picture" in lit ? lit.picture : undefined;
    if (pic) {
      const owner = byId.get(pic);
      const fig = owner && figures.get(figureOf(owner) ?? "");
      if (!fig)
        throw new Error(
          `literal: ${beat.id} runs on the picture of "${pic}", which has no figure in the source. Run \`decksmith illustrate\` first, or fix \`picture\`.`,
        );
      image = resolve(assetsDir, fig.src);
    }
    const shows =
      lit.kind === "flow" ? lit.stages.flatMap((s) => (s.figure ? [s.figure] : [])) : [];
    for (const id of shows)
      if (!own[id])
        throw new Error(
          `literal: ${beat.id} shows figure "${id}", which is not one of the source's own figures`,
        );
    const headline = (beat.params as { headline?: unknown }).headline;
    beats[beat.id] = {
      kind: lit.kind,
      takeaway: beat.takeaway?.trim() || beat.intent,
      ...(typeof headline === "string" && headline.trim() ? { headline } : {}),
      labels: Object.fromEntries(lit.labels.map((l) => [l.slot, l.text])),
      ...(image ? { image } : {}),
      data: lit,
      ...(shows.length
        ? { assets: Object.fromEntries(shows.map((id) => [id, own[id] as string])) }
        : {}),
    };
  }
  return { beats };
}

/**
 * Each of the source's own figures, cut into panels as \`region\` panels cuts it.
 * A figure whose file is missing or unreadable is left out: the build names it.
 */
export async function figurePanelCounts(
  source: Source,
  assetsDir: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const f of source.figures) {
    if (f.id.startsWith(GENERATED_FIGURE_PREFIX)) continue;
    try {
      out[f.id] = await figurePanels(resolve(assetsDir, f.src));
    } catch {
      // Unreadable here is unreadable at build, which fails loudly with the file's name.
    }
  }
  return out;
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
  const f = KINDS[kind].fragment(layers, region, cues, spec, theme, href);
  return { ...f, script: leanThroughStill(f.script, cues) };
}

/** The shortest still stretch inside a sentence a literal scene leans through. */
const LEAN_MIN_SECONDS = 4;
/**
 * A drift of a few px, not a scale: leaning in by 1.02 cut r2's lengths labels
 * at the region's edge (text_clipped), and leaning back by 0.985 drew 40px
 * labels at 39.4px, under the floor (r3 C s8, apparent_type_floor).
 */
const LEAN_Y = -6;

/**
 * A scene's script with a slow lean of the whole scene through each still stretch
 * of a sentence: back, and forward to rest before the next sentence starts or the
 * next tween runs, so every hold (a sentence's start) sees the layout as drawn.
 *
 * A kind times its steps on the sentences, but a step is one reveal and a sentence
 * runs 7-9s: r2's results table stood 6.4s after each row lit, and a lengths scene
 * with two groups over four sentences stood 12s across its last two. The kinds
 * that lean their own camera (`drift`) leave no stretch for this to find.
 *
 * Reads the script it is given — every line is `Tl`'s `tl.fromTo(..., {to}, at);`
 * with a JSON `to` — and a line it cannot read counts as busy for 1s, so an
 * unfamiliar line can only make the lean shorter, never overlap a tween.
 */
export function leanThroughStill(script: string, cues: readonly Cue[]): string {
  const first = cues[0];
  const last = cues[cues.length - 1];
  if (!first || !last) return script;
  const busy: Array<[number, number]> = [];
  for (const line of script.split("\n")) {
    const m = /, (\{[^{}]*\}), (-?\d+(?:\.\d+)?)\);\s*$/.exec(line);
    if (!m) continue;
    let dur = 1;
    try {
      const d = (JSON.parse(m[1] as string) as { duration?: unknown }).duration;
      if (typeof d === "number") dur = d;
    } catch {
      // Not Tl's JSON: counted busy for 1s, which only shortens a lean.
    }
    const at = Number(m[2]);
    busy.push([at, at + dur]);
  }
  // Each sentence on its own: a lean never crosses a sentence's start, where a hold is.
  const out: string[] = [];
  cues.forEach((c, k) => {
    const end = cues[k + 1]?.t0 ?? last.t1;
    let t = c.t0;
    const marks = busy.filter(([a, b]) => b > c.t0 && a < end).sort((x, y) => x[0] - y[0]);
    const gaps: Array<[number, number]> = [];
    for (const [a, b] of marks) {
      if (a > t) gaps.push([t, a]);
      t = Math.max(t, b);
    }
    if (end > t) gaps.push([t, end]);
    for (const [g0, g1] of gaps) {
      const t0 = round3(g0 + 0.15);
      const t1 = round3(g1 - 0.15);
      if (t1 - t0 < LEAN_MIN_SECONDS) continue;
      const half = round3((t1 - t0 - 0.05) / 2);
      const lean = JSON.stringify({ y: LEAN_Y });
      const rest = JSON.stringify({ y: 0 });
      out.push(
        `tl.fromTo("#SCENEID-lit", ${rest}, ${JSON.stringify({ y: LEAN_Y, duration: half, ease: "sine.inOut", immediateRender: false })}, ${t0});`,
        `tl.fromTo("#SCENEID-lit", ${lean}, ${JSON.stringify({ y: 0, duration: half, ease: "sine.inOut", immediateRender: false })}, ${round3(t0 + half + 0.05)});`,
      );
    }
  });
  return out.length ? `${script}\n${out.join("\n")}` : script;
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
    let first = true;
    g.cues.forEach((c, i) => {
      open ??= c.start;
      const ends = /[.!?。！？]["'”’)\]]*$/.test(c.text.trim()) || i === g.cues.length - 1;
      if (!ends) return;
      out.push({
        t0: round3(g.start + open - scene.start),
        t1: round3(g.start + c.end - scene.start),
        ...(first ? { stop: true } : {}),
      });
      first = false;
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
    design: "v2",
  });
  const cuesOf = new Map<string, Cue[]>();
  const durationOf = new Map<string, number>();
  for (const sc of timing.scenes) {
    const beat = kept[Number(sc.id.slice(1)) - 1];
    if (beat) {
      cuesOf.set(beat.id, sentenceCues(timing, sc.id));
      durationOf.set(beat.id, sc.duration);
    }
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
    const rel = spec.image;
    const image = rel ? resolve(input.planDir, rel) : undefined;
    const layers = await impl.layers({
      beatId: beat.id,
      ...(image ? { image } : {}),
      dir,
      region,
      spec,
      theme,
      earlier,
    });
    earlier.set(beat.id, { kind: spec.kind, layers, labels: spec.labels });
    const fragment = literalFragment(spec.kind, layers, region, cues, spec, theme);
    const late = lateReveals(fragment.script, durationOf.get(beat.id) ?? Number.POSITIVE_INFINITY);
    if (late.length)
      throw new Error(
        `literal: ${beat.id} (${spec.kind}) shows ${late
          .slice(0, 4)
          .map((r) => `${r.id} at ${r.at}s`)
          .join(
            ", ",
          )} too late to stand whole for ${SEEN_WHOLE_S}s before the scene ends at ${durationOf.get(beat.id)}s`,
      );
    map[beat.id] = {
      fragment,
      holds: placeholder[beat.id]?.holds ?? [],
      ...(eyebrow ? { eyebrow } : {}),
      // Its pictures move inside their own panels; the body is clipped to its box (BespokeEntry).
      clip: true,
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

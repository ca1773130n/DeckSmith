/**
 * VARIETY: the plan-level rule that a deck must not be one layout repeated.
 *
 * The measured failure this answers (2026-10-09, a 14-beat Korean paper deck,
 * no figures, planned with `--images`): 5 split-compare, 5 pipeline, 2 callout,
 * 1 title, 1 bar-compare, ZERO illustrations — and beats 2 to 12 alternated
 * split-compare / pipeline / split-compare / pipeline for nine slides running.
 * RULE 1's "not the same archetype twice in a row" held at every pair, and the
 * deck still read, slide after slide, as the same two cards on a pale ground.
 * The prompt said a stage MAY carry an illustration; the planner never did.
 *
 * So the rule is a minimum, not an invitation, and it is CHECKED: the prompt
 * (src/plan/prompt.ts) states these numbers by importing them from here, and
 * `codexPlanner` (src/plan/codex.ts) runs `varietyFindings` on what comes back,
 * asks once for a repair, and refuses a plan that still breaks it. One table,
 * read by both, so the sentence the model is given and the check it is held to
 * cannot drift apart.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never rewrites a beat. Turning a pipeline
 * into a stage needs a picture brief only the planner can write honestly, and
 * reordering beats breaks the narration's argument. A plan that breaks the rule
 * goes back to the planner with the reasons, which is the only repair that
 * keeps the deck's content the planner's.
 */
import type { Prefs } from "../prefs.js";
import type { Archetype, Beat, Storyboard } from "../types.js";

/** A deck this long must carry stage beats. Below it there is no room to spend one. */
export const STAGE_MIN_BEATS = 8;
/** At least one stage per this many beats, when the deck may ask for pictures. */
export const STAGE_EVERY = 4;
/** Longest A/B/A/B run allowed: three beats (A, B, A) is a return; four is a rut. */
export const MAX_ALTERNATION = 3;

/**
 * At least this share of a deck's beats are SCENES — a picture owns or backs
 * them — when the deck may ask for pictures. Three stages in fourteen still left
 * nine beats of cards on the pack's pale ground in the 2026-10-09 ko e2e; a
 * diagram with a `backdrop` is drawn over a picture, so "most beats are scenes"
 * no longer costs the diagram.
 */
export const SCENE_SHARE = 0.6;

/**
 * The archetypes that draw boxes, cards or rows of them — what the founder
 * means by slideware. A backdrop puts them in a scene but they are still
 * panels: round 1 of the 2026-10-09 ko e2e had ten of fourteen beats as
 * scenes, and nine of fourteen were still panels over pictures.
 */
export const PANEL_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  "pipeline",
  "split-compare",
  "callout",
  "stack",
  "data-table",
]);
/** At most this share of a picture deck's beats are panels: five of fourteen. */
export const PANEL_SHARE = 0.36;

/** How many panel beats a deck of `beats` may carry, given whether it may ask for pictures. */
export function panelsAllowed(beats: number, images: Prefs["images"]): number {
  if (!images.enabled || beats < STAGE_MIN_BEATS) return Number.POSITIVE_INFINITY;
  return Math.max(2, Math.round(beats * PANEL_SHARE));
}

/** How many stage beats a deck of `beats` must carry, given the picture cap. */
export function stagesRequired(beats: number, images: Prefs["images"]): number {
  if (!images.enabled || beats < STAGE_MIN_BEATS) return 0;
  return Math.min(Math.floor(beats / STAGE_EVERY), images.max);
}

/** How many beats of a deck of `beats` must be scenes (`SCENE_SHARE`), given the picture cap. */
export function scenesRequired(beats: number, images: Prefs["images"]): number {
  if (!images.enabled || beats < STAGE_MIN_BEATS) return 0;
  return Math.min(Math.ceil(beats * SCENE_SHARE), images.max);
}

/**
 * Whether a picture owns or backs this beat: a stage, a figure beat, a
 * split-compare side with a picture, or a diagram over a `backdrop`. A brief
 * counts as a figure does — it is a picture by the time anyone sees the deck.
 * A hero number and a kinetic claim are scenes with or without one: with none
 * they fill the frame with a field of colour, never the pale ground.
 */
export function isScene(beat: Beat): boolean {
  const p = beat.params as Record<string, unknown>;
  const pictured = (x: unknown) => {
    const o = x as { figureId?: unknown; illustration?: unknown } | undefined;
    return o?.figureId !== undefined || o?.illustration !== undefined;
  };
  switch (beat.archetype) {
    case "stage":
    case "claim-figure":
    case "annotated-figure":
    case "hero-number":
    case "kinetic":
      return true;
    case "split-compare":
      return pictured(p.left) || pictured(p.right) || pictured(p.backdrop);
    default:
      return pictured(p.backdrop);
  }
}

/**
 * Every way `storyboard` breaks the variety rule, as sentences the planner can
 * act on. Empty is a pass.
 */
export function varietyFindings(storyboard: Storyboard, images: Prefs["images"]): string[] {
  const beats = storyboard.beats;
  const out: string[] = [];

  // RULE 1, which the prompt has always stated and nothing ever checked.
  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1] as Beat;
    const b = beats[i] as Beat;
    if (a.archetype === b.archetype) {
      out.push(
        `${a.id} and ${b.id} are both \`${a.archetype}\`, next to each other. Draw one of them as a different shape.`,
      );
    }
  }

  // A/B/A/B: every beat equal to the one two back and not the one before.
  let start = 0;
  for (let i = 2; i <= beats.length; i++) {
    const alternates =
      i < beats.length &&
      beats[i]?.archetype === beats[i - 2]?.archetype &&
      beats[i]?.archetype !== beats[i - 1]?.archetype;
    if (alternates) continue;
    // The run is beats[start .. i-1]; a run that never alternated is 2 long.
    const len = i - start;
    if (len > MAX_ALTERNATION) {
      const first = beats[start] as Beat;
      const second = beats[start + 1] as Beat;
      out.push(
        `${first.id} to ${(beats[i - 1] as Beat).id} alternate \`${first.archetype}\` and \`${second.archetype}\` for ${len} beats running; at most ${MAX_ALTERNATION} may. Break the run with a different shape — a stage, a chart, a stack, a grid.`,
      );
    }
    start = i - 1;
  }

  const need = stagesRequired(beats.length, images);
  const stages = beats.filter((b) => b.archetype === "stage");
  if (stages.length < need) {
    out.push(
      `${beats.length} beats carry ${stages.length} stage beat(s); a deck this long needs at least ${need} (one per ${STAGE_EVERY}). Give points with no figure a full-bleed \`stage\` with an \`illustration\` brief.`,
    );
  }
  const scenes = scenesRequired(beats.length, images);
  const pictured = beats.filter(isScene).length;
  if (pictured < scenes) {
    out.push(
      `${beats.length} beats carry ${pictured} scene(s); at least ${scenes} must be scenes. Set a number the source reports as a \`hero-number\` and a single strong claim as \`kinetic\`, or give the pipeline, split-compare, callout and bar-compare beats a \`backdrop\` with an \`illustration\` brief — a scene that fits the point, calm where the panels sit.`,
    );
  }
  const panelCap = panelsAllowed(beats.length, images);
  const panels = beats.filter((b) => PANEL_ARCHETYPES.has(b.archetype));
  if (panels.length > panelCap) {
    out.push(
      `${panels.length} of ${beats.length} beats are panels (${panels.map((b) => `${b.id} \`${b.archetype}\``).join(", ")}); at most ${panelCap} may be. Redraw the rest: a number the source reports is a \`hero-number\`, a single strong claim is \`kinetic\`, a trend is a \`line-chart\`, magnitudes are \`bar-compare\`, a turn in the argument is a \`stage\`.`,
    );
  }
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1];
    const b = stages[i];
    if (a?.archetype === "stage" && b?.archetype === "stage") {
      if (a.params.placement === b.params.placement) {
        out.push(
          `stages ${a.id} and ${b.id} both set their words at "${a.params.placement}". Consecutive stages take different placements.`,
        );
      }
    }
  }
  return out;
}
